/* HALO ON THE ADMIN GLOBE: the live feeds Hitman's Halo had, through the
   canonical Worker, owner-only by the release guard (world-release.test.mjs
   proves the guard). Here: each layer's normalization and filtering, its cap,
   not_configured without a provider call, the last good answer while a
   provider is down, one provider call per window, and the headers. Fake fetch
   only; no network. Fixture shapes are the providers' answers as probed
   live on 2026-10-21. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  handleHaloLayers, handleWorldGeocode, HALO_LAYERS, WORLD_GEOCODE_PATH, AIS_INSTANCE, NIFC_PERIMETERS_URL,
  normalizeMilitaryAircraft, normalizeQuake, normalizeRing, normalizeCyclone, normalizeVessel, normalizeGeocodeQuery,
  parseFirmsCsv, fetchFires, perimetersQuery
} from '../src/world-halo-layers.js';
import { workersFetch } from './support/workers-fetch-semantics.mjs';

const ORIGIN = 'https://matthew.mccluster.org';
const FIRMS_KEY = 'firms-map-key-SECRET-0123456789abcdef';
const ENV = { ALLOWED_ORIGINS: ORIGIN };
const req = (path, { method = 'GET' } = {}) => new Request(`https://api.mccluster.org${path}`, { method, headers: { origin: ORIGIN, authorization: 'Bearer owner' } });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (body, status = 200, type = 'text/plain') => new Response(body, { status, headers: { 'content-type': type } });
function memoryCache() { const m = new Map(); return { async match(k) { const v = m.get(k.url); return v ? new Response(v) : undefined; }, async put(k, r) { m.set(k.url, await r.text()); }, raw: m }; }
/* move every kept answer's fetched_at back by `seconds` */
function age(cache, seconds) {
  for (const [k, v] of cache.raw) { const b = JSON.parse(v); b.fetched_at = new Date(Date.parse(b.fetched_at) - seconds * 1000).toISOString(); cache.raw.set(k, JSON.stringify(b)); }
}
const headersOk = (r) => {
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('vary'), 'origin, authorization');
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
};
/* a chunked body, split at awkward places, the way a large CSV arrives */
function streamed(str, size = 7) {
  const bytes = new TextEncoder().encode(str);
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size)); c.close(); } }), { headers: { 'content-type': 'text/csv' } });
}

/* ---------- fixtures ---------- */
const NOW_MS = Date.now();
/* adsb.lol /v2/mil: feet, knots, 'ground', dbFlags 1 = military, lastPosition when the position is old */
const MIL = { msg: 'No error', now: NOW_MS, total: 12, ac: [
  { hex: 'ae03fd', type: 'adsb_icao', flight: 'PAT899  ', r: '84-00144', t: 'BE20', dbFlags: 1, alt_baro: 2975, alt_geom: 2975, gs: 153.8, track: 167.23, squawk: '4633', emergency: 'none', lat: 47.247711, lon: -122.637909, seen_pos: 0.149 },
  { hex: 'ae6828', type: 'adsb_icao', dbFlags: 1, alt_baro: 'ground', gs: 0, squawk: '6616', emergency: 'none', lat: 48.36, lon: -122.66, seen_pos: 1.18 },
  { hex: 'ae624a', type: 'mode_s', flight: 'MUSL    ', t: 'B212', dbFlags: 1, lastPosition: { lat: 38.68, lon: -76.82, seen_pos: 800 } },
  { hex: 'old001', flight: 'OLD', t: 'C17', dbFlags: 1, alt_baro: 20000, gs: 300, track: 10, lat: 40.2, lon: -74.3, seen_pos: 300 },
  { hex: 'pia001', flight: 'PIA1', t: 'C130', dbFlags: 1 | 4, alt_baro: 20000, gs: 300, track: 10, lat: 40.1, lon: -74.2 },
  { hex: 'ladd01', flight: 'LADD1', t: 'GLF5', dbFlags: 1 | 8, alt_baro: 20000, gs: 300, track: 10, lat: 40.1, lon: -74.2 },
  { hex: 'em7700', flight: 'RCH77', t: 'C17', dbFlags: 1, alt_baro: 30000, gs: 450, track: 90, squawk: '7700', lat: '36.5', lon: '-80.25', seen_pos: 2 },
  { hex: 'emgen1', flight: 'EVAC1', t: 'C130', dbFlags: 1, alt_baro: 15000, gs: 250, track: 400, squawk: '1200', emergency: 'general', lat: 35, lon: -79, seen_pos: 1 },
  { hex: 'ae03fd', flight: 'DUPE', t: 'BE20', dbFlags: 1, alt_baro: 1000, gs: 100, track: 1, lat: 47, lon: -122 },
  { hex: 'badlat', flight: 'BAD', dbFlags: 1, alt_baro: 1000, gs: 100, track: 1, lat: 95, lon: 10 },
  { flight: 'NOHEX', dbFlags: 1, alt_baro: 1000, gs: 100, track: 1, lat: 10, lon: 10 },
  { hex: 'long01', flight: 'X'.repeat(300), t: 'T'.repeat(300), dbFlags: 1, alt_baro: 1000, gs: 100, track: 1, lat: 10, lon: 10, squawk: '89AB' }
] };
const USGS = { type: 'FeatureCollection', metadata: { generated: NOW_MS, count: 6 }, features: [
  { type: 'Feature', id: 'ci41350127', properties: { mag: 2.52, place: '11 km NE of Kernville, CA', time: 1792600516700, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/ci41350127', tsunami: 0, alert: null }, geometry: { type: 'Point', coordinates: [-118.357333333333, 35.8326666666667, 11.89] } },
  { type: 'Feature', id: 'us7000abcd', properties: { mag: '6.1', place: 'P'.repeat(300), time: 1792600000000, url: 'https://evil.example/phish', tsunami: 1, alert: 'orange' }, geometry: { type: 'Point', coordinates: [142.5, 38.1, 35] } },
  { type: 'Feature', id: 'nocoords', properties: { mag: 1 }, geometry: { type: 'Point', coordinates: [null, null, 5] } },
  { type: 'Feature', id: 'badlon', properties: { mag: 1 }, geometry: { type: 'Point', coordinates: [200, 10, 5] } },
  { type: 'Feature', properties: { mag: 1 }, geometry: { type: 'Point', coordinates: [10, 10, 5] } },
  { type: 'Feature', id: 'weird', properties: { mag: 'big', alert: 'purple', time: 'yesterday', url: 'http://earthquake.usgs.gov/x' }, geometry: { type: 'Point', coordinates: ['10.123456', '-20.5', 'deep'] } }
] };
const FIRMS_HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const FIRMS_SNPP = [FIRMS_HEADER,
  '-12.345678,23.456789,330.5,0.39,0.36,2026-10-21,130,N,VIIRS,n,2.0NRT,290.1,5.2,N',
  '34.1,-118.2,367.0,0.4,0.4,2026-10-21,2054,N,VIIRS,h,2.0NRT,300.2,88.8,D',
  '95.0,10.0,330,0.4,0.4,2026-10-21,0130,N,VIIRS,l,2.0NRT,290,3.3,N',
  '10.0,10.0,330,0.4',
  '1.5,2.5,330,0.4,0.4,2026-13-40,9999,N,VIIRS,x,2.0NRT,290,abc,Q'
].join('\r\n') + '\r\n';
const FIRMS_NOAA20 = [FIRMS_HEADER, '-33.9,151.2,340,0.5,0.4,2026-10-21,0412,N20,VIIRS,l,2.0NRT,295,12.5,D'].join('\n') + '\n';
const ring = (pts) => pts.map(([x, y]) => [x, y]);
const NIFC = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { poly_IncidentName: 'Little Giant', attr_UniqueFireIdentifier: '2026-WAOWF-260406', attr_IncidentSize: 172912, attr_PercentContained: 95, attr_FireDiscoveryDateTime: 1784164674000 },
    geometry: { type: 'MultiPolygon', coordinates: [[ring([[-120.59531, 47.83372], [-120.5945, 47.833], [-120.5945, 47.833], [-120.5942, 47.8327], [-120.59531, 47.83372]])], [ring([[-120.75, 47.88], [-120.74, 47.89], [-120.73, 47.88]])]] } },
  { type: 'Feature', properties: { poly_IncidentName: 'N'.repeat(300), attr_UniqueFireIdentifier: null, attr_IncidentSize: -5, attr_PercentContained: 140, attr_FireDiscoveryDateTime: null },
    geometry: { type: 'Polygon', coordinates: [ring([[-110, 40], [-110, 999], [-109, 40], [-109, 41], ['x', 1], [-110, 40]])] } },
  { type: 'Feature', properties: { poly_IncidentName: 'No geometry', attr_UniqueFireIdentifier: 'nogeom' }, geometry: null },
  { type: 'Feature', properties: { poly_IncidentName: 'Degenerate', attr_UniqueFireIdentifier: 'degen' }, geometry: { type: 'Polygon', coordinates: [ring([[-100, 40], [-100, 40], [-100, 40]])] } },
  { type: 'Feature', properties: { poly_IncidentName: 'Point', attr_UniqueFireIdentifier: 'pt' }, geometry: { type: 'Point', coordinates: [-100, 40] } }
] };
const NHC = { activeStorms: [
  { id: 'ep222026', binNumber: 'EP2', name: 'Twenty-Two-E', classification: 'TD', intensity: '30', pressure: '1005', latitude: '9.5N', longitude: '99.3W', latitudeNumeric: 9.5, longitudeNumeric: -99.3, movementDir: 265, movementSpeed: 7, publicAdvisory: { url: 'https://www.nhc.noaa.gov/text/MIATCPEP2.shtml' } },
  { id: 'al142026', name: 'Milton', classification: 'HU', intensity: 140, pressure: 905, latitude: '22.1N', longitude: '88.4W', movementDir: 90, movementSpeed: '9', publicAdvisory: { url: 'https://evil.example/MIATCPAT4.shtml' } },
  { id: 'not-an-id', name: 'Bad id', latitudeNumeric: 10, longitudeNumeric: 10 },
  { id: 'cp012026', name: 'No position', classification: 'TS' },
  { id: 'cp022026', name: 'Odd values', classification: '<script>', intensity: 'strong', pressure: 50, latitudeNumeric: 95, longitudeNumeric: 10 }
] };

/* ---------- the routes ---------- */
test('the routes are exactly the registered Halo layers, GET and HEAD only, and the World layers are not answered here', async () => {
  for (const p of ['/v1/world/layers/flights', '/v1/world/layers/satellites', '/v1/world/layers/launches', '/v1/world/layers/weather', '/v1/world/layers/militaryx', '/v1/world/geocode', '/v1/world/layer/military']) {
    assert.equal(await handleHaloLayers(req(p), ENV, { fetchImpl: () => { throw new Error('no call'); } }), null, p);
  }
  assert.deepEqual(Object.keys(HALO_LAYERS), ['airquality', 'military', 'quakes', 'fires', 'perimeters', 'cyclones', 'vessels']);
  const post = await handleHaloLayers(req('/v1/world/layers/quakes', { method: 'POST' }), ENV);
  assert.equal(post.status, 405); headersOk(post);
  assert.equal(await handleWorldGeocode(req('/v1/world/layers/quakes'), ENV), null);
  assert.equal(WORLD_GEOCODE_PATH, '/v1/world/geocode');
  assert.deepEqual(Object.fromEntries(Object.entries(HALO_LAYERS).map(([k, v]) => [k, [v.ttl, v.max, v.rows]])), {
    airquality: [600, 500, 'readings'], military: [30, 4000, 'aircraft'], quakes: [120, 2000, 'quakes'], fires: [1800, 25000, 'fires'],
    perimeters: [600, 400, 'perimeters'], cyclones: [600, 50, 'cyclones'], vessels: [0, 8000, 'vessels']
  });
});

/* ---------- a shared harness for the five Cache API layers ---------- */
function providerFor(layer, { fail = false, body = null } = {}) {
  return workersFetch(async (url) => {
    if (fail) return text('down', 503);
    switch (url.hostname) {
      case 'api.adsb.lol': return json(body || MIL);
      case 'earthquake.usgs.gov': return json(body || USGS);
      case 'firms.modaps.eosdis.nasa.gov': return streamed(url.pathname.includes('NOAA20') ? FIRMS_NOAA20 : FIRMS_SNPP);
      case 'services3.arcgis.com': return json(body || NIFC);
      case 'www.nhc.noaa.gov': return json(body || NHC);
      default: throw new Error('unexpected ' + url + ' for ' + layer);
    }
  });
}
const CACHED = [['military', 'aircraft', 30, {}], ['quakes', 'quakes', 120, {}], ['fires', 'fires', 1800, { FIRMS_MAP_KEY: FIRMS_KEY }], ['perimeters', 'perimeters', 600, {}], ['cyclones', 'cyclones', 600, {}]];

for (const [layer, rows, ttl, extra] of CACHED) {
  test(`${layer}: one provider call per ${ttl} s window; a hit within the window asks nobody`, async () => {
    const env = { ...ENV, ...extra }, cache = memoryCache(), fetchImpl = providerFor(layer);
    const first = await handleHaloLayers(req(`/v1/world/layers/${layer}`), env, { fetchImpl, cacheImpl: cache });
    assert.equal(first.status, 200); headersOk(first);
    const body = await first.json();
    assert.equal(body.ok, true); assert.equal(body.layer, layer); assert.equal(body.stale, false); assert.equal(body.unavailable, undefined);
    assert.ok(body.fetched_at && body.attribution && body.credit && body.license, 'attributed, credited and licensed');
    assert.equal(body.count, body[rows].length);
    const calls = fetchImpl.calls.length;
    assert.ok(calls >= 1);
    for (const c of fetchImpl.calls) assert.equal(c.init.redirect, 'manual', "workerd throws on redirect: 'error'");
    age(cache, ttl - 5);
    const again = await (await handleHaloLayers(req(`/v1/world/layers/${layer}`), env, { fetchImpl, cacheImpl: cache })).json();
    assert.equal(fetchImpl.calls.length, calls, 'inside the window the provider is not asked again');
    assert.deepEqual(again[rows], body[rows]);
    age(cache, 10);
    await handleHaloLayers(req(`/v1/world/layers/${layer}`), env, { fetchImpl, cacheImpl: cache });
    assert.ok(fetchImpl.calls.length > calls, 'past the window the provider is asked again');
  });

  test(`${layer}: provider down serves the last good answer, stale, with the reason; with nothing kept it is unavailable and nothing is stored`, async () => {
    const env = { ...ENV, ...extra }, cache = memoryCache();
    const good = await (await handleHaloLayers(req(`/v1/world/layers/${layer}`), env, { fetchImpl: providerFor(layer), cacheImpl: cache })).json();
    age(cache, ttl + 60);
    const down = providerFor(layer, { fail: true });
    const r = await handleHaloLayers(req(`/v1/world/layers/${layer}`), env, { fetchImpl: down, cacheImpl: cache });
    headersOk(r);
    const stale = await r.json();
    assert.equal(stale.stale, true); assert.equal(stale.upstream_error, 'upstream_http');
    assert.deepEqual(stale[rows], good[rows], 'the last good answer');
    age(cache, 7 * 3600);
    const gone = await (await handleHaloLayers(req(`/v1/world/layers/${layer}`), env, { fetchImpl: down, cacheImpl: cache })).json();
    assert.equal(gone.unavailable, true, 'past the 6 h grace a kept answer is not served');
    const fresh = memoryCache();
    const empty = await (await handleHaloLayers(req(`/v1/world/layers/${layer}`), env, { fetchImpl: down, cacheImpl: fresh })).json();
    assert.equal(empty.ok, true); assert.equal(empty.unavailable, true); assert.equal(empty.upstream_error, 'upstream_http');
    assert.equal(empty.count, 0); assert.deepEqual(empty[rows], []); assert.equal(empty.stale, false); assert.equal(empty.fetched_at, null);
    assert.ok(empty.attribution && empty.credit && empty.license);
    assert.equal(fresh.raw.size, 0, 'a failure is never stored as the answer');
  });
}

/* ---------- military ---------- */
test('military: airborne, positioned, current, not privacy-flagged; emergencies marked; strings capped', async () => {
  const fetchImpl = providerFor('military');
  const body = await (await handleHaloLayers(req('/v1/world/layers/military'), ENV, { fetchImpl, cacheImpl: memoryCache() })).json();
  assert.equal(fetchImpl.calls[0].url, 'https://api.adsb.lol/v2/mil');
  assert.equal(body.attribution, 'adsb.lol, Open Database License (ODbL) 1.0'); assert.equal(body.license, 'ODbL-1.0'); assert.equal(body.credit, 'Military flights: adsb.lol (ODbL)');
  assert.equal(body.withheld, 2, 'PIA and LADD airframes are withheld and counted, never drawn');
  assert.deepEqual(body.aircraft.map((a) => a[0]), ['ae03fd', 'em7700', 'emgen1', 'long01'], 'ground, no position, stale, duplicate, bad latitude and no-hex rows are dropped');
  assert.deepEqual(body.aircraft[0], ['ae03fd', 'PAT899', -122.638, 47.248, 906.8, 79.121, 167.23, 'BE20', '4633', false]);
  assert.deepEqual(body.aircraft[1], ['em7700', 'RCH77', -80.25, 36.5, 9144, 231.5, 90, 'C17', '7700', true], 'squawk 7700 is an emergency; string coordinates are read');
  assert.equal(body.aircraft[2][9], true, "readsb emergency 'general' is an emergency");
  assert.equal(body.aircraft[2][6], null, 'a track outside 0..360 is null, never kept');
  const long = body.aircraft[3];
  assert.equal(long[1].length, 16); assert.equal(long[7].length, 16); assert.equal(long[8], null, 'a squawk that is not four octal digits is null');
  assert.equal(body.observed_at, new Date(NOW_MS).toISOString());
  for (const a of body.aircraft) { assert.equal(a.length, 10); assert.ok(a[3] >= -90 && a[3] <= 90 && a[2] >= -180 && a[2] <= 180); }
});

test('military: the row helper drops what is not drawable and caps at 4000', async () => {
  assert.equal(normalizeMilitaryAircraft({ hex: 'a', dbFlags: 4, alt_baro: 1, lat: 1, lon: 1 }), null);
  assert.equal(normalizeMilitaryAircraft({ hex: 'a', dbFlags: 8, alt_baro: 1, lat: 1, lon: 1 }), null);
  assert.equal(normalizeMilitaryAircraft({ hex: 'a', alt_baro: 'ground', lat: 1, lon: 1 }), null);
  assert.equal(normalizeMilitaryAircraft({ hex: 'a', alt_baro: 1, lat: 1, lon: 1, seen_pos: 61 }), null);
  assert.equal(normalizeMilitaryAircraft({ hex: 'a', alt_baro: 1, lat: 1, lon: 181 }), null);
  assert.equal(normalizeMilitaryAircraft({ hex: 'a', alt_baro: 1, lastPosition: { lat: 1, lon: 1 } }), null);
  assert.equal(normalizeMilitaryAircraft(null), null);
  assert.deepEqual(normalizeMilitaryAircraft({ hex: 'a', alt_baro: 1000, lat: 1, lon: 2, squawk: '7500', emergency: 'none' }), ['a', '', 2, 1, 304.8, null, null, null, '7500', true]);
  assert.equal(normalizeMilitaryAircraft({ hex: 'a', alt_baro: 1000, lat: 1, lon: 2, squawk: '7600' })[9], true);
  assert.equal(normalizeMilitaryAircraft({ hex: 'a', alt_baro: 1000, lat: 1, lon: 2, squawk: '1200', emergency: '' })[9], false);
  const many = { now: NOW_MS, ac: Array.from({ length: 4100 }, (_, i) => ({ hex: `h${i}`, alt_baro: 1000, lat: 1, lon: 1, dbFlags: 1 })) };
  const body = await (await handleHaloLayers(req('/v1/world/layers/military'), ENV, { fetchImpl: providerFor('military', { body: many }), cacheImpl: memoryCache() })).json();
  assert.equal(body.count, 4000); assert.equal(body.truncated, true); assert.equal(body.total, 4100);
  /* an answer without an aircraft list is a failure, not zero */
  const bad = await (await handleHaloLayers(req('/v1/world/layers/military'), ENV, { fetchImpl: providerFor('military', { body: { msg: 'error' } }), cacheImpl: memoryCache() })).json();
  assert.equal(bad.unavailable, true); assert.equal(bad.upstream_error, 'upstream_invalid_json');
});

/* ---------- quakes ---------- */
test('quakes: valid epicentres with an id, ISO time, provider links only, strings capped, alert values checked', async () => {
  const body = await (await handleHaloLayers(req('/v1/world/layers/quakes'), ENV, { fetchImpl: providerFor('quakes'), cacheImpl: memoryCache() })).json();
  assert.equal(body.attribution, 'U.S. Geological Survey, Earthquake Hazards Program'); assert.equal(body.license, 'Public domain (U.S. Government work)'); assert.equal(body.credit, 'Earthquakes: USGS');
  assert.deepEqual(body.quakes.map((q) => q.id), ['ci41350127', 'us7000abcd', 'weird'], 'no coordinates, longitude 200 and no id are dropped');
  assert.deepEqual(body.quakes[0], { id: 'ci41350127', mag: 2.52, place: '11 km NE of Kernville, CA', time: '2026-10-21T16:35:16.700Z', lon: -118.3573, lat: 35.8327, depth_km: 11.89, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/ci41350127', tsunami: false, alert: null });
  const big = body.quakes[1];
  assert.equal(big.mag, 6.1); assert.equal(big.place.length, 120); assert.equal(big.url, null, 'a link off the USGS host is dropped'); assert.equal(big.tsunami, true); assert.equal(big.alert, 'orange');
  const weird = body.quakes[2];
  assert.deepEqual([weird.mag, weird.alert, weird.time, weird.url, weird.depth_km, weird.lon, weird.lat], [null, null, null, null, null, 10.1235, -20.5]);
  assert.equal(normalizeQuake({ id: 'x', geometry: { coordinates: [0, 91] } }), null);
  const many = { metadata: {}, features: Array.from({ length: 2100 }, (_, i) => ({ id: `q${i}`, properties: { mag: 1 }, geometry: { coordinates: [1, 1, 1] } })) };
  const capped = await (await handleHaloLayers(req('/v1/world/layers/quakes'), ENV, { fetchImpl: providerFor('quakes', { body: many }), cacheImpl: memoryCache() })).json();
  assert.equal(capped.count, 2000); assert.equal(capped.quakes[0].id, 'q0', 'feed order kept (newest first)');
});

/* ---------- fires ---------- */
test('fires: without FIRMS_MAP_KEY the layer is not_configured and NASA is never asked', async () => {
  for (const env of [ENV, { ...ENV, FIRMS_MAP_KEY: '' }, { ...ENV, FIRMS_MAP_KEY: '   ' }]) {
    const fetchImpl = providerFor('fires'), cache = memoryCache();
    const r = await handleHaloLayers(req('/v1/world/layers/fires'), env, { fetchImpl, cacheImpl: cache });
    assert.equal(r.status, 200); headersOk(r);
    const body = await r.json();
    assert.deepEqual([body.ok, body.layer, body.unavailable, body.upstream_error, body.count, body.fires, body.stale], [true, 'fires', true, 'not_configured', 0, [], false]);
    assert.deepEqual(body.requires, ['FIRMS_MAP_KEY']);
    assert.equal(fetchImpl.calls.length, 0); assert.equal(cache.raw.size, 0);
  }
});

test('fires: both VIIRS sources, CSV read by header name as it streams, ISO acquisition, bad rows dropped, sorted by FRP', async () => {
  const fetchImpl = providerFor('fires'), cache = memoryCache();
  const body = await (await handleHaloLayers(req('/v1/world/layers/fires'), { ...ENV, FIRMS_MAP_KEY: FIRMS_KEY }, { fetchImpl, cacheImpl: cache })).json();
  assert.deepEqual(fetchImpl.calls.map((c) => new URL(c.url).pathname).sort(), [
    `/api/area/csv/${FIRMS_KEY}/VIIRS_NOAA20_NRT/world/1`, `/api/area/csv/${FIRMS_KEY}/VIIRS_SNPP_NRT/world/1`
  ]);
  assert.equal(body.attribution, 'NASA FIRMS, VIIRS 375 m near real-time (Suomi NPP and NOAA-20)'); assert.equal(body.credit, 'Fires: NASA FIRMS');
  assert.deepEqual(body.fires, [
    [-118.2, 34.1, 88.8, 'high', '2026-10-21T20:54:00.000Z', 'Suomi NPP', 'D'],
    [151.2, -33.9, 12.5, 'low', '2026-10-21T04:12:00.000Z', 'NOAA-20', 'D'],
    [23.4568, -12.3457, 5.2, 'nominal', '2026-10-21T01:30:00.000Z', 'Suomi NPP', 'N'],
    [2.5, 1.5, null, null, null, 'Suomi NPP', null]
  ], 'latitude 95 and the ragged row are dropped; nonsense values become null, never zero');
  assert.equal(body.count, 4); assert.equal(body.total, 4); assert.equal(body.partial, false);
  assert.deepEqual(body.sources.map((s) => [s.source, s.status]), [['VIIRS_SNPP_NRT', 'ok'], ['VIIRS_NOAA20_NRT', 'ok']]);
  assert.equal(JSON.stringify(body).includes(FIRMS_KEY), false, 'the key is never in an answer');
  assert.ok([...cache.raw.keys()].every((k) => !k.includes(FIRMS_KEY)), 'nor in a cache key');
});

test('fires: one source down is a partial answer; both down is unavailable with each source typed, and the key never appears', async () => {
  const half = workersFetch(async (url) => (url.pathname.includes('NOAA20') ? text('busy', 429) : streamed(FIRMS_SNPP)));
  const partial = await fetchFires({ FIRMS_MAP_KEY: FIRMS_KEY }, half);
  assert.equal(partial.partial, true); assert.equal(partial.count, 3, 'the Suomi NPP rows alone');
  assert.deepEqual(partial.sources[1], { source: 'VIIRS_NOAA20_NRT', status: 'failed', error: 'upstream_rate_limited', provider_status: 429 });
  /* FIRMS answers a bad key with a sentence, not a CSV */
  const badKey = workersFetch(async () => text('Invalid MAP_KEY.'));
  const r = await handleHaloLayers(req('/v1/world/layers/fires'), { ...ENV, FIRMS_MAP_KEY: FIRMS_KEY }, { fetchImpl: badKey, cacheImpl: memoryCache() });
  const raw = await r.text(), body = JSON.parse(raw);
  assert.equal(body.unavailable, true); assert.equal(body.upstream_error, 'upstream_invalid_csv');
  assert.deepEqual(body.providers.map((p) => [p.source, p.status, p.error]), [['VIIRS_SNPP_NRT', 'failed', 'upstream_invalid_csv'], ['VIIRS_NOAA20_NRT', 'failed', 'upstream_invalid_csv']]);
  assert.equal(raw.includes(FIRMS_KEY), false);
  for (const failing of [workersFetch(async () => { throw new TypeError(`fetch failed for https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_KEY}/x`); }), workersFetch(async () => text(`error for key ${FIRMS_KEY}`, 500))]) {
    const t = await (await handleHaloLayers(req('/v1/world/layers/fires'), { ...ENV, FIRMS_MAP_KEY: FIRMS_KEY }, { fetchImpl: failing, cacheImpl: memoryCache() })).text();
    assert.equal(t.includes(FIRMS_KEY), false, 'neither a thrown message nor a provider body can echo the key');
    assert.equal(JSON.parse(t).unavailable, true);
  }
});

test('fires: over 25000 rows the lowest FRP goes first; the stream is parsed across chunk boundaries', async () => {
  const lines = [FIRMS_HEADER];
  for (let i = 0; i < 26000; i += 1) lines.push(`${(i % 170) - 85}.5,${(i % 350) - 175}.25,330,0.4,0.4,2026-10-21,0130,N,VIIRS,n,2.0NRT,290,${(i / 10).toFixed(1)},D`);
  const csv = lines.join('\n');
  const fetchImpl = workersFetch(async (url) => (url.pathname.includes('NOAA20') ? streamed(FIRMS_HEADER + '\n') : streamed(csv, 4096)));
  const body = await fetchFires({ FIRMS_MAP_KEY: FIRMS_KEY }, fetchImpl);
  assert.equal(body.count, 25000); assert.equal(body.total, 26000); assert.equal(body.truncated, true);
  assert.equal(body.fires[0][2], 2599.9, 'the strongest fire first');
  assert.equal(Math.min(...body.fires.map((f) => f[2])), 100, 'the 1000 weakest are the ones dropped');
  const small = await parseFirmsCsv(streamed(FIRMS_SNPP, 3), 'Suomi NPP', 2);
  assert.deepEqual(small.rows.map((r) => r[2]), [88.8, 5.2]); assert.equal(small.total, 3);
  await assert.rejects(() => parseFirmsCsv(streamed(''), 'x'), (e) => e.code === 'upstream_invalid_csv');
});

/* ---------- perimeters ---------- */
test('perimeters: NIFC WFIGS asked for simplified GeoJSON, largest first; rings rounded, cleaned, closed; strings and numbers checked', async () => {
  const fetchImpl = providerFor('perimeters');
  const body = await (await handleHaloLayers(req('/v1/world/layers/perimeters'), ENV, { fetchImpl, cacheImpl: memoryCache() })).json();
  const asked = new URL(fetchImpl.calls[0].url);
  assert.equal(`${asked.origin}${asked.pathname}`, NIFC_PERIMETERS_URL);
  assert.equal(asked.hostname, 'services3.arcgis.com');
  assert.deepEqual(Object.fromEntries(asked.searchParams), {
    where: '1=1', outFields: 'poly_IncidentName,attr_UniqueFireIdentifier,attr_IncidentSize,attr_PercentContained,attr_FireDiscoveryDateTime',
    returnGeometry: 'true', outSR: '4326', maxAllowableOffset: '0.005', geometryPrecision: '4', orderByFields: 'attr_IncidentSize DESC', resultRecordCount: '400', f: 'geojson'
  });
  assert.equal(perimetersQuery(), fetchImpl.calls[0].url);
  assert.equal(body.attribution, 'National Interagency Fire Center, WFIGS Interagency Fire Perimeters (current)'); assert.equal(body.credit, 'Wildfire perimeters: NIFC WFIGS');
  assert.equal(body.count, 2, 'no geometry, a degenerate ring and a point are dropped');
  assert.deepEqual(body.perimeters[0], {
    id: '2026-WAOWF-260406', name: 'Little Giant', acres: 172912, contained_pct: 95, discovered: '2026-07-16T01:17:54.000Z',
    rings: [[[-120.5953, 47.8337], [-120.5945, 47.833], [-120.5942, 47.8327], [-120.5953, 47.8337]], [[-120.75, 47.88], [-120.74, 47.89], [-120.73, 47.88], [-120.75, 47.88]]]
  }, 'a MultiPolygon lists its rings together; a repeated point is dropped; an open ring is closed');
  const second = body.perimeters[1];
  assert.equal(second.id, 'perimeter-1'); assert.equal(second.name.length, 120); assert.equal(second.acres, null); assert.equal(second.contained_pct, null); assert.equal(second.discovered, null);
  assert.deepEqual(second.rings, [[[-110, 40], [-109, 40], [-109, 41], [-110, 40]]], 'invalid points are dropped from the ring');
});

test('perimeters: 2000 points a ring at most (thinned evenly, still closed), 400 perimeters, and an ArcGIS error body is a failure', async () => {
  const big = Array.from({ length: 5000 }, (_, i) => [-100 + Math.cos(i / 800) / 10, 40 + Math.sin(i / 800) / 10]);
  const r = normalizeRing(big);
  assert.equal(r.length, 2000); assert.deepEqual(r[0], r[1999]); assert.deepEqual(r[0], [-99.9, 40]);
  assert.equal(normalizeRing([[0, 0], [1, 1]]), null); assert.equal(normalizeRing('nope'), null);
  const many = { features: Array.from({ length: 450 }, (_, i) => ({ properties: { attr_UniqueFireIdentifier: `f${i}`, poly_IncidentName: `Fire ${i}` }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } })) };
  const capped = await (await handleHaloLayers(req('/v1/world/layers/perimeters'), ENV, { fetchImpl: providerFor('perimeters', { body: many }), cacheImpl: memoryCache() })).json();
  assert.equal(capped.count, 400); assert.equal(capped.perimeters[0].id, 'f0');
  const arcgisError = await (await handleHaloLayers(req('/v1/world/layers/perimeters'), ENV, { fetchImpl: providerFor('perimeters', { body: { error: { code: 400, message: 'Invalid field' } } }), cacheImpl: memoryCache() })).json();
  assert.equal(arcgisError.unavailable, true); assert.equal(arcgisError.upstream_error, 'upstream_http'); assert.deepEqual(arcgisError.perimeters, []);
});

/* ---------- cyclones ---------- */
test('cyclones: NHC storms with knots, millibars, a checked advisory link, and movement converted from mph to knots', async () => {
  const body = await (await handleHaloLayers(req('/v1/world/layers/cyclones'), ENV, { fetchImpl: providerFor('cyclones'), cacheImpl: memoryCache() })).json();
  assert.equal(body.attribution, 'NOAA National Hurricane Center'); assert.equal(body.credit, 'Tropical cyclones: NOAA NHC');
  assert.deepEqual(body.cyclones[0], { id: 'ep222026', name: 'Twenty-Two-E', classification: 'TD', intensity_kt: 30, pressure_mb: 1005, lat: 9.5, lon: -99.3, movement_dir: 265, movement_kt: 6, basin: 'EP', advisory_url: 'https://www.nhc.noaa.gov/text/MIATCPEP2.shtml' });
  assert.deepEqual(body.cyclones[1], { id: 'al142026', name: 'Milton', classification: 'HU', intensity_kt: 140, pressure_mb: 905, lat: 22.1, lon: -88.4, movement_dir: 90, movement_kt: 8, basin: 'AL', advisory_url: null }, 'the hemisphere strings are read when the numbers are missing; a link off NHC is dropped');
  assert.equal(body.count, 2, 'a bad id, no position and latitude 95 are dropped');
  assert.equal(normalizeCyclone({ id: 'cp022026', classification: '<script>', intensity: 'strong', pressure: 50, latitudeNumeric: 20, longitudeNumeric: -150 }).classification, null);
});

test('cyclones: no active storm is a valid, empty answer, not unavailable', async () => {
  const body = await (await handleHaloLayers(req('/v1/world/layers/cyclones'), ENV, { fetchImpl: providerFor('cyclones', { body: { activeStorms: [] } }), cacheImpl: memoryCache() })).json();
  assert.equal(body.ok, true); assert.equal(body.unavailable, undefined); assert.equal(body.count, 0); assert.deepEqual(body.cyclones, []);
  const bad = await (await handleHaloLayers(req('/v1/world/layers/cyclones'), ENV, { fetchImpl: providerFor('cyclones', { body: { storms: 'none' } }), cacheImpl: memoryCache() })).json();
  assert.equal(bad.unavailable, true); assert.equal(bad.upstream_error, 'upstream_invalid_json');
});

/* ---------- vessels ---------- */
function aisBinding(snapshot, { status = 200, throwIt = false } = {}) {
  const asked = [];
  return {
    asked,
    idFromName(name) { asked.push({ name }); return { name }; },
    get(id) {
      return { async fetch(request) { asked.push({ id: id.name, url: request.url, method: request.method }); if (throwIt) throw new Error('DO reset'); return status === 200 ? json(snapshot) : json({ error: 'x' }, status); } };
    }
  };
}
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const AIS = { configured: true, status: 'open', stale: false, last_message_at: iso(5000), cached_vessels: 9, returned: 8, rows: [
  { mmsi: '366999999', ship_name: 'EVER GIVEN@@@@', latitude: 40.70001, longitude: -74.01234567, sog: 12.34, cog: 181.26, heading: 180, nav_status: '0', updated_at: iso(10000) },
  { mmsi: '235000000', ship_name: '@@@@@@', latitude: 51.5, longitude: 0.1, sog: 102.3, cog: 360, heading: 511, nav_status: '15', updated_at: iso(20000) },
  { mmsi: 'abc', ship_name: 'BAD MMSI', latitude: 1, longitude: 1, updated_at: iso(1000) },
  { mmsi: '0', ship_name: 'ZERO', latitude: 1, longitude: 1, updated_at: iso(1000) },
  { mmsi: '211111111', ship_name: 'NO POSITION', latitude: null, longitude: null, updated_at: iso(1000) },
  { mmsi: '211111112', ship_name: 'OFF THE MAP', latitude: 1, longitude: 190, updated_at: iso(1000) },
  { mmsi: '211111113', ship_name: 'TWO HOURS OLD', latitude: 1, longitude: 1, updated_at: iso(2 * 3600e3) },
  { mmsi: 211111114, ship_name: 'N'.repeat(300), latitude: -10, longitude: 20, sog: -1, cog: 'x', heading: 400, nav_status: '7', updated_at: iso(1000) }
] };

test('vessels: read from the AIS Durable Object instance the spatial console uses; AIS "not available" values are null; bad rows dropped', async () => {
  const binding = aisBinding(AIS);
  const fetchImpl = workersFetch(async () => { throw new Error('no provider: the Durable Object is the cache'); });
  const r = await handleHaloLayers(req('/v1/world/layers/vessels'), { ...ENV, AISSTREAM_API_KEY: 'ais-key', HereTenantAgent: binding }, { fetchImpl, cacheImpl: memoryCache() });
  assert.equal(r.status, 200); headersOk(r);
  const body = await r.json();
  assert.equal(AIS_INSTANCE, 'seek-first:ais:mccluster');
  assert.deepEqual(binding.asked[0], { name: 'seek-first:ais:mccluster' });
  const call = new URL(binding.asked[1].url);
  assert.equal(call.pathname, '/internal/seek-first/ais/snapshot'); assert.equal(call.searchParams.get('limit'), '8000'); assert.equal(binding.asked[1].method, 'GET');
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(body.attribution, 'AISStream.io'); assert.equal(body.credit, 'Ships: AISStream.io'); assert.equal(body.status, 'open'); assert.equal(body.stale, false);
  assert.deepEqual(body.vessels, [
    ['366999999', 'EVER GIVEN', -74.0123, 40.7, 12.3, 181.3, 180, 0],
    ['235000000', null, 0.1, 51.5, null, null, null, null],
    ['211111114', 'N'.repeat(120), 20, -10, null, null, null, 7]
  ]);
  assert.equal(body.count, 3);
  assert.equal(JSON.stringify(body).includes('ais-key'), false);
  assert.equal(normalizeVessel({ mmsi: '1', latitude: 1, longitude: 1, updated_at: 'garbage' })[0], '1', 'an unreadable time is not a reason to drop a position');
});

test('vessels: no binding or no AISSTREAM_API_KEY is not_configured and the Durable Object is never asked', async () => {
  const binding = aisBinding(AIS);
  for (const env of [{ ...ENV, HereTenantAgent: binding }, { ...ENV, AISSTREAM_API_KEY: 'k' }, { ...ENV, AISSTREAM_API_KEY: 'k', HereTenantAgent: {} }]) {
    const r = await handleHaloLayers(req('/v1/world/layers/vessels'), env);
    headersOk(r);
    const body = await r.json();
    assert.deepEqual([body.ok, body.unavailable, body.upstream_error, body.count, body.vessels], [true, true, 'not_configured', 0, []]);
    assert.deepEqual(body.requires, ['AISSTREAM_API_KEY', 'HereTenantAgent']);
  }
  assert.equal(binding.asked.length, 0);
});

test('vessels: a failed Durable Object read or a failed stream with nothing kept is unavailable; a stale stream with rows still draws them', async () => {
  const env = (b) => ({ ...ENV, AISSTREAM_API_KEY: 'k', HereTenantAgent: b });
  for (const b of [aisBinding(AIS, { status: 500 }), aisBinding(AIS, { throwIt: true }), aisBinding({ nope: true })]) {
    const body = await (await handleHaloLayers(req('/v1/world/layers/vessels'), env(b))).json();
    assert.equal(body.unavailable, true); assert.equal(body.upstream_error, 'ais_cache_error'); assert.deepEqual(body.vessels, []);
  }
  const failed = await (await handleHaloLayers(req('/v1/world/layers/vessels'), env(aisBinding({ ...AIS, status: 'auth-failed', rows: [] })))).json();
  assert.equal(failed.unavailable, true); assert.equal(failed.upstream_error, 'aisstream_auth_failed');
  const warming = await (await handleHaloLayers(req('/v1/world/layers/vessels'), env(aisBinding({ ...AIS, status: 'connecting', rows: [] })))).json();
  assert.equal(warming.unavailable, undefined, 'a stream that is connecting is empty, not unavailable'); assert.equal(warming.status, 'connecting');
  const stale = await (await handleHaloLayers(req('/v1/world/layers/vessels'), env(aisBinding({ ...AIS, status: 'stale', stale: true })))).json();
  assert.equal(stale.stale, true); assert.equal(stale.count, 3);
});

test('vessels: capped at 8000, freshest first as the Durable Object orders them', async () => {
  const rows = Array.from({ length: 8100 }, (_, i) => ({ mmsi: String(100000000 + i), latitude: 1, longitude: 1, updated_at: iso(i) }));
  const body = await (await handleHaloLayers(req('/v1/world/layers/vessels'), { ...ENV, AISSTREAM_API_KEY: 'k', HereTenantAgent: aisBinding({ ...AIS, rows }) })).json();
  assert.equal(body.count, 8000); assert.equal(body.vessels[0][0], '100000000');
});

/* ---------- place search ---------- */
const PHOTON = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { osm_key: 'place', osm_value: 'city', type: 'city', name: 'New Haven', county: 'South Central Connecticut Planning Region', state: 'Connecticut', country: 'United States', extent: [-72.9980695, 41.3505968, -72.8608112, 41.2464253] }, geometry: { type: 'Point', coordinates: [-72.9250518, 41.3082138] } },
  { type: 'Feature', properties: { osm_value: 'village', name: 'New Haven', state: 'Michigan', country: 'United States' }, geometry: { type: 'Point', coordinates: [-84.1533058, 43.0936376] } },
  { type: 'Feature', properties: { name: 'Nowhere' }, geometry: { type: 'Point', coordinates: [500, 1] } },
  { type: 'Feature', properties: { osm_value: '<b>bad</b>', name: 'X'.repeat(300), extent: [1, 'x', 2, 3] }, geometry: { type: 'Point', coordinates: [1, 2] } },
  ...Array.from({ length: 6 }, (_, i) => ({ type: 'Feature', properties: { name: `Extra ${i}` }, geometry: { type: 'Point', coordinates: [i, i] } }))
] };
const NOMINATIM = [{ place_id: 1, lat: '41.3082138', lon: '-72.9250518', category: 'boundary', type: 'administrative', addresstype: 'city', name: 'New Haven', display_name: 'New Haven, South Central Connecticut Planning Region, Connecticut, United States', boundingbox: ['41.2464253', '41.3505968', '-72.9980695', '-72.8608112'] }];

function geo({ photon = 'ok', nominatim = 'ok' } = {}) {
  return workersFetch(async (url) => {
    if (url.hostname === 'photon.komoot.io') return photon === 'ok' ? json(PHOTON) : photon === 'bad' ? json({ nope: 1 }) : text('down', 503);
    if (url.hostname === 'nominatim.openstreetmap.org') return nominatim === 'ok' ? json(NOMINATIM) : text('slow down', 429);
    throw new Error('unexpected ' + url);
  });
}
const gq = (q) => req(`/v1/world/geocode${q === undefined ? '' : `?q=${encodeURIComponent(q)}`}`);

test('geocode: q is trimmed and must be 2 to 120 characters, else 400 with no provider call', async () => {
  const fetchImpl = geo();
  for (const q of [undefined, '', ' ', 'a', '  b  ', 'x'.repeat(121), '\u0000\u0001']) {
    const r = await handleWorldGeocode(gq(q), ENV, { fetchImpl, cacheImpl: memoryCache() });
    assert.equal(r.status, 400, JSON.stringify(q)); headersOk(r);
    const body = await r.json();
    assert.equal(body.ok, false); assert.equal(body.code, 'invalid_query');
  }
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(normalizeGeocodeQuery('  New \n  Haven  '), 'New Haven');
  assert.equal(normalizeGeocodeQuery('x'.repeat(120)), 'x'.repeat(120));
  assert.equal((await handleWorldGeocode(req('/v1/world/geocode?q=ab', { method: 'POST' }), ENV)).status, 405);
});

test('geocode: Photon answers, at most six results, bbox as [w,s,e,n], names capped, bad coordinates dropped', async () => {
  const fetchImpl = geo();
  const r = await handleWorldGeocode(gq('  New   Haven '), ENV, { fetchImpl, cacheImpl: memoryCache() });
  assert.equal(r.status, 200); headersOk(r);
  const body = await r.json();
  assert.equal(body.ok, true); assert.equal(body.query, 'New Haven'); assert.equal(body.provider, 'photon');
  assert.equal(body.license, 'ODbL-1.0'); assert.match(body.attribution, /OpenStreetMap contributors/);
  assert.equal(body.results.length, 6);
  assert.deepEqual(body.results[0], { name: 'New Haven, Connecticut, United States', kind: 'city', lon: -72.92505, lat: 41.30821, bbox: [-72.99807, 41.24643, -72.86081, 41.3506] });
  assert.deepEqual(body.results[1], { name: 'New Haven, Michigan, United States', kind: 'village', lon: -84.15331, lat: 43.09364, bbox: null });
  assert.equal(body.results[2].name.length, 120); assert.equal(body.results[2].kind, null); assert.equal(body.results[2].bbox, null);
  assert.ok(!body.results.some((x) => x.name === 'Nowhere'));
  const asked = new URL(fetchImpl.calls[0].url);
  assert.equal(asked.origin + asked.pathname, 'https://photon.komoot.io/api/');
  assert.equal(asked.searchParams.get('q'), 'New Haven'); assert.equal(asked.searchParams.get('limit'), '6');
  assert.equal(fetchImpl.calls.length, 1, 'Nominatim is not asked when Photon answers');
  assert.equal(fetchImpl.calls[0].init.redirect, 'manual');
});

test('geocode: only when Photon fails is Nominatim asked, with an identifying User-Agent; both failing is unavailable and not kept', async () => {
  for (const photon of ['down', 'bad']) {
    const fetchImpl = geo({ photon });
    const body = await (await handleWorldGeocode(gq('New Haven'), ENV, { fetchImpl, cacheImpl: memoryCache() })).json();
    assert.equal(body.provider, 'nominatim', photon);
    assert.deepEqual(body.results, [{ name: 'New Haven, South Central Connecticut Planning Region, Connecticut, United States', kind: 'city', lon: -72.92505, lat: 41.30821, bbox: [-72.99807, 41.24643, -72.86081, 41.3506] }]);
    assert.match(body.attribution, /Nominatim/);
    assert.deepEqual(body.providers.map((p) => [p.provider, p.status]), [['photon', 'failed'], ['nominatim', 'ok']]);
    const nom = fetchImpl.calls.find((c) => c.url.startsWith('https://nominatim.openstreetmap.org/search?'));
    const u = new URL(nom.url);
    assert.deepEqual([u.searchParams.get('format'), u.searchParams.get('limit'), u.searchParams.get('q')], ['jsonv2', '6', 'New Haven']);
    assert.match(nom.init.headers['user-agent'], /^McCluster-World\/1\.0 \(\+https:\/\/mccluster\.org/);
    assert.equal(nom.init.redirect, 'manual');
  }
  const cache = memoryCache();
  const r = await handleWorldGeocode(gq('New Haven'), ENV, { fetchImpl: geo({ photon: 'down', nominatim: 'down' }), cacheImpl: cache });
  assert.equal(r.status, 200); headersOk(r);
  const body = await r.json();
  assert.deepEqual([body.ok, body.unavailable, body.upstream_error, body.results], [true, true, 'upstream_rate_limited', []]);
  assert.deepEqual(body.providers.map((p) => [p.provider, p.error]), [['photon', 'upstream_http'], ['nominatim', 'upstream_rate_limited']]);
  assert.equal(cache.raw.size, 0, 'a failure is never kept');
});

test('geocode: each normalized query is kept 24 h; the same place asked differently asks nobody', async () => {
  const fetchImpl = geo(), cache = memoryCache();
  await handleWorldGeocode(gq('New Haven'), ENV, { fetchImpl, cacheImpl: cache });
  assert.equal(cache.raw.size, 1);
  const again = await (await handleWorldGeocode(gq('  new   HAVEN '), ENV, { fetchImpl, cacheImpl: cache })).json();
  assert.equal(fetchImpl.calls.length, 1, 'the kept answer is served');
  assert.equal(again.query, 'new HAVEN'); assert.equal(again.results.length, 6);
  age(cache, 23 * 3600);
  await handleWorldGeocode(gq('New Haven'), ENV, { fetchImpl, cacheImpl: cache });
  assert.equal(fetchImpl.calls.length, 1);
  age(cache, 2 * 3600);
  await handleWorldGeocode(gq('New Haven'), ENV, { fetchImpl, cacheImpl: cache });
  assert.equal(fetchImpl.calls.length, 2, 'past 24 h the provider is asked again');
});

/* ---------- the source keeps its promises ---------- */
test('every provider fetch goes through the safe fetch; no credential in a log; each layer states its upstream and terms', async () => {
  const src = await readFile(new URL('../src/world-halo-layers.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(code, /\bfetchImpl\(/, 'providers are only reached through upstream() (fetchNoCrossHostRedirect)');
  assert.doesNotMatch(code, /redirect:\s*['"](error|follow)['"]/);
  assert.doesNotMatch(code, /console\.|logEvent/);
  assert.match(src, /import \{ cachedLayer, normalizeAdsbAircraft, upstream \} from '\.\/world-layers\.js';/);
  for (const needle of ['api.adsb.lol/v2/mil', 'ODbL', 'earthquake.usgs.gov', 'public', 'firms.modaps.eosdis.nasa.gov', 'FIRMS_MAP_KEY', 'WFIGS', 'CurrentStorms.json', 'AISStream.io', 'photon.komoot.io', 'nominatim.openstreetmap.org', 'Dropped']) assert.ok(src.includes(needle), needle);
  const index = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const guard = index.indexOf('await guardWorldRelease(request, env)');
  assert.ok(guard > 0 && index.indexOf('await handleHaloLayers(request, env)') > guard && index.indexOf('await handleWorldGeocode(request, env)') > guard, 'both dispatch after the release guard');
  assert.match(index, /import \{ handleHaloLayers, handleWorldGeocode, WORLD_GEOCODE_PATH \} from '\.\/world-halo-layers\.js';/);
});
