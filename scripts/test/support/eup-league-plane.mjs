// The in-process League plane: the REAL Worker router over the REAL pending SQL, for tests and browsers.
// Never connects to canonical Supabase, Cloudflare or any network: every URL it serves ends in .invalid or is the
// API origin a page already calls, and both are answered in this process.
//
//   const plane = await createLeaguePlane();              // PGLITE_MODULE must point at PGlite's dist/index.js
//   const r = await plane.call('tester', 'GET', '/v1/eup/member/league');   // { status, body, headers, response }
//   const res = await plane.handle(new Request(url, init)); // any request a page would send (API or storage)
//   await plane.attach(browserContextOrPage);              // Playwright: the plane answers its own URLs
//   await plane.close();
//
// WHAT IS REAL (the code under test, unchanged and unwrapped):
//   - workers/mccluster/src/eup/router.js handleEup and everything it imports: the owner routes (league.js), the
//     member branch (league-member.js), the media module (league-media.js), modules.js, overview.js, the contract.
//   - The pending SQL: supabase/pending/eup_module_policy_v1.sql then eup_league_v1.sql, in PGlite, with Supabase-style
//     API roles and default privileges (scripts/test/support/eup-league-database.mjs builds it). Every RPC runs as the
//     role its key names (service_role for the Worker) in its own transaction, exactly once.
// WHAT IS EMULATED (and nothing more):
//   1. PostgREST, as far as the Worker uses it (EMULATED.postgrest below): POST /rest/v1/rpc/<name> with a JSON object
//      of named arguments. The function is found by name in schema public and by the set of argument names sent
//      (404 PGRST202 when none matches, 300 PGRST203 when several do), the arguments are bound BY NAME through
//      json_to_record with the declared parameter types (a misnamed argument is a PGRST202, as in PostgREST, not a
//      silently dropped value), the result is the function's value as JSON, and an exception answers
//      { code, message, details, hint } with PostgREST's SQLSTATE -> HTTP status table. The key decides the role:
//      the service key runs service_role; the anon key runs anon; the anon key with a plane session bearer runs
//      authenticated with request.jwt.claims { sub, role }. Any other key is 401. Table paths: GET
//      /rest/v1/<table>?select=<columns>&limit=<n> only (no filters), as the same role, so a probe sees the real
//      grants; a table that does not exist answers 404 PGRST205. Not emulated: GET RPCs, Prefer headers, filters,
//      embedding, the 8 s statement_timeout of the API role, schema-cache reload on NOTIFY (reloadSchema() instead).
//   2. The session check: a token -> account map (signIn / token / session) in place of GoTrue's /auth/v1/user.
//      authUser mirrors workers/mccluster/src/index.js (no "Bearer " prefix is null; an unknown token is null).
//      requireHouseOwner mirrors index.js too (401 without a user, 503 without the house organisation, 403 unless an
//      owner membership exists) and reads the plane's own public.orgs / public.org_members rows.
//   3. The Worker entry: only what index.js does for /v1/eup before handleEup (OPTIONS answers 204 with the Worker's
//      corsHeaders; nothing else of index.js runs).
//   4. Storage: the media lane's double, workers/mccluster/test/support/eup-league-storage-double.mjs, unchanged (its
//      header says what it models; it was not compared with real storage). Calls a browser makes to it (the grant PUT,
//      a signed read, any probe) also get CORS headers: allow-origin * and a preflight answer. The Worker's own calls
//      go through asWorkerFetch, which applies the Worker runtime's fetch rules.
//   5. Time is the real clock for the Worker, the SQL and the storage tokens alike.
//   6. PGlite is ONE session: concurrent requests are served, but their RPCs run one after another. Lock order and
//      races are proven by scripts/test/eup-league.native.integration.mjs, never by this plane.
//
// FAULTS, for "the write committed but the answer never arrived": plane.faults.add({ method, path, as, mode }) where
// mode is 'drop' (the request is served and committed, then the connection fails), 'hang' (served and committed, the
// answer is never delivered; a Playwright route stays open until close()), or 'refuse' (the connection fails before
// the plane sees the request: nothing is served). match by method, by path (string = exact pathname, RegExp = tested
// on pathname + search) and by account name, or pass match: (request, url) => boolean. times defaults to 1.
//
// BROWSERS (Playwright): plane.attach(contextOrPage) registers one route whose URL predicate is plane.owns(url), so
// URLs that are not the plane's (static files, /v1/status, auth) fall through to the test's own routes. A page sends
// its own Authorization header: put plane.session(name) into localStorage 'mccdb_session' (see sessionScript()).
// The page's API origin is https://api.mccluster.org (js/control-room/eup.js); grants and signed reads point at
// plane.supabase (https://league-plane.invalid), which the same route answers.
import { randomBytes } from 'node:crypto';
import { handleEup, EUP_PREFIX } from '../../../workers/mccluster/src/eup/router.js';
import { corsHeaders } from '../../../workers/mccluster/src/lib/http.js';
import * as C from '../../../workers/mccluster/src/eup/league-contract.js';
import { createLeagueStorageDouble, asWorkerFetch } from '../../../workers/mccluster/test/support/eup-league-storage-double.mjs';
import { asServiceRole } from './eup-module-policy-database.mjs';
import { createLeagueDatabase, OWNER, PEER, REVIEWER, TESTER, TESTER_B, OUTSIDER, OTHER_ORG_OWNER, UNKNOWN, RIGHTS } from './eup-league-database.mjs';

export { OWNER, PEER, REVIEWER, TESTER, TESTER_B, OUTSIDER, OTHER_ORG_OWNER, UNKNOWN, RIGHTS };

/* The accounts the database harness creates, by the name tests and pages use. owner and reviewer are house owners;
   tester is meant for campaign A and tester_b for campaign B (grants are the test's to make); peer is a plain member
   of the house organisation; outsider is signed in and invited nowhere; other_org_owner owns another organisation. */
export const ACCOUNTS = Object.freeze({ owner: OWNER, reviewer: REVIEWER, tester: TESTER, tester_b: TESTER_B, peer: PEER, outsider: OUTSIDER, other_org_owner: OTHER_ORG_OWNER });
export const API_ORIGIN = 'https://api.mccluster.org';
export const SUPABASE_ORIGIN = 'https://league-plane.invalid';
export const PAGE_ORIGIN = 'https://matthew.mccluster.org'; // the Origin header plane.call sends; one of the Worker's default origins
const SERVICE_KEY = 'league-plane-service-key-not-a-secret';
const ANON_KEY = 'league-plane-anon-key-not-a-secret';

/* A League policy with clearly synthetic values, for pages and seeds that need one. The values are TEST FIXTURES, not
   defaults and not policy (DECISIONS D3: code ships no business value); every notice says so in its own text. */
const notice = (id) => ({ revision: `plane-${id}-1`, text: `TEST FIXTURE ${id} notice of the in-process League plane. Not real policy text.\nIt exists so a test can show and accept a notice.` });
export const PLANE_POLICY = Object.freeze({
  entitlement: 'none_required',
  media: { enabled: true, kinds: ['audio', 'video'], audio_max_bytes: 8388608, video_max_bytes: 33554432, max_duration_seconds: 300 },
  retention: { completed_days: 30, withdrawn_days: 7 },
  notices: { participation: notice('participation'), private_review: notice('private-review'), publication: notice('publication') }
});

/* Exactly what the plane stands in for, as data a report can print. */
export const EMULATED = Object.freeze({
  postgrest: 'POST /rest/v1/rpc/<name> by named arguments (PGRST202/PGRST203, SQLSTATE -> HTTP status, { code, message, details, hint }); GET /rest/v1/<table>?select=&limit= without filters (PGRST205 for a missing table); role from the key: service_role, anon, authenticated',
  session: 'token -> account map in place of /auth/v1/user; requireHouseOwner reads the plane database as index.js reads PostgREST',
  entry: 'index.js OPTIONS preflight (204 + corsHeaders) and the /v1/eup dispatch only',
  storage: 'workers/mccluster/test/support/eup-league-storage-double.mjs, unchanged; browser-facing answers add CORS (allow-origin *)',
  clock: 'real time everywhere',
  concurrency: 'one PGlite session: RPCs are serialised; races are proven natively, not here'
});

/* PostgREST's answer status for a SQLSTATE (its documented table). 42501 is 401 for the anonymous role, 403 otherwise. */
export function postgrestStatus(code, role = 'service_role') {
  const c = String(code || '');
  if (c === '42501') return role === 'anon' ? 401 : 403;
  if (c === '23503' || c === '23505') return 409;
  if (c === '25006') return 405;
  if (c === '42883' || c === '42P01') return 404;
  if (c === '53400' || c === '42P17') return 500;
  if (c.startsWith('08') || c.startsWith('53')) return 503;
  if (c.startsWith('0L') || c.startsWith('0P') || c.startsWith('28')) return 403;
  if (['09', '25', '2D', '38', '39', '3B', '40', '54', '55', '57', '58', 'F0', 'HV', 'XX'].some((p) => c.startsWith(p))) return 500;
  return 400; // P0001, P0*, 22*, and every code PostgREST does not list (EU*, EUM*)
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const quote = (name) => `"${name}"`;
const pgrst = (status, code, message, extra = {}) => Response.json({ code, details: null, hint: null, message, ...extra }, { status });
const base64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64').replace(/=+$/, '');
const decodeToken = (token) => { try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64').toString('utf8')); } catch { return null; } };

export async function createLeaguePlane({
  enable = true, database = null, apiOrigin = API_ORIGIN, supabaseOrigin = SUPABASE_ORIGIN, allowedOrigins = [], rpcTimeoutMs, now = Date.now
} = {}) {
  const league = database || await createLeagueDatabase({ enable });
  const { db } = league;
  const env = Object.freeze({ SUPABASE_URL: supabaseOrigin, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY, ALLOWED_ORIGINS: allowedOrigins.join(',') });
  const storage = createLeagueStorageDouble({ origin: supabaseOrigin, serviceKey: SERVICE_KEY, now });
  const log = []; // every request the plane answered: { method, path, as, status, fault } (no token, no body)
  const rpcLog = []; // every RPC: { name, role, action, actor, id, status, code }
  const pending = new Set(); // rejecters of 'hang' faults, released by close()

  /* ---------------------------------------------------------------- sessions */
  const sessions = new Map(); // token -> { id, email, name }
  const named = new Map(); // name -> token
  function signIn(account, { email, name = null } = {}) {
    if (typeof account !== 'string' || !C.PATTERNS.uuid.test(account)) throw new TypeError('signIn: an account uuid is required');
    const exp = Math.floor(now() / 1000) + 86400;
    const id = account.toLowerCase();
    const mail = email || `${name || id.slice(0, 8)}@plane.invalid`;
    const token = `plane.${base64({ sub: id, email: mail, role: 'authenticated', exp })}.${randomBytes(18).toString('base64url')}`;
    sessions.set(token, { id, email: mail, name });
    return token;
  }
  for (const [name, id] of Object.entries(ACCOUNTS)) named.set(name, signIn(id, { name }));
  const token = (as) => {
    if (as && typeof as === 'object' && typeof as.token === 'string') return as.token;
    if (named.has(as)) return named.get(as);
    throw new TypeError(`league plane: unknown account name ${JSON.stringify(as)}`);
  };
  const nameOf = (bearer) => sessions.get(bearer)?.name ?? (sessions.has(bearer) ? 'signed-in' : null);
  /* The site's session record (localStorage 'mccdb_session'), as js/backend.js reads it. */
  function session(as) {
    const t = token(as);
    const claims = decodeToken(t);
    return { access_token: t, refresh_token: 'plane-fixture-only', expires_at: claims.exp, user: { id: claims.sub, email: claims.email } };
  }
  /* A Playwright init script that stores that session before any page script runs. */
  const sessionScript = (as) => ({ content: `try{localStorage.setItem('mccdb_session',${JSON.stringify(JSON.stringify(session(as)))})}catch(e){}` });

  /* index.js authUser: no "bearer " prefix is null; the token map stands in for /auth/v1/user. */
  async function authUser(request) {
    const authorization = request.headers.get('authorization') || '';
    if (!authorization.toLowerCase().startsWith('bearer ')) return null;
    const user = sessions.get(authorization.slice(7));
    return user ? { id: user.id, email: user.email } : null;
  }
  /* index.js requireHouseOwner, reading the plane's own orgs / org_members rows. */
  async function requireHouseOwner(request) {
    const user = await authUser(request);
    if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
    const house = (await db.query("select id from public.orgs where slug = 'mccluster' limit 1")).rows[0];
    if (!house) throw Object.assign(new Error('McCluster house organization is not configured'), { status: 503 });
    const member = (await db.query("select 1 from public.org_members where org_id = $1 and profile_id = $2 and role = 'owner' limit 1", [house.id, user.id])).rows[0];
    if (!member) throw Object.assign(new Error('McCluster house owner access required'), { status: 403 });
    return user;
  }

  /* ---------------------------------------------------------------- PostgREST */
  const signatures = new Map();
  async function functionsNamed(name) {
    if (!signatures.has(name)) {
      const rows = (await db.query(`select p.proretset as retset, p.prorettype::regtype::text as ret, p.pronargdefaults as defaults,
          coalesce(p.proargnames, '{}'::text[]) as names, coalesce(p.proargmodes::text[], '{}'::text[]) as modes,
          (select array_agg(format_type(t, null) order by i) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality as x(t, i)) as types
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1 and p.prokind = 'f'`, [name])).rows;
      signatures.set(name, rows.map((r) => {
        const inputs = [];
        (r.types || []).forEach((type, i) => { if (!r.modes.length || ['i', 'b', 'v'].includes(r.modes[i])) inputs.push({ name: r.names[i], type }); });
        return { retset: r.retset, ret: r.ret, inputs, required: inputs.slice(0, inputs.length - r.defaults).map((a) => a.name) };
      }));
    }
    return signatures.get(name);
  }
  function roleOf(headers) {
    const apikey = headers.get('apikey');
    const bearer = (headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (apikey === SERVICE_KEY && (!bearer || bearer === SERVICE_KEY)) return { role: 'service_role', claims: { role: 'service_role' } };
    if (apikey === ANON_KEY && (!bearer || bearer === ANON_KEY)) return { role: 'anon', claims: { role: 'anon' } };
    if (apikey === ANON_KEY && sessions.has(bearer)) return { role: 'authenticated', claims: { sub: sessions.get(bearer).id, role: 'authenticated' } };
    return null;
  }
  const asRole = (who, work) => (who.role === 'service_role' ? asServiceRole(db, work) : db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who.claims)]);
    await tx.exec(`set local role ${who.role}`);
    return work(tx);
  }));
  const failure = (error, role) => {
    const code = typeof error?.code === 'string' ? error.code : 'XX000';
    return Response.json({ code, details: error?.detail ?? null, hint: error?.hint ?? null, message: error?.message ?? 'error' }, { status: postgrestStatus(code, role) });
  };
  async function rpc(name, who, text) {
    const entry = { name, role: who.role, action: null, actor: null, id: null, status: null, code: null };
    rpcLog.push(entry);
    let args;
    try { args = text ? JSON.parse(text) : {}; } catch { args = undefined; }
    if (!args || typeof args !== 'object' || Array.isArray(args)) { entry.status = 400; entry.code = 'PGRST102'; return pgrst(400, 'PGRST102', 'Empty or invalid json'); }
    Object.assign(entry, { action: args.p_action ?? null, actor: args.p_actor ?? null, id: args.p_id ?? args.p_upload ?? null });
    const keys = Object.keys(args);
    const candidates = IDENT.test(name) ? await functionsNamed(name) : [];
    const matches = candidates.filter((f) => keys.every((k) => f.inputs.some((a) => a.name === k)) && f.required.every((r) => keys.includes(r)));
    if (matches.length !== 1) {
      const code = matches.length ? 'PGRST203' : 'PGRST202';
      entry.status = matches.length ? 300 : 404; entry.code = code;
      return pgrst(entry.status, code, matches.length ? `Could not choose the best candidate function between several for public.${name}`
        : `Could not find the function public.${name}(${[...keys].sort().join(', ')}) in the schema cache`);
    }
    const fn = matches[0];
    const used = fn.inputs.filter((a) => keys.includes(a.name));
    if (!used.every((a) => IDENT.test(a.name))) { entry.status = 404; entry.code = 'PGRST202'; return pgrst(404, 'PGRST202', `Could not find the function public.${name}`); }
    const call = `public.${quote(name)}(${used.map((a) => `${quote(a.name)} := _.${quote(a.name)}`).join(', ')})`;
    const from = used.length ? ` from json_to_record($1::json) as _(${used.map((a) => `${quote(a.name)} ${a.type}`).join(', ')})` : '';
    const select = fn.ret === 'void' ? `select ${call} is null as r${from}`
      : fn.retset ? `select coalesce((select jsonb_agg(to_jsonb(t)) from ${call} t), '[]'::jsonb) as r${from}` : `select to_jsonb(${call}) as r${from}`;
    try {
      const value = await asRole(who, async (tx) => (await tx.query(select, used.length ? [JSON.stringify(args)] : [])).rows[0]?.r);
      entry.status = fn.ret === 'void' ? 204 : 200;
      return fn.ret === 'void' ? new Response(null, { status: 204 }) : new Response(JSON.stringify(value ?? null), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    } catch (error) {
      entry.status = postgrestStatus(error?.code, who.role); entry.code = error?.code ?? null;
      return failure(error, who.role);
    }
  }
  async function table(name, url, who) {
    if (!IDENT.test(name)) return pgrst(404, 'PGRST205', `Could not find the table 'public.${name}' in the schema cache`);
    const exists = (await db.query("select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = $1 and relkind in ('r', 'v', 'm', 'p', 'f')", [name])).rows.length;
    if (!exists) return pgrst(404, 'PGRST205', `Could not find the table 'public.${name}' in the schema cache`);
    const params = [...url.searchParams.keys()].filter((k) => k !== 'select' && k !== 'limit');
    if (params.length) return pgrst(501, 'PLANE501', 'The League plane does not emulate PostgREST filters');
    const columns = (url.searchParams.get('select') || '*').split(',').map((c) => c.trim());
    if (!columns.every((c) => c === '*' || IDENT.test(c))) return pgrst(400, 'PGRST100', 'The League plane accepts plain column names only');
    const limit = /^\d{1,4}$/.test(url.searchParams.get('limit') || '') ? Number(url.searchParams.get('limit')) : 1000;
    const list = columns.map((c) => (c === '*' ? '*' : quote(c))).join(', ');
    try {
      const rows = await asRole(who, async (tx) => (await tx.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as r from (select ${list} from public.${quote(name)} limit ${limit}) t`)).rows[0].r);
      return Response.json(rows);
    } catch (error) {
      return failure(error, who.role);
    }
  }
  async function postgrest(url, method, headers, text) {
    const who = roleOf(headers);
    if (!who) return pgrst(401, 'PGRST301', 'Invalid API key or token');
    const path = url.pathname.slice('/rest/v1/'.length);
    const fn = /^rpc\/([^/]+)$/.exec(path);
    if (fn) {
      if (method !== 'POST') return pgrst(405, 'PLANE405', 'The League plane emulates POST /rest/v1/rpc only');
      return rpc(decodeURIComponent(fn[1]), who, text);
    }
    if (method === 'GET' && /^[^/]+$/.test(path)) return table(decodeURIComponent(path), url, who);
    return pgrst(405, 'PLANE405', 'The League plane emulates table reads only');
  }
  const bodyText = async (input, init) => (typeof init.body === 'string' ? init.body
    : init.body != null ? new Response(init.body).text() : input instanceof Request ? input.clone().text() : '');

  /* What the Worker gets as fetchImpl: storage calls go to the double, /rest/v1 to PostgREST, anything else is a
     network failure (the Worker has no business calling it). asWorkerFetch applies the Worker runtime's fetch rules. */
  const workerFetch = asWorkerFetch(async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (storage.handles(url.href)) return storage.fetch(input, init);
    if (url.origin === supabaseOrigin && url.pathname.startsWith('/rest/v1/')) {
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      return postgrest(url, String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase(), headers, await bodyText(input, init));
    }
    throw new TypeError(`league plane: the Worker called ${url.origin}${url.pathname}, which the plane does not serve`);
  });

  /* ---------------------------------------------------------------- the surfaces a page reaches */
  const isApi = (u) => u.origin === apiOrigin && (u.pathname === EUP_PREFIX || u.pathname.startsWith(`${EUP_PREFIX}/`));
  const isSupabase = (u) => u.origin === supabaseOrigin && (u.pathname.startsWith('/storage/v1/') || u.pathname.startsWith('/rest/v1/'));
  function owns(href) {
    try { const u = new URL(typeof href === 'string' ? href : href.href ?? String(href)); return isApi(u) || isSupabase(u); } catch { return false; }
  }
  const STORAGE_CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, content-length, content-type, etag, accept-ranges' };
  async function supabaseAnswer(request, url) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: { ...STORAGE_CORS, 'access-control-allow-methods': 'GET, HEAD, PUT, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, apikey, content-type, x-upsert, x-client-info, range, cache-control', 'access-control-max-age': '600' } });
    }
    const answer = url.pathname.startsWith('/rest/v1/')
      ? await postgrest(url, request.method, request.headers, request.method === 'GET' || request.method === 'HEAD' ? '' : await request.clone().text())
      : await storage.fetch(request);
    const headers = new Headers(answer.headers);
    for (const [k, v] of Object.entries(STORAGE_CORS)) headers.set(k, v);
    return new Response(answer.body, { status: answer.status, headers });
  }
  async function workerAnswer(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    return handleEup(request, env, { requireHouseOwner, authUser, fetchImpl: workerFetch, now, rpcTimeoutMs });
  }

  /* ---------------------------------------------------------------- faults */
  const faultList = [];
  const faults = {
    add({ method = null, path = null, as = null, match = null, mode = 'drop', times = 1 } = {}) {
      if (!['drop', 'hang', 'refuse'].includes(mode)) throw new TypeError('fault mode is drop, hang or refuse');
      const fault = { method, path, as, match, mode, times, hits: 0 };
      faultList.push(fault);
      return { get hits() { return fault.hits; }, off() { const i = faultList.indexOf(fault); if (i >= 0) faultList.splice(i, 1); } };
    },
    clear() { faultList.length = 0; }
  };
  function takeFault(request, url) {
    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    for (const fault of faultList) {
      if (fault.times <= 0) continue;
      if (fault.method && fault.method !== request.method) continue;
      if (typeof fault.path === 'string' && fault.path !== url.pathname) continue;
      if (fault.path instanceof RegExp && !fault.path.test(url.pathname + url.search)) continue;
      if (fault.as && token(fault.as) !== bearer) continue;
      if (typeof fault.match === 'function' && !fault.match(request, url)) continue;
      fault.times -= 1; fault.hits += 1;
      return fault;
    }
    return null;
  }
  const lost = (mode) => Object.assign(new TypeError(`fetch failed (league plane fault: ${mode})`), { planeFault: mode });

  /* handle(request): what the network would answer a page. */
  async function handle(request) {
    if (!(request instanceof Request)) throw new TypeError('handle takes a Request');
    const url = new URL(request.url);
    if (!owns(url)) throw new TypeError(`league plane: ${url.origin}${url.pathname} is not served by the plane`);
    const entry = { method: request.method, path: url.pathname + url.search, as: nameOf((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')), status: null, fault: null };
    log.push(entry);
    const fault = takeFault(request, url);
    entry.fault = fault?.mode ?? null;
    if (fault?.mode === 'refuse') throw lost('refuse');
    const response = isApi(url) ? await workerAnswer(request) : await supabaseAnswer(request, url);
    entry.status = response.status;
    if (fault?.mode === 'drop') { await response.arrayBuffer().catch(() => {}); throw lost('drop'); }
    if (fault?.mode === 'hang') {
      await response.arrayBuffer().catch(() => {});
      return new Promise((_, reject) => {
        const give = () => { pending.delete(give); reject(lost('hang')); };
        pending.add(give);
        if (request.signal) request.signal.addEventListener('abort', give, { once: true });
      });
    }
    return response;
  }
  const fetchLike = (input, init) => handle(input instanceof Request && init === undefined ? input : new Request(input, init));

  /* call(as, method, path, body, { headers, raw, origin }): one JSON request as a named account (null: no bearer). */
  async function call(as, method, path, body, { headers = {}, raw, origin = PAGE_ORIGIN } = {}) {
    const init = { method, headers: { origin, ...(as === null || as === undefined ? {} : { authorization: `Bearer ${token(as)}` }), ...headers } };
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) init.body = JSON.stringify(body);
    if (init.body !== undefined && !Object.keys(init.headers).some((h) => h.toLowerCase() === 'content-type')) init.headers['content-type'] = 'application/json';
    const response = await handle(new Request(new URL(path, apiOrigin), init));
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed, headers: response.headers, response };
  }

  /* ---------------------------------------------------------------- Playwright */
  const DROP = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade']);
  async function route(pwRoute) {
    const req = pwRoute.request();
    if (!owns(req.url())) return pwRoute.fallback();
    const method = req.method();
    const headers = Object.fromEntries(Object.entries(await req.allHeaders()).filter(([k]) => !k.startsWith(':') && !DROP.has(k.toLowerCase())));
    const body = method === 'GET' || method === 'HEAD' ? undefined : (req.postDataBuffer() ?? undefined);
    try {
      const response = await handle(new Request(req.url(), { method, headers, body }));
      const out = Buffer.from(await response.arrayBuffer());
      await pwRoute.fulfill({ status: response.status, headers: Object.fromEntries(response.headers.entries()), body: out });
    } catch (error) {
      await pwRoute.abort(error?.planeFault === 'refuse' ? 'failed' : error?.planeFault ? 'connectionreset' : 'failed').catch(() => {});
    }
  }
  /* attach(target): target is a Playwright BrowserContext or Page. Returns a function that removes the route. */
  async function attach(target) {
    const predicate = (url) => owns(url);
    await target.route(predicate, route);
    return () => target.unroute(predicate, route);
  }

  /* ---------------------------------------------------------------- seeding (for pages that need a released mission) */
  /* seed(): through the Worker, as the owner: install and enable the module when needed, set the policy when none is
     stored, create a campaign and the song mission FROM THE FIXTURE route, release both, invite, grant. Returns the
     rows the routes answered. Any refusal throws with the route's status and reason. */
  async function seed({ policy = PLANE_POLICY, slug = 'plane-campaign', testers = ['tester'], invited = true, mission = 'write-a-song' } = {}) {
    let n = 0;
    const key = (label) => `plane-seed-${label}-${randomBytes(6).toString('hex')}`;
    const must = async (method, path, body) => {
      n += 1;
      const r = await call('owner', method, path, body);
      if (r.status !== 200 || !r.body?.ok) throw Object.assign(new Error(`league plane seed step ${n} ${method} ${path}: ${r.status} ${r.body?.reason}`), { status: r.status, reason: r.body?.reason });
      return r.body;
    };
    const control = await must('GET', '/v1/eup/modules');
    let unit = control.modules.find((m) => m.moduleId === C.MODULE);
    if (!unit.installed) unit = { state: 'disabled', revision: (await must('POST', `/v1/eup/modules/${C.MODULE}/install`, { idempotency_key: key('install'), reason: 'Plane seed: install the League module.' })).receipt.policy.revision };
    if (unit.state !== 'enabled') await must('POST', `/v1/eup/modules/${C.MODULE}/state`, { idempotency_key: key('enable'), expected_revision: unit.revision, state: 'enabled', reason: 'Plane seed: enable the League module.' });
    let stored = (await must('GET', `${C.PREFIX.owner}/policy`)).policy;
    if (policy && stored.revision === 0) stored = (await must('POST', `${C.PREFIX.owner}/policy`, { idempotency_key: key('policy'), expected_revision: 0, policy, reason: 'Plane seed: synthetic test-fixture policy.' })).policy;
    const fixture = (await must('GET', `${C.PREFIX.owner}/fixture`)).fixture;
    let campaign = (await must('POST', `${C.PREFIX.owner}/campaigns`, { idempotency_key: key('campaign'), campaign: { slug, title: fixture.title, purpose: fixture.purpose } })).campaign;
    const m = fixture.missions.find((x) => x.slug === mission);
    let created = (await must('POST', `${C.PREFIX.owner}/campaigns/${campaign.id}/missions`, { idempotency_key: key('mission'),
      mission: { slug: m.slug, title: m.title, template: m.template, proof_modes: m.proof_modes, requirements: m.requirements, acceptance: m.acceptance } })).mission;
    campaign = (await must('POST', `${C.PREFIX.owner}/campaigns/${campaign.id}/transition`, { idempotency_key: key('release'), expected_revision: campaign.revision, to: 'released' })).campaign;
    created = (await must('POST', `${C.PREFIX.owner}/missions/${created.id}/transition`, { idempotency_key: key('mission-release'), expected_revision: created.revision, to: 'released' })).mission;
    const grants = [];
    if (invited) {
      campaign = (await must('POST', `${C.PREFIX.owner}/campaigns/${campaign.id}/audience`, { idempotency_key: key('audience'), expected_revision: campaign.revision, audience: 'invited' })).campaign;
      for (const name of testers) grants.push((await must('POST', `${C.PREFIX.owner}/campaigns/${campaign.id}/audience/grants`, { idempotency_key: key('grant'), grant: { account: ACCOUNTS[name] ?? name, note: 'Plane seed: test-fixture tester.' } })).grant);
    }
    return { policy: stored, campaign, mission: created, grants };
  }

  async function close() {
    for (const give of [...pending]) give();
    await league.close();
  }

  return {
    api: apiOrigin, supabase: supabaseOrigin, env, accounts: ACCOUNTS, league, db, storage, log, rpcLog, faults,
    anonKey: ANON_KEY, serviceKeyHeaders: () => ({ apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` }),
    handle, fetch: fetchLike, call, owns, route, attach, seed, close,
    token, session, sessionScript, signIn, signOut: (t) => sessions.delete(t),
    workerFetch, authUser, requireHouseOwner, reloadSchema: () => signatures.clear()
  };
}
