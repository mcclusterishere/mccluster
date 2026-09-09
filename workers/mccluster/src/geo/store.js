import { PERSISTENCE, sourceByKey } from './source-registry.js';
import { GeoAdapterError } from './adapters.js';

function configured(env) {
  return Boolean(env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY);
}

function headers(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra
  };
}

async function db(env, path, { method = 'GET', body, prefer, allow404 = false } = {}) {
  if (!configured(env)) throw new GeoAdapterError('McCluster database is not configured', 503, 'database_not_configured');
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: headers(env, prefer ? { prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (allow404 && response.status === 404) return null;
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    throw new GeoAdapterError('Spatial database request failed', response.status === 404 ? 503 : 502, 'database_error', {
      status: response.status,
      payload
    });
  }
  return payload;
}

export async function resolveHouseOrg(env) {
  const rows = await db(env, 'orgs?slug=eq.mccluster&enabled=eq.true&select=id,slug,name,kind&limit=1');
  const org = rows?.[0];
  if (!org) throw new GeoAdapterError('McCluster house organization is not configured', 503, 'house_org_missing');
  return org;
}

export async function schemaReady(env) {
  if (!configured(env)) return false;
  try {
    const rows = await db(env, 'geo_sources?select=source_key&limit=1');
    return Array.isArray(rows);
  } catch {
    return false;
  }
}

function wktPoint(value) {
  if (!value || !Number.isFinite(Number(value.lat)) || !Number.isFinite(Number(value.lon))) return null;
  return `POINT(${Number(value.lon)} ${Number(value.lat)})`;
}

function provenance(result, record) {
  return {
    provider: result.source,
    fetched_at: result.fetched_at,
    source_url: record?.source_url || result.source_url || null,
    attribution: result.attribution || null,
    persistence_policy: result.persistence
  };
}

function entityRow(orgId, result, item) {
  return {
    org_id: orgId,
    source_key: result.source,
    external_id: String(item.external_id),
    entity_type: item.entity_type || 'unknown',
    name: item.name || null,
    location: wktPoint(item.point),
    properties: item.properties || {},
    provenance: provenance(result, item),
    source_url: item.source_url || result.source_url || null,
    observed_at: item.observed_at || result.fetched_at,
    last_seen_at: result.fetched_at,
    updated_at: result.fetched_at
  };
}

function eventRow(orgId, result, item) {
  return {
    org_id: orgId,
    source_key: result.source,
    external_id: String(item.external_id),
    event_type: item.event_type || 'unknown',
    name: item.name || null,
    location: wktPoint(item.point),
    severity: Number.isFinite(Number(item.severity)) ? Number(item.severity) : null,
    status: item.status || null,
    starts_at: item.starts_at || null,
    ends_at: item.ends_at || null,
    observed_at: item.observed_at || result.fetched_at,
    properties: item.properties || {},
    provenance: provenance(result, item),
    source_url: item.source_url || result.source_url || null,
    updated_at: result.fetched_at
  };
}

function observationRow(orgId, result, item) {
  return {
    org_id: orgId,
    source_key: result.source,
    external_id: item.external_id ? String(item.external_id) : null,
    observation_type: item.observation_type || 'measurement',
    metric: item.metric || null,
    value_number: Number.isFinite(Number(item.value_number)) ? Number(item.value_number) : null,
    value_text: item.value_text === undefined || item.value_text === null ? null : String(item.value_text),
    unit: item.unit || null,
    location: wktPoint(item.point),
    observed_at: item.observed_at || result.fetched_at,
    payload: item.properties || {},
    provenance: provenance(result, item)
  };
}

async function startRun(env, orgId, result, operation, requestFingerprint = null) {
  const rows = await db(env, 'geo_ingestion_runs', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{
      org_id: orgId,
      source_key: result.source,
      operation,
      status: 'running',
      request_fingerprint: requestFingerprint,
      records_seen: result.records?.length || 0,
      metadata: { source_url: result.source_url, persistence: result.persistence }
    }]
  });
  return rows?.[0] || null;
}

async function finishRun(env, runId, patch) {
  if (!runId) return;
  await db(env, `geo_ingestion_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { ...patch, finished_at: new Date().toISOString() }
  });
}

async function upsertRows(env, table, rows, onConflict) {
  if (!rows.length) return [];
  return db(env, `${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: rows
  });
}

async function insertObservations(env, rows) {
  if (!rows.length) return [];
  return db(env, 'geo_observations?on_conflict=org_id,source_key,external_id', {
    method: 'POST',
    prefer: 'resolution=ignore-duplicates,return=representation',
    body: rows
  });
}

export async function persistAdapterResult(env, orgId, result, { operation = 'fetch', requestFingerprint = null, force = false, entitlement = null } = {}) {
  const source = sourceByKey(result.source);
  if (!source) throw new GeoAdapterError('Unknown spatial source', 404, 'unknown_source');

  if (source.persistence === PERSISTENCE.NONE) {
    return { persisted: false, reason: 'provider_content_must_not_be_stored', records_seen: result.records?.length || 0, records_written: 0 };
  }
  if (source.persistence === PERSISTENCE.TRANSIENT && !force) {
    return { persisted: false, reason: 'transient_provider', records_seen: result.records?.length || 0, records_written: 0 };
  }
  // force only overrides the registry default for a transient feed; it can
  // never override an org entitlement that withholds retention.
  if (entitlement && entitlement.persistence_allowed === false) {
    return { persisted: false, reason: 'entitlement_forbids_persistence', records_seen: result.records?.length || 0, records_written: 0 };
  }
  if (!await schemaReady(env)) throw new GeoAdapterError('Spatial database schema is not ready', 503, 'spatial_schema_not_ready');

  const run = await startRun(env, orgId, result, operation, requestFingerprint);
  try {
    const entities = (result.records || []).filter((item) => item.kind === 'entity').map((item) => entityRow(orgId, result, item));
    const events = (result.records || []).filter((item) => item.kind === 'event').map((item) => eventRow(orgId, result, item));
    const observations = (result.records || []).filter((item) => item.kind === 'observation').map((item) => observationRow(orgId, result, item));

    const [entityWrites, eventWrites, observationWrites] = await Promise.all([
      upsertRows(env, 'geo_entities', entities, 'org_id,source_key,external_id'),
      upsertRows(env, 'geo_events', events, 'org_id,source_key,external_id'),
      insertObservations(env, observations)
    ]);
    const written = (entityWrites?.length || 0) + (eventWrites?.length || 0) + (observationWrites?.length || 0);
    await finishRun(env, run?.id, { status: 'succeeded', records_written: written });
    return {
      persisted: true,
      ingestion_run_id: run?.id || null,
      records_seen: result.records?.length || 0,
      records_written: written,
      entities_written: entityWrites?.length || 0,
      events_written: eventWrites?.length || 0,
      observations_written: observationWrites?.length || 0
    };
  } catch (error) {
    await finishRun(env, run?.id, {
      status: 'failed',
      records_written: 0,
      error_code: error?.code || 'database_error',
      error_message: String(error?.message || error).slice(0, 500)
    }).catch(() => {});
    throw error;
  }
}

async function rpc(env, name, args) {
  return db(env, `rpc/${name}`, {
    method: 'POST',
    prefer: 'return=representation',
    body: args
  });
}

export async function nearbyEntities(env, orgId, params) {
  return rpc(env, 'geo_nearby', {
    p_org: orgId,
    p_lat: Number(params.lat),
    p_lon: Number(params.lon),
    p_radius_m: Number(params.radius_m || 5000),
    p_limit: Number(params.limit || 100),
    p_source: params.source || null,
    p_entity_type: params.entity_type || null
  });
}

export async function nearbyEvents(env, orgId, params) {
  return rpc(env, 'geo_events_nearby', {
    p_org: orgId,
    p_lat: Number(params.lat),
    p_lon: Number(params.lon),
    p_radius_m: Number(params.radius_m || 25000),
    p_limit: Number(params.limit || 100),
    p_source: params.source || null,
    p_event_type: params.event_type || null
  });
}

export async function entitiesInBbox(env, orgId, params) {
  return rpc(env, 'geo_bbox', {
    p_org: orgId,
    p_min_lat: Number(params.min_lat),
    p_min_lon: Number(params.min_lon),
    p_max_lat: Number(params.max_lat),
    p_max_lon: Number(params.max_lon),
    p_limit: Number(params.limit || 500),
    p_source: params.source || null
  });
}

export async function getEntity(env, orgId, id) {
  const rows = await db(env, `geo_entities?org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(id)}&select=id,source_key,external_id,entity_type,name,properties,provenance,source_url,observed_at,first_seen_at,last_seen_at,expires_at&limit=1`);
  return rows?.[0] || null;
}

export async function listEntities(env, orgId, { source, entityType, limit = 100 } = {}) {
  const parts = [
    `org_id=eq.${encodeURIComponent(orgId)}`,
    'select=id,source_key,external_id,entity_type,name,properties,provenance,source_url,observed_at,first_seen_at,last_seen_at,expires_at',
    'order=last_seen_at.desc',
    `limit=${Math.max(1, Math.min(Number(limit) || 100, 1000))}`
  ];
  if (source) parts.push(`source_key=eq.${encodeURIComponent(source)}`);
  if (entityType) parts.push(`entity_type=eq.${encodeURIComponent(entityType)}`);
  return db(env, `geo_entities?${parts.join('&')}`);
}

export async function listIngestionRuns(env, orgId, { source, limit = 50 } = {}) {
  const parts = [
    `org_id=eq.${encodeURIComponent(orgId)}`,
    'select=id,source_key,operation,status,records_seen,records_written,error_code,error_message,started_at,finished_at',
    'order=started_at.desc',
    `limit=${Math.max(1, Math.min(Number(limit) || 50, 200))}`
  ];
  if (source) parts.push(`source_key=eq.${encodeURIComponent(source)}`);
  return db(env, `geo_ingestion_runs?${parts.join('&')}`);
}

/*
  Entitlement rows. Absent rows are not an error: the registry default in
  entitlements.js applies, so open data works the moment the schema exists and
  restricted lanes stay closed until the owner writes a grant.
*/
export async function entitlementRows(env, orgId, sourceKey = null) {
  if (!configured(env)) return new Map();
  const parts = [
    `org_id=eq.${encodeURIComponent(orgId)}`,
    'select=source_key,enabled,lane,commercial_use,public_display,redistribution,persistence_allowed,terms_acknowledged_at,effective_at,expires_at'
  ];
  if (sourceKey) parts.push(`source_key=eq.${encodeURIComponent(sourceKey)}`);
  try {
    const rows = await db(env, `geo_source_entitlements?${parts.join('&')}`);
    return new Map((rows || []).map((row) => [row.source_key, row]));
  } catch {
    // A missing schema must not stop a keyless open-data read.
    return new Map();
  }
}

/*
  History. geo_entities holds current state; geo_entity_revisions is the append
  only record of how that state got there, and geo_observations is the metric
  timeline. An entity's history is the merge of both, newest first.
*/
export async function entityRevisions(env, orgId, entityId, limit = 100) {
  return db(env, `geo_entity_revisions?org_id=eq.${encodeURIComponent(orgId)}&entity_id=eq.${encodeURIComponent(entityId)}&select=id,revision,change_type,name,entity_type,properties,provenance,source_url,observed_at,recorded_at&order=revision.desc&limit=${Math.max(1, Math.min(Number(limit) || 100, 500))}`);
}

export async function entityObservations(env, orgId, entityId, limit = 200) {
  return db(env, `geo_observations?org_id=eq.${encodeURIComponent(orgId)}&entity_id=eq.${encodeURIComponent(entityId)}&select=id,source_key,external_id,observation_type,metric,value_number,value_text,unit,observed_at,provenance&order=observed_at.desc&limit=${Math.max(1, Math.min(Number(limit) || 200, 1000))}`);
}

export async function timelineNearby(env, orgId, params) {
  return rpc(env, 'geo_timeline', {
    p_org: orgId,
    p_lat: Number(params.lat),
    p_lon: Number(params.lon),
    p_radius_m: Number(params.radius_m || 25000),
    p_from: params.from || null,
    p_to: params.to || null,
    p_limit: Number(params.limit || 200),
    p_source: params.source || null
  });
}

export async function listProjects(env, orgId, limit = 100) {
  return db(env, `geo_projects?org_id=eq.${encodeURIComponent(orgId)}&select=id,project_key,name,description,settings,created_at,updated_at&order=created_at.desc&limit=${Math.max(1, Math.min(Number(limit) || 100, 200))}`);
}

export async function listLayers(env, orgId, limit = 200) {
  return db(env, `geo_layers?org_id=eq.${encodeURIComponent(orgId)}&select=id,layer_key,name,source_key,layer_type,enabled,style,settings&order=layer_key.asc&limit=${Math.max(1, Math.min(Number(limit) || 200, 500))}`);
}
