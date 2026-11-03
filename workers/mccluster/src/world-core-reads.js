/* MCCLUSTER CORE READS THE HALO MAP: a Core-signed GET to a few read-only
   World layer routes acts as the house owner.

   Core on OVH pairs headlines with items on the Halo map
   (core/src/executors/world-news-pairing.mjs, docs/control-plane/WORLD-NEWS-PAIRING.md).
   The layers are owner-only (./world-release.js) and Core holds no user
   session, so it signs each read with the key it already shares with this
   Worker (CORE_EDGE_SIGNING_KEY, the scheme in ./media/core-signature.js).

   Narrow on purpose. A request that announces the Core protocol is handled
   here and nowhere else, except POST /v1/media/mcp (its own block in
   ./entry.js). Everything else that announces it is refused, never
   downgraded to an anonymous or bearer request:
     - GET only, no query string, empty body (the signature covers the
       method, the path and the body digest, not a query string);
     - only the layers in CORE_READ_LAYERS; military, flights, tides, Halo
       operations, CCTV, geocode and every other route are refused;
     - a valid signature (timestamp window, single-use nonce, body digest);
     - a layer the owner withdrew (WORLD_GLOBE_WITHDRAWN) stays withdrawn;
     - exactly one house owner (houseOwnerActor), else 503.
   The answer is the same body the owner's globe gets, private, no-store. */
import { globeRelease } from '../../../packages/release-policy/globe.mjs';
import { fail, reply } from './lib/http.js';
import { houseOwnerActor, isCoreSigned, verifyCoreSignature } from './media/core-signature.js';
import { handleHaloLayers } from './world-halo-layers.js';
import { worldLayerAnswer } from './world-layers.js';

export const CORE_READ_LAYERS = Object.freeze(['quakes', 'cyclones', 'natural', 'fires', 'perimeters', 'launches', 'satellites', 'vessels', 'weather']);
export const CORE_READ_PATH = new RegExp(`^/v1/world/layers/(${CORE_READ_LAYERS.join('|')})$`);
const WORLD_LAYERS = new Set(['launches', 'satellites']);

function privately(res) {
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
function refuse(request, env, message, status, code) {
  const res = reply(request, env, { ok: false, code, error: message }, status);
  return privately(res);
}

/* POST /v1/media/mcp is the only other route a Core signature may reach. */
export function coreSignedMediaRoute(request, path) {
  return path === '/v1/media/mcp' && request.method === 'POST';
}

export async function handleCoreSignedRead(request, env, path, { fetchImpl = fetch, cacheImpl = null } = {}) {
  const match = path.match(CORE_READ_PATH);
  if (!match) return refuse(request, env, 'A Core signature is not accepted on this route.', 403, 'core_route_not_allowed');
  if (request.method !== 'GET') return refuse(request, env, 'Core reads the World layers with GET only.', 405, 'core_method_not_allowed');
  if (new URL(request.url).search) return refuse(request, env, 'A Core-signed read carries no query string.', 400, 'core_query_not_signed');
  try {
    await verifyCoreSignature({ request, env, path, bodyBytes: new Uint8Array(0) });
  } catch (error) {
    return privately(fail(request, env, error.message || 'Core signature refused', error.status || 401));
  }
  const layer = match[1];
  if (globeRelease(layer, env) === 'withdrawn') return refuse(request, env, 'This globe feature is withdrawn.', 403, 'feature_withdrawn');
  try {
    await houseOwnerActor(env);
  } catch (error) {
    return privately(fail(request, env, error.message || 'House owner unavailable', error.status || 503));
  }
  if (WORLD_LAYERS.has(layer)) return privately(reply(request, env, await worldLayerAnswer(layer, env, { fetchImpl, cacheImpl })));
  return handleHaloLayers(request, env, { fetchImpl, cacheImpl });
}

/* Both entries call this first (./entry-platform.js, then ./entry.js): null
   when the request does not announce Core, or is Core's media call; otherwise
   the whole answer. */
export async function coreSignedGate(request, env, options = {}) {
  if (!isCoreSigned(request)) return null;
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (coreSignedMediaRoute(request, path)) return null;
  try {
    return await handleCoreSignedRead(request, env, path, options);
  } catch (error) {
    return privately(fail(request, env, error.message || 'Core read failed', error.status || 500));
  }
}
