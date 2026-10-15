/* THE WORLD'S CESIUM ION, WITHOUT HANDING OUT THE KEY.

   Owner, 2026-10-15: "I added an ion, cesium ion key to the McCluster
   worker." The World's Earth (js/action-globe.js) keeps NASA's imagery from
   far out and, as the camera comes down, takes Cesium World Terrain, aerial
   imagery and 3D buildings from Cesium ion.

   HOW THE KEY STAYS HERE. CesiumJS asks `${Ion.defaultServer}v1/assets/{id}/
   endpoint` for every ion asset. The page points Ion.defaultServer at this
   route (https://api.mccluster.org/v1/world/ion/) and clears Cesium's built-in
   token, so the browser sends nothing secret. This route asks ion for the same
   endpoint with the account's token and passes ion's answer through. That
   answer carries a token for that one asset that ion lets live about an hour;
   it is the only token a browser ever holds. Tiles then go straight from ion
   to the browser, and when the asset token runs out CesiumJS asks this route
   again.

   WHAT IT SERVES. Only the assets the World draws (ION_ASSETS), only to the
   ecosystem's own pages (the CORS allowlist, checked on the Origin header).
   Each answer is kept per data centre for 20 minutes, well inside the asset
   token's hour, so ion's API sees a handful of calls an hour whatever the
   traffic; while ion is down a kept answer up to 45 minutes old still serves.
   GET /v1/world/ion says whether the World has ion at all, so a page without
   it never asks for an asset. */
import { reply, fail, corsHeaders, allowedOrigins } from './lib/http.js';

export const WORLD_ION_PATH = '/v1/world/ion';
export const ION_API = 'https://api.cesium.com';

/* terrain: Cesium World Terrain. imagery, tried in order: Bing Maps Aerial
   with Labels, Bing Maps Aerial, Sentinel-2. buildings: Cesium OSM Buildings. */
export const ION_ASSETS = Object.freeze({ terrain: 1, imagery: Object.freeze([3, 2, 3954]), buildings: 96188 });
const SERVED = new Set([ION_ASSETS.terrain, ION_ASSETS.buildings, ...ION_ASSETS.imagery]);

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

function cacheKey(id) {
  return new Request(`https://cache.mccluster.internal/world/ion/${id}`);
}

async function askIon(id, token, origin, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${ION_API}/v1/assets/${id}/endpoint`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', origin, referer: `${origin}/` },
      redirect: 'error',
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
  res.headers.set('cache-control', `public, max-age=${maxAge}`);
  res.headers.set('vary', 'Origin');
  return res;
}

export async function handleWorldIon(request, env, { fetchImpl = fetch, cacheImpl = null, now = () => Date.now() } = {}) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (path !== WORLD_ION_PATH && !path.startsWith(`${WORLD_ION_PATH}/`)) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(request, env, 'Method not allowed', 405);

  const ion = cesiumIonToken(env);
  if (path === WORLD_ION_PATH) {
    return answer(request, env, { ok: true, available: Boolean(ion), binding: ion ? ion.name : null, assets: ION_ASSETS });
  }

  const match = path.match(/^\/v1\/world\/ion\/v1\/assets\/(\d{1,9})\/endpoint$/);
  if (!match) return fail(request, env, 'Not found', 404);
  const id = Number(match[1]);
  if (!SERVED.has(id)) return fail(request, env, 'This asset is not part of the World', 404, { asset: id });
  const origin = request.headers.get('origin') || '';
  if (!origin || !allowedOrigins(env).includes(origin)) return fail(request, env, "Only the ecosystem's own pages can draw the World's map data", 403);
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
