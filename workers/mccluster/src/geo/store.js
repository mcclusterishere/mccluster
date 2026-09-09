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

export async function persistAdapterResult(env, orgId, result, { operation = 'fetch', requestFingerprint = null, force = false } = {}) {
  const source = sourceByKey(result.source);
  if (!source) throw new GeoAdapterError('Unknown spatial source', 404, 'unknown_source');

  if (source.persistence === PERSISTENCE.NONE) {
    return { persisted: false, reason: 'provider_content_must_not_be_stored', records_seen: result.records?.length || 0, records_written: 0 };
  }
  if (source.persistence === PERSISTENCE.TRANSIENT && !force) {
    return { persisted: false, reason: 'transient_provider', records_seen: result.records?.length || 0, records_written: 0 };
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

async function trySelect(env, path) {
  if (!configured(env)) return { rows: [], missing: true };
  try {
    const payload = await db(env, path, { allow404: true });
    if (payload === null) return { rows: [], missing: true };
    return { rows: Array.isArray(payload) ? payload : [], missing: false };
  } catch {
    return { rows: [], missing: true };
  }
}

function coordsFrom(value) {
  const lat = Number(value?.lat ?? value?.latitude ?? value?.metadata?.lat);
  const lon = Number(value?.lon ?? value?.lng ?? value?.longitude ?? value?.metadata?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function entityRecord({ externalId, entityType, name, point, properties }) {
  return {
    kind: 'entity',
    external_id: String(externalId),
    entity_type: entityType || 'unknown',
    name: name || null,
    point: point || null,
    properties: properties || {},
    source_url: null,
    observed_at: null
  };
}

function facilityRecord(row) {
  return entityRecord({
    externalId: row.facility_key || row.external_id || row.id,
    entityType: row.kind || row.entity_type || 'facility',
    name: row.name,
    point: coordsFrom(row),
    properties: {
      city: row.city || null,
      region: row.region || null,
      visibility: row.visibility || 'internal',
      source_key: row.source_key || null,
      ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {})
    }
  });
}

function projectedOrgRecord(row) {
  const point = coordsFrom(row.settings) || coordsFrom(row);
  return entityRecord({
    externalId: row.slug || row.id,
    entityType: row.kind || 'org',
    name: row.name,
    point,
    properties: {
      slug: row.slug || null,
      kind: row.kind || null,
      projected_from: 'orgs'
    }
  });
}

function projectedEuOrgRecord(row) {
  return entityRecord({
    externalId: row.domain || row.id,
    entityType: row.kind || 'stakeholder',
    name: row.name,
    point: coordsFrom(row.metadata) || coordsFrom(row),
    properties: {
      jurisdiction: row.jurisdiction || null,
      domain: row.domain || null,
      projected_from: 'eu_stakeholder_orgs'
    }
  });
}

function projectedResearchRecord(row) {
  return entityRecord({
    externalId: row.slug || row.id,
    entityType: 'research-project',
    name: row.title || row.name,
    point: coordsFrom(row.settings) || coordsFrom(row),
    properties: {
      status: row.status || null,
      visibility: row.visibility || 'internal',
      projected_from: 'eu_research_projects'
    }
  });
}

export async function loadAuthoritativeEntities(env, sourceKey) {
  if (!configured(env)) {
    return { records: [], sites: [], arcs: [], authoritative: false, authority: 'unavailable' };
  }

  const facilities = await trySelect(
    env,
    `facilities?source_key=eq.${encodeURIComponent(sourceKey)}&select=facility_key,name,kind,city,region,lat,lon,visibility,source_key,metadata&order=facility_key.asc`
  );
  if (!facilities.missing && facilities.rows.length) {
    const records = facilities.rows.map(facilityRecord);
    return { records, sites: records, arcs: [], authoritative: true, authority: 'facilities' };
  }

  const entities = await trySelect(
    env,
    `geo_entities?source_key=eq.${encodeURIComponent(sourceKey)}&select=external_id,entity_type,name,properties,source_url,observed_at&order=external_id.asc&limit=500`
  );
  if (!entities.missing && entities.rows.length) {
    const records = entities.rows.map((row) => entityRecord({
      externalId: row.external_id,
      entityType: row.entity_type,
      name: row.name,
      point: coordsFrom(row.properties),
      properties: row.properties || {}
    }));
    return { records, sites: records, arcs: [], authoritative: true, authority: 'geo_entities' };
  }

  const projected = [];
  if (sourceKey === 'house') {
    const orgs = await trySelect(env, 'orgs?enabled=eq.true&select=id,slug,name,kind,settings&order=slug.asc');
    if (!orgs.missing) projected.push(...orgs.rows.map(projectedOrgRecord));
  }
  if (sourceKey === 'equity_uprise') {
    const stakeholders = await trySelect(env, 'eu_stakeholder_orgs?select=id,name,kind,jurisdiction,domain,metadata&order=name.asc&limit=500');
    if (!stakeholders.missing) projected.push(...stakeholders.rows.map(projectedEuOrgRecord));
    const research = await trySelect(env, 'eu_research_projects?select=id,slug,title,status,visibility,settings&order=slug.asc&limit=500');
    if (!research.missing) projected.push(...research.rows.map(projectedResearchRecord));
  }

  if (projected.length) {
    return { records: projected, sites: projected, arcs: [], authoritative: true, authority: 'projected' };
  }

  return {
    records: [],
    sites: [],
    arcs: [],
    authoritative: !facilities.missing,
    authority: facilities.missing ? 'unavailable' : 'empty'
  };
}

export async function loadInternalPlane(env) {
  if (!configured(env)) {
    return { sites: [], arcs: [], authoritative: false, authority: 'unavailable' };
  }

  const facilities = await trySelect(
    env,
    'facilities?select=facility_key,name,kind,city,region,lat,lon,visibility,source_key,metadata&order=source_key.asc,facility_key.asc'
  );
  if (!facilities.missing) {
    const sites = facilities.rows.map((row) => ({
      id: row.facility_key,
      layer: row.source_key || row.kind || 'house',
      name: row.name,
      city: row.city || null,
      lat: coordsFrom(row)?.lat ?? null,
      lon: coordsFrom(row)?.lon ?? null,
      visibility: row.visibility || 'internal',
      detail: row.metadata?.detail || null,
      sources: row.metadata?.sources || [row.source_key].filter(Boolean)
    }));
    const links = await trySelect(
      env,
      'facility_links?select=source_facility_key,target_facility_key,relationship_type&order=source_facility_key.asc'
    );
    const arcs = (links.rows || []).map((row) => [row.source_facility_key, row.target_facility_key]);
    return {
      sites,
      arcs,
      authoritative: true,
      authority: 'facilities'
    };
  }

  const house = await loadAuthoritativeEntities(env, 'house');
  const policy = await loadAuthoritativeEntities(env, 'equity_uprise');
  const research = await loadAuthoritativeEntities(env, 'scsu_docket');
  const records = [...house.records, ...policy.records, ...research.records];
  return {
    sites: records.map((row) => ({
      id: row.external_id,
      layer: row.entity_type,
      name: row.name,
      city: row.properties?.city || null,
      lat: row.point?.lat ?? null,
      lon: row.point?.lon ?? null,
      visibility: row.properties?.visibility || 'internal',
      detail: row.properties?.detail || null,
      sources: row.properties?.sources || []
    })),
    arcs: [],
    authoritative: house.authoritative || policy.authoritative || research.authoritative,
    authority: [house.authority, policy.authority, research.authority].find((value) => value && value !== 'unavailable' && value !== 'empty') || 'empty'
  };
}

