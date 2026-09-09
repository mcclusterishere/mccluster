import { fail, reply } from '../lib/http.js';
import { adapterCapabilities, executeAdapter, GeoAdapterError } from './adapters.js';
import { sourceByKey, sourceCatalog } from './source-registry.js';
import {
  entitiesInBbox,
  getEntity,
  listEntities,
  listIngestionRuns,
  nearbyEntities,
  nearbyEvents,
  persistAdapterResult,
  resolveHouseOrg,
  schemaReady
} from './store.js';

const SERVICE = 'mccluster-spatial-intelligence';
const UPSTREAM = 'https://github.com/bilawalsidhu/gods-eye-view';
const UPSTREAM_COMMIT = '759652207fd1279ece97f0f19af566feb9a82146';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readiness(env) {
  const sources = sourceCatalog(env);
  const credentialed = sources.filter((source) => source.credential_required);
  const configured = credentialed.filter((source) => source.configured);
  const noCredential = sources.filter((source) => !source.credential_required);

  return {
    total_sources: sources.length,
    no_credential_sources: noCredential.length,
    credentialed_sources: credentialed.length,
    credentialed_sources_configured: configured.length,
    credentialed_sources_pending: credentialed.length - configured.length
  };
}

function finite(value, name, min, max, fallback = undefined) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new GeoAdapterError(`${name} must be between ${min} and ${max}`, 400, 'invalid_parameter');
  }
  return parsed;
}

function int(value, name, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new GeoAdapterError(`${name} must be an integer between ${min} and ${max}`, 400, 'invalid_parameter');
  }
  return parsed;
}

async function jsonBody(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 1_000_000) throw new GeoAdapterError('Spatial request body is too large', 413, 'request_too_large');
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not object');
    return body;
  } catch {
    throw new GeoAdapterError('Request body must be a JSON object', 400, 'invalid_json');
  }
}

async function requireOwner(request, env, options) {
  if (typeof options?.requireHouseOwner !== 'function') {
    throw new GeoAdapterError('Spatial authorization is unavailable', 503, 'authorization_unavailable');
  }
  return options.requireHouseOwner(request, env);
}

async function protectedContext(request, env, options, { requireSchema = false } = {}) {
  const user = await requireOwner(request, env, options);
  const org = await resolveHouseOrg(env);
  if (requireSchema && !await schemaReady(env)) {
    throw new GeoAdapterError('Spatial database schema is not ready', 503, 'spatial_schema_not_ready');
  }
  return { user, org };
}

async function requestFingerprint(source, body) {
  const bytes = new TextEncoder().encode(JSON.stringify({ source, body }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function responseResult(result, { includeRaw = false, persistence = null } = {}) {
  const payload = {
    source: result.source,
    operation: result.operation,
    fetched_at: result.fetched_at,
    source_url: result.source_url,
    attribution: result.attribution,
    persistence_policy: result.persistence,
    records: result.records || [],
    persistence
  };
  for (const [key, value] of Object.entries(result)) {
    if (['source', 'operation', 'fetched_at', 'source_url', 'attribution', 'persistence', 'records', 'raw'].includes(key)) continue;
    payload[key] = value;
  }
  if (includeRaw) payload.raw = result.raw;
  return payload;
}

async function fetchAndMaybePersist(request, env, options, sourceKey, mode) {
  const source = sourceByKey(sourceKey);
  if (!source) throw new GeoAdapterError('Unknown spatial source', 404, 'unknown_source');
  const { org } = await protectedContext(request, env, options);
  const body = await jsonBody(request);
  const result = await executeAdapter(sourceKey, body, env);
  const shouldPersist = mode === 'ingest' || body.persist !== false;
  let persistence = { persisted: false, reason: shouldPersist ? 'not_persistable' : 'disabled_by_request', records_seen: result.records?.length || 0, records_written: 0 };

  if (shouldPersist) {
    const fingerprint = await requestFingerprint(sourceKey, body);
    persistence = await persistAdapterResult(env, org.id, result, {
      operation: result.operation || mode,
      requestFingerprint: fingerprint,
      force: false
    });
  }

  return reply(request, env, {
    ok: true,
    service: SERVICE,
    org: { id: org.id, slug: org.slug },
    result: responseResult(result, { includeRaw: body.include_raw === true, persistence })
  }, mode === 'ingest' && persistence.persisted ? 201 : 200);
}

function queryParams(url) {
  return Object.fromEntries(url.searchParams.entries());
}

async function aisSnapshot(request, env, options, restart = false) {
  await protectedContext(request, env, options);
  if (!env.HereTenantAgent) throw new GeoAdapterError('Tenant agent Durable Object binding is unavailable', 503, 'durable_object_unavailable');
  const id = env.HereTenantAgent.idFromName('geo:ais:mccluster');
  const stub = env.HereTenantAgent.get(id);
  const internal = new Request(
    restart ? 'https://internal.mccluster/internal/geo/ais/restart' : 'https://internal.mccluster/internal/geo/ais/snapshot',
    { method: restart ? 'POST' : 'GET' }
  );
  const response = await stub.fetch(internal);
  if (!response.ok) throw new GeoAdapterError('AIS live cache request failed', 502, 'ais_cache_error');
  const data = await response.json();
  return reply(request, env, {
    ok: true,
    service: SERVICE,
    source: 'aisstream',
    ...data
  });
}

export default {
  async fetch(request, env, options = {}) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if ((path === '/v1/geo' || path === '/v1/geo/health') && request.method === 'GET') {
        const dbReady = await schemaReady(env);
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          mode: dbReady ? 'live' : 'adapter-ready',
          upstream_reference: UPSTREAM,
          upstream_commit: UPSTREAM_COMMIT,
          database_schema_ready: dbReady,
          adapter_gateway_ready: true,
          adapter_capabilities: adapterCapabilities(),
          readiness: readiness(env)
        });
      }

      if (path === '/v1/geo/sources' && request.method === 'GET') {
        return reply(request, env, {
          service: SERVICE,
          sources: sourceCatalog(env)
        });
      }

      if (path === '/v1/geo/capabilities' && request.method === 'GET') {
        return reply(request, env, {
          service: SERVICE,
          upstream_reference: UPSTREAM,
          upstream_commit: UPSTREAM_COMMIT,
          adapters: adapterCapabilities(),
          routes: {
            fetch: 'POST /v1/geo/fetch/:source',
            ingest: 'POST /v1/geo/ingest/:source',
            nearby: 'GET /v1/geo/nearby',
            bbox: 'GET /v1/geo/bbox',
            events_nearby: 'GET /v1/geo/events/nearby',
            entities: 'GET /v1/geo/entities',
            live_ais: 'GET /v1/geo/live/ais'
          }
        });
      }

      const providerMatch = path.match(/^\/v1\/geo\/(fetch|ingest)\/([a-z0-9_-]+)$/i);
      if (providerMatch && request.method === 'POST') {
        return fetchAndMaybePersist(request, env, options, providerMatch[2], providerMatch[1]);
      }

      if (path === '/v1/geo/live/ais' && request.method === 'GET') {
        return aisSnapshot(request, env, options, false);
      }
      if (path === '/v1/geo/live/ais/restart' && request.method === 'POST') {
        return aisSnapshot(request, env, options, true);
      }

      if (path === '/v1/geo/nearby' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const params = queryParams(url);
        params.lat = finite(params.lat, 'lat', -90, 90);
        params.lon = finite(params.lon ?? params.lng, 'lon', -180, 180);
        params.radius_m = finite(params.radius_m, 'radius_m', 1, 1_000_000, 5000);
        params.limit = int(params.limit, 'limit', 1, 1000, 100);
        const rows = await nearbyEntities(env, org.id, params);
        return reply(request, env, { ok: true, service: SERVICE, entities: rows || [] });
      }

      if (path === '/v1/geo/events/nearby' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const params = queryParams(url);
        params.lat = finite(params.lat, 'lat', -90, 90);
        params.lon = finite(params.lon ?? params.lng, 'lon', -180, 180);
        params.radius_m = finite(params.radius_m, 'radius_m', 1, 2_000_000, 25000);
        params.limit = int(params.limit, 'limit', 1, 1000, 100);
        const rows = await nearbyEvents(env, org.id, params);
        return reply(request, env, { ok: true, service: SERVICE, events: rows || [] });
      }

      if (path === '/v1/geo/bbox' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const params = queryParams(url);
        params.min_lat = finite(params.min_lat, 'min_lat', -90, 90);
        params.min_lon = finite(params.min_lon, 'min_lon', -180, 180);
        params.max_lat = finite(params.max_lat, 'max_lat', -90, 90);
        params.max_lon = finite(params.max_lon, 'max_lon', -180, 180);
        if (params.min_lat > params.max_lat || params.min_lon > params.max_lon) throw new GeoAdapterError('bbox minimums must be lower than maximums', 400, 'invalid_parameter');
        params.limit = int(params.limit, 'limit', 1, 2000, 500);
        const rows = await entitiesInBbox(env, org.id, params);
        return reply(request, env, { ok: true, service: SERVICE, entities: rows || [] });
      }

      if (path === '/v1/geo/entities' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const rows = await listEntities(env, org.id, {
          source: url.searchParams.get('source') || null,
          entityType: url.searchParams.get('entity_type') || null,
          limit: int(url.searchParams.get('limit'), 'limit', 1, 1000, 100)
        });
        return reply(request, env, { ok: true, service: SERVICE, entities: rows || [] });
      }

      const entityMatch = path.match(/^\/v1\/geo\/entities\/([0-9a-f-]{36})$/i);
      if (entityMatch && request.method === 'GET') {
        if (!UUID_RE.test(entityMatch[1])) throw new GeoAdapterError('Invalid entity id', 400, 'invalid_parameter');
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const entity = await getEntity(env, org.id, entityMatch[1]);
        if (!entity) throw new GeoAdapterError('Spatial entity not found', 404, 'entity_not_found');
        return reply(request, env, { ok: true, service: SERVICE, entity });
      }

      if (path === '/v1/geo/ingestion-runs' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const rows = await listIngestionRuns(env, org.id, {
          source: url.searchParams.get('source') || null,
          limit: int(url.searchParams.get('limit'), 'limit', 1, 200, 50)
        });
        return reply(request, env, { ok: true, service: SERVICE, runs: rows || [] });
      }

      return fail(request, env, 'Spatial intelligence route not found', 404);
    } catch (error) {
      const status = Number(error?.status) || 500;
      return fail(
        request,
        env,
        error?.message || 'Spatial intelligence request failed',
        status,
        { code: error?.code || 'spatial_error', ...(error?.detail === undefined ? {} : { provider_detail: error.detail }) }
      );
    }
  }
};
