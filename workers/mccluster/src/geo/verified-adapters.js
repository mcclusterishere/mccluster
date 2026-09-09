import { GeoAdapterError } from './adapters.js';

const MAX_ROWS = 2000;

function text(value, name, max = 300) {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new GeoAdapterError(`${name} is invalid`, 400, 'invalid_parameter');
  return result;
}

function finite(value, name, min, max, fallback = null) {
  if ((value === undefined || value === null || value === '') && fallback !== null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new GeoAdapterError(`${name} is invalid`, 400, 'invalid_parameter');
  return parsed;
}

function timestamp(date) {
  if (!date) return new Date().toISOString();
  const normalized = /^\d{4}(-\d{2})?(-\d{2})?$/.test(String(date))
    ? `${String(date).padEnd(10, '-01').replace(/-01-01-01$/, '-01-01')}T00:00:00Z`
    : String(date);
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString() : parsed.toISOString();
}

async function jsonFetch(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'user-agent': 'McCluster-Spatial/1.0 (https://mccluster.org)',
        ...(init.headers || {})
      }
    });
    const body = await response.text();
    if (!response.ok) {
      throw new GeoAdapterError('Provider request failed', response.status === 429 ? 429 : 502, 'provider_error', {
        provider_status: response.status,
        body: body.slice(0, 600)
      });
    }
    try {
      return body ? JSON.parse(body) : null;
    } catch {
      throw new GeoAdapterError('Provider returned invalid JSON', 502, 'provider_invalid_json');
    }
  } catch (error) {
    if (error instanceof GeoAdapterError) throw error;
    if (error?.name === 'AbortError') throw new GeoAdapterError('Provider request timed out', 504, 'provider_timeout');
    throw new GeoAdapterError('Provider request failed', 502, 'provider_network_error');
  } finally {
    clearTimeout(timer);
  }
}

function baseResult(source, operation, sourceUrl, records, raw, attribution = null) {
  return {
    source,
    operation,
    fetched_at: new Date().toISOString(),
    source_url: sourceUrl,
    attribution,
    persistence: 'persistent',
    records: records.slice(0, MAX_ROWS),
    raw
  };
}

export async function dataCommonsV2(input, env) {
  if (!env?.DATA_COMMONS_API_KEY) {
    throw new GeoAdapterError('Data Commons credentials are not configured', 503, 'credential_missing', {
      required_bindings: ['DATA_COMMONS_API_KEY']
    });
  }

  const variables = Array.isArray(input?.stat_vars)
    ? input.stat_vars.slice(0, 20).map((value) => text(value, 'stat_var'))
    : [text(input?.stat_var, 'stat_var')];
  const entities = Array.isArray(input?.places)
    ? input.places.slice(0, 50).map((value) => text(value, 'place'))
    : [text(input?.place, 'place')];
  const date = input?.date === undefined ? '' : String(input.date);
  const url = 'https://api.datacommons.org/v2/observation';
  const requestBody = {
    date,
    variable: { dcids: variables },
    entity: { dcids: entities },
    select: ['value', 'date', 'facet']
  };
  const data = await jsonFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.DATA_COMMONS_API_KEY
    },
    body: JSON.stringify(requestBody)
  });

  const records = [];
  for (const [variable, variableData] of Object.entries(data?.byVariable || {})) {
    for (const [entity, entityData] of Object.entries(variableData?.byEntity || {})) {
      for (const facet of entityData?.orderedFacets || []) {
        const facetMeta = data?.facets?.[String(facet?.facetId)] || {};
        for (const observation of facet?.observations || []) {
          if (records.length >= MAX_ROWS) break;
          records.push({
            kind: 'observation',
            external_id: `dc:${entity}:${variable}:${facet?.facetId || 'default'}:${observation?.date}`,
            observation_type: 'statistical_series',
            metric: variable,
            value_number: Number.isFinite(Number(observation?.value)) ? Number(observation.value) : null,
            value_text: observation?.value === undefined ? null : String(observation.value),
            unit: facetMeta?.unit || null,
            point: null,
            observed_at: timestamp(observation?.date),
            properties: {
              entity,
              facet_id: facet?.facetId || null,
              facet: facetMeta
            }
          });
        }
      }
    }
  }

  return baseResult('data_commons', 'v2_observation', url, records, data, 'Data Commons');
}

export async function epaEchoFacilities(input) {
  const url = new URL('https://echodata.epa.gov/echo/echo_rest_services.get_facilities');
  url.searchParams.set('output', 'JSON');
  url.searchParams.set('responseset', String(Math.max(1, Math.min(Math.trunc(Number(input?.limit || 100)), 1000))));

  const allowedConvenience = {
    facility_name: 'p_fn',
    state: 'p_st',
    city: 'p_ct',
    zip: 'p_zip',
    media: 'p_med'
  };
  for (const [inputKey, echoKey] of Object.entries(allowedConvenience)) {
    if (input?.[inputKey] !== undefined && input?.[inputKey] !== null && input?.[inputKey] !== '') {
      url.searchParams.set(echoKey, String(input[inputKey]).slice(0, 200));
    }
  }
  if (input?.lat !== undefined || input?.latitude !== undefined) {
    url.searchParams.set('p_lat', String(finite(input?.lat ?? input?.latitude, 'lat', -90, 90)));
    url.searchParams.set('p_long', String(finite(input?.lon ?? input?.lng ?? input?.longitude, 'lon', -180, 180)));
    url.searchParams.set('p_radius', String(finite(input?.radius_miles ?? input?.radius ?? 25, 'radius_miles', 0.1, 100)));
  }
  for (const [key, value] of Object.entries(input?.params || {})) {
    if (!/^p_[A-Za-z0-9_]+$/.test(key)) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
    url.searchParams.set(key, String(value).slice(0, 300));
  }

  const data = await jsonFetch(url);
  const facilities = data?.Results?.Facilities || data?.Results?.Facility || data?.Results?.FacilitiesList || [];
  const rows = Array.isArray(facilities) ? facilities : [];
  const records = rows.slice(0, MAX_ROWS).map((facility, index) => {
    const lat = Number(facility?.FacLat ?? facility?.Latitude ?? facility?.AIRLat ?? facility?.Lat);
    const lon = Number(facility?.FacLong ?? facility?.Longitude ?? facility?.AIRLong ?? facility?.Long);
    return {
      kind: 'entity',
      external_id: String(facility?.RegistryID || facility?.RegistryId || facility?.FacID || facility?.SourceID || index),
      entity_type: 'regulated_facility',
      name: facility?.FacName || facility?.FacilityName || facility?.Name || 'EPA regulated facility',
      point: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
      observed_at: new Date().toISOString(),
      properties: facility || {}
    };
  });

  return baseResult('epa', 'echo_facilities', url.toString(), records, data, 'U.S. EPA ECHO');
}
