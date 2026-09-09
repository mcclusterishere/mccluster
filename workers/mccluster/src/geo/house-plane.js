import { PERSISTENCE, sourceByKey, sourceCatalog } from './source-registry.js';
import { LANE_CONTRACT } from './lanes.js';

const SERVICE = 'mccluster-spatial-intelligence';
const UPSTREAM = 'https://github.com/bilawalsidhu/gods-eye-view';
const UPSTREAM_COMMIT = '759652207fd1279ece97f0f19af566feb9a82146';

export const PLANE_ROUTES = Object.freeze({
  health: 'GET /v1/geo',
  plane: 'GET /v1/geo/plane',
  plane_internal: 'GET /v1/geo/plane/internal',
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

function houseResult(sourceKey, operation, records, extra = {}) {
  const source = sourceByKey(sourceKey);
  return {
    source: sourceKey,
    operation,
    fetched_at: new Date().toISOString(),
    source_url: null,
    attribution: source?.attribution || 'McCluster INTERNAL',
    persistence: source?.persistence || PERSISTENCE.PERSISTENT,
    records,
    raw: null,
    ...extra
  };
}

export async function executeHouseAdapter(sourceKey, _input, env = {}) {
  const { loadAuthoritativeEntities } = await import('./store.js');
  const loaded = await loadAuthoritativeEntities(env, sourceKey);
  return houseResult(sourceKey, 'authoritative-entities', loaded.records, {
    authoritative: loaded.authoritative,
    authority: loaded.authority
  });
}

export function publicPlaneContract({ schemaReady = false, sources = [] } = {}) {
  const catalog = sources.length ? sources : [];
  return {
    ok: true,
    service: SERVICE,
    plane: 'spatial',
    satellite_of: 'control',
    worker: 'mccluster',
    durable_object: 'HereTenantAgent',
    namespace: '/v1/geo',
    version: 1,
    database_schema_ready: Boolean(schemaReady),
    upstream_reference: UPSTREAM,
    upstream_commit: UPSTREAM_COMMIT,
    upstream_license: 'MIT',
    forbidden: FORBIDDEN,
    lanes: LANE_CONTRACT,
    routes: PLANE_ROUTES,
    public_layers: catalog.filter((row) => row.lane === 'OPEN').map((row) => row.key),
    capabilities: {
      public: true,
      internal_plane: 'GET /v1/geo/plane/internal',
      fetch_persists: false,
      ingest_persists: true
    }
  };
}

export function internalPlaneContract({
  schemaReady = false,
  sources = [],
  sites = [],
  arcs = [],
  authority = 'unavailable',
  authoritative = false
} = {}) {
  return {
    ...publicPlaneContract({ schemaReady, sources }),
    durable_object_instance: 'geo:ais:mccluster',
    supabase: 'zmnhbrjyhxzhkxmhkexs',
    sources: sources.length ? sources : sourceCatalog({}),
    sites,
    arcs,
    authoritative,
    authority
  };
}
