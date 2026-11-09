/* Service-role access to the E=Up private intake store. Everything goes through
   the eup_* RPCs defined in supabase/pending/eup_intake_v1.sql; there is no
   direct table access from the Worker and no path to the civic_ or action_policy_ tables.
   Callers have already passed the house-owner check in ./router.js. */
import { feedById, assertRights } from './registry.js';

const fail = (status, message, reason) => Object.assign(new Error(message), { status, reason });

export function storageConfigured(env) {
  return Boolean(env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY);
}

export async function rpc(env, name, args, { fetchImpl = fetch } = {}) {
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
    if (/not_configured|source_paused/.test(message)) throw fail(503, message, message);
    if (code === '40001' || /revision_conflict|idempotency_payload_mismatch|review_item_closed/.test(message)) throw fail(409, message || 'conflict', message.replace(/[^a-z_]/g, '') || 'conflict');
    if (code === 'P0002' || /not_found|unknown_/.test(message)) throw fail(404, message || 'not found', 'not_found');
    if (code === '22023' || code === '22P02') throw fail(400, message || 'invalid request', 'invalid_request');
    throw fail(503, 'E=Up intake storage request failed', 'storage_unavailable');
  }
  return data;
}

export const readSourceStates = async (env, ctx) => (await rpc(env, 'eup_sources_read', { p_action: 'list', p_params: {} }, ctx)) || [];
export const readReview = (env, ctx, status = 'open') => rpc(env, 'eup_sources_read', { p_action: 'review', p_params: { status } }, ctx);
export const readRuns = (env, ctx, source_id) => rpc(env, 'eup_sources_read', { p_action: 'runs', p_params: { source_id } }, ctx);
export const sourcesCommand = (env, ctx, action, params, actor) => rpc(env, 'eup_sources_command', { p_action: action, p_params: params, p_actor: actor }, ctx);
export const civicRead = (env, ctx, action, params) => rpc(env, 'eup_civic_read', { p_action: action, p_params: params }, ctx);
export const companyRead = (env, ctx, action, params) => rpc(env, 'eup_company_read', { p_action: action, p_params: params }, ctx);
export const intakeApply = (env, ctx, source_id, kind, records) => rpc(env, 'eup_intake_apply', { p_source_id: source_id, p_kind: kind, p_records: records }, ctx);
export const importRunFinish = (env, ctx, run_id, status, records, error, cursor) => rpc(env, 'eup_import_run_finish', { p_run_id: run_id, p_status: status, p_records: records, p_error: error, p_cursor: cursor }, ctx);

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
  assertRights(feedEntry, state, { now, fail });
  if (state?.configured !== true) throw fail(503, `${feedEntry.label} is not configured`, 'not_configured');
  for (const name of feedEntry.credentialEnv) if (!(typeof env?.[name] === 'string' && env[name])) throw fail(503, `${feedEntry.label} credential binding ${name} is absent`, 'not_configured');
  if (state?.paused) throw fail(503, `${feedEntry.label} is paused`, 'source_paused');
  return feedEntry;
}
