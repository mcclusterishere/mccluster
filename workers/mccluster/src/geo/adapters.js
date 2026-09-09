import { PERSISTENCE, sourceByKey, sourceConfigured } from './source-registry.js';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_PROVIDER_ROWS = 2000;
const SENSITIVE_QUERY_KEYS = new Set(['key', 'api_key', 'access_token', 'token', 'map_key']);

export class GeoAdapterError extends Error {
  constructor(message, status = 400, code = 'geo_adapter_error', detail = undefined) {
    super(message);
    this.name = 'GeoAdapterError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function finite(value, name, { min = -Infinity, max = Infinity, required = true } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new GeoAdapterError(`${name} must be a finite number between ${min} and ${max}`, 400, 'invalid_parameter');
  }
  return parsed;
}

function integer(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== null) return fallback;
    throw new GeoAdapterError(`${name} is required`, 400, 'invalid_parameter');
  }
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new GeoAdapterError(`${name} must be an integer between ${min} and ${max}`, 400, 'invalid_parameter');
  }
  return parsed;
}

function stringValue(value, name, { required = true, max = 500, pattern = null } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  const text = String(value || '').trim();
  if (!text || text.length > max || (pattern && !pattern.test(text))) {
    throw new GeoAdapterError(`${name} is invalid`, 400, 'invalid_parameter');
  }
  return text;
}

function latLon(input) {
  return {
    lat: finite(input?.lat ?? input?.latitude, 'lat', { min: -90, max: 90 }),
    lon: finite(input?.lon ?? input?.lng ?? input?.longitude, 'lon', { min: -180, max: 180 })
  };
}

function clampRows(rows) {
  return Array.isArray(rows) ? rows.slice(0, MAX_PROVIDER_ROWS) : [];
}

function timestamp(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
}

function point(lat, lon) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  const y = Number(lat);
  const x = Number(lon);
  if (y < -90 || y > 90 || x < -180 || x > 180) return null;
  return { lat: y, lon: x };
}

function record(kind, fields) {
  return { kind, ...fields };
}

function redactedUrl(value) {
  const url = new URL(String(value));
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, '[redacted]');
  }
  return url.toString();
}

async function providerFetch(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'McCluster-Spatial/1.0 (https://mccluster.org)',
        ...(init.headers || {})
      }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GeoAdapterError(
        `Provider request failed with ${response.status}`,
        response.status === 429 ? 429 : 502,
        'provider_error',
        { provider_status: response.status, body: body.slice(0, 600) }
      );
    }
    return response;
  } catch (error) {
    if (error instanceof GeoAdapterError) throw error;
    if (error?.name === 'AbortError') throw new GeoAdapterError('Provider request timed out', 504, 'provider_timeout');
    throw new GeoAdapterError('Provider request failed', 502, 'provider_network_error');
  } finally {
    clearTimeout(timer);
  }
}

async function jsonFetch(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await providerFetch(url, init, timeoutMs);
  const text = await response.text();
  try {
    return { data: text ? JSON.parse(text) : null, response };
  } catch {
    throw new GeoAdapterError('Provider returned invalid JSON', 502, 'provider_invalid_json');
  }
}

function result(sourceKey, operation, sourceUrl, records, raw, extra = {}) {
  const source = sourceByKey(sourceKey);
  return {
    source: sourceKey,
    operation,
    fetched_at: new Date().toISOString(),
    source_url: sourceUrl ? redactedUrl(sourceUrl) : null,
    attribution: source?.attribution || null,
    persistence: source?.persistence || PERSISTENCE.PERSISTENT,
    records: clampRows(records),
    raw,
    ...extra
  };
}

function requireCredentials(sourceKey, env) {
  const source = sourceByKey(sourceKey);
  if (!source) throw new GeoAdapterError('Unknown spatial source', 404, 'unknown_source');
  if (!sourceConfigured(source, env)) {
    throw new GeoAdapterError(
      `${source.name} credentials are not configured`,
      503,
      'credential_missing',
      { required_bindings: source.credentialEnv }
    );
  }
  return source;
}

function paramsFromObject(url, values, { skip = [] } = {}) {
  const ignored = new Set(skip);
  for (const [key, value] of Object.entries(values || {})) {
    if (ignored.has(key) || value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else if (['string', 'number', 'boolean'].includes(typeof value)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function assertPublicHttpsUrl(value) {
  const url = new URL(stringValue(value, 'url', { max: 2000 }));
  if (url.protocol !== 'https:') throw new GeoAdapterError('Only HTTPS provider URLs are allowed', 400, 'unsafe_url');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '::1' || host === '0.0.0.0'
  ) {
    throw new GeoAdapterError('Private/local provider URLs are not allowed', 400, 'unsafe_url');
  }
  return url;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ''])));
}

async function usgs(input) {
  const { lat, lon } = latLon(input);
  const radiusKm = finite(input?.radius_km ?? 250, 'radius_km', { min: 0.1, max: 2000 });
  const limit = integer(input?.limit ?? 250, 'limit', { min: 1, max: 1000 });
  const url = new URL('https://earthquake.usgs.gov/fdsnws/event/1/query');
  url.searchParams.set('format', 'geojson');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('maxradiuskm', String(radiusKm));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('orderby', 'time');
  if (input?.min_magnitude !== undefined) url.searchParams.set('minmagnitude', String(finite(input.min_magnitude, 'min_magnitude', { min: -2, max: 10 })));
  if (input?.start_time) url.searchParams.set('starttime', timestamp(input.start_time));
  const { data } = await jsonFetch(url);
  const records = clampRows(data?.features).map((feature) => {
    const coordinates = feature?.geometry?.coordinates || [];
    return record('event', {
      external_id: String(feature?.id || feature?.properties?.code || crypto.randomUUID()),
      event_type: 'earthquake',
      name: feature?.properties?.place || 'Earthquake',
      point: point(coordinates[1], coordinates[0]),
      severity: Number.isFinite(Number(feature?.properties?.mag)) ? Number(feature.properties.mag) : null,
      observed_at: timestamp(feature?.properties?.time),
      source_url: feature?.properties?.url || null,
      properties: feature?.properties || {}
    });
  });
  return result('usgs', 'earthquakes', url, records, data);
}

async function openMeteo(input) {
  const { lat, lon } = latLon(input);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('forecast_days', String(integer(input?.forecast_days ?? 3, 'forecast_days', { min: 1, max: 16 })));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,visibility,wind_speed_10m,wind_direction_10m');
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover,visibility,wind_speed_10m,wind_direction_10m');
  const { data } = await jsonFetch(url);
  const observedAt = timestamp(data?.current?.time);
  const location = point(data?.latitude ?? lat, data?.longitude ?? lon);
  const records = [
    record('entity', {
      external_id: `weather:${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`,
      entity_type: 'weather_cell',
      name: 'Local weather',
      point: location,
      observed_at: observedAt,
      properties: { elevation: data?.elevation, timezone: data?.timezone }
    }),
    ...Object.entries(data?.current || {})
      .filter(([key, value]) => key !== 'time' && Number.isFinite(Number(value)))
      .map(([key, value]) => record('observation', {
        external_id: `weather:${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}:${key}:${observedAt}`,
        observation_type: 'weather',
        metric: key,
        value_number: Number(value),
        unit: data?.current_units?.[key] || null,
        point: location,
        observed_at: observedAt,
        properties: {}
      }))
  ];
  return result('open_meteo', 'forecast', url, records, data);
}

async function celestrak(input) {
  const group = stringValue(input?.group || 'active', 'group', { max: 40, pattern: /^[A-Za-z0-9_-]+$/ }).toUpperCase();
  const url = new URL('https://celestrak.org/NORAD/elements/gp.php');
  url.searchParams.set('GROUP', group);
  url.searchParams.set('FORMAT', 'JSON');
  const { data } = await jsonFetch(url);
  const records = clampRows(data).map((item) => record('entity', {
    external_id: String(item?.NORAD_CAT_ID || item?.OBJECT_ID || item?.OBJECT_NAME || crypto.randomUUID()),
    entity_type: 'satellite',
    name: item?.OBJECT_NAME || item?.OBJECT_ID || 'Satellite',
    point: null,
    observed_at: timestamp(item?.EPOCH),
    properties: item || {}
  }));
  return result('celestrak', 'gp', url, records, data);
}

async function adsbLol(input) {
  const { lat, lon } = latLon(input);
  const radius = finite(input?.radius_nm ?? input?.radius ?? 125, 'radius_nm', { min: 1, max: 250 });
  const url = new URL(`https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${radius}`);
  const { data } = await jsonFetch(url);
  const records = clampRows(data?.ac).map((aircraft) => record('entity', {
    external_id: String(aircraft?.hex || aircraft?.icao || crypto.randomUUID()).replace(/^~/, ''),
    entity_type: aircraft?.mil ? 'military_aircraft' : 'aircraft',
    name: String(aircraft?.flight || aircraft?.r || aircraft?.hex || 'Aircraft').trim(),
    point: point(aircraft?.lat, aircraft?.lon),
    observed_at: timestamp((Date.now() / 1000) - Number(aircraft?.seen || 0)),
    properties: aircraft || {}
  }));
  return result('adsb_lol', 'aircraft', url, records, data);
}

async function overpass(input) {
  const operation = input?.operation || 'infrastructure';
  const timeout = 25;
  let query;
  if (input?.bbox) {
    const values = String(input.bbox).split(',').map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) throw new GeoAdapterError('bbox must be south,west,north,east', 400, 'invalid_parameter');
    const [south, west, north, east] = values;
    finite(south, 'south', { min: -90, max: 90 });
    finite(north, 'north', { min: -90, max: 90 });
    finite(west, 'west', { min: -180, max: 180 });
    finite(east, 'east', { min: -180, max: 180 });
    const selector = operation === 'military'
      ? `nwr[\"military\"](${south},${west},${north},${east});nwr[\"landuse\"=\"military\"](${south},${west},${north},${east});`
      : `way[\"highway\"](${south},${west},${north},${east});nwr[\"power\"](${south},${west},${north},${east});nwr[\"man_made\"](${south},${west},${north},${east});`;
    query = `[out:json][timeout:${timeout}];(${selector});out center tags;`;
  } else {
    const { lat, lon } = latLon(input);
    const radius = integer(input?.radius_m ?? 5000, 'radius_m', { min: 50, max: 100000 });
    const selector = operation === 'military'
      ? `nwr(around:${radius},${lat},${lon})[\"military\"];nwr(around:${radius},${lat},${lon})[\"landuse\"=\"military\"];`
      : `way(around:${radius},${lat},${lon})[\"highway\"];nwr(around:${radius},${lat},${lon})[\"power\"];nwr(around:${radius},${lat},${lon})[\"man_made\"];`;
    query = `[out:json][timeout:${timeout}];(${selector});out center tags;`;
  }
  const url = new URL('https://overpass-api.de/api/interpreter');
  const { data } = await jsonFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }).toString()
  }, 30000);
  const records = clampRows(data?.elements).map((item) => {
    const p = point(item?.lat ?? item?.center?.lat, item?.lon ?? item?.center?.lon);
    return record('entity', {
      external_id: `${item?.type || 'osm'}:${item?.id}`,
      entity_type: operation === 'military' ? 'mapped_military_installation' : `osm_${item?.type || 'feature'}`,
      name: item?.tags?.name || item?.tags?.ref || `${item?.type || 'OSM'} ${item?.id}`,
      point: p,
      observed_at: new Date().toISOString(),
      properties: { type: item?.type, id: item?.id, tags: item?.tags || {}, center: item?.center || null }
    });
  });
  return result('overpass', operation, url, records, data);
}

async function launchLibrary(input, env) {
  const limit = integer(input?.limit ?? 30, 'limit', { min: 1, max: 100 });
  const mode = ['list', 'normal', 'detailed'].includes(input?.mode) ? input.mode : 'detailed';
  const url = new URL('https://ll.thespacedevs.com/2.3.0/launches/upcoming/');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('mode', mode);
  url.searchParams.set('ordering', 'net');
  const headers = {};
  if (env?.LL2_API_TOKEN) headers.authorization = `Token ${env.LL2_API_TOKEN}`;
  const { data } = await jsonFetch(url, { headers });
  const records = clampRows(data?.results).map((launch) => record('event', {
    external_id: String(launch?.id || launch?.slug || crypto.randomUUID()),
    event_type: 'space_launch',
    name: launch?.name || 'Space launch',
    point: point(launch?.pad?.latitude, launch?.pad?.longitude),
    severity: null,
    status: launch?.status?.abbrev || launch?.status?.name || null,
    starts_at: timestamp(launch?.window_start || launch?.net),
    ends_at: launch?.window_end ? timestamp(launch.window_end) : null,
    observed_at: timestamp(launch?.last_updated),
    source_url: launch?.url || null,
    properties: launch || {}
  }));
  return result('launch_library2', 'upcoming_launches', url, records, data);
}

async function grantsGov(input) {
  const url = new URL('https://api.grants.gov/v1/api/search2');
  const body = {
    keyword: String(input?.keyword || '').slice(0, 200),
    rows: integer(input?.rows ?? 50, 'rows', { min: 1, max: 100 }),
    startRecordNum: integer(input?.start_record ?? 0, 'start_record', { min: 0, max: 10000 })
  };
  for (const key of ['oppStatuses', 'agencies', 'fundingCategories', 'eligibilities']) {
    if (input?.[key] !== undefined) body[key] = input[key];
  }
  const { data } = await jsonFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const opportunities = data?.data?.oppHits || data?.oppHits || data?.data?.opportunities || data?.opportunities || [];
  const records = clampRows(opportunities).map((opp) => record('event', {
    external_id: String(opp?.id || opp?.oppNumber || opp?.opportunityNumber || crypto.randomUUID()),
    event_type: 'grant_opportunity',
    name: opp?.title || opp?.opportunityTitle || 'Grant opportunity',
    point: null,
    status: opp?.oppStatus || opp?.status || null,
    starts_at: opp?.openDate ? timestamp(opp.openDate) : null,
    ends_at: opp?.closeDate ? timestamp(opp.closeDate) : null,
    observed_at: new Date().toISOString(),
    properties: opp || {}
  }));
  return result('grants_gov', 'search', url, records, data);
}

async function usaSpending(input) {
  const url = new URL('https://api.usaspending.gov/api/v2/search/spending_by_award/');
  const body = input?.body && typeof input.body === 'object' ? input.body : {
    filters: input?.filters || {
      time_period: [{ start_date: input?.start_date || '2025-01-01', end_date: input?.end_date || '2026-12-31' }],
      award_type_codes: input?.award_type_codes || ['02', '03', '04', '05']
    },
    fields: input?.fields || ['Award ID', 'Recipient Name', 'Award Amount', 'Start Date', 'End Date', 'Awarding Agency', 'Award Type'],
    page: integer(input?.page ?? 1, 'page', { min: 1, max: 1000 }),
    limit: integer(input?.limit ?? 50, 'limit', { min: 1, max: 100 }),
    sort: input?.sort || 'Award Amount',
    order: input?.order === 'asc' ? 'asc' : 'desc'
  };
  const { data } = await jsonFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const rows = data?.results || [];
  const records = clampRows(rows).map((award) => record('entity', {
    external_id: String(award?.['Award ID'] || award?.internal_id || award?.generated_unique_award_id || crypto.randomUUID()),
    entity_type: 'federal_award',
    name: award?.['Recipient Name'] || award?.recipient_name || 'Federal award',
    point: null,
    observed_at: new Date().toISOString(),
    properties: award || {}
  }));
  return result('usaspending', 'spending_by_award', url, records, data);
}

async function nhtsa(input) {
  const make = encodeURIComponent(stringValue(input?.make, 'make', { max: 80 }));
  const model = encodeURIComponent(stringValue(input?.model, 'model', { max: 80 }));
  const year = integer(input?.model_year ?? input?.year, 'model_year', { min: 1940, max: new Date().getUTCFullYear() + 2 });
  const url = new URL(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${make}&model=${model}&modelYear=${year}`);
  const { data } = await jsonFetch(url);
  const rows = data?.results || data?.Results || [];
  const records = clampRows(rows).map((recall) => record('event', {
    external_id: String(recall?.NHTSACampaignNumber || recall?.nhtsaCampaignNumber || crypto.randomUUID()),
    event_type: 'vehicle_recall',
    name: recall?.Component || recall?.component || `${year} ${decodeURIComponent(make)} ${decodeURIComponent(model)} recall`,
    point: null,
    status: null,
    starts_at: recall?.ReportReceivedDate ? timestamp(recall.ReportReceivedDate) : null,
    observed_at: new Date().toISOString(),
    properties: recall || {}
  }));
  return result('nhtsa', 'recalls', url, records, data);
}

async function census(input, env) {
  requireCredentials('census', env);
  const year = integer(input?.year ?? 2024, 'year', { min: 1990, max: new Date().getUTCFullYear() });
  const dataset = stringValue(input?.dataset || 'acs/acs5', 'dataset', { max: 100, pattern: /^[A-Za-z0-9_/-]+$/ });
  const get = stringValue(input?.get || 'NAME,B01001_001E', 'get', { max: 1000, pattern: /^[A-Za-z0-9_,]+$/ });
  const geography = stringValue(input?.for || 'state:*', 'for', { max: 200 });
  const url = new URL(`https://api.census.gov/data/${year}/${dataset}`);
  url.searchParams.set('get', get);
  url.searchParams.set('for', geography);
  if (input?.in) url.searchParams.set('in', stringValue(input.in, 'in', { max: 200 }));
  url.searchParams.set('key', env.CENSUS_API_KEY);
  const { data } = await jsonFetch(url);
  const headers = Array.isArray(data?.[0]) ? data[0] : [];
  const rows = Array.isArray(data) ? data.slice(1) : [];
  const records = clampRows(rows).map((values, index) => {
    const properties = Object.fromEntries(headers.map((key, i) => [key, values?.[i]]));
    return record('entity', {
      external_id: `census:${year}:${dataset}:${Object.values(properties).slice(-4).join(':') || index}`,
      entity_type: 'census_geography',
      name: properties.NAME || 'Census geography',
      point: null,
      observed_at: new Date().toISOString(),
      properties
    });
  });
  return result('census', 'dataset', url, records, data);
}

async function fred(input, env) {
  requireCredentials('fred', env);
  const seriesId = stringValue(input?.series_id, 'series_id', { max: 80, pattern: /^[A-Za-z0-9_.-]+$/ });
  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', env.FRED_API_KEY);
  url.searchParams.set('file_type', 'json');
  if (input?.observation_start) url.searchParams.set('observation_start', String(input.observation_start));
  if (input?.observation_end) url.searchParams.set('observation_end', String(input.observation_end));
  const { data } = await jsonFetch(url);
  const records = clampRows(data?.observations).map((obs) => record('observation', {
    external_id: `fred:${seriesId}:${obs.date}`,
    observation_type: 'economic_series',
    metric: seriesId,
    value_number: Number.isFinite(Number(obs.value)) ? Number(obs.value) : null,
    value_text: obs.value,
    unit: null,
    point: null,
    observed_at: timestamp(`${obs.date}T00:00:00Z`),
    properties: obs || {}
  }));
  return result('fred', 'series_observations', url, records, data);
}

async function bls(input, env) {
  requireCredentials('bls', env);
  const seriesIds = Array.isArray(input?.series_ids) ? input.series_ids.slice(0, 50).map((id) => stringValue(id, 'series_id', { max: 80 })) : [stringValue(input?.series_id, 'series_id', { max: 80 })];
  const startyear = String(integer(input?.start_year ?? new Date().getUTCFullYear() - 3, 'start_year', { min: 1940, max: new Date().getUTCFullYear() }));
  const endyear = String(integer(input?.end_year ?? new Date().getUTCFullYear(), 'end_year', { min: Number(startyear), max: new Date().getUTCFullYear() }));
  const url = new URL('https://api.bls.gov/publicAPI/v2/timeseries/data/');
  const body = { seriesid: seriesIds, startyear, endyear, registrationkey: env.BLS_API_KEY };
  const { data } = await jsonFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const records = [];
  for (const series of data?.Results?.series || []) {
    for (const obs of series?.data || []) {
      records.push(record('observation', {
        external_id: `bls:${series.seriesID}:${obs.year}:${obs.period}`,
        observation_type: 'labor_series',
        metric: series.seriesID,
        value_number: Number.isFinite(Number(obs.value)) ? Number(obs.value) : null,
        value_text: obs.value,
        unit: null,
        point: null,
        observed_at: `${obs.year}-01-01T00:00:00.000Z`,
        properties: obs || {}
      }));
    }
  }
  return result('bls', 'timeseries', url, records, data);
}

async function eia(input, env) {
  requireCredentials('eia', env);
  const route = stringValue(input?.route || 'electricity/rto/region-data/data/', 'route', { max: 300, pattern: /^[A-Za-z0-9_./-]+$/ });
  const url = new URL(`https://api.eia.gov/v2/${route.replace(/^\/+/, '')}`);
  url.searchParams.set('api_key', env.EIA_API_KEY);
  paramsFromObject(url, input?.params || {});
  if (!url.searchParams.has('length')) url.searchParams.set('length', String(integer(input?.limit ?? 100, 'limit', { min: 1, max: 5000 })));
  const { data } = await jsonFetch(url);
  const rows = data?.response?.data || [];
  const records = clampRows(rows).map((item, index) => record('observation', {
    external_id: `eia:${route}:${item?.period || index}:${item?.respondent || item?.region || ''}`,
    observation_type: 'energy_series',
    metric: item?.type || item?.series || route,
    value_number: Number.isFinite(Number(item?.value)) ? Number(item.value) : null,
    value_text: item?.value === undefined ? null : String(item.value),
    unit: item?.['value-units'] || item?.units || null,
    point: null,
    observed_at: item?.period ? timestamp(item.period) : new Date().toISOString(),
    properties: item || {}
  }));
  return result('eia', 'route', url, records, data);
}

async function dataCommons(input, env) {
  requireCredentials('data_commons', env);
  const place = stringValue(input?.place, 'place', { max: 200 });
  const statVar = stringValue(input?.stat_var, 'stat_var', { max: 300 });
  const url = new URL('https://api.datacommons.org/stat/series');
  url.searchParams.set('place', place);
  url.searchParams.set('stat_var', statVar);
  const { data } = await jsonFetch(url, { headers: { 'x-api-key': env.DATA_COMMONS_API_KEY } });
  const series = data?.series || data || {};
  const records = Object.entries(series).slice(0, MAX_PROVIDER_ROWS).map(([date, value]) => record('observation', {
    external_id: `dc:${place}:${statVar}:${date}`,
    observation_type: 'statistical_series',
    metric: statVar,
    value_number: Number.isFinite(Number(value)) ? Number(value) : null,
    value_text: value === undefined ? null : String(value),
    point: null,
    observed_at: timestamp(`${date}T00:00:00Z`),
    properties: { place }
  }));
  return result('data_commons', 'stat_series', url, records, data);
}

async function openSky(input, env) {
  requireCredentials('opensky_research', env);
  const tokenUrl = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
  const token = await jsonFetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.OPENSKY_CLIENT_ID, client_secret: env.OPENSKY_CLIENT_SECRET }).toString()
  });
  const accessToken = token?.data?.access_token;
  if (!accessToken) throw new GeoAdapterError('OpenSky OAuth did not return an access token', 502, 'provider_auth_error');
  const url = new URL('https://opensky-network.org/api/states/all');
  if (input?.bbox) {
    const [lamin, lomin, lamax, lomax] = String(input.bbox).split(',').map(Number);
    [lamin, lamax].forEach((value) => finite(value, 'latitude', { min: -90, max: 90 }));
    [lomin, lomax].forEach((value) => finite(value, 'longitude', { min: -180, max: 180 }));
    url.searchParams.set('lamin', String(lamin));
    url.searchParams.set('lomin', String(lomin));
    url.searchParams.set('lamax', String(lamax));
    url.searchParams.set('lomax', String(lomax));
  }
  const { data } = await jsonFetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const records = clampRows(data?.states).map((state) => record('entity', {
    external_id: String(state?.[0] || crypto.randomUUID()),
    entity_type: 'aircraft',
    name: String(state?.[1] || state?.[0] || 'Aircraft').trim(),
    point: point(state?.[6], state?.[5]),
    observed_at: timestamp(state?.[4] || data?.time),
    properties: {
      icao24: state?.[0], callsign: state?.[1], origin_country: state?.[2], time_position: state?.[3], last_contact: state?.[4],
      longitude: state?.[5], latitude: state?.[6], baro_altitude: state?.[7], on_ground: state?.[8], velocity: state?.[9],
      true_track: state?.[10], vertical_rate: state?.[11], sensors: state?.[12], geo_altitude: state?.[13], squawk: state?.[14], spi: state?.[15], position_source: state?.[16], category: state?.[17]
    }
  }));
  return result('opensky_research', 'states', url, records, data);
}

async function nasaFirms(input, env) {
  requireCredentials('nasa_firms', env);
  const source = stringValue(input?.satellite || 'VIIRS_SNPP_NRT', 'satellite', { max: 40, pattern: /^[A-Za-z0-9_-]+$/ });
  const dayRange = integer(input?.day_range ?? 1, 'day_range', { min: 1, max: 10 });
  let area = input?.area;
  if (!area) {
    const { lat, lon } = latLon(input);
    const delta = finite(input?.delta_deg ?? 1, 'delta_deg', { min: 0.01, max: 20 });
    area = `${Math.max(-180, lon - delta)},${Math.max(-90, lat - delta)},${Math.min(180, lon + delta)},${Math.min(90, lat + delta)}`;
  }
  const safeArea = stringValue(area, 'area', { max: 120, pattern: /^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$/ });
  const url = new URL(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(env.FIRMS_MAP_KEY)}/${source}/${safeArea}/${dayRange}`);
  const response = await providerFetch(url, { headers: { accept: 'text/csv' } });
  const text = await response.text();
  const rows = parseCsv(text);
  const records = clampRows(rows).map((fire, index) => record('event', {
    external_id: `firms:${source}:${fire.latitude}:${fire.longitude}:${fire.acq_date}:${fire.acq_time}:${index}`,
    event_type: 'active_fire',
    name: 'Active fire / thermal anomaly',
    point: point(fire.latitude, fire.longitude),
    severity: Number.isFinite(Number(fire.frp)) ? Number(fire.frp) : null,
    observed_at: fire.acq_date ? timestamp(`${fire.acq_date}T${String(fire.acq_time || '0000').padStart(4, '0').slice(0, 2)}:${String(fire.acq_time || '0000').padStart(4, '0').slice(2, 4)}:00Z`) : new Date().toISOString(),
    properties: fire
  }));
  return result('nasa_firms', 'area', url, records, rows);
}

async function tomTom(input, env) {
  requireCredentials('tomtom', env);
  const { lat, lon } = latLon(input);
  const zoom = integer(input?.zoom ?? 10, 'zoom', { min: 0, max: 22 });
  const style = ['absolute', 'relative', 'relative0', 'relative0-dark', 'relative-delay', 'reduced-sensitivity'].includes(input?.style) ? input.style : 'relative';
  const url = new URL(`https://api.tomtom.com/traffic/services/4/flowSegmentData/${style}/${zoom}/json`);
  url.searchParams.set('point', `${lat},${lon}`);
  url.searchParams.set('key', env.TOMTOM_API_KEY);
  const { data } = await jsonFetch(url);
  const flow = data?.flowSegmentData || data || {};
  const recordRow = record('observation', {
    external_id: `tomtom:flow:${lat.toFixed(5)},${lon.toFixed(5)}:${Math.floor(Date.now() / 120000)}`,
    observation_type: 'traffic_flow',
    metric: 'current_speed',
    value_number: Number.isFinite(Number(flow?.currentSpeed)) ? Number(flow.currentSpeed) : null,
    unit: flow?.unit || 'km/h',
    point: point(lat, lon),
    observed_at: new Date().toISOString(),
    properties: flow || {}
  });
  return result('tomtom', 'flow_segment', url, [recordRow], data);
}

async function mapbox(input, env) {
  requireCredentials('mapbox', env);
  const query = encodeURIComponent(stringValue(input?.query, 'query', { max: 300 }));
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json`);
  url.searchParams.set('access_token', env.MAPBOX_ACCESS_TOKEN);
  url.searchParams.set('limit', String(integer(input?.limit ?? 5, 'limit', { min: 1, max: 10 })));
  const { data } = await jsonFetch(url);
  const records = clampRows(data?.features).map((feature) => record('entity', {
    external_id: String(feature?.id || crypto.randomUUID()),
    entity_type: 'geocode_result',
    name: feature?.place_name || feature?.text || 'Place',
    point: point(feature?.center?.[1], feature?.center?.[0]),
    observed_at: new Date().toISOString(),
    properties: feature || {}
  }));
  return result('mapbox', 'geocode', url, records, data);
}

async function googleMaps(input, env) {
  requireCredentials('google_maps', env);
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  if (input?.address) url.searchParams.set('address', stringValue(input.address, 'address', { max: 500 }));
  else {
    const { lat, lon } = latLon(input);
    url.searchParams.set('latlng', `${lat},${lon}`);
  }
  url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);
  const { data } = await jsonFetch(url);
  const records = clampRows(data?.results).map((item) => record('entity', {
    external_id: String(item?.place_id || crypto.randomUUID()),
    entity_type: 'geocode_result',
    name: item?.formatted_address || 'Place',
    point: point(item?.geometry?.location?.lat, item?.geometry?.location?.lng),
    observed_at: new Date().toISOString(),
    properties: item || {}
  }));
  return result('google_maps', 'geocode', url, records, data);
}

async function nominatim(input) {
  const { lat, lon } = latLon(input);
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('zoom', String(integer(input?.zoom ?? 14, 'zoom', { min: 3, max: 18 })));
  const { data } = await jsonFetch(url, { headers: { 'accept-language': 'en' } });
  const records = [record('entity', {
    external_id: String(data?.place_id || `nominatim:${lat},${lon}`),
    entity_type: 'place',
    name: data?.display_name || 'Place',
    point: point(data?.lat ?? lat, data?.lon ?? lon),
    observed_at: new Date().toISOString(),
    properties: data || {}
  })];
  return result('nominatim', 'reverse', url, records, data);
}

async function gdelt(input) {
  const query = stringValue(input?.query, 'query', { max: 300 });
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', String(integer(input?.limit ?? 25, 'limit', { min: 1, max: 250 })));
  url.searchParams.set('sort', 'HybridRel');
  const { data } = await jsonFetch(url);
  const contextPoint = input?.lat !== undefined ? point(input.lat, input.lon ?? input.lng) : null;
  const records = clampRows(data?.articles).map((article, index) => record('event', {
    external_id: String(article?.url || `gdelt:${index}:${article?.seendate || ''}`),
    event_type: 'news_article',
    name: article?.title || 'News article',
    point: contextPoint,
    observed_at: timestamp(article?.seendate),
    source_url: article?.url || null,
    properties: article || {}
  }));
  return result('gdelt', 'articles', url, records, data);
}

async function radioBrowser(input) {
  const url = new URL('https://all.api.radio-browser.info/json/stations/search');
  url.searchParams.set('hidebroken', 'true');
  url.searchParams.set('order', 'clickcount');
  url.searchParams.set('reverse', 'true');
  url.searchParams.set('limit', String(integer(input?.limit ?? 100, 'limit', { min: 1, max: 500 })));
  if (input?.countrycode) url.searchParams.set('countrycode', stringValue(input.countrycode, 'countrycode', { max: 2, pattern: /^[A-Za-z]{2}$/ }).toUpperCase());
  if (input?.tag) url.searchParams.set('tag', stringValue(input.tag, 'tag', { max: 80 }));
  const { data } = await jsonFetch(url);
  const records = clampRows(data).map((station) => record('entity', {
    external_id: String(station?.stationuuid || crypto.randomUUID()),
    entity_type: 'radio_station',
    name: station?.name || 'Radio station',
    point: point(station?.geo_lat ?? station?.latitude, station?.geo_long ?? station?.longitude),
    observed_at: new Date().toISOString(),
    source_url: station?.homepage || null,
    properties: { ...station, url: undefined, url_resolved: undefined }
  }));
  return result('radio_browser', 'stations', url, records, data);
}

async function gbfs(input) {
  const url = assertPublicHttpsUrl(input?.url);
  const { data } = await jsonFetch(url);
  const stations = data?.data?.stations || data?.data?.bikes || data?.data?.vehicles || [];
  const records = clampRows(stations).map((item, index) => record('entity', {
    external_id: String(item?.station_id || item?.vehicle_id || item?.bike_id || index),
    entity_type: item?.station_id ? 'bikeshare_station' : 'shared_mobility_vehicle',
    name: item?.name || item?.station_id || item?.vehicle_id || 'Shared mobility',
    point: point(item?.lat, item?.lon),
    observed_at: timestamp(data?.last_updated),
    properties: item || {}
  }));
  return result('gbfs', 'feed', url, records, data);
}

async function cctv(input) {
  const provider = input?.provider || 'austin';
  if (provider !== 'austin') throw new GeoAdapterError('Only the audited Austin CCTV catalog is enabled in this adapter', 400, 'unsupported_provider');
  const url = new URL('https://data.austintexas.gov/api/views/b4k4-adkb/rows.json?accessType=DOWNLOAD');
  const { data } = await jsonFetch(url);
  return result('cctv', 'catalog', url, [], data, { note: 'Catalog is returned transiently; camera-frame redistribution remains provider-governed.' });
}

async function copernicus(input, env) {
  requireCredentials('copernicus', env);
  const tokenUrl = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
  const token = await jsonFetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.COPERNICUS_CLIENT_ID, client_secret: env.COPERNICUS_CLIENT_SECRET }).toString()
  });
  const accessToken = token?.data?.access_token;
  if (!accessToken) throw new GeoAdapterError('Copernicus OAuth did not return an access token', 502, 'provider_auth_error');
  const url = new URL('https://catalogue.dataspace.copernicus.eu/stac/search');
  const body = {
    collections: input?.collections || ['SENTINEL-2'],
    limit: integer(input?.limit ?? 50, 'limit', { min: 1, max: 100 }),
    ...(input?.bbox ? { bbox: String(input.bbox).split(',').map(Number) } : {}),
    ...(input?.datetime ? { datetime: String(input.datetime) } : {})
  };
  const { data } = await jsonFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body) });
  const records = clampRows(data?.features).map((feature) => {
    let p = null;
    if (feature?.geometry?.type === 'Point') p = point(feature.geometry.coordinates?.[1], feature.geometry.coordinates?.[0]);
    else if (Array.isArray(feature?.bbox) && feature.bbox.length >= 4) p = point((feature.bbox[1] + feature.bbox[3]) / 2, (feature.bbox[0] + feature.bbox[2]) / 2);
    return record('entity', {
      external_id: String(feature?.id || crypto.randomUUID()),
      entity_type: 'earth_observation_scene',
      name: feature?.properties?.title || feature?.id || 'Copernicus scene',
      point: p,
      observed_at: timestamp(feature?.properties?.datetime),
      properties: { type: feature?.type, bbox: feature?.bbox, geometry: feature?.geometry, properties: feature?.properties, assets: feature?.assets }
    });
  });
  return result('copernicus', 'stac_search', url, records, data);
}

async function planet(input, env) {
  requireCredentials('planet_research', env);
  const url = new URL('https://api.planet.com/data/v1/quick-search');
  const body = {
    item_types: input?.item_types || ['PSScene'],
    filter: input?.filter || {
      type: 'AndFilter',
      config: [
        ...(input?.geometry ? [{ type: 'GeometryFilter', field_name: 'geometry', config: input.geometry }] : []),
        { type: 'DateRangeFilter', field_name: 'acquired', config: { gte: input?.start_time || new Date(Date.now() - 7 * 86400000).toISOString(), lte: input?.end_time || new Date().toISOString() } }
      ]
    }
  };
  const auth = btoa(`${env.PLANET_RESEARCH_API_KEY}:`);
  const { data } = await jsonFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` }, body: JSON.stringify(body) });
  const records = clampRows(data?.features).map((feature) => {
    const coords = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    return record('entity', {
      external_id: String(feature?.id || crypto.randomUUID()),
      entity_type: 'earth_observation_scene',
      name: feature?.id || 'Planet scene',
      point: coords ? point(coords[1], coords[0]) : null,
      observed_at: timestamp(feature?.properties?.acquired),
      properties: feature || {}
    });
  });
  return result('planet_research', 'quick_search', url, records, data);
}

async function epa(input) {
  const endpoint = input?.endpoint || 'echo';
  if (endpoint !== 'echo') throw new GeoAdapterError('Unsupported EPA operation', 400, 'unsupported_operation');
  // EPA ECHO exposes multiple schemas that drift independently. Keep this as a
  // fixed-host gateway rather than accepting arbitrary URLs; callers provide an
  // ECHO REST path after /echo/ only.
  const path = stringValue(input?.path || 'rest_services.get_facilities', 'path', { max: 300, pattern: /^[A-Za-z0-9_.\/-]+$/ });
  const url = new URL(`https://echodata.epa.gov/echo/${path}`);
  paramsFromObject(url, input?.params || {});
  const { data } = await jsonFetch(url);
  return result('epa', 'echo', url, [], data);
}

async function passthroughConfig(sourceKey) {
  const source = sourceByKey(sourceKey);
  if (sourceKey === 'reearth_terrain') {
    return result(sourceKey, 'config', null, [], null, { terrain_url: 'https://terrain.reearth.land/cesium-mesh/ellipsoid' });
  }
  if (sourceKey === 'cesium_ion') {
    return result(sourceKey, 'config', null, [], null, { configured_for_server: true, note: 'Viewer token remains a scoped client/viewer concern; this endpoint never returns it.' });
  }
  throw new GeoAdapterError(`${source?.name || sourceKey} has no one-shot HTTP operation`, 400, 'unsupported_operation');
}

export async function executeAdapter(sourceKey, input = {}, env = {}) {
  const source = sourceByKey(sourceKey);
  if (!source) throw new GeoAdapterError('Unknown spatial source', 404, 'unknown_source');
  if (source.credentialEnv.length && !sourceConfigured(source, env)) requireCredentials(sourceKey, env);

  switch (sourceKey) {
    case 'usgs': return usgs(input);
    case 'open_meteo': return openMeteo(input);
    case 'celestrak': return celestrak(input);
    case 'adsb_lol': return adsbLol(input);
    case 'overpass': return overpass(input);
    case 'launch_library2': return launchLibrary(input, env);
    case 'grants_gov': return grantsGov(input);
    case 'usaspending': return usaSpending(input);
    case 'nhtsa': return nhtsa(input);
    case 'census': return census(input, env);
    case 'fred': return fred(input, env);
    case 'bls': return bls(input, env);
    case 'eia': return eia(input, env);
    case 'data_commons': return dataCommons(input, env);
    case 'opensky_research': return openSky(input, env);
    case 'nasa_firms': return nasaFirms(input, env);
    case 'tomtom': return tomTom(input, env);
    case 'mapbox': return mapbox(input, env);
    case 'google_maps': return googleMaps(input, env);
    case 'nominatim': return nominatim(input);
    case 'gdelt': return gdelt(input);
    case 'radio_browser': return radioBrowser(input);
    case 'gbfs': return gbfs(input);
    case 'cctv': return cctv(input);
    case 'copernicus': return copernicus(input, env);
    case 'planet_research': return planet(input, env);
    case 'reearth_terrain':
    case 'cesium_ion':
      return passthroughConfig(sourceKey);
    case 'aisstream':
      return result('aisstream', 'websocket', null, [], null, { live_endpoint: '/v1/geo/live/ais', configured: sourceConfigured(source, env) });
    default:
      throw new GeoAdapterError(`${source.name} adapter is registered but has no default operation`, 501, 'adapter_not_implemented');
  }
}

export function adapterCapabilities() {
  return {
    persistent: ['usgs', 'open_meteo', 'celestrak', 'adsb_lol', 'overpass', 'launch_library2', 'grants_gov', 'usaspending', 'nhtsa', 'census', 'fred', 'bls', 'eia', 'data_commons', 'nasa_firms', 'copernicus', 'planet_research', 'radio_browser', 'gbfs'],
    transient: ['opensky_research', 'tomtom', 'mapbox', 'nominatim', 'gdelt', 'cctv', 'aisstream'],
    never_persist: ['google_maps', 'cesium_ion'],
    config_only: ['reearth_terrain', 'cesium_ion']
  };
}
