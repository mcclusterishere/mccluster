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

   Licences, for the owner: OpenSky's data is for non-commercial research
   and education, and a product in operation can need a written agreement
   with OpenSky; this fetches anonymously unless OPENSKY_CLIENT_ID and
   OPENSKY_CLIENT_SECRET (the seek-first research lane) are set, which
   raises the request budget. CelesTrak asks for citation. The Space Devs
   allow use and sharing with value added and encourage credit; an
   LL2_API_TOKEN raises their limit (15 calls an hour anonymous). */
import { fail, reply } from './lib/http.js';
import { fetchNoCrossHostRedirect, UpstreamError } from './lib/safe-fetch.js';

export const LAYERS = Object.freeze({
  flights: { public: true, ttl: 600, attribution: 'OpenSky Network', max: 5000 },
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
async function upstream(url, init = {}, fetchImpl = fetch, as = 'json') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    try {
      res = await fetchNoCrossHostRedirect(url, { ...init, signal: controller.signal, headers: { accept: as === 'text' ? 'text/plain' : 'application/json', 'user-agent': 'McCluster-World/1.0 (https://mccluster.org)', ...(init.headers || {}) } }, { fetchImpl });
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      if (controller.signal.aborted || error?.name === 'AbortError') throw new UpstreamError('upstream_timeout', `provider timed out after ${TIMEOUT_MS} ms`);
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

export async function fetchFlights(env, fetchImpl = fetch) {
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
  return { source: 'opensky', authenticated: !!token, observed_at: data && data.time ? new Date(data.time * 1000).toISOString() : null, total: states.length, count: aircraft.length, aircraft };
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
    if (hit) return { body: { ...hit, upstream_error: reason }, stale: true, error };
    return { body: { ok: true, layer, fetched_at: null, attribution: spec.attribution, unavailable: true, upstream_error: reason, count: 0, [layer === 'flights' ? 'aircraft' : layer]: [] }, stale: false, error };
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
  res.headers.set('cache-control', spec.public ? `public, max-age=${Math.min(spec.ttl, 300)}` : 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
