/* USGS earthquakes -> source snapshots + evidence.

   SOURCE AND TERMS. USGS Earthquake Hazards Program, FDSN event web service
   (https://earthquake.usgs.gov/fdsnws/event/1/). USGS-authored data are U.S.
   Government works in the public domain; USGS asks for credit ("U.S.
   Geological Survey"), see
   https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits.
   Commercial use and public display are allowed with attribution.

   BOUNDED DATASET. Magnitude >= 2.5 only, at most PAGE_LIMIT events per run,
   ordered oldest-first so a run that hits the limit simply continues from
   where it stopped on the next run. The first run looks back 24 hours.

   CADENCE AND RATE LIMITS. The Worker cron ticks every 5 minutes; the
   database refuses to start a run less than 15 minutes after the previous
   one (intel_collector_begin), so this is at most 96 requests a day. USGS
   publishes no hard quota for the FDSN service but asks for reasonable use
   and errors above 20,000 results per query; 500 is far below that.

   CHECKPOINT AND IDEMPOTENCY. The cursor is the newest observed event time
   committed so far. Each run re-reads OVERLAP_MINUTES before it, because USGS
   revises recent events; a revision has a new `updated` time and therefore
   a new idempotency key (`usgs:<id>:<updated>`) and is stored as a new
   snapshot, while an unchanged event deduplicates. Rows and the advanced
   cursor are committed in one database transaction (intel_collector_commit).

   ERROR HANDLING. Any upstream problem (network, timeout, non-2xx, redirect,
   invalid JSON, wrong shape) is recorded as a FAILED run with the reason and
   the cursor does not move. Zero is only ever reported when USGS itself said
   there were no events (HTTP 204, or an empty FeatureCollection).

   FLAG. Nothing here runs unless INTEL_USGS_COLLECTOR_ENABLED is exactly
   "true". With the flag off the scheduled hook returns before any network or
   database call, so deploying this code starts no writes. */

import { IntelError, configured, resolveHouseOrg, rpc } from './store.js';

export const USGS_CONNECTOR_KEY = 'usgs.earthquakes';
export const USGS_ENDPOINT = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
export const MIN_MAGNITUDE = 2.5;
export const PAGE_LIMIT = 500;
export const OVERLAP_MINUTES = 60;
export const INITIAL_LOOKBACK_HOURS = 24;
export const MIN_INTERVAL_SECONDS = 900;
const TIMEOUT_MS = 15000;

export const USGS_CONNECTOR = Object.freeze({
  kind: 'api',
  display_name: 'USGS earthquakes (M2.5+)',
  description: 'USGS FDSN event service, magnitude 2.5 and above, checkpointed by event time.',
  config: {
    endpoint: USGS_ENDPOINT,
    min_magnitude: MIN_MAGNITUDE,
    page_limit: PAGE_LIMIT,
    overlap_minutes: OVERLAP_MINUTES,
    initial_lookback_hours: INITIAL_LOOKBACK_HOURS,
    min_interval_seconds: MIN_INTERVAL_SECONDS
  },
  license_policy: {
    publisher: 'U.S. Geological Survey',
    license: 'Public domain (U.S. Government work)',
    attribution: 'U.S. Geological Survey',
    terms_url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
    commercial_use: true,
    public_display: true
  },
  retention_policy: { days: 365 }
});

export function collectorEnabled(env) {
  return String(env?.INTEL_USGS_COLLECTOR_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export function queryUrl(cursor, now = new Date()) {
  const last = cursor?.last_observed_at ? Date.parse(cursor.last_observed_at) : NaN;
  const start = Number.isFinite(last)
    ? new Date(last - OVERLAP_MINUTES * 60_000)
    : new Date(now.getTime() - INITIAL_LOOKBACK_HOURS * 3_600_000);
  const url = new URL(USGS_ENDPOINT);
  url.searchParams.set('format', 'geojson');
  url.searchParams.set('orderby', 'time-asc');
  url.searchParams.set('minmagnitude', String(MIN_MAGNITUDE));
  url.searchParams.set('starttime', start.toISOString());
  url.searchParams.set('endtime', now.toISOString());
  url.searchParams.set('limit', String(PAGE_LIMIT));
  return url;
}

class UpstreamFailure extends Error {
  constructor(reason, detail = {}) {
    super(reason);
    this.reason = reason;
    this.detail = detail;
  }
}

/* Fetches one page. Throws UpstreamFailure for anything that is not an
   explicit, well-formed answer from USGS. */
export async function fetchUsgsPage(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    // Workers reject redirect:'error'; 'manual' plus the 3xx check below is the equivalent.
    res = await fetchImpl(url.toString(), {
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'McCluster-Intel/1.0 (https://mccluster.org)' }
    });
  } catch (error) {
    throw new UpstreamFailure(error?.name === 'AbortError' ? 'provider_timeout' : 'provider_network_error');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return { features: [], provider_status: 204 };
  if (res.status >= 300 && res.status < 400) throw new UpstreamFailure('provider_redirect', { provider_status: res.status });
  if (!res.ok) throw new UpstreamFailure(`provider_http_${res.status}`, { provider_status: res.status });
  let data;
  try { data = await res.json(); } catch { throw new UpstreamFailure('provider_invalid_json', { provider_status: res.status }); }
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new UpstreamFailure('provider_invalid_payload', { provider_status: res.status });
  }
  return { features: data.features, provider_status: res.status };
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function finite(value) {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? n : null;
}

/* One FDSN feature -> one commit record. Returns null for a feature that
   cannot be identified or dated; the caller counts it as rejected. */
export async function normalizeFeature(feature, retrievedAt) {
  const id = typeof feature?.id === 'string' ? feature.id.trim() : '';
  const p = feature?.properties || {};
  const time = finite(p.time);
  if (!id || time === null) return null;
  const updated = finite(p.updated) ?? time;
  const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
  const lon = finite(coords[0]);
  const lat = finite(coords[1]);
  // a pair the source published, inside the globe, and not (0,0); otherwise unknown
  const located = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  const mag = finite(p.mag);
  const place = typeof p.place === 'string' ? p.place.slice(0, 200) : null;
  const sourceUrl = typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : null;
  const record = {
    external_id: id,
    record_kind: 'earthquake',
    idempotency_key: `usgs:${id}:${updated}`,
    content_hash: await sha256Hex(JSON.stringify(feature)),
    title: (typeof p.title === 'string' && p.title.trim()) ? p.title.slice(0, 500) : `M ${mag ?? '?'} earthquake${place ? ` - ${place}` : ''}`,
    summary: place ? `USGS ${p.status || 'reported'} event: ${place}` : 'USGS reported event',
    observed_at: new Date(time).toISOString(),
    retrieved_at: retrievedAt,
    source_url: sourceUrl,
    region_label: place,
    source_ref: { provider: 'usgs', provider_id: id, url: sourceUrl, updated_at: new Date(updated).toISOString(), retrieved_at: retrievedAt },
    measures: {
      magnitude: mag,
      magnitude_type: typeof p.magType === 'string' ? p.magType : null,
      depth_km: finite(coords[2]),
      significance: finite(p.sig),
      tsunami_flag: finite(p.tsunami),
      review_status: typeof p.status === 'string' ? p.status : null
    },
    payload: { type: 'Feature', id, properties: p, geometry: feature?.geometry ?? null }
  };
  if (located) { record.lat = lat; record.lon = lon; }
  return record;
}

/* One collector run. Returns a plain report; never throws for upstream
   problems (they become failed runs). */
export async function runUsgsCollector(env, { now = new Date(), fetchImpl = fetch } = {}) {
  if (!collectorEnabled(env)) return { ran: false, reason: 'collector_disabled' };
  if (!configured(env)) return { ran: false, reason: 'database_not_configured' };

  const org = await resolveHouseOrg(env);
  const begin = await rpc(env, 'intel_collector_begin', {
    p_org: org.id,
    p_connector_key: USGS_CONNECTOR_KEY,
    p_connector: USGS_CONNECTOR,
    p_min_interval_seconds: MIN_INTERVAL_SECONDS
  });
  if (!begin?.started) return { ran: false, reason: begin?.reason || 'not_started', connector_id: begin?.connector_id || null };
  const runId = begin.run_id;
  const url = queryUrl(begin.cursor || {}, now);
  const fail = async (reason, detail = {}) => {
    await rpc(env, 'intel_collector_fail', {
      p_org: org.id, p_run: runId, p_error: reason, p_metadata: { query_url: url.toString(), ...detail }
    });
    return { ran: true, run_id: runId, status: 'failed', error: reason, ...detail };
  };

  let page;
  try {
    page = await fetchUsgsPage(url, fetchImpl);
  } catch (error) {
    if (error instanceof UpstreamFailure) return fail(error.reason, error.detail);
    return fail('collector_error', { message: String(error?.message || error).slice(0, 300) });
  }

  const retrievedAt = now.toISOString();
  const records = [];
  let unidentifiable = 0;
  for (const feature of page.features.slice(0, PAGE_LIMIT)) {
    const record = await normalizeFeature(feature, retrievedAt);
    if (record) records.push(record); else unidentifiable += 1;
  }
  // Unidentifiable features still go to the store so they are counted as rejected, not dropped silently.
  for (let i = 0; i < unidentifiable; i += 1) records.push({ external_id: '', title: '', idempotency_key: '', content_hash: '' });

  const newest = records.reduce((max, r) => (r.observed_at && r.observed_at > max ? r.observed_at : max), begin.cursor?.last_observed_at || '');
  const cursor = newest ? { last_observed_at: newest } : (begin.cursor || {});

  try {
    const committed = await rpc(env, 'intel_collector_commit', {
      p_org: org.id,
      p_run: runId,
      p_records: records,
      p_cursor: cursor,
      p_metadata: { query_url: url.toString(), provider_status: page.provider_status, page_full: page.features.length >= PAGE_LIMIT }
    });
    return { ran: true, ...committed };
  } catch (error) {
    if (error instanceof IntelError && error.code === 'intel_schema_not_ready') throw error;
    return fail('commit_failed', { message: String(error?.message || error).slice(0, 300) });
  }
}

/* The scheduled hook. The flag is checked before anything else, so with
   the flag off a cron tick makes no network or database call at all. */
export async function runScheduledIntelCollectors(env, options = {}) {
  if (!collectorEnabled(env)) return { ran: false, reason: 'collector_disabled' };
  return runUsgsCollector(env, options);
}
