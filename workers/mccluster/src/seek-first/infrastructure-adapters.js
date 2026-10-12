import { sourceByKey } from './source-registry.js';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_ROWS = 1000;

export class InfrastructureAdapterError extends Error {
  constructor(message, status = 400, code = 'infrastructure_adapter_error', detail = undefined) {
    super(message);
    this.name = 'InfrastructureAdapterError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function finite(value, name, min, max, required = true) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new InfrastructureAdapterError(`${name} must be between ${min} and ${max}`, 400, 'invalid_parameter');
  }
  return number;
}

function integer(value, name, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new InfrastructureAdapterError(`${name} must be an integer between ${min} and ${max}`, 400, 'invalid_parameter');
  }
  return number;
}

function boundedText(value, max = 160) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function point(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function timestamp(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed.toISOString();
}

function normalizeBbox(input, { required = false, maxSpan = 25 } = {}) {
  const raw = input?.bbox;
  let values = null;
  if (Array.isArray(raw)) values = raw.map(Number);
  else if (typeof raw === 'string' && raw.trim()) values = raw.split(',').map(Number);
  else if ([input?.min_lon, input?.min_lat, input?.max_lon, input?.max_lat].every((value) => value !== undefined)) {
    values = [input.min_lon, input.min_lat, input.max_lon, input.max_lat].map(Number);
  }

  if (!values) {
    if (required) throw new InfrastructureAdapterError('bbox is required', 400, 'bbox_required');
    return null;
  }
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new InfrastructureAdapterError('bbox must be min_lon,min_lat,max_lon,max_lat', 400, 'invalid_parameter');
  }
  const [minLon, minLat, maxLon, maxLat] = values;
  finite(minLon, 'min_lon', -180, 180);
  finite(maxLon, 'max_lon', -180, 180);
  finite(minLat, 'min_lat', -90, 90);
  finite(maxLat, 'max_lat', -90, 90);
  if (minLon >= maxLon || minLat >= maxLat) {
    throw new InfrastructureAdapterError('bbox minimums must be lower than maximums', 400, 'invalid_parameter');
  }
  if (maxLon - minLon > maxSpan || maxLat - minLat > maxSpan) {
    throw new InfrastructureAdapterError(`bbox span must be ${maxSpan} degrees or less`, 400, 'bbox_too_large');
  }
  return { minLon, minLat, maxLon, maxLat };
}

async function jsonFetch(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'McCluster-Spatial/1.0 (https://mccluster.org)',
        ...headers,
      },
    });
    if (!response.ok) {
      throw new InfrastructureAdapterError(
        `Infrastructure provider request failed with ${response.status}`,
        response.status === 429 ? 429 : 502,
        'provider_error',
        { provider_status: response.status },
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof InfrastructureAdapterError) throw error;
    if (error?.name === 'AbortError') {
      throw new InfrastructureAdapterError('Infrastructure provider request timed out', 504, 'provider_timeout');
    }
    throw new InfrastructureAdapterError('Infrastructure provider request failed', 502, 'provider_network_error');
  } finally {
    clearTimeout(timer);
  }
}

function result(sourceKey, operation, sourceUrl, records, extra = {}) {
  const source = sourceByKey(sourceKey);
  return {
    source: sourceKey,
    operation,
    fetched_at: new Date().toISOString(),
    source_url: sourceUrl,
    attribution: source?.attribution || null,
    persistence: source?.persistence || 'transient',
    records: Array.isArray(records) ? records.slice(0, MAX_ROWS) : [],
    raw: null,
    ...extra,
  };
}

function entity(fields) {
  return { kind: 'entity', ...fields };
}

/**
 * PeeringDB facility discovery. Numeric API filters are deliberately applied
 * upstream so a viewport request never downloads the global facility table.
 * PeeringDB's acceptable-use rules are represented by the source registry's
 * NONPROFIT lane; this adapter never silently upgrades that permission.
 */
async function peeringDb(input = {}, env = {}) {
  const bbox = normalizeBbox(input, { required: false, maxSpan: 40 });
  const limit = integer(input.limit, 'limit', 1, 500, 250);
  const url = new URL('https://www.peeringdb.com/api/fac');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('depth', '0');
  if (bbox) {
    url.searchParams.set('latitude__gte', String(bbox.minLat));
    url.searchParams.set('latitude__lte', String(bbox.maxLat));
    url.searchParams.set('longitude__gte', String(bbox.minLon));
    url.searchParams.set('longitude__lte', String(bbox.maxLon));
  }
  if (input.country) url.searchParams.set('country', String(input.country).trim().toUpperCase().slice(0, 2));
  if (input.state) url.searchParams.set('state', String(input.state).trim().slice(0, 32));
  if (input.city) url.searchParams.set('city', String(input.city).trim().slice(0, 80));

  const headers = env.PEERINGDB_API_KEY
    ? { authorization: `Api-Key ${env.PEERINGDB_API_KEY}` }
    : {};
  const data = await jsonFetch(url, { headers });
  const rows = Array.isArray(data?.data) ? data.data : [];
  const records = rows.map((facility) => entity({
    external_id: `pdb:fac:${facility.id}`,
    entity_type: 'internet_facility',
    name: boundedText(facility.name, 220) || `PeeringDB Facility ${facility.id}`,
    point: point(facility.latitude, facility.longitude),
    observed_at: timestamp(facility.updated),
    source_url: facility.id ? `https://www.peeringdb.com/fac/${facility.id}` : null,
    properties: {
      peeringdb_id: facility.id ?? null,
      org_id: facility.org_id ?? null,
      org_name: boundedText(facility.org_name, 220),
      aka: boundedText(facility.aka, 220),
      city: boundedText(facility.city, 120),
      state: boundedText(facility.state, 80),
      country: boundedText(facility.country, 8),
      address1: boundedText(facility.address1, 240),
      address2: boundedText(facility.address2, 240),
      zipcode: boundedText(facility.zipcode, 32),
      website: boundedText(facility.website, 500),
      clli: boundedText(facility.clli, 32),
      net_count: Number.isFinite(Number(facility.net_count)) ? Number(facility.net_count) : null,
      ix_count: Number.isFinite(Number(facility.ix_count)) ? Number(facility.ix_count) : null,
      status: boundedText(facility.status, 32),
      geo_method: 'provider_coordinate',
      geo_precision_m: 100,
      geo_confidence: 0.92,
    },
  })).filter((row) => row.point !== null);

  return result('peeringdb', 'facilities', url.toString(), records, {
    provider_count: rows.length,
    mapped_count: records.length,
    bbox: bbox ? [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat] : null,
  });
}

/**
 * RIPE Atlas public probe discovery. The service intentionally obfuscates probe
 * coordinates; that fact travels with every normalized row so Halo never
 * presents an 80-400m privacy offset as a surveyed device location.
 */
async function ripeAtlas(input = {}) {
  const bbox = normalizeBbox(input, { required: true, maxSpan: 20 });
  const limit = integer(input.limit, 'limit', 1, 500, 250);
  const url = new URL('https://atlas.ripe.net/api/v2/probes/');
  url.searchParams.set('page_size', String(limit));
  url.searchParams.set('latitude__gte', String(bbox.minLat));
  url.searchParams.set('latitude__lte', String(bbox.maxLat));
  url.searchParams.set('longitude__gte', String(bbox.minLon));
  url.searchParams.set('longitude__lte', String(bbox.maxLon));
  if (input.connected_only !== false) url.searchParams.set('status', '2');
  if (input.anchor_only === true) url.searchParams.set('is_anchor', 'true');
  if (input.country_code) url.searchParams.set('country_code', String(input.country_code).trim().toUpperCase().slice(0, 2));

  const data = await jsonFetch(url);
  const rows = Array.isArray(data?.results) ? data.results : [];
  const records = rows.map((probe) => {
    const coordinates = Array.isArray(probe?.geometry?.coordinates) ? probe.geometry.coordinates : [];
    return entity({
      external_id: `ripe-atlas:probe:${probe.id}`,
      entity_type: probe.is_anchor ? 'ripe_atlas_anchor' : 'ripe_atlas_probe',
      name: `${probe.is_anchor ? 'RIPE Atlas Anchor' : 'RIPE Atlas Probe'} ${probe.id}`,
      point: point(coordinates[1], coordinates[0]),
      observed_at: timestamp(probe.last_connected),
      source_url: probe.id ? `https://atlas.ripe.net/probes/${probe.id}/` : null,
      properties: {
        probe_id: probe.id ?? null,
        asn_v4: probe.asn_v4 ?? null,
        asn_v6: probe.asn_v6 ?? null,
        prefix_v4: probe.prefix_v4 ?? null,
        prefix_v6: probe.prefix_v6 ?? null,
        country_code: boundedText(probe.country_code, 8),
        status_id: probe?.status?.id ?? probe.status ?? null,
        status_name: boundedText(probe?.status?.name, 80),
        is_anchor: Boolean(probe.is_anchor),
        is_public: Boolean(probe.is_public),
        tags: Array.isArray(probe.tags) ? probe.tags.map((tag) => boundedText(tag?.slug || tag?.name, 80)).filter(Boolean) : [],
        geo_method: 'privacy_obfuscated',
        geo_precision_m: 400,
        geo_confidence: 0.80,
      },
    });
  }).filter((row) => row.point !== null);

  return result('ripe_atlas', 'probes', url.toString(), records, {
    provider_count: rows.length,
    mapped_count: records.length,
    bbox: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat],
    coordinate_notice: 'RIPE Atlas probe locations are privacy-obfuscated by the provider.',
  });
}

export const INFRASTRUCTURE_SOURCE_KEYS = Object.freeze(['peeringdb', 'ripe_atlas']);

export function isInfrastructureSource(sourceKey) {
  return INFRASTRUCTURE_SOURCE_KEYS.includes(String(sourceKey || '').trim());
}

export async function executeInfrastructureAdapter(sourceKey, input = {}, env = {}) {
  switch (String(sourceKey || '').trim()) {
    case 'peeringdb': return peeringDb(input, env);
    case 'ripe_atlas': return ripeAtlas(input, env);
    default:
      throw new InfrastructureAdapterError('Unknown infrastructure source', 404, 'unknown_infrastructure_source');
  }
}
