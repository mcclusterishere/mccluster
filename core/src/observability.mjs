/* Core's producer for the canonical observability contract
   (public.control_observability_events), the same table the Worker writes.

   Core events are server-side facts about work Core actually did: a job ran
   or failed, a capability was dispatched, a resident AI turn looked the web
   up or ran inference. Each is pinned to the org the work belongs to and to a
   trace: the job's own trace_id when one was handed in, otherwise the job id,
   so every event for one job opens as one trace in System · Observability.

   Never throws and never blocks for long: observability must not be the
   reason a job fails. Arguments, prompts and outputs are not recorded. */
import { randomUUID } from 'node:crypto';
import { rest } from './supabase.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS = new Set(['info', 'warn', 'error']);
const KINDS = new Set(['job', 'scheduled', 'dependency', 'incident', 'domain', 'capability']);
const OUTCOMES = new Set(['ok', 'error', 'refused', 'retry', 'pending', 'cancelled']);
const WRITE_TIMEOUT_MS = 5000;
const MAX_DETAIL_CHARS = 8000;

const uuid = (value) => (UUID.test(String(value || '')) ? String(value).toLowerCase() : null);

function text(value, max) {
  const out = String(value ?? '').trim();
  return out ? out.slice(0, max) : null;
}

function name(value) {
  return String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 120) || null;
}

function bounded(detail) {
  if (!detail || typeof detail !== 'object') return {};
  let json;
  try { json = JSON.stringify(detail); } catch { return { unserializable: true }; }
  if (json.length <= MAX_DETAIL_CHARS) return JSON.parse(json);
  return { truncated: true, bytes: json.length, preview: json.slice(0, MAX_DETAIL_CHARS) };
}

/* The trace a job's events belong to. */
export function jobTraceId(job) {
  return uuid(job?.input?.trace_id) || uuid(job?.trace_id) || uuid(job?.id) || randomUUID();
}

export function coreEventRow(fields = {}) {
  const orgId = uuid(fields.orgId);
  const eventName = name(fields.name);
  if (!orgId || !eventName) return null;
  const level = LEVELS.has(fields.level) ? fields.level : 'info';
  const duration = Number(fields.durationMs);
  return {
    org_id: orgId,
    trace_id: uuid(fields.traceId) || randomUUID(),
    request_id: uuid(fields.requestId) || uuid(fields.traceId) || randomUUID(),
    span_id: randomUUID(),
    parent_span_id: uuid(fields.parentSpanId),
    event_kind: KINDS.has(fields.kind) ? fields.kind : 'job',
    event_name: eventName,
    level,
    outcome: OUTCOMES.has(fields.outcome) ? fields.outcome : (level === 'error' ? 'error' : 'ok'),
    source: 'core',
    service: text(fields.service, 64) || 'mccluster-core',
    route: text(fields.route, 500) || `core:${eventName}`,
    method: null,
    status_code: null,
    duration_ms: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null,
    actor_user_id: uuid(fields.actorUserId),
    resource_type: text(fields.resourceType, 64),
    resource_id: text(fields.resourceId, 200),
    message: text(fields.message, 2000),
    detail: bounded(fields.detail),
    occurred_at: new Date(fields.occurredAt || Date.now()).toISOString(),
  };
}

export async function emitCoreEvent(fields = {}) {
  const row = coreEventRow(fields);
  if (!row) return { recorded: false, reason: 'org_and_name_required' };
  try {
    await rest('control_observability_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([row]),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
    return { recorded: true, trace_id: row.trace_id };
  } catch (error) {
    console.error(JSON.stringify({ event: 'core_observability_write_failed', name: row.event_name, message: error?.message || String(error) }));
    return { recorded: false, reason: 'write_failed' };
  }
}
