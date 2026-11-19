/* Owner direction 2026-10-16: flights, satellites, vehicle telemetry and Halo
   feeds belong to internal intelligence, not a public or paid globe offering.
   admin_preview is the existing wire value for operator-only access, not a
   promise of future public release. Account tiers cannot publish these feeds.
   The Halo feeds on the admin globe (military, quakes, fires, perimeters,
   cyclones, vessels) and place search ride the same owner-only gate, as do
   Halo operations ('halo-ops': /v1/world/halo/*, the owner's missions and
   people), NOAA water levels ('tides': /v1/world/layers/tides and
   /v1/world/tides/*) and Core's Connecticut weather snapshot ('weather':
   /v1/world/weather/*, alongside the NWS alerts layer). */
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
/* PUBLIC ENVIRONMENTAL ROUTES (owner, 2026-11-17: the environmental globe). These are not globe
   features of the owner-only release above: globeFeatureForPath answers null for every one of them,
   so guardWorldRelease leaves them to their own gate. That gate is the persisted `environment` module
   policy, read on every request in the Worker (workers/mccluster/src/world-environment.js), exactly as
   for GET /v1/world/environment: unreadable or missing is 503 module_policy_unavailable, disabled is 404
   module_disabled, draining still answers reads. Nothing here defaults to on, and nothing here makes an
   owner-only Halo path public: /v1/world/layers/*, /v1/world/tides/* and /v1/world/halo/* stay above.
   `param` is the one path segment a route takes (a NOAA station id, a USGS event id), unvalidated here. */
export const ENVIRONMENT_MODULE = 'environment';
export const ENVIRONMENT_PUBLIC_ROUTES = Object.freeze([
  Object.freeze({ id: 'feed', pattern: /^\/v1\/world\/environment$/ }),
  Object.freeze({ id: 'fires', pattern: /^\/v1\/world\/environment\/layers\/fires$/ }),
  Object.freeze({ id: 'perimeters', pattern: /^\/v1\/world\/environment\/layers\/perimeters$/ }),
  Object.freeze({ id: 'alerts', pattern: /^\/v1\/world\/environment\/layers\/alerts$/ }),
  Object.freeze({ id: 'eonet', pattern: /^\/v1\/world\/environment\/layers\/eonet$/ }),
  Object.freeze({ id: 'tides', pattern: /^\/v1\/world\/environment\/layers\/tides$/ }),
  Object.freeze({ id: 'water-level', pattern: /^\/v1\/world\/environment\/tides\/([^/]+)$/ }),
  Object.freeze({ id: 'shakemap', pattern: /^\/v1\/world\/environment\/quakes\/([^/]+)\/shakemap$/ }),
  /* a quake's documented rupture: the modelled up-dip edge of a USGS finite-fault plane, or none (event timeline slice S5) */
  Object.freeze({ id: 'rupture', pattern: /^\/v1\/world\/environment\/quakes\/([^/]+)\/rupture$/ })
]);
export function environmentRouteForPath(path) {
  for (const route of ENVIRONMENT_PUBLIC_ROUTES) {
    const m = route.pattern.exec(path);
    if (m) return { id: route.id, module: ENVIRONMENT_MODULE, param: m[1] === undefined ? null : m[1] };
  }
  return null;
}
export function globeFeatureForPath(path) {
  if (path.startsWith('/v1/world/layers/')) return path.slice('/v1/world/layers/'.length);
  if (path === '/v1/world/cctv' || path.startsWith('/v1/world/cctv/')) return 'cctv';
  if (path === '/v1/world/ion' || path.startsWith('/v1/world/ion/')) return 'ion';
  if (path === '/v1/world/geocode') return 'search';
  if (path === '/v1/world/halo' || path.startsWith('/v1/world/halo/')) return 'halo-ops';
  if (path === '/v1/world/tides' || path.startsWith('/v1/world/tides/')) return 'tides';
  if (path === '/v1/world/weather' || path.startsWith('/v1/world/weather/')) return 'weather';
  if (path === '/v1/intel/geo' || path === '/v1/equity-uprise/halo-globe') return 'intel';
  return null;
}
