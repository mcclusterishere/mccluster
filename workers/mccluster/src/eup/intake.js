/* Service-role access to the E=Up private intake store. Everything goes through
   the eup_* RPCs defined in supabase/pending/eup_intake_v1.sql; there is no
   direct table access from the Worker and no path to the civic_ or action_policy_ tables.
   Callers have already passed the house-owner check in ./router.js.
   Intake writes are guarded by the persisted policy of module intake in their own transaction; a refused
   write answers with the shared module-policy reasons from ./modules.js (the one mapping of those codes).
   Import runs: a run is claimed under a lease and the policy revision the claim was made under (guarded),
   every apply of that job carries the revision, and the run is settled (finished or released) by its lease
   alone, in every module state. The job itself is ./import-runner.js. */
import { feedById, assertRights } from './registry.js';
import { modulePolicyRefusal } from './modules.js';

const fail = (status, message, reason) => Object.assign(new Error(message), { status, reason });

export function storageConfigured(env) {
  return Boolean(env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY);
}

/* A refused guarded write is mapped first, before the storage_unavailable fallback. The EUM codes always mean
   the module guard. A lock wait, a statement timeout and an undefined function mean it only where the guard
   runs: `guarded: false` is for RPCs it never runs in (reads, lease-gated settlement), where those three stay
   storage failures. */
const REFUSAL_TEXT = { module_policy_unavailable: 'Module policy unavailable', module_not_installed: 'The intake module is not installed', module_draining: 'The intake module is draining', module_disabled: 'The intake module is disabled', module_policy_changed: 'The intake module policy changed', module_busy: 'The intake module is busy' };
export async function rpc(env, name, args, { fetchImpl = fetch, guarded = true } = {}) {
  if (!storageConfigured(env)) throw fail(503, 'E=Up intake storage is not configured', 'storage_unavailable');
  let res;
  try {
    res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(args)
    });
  } catch {
    throw fail(503, 'E=Up intake storage is unreachable', 'storage_unavailable');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const message = String(data?.message || '');
    const code = String(data?.code || '');
    const refusal = guarded || /^EUM0[0-4]$/.test(code) ? modulePolicyRefusal(code) : null;
    if (refusal) throw fail(refusal[0], REFUSAL_TEXT[refusal[1]] || 'Module policy refused the write', refusal[1]);
    /* Settlement of an import run is gated by its lease: another claim holds the run, or it is not running. */
    if (code === 'EUI01') throw fail(409, 'The import run lease was lost', 'lease_lost');
    if (code === 'EUI02') throw fail(409, 'The import run is not running', 'run_not_running');
    if (/not_configured|source_paused/.test(message)) throw fail(503, message, message);
    if (code === '40001' || /revision_conflict|idempotency_payload_mismatch|review_item_closed/.test(message)) throw fail(409, message || 'conflict', message.replace(/[^a-z_]/g, '') || 'conflict');
    if (code === 'P0002' || /not_found|unknown_/.test(message)) throw fail(404, message || 'not found', 'not_found');
    if (code === '22023' || code === '22P02') throw fail(400, message || 'invalid request', 'invalid_request');
    throw fail(503, 'E=Up intake storage request failed', 'storage_unavailable');
  }
  return data;
}

const unguarded = (ctx) => ({ fetchImpl: ctx?.fetchImpl, guarded: false });
export const readSourceStates = async (env, ctx) => (await rpc(env, 'eup_sources_read', { p_action: 'list', p_params: {} }, unguarded(ctx))) || [];
export const readReview = (env, ctx, status = 'open') => rpc(env, 'eup_sources_read', { p_action: 'review', p_params: { status } }, unguarded(ctx));
export const readRuns = (env, ctx, source_id) => rpc(env, 'eup_sources_read', { p_action: 'runs', p_params: { source_id } }, unguarded(ctx));
export const sourcesCommand = (env, ctx, action, params, actor) => rpc(env, 'eup_sources_command', { p_action: action, p_params: params, p_actor: actor }, ctx);
export const civicRead = (env, ctx, action, params) => rpc(env, 'eup_civic_read', { p_action: action, p_params: params }, unguarded(ctx));
export const companyRead = (env, ctx, action, params) => rpc(env, 'eup_company_read', { p_action: action, p_params: params }, unguarded(ctx));
/* { queued, running, running_expired, lease_expires_at }: the open import runs. A drain has settled when
   running - running_expired is 0 (an expired lease has no live holder). Never guarded. */
export const readRunCounts = (env, ctx) => rpc(env, 'eup_sources_read', { p_action: 'run_counts', p_params: {} }, unguarded(ctx));
/* A job passes the policy revision its claim returned: the store then refuses the write once the module
   drains (module_draining) and after a drain and re-enable (module_policy_changed). Without one the write is
   bound to the current policy only. */
export const intakeApply = (env, ctx, source_id, kind, records, policy_revision = null) => rpc(env, 'eup_intake_apply', { p_source_id: source_id, p_kind: kind, p_records: records, ...(policy_revision === null || policy_revision === undefined ? {} : { p_policy_revision: policy_revision }) }, ctx);
/* Guarded: a module that is not installed, draining or disabled starts no job.
   { claimed: false, policy_revision } | { claimed: true, run_id, source_id, cursor, attempt, lease, lease_expires_at, policy_revision, reclaimed }.
   The lease is the holder's secret and cannot be renewed (30 to 3600 seconds). */
export const importRunClaim = (env, ctx, worker, source_id = null, lease_seconds = 300) => rpc(env, 'eup_import_run_claim', { p_worker: worker, p_source_id: source_id, p_lease_seconds: lease_seconds }, ctx);
/* Settlement is not guarded by module state: it is how a drain finishes. Only the holder of the lease of a
   running run can release it (back to queued, kept) or finish it; anyone else is refused lease_lost or
   run_not_running (409). */
export const importRunRelease = (env, ctx, run_id, lease, reason) => rpc(env, 'eup_import_run_release', { p_run_id: run_id, p_lease: lease, p_reason: reason }, unguarded(ctx));
export const importRunFinish = (env, ctx, run_id, status, records, error, cursor, lease = null) => rpc(env, 'eup_import_run_finish', { p_run_id: run_id, p_status: status, p_records: records, p_error: error, p_cursor: cursor, p_lease: lease }, unguarded(ctx));

/* Rows from a source whose rights are held, unreviewed or expired are withheld
   from any read, even when they are already stored (a cached restricted record
   cannot outlive its grant). Returns the kept rows and a count of withheld. */
export function withholdRestricted(rows, states, { now = Date.now() } = {}) {
  const byId = new Map((states || []).map((s) => [s.source_id, s]));
  const kept = []; const withheld = {};
  for (const row of rows || []) {
    const sid = row?.provenance?.source_id;
    const feedEntry = feedById(sid);
    try {
      if (feedEntry) assertRights(feedEntry, byId.get(sid) || null, { now });
      kept.push(row);
    } catch (error) {
      withheld[sid] = (withheld[sid] || 0) + 1;
    }
  }
  return { rows: kept, withheld };
}

/* The one gate before any upstream request: definition known, rights
   approved and unexpired, bindings present, source configured and not paused.
   It never touches the network itself. */
export function assertFetchAllowed(source_id, state, env, { now = Date.now() } = {}) {
  const feedEntry = feedById(source_id);
  if (!feedEntry) throw fail(404, 'Unknown source', 'unknown_source');
  if (feedEntry.access === 'held') throw fail(403, `${feedEntry.label} is held pending rights review`, 'rights_held');
  /* unreviewed access is a configuration gap (503), expired access is a rights refusal (403) */
  if (state?.access !== 'approved') throw fail(503, `${feedEntry.label} access has not been reviewed and approved`, 'not_configured');
  assertRights(feedEntry, state, { now, fail });
  if (state?.configured !== true) throw fail(503, `${feedEntry.label} is not configured`, 'not_configured');
  for (const name of feedEntry.credentialEnv) if (!(typeof env?.[name] === 'string' && env[name])) throw fail(503, `${feedEntry.label} credential binding ${name} is absent`, 'not_configured');
  if (state?.paused) throw fail(503, `${feedEntry.label} is paused`, 'source_paused');
  return feedEntry;
}
