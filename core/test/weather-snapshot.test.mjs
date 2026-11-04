import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { readFile } from 'node:fs/promises';

import { GRID, REGION, USER_AGENT, FEED_KEYS, SNAPSHOT_SCHEMA } from '../src/weather/region.mjs';
import {
  aggregateToGrid, decodeRate, encodeRate, fromBase64, normalizeAlerts, normalizeForecast, normalizeObservation,
  normalizePredictions, normalizeWaterLevel,
} from '../src/weather/fields.mjs';
import { decodeWindow, describe, encodeGrib2Png } from '../src/weather/grib2.mjs';
import { OUTSIDE, beamHeightM, decodeLevel3, levelValue, rangeBearing, resampleToGrid } from '../src/weather/nexrad-level3.mjs';
import { buildSnapshot, ingestRegion, mergeWithPrevious, parseListing, withAges, CARRY_LIMIT_S } from '../src/weather/ingest.mjs';
import { FIXTURE_DIR, fixtureFetch, fixtureManifest, fixtureNow } from '../src/weather/fixture-fetch.mjs';
import { weatherRegionSnapshot, JOB_TYPE } from '../src/executors/weather-region-snapshot.mjs';
import { ingestEnabled, keepHours } from '../src/seed-weather-snapshot.mjs';

const NOW = new Date(fixtureNow());
const manifest = fixtureManifest();
const fixture = (name) => fs.readFileSync(path.join(FIXTURE_DIR, name));
const fixtureJson = (feed) => JSON.parse(fixture(manifest.json[feed]).toString('utf8'));
const radarFile = (product) => Object.entries(manifest.objects['unidata-nexrad-level3']).find(([k]) => k.includes(`_${product}_`))[1];

/* ---------- GRIB2 / MRMS ---------- */

test('GRIB2 PNG packing round-trips through the reader, cropped to a window', () => {
  const ni = 6, nj = 4, values = [];
  for (let k = 0; k < ni * nj; k += 1) values.push(k % 5 === 0 ? -3 : k / 4);
  const grib = encodeGrib2Png({ referenceTime: '2026-11-03T15:00:00Z', category: 6, number: 1, west: -73.755, north: 42.075, di: 0.01, dj: 0.01, ni, nj, values, decimalScale: 1, reference: -999 });
  const meta = describe(grib);
  assert.equal(meta.discipline, 209);
  assert.deepEqual(meta.parameter, { category: 6, number: 1, product_template: 0 });
  assert.equal(meta.reference_time, '2026-11-03T15:00:00.000Z');
  assert.equal(meta.packing.template, 41);
  const full = decodeWindow(grib, { west: -74, south: 41, east: -73, north: 43 });
  assert.equal(full.window.ni, ni); assert.equal(full.window.nj, nj);
  full.values.forEach((v, k) => assert.ok(Math.abs(v - Math.round(values[k] * 10) / 10) < 1e-4, `value ${k}`));
  const crop = decodeWindow(grib, { west: -73.746, south: 42.044, east: -73.724, north: 42.066 });
  assert.equal(crop.window.ni, 3); assert.equal(crop.window.nj, 3);
  assert.ok(Math.abs(crop.values[0] - values[1 * ni + 1]) < 0.06);
  assert.ok(Math.abs(crop.window.west - -73.745) < 1e-9 && Math.abs(crop.window.north - 42.065) < 1e-9);
});

test('the recorded MRMS crop is PrecipRate on the native 0.01 degree grid', () => {
  const key = Object.keys(manifest.objects['noaa-mrms-pds'])[0];
  const grib = zlib.gunzipSync(fixture(manifest.objects['noaa-mrms-pds'][key]));
  const meta = describe(grib);
  assert.equal(meta.discipline, 209);
  assert.equal(meta.parameter.category, 6);
  assert.equal(meta.parameter.number, 1);
  assert.equal(meta.grid.di, 0.01);
  const { window, values } = decodeWindow(grib, GRID);
  assert.equal(window.ni, 200); assert.equal(window.nj, 112);
  for (const v of values) assert.ok(v >= -3 && v < 500, `plausible rate ${v}`);
});

test('the rain-rate codec keeps 0.1 mm/h steps to 20 mm/h, saturates at 126, and reserves 254/255', () => {
  assert.equal(encodeRate(0), 0);
  assert.equal(decodeRate(encodeRate(0.04)), 0.1); // any rain is at least one step, never rounded to dry
  assert.equal(decodeRate(encodeRate(3.27)), 3.3);
  assert.equal(decodeRate(encodeRate(42)), 42);
  assert.equal(encodeRate(999), 253);
  assert.equal(encodeRate(-3), 254);
  assert.equal(decodeRate(254), null);
  assert.equal(decodeRate(255), null);
});

test('aggregation averages the native cells inside each region cell and keeps no-coverage apart', () => {
  const grid = { west: 0, north: 1, dlon: 0.02, dlat: 0.02, nx: 2, ny: 1 };
  const window = { west: 0.005, north: 0.995, di: 0.01, dj: 0.01, ni: 4, nj: 2 };
  // cell 0: 2, 4, 0, 2 -> mean 2 ; cell 1: all no coverage
  const values = Float32Array.from([2, 4, -3, -3, 0, 2, -3, -1]);
  const { codes, stats } = aggregateToGrid(window, values, grid);
  assert.equal(decodeRate(codes[0]), 2);
  assert.equal(codes[1], 254);
  assert.equal(stats.covered_cells, 1);
  assert.equal(stats.max_native_mmh, 4);
});

/* ---------- NEXRAD Level III ---------- */

test('KOKX N0B and N0G decode: header, 0.25 km gates, level codes, radar position', async () => {
  for (const product of ['N0B', 'N0G']) {
    const d = await decodeLevel3(fixture(radarFile(product)));
    assert.equal(d.header.code, product);
    assert.equal(d.header.product, product === 'N0B' ? 153 : 154);
    assert.equal(d.header.radar.lat, 40.865);
    assert.equal(d.header.radar.lon, -72.864);
    assert.equal(d.header.elevation_deg, 0.5);
    assert.equal(d.km_per_bin, 0.25);
    assert.equal(d.radials.length, 720);
    assert.equal(d.nBins, product === 'N0B' ? 1840 : 1200);
    assert.equal(d.header.thresholds.increment, 0.5);
    assert.equal(d.header.units, product === 'N0B' ? 'dBZ' : 'm/s');
    assert.equal(levelValue(0, d.header.thresholds), null);
    assert.equal(levelValue(1, d.header.thresholds), null);
    assert.equal(levelValue(2, d.header.thresholds), d.header.thresholds.min);
    const codes = resampleToGrid(d, GRID);
    assert.equal(codes.length, GRID.nx * GRID.ny);
    assert.ok(codes.some((c) => c !== OUTSIDE), 'Connecticut is inside the scan');
  }
});

test('radar geometry: Bridgeport is about 44 km from KOKX, with the 0.5 degree beam about 0.5 km up', () => {
  const rb = rangeBearing(40.865, -72.864, REGION.focus.lat, REGION.focus.lon);
  assert.ok(rb.km > 43 && rb.km < 44.5, String(rb.km));
  assert.ok(rb.deg > 315 && rb.deg < 328, String(rb.deg));
  const h = beamHeightM(rb.km, 0.5);
  assert.ok(h > 450 && h < 550, String(h));
  assert.ok(beamHeightM(200, 0.5) > 3000, 'the beam rises with range');
});

/* ---------- normalizers ---------- */

test('NWS observation: each value keeps its unit and QC; rejected values are withheld, not shown', () => {
  const json = fixtureJson('observation');
  const rec = normalizeObservation(json, { now: NOW, url: REGION.feeds.observation.url });
  assert.equal(rec.data_kind, 'observation');
  assert.equal(rec.observed_at, new Date(json.properties.timestamp).toISOString());
  assert.equal(rec.units.temperature, 'degC');
  assert.equal(rec.payload.station, 'KBDR');
  const bad = structuredClone(json);
  bad.properties.temperature = { unitCode: 'wmoUnit:degC', value: 99, qualityControl: 'X' };
  const r2 = normalizeObservation(bad, { now: NOW });
  assert.equal(r2.payload.values.temperature, null);
  assert.ok(r2.quality_flags.includes('temperature_withheld_qc_rejected'));
  assert.throws(() => normalizeObservation({ properties: {} }, { now: NOW }), /timestamp/);
});

test('NWS hourly forecast: issued at updateTime (never the response time), past hours dropped, wind parsed', () => {
  const json = fixtureJson('forecast_hourly');
  const rec = normalizeForecast(json, { now: NOW });
  assert.equal(rec.data_kind, 'forecast');
  assert.equal(rec.issued_at, new Date(json.properties.updateTime).toISOString());
  assert.notEqual(rec.issued_at, new Date(json.properties.generatedAt).toISOString());
  assert.ok(rec.payload.periods.length > 0 && rec.payload.periods.length <= 24);
  for (const p of rec.payload.periods) assert.ok(Date.parse(p.end) > NOW.getTime());
  const later = normalizeForecast(json, { now: new Date(NOW.getTime() + 6 * 3_600_000) });
  assert.ok(later.payload.periods.length < rec.payload.periods.length);
  const w = structuredClone(json);
  w.properties.periods[1].windSpeed = '5 to 15 mph';
  const r3 = normalizeForecast(w, { now: new Date(w.properties.periods[1].startTime) });
  assert.equal(r3.payload.periods[0].wind_speed_ms, 6.7);
});

test('NWS alerts: none active is a fresh answer; an alert keeps its official text and only weather.gov links (synthetic sample)', () => {
  const none = normalizeAlerts(fixtureJson('alerts'), { now: NOW });
  assert.equal(none.status, 'ok');
  assert.equal(none.payload.count, 0);
  // SYNTHETIC test input, shaped like api.weather.gov; not a real alert
  const sample = { updated: '2026-11-03T15:00:00Z', features: [
    { id: 'https://api.weather.gov/alerts/urn:oid:test.1', properties: { id: 'urn:oid:test.1', event: 'Coastal Flood Advisory', severity: 'Minor', urgency: 'Expected', certainty: 'Likely', headline: 'Coastal Flood Advisory issued (test)', sent: '2026-11-03T14:00:00Z', expires: '2026-11-03T22:00:00Z', areaDesc: 'Southern Fairfield' } },
    { id: 'https://evil.example/alert', properties: { event: 'Fake\u0007Warning' } },
  ] };
  const rec = normalizeAlerts(sample, { now: NOW });
  assert.equal(rec.data_kind, 'alert');
  assert.equal(rec.payload.count, 2);
  assert.equal(rec.payload.alerts[0].link, 'https://api.weather.gov/alerts/urn:oid:test.1');
  assert.equal(rec.payload.alerts[1].link, null);
  assert.equal(rec.payload.alerts[1].event, 'Fake Warning');
});

test('CO-OPS: water level in NAVD88 with preliminary flagged; predictions are forecasts; provider errors throw', () => {
  const wl = normalizeWaterLevel(fixtureJson('water_level'), { now: NOW });
  assert.equal(wl.vertical_datum, 'NAVD88');
  assert.equal(wl.units.water_level, 'm');
  assert.ok(wl.quality_flags.includes('preliminary'));
  assert.ok(Number.isFinite(wl.payload.water_level));
  const pr = normalizePredictions(fixtureJson('tide_predictions'), { now: NOW });
  assert.equal(pr.data_kind, 'forecast');
  assert.ok(pr.payload.events.every((e) => e.type === 'high' || e.type === 'low'));
  assert.throws(() => normalizeWaterLevel({ error: { message: 'No data was found' } }, { now: NOW }), /No data/);
});

/* ---------- the region, once ---------- */

test('one run calls each upstream once, with the generic User-Agent, and returns all eight feeds', async () => {
  const calls = [];
  const inner = fixtureFetch({ calls });
  const agents = new Set();
  const fetchImpl = (url, init) => { agents.add(init?.headers?.['user-agent']); assert.equal(init?.redirect, 'manual'); return inner(url, init); };
  const { records, receipts } = await ingestRegion({ now: NOW, fetchImpl });
  assert.deepEqual(Object.keys(records).sort(), [...FEED_KEYS].sort());
  for (const key of FEED_KEYS) assert.equal(records[key].status, 'ok', `${key}: ${JSON.stringify(receipts.find((r) => r.feed === key))}`);
  assert.deepEqual([...agents], [USER_AGENT]);
  assert.doesNotMatch(USER_AGENT, /@/, 'no personal email in the User-Agent');
  assert.equal(new Set(calls).size, calls.length, 'no URL fetched twice');
  assert.equal(calls.length, 5 + 2 + 2 * 2, 'five JSON feeds, MRMS list+get, two radar list+get');
});

test('radial velocity is labelled relative to KOKX and never as a wind vector', async () => {
  const { records } = await ingestRegion({ now: NOW, fetchImpl: fixtureFetch(), only: ['radar_velocity', 'radar_reflectivity'] });
  const v = records.radar_velocity;
  assert.ok(v.quality_flags.includes('relative_to_radar'));
  assert.ok(v.quality_flags.includes('radial_component_only'));
  assert.equal(v.payload.radar.id, 'KOKX');
  assert.match(v.payload.meaning, /not a wind vector/);
  assert.equal(v.payload.lut.code1, 'range_folded');
  assert.equal(fromBase64(v.payload.data).length, GRID.nx * GRID.ny);
  assert.ok(records.radar_reflectivity.quality_flags.includes('returns_not_rainfall'));
  assert.ok(v.payload.focus.range_km > 43 && v.payload.focus.range_km < 44.5);
});

test('a missing feed degrades alone: the others stay fresh and nothing is invented', async () => {
  const { records, receipts } = await ingestRegion({ now: NOW, fetchImpl: fixtureFetch({ fail: { rain_now: 503, observation: 500 } }) });
  assert.equal(records.rain_now.status, 'missing');
  assert.equal(records.rain_now.payload, null);
  assert.equal(records.rain_now.data_kind, null);
  assert.equal(records.observation.missing_reason, 'http_500');
  assert.equal(records.forecast_hourly.status, 'ok');
  assert.equal(records.radar_velocity.status, 'ok');
  assert.equal(receipts.filter((r) => r.status === 'missing').length, 2);
});

test('a radar host without bzip2 loses only the radar feeds', async () => {
  const inflate = async () => { throw Object.assign(new Error('bzip2 unavailable: ENOENT'), { code: 'decoder_missing' }); };
  const { records } = await ingestRegion({ now: NOW, fetchImpl: fixtureFetch(), inflate });
  assert.equal(records.radar_reflectivity.missing_reason, 'decoder_missing');
  assert.equal(records.radar_velocity.missing_reason, 'decoder_missing');
  assert.equal(records.rain_now.status, 'ok');
});

test('carried-forward records keep their original times, age visibly, and expire', async () => {
  const good = await ingestRegion({ now: NOW, fetchImpl: fixtureFetch() });
  const first = buildSnapshot({ now: NOW, records: good.records });
  const later = new Date(NOW.getTime() + 40 * 60_000);
  const bad = await ingestRegion({ now: later, fetchImpl: fixtureFetch({ fail: { rain_now: 503, observation: 503 } }) });
  const second = withAges(buildSnapshot({ now: later, records: bad.records, previous: first }), later);
  const rain = second.feeds.rain_now;
  assert.equal(rain.status, 'carried_forward');
  assert.equal(rain.observed_at, first.feeds.rain_now.observed_at);
  assert.ok(rain.quality_flags.includes('carried_forward'));
  assert.equal(rain.stale, true, 'MRMS older than 15 minutes is stale');
  assert.ok(rain.age_s >= 40 * 60);
  // the recorded radar volumes are also too old for a run 40 minutes later: no recent file, so carried too
  assert.equal(second.feeds.radar_velocity.carried_reason, 'no_recent_file');
  assert.equal(second.counts.carried_forward, 4);
  const muchLater = new Date(NOW.getTime() + (CARRY_LIMIT_S.raster + 600) * 1000);
  const merged = mergeWithPrevious(bad.records, first, { now: muchLater });
  assert.equal(merged.rain_now.status, 'missing', 'a raster is not carried past two hours');
  assert.equal(merged.observation.status, 'carried_forward', 'a station reading may be carried a day');
});

test('the snapshot is small, versioned and says what it is', async () => {
  const { records, receipts } = await ingestRegion({ now: NOW, fetchImpl: fixtureFetch() });
  const snap = withAges(buildSnapshot({ now: NOW, records, receipts }), NOW);
  assert.equal(snap.schema, SNAPSHOT_SCHEMA);
  assert.equal(snap.region, 'connecticut-pilot');
  assert.deepEqual(snap.counts, { ok: 8, carried_forward: 0, missing: 0 });
  assert.ok(JSON.stringify(snap).length < 64 * 1024, 'under 64 KB');
  for (const r of Object.values(snap.feeds)) {
    for (const k of ['source_id', 'product', 'data_kind', 'units', 'quality_flags', 'ingested_at', 'stale_at', 'attribution']) assert.ok(k in r, `${r.feed}.${k}`);
    assert.ok(['observation', 'forecast', 'alert'].includes(r.data_kind), 'no simulated record in a real snapshot');
    assert.ok(r.observed_at || r.issued_at, `${r.feed} has a time`);
  }
  const old = withAges(snap, new Date(NOW.getTime() + 3 * 3_600_000));
  assert.equal(old.feeds.observation.stale, true);
  assert.equal(old.feeds.rain_now.stale, true);
});

test('S3 listings parse to keys, times and sizes', () => {
  const xml = '<ListBucketResult><Contents><Key>OKX_N0B_2026_11_03_15_27_00</Key><LastModified>2026-11-03T15:28:19.000Z</LastModified><Size>117136</Size></Contents></ListBucketResult>';
  assert.deepEqual(parseListing(xml), [{ key: 'OKX_N0B_2026_11_03_15_27_00', last_modified: '2026-11-03T15:28:19.000Z', size: 117136 }]);
});

/* ---------- the job ---------- */

test('the executor writes one snapshot as its output and atomically to the local file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-weather-'));
  const queries = [];
  const query = async (p) => { queries.push(p); return { body: [] }; };
  const out = await weatherRegionSnapshot({ id: 'j1', org_id: 'org', target_id: 'connecticut-pilot', job_type: JOB_TYPE }, {
    query, resolveOrg: async () => 'org', fetchImpl: fixtureFetch(), env: { MCCLUSTER_WEATHER_DIR: dir }, now: NOW,
  });
  assert.equal(out.executor, 'weather_region_snapshot:v1');
  assert.deepEqual(out.counts, { ok: 8, carried_forward: 0, missing: 0 });
  assert.equal(out.local.written, true);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'connecticut-pilot', 'latest.json'), 'utf8'));
  assert.equal(onDisk.generated_at, out.snapshot.generated_at);
  assert.ok(queries[0].includes(`job_type=eq.${JOB_TYPE}`) && queries[0].includes('status=eq.done'));
  await assert.rejects(() => weatherRegionSnapshot({ org_id: 'other', target_id: 'connecticut-pilot' }, { resolveOrg: async () => 'org' }), /outside Core authority/);
  await assert.rejects(() => weatherRegionSnapshot({ org_id: 'org', target_id: 'mars' }, { resolveOrg: async () => 'org', query }), /unknown region/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the executor carries forward from the previous job output when a feed fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-weather-'));
  const first = await weatherRegionSnapshot({ org_id: 'org', target_id: 'connecticut-pilot' }, { query: async () => ({ body: [] }), resolveOrg: async () => 'org', fetchImpl: fixtureFetch(), env: { MCCLUSTER_WEATHER_DIR: dir }, now: NOW });
  const second = await weatherRegionSnapshot({ org_id: 'org', target_id: 'connecticut-pilot' }, {
    query: async () => ({ body: [{ output: { snapshot: first.snapshot } }] }), resolveOrg: async () => 'org',
    fetchImpl: fixtureFetch({ fail: { radar_velocity: 503 } }), env: { MCCLUSTER_WEATHER_DIR: dir }, now: new Date(NOW.getTime() + 600_000),
  });
  assert.equal(second.previous_from, 'job');
  assert.equal(second.snapshot.feeds.radar_velocity.status, 'carried_forward');
  assert.equal(second.counts.carried_forward, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scheduling is off by default: the seed needs WEATHER_INGEST_ENABLED and deploy does not enable the timer', async () => {
  assert.equal(ingestEnabled({}), false);
  assert.equal(ingestEnabled({ WEATHER_INGEST_ENABLED: 'TRUE' }), true);
  assert.equal(keepHours({}), 48);
  assert.equal(keepHours({ WEATHER_SNAPSHOT_KEEP_HOURS: '1' }), 6);
  const deploy = await readFile(new URL('../../scripts/deploy-ovh-core.sh', import.meta.url), 'utf8');
  const enableLine = deploy.split('\n').find((l) => l.startsWith('for timer in '));
  assert.ok(enableLine && !enableLine.includes('mccluster-core-weather.timer'));
  const timer = await readFile(new URL('../systemd/mccluster-core-weather.timer', import.meta.url), 'utf8');
  assert.match(timer, /OnUnitActiveSec=10min/);
  const service = await readFile(new URL('../systemd/mccluster-core-weather.service', import.meta.url), 'utf8');
  assert.match(service, /seed-weather-snapshot\.mjs/);
  const runner = await readFile(new URL('../src/runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /\['weather_region_snapshot', weatherRegionSnapshot\]/);
});
