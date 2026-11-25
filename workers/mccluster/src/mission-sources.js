/* Mission sources: the house owner's controls over a mission catalog's source page in the World (the first is Project
   Drawdown's, the source of the catalog 'drawdown'). docs/control-plane/WORLD-MISSION-SOURCES.md is the record; every
   decision there is a default adopted pending Matthew's confirmation. A source page is McCluster Corp's page about the
   organization a catalog was written from: never that organization's account, sponsor or partner page.

     GET  /v1/mission-sources            every source with its state (drafts included), its organization, its open
                                         missions and the last 20 audit records: { ok, store, sources, history }
     POST /v1/mission-sources/commands   { command: show | hide | edit, catalog, expected_revision, key, reason, payload? }
                                         -> { ok: true, receipt }

   OWNER ONLY, and an authorization addition (the house owner reads drafts and changes public words), which ships only with
   Matthew's approval of the pull request and of the pending SQL. Nothing here runs before the verified house-owner check
   (requireHouseOwner from index.js): its 401 and 403 pass through; anything else it throws means it could not answer
   (503 authorization_unavailable). The acting owner is always the verified session user, never a body field, and both
   store functions check the house owner again in their own transaction (42501). Every answer is private, no-store.

   THE STORE is pending SQL (supabase/pending/20261119140000_mission_catalog_sources_v1.sql): two SECURITY DEFINER functions
   executable by service_role only, reached as the service role through PostgREST, as ./eup/environment/owner.js reaches
   its store (the service key, /rest/v1/rpc/<name>, a 10 s timeout, no redirect). No table is read directly. Until the
   SQL is applied the functions do not exist: the read answers 200 store 'not_applied' and a command 503
   store_not_applied, recording nothing. So this route is safe the moment the Worker deploys, before anything is applied.

   NO UPSTREAM TEXT. A refusal answers { ok: false, code, error } with a fixed sentence per code. The constraint name in
   PostgREST's message is read only to choose between words_refused, facts_refused and role_line_refused. For a command,
   storage_unavailable means the outcome is UNKNOWN: read the history back and look for the key; the same body with the
   same key is recorded at most once. */
import { reply } from './lib/http.js';

export const MISSION_SOURCES_PREFIX = '/v1/mission-sources';
export const MISSION_SOURCES_PENDING_FILE = 'supabase/pending/20261119140000_mission_catalog_sources_v1.sql';
export const MISSION_SOURCES_RPC_TIMEOUT_MS = 10000;
export const MISSION_SOURCE_COMMANDS = Object.freeze(['show', 'hide', 'edit']);
const MAX_BODY_BYTES = 4096;
const BODY_KEYS = Object.freeze(['command', 'catalog', 'expected_revision', 'key', 'reason', 'payload']);
const CATALOG = /^[a-z][a-z0-9_-]{1,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_REVISION = 2147483647;

/* The fixed sentences (docs/control-plane/WORLD-MISSION-SOURCES.md, the Control card's words). */
export const MISSION_SOURCE_MESSAGES = Object.freeze({
  authentication_required: 'Sign in as the house owner.',
  owner_required: 'Only the house owner can change a mission source.',
  authorization_unavailable: 'The house owner check did not answer. Nothing was read or changed.',
  invalid: 'That change could not be read. Nothing was changed.',
  words_refused: 'These words cannot be saved: a source page never calls its source a sponsor, partner, funder, author or operator, and never says it endorsed, recommended or approved anything.',
  facts_refused: 'Each fact needs a label (up to 40 characters), a value (up to 160) and an https source; up to six facts, with the date they were read.',
  role_line_refused: 'The role line must be one line of 1 to 160 characters.',
  not_found: 'There is no source page for that catalog. Nothing was changed.',
  moved: 'This source changed since you opened it. Reload it and try again.',
  key_reused: 'That command key was already used for a different change. Reload and try again.',
  store_busy: 'The store is busy. Nothing was changed; send it again.',
  store_not_applied: 'The mission sources table is not applied yet (supabase/pending/20261119140000_mission_catalog_sources_v1.sql). Nothing can be shown, hidden or edited until it is approved and applied.',
  storage_unavailable: 'Not known whether this was saved. Read the record back and look for the key; the same change sent again with the same key is recorded at most once.',
  not_route: 'There is no such mission sources route.',
  method_not_allowed: 'That method is not allowed here.'
});

/* A store answer (SQLSTATE or PostgREST code) -> [HTTP status, code]. Anything not named here, a timeout, a redirect, a
   lost or unreadable answer is 503 storage_unavailable. */
const STATUS = Object.freeze({
  '42501': [403, 'owner_required'],
  '22023': [422, 'invalid'], '22007': [422, 'invalid'], '22008': [422, 'invalid'], '22P02': [422, 'invalid'],
  MCS01: [404, 'not_found'], MCS02: [409, 'moved'], MCS03: [409, 'key_reused'],
  '55P03': [503, 'store_busy'], '57014': [503, 'store_busy'],
  PGRST202: [503, 'store_not_applied'], '42883': [503, 'store_not_applied'], PGRST205: [503, 'store_not_applied'], '42P01': [503, 'store_not_applied']
});
const CHECKS = Object.freeze({
  mission_catalog_sources_words_check: 'words_refused',
  mission_catalog_sources_facts_check: 'facts_refused',
  mission_catalog_sources_read_on_check: 'facts_refused',
  mission_catalog_sources_role_line_check: 'role_line_refused'
});
export const MISSION_SOURCE_STORE_ERRORS = STATUS;

const refusal = (status, code) => Object.assign(new Error(MISSION_SOURCE_MESSAGES[code]), { status, code });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const length = (s) => [...s].length;
function isDay(s) {
  if (typeof s !== 'string' || !DAY.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/* The store's code for a refused answer: 23514 is split by the constraint PostgREST names in its message. */
export function storeCode(body) {
  const code = typeof body?.code === 'string' ? body.code : '';
  if (code === '23514') {
    const m = /check constraint "([a-z0-9_]+)"/.exec(typeof body?.message === 'string' ? body.message : '');
    return [422, (m && CHECKS[m[1]]) || 'invalid'];
  }
  return Object.hasOwn(STATUS, code) ? STATUS[code] : [503, 'storage_unavailable'];
}

/* One service-role RPC. Resolves to the function's JSON; throws refusal(status, code) otherwise. */
async function storeRpc(env, fetchImpl, name, args, timeoutMs) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) throw refusal(503, 'storage_unavailable');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs > 0 ? timeoutMs : MISSION_SOURCES_RPC_TIMEOUT_MS) : null;
  try {
    let response;
    try {
      response = await fetchImpl(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST', redirect: 'manual', signal: controller ? controller.signal : undefined,
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(args)
      });
    } catch { throw refusal(503, 'storage_unavailable'); }
    if (response.status >= 300 && response.status < 400) throw refusal(503, 'storage_unavailable');
    let value;
    try { value = await response.json(); } catch { value = undefined; }
    if (!response.ok) throw refusal(...storeCode(value));
    if (value === undefined) throw refusal(503, 'storage_unavailable');
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* The command body, checked before any store call: exactly the six keys (payload optional), and the payload the command
   takes. Returns the RPC's arguments without the actor; throws 422 invalid. */
export function commandArgs(body) {
  const invalid = () => refusal(422, 'invalid');
  if (!isObject(body)) throw invalid();
  const keys = Object.keys(body);
  if (!keys.every((k) => BODY_KEYS.includes(k)) || !BODY_KEYS.filter((k) => k !== 'payload').every((k) => keys.includes(k))) throw invalid();
  const { command, catalog, expected_revision: revision, key, reason } = body;
  if (!MISSION_SOURCE_COMMANDS.includes(command)) throw invalid();
  if (typeof catalog !== 'string' || !CATALOG.test(catalog)) throw invalid();
  if (!Number.isInteger(revision) || revision < 1 || revision > MAX_REVISION) throw invalid();
  if (typeof key !== 'string' || !UUID.test(key)) throw invalid();
  if (typeof reason !== 'string' || length(reason) < 1 || length(reason) > 500 || CONTROL.test(reason)) throw invalid();
  const payload = body.payload === undefined ? {} : body.payload;
  if (!isObject(payload)) throw invalid();
  const pk = Object.keys(payload);
  if (command === 'show') {
    if (pk.length !== 2 || payload.permission_confirmed !== true || !isDay(payload.permission_confirmed_on)) throw invalid();
  } else if (command === 'hide') {
    if (pk.length) throw invalid();
  } else {
    if (!pk.length || !pk.every((k) => ['role_line', 'facts', 'facts_read_on'].includes(k))) throw invalid();
    if ('role_line' in payload && (typeof payload.role_line !== 'string' || length(payload.role_line) > 160)) throw invalid();
    if ('facts' in payload && (!Array.isArray(payload.facts) || payload.facts.length > 6 || !('facts_read_on' in payload))) throw invalid();
    if ('facts_read_on' in payload && !isDay(payload.facts_read_on)) throw invalid();
  }
  return { p_catalog: catalog, p_command: command, p_expected_revision: revision, p_key: key.toLowerCase(), p_reason: reason, p_payload: payload };
}

async function readBody(request) {
  let text;
  try { text = await request.text(); } catch { throw refusal(422, 'invalid'); }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw refusal(422, 'invalid');
  try { return JSON.parse(text); } catch { throw refusal(422, 'invalid'); }
}

export async function handleMissionSources(request, env, { requireHouseOwner, fetchImpl = fetch, rpcTimeoutMs = MISSION_SOURCES_RPC_TIMEOUT_MS } = {}) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (path !== MISSION_SOURCES_PREFIX && !path.startsWith(MISSION_SOURCES_PREFIX + '/')) return null;
  const respond = (data, status = 200) => {
    const r = reply(request, env, data, status);
    r.headers.set('cache-control', 'private, no-store');
    return r;
  };
  const refuse = (error) => {
    const code = typeof error?.code === 'string' && Object.hasOwn(MISSION_SOURCE_MESSAGES, error.code) ? error.code : 'storage_unavailable';
    const status = Number.isInteger(error?.status) ? error.status : 503;
    return respond({ ok: false, code, error: MISSION_SOURCE_MESSAGES[code] }, status);
  };
  try {
    if (typeof requireHouseOwner !== 'function') throw refusal(503, 'authorization_unavailable');
    let user;
    try { user = await requireHouseOwner(request, env); } catch (error) {
      if (error?.status === 401) throw refusal(401, 'authentication_required');
      if (error?.status === 403) throw refusal(403, 'owner_required');
      throw refusal(503, 'authorization_unavailable');
    }
    if (!user || typeof user.id !== 'string' || !UUID.test(user.id)) throw refusal(401, 'authentication_required');
    const actor = user.id.toLowerCase();

    if (path === MISSION_SOURCES_PREFIX) {
      if (request.method !== 'GET') throw refusal(405, 'method_not_allowed');
      try {
        const value = await storeRpc(env, fetchImpl, 'mission_catalog_source_owner_state', { p_actor: actor }, rpcTimeoutMs);
        if (!isObject(value) || !Array.isArray(value.sources) || !Array.isArray(value.history)) return respond({ ok: true, store: 'unavailable', sources: [], history: [] });
        return respond({ ok: true, store: 'applied', sources: value.sources, history: value.history });
      } catch (error) {
        if (error?.code === 'owner_required') throw error;
        if (error?.code === 'store_not_applied') return respond({ ok: true, store: 'not_applied', sources: [], history: [] });
        return respond({ ok: true, store: 'unavailable', sources: [], history: [] });
      }
    }

    if (path === `${MISSION_SOURCES_PREFIX}/commands`) {
      if (request.method !== 'POST') throw refusal(405, 'method_not_allowed');
      const args = commandArgs(await readBody(request));
      const receipt = await storeRpc(env, fetchImpl, 'mission_catalog_source_command', { p_actor: actor, ...args }, rpcTimeoutMs);
      if (!isObject(receipt) || receipt.ok !== true || !Number.isInteger(receipt.revision)) throw refusal(503, 'storage_unavailable');
      return respond({ ok: true, receipt });
    }

    throw refusal(404, 'not_route');
  } catch (error) {
    return refuse(error);
  }
}
