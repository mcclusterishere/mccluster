/* INGEST ONCE, SERVE SMALL: fetch every Connecticut feed once and build one
   normalized snapshot (mccluster.weather.snapshot.v1).

   Each feed is independent: one that times out, errors or changes format
   becomes a `missing` record (or the previous run's record, `carried_forward`,
   still carrying its original times so it keeps ageing), and the rest of the
   snapshot is unaffected. Nothing here throws for an upstream failure.

   Upstream etiquette: one request per feed per run, a generic identifying
   User-Agent (never a person's address), redirects refused, bodies capped.
   S3 buckets are listed with `start-after` so a listing returns only the last
   few minutes of keys. */
import zlib from 'node:zlib';
import { GRID, REGION, SNAPSHOT_SCHEMA, USER_AGENT, FEED_KEYS } from './region.mjs';
import {
  LEVEL_CODEC, RATE_CODEC, aggregateToGrid, clip, gridCellAt, missingRecord, normalizeAlerts, normalizeForecast,
  normalizeObservation, normalizePredictions, normalizeWaterLevel, baseRecord, decodeRate, num, toBase64,
} from './fields.mjs';
import { decodeWindow } from './grib2.mjs';
import { OUTSIDE, beamHeightM, decodeLevel3, levelValue, rangeBearing, resampleToGrid } from './nexrad-level3.mjs';

export const JSON_TIMEOUT_MS = 20_000;
export const OBJECT_TIMEOUT_MS = 45_000;
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_OBJECT_BYTES = 8 * 1024 * 1024;
/* how long a record may be carried forward when its feed fails, by kind */
export const CARRY_LIMIT_S = Object.freeze({ raster: 2 * 3600, default: 24 * 3600 });
const RASTER_FEEDS = new Set(['rain_now', 'radar_reflectivity', 'radar_velocity']);

function fail(message, code) { return Object.assign(new Error(message), { code }); }

async function readCapped(res, max) {
  const len = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(len) && len > max) throw fail('response too large', 'too_large');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > max) throw fail('response too large', 'too_large');
  return buf;
}

export async function fetchBytes(url, { fetchImpl = globalThis.fetch, timeoutMs = OBJECT_TIMEOUT_MS, maxBytes = MAX_OBJECT_BYTES, accept = '*/*' } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw fail(error?.name === 'TimeoutError' ? 'timeout' : 'fetch failed', error?.name === 'TimeoutError' ? 'timeout' : 'fetch_failed');
  }
  if (!res.ok) throw fail(`HTTP ${res.status}`, `http_${res.status}`);
  return readCapped(res, maxBytes);
}

export async function fetchJson(url, opts = {}) {
  const bytes = await fetchBytes(url, { timeoutMs: JSON_TIMEOUT_MS, maxBytes: MAX_JSON_BYTES, accept: 'application/geo+json, application/json', ...opts });
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw fail('response is not JSON', 'bad_json'); }
}

/* ---------- S3 public bucket listing (ListObjectsV2, anonymous) ---------- */
export function parseListing(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([^<]+)<\/Key>/.exec(m[1])?.[1];
    const modified = /<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1];
    const size = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1]);
    if (key) out.push({ key, last_modified: modified || null, size: Number.isFinite(size) ? size : null });
  }
  return out;
}
export const bucketUrl = (bucket) => `https://${bucket}.s3.amazonaws.com`;
export async function listBucket(bucket, { prefix, startAfter, maxKeys = 200, fetchImpl }) {
  const q = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': String(maxKeys) });
  if (startAfter) q.set('start-after', startAfter);
  const bytes = await fetchBytes(`${bucketUrl(bucket)}/?${q}`, { fetchImpl, timeoutMs: JSON_TIMEOUT_MS, maxBytes: MAX_JSON_BYTES, accept: 'application/xml' });
  return parseListing(new TextDecoder().decode(bytes));
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

/* MRMS keys: CONUS/PrecipRate_00.00/YYYYMMDD/MRMS_PrecipRate_00.00_YYYYMMDD-HHMMSS.grib2.gz */
export function mrmsKeyTime(key) {
  const m = /_(\d{8})-(\d{6})\.grib2\.gz$/.exec(key);
  return m ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4)}Z` : null;
}
/* Level III keys: OKX_N0B_YYYY_MM_DD_HH_MM_SS (the volume scan start) */
export function level3KeyTime(key) {
  const m = /_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})$/.exec(key);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/* The newest key at or before `now`, looking back `lookbackMin` minutes (today and, across midnight, yesterday). */
export async function latestKey({ bucket, dayPrefix, keyTime, startAfterFor, now, lookbackMin, fetchImpl }) {
  const nowMs = Number(new Date(now));
  const since = new Date(nowMs - lookbackMin * 60_000);
  const days = ymd(since) === ymd(new Date(nowMs)) ? [new Date(nowMs)] : [since, new Date(nowMs)];
  let best = null;
  for (const day of days) {
    const list = await listBucket(bucket, { prefix: dayPrefix(day), startAfter: startAfterFor(since, day), fetchImpl });
    for (const item of list) {
      const t = keyTime(item.key);
      if (!t || Date.parse(t) > nowMs + 60_000) continue;
      if (!best || t > best.time) best = { ...item, time: t };
    }
  }
  return best;
}

export function mrmsLocator(feed) {
  return {
    bucket: feed.bucket,
    dayPrefix: (d) => `${feed.prefix}${ymd(d)}/`,
    startAfterFor: (since, day) => (ymd(since) === ymd(day) ? `${feed.prefix}${ymd(day)}/MRMS_PrecipRate_00.00_${ymd(since)}-${pad(since.getUTCHours())}${pad(since.getUTCMinutes())}00.grib2.gz` : null),
    keyTime: mrmsKeyTime,
  };
}
export function level3Locator(feed) {
  const stem = (d) => `${feed.site}_${feed.product}_${d.getUTCFullYear()}_${pad(d.getUTCMonth() + 1)}_${pad(d.getUTCDate())}_`;
  return {
    bucket: feed.bucket,
    dayPrefix: stem,
    startAfterFor: (since, day) => (ymd(since) === ymd(day) ? `${stem(day)}${pad(since.getUTCHours())}_${pad(since.getUTCMinutes())}_00` : null),
    keyTime: level3KeyTime,
  };
}

/* ---------- raster feeds ---------- */
export async function ingestMrms({ now, fetchImpl }) {
  const feed = REGION.feeds.rain_now;
  const loc = mrmsLocator(feed);
  const latest = await latestKey({ ...loc, now, lookbackMin: 30, fetchImpl });
  if (!latest) throw fail('no MRMS PrecipRate file in the last 30 minutes', 'no_recent_file');
  const url = `${bucketUrl(feed.bucket)}/${latest.key}`;
  const gz = await fetchBytes(url, { fetchImpl });
  const grib = zlib.gunzipSync(gz, { maxOutputLength: 64 * 1024 * 1024 });
  const { meta, window, values } = decodeWindow(grib, GRID);
  if (meta.parameter.category !== 6 || meta.parameter.number !== 1 || meta.discipline !== 209) {
    throw fail(`unexpected MRMS parameter ${meta.discipline}/${meta.parameter.category}/${meta.parameter.number}`, 'unexpected_product');
  }
  const { codes, stats } = aggregateToGrid(window, values, GRID);
  const focus = codes[gridCellAt(GRID, REGION.focus.lat, REGION.focus.lon)];
  return baseRecord('rain_now', {
    now, url, dataKind: 'observation', observedAt: meta.reference_time, validFrom: meta.reference_time,
    units: { precip_rate: 'mm/h' },
    qualityFlags: ['radar_estimate', 'aggregated_mean_2x2'],
    derivedFrom: [latest.key],
    payload: {
      codec: RATE_CODEC, encoding: 'uint8-base64', grid: 'region', data: toBase64(codes),
      native_resolution_deg: 0.01, aggregation: 'mean of the native 0.01 deg cells inside each 0.02 deg cell; negative MRMS sentinels are no coverage',
      stats, focus: { name: REGION.focus.name, precip_rate_mmh: decodeRate(focus), code: focus },
      meaning: 'Estimated instantaneous surface precipitation rate from the multi-radar mosaic. Not an accumulation.',
      source_last_modified: latest.last_modified,
    },
  });
}

export async function ingestLevel3(feedKey, { now, fetchImpl, inflate }) {
  const feed = REGION.feeds[feedKey];
  const loc = level3Locator(feed);
  const latest = await latestKey({ ...loc, now, lookbackMin: 40, fetchImpl });
  if (!latest) throw fail(`no ${feed.product} product in the last 40 minutes`, 'no_recent_file');
  const url = `${bucketUrl(feed.bucket)}/${latest.key}`;
  const bytes = await fetchBytes(url, { fetchImpl, maxBytes: 2 * 1024 * 1024 });
  const decoded = await decodeLevel3(bytes, inflate ? { inflate } : undefined);
  const h = decoded.header;
  if (h.code !== feed.product) throw fail(`expected ${feed.product}, got ${h.code}`, 'unexpected_product');
  const codes = resampleToGrid(decoded, GRID);
  let covered = 0, valued = 0, special1 = 0;
  let max = null, min = null;
  for (const c of codes) {
    if (c === OUTSIDE) continue;
    covered += 1;
    if (c === 1) special1 += 1;
    const v = levelValue(c, h.thresholds);
    if (v === null) continue;
    valued += 1;
    if (max === null || v > max) max = v;
    if (min === null || v < min) min = v;
  }
  const fb = rangeBearing(h.radar.lat, h.radar.lon, REGION.focus.lat, REGION.focus.lon);
  const focusCode = codes[gridCellAt(GRID, REGION.focus.lat, REGION.focus.lon)];
  const velocity = h.quantity === 'radial_velocity';
  const flags = ['nearest_bin_resample', 'lowest_tilt_only'];
  if (velocity) flags.push('radial_component_only', 'relative_to_radar', 'aliasing_possible');
  else flags.push('returns_not_rainfall');
  return baseRecord(feedKey, {
    now, url, dataKind: 'observation', observedAt: h.volume_start, validFrom: h.volume_start,
    units: { [h.quantity]: h.units },
    qualityFlags: flags,
    derivedFrom: [latest.key],
    payload: {
      codec: LEVEL_CODEC, encoding: 'uint8-base64', grid: 'region', data: toBase64(codes),
      product_code: h.product, product: h.code, product_name: h.name, quantity: h.quantity,
      lut: { min: h.thresholds.min, increment: h.thresholds.increment, levels: h.thresholds.levels, code0: 'below_threshold', code1: h.code1, code255: 'outside_scan' },
      radar: {
        id: feed.radar, lat: h.radar.lat, lon: h.radar.lon, height_m: num(h.radar.height_ft * 0.3048, 1),
        elevation_deg: h.elevation_deg, vcp: h.vcp, volume_start: h.volume_start, generated: h.generated,
        gate_km: decoded.km_per_bin, bins: decoded.nBins, radials: decoded.radials.length,
      },
      stats: { cells: codes.length, covered_cells: covered, valued_cells: valued, [`${h.code1}_cells`]: special1, min, max },
      focus: {
        name: REGION.focus.name, code: focusCode, value: levelValue(focusCode, h.thresholds),
        range_km: num(fb.km, 1), azimuth_from_radar_deg: num(fb.deg, 1), beam_centre_height_m: beamHeightM(fb.km, h.elevation_deg),
      },
      meaning: velocity
        ? `Radial velocity toward or away from ${feed.radar} only (positive = away from the radar, negative = toward it). It is the component along the beam at the beam's height, not a wind vector at the ground, and it changes meaning if another radar is chosen.`
        : `Radar returns at the lowest tilt of ${feed.radar}, in dBZ. Not a rain gauge: returns include clutter, birds and insects, and the beam rises with distance.`,
      source_last_modified: latest.last_modified,
    },
  });
}

/* ---------- the whole region ---------- */
function predictionsUrl(now) {
  const start = new Date(Number(new Date(now)) - 86_400_000);
  return `${REGION.feeds.tide_predictions.url}&begin_date=${ymd(start)}&range=72`;
}

export async function ingestRegion({ now = new Date(), fetchImpl = globalThis.fetch, inflate, only = FEED_KEYS } = {}) {
  const f = REGION.feeds;
  const jobs = {
    observation: async () => normalizeObservation(await fetchJson(f.observation.url, { fetchImpl }), { now, url: f.observation.url }),
    forecast_hourly: async () => normalizeForecast(await fetchJson(f.forecast_hourly.url, { fetchImpl }), { now, url: f.forecast_hourly.url }),
    alerts: async () => normalizeAlerts(await fetchJson(f.alerts.url, { fetchImpl }), { now, url: f.alerts.url }),
    water_level: async () => normalizeWaterLevel(await fetchJson(f.water_level.url, { fetchImpl }), { now, url: f.water_level.url }),
    tide_predictions: async () => { const url = predictionsUrl(now); return normalizePredictions(await fetchJson(url, { fetchImpl }), { now, url }); },
    rain_now: () => ingestMrms({ now, fetchImpl }),
    radar_reflectivity: () => ingestLevel3('radar_reflectivity', { now, fetchImpl, inflate }),
    radar_velocity: () => ingestLevel3('radar_velocity', { now, fetchImpl, inflate }),
  };
  const records = {}, receipts = [];
  // JSON feeds in parallel; the rasters one after another so peak memory stays one decode
  const jsonKeys = only.filter((k) => !RASTER_FEEDS.has(k));
  const rasterKeys = only.filter((k) => RASTER_FEEDS.has(k));
  const run = async (key) => {
    const t0 = Date.now();
    try {
      records[key] = await jobs[key]();
      receipts.push({ feed: key, status: 'ok', ms: Date.now() - t0 });
    } catch (error) {
      const code = clip(error?.code || 'failed', 40);
      records[key] = missingRecord(key, { now, reason: code });
      receipts.push({ feed: key, status: 'missing', reason: code, detail: clip(error?.message, 160), ms: Date.now() - t0 });
    }
  };
  await Promise.all(jsonKeys.map(run));
  for (const key of rasterKeys) await run(key);
  receipts.sort((a, b) => FEED_KEYS.indexOf(a.feed) - FEED_KEYS.indexOf(b.feed));
  return { records, receipts };
}

/* Carry the previous good record forward when a feed failed this run, within
   CARRY_LIMIT_S of its own observation/issue time. Its times are unchanged, so
   it keeps ageing and goes stale on its own schedule. */
export function mergeWithPrevious(records, previous, { now }) {
  const nowMs = Number(new Date(now));
  const out = {};
  for (const key of FEED_KEYS) {
    const rec = records[key];
    const prev = previous?.feeds?.[key];
    if (rec && rec.status !== 'missing') { out[key] = rec; continue; }
    const basis = Date.parse(prev?.observed_at || prev?.issued_at || prev?.valid_from || '');
    const limit = (RASTER_FEEDS.has(key) ? CARRY_LIMIT_S.raster : CARRY_LIMIT_S.default) * 1000;
    if (prev && prev.status !== 'missing' && prev.payload && Number.isFinite(basis) && nowMs - basis <= limit) {
      out[key] = {
        ...prev,
        status: 'carried_forward',
        quality_flags: [...new Set([...(prev.quality_flags || []).filter((q) => q !== 'carried_forward'), 'carried_forward'])].sort(),
        carried_reason: rec?.missing_reason || 'not_fetched',
        carried_at: new Date(nowMs).toISOString(),
      };
    } else {
      out[key] = rec || missingRecord(key, { now, reason: 'not_fetched' });
    }
  }
  return out;
}

export function buildSnapshot({ now = new Date(), records, receipts = [], previous = null, mode = 'live' }) {
  const feeds = mergeWithPrevious(records, previous, { now });
  const counts = { ok: 0, carried_forward: 0, missing: 0 };
  for (const r of Object.values(feeds)) counts[r.status] += 1;
  return {
    schema: SNAPSHOT_SCHEMA,
    region: REGION.id,
    region_name: REGION.name,
    generated_at: new Date(now).toISOString(),
    mode,
    grid: GRID,
    focus: REGION.focus,
    counts,
    feeds,
    receipts,
    notes: [
      'Observed, forecast, alert and simulated values are separate records; nothing here is fictional game weather.',
      'Ages are measured from each record\'s own observation or issue time, not from this snapshot.',
      'Radial velocity is relative to KOKX: motion toward or away from that radar along the beam, not a wind vector.',
    ],
  };
}

/* Seconds since each record's basis time, and whether it is past stale_at.
   The Worker and the desk recompute this at read time; this is the same rule. */
export function withAges(snapshot, now = new Date()) {
  const nowMs = Number(new Date(now));
  const feeds = {};
  for (const [key, r] of Object.entries(snapshot?.feeds || {})) {
    const basis = Date.parse(r.observed_at || r.issued_at || r.valid_from || '');
    feeds[key] = {
      ...r,
      age_s: Number.isFinite(basis) ? Math.max(0, Math.round((nowMs - basis) / 1000)) : null,
      stale: r.status === 'missing' ? true : Date.parse(r.stale_at || '') <= nowMs,
    };
  }
  return { ...snapshot, read_at: new Date(nowMs).toISOString(), feeds };
}
