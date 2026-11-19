/* THE ENVIRONMENTAL GLOBE'S PUBLIC LAYERS (owner, 2026-11-17: the environmental globe in
   docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md; routes, DTOs, licences and timestamp
   meanings: docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md).

     GET /v1/world/environment/layers/fires             NASA FIRMS VIIRS NOAA-20 and NOAA-21, trailing 24 h (needs FIRMS_MAP_KEY)
     GET /v1/world/environment/layers/perimeters        NIFC WFIGS current interagency fire perimeters (U.S.)
     GET /v1/world/environment/layers/alerts            NOAA NWS active alerts: their own polygons; zone-only alerts listed, never placed
     GET /v1/world/environment/layers/eonet             NASA EONET open events with every reported geometry, oldest first
     GET /v1/world/environment/layers/tides             NOAA CO-OPS water-level stations and the latest level at 20 documented stations
     GET /v1/world/environment/tides/:station           one NOAA CO-OPS station's observed water level, last 24 h (MLLW, metres)
     GET /v1/world/environment/quakes/:event/shakemap   one USGS event's ShakeMap intensity (MMI) contours, on demand
     GET /v1/world/environment/quakes/:event/rupture    one USGS event's documented rupture: the modelled up-dip edge of a finite-fault plane, or none

   PUBLIC, BEHIND THE SAME GATE AS GET /v1/world/environment. Every route asks `gate` first: the
   persisted environment module policy, read from the canonical store on every request and judged by
   the pinned product's own rules (world-environment.js). Unreadable or missing is 503
   module_policy_unavailable, disabled is 404 module_disabled, draining still answers reads; there is
   no default and no cache of the decision. The route table is the release policy's
   (packages/release-policy/globe.mjs, environmentRouteForPath); none of these paths is a Halo path, and
   no Halo route is reached or relaxed from here. Unauthenticated: no bearer is read and none is needed.

   WHAT IS NEVER IN AN ANSWER: a credential (the FIRMS map key travels only in the request URL to NASA
   and never into an answer, a cache key, an error or a log line; nothing here logs), a provider's error
   message, member data, locations, assignments, Halo intelligence, aircraft, vessels or cameras. Every
   provider value is range-checked and length-capped (./world-halo-layers.js helpers); geometry that is
   not exactly what the provider published is dropped and counted, never mended.

   EVERY ANSWER carries `sources`: one health record per provider consulted (./world-layers.js
   sourceHealth: id, label, status, reason, fetched_at, last_success_at, coverage, attribution, license,
   url), private/no-store with the CORS of the sibling handlers, so a disabled module stops serving at
   once. Provider answers are kept per source in the Cache API for the provider's window and served as the
   last good copy (status stale, with the reason) for up to 6 h while it is down. */
import { reply } from './lib/http.js';
import { UpstreamError } from './lib/safe-fetch.js';
import { healthReason, sourceHealth, upstream } from './world-layers.js';
import { NIFC_PERIMETERS_URL, clip, finite, isoFromMs, latOf, lonOf, normalizeRing, parseFirmsCsv, providerUrl, within } from './world-halo-layers.js';
import { boundedEventJson, normalizeAlert, normalizeNatural } from './world-events.js';
import { STATION_ID, TIDES, boundedJson, normalizeStation, normalizeWaterLevel, waterLevelUrl } from './world-halo-ops.js';
import { environmentRouteForPath } from '../../../packages/release-policy/globe.mjs';
/* every kept copy below is read through sharedLayer: concurrent misses share one provider read (release security review SEC-2) */
import { sharedLayer } from './world-environment-guard.js';

const ROOT = '/v1/world/environment';
/* the namespaces this module answers for; anything else under them is 404 after the gate */
const NAMESPACES = ['layers', 'tides', 'quakes'];
const isoNow = () => new Date().toISOString();
const isoOf = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
/* a provider's timestamp string to ISO UTC, or null (never the retrieval time in its place) */
const isoTime = (v) => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);

/* ---------- the providers, as each health record names them ---------- */
const FIRMS_HOME = 'https://firms.modaps.eosdis.nasa.gov/';
const FIRMS_LICENSE = 'NASA FIRMS data: CC0 1.0 (U.S. public domain); please credit NASA FIRMS';
export const LAYER_SOURCES = Object.freeze({
  firms_viirs_noaa20: Object.freeze({ id: 'firms_viirs_noaa20', label: 'NASA FIRMS VIIRS NOAA-20', url: FIRMS_HOME, license: FIRMS_LICENSE,
    attribution: 'NASA FIRMS, VIIRS 375 m active fire product (NOAA-20, near real-time)',
    coverage: 'Global VIIRS active-fire detections from NOAA-20 in the 24 hours before retrieval' }),
  firms_viirs_noaa21: Object.freeze({ id: 'firms_viirs_noaa21', label: 'NASA FIRMS VIIRS NOAA-21', url: FIRMS_HOME, license: FIRMS_LICENSE,
    attribution: 'NASA FIRMS, VIIRS 375 m active fire product (NOAA-21, near real-time)',
    coverage: 'Global VIIRS active-fire detections from NOAA-21 in the 24 hours before retrieval' }),
  wfigs: Object.freeze({ id: 'wfigs', label: 'NIFC WFIGS perimeters', url: 'https://data-nifc.opendata.arcgis.com/',
    attribution: 'National Interagency Fire Center, WFIGS Interagency Fire Perimeters (current)',
    license: 'U.S. federal data with no named licence, provided as is under the NIFC disclaimer',
    coverage: 'United States wildland fire incidents with a current interagency perimeter' }),
  nws: Object.freeze({ id: 'nws', label: 'NOAA NWS', url: 'https://www.weather.gov/',
    attribution: 'NOAA National Weather Service', license: 'Public domain (U.S. Government work)',
    coverage: 'United States active alerts (status Actual); many alerts name forecast zones and carry no polygon' }),
  eonet: Object.freeze({ id: 'eonet', label: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/',
    attribution: 'NASA Earth Observatory Natural Event Tracker (EONET)', license: 'NASA open data; each event names the sources EONET drew it from',
    coverage: 'Global open natural-event reports from the last 30 days; not exhaustive' }),
  coops_stations: Object.freeze({ id: 'coops_stations', label: 'NOAA CO-OPS stations', url: 'https://tidesandcurrents.noaa.gov/',
    attribution: 'NOAA Center for Operational Oceanographic Products and Services (CO-OPS)', license: 'Public domain (U.S. Government work); NOAA asks to be credited',
    coverage: 'NOAA CO-OPS water-level stations: U.S. coasts, the Great Lakes and territories' }),
  coops_latest: Object.freeze({ id: 'coops_latest', label: 'NOAA CO-OPS latest water levels', url: 'https://tidesandcurrents.noaa.gov/',
    attribution: 'NOAA Center for Operational Oceanographic Products and Services (CO-OPS)', license: 'Public domain (U.S. Government work); NOAA asks to be credited',
    coverage: 'The latest observed water level at 20 documented NOAA stations on U.S. coasts and territories, refreshed at most every 15 minutes' }),
  coops_water_level: Object.freeze({ id: 'coops_water_level', label: 'NOAA CO-OPS water level', url: 'https://tidesandcurrents.noaa.gov/',
    attribution: 'NOAA Center for Operational Oceanographic Products and Services (CO-OPS)', license: 'Public domain (U.S. Government work); NOAA asks to be credited',
    coverage: 'One station\'s observed water level over the last 24 hours' }),
  usgs_event: Object.freeze({ id: 'usgs_event', label: 'USGS event detail', url: 'https://earthquake.usgs.gov/',
    attribution: 'U.S. Geological Survey, Earthquake Hazards Program', license: 'Public domain (U.S. Government work)',
    coverage: 'The products USGS lists for one earthquake' }),
  usgs_shakemap: Object.freeze({ id: 'usgs_shakemap', label: 'USGS ShakeMap', url: 'https://earthquake.usgs.gov/data/shakemap/',
    attribution: 'U.S. Geological Survey ShakeMap', license: 'Public domain (U.S. Government work)',
    coverage: 'ShakeMap exists for about M5.4 and larger worldwide, and from about M3 to M3.5 in some U.S. regional networks' }),
  usgs_rupture: Object.freeze({ id: 'usgs_rupture', label: 'USGS ShakeMap rupture', url: 'https://earthquake.usgs.gov/data/finitefault/',
    attribution: 'U.S. Geological Survey, ShakeMap rupture and finite-fault products', license: 'Public domain (U.S. Government work)',
    coverage: 'A modelled finite-fault plane exists for about a dozen earthquakes a year, all M6.5 and larger; every other quake is modelled as a point' })
});

/* ---------- answers ---------- */
function send(request, env, body, status = 200) {
  const res = reply(request, env, body, status);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
const refuse = (request, env, code, status) => send(request, env, { ok: false, code }, status);

/* ---------- fires: NASA FIRMS VIIRS (NOAA-20, NOAA-21), trailing 24 hours, world ----------
   The area API's day range counts UTC days (1 is "today" only, nearly empty just after 00:00 UTC), so
   two days are asked for and every detection outside the 24 hours before retrieval is left out. Suomi
   NPP is not asked for: its production ceased on 2026-11-02 (FIRMS FAQ). Each satellite is fetched and
   kept on its own, so one failing never hides the other. Detections are the strongest by fire radiative
   power (FRP) up to the cap; the area summary counts every detection in the window, kept or not. */
export const FIRES = Object.freeze({
  ttl: 1800, cap: 10000, dayRange: 2, windowHours: 24, futureSlackMs: 3600000, cellDegrees: 1, cellsCap: 20000, timeoutMs: 25000, footprintM: 375,
  satellites: Object.freeze([
    Object.freeze({ product: 'VIIRS_NOAA20_NRT', satellite: 'NOAA-20', source: 'firms_viirs_noaa20' }),
    Object.freeze({ product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21', source: 'firms_viirs_noaa21' })
  ])
});
const FIRE_COLUMNS = Object.freeze(['lon', 'lat', 'frp_mw', 'confidence', 'acquired_at', 'satellite', 'day_night']);
const CELL_COLUMNS = Object.freeze(['west', 'south', 'detections', 'frp_sum_mw', 'frp_max_mw', 'latest_acquired_at']);
const round1 = (n) => Math.round(n * 10) / 10;

/* the 1-degree cell a detection falls in, by its south-west corner */
function cellOf(lon, lat, size = FIRES.cellDegrees) {
  const west = Math.min(180 - size, Math.floor(lon / size) * size), south = Math.min(90 - size, Math.floor(lat / size) * size);
  return [west === 0 ? 0 : west, south === 0 ? 0 : south];
}
function addToCell(cells, row, t) {
  const [west, south] = cellOf(row[0], row[1]);
  const key = `${west},${south}`;
  let c = cells.get(key);
  if (!c) { c = [west, south, 0, 0, null, 0]; cells.set(key, c); }
  c[2] += 1;
  if (row[2] !== null) { c[3] += row[2]; c[4] = c[4] === null ? row[2] : Math.max(c[4], row[2]); }
  if (t > c[5]) c[5] = t;
}

/* one satellite's trailing 24 hours. The key is put into the request URL and nowhere else; every
   failure leaves here as a typed code (lib/safe-fetch.js), never with the URL or a provider message. */
export async function fetchFirmsSatellite(env, fetchImpl, sat, now = Date.now()) {
  const key = String(env.FIRMS_MAP_KEY || '').trim();
  if (!key) throw new UpstreamError('not_configured', 'FIRMS is not configured');
  const since = now - FIRES.windowHours * 3600000, until = now + FIRES.futureSlackMs;
  const cells = new Map();
  let outside = 0, untimed = 0;
  const keep = (row) => {
    const t = row[4] ? Date.parse(row[4]) : NaN;
    if (!Number.isFinite(t)) { untimed += 1; return false; }
    if (t < since || t > until) { outside += 1; return false; }
    addToCell(cells, row, t);
    return true;
  };
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${sat.product}/world/${FIRES.dayRange}`;
  const parsed = await upstream(url, { headers: { accept: 'text/csv, text/plain' } }, fetchImpl, (res) => parseFirmsCsv(res, sat.satellite, FIRES.cap, { keep }), FIRES.timeoutMs);
  return {
    product: sat.product, satellite: sat.satellite, window: { since: isoOf(since), until: isoOf(now) },
    total: parsed.total, outside_window: outside, untimed, dropped: parsed.dropped, read_cut: parsed.cut === true,
    truncated: parsed.total > parsed.rows.length, count: parsed.rows.length, detections: parsed.rows,
    cells: [...cells.values()].map((c) => [c[0], c[1], c[2], round1(c[3]), c[4], isoOf(c[5])])
  };
}

const byFrp = (a, b) => (b[2] === null ? -1 : b[2]) - (a[2] === null ? -1 : a[2]);
async function firesAnswer(env, fetchImpl, cacheImpl) {
  const configured = Boolean(String(env.FIRMS_MAP_KEY || '').trim());
  const parts = await Promise.all(FIRES.satellites.map(async (sat) => {
    /* without the key nobody is asked and nothing kept is read: an honest not_configured */
    const outcome = configured
      ? await sharedLayer({ layer: 'fires', key: `consumer-environment-v1-firms-${sat.product}`, ttl: FIRES.ttl, rows: 'detections', fetcher: (e, f) => fetchFirmsSatellite(e, f, sat) }, env, fetchImpl, cacheImpl)
      : { body: { unavailable: true, fetched_at: null, upstream_error: 'not_configured' }, stale: false, last_success_at: null };
    return { sat, outcome, body: outcome.body && !outcome.body.unavailable ? outcome.body : null };
  }));
  const detections = [], cells = new Map();
  let total = 0, dropped = 0, outside = 0, untimed = 0;
  for (const { body } of parts) {
    if (!body) continue;
    total += Number(body.total) || 0; dropped += Number(body.dropped) || 0; outside += Number(body.outside_window) || 0; untimed += Number(body.untimed) || 0;
    for (const row of Array.isArray(body.detections) ? body.detections : []) detections.push(row);
    for (const c of Array.isArray(body.cells) ? body.cells : []) {
      const key = `${c[0]},${c[1]}`, t = Date.parse(c[5]);
      const m = cells.get(key);
      if (!m) { cells.set(key, [c[0], c[1], c[2], c[3], c[4], Number.isFinite(t) ? t : 0]); continue; }
      m[2] += c[2]; m[3] += c[3];
      if (c[4] !== null) m[4] = m[4] === null ? c[4] : Math.max(m[4], c[4]);
      if (Number.isFinite(t) && t > m[5]) m[5] = t;
    }
  }
  detections.sort(byFrp);
  const kept = detections.slice(0, FIRES.cap);
  const summary = [...cells.values()].map((c) => [c[0], c[1], c[2], round1(c[3]), c[4], isoOf(c[5] || NaN)])
    .sort((a, b) => b[3] - a[3] || b[2] - a[2] || a[0] - b[0] || a[1] - b[1]);
  const shown = summary.slice(0, FIRES.cellsCap);
  return {
    ok: true, schema: 'world-environment-fires/v1', layer: 'fires', generated_at: isoNow(),
    sources: parts.map(({ sat, outcome }) => sourceHealth(LAYER_SOURCES[sat.source], outcome)),
    windows: parts.map(({ sat, body }) => ({ source: sat.source, since: body && body.window ? body.window.since : null, until: body && body.window ? body.window.until : null })),
    columns: FIRE_COLUMNS, detections: kept, count: kept.length, total, cap: FIRES.cap,
    truncated: total > kept.length || parts.some(({ body }) => body && (body.truncated === true || body.read_cut === true)),
    dropped, outside_window: outside, untimed,
    summary: { cell_degrees: FIRES.cellDegrees, columns: CELL_COLUMNS, cells: shown, count: shown.length, cap: FIRES.cellsCap, truncated: summary.length > shown.length },
    footprint_m: FIRES.footprintM,
    notes: {
      detection: 'A detection is the centre of a VIIRS pixel (about 375 m across at nadir) flagged as containing one or more fires or other thermal anomalies. It is not a confirmed fire, a fire perimeter or a burned area.',
      time: 'acquired_at is the satellite overpass time in UTC (FIRMS acq_date and acq_time), not when a fire started.',
      summary: 'Cells count every detection in the window, kept in the list or not. The same fire is often detected on several overpasses and by both satellites, so detections are not a count of fires. frp_sum_mw adds only detections that reported FRP.',
      window: 'Each satellite covers the 24 hours before its own retrieval (windows).'
    }
  };
}

/* ---------- geometry exactly as published ----------
   A ring is used only as the provider closed it: at least four positions, every one a pair of finite
   numbers on the globe (longitude -180..180, latitude -90..90), the last equal to the first. Anything
   else is malformed, and the polygon it belongs to is dropped whole: a hole is never promoted to an
   exterior, and an exterior is never drawn without a hole it had, which would claim the hole's area.
   The Halo normalizer (normalizeRing) then rounds to 4 decimals (about 11 m), drops repeated points and
   thins a ring past the point cap evenly, re-closing it on the provider's own first point. A ring that
   rounds to fewer than three distinct points, or to no area, is tiny: a tiny hole is left out (it is
   below the precision of the answer), a tiny exterior drops its polygon. Nothing is closed, mended or
   moved here. Lines (ShakeMap contours) need two distinct positions; they are thinned evenly, keeping
   both ends. */
export const GEOMETRY = Object.freeze({ maxPolygons: 100, maxRings: 250, maxPoints: 2000, maxLinePoints: 2000 });
const onGlobe = (p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
  && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90;
/* shoelace area in square degrees, taken about the first point so rounding noise stays small */
function ringArea(r) {
  const [x0, y0] = r[0];
  let a = 0;
  for (let i = 1; i < r.length - 1; i += 1) a += (r[i][0] - x0) * (r[i + 1][1] - y0) - (r[i + 1][0] - x0) * (r[i][1] - y0);
  return a / 2;
}
const MIN_RING_AREA = 1e-9;
export function strictRing(ring, maxPoints = GEOMETRY.maxPoints) {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(onGlobe)) return { ring: null, why: 'malformed' };
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return { ring: null, why: 'malformed' };
  const r = normalizeRing(ring, maxPoints);
  if (!r || r.length < 4 || Math.abs(ringArea(r)) < MIN_RING_AREA) return { ring: null, why: 'tiny' };
  return { ring: r, why: null };
}
/* GeoJSON Polygon or MultiPolygon to [[exterior, ...holes], ...]; anything else has no polygons */
export function strictPolygons(geometry, { maxPolygons = GEOMETRY.maxPolygons, maxRings = GEOMETRY.maxRings, maxPoints = GEOMETRY.maxPoints } = {}) {
  const raw = geometry && geometry.type === 'Polygon' ? [geometry.coordinates] : geometry && geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
  const out = { polygons: [], polygons_dropped: 0, truncated: false, supported: Array.isArray(raw) };
  if (!Array.isArray(raw)) return out;
  let rings = 0;
  for (const poly of raw) {
    if (out.polygons.length >= maxPolygons) { out.truncated = true; break; }
    if (!Array.isArray(poly) || !poly.length) { out.polygons_dropped += 1; continue; }
    const outer = strictRing(poly[0], maxPoints);
    if (!outer.ring) { out.polygons_dropped += 1; continue; }
    const kept = [outer.ring];
    let malformed = false;
    for (const hole of poly.slice(1)) {
      const h = strictRing(hole, maxPoints);
      if (h.ring) kept.push(h.ring);
      else if (h.why === 'malformed') { malformed = true; break; }
    }
    if (malformed) { out.polygons_dropped += 1; continue; }
    if (rings + kept.length > maxRings) { out.truncated = true; break; }
    rings += kept.length;
    out.polygons.push(kept);
  }
  return out;
}
export function strictLine(line, maxPoints = GEOMETRY.maxLinePoints) {
  if (!Array.isArray(line) || line.length < 2 || !line.every(onGlobe)) return null;
  const pts = [];
  for (const p of line) {
    const q = [lonOf(p[0]), latOf(p[1])], prev = pts[pts.length - 1];
    if (prev && prev[0] === q[0] && prev[1] === q[1]) continue;
    pts.push(q);
  }
  if (pts.length < 2) return null;
  if (pts.length <= maxPoints) return pts;
  const step = (pts.length - 1) / (maxPoints - 1), thin = [];
  for (let k = 0; k < maxPoints; k += 1) thin.push(pts[Math.round(k * step)]);
  return thin;
}

/* ---------- perimeters: NIFC WFIGS current interagency fire perimeters (U.S.) ----------
   The polygons NIFC publishes, generalized by its own server to a 0.002-degree tolerance (about 200 m)
   and 4 decimals, largest by GIS acres first. Three times, all as NIFC records them: when the polygon
   was captured (poly_PolygonDateTime), when the record was last edited (poly_DateCurrent, UTC) and when
   the fire was discovered (attr_FireDiscoveryDateTime). Operational mapping, not a legal boundary. */
export const PERIMETERS = Object.freeze({ ttl: 600, max: 400, offset: '0.002', timeoutMs: 15000 });
export function publicPerimetersQuery() {
  return `${NIFC_PERIMETERS_URL}?${new URLSearchParams({
    where: '1=1',
    outFields: 'poly_IncidentName,attr_UniqueFireIdentifier,poly_GISAcres,poly_PolygonDateTime,poly_DateCurrent,attr_FireDiscoveryDateTime',
    returnGeometry: 'true', outSR: '4326', maxAllowableOffset: PERIMETERS.offset, geometryPrecision: '4',
    orderByFields: 'poly_GISAcres DESC', resultRecordCount: String(PERIMETERS.max), f: 'geojson'
  }).toString()}`;
}
export function publicPerimeter(f, index = 0) {
  if (!f || typeof f !== 'object') return { perimeter: null, polygons_dropped: 0 };
  const p = f.properties && typeof f.properties === 'object' ? f.properties : {};
  const geo = strictPolygons(f.geometry);
  if (!geo.polygons.length) return { perimeter: null, polygons_dropped: geo.polygons_dropped };
  return {
    polygons_dropped: geo.polygons_dropped,
    perimeter: {
      id: clip(p.attr_UniqueFireIdentifier, 64) || (f.id === null || f.id === undefined ? null : clip(f.id, 64)) || `perimeter-${index}`,
      name: clip(p.poly_IncidentName, 120), gis_acres: within(p.poly_GISAcres, 0, 10000000, 2),
      polygon_captured_at: isoFromMs(p.poly_PolygonDateTime), last_edited_at: isoFromMs(p.poly_DateCurrent), discovered_at: isoFromMs(p.attr_FireDiscoveryDateTime),
      polygons: geo.polygons, polygons_dropped: geo.polygons_dropped, geometry_truncated: geo.truncated
    }
  };
}
export async function fetchPublicPerimeters(env, fetchImpl) {
  const data = await upstream(publicPerimetersQuery(), {}, fetchImpl, boundedEventJson, PERIMETERS.timeoutMs);
  /* ArcGIS reports a failed query as 200 with an error object */
  if (data && data.error) throw new UpstreamError('upstream_http', 'ArcGIS query failed', { providerStatus: finite(data.error.code) });
  if (!data || !Array.isArray(data.features)) throw new UpstreamError('upstream_invalid_json', 'NIFC answer has no feature list');
  const perimeters = [], seen = new Set();
  let dropped = 0, polygonsDropped = 0;
  for (let i = 0; i < data.features.length && perimeters.length < PERIMETERS.max; i += 1) {
    const { perimeter, polygons_dropped } = publicPerimeter(data.features[i], i);
    polygonsDropped += polygons_dropped;
    if (!perimeter || seen.has(perimeter.id)) { dropped += 1; continue; }
    seen.add(perimeter.id);
    perimeters.push(perimeter);
  }
  const more = data.exceededTransferLimit === true || (data.properties && data.properties.exceededTransferLimit === true);
  return { total: data.features.length, count: perimeters.length, dropped, polygons_dropped: polygonsDropped, more_available: more, perimeters };
}
async function perimetersAnswer(env, fetchImpl, cacheImpl) {
  const outcome = await sharedLayer({ layer: 'perimeters', key: 'consumer-environment-v1-wfigs', ttl: PERIMETERS.ttl, rows: 'perimeters', fetcher: fetchPublicPerimeters }, env, fetchImpl, cacheImpl);
  const b = outcome.body && !outcome.body.unavailable ? outcome.body : {};
  const perimeters = Array.isArray(b.perimeters) ? b.perimeters : [];
  return {
    ok: true, schema: 'world-environment-perimeters/v1', layer: 'perimeters', generated_at: isoNow(),
    sources: [sourceHealth(LAYER_SOURCES.wfigs, outcome)],
    perimeters, count: perimeters.length, total: Number(b.total) || 0, cap: PERIMETERS.max,
    truncated: b.more_available === true, dropped: Number(b.dropped) || 0, polygons_dropped: Number(b.polygons_dropped) || 0,
    generalization_degrees: Number(PERIMETERS.offset),
    notes: {
      geometry: 'Polygons as NIFC publishes them, generalized by NIFC\'s server to about 200 m. A ring that is not closed, has a coordinate off the globe or is not a number is dropped with its polygon and counted, never repaired. Operational fire mapping, not a legal boundary.',
      time: 'polygon_captured_at is when the perimeter was mapped; last_edited_at when NIFC\'s record last changed (UTC); discovered_at when the fire was discovered.'
    }
  };
}

/* ---------- alerts: NOAA NWS active alerts ----------
   The same alerts, filter and ids as the feed's NWS source (normalizeAlert; an id here is the feed's
   event id, nws:<id>). An alert carrying its own polygon is drawn with it; a zone-only alert (no geometry)
   is counted and listed, never given a point; an alert whose polygon fails the checks is listed as
   rejected. Times are the CAP times as NWS sent them, in UTC: sent, onset, expires, ends. An alert that
   has expired by the time it is answered (a kept copy) is left out. */
export const ALERTS = Object.freeze({ ttl: 120, max: 1500, url: 'https://api.weather.gov/alerts/active?status=actual' });
export function publicAlert(f, now = Date.now()) {
  const row = normalizeAlert(f, now);
  if (!row) return null;
  const p = f.properties;
  const zoneOnly = f.geometry === null || f.geometry === undefined;
  const geo = zoneOnly ? null : strictPolygons(f.geometry);
  const geometry = zoneOnly ? 'zone_only' : geo.polygons.length ? 'polygon' : 'rejected';
  return {
    id: clip(`nws:${row.id}`, 300), event: clip(p.event, 120), headline: clip(p.headline, 300),
    severity: clip(p.severity, 30), certainty: clip(p.certainty, 30), urgency: clip(p.urgency, 30),
    sent: isoTime(p.sent), onset: isoTime(p.onset), expires: isoTime(p.expires), ends: isoTime(p.ends),
    area: clip(p.areaDesc, 300), url: providerUrl(p['@id'], ['api.weather.gov']) || providerUrl(f.id, ['api.weather.gov']),
    geometry, polygons: geometry === 'polygon' ? geo.polygons : null, polygons_dropped: geo ? geo.polygons_dropped : 0
  };
}
const alertEnd = (a) => Math.min(...[a.expires, a.ends].map((t) => (t ? Date.parse(t) : Infinity)));
export async function fetchPublicAlerts(env, fetchImpl) {
  const data = await upstream(ALERTS.url, { headers: { accept: 'application/geo+json' } }, fetchImpl, boundedEventJson);
  if (!data || !Array.isArray(data.features)) throw new UpstreamError('upstream_invalid_json', 'NWS answer has no feature collection');
  const now = Date.now(), alerts = [];
  for (const f of data.features) { const a = publicAlert(f, now); if (a) alerts.push(a); }
  alerts.sort((a, b) => (Date.parse(b.sent) || 0) - (Date.parse(a.sent) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const listed = alerts.slice(0, ALERTS.max);
  return { total: data.features.length, current: alerts.length, truncated: alerts.length > listed.length, alerts: listed };
}
async function alertsAnswer(env, fetchImpl, cacheImpl) {
  const outcome = await sharedLayer({ layer: 'alerts', key: 'consumer-environment-v1-nws-alerts', ttl: ALERTS.ttl, rows: 'alerts', fetcher: fetchPublicAlerts }, env, fetchImpl, cacheImpl);
  const b = outcome.body && !outcome.body.unavailable ? outcome.body : {};
  const now = Date.now();
  const alerts = (Array.isArray(b.alerts) ? b.alerts : []).filter((a) => alertEnd(a) > now);
  const counts = { polygon: 0, zone_only: 0, rejected: 0 };
  for (const a of alerts) if (Object.hasOwn(counts, a.geometry)) counts[a.geometry] += 1;
  return {
    ok: true, schema: 'world-environment-alerts/v1', layer: 'alerts', generated_at: isoNow(),
    sources: [sourceHealth(LAYER_SOURCES.nws, outcome)],
    alerts, count: alerts.length, counts, total: Number(b.total) || 0, cap: ALERTS.max, truncated: b.truncated === true,
    notes: {
      geometry: 'polygon: the alert\'s own polygon, drawn as published. zone_only: NWS names forecast zones and gives no polygon, so the alert is listed and never placed. rejected: the published polygon failed the checks and is not drawn.',
      time: 'sent is when NWS issued the message; onset when the hazard is expected to begin; expires when the message expires; ends when the hazard is expected to end. Times are UTC.',
      id: 'Each id is the World feed\'s event id for the same alert (nws:<NWS id>).'
    }
  };
}

/* ---------- natural events: NASA EONET open events ----------
   The same events and ids as the feed's EONET source (normalizeNatural; eonet:<id>), with every
   geometry EONET reports, oldest first, so a storm's successive positions can be drawn as its track.
   Each entry keeps its own date and magnitude. EONET often dates a report 00:00 UTC when only the day is
   known: such an entry carries placeholder_time true, and its time of day should not be read as real. */
export const EONET = Object.freeze({ ttl: 600, max: 500, maxTrack: 500, url: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=500' });
export function publicNaturalEvent(e) {
  const base = normalizeNatural(e);
  if (!base || !base.id) return null;
  const track = [];
  let dropped = 0;
  for (const g of Array.isArray(e.geometry) ? e.geometry : []) {
    const date = g && typeof g === 'object' ? isoTime(g.date) : null;
    let shape = null;
    if (date && g.type === 'Point' && onGlobe(g.coordinates)) shape = { type: 'Point', coordinates: [lonOf(g.coordinates[0]), latOf(g.coordinates[1])] };
    else if (date && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
      const geo = strictPolygons(g);
      if (geo.polygons.length) shape = { type: 'Polygon', polygons: geo.polygons };
    }
    if (!shape) { dropped += 1; continue; }
    const magnitude = typeof g.magnitudeValue === 'number' && Number.isFinite(g.magnitudeValue) ? g.magnitudeValue : null;
    track.push({ date, placeholder_time: date.endsWith('T00:00:00.000Z'), ...shape, magnitude, unit: magnitude === null ? null : clip(g.magnitudeUnit, 60) });
  }
  if (!track.length) return null;
  track.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const kept = track.slice(-EONET.maxTrack);
  return {
    id: clip(`eonet:${base.id}`, 300), title: clip(e.title, 180),
    categories: (Array.isArray(e.categories) ? e.categories : []).map((c) => clip(c && (c.title || c.id), 80)).filter(Boolean).slice(0, 8),
    kind: base.kind, url: base.url,
    reported_by: (Array.isArray(e.sources) ? e.sources : []).map((s) => clip(s && s.id, 40)).filter(Boolean).slice(0, 10),
    track: kept, track_count: track.length, track_truncated: track.length > kept.length, geometry_dropped: dropped,
    placeholder_times: kept.filter((t) => t.placeholder_time).length
  };
}
export async function fetchPublicNatural(env, fetchImpl) {
  const data = await upstream(EONET.url, {}, fetchImpl, boundedEventJson);
  if (!data || !Array.isArray(data.events)) throw new UpstreamError('upstream_invalid_json', 'EONET answer has no event collection');
  const events = [];
  let skipped = 0;
  for (const e of data.events) {
    if (events.length >= EONET.max) break;
    const n = publicNaturalEvent(e);
    if (n) events.push(n); else skipped += 1;
  }
  return { total: data.events.length, skipped, truncated: data.events.length >= EONET.max, events };
}
async function naturalAnswer(env, fetchImpl, cacheImpl) {
  const outcome = await sharedLayer({ layer: 'eonet', key: 'consumer-environment-v1-eonet-tracks', ttl: EONET.ttl, rows: 'events', fetcher: fetchPublicNatural }, env, fetchImpl, cacheImpl);
  const b = outcome.body && !outcome.body.unavailable ? outcome.body : {};
  const events = Array.isArray(b.events) ? b.events : [];
  return {
    ok: true, schema: 'world-environment-eonet/v1', layer: 'eonet', generated_at: isoNow(),
    sources: [sourceHealth(LAYER_SOURCES.eonet, outcome)],
    events, count: events.length, total: Number(b.total) || 0, skipped: Number(b.skipped) || 0, cap: EONET.max, truncated: b.truncated === true,
    notes: {
      track: 'track lists every geometry EONET reports for the event, oldest first: a storm\'s successive reported positions, not an inferred path or forecast.',
      time: 'An entry with placeholder_time true is dated exactly 00:00 UTC, which EONET often uses when only the day is known; read its date, not its time of day.',
      coverage: 'EONET is a curated, periodically updated catalogue of open events, not continuous telemetry; it is not exhaustive.'
    }
  };
}

/* ---------- coastal water levels: NOAA CO-OPS ----------
   Observed water level, in metres above the station's Mean Lower Low Water (MLLW) datum, in UTC; never a
   tide prediction, a current or a navigation clearance. q is NOAA's quality flag: p preliminary (not yet
   verified by NOAA, and labelled so), v verified. The station list is kept a day. The latest level is
   read for a fixed, documented set of 20 stations (TIDE_LATEST_STATIONS), at most once per 15 minutes
   per Cloudflare location, two requests at a time with a pause between them, following NOAA's request to
   space and cache calls; one station's own 24 hours is read on demand and kept 6 minutes. A station must
   be in NOAA's water-level list (while the list can be read); a station NOAA marks as not tidal (the Great
   Lakes and other non-tidal gauges) has no MLLW and is refused rather than asked. The Halo station
   normalizer and water-level reader (./world-halo-ops.js) do the checking. */
export const TIDES_PUBLIC = Object.freeze({ latestTtl: 900, latestBytes: 64000, latestTimeoutMs: 8000, latestDeadlineMs: 15000, concurrency: 2, gapMs: 100, waterTimeoutMs: 10000 });
export const TIDE_LATEST_STATIONS = Object.freeze([
  ['8443970', 'Boston, MA'], ['8461490', 'New London, CT'], ['8518750', 'The Battery, NY'], ['8534720', 'Atlantic City, NJ'],
  ['8638610', 'Sewells Point, VA'], ['8658120', 'Wilmington, NC'], ['8665530', 'Charleston, SC'], ['8723214', 'Virginia Key, FL'],
  ['8724580', 'Key West, FL'], ['8726520', 'St. Petersburg, FL'], ['8761724', 'Grand Isle, LA'], ['8771450', 'Galveston Pier 21, TX'],
  ['9410170', 'San Diego, CA'], ['9414290', 'San Francisco, CA'], ['9439040', 'Astoria, OR'], ['9447130', 'Seattle, WA'],
  ['9455920', 'Anchorage, AK'], ['1612340', 'Honolulu, HI'], ['9755371', 'San Juan, PR'], ['1630000', 'Apra Harbor, Guam']
].map(([id, place]) => Object.freeze({ id, place })));
export function latestWaterLevelUrl(id) {
  return `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&application=mccluster&station=${id}&datum=MLLW&units=metric&time_zone=gmt&format=json&date=latest`;
}
const STATION_COLUMNS = Object.freeze(['id', 'name', 'lon', 'lat', 'state', 'tidal', 'great_lakes']);
const WATER_COLUMNS = Object.freeze(['observed_at', 'value_m', 'quality']);
const qOf = (quality) => (quality === 'preliminary' ? 'p' : quality === 'verified' ? 'v' : null);
const flagOf = (v) => (v === true ? true : v === false ? false : null);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* [id, name, lon, lat, state, tidal, great_lakes]: the Halo row plus NOAA's own two flags, unread as null */
export function publicStation(s) {
  const row = normalizeStation(s);
  return row ? [...row, flagOf(s.tidal), flagOf(s.greatlakes)] : null;
}
export async function fetchPublicTideStations(env, fetchImpl) {
  const data = await upstream(TIDES.stationsUrl, {}, fetchImpl, boundedJson(TIDES.stationsBytes), 15000);
  if (!data || !Array.isArray(data.stations)) throw new UpstreamError('upstream_invalid_json', 'NOAA answer has no station list');
  const seen = new Set(), stations = [];
  for (const s of data.stations) {
    const row = publicStation(s);
    if (!row || seen.has(row[0])) continue;
    seen.add(row[0]);
    if (stations.length < TIDES.stationsMax) stations.push(row);
  }
  return { total: data.stations.length, truncated: seen.size > stations.length, count: stations.length, stations };
}
/* THE CRAWL ENDS ON TIME (release security review SEC-2: with every NOAA request hanging one GET /layers/tides took 81 s, past the
   browser client's 20 s, so each visitor started the whole crawl again): no station is asked once `deadlineMs` has passed since the
   first, each request gets at most what remains (and at least a second), and a station never asked is unavailable, reason timeout */
export async function fetchLatestWaterLevels(env, fetchImpl, { gapMs = TIDES_PUBLIC.gapMs, deadlineMs = TIDES_PUBLIC.latestDeadlineMs } = {}) {
  const list = TIDE_LATEST_STATIONS, readings = new Array(list.length), codes = [];
  const ends = Date.now() + deadlineMs;
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++, { id, place } = list[i];
      const left = ends - Date.now();
      if (left <= 0) {
        codes.push('upstream_timeout');
        readings[i] = { station: id, place, name: null, lon: null, lat: null, value_m: null, observed_at: null, quality: null, q: null, status: 'unavailable', reason: 'timeout' };
        continue;
      }
      try {
        const body = normalizeWaterLevel(await upstream(latestWaterLevelUrl(id), {}, fetchImpl, boundedJson(TIDES_PUBLIC.latestBytes), Math.max(1000, Math.min(TIDES_PUBLIC.latestTimeoutMs, left))), id);
        const last = body.observations[body.observations.length - 1];
        readings[i] = { station: id, place, name: body.station.name, lon: body.station.lon, lat: body.station.lat, value_m: last[1], observed_at: last[0], quality: last[2], q: qOf(last[2]), status: 'available', reason: null };
      } catch (error) {
        const code = (error && error.code) || 'upstream_error';
        codes.push(code);
        readings[i] = { station: id, place, name: null, lon: null, lat: null, value_m: null, observed_at: null, quality: null, q: null, status: 'unavailable', reason: healthReason(code) || 'upstream_error' };
      }
      if (gapMs > 0 && next < list.length && Date.now() < ends) await pause(gapMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(TIDES_PUBLIC.concurrency, list.length) }, worker));
  const answered = readings.filter((r) => r.status === 'available').length;
  if (!answered) throw new UpstreamError(codes[0] || 'upstream_error', 'no station answered');
  return { asked: list.length, answered, readings };
}
const tideStationsLayer = (env, fetchImpl, cacheImpl) => sharedLayer({ layer: 'tides', key: 'consumer-environment-v1-tide-stations', ttl: TIDES.stationsTtl, rows: 'stations', fetcher: fetchPublicTideStations }, env, fetchImpl, cacheImpl);
async function tidesAnswer(env, fetchImpl, cacheImpl, gapMs, deadlineMs) {
  const [stations, latest] = await Promise.all([
    tideStationsLayer(env, fetchImpl, cacheImpl),
    sharedLayer({ layer: 'water_level_latest', key: 'consumer-environment-v1-tide-latest', ttl: TIDES_PUBLIC.latestTtl, rows: 'readings', fetcher: (e, f) => fetchLatestWaterLevels(e, f, { gapMs, deadlineMs }) }, env, fetchImpl, cacheImpl)
  ]);
  const sb = stations.body && !stations.body.unavailable ? stations.body : {}, lb = latest.body && !latest.body.unavailable ? latest.body : null;
  const rows = Array.isArray(sb.stations) ? sb.stations : [];
  const byId = new Map(rows.map((r) => [r[0], r]));
  const kept = lb && Array.isArray(lb.readings) ? lb.readings : [];
  const readings = TIDE_LATEST_STATIONS.map(({ id, place }) => {
    const r = kept.find((x) => x && x.station === id) || null, s = byId.get(id) || null;
    return {
      station: id, place, name: (r && r.name) || (s && s[1]) || null, lon: r && r.lon !== null ? r.lon : s ? s[2] : null, lat: r && r.lat !== null ? r.lat : s ? s[3] : null,
      value_m: r ? r.value_m : null, observed_at: r ? r.observed_at : null, quality: r ? r.quality : null, q: r ? r.q : null,
      status: r ? r.status : 'unavailable', reason: r ? r.reason : healthReason(latest.body && latest.body.upstream_error) || 'upstream_error'
    };
  });
  return {
    ok: true, schema: 'world-environment-tides/v1', layer: 'tides', generated_at: isoNow(),
    sources: [sourceHealth(LAYER_SOURCES.coops_stations, stations), sourceHealth(LAYER_SOURCES.coops_latest, latest)],
    product: 'observed_water_level', datum: 'MLLW', units: 'm',
    stations: { columns: STATION_COLUMNS, rows, count: rows.length, total: Number(sb.total) || 0, truncated: sb.truncated === true },
    latest: { set: 'documented', stations: TIDE_LATEST_STATIONS.length, refresh_s: TIDES_PUBLIC.latestTtl, answered: readings.filter((r) => r.status === 'available').length, readings },
    notes: {
      value: 'value_m is the observed water level in metres above the station\'s Mean Lower Low Water (MLLW) datum. It is an observation, not a tide prediction, not a current and not a navigation clearance.',
      quality: 'q p (quality preliminary) has not been verified by NOAA; v (verified) has.',
      time: 'observed_at is NOAA\'s observation time in UTC.',
      datum: 'Stations NOAA marks as not tidal (tidal false, including the Great Lakes, which use IGLD) have no MLLW, so this service gives them no reading.'
    }
  };
}
async function waterLevelAnswer(request, env, id, fetchImpl, cacheImpl) {
  if (!STATION_ID.test(id)) return refuse(request, env, 'invalid_station', 400);
  const stations = await tideStationsLayer(env, fetchImpl, cacheImpl);
  const list = stations.body && !stations.body.unavailable && Array.isArray(stations.body.stations) ? stations.body.stations : null;
  const row = list ? list.find((r) => r[0] === id) || null : null;
  if (list && !row) return refuse(request, env, 'unknown_station', 404);
  if (row && row[5] === false) return refuse(request, env, 'no_mllw_datum', 404);
  const outcome = await sharedLayer({
    layer: 'water_level', key: `consumer-environment-v1-water-${id}`, ttl: TIDES.waterTtl, rows: 'observations',
    fetcher: async (e, f) => normalizeWaterLevel(await upstream(waterLevelUrl(id), {}, f, boundedJson(TIDES.waterBytes), TIDES_PUBLIC.waterTimeoutMs), id)
  }, env, fetchImpl, cacheImpl, { lookup: true });
  const b = outcome.body && !outcome.body.unavailable ? outcome.body : {};
  const observations = Array.isArray(b.observations) ? b.observations : [];
  const last = observations[observations.length - 1] || null;
  const station = b.station || (row ? { id, name: row[1], lat: row[3], lon: row[2] } : { id, name: null, lat: null, lon: null });
  return send(request, env, {
    ok: true, schema: 'world-environment-water-level/v1', generated_at: isoNow(),
    sources: [sourceHealth(LAYER_SOURCES.coops_water_level, outcome)],
    station, product: 'observed_water_level', datum: 'MLLW', units: 'm',
    columns: WATER_COLUMNS, observations, count: observations.length, dropped: Number(b.dropped) || 0, truncated: b.truncated === true,
    latest: last ? { observed_at: last[0], value_m: last[1], quality: last[2], q: qOf(last[2]) } : null,
    url: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${id}`,
    notes: {
      value: 'Observed water level in metres above the station\'s MLLW datum, oldest first; not a tide prediction or a navigation clearance.',
      quality: 'quality preliminary has not been verified by NOAA; verified has.',
      time: 'observed_at is NOAA\'s observation time in UTC.'
    }
  });
}

/* ---------- ShakeMap: USGS intensity contours for one earthquake ----------
   On demand, for a USGS event id (two lower-case letters, then letters and digits). The event's detail
   is read (kept 5 minutes; an unknown event is USGS's own 404, said so; a deleted one is its 409, said as
   withdrawn), its preferred ShakeMap product
   chosen (highest preferredWeight, then the latest update; a deleted product never), and that product's
   cont_mmi.json read from USGS's own host, kept a day per product version and update time, since a
   version's contours do not change. ShakeMap is a modelled estimate of shaking intensity (Modified
   Mercalli Intensity) that combines recordings with ground-motion models; it is versioned, can change,
   and is labelled modelled. Each contour is an isoseismal line set, coloured as USGS colours it; lines are
   checked like any geometry, thinned evenly past 20,000 vertices in all, and never extended or closed. */
export const SHAKEMAP = Object.freeze({ detailTtl: 300, contoursTtl: 86400, detailBytes: 4000000, contourBytes: 8000000, timeoutMs: 12000, maxContours: 24, maxLines: 600, maxVertices: 20000, maxLinePoints: 2000 });
export const USGS_EVENT_ID = /^[a-z]{2}[a-z0-9]{2,30}$/;
export const shakemapDetailUrl = (id) => `https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${id}.geojson`;
const USGS_HOSTS = ['earthquake.usgs.gov'];
const versionOf = (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : typeof v === 'string' && /^\d{1,6}$/.test(v.trim()) ? Number(v.trim()) : null);
const wordOf = (v) => { const t = clip(v, 32); return t && /^[a-z][a-z_ -]*$/i.test(t) ? t.toLowerCase() : null; };
/* the event's preferred, undeleted ShakeMap, or null when USGS lists none */
export function readShakemapProduct(detail, id) {
  if (!detail || typeof detail !== 'object' || !detail.properties || typeof detail.properties !== 'object') throw new UpstreamError('upstream_invalid_json', 'USGS answer is not an event');
  const ids = typeof detail.properties.ids === 'string' ? detail.properties.ids.split(',').filter(Boolean) : [];
  if (detail.id !== id && !ids.includes(id)) throw new UpstreamError('upstream_invalid_json', 'USGS answered for another event');
  const preferred = clip(detail.id, 40);
  const products = detail.properties.products && typeof detail.properties.products === 'object' ? detail.properties.products.shakemap : null;
  const list = (Array.isArray(products) ? products : []).filter((p) => p && typeof p === 'object' && p.status !== 'DELETE');
  if (!list.length) return { found: true, preferred_id: preferred, shakemap: null };
  list.sort((a, b) => (finite(b.preferredWeight) ?? -Infinity) - (finite(a.preferredWeight) ?? -Infinity) || (finite(b.updateTime) ?? 0) - (finite(a.updateTime) ?? 0));
  const p = list[0], pp = p.properties && typeof p.properties === 'object' ? p.properties : {};
  const cont = p.contents && typeof p.contents === 'object' ? p.contents['download/cont_mmi.json'] : null;
  const rupture = p.contents && typeof p.contents === 'object' ? p.contents['download/rupture.json'] : null;
  return {
    found: true, preferred_id: preferred,
    shakemap: {
      code: clip(p.code, 40), source: clip(p.source, 16), update_time: isoFromMs(p.updateTime), version: versionOf(pp.version),
      process_time: isoTime(pp['process-timestamp']), review_status: wordOf(pp['review-status']), map_status: wordOf(pp['map-status']),
      max_mmi: within(pp.maxmmi, 0, 12, 1), contours_url: cont && typeof cont === 'object' ? providerUrl(cont.url, USGS_HOSTS) : null,
      rupture_url: rupture && typeof rupture === 'object' ? providerUrl(rupture.url, USGS_HOSTS) : null
    }
  };
}
async function fetchShakemapDetail(id, fetchImpl) {
  let detail;
  try {
    /* an event USGS no longer lists in the realtime feed is redirected, on the same host, to its FDSN
       event service; an unknown id ends there as 404 (or 204, its no-data answer) */
    detail = await upstream(shakemapDetailUrl(id), {}, fetchImpl, async (res) => (res.status === 204 ? null : boundedJson(SHAKEMAP.detailBytes)(res)), SHAKEMAP.timeoutMs);
  } catch (error) {
    if (error && error.code === 'upstream_http' && error.providerStatus === 404) return { found: false, preferred_id: null, shakemap: null };
    /* a deleted event: USGS's own answer is 409 ("The requested event has been deleted"), not an outage (E=UP slice S3) */
    if (error && error.code === 'upstream_http' && error.providerStatus === 409) return { found: true, withdrawn: true, preferred_id: null, shakemap: null };
    throw error;
  }
  return detail === null ? { found: false, preferred_id: null, shakemap: null } : readShakemapProduct(detail, id);
}
/* cont_mmi.json (a FeatureCollection of MultiLineString isoseismals: value, units, color) to contours */
export function readShakemapContours(fc, limits = SHAKEMAP) {
  if (!fc || typeof fc !== 'object' || !Array.isArray(fc.features)) throw new UpstreamError('upstream_invalid_json', 'ShakeMap contours are not a feature collection');
  const byMmi = new Map();
  let linesDropped = 0, featuresDropped = 0;
  for (const f of fc.features) {
    const p = f && f.properties && typeof f.properties === 'object' ? f.properties : {};
    const g = f && f.geometry;
    const mmi = within(p.value, 0, 12, 2);
    const raw = g && g.type === 'MultiLineString' && Array.isArray(g.coordinates) ? g.coordinates : g && g.type === 'LineString' ? [g.coordinates] : null;
    if (mmi === null || !raw || (p.units !== undefined && p.units !== 'mmi')) { featuresDropped += 1; continue; }
    let c = byMmi.get(mmi);
    if (!c) { c = { mmi, color: typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color.toLowerCase() : null, lines: [] }; byMmi.set(mmi, c); }
    for (const line of raw) { const l = strictLine(line, limits.maxLinePoints); if (l) c.lines.push(l); else linesDropped += 1; }
  }
  /* the strongest shaking first when anything has to go */
  let contours = [...byMmi.values()].filter((c) => c.lines.length).sort((a, b) => b.mmi - a.mmi);
  let truncated = contours.length > limits.maxContours, lines = 0;
  contours = contours.slice(0, limits.maxContours).map((c) => {
    const room = Math.max(0, limits.maxLines - lines), kept = c.lines.slice(0, room);
    if (kept.length < c.lines.length) truncated = true;
    lines += kept.length;
    return { ...c, lines: kept };
  }).filter((c) => c.lines.length);
  /* past the vertex budget every line keeps every k-th position and both ends, k as small as fits */
  const thin = (l, k) => { const out = l.filter((_, i) => i % k === 0); if (out[out.length - 1] !== l[l.length - 1]) out.push(l[l.length - 1]); return out; };
  const count = (k) => contours.reduce((n, c) => n + c.lines.reduce((m, l) => m + (k === 1 ? l.length : thin(l, k).length), 0), 0);
  let stride = 1, vertices = count(1);
  if (vertices > limits.maxVertices) {
    stride = Math.max(2, Math.floor(vertices / limits.maxVertices));
    vertices = count(stride);
    while (vertices > limits.maxVertices) { stride += 1; vertices = count(stride); }
    contours = contours.map((c) => ({ ...c, lines: c.lines.map((l) => thin(l, stride)) }));
  }
  return {
    contours: contours.sort((a, b) => a.mmi - b.mmi), counts: { contours: contours.length, lines, vertices },
    lines_dropped: linesDropped, features_dropped: featuresDropped, thinned: stride > 1, truncated
  };
}
const keyPart = (v) => String(v === null || v === undefined ? 'x' : v).replace(/[^a-z0-9]/gi, '').slice(0, 40) || 'x';
async function shakemapAnswer(request, env, id, fetchImpl, cacheImpl) {
  if (!USGS_EVENT_ID.test(id)) return refuse(request, env, 'invalid_event', 400);
  const detail = await sharedLayer({ layer: 'shakemap_detail', key: `consumer-environment-v1-shakemap-${id}`, ttl: SHAKEMAP.detailTtl, rows: 'products', fetcher: (e, f) => fetchShakemapDetail(id, f) }, env, fetchImpl, cacheImpl, { lookup: true });
  const sources = [sourceHealth(LAYER_SOURCES.usgs_event, detail)];
  const base = {
    ok: true, schema: 'world-environment-shakemap/v1', event_id: id, generated_at: isoNow(), sources, modelled: true, units: 'MMI',
    notes: {
      shakemap: 'ShakeMap is the USGS\'s modelled estimate of shaking intensity (Modified Mercalli Intensity, MMI), combining recordings with ground-motion models. It is versioned and can change; it is not a measurement at every place.',
      contours: 'Each contour is a line of equal estimated intensity (an isoseismal), coloured as USGS colours it.'
    }
  };
  const d = detail.body && !detail.body.unavailable ? detail.body : null;
  if (!d) return send(request, env, { ...base, available: false, reason: 'source_unavailable', contours: [] });
  if (d.withdrawn) return send(request, env, { ...base, available: false, reason: 'withdrawn', contours: [] });
  if (!d.found) return send(request, env, { ...base, available: false, reason: 'event_not_found', contours: [] });
  if (!d.shakemap) return send(request, env, { ...base, usgs_preferred_id: d.preferred_id, available: false, reason: 'no_shakemap', contours: [] });
  const sm = d.shakemap;
  const product = { usgs_preferred_id: d.preferred_id, version: sm.version, process_time: sm.process_time, review_status: sm.review_status, map_status: sm.map_status, max_mmi: sm.max_mmi, update_time: sm.update_time, product_code: sm.code, product_source: sm.source };
  if (!sm.contours_url) return send(request, env, { ...base, ...product, available: false, reason: 'no_contours', contours: [] });
  const versionKey = [sm.source, sm.code, sm.version, Date.parse(sm.update_time)].map(keyPart).join('-');
  const contours = await sharedLayer({
    layer: 'shakemap_contours', key: `consumer-environment-v1-shakemap-${id}-${versionKey}`, ttl: SHAKEMAP.contoursTtl, rows: 'contours',
    fetcher: async (e, f) => readShakemapContours(await upstream(sm.contours_url, {}, f, boundedJson(SHAKEMAP.contourBytes), SHAKEMAP.timeoutMs))
  }, env, fetchImpl, cacheImpl, { lookup: true });
  sources.push(sourceHealth(LAYER_SOURCES.usgs_shakemap, contours));
  const c = contours.body && !contours.body.unavailable ? contours.body : null;
  if (!c) return send(request, env, { ...base, ...product, available: false, reason: 'source_unavailable', contours: [] });
  return send(request, env, {
    ...base, ...product, available: true, reason: null, contours: Array.isArray(c.contours) ? c.contours : [],
    counts: c.counts || { contours: 0, lines: 0, vertices: 0 }, thinned: c.thinned === true, truncated: c.truncated === true,
    lines_dropped: Number(c.lines_dropped) || 0, features_dropped: Number(c.features_dropped) || 0,
    caps: { contours: SHAKEMAP.maxContours, lines: SHAKEMAP.maxLines, vertices: SHAKEMAP.maxVertices }
  });
}

/* ---------- documented rupture: the modelled up-dip edge of a USGS finite-fault plane (event timeline slice S5, D13) ----------
   On demand, for one USGS event, through the same event detail as its ShakeMap (one read, kept 5 minutes, shared). The preferred
   ShakeMap's own download/rupture.json is read from USGS's host and kept a day per product version. What may be drawn, and why:
   USGS documents rupture geometry for about a dozen quakes a year (all M6.5 and up) as a modelled, dipping fault plane, a Polygon
   or MultiPolygon in rupture.json whose reference names a finite-fault model (for example "Source: USGS NEIC Rapid Finite
   Fault"); a quake modelled as a point has a Point there (reference "Origin"), and the file's "rupture type" says "rupture
   extent" either way, so it decides nothing. Only the plane's up-dip edge (its shallowest side, the line a crack would follow if
   the fault reached the surface) is answered, as a model: never a mapped surface crack. A Point, a plane without a named finite
   fault, a plane with no depths or no clear top edge, and a quake USGS has withdrawn (its detail answers 409) draw nothing, each
   with its reason. */
export const RUPTURE = Object.freeze({ bytes: 200000, ttl: 86400, timeoutMs: 12000, maxPolygons: 8, maxVertices: 64 });
const FINITE_FAULT = /finite[\s-]*fault/i;
const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
/* the shallowest side of one closed ring of [lon, lat, depth km] vertices: the longest run of consecutive vertices (round the
   ring) lying within 2 % of the plane's depth range (at least 50 m) of its top; null for a ring that is open, too short or too
   long, carries a value off the globe or out of range, is level, or has no run of two */
export function upDipEdge(ring, maxVertices = RUPTURE.maxVertices) {
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > maxVertices + 1) return null;
  const pts = [];
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 3) return null;
    const [lon, lat, depth] = p;
    if (![lon, lat, depth].every((v) => typeof v === 'number' && Number.isFinite(v)) || Math.abs(lon) > 180 || Math.abs(lat) > 90 || depth < -10 || depth > 800) return null;
    pts.push([lon, lat, depth]);
  }
  const first = pts[0], last = pts[pts.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1] || first[2] !== last[2]) return null;
  pts.pop();
  if (pts.length < 3) return null;
  const depths = pts.map((p) => p[2]), top = Math.min(...depths), bottom = Math.max(...depths);
  if (bottom - top < 0.5) return null;
  const tolerance = Math.max(0.05, 0.02 * (bottom - top)), n = pts.length, onTop = pts.map((p) => p[2] <= top + tolerance);
  let best = null;
  for (let i = 0; i < n; i += 1) {
    if (!onTop[i] || onTop[(i - 1 + n) % n]) continue;
    const run = [];
    for (let k = 0; k < n && onTop[(i + k) % n]; k += 1) run.push(pts[(i + k) % n]);
    if (!best || run.length > best.length) best = run;
  }
  if (!best || best.length < 2) return null;
  return { line: best.map((p) => [round(p[0], 5), round(p[1], 5)]), top, bottom };
}
/* rupture.json (a FeatureCollection with a metadata block) to what may be drawn */
export function readRupture(fc, limits = RUPTURE) {
  if (!fc || typeof fc !== 'object' || !Array.isArray(fc.features)) throw new UpstreamError('upstream_invalid_json', 'rupture is not a feature collection');
  const meta = fc.metadata && typeof fc.metadata === 'object' ? fc.metadata : {};
  const reference = typeof meta.reference === 'string' ? meta.reference.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const created = /Model created:\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/.exec(reference);
  const base = { reference, reviewed: meta.reviewed === 'True' || meta.reviewed === true ? true : meta.reviewed === 'False' || meta.reviewed === false ? false : null, model_created: created ? created[1] : null };
  const geometries = fc.features.map((f) => (f && f.geometry && typeof f.geometry === 'object' ? f.geometry : null)).filter(Boolean);
  const polygons = [];
  for (const g of geometries) {
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) polygons.push(g.coordinates);
    else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) for (const poly of g.coordinates) polygons.push(poly);
  }
  if (!polygons.length) return { ...base, finite: false, reason: geometries.some((g) => g.type === 'Point') ? 'point_source' : 'no_edge', edges: [] };
  if (!FINITE_FAULT.test(reference)) return { ...base, finite: false, reason: 'not_finite_fault', edges: [] };
  const edges = [];
  let top = Infinity, bottom = -Infinity;
  for (const poly of polygons.slice(0, limits.maxPolygons)) {
    const edge = upDipEdge(Array.isArray(poly) ? poly[0] : null, limits.maxVertices);
    if (!edge) continue;
    edges.push(edge.line); top = Math.min(top, edge.top); bottom = Math.max(bottom, edge.bottom);
  }
  if (!edges.length) return { ...base, finite: false, reason: 'no_edge', edges: [] };
  return { ...base, finite: true, reason: null, edges, top_depth_km: round(top, 1), bottom_depth_km: round(bottom, 1) };
}
async function ruptureAnswer(request, env, id, fetchImpl, cacheImpl) {
  if (!USGS_EVENT_ID.test(id)) return refuse(request, env, 'invalid_event', 400);
  /* the very read the ShakeMap route makes (same key, same fetcher): one detail per event, shared and coalesced */
  const detail = await sharedLayer({ layer: 'shakemap_detail', key: `consumer-environment-v1-shakemap-${id}`, ttl: SHAKEMAP.detailTtl, rows: 'products', fetcher: (e, f) => fetchShakemapDetail(id, f) }, env, fetchImpl, cacheImpl, { lookup: true });
  const sources = [sourceHealth(LAYER_SOURCES.usgs_event, detail)];
  const base = {
    ok: true, schema: 'world-environment-rupture/v1', event_id: id, generated_at: isoNow(), sources, modelled: true, label: 'modelled rupture plane (USGS finite fault)', edges: [],
    notes: {
      rupture: 'A USGS finite-fault model estimates the fault plane that slipped. The edge given is the plane\'s shallowest side, a model: not a crack mapped at the surface.',
      point: 'Most earthquakes have no finite-fault model: USGS treats them as a point, and nothing is drawn.'
    }
  };
  const d = detail.body && !detail.body.unavailable ? detail.body : null;
  /* USGS answers 409 for an event it has deleted, which the detail reader says as withdrawn (slice S3): so is its rupture, even
     over a copy kept from before the deletion */
  if (d && d.withdrawn === true) return send(request, env, { ...base, available: false, reason: 'withdrawn' });
  if (!d) return send(request, env, { ...base, available: false, reason: 'source_unavailable' });
  if (!d.found) return send(request, env, { ...base, available: false, reason: 'event_not_found' });
  if (!d.shakemap) return send(request, env, { ...base, usgs_preferred_id: d.preferred_id, available: false, reason: 'no_shakemap' });
  const sm = d.shakemap, product = { usgs_preferred_id: d.preferred_id, version: sm.version, product_code: sm.code, product_source: sm.source, update_time: sm.update_time };
  /* a copy kept before this reader existed cannot say whether a rupture file is listed */
  if (sm.rupture_url === undefined) return send(request, env, { ...base, ...product, available: false, reason: 'source_unavailable' });
  if (!sm.rupture_url) return send(request, env, { ...base, ...product, available: false, reason: 'no_rupture' });
  const versionKey = [sm.source, sm.code, sm.version, Date.parse(sm.update_time)].map(keyPart).join('-');
  const rupture = await sharedLayer({
    layer: 'rupture', key: `consumer-environment-v1-rupture-${id}-${versionKey}`, ttl: RUPTURE.ttl, rows: 'edges',
    fetcher: async (e, f) => readRupture(await upstream(sm.rupture_url, {}, f, boundedJson(RUPTURE.bytes), RUPTURE.timeoutMs))
  }, env, fetchImpl, cacheImpl, { lookup: true });
  sources.push(sourceHealth(LAYER_SOURCES.usgs_rupture, rupture));
  const r = rupture.body && !rupture.body.unavailable ? rupture.body : null;
  if (!r) return send(request, env, { ...base, ...product, available: false, reason: 'source_unavailable' });
  const facts = { reference: r.reference || '', reviewed: r.reviewed === true ? true : r.reviewed === false ? false : null, model_created: r.model_created || null };
  if (r.finite !== true) return send(request, env, { ...base, ...product, ...facts, available: false, reason: r.reason || 'no_edge' });
  return send(request, env, { ...base, ...product, ...facts, available: true, reason: null, edges: Array.isArray(r.edges) ? r.edges : [], top_depth_km: r.top_depth_km, bottom_depth_km: r.bottom_depth_km });
}

/* ---------- the routes ---------- */
function inNamespace(path) {
  if (!path.startsWith(ROOT + '/')) return false;
  return NAMESPACES.includes(path.slice(ROOT.length + 1).split('/')[0]);
}

/* null when the path is not one of these routes (the pinned product answers the rest).
   `gate` is required: without one, nothing is served. */
export async function handleEnvironmentLayers(request, env, { fetchImpl = fetch, cacheImpl = null, gate = null, tideGapMs = TIDES_PUBLIC.gapMs, tideDeadlineMs = TIDES_PUBLIC.latestDeadlineMs } = {}) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const route = environmentRouteForPath(path);
  if (route && route.id === 'feed') return null;
  if (!route && !inNamespace(path)) return null;
  let refusal;
  try { refusal = typeof gate === 'function' ? await gate() : { code: 'module_policy_unavailable', status: 503 }; } catch { refusal = { code: 'module_policy_unavailable', status: 503 }; }
  if (refusal) return refuse(request, env, refusal.code, refusal.status);
  if (request.method !== 'GET') return refuse(request, env, 'method_not_allowed', 405);
  if (!route) return refuse(request, env, 'not_found', 404);
  if (route.id === 'fires') return send(request, env, await firesAnswer(env, fetchImpl, cacheImpl));
  if (route.id === 'perimeters') return send(request, env, await perimetersAnswer(env, fetchImpl, cacheImpl));
  if (route.id === 'alerts') return send(request, env, await alertsAnswer(env, fetchImpl, cacheImpl));
  if (route.id === 'eonet') return send(request, env, await naturalAnswer(env, fetchImpl, cacheImpl));
  if (route.id === 'tides') return send(request, env, await tidesAnswer(env, fetchImpl, cacheImpl, tideGapMs, tideDeadlineMs));
  if (route.id === 'water-level') return waterLevelAnswer(request, env, route.param, fetchImpl, cacheImpl);
  if (route.id === 'shakemap') return shakemapAnswer(request, env, route.param, fetchImpl, cacheImpl);
  if (route.id === 'rupture') return ruptureAnswer(request, env, route.param, fetchImpl, cacheImpl);
  return refuse(request, env, 'not_found', 404);
}
