import { fail, reply } from '../lib/http.js';
import { adapterCapabilities, GeoAdapterError } from './adapters.js';
import { AccessError, accessConfigured, verifyAccess } from './access.js';
import { assertConsumable, effectiveEntitlement, entitlementCatalog, LANES, normalizeLane, sourceOrThrow } from './entitlements.js';
import { executeProvider } from './gateway.js';
import { SOURCES, sourceByKey, sourceCatalog, sourceConfigured } from './source-registry.js';
import {
  entitiesInBbox,
  entitlementRows,
  entityObservations,
  entityRevisions,
  getEntity,
  listEntities,
  listIngestionRuns,
  listLayers,
  listProjects,
  nearbyEntities,
  nearbyEvents,
  persistAdapterResult,
  resolveHouseOrg,
  schemaReady,
  timelineNearby
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
    credentialed_sources_pending: credentialed.length - configured.length,
    pending_bindings: credentialed
      .filter((source) => !source.configured)
      .flatMap((source) => source.credential_bindings)
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

function isoOrNull(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.valueOf())) throw new GeoAdapterError(`${name} must be an ISO timestamp`, 400, 'invalid_parameter');
  return parsed.toISOString();
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

/*
  Every data route passes through here. Cloudflare Access first when the edge is
  configured, then the McCluster house-owner check, then the org's entitlements.
  Neither lock is skippable by a query parameter.
*/
async function protectedContext(request, env, options, { requireSchema = false, lane = null } = {}) {
  const access = await verifyAccess(request, env);
  const user = await requireOwner(request, env, options);
  const org = await resolveHouseOrg(env);
  if (requireSchema && !await schemaReady(env)) {
    throw new GeoAdapterError('Spatial database schema is not ready', 503, 'spatial_schema_not_ready');
  }
  return { access, user, org, lane: lane === null ? null : normalizeLane(lane) };
}

async function requestFingerprint(source, body) {
  const bytes = new TextEncoder().encode(JSON.stringify({ source, body }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function responseResult(result, { includeRaw = false, persistence = null, entitlement = null } = {}) {
  const payload = {
    source: result.source,
    operation: result.operation,
    fetched_at: result.fetched_at,
    source_url: result.source_url,
    attribution: result.attribution,
    persistence_policy: result.persistence,
    records: result.records || [],
    persistence,
    entitlement
  };
  for (const [key, value] of Object.entries(result)) {
    if (['source', 'operation', 'fetched_at', 'source_url', 'attribution', 'persistence', 'records', 'raw'].includes(key)) continue;
    payload[key] = value;
  }
  if (includeRaw) payload.raw = result.raw;
  return payload;
}

async function fetchAndMaybePersist(request, env, options, sourceKey, mode) {
  const source = sourceOrThrow(sourceKey);
  const body = await jsonBody(request);
  const lane = normalizeLane(body.lane);
  const { org } = await protectedContext(request, env, options);

  const rows = await entitlementRows(env, org.id, sourceKey);
  const entitlement = effectiveEntitlement(source, rows.get(sourceKey));
  assertConsumable(entitlement, lane);

  const result = await executeProvider(sourceKey, body, env);
  const shouldPersist = mode === 'ingest' || body.persist !== false;
  let persistence = {
    persisted: false,
    reason: shouldPersist ? 'not_persistable' : 'disabled_by_request',
    records_seen: result.records?.length || 0,
    records_written: 0
  };

  if (shouldPersist) {
    const fingerprint = await requestFingerprint(sourceKey, body);
    persistence = await persistAdapterResult(env, org.id, result, {
      operation: result.operation || mode,
      requestFingerprint: fingerprint,
      force: false,
      entitlement
    });
  }

  return reply(request, env, {
    ok: true,
    service: SERVICE,
    org: { id: org.id, slug: org.slug },
    lane,
    result: responseResult(result, {
      includeRaw: body.include_raw === true,
      persistence,
      entitlement: {
        origin: entitlement.origin,
        source_class: entitlement.source_class,
        commercial_use: entitlement.commercial_use,
        public_display: entitlement.public_display,
        redistribution: entitlement.redistribution,
        persistence_allowed: entitlement.persistence_allowed,
        attribution_required: entitlement.attribution_required,
        attribution: entitlement.attribution
      }
    })
  }, mode === 'ingest' && persistence.persisted ? 201 : 200);
}

function queryParams(url) {
  return Object.fromEntries(url.searchParams.entries());
}

async function aisSnapshot(request, env, options, url, restart = false) {
  await protectedContext(request, env, options);
  if (!env.HereTenantAgent) throw new GeoAdapterError('Tenant agent Durable Object binding is unavailable', 503, 'durable_object_unavailable');

  const internalUrl = new URL(restart
    ? 'https://internal.mccluster/internal/seek-first/ais/restart'
    : 'https://internal.mccluster/internal/seek-first/ais/snapshot');
  if (!restart) {
    const limit = int(url.searchParams.get('limit'), 'limit', 1, 5000, 1000);
    internalUrl.searchParams.set('limit', String(limit));
    const bbox = url.searchParams.get('bbox');
    if (bbox) {
      const values = String(bbox).split(',').map(Number);
      if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
        throw new GeoAdapterError('bbox must be min_lon,min_lat,max_lon,max_lat', 400, 'invalid_parameter');
      }
      finite(values[0], 'min_lon', -180, 180);
      finite(values[1], 'min_lat', -90, 90);
      finite(values[2], 'max_lon', -180, 180);
      finite(values[3], 'max_lat', -90, 90);
      internalUrl.searchParams.set('bbox', values.join(','));
    }
  }

  const id = env.HereTenantAgent.idFromName('seek-first:ais:mccluster');
  const stub = env.HereTenantAgent.get(id);
  const response = await stub.fetch(new Request(internalUrl, { method: restart ? 'POST' : 'GET' }));
  if (!response.ok) throw new GeoAdapterError('AIS live cache request failed', 502, 'ais_cache_error');
  const data = await response.json();
  return reply(request, env, {
    ok: true,
    service: SERVICE,
    source: 'aisstream',
    persistence_policy: 'transient',
    attribution: sourceByKey('aisstream')?.attribution || null,
    ...data
  });
}

/*
  Viewer configuration.

  Adapter secrets (Census, EIA, FIRMS, AISStream, TomTom, OpenSky, Copernicus,
  Planet, ...) are server-side only and never appear here. Google Maps and
  Cesium ion are different in kind: they are browser-side credentials that the
  globe cannot use unless the browser holds them. They are released only to a
  verified house owner, over an already-authenticated request, and the owner is
  expected to scope them (HTTP-referrer restriction on the Google key, a
  read-only scoped ion token). Everything else the console needs is a boolean.
*/
function viewerConfig(env) {
  const google = Boolean(env.GOOGLE_MAPS_API_KEY);
  const cesium = Boolean(env.CESIUM_ION_TOKEN);
  return {
    keyless: !google && !cesium,
    basemap: {
      // Always available. The console boots on this and only this.
      openstreetmap: {
        url: 'https://tile.openstreetmap.org/',
        attribution: '© OpenStreetMap contributors',
        note: 'Subject to the OSM tile usage policy. Move to Mapbox or a self-hosted tile source for heavy use.'
      }
    },
    google_photorealistic_3d_tiles: {
      available: google,
      api_key: google ? env.GOOGLE_MAPS_API_KEY : null,
      required_binding: 'GOOGLE_MAPS_API_KEY',
      url: 'https://tile.googleapis.com/v1/3dtiles/root.json',
      note: 'Restrict this key by HTTP referrer. Google map content must not be persisted.'
    },
    cesium_ion: {
      available: cesium,
      token: cesium ? env.CESIUM_ION_TOKEN : null,
      required_binding: 'CESIUM_ION_TOKEN',
      note: 'Use a scoped read-only ion token. World Terrain and ion assets need it; the ellipsoid fallback does not.'
    },
    layers: SOURCES.map((source) => ({
      key: source.key,
      name: source.name,
      capabilities: source.capabilities,
      source_class: source.sourceClass,
      persistence: source.persistence,
      transport: source.transport,
      attribution: source.attribution,
      credential_required: source.credentialEnv.length > 0,
      credential_bindings: source.credentialEnv,
      configured: sourceConfigured(source, env)
    }))
  };
}

export default {
  async fetch(request, env, options = {}) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      /*
        The only unauthenticated route. It says whether the subsystem is up and
        nothing about which providers are keyed — that inventory is a map of
        where the credentials are, so it lives behind the owner check.
      */
      if ((path === '/v1/seek-first' || path === '/v1/seek-first/health') && request.method === 'GET') {
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          mode: await schemaReady(env) ? 'live' : 'adapter-ready',
          adapter_gateway_ready: true,
          edge_access_configured: accessConfigured(env),
          upstream_reference: UPSTREAM,
          upstream_commit: UPSTREAM_COMMIT
        });
      }

      if (path === '/v1/seek-first/sources' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options);
        const lane = normalizeLane(url.searchParams.get('lane'));
        const rows = await entitlementRows(env, org.id);
        const decorate = entitlementCatalog(rows, lane);
        const catalog = sourceCatalog(env);
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          lane,
          sources: catalog.map((entry) => {
            const source = sourceByKey(entry.key);
            const decision = decorate(source);
            return {
              ...entry,
              entitlement: {
                origin: decision.origin,
                allowed: decision.allowed,
                denied_reason: decision.denied_reason,
                consumable_by: decision.consumable_by,
                commercial_use: decision.commercial_use,
                public_display: decision.public_display,
                redistribution: decision.redistribution,
                persistence_allowed: decision.persistence_allowed,
                expires_at: decision.expires_at
              }
            };
          })
        });
      }

      if (path === '/v1/seek-first/entitlements' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options);
        const lane = normalizeLane(url.searchParams.get('lane'));
        const rows = await entitlementRows(env, org.id);
        const decorate = entitlementCatalog(rows, lane);
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          org: { id: org.id, slug: org.slug },
          lane,
          lanes: Object.values(LANES),
          entitlements: SOURCES.map(decorate)
        });
      }

      if (path === '/v1/seek-first/readiness' && request.method === 'GET') {
        await protectedContext(request, env, options);
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          database_schema_ready: await schemaReady(env),
          edge_access_configured: accessConfigured(env),
          adapter_capabilities: adapterCapabilities(),
          readiness: readiness(env)
        });
      }

      if (path === '/v1/seek-first/viewer/config' && request.method === 'GET') {
        await protectedContext(request, env, options);
        return reply(request, env, { ok: true, service: SERVICE, config: viewerConfig(env) });
      }

      if (path === '/v1/seek-first/capabilities' && request.method === 'GET') {
        await protectedContext(request, env, options);
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          upstream_reference: UPSTREAM,
          upstream_commit: UPSTREAM_COMMIT,
          adapters: adapterCapabilities(),
          lanes: Object.values(LANES),
          routes: {
            health: 'GET /v1/seek-first/health',
            readiness: 'GET /v1/seek-first/readiness',
            sources: 'GET /v1/seek-first/sources?lane=',
            entitlements: 'GET /v1/seek-first/entitlements?lane=',
            viewer_config: 'GET /v1/seek-first/viewer/config',
            fetch: 'POST /v1/seek-first/fetch/:source',
            ingest: 'POST /v1/seek-first/ingest/:source',
            entities: 'GET /v1/seek-first/entities',
            entity: 'GET /v1/seek-first/entities/:id',
            entity_history: 'GET /v1/seek-first/entities/:id/history',
            nearby: 'GET /v1/seek-first/nearby',
            bbox: 'GET /v1/seek-first/bbox',
            events_nearby: 'GET /v1/seek-first/events/nearby',
            timeline: 'GET /v1/seek-first/timeline',
            projects: 'GET /v1/seek-first/projects',
            layers: 'GET /v1/seek-first/layers',
            ingestion_runs: 'GET /v1/seek-first/ingestion-runs',
            live_ais: 'GET /v1/seek-first/live/ais',
            live_ais_restart: 'POST /v1/seek-first/live/ais/restart'
          }
        });
      }

      const providerMatch = path.match(/^\/v1\/seek-first\/(fetch|ingest)\/([a-z0-9_-]+)$/i);
      if (providerMatch && request.method === 'POST') {
        return await fetchAndMaybePersist(request, env, options, providerMatch[2], providerMatch[1]);
      }

      if (path === '/v1/seek-first/live/ais' && request.method === 'GET') {
        return await aisSnapshot(request, env, options, url, false);
      }
      if (path === '/v1/seek-first/live/ais/restart' && request.method === 'POST') {
        return await aisSnapshot(request, env, options, url, true);
      }

      if (path === '/v1/seek-first/nearby' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const params = queryParams(url);
        params.lat = finite(params.lat, 'lat', -90, 90);
        params.lon = finite(params.lon ?? params.lng, 'lon', -180, 180);
        params.radius_m = finite(params.radius_m, 'radius_m', 1, 1_000_000, 5000);
        params.limit = int(params.limit, 'limit', 1, 1000, 100);
        const rows = await nearbyEntities(env, org.id, params);
        return reply(request, env, { ok: true, service: SERVICE, entities: rows || [] });
      }

      if (path === '/v1/seek-first/events/nearby' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const params = queryParams(url);
        params.lat = finite(params.lat, 'lat', -90, 90);
        params.lon = finite(params.lon ?? params.lng, 'lon', -180, 180);
        params.radius_m = finite(params.radius_m, 'radius_m', 1, 2_000_000, 25000);
        params.limit = int(params.limit, 'limit', 1, 1000, 100);
        const rows = await nearbyEvents(env, org.id, params);
        return reply(request, env, { ok: true, service: SERVICE, events: rows || [] });
      }

      if (path === '/v1/seek-first/timeline' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const params = queryParams(url);
        params.lat = finite(params.lat, 'lat', -90, 90);
        params.lon = finite(params.lon ?? params.lng, 'lon', -180, 180);
        params.radius_m = finite(params.radius_m, 'radius_m', 1, 2_000_000, 25000);
        params.from = isoOrNull(params.from, 'from');
        params.to = isoOrNull(params.to, 'to');
        params.limit = int(params.limit, 'limit', 1, 2000, 200);
        const rows = await timelineNearby(env, org.id, params);
        return reply(request, env, { ok: true, service: SERVICE, timeline: rows || [] });
      }

      if (path === '/v1/seek-first/bbox' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const params = queryParams(url);
        params.min_lat = finite(params.min_lat, 'min_lat', -90, 90);
        params.min_lon = finite(params.min_lon, 'min_lon', -180, 180);
        params.max_lat = finite(params.max_lat, 'max_lat', -90, 90);
        params.max_lon = finite(params.max_lon, 'max_lon', -180, 180);
        if (params.min_lat > params.max_lat || params.min_lon > params.max_lon) {
          throw new GeoAdapterError('bbox minimums must be lower than maximums', 400, 'invalid_parameter');
        }
        params.limit = int(params.limit, 'limit', 1, 2000, 500);
        const rows = await entitiesInBbox(env, org.id, params);
        return reply(request, env, { ok: true, service: SERVICE, entities: rows || [] });
      }

      if (path === '/v1/seek-first/entities' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const rows = await listEntities(env, org.id, {
          source: url.searchParams.get('source') || null,
          entityType: url.searchParams.get('entity_type') || null,
          limit: int(url.searchParams.get('limit'), 'limit', 1, 1000, 100)
        });
        return reply(request, env, { ok: true, service: SERVICE, entities: rows || [] });
      }

      const historyMatch = path.match(/^\/v1\/seek-first\/entities\/([0-9a-f-]{36})\/history$/i);
      if (historyMatch && request.method === 'GET') {
        if (!UUID_RE.test(historyMatch[1])) throw new GeoAdapterError('Invalid entity id', 400, 'invalid_parameter');
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const entity = await getEntity(env, org.id, historyMatch[1]);
        if (!entity) throw new GeoAdapterError('Spatial entity not found', 404, 'entity_not_found');
        const limit = int(url.searchParams.get('limit'), 'limit', 1, 500, 100);
        const [revisions, observations] = await Promise.all([
          entityRevisions(env, org.id, entity.id, limit),
          entityObservations(env, org.id, entity.id, limit * 2)
        ]);
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          entity,
          revisions: revisions || [],
          observations: observations || []
        });
      }

      const entityMatch = path.match(/^\/v1\/seek-first\/entities\/([0-9a-f-]{36})$/i);
      if (entityMatch && request.method === 'GET') {
        if (!UUID_RE.test(entityMatch[1])) throw new GeoAdapterError('Invalid entity id', 400, 'invalid_parameter');
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const entity = await getEntity(env, org.id, entityMatch[1]);
        if (!entity) throw new GeoAdapterError('Spatial entity not found', 404, 'entity_not_found');
        return reply(request, env, { ok: true, service: SERVICE, entity });
      }

      if (path === '/v1/seek-first/projects' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const rows = await listProjects(env, org.id, int(url.searchParams.get('limit'), 'limit', 1, 200, 100));
        return reply(request, env, { ok: true, service: SERVICE, projects: rows || [] });
      }

      if (path === '/v1/seek-first/layers' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const rows = await listLayers(env, org.id, int(url.searchParams.get('limit'), 'limit', 1, 500, 200));
        return reply(request, env, { ok: true, service: SERVICE, layers: rows || [] });
      }

      if (path === '/v1/seek-first/ingestion-runs' && request.method === 'GET') {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const rows = await listIngestionRuns(env, org.id, {
          source: url.searchParams.get('source') || null,
          limit: int(url.searchParams.get('limit'), 'limit', 1, 200, 50)
        });
        return reply(request, env, { ok: true, service: SERVICE, runs: rows || [] });
      }

      return fail(request, env, 'Spatial intelligence route not found', 404);
    } catch (error) {
      if (error instanceof AccessError) {
        return fail(request, env, error.message, error.status, { code: error.code });
      }
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
