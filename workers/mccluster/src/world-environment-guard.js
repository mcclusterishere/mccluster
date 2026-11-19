/* THE ENVIRONMENT MODULE'S PUBLIC ANSWERS, TOLD TRUTHFULLY, AND THE BOUNDS ON ITS PUBLIC READS (E=UP event timeline, slice S0,
   2026-11-19; the record is docs/control-plane/EUP-EVENT-TIMELINE.md, the routes docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md).

   OFF, OUTAGE AND NO DATA ARE THREE ANSWERS ON THE WIRE (owner direction 2026-11-19: "distinguish off, outage and no data"):
     off      404 { ok:false, code:'module_disabled' }            the owner has not turned the module on: it was never installed
                                                                  (the store's own EUM01, no policy row) or it is installed and
                                                                  disabled. One answer for both (decision D2, default adopted
                                                                  pending Matthew's confirmation): a visitor learns nothing about
                                                                  how far the owner got.
     outage   503 { ok:false, code:'module_policy_unavailable' }  the policy could not be read: the store down or refusing, its
                                                                  schema or a function missing (PGRST202, 42883), the Worker's two
                                                                  Supabase secrets absent, a redirect, an answer the pinned product
                                                                  does not accept.
     no data  200 with zero events or zero items                   the module is on and the providers answered with nothing.
   Before 2026-11-19 a missing row answered the outage's 503, so "never installed" (production since 2026-11-17: zero policy
   rows) read exactly like a store incident. The policy is read ONCE per request here and handed to the pinned product's server
   (vendor/equity-uprise/src/environment/server.mjs, byte-identical), which applies its own disabled and draining rules; a write's
   second read (the pinned mutation gate) still goes to the store, so a drain that lands meanwhile still stops the write.

   BOUNDS ON THE PUBLIC READS (release security review SEC-2: no rate limit and no coalescing; 40 concurrent requests for one
   uncached layer made 40 provider requests, 60 distinct event ids 60):
     - concurrent misses share one provider read: requests in one Worker isolate that ask for the same kept copy while it is being
       fetched wait for that one fetch (sharedLayer), instead of each asking the provider. A waiter that has not been answered after
       FLIGHT_WAIT_MS (longer than any provider's own timeout) or whose leader failed asks on its own, so a cancelled request never
       strands the others. At most MAX_LOOKUP_FLIGHTS distinct on-demand lookups (a quake's ShakeMap, one station's water level)
       are fetched at once per isolate; past that a lookup is answered from the kept copy or as unavailable, never by another
       provider request.
     - a cheap per-client limit: a token bucket per client address (Cloudflare's cf-connecting-ip) over the public GETs (the feed
       and the layer routes), and a tighter one over the on-demand lookups, refused with 429 { ok:false, code:'rate_limited' } and a
       retry-after. Held in the memory of one isolate only, at most MAX_CLIENTS addresses (an IPv6 address by its /64): never
       stored, cached, logged or sent anywhere. A request without that header (only tests and local tools send one) is not limited.
       Private routes (team, missions, proofs, planning) are never limited here.
   The Cache API alone does not bound either: it keeps a copy per Cloudflare location after a fetch has finished, and every
   request that misses before then asks the provider itself. */
import { reply } from './lib/http.js';
import { UpstreamError } from './lib/safe-fetch.js';
import { readModulePolicy } from './eup/modules.js';
import { trackedLayer } from './world-layers.js';
import { environmentRouteForPath } from '../../../packages/release-policy/globe.mjs';

export const OFF = Object.freeze({ code: 'module_disabled', status: 404 });
export const OUTAGE = Object.freeze({ code: 'module_policy_unavailable', status: 503 });

/* the refusal a failed policy read stands for: only the store's own "no row" (EUM01, supabase/migrations/
   20261117144103_eup_module_policy_v1.sql) is off; every other failure is an outage */
export function refusalOf(error) {
  return error && typeof error === 'object' && error.sqlstate === 'EUM01' && error.reason === 'module_not_installed' ? OFF : OUTAGE;
}

/* The environment policy, read once for this request: () => Promise<{ policy } | { refusal, error }>; never rejects. */
export function policyRead(env, fetchImpl) {
  let once = null;
  return () => (once ||= readModulePolicy(env, fetchImpl, 'environment').then((policy) => ({ policy }), (error) => ({ refusal: refusalOf(error), error })));
}

/* The pinned server's loadPolicy: the first call is this request's read (its error, when it failed, so the pinned server answers its
   own 503), every later call (the mutation gate before a write) reads the store again. */
export function policyLoader(read, env, fetchImpl) {
  let first = true;
  return async () => {
    if (!first) return readModulePolicy(env, fetchImpl, 'environment');
    first = false;
    const r = await read();
    if (r.policy) return r.policy;
    throw r.error;
  };
}

/* the same answer shape as every refusal on these routes: private, never cached, varying by origin and credential */
export function gateAnswer(request, env, body, status, headers = {}) {
  const res = reply(request, env, body, status);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

/* ---------- concurrent misses share one provider read ---------- */
export const FLIGHT_WAIT_MS = 30000;
export const MAX_LOOKUP_FLIGHTS = 16;
const FLIGHTS = new WeakMap(); /* fetchImpl -> cache -> Map(key -> { run, lookup }) */
const NO_CACHE = {};
function flightsFor(fetchImpl, cacheImpl) {
  const owner = typeof fetchImpl === 'function' || (fetchImpl && typeof fetchImpl === 'object') ? fetchImpl : NO_CACHE;
  let byCache = FLIGHTS.get(owner);
  if (!byCache) { byCache = new WeakMap(); FLIGHTS.set(owner, byCache); }
  const scope = cacheImpl && typeof cacheImpl === 'object' ? cacheImpl : NO_CACHE;
  let flights = byCache.get(scope);
  if (!flights) { flights = new Map(); byCache.set(scope, flights); }
  return flights;
}
const busy = async () => { throw new UpstreamError('upstream_busy', 'too many provider lookups in flight'); };
function waitFor(run, ms) {
  let timer;
  return Promise.race([run, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('flight_wait')), ms); })]).finally(() => clearTimeout(timer));
}
/* trackedLayer (./world-layers.js) with concurrent misses coalesced; `lookup` marks an on-demand key (a key per event or station),
   whose distinct flights are capped */
export function sharedLayer(spec, env, fetchImpl, cacheImpl, { lookup = false, waitMs = FLIGHT_WAIT_MS } = {}) {
  const flights = flightsFor(fetchImpl, cacheImpl), key = String(spec.key || spec.layer);
  const running = flights.get(key);
  if (running) return waitFor(running.run, waitMs).catch(() => trackedLayer(spec, env, fetchImpl, cacheImpl));
  if (lookup && [...flights.values()].filter((f) => f.lookup).length >= MAX_LOOKUP_FLIGHTS) return trackedLayer({ ...spec, fetcher: busy }, env, fetchImpl, cacheImpl);
  const run = trackedLayer(spec, env, fetchImpl, cacheImpl);
  const entry = { run, lookup };
  flights.set(key, entry);
  const done = () => { if (flights.get(key) === entry) flights.delete(key); };
  run.then(done, done);
  return run;
}
export const flightCount = (fetchImpl, cacheImpl) => flightsFor(fetchImpl, cacheImpl).size;

/* ---------- a cheap per-client limit ---------- */
export const PUBLIC_READ_LIMITS = Object.freeze({
  reads: Object.freeze({ capacity: 120, perSecond: 2 }),   /* every public GET: a visitor's page asks about 30 a minute at most */
  lookups: Object.freeze({ capacity: 30, perSecond: 0.5 }) /* on-demand lookups: the 24 h quake replay asks at most 50, 20 a minute */
});
export const MAX_CLIENTS = 4096;
/* A token bucket per key: `capacity` at once, refilled at `perSecond`; the least recently seen key is forgotten first. take() is 0
   when allowed, else the whole seconds to wait. */
export function createRateLimiter({ capacity, perSecond, maxClients = MAX_CLIENTS, now = () => Date.now() }) {
  const buckets = new Map();
  return Object.freeze({
    take(id) {
      const t = now();
      let b = buckets.get(id);
      if (b) buckets.delete(id); else b = { tokens: capacity, at: t };
      b.tokens = Math.min(capacity, b.tokens + (Math.max(0, t - b.at) / 1000) * perSecond); b.at = t;
      buckets.set(id, b);
      while (buckets.size > maxClients) buckets.delete(buckets.keys().next().value);
      if (b.tokens >= 1) { b.tokens -= 1; return 0; }
      return Math.max(1, Math.ceil((1 - b.tokens) / perSecond));
    },
    size: () => buckets.size
  });
}
export function createPublicReadLimits(options = {}) {
  return Object.freeze({ reads: createRateLimiter({ ...PUBLIC_READ_LIMITS.reads, ...options }), lookups: createRateLimiter({ ...PUBLIC_READ_LIMITS.lookups, ...options }) });
}
const DEFAULT_LIMITS = createPublicReadLimits();
/* the client's address as a bucket key: IPv4 as given, IPv6 by its /64 (one subscriber usually holds a whole /64) */
export function clientKey(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!v || v.length > 64) return null;
  if (!v.includes(':')) return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(v) ? v : null;
  const [head, tail, extra] = v.split('::');
  if (extra !== undefined) return null;
  const h = head ? head.split(':') : [], t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  if (groups.length < 4 || !groups.slice(0, 4).every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
/* null when the request may go on; else the 429. Only the public GETs are counted; a lookup takes from both buckets. */
export function limitPublicRead(request, env, limits = DEFAULT_LIMITS) {
  if (request.method !== 'GET' || !limits) return null;
  const route = environmentRouteForPath(new URL(request.url).pathname.replace(/\/+$/, '') || '/');
  if (!route) return null;
  const id = clientKey(request.headers.get('cf-connecting-ip'));
  if (!id) return null;
  let wait = limits.reads.take(id);
  /* a deep link's one event (slice S4) is a lookup too: a key per event */
  if (!wait && (route.id === 'shakemap' || route.id === 'rupture' || route.id === 'water-level' || route.id === 'event')) wait = limits.lookups.take(id);
  return wait ? gateAnswer(request, env, { ok: false, code: 'rate_limited' }, 429, { 'retry-after': String(wait) }) : null;
}
