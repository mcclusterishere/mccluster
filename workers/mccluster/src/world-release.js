import { globeFeatureForPath, globeRelease } from '../../../packages/release-policy/globe.mjs';
import { bearerUser } from './world-layers.js';
import { isHouseOwner } from './world-access.js';
import { uuid } from './world-cctv.js';
import { reply } from './lib/http.js';

/* Called before dispatch/cache reads at the canonical Worker boundary.
   Existing per-feature privacy, purpose and rate-limit gates still apply. */
export async function guardWorldRelease(request, env, { fetchImpl = fetch } = {}) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const feature = globeFeatureForPath(path);
  if (!feature) return null;
  let reason = globeRelease(feature, env);
  if (reason !== 'withdrawn') {
    const user = await bearerUser(request, env, fetchImpl);
    if (user && uuid(user.id) && await isHouseOwner(env, user.id, fetchImpl)) return null;
  }
  const res = reply(request, env, { ok: false, code: reason === 'withdrawn' ? 'feature_withdrawn' : 'admin_preview', error: 'This globe feature is not released.', feature }, 403);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
