/* Current release policy: world-release.js requires live house-owner preview
   before dispatch. packages/release-policy/globe.mjs maps every path below to
   an owner-only globe feature; nothing in this file publishes a feed. */
/* HALO ON THE ADMIN GLOBE: the live feeds Hitman's Halo had, served through
   the canonical Worker for the house owner (owner direction 2026-10-16:
   Halo feeds belong to internal intelligence, not a public or paid globe).

     GET /v1/world/layers/military     military aircraft now        adsb.lol
     GET /v1/world/layers/quakes       earthquakes, past day        USGS
     GET /v1/world/layers/fires        active fires, past day       NASA FIRMS (needs FIRMS_MAP_KEY)
     GET /v1/world/layers/perimeters   current US fire perimeters   NIFC WFIGS
     GET /v1/world/layers/cyclones     active tropical cyclones     NOAA NHC
     GET /v1/world/layers/vessels      ships, from the AIS stream   AISStream.io (needs AISSTREAM_API_KEY
                                       the Worker already keeps      and the HereTenantAgent binding)
     GET /v1/world/geocode?q=          place search                 Photon, then Nominatim

   Same contract as the World's other layers (./world-layers.js, whose
   `upstream` and `cachedLayer` are reused here): every provider is fetched
   with redirect: 'manual' and may only redirect to its own host over https
   (lib/safe-fetch.js); each answer is trimmed to what the globe draws, kept in
   the Cache API for the layer's window, served as the last good answer
   (marked stale, with the reason) for up to 6 h while the provider is down,
   and otherwise an honest `unavailable` with zero rows, never an error page. A
   layer whose credential is missing answers `not_configured` without asking
   anyone. Every answer is `private, no-store`, varying on Origin and
   Authorization, because only the owner may see it.

   Nothing from a provider is trusted: every number is finite and range-checked
   (lat within ±90, lon within ±180), every string is length-capped (names at
   120 characters) and stripped of control characters, and links are kept only
   when they point at the provider's own https host. No credential is ever put
   in an answer, an error, a cache key or a log line.

   THE LAYERS, THEIR TERMS, AND WHAT IS DROPPED

   military: https://api.adsb.lol/v2/mil, keyless. adsb.lol's data is the Open
     Database License (ODbL) 1.0: attribution, share-alike for a derived
     database; its terms say a feeder API key will be required in future and
     ask production users to contact them. Dropped: aircraft on the ground,
     without a current position, with a position older than 60 s, and every
     privacy-flagged airframe (readsb dbFlags 4 = PIA, 8 = LADD), which is
     counted in `withheld`, never drawn. Capped at 4000. Window 30 s.
     Row: [hex, callsign, lon, lat, alt_m, speed_ms, track_deg, type, squawk, emergency];
     emergency is true for squawk 7500/7600/7700 or a readsb emergency other than 'none'.

   quakes: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson,
     keyless. USGS data is a U.S. Government work in the public domain; credit
     is requested. Dropped: events without an id or a valid epicentre. Capped
     at 2000 (feed order, newest first). Window 120 s.

   fires: NASA FIRMS area API, https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{source}/world/1,
     for VIIRS_SNPP_NRT and VIIRS_NOAA20_NRT. Needs FIRMS_MAP_KEY (a free key
     with a per-key transaction limit). NASA's open-data policy puts no
     restriction on reuse and asks for acknowledgement. The CSV is read line by
     line as it arrives, columns found by header name. Dropped: rows without a
     valid position, ragged rows; over the cap, the rows with the lowest fire
     radiative power (FRP) go first. Capped at 25000. Window 1800 s. One source
     down while the other answers is a partial answer, said so.
     Row: [lon, lat, frp_mw, confidence ('low'|'nominal'|'high'), acq (ISO, UTC), satellite, daynight ('D'|'N')].

   perimeters: NIFC WFIGS Interagency Fire Perimeters (current), the ArcGIS
     FeatureServer query, keyless and public. A U.S. interagency open-data
     product, provided as is; perimeters are operational, not legal
     boundaries, and cover U.S. incidents only. Asked for GeoJSON, simplified
     on the server (maxAllowableOffset 0.005°) at 4 decimals, largest first.
     Dropped: features without a drawable ring, invalid points, repeated
     points. Coordinates rounded to 4 decimals; at most 400 perimeters, 250
     rings each, 2000 points a ring (a longer ring is thinned evenly and
     stays closed). Every ring of every polygon, outer boundaries and holes
     alike, is listed together in `rings`. Window 600 s.

   cyclones: https://www.nhc.noaa.gov/CurrentStorms.json, keyless, public
     domain (NOAA). NHC's areas only: the Atlantic and the eastern and central
     Pacific. intensity is in knots; NHC gives movementSpeed in mph (checked
     against the forecast advisory: 7 mph is the advisory's 6 kt), so it is
     converted. No active storm is an empty, valid answer. Window 600 s.

   vessels: the AIS snapshot the Worker already keeps in the HereTenantAgent
     Durable Object (instance 'seek-first:ais:mccluster', the one the spatial
     console reads), fed by AISStream.io under its terms of service. The
     Durable Object is the cache, so the Cache API is not used. Dropped: rows
     without a valid MMSI or position, and rows older than an hour. AIS
     "not available" values (speed 102.3, course 360, heading 511, status 15)
     become null. Capped at 8000, freshest first.

   geocode: Photon (https://photon.komoot.io, komoot's public instance, fair
     use) and, only when Photon fails, Nominatim
     (https://nominatim.openstreetmap.org) under its usage policy: an
     identifying User-Agent, results cached, and an owner-only fallback that
     stays far below its limit of one request a second. Both answer from
     OpenStreetMap data, ODbL 1.0 (© OpenStreetMap contributors). The query is
     trimmed and must be 2 to 120 characters; each normalized query is kept
     24 h. At most 6 results. Both providers failing is an honest
     `unavailable` with no results, never cached. */
import { fetchWeather, fetchNatural } from './world-events.js';
import { fail, reply } from './lib/http.js';
import { UpstreamError } from './lib/safe-fetch.js';
import { cachedLayer, normalizeAdsbAircraft, upstream } from './world-layers.js';

export const HALO_LAYERS = Object.freeze({
  weather: Object.freeze({ ttl: 120, max: 1500, rows: 'events', base: Object.freeze({ credit: 'Weather alerts: NOAA NWS', attribution_url: 'https://www.weather.gov', license: 'Public domain (U.S. Government work)' }) }),
  natural: Object.freeze({ ttl: 600, max: 500, rows: 'events', base: Object.freeze({ credit: 'Natural events: NASA EONET', attribution_url: 'https://eonet.gsfc.nasa.gov', license: 'NASA open data' }) }),
  military: Object.freeze({ ttl: 30, max: 4000, rows: 'aircraft', base: Object.freeze({ attribution: 'adsb.lol, Open Database License (ODbL) 1.0', attribution_url: 'https://adsb.lol', credit: 'Military flights: adsb.lol (ODbL)', license: 'ODbL-1.0' }) }),
  quakes: Object.freeze({ ttl: 120, max: 2000, rows: 'quakes', base: Object.freeze({ attribution: 'U.S. Geological Survey, Earthquake Hazards Program', attribution_url: 'https://earthquake.usgs.gov', credit: 'Earthquakes: USGS', license: 'Public domain (U.S. Government work)' }) }),
  fires: Object.freeze({ ttl: 1800, max: 25000, rows: 'fires', requires: Object.freeze(['FIRMS_MAP_KEY']), base: Object.freeze({ attribution: 'NASA FIRMS, VIIRS 375 m near real-time (Suomi NPP and NOAA-20)', attribution_url: 'https://firms.modaps.eosdis.nasa.gov', credit: 'Fires: NASA FIRMS', license: 'NASA open data (no restriction on reuse; acknowledgement requested)' }) }),
  perimeters: Object.freeze({ ttl: 600, max: 400, rows: 'perimeters', base: Object.freeze({ attribution: 'National Interagency Fire Center, WFIGS Interagency Fire Perimeters (current)', attribution_url: 'https://data-nifc.opendata.arcgis.com', credit: 'Wildfire perimeters: NIFC WFIGS', license: 'U.S. Government open data (NIFC), provided as is' }) }),
  cyclones: Object.freeze({ ttl: 600, max: 50, rows: 'cyclones', base: Object.freeze({ attribution: 'NOAA National Hurricane Center', attribution_url: 'https://www.nhc.noaa.gov', credit: 'Tropical cyclones: NOAA NHC', license: 'Public domain (U.S. Government work)' }) }),
  vessels: Object.freeze({ ttl: 0, max: 8000, rows: 'vessels', requires: Object.freeze(['AISSTREAM_API_KEY', 'HereTenantAgent']), base: Object.freeze({ attribution: 'AISStream.io', attribution_url: 'https://aisstream.io', credit: 'Ships: AISStream.io', license: 'AISStream.io terms of service' }) })
});
const HALO_PATH = /^\/v1\/world\/layers\/(military|quakes|fires|perimeters|cyclones|vessels|weather|natural)$/;
export const WORLD_GEOCODE_PATH = '/v1/world/geocode';

/* ---------- trust nothing: numbers, strings and links from a provider ----------
   (exported for ./world-halo-ops.js, which trusts Supabase rows no further) */
export function finite(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'string' && !v.trim()) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
const roundTo = (n, places) => { const f = 10 ** places; return Math.round(n * f) / f; };
/* a finite number within [lo, hi], rounded; anything else is null, never 0 */
export function within(v, lo, hi, places = 3) {
  const n = finite(v);
  return n === null || n < lo || n > hi ? null : roundTo(n, places);
}
export const latOf = (v, places = 4) => within(v, -90, 90, places);
export const lonOf = (v, places = 4) => within(v, -180, 180, places);
/* a provider string, control characters removed, trimmed, capped; empty is null */
export function clip(v, max) {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return s ? s.slice(0, max).trim() : null;
}
/* a link kept only when it is https on one of the provider's own hosts */
function providerUrl(v, hosts) {
  if (typeof v !== 'string' || v.length > 500) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !hosts.includes(u.hostname.toLowerCase())) return null;
    return u.href;
  } catch {
    return null;
  }
}
/* epoch milliseconds to ISO, within a sane span (1900 to 2200) */
function isoFromMs(v) {
  const n = finite(v);
  return n === null || n < -2208988800000 || n > 7258118400000 ? null : new Date(n).toISOString();
}
/* the Worker's clock, for answers the Worker assembles itself */
function isoNow() { return new Date().toISOString(); }

/* ---------- military aircraft (adsb.lol /v2/mil) ---------- */
/* readsb dbFlags: 4 = PIA (privacy ICAO address), 8 = LADD (owner asked that it not be displayed) */
const PRIVACY_FLAGS = 4 | 8;
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

/* one /v2/mil aircraft to the military row, or null when it is not drawable:
   privacy-flagged, on the ground, without a position, or a stale position */
export function normalizeMilitaryAircraft(a) {
  if (!a || typeof a !== 'object') return null;
  if (Number(a.dbFlags) & PRIVACY_FLAGS) return null;
  const hex = clip(a.hex, 16);
  if (!hex) return null;
  const row = normalizeAdsbAircraft(a);
  if (!row) return null;
  const squawkRaw = a.squawk === null || a.squawk === undefined ? '' : String(a.squawk).trim();
  const squawk = /^[0-7]{4}$/.test(squawkRaw) ? squawkRaw : null;
  const flagged = typeof a.emergency === 'string' && a.emergency.trim() !== '' && a.emergency.trim().toLowerCase() !== 'none';
  return [
    hex, clip(row[1], 16) || '', row[2], row[3],
    within(row[4], -1000, 40000, 1), within(row[5], 0, 1200, 3), within(row[6], 0, 360, 2),
    clip(a.t, 16), squawk, Boolean((squawk && EMERGENCY_SQUAWKS.has(squawk)) || flagged)
  ];
}

export async function fetchMilitary(env, fetchImpl = fetch) {
  const data = await upstream('https://api.adsb.lol/v2/mil', {}, fetchImpl, 'json', 10000);
  if (!data || !Array.isArray(data.ac)) throw new UpstreamError('upstream_invalid_json', 'adsb.lol answer has no aircraft list');
  const max = HALO_LAYERS.military.max;
  const seen = new Set(), aircraft = [];
  let withheld = 0, dropped = 0;
  for (const a of data.ac) {
    const hex = clip(a && a.hex, 16);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    if (Number(a.dbFlags) & PRIVACY_FLAGS) { withheld += 1; continue; }
    const row = normalizeMilitaryAircraft(a);
    if (!row) { dropped += 1; continue; }
    if (aircraft.length < max) aircraft.push(row);
  }
  return {
    observed_at: isoFromMs(data.now), total: seen.size, withheld, dropped,
    truncated: seen.size - withheld - dropped > aircraft.length, count: aircraft.length, aircraft
  };
}

/* ---------- earthquakes (USGS, past day) ---------- */
const QUAKE_ALERTS = new Set(['green', 'yellow', 'orange', 'red']);
export function normalizeQuake(f) {
  if (!f || typeof f !== 'object') return null;
  const p = f.properties && typeof f.properties === 'object' ? f.properties : {};
  const c = f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : [];
  const lon = lonOf(c[0]), lat = latOf(c[1]);
  const id = clip(f.id, 64);
  if (!id || lon === null || lat === null) return null;
  return {
    id, mag: within(p.mag, -3, 11, 2), place: clip(p.place, 120), time: isoFromMs(p.time), lon, lat,
    depth_km: within(c[2], -20, 1000, 2), url: providerUrl(p.url, ['earthquake.usgs.gov']),
    tsunami: p.tsunami === 1 || p.tsunami === '1' || p.tsunami === true, alert: QUAKE_ALERTS.has(p.alert) ? p.alert : null
  };
}

export async function fetchQuakes(env, fetchImpl = fetch) {
  const data = await upstream('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', {}, fetchImpl);
  if (!data || !Array.isArray(data.features)) throw new UpstreamError('upstream_invalid_json', 'USGS answer has no feature list');
  const max = HALO_LAYERS.quakes.max, quakes = [];
  for (const f of data.features) {
    if (quakes.length >= max) break;
    const q = normalizeQuake(f);
    if (q) quakes.push(q);
  }
  return { observed_at: isoFromMs(data.metadata && data.metadata.generated), total: data.features.length, count: quakes.length, quakes };
}

/* ---------- active fires (NASA FIRMS VIIRS, past day, world) ---------- */
export const FIRMS_SOURCES = Object.freeze([
  Object.freeze({ source: 'VIIRS_SNPP_NRT', satellite: 'Suomi NPP' }),
  Object.freeze({ source: 'VIIRS_NOAA20_NRT', satellite: 'NOAA-20' })
]);
const FIRMS_TIMEOUT_MS = 25000;
const FIRMS_MAX_LINE = 2048;
const FIRMS_MAX_LINES = 1500000;
const FIRE_CONFIDENCE = Object.freeze({ l: 'low', low: 'low', n: 'nominal', nominal: 'nominal', h: 'high', high: 'high' });

/* reads a text body line by line as it arrives (a world CSV can be tens of
   megabytes; only the kept rows stay in memory) */
async function eachLine(res, onLine) {
  try {
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop();
        for (const line of parts) if (onLine(line) === false) { await reader.cancel().catch(() => {}); return; }
        if (buf.length > FIRMS_MAX_LINE) throw new UpstreamError('upstream_invalid_csv', 'provider line too long');
      }
      buf += decoder.decode();
      if (buf) onLine(buf);
      return;
    }
    for (const line of (await res.text()).split('\n')) if (onLine(line) === false) return;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error && error.name === 'AbortError') throw new UpstreamError('upstream_timeout', `provider timed out after ${FIRMS_TIMEOUT_MS} ms`);
    throw new UpstreamError('upstream_network', 'provider body could not be read');
  }
}

/* "2026-10-21" + "130" or "0130" (UTC) to ISO */
function firmsAcq(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{1,4}$/.test(time || '')) return null;
  const t = time.padStart(4, '0'), hh = Number(t.slice(0, 2)), mm = Number(t.slice(2));
  if (hh > 23 || mm > 59) return null;
  const ms = Date.parse(`${date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/* highest fire radiative power first; a row without FRP sorts last */
const byFrp = (a, b) => (b[2] === null ? -1 : b[2]) - (a[2] === null ? -1 : a[2]);
function keepTop(rows, cap) {
  rows.sort(byFrp);
  if (rows.length > cap) rows.length = cap;
  return rows;
}

/* one FIRMS CSV body to fire rows; columns by header name, never by position */
export async function parseFirmsCsv(res, satellite, cap = HALO_LAYERS.fires.max) {
  let cols = null, total = 0, lines = 0;
  const rows = [];
  await eachLine(res, (raw) => {
    lines += 1;
    if (lines > FIRMS_MAX_LINES) return false;
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) return true;
    if (line.length > FIRMS_MAX_LINE) return true;
    const cells = line.split(',');
    if (!cols) {
      const names = cells.map((c) => c.trim().toLowerCase());
      cols = Object.fromEntries(['latitude', 'longitude', 'frp', 'confidence', 'acq_date', 'acq_time', 'daynight'].map((n) => [n, names.indexOf(n)]));
      cols.width = names.length;
      if (cols.latitude < 0 || cols.longitude < 0) throw new UpstreamError('upstream_invalid_csv', 'provider answer is not the expected CSV');
      return true;
    }
    if (cells.length !== cols.width) return true;
    const get = (n) => (cols[n] >= 0 ? cells[cols[n]].trim() : '');
    const lon = lonOf(get('longitude')), lat = latOf(get('latitude'));
    if (lon === null || lat === null) return true;
    const dn = get('daynight').toUpperCase();
    rows.push([lon, lat, within(get('frp'), 0, 100000, 1), FIRE_CONFIDENCE[get('confidence').toLowerCase()] || null, firmsAcq(get('acq_date'), get('acq_time')), satellite, dn === 'D' || dn === 'N' ? dn : null]);
    total += 1;
    if (rows.length >= cap * 2) keepTop(rows, cap);
    return true;
  });
  if (!cols) throw new UpstreamError('upstream_invalid_csv', 'provider answer is empty');
  return { total, rows: keepTop(rows, cap) };
}

export async function fetchFires(env, fetchImpl = fetch) {
  const key = String(env.FIRMS_MAP_KEY || '').trim();
  if (!key) throw new UpstreamError('not_configured', 'FIRMS_MAP_KEY is not set');
  const max = HALO_LAYERS.fires.max;
  const results = await Promise.all(FIRMS_SOURCES.map(async ({ source, satellite }) => {
    try {
      const parsed = await upstream(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/world/1`, { headers: { accept: 'text/csv, text/plain' } }, fetchImpl, (res) => parseFirmsCsv(res, satellite, max), FIRMS_TIMEOUT_MS);
      return { source, status: 'ok', rows: parsed.rows, total: parsed.total };
    } catch (error) {
      /* the code and the provider's status only: never the URL, which carries the key */
      return { source, status: 'failed', error: (error && error.code) || 'upstream_error', provider_status: (error && error.providerStatus) || null };
    }
  }));
  const sources = results.map((r) => (r.status === 'ok' ? { source: r.source, status: 'ok', reported: r.total } : { source: r.source, status: 'failed', error: r.error, provider_status: r.provider_status }));
  const ok = results.filter((r) => r.status === 'ok');
  if (!ok.length) {
    const err = new UpstreamError(results[0].error, 'every FIRMS source failed', { providerStatus: results[0].provider_status });
    err.providers = sources;
    throw err;
  }
  const total = ok.reduce((n, r) => n + r.total, 0);
  const fires = keepTop(ok.flatMap((r) => r.rows), max);
  return { sources, partial: ok.length < results.length, total, truncated: total > fires.length, count: fires.length, fires };
}

/* ---------- wildfire perimeters (NIFC WFIGS, current) ---------- */
export const NIFC_PERIMETERS_URL = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';
const PERIMETER_MAX_RINGS = 250;
const PERIMETER_MAX_POINTS = 2000;

export function perimetersQuery(max = HALO_LAYERS.perimeters.max) {
  return `${NIFC_PERIMETERS_URL}?${new URLSearchParams({
    where: '1=1',
    outFields: 'poly_IncidentName,attr_UniqueFireIdentifier,attr_IncidentSize,attr_PercentContained,attr_FireDiscoveryDateTime',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: '0.005',
    geometryPrecision: '4',
    orderByFields: 'attr_IncidentSize DESC',
    resultRecordCount: String(max),
    f: 'geojson'
  }).toString()}`;
}

/* a ring of [lon, lat] at 4 decimals: invalid and repeated points dropped,
   closed, thinned evenly past the point cap; null when it cannot enclose anything */
export function normalizeRing(ring, maxPoints = PERIMETER_MAX_POINTS) {
  if (!Array.isArray(ring)) return null;
  let pts = [];
  for (const pos of ring) {
    if (!Array.isArray(pos)) continue;
    const lon = lonOf(pos[0]), lat = latOf(pos[1]);
    if (lon === null || lat === null) continue;
    const prev = pts[pts.length - 1];
    if (prev && prev[0] === lon && prev[1] === lat) continue;
    pts.push([lon, lat]);
  }
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  if (pts.length < 3) return null;
  if (pts.length > maxPoints - 1) {
    const step = pts.length / (maxPoints - 1), thin = [];
    for (let k = 0; k < maxPoints - 1; k += 1) thin.push(pts[Math.floor(k * step)]);
    pts = thin;
  }
  pts.push([pts[0][0], pts[0][1]]);
  return pts;
}

export function normalizePerimeter(f, index = 0) {
  if (!f || typeof f !== 'object') return null;
  const p = f.properties && typeof f.properties === 'object' ? f.properties : {};
  const g = f.geometry;
  const polygons = g && g.type === 'Polygon' && Array.isArray(g.coordinates) ? [g.coordinates] : g && g.type === 'MultiPolygon' && Array.isArray(g.coordinates) ? g.coordinates : [];
  const rings = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) continue;
    for (const ring of polygon) {
      if (rings.length >= PERIMETER_MAX_RINGS) break;
      const r = normalizeRing(ring);
      if (r) rings.push(r);
    }
  }
  if (!rings.length) return null;
  return {
    id: clip(p.attr_UniqueFireIdentifier, 64) || (f.id === null || f.id === undefined ? null : clip(f.id, 64)) || `perimeter-${index}`,
    name: clip(p.poly_IncidentName, 120), acres: within(p.attr_IncidentSize, 0, 10000000, 1),
    contained_pct: within(p.attr_PercentContained, 0, 100, 0), discovered: isoFromMs(p.attr_FireDiscoveryDateTime), rings
  };
}

export async function fetchPerimeters(env, fetchImpl = fetch) {
  const max = HALO_LAYERS.perimeters.max;
  const data = await upstream(perimetersQuery(max), {}, fetchImpl, 'json', 15000);
  /* ArcGIS reports a failed query as 200 with an error object */
  if (data && data.error) throw new UpstreamError('upstream_http', 'ArcGIS query failed', { providerStatus: finite(data.error.code) });
  if (!data || !Array.isArray(data.features)) throw new UpstreamError('upstream_invalid_json', 'NIFC answer has no feature list');
  const perimeters = [];
  for (let i = 0; i < data.features.length && perimeters.length < max; i += 1) {
    const p = normalizePerimeter(data.features[i], i);
    if (p) perimeters.push(p);
  }
  return { coverage: 'United States incidents (WFIGS)', total: data.features.length, count: perimeters.length, perimeters };
}

/* ---------- tropical cyclones (NOAA NHC) ---------- */
const MPH_TO_KT = 0.868976;
/* "9.5N" / "99.3W" when the numeric field is missing */
function hemisphere(v, pos, neg) {
  const m = typeof v === 'string' && v.trim().match(/^(\d{1,3}(?:\.\d+)?)\s*([A-Za-z])$/);
  if (!m) return null;
  const h = m[2].toUpperCase();
  return h === pos ? Number(m[1]) : h === neg ? -Number(m[1]) : null;
}

export function normalizeCyclone(s) {
  if (!s || typeof s !== 'object') return null;
  const idRaw = typeof s.id === 'string' ? s.id.trim().toLowerCase() : '';
  if (!/^[a-z]{2}\d{6}$/.test(idRaw)) return null;
  const lat = latOf(finite(s.latitudeNumeric) ?? hemisphere(s.latitude, 'N', 'S'), 2);
  const lon = lonOf(finite(s.longitudeNumeric) ?? hemisphere(s.longitude, 'E', 'W'), 2);
  if (lat === null || lon === null) return null;
  const cls = typeof s.classification === 'string' ? s.classification.trim().toUpperCase() : '';
  const mph = within(s.movementSpeed, 0, 200, 3);
  return {
    id: idRaw, name: clip(s.name, 120), classification: /^[A-Z]{1,4}$/.test(cls) ? cls : null,
    intensity_kt: within(s.intensity, 0, 250, 0), pressure_mb: within(s.pressure, 850, 1100, 0), lat, lon,
    movement_dir: within(s.movementDir, 0, 360, 0), movement_kt: mph === null ? null : Math.round(mph * MPH_TO_KT),
    basin: idRaw.slice(0, 2).toUpperCase(), advisory_url: providerUrl(s.publicAdvisory && s.publicAdvisory.url, ['www.nhc.noaa.gov'])
  };
}

export async function fetchCyclones(env, fetchImpl = fetch) {
  const data = await upstream('https://www.nhc.noaa.gov/CurrentStorms.json', {}, fetchImpl);
  if (!data || !Array.isArray(data.activeStorms)) throw new UpstreamError('upstream_invalid_json', 'NHC answer has no storm list');
  const max = HALO_LAYERS.cyclones.max, cyclones = [];
  for (const s of data.activeStorms) {
    if (cyclones.length >= max) break;
    const c = normalizeCyclone(s);
    if (c) cyclones.push(c);
  }
  return { coverage: 'Atlantic, eastern and central Pacific (NHC areas of responsibility)', count: cyclones.length, cyclones };
}

/* ---------- ships (the AIS snapshot in the HereTenantAgent Durable Object) ---------- */
export const AIS_INSTANCE = 'seek-first:ais:mccluster';
const AIS_ROW_MAX_AGE_MS = 3600000;
const AIS_FAILED = new Set(['auth-failed', 'error', 'closed', 'unconfigured']);

export function normalizeVessel(r, now = Date.now()) {
  if (!r || typeof r !== 'object') return null;
  const mmsi = typeof r.mmsi === 'string' || typeof r.mmsi === 'number' ? String(r.mmsi).trim() : '';
  if (!/^\d{1,9}$/.test(mmsi) || Number(mmsi) <= 0) return null;
  const lon = lonOf(r.longitude), lat = latOf(r.latitude);
  if (lon === null || lat === null) return null;
  const seen = typeof r.updated_at === 'string' ? Date.parse(r.updated_at) : NaN;
  if (Number.isFinite(seen) && now - seen > AIS_ROW_MAX_AGE_MS) return null;
  /* AIS pads names with '@'; 102.3 kn, 360° course, 511° heading and status 15 mean "not available" */
  const name = clip(typeof r.ship_name === 'string' ? r.ship_name.replace(/@+/g, ' ') : null, 120);
  const sog = within(r.sog, 0, 102.2, 1), cog = within(r.cog, 0, 359.9, 1), heading = within(r.heading, 0, 359, 0);
  const status = finite(r.nav_status);
  return [mmsi, name, lon, lat, sog, cog, heading, status !== null && Number.isInteger(status) && status >= 0 && status <= 14 ? status : null];
}

async function vesselsLayer(env) {
  const spec = HALO_LAYERS.vessels;
  const base = { ok: true, layer: 'vessels', ...spec.base };
  let snapshot;
  try {
    const stub = env.HereTenantAgent.get(env.HereTenantAgent.idFromName(AIS_INSTANCE));
    const res = await stub.fetch(new Request(`https://internal.mccluster/internal/seek-first/ais/snapshot?limit=${spec.max}`, { method: 'GET' }));
    if (!res || !res.ok) throw new Error('snapshot refused');
    snapshot = await res.json();
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.rows)) throw new Error('snapshot malformed');
  } catch {
    return { ...base, fetched_at: null, unavailable: true, upstream_error: 'ais_cache_error', count: 0, vessels: [], stale: false };
  }
  const now = Date.now(), vessels = [];
  for (const r of snapshot.rows) {
    if (vessels.length >= spec.max) break;
    const v = normalizeVessel(r, now);
    if (v) vessels.push(v);
  }
  const status = typeof snapshot.status === 'string' ? snapshot.status.slice(0, 32) : null;
  const body = {
    ...base, fetched_at: isoNow(), status, last_message_at: isoFromMs(Date.parse(snapshot.last_message_at)),
    cached_vessels: within(snapshot.cached_vessels, 0, 1e7, 0), count: vessels.length, vessels, stale: snapshot.stale === true
  };
  if (!vessels.length && status && AIS_FAILED.has(status)) return { ...body, unavailable: true, upstream_error: `aisstream_${status.replace(/-/g, '_')}` };
  return body;
}

/* ---------- the routes ---------- */
const FETCHERS = { weather: fetchWeather, natural: fetchNatural, military: fetchMilitary, quakes: fetchQuakes, fires: fetchFires, perimeters: fetchPerimeters, cyclones: fetchCyclones };

/* owner-only answers never sit in a browser or shared cache */
function send(request, env, body, status = 200) {
  const res = reply(request, env, body, status);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
function refuse(request, env, message, status) {
  const res = fail(request, env, message, status);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}

function configured(layer, env) {
  if (layer === 'fires') return Boolean(String(env.FIRMS_MAP_KEY || '').trim());
  if (layer === 'vessels') return Boolean(env.AISSTREAM_API_KEY && env.HereTenantAgent && typeof env.HereTenantAgent.idFromName === 'function' && typeof env.HereTenantAgent.get === 'function');
  return true;
}

export async function handleHaloLayers(request, env, { fetchImpl = fetch, cacheImpl = null } = {}) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const m = path.match(HALO_PATH);
  if (!m) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(request, env, 'Method not allowed', 405);
  const layer = m[1], spec = HALO_LAYERS[layer];
  if (!configured(layer, env)) {
    return send(request, env, { ok: true, layer, fetched_at: null, ...spec.base, unavailable: true, upstream_error: 'not_configured', requires: spec.requires, count: 0, [spec.rows]: [], stale: false });
  }
  if (layer === 'vessels') return send(request, env, await vesselsLayer(env));
  const { body, stale } = await cachedLayer({ layer, ttl: spec.ttl, base: spec.base, rows: spec.rows, fetcher: FETCHERS[layer] }, env, fetchImpl, cacheImpl);
  return send(request, env, { ...body, stale: !!stale });
}

/* ---------- place search (Photon, then Nominatim) ---------- */
const GEOCODE_TTL = 86400;
const GEOCODE_LIMIT = 6;
const GEOCODE_TIMEOUT_MS = 6000;
const GEOCODE_USER_AGENT = 'McCluster-World/1.0 (+https://mccluster.org; owner place search, results cached 24 h)';
const GEOCODE_SOURCES = Object.freeze({
  photon: Object.freeze({ attribution: 'Photon by komoot; data © OpenStreetMap contributors', attribution_url: 'https://photon.komoot.io', license: 'ODbL-1.0' }),
  nominatim: Object.freeze({ attribution: 'Nominatim; data © OpenStreetMap contributors', attribution_url: 'https://nominatim.openstreetmap.org', license: 'ODbL-1.0' })
});

/* trimmed, whitespace collapsed, 2 to 120 characters; null otherwise */
export function normalizeGeocodeQuery(raw) {
  if (typeof raw !== 'string') return null;
  const q = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return q.length >= 2 && q.length <= 120 ? q : null;
}

function bboxOf(w, s, e, n) {
  const box = [lonOf(w, 5), latOf(s, 5), lonOf(e, 5), latOf(n, 5)];
  return box.every((v) => v !== null) && box[1] <= box[3] ? box : null;
}
function kindOf(v) {
  const k = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /^[a-z0-9_ -]{1,40}$/.test(k) ? k : null;
}

export function photonResults(data) {
  if (!data || !Array.isArray(data.features)) throw new UpstreamError('upstream_invalid_json', 'Photon answer has no feature list');
  const results = [];
  for (const f of data.features) {
    if (results.length >= GEOCODE_LIMIT) break;
    if (!f || typeof f !== 'object') continue;
    const p = f.properties && typeof f.properties === 'object' ? f.properties : {};
    const c = f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : [];
    const lon = lonOf(c[0], 5), lat = latOf(c[1], 5);
    if (lon === null || lat === null) continue;
    const parts = [];
    for (const part of [p.name, p.city, p.state, p.country].map((x) => clip(x, 120))) if (part && !parts.includes(part)) parts.push(part);
    const name = clip(parts.join(', '), 120);
    if (!name) continue;
    /* Photon's extent is [west, north, east, south] */
    const e = Array.isArray(p.extent) && p.extent.length === 4 ? p.extent : null;
    results.push({ name, kind: kindOf(p.osm_value || p.type), lon, lat, bbox: e ? bboxOf(e[0], e[3], e[2], e[1]) : null });
  }
  return results;
}

export function nominatimResults(data) {
  if (!Array.isArray(data)) throw new UpstreamError('upstream_invalid_json', 'Nominatim answer is not a list');
  const results = [];
  for (const r of data) {
    if (results.length >= GEOCODE_LIMIT) break;
    if (!r || typeof r !== 'object') continue;
    const lon = lonOf(r.lon, 5), lat = latOf(r.lat, 5);
    const name = clip(r.display_name || r.name, 120);
    if (lon === null || lat === null || !name) continue;
    /* Nominatim's boundingbox is [south, north, west, east], as strings */
    const b = Array.isArray(r.boundingbox) && r.boundingbox.length === 4 ? r.boundingbox : null;
    results.push({ name, kind: kindOf(r.addresstype || r.type), lon, lat, bbox: b ? bboxOf(b[2], b[0], b[3], b[1]) : null });
  }
  return results;
}

async function geocode(q, fetchImpl) {
  const providers = [];
  const headers = { 'user-agent': GEOCODE_USER_AGENT };
  try {
    const data = await upstream(`https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: String(GEOCODE_LIMIT) })}`, { headers }, fetchImpl, 'json', GEOCODE_TIMEOUT_MS);
    const results = photonResults(data);
    providers.push({ provider: 'photon', status: 'ok', count: results.length });
    return { provider: 'photon', ...GEOCODE_SOURCES.photon, providers, results };
  } catch (error) {
    providers.push({ provider: 'photon', status: 'failed', error: (error && error.code) || 'upstream_error', provider_status: (error && error.providerStatus) || null });
  }
  try {
    const data = await upstream(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: 'jsonv2', limit: String(GEOCODE_LIMIT), q })}`, { headers }, fetchImpl, 'json', GEOCODE_TIMEOUT_MS);
    const results = nominatimResults(data);
    providers.push({ provider: 'nominatim', status: 'ok', count: results.length });
    return { provider: 'nominatim', ...GEOCODE_SOURCES.nominatim, providers, results };
  } catch (error) {
    providers.push({ provider: 'nominatim', status: 'failed', error: (error && error.code) || 'upstream_error', provider_status: (error && error.providerStatus) || null });
    const err = new UpstreamError((error && error.code) || 'upstream_error', 'every place-search provider failed');
    err.providers = providers;
    throw err;
  }
}

export async function handleWorldGeocode(request, env, { fetchImpl = fetch, cacheImpl = null } = {}) {
  const url = new URL(request.url);
  if ((url.pathname.replace(/\/+$/, '') || '/') !== WORLD_GEOCODE_PATH) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(request, env, 'Method not allowed', 405);
  const q = normalizeGeocodeQuery(url.searchParams.get('q'));
  if (!q) return send(request, env, { ok: false, code: 'invalid_query', error: 'q must be 2 to 120 characters' }, 400);

  const store = cacheImpl || (globalThis.caches && globalThis.caches.default) || null;
  const key = new Request(`https://cache.mccluster.internal/world/geocode/${encodeURIComponent(q.toLowerCase())}`);
  if (store) {
    const res = await store.match(key).catch(() => null);
    const hit = res ? await res.json().catch(() => null) : null;
    const age = hit && hit.fetched_at ? Date.now() - Date.parse(hit.fetched_at) : NaN;
    if (hit && Array.isArray(hit.results) && age >= 0 && age < GEOCODE_TTL * 1000) return send(request, env, { ...hit, query: q });
  }
  try {
    const found = await geocode(q, fetchImpl);
    const body = { ok: true, query: q, fetched_at: isoNow(), ...found };
    if (store) await store.put(key, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${GEOCODE_TTL}` } })).catch(() => {});
    return send(request, env, body);
  } catch (error) {
    return send(request, env, {
      ok: true, query: q, fetched_at: null, ...GEOCODE_SOURCES.photon, unavailable: true,
      upstream_error: (error && error.code) || 'upstream_error', providers: (error && error.providers) || [], results: []
    });
  }
}
