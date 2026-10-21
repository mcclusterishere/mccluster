/* Current release policy: world-release.js requires house-owner preview before
   this adapter; responses cannot outlive a release check in browser caches. */
/* THE WORLD'S CESIUM ION, FOR SIGNED-IN MEMBERS, WITHOUT HANDING OUT THE KEY.

   Owner, 2026-10-15: "I added an ion, cesium ion key to the McCluster
   worker." The World's Earth (js/action-globe.js) keeps NASA's imagery from
   far out and, for a signed-in member, as the camera comes down, takes Cesium
   World Terrain, aerial imagery and 3D buildings from Cesium ion. Logged-out
   visitors get the globe and its free layers (NASA GIBS, OpenStreetMap) and
   never touch ion: the ion assets are account-backed (metered/paid), and the
   owner's rule for the public is the globe plus one free layer, with the
   paid map data for signed-in members.

   HOW THE KEY STAYS HERE. CesiumJS asks `${Ion.defaultServer}v1/assets/{id}/
   endpoint` for every ion asset. A member's page points Ion.defaultServer at
   this route (https://api.mccluster.org/v1/world/ion/) with the member's
   Supabase session in an Authorization header (never in the URL) and clears
   Cesium's built-in token. This route asks ion for the same endpoint with the
   account's token and passes ion's answer through. That answer carries a token
   for that one asset that ion lets live about an hour; it is the only ion token
   a browser ever holds. Tiles then go straight from ion to the browser, and
   when the asset token runs out CesiumJS asks this route again.

   WHO IS SERVED, IN ORDER. Only the assets the World draws (ION_ASSETS; any
   other id is a 404). Only requests whose Origin is one of the ecosystem's own
   pages (the CORS allowlist; a 403 otherwise). The Origin header is trivially
   set by any non-browser client, so it is an extra check, never the gate: the
   gate is a signed-in member, verified with Supabase exactly as the members'
   data layers are (bearerUser, ./world-layers.js); no bearer, or one Supabase
   does not recognise, is a 401. Requests are rate limited per client IP
   (before the Supabase check, so a flood of bad bearers does not become a
   flood of Supabase calls) and per member (RATE_LIMITS; a 429 with
   retry-after). The limiter lives in the isolate's memory: it is per data
   centre and per isolate, resets when the isolate does, and is a brake on
   scripted abuse, not an exact quota. The hard ceiling on spend is the ion
   account itself (token scope and usage alerts, set in the ion dashboard).

   CACHING. Each ion answer is kept per data centre for 20 minutes, well inside
   the asset token's hour, so ion's API sees a handful of calls an hour
   whatever the traffic; while ion is down a kept answer up to 45 minutes old
   still serves. Answers go back `private`, varying on Origin and Authorization,
   so no shared cache hands a member's answer to anyone else.

   GET /v1/world/ion stays public: it says whether the World has ion at all
   ({ available, members_only: true }), so a page never asks for an asset
   it cannot have. The page itself only asks it for a signed-in member.

   OWNER ACTIONS THIS CODE CANNOT DO (not done by this change): restrict the
   ion token's scope to exactly these six assets in the Cesium ion dashboard;
   turn on ion usage alerts; confirm the ion plan permits this commercial use
   (the free Community plan is for non-commercial use). */
import { reply, fail, corsHeaders, allowedOrigins } from './lib/http.js';
import { bearerUser } from './world-layers.js';

export const WORLD_ION_PATH = '/v1/world/ion';
export const ION_API = 'https://api.cesium.com';

/* terrain: Cesium World Terrain. imagery, tried in order: Bing Maps Aerial
   with Labels, Bing Maps Aerial, Sentinel-2. buildings: Cesium OSM Buildings.
   photoreal: Google Photorealistic 3D Tiles through Cesium ion (asset 2275207).
   Google's Map Tiles API terms ride with it: the Google logo and the data
   attributions the tileset carries must stay visible on screen whenever its
   tiles are drawn (never hidden, cropped or covered); tiles may not be cached,
   stored or copied, so this Worker never fetches, proxies or keeps a tile (it
   passes on ion's endpoint answer only, and the browser takes tiles straight
   from Google); and ion's own terms apply on top (the Community plan is for
   non-commercial use). */
export const ION_ASSETS = Object.freeze({ terrain: 1, imagery: Object.freeze([3, 2, 3954]), buildings: 96188, photoreal: 2275207 });
const SERVED = new Set([ION_ASSETS.terrain, ION_ASSETS.buildings, ...ION_ASSETS.imagery, ION_ASSETS.photoreal]);

/* CESIUM_ION_TOKEN is the name the rest of the plane uses (the spatial
   console, Hitman's Halo); the others are read so a token saved under a near
   name still works. GET /v1/world/ion reports which one it found. */
export const ION_TOKEN_BINDINGS = Object.freeze(['CESIUM_ION_TOKEN', 'CESIUM_ION_ACCESS_TOKEN', 'CESIUM_ION_KEY', 'CESIUM_ION_API_KEY', 'CESIUM_TOKEN']);

export function cesiumIonToken(env) {
  for (const name of ION_TOKEN_BINDINGS) {
    const value = env && typeof env[name] === 'string' ? env[name].trim() : '';
    if (value) return { name, token: value };
  }
  return null;
}

const FRESH_MS = 20 * 60 * 1000;
const STALE_MS = 45 * 60 * 1000;
const TIMEOUT_MS = 10000;
const BROWSER_MAX_AGE = 300;

/* in-isolate sliding counters: a member may open the World on a few devices and
   each page asks for at most six assets, then about once an hour per asset */
export const RATE_LIMITS = Object.freeze({ windowMs: 10 * 60 * 1000, perIp: 120, perMember: 60 });
const MAX_KEYS = 5000;

export function createLimiter({ windowMs = RATE_LIMITS.windowMs, max }) {
  const hits = new Map();
  return {
    /* counts this hit; says whether it is within the limit and, if not, how long until the window frees a slot */
    take(key, at) {
      const since = at - windowMs;
      const list = (hits.get(key) || []).filter((t) => t > since);
      if (list.length >= max) {
        hits.set(key, list);
        return { ok: false, retryAfter: Math.max(1, Math.ceil((list[0] + windowMs - at) / 1000)) };
      }
      list.push(at);
      hits.delete(key);
      hits.set(key, list);
      /* the oldest keys go first when the map grows past its bound */
      while (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value);
      return { ok: true };
    },
    reset() { hits.clear(); }
  };
}

const LIMITS = { ip: createLimiter({ max: RATE_LIMITS.perIp }), member: createLimiter({ max: RATE_LIMITS.perMember }) };
export function resetWorldIonLimits() { LIMITS.ip.reset(); LIMITS.member.reset(); }

function limited(request, env, retryAfter) {
  const res = fail(request, env, 'Too many map requests; try again shortly', 429, { retry_after: retryAfter });
  res.headers.set('retry-after', String(retryAfter));
  res.headers.set('cache-control', 'no-store');
  return res;
}

function cacheKey(id) {
  return new Request(`https://cache.mccluster.internal/world/ion/${id}`);
}

async function askIon(id, token, origin, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${ION_API}/v1/assets/${id}/endpoint`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', origin, referer: `${origin}/` },
      /* workerd takes only 'follow' or 'manual' ('error' throws); 'manual' hands back a 3xx, which !res.ok turns into a
         502, so the token never follows a redirect */
      redirect: 'manual',
      signal: controller.signal
    });
    if (!res.ok) return { ok: false, status: res.status };
    const endpoint = await res.json().catch(() => null);
    if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint) || (!endpoint.url && !endpoint.externalType)) return { ok: false, status: res.status };
    return { ok: true, endpoint };
  } catch {
    return { ok: false, status: null };
  } finally {
    clearTimeout(timer);
  }
}

function answer(request, env, body, maxAge = BROWSER_MAX_AGE) {
  const res = reply(request, env, body);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'Origin, Authorization');
  return res;
}

export async function handleWorldIon(request, env, { fetchImpl = fetch, cacheImpl = null, now = () => Date.now(), limits = LIMITS } = {}) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (path !== WORLD_ION_PATH && !path.startsWith(`${WORLD_ION_PATH}/`)) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(request, env, 'Method not allowed', 405);

  const ion = cesiumIonToken(env);
  if (path === WORLD_ION_PATH) {
    const res = reply(request, env, { ok: true, available: Boolean(ion), members_only: true, binding: ion ? ion.name : null, assets: ION_ASSETS });
    res.headers.set('cache-control', 'private, no-store');
    res.headers.set('vary', 'Origin, Authorization');
    return res;
  }

  const match = path.match(/^\/v1\/world\/ion\/v1\/assets\/(\d{1,9})\/endpoint$/);
  if (!match) return fail(request, env, 'Not found', 404);
  const id = Number(match[1]);
  if (!SERVED.has(id)) return fail(request, env, 'This asset is not part of the World', 404, { asset: id });
  const origin = request.headers.get('origin') || '';
  if (!origin || !allowedOrigins(env).includes(origin)) return fail(request, env, "Only the ecosystem's own pages can draw the World's map data", 403);

  /* the IP brake comes before the Supabase check; the member gate is the real one */
  const at = now();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const byIp = limits.ip.take(ip, at);
  if (!byIp.ok) return limited(request, env, byIp.retryAfter);
  const user = await bearerUser(request, env, fetchImpl);
  if (!user) {
    const res = fail(request, env, "Sign in to see the World's terrain, aerial imagery and 3D buildings", 401, { members_only: true });
    res.headers.set('cache-control', 'no-store');
    return res;
  }
  const byMember = limits.member.take(String(user.id), at);
  if (!byMember.ok) return limited(request, env, byMember.retryAfter);
  if (!ion) return fail(request, env, "The World's Cesium ion is not configured", 503, { binding: ION_TOKEN_BINDINGS[0] });

  const store = cacheImpl || (globalThis.caches && globalThis.caches.default) || null;
  const key = cacheKey(id);
  let kept = null;
  if (store) {
    const hit = await store.match(key).catch(() => null);
    if (hit) kept = await hit.json().catch(() => null);
  }
  const age = kept && Number.isFinite(kept.fetched_at) ? now() - kept.fetched_at : Infinity;
  if (kept && kept.endpoint && age >= 0 && age < FRESH_MS) return answer(request, env, kept.endpoint);

  const got = await askIon(id, ion.token, origin, fetchImpl);
  if (got.ok) {
    if (store) {
      const body = JSON.stringify({ fetched_at: now(), endpoint: got.endpoint });
      await store.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Math.ceil(STALE_MS / 1000)}` } })).catch(() => {});
    }
    return answer(request, env, got.endpoint);
  }
  if (kept && kept.endpoint && age >= 0 && age < STALE_MS) return answer(request, env, kept.endpoint, 60);
  return fail(request, env, 'Cesium ion did not answer for this asset', 502, { asset: id, upstream_status: got.status });
}
