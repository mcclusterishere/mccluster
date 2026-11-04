/* The owner's Connecticut Weather Desk (weather-desk.html, js/weather/*): gated, labelled, mobile first,
   and the browser decoder agrees with Core's encoder. Game weather is simulated, keeps real alerts, and never
   uses radar radial velocity as wind. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeRate, decodeRate as coreDecodeRate } from '../../core/src/weather/fields.mjs';
import { ingestRegion, buildSnapshot, withAges } from '../../core/src/weather/ingest.mjs';
import { fixtureFetch, fixtureNow } from '../../core/src/weather/fixture-fetch.mjs';
import { decodeRate, decodeRaster, valueAt, ageNow, ageText, staleNow, fetchWeather } from '../../js/weather/client.mjs';
import { gameWeather, rainIntensity, rainLabel } from '../../js/weather/game-weather.mjs';

const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const NOW = Date.parse(fixtureNow());
const { records, receipts } = await ingestRegion({ now: new Date(NOW), fetchImpl: fixtureFetch() });
const SNAP = withAges(buildSnapshot({ now: new Date(NOW), records, receipts }), new Date(NOW));

test('the desk is owner only: gated, noindex, out of the sitemap, its script loads only after the gate', () => {
  const html = read('weather-desk.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<section class="[^"]*owner-gate[^"]*"[^>]*data-owner-gate/);
  assert.match(html, /data-owner-load="js\/weather\/desk\.mjs\?v=__STAMP__"/);
  assert.match(html, /<script type="module" src="js\/owner-only\.mjs\?v=__STAMP__"><\/script>/);
  const outside = html.replace(/<template[\s\S]*?<\/template>/g, '');
  assert.doesNotMatch(outside, /<script[^>]+src="[^"]*js\/weather\//, 'no weather script outside the gate');
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
  const sitemap = JSON.parse(read('data/seo/sitemap-pages.json')).pages.map((p) => p.url);
  assert.ok(!sitemap.some((u) => u.endsWith('/weather-desk.html')));
  for (const part of [outside, ...[...html.matchAll(/<template[\s\S]*?<\/template>/g)].map((m) => m[0])]) assert.equal((part.match(/<h1[\s>]/g) || []).length, 1);
});

test('mobile first and no purple: min-width queries only, minmax(0,1fr), 16px controls', () => {
  const css = read('css/weather-desk.css');
  assert.doesNotMatch(css, /max-width\s*:\s*\d+px\s*\)/, 'no max-width media query');
  assert.doesNotMatch(css.replace(/minmax\(0,\s*1fr\)/g, ''), /\b1fr\b/, 'every 1fr is minmax(0, 1fr)');
  assert.match(css, /max\(16px/);
  const desk = read('js/weather/desk.mjs');
  for (const src of [css, desk, read('weather-desk.html')]) assert.doesNotMatch(src, /purple|violet|magenta|indigo|#8a2be2|#800080/i);
});

test('the browser rain decoder agrees with Core for every code', () => {
  for (let c = 0; c < 256; c += 1) assert.equal(decodeRate(c), coreDecodeRate(c), `code ${c}`);
  for (const mmh of [0, 0.3, 7.25, 19.9, 33, 200]) assert.equal(decodeRate(encodeRate(mmh)), coreDecodeRate(encodeRate(mmh)));
});

test('rasters decode on the snapshot grid; radar codes map through the product lut', () => {
  const rain = decodeRaster(SNAP.feeds.rain_now, SNAP.grid);
  assert.equal(rain.values.length, SNAP.grid.nx * SNAP.grid.ny);
  assert.equal(rain.units, 'mm/h');
  const vel = decodeRaster(SNAP.feeds.radar_velocity, SNAP.grid);
  assert.equal(vel.units, 'm/s');
  for (let k = 0; k < vel.codes.length; k += 1) {
    if (vel.codes[k] >= 2 && vel.codes[k] < 255) assert.ok(vel.values[k] >= -63.5 && vel.values[k] <= 63.5);
    else assert.ok(Number.isNaN(vel.values[k]));
  }
  assert.equal(valueAt(SNAP, 'rain_now', 0, 0), null, 'outside the grid is null, never 0');
  assert.equal(decodeRaster({ payload: { data: 'AAAA', codec: 'mrms-rate-u8-v1' } }, SNAP.grid), null, 'a wrong-size raster is refused');
});

test('ages advance locally and stale is honest', () => {
  const r = SNAP.feeds.observation;
  assert.equal(ageNow(r, SNAP, NOW + 60_000), r.age_s + 60);
  assert.equal(staleNow(r, NOW), false);
  assert.equal(staleNow(r, NOW + 6 * 3_600_000), true);
  assert.equal(staleNow({ status: 'missing' }), true);
  assert.equal(ageText(4320), '72 min old');
});

test('fetchWeather asks the Worker with the bearer, never a provider', async () => {
  const seen = [];
  const body = await fetchWeather({ token: 't', rasters: false, fetchImpl: async (url, init) => { seen.push([url, init.headers.authorization]); return new Response(JSON.stringify({ ok: true, available: false }), { status: 200 }); } });
  assert.equal(body.available, false);
  assert.deepEqual(seen, [['https://api.mccluster.org/v1/world/weather/connecticut-pilot?rasters=0', 'Bearer t']]);
  await assert.rejects(() => fetchWeather({ token: null }), /house owner/);
});

test('game weather is simulated, cites its inputs, keeps real alerts, never uses radial velocity as wind', () => {
  const g = gameWeather(SNAP, { nowMs: NOW });
  assert.equal(g.data_kind, 'simulated');
  assert.match(g.labels[0], /fictional/);
  assert.equal(g.wind.source, 'observation');
  assert.ok(!g.inputs.some((i) => i.feed === 'radar_velocity'));
  assert.equal(g.rain.source, 'rain_now');
  assert.equal(g.tide.source, 'water_level');
  assert.ok(['rising', 'falling'].includes(g.tide.trend));
  assert.match(g.effects.water_city_y_status, /proposal/);
  const withAlert = structuredClone(SNAP);
  withAlert.feeds.alerts.payload.alerts = [{ event: 'Coastal Flood Advisory', severity: 'Minor', headline: 'synthetic test alert' }];
  assert.equal(gameWeather(withAlert, { nowMs: NOW }).real_alerts[0].event, 'Coastal Flood Advisory');
  const later = gameWeather(SNAP, { nowMs: NOW + 6 * 3_600_000 });
  assert.equal(later.rain.source, 'simulated_default', 'stale rain is not presented as current');
  assert.ok(later.labels.some((l) => /simulated defaults/.test(l)));
  assert.ok(later.labels.some((l) => /weather\.gov/.test(l)));
  assert.equal(gameWeather(null).data_kind, 'simulated');
  assert.equal(rainIntensity(0), 0);
  assert.ok(rainIntensity(4) > rainIntensity(0.5) && rainIntensity(100) <= 1);
  assert.equal(rainLabel(8), 'moderate rain');
});
