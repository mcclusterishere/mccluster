// The in-process environment OWNER plane (E=UP event timeline slice S2, 2026-11-19): the REAL Worker router for /v1/eup
// (workers/mccluster/src/eup/router.js handleEup, with the owner routes of workers/mccluster/src/eup/environment/owner.js,
// unchanged and unwrapped) over the REAL SQL in PGlite: the applied module policy
// (supabase/migrations/20261117144103_eup_module_policy_v1.sql) and, unless `apply` is false, the five PENDING store parts
// (supabase/pending/20261119100000_eup_environment_events_v1_01.sql to _05.sql), never applied anywhere else. It is the local
// stand-in for "staging" (decision D1, default adopted pending Matthew's confirmation): none exists, and creating one is his
// call. Never connects to canonical Supabase, Cloudflare or any network.
//
//   const plane = await createEnvironmentOwnerPlane();             // PGLITE_MODULE must point at PGlite's dist/index.js
//   const r = await plane.call('owner', 'GET', '/v1/eup/environment/health');   // { status, body, headers }
//   await plane.store.ingest([usgsEvent({...})]);                   // a write the page does not make (the ingest is a later slice)
//   await plane.install(); await plane.enable();                    // the module policy, as the owner's Control would set it
//   plane.providers = 'rows' | 'empty' | 'down'; plane.down.add('eonet.gsfc.nasa.gov');
//   plane.faults.add({ method: 'POST', path: '/v1/eup/environment/commands', mode: 'drop' });  // committed, answer lost
//   await plane.attach(browserContext);                             // Playwright: the plane answers https://api.mccluster.org/v1/eup/*
//   await plane.close();
//
// WHAT IS REAL: the Worker router and everything it imports (the owner check's caller, owner.js, modules.js, the public
// routes' own code that the live check reads through), and the SQL with its functions, grants, owner checks, revisions,
// keys and logs.
// WHAT IS EMULATED, and nothing more:
//   1. PostgREST and the session check: the League plane's emulation (./eup-league-plane.mjs, reused unchanged): RPCs bound
//      by argument name and declared type (a misnamed argument is PGRST202), a missing function 404 PGRST202, a raised
//      SQLSTATE its code with PostgREST's status, the role from the key; a token -> account map for the session, and
//      requireHouseOwner reading this database's orgs and org_members as index.js reads PostgREST. Accounts: owner and
//      reviewer are house owners, peer is a plain member, tester and outsider are signed in and belong to nothing.
//   2. The providers: small built answers (labelled as built) for USGS (one M5.2 quake), NOAA NWS (no alert), NOAA NHC (no
//      storm), NIFC WFIGS (no perimeter), NASA EONET (one wildfire) and NOAA CO-OPS (stations and readings); 'empty' answers
//      nothing from each, 'down' fails each at the network level; a host in plane.down fails alone. FIRMS is never asked: the
//      plane's Worker has no FIRMS_MAP_KEY, as a Worker without the secret has none.
//   3. The Worker entry: only an OPTIONS preflight (204 with the Worker's CORS headers) and the /v1/eup dispatch.
//   4. Faults: 'drop' serves and commits the request, then fails the connection (the page sees a network error);
//      'refuse' fails it before the plane sees it.
import { createLeaguePlane } from './eup-league-plane.mjs';
import { createEnvironmentStoreDatabase, usgsEvent, DEFAULT_USGS_RULE, OWNER, PEER, SECOND_OWNER } from './eup-environment-database.mjs';
import { installModule, enableModule, setModuleState, disableModule } from './eup-module-policy-database.mjs';
import { handleEup, EUP_PREFIX } from '../../../workers/mccluster/src/eup/router.js';
import { corsHeaders } from '../../../workers/mccluster/src/lib/http.js';

export { usgsEvent, DEFAULT_USGS_RULE, OWNER, PEER, SECOND_OWNER };
export const API_ORIGIN = 'https://api.mccluster.org';
export const PAGE_ORIGIN = 'https://matthew.mccluster.org';
export const ENVIRONMENT_PREFIX = `${EUP_PREFIX}/environment`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/* the providers' small built answers: one quake, one natural event, no alert, no storm, no perimeter, two stations */
const HOSTS = Object.freeze(['earthquake.usgs.gov', 'api.weather.gov', 'www.nhc.noaa.gov', 'services3.arcgis.com', 'eonet.gsfc.nasa.gov', 'api.tidesandcurrents.noaa.gov']);
function providerAnswer(url, mode, down) {
  if (mode === 'down' || down.has(url.hostname)) throw new TypeError('provider unreachable');
  const empty = mode === 'empty', now = Date.now();
  switch (url.hostname) {
    case 'earthquake.usgs.gov': return json({ metadata: { generated: now }, features: empty ? [] : [{ id: 'usowner01', geometry: { coordinates: [142.1, 38.3, 10] },
      properties: { place: '40 km E of a built test place', time: now - 1800e3, mag: 5.2, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/usowner01' } }] });
    case 'api.weather.gov': return json({ features: [] });
    case 'www.nhc.noaa.gov': return json({ activeStorms: [] });
    case 'services3.arcgis.com': return json({ features: [] });
    case 'eonet.gsfc.nasa.gov': return json({ events: empty ? [] : [{ id: 'EONET_OWNER_1', title: 'Owner plane wildfire, built for the test', categories: [{ id: 'wildfires', title: 'Wildfires' }],
      sources: [{ id: 'InciWeb', url: 'https://inciweb.wildfire.gov/' }], geometry: [{ type: 'Point', coordinates: [-120.5, 38.2], date: new Date(now - 3600e3).toISOString() }] }] });
    case 'api.tidesandcurrents.noaa.gov':
      if (url.pathname.includes('/mdapi/')) return json({ count: empty ? 0 : 1, stations: empty ? [] : [{ id: '8443970', name: 'Boston', lat: 42.3539, lng: -71.0503, state: 'MA', tidal: true, greatlakes: false }] });
      if (empty) return json({ error: { message: 'No data was found.' } });
      return json({ metadata: { id: url.searchParams.get('station') || '8443970', name: 'Built station', lat: '42.3539', lon: '-71.0503' }, data: [{ t: new Date(now - 600e3).toISOString().slice(0, 16).replace('T', ' '), v: '1.234', s: '0.003', f: '0,0,0,0', q: 'p' }] });
    default: throw new Error('the owner plane answers no other provider: ' + url.href);
  }
}

export async function createEnvironmentOwnerPlane({ apply = true } = {}) {
  const store = await createEnvironmentStoreDatabase({ apply });
  const league = await createLeaguePlane({ database: { db: store.db, close: () => store.close() } });
  const log = []; // { method, path, as, status, fault } per request the plane answered
  const plane = {
    api: API_ORIGIN, accounts: league.accounts, store, db: store.db, env: league.env, log, rpcLog: league.rpcLog,
    providers: 'rows', down: new Set(), providerCalls: [],
    install: () => installModule(store.db, 'environment', OWNER),
    enable: () => enableModule(store.db, 'environment', OWNER),
    drain: () => setModuleState(store.db, 'environment', 'draining', OWNER),
    disable: () => disableModule(store.db, 'environment', OWNER)
  };
  /* what the Worker gets as fetchImpl: the store's PostgREST, or a provider's built answer. The League plane's fetch applies the
     Worker runtime's rules, `this` included, so it is called unbound, as the Worker calls fetch. */
  const storeFetch = league.workerFetch;
  async function fetchImpl(input, init = {}) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === league.supabase) return storeFetch(input, init);
    plane.providerCalls.push(url.hostname);
    return providerAnswer(url, plane.providers, plane.down);
  }
  const owns = (href) => { try { const u = new URL(typeof href === 'string' ? href : href.href ?? String(href)); return u.origin === API_ORIGIN && (u.pathname === EUP_PREFIX || u.pathname.startsWith(`${EUP_PREFIX}/`)); } catch { return false; } };
  const faultList = [];
  plane.faults = {
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
      if (f.path instanceof RegExp && !f.path.test(url.pathname + url.search)) continue;
      f.times -= 1; f.hits += 1;
      return f;
    }
    return null;
  }
  /* handle(request): what the network would answer a page or a caller */
  async function handle(request) {
    const url = new URL(request.url);
    if (!owns(url)) throw new TypeError(`environment owner plane: ${url.origin}${url.pathname} is not served by the plane`);
    const entry = { method: request.method, path: url.pathname + url.search, status: null, fault: null };
    log.push(entry);
    if (request.method === 'OPTIONS') { entry.status = 204; return new Response(null, { status: 204, headers: corsHeaders(request, league.env) }); }
    const fault = takeFault(request, url);
    entry.fault = fault?.mode ?? null;
    if (fault?.mode === 'refuse') throw Object.assign(new TypeError('fetch failed (owner plane fault: refuse)'), { planeFault: 'refuse' });
    const response = await handleEup(request, league.env, { requireHouseOwner: league.requireHouseOwner, authUser: league.authUser, fetchImpl, now: Date.now });
    entry.status = response.status;
    if (fault?.mode === 'drop') { await response.arrayBuffer().catch(() => {}); throw Object.assign(new TypeError('fetch failed (owner plane fault: drop)'), { planeFault: 'drop' }); }
    return response;
  }
  plane.handle = handle;
  plane.owns = owns;
  /* call(as, method, path, body): one JSON request as a named account (null: no bearer) */
  plane.call = async (as, method, path, body, { headers = {} } = {}) => {
    const init = { method, headers: { origin: PAGE_ORIGIN, ...(as === null || as === undefined ? {} : { authorization: `Bearer ${league.token(as)}` }), ...headers } };
    if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); if (!Object.keys(init.headers).some((h) => h.toLowerCase() === 'content-type')) init.headers['content-type'] = 'application/json'; }
    const response = await handle(new Request(new URL(path, API_ORIGIN), init));
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed, headers: response.headers };
  };
  /* Playwright: one route whose predicate is owns(url); register it AFTER the test's own catch-all route so it wins */
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
  plane.attach = async (target) => { const predicate = (u) => owns(u); await target.route(predicate, route); return () => target.unroute(predicate, route); };
  plane.session = (as) => league.session(as);
  plane.sessionScript = (as) => league.sessionScript(as);
  plane.token = (as) => league.token(as);
  /* PostgREST reloads its schema cache after DDL; call this after applying or rolling back the store parts */
  plane.reloadSchema = () => league.reloadSchema();
  plane.close = () => league.close();
  return plane;
}
