/* Durable Control observability.

   Control may name the workspace it is currently operating in with
   x-mccluster-org-id, but that header is never trusted by itself. The event is
   persisted only after the caller's bearer token resolves to a real user and
   that user is verified as a member of the claimed organization.

   The request/response body is deliberately not retained. This is an
   operational trace, not a second analytics or message store. */

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

function cleanText(value, max = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function eventLevel(status) {
  const code = Number(status || 0);
  if (code >= 500) return 'error';
  if (code >= 400) return 'warn';
  return 'info';
}

function schedule(ctx, promise) {
  const guarded = Promise.resolve(promise).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(guarded);
  else void guarded;
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

async function persistVerifiedRequest(env, event) {
  const actor = await verifiedActor(env, event.authorization, event.orgId);
  if (!actor) return { recorded: false, reason: 'membership_unverified' };

  const row = {
    org_id: event.orgId,
    trace_id: event.traceId,
    request_id: event.requestId,
    parent_span_id: isUuid(event.parentSpanId) ? event.parentSpanId : null,
    event_kind: 'request',
    level: eventLevel(event.status),
    service: 'mccluster-worker',
    route: cleanText(event.route, 500) || '/',
    method: cleanText(event.method, 16),
    status_code: Number.isInteger(event.status) ? event.status : null,
    duration_ms: Math.max(0, Math.round(Number(event.durationMs) || 0)),
    actor_user_id: actor.userId,
    resource_type: null,
    resource_id: null,
    message: cleanText(`${event.method} ${event.route} → ${event.status}`, 1000),
    detail: {
      membership_role: actor.role,
      cf_ray: cleanText(event.cfRay, 120),
      colo: cleanText(event.colo, 32),
      country: cleanText(event.country, 8),
      worker_revision: cleanText(event.revision, 120)
    }
  };

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/control_observability_events`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), prefer: 'return=minimal' },
    body: JSON.stringify(row)
  });
  return { recorded: response.ok, status: response.status };
}

export async function observeControlRequest(request, env, ctx, handler) {
  const start = Date.now();
  const inputHeaders = new Headers(request.headers);
  const suppliedTrace = inputHeaders.get('x-mccluster-trace-id');
  const traceId = isUuid(suppliedTrace) ? suppliedTrace : crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const parentSpanId = inputHeaders.get('x-mccluster-parent-span-id');
  const orgId = inputHeaders.get('x-mccluster-org-id');
  const authorization = inputHeaders.get('authorization') || '';
  inputHeaders.set('x-mccluster-trace-id', traceId);
  inputHeaders.set('x-mccluster-request-id', requestId);

  const tracedRequest = new Request(request, { headers: inputHeaders });
  const url = new URL(tracedRequest.url);
  const route = url.pathname.replace(/\/+$/, '') || '/';

  let response;
  try {
    response = await handler(tracedRequest);
  } catch (error) {
    if (isUuid(orgId) && authorization && route !== '/v1/observability/events') {
      schedule(ctx, persistVerifiedRequest(env, {
        orgId, authorization, traceId, requestId, parentSpanId,
        route, method: tracedRequest.method,
        status: Number(error?.status) || 500,
        durationMs: Date.now() - start,
        cfRay: tracedRequest.headers.get('cf-ray'),
        colo: tracedRequest.cf?.colo,
        country: tracedRequest.cf?.country,
        revision: env?.CF_VERSION_METADATA?.id
      }));
    }
    throw error;
  }

  const headers = new Headers(response.headers);
  headers.set('x-mccluster-trace-id', traceId);
  headers.set('x-mccluster-request-id', requestId);
  const exposed = headers.get('access-control-expose-headers');
  const traceHeaders = 'x-mccluster-trace-id,x-mccluster-request-id';
  headers.set('access-control-expose-headers', exposed ? `${exposed},${traceHeaders}` : traceHeaders);
  const wrapped = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });

  if (isUuid(orgId) && authorization && route !== '/v1/observability/events') {
    schedule(ctx, persistVerifiedRequest(env, {
      orgId, authorization, traceId, requestId, parentSpanId,
      route, method: tracedRequest.method, status: wrapped.status,
      durationMs: Date.now() - start,
      cfRay: tracedRequest.headers.get('cf-ray'),
      colo: tracedRequest.cf?.colo,
      country: tracedRequest.cf?.country,
      revision: env?.CF_VERSION_METADATA?.id
    }));
  }

  return wrapped;
}

export async function listObservabilityEvents(env, orgId, url) {
  if (!isUuid(orgId)) throw Object.assign(new Error('org_id is required'), { status: 400 });

  const requested = Number(url.searchParams.get('limit') || 100);
  const limit = Math.min(200, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 100));
  const level = String(url.searchParams.get('level') || '').trim().toLowerCase();
  if (level && !['info', 'warn', 'error'].includes(level)) {
    throw Object.assign(new Error('level must be info, warn, or error'), { status: 400 });
  }
  const traceId = String(url.searchParams.get('trace_id') || '').trim();
  if (traceId && !isUuid(traceId)) {
    throw Object.assign(new Error('trace_id must be a UUID'), { status: 400 });
  }
  const rawSince = String(url.searchParams.get('since') || '').trim();
  let since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (rawSince) {
    const parsed = new Date(rawSince);
    if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error('since must be an ISO timestamp'), { status: 400 });
    since = parsed;
  }

  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    created_at: `gte.${since.toISOString()}`,
    select: 'id,org_id,trace_id,request_id,parent_span_id,event_kind,level,service,route,method,status_code,duration_ms,actor_user_id,resource_type,resource_id,message,detail,created_at',
    order: 'created_at.desc,id.desc',
    limit: String(limit + 1)
  });
  if (level) params.set('level', `eq.${level}`);
  if (traceId) params.set('trace_id', `eq.${traceId}`);

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/control_observability_events?${params.toString()}`,
    { headers: serviceHeaders(env) }
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    throw Object.assign(new Error('Observability event read failed'), { status: response.status, detail: rows });
  }
  const hasMore = rows.length > limit;
  return { events: hasMore ? rows.slice(0, limit) : rows, has_more: hasMore, since: since.toISOString() };
}
