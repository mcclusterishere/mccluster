// The in-process environment plane (E=UP event timeline slice S0, 2026-11-19): the REAL Worker handler for
// /v1/world/environment (workers/mccluster/src/world-environment.js, handleWorldEnvironment, unchanged and unwrapped) over
// the REAL applied module-policy SQL (supabase/migrations/20261117144103_eup_module_policy_v1.sql) in PGlite. It is the local
// stand-in for "staging" (decision D1, default adopted pending Matthew's confirmation): no staging Worker or Supabase branch
// exists, and creating one is Matthew's call. Never connects to canonical Supabase, Cloudflare or any network.
//
//   const plane = await createEnvironmentPlane();              // PGLITE_MODULE must point at PGlite's dist/index.js
//   const r = await plane.get('/v1/world/environment');        // { status, body, policyReads, providerCalls }
//   await plane.install(); await plane.enable(); await plane.drain(); await plane.disable();
//   plane.providers = 'rows' | 'empty' | 'down';  plane.store = 'up' | 'down';
//   await plane.close();
//
// WHAT IS REAL: the Worker handler and everything it imports (the gate, the guard, the layer routes, the pinned product's
// server), and the policy SQL with its functions, grants and the house owner check.
// WHAT IS EMULATED, and nothing more:
//   1. PostgREST for the one RPC the gate calls, POST /rest/v1/rpc/eup_module_policy_read {p_module}: run as service_role in its
//      own transaction; a function that does not exist answers 404 PGRST202, a raised SQLSTATE answers { code, message } with
//      PostgREST's status (400 for the module policy's own EUM codes, 404 for 42883, 503 for class 08 and 53, else 500 or 400 as
//      PostgREST documents). The mission list's table read answers 404 PGRST205: the table is not in production either.
//   2. The providers: small built-in answers for NOAA NWS, NASA EONET, USGS and NOAA NHC ('rows'), the same providers answering
//      with nothing ('empty'), or every provider failing ('down').
//   3. The store being unreachable ('down'): the policy RPC fails at the network level.
import { createModulePolicyDatabase, installModule, enableModule, setModuleState, disableModule, OWNER } from './eup-module-policy-database.mjs';
import { handleWorldEnvironment } from '../../../workers/mccluster/src/world-environment.js';

export const SUPABASE_ORIGIN = 'https://environment-plane.invalid';
const SERVICE_KEY = 'environment-plane-service-key-not-a-secret';
export const ENV = Object.freeze({ SUPABASE_URL: SUPABASE_ORIGIN, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ALLOWED_ORIGINS: 'https://mccluster.org' });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/* PostgREST's documented status for a SQLSTATE, as far as the policy read can raise one */
export function postgrestStatus(code) {
  const c = String(code || '');
  if (c === '42883' || c === '42P01') return 404;
  if (c.startsWith('08') || c.startsWith('53')) return 503;
  if (c === 'P0001' || /^EUM\d\d$/.test(c)) return 400;
  if (/^(25|2D|38|39|3B|40|54|55|57|58|F0|HV|P0|XX)/.test(c)) return 500;
  return 400;
}

/* the providers' small answers, built here (labelled as built): one quake, one natural event, no alert, no storm */
const now = () => Date.now();
function providerAnswer(url, mode) {
  if (mode === 'down') throw new TypeError('provider unreachable');
  const empty = mode === 'empty';
  if (url.hostname === 'api.weather.gov') return json({ features: [] });
  if (url.hostname === 'eonet.gsfc.nasa.gov') return json({ events: empty ? [] : [{ id: 'EONET_PLANE_1', title: 'Plane wildfire, built for the test', categories: [{ id: 'wildfires', title: 'Wildfires' }], sources: [{ id: 'InciWeb', url: 'https://inciweb.wildfire.gov/' }], geometry: [{ type: 'Point', coordinates: [-120.5, 38.2], date: new Date(now() - 3600e3).toISOString() }] }] });
  if (url.hostname === 'earthquake.usgs.gov') return json({ metadata: { generated: now() }, features: empty ? [] : [{ id: 'usplane01', geometry: { coordinates: [-117.6, 35.7, 8.2] }, properties: { place: '12 km SW of a built test place', time: now() - 1800e3, mag: 4.6, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/usplane01' } }] });
  if (url.hostname === 'www.nhc.noaa.gov') return json({ activeStorms: [] });
  throw new Error('the plane answers no other provider: ' + url.href);
}

export async function createEnvironmentPlane() {
  const { db, close, rollback } = await createModulePolicyDatabase();
  let policyReads = 0, providerCalls = 0;
  const plane = {
    db, providers: 'rows', store: 'up', cache: null,
    async fetchImpl(input, init = {}) {
      const url = new URL(String(input));
      if (url.origin === SUPABASE_ORIGIN) {
        if (plane.store === 'down') throw new TypeError('the store is unreachable');
        if (url.pathname === '/rest/v1/rpc/eup_module_policy_read') {
          policyReads += 1;
          if (init.headers?.apikey !== SERVICE_KEY) return json({ code: '42501', message: 'permission denied' }, 401);
          const args = JSON.parse(init.body || '{}');
          try {
            const row = await db.transaction(async (tx) => { await tx.exec('set local role service_role'); return (await tx.query('select public.eup_module_policy_read($1) as r', [args.p_module])).rows[0]; });
            return json(row.r);
          } catch (error) {
            if (error.code === '42883' && /eup_module_policy_read/.test(error.message)) return json({ code: 'PGRST202', message: 'Could not find the function public.eup_module_policy_read(p_module) in the schema cache' }, 404);
            return json({ code: error.code, message: error.message, details: null, hint: null }, postgrestStatus(error.code));
          }
        }
        /* any other function is not in this plane's database (the event store's parts are not applied here): PostgREST's own
           answer for a missing function (E=UP slice S4: the public feed's USGS rows are read from that store) */
        if (url.pathname.startsWith('/rest/v1/rpc/')) return json({ code: 'PGRST202', message: 'Could not find the function in the schema cache' }, 404);
        if (url.pathname.startsWith('/rest/v1/')) return json({ code: 'PGRST205', message: 'Could not find the table in the schema cache' }, 404);
        return json({ message: 'not found' }, 404);
      }
      providerCalls += 1;
      return providerAnswer(url, plane.providers);
    },
    /* one GET as a signed-out visitor's page sends it */
    async get(path, { cache = plane.cache } = {}) {
      const before = { reads: policyReads, calls: providerCalls };
      const response = await handleWorldEnvironment(new Request('https://api.mccluster.org' + path, { headers: { origin: 'https://mccluster.org', accept: 'application/json' } }), ENV, { fetchImpl: plane.fetchImpl, cacheImpl: cache || memoryCache(), limits: null });
      return { status: response.status, body: await response.json(), headers: response.headers, policyReads: policyReads - before.reads, providerCalls: providerCalls - before.calls };
    },
    install: () => installModule(db, 'environment', OWNER),
    enable: () => enableModule(db, 'environment', OWNER),
    drain: () => setModuleState(db, 'environment', 'draining', OWNER),
    disable: () => disableModule(db, 'environment', OWNER),
    /* the policy SQL rolled back: its functions are gone, as in a database the migration never reached */
    unapplySchema: () => rollback(),
    close
  };
  return plane;
}
export function memoryCache() {
  const raw = new Map();
  return { raw, async match(k) { return raw.has(k.url) ? new Response(raw.get(k.url)) : undefined; }, async put(k, r) { raw.set(k.url, await r.text()); } };
}
