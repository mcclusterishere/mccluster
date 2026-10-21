/* Current release policy: world-release.js requires live house-owner preview
   before dispatch. The original adapter prerequisites below do not release data. */
/* THE WORLD'S DATA LAYERS (owner, 2026-10-15: "we need some demo data …
   one you can see not logged in, maybe the flights … and then two other
   data sets, like satellites and space missions, that only logged in users
   can see").

   Three read-only routes the globe (js/action-globe.js) draws from:

     GET /v1/world/layers/flights      public    aircraft in the air now
     GET /v1/world/layers/satellites   members   orbital elements to propagate
     GET /v1/world/layers/launches     members   upcoming launches, at their pads

   Every source is one Hitman's Halo already uses (DATA_SOURCES.md there;
   the seek-first registry here names the same three). Each is fetched
   here, trimmed to what the Earth needs, cached in the Worker so the
   provider sees one request per window however many people look, and
   served with its attribution. A provider that is down gives the last
   good answer while it lasts, then an honest "unavailable", never an
   error page in the frame.

   Members only means the Worker checks the bearer with Supabase, not the
   page hiding a button (client-side hiding is not authorization:
   docs/action-network/EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md).

   Flights are a provider chain (2026-10-16: anonymous OpenSky timed out
   from Cloudflare's egress on every call, so the one public layer was
   "unavailable"):
     1. OpenSky, only when OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET are
        set on the Worker (anonymous OpenSky is not attempted);
     2. adsb.lol (api.adsb.lol, ODbL 1.0) when OpenSky is not configured
        or fails. adsb.lol answers a point and a radius (at most 250 nm),
        so the World gets a SAMPLE: FLIGHT_REGIONS below, a fixed set of
        busy-airspace circles, deduplicated by transponder. It is not "all
        flights" and the response says so (coverage).
   Each attempt is reported in `providers`; a provider that failed is never
   a success with zero aircraft. airplanes.live is not used: its API guide
   lists it as non-commercial use.

   Licences, for the owner: OpenSky's data is for non-commercial research
   and education, and a product in operation can need a written agreement
   with OpenSky. adsb.lol's data is ODbL 1.0 (attribution; share-alike for a
   derived database), free today, and its terms say an API key from feeding
   will be required in future and ask production users to contact them. CelesTrak asks for citation. The Space Devs
   allow use and sharing with value added and encourage credit; an
   LL2_API_TOKEN raises their limit (15 calls an hour anonymous). */
import { fail, reply } from './lib/http.js';
import { fetchNoCrossHostRedirect, UpstreamError } from './lib/safe-fetch.js';

export const LAYERS = Object.freeze({
  flights: { public: true, ttl: 600, attribution: 'adsb.lol (ODbL 1.0) or OpenSky Network', max: 5000 },
  satellites: { public: false, ttl: 7200, attribution: 'CelesTrak (celestrak.org), Dr. T.S. Kelso', max: 240 },
  launches: { public: false, ttl: 1800, attribution: 'Launch Library 2 — The Space Devs', max: 30 }
});
const STALE_GRACE = 6 * 3600;
const TIMEOUT_MS = 12000;
/* the bright, named objects a person can relate to, not the whole catalogue */
const SATELLITE_GROUPS = ['stations', 'visual'];

/* Workers' fetch rejects redirect: 'error'; the provider is fetched with
   redirect: 'manual' and may only redirect to its own host over https
   (lib/safe-fetch.js). Every failure is typed, so "unavailable" says why. */
async function upstream(url, init = {}, fetchImpl = fetch, as = 'json', timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    try {
      res = await fetchNoCrossHostRedirect(url, { ...init, signal: controller.signal, headers: { accept: as === 'text' ? 'text/plain' : 'application/json', 'user-agent': 'McCluster-World/1.0 (https://mccluster.org)', ...(init.headers || {}) } }, { fetchImpl });
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      if (controller.signal.aborted || error?.name === 'AbortError') throw new UpstreamError('upstream_timeout', `provider timed out after ${timeoutMs} ms`);
      throw new UpstreamError('upstream_network', 'provider fetch failed');
    }
    if (!res.ok) throw new UpstreamError(res.status === 429 ? 'upstream_rate_limited' : 'upstream_http', `provider ${res.status}`, { providerStatus: res.status });
    if (as === 'text') return await res.text();
    try { return await res.json(); } catch { throw new UpstreamError('upstream_invalid_json', 'provider returned invalid JSON', { providerStatus: res.status }); }
  } finally {
    clearTimeout(timer);
  }
}

/* the bearer is a member's: Supabase says so, or nobody is signed in */
export async function bearerUser(request, env, fetchImpl = fetch) {
  const h = request.headers.get('authorization') || '';
  if (!/^bearer\s+\S+/i.test(h) || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: h } });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

/* ---------- the three fetches, trimmed to what the Earth draws ---------- */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
/* a coordinate the provider gives as a string or a number; absent, null or empty is absent, never zero */
const coord = (v) => (v === null || v === undefined || v === '' ? null : num(Number(v)));

async function openSkyToken(env, fetchImpl) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return null;
  const tok = await upstream('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.OPENSKY_CLIENT_ID, client_secret: env.OPENSKY_CLIENT_SECRET }).toString()
  }, fetchImpl).catch(() => null);
  return tok && tok.access_token ? tok.access_token : null;
}

/* OpenSky's /states/all: the whole sky in one answer. Exported for the tests;
   the World asks it only with the research credentials (fetchFlights). */
export async function fetchOpenSky(env, fetchImpl = fetch) {
  const token = await openSkyToken(env, fetchImpl);
  const data = await upstream('https://opensky-network.org/api/states/all', token ? { headers: { authorization: `Bearer ${token}` } } : {}, fetchImpl);
  const states = Array.isArray(data && data.states) ? data.states : [];
  /* [icao24, callsign, lon, lat, altitude m, speed m/s, track deg]; airborne, positioned */
  const aircraft = [];
  for (const s of states) {
    if (!Array.isArray(s) || s[8] === true) continue;
    const lon = num(s[5]), lat = num(s[6]);
    if (lon === null || lat === null) continue;
    aircraft.push([String(s[0] || ''), String(s[1] || '').trim(), lon, lat, num(s[7]), num(s[9]), num(s[10])]);
    if (aircraft.length >= LAYERS.flights.max) break;
  }
  return {
    source: 'opensky', provider: 'opensky', authenticated: !!token,
    attribution: 'OpenSky Network', attribution_url: 'https://opensky-network.org', license: 'OpenSky Network terms of use (non-commercial research and education)', credit: 'Flights: OpenSky',
    coverage: { kind: 'global', note: 'every aircraft OpenSky reported in this snapshot, up to the layer cap' },
    observed_at: data && data.time ? new Date(data.time * 1000).toISOString() : null, total: states.length, count: aircraft.length, aircraft
  };
}

/* adsb.lol answers aircraft within a radius (max 250 nm) of a point. A
   fixed set of busy airspaces, asked a few at a time once per cache window
   per Cloudflare location: eight subrequests, well inside the Worker budget. */
export const FLIGHT_REGIONS = Object.freeze([
  { id: 'new-york', lat: 40.7, lon: -74.0 },
  { id: 'chicago', lat: 41.9, lon: -87.9 },
  { id: 'los-angeles', lat: 34.0, lon: -118.4 },
  { id: 'london', lat: 51.5, lon: -0.5 },
  { id: 'frankfurt', lat: 50.0, lon: 8.6 },
  { id: 'dubai', lat: 25.2, lon: 55.4 },
  { id: 'singapore', lat: 1.35, lon: 103.99 },
  { id: 'tokyo', lat: 35.6, lon: 139.8 }
]);
const ADSB_RADIUS_NM = 250;
const ADSB_CONCURRENCY = 4;
const ADSB_TIMEOUT_MS = 8000;
/* readsb dbFlags: 4 = PIA (privacy ICAO address), 8 = LADD (owner asked that it not be displayed) */
const ADSB_WITHHELD_FLAGS = 4 | 8;
const FT_TO_M = 0.3048, KT_TO_MS = 0.514444;

/* one adsb.lol aircraft to the World's row, or null when it is not drawable:
   on the ground, without a position, a stale position, or a privacy-flagged airframe */
export function normalizeAdsbAircraft(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.alt_baro === 'ground') return null;
  const lat = coord(a.lat), lon = coord(a.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (typeof a.seen_pos === 'number' && a.seen_pos > 60) return null;
  const alt = typeof a.alt_baro === 'number' ? a.alt_baro : (typeof a.alt_geom === 'number' ? a.alt_geom : null);
  return [String(a.hex || ''), String(a.flight || '').trim(), lon, lat, alt === null ? null : num(alt * FT_TO_M), typeof a.gs === 'number' ? num(a.gs * KT_TO_MS) : null, num(a.track)];
}

export async function fetchAdsbLol(env, fetchImpl = fetch, { regions = FLIGHT_REGIONS } = {}) {
  const results = new Array(regions.length);
  let next = 0;
  async function worker() {
    while (next < regions.length) {
      const i = next++, r = regions[i];
      try {
        const data = await upstream(`https://api.adsb.lol/v2/point/${r.lat}/${r.lon}/${ADSB_RADIUS_NM}`, {}, fetchImpl, 'json', ADSB_TIMEOUT_MS);
        if (!data || !Array.isArray(data.ac)) throw new UpstreamError('upstream_invalid_json', 'adsb.lol answer has no aircraft list');
        results[i] = { region: r.id, status: 'ok', data };
      } catch (error) {
        results[i] = { region: r.id, status: 'failed', error: (error && error.code) || 'upstream_error', provider_status: (error && error.providerStatus) || null };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ADSB_CONCURRENCY, regions.length) }, worker));
  const ok = results.filter((r) => r.status === 'ok');
  const regionStatus = results.map((r) => (r.status === 'ok' ? { region: r.region, status: 'ok', reported: r.data.ac.length } : { region: r.region, status: 'failed', error: r.error, provider_status: r.provider_status }));
  if (!ok.length) {
    const err = new UpstreamError(results[0] ? results[0].error : 'upstream_error', 'adsb.lol unavailable in every region', { providerStatus: results[0] ? results[0].provider_status : null });
    err.regions = regionStatus;
    throw err;
  }
  const seen = new Set(), aircraft = [];
  let reported = 0, withheld = 0, observed = 0;
  for (const r of ok) {
    if (typeof r.data.now === 'number' && r.data.now > observed) observed = r.data.now;
    for (const a of r.data.ac) {
      reported += 1;
      const hex = String(a && a.hex || '');
      if (!hex || seen.has(hex)) continue;
      seen.add(hex);
      if (Number(a.dbFlags) & ADSB_WITHHELD_FLAGS) { withheld += 1; continue; }
      const row = normalizeAdsbAircraft(a);
      if (row && aircraft.length < LAYERS.flights.max) aircraft.push(row);
    }
  }
  return {
    source: 'adsb_lol', provider: 'adsb_lol', authenticated: false,
    attribution: 'adsb.lol, Open Database License (ODbL) 1.0', attribution_url: 'https://adsb.lol', license: 'ODbL-1.0', license_url: 'https://opendatacommons.org/licenses/odbl/1-0/', credit: 'Flights: adsb.lol (ODbL)',
    coverage: {
      kind: 'regional_sample', radius_nm: ADSB_RADIUS_NM, regions: regions.map((r) => r.id), regions_ok: ok.length, regions_failed: results.length - ok.length,
      note: `a sample of ${aircraft.length} aircraft within ${ADSB_RADIUS_NM} nm of ${ok.length} busy airspaces, not every flight in the air`
    },
    partial: ok.length < results.length, region_status: regionStatus,
    observed_at: observed ? new Date(observed).toISOString() : null, total: seen.size, withheld, reported, count: aircraft.length, aircraft
  };
}

/* the chain: OpenSky with credentials, then adsb.lol. Every attempt is in
   `providers`; when every one fails the error carries them all. */
export async function fetchFlights(env, fetchImpl = fetch) {
  const providers = [];
  if (env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET) {
    try {
      const data = await fetchOpenSky(env, fetchImpl);
      providers.push({ provider: 'opensky', status: 'ok', authenticated: data.authenticated, count: data.count });
      return { ...data, providers };
    } catch (error) {
      providers.push({ provider: 'opensky', status: 'failed', error: (error && error.code) || 'upstream_error', provider_status: (error && error.providerStatus) || null });
    }
  } else {
    providers.push({ provider: 'opensky', status: 'skipped', reason: 'not_configured' });
  }
  try {
    const data = await fetchAdsbLol(env, fetchImpl);
    providers.push({ provider: 'adsb_lol', status: data.partial ? 'partial' : 'ok', count: data.count, regions_ok: data.coverage.regions_ok, regions_failed: data.coverage.regions_failed });
    return { ...data, providers };
  } catch (error) {
    providers.push({ provider: 'adsb_lol', status: 'failed', error: (error && error.code) || 'upstream_error', provider_status: (error && error.providerStatus) || null, regions: error && error.regions || undefined });
    const err = new UpstreamError((error && error.code) || 'upstream_error', 'every flights provider failed', { providerStatus: error && error.providerStatus });
    err.providers = providers;
    throw err;
  }
}

export async function fetchSatellites(env, fetchImpl = fetch) {
  const seen = new Map();
  let failed = 0, lastError = null;
  for (const group of SATELLITE_GROUPS) {
    /* CelesTrak's TLE format: three lines per object, name then the two element lines.
       One group down is tolerated when another answers; every group down is the provider down. */
    const text = await upstream(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=TLE`, {}, fetchImpl, 'text').catch((error) => { failed += 1; lastError = error; return ''; });
    const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const name = lines[i].trim(), l1 = lines[i + 1], l2 = lines[i + 2];
      if (!/^1 /.test(l1) || !/^2 /.test(l2)) continue;
      const id = l1.slice(2, 7).trim();
      if (!seen.has(id)) seen.set(id, { id, name, group, tle1: l1, tle2: l2 });
      if (seen.size >= LAYERS.satellites.max) break;
    }
  }
  const satellites = [...seen.values()];
  if (!satellites.length && failed === SATELLITE_GROUPS.length) throw new UpstreamError((lastError && lastError.code) || 'upstream_error', 'celestrak unavailable', { providerStatus: lastError ? lastError.providerStatus : null });
  return { source: 'celestrak', groups: SATELLITE_GROUPS, count: satellites.length, satellites };
}

export async function fetchLaunches(env, fetchImpl = fetch) {
  const headers = env.LL2_API_TOKEN ? { authorization: `Token ${env.LL2_API_TOKEN}` } : {};
  const data = await upstream(`https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=${LAYERS.launches.max}&mode=normal&ordering=net`, { headers }, fetchImpl);
  const launches = (Array.isArray(data && data.results) ? data.results : []).map((l) => ({
    id: String(l.id || ''),
    name: String(l.name || 'Launch').slice(0, 120),
    net: l.net || null,
    status: l.status && (l.status.abbrev || l.status.name) || null,
    provider: l.launch_service_provider && l.launch_service_provider.name || null,
    pad: { name: l.pad && l.pad.name || null, location: l.pad && l.pad.location && l.pad.location.name || null, lat: coord(l.pad && l.pad.latitude), lon: coord(l.pad && l.pad.longitude) },
    mission: { name: l.mission && l.mission.name || null, type: l.mission && l.mission.type || null },
    url: l.url || null
  })).filter((l) => l.pad.lat !== null && l.pad.lon !== null);
  return { source: 'launch_library2', count: launches.length, launches };
}

const FETCHERS = { flights: fetchFlights, satellites: fetchSatellites, launches: fetchLaunches };

/* ---------- the cache: one provider request per window, the last good answer while a provider is down ---------- */
function cacheKey(layer) {
  return new Request(`https://cache.mccluster.internal/world/layers/${layer}`);
}
async function cached(layer, env, fetchImpl, cacheImpl) {
  const spec = LAYERS[layer];
  const store = cacheImpl || (globalThis.caches && globalThis.caches.default) || null;
  const key = cacheKey(layer);
  let hit = null;
  if (store) {
    const res = await store.match(key).catch(() => null);
    if (res) hit = await res.json().catch(() => null);
  }
  const fresh = hit && hit.fetched_at && (Date.now() - Date.parse(hit.fetched_at)) < spec.ttl * 1000;
  if (fresh) return { body: hit, stale: false };
  try {
    const data = await FETCHERS[layer](env, fetchImpl);
    const body = { ok: true, layer, fetched_at: new Date().toISOString(), attribution: spec.attribution, ...data };
    if (store) await store.put(key, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${spec.ttl + STALE_GRACE}` } })).catch(() => {});
    return { body, stale: false };
  } catch (error) {
    const reason = (error && error.code) || 'upstream_error';
    const providers = error && Array.isArray(error.providers) ? { providers: error.providers } : {};
    if (hit) return { body: { ...hit, upstream_error: reason, ...(providers.providers ? { refresh_providers: providers.providers } : {}) }, stale: true, error };
    return { body: { ok: true, layer, fetched_at: null, attribution: spec.attribution, unavailable: true, upstream_error: reason, ...providers, count: 0, [layer === 'flights' ? 'aircraft' : layer]: [] }, stale: false, error };
  }
}

export async function handleWorldLayers(request, env, { fetchImpl = fetch, cacheImpl = null } = {}) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/v1\/world\/layers\/(flights|satellites|launches)$/);
  if (!m) return null;
  const layer = m[1], spec = LAYERS[layer];
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(request, env, 'Method not allowed', 405);
  if (!spec.public) {
    const user = await bearerUser(request, env, fetchImpl);
    if (!user) return fail(request, env, `Sign in to see ${layer === 'launches' ? 'space missions' : layer}`, 401, { layer, members_only: true });
  }
  const { body, stale } = await cached(layer, env, fetchImpl, cacheImpl);
  const res = reply(request, env, { ...body, stale: !!stale });
  /* the public layer may sit in browser and edge caches for its window; a member's never leaves their session */
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
