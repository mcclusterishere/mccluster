/* Owner direction 2026-10-16: flights, satellites, vehicle telemetry and Halo
   feeds belong to internal intelligence, not a public or paid globe offering.
   admin_preview is the existing wire value for operator-only access, not a
   promise of future public release. Account tiers cannot publish these feeds.
   The Halo feeds on the admin globe (military, quakes, fires, perimeters,
   cyclones, vessels) and place search ride the same owner-only gate, as do
   Halo operations ('halo-ops': /v1/world/halo/*, the owner's missions and
   people) and NOAA water levels ('tides': /v1/world/layers/tides and
   /v1/world/tides/*). */
export const GLOBE_FEATURES = Object.freeze(['flights','satellites','launches','intel','music','cctv','audience','transport','ion','military','quakes','fires','perimeters','cyclones','vessels','search','halo-ops','tides','weather','natural']);
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
  if (path === '/v1/world/geocode') return 'search';
  if (path === '/v1/world/halo' || path.startsWith('/v1/world/halo/')) return 'halo-ops';
  if (path === '/v1/world/tides' || path.startsWith('/v1/world/tides/')) return 'tides';
  if (path === '/v1/intel/geo' || path === '/v1/equity-uprise/halo-globe') return 'intel';
  return null;
}
