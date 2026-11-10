/* A synthetic data plane for the paid media protocol, shared by
   media-operation-claims.test.mjs and media-operation-recovery.test.mjs.
   It stubs globalThis.fetch for the Supabase REST/RPC plane (and the provider
   hosts a test opts into) with the semantics the router depends on:

   - the claim functions of supabase/pending/media_operation_claims_v2.sql
     (first insert wins, fingerprint mismatch refused, repair by the job's
     routing.operation_id, takeover after the window including a bound claim
     whose job is gone, bind by job identity, fail by the current attempt
     only), release v2 (once, never after settlement, conditional on the
     expected status) and the operator decision;
   - PostgREST's filters on media_jobs for GET and PATCH (eq, neq, is.null,
     not.is.null, in, not.in, lt/lte/gt/gte, JSON paths such as
     routing->>reservation_state): a PATCH that matches no row answers [] and
     every PATCH is logged with its filter string, so a compare-and-set that
     does not hold is visible;
   - media_jobs.error, provider_status, result, routing and input are NOT NULL
     (0041): a null there is refused with 23502;
   - one job per (org, operation id), like the unique index.

   The SQL itself is proven on PostgreSQL by scripts/test-media-recovery-db.sh;
   this is its in-memory twin for the Worker's side. No network: anything the
   plane does not know is a test failure. */
import { __resetCapabilityCache } from '../../src/lib/capabilities.js';
import { observeScheduled } from '../../src/lib/observability.js';

export const ORG = '123e4567-e89b-42d3-a456-426614174000';
export const OTHER_ORG = '223e4567-e89b-42d3-a456-426614174000';
export const HOUSE_ORG = '323e4567-e89b-42d3-a456-426614174000';
/* The org's owner; also the single house owner unless a test says otherwise. */
export const USER = { id: '423e4567-e89b-42d3-a456-426614174333' };
export const MEMBER = { id: '723e4567-e89b-42d3-a456-426614174777' };
export const MODEL = { id: 't2i', provider: 'fal', provider_model_id: 'fal-ai/flux-2', capability: 'text-to-image', parameter_schema: {}, cost_hint: {}, enabled: true };
export const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', FAL_KEY: 'synthetic' };
export const WINDOW_MS = 15 * 60 * 1000;

export const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const pgError = (code, message, status = 400, extra = {}) => json({ code, message, details: null, hint: null, ...extra }, status);
const missingFunction = (name) => json({ code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache`, details: null, hint: null }, 404);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export const V2_FUNCTIONS = ['media_claim_operation_v2', 'media_bind_operation_v2', 'media_fail_operation_v2', 'media_release_cost_reservation_v2', 'media_resolve_operation_job_v1', 'media_operation_recovery_candidates_v1'];

/* ---- PostgREST filters ---------------------------------------------------- */
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function parseQuery(query) {
  return String(query || '').split('&').filter(Boolean).map((pair) => {
    const at = pair.indexOf('=');
    return [decodeURIComponent(pair.slice(0, at)), decodeURIComponent(pair.slice(at + 1))];
  });
}

function columnValue(row, key) {
  const parts = key.split(/->>|->/);
  let value = row;
  for (const part of parts) value = value === null || value === undefined ? undefined : value[part];
  return value === undefined ? null : value;
}

function list(expr) {
  const inner = expr.slice(expr.indexOf('(') + 1, expr.lastIndexOf(')'));
  return inner.split(',').map((item) => item.trim().replace(/^"|"$/g, '')).filter((item) => item !== '');
}

function compare(value, expr, key) {
  const text = value === null ? null : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  if (expr === 'is.null') return text === null;
  if (expr === 'not.is.null') return text !== null;
  if (expr.startsWith('eq.')) return text !== null && text === expr.slice(3);
  /* SQL: NULL <> 'x' is not true */
  if (expr.startsWith('neq.')) return text !== null && text !== expr.slice(4);
  if (expr.startsWith('in.(')) return text !== null && list(expr).includes(text);
  if (expr.startsWith('not.in.(')) return text !== null && !list(expr).includes(text);
  const ordered = /^(lt|lte|gt|gte)\.(.+)$/.exec(expr);
  if (ordered) {
    if (text === null) return false;
    const left = Date.parse(text), right = Date.parse(ordered[2]);
    const [a, b] = Number.isNaN(left) || Number.isNaN(right) ? [Number(text), Number(ordered[2])] : [left, right];
    return { lt: a < b, lte: a <= b, gt: a > b, gte: a >= b }[ordered[1]];
  }
  throw new Error(`media plane: unsupported PostgREST filter ${key}=${expr}`);
}

export function matchesFilter(row, query) {
  return parseQuery(query).every(([key, expr]) => RESERVED.has(key) || compare(columnValue(row, key), expr, key));
}

function shaped(rows, query) {
  const params = new Map(parseQuery(query));
  let out = [...rows];
  const order = params.get('order');
  if (order) {
    const [column, direction] = order.split(',')[0].split('.');
    out.sort((a, b) => {
      const x = a[column], y = b[column];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * (direction === 'desc' ? -1 : 1);
    });
  }
  if (params.has('limit')) out = out.slice(0, Number(params.get('limit')));
  return out;
}

/* ---- the plane ------------------------------------------------------------- */
export function plane(options = {}) {
  const {
    claimsAvailable = true,        // false: the claim function answers PGRST202
    missing = [],                  // RPC names that answer PGRST202
    lookupGate = null,             // awaited on every media_jobs GET
    patchFails = null,             // true | (entry, state) => boolean : that PATCH answers 500
    reserveFails = false,          // the reservation answers 22023 (budget)
    reserve = null,                // (body, state, create) => Response | undefined : custom reservation
    spendGuard = false,            // refuse a creator who is not an owner (42501), like the trigger
    roles = {},                    // profile id -> org role (default 'owner'; null = not a member)
    houseOwners = [USER.id],
    sessions = {},                 // bearer token -> GoTrue user
    auditFails = false,
    candidates = null,             // the candidates answer, or (body, state) => answer
    billing = null,                // (requestIds) => billing events
    falQueue = null,               // (url, init, state) => Response for POST https://queue.fal.run/...
    beforePatch = null,            // async (entry, state) => void, before a PATCH is applied
    intercept = null,              // async ({ method, url, body }, state) => Response | undefined, before anything else
    models = null                  // (id) => model row
  } = options;
  const gone = new Set(missing);
  if (!claimsAvailable) gone.add('media_claim_operation_v2');

  const state = {
    claims: new Map(), jobs: new Map(), costs: new Map(), assets: [], audit: [], events: [], nonces: new Set(),
    calls: [], patches: [], patchLog: [], rpcs: [],
    lookups: 0, reserves: 0, releases: 0, releaseCalls: 0, releasesV1: 0, claimCalls: 0,
    now: () => Date.now()
  };
  const iso = (ms = state.now()) => new Date(ms).toISOString();
  let seq = 0;
  let auditSeq = 0;

  const roleOf = (profileId) => (Object.prototype.hasOwnProperty.call(roles, profileId) ? roles[profileId] : 'owner');
  const jobByOperation = (orgId, operationId) => [...state.jobs.values()].find((j) => j.org_id === orgId && (j.routing?.operation_id ?? null) === operationId) || null;

  state.createJob = (body) => {
    seq += 1;
    const estimated = body.p_estimated_cost_usd_micros ?? 12000;
    /* The synthetic catalog row carries no price. Production's spend guard
       refuses a paid provider job without an estimate, so every real job is
       'reserved'; the plane reserves a nominal amount to match. */
    const job = {
      id: `523e4567-e89b-42d3-a456-4266141740${String(seq).padStart(2, '0')}`,
      org_id: body.p_org_id, created_by: body.p_created_by ?? null,
      provider: body.p_provider ?? 'fal', provider_model_id: body.p_provider_model_id ?? MODEL.provider_model_id,
      capability: body.p_capability ?? MODEL.capability, status: 'queued', prompt: body.p_prompt ?? null,
      input: clone(body.p_input) ?? {},
      routing: { ...clone(body.p_routing || {}), budget_cents: body.p_budget_cents ?? null, estimated_cost_usd_micros: estimated, reservation_state: 'reserved' },
      provider_request_id: null, provider_status: {}, result: {}, error: {},
      estimated_cost_cents: Math.ceil(estimated / 10000), actual_cost_cents: null,
      submitted_at: null, completed_at: null, created_at: iso(), updated_at: iso()
    };
    state.jobs.set(job.id, job);
    state.costs.set(job.id, { reserved: estimated, released: null, actual: null });
    return job;
  };

  /* --- claims v2 --- */
  const normalise = (row) => Object.assign(row, {
    attempt: row.attempt ?? 1, history: row.history ?? [], claimed_at: row.claimed_at ?? iso(), bound_at: row.bound_at ?? null,
    failure: row.failure ?? null, job_id: row.job_id ?? null, resolution: row.resolution ?? null, resolved_at: row.resolved_at ?? null
  });

  function bind(orgId, operationId, jobId, note = null) {
    const job = state.jobs.get(jobId);
    if (!job || job.org_id !== orgId || (job.routing?.operation_id ?? null) !== operationId) return { error: 'job_not_for_operation' };
    const row = state.claims.get(`${orgId}:${operationId}`);
    if (!row) return { error: 'operation_not_claimed' };
    normalise(row);
    if (row.state === 'bound' && row.job_id) {
      return row.job_id === jobId ? { outcome: 'already_bound', claim: row } : { error: 'operation_bound_elsewhere' };
    }
    const prior = row.state;
    const rebind = prior === 'bound';
    if (rebind) row.resolution = { ...(row.resolution || {}), kind: 'rebind', at: iso(), prior_state: 'bound', ...(note || {}) };
    else if (prior === 'failed' || note) row.resolution = { ...(row.resolution || {}), kind: 'late_bind', at: iso(), prior_state: prior, prior_failure: row.failure, ...(note || {}) };
    if (rebind || prior === 'failed' || note) row.resolved_at = iso();
    Object.assign(row, { job_id: jobId, state: 'bound', bound_at: iso(), updated_at: iso() });
    return { outcome: prior === 'claimed' && !note ? 'bound' : 'repaired', claim: row };
  }

  function claim(body) {
    const key = `${body.p_org_id}:${body.p_operation_id}`;
    let row = state.claims.get(key);
    if (!row) {
      row = normalise({
        org_id: body.p_org_id, operation_id: body.p_operation_id, fingerprint: body.p_fingerprint, actor_id: body.p_actor_id ?? null,
        operation_type: body.p_operation_type || 'media.generate', state: 'claimed', updated_at: iso()
      });
      state.claims.set(key, row);
      return json({ outcome: 'won', attempt: 1, claim: row });
    }
    normalise(row);
    if (row.fingerprint !== body.p_fingerprint) return pgError('P0001', 'operation_payload_mismatch');
    const open = row.state === 'claimed' || (row.state === 'bound' && !row.job_id);
    if (open || row.state === 'failed') {
      const job = jobByOperation(body.p_org_id, body.p_operation_id);
      if (job) {
        const bound = bind(body.p_org_id, body.p_operation_id, job.id, { by: 'media_claim_operation_v2', actor_id: body.p_actor_id ?? null });
        return json({ outcome: 'existing', repaired: true, claim: bound.claim });
      }
    }
    const since = Date.parse(row.bound_at || row.claimed_at);
    if (open && since < state.now() - WINDOW_MS) {
      row.history = [...row.history, {
        attempt: row.attempt, actor_id: row.actor_id ?? null, claimed_at: row.claimed_at, bound_at: row.bound_at, superseded_at: iso(),
        reason: row.state === 'bound' ? 'bound_job_missing' : 'expired_without_job'
      }];
      Object.assign(row, { state: 'claimed', job_id: null, bound_at: null, attempt: row.attempt + 1, actor_id: body.p_actor_id ?? null, claimed_at: iso(), updated_at: iso() });
      return json({ outcome: 'won', takeover: true, attempt: row.attempt, claim: row });
    }
    return json({ outcome: 'existing', claim: row, expires_at: open ? iso(since + WINDOW_MS) : null });
  }

  function failClaim(body) {
    if (body.p_attempt === null || body.p_attempt === undefined) return pgError('22023', 'attempt is required');
    const row = state.claims.get(`${body.p_org_id}:${body.p_operation_id}`);
    if (!row || normalise(row).state !== 'claimed') return pgError('P0001', 'operation_not_claimed');
    if (row.attempt !== body.p_attempt) return pgError('P0001', 'operation_attempt_superseded');
    if (jobByOperation(body.p_org_id, body.p_operation_id)) return pgError('P0001', 'operation_has_job');
    Object.assign(row, { state: 'failed', failure: body.p_failure ?? {}, updated_at: iso() });
    return json(row);
  }

  /* --- money --- */
  const settled = (job) => job.routing?.reservation_state === 'settled' || state.costs.get(job.id)?.actual !== null && state.costs.get(job.id)?.actual !== undefined;

  function release(body) {
    state.releaseCalls += 1;
    const job = state.jobs.get(body.p_job_id);
    if (!job) return { error: ['22023', 'Unknown media job'] };
    if (Array.isArray(body.p_expect_status) && !body.p_expect_status.includes(job.status)) return { error: ['P0001', 'job_status_mismatch'] };
    if (settled(job)) return { error: ['P0001', 'reservation_already_settled'] };
    const cost = state.costs.get(job.id);
    if (!cost || cost.reserved === null) return { released: false, reason: 'no_reservation', job_id: job.id };
    if (cost.released) return { released: false, reason: 'already_released', job_id: job.id, amount_usd_micros: cost.released.amount, source: cost.released.source };
    cost.released = { amount: cost.reserved, source: body.p_source || 'mccluster-release', reason: body.p_reason ?? null, metadata: clone(body.p_metadata) || {} };
    job.routing = { ...job.routing, reservation_state: 'released', released_reserve_usd_micros: cost.reserved, reservation_released_at: iso() };
    state.releases += 1;
    return { released: true, job_id: job.id, amount_usd_micros: cost.reserved, source: cost.released.source };
  }

  function recordActual(body) {
    const job = state.jobs.get(body.p_job_id);
    if (!job) return pgError('22023', 'Unknown media job');
    const cost = state.costs.get(job.id) || { reserved: null, released: null, actual: null };
    cost.actual = body.p_actual_cost_usd_micros;
    if (cost.reserved !== null) cost.released = { amount: Math.max(cost.reserved - cost.actual, 0), source: 'mccluster-reconciliation', reason: 'unused reserve after provider reconciliation', metadata: {} };
    state.costs.set(job.id, cost);
    job.actual_cost_cents = Math.ceil(cost.actual / 10000);
    job.routing = { ...job.routing, actual_cost_usd_micros: cost.actual, reservation_state: 'settled' };
    return json(null);
  }

  /* --- the operator decision (media_resolve_operation_job_v1) --- */
  function resolve(body) {
    const refuse = (message) => pgError('P0001', message);
    const invalid = (message) => pgError('22023', message);
    const decision = body.p_decision;
    if (!['release', 'settle', 'bind'].includes(decision)) return invalid('decision must be release, settle or bind');
    if (!body.p_org_id || !body.p_job_id || !body.p_actor_id) return invalid('org_id, job_id and actor_id are required');
    if (!String(body.p_reason || '').trim()) return invalid('a reason is required');
    const requestId = String(body.p_provider_request_id || '').trim() || null;
    if (decision === 'settle' && !requestId) return invalid('settle requires the provider request id');
    const job = state.jobs.get(body.p_job_id);
    if (!job) return refuse('job_not_found');
    if (job.org_id !== body.p_org_id) return refuse('job_not_in_org');
    const last = job.routing?.operator_resolution || null;
    const history = job.routing?.operator_resolution_history || [];
    const outcome = job.provider_status?.outcome ?? null;
    const given = body.p_evidence && typeof body.p_evidence === 'object' && !Array.isArray(body.p_evidence) ? body.p_evidence : {};
    const evidence = Object.keys(given).length > 0;
    if (last && last.decision === decision && (decision !== 'settle' || (last.provider_request_id ?? null) === requestId)) {
      return json({ outcome: 'already_resolved', job_id: job.id, resolution: last });
    }
    if (last) {
      if (last.decision === 'release' && decision === 'settle') { /* allowed */ }
      else if (last.decision === 'settle' && decision === 'release') {
        if (outcome !== 'unknown_request' || !evidence) return refuse('release_after_settle_requires_unknown_request');
      } else if (last.decision === 'bind' && decision !== 'bind') { /* allowed */ }
      else return refuse('job_already_resolved');
    }
    const resolution = {
      decision, actor_id: body.p_actor_id, reason: body.p_reason, evidence: given, at: iso(), prior_status: job.status, prior_outcome: outcome,
      prior_reservation_state: job.routing?.reservation_state ?? null, prior_error: clone(job.error),
      provider_request_id: decision === 'settle' ? requestId : (job.provider_request_id ?? null)
    };
    const marks = { operator_resolution: resolution, operator_resolution_history: [...history, resolution] };
    if (decision === 'bind') {
      const operationId = job.routing?.operation_id ?? null;
      if (!operationId) return invalid('job carries no operation_id');
      const bound = bind(job.org_id, operationId, job.id, { by: 'operator', actor_id: body.p_actor_id, reason: body.p_reason });
      if (bound.error) return refuse(bound.error);
      job.routing = { ...job.routing, ...marks };
      return json({ outcome: bound.outcome, job_id: job.id, status: job.status, claim: bound.claim, resolution });
    }
    if (settled(job)) return refuse('reservation_already_settled');
    if (job.provider_request_id && job.status !== 'failed' && outcome !== 'unknown_request') return refuse('job_has_provider_request');
    if (!['queued', 'reconciling', 'failed'].includes(job.status)) return refuse('job_not_resolvable');
    if (decision === 'release') {
      const neverStarted = job.routing?.submit_protocol === 'cas-v1' && !job.provider_request_id && outcome === null && job.status === 'queued';
      if (!neverStarted && job.status !== 'failed' && !evidence) return refuse('release_requires_evidence');
      Object.assign(job, {
        status: 'failed', error: { message: body.p_reason, stage: 'recovery', decision: 'release' },
        provider_status: { ...job.provider_status, outcome: 'released_by_operator', released_at: iso() },
        routing: { ...job.routing, ...marks }, updated_at: iso()
      });
      const released = release({ p_job_id: job.id, p_reason: body.p_reason, p_source: 'mccluster-operator-release', p_metadata: { actor_id: body.p_actor_id, evidence: given, decision: 'release' }, p_expect_status: ['failed'] });
      return json({ outcome: 'released', job_id: job.id, status: 'failed', release: released, resolution });
    }
    const refusedSubmit = job.status === 'failed' && (outcome === 'submit_refused' || (job.error?.stage === 'submit' && job.error?.uncertain !== true));
    if (refusedSubmit && !evidence) return refuse('settle_requires_evidence');
    if ([...state.jobs.values()].some((j) => j.id !== job.id && j.provider === job.provider && j.provider_request_id === requestId)) return refuse('provider_request_id_in_use');
    const { unknown_request_count: _dropped, ...status } = job.provider_status || {};
    Object.assign(job, {
      provider_request_id: requestId, submitted_at: job.submitted_at || iso(), status: 'queued', error: {},
      provider_status: { ...status, outcome: 'attached_by_operator', attached_at: iso(), request_id: requestId },
      routing: { ...job.routing, ...marks }, updated_at: iso()
    });
    return json({ outcome: 'settled', job_id: job.id, status: 'queued', provider_request_id: requestId, resolution });
  }

  /* --- fetch --- */
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input instanceof Request ? input.url : input);
    const method = init.method || (input instanceof Request ? input.method : 'GET');
    let body = null;
    if (init.body) { try { body = JSON.parse(String(init.body)); } catch { body = String(init.body); } }
    state.calls.push({ method, url: u, body });
    const header = (name) => new Headers(init.headers || (input instanceof Request ? input.headers : {})).get(name);
    if (intercept) {
      const answered = await intercept({ method, url: u, body }, state);
      if (answered) return answered;
    }

    if (u.startsWith('https://queue.fal.run/') && falQueue) return falQueue(u, init, state);
    if (u.startsWith('https://api.fal.ai/v1/models/billing-events')) {
      const ids = new URL(u).searchParams.getAll('request_id');
      return json({ billing_events: billing ? billing(ids, state) : [], has_more: false });
    }
    if (!u.startsWith(env.SUPABASE_URL)) throw new Error(`Unexpected offline fixture fetch: ${method} ${u}`);
    const path = u.slice(env.SUPABASE_URL.length);

    if (path.startsWith('/auth/v1/user')) {
      const token = String(header('authorization') || '').replace(/^Bearer\s+/i, '');
      return sessions[token] ? json(sessions[token]) : json({ message: 'invalid token' }, 401);
    }
    if (path === '/rest/v1/core_signed_nonces' && method === 'POST') {
      if (state.nonces.has(body?.nonce)) return new Response(null, { status: 409 });
      state.nonces.add(body?.nonce);
      return new Response(null, { status: 201 });
    }
    if (path.startsWith('/rest/v1/orgs?')) return json([{ id: HOUSE_ORG }]);
    if (path.startsWith('/rest/v1/org_members?')) {
      const query = path.slice(path.indexOf('?') + 1);
      const params = new Map(parseQuery(query));
      const profile = (params.get('profile_id') || '').replace(/^eq\./, '');
      if (profile) {
        const role = roleOf(profile);
        return json(role ? [{ org_id: (params.get('org_id') || '').replace(/^eq\./, ''), role }] : []);
      }
      return json(houseOwners.map((id) => ({ profile_id: id })));
    }
    if (path.startsWith('/rest/v1/control_role_capabilities?')) {
      return json(['owner', 'staff', 'viewer'].map((role) => ({ role, capability: 'media.generate', allowed: role !== 'viewer' })));
    }
    if (path.startsWith('/rest/v1/media_models?')) {
      const id = decodeURIComponent((path.match(/[?&]id=eq\.([^&]+)/) || [])[1] || '');
      return json([models ? models(id) : MODEL].filter(Boolean));
    }
    if (path.startsWith('/rest/v1/control_observability_events') && method === 'POST') {
      state.events.push(...(Array.isArray(body) ? body : [body]));
      return new Response(null, { status: 201 });
    }
    if (path === '/rest/v1/control_audit' && method === 'POST') {
      if (auditFails) return json({ message: 'synthetic ledger outage' }, 500);
      auditSeq += 1;
      const row = { id: auditSeq, at: iso(), ...body };
      state.audit.push(row);
      return json([row], 201);
    }
    if (path.startsWith('/rest/v1/media_assets')) {
      if (method === 'POST') {
        const rows = (Array.isArray(body) ? body : [body]).map((asset, i) => ({ id: `asset-${state.assets.length + i + 1}`, created_at: iso(), ...asset }));
        state.assets.push(...rows);
        return json(rows, 201);
      }
      const jobId = decodeURIComponent((path.match(/job_id=eq\.([^&]+)/) || [])[1] || '');
      return json(state.assets.filter((asset) => asset.job_id === jobId));
    }

    const rpc = (path.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/) || [])[1];
    if (rpc) {
      state.rpcs.push({ name: rpc, body });
      if (rpc === 'media_claim_operation_v2') state.claimCalls += 1;
      if (gone.has(rpc)) return missingFunction(rpc);
      if (rpc === 'media_claim_operation_v2') return claim(body);
      if (rpc === 'media_bind_operation_v2') {
        const bound = bind(body.p_org_id, body.p_operation_id, body.p_job_id, body.p_note ?? null);
        return bound.error ? pgError('P0001', bound.error) : json(bound);
      }
      if (rpc === 'media_fail_operation_v2') return failClaim(body);
      if (rpc === 'media_create_budgeted_job_v2') {
        state.reserves += 1;
        if (reserveFails) return pgError('22023', 'Estimated media cost exceeds budget');
        if (reserve) {
          const custom = await reserve(body, state, () => state.createJob(body));
          if (custom) return custom;
        }
        if (spendGuard && roleOf(body.p_created_by) !== 'owner') {
          return pgError('42501', 'Organization owner access is required to spend on media generation', 403);
        }
        const operationId = body.p_routing?.operation_id ?? null;
        if (operationId && jobByOperation(body.p_org_id, operationId)) {
          return pgError('23505', 'duplicate key value violates unique constraint "media_jobs_org_operation_uidx"', 409, { details: `Key (org_id, (routing ->> 'operation_id'::text))=(${body.p_org_id}, ${operationId}) already exists.` });
        }
        return json(state.createJob(body));
      }
      if (rpc === 'media_release_cost_reservation_v2') {
        const released = release(body);
        return released.error ? pgError(...released.error) : json(released);
      }
      if (rpc === 'media_release_cost_reservation') {
        /* 0054: no status condition, no settlement guard */
        state.releasesV1 += 1;
        const job = state.jobs.get(body.p_job_id);
        const cost = job && state.costs.get(job.id);
        if (job && cost && cost.reserved !== null) {
          cost.released = { amount: cost.reserved, source: 'mccluster-release', reason: body.p_reason ?? null, metadata: {} };
          job.routing = { ...job.routing, reservation_state: 'released' };
          state.releases += 1;
        }
        return json(null);
      }
      if (rpc === 'media_record_actual_cost_v2') return recordActual(body);
      if (rpc === 'media_resolve_operation_job_v1') return resolve(body);
      if (rpc === 'media_operation_recovery_candidates_v1') {
        const answer = typeof candidates === 'function' ? candidates(body, state) : candidates;
        return json(answer || { generated_at: iso(), older_than: '00:15:00', counts: {}, by_org: [], candidates: [] });
      }
      throw new Error(`Unexpected offline fixture RPC: ${rpc}`);
    }

    if (path.startsWith('/rest/v1/media_jobs?')) {
      const query = path.slice(path.indexOf('?') + 1);
      if (method === 'GET') {
        state.lookups += 1;
        if (lookupGate) await lookupGate(state.lookups);
        return json(shaped([...state.jobs.values()].filter((job) => matchesFilter(job, query)), query).map(clone));
      }
      if (method === 'PATCH') {
        const id = decodeURIComponent((query.match(/(?:^|&)id=eq\.([^&]+)/) || [])[1] || '');
        const filter = query.replace(/(?:^|&)id=eq\.[^&]+/, '').replace(/^&/, '');
        const entry = { id, filter, body, matched: 0, failed: false };
        state.patches.push(body);
        state.patchLog.push(entry);
        if (patchFails === true || (typeof patchFails === 'function' && patchFails(entry, state))) {
          entry.failed = true;
          return json({ message: 'synthetic persistence failure' }, 500);
        }
        if (beforePatch) await beforePatch(entry, state);
        for (const column of ['error', 'provider_status', 'result', 'routing', 'input']) {
          if (body && Object.prototype.hasOwnProperty.call(body, column) && body[column] === null) {
            entry.failed = true;
            return pgError('23502', `null value in column "${column}" of relation "media_jobs" violates not-null constraint`);
          }
        }
        const rows = [...state.jobs.values()].filter((job) => matchesFilter(job, query));
        for (const job of rows) Object.assign(job, clone(body));
        entry.matched = rows.length;
        return json(rows.map(clone));
      }
    }
    throw new Error(`Unexpected offline fixture fetch: ${method} ${u}`);
  };
  __resetCapabilityCache();
  state.restore = () => { globalThis.fetch = original; __resetCapabilityCache(); };
  state.job = (id) => state.jobs.get(id);
  state.onlyJob = () => { if (state.jobs.size !== 1) throw new Error(`expected one job, found ${state.jobs.size}`); return [...state.jobs.values()][0]; };
  state.eventNames = () => state.events.map((event) => event.event_name);
  state.event = (name) => state.events.find((event) => event.event_name === name) || null;
  state.rpcCalls = (name) => state.rpcs.filter((call) => call.name === name);
  /* index of the first call matching the predicate, -1 when none */
  state.callIndex = (predicate) => state.calls.findIndex(predicate);
  return state;
}

/* A provider adapter double for deps.submit. */
export function provider({ mode = 'accept' } = {}) {
  const p = { submits: 0, calls: [] };
  p.submit = async (_env, modelId, input, options) => {
    p.submits += 1;
    p.calls.push({ modelId, input, options });
    if (typeof mode === 'function') return mode(p);
    if (mode === 'uncertain') throw Object.assign(new Error('Synthetic timeout after provider acceptance'), { name: 'TimeoutError' });
    if (mode === 'definite') throw Object.assign(new Error('fal gateway is not configured'), { status: 503, preflight: true });
    if (mode === 'rejected') throw Object.assign(new Error('Unprocessable input'), { status: 422 });
    return { request_id: `accepted-${p.submits}` };
  };
  return p;
}

/* Domain events are recorded only under a trace (lib/observability.js). Run
   fn under one and wait for the flush, so state.events holds what it wrote. */
export async function traced(fn, traceEnv = env) {
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  let result;
  let failure = null;
  try { result = await observeScheduled(traceEnv, ctx, 'test.media', fn); } catch (error) { failure = error; }
  await Promise.all(pending);
  if (failure) throw failure;
  return result;
}
