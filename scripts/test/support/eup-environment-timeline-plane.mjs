// The in-process environmental TIMELINE plane (E=UP event timeline slice S4, 2026-11-19): the REAL Worker handler for
// /v1/world/environment and everything under it (workers/mccluster/src/world-environment.js, handleWorldEnvironment, unchanged
// and unwrapped: the gate, the public timeline routes of ./world-environment-events.js, the layer routes, the pinned product's
// server) over the REAL SQL in PGlite: the applied module policy (supabase/migrations/20261117144103_eup_module_policy_v1.sql)
// and, unless `apply` is false, the five PENDING event store parts (supabase/pending/20261119100000_eup_environment_events_v1_01.sql
// to _05.sql), never applied anywhere else. It is the local stand-in for "staging" (decision D1, default adopted pending
// Matthew's confirmation): none exists, and creating one is his call. Never connects to canonical Supabase, Cloudflare or any
// network.
//
//   const plane = await createTimelinePlane();                  // PGLITE_MODULE must point at PGlite's dist/index.js
//   await plane.enable(); await plane.store.command('set_rule', 'usgs', 0);   // the owner turns the module on and sets USGS's rule
//   await plane.store.ingest([usgsEvent({ provider_id: 'us7000abcd' })]);     // what the S3 ingest writes on its cron
//   const r = await plane.get('/v1/world/environment/events');                // { status, body, headers, storeReads, providerCalls }
//   await plane.attach(page);                                                 // Playwright: the plane answers /v1/world/environment*
//   createTimelinePlane({ origins: ['http://127.0.0.1:<port>'] })              // a test page's own origin, allowed as the Worker allows its sites
//   await plane.close();
//
// WHAT IS REAL: the Worker handler and everything it imports, the SQL with its functions, grants, gates, revisions, aliases and
// tombstones, and the edge cache's rules (an in-memory Cache API, one per plane unless a call brings its own).
// WHAT IS EMULATED, and nothing more:
//   1. PostgREST for the three functions these routes call, as service_role in its own transaction: eup_module_policy_read, and
//      the store's eup_environment_public_events and eup_environment_public_event; a function that does not exist answers 404
//      PGRST202, a raised SQLSTATE its code with PostgREST's status (scripts/test/support/eup-environment-plane.mjs
//      postgrestStatus), any table read 404 PGRST205 (the mission table is not in production either).
//   2. The providers: small built answers for NOAA NWS (no alert), NASA EONET (one wildfire), NOAA NHC (no storm), NIFC WFIGS (no
//      perimeter) and NOAA CO-OPS (one station and reading); USGS answers only a ShakeMap detail look-up (404: no such product).
//      The public feed never asks USGS for quakes: they come from the store. FIRMS is never asked (no FIRMS_MAP_KEY here).
//   3. The clock, when a test passes `now` (the edge cache's minute).
//   4. A browser test's page origin (http://127.0.0.1:<port>) added to ALLOWED_ORIGINS beside the World's own sites, so the
//      Worker's own CORS rule answers that page as it answers https://mccluster.org.
import { createEnvironmentStoreDatabase, environmentStoreRpc, usgsEvent, DEFAULT_USGS_RULE, OWNER } from './eup-environment-database.mjs';
import { installModule, enableModule, setModuleState, disableModule, asServiceRole } from './eup-module-policy-database.mjs';
import { postgrestStatus } from './eup-environment-plane.mjs';
import { handleWorldEnvironment } from '../../../workers/mccluster/src/world-environment.js';
import { corsHeaders } from '../../../workers/mccluster/src/lib/http.js';

export { usgsEvent, DEFAULT_USGS_RULE, OWNER };
export const API_ORIGIN = 'https://api.mccluster.org';
export const SUPABASE_ORIGIN = 'https://environment-timeline-plane.invalid';
const SERVICE_KEY = 'environment-timeline-plane-service-key-not-a-secret';
export const ENV = Object.freeze({ SUPABASE_URL: SUPABASE_ORIGIN, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ALLOWED_ORIGINS: 'https://mccluster.org,https://matthew.mccluster.org' });
const ROOT = '/v1/world/environment';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const STORE_READS = Object.freeze(['eup_environment_public_events', 'eup_environment_public_event']);

/* the providers' small built answers (labelled as built), relative to the plane's clock */
function providerAnswer(url, now, mode) {
  if (mode === 'down') throw new TypeError('provider unreachable');
  const t = now();
  switch (url.hostname) {
    case 'api.weather.gov': return json({ features: [] });
    case 'www.nhc.noaa.gov': return json({ activeStorms: [] });
    case 'services3.arcgis.com': return json({ features: [] });
    case 'eonet.gsfc.nasa.gov': return json({ events: [{ id: 'EONET_TIMELINE_1', title: 'Timeline plane wildfire, built for the test', categories: [{ id: 'wildfires', title: 'Wildfires' }],
      sources: [{ id: 'InciWeb', url: 'https://inciweb.wildfire.gov/' }], geometry: [{ type: 'Point', coordinates: [-120.5, 38.2], date: new Date(t - 3600e3).toISOString() }] }] });
    case 'api.tidesandcurrents.noaa.gov':
      if (url.pathname.includes('/mdapi/')) return json({ count: 1, stations: [{ id: '8443970', name: 'Boston', lat: 42.3539, lng: -71.0503, state: 'MA', tidal: true, greatlakes: false }] });
      return json({ metadata: { id: url.searchParams.get('station') || '8443970', name: 'Built station', lat: '42.3539', lon: '-71.0503' }, data: [{ t: new Date(t - 600e3).toISOString().slice(0, 16).replace('T', ' '), v: '1.234', s: '0.003', f: '0,0,0,0', q: 'p' }] });
    /* a ShakeMap or rupture look-up for a chosen quake: USGS knows no product for these built events */
    case 'earthquake.usgs.gov': return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    default: throw new Error('the timeline plane answers no other provider: ' + url.href);
  }
}

export async function createTimelinePlane({ apply = true, now = () => Date.now(), origins = [] } = {}) {
  const store = await createEnvironmentStoreDatabase({ apply });
  const env = Object.freeze({ ...ENV, ALLOWED_ORIGINS: [ENV.ALLOWED_ORIGINS, ...origins].join(',') });
  const db = store.db;
  const log = { storeReads: 0, policyReads: 0, providerCalls: [] };
  const memoryCache = () => {
    const raw = new Map();
    return { raw, async match(k) { return raw.has(k.url) ? new Response(raw.get(k.url)) : undefined; }, async put(k, r) { raw.set(k.url, await r.text()); } };
  };
  const plane = {
    db, store, env, providers: 'rows', storeDown: false, now, log,
    cache: memoryCache(),
    freshCache() { plane.cache = memoryCache(); return plane.cache; },
    install: () => installModule(db, 'environment', OWNER),
    enable: () => enableModule(db, 'environment', OWNER),
    drain: () => setModuleState(db, 'environment', 'draining', OWNER),
    disable: () => disableModule(db, 'environment', OWNER),
    /* the house owner's command (store.command takes the expected revision); the USGS rule is the D7 default */
    setUsgsRule: async () => store.command('set_rule', 'usgs', 0, { reason: 'Timeline plane: adopt the D7 default pending confirmation.' }),
    async fetchImpl(input, init = {}) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === SUPABASE_ORIGIN) {
        if (plane.storeDown) throw new TypeError('the store is unreachable');
        const headers = init.headers || {};
        if (headers.apikey !== SERVICE_KEY) return json({ code: '42501', message: 'permission denied' }, 401);
        const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
        if (!rpc) return json({ code: 'PGRST205', message: 'Could not find the table in the schema cache' }, 404);
        const args = JSON.parse(init.body || '{}');
        try {
          if (rpc[1] === 'eup_module_policy_read') {
            log.policyReads += 1;
            return json(await asServiceRole(db, async (tx) => (await tx.query('select public.eup_module_policy_read($1) as r', [args.p_module])).rows[0].r));
          }
          if (STORE_READS.includes(rpc[1])) { log.storeReads += 1; return json(await environmentStoreRpc(db, rpc[1], args)); }
          return json({ code: 'PGRST202', message: 'Could not find the function in the schema cache' }, 404);
        } catch (error) {
          if (error.code === '42883') return json({ code: 'PGRST202', message: 'Could not find the function in the schema cache' }, 404);
          return json({ code: error.code, message: 'refused', details: null, hint: null }, postgrestStatus(error.code));
        }
      }
      log.providerCalls.push(url.hostname);
      return providerAnswer(url, plane.now, plane.providers);
    },
    /* one GET as a signed-out visitor's page sends it: { status, body, headers, storeReads, policyReads, providerCalls } */
    async get(path, { cache = plane.cache, origin = 'https://mccluster.org' } = {}) {
      const before = { store: log.storeReads, policy: log.policyReads, providers: log.providerCalls.length };
      const response = await handleWorldEnvironment(new Request(API_ORIGIN + path, { headers: { origin, accept: 'application/json' } }), env,
        { fetchImpl: plane.fetchImpl, cacheImpl: cache, limits: null, now: plane.now });
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = text; }
      return { status: response.status, body, headers: response.headers, storeReads: log.storeReads - before.store, policyReads: log.policyReads - before.policy,
        providerCalls: log.providerCalls.slice(before.providers) };
    },
    /* Playwright: answer https://api.mccluster.org/v1/world/environment* through the real handler; register AFTER the test's own
       catch-all route so it wins. Every page in the context shares the plane's edge cache, as one Cloudflare location would. */
    async attach(target) {
      const owns = (u) => { try { const x = new URL(typeof u === 'string' ? u : u.href); return x.origin === API_ORIGIN && (x.pathname === ROOT || x.pathname.startsWith(`${ROOT}/`)); } catch { return false; } };
      const route = async (pwRoute) => {
        const req = pwRoute.request();
        if (!owns(req.url())) return pwRoute.fallback();
        const headers = Object.fromEntries(Object.entries(await req.allHeaders()).filter(([k]) => !k.startsWith(':') && !['host', 'content-length', 'connection'].includes(k.toLowerCase())));
        if (req.method() === 'OPTIONS') return pwRoute.fulfill({ status: 204, headers: corsHeaders(new Request(req.url(), { headers }), env) });
        try {
          const response = await handleWorldEnvironment(new Request(req.url(), { method: req.method(), headers }), env, { fetchImpl: plane.fetchImpl, cacheImpl: plane.cache, limits: null, now: plane.now });
          await pwRoute.fulfill({ status: response.status, headers: Object.fromEntries(response.headers.entries()), body: Buffer.from(await response.arrayBuffer()) });
        } catch { await pwRoute.abort('failed').catch(() => {}); }
      };
      await target.route(owns, route);
      return () => target.unroute(owns, route);
    },
    close: () => store.close()
  };
  return plane;
}
