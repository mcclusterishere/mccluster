/* CONNECTICUT WEATHER, READ FROM CORE'S SNAPSHOT (owner only).

     GET /v1/world/weather/connecticut-pilot              the latest snapshot, ages recomputed now
     GET /v1/world/weather/connecticut-pilot?rasters=0    the same without the three grids (a few KB)

   McCluster Core on OVH ingests every feed ONCE per region (job
   weather_region_snapshot, core/src/executors/weather-region-snapshot.mjs) and
   the snapshot is that job's output in ops_agent_jobs, the same storage the
   morning briefs use (./news-briefs.js): no new table. This route never calls
   NWS, NOAA, MRMS or NEXRAD. It reads the latest finished job once a minute at
   most (Cache API, one shared entry, not per viewer), so readers never multiply
   upstream or database calls.

   Owner only, like the other Halo feeds on the admin globe: the release guard
   maps /v1/world/weather/* to the globe feature 'weather'
   (packages/release-policy/globe.mjs) and this handler checks the house owner
   again (houseOwnerOf). Every answer is `private, no-store`.

   Each record's age is recomputed here from its own observation or issue time,
   and `stale` is set when it passed its stale_at, so a snapshot that stops
   updating visibly ages instead of looking current. Records keep what Core
   wrote: source, product, units, data_kind (observation | forecast | alert),
   quality flags, and, for radial velocity, that it is relative to KOKX.
   Docs: docs/control-plane/CONNECTICUT-WEATHER.md. */
import { fail, reply } from './lib/http.js';
import { houseOwnerOf } from './world-halo-ops.js';
import { service } from './world-cctv.js';

export const WEATHER_PREFIX = '/v1/world/weather';
export const WEATHER_REGIONS = Object.freeze(['connecticut-pilot']);
export const WEATHER_JOB_TYPE = 'weather_region_snapshot';
export const SNAPSHOT_SCHEMA = 'mccluster.weather.snapshot.v1';
export const WEATHER_FEEDS = Object.freeze(['observation', 'forecast_hourly', 'alerts', 'water_level', 'tide_predictions', 'rain_now', 'radar_reflectivity', 'radar_velocity']);
const RASTERS = new Set(['rain_now', 'radar_reflectivity', 'radar_velocity']);
const CACHE_SECONDS = 60;
const CACHE_ORIGIN = 'https://weather-snapshot.mccluster.internal';

function privately(res) {
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
const send = (request, env, body, status = 200) => privately(reply(request, env, body, status));

/* Seconds since each record's own basis time; stale once past stale_at. */
export function ageSnapshot(snapshot, nowMs = Date.now(), { rasters = true } = {}) {
  const feeds = {};
  for (const key of WEATHER_FEEDS) {
    const r = snapshot?.feeds?.[key];
    if (!r || typeof r !== 'object') continue;
    const basis = Date.parse(r.observed_at || r.issued_at || r.valid_from || '');
    const staleAt = Date.parse(r.stale_at || '');
    const record = {
      ...r,
      age_s: Number.isFinite(basis) ? Math.max(0, Math.round((nowMs - basis) / 1000)) : null,
      stale: r.status === 'missing' || !Number.isFinite(staleAt) || staleAt <= nowMs,
    };
    if (!rasters && RASTERS.has(key) && record.payload && typeof record.payload === 'object') {
      const { data: _omitted, ...rest } = record.payload;
      record.payload = { ...rest, data_omitted: true };
    }
    feeds[key] = record;
  }
  const generated = Date.parse(snapshot?.generated_at || '');
  return {
    ...snapshot,
    feeds,
    read_at: new Date(nowMs).toISOString(),
    snapshot_age_s: Number.isFinite(generated) ? Math.max(0, Math.round((nowMs - generated) / 1000)) : null,
  };
}

async function houseOrgId(env, fetchImpl) {
  const rows = await service(env, 'orgs?slug=eq.mccluster&select=id&limit=1', fetchImpl);
  return rows[0]?.id || null;
}

/* The latest finished snapshot for a region, through one shared minute-long cache entry. */
export async function latestSnapshot(env, region, { fetchImpl = fetch, cacheImpl = globalThis.caches?.default || null, nowMs = Date.now() } = {}) {
  const key = new Request(`${CACHE_ORIGIN}/${region}`);
  if (cacheImpl) {
    const hit = await cacheImpl.match(key).catch(() => null);
    if (hit) {
      const cached = await hit.json().catch(() => null);
      if (cached && Number.isFinite(cached.cached_at) && nowMs - cached.cached_at < CACHE_SECONDS * 1000) return cached.value;
    }
  }
  const org = await houseOrgId(env, fetchImpl);
  if (!org) throw Object.assign(new Error('house org unavailable'), { status: 503 });
  const rows = await service(env, `ops_agent_jobs?org_id=eq.${encodeURIComponent(org)}&job_type=eq.${WEATHER_JOB_TYPE}&target_id=eq.${encodeURIComponent(region)}&status=eq.done&select=output,updated_at&order=updated_at.desc&limit=1`, fetchImpl);
  const snapshot = rows[0]?.output?.snapshot;
  const value = snapshot && snapshot.schema === SNAPSHOT_SCHEMA && snapshot.region === region ? snapshot : null;
  if (cacheImpl) {
    const body = JSON.stringify({ cached_at: nowMs, value });
    await cacheImpl.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_SECONDS}` } })).catch(() => null);
  }
  return value;
}

export async function handleWorldWeather(request, env, { fetchImpl = fetch, cacheImpl, nowMs = Date.now() } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== WEATHER_PREFIX && !path.startsWith(`${WEATHER_PREFIX}/`)) return null;
  if (request.method !== 'GET') return privately(fail(request, env, 'Method not allowed', 405));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return send(request, env, { ok: false, error: 'not configured' }, 503);
  if (!(await houseOwnerOf(request, env, fetchImpl))) return send(request, env, { ok: false, code: 'owner_only', error: 'Only the house owner may see this.' }, 403);
  const region = path.slice(WEATHER_PREFIX.length + 1);
  if (!WEATHER_REGIONS.includes(region)) return send(request, env, { ok: false, code: 'unknown_region', error: 'Weather is kept for connecticut-pilot only.', regions: WEATHER_REGIONS }, 404);
  let snapshot;
  try {
    snapshot = await latestSnapshot(env, region, { fetchImpl, cacheImpl, nowMs });
  } catch {
    return send(request, env, { ok: false, code: 'unavailable', error: 'Weather is unavailable right now.' }, 503);
  }
  if (!snapshot) {
    return send(request, env, {
      ok: true, available: false, region, reason: 'no_snapshot_yet',
      note: 'No finished weather_region_snapshot job yet. Ingest on McCluster Core is off until the owner enables it (docs/control-plane/CONNECTICUT-WEATHER.md).',
    });
  }
  return send(request, env, { ok: true, available: true, ...ageSnapshot(snapshot, nowMs, { rasters: url.searchParams.get('rasters') !== '0' }) });
}
