import { PERSISTENCE, sourceByKey } from './source-registry.js';
import { LANE_CONTRACT } from './lanes.js';

const SERVICE = 'mccluster-spatial-intelligence';
const BRANCH = 'grok/spatial-plane';
const UPSTREAM = 'https://github.com/bilawalsidhu/gods-eye-view';
const UPSTREAM_COMMIT = '759652207fd1279ece97f0f19af566feb9a82146';

/*
  McCluster's own spatial layer. GEV never had these. ChatGPT cloned USGS/EPA
  and stopped. Claude asked to host Cesium. The house plane is the reason
  this namespace exists: Equity Uprise, SCSU, Shiloh, PRIM3, Whip corridors
  as INTERNAL entities on the one Worker.
*/

export const PLANE_SITES = Object.freeze([
  Object.freeze({ id: 'house', layer: 'house', name: 'Control plane', city: 'Bridgeport', lat: 41.1865, lon: -73.1956, detail: 'Worker mccluster. One API. HereTenantAgent stays exported.', sources: Object.freeze(['house', 'overpass', 'open_meteo']) }),
  Object.freeze({ id: 'shiloh', layer: 'house', name: 'Shiloh Church BPT', city: 'Bridgeport', lat: 41.179, lon: -73.189, detail: 'Faith / facilities digital twin. Same entity model, access-controlled.', sources: Object.freeze(['house', 'overpass']) }),
  Object.freeze({ id: 'ne-ops', layer: 'house', name: 'NE operations', city: 'Everett', lat: 42.4084, lon: -71.0525, detail: 'House operations node. Consumes the plane. Does not own it.', sources: Object.freeze(['house', 'open_meteo', 'nhtsa']) }),
  Object.freeze({ id: 'site0', layer: 'house', name: 'PRIM3 Site 0', city: 'Lower Colorado', lat: 34.48, lon: -114.34, detail: '3D twin consumes spatial APIs. The renderer is never the source of truth.', sources: Object.freeze(['house', 'overpass', 'open_meteo', 'usgs']) }),
  Object.freeze({ id: 'eu-dc', layer: 'policy', name: 'Equity Uprise · federal', city: 'Washington', lat: 38.9072, lon: -77.0369, detail: 'Canonical publish vs external distribute. Census, USAspending, Grants.gov, BLS feed the docket.', sources: Object.freeze(['equity_uprise', 'usaspending', 'grants_gov', 'census', 'bls', 'fred']) }),
  Object.freeze({ id: 'eu-atl', layer: 'policy', name: 'Equity Uprise · South', city: 'Atlanta', lat: 33.749, lon: -84.388, detail: 'EPA facilities, TRI, air and water. Environmental justice stays on the house org.', sources: Object.freeze(['equity_uprise', 'epa', 'census', 'gdelt']) }),
  Object.freeze({ id: 'scsu', layer: 'policy', name: 'SCSU research lane', city: 'New Haven', lat: 41.3327, lon: -72.947, detail: 'Academic-only Planet and OpenSky. A commercial satellite such as Whip must never receive this lane.', sources: Object.freeze(['scsu_docket', 'planet_research', 'opensky_research']) }),
  Object.freeze({ id: 'eia-hou', layer: 'policy', name: 'Energy docket', city: 'Houston', lat: 29.7604, lon: -95.3698, detail: 'EIA generation, demand, and grid flows bound to publication hashes the same way EU content is.', sources: Object.freeze(['equity_uprise', 'eia', 'epa']) }),
  Object.freeze({ id: 'midwest', layer: 'policy', name: 'Midwest docket', city: 'Detroit', lat: 42.3314, lon: -83.0458, detail: 'Labor, housing, and federal awards as observations. History is the asset, not the globe.', sources: Object.freeze(['equity_uprise', 'bls', 'census', 'usaspending', 'fred']) }),
  Object.freeze({ id: 'whip-bos', layer: 'mobility', name: 'Whip · NE corridor', city: 'Boston', lat: 42.3601, lon: -71.0589, detail: 'Aggregated mobility only. Individual rider histories are not public intelligence.', sources: Object.freeze(['nhtsa', 'tomtom', 'open_meteo']) }),
  Object.freeze({ id: 'whip-nyc', layer: 'mobility', name: 'Whip · NY corridor', city: 'New York', lat: 40.7128, lon: -74.006, detail: 'Traffic and hazards as transient observations. TomTom stays commercial-lane.', sources: Object.freeze(['nhtsa', 'tomtom']) })
]);

export const PLANE_ARCS = Object.freeze([
  Object.freeze(['eu-dc', 'eu-atl']),
  Object.freeze(['eu-dc', 'eia-hou']),
  Object.freeze(['eu-dc', 'scsu']),
  Object.freeze(['eu-dc', 'midwest']),
  Object.freeze(['house', 'eu-dc']),
  Object.freeze(['house', 'scsu']),
  Object.freeze(['whip-bos', 'whip-nyc']),
  Object.freeze(['ne-ops', 'whip-bos']),
  Object.freeze(['house', 'site0'])
]);

export const PLANE_ROUTES = Object.freeze({
  health: 'GET /v1/geo',
  plane: 'GET /v1/geo/plane',
  sources: 'GET /v1/geo/sources',
  capabilities: 'GET /v1/geo/capabilities',
  fetch: 'POST /v1/geo/fetch/:source',
  ingest: 'POST /v1/geo/ingest/:source',
  nearby: 'GET /v1/geo/nearby',
  bbox: 'GET /v1/geo/bbox',
  events_nearby: 'GET /v1/geo/events/nearby',
  entities: 'GET /v1/geo/entities',
  live_ais: 'GET /v1/geo/live/ais'
});

export const FORBIDDEN = Object.freeze({
  second_worker: true,
  gev_proxy: true,
  vercel: true,
  pages_hijack: true,
  cesium_clone: true,
  overwrite_index_html: true,
  gbfs_api_mimicry: true,
  openai_in_geo: true
});

function houseResult(sourceKey, operation, records) {
  const source = sourceByKey(sourceKey);
  return {
    source: sourceKey,
    operation,
    fetched_at: new Date().toISOString(),
    source_url: null,
    attribution: source?.attribution || 'McCluster INTERNAL',
    persistence: source?.persistence || PERSISTENCE.PERSISTENT,
    records,
    raw: null
  };
}

function siteRecord(site) {
  return {
    kind: 'entity',
    external_id: site.id,
    entity_type: site.layer,
    name: site.name,
    point: { lat: site.lat, lon: site.lon },
    properties: {
      city: site.city,
      layer: site.layer,
      detail: site.detail,
      sources: site.sources
    },
    source_url: null,
    observed_at: null
  };
}

function sitesFor(layer) {
  return PLANE_SITES.filter((site) => site.layer === layer).map(siteRecord);
}

export async function executeHouseAdapter(sourceKey) {
  if (sourceKey === 'house') return houseResult('house', 'house-sites', sitesFor('house'));
  if (sourceKey === 'equity_uprise') return houseResult('equity_uprise', 'policy-nodes', sitesFor('policy'));
  if (sourceKey === 'scsu_docket') {
    const rows = PLANE_SITES.filter((site) => site.id === 'scsu').map(siteRecord);
    return houseResult('scsu_docket', 'research-docket', rows);
  }
  throw new Error(`house adapter does not own ${sourceKey}`);
}

export function planeContract({ schemaReady = false, sources = [] } = {}) {
  return {
    ok: true,
    service: SERVICE,
    plane: 'spatial',
    satellite_of: 'control',
    worker: 'mccluster',
    durable_object: 'HereTenantAgent',
    durable_object_instance: 'geo:ais:mccluster',
    supabase: 'zmnhbrjyhxzhkxmhkexs',
    namespace: '/v1/geo',
    branch: BRANCH,
    prize: true,
    do_not_merge: true,
    status: 'prize-branch',
    database_schema_ready: Boolean(schemaReady),
    upstream_reference: UPSTREAM,
    upstream_commit: UPSTREAM_COMMIT,
    upstream_license: 'MIT',
    production_note: 'Live api.mccluster.org /v1/geo is 404 until the house deploys this Worker. This branch must not merge and must not publish GitHub Pages.',
    forbidden: FORBIDDEN,
    lanes: LANE_CONTRACT,
    routes: PLANE_ROUTES,
    sites: PLANE_SITES,
    arcs: PLANE_ARCS,
    sources
  };
}
