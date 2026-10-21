/* Owner direction 2026-10-16: flights, satellites, vehicle telemetry and Halo
   feeds belong to internal intelligence, not a public or paid globe offering.
   admin_preview is the existing wire value for operator-only access, not a
   promise of future public release. Account tiers cannot publish these feeds. */
export const GLOBE_FEATURES = Object.freeze(['flights','satellites','launches','intel','music','cctv','audience','transport','ion']);
export const GLOBE_RELEASE_VERSION = 'globe-admin-preview/v1';
export function globeRelease(feature, env = {}) {
  if (!GLOBE_FEATURES.includes(feature)) return 'withdrawn';
  const raw = env.WORLD_GLOBE_WITHDRAWN;
  if (raw == null || raw === '') return 'admin_preview';
  if (typeof raw !== 'string') return 'withdrawn';
  const ids = raw.split(',').map(x => x.trim());
  if (ids.some(x => x !== '*' && !GLOBE_FEATURES.includes(x))) return 'withdrawn';
  return ids.includes('*') || ids.includes(feature) ? 'withdrawn' : 'admin_preview';
}
export function globeFeatureForPath(path) {
  if (path.startsWith('/v1/world/layers/')) return path.slice('/v1/world/layers/'.length);
  if (path === '/v1/world/cctv' || path.startsWith('/v1/world/cctv/')) return 'cctv';
  if (path === '/v1/world/ion' || path.startsWith('/v1/world/ion/')) return 'ion';
  if (path === '/v1/intel/geo' || path === '/v1/equity-uprise/halo-globe') return 'intel';
  return null;
}
