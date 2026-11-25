// The in-process MISSION SOURCES plane: the REAL Worker route /v1/mission-sources (workers/mccluster/src/mission-sources.js,
// unchanged and unwrapped) over the REAL pending SQL in PGlite (supabase/tests/mission_catalog_sources.stub.sql, the publish
// of one Drawdown mission, then supabase/pending/20261119140000_mission_catalog_sources_v1.sql unless `apply` is false),
// never applied anywhere else. For scripts/test/mission-sources-owner.integration.mjs and the Control Room card's browser
// proof scripts/e2e/control-mission-sources.e2e.mjs. Never connects to canonical Supabase, Cloudflare or any network.
//
//   const plane = await createMissionSourcesPlane();               // PGLITE_MODULE must point at PGlite's dist/index.js
//   const r = await plane.call('owner', 'GET', '/v1/mission-sources');   // { status, body, headers }
//   plane.faults.add({ method: 'POST', path: '/v1/mission-sources/commands', mode: 'drop' });  // committed, answer lost
//   await plane.attach(browserContext);                            // Playwright: the plane answers https://api.mccluster.org/v1/mission-sources*
//   await plane.applyForward(); await plane.rollback();            // the pending file and its rollback, as the owner would apply them
//   await plane.close();
//
// WHAT IS REAL: the Worker route and everything it imports; the SQL, with its grants, policies, checks, the two functions'
// house-owner checks, revisions, keys and the control_audit rows.
// WHAT IS EMULATED, and nothing more: PostgREST and the session check, exactly as the League plane emulates them
// (./eup-league-plane.mjs, reused unchanged: RPCs bound by argument name and declared type, a missing function 404
// PGRST202, a raised SQLSTATE its code with PostgREST's status, the role from the key; a token -> account map; and
// requireHouseOwner reading this database's orgs and org_members as index.js reads PostgREST). Accounts (the stub's ids):
// owner is the house owner; staff and viewer are house members who are not the owner; member is signed in and in no
// house role. Faults: 'drop' serves and commits the request, then fails the connection; 'refuse' fails it before the
// plane sees it. One PGlite session: requests are served one after another (races are the native proof's).
import { readFile } from 'node:fs/promises';
import { createLeaguePlane } from './eup-league-plane.mjs';
import { stubSql, forwardSql, rollbackSql, OWNER, STAFF, VIEWER, MEMBER, DRAWDOWN_MISSIONS } from './mission-catalog-sources-database.mjs';
import { handleMissionSources, MISSION_SOURCES_PREFIX } from '../../../workers/mccluster/src/mission-sources.js';
import { corsHeaders } from '../../../workers/mccluster/src/lib/http.js';

export { OWNER, STAFF, VIEWER, MEMBER, MISSION_SOURCES_PREFIX };
export const API_ORIGIN = 'https://api.mccluster.org';
export const PAGE_ORIGIN = 'https://matthew.mccluster.org';

export async function createMissionSourcesPlane({ apply = true, publish = true } = {}) {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(await stubSql());
  if (publish) await db.exec(`update public.action_missions set status = 'open' where id = '${DRAWDOWN_MISSIONS[0]}'`);
  if (apply) await db.exec(await forwardSql());
  const league = await createLeaguePlane({ database: { db, close: () => db.close() } });
  /* the stub's accounts by name: owner and member are League plane accounts with the same ids; staff is its "peer" id;
     the viewer is signed in here */
  const tokens = { owner: league.token('owner'), staff: league.token('peer'), member: league.token('outsider'), viewer: league.signIn(VIEWER, { name: 'viewer' }) };
  const token = (as) => {
    if (as && typeof as === 'object' && typeof as.token === 'string') return as.token;
    if (Object.hasOwn(tokens, as)) return tokens[as];
    throw new TypeError(`mission sources plane: unknown account ${JSON.stringify(as)}`);
  };
  const log = [];
  const owns = (href) => {
    try {
      const u = new URL(typeof href === 'string' ? href : href.href ?? String(href));
      return u.origin === API_ORIGIN && (u.pathname === MISSION_SOURCES_PREFIX || u.pathname.startsWith(`${MISSION_SOURCES_PREFIX}/`));
    } catch { return false; }
  };
  const faultList = [];
  const faults = {
    add({ method = null, path = null, mode = 'drop', times = 1 } = {}) {
      if (!['drop', 'refuse'].includes(mode)) throw new TypeError('fault mode is drop or refuse');
      const fault = { method, path, mode, times, hits: 0 };
      faultList.push(fault);
      return { get hits() { return fault.hits; } };
    },
    clear() { faultList.length = 0; }
  };
  function takeFault(request, url) {
    for (const f of faultList) {
      if (f.times <= 0 || (f.method && f.method !== request.method)) continue;
      if (typeof f.path === 'string' && f.path !== url.pathname) continue;
      f.times -= 1; f.hits += 1;
      return f;
    }
    return null;
  }
  /* the house-owner check the route gets; tests may replace it (a deliberately broken check, to prove the SQL's own) */
  let requireHouseOwner = league.requireHouseOwner;
  async function handle(request) {
    const url = new URL(request.url);
    if (!owns(url)) throw new TypeError(`mission sources plane: ${url.origin}${url.pathname} is not served by the plane`);
    const entry = { method: request.method, path: url.pathname + url.search, status: null, fault: null };
    log.push(entry);
    if (request.method === 'OPTIONS') { entry.status = 204; return new Response(null, { status: 204, headers: corsHeaders(request, league.env) }); }
    const fault = takeFault(request, url);
    entry.fault = fault?.mode ?? null;
    if (fault?.mode === 'refuse') throw Object.assign(new TypeError('fetch failed (mission sources plane fault: refuse)'), { planeFault: 'refuse' });
    const response = await handleMissionSources(request, league.env, { requireHouseOwner, fetchImpl: league.workerFetch });
    entry.status = response.status;
    if (fault?.mode === 'drop') { await response.arrayBuffer().catch(() => {}); throw Object.assign(new TypeError('fetch failed (mission sources plane fault: drop)'), { planeFault: 'drop' }); }
    return response;
  }
  async function call(as, method, path, body, { headers = {}, raw } = {}) {
    const init = { method, headers: { origin: PAGE_ORIGIN, ...(as === null || as === undefined ? {} : { authorization: `Bearer ${token(as)}` }), ...headers } };
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) init.body = JSON.stringify(body);
    if (init.body !== undefined && !Object.keys(init.headers).some((h) => h.toLowerCase() === 'content-type')) init.headers['content-type'] = 'application/json';
    const response = await handle(new Request(new URL(path, API_ORIGIN), init));
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed, text, headers: response.headers };
  }
  const DROP = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade']);
  async function route(pwRoute) {
    const req = pwRoute.request();
    if (!owns(req.url())) return pwRoute.fallback();
    const method = req.method();
    const headers = Object.fromEntries(Object.entries(await req.allHeaders()).filter(([k]) => !k.startsWith(':') && !DROP.has(k.toLowerCase())));
    const body = method === 'GET' || method === 'HEAD' ? undefined : (req.postDataBuffer() ?? undefined);
    try {
      const response = await handle(new Request(req.url(), { method, headers, body }));
      await pwRoute.fulfill({ status: response.status, headers: Object.fromEntries(response.headers.entries()), body: Buffer.from(await response.arrayBuffer()) });
    } catch (error) {
      await pwRoute.abort(error?.planeFault === 'drop' ? 'connectionreset' : 'failed').catch(() => {});
    }
  }
  return {
    api: API_ORIGIN, db, league, log, rpcLog: league.rpcLog, faults, handle, call, owns,
    accounts: { owner: OWNER, staff: STAFF, viewer: VIEWER, member: MEMBER },
    token, session: (as) => league.session({ token: token(as) }), sessionScript: (as) => league.sessionScript({ token: token(as) }),
    setOwnerCheck(fn) { requireHouseOwner = fn; },
    /* PostgREST reloads its schema cache after DDL; the plane forgets the functions it bound */
    reloadSchema: () => league.reloadSchema(),
    async applyForward() { await db.exec(await forwardSql()); league.reloadSchema(); },
    async rollback() { await db.exec(await rollbackSql()); league.reloadSchema(); },
    attach: async (target) => { const predicate = (u) => owns(u); await target.route(predicate, route); return () => target.unroute(predicate, route); },
    audits: async () => (await db.query("select count(*)::int as n from public.control_audit where event like 'mission_source.%'")).rows[0].n,
    source: async () => (await db.query("select catalog, state, revision, role_line, facts, facts_read_on::text as facts_read_on from public.mission_catalog_sources where catalog = 'drawdown'")).rows[0] || null,
    close: () => league.close()
  };
}
export const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
