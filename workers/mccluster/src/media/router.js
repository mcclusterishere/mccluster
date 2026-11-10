import { currentTrace, recordEvent } from '../lib/observability.js';
import { billingEventsFal, classifySubmitError, collectAssetCandidates, normalizeFalStatus, resultFal, statusFal, submitFal, verifyFalWebhook } from './fal.js';
import { estimateModelCost } from './pricing.js';
import { requireOrgId } from '../social/security.js';
import { requireCapability } from '../lib/capabilities.js';
import { validateModelInput } from './input-contract.js';
import { recordAudit } from '../lib/audit.js';

function headers(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

export async function db(env, path, options = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers(env), ...(options.headers || {}) }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error('Media database request failed'), { status: res.status, detail: data });
  return data;
}

export async function rpc(env, name, payload) {
  return db(env, `rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function getOrg(env, userId, requestedOrgId) {
  const orgId = requireOrgId(requestedOrgId);
  const rows = await db(env, `org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(userId)}&select=org_id,role&limit=1`);
  if (!rows?.length) throw Object.assign(new Error('You are not a member of that organization'), { status: 403 });
  return rows[0];
}

export async function modelById(env, id) {
  const rows = await db(env, `media_models?id=eq.${encodeURIComponent(id)}&enabled=eq.true&select=*`);
  return rows?.[0] || null;
}

export async function jobById(env, id, orgId) {
  const rows = await db(env, `media_jobs?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(orgId)}&select=*`);
  return rows?.[0] || null;
}

/* The same row without an organization filter: only for callers that already
   hold the job by another verified handle (the provider's webhook, the cron
   sweep, a write this module just made). Never for a member's request. */
async function jobByIdAnyOrg(env, id) {
  const rows = await db(env, `media_jobs?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return rows?.[0] || null;
}

/* Idempotent paid work (audit C5): a stable operation id makes a repeated
   request resolve to the one job it already made instead of a second
   reservation and provider submission. The decision is an ATOMIC CLAIM in
   public.media_operation_claims (applied in production as
   supabase/migrations/20261109194957_media_operation_claims_v1.sql; the
   functions called here are the additive
   supabase/pending/media_operation_claims_v2.sql): the first caller to insert
   (org_id, operation_id) wins the right to reserve budget; it binds the job
   id to the claim; every other caller, whatever isolate or retry it came
   from, gets that job back. A reused id with a different request body is
   refused (fingerprint mismatch). The old check-then-create lookup is kept
   only as the loser's readback. Core MCP calls carry a stable id from Core
   (core/src/tools/mcp-http.mjs); API callers may send their own. Without an
   id the request is a deliberate one-off. */
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function operationIdFrom(body) {
  const raw = body?.operation_id;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !OPERATION_ID.test(raw)) {
    throw Object.assign(new Error('operation_id must be 1-128 characters of letters, digits, ".", "_", ":" or "-"'), { status: 400 });
  }
  return raw;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/* What the operation id is bound to: the org, the resolved model, the exact
   provider input, the budget and the strategy. Key order never matters. */
export async function operationFingerprint(body, model) {
  const input = { ...(body?.input || {}) };
  if (body?.prompt && !input.prompt) input.prompt = body.prompt;
  const text = canonicalJson({
    org_id: body?.org_id || null,
    model_id: model?.id || body?.model_id || null,
    provider_model_id: model?.provider_model_id || null,
    input,
    budget_cents: body?.budget_cents ?? null,
    strategy: body?.strategy || 'explicit-model'
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function jobByOperationId(env, orgId, operationId) {
  const rows = await db(env, `media_jobs?org_id=eq.${encodeURIComponent(orgId)}&routing->>operation_id=eq.${encodeURIComponent(operationId)}&select=*&order=created_at.asc&limit=1`);
  return rows?.[0] || null;
}

/* Org-checked readback of the job bound to an operation id (the loser's and
   the reconciler's handle). Membership is required; null when nothing is bound. */
export async function jobForOperation(request, env, user) {
  let body;
  try { body = await request.json(); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  const org = await getOrg(env, user.id, body.org_id);
  const operationId = operationIdFrom(body);
  if (!operationId) throw Object.assign(new Error('operation_id is required'), { status: 400 });
  return jobByOperationId(env, org.org_id, operationId);
}

function claimError(status, message, reason, detail) {
  return Object.assign(new Error(message), { status, reason, detail });
}

/* COMPARE-AND-SET ON THE JOB ROW (recovery lane, 2026-11-09).

   Every status write after the reservation is a PATCH that names the state it
   expects (a PostgREST filter beside id=eq.<job>); a write that matches no row
   changed nothing, and the caller re-reads instead of assuming. That is what
   makes "exactly one submitter per job" and "status never regresses" true
   across isolates, retries, the provider webhook, the cron sweep and an
   operator decision, none of which share memory.

   PostgREST contract these rely on (documented behaviour, asserted against the
   synthetic plane in test/media-operation-recovery.test.mjs; not re-verified
   against the live plane from this change): a PATCH with Prefer:
   return=representation that matches no row answers 200 with [], and JSON path
   filters (routing->>key) apply to PATCH as they do to GET. */
const SUBMIT_PROTOCOL = 'cas-v1';
/* May send the provider request: reserved, never marked, no request id. */
export const CAS_SUBMIT = 'status=eq.queued&routing->>reservation_state=eq.reserved&provider_request_id=is.null&provider_status->>outcome=is.null';
/* May record the provider's request id: nobody (the webhook) recorded one first. */
export const CAS_RECORD = 'provider_request_id=is.null&status=in.(queued,reconciling)';
/* May mark the submit outcome unknown: still marked submitting, still no request id. */
export const CAS_UNCERTAIN = 'status=eq.queued&provider_request_id=is.null&provider_status->>outcome=eq.submitting';
/* May move an open job: never out of a terminal state. */
export const CAS_REFRESH = 'status=not.in.(completed,failed,cancelled)';
/* May fail a job before any provider request exists for it. */
export const CAS_FAIL_PRESUBMIT = 'status=eq.queued&provider_request_id=is.null';
/* May attach a provider request id named by an authenticated webhook hint. */
export const CAS_HINT_ATTACH = 'provider=eq.fal&provider_request_id=is.null&status=in.(queued,reconciling,failed)&routing->>submit_protocol=eq.cas-v1&routing->>reservation_state=neq.settled';
/* Consecutive provider 404s before a request id is treated as unknown. */
const UNKNOWN_REQUEST_THRESHOLD = 3;

async function jobByProviderRequestId(env, requestId) {
  const rows = await db(env, `media_jobs?provider=eq.fal&provider_request_id=eq.${encodeURIComponent(requestId)}&select=*&limit=1`);
  return rows?.[0] || null;
}

export async function patchJob(env, id, values) {
  const rows = await db(env, `media_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
  return rows?.[0] || null;
}

/* The compare-and-set write: the row, or null when the filter matched nothing
   (an empty body and [] both mean zero rows). Throws only when the request
   itself failed, which says nothing about whether it was applied. */
export async function patchJobWhere(env, id, filter, values) {
  const rows = await db(env, `media_jobs?id=eq.${encodeURIComponent(id)}&${filter}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
  return (Array.isArray(rows) ? rows[0] : null) || null;
}

function isSettled(job) {
  return (job?.actual_cost_cents ?? null) !== null || job?.routing?.reservation_state === 'settled';
}

function isMissingFunction(error) {
  const code = error?.detail?.code;
  return code === 'PGRST202' || code === '42883';
}

function refusalMessage(error) {
  return String(error?.detail?.message || error?.message || '');
}

/* THE WEBHOOK HINT. A job whose submit outcome is unknown has no provider
   request id, so the provider's webhook (which names only its own request id)
   cannot find it. The webhook URL given to the provider therefore carries the
   job id and a token only this Worker can derive:
   base64url(HMAC-SHA256(MEDIA_WEBHOOK_HINT_SECRET, 'fal-webhook-hint:' + job id)).
   Nothing is stored, so a member who can read the job row cannot forge it,
   and a webhook is matched by the hint only after the token verifies. Without
   the secret (32+ characters) the URL is the plain one and matching is by
   request id alone, as before. */
const HINT_LABEL = 'fal-webhook-hint:';
const HINT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

async function hintKey(env, usage) {
  const secret = String(env?.MEDIA_WEBHOOK_HINT_SECRET || '');
  if (secret.length < 32) return null;
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function webhookUrlFor(env, origin, jobId) {
  const base = `${origin}/v1/media/webhooks/fal`;
  const key = jobId ? await hintKey(env, 'sign') : null;
  if (!key) return base;
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${HINT_LABEL}${jobId}`));
  return `${base}/${jobId}/${bytesToBase64Url(mac)}`;
}

export async function verifyWebhookHint(env, jobId, token) {
  if (typeof jobId !== 'string' || !jobId || typeof token !== 'string' || !HINT_TOKEN.test(token)) return false;
  const key = await hintKey(env, 'verify');
  if (!key) return false;
  let signature;
  try {
    const binary = atob(`${token.replace(/-/g, '+').replace(/_/g, '/')}=`);
    signature = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(`${HINT_LABEL}${jobId}`));
}

/* Winner/loser protocol (supabase/pending/media_operation_claims_v2.sql, which
   must be applied before this Worker ships). Returns { won: true, attempt }
   for the winner (the first caller, or a same-fingerprint takeover of a claim
   that produced no job inside the window), otherwise the durable outcome: the
   bound job (repaired to it when the winner stopped before the bind), the
   recorded definite failure, or a 'pending' refusal that says when the claim
   expires. Fails closed when the claim cannot be consulted: nothing is
   reserved, including when the v2 functions are missing. */
async function claimOperation(env, { orgId, operationId, fingerprint, actorId, operationType }) {
  let claim;
  try {
    claim = await rpc(env, 'media_claim_operation_v2', {
      p_org_id: orgId, p_operation_id: operationId, p_fingerprint: fingerprint, p_actor_id: actorId, p_operation_type: operationType
    });
  } catch (error) {
    if (/operation_payload_mismatch/.test(refusalMessage(error))) {
      throw claimError(409, 'operation_id was already used with a different request', 'operation_payload_mismatch', { operation_id: operationId });
    }
    if (isMissingFunction(error)) {
      recordEvent({
        orgId, name: 'media.operation.claims_v2_missing', kind: 'dependency', level: 'error', outcome: 'error',
        actorUserId: actorId, resourceType: 'media_operation', resourceId: operationId,
        message: 'media_claim_operation_v2 is not deployed (apply supabase/pending/media_operation_claims_v2.sql); nothing was reserved'
      });
    }
    throw claimError(503, 'Paid operation claims are unavailable; nothing was reserved', 'operation_claims_unavailable', { operation_id: operationId });
  }
  const outcome = Array.isArray(claim) ? claim[0] : claim;
  const row = outcome?.claim;
  if (outcome?.outcome === 'won') {
    return { won: true, attempt: Number(outcome.attempt ?? row?.attempt ?? 1) || 1, takeover: outcome.takeover === true };
  }
  if (!row) throw claimError(503, 'Paid operation claim returned no decision; nothing was reserved', 'operation_claims_unavailable', { operation_id: operationId });
  if (row.state === 'failed') {
    const message = row.failure?.message || 'The operation already failed';
    throw claimError(409, message, 'operation_failed', { operation_id: operationId, failure: row.failure || null });
  }
  if (row.job_id) {
    const job = await jobById(env, row.job_id, orgId) || await jobByOperationId(env, orgId, operationId);
    if (job) return { won: false, job };
  }
  /* claimed, or bound to a job row that is gone: the winner is mid-flight, or
     it stopped. Either way this caller reserves nothing. */
  const job = await jobByOperationId(env, orgId, operationId);
  if (job) return { won: false, job };
  throw claimError(409, 'This operation is already in progress; read it back by operation_id', 'operation_pending', {
    operation_id: operationId, claimed_at: row.claimed_at || null, expires_at: outcome?.expires_at || null, attempt: row.attempt ?? null
  });
}

/* Bind by job identity: 'bound', 'already_bound' and 'repaired' are all
   success (a loser's repair and the winner's bind cannot fail each other). */
async function bindOperation(env, orgId, operationId, jobId) {
  const bound = await rpc(env, 'media_bind_operation_v2', { p_org_id: orgId, p_operation_id: operationId, p_job_id: jobId });
  return Array.isArray(bound) ? bound[0] : bound;
}

/* A definite failure before any reservation, recorded by the attempt that
   holds the claim. A refusal (the attempt was superseded by a takeover, or a
   job exists after all) is evidence, never an error for the caller. */
async function failOperation(env, orgId, operationId, failure, attempt) {
  try {
    return await rpc(env, 'media_fail_operation_v2', { p_org_id: orgId, p_operation_id: operationId, p_failure: failure, p_attempt: attempt });
  } catch (error) {
    recordEvent({
      orgId, name: 'media.operation.fail_refused', level: 'warn', outcome: 'refused',
      resourceType: 'media_operation', resourceId: operationId,
      message: `The operation's failure was not recorded on its claim: ${refusalMessage(error).slice(0, 300)}`,
      detail: { operation_id: operationId, attempt: attempt ?? null, reason: refusalMessage(error).slice(0, 200) || null, failure }
    });
    return null;
  }
}

/* Release a reservation exactly once, and only for a job in the status the
   caller believes it is in (every call site patches 'failed' first). Never
   throws: the answer says what happened.

   media_release_cost_reservation_v2 refuses after settlement and when the job
   moved on; both are logged and leave the money where it is. If v2 is not
   deployed (a misordered rollout) the 0054 function is the fallback, so a
   failed job never keeps its reservation because of the rollout order; 0054
   has no settlement guard, so it is not called for a job this Worker already
   sees as settled. */
export async function releaseReservation(env, job, reason, options = {}) {
  const expect = options.expect === undefined ? ['failed'] : options.expect;
  const note = (name, level, outcome, message, detail = {}) => recordEvent({
    orgId: job.org_id, name, level, outcome,
    traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id, message,
    detail: { provider_request_id: job.provider_request_id || null, release_reason: reason || null, ...detail }
  });
  try {
    const answer = await rpc(env, 'media_release_cost_reservation_v2', {
      p_job_id: job.id,
      p_reason: reason || null,
      p_source: options.source || 'mccluster-release',
      p_metadata: options.metadata || {},
      p_expect_status: expect
    });
    const outcome = (Array.isArray(answer) ? answer[0] : answer) || {};
    return {
      released: outcome.released === true,
      reason: outcome.released === true ? null : (outcome.reason || 'no_answer'),
      amount_usd_micros: outcome.amount_usd_micros ?? null,
      via: 'v2'
    };
  } catch (error) {
    const message = refusalMessage(error);
    if (isMissingFunction(error)) {
      if (isSettled(job)) {
        note('media.operation.release_v1_fallback', 'warn', 'refused', 'media_release_cost_reservation_v2 is not deployed and the job is settled; nothing was released', { released: false });
        return { released: false, reason: 'reservation_already_settled', via: 'v1' };
      }
      try {
        await rpc(env, 'media_release_cost_reservation', { p_job_id: job.id, p_reason: reason || null });
        note('media.operation.release_v1_fallback', 'warn', 'ok', 'media_release_cost_reservation_v2 is not deployed; released through media_release_cost_reservation', { released: true });
        return { released: true, reason: null, amount_usd_micros: null, via: 'v1' };
      } catch (fallbackError) {
        note('media.generation.release_failed', 'error', 'error', `reservation release failed: ${refusalMessage(fallbackError).slice(0, 300)}`, { via: 'v1' });
        return { released: false, reason: 'release_failed', via: 'v1' };
      }
    }
    const refused = /reservation_already_settled|job_status_mismatch/.exec(message);
    if (refused) {
      note('media.generation.release_refused', 'warn', 'refused', `reservation release refused: ${refused[0]}`, { refusal: refused[0], expect_status: expect });
      return { released: false, reason: refused[0], via: 'v2' };
    }
    note('media.generation.release_failed', 'error', 'error', `reservation release failed: ${message.slice(0, 300)}`, { via: 'v2' });
    return { released: false, reason: 'release_failed', via: 'v2' };
  }
}

/* What a failed reservation call means for the claim.
   caller_refused      the spend guard refused THIS caller (42501 / HTTP 403):
                       says nothing about the operation, so the claim is not
                       failed (an owner's same-fingerprint retry takes it over)
   duplicate_operation the unique index refused a second job for this
                       operation id: another attempt already reserved it
   definite            the database answered and nothing was reserved
   unknown             no answer, or one that proves nothing (transport error,
                       gateway status): the reservation may have committed */
export function classifyReservationError(error) {
  const code = String(error?.detail?.code || '');
  const text = `${error?.detail?.message || ''} ${error?.detail?.details || ''}`;
  if (code === '42501' || Number(error?.status) === 403) return 'caller_refused';
  if (code === '23505' && text.includes('media_jobs_org_operation_uidx')) return 'duplicate_operation';
  if (/^(22|23|42|P0)/.test(code)) return 'definite';
  return 'unknown';
}

export async function saveAssets(env, orgId, jobId, result) {
  const candidates = collectAssetCandidates(result);
  const unique = [...new Map(candidates.map((a) => [a.url, a])).values()];
  if (!unique.length) return [];

  const existing = await db(env, `media_assets?job_id=eq.${encodeURIComponent(jobId)}&select=url`);
  const existingUrls = new Set((existing || []).map((asset) => asset.url));
  const body = unique
    .filter((asset) => !existingUrls.has(asset.url))
    .map((asset) => ({ ...asset, org_id: orgId, job_id: jobId }));
  if (!body.length) return [];

  return db(env, 'media_assets', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
}

function budgetCents(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw Object.assign(new Error('budget_cents must be a non-negative number'), { status: 400 });
  }
  return Math.floor(parsed);
}

function estimatePayload(estimate) {
  if (!estimate?.available) return {};
  return {
    estimated_cost_cents: estimate.estimated_cost_cents,
    estimated_cost_cents_exact: estimate.estimated_cost_cents_exact,
    estimated_cost_usd_micros: estimate.estimated_cost_usd_micros,
    units: estimate.units ?? null,
    unit: estimate.unit ?? null,
    unit_price_cents: estimate.unit_price_cents ?? null,
    unit_price_usd_micros: estimate.unit_price_usd_micros ?? null,
    output_count: estimate.output_count ?? null,
    megapixels_per_output: estimate.megapixels_per_output ?? null,
    pricing_formula: estimate.pricing_formula ?? null
  };
}

function billingEventCostMicros(event) {
  const nano = Number(event?.cost_estimate_nano_usd);
  if (Number.isFinite(nano) && nano >= 0) return Math.ceil(nano / 1000);
  const total = Number(event?.cost_total);
  if (Number.isFinite(total) && total >= 0) return Math.ceil(total * 1_000_000);
  return null;
}

function billingEventUnitPriceMicros(event) {
  const price = Number(event?.unit_price);
  return Number.isFinite(price) && price >= 0 ? Math.ceil(price * 1_000_000) : null;
}

async function settleFalBillingEvent(env, job, event) {
  const actualCostMicros = billingEventCostMicros(event);
  if (actualCostMicros === null) return { settled: false, reason: 'billing_event_missing_cost' };

  const quantity = Number(event?.output_units);
  const estimate = job?.routing?.estimate || {};
  await rpc(env, 'media_record_actual_cost_v2', {
    p_job_id: job.id,
    p_actual_cost_usd_micros: actualCostMicros,
    p_quantity: Number.isFinite(quantity) ? quantity : null,
    p_unit: estimate.unit || null,
    p_unit_price_usd_micros: billingEventUnitPriceMicros(event),
    p_source: 'fal-billing-events',
    p_raw_provider_usage: event || {},
    p_occurred_at: event?.timestamp || null
  });

  return { settled: true, actual_cost_usd_micros: actualCostMicros };
}

async function reconcileFalJobs(env, jobs) {
  /* A provider cost is recorded only against a COMPLETED job. Every caller
     passes one (the cost cron's filter, the webhook after its completion
     write, a read of a completed job); the condition here makes it a
     property of the ledger write itself, so a failed job is never settled
     and released at once. A failed job the provider billed anyway is a
     recovery candidate (billed_while_failed), decided by a person. */
  const candidates = (jobs || []).filter((job) => job?.provider === 'fal' && job?.status === 'completed' && job?.provider_request_id && job?.actual_cost_cents === null);
  if (!candidates.length) return { configured: Boolean(env.FAL_ADMIN_KEY), checked: 0, settled: 0, pending: 0 };

  const billing = await billingEventsFal(env, candidates.map((job) => job.provider_request_id));
  if (!billing.available) {
    return {
      configured: Boolean(env.FAL_ADMIN_KEY),
      checked: candidates.length,
      settled: 0,
      pending: candidates.length,
      reason: billing.reason,
      retryable: Boolean(billing.retryable)
    };
  }

  const byRequestId = new Map((billing.events || []).map((event) => [String(event.request_id), event]));
  let settled = 0;
  let pending = 0;
  const failures = [];

  for (const job of candidates) {
    const event = byRequestId.get(String(job.provider_request_id));
    if (!event) {
      pending += 1;
      continue;
    }
    try {
      const result = await settleFalBillingEvent(env, job, event);
      if (result.settled) {
        settled += 1;
        recordEvent({
          orgId: job.org_id, name: 'media.cost.settled', traceId: job.routing?.trace_id,
          resourceType: 'media_job', resourceId: job.id,
          message: 'Provider cost recorded against the reservation',
          detail: { provider_request_id: job.provider_request_id, actual_cost_usd_micros: result.actual_cost_usd_micros }
        });
      } else pending += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ job_id: job.id, message });
      recordEvent({
        orgId: job.org_id, name: 'media.cost.settle_failed', level: 'error', outcome: 'error', traceId: job.routing?.trace_id,
        resourceType: 'media_job', resourceId: job.id,
        message: `Provider cost could not be recorded: ${message.slice(0, 300)}`,
        detail: { provider_request_id: job.provider_request_id }
      });
    }
  }

  return {
    configured: true,
    checked: candidates.length,
    settled,
    pending: pending + failures.length,
    failures
  };
}

export async function reconcilePendingFalCosts(env, options = {}) {
  if (!env.FAL_ADMIN_KEY) return { configured: false, checked: 0, settled: 0, pending: 0, reason: 'fal_admin_key_not_configured' };
  const limit = Math.min(50, Math.max(1, Number(options.limit || 50)));
  const jobs = await db(env, `media_jobs?provider=eq.fal&status=eq.completed&actual_cost_cents=is.null&provider_request_id=not.is.null&order=completed_at.asc&limit=${limit}&select=*`);
  return reconcileFalJobs(env, jobs || []);
}

export async function reconcileFalJobCost(env, job) {
  const result = await reconcileFalJobs(env, [job]);
  return { ...result, settled_job: result.settled > 0 ? job.id : null };
}

/* Media spend, aggregated from the media_cost_events ledger.

   Every other control on spend is per job, so nothing could answer "how much
   of the funded provider balance is gone". Membership is enough to read it —
   this exposes no prompt, asset or model input, only amounts the ledger
   already settled or reserved. */
export async function getUsage(request, env, user) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));

  const groupBy = (url.searchParams.get('group_by') || 'day').toLowerCase();
  if (!['day', 'provider', 'capability', 'model'].includes(groupBy)) {
    throw Object.assign(new Error('group_by must be day, provider, capability, or model'), { status: 400 });
  }

  const parseWhen = (name) => {
    const raw = url.searchParams.get(name);
    if (!raw) return null;
    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) throw Object.assign(new Error(`${name} must be a timestamp`), { status: 400 });
    return when.toISOString();
  };

  const rollup = await rpc(env, 'media_usage_rollup', {
    p_org_id: org.org_id,
    p_from: parseWhen('from'),
    p_to: parseWhen('to'),
    p_group_by: groupBy
  });
  /* PostgREST returns a scalar function result directly or wrapped in a
     single-element array depending on the call shape. */
  return Array.isArray(rollup) ? rollup[0] : rollup;
}

export async function getMediaBudget(request, env, user) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));
  if (org.role !== 'owner') {
    throw Object.assign(new Error('Organization owner access is required to manage the media allowance'), { status: 403 });
  }
  const rows = await db(
    env,
    `org_media_budgets?org_id=eq.${encodeURIComponent(org.org_id)}&select=org_id,enabled,monthly_limit_cents,warn_at_percent,updated_by,created_at,updated_at&limit=1`
  );
  const budget = rows?.[0] || {
    org_id: org.org_id,
    enabled: false,
    monthly_limit_cents: null,
    warn_at_percent: 80,
    updated_by: null,
    created_at: null,
    updated_at: null
  };
  return { budget };
}

export async function updateMediaBudget(request, env, user) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));
  if (org.role !== 'owner') {
    throw Object.assign(new Error('Organization owner access is required to manage the media allowance'), { status: 403 });
  }

  let body;
  try { body = await request.json(); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }

  if (typeof body.enabled !== 'boolean') {
    throw Object.assign(new Error('enabled must be true or false'), { status: 400 });
  }

  let monthlyLimit = body.monthly_limit_cents;
  if (monthlyLimit === '' || monthlyLimit === undefined) monthlyLimit = null;
  if (monthlyLimit !== null) {
    monthlyLimit = Number(monthlyLimit);
    if (!Number.isSafeInteger(monthlyLimit) || monthlyLimit < 0) {
      throw Object.assign(new Error('monthly_limit_cents must be a non-negative integer or null'), { status: 400 });
    }
  }
  if (body.enabled && monthlyLimit === null) {
    throw Object.assign(new Error('A monthly limit is required when the media allowance is enabled'), { status: 400 });
  }

  const warnAt = body.warn_at_percent === undefined ? 80 : Number(body.warn_at_percent);
  if (!Number.isInteger(warnAt) || warnAt < 1 || warnAt > 100) {
    throw Object.assign(new Error('warn_at_percent must be an integer from 1 to 100'), { status: 400 });
  }

  const rows = await db(env, 'org_media_budgets?on_conflict=org_id&select=org_id,enabled,monthly_limit_cents,warn_at_percent,updated_by,created_at,updated_at', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      org_id: org.org_id,
      enabled: body.enabled,
      monthly_limit_cents: monthlyLimit,
      warn_at_percent: warnAt,
      updated_by: user.id,
      updated_at: new Date().toISOString()
    })
  });
  const budget = rows?.[0];
  if (!budget) throw Object.assign(new Error('Media allowance update did not return a record'), { status: 502 });

  const audit = await recordAudit(env, {
    orgId: org.org_id,
    actorUserId: user.id,
    actorKind: 'user',
    event: 'media_budget.updated',
    capability: 'media.budget.manage',
    resourceType: 'org_media_budget',
    resourceId: org.org_id,
    detail: {
      enabled: budget.enabled,
      monthly_limit_cents: budget.monthly_limit_cents,
      warn_at_percent: budget.warn_at_percent
    }
  });

  return { budget, audit };
}

export async function listModels(request, env) {
  const url = new URL(request.url);
  const capability = url.searchParams.get('capability');
  const provider = url.searchParams.get('provider');
  let path = 'media_models?enabled=eq.true&order=capability.asc,display_name.asc&select=*';
  if (capability) path += `&capability=eq.${encodeURIComponent(capability)}`;
  if (provider) path += `&provider=eq.${encodeURIComponent(provider)}`;
  return db(env, path);
}

export async function createGeneration(request, env, user, deps = {}) {
  let body;
  try { body = await request.json(); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  const org = await getOrg(env, user.id, body.org_id);
  // Membership is not permission. Generation calls fal.ai and spends real
  // money against the org's budget, so a viewer being in the org is not
  // enough — the grant matrix decides.
  await requireCapability(env, org, 'media.generate');
  if (!body.model_id) throw Object.assign(new Error('model_id is required'), { status: 400 });
  const model = await modelById(env, body.model_id);
  if (!model) throw Object.assign(new Error('Unknown or disabled media model'), { status: 404 });
  if (model.provider !== 'fal') throw Object.assign(new Error('Provider adapter not installed'), { status: 501 });

  const operationId = operationIdFrom(body);
  const input = { ...(body.input || {}) };
  if (body.prompt && !input.prompt) input.prompt = body.prompt;
  if (!Object.keys(input).length) throw Object.assign(new Error('input or prompt is required'), { status: 400 });
  validateModelInput(model, input);
  /* A malformed budget is the request's own fault: refuse it before it can
     hold a claim. */
  const budget = budgetCents(body.budget_cents);

  const ctx = { env, request, org, user, deps, operationId, requestModel: { providerModelId: model.provider_model_id, input } };
  let decision = null;
  if (operationId) {
    /* Both callers of a duplicated operation get the same durable outcome,
       whatever state it reached (queued, reconciling, failed, completed).
       Exactly one of them reserves, and exactly one caller submits. */
    const fingerprint = await operationFingerprint(body, model);
    decision = await claimOperation(env, {
      orgId: org.org_id, operationId, fingerprint, actorId: user.id, operationType: body.strategy ? `media.generate:${body.strategy}` : 'media.generate'
    });
    if (!decision.won) return ensureSubmitted(ctx, decision.job);
  }
  const claimed = Boolean(decision);
  /* Definite failures before a reservation exists are recorded on the claim
     so a loser reads the same refusal instead of reserving. */
  const definiteBeforeReserve = async (error) => {
    if (claimed) await failOperation(env, org.org_id, operationId, { message: error?.message || String(error), status: error?.status || null, stage: 'preflight' }, decision.attempt);
    throw error;
  };

  const budgetUsdMicros = budget === null ? null : budget * 10_000;
  const estimate = estimateModelCost(model, input);
  if (budget !== null && !estimate.available) {
    await definiteBeforeReserve(Object.assign(new Error('This model cannot be safely preflighted against a budget yet'), {
      status: 422,
      detail: { model_id: model.id, provider_model_id: model.provider_model_id, reason: estimate.reason }
    }));
  }
  if (budgetUsdMicros !== null && estimate.estimated_cost_usd_micros > budgetUsdMicros) {
    await definiteBeforeReserve(Object.assign(new Error('Estimated media cost exceeds budget'), {
      status: 422,
      detail: {
        model_id: model.id,
        estimated_cost_cents: estimate.estimated_cost_cents,
        estimated_cost_usd_micros: estimate.estimated_cost_usd_micros,
        budget_cents: budget,
        budget_usd_micros: budgetUsdMicros
      }
    }));
  }

  const estimateData = estimatePayload(estimate);
  let created;
  try {
    created = await rpc(env, 'media_create_budgeted_job_v2', {
    p_org_id: org.org_id,
    p_created_by: user.id,
    p_provider: model.provider,
    p_provider_model_id: model.provider_model_id,
    p_capability: model.capability,
    p_prompt: body.prompt || input.prompt || null,
    p_input: input,
    p_routing: {
      requested_model_id: model.id,
      requested_by: user.id,
      strategy: body.strategy || 'explicit-model',
      operation_id: operationId,
      /* From this protocol on, a job without a submit marker has provably
         not been sent to the provider. Rows without it predate that. */
      submit_protocol: SUBMIT_PROTOCOL,
      estimate_available: Boolean(estimate.available),
      estimate_reason: estimate.available ? null : estimate.reason,
      /* The provider webhook arrives later on its own request; it rejoins
         this trace through the job row. */
      trace_id: currentTrace()?.trace_id || null
    },
    p_estimated_cost_usd_micros: estimate.available ? estimate.estimated_cost_usd_micros : null,
    p_budget_cents: budget,
    p_pricing_snapshot: estimate.pricing_snapshot || model.cost_hint || {},
    p_estimate: estimateData
    });
  } catch (error) {
    const kind = classifyReservationError(error);
    const refusal = Object.assign(new Error(error?.detail?.message || error?.message || 'Media job reservation failed'), {
      status: kind === 'caller_refused' ? 403 : (error?.status === 400 ? 422 : (error?.status || 502)), detail: error?.detail || null
    });
    /* Without an operation id there is no claim to protect: the refusal is
       the answer, as before. */
    if (!claimed) throw refusal;
    if (kind === 'caller_refused') {
      /* The spend guard refused this caller, not the operation. The claim
         stays 'claimed': an owner's retry with the same request is pending
         inside the window and takes it over after it. */
      recordEvent({
        orgId: org.org_id, name: 'media.operation.caller_refused', level: 'warn', outcome: 'refused', actorUserId: user.id,
        resourceType: 'media_operation', resourceId: operationId,
        message: `The reservation refused this caller; the operation's claim was not failed: ${refusal.message.slice(0, 300)}`,
        detail: { operation_id: operationId, attempt: decision.attempt }
      });
      throw refusal;
    }
    /* The database answered and reserved nothing (budget, allowance, validation). */
    if (kind === 'definite') await definiteBeforeReserve(refusal);
    /* Another attempt already reserved this operation (the unique index said
       so), or the outcome is unknown (the call may have committed). Never
       record a failure over a reservation that may exist: read the job back. */
    const existing = await jobByOperationId(env, org.org_id, operationId).catch(() => null);
    if (!existing) {
      throw claimError(503, 'The reservation outcome is unknown; nothing was submitted. Retry with the same operation_id', 'reservation_outcome_unknown', { operation_id: operationId });
    }
    await bindOperation(env, org.org_id, operationId, existing.id).catch(() => null);
    return ensureSubmitted(ctx, existing);
  }
  const job = Array.isArray(created) ? created[0] : created;
  if (!job?.id) throw Object.assign(new Error('Media job creation did not return a job'), { status: 500 });
  if (claimed) {
    /* Bind before submitting so a loser arriving now reads this job rather
       than 'pending'. If the bind cannot be recorded the reservation exists
       but this caller has sent nothing: fail the job only while nobody has
       started submitting it, release, and answer definitively. */
    try {
      await bindOperation(env, org.org_id, operationId, job.id);
    } catch (error) {
      const failed = await patchJobWhere(env, job.id, `${CAS_FAIL_PRESUBMIT}&provider_status->>outcome=is.null`, {
        status: 'failed', error: { message: 'operation bind failed before submission', detail: error?.detail || null }
      }).catch(() => null);
      if (failed) await releaseReservation(env, failed, 'operation bind failed before submission');
      else releaseSkipped(job, user, 'operation bind failed before submission');
      throw claimError(503, failed
        ? 'Paid operation could not be bound; the reservation was released and nothing was submitted'
        : 'Paid operation could not be bound; this request submitted nothing', 'operation_claims_unavailable', { operation_id: operationId, job_id: job.id });
    }
  }
  ctx.spend = {
    model_id: model.id,
    provider_model_id: model.provider_model_id,
    capability: model.capability,
    estimated_cost_cents: estimate.available ? estimate.estimated_cost_cents : null,
    budget_cents: budget
  };
  return submitJob(ctx, job);
}

function releaseSkipped(job, user, reason) {
  recordEvent({
    orgId: job.org_id, name: 'media.generation.release_skipped', level: 'warn', outcome: 'pending', actorUserId: user?.id,
    resourceType: 'media_job', resourceId: job.id,
    message: `The job could not be marked failed, so its reservation was not released (recovery candidate): ${reason}`.slice(0, 500),
    detail: { operation_id: job.routing?.operation_id || null }
  });
}

/* Submit one reserved job to the provider, at most once across every caller.

   1. MARK: a compare-and-set PATCH (CAS_SUBMIT) writes a 'submitting' marker.
      Only the caller whose PATCH matched goes on; everyone else reads the job.
   2. SEND: one provider request (the adapter never retries), built from the
      job row's own model and input.
   3. RECORD: every outcome is another compare-and-set, so a webhook that
      landed first, an operator decision or the cron sweep is never overwritten:
      - refused (a definite provider answer): failed, then released;
      - unknown (the bytes may have left): 'reconciling', reservation kept,
        never resubmitted;
      - accepted: the request id, status 'queued'. */
async function submitJob(ctx, job) {
  const { env, org, user } = ctx;
  const submit = typeof ctx.deps?.submit === 'function' ? ctx.deps.submit : submitFal;
  const operationId = job.routing?.operation_id ?? ctx.operationId ?? null;
  /* The job row is the authority. The request's own values stand in only
     when the reservation call answered with a row that does not carry them;
     the fingerprint already bound them to this operation. */
  const providerModelId = job.provider_model_id || ctx.requestModel?.providerModelId || null;
  const input = job.input && typeof job.input === 'object' && Object.keys(job.input).length ? job.input : (ctx.requestModel?.input || null);
  if (!providerModelId || !input) return job;
  const spend = ctx.spend || {
    model_id: job.routing?.requested_model_id ?? null,
    provider_model_id: providerModelId,
    capability: job.capability ?? null,
    estimated_cost_cents: job.estimated_cost_cents ?? null,
    budget_cents: job.routing?.budget_cents ?? null
  };
  const webhookUrl = await webhookUrlFor(env, new URL(ctx.request.url).origin, job.id);

  const attemptedAt = new Date().toISOString();
  /* attempt_id is this call's own token: a later compare-and-set can tell
     "my marker" from another caller's. */
  const marker = { outcome: 'submitting', attempted_at: attemptedAt, delivery: 'webhook', submitter: currentTrace()?.trace_id || null, attempt_id: crypto.randomUUID() };
  let marked;
  try {
    marked = await patchJobWhere(env, job.id, CAS_SUBMIT, { provider_status: marker });
  } catch (error) {
    /* The marker write failed, so nothing is sent. Whether it was applied is
       unknown: fail the job only if it carries this call's marker, or no
       marker at all. A job another caller marked is theirs. */
    const failure = { status: 'failed', error: { message: 'submit marker could not be recorded; nothing was submitted', stage: 'preflight', detail: error?.detail || null } };
    let failed = null;
    try {
      failed = await patchJobWhere(env, job.id, `${CAS_FAIL_PRESUBMIT}&provider_status->>attempt_id=eq.${marker.attempt_id}`, { ...failure, provider_status: { ...marker, outcome: 'not_submitted' } })
        || await patchJobWhere(env, job.id, `${CAS_FAIL_PRESUBMIT}&provider_status->>outcome=is.null`, failure);
    } catch {
      failed = null;
    }
    if (failed) await releaseReservation(env, failed, 'submit marker could not be recorded; nothing was submitted');
    else releaseSkipped(job, user, 'submit marker could not be recorded');
    throw claimError(503, 'The submission could not be started; nothing was sent to the provider', 'submit_marker_unavailable', { job_id: job.id, operation_id: operationId });
  }
  /* Someone else holds this job (another caller is submitting it, the webhook
     already attached a request, or an operator decided it): no submit. */
  if (!marked) return (await jobById(env, job.id, job.org_id ?? org.org_id)) || job;

  recordEvent({
    orgId: org.org_id, name: 'media.generation.reserved', actorUserId: user.id,
    resourceType: 'media_job', resourceId: job.id,
    message: `Reserved ${spend.capability} on ${providerModelId}`,
    detail: spend
  });

  const submitStarted = Date.now();
  let submitted;
  try {
    submitted = await submit(env, providerModelId, input, { webhookUrl });
    if (!submitted?.request_id) throw Object.assign(new Error('The provider adapter returned no request id'), { uncertain: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const classification = classifySubmitError(error);
    if (classification === 'uncertain') {
      /* The bytes may have reached the provider (timeout, abort, network loss,
         5xx after send). The job may be running and will be billed. Keep the
         reservation, record the attempt as evidence and leave the job for
         reconciliation. Never resubmit automatically: a retry with the same
         operation id reads this job back; a deliberate new attempt needs a
         new operation id. */
      recordEvent({
        orgId: org.org_id, name: 'media.generation.submit_uncertain', kind: 'dependency', level: 'warn', outcome: 'error',
        actorUserId: user.id, resourceType: 'media_job', resourceId: job.id, durationMs: Date.now() - submitStarted,
        message: `fal submission outcome unknown; reservation kept for reconciliation: ${message.slice(0, 300)}`,
        detail: spend
      });
      let row;
      let written = true;
      try {
        row = await patchJobWhere(env, job.id, CAS_UNCERTAIN, {
          status: 'reconciling',
          error: { message, uncertain: true, stage: 'submit' },
          provider_status: { ...marker, outcome: 'uncertain', error: message.slice(0, 500) }
        });
      } catch {
        written = false;
      }
      if (written && !row) {
        /* The marker is gone: the hinted webhook already attached the
           provider's request (or the job was decided). Its state is the answer. */
        const current = await jobById(env, job.id, job.org_id ?? org.org_id).catch(() => null);
        if (current) return current;
      }
      throw claimError(502, `Provider outcome is unknown; the reservation is kept for reconciliation: ${message}`, 'provider_outcome_uncertain', { job_id: job.id, operation_id: operationId });
    }
    /* A definite refusal: one write marks the job failed, and only then is
       the reservation released. If that write did not land the reservation
       stays (a recovery candidate), never a blind release. */
    let failed = null;
    try {
      failed = await patchJobWhere(env, job.id, CAS_FAIL_PRESUBMIT, {
        status: 'failed',
        error: { message, stage: 'submit' },
        provider_status: { ...marker, outcome: 'submit_refused', provider_status_code: Number(error?.status ?? error?.statusCode) || null }
      });
    } catch {
      failed = null;
    }
    const release = failed ? await releaseReservation(env, failed, `provider submission failed: ${message}`) : null;
    recordEvent({
      orgId: org.org_id, name: 'media.generation.submit_failed', kind: 'dependency', level: 'error', outcome: 'error',
      actorUserId: user.id, resourceType: 'media_job', resourceId: job.id, durationMs: Date.now() - submitStarted,
      message: `fal submission failed; reservation ${release?.released ? 'released' : 'not released'}: ${message.slice(0, 300)}`,
      detail: spend
    });
    if (!failed) releaseSkipped(job, user, `provider submission failed: ${message}`);
    throw error;
  }
  recordEvent({
    orgId: org.org_id, name: 'media.generation.submitted', kind: 'dependency', actorUserId: user.id,
    resourceType: 'media_job', resourceId: job.id, durationMs: Date.now() - submitStarted,
    message: `Submitted to fal (${providerModelId})`,
    detail: { ...spend, provider_request_id: submitted.request_id || null }
  });
  let recorded;
  try {
    recorded = await patchJobWhere(env, job.id, CAS_RECORD, {
      provider_request_id: submitted.request_id,
      submitted_at: new Date().toISOString(),
      provider_status: { ...marker, ...submitted, outcome: 'submitted', delivery: 'webhook' },
      status: 'queued'
    });
  } catch (error) {
    /* The provider accepted; only our record failed. The reservation stays and
       the request id is the reconciliation handle. */
    const message = error instanceof Error ? error.message : String(error);
    recordEvent({
      orgId: org.org_id, name: 'media.generation.persist_failed', kind: 'dependency', level: 'error', outcome: 'error',
      actorUserId: user.id, resourceType: 'media_job', resourceId: job.id,
      message: `provider accepted ${submitted.request_id || '?'} but the job record could not be updated: ${message.slice(0, 300)}`,
      detail: { ...spend, provider_request_id: submitted.request_id || null }
    });
    await patchJobWhere(env, job.id, CAS_RECORD, {
      status: 'reconciling',
      provider_request_id: submitted.request_id,
      error: { message, uncertain: true, stage: 'persist' },
      provider_status: { ...marker, ...submitted, outcome: 'accepted_unrecorded', delivery: 'webhook' }
    }).catch(() => null);
    throw claimError(502, 'Provider accepted the job but its record could not be saved; reservation kept', 'provider_accepted_persistence_failed', { job_id: job.id, provider_request_id: submitted.request_id || null, operation_id: operationId });
  }
  if (recorded) return recorded;
  /* The record matched nothing: the webhook was first (never downgrade what
     it wrote), or the job was decided while the request was in flight. */
  const current = await jobById(env, job.id, job.org_id ?? org.org_id).catch(() => null);
  if (!current || current.provider_request_id !== submitted.request_id) {
    /* The provider accepted a request this job row does not name. Keep the
       handle where an operator can find it (reconcile decision settle). */
    recordEvent({
      orgId: org.org_id, name: 'media.generation.request_unrecorded', kind: 'dependency', level: 'error', outcome: 'error',
      actorUserId: user.id, resourceType: 'media_job', resourceId: job.id,
      message: `provider accepted ${submitted.request_id} but the job (${current?.status || 'unreadable'}) does not carry it`,
      detail: { ...spend, provider_request_id: submitted.request_id, job_status: current?.status || null, job_provider_request_id: current?.provider_request_id || null }
    });
  }
  return current || job;
}

/* Every readback path ends here (a repaired claim, the unique index refusing
   a second reservation, an unknown reservation outcome, a loser reading a
   bound job): a job reserved under cas-v1 that nobody has started submitting
   is submitted by whoever wins the compare-and-set, exactly as its winner
   would have, so a winner that stopped between the reservation and the submit
   does not leave a job that answers 202 forever. Rows from before cas-v1 are
   never touched: for them a missing marker proves nothing. Owners only,
   mirroring the spend guard. */
async function ensureSubmitted(ctx, job) {
  if (!job) return job;
  const neverStarted = job.routing?.submit_protocol === SUBMIT_PROTOCOL
    && job.status === 'queued'
    && !job.provider_request_id
    && (job.provider_status?.outcome ?? null) === null
    && job.routing?.reservation_state === 'reserved';
  if (neverStarted && ctx.org?.role === 'owner') return submitJob(ctx, job);
  return job;
}

/* The provider's webhook. Matched by the provider request id; when no job
   carries it, by the authenticated hint in the URL (see webhookUrlFor), which
   is how a job whose submit outcome was unknown, or which an operator
   released too early, gets its result after all. */
export async function handleFalWebhook(request, env, deps = {}, hint = null) {
  const verify = typeof deps?.verify === 'function' ? deps.verify : verifyFalWebhook;
  const webhook = await verify(request, env);
  const rawRequestId = webhook?.request_id || webhook?.gateway_request_id;
  if (!rawRequestId) throw Object.assign(new Error('fal webhook is missing request_id'), { status: 400 });
  const providerRequestId = String(rawRequestId);
  const unmatched = { accepted: true, matched: false, request_id: providerRequestId };

  let job = await jobByProviderRequestId(env, providerRequestId);
  let attachedFrom = null;
  if (!job && hint?.jobId) {
    if (!(await verifyWebhookHint(env, hint.jobId, hint.token))) return unmatched;
    const prior = await jobByIdAnyOrg(env, hint.jobId);
    if (!prior) return unmatched;
    if (prior.provider_request_id && prior.provider_request_id !== providerRequestId) {
      /* One job, one provider request. A second request under this job's
         hint is evidence of a duplicate submission, never a new result. */
      recordEvent({
        orgId: prior.org_id, name: 'media.generation.webhook_conflict', kind: 'dependency', level: 'error', outcome: 'refused',
        traceId: prior.routing?.trace_id, resourceType: 'media_job', resourceId: prior.id,
        message: `fal sent ${providerRequestId} for a job that already carries ${prior.provider_request_id}; ignored`,
        detail: { provider_request_id: providerRequestId, job_provider_request_id: prior.provider_request_id, webhook_status: webhook?.status || null }
      });
      return { ...unmatched, ignored: 'conflict', job_id: prior.id };
    }
    const now = new Date().toISOString();
    const attached = await patchJobWhere(env, prior.id, CAS_HINT_ATTACH, {
      provider_request_id: providerRequestId,
      submitted_at: prior.submitted_at || now,
      provider_status: { ...(prior.provider_status || {}), outcome: 'attached_by_webhook', attached_at: now, request_id: providerRequestId }
    });
    /* Nothing attached: the submitter (or an operator settle) may have recorded this very request id meanwhile. */
    job = attached || await jobByProviderRequestId(env, providerRequestId);
    if (!job) return unmatched;
    /* The status of the row the attach wrote, not of the earlier read: an operator release can land in between. */
    if (attached) attachedFrom = attached.status;
    if (attached) recordEvent({
      orgId: job.org_id, name: 'media.generation.webhook_attached', kind: 'dependency', level: 'warn',
      traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
      message: `fal request ${providerRequestId} attached to a job without a request id (was ${prior.status})`,
      detail: { provider_request_id: providerRequestId, prior_status: prior.status, prior_outcome: prior.provider_status?.outcome || null }
    });
  }
  if (!job) return unmatched;

  const falStatus = String(webhook?.status || '').toUpperCase();
  if (job.status === 'completed' || job.status === 'cancelled') {
    /* A replay, or a late answer for a job that is already final. */
    recordEvent({
      orgId: job.org_id, name: 'media.generation.webhook_ignored', kind: 'dependency',
      traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
      message: `fal webhook (${falStatus || 'no status'}) for a ${job.status} job; ignored`,
      detail: { provider_request_id: providerRequestId, webhook_status: falStatus || null }
    });
    return { accepted: true, matched: true, job_id: job.id, status: job.status, ignored: 'terminal' };
  }

  if (falStatus === 'ERROR') {
    const reason = 'fal generation did not produce a successful output';
    if (job.status === 'failed') {
      /* Already failed (a replay, or an early release): the status stands;
         make sure the reservation is not still held. Idempotent. */
      const release = await releaseReservation(env, job, reason);
      return { accepted: true, matched: true, job_id: job.id, status: 'failed', reservation: release.released ? 'released' : release.reason };
    }
    if (isSettled(job)) {
      /* The provider billed this request: a later failure report never
         unwinds a settled cost. Keep the report as evidence. */
      await patchJobWhere(env, job.id, CAS_REFRESH, { provider_status: webhook });
      recordEvent({
        orgId: job.org_id, name: 'media.generation.failed_after_settlement', kind: 'dependency', level: 'warn', outcome: 'error',
        traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
        message: 'fal reported a failure for a job whose cost is already settled; status unchanged',
        detail: { provider_request_id: providerRequestId, status: job.status }
      });
      return { accepted: true, matched: true, job_id: job.id, status: job.status, ignored: 'settled' };
    }
    const failed = await patchJobWhere(env, job.id, CAS_REFRESH, {
      status: 'failed',
      provider_status: webhook,
      error: {
        message: typeof webhook.error === 'string' ? webhook.error : 'fal generation failed',
        detail: webhook.payload || null
      }
    });
    if (!failed) {
      const current = await jobByIdAnyOrg(env, job.id);
      return { accepted: true, matched: true, job_id: job.id, status: current?.status || job.status, ignored: 'state_changed' };
    }
    const release = await releaseReservation(env, failed, reason);
    recordEvent({
      orgId: job.org_id, name: 'media.generation.failed', kind: 'dependency', level: 'error', outcome: 'error',
      traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
      message: `fal reported the generation failed; reservation ${release.released ? 'released' : `not released (${release.reason})`}`,
      detail: { provider_request_id: providerRequestId, provider_model_id: job.provider_model_id || null }
    });
    return { accepted: true, matched: true, job_id: failed.id || job.id, status: 'failed' };
  }

  if (falStatus !== 'OK') {
    throw Object.assign(new Error('Unsupported fal webhook status'), { status: 400, detail: { status: webhook?.status || null } });
  }

  const result = webhook.payload || {};
  const completion = {
    status: 'completed',
    result,
    completed_at: job.completed_at || new Date().toISOString(),
    provider_status: webhook,
    error: {}
  };
  /* A failed job is completed only through the hint attach above: the
     provider ran a request whose submit was refused on our side, or one an
     operator released before the provider's answer. Every other job must
     still be open. */
  /* Decided from the durable row, not from this delivery's memory, so a retried delivery finishes what an
     earlier one started (a completion write that failed once, or a release that landed mid-delivery). */
  const afterFailure = job.status === 'failed' && job.provider_request_id === providerRequestId && !isSettled(job)
    && (attachedFrom === 'failed' || ['attached_by_webhook', 'released_by_operator'].includes(job.provider_status?.outcome));
  const completed = afterFailure
    ? await patchJobWhere(env, job.id, `status=eq.failed&provider_request_id=eq.${encodeURIComponent(providerRequestId)}`, completion)
    : await patchJobWhere(env, job.id, CAS_REFRESH, completion);
  if (!completed) {
    const current = await jobByIdAnyOrg(env, job.id);
    recordEvent({
      orgId: job.org_id, name: 'media.generation.webhook_ignored', kind: 'dependency', level: 'warn',
      traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
      message: `fal reported success for a job that is ${current?.status || job.status}; status unchanged`,
      detail: { provider_request_id: providerRequestId, webhook_status: falStatus, status: current?.status || job.status }
    });
    return { accepted: true, matched: true, job_id: job.id, status: current?.status || job.status, ignored: 'state_changed' };
  }
  await saveAssets(env, job.org_id, job.id, result);
  if (afterFailure) {
    /* The ledger self-corrects below (record_actual replaces the released
       row); the decision that released it stays on the job row and in the
       audit ledger, and this row says the provider ran it anyway. */
    await recordAudit(env, {
      orgId: job.org_id,
      actorKind: 'system',
      event: 'media_operation.completed_after_release',
      capability: 'media.recover',
      resourceType: 'media_job',
      resourceId: job.id,
      detail: {
        provider_request_id: providerRequestId,
        operation_id: job.routing?.operation_id || null,
        prior_outcome: job.provider_status?.outcome || null,
        prior_reservation_state: job.routing?.reservation_state || null,
        operator_resolution: job.routing?.operator_resolution || null
      }
    });
  }
  recordEvent({
    orgId: job.org_id, name: 'media.generation.completed', kind: 'dependency',
    traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
    durationMs: job.submitted_at ? Date.now() - Date.parse(job.submitted_at) : null,
    message: 'fal completed the generation',
    detail: { provider_request_id: providerRequestId, provider_model_id: job.provider_model_id || null }
  });
  /* record_actual is only ever called for a job in status 'completed'. */
  const reconciliation = await reconcileFalJobCost(env, completed).catch((error) => ({
    configured: Boolean(env.FAL_ADMIN_KEY),
    settled: 0,
    pending: 1,
    reason: error instanceof Error ? error.message : String(error)
  }));

  return {
    accepted: true,
    matched: true,
    job_id: completed.id || job.id,
    status: 'completed',
    cost_reconciliation: reconciliation
  };
}

/* A completed job's result and cost, fetched by its request id when the
   webhook did not bring them. */
async function settleCompletedJob(env, job, deps = {}) {
  if (job.status !== 'completed') return job;
  if (!job.result || Object.keys(job.result).length === 0) {
    const fetchResult = typeof deps?.result === 'function' ? deps.result : resultFal;
    const result = await fetchResult(env, job.provider_model_id, job.provider_request_id);
    job = await patchJob(env, job.id, {
      result: result.data || {},
      completed_at: job.completed_at || new Date().toISOString(),
      provider_status: { ...(job.provider_status || {}), request_id: result.request_id }
    }) || job;
    await saveAssets(env, job.org_id, job.id, result.data || {});
  }
  if (job.provider === 'fal' && job.provider_request_id && job.actual_cost_cents === null) {
    const reconciliation = await reconcileFalJobCost(env, job).catch(() => null);
    if (reconciliation?.settled) job = await jobByIdAnyOrg(env, job.id) || job;
  }
  return job;
}

/* What the provider says about an open job, written with compare-and-set.
   Returns { job, action }: completed | failed | failed_after_settlement |
   updated | unchanged (the job moved on by itself; re-read). */
async function applyStatus(env, job, raw, deps = {}) {
  const status = normalizeFalStatus(raw);
  const reread = async () => (await jobByIdAnyOrg(env, job.id)) || job;
  if (status === 'completed') {
    /* The provider's status vocabulary has no failure value; a failed
       request is COMPLETED and its result is the error. Fetch the result BEFORE the job is
       written as completed, and write both in one compare-and-set: a request whose result
       cannot be read stays open, so its ERROR webhook still fails and releases it. */
    let fetched = null;
    if (!job.result || Object.keys(job.result).length === 0) {
      const fetchResult = typeof deps?.result === 'function' ? deps.result : resultFal;
      fetched = await fetchResult(env, job.provider_model_id, job.provider_request_id);
    }
    const patched = await patchJobWhere(env, job.id, CAS_REFRESH, {
      status: 'completed', provider_status: fetched ? { ...raw, request_id: fetched.request_id } : raw, error: {}, completed_at: job.completed_at || new Date().toISOString(),
      ...(fetched ? { result: fetched.data || {} } : {})
    });
    if (patched && fetched) await saveAssets(env, patched.org_id, patched.id, fetched.data || {});
    const current = patched || await reread();
    return { job: await settleCompletedJob(env, current, deps), action: patched ? 'completed' : 'unchanged' };
  }
  if (status === 'failed') {
    if (isSettled(job)) {
      const patched = await patchJobWhere(env, job.id, CAS_REFRESH, { provider_status: raw });
      recordEvent({
        orgId: job.org_id, name: 'media.generation.failed_after_settlement', kind: 'dependency', level: 'warn', outcome: 'error',
        traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
        message: 'fal reported a failure for a job whose cost is already settled; status unchanged',
        detail: { provider_request_id: job.provider_request_id || null, status: job.status }
      });
      return { job: patched || await reread(), action: 'failed_after_settlement' };
    }
    const failed = await patchJobWhere(env, job.id, CAS_REFRESH, {
      status: 'failed', provider_status: raw, error: { message: 'provider reported failure', stage: 'provider', detail: raw }
    });
    if (!failed) return { job: await reread(), action: 'unchanged' };
    const release = await releaseReservation(env, failed, 'provider reported the generation failed');
    recordEvent({
      orgId: job.org_id, name: 'media.generation.failed', kind: 'dependency', level: 'error', outcome: 'error',
      traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
      message: `fal reported the generation failed; reservation ${release.released ? 'released' : `not released (${release.reason})`}`,
      detail: { provider_request_id: job.provider_request_id || null, provider_model_id: job.provider_model_id || null }
    });
    return { job: release.released ? await reread() : failed, action: 'failed', released: release.released };
  }
  const patched = await patchJobWhere(env, job.id, CAS_REFRESH, { status, provider_status: raw });
  return { job: patched || await reread(), action: patched ? 'updated' : 'unchanged' };
}

/* Shared by the member's read and the cron sweep. */
export async function applyProviderStatus(env, job, raw, deps = {}) {
  return (await applyStatus(env, job, raw, deps)).job;
}

/* Ask the provider about an open job and apply the answer. A 404 is counted
   on the job, not thrown: three in a row mean the provider does not know this
   request id (a mistyped operator attach, or a request it dropped), and the
   job is parked as 'reconciling' with outcome 'unknown_request' for a person
   to decide with evidence. Any real answer resets the count. Other errors
   propagate to the caller. */
export async function pollProviderStatus(env, job, deps = {}) {
  const fetchStatus = typeof deps?.status === 'function' ? deps.status : statusFal;
  let raw;
  try {
    raw = await fetchStatus(env, job.provider_model_id, job.provider_request_id);
  } catch (error) {
    if (Number(error?.status ?? error?.statusCode) !== 404) throw error;
    const prior = job.provider_status && typeof job.provider_status === 'object' ? job.provider_status : {};
    const count = (Number(prior.unknown_request_count) || 0) + 1;
    const unknown = count >= UNKNOWN_REQUEST_THRESHOLD;
    const patched = await patchJobWhere(env, job.id, CAS_REFRESH, {
      provider_status: { ...prior, unknown_request_count: count, ...(unknown ? { outcome: 'unknown_request' } : {}) },
      ...(unknown ? { status: 'reconciling' } : {})
    });
    if (patched && unknown && prior.outcome !== 'unknown_request') {
      recordEvent({
        orgId: job.org_id, name: 'media.generation.unknown_request', kind: 'dependency', level: 'warn', outcome: 'error',
        traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
        message: `fal does not know request ${job.provider_request_id} (${count} consecutive 404s); parked for an operator decision`,
        detail: { provider_request_id: job.provider_request_id, unknown_request_count: count }
      });
    }
    return { job: patched || (await jobByIdAnyOrg(env, job.id)) || job, action: 'unknown_request' };
  }
  return applyStatus(env, job, raw, deps);
}

export async function getGeneration(request, env, user, jobId, refresh = true, deps = {}) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));
  let job = await jobById(env, jobId, org.org_id);
  if (!job) throw Object.assign(new Error('Media job not found'), { status: 404 });

  if (refresh && job.provider === 'fal' && job.provider_request_id && !['completed', 'failed', 'cancelled'].includes(job.status)) {
    /* applies the status and, when it completed, fetches result and cost */
    job = (await pollProviderStatus(env, job, deps)).job;
  } else {
    job = await settleCompletedJob(env, job, deps);
  }

  const assets = await db(env, `media_assets?job_id=eq.${encodeURIComponent(job.id)}&order=created_at.asc&select=*`);
  return { job, assets: assets || [] };
}
