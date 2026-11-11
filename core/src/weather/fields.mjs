/* WEATHER FIELDS: one normalized record per feed (WeatherFieldV1).

   The record extends the shape proposed in docs/fictional-city/PLANET-CONNECTICUT.md.
   Every record says where it came from (source_id, product, source_url,
   attribution), what kind of statement it is (data_kind: observation | forecast |
   alert | simulated), when (observed_at, issued_at, valid_from, valid_to,
   ingested_at, stale_at), in what units and datum, with which quality flags,
   and whether it is fresh, carried forward from an earlier run, or missing.

   Nothing here invents a value. A feed that did not answer is `missing`, with a
   null payload and a reason; it is never filled with a plausible number. Fictional
   game weather is produced elsewhere (js/weather/game-weather.mjs) and is always
   labelled `simulated`.

   Provider text is untrusted: strings are stripped of control characters and
   capped, numbers must be finite, links are kept only on the provider's own host. */
import { FIELD_SCHEMA, REGION } from './region.mjs';

export const DATA_KINDS = Object.freeze(['observation', 'forecast', 'alert', 'simulated']);
export const STATUSES = Object.freeze(['ok', 'carried_forward', 'missing']);

export function clip(v, max = 200) {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max).trim() : null;
}
export function num(v, places = 3) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
export function iso(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
/* CO-OPS times are "YYYY-MM-DD HH:MM" in the zone asked for (gmt). */
export function coopsTime(v) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(String(v || ''));
  return m ? iso(`${m[1]}T${m[2]}:00Z`) : null;
}
function providerLink(v, host) {
  try { const u = new URL(String(v)); return u.protocol === 'https:' && u.hostname === host ? u.href.slice(0, 300) : null; } catch { return null; }
}

/* The base record. `basis` is the time the record's age is measured from. */
export function baseRecord(feedKey, { now, url = null, dataKind, observedAt = null, issuedAt = null, validFrom = null, validTo = null,
  units = {}, verticalDatum = null, qualityFlags = [], payload = null, geometry = null, derivedFrom = [], extra = {} }) {
  const feed = REGION.feeds[feedKey];
  if (!feed) throw new Error(`unknown weather feed ${feedKey}`);
  if (!DATA_KINDS.includes(dataKind)) throw new Error(`invalid data_kind ${dataKind}`);
  const basis = observedAt || issuedAt || validFrom;
  const basisMs = Date.parse(basis || '');
  const nowIso = new Date(now).toISOString();
  return {
    schema: FIELD_SCHEMA,
    id: `${feed.source_id}:${feed.product}:${feed.station || feed.radar || feed.zone || feed.office || REGION.id}:${basis || nowIso}`,
    region: REGION.id,
    feed: feedKey,
    status: 'ok',
    source_id: feed.source_id,
    product: feed.product,
    source_url: url,
    attribution: feed.attribution,
    data_kind: dataKind,
    geometry,
    observed_at: observedAt,
    issued_at: issuedAt,
    valid_from: validFrom,
    valid_to: validTo,
    ingested_at: nowIso,
    stale_at: Number.isFinite(basisMs) ? new Date(basisMs + feed.stale_after_s * 1000).toISOString() : nowIso,
    expected_cadence_s: feed.expected_cadence_s,
    units,
    vertical_datum: verticalDatum,
    quality_flags: [...new Set(qualityFlags)].sort(),
    derived_from: derivedFrom,
    payload,
    ...extra,
  };
}

export function missingRecord(feedKey, { now, reason, url = null }) {
  const feed = REGION.feeds[feedKey];
  const nowIso = new Date(now).toISOString();
  return {
    schema: FIELD_SCHEMA,
    id: `${feed.source_id}:${feed.product}:missing:${nowIso}`,
    region: REGION.id, feed: feedKey, status: 'missing',
    source_id: feed.source_id, product: feed.product, source_url: url, attribution: feed.attribution,
    data_kind: null, geometry: null,
    observed_at: null, issued_at: null, valid_from: null, valid_to: null,
    ingested_at: nowIso, stale_at: nowIso, expected_cadence_s: feed.expected_cadence_s,
    units: {}, vertical_datum: null, quality_flags: ['missing'], derived_from: [], payload: null,
    missing_reason: clip(reason, 120) || 'unavailable',
  };
}

/* ---------- NWS station observation ----------
   QC codes are MADIS's: Z none applied, C coarse pass, S screened, V verified,
   X rejected, Q questioned, G subjective good, B subjective bad. A value whose
   QC is X or B is withheld (null) and flagged; everything else is kept with its
   code. Each value keeps the NWS unitCode it arrived with. */
const QC = { Z: 'qc_none', C: 'qc_coarse_pass', S: 'qc_screened', V: 'qc_verified', X: 'qc_rejected', Q: 'qc_questioned', G: 'qc_subjective_good', B: 'qc_subjective_bad', T: 'qc_temporal' };
const OBS_FIELDS = ['temperature', 'dewpoint', 'relativeHumidity', 'windDirection', 'windSpeed', 'windGust', 'barometricPressure', 'seaLevelPressure', 'visibility', 'precipitationLastHour', 'precipitationLast3Hours', 'heatIndex', 'windChill'];
const SNAKE = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const unitOf = (code) => clip(String(code || '').replace(/^wmoUnit:/, ''), 40);

export function normalizeObservation(json, { now, url }) {
  const p = json?.properties;
  const observedAt = iso(p?.timestamp);
  if (!p || !observedAt) throw Object.assign(new Error('NWS observation has no timestamp'), { code: 'bad_payload' });
  const values = {}, units = {}, qc = {};
  const flags = [];
  for (const k of OBS_FIELDS) {
    const field = p[k];
    if (!field || typeof field !== 'object') continue;
    const key = SNAKE(k);
    const code = clip(field.qualityControl, 2);
    let value = num(field.value, 3);
    if (code === 'X' || code === 'B') { flags.push(`${key}_withheld_${QC[code]}`); value = null; }
    values[key] = value;
    units[key] = unitOf(field.unitCode);
    if (code) qc[key] = QC[code] || `qc_${code.toLowerCase()}`;
  }
  if (Object.values(qc).some((c) => c === 'qc_none')) flags.push('some_values_not_quality_controlled');
  const coords = json?.geometry?.coordinates;
  return baseRecord('observation', {
    now, url, dataKind: 'observation', observedAt, validFrom: observedAt,
    units, qualityFlags: flags,
    geometry: Array.isArray(coords) && num(coords[0]) !== null ? { type: 'Point', coordinates: [num(coords[0], 5), num(coords[1], 5)] } : null,
    payload: {
      station: REGION.feeds.observation.station,
      station_name: clip(p.stationName, 80) || REGION.feeds.observation.station_name,
      description: clip(p.textDescription, 80),
      values, qc,
      elevation_m: num(p.elevation?.value, 1),
    },
  });
}

/* ---------- NWS hourly forecast ----------
   `issued_at` is updateTime (when forecasters last changed the grid, the real
   issue time); generatedAt (when api.weather.gov rendered this response, which
   is always "now") is kept in the payload and never used to make it look fresh. windSpeed
   arrives as text ("7 mph" or "5 to 10 mph"); the upper figure is parsed. */
function mph(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*(?:to\s*(\d+(?:\.\d+)?))?\s*mph/i);
  return m ? Number(m[2] || m[1]) : null;
}
export function normalizeForecast(json, { now, url, periods = REGION.feeds.forecast_hourly.periods }) {
  const p = json?.properties;
  const list = Array.isArray(p?.periods) ? p.periods : null;
  const issuedAt = iso(p?.updateTime) || iso(p?.generatedAt);
  if (!list || !issuedAt) throw Object.assign(new Error('NWS forecast has no periods'), { code: 'bad_payload' });
  const nowMs = Number(new Date(now));
  const out = [];
  for (const period of list) {
    const start = iso(period?.startTime), end = iso(period?.endTime);
    if (!start || !end || Date.parse(end) <= nowMs) continue; // past hours are not "the forecast" any more
    const tf = num(period.temperature, 1);
    const unit = clip(period.temperatureUnit, 2);
    const windMph = mph(period.windSpeed);
    out.push({
      start, end,
      daytime: period.isDaytime === true,
      temperature_c: tf === null ? null : unit === 'F' ? num(((tf - 32) * 5) / 9, 1) : tf,
      precip_probability_pct: num(period.probabilityOfPrecipitation?.value, 0),
      dewpoint_c: num(period.dewpoint?.value, 1),
      relative_humidity_pct: num(period.relativeHumidity?.value, 0),
      wind_speed_ms: windMph === null ? null : num(windMph * 0.44704, 1),
      wind_direction: clip(period.windDirection, 4),
      short_forecast: clip(period.shortForecast, 80),
    });
    if (out.length >= periods) break;
  }
  const flags = [];
  if (!out.length) flags.push('no_future_periods');
  return baseRecord('forecast_hourly', {
    now, url, dataKind: 'forecast', issuedAt,
    validFrom: out[0]?.start || null, validTo: out.at(-1)?.end || null,
    units: { temperature: 'degC', dewpoint: 'degC', precip_probability: 'percent', relative_humidity: 'percent', wind_speed: 'm/s', wind_direction: 'compass point' },
    qualityFlags: flags,
    payload: {
      office: REGION.feeds.forecast_hourly.office, grid_x: REGION.feeds.forecast_hourly.grid_x, grid_y: REGION.feeds.forecast_hourly.grid_y,
      generated_at: iso(p.generatedAt), issue_basis: iso(p.updateTime) ? 'updateTime' : 'generatedAt', periods: out,
    },
  });
}

/* ---------- NWS active alerts ----------
   Official text, trimmed: event, severity, urgency, certainty, headline and
   times, with a link to the alert on api.weather.gov. Zero alerts is a valid,
   fresh answer ("none active"), not a missing feed. */
export function normalizeAlerts(json, { now, url }) {
  const features = Array.isArray(json?.features) ? json.features : null;
  if (!features) throw Object.assign(new Error('NWS alerts response has no features'), { code: 'bad_payload' });
  const nowIso = new Date(now).toISOString();
  const alerts = features.slice(0, 20).map((f) => {
    const a = f?.properties || {};
    return {
      id: clip(a.id, 160),
      event: clip(a.event, 80),
      severity: clip(a.severity, 20), urgency: clip(a.urgency, 20), certainty: clip(a.certainty, 20),
      status: clip(a.status, 20), message_type: clip(a.messageType, 20),
      headline: clip(a.headline, 300),
      area: clip(a.areaDesc, 200),
      sender: clip(a.senderName, 80),
      sent: iso(a.sent), effective: iso(a.effective), onset: iso(a.onset), expires: iso(a.expires), ends: iso(a.ends),
      instruction: clip(a.instruction, 600),
      link: providerLink(f?.id || a['@id'], 'api.weather.gov'),
    };
  }).filter((a) => a.event);
  const updated = iso(json.updated) || nowIso;
  return baseRecord('alerts', {
    now, url, dataKind: 'alert', issuedAt: updated, validFrom: updated,
    qualityFlags: features.length > 20 ? ['truncated_to_20'] : [],
    payload: { zone: REGION.feeds.alerts.zone, zone_name: REGION.feeds.alerts.zone_name, count: alerts.length, alerts },
  });
}

/* ---------- NOAA CO-OPS water level ----------
   q:"p" is preliminary, q:"v" verified. f is four 0/1 flags: O (count of
   samples outside 3 sigma), F (flat tolerance), R (rate of change), L (limit). */
export function normalizeWaterLevel(json, { now, url }) {
  if (json?.error) throw Object.assign(new Error(clip(json.error.message, 120) || 'CO-OPS error'), { code: 'upstream_error' });
  const row = Array.isArray(json?.data) ? json.data[0] : null;
  const observedAt = coopsTime(row?.t);
  const level = num(row?.v, 3);
  if (!observedAt || level === null) throw Object.assign(new Error('CO-OPS water level missing'), { code: 'bad_payload' });
  const feed = REGION.feeds.water_level;
  const flags = [];
  if (row.q === 'p') flags.push('preliminary'); else if (row.q === 'v') flags.push('verified');
  const f = String(row.f || '').split(',');
  ['outlier_samples', 'flat_tolerance', 'rate_of_change', 'limit_exceeded'].forEach((name, i) => { if (f[i] && f[i] !== '0') flags.push(name); });
  return baseRecord('water_level', {
    now, url, dataKind: 'observation', observedAt, validFrom: observedAt,
    validTo: new Date(Date.parse(observedAt) + 6 * 60_000).toISOString(),
    units: { water_level: 'm', sigma: 'm' }, verticalDatum: feed.vertical_datum, qualityFlags: flags,
    geometry: { type: 'Point', coordinates: [feed.lon, feed.lat] },
    payload: { station: feed.station, station_name: feed.station_name, water_level: level, sigma: num(row.s, 3) },
  });
}

/* ---------- NOAA CO-OPS high/low predictions ---------- */
export function normalizePredictions(json, { now, url }) {
  if (json?.error) throw Object.assign(new Error(clip(json.error.message, 120) || 'CO-OPS error'), { code: 'upstream_error' });
  const rows = Array.isArray(json?.predictions) ? json.predictions : null;
  if (!rows) throw Object.assign(new Error('CO-OPS predictions missing'), { code: 'bad_payload' });
  const feed = REGION.feeds.tide_predictions;
  const events = rows.map((r) => ({ t: coopsTime(r?.t), level: num(r?.v, 3), type: r?.type === 'H' ? 'high' : r?.type === 'L' ? 'low' : null }))
    .filter((e) => e.t && e.level !== null && e.type).slice(0, 12);
  if (!events.length) throw Object.assign(new Error('CO-OPS predictions empty'), { code: 'bad_payload' });
  return baseRecord('tide_predictions', {
    now, url, dataKind: 'forecast', issuedAt: new Date(now).toISOString(),
    validFrom: events[0].t, validTo: events.at(-1).t,
    units: { level: 'm' }, verticalDatum: feed.vertical_datum, qualityFlags: ['astronomical_prediction'],
    geometry: { type: 'Point', coordinates: [feed.lon, feed.lat] },
    payload: { station: feed.station, station_name: feed.station_name, issue_basis: 'retrieved_at: astronomical predictions carry no issue time', events },
  });
}

/* ---------- rasters ----------
   Rasters ride in the snapshot as uint8 arrays, base64, on the region GRID.

   mrms-rate-u8-v1 (MRMS PrecipRate, mm/h):
     0          no precipitation (0 mm/h)
     1..199     code * 0.1 mm/h            (0.1 to 19.9)
     200..253   20 + (code - 200) * 2 mm/h (20 to 126; heavier saturates at 253)
     254        no radar coverage / missing (MRMS negative sentinels)
     255        outside the source grid
   nexrad-level-u8-v1 (Level III level codes, kept as the product sent them):
     0 below threshold; 1 range folded (velocity) or missing (reflectivity);
     n >= 2 is lut.min + (n - 2) * lut.increment in the product's units;
     255 outside the scan (the product's top level code is folded into 254). */
export const RATE_CODEC = 'mrms-rate-u8-v1';
export const LEVEL_CODEC = 'nexrad-level-u8-v1';
export function encodeRate(mmh) {
  if (mmh === null || mmh === undefined || !Number.isFinite(mmh) || mmh < 0) return 254;
  if (mmh === 0) return 0;
  if (mmh < 19.95) return Math.max(1, Math.round(mmh * 10));
  return Math.min(253, 200 + Math.round((mmh - 20) / 2));
}
export function decodeRate(code) {
  if (code === 0) return 0;
  if (code >= 1 && code <= 199) return Math.round(code) / 10;
  if (code >= 200 && code <= 253) return 20 + (code - 200) * 2;
  return null; // 254 no coverage, 255 outside
}
export const toBase64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
export const fromBase64 = (s) => new Uint8Array(Buffer.from(String(s || ''), 'base64'));

/* Mean of the native cells whose centres fall inside each region cell. */
export function aggregateToGrid(window, values, grid) {
  const sums = new Float64Array(grid.nx * grid.ny), counts = new Uint16Array(grid.nx * grid.ny), seen = new Uint8Array(grid.nx * grid.ny);
  const maxes = new Float32Array(grid.nx * grid.ny).fill(-Infinity);
  for (let j = 0; j < window.nj; j += 1) {
    const lat = window.north - j * window.dj;
    const gj = Math.floor((grid.north - lat) / grid.dlat);
    if (gj < 0 || gj >= grid.ny) continue;
    for (let i = 0; i < window.ni; i += 1) {
      const lon = window.west + i * window.di;
      const gi = Math.floor((lon - grid.west) / grid.dlon);
      if (gi < 0 || gi >= grid.nx) continue;
      const k = gj * grid.nx + gi;
      seen[k] = 1;
      const v = values[j * window.ni + i];
      if (!(v >= 0)) continue; // negative sentinels: no coverage / missing
      sums[k] += v; counts[k] += 1;
      if (v > maxes[k]) maxes[k] = v;
    }
  }
  const codes = new Uint8Array(grid.nx * grid.ny);
  let wet = 0, covered = 0, max = 0;
  for (let k = 0; k < codes.length; k += 1) {
    if (!seen[k]) { codes[k] = 255; continue; }
    if (!counts[k]) { codes[k] = 254; continue; }
    covered += 1;
    const mean = sums[k] / counts[k];
    codes[k] = encodeRate(mean);
    if (codes[k] > 0) wet += 1;
    if (maxes[k] > max) max = maxes[k];
  }
  return { codes, stats: { cells: codes.length, covered_cells: covered, wet_cells: wet, max_native_mmh: num(max, 1) } };
}

export function gridCellAt(grid, lat, lon) {
  const i = Math.floor((lon - grid.west) / grid.dlon), j = Math.floor((grid.north - lat) / grid.dlat);
  return i < 0 || j < 0 || i >= grid.nx || j >= grid.ny ? -1 : j * grid.nx + i;
}
