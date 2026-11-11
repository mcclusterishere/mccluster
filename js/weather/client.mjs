/* WEATHER CLIENT: the small API the owner's desk uses now and the globe can call later.

     import { createWeatherLayer, decodeRaster, valueAt } from './js/weather/client.mjs';
     const layer = createWeatherLayer({ getToken: () => MCC_SUPA.token(), onUpdate: (snap) => draw(snap) });
     layer.start();            // polls GET /v1/world/weather/connecticut-pilot every 2 min; layer.stop()
     decodeRaster(snap.feeds.rain_now)   // { grid, values: Float32Array (NaN = no data), units, quantity }
     valueAt(snap, 'rain_now', 41.17, -73.19)

   The Worker answers only the house owner and serves McCluster Core's
   once-per-region snapshot (workers/mccluster/src/world-weather.js); this
   module never calls a weather provider. Ages come from the server and are
   advanced locally between polls with `ageNow`, so a page left open keeps
   showing data getting older rather than freezing at "2 min ago". */

export const API_ORIGIN = 'https://api.mccluster.org';
export const REGION = 'connecticut-pilot';
export const RASTER_FEEDS = Object.freeze(['rain_now', 'radar_reflectivity', 'radar_velocity']);

/* mrms-rate-u8-v1: same table as core/src/weather/fields.mjs (tested to agree) */
export function decodeRate(code) {
  if (code === 0) return 0;
  if (code >= 1 && code <= 199) return code / 10;
  if (code >= 200 && code <= 253) return 20 + (code - 200) * 2;
  return null;
}
/* nexrad-level-u8-v1: Level III level codes */
export function levelValue(code, lut) {
  if (code === 255 || code < 2 || !lut) return null;
  return lut.min + (code - 2) * lut.increment;
}

function base64Bytes(s) {
  const bin = typeof atob === 'function' ? atob(String(s || '')) : Buffer.from(String(s || ''), 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/* A raster record -> physical values on the snapshot grid. */
export function decodeRaster(record, grid) {
  const p = record && record.payload;
  if (!p || typeof p.data !== 'string' || !grid) return null;
  const codes = base64Bytes(p.data);
  if (codes.length !== grid.nx * grid.ny) return null;
  const values = new Float32Array(codes.length);
  const special = new Uint8Array(codes.length); // 0 value, 1 below threshold/dry-none, 2 special (missing/range folded), 3 outside
  for (let k = 0; k < codes.length; k += 1) {
    const c = codes[k];
    let v = null;
    if (p.codec === 'mrms-rate-u8-v1') { v = decodeRate(c); special[k] = c === 255 ? 3 : c === 254 ? 2 : 0; }
    else if (p.codec === 'nexrad-level-u8-v1') { v = levelValue(c, p.lut); special[k] = c === 255 ? 3 : c === 1 ? 2 : c === 0 ? 1 : 0; }
    values[k] = v === null ? NaN : v;
  }
  const unitKey = Object.keys(record.units || {})[0];
  return { grid, values, special, codes, units: unitKey ? record.units[unitKey] : null, quantity: p.quantity || unitKey || null, codec: p.codec };
}

export function cellIndex(grid, lat, lon) {
  const i = Math.floor((lon - grid.west) / grid.dlon), j = Math.floor((grid.north - lat) / grid.dlat);
  return i < 0 || j < 0 || i >= grid.nx || j >= grid.ny ? -1 : j * grid.nx + i;
}
export function valueAt(snapshot, feed, lat, lon) {
  const r = decodeRaster(snapshot?.feeds?.[feed], snapshot?.grid);
  if (!r) return null;
  const k = cellIndex(r.grid, lat, lon);
  return k < 0 || Number.isNaN(r.values[k]) ? null : r.values[k];
}

/* The record's age now, advancing the server's read-time age by local elapsed time. */
export function ageNow(record, snapshot, nowMs = Date.now()) {
  if (!record || record.age_s === null || record.age_s === undefined) return null;
  const readAt = Date.parse(snapshot?.read_at || '');
  return Math.max(0, Math.round(record.age_s + (Number.isFinite(readAt) ? (nowMs - readAt) / 1000 : 0)));
}
export function staleNow(record, nowMs = Date.now()) {
  if (!record || record.status === 'missing') return true;
  const at = Date.parse(record.stale_at || '');
  return !Number.isFinite(at) || at <= nowMs;
}
export function ageText(seconds) {
  if (seconds === null || seconds === undefined) return 'no time';
  if (seconds < 90) return `${seconds} s old`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min old`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h old`;
  return `${Math.round(seconds / 86400)} d old`;
}

export async function fetchWeather({ token, region = REGION, rasters = true, fetchImpl = globalThis.fetch, apiOrigin = API_ORIGIN, signal } = {}) {
  if (!token) throw Object.assign(new Error('Sign in with the house owner\'s account.'), { status: 401 });
  const res = await fetchImpl(`${apiOrigin}/v1/world/weather/${encodeURIComponent(region)}${rasters ? '' : '?rasters=0'}`, {
    headers: { authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw Object.assign(new Error(body?.error || `Weather answered ${res.status}`), { status: res.status });
  return body;
}

export function createWeatherLayer({ getToken, onUpdate = () => {}, onError = () => {}, intervalMs = 120_000, region = REGION, rasters = true, fetchImpl } = {}) {
  let timer = 0, latest = null, running = false;
  async function refresh() {
    try {
      const token = typeof getToken === 'function' ? await getToken() : null;
      latest = await fetchWeather({ token, region, rasters, fetchImpl });
      onUpdate(latest);
    } catch (error) { onError(error); }
    return latest;
  }
  return {
    start() { if (running) return; running = true; refresh(); timer = setInterval(refresh, Math.max(60_000, intervalMs)); },
    stop() { running = false; clearInterval(timer); },
    refresh,
    get latest() { return latest; },
  };
}
