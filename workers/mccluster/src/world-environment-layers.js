/* THE ENVIRONMENTAL GLOBE'S PUBLIC LAYERS (owner, 2026-11-17: the environmental globe in
   docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md; routes, DTOs, licences and timestamp
   meanings: docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md).

     GET /v1/world/environment/layers/fires             NASA FIRMS VIIRS NOAA-20 and NOAA-21, trailing 24 h (needs FIRMS_MAP_KEY)

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
import { sourceHealth, trackedLayer, upstream } from './world-layers.js';
import { parseFirmsCsv } from './world-halo-layers.js';
import { environmentRouteForPath } from '../../../packages/release-policy/globe.mjs';

const ROOT = '/v1/world/environment';
/* the namespaces this module answers for; anything else under them is 404 after the gate */
const NAMESPACES = ['layers', 'tides', 'quakes'];
const isoNow = () => new Date().toISOString();
const isoOf = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/* ---------- the providers, as each health record names them ---------- */
const FIRMS_HOME = 'https://firms.modaps.eosdis.nasa.gov/';
const FIRMS_LICENSE = 'NASA FIRMS data: CC0 1.0 (U.S. public domain); please credit NASA FIRMS';
export const LAYER_SOURCES = Object.freeze({
  firms_viirs_noaa20: Object.freeze({ id: 'firms_viirs_noaa20', label: 'NASA FIRMS VIIRS NOAA-20', url: FIRMS_HOME, license: FIRMS_LICENSE,
    attribution: 'NASA FIRMS, VIIRS 375 m active fire product (NOAA-20, near real-time)',
    coverage: 'Global VIIRS active-fire detections from NOAA-20 in the 24 hours before retrieval' }),
  firms_viirs_noaa21: Object.freeze({ id: 'firms_viirs_noaa21', label: 'NASA FIRMS VIIRS NOAA-21', url: FIRMS_HOME, license: FIRMS_LICENSE,
    attribution: 'NASA FIRMS, VIIRS 375 m active fire product (NOAA-21, near real-time)',
    coverage: 'Global VIIRS active-fire detections from NOAA-21 in the 24 hours before retrieval' })
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
      ? await trackedLayer({ layer: 'fires', key: `consumer-environment-v1-firms-${sat.product}`, ttl: FIRES.ttl, rows: 'detections', fetcher: (e, f) => fetchFirmsSatellite(e, f, sat) }, env, fetchImpl, cacheImpl)
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

/* ---------- the routes ---------- */
function inNamespace(path) {
  if (!path.startsWith(ROOT + '/')) return false;
  return NAMESPACES.includes(path.slice(ROOT.length + 1).split('/')[0]);
}

/* null when the path is not one of these routes (the pinned product answers the rest).
   `gate` is required: without one, nothing is served. */
export async function handleEnvironmentLayers(request, env, { fetchImpl = fetch, cacheImpl = null, gate = null } = {}) {
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
  return refuse(request, env, 'not_found', 404);
}
