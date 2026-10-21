/* Durable Control observability.

   One canonical, org-scoped event contract (public.control_observability_events)
   carries three kinds of record:

   - REQUEST rows. Control names the workspace it is operating in with
     x-mccluster-org-id, but that header is never trusted by itself: the row is
     persisted only after the caller's bearer token resolves to a real user who
     is verified as a member of the claimed organization.
   - DOMAIN events, emitted by server code that has already authorized the
     caller for the org it names (an audited mutation, a paid media
     reservation, an AI decision transition). They share the request's trace
     and request ids, so one trace shows the request and what it changed.
   - CORE and future OTel/Logpush rows, written by other producers into the
     same contract (see core/src/observability.mjs).

   The request/response body is deliberately not retained. This is an
   operational trace, not a second analytics or message store. Successful fast
   reads are not retained either: they are the bulk of Control's traffic and
   carry no signal, so the retained tail is mutations, failures and slow reads. */

import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage();

/* Retention, enforced by pruneObservabilityEvents on the Worker cron. */
export const OBSERVABILITY_RETENTION_DAYS = Object.freeze({ info: 14, warn: 90, error: 90 });
/* A read slower than this is retained even when it succeeded. */
const SLOW_READ_MS = 1000;
/* A runaway loop cannot turn one request into an unbounded write. */
const MAX_DOMAIN_EVENTS_PER_REQUEST = 25;
const MAX_DETAIL_CHARS = 8000;

const LEVELS = new Set(['info', 'warn', 'error']);
const KINDS = new Set(['request', 'job', 'scheduled', 'dependency', 'incident', 'domain', 'capability']);
const OUTCOMES = new Set(['ok', 'error', 'refused', 'retry', 'pending', 'cancelled']);
const SOURCES = new Set(['worker', 'core', 'supabase', 'provider', 'browser', 'otel', 'logpush']);

/* PostgREST takes a bulk insert's columns from its first object, so every
   row is written with exactly these keys. */
const ROW_KEYS = [
  'org_id', 'trace_id', 'request_id', 'span_id', 'parent_span_id', 'event_kind', 'event_name',
  'level', 'outcome', 'source', 'service', 'route', 'method', 'status_code', 'duration_ms',
  'actor_user_id', 'resource_type', 'resource_id', 'message', 'detail', 'occurred_at'
];

function shape(row) {
  const out = {};
  for (const key of ROW_KEYS) out[key] = row[key] ?? null;
  if (!out.detail) out.detail = {};
  if (!out.occurred_at) out.occurred_at = new Date().toISOString();
  if (!out.source) out.source = 'worker';
  return out;
}

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

/* Trace ids may come from other producers (Core job ids, OpenTelemetry trace
   ids rendered as UUIDs), so any 128-bit hex id in UUID form is accepted. */
function isTraceId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function cleanText(value, max = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

/* Event names are dotted lowercase identifiers: work.task.create. */
export function eventName(value) {
  const name = String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 120);
  return name || null;
}

function boundDetail(detail) {
  if (detail === null || detail === undefined) return {};
  let json;
  try { json = JSON.stringify(detail); } catch { return { unserializable: true }; }
  if (json === undefined) return {};
  if (json.length <= MAX_DETAIL_CHARS) return JSON.parse(json);
  return { truncated: true, bytes: json.length, preview: json.slice(0, MAX_DETAIL_CHARS) };
}

function eventLevel(status) {
  const code = Number(status || 0);
  if (code >= 500) return 'error';
  if (code >= 400) return 'warn';
  return 'info';
}

function schedule(ctx, promise) {
  const guarded = Promise.resolve(promise).catch((error) => {
    console.error(JSON.stringify({
      event: 'observability_write_failed',
      message: error instanceof Error ? error.message : String(error)
    }));
  });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(guarded);
  return guarded;
}

/* The trace this code is running under, when there is one. */
export function currentTrace() {
  const store = scope.getStore();
  return store ? { trace_id: store.traceId, request_id: store.requestId } : null;
}

/* Record a domain event under the current request's trace.

   Callers are server code that has already authorized the actor for orgId;
   the org is never taken from the client here. Outside a traced request the
   call is a no-op, so library code can call it unconditionally. */
export function recordEvent(fields = {}) {
  const store = scope.getStore();
  if (!store) return false;
  if (!isUuid(fields.orgId)) return false;
  if (store.events.length >= MAX_DOMAIN_EVENTS_PER_REQUEST) {
    store.dropped += 1;
    return false;
  }
  const name = eventName(fields.name);
  if (!name) return false;
  const level = LEVELS.has(fields.level) ? fields.level : 'info';
  const kind = KINDS.has(fields.kind) && fields.kind !== 'request' ? fields.kind : 'domain';
  const traceId = isTraceId(fields.traceId) ? fields.traceId : store.traceId;
  store.events.push({
    org_id: fields.orgId,
    trace_id: traceId,
    request_id: store.requestId,
    span_id: crypto.randomUUID(),
    parent_span_id: store.spanId,
    event_kind: kind,
    event_name: name,
    level,
    outcome: OUTCOMES.has(fields.outcome) ? fields.outcome : (level === 'error' ? 'error' : 'ok'),
    source: 'worker',
    service: 'mccluster-worker',
    route: cleanText(store.route, 500) || '/',
    method: cleanText(store.method, 16),
    status_code: null,
    duration_ms: Number.isFinite(Number(fields.durationMs)) ? Math.max(0, Math.round(Number(fields.durationMs))) : null,
    actor_user_id: isUuid(fields.actorUserId) ? fields.actorUserId : null,
    resource_type: cleanText(fields.resourceType, 64),
    resource_id: cleanText(fields.resourceId, 200),
    message: cleanText(fields.message, 2000),
    detail: boundDetail(fields.detail),
    occurred_at: new Date().toISOString()
  });
  return true;
}

async function verifiedActor(env, authorization, orgId) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!isUuid(orgId) || !/^Bearer\s+/i.test(String(authorization || ''))) return null;
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim();
  if (!token || token === env.SUPABASE_SERVICE_ROLE_KEY) return null;

  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${token}`
    }
  });
  if (!userResponse.ok) return null;
  const user = await userResponse.json().catch(() => null);
  if (!user?.id) return null;

  const membership = await fetch(
    `${env.SUPABASE_URL}/rest/v1/org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(user.id)}&select=org_id,role&limit=1`,
    { headers: serviceHeaders(env) }
  );
  if (!membership.ok) return null;
  const rows = await membership.json().catch(() => []);
  if (!rows?.length) return null;
  return { userId: user.id, role: rows[0].role || null };
}

async function requestRow(env, event) {
  const actor = await verifiedActor(env, event.authorization, event.orgId);
  if (!actor) return null;
  return {
    org_id: event.orgId,
    trace_id: event.traceId,
    request_id: event.requestId,
    span_id: event.spanId,
    parent_span_id: isUuid(event.parentSpanId) ? event.parentSpanId : null,
    event_kind: 'request',
    event_name: 'http.request',
    level: eventLevel(event.status),
    outcome: Number(event.status) >= 400 ? (Number(event.status) >= 500 ? 'error' : 'refused') : 'ok',
    source: 'worker',
    service: 'mccluster-worker',
    route: cleanText(event.route, 500) || '/',
    method: cleanText(event.method, 16),
    status_code: Number.isInteger(event.status) ? event.status : null,
    duration_ms: Math.max(0, Math.round(Number(event.durationMs) || 0)),
    actor_user_id: actor.userId,
    resource_type: null,
    resource_id: null,
    message: cleanText(`${event.method} ${event.route} → ${event.status}`, 1000),
    occurred_at: new Date(event.startedAt).toISOString(),
    detail: {
      membership_role: actor.role,
      cf_ray: cleanText(event.cfRay, 120),
      colo: cleanText(event.colo, 32),
      country: cleanText(event.country, 8),
      worker_revision: cleanText(event.revision, 120),
      ...(event.droppedEvents ? { dropped_domain_events: event.droppedEvents } : {})
    }
  };
}

async function insertRows(env, rows) {
  if (!rows.length || !env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) return { recorded: 0 };
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/control_observability_events`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), prefer: 'return=minimal' },
    body: JSON.stringify(rows.map(shape))
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`observability insert rejected (${response.status}): ${text.slice(0, 300)}`);
  }
  return { recorded: rows.length };
}

/* A request row is worth keeping when it changed something, failed, or was
   slow. A fast successful read is Control polling itself. */
function retainRequest({ method, status, durationMs }) {
  const read = method === 'GET' || method === 'HEAD';
  return !read || Number(status) >= 400 || Number(durationMs) >= SLOW_READ_MS;
}

async function flush(env, store, request) {
  const rows = [...store.events];
  let requestState = request ? 'not_retained' : 'none';
  if (request && retainRequest(request)) {
    const row = await requestRow(env, { ...request, droppedEvents: store.dropped });
    /* A claimed workspace the caller does not belong to is never written. */
    requestState = row ? 'recorded' : 'membership_unverified';
    if (row) rows.unshift(row);
  }
  const written = await insertRows(env, rows);
  return { ...written, request: requestState };
}

function traceHeaders(response, traceId, requestId) {
  /* An upgraded socket cannot be re-wrapped without losing it. */
  if (response.status === 101 || response.webSocket) return response;
  const headers = new Headers(response.headers);
  headers.set('x-mccluster-trace-id', traceId);
  headers.set('x-mccluster-request-id', requestId);
  const exposed = String(headers.get('access-control-expose-headers') || '').split(',').map((v) => v.trim()).filter(Boolean);
  for (const name of ['x-mccluster-trace-id', 'x-mccluster-request-id']) {
    if (!exposed.some((v) => v.toLowerCase() === name)) exposed.push(name);
  }
  headers.set('access-control-expose-headers', exposed.join(','));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function observeControlRequest(request, env, ctx, handler) {
  const start = Date.now();
  const inputHeaders = new Headers(request.headers);
  const suppliedTrace = inputHeaders.get('x-mccluster-trace-id');
  const traceId = isTraceId(suppliedTrace) ? suppliedTrace.toLowerCase() : crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const parentSpanId = inputHeaders.get('x-mccluster-parent-span-id');
  const orgId = inputHeaders.get('x-mccluster-org-id');
  const authorization = inputHeaders.get('authorization') || '';
  inputHeaders.set('x-mccluster-trace-id', traceId);
  inputHeaders.set('x-mccluster-request-id', requestId);

  const tracedRequest = new Request(request, { headers: inputHeaders });
  const url = new URL(tracedRequest.url);
  const route = url.pathname.replace(/\/+$/, '') || '/';
  const store = {
    traceId, requestId, spanId: crypto.randomUUID(), parentSpanId,
    route, method: tracedRequest.method, events: [], dropped: 0
  };
  const observable = isUuid(orgId) && authorization && route !== '/v1/observability/events';

  const describe = (status) => (observable ? {
    orgId, authorization, traceId, requestId, parentSpanId, spanId: store.spanId,
    route, method: tracedRequest.method, status,
    startedAt: start,
    durationMs: Date.now() - start,
    cfRay: tracedRequest.headers.get('cf-ray'),
    colo: tracedRequest.cf?.colo,
    country: tracedRequest.cf?.country,
    revision: env?.CF_VERSION_METADATA?.id
  } : null);

  let response;
  try {
    response = await scope.run(store, () => handler(tracedRequest));
  } catch (error) {
    schedule(ctx, flush(env, store, describe(Number(error?.status) || 500)));
    throw error;
  }
  schedule(ctx, flush(env, store, describe(response.status)));
  return traceHeaders(response, traceId, requestId);
}

/* Scheduled work (publish queue, cost reconciliation) has no request, but its
   domain events still belong in the same contract under their own trace. */
export async function observeScheduled(env, ctx, name, task) {
  const traceId = crypto.randomUUID();
  const store = {
    traceId,
    requestId: crypto.randomUUID(),
    spanId: crypto.randomUUID(),
    parentSpanId: null,
    route: `cron:${eventName(name) || 'scheduled'}`,
    method: null,
    events: [],
    dropped: 0
  };
  try {
    return await scope.run(store, task);
  } finally {
    schedule(ctx, flush(env, store, null));
  }
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(atob(String(raw).replace(/-/g, '+').replace(/_/g, '/')));
    const at = new Date(parsed?.t);
    const id = Number(parsed?.i);
    if (Number.isNaN(at.getTime()) || !Number.isSafeInteger(id) || id <= 0) return null;
    return { at: at.toISOString(), id };
  } catch {
    return null;
  }
}

function encodeCursor(row) {
  return btoa(JSON.stringify({ t: row.created_at, i: row.id }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const EVENT_COLUMNS = [
  'id', 'org_id', 'trace_id', 'request_id', 'span_id', 'parent_span_id', 'event_kind', 'event_name',
  'level', 'outcome', 'source', 'service', 'route', 'method', 'status_code', 'duration_ms',
  'actor_user_id', 'resource_type', 'resource_id', 'message', 'detail', 'occurred_at', 'created_at'
].join(',');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export async function listObservabilityEvents(env, orgId, url) {
  if (!isUuid(orgId)) throw badRequest('org_id is required');
  const q = url.searchParams;

  const requested = Number(q.get('limit') || 100);
  const limit = Math.min(200, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 100));

  const level = String(q.get('level') || '').trim().toLowerCase();
  if (level && !LEVELS.has(level)) throw badRequest('level must be info, warn, or error');

  const traceId = String(q.get('trace_id') || '').trim();
  if (traceId && !isTraceId(traceId)) throw badRequest('trace_id must be a UUID');
  const requestId = String(q.get('request_id') || '').trim();
  if (requestId && !isUuid(requestId)) throw badRequest('request_id must be a UUID');

  const resourceType = String(q.get('resource_type') || '').trim();
  const resourceId = String(q.get('resource_id') || '').trim();
  if ((resourceType && !/^[a-z][a-z0-9_.:-]{0,63}$/.test(resourceType)) || resourceId.length > 200) {
    throw badRequest('resource_type/resource_id are malformed');
  }
  if (resourceId && !resourceType) throw badRequest('resource_id requires resource_type');

  const kind = String(q.get('event_kind') || '').trim();
  if (kind && !KINDS.has(kind)) throw badRequest('event_kind is not recognised');
  const source = String(q.get('source') || '').trim();
  if (source && !SOURCES.has(source)) throw badRequest('source is not recognised');
  const name = String(q.get('event_name') || '').trim();
  if (name && name !== eventName(name)) throw badRequest('event_name is malformed');

  const rawCursor = q.get('cursor');
  const cursor = decodeCursor(rawCursor);
  if (rawCursor && !cursor) throw badRequest('cursor is malformed');

  /* A trace, request or resource drilldown looks back across the whole
     retention window by default; the tail defaults to the last 24 hours. */
  const drilldown = Boolean(traceId || requestId || resourceId);
  const rawSince = String(q.get('since') || '').trim();
  let since = new Date(Date.now() - (drilldown ? OBSERVABILITY_RETENTION_DAYS.error : 1) * 24 * 60 * 60 * 1000);
  if (rawSince) {
    const parsed = new Date(rawSince);
    if (Number.isNaN(parsed.getTime())) throw badRequest('since must be an ISO timestamp');
    since = parsed;
  }

  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    created_at: `gte.${since.toISOString()}`,
    select: EVENT_COLUMNS,
    order: 'created_at.desc,id.desc',
    limit: String(limit + 1)
  });
  if (level) params.set('level', `eq.${level}`);
  if (traceId) params.set('trace_id', `eq.${traceId.toLowerCase()}`);
  if (requestId) params.set('request_id', `eq.${requestId}`);
  if (resourceType) params.set('resource_type', `eq.${resourceType}`);
  if (resourceId) params.set('resource_id', `eq.${resourceId}`);
  if (kind) params.set('event_kind', `eq.${kind}`);
  if (source) params.set('source', `eq.${source}`);
  if (name) params.set('event_name', `eq.${name}`);
  if (cursor) params.set('or', `(created_at.lt."${cursor.at}",and(created_at.eq."${cursor.at}",id.lt.${cursor.id}))`);

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/control_observability_events?${params.toString()}`,
    { headers: serviceHeaders(env) }
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    throw Object.assign(new Error('Observability event read failed'), { status: response.status, detail: rows });
  }
  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  return {
    events,
    has_more: hasMore,
    next_cursor: hasMore ? encodeCursor(events[events.length - 1]) : null,
    since: since.toISOString(),
    retention_days: OBSERVABILITY_RETENTION_DAYS
  };
}

/* Retention: info rows age out after 14 days, warnings and errors after 90.
   Runs on the Worker cron with the service role; each pass deletes only rows
   past their window, so it is safe to repeat. */
export async function pruneObservabilityEvents(env, now = Date.now()) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) return { pruned: false, reason: 'supabase_not_configured' };
  const cutoff = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const passes = [
    ['info', cutoff(OBSERVABILITY_RETENTION_DAYS.info)],
    ['warn', cutoff(OBSERVABILITY_RETENTION_DAYS.warn)],
    ['error', cutoff(OBSERVABILITY_RETENTION_DAYS.error)]
  ];
  const results = {};
  for (const [level, before] of passes) {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/control_observability_events?level=eq.${level}&created_at=lt.${encodeURIComponent(before)}`,
      { method: 'DELETE', headers: { ...serviceHeaders(env), prefer: 'return=minimal' } }
    );
    if (!response.ok) throw new Error(`observability prune rejected for ${level} (${response.status})`);
    results[level] = before;
  }
  return { pruned: true, before: results };
}
