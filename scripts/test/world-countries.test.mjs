/* The World's countries: data integrity, flags, the fade rule, the Countries preference, the tap, and the mission counts.
   node --test scripts/test/world-countries.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
const C = createRequire(import.meta.url)(ROOT + 'js/world-countries.js');
const data = JSON.parse(read('data/geo/world-countries-110m.json'));
const feats = data.features;
const NO_ISO = new Set(['CYN', 'SOL']); /* Northern Cyprus, Somaliland: no ISO 3166-1 code in Natural Earth */

test('the borders file says where it came from, its version and its licence, and stays small', () => {
  assert.match(data.source, /Natural Earth 1:110m/);
  assert.match(data.version, /v5\.1\.2/);
  assert.match(data.licence, /Public domain/i);
  assert.match(data.source_sha256, /^[0-9a-f]{64}$/);
  assert.equal(data.generated_by, 'tools/build-world-countries.mjs');
  assert.ok(existsSync(ROOT + 'tools/build-world-countries.mjs') && existsSync(ROOT + 'tools/build-flag-sprite.mjs'));
  assert.ok(gzipSync(readFileSync(ROOT + 'data/geo/world-countries-110m.json')).length < 300 * 1024);
});

test('every feature has a code, a name, a continent, a region and a real label point', () => {
  assert.equal(feats.length, 177);
  for (const f of feats) {
    const p = f.properties;
    assert.match(String(p.a3), /^[A-Z]{3}$/, p.name);
    if (NO_ISO.has(p.a3)) { assert.equal(p.a2, null); assert.equal(p.flag, false); }
    else assert.match(String(p.a2), /^[A-Z]{2}$/, p.name);
    assert.ok(p.name && p.continent && p.region, p.name);
    const [lon, lat] = p.label;
    assert.ok(Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90, p.name);
    assert.ok(!(lon === 0 && lat === 0), p.name + ' label point is 0,0');
    assert.ok(['Polygon', 'MultiPolygon'].includes(f.geometry.type));
    /* the label point is at the country (Natural Earth's points come from finer data: within half a degree of the 1:110m box) */
    const b = p.bbox; assert.ok(lon >= b[0] - 0.5 && lon <= b[2] + 0.5 && lat >= b[1] - 0.5 && lat <= b[3] + 0.5, p.name);
  }
  assert.equal(new Set(feats.map((f) => f.properties.a3)).size, feats.length);
  assert.equal(new Set(feats.filter((f) => f.properties.a2).map((f) => f.properties.a2)).size, feats.filter((f) => f.properties.a2).length);
});

test('the United States is there, with its main body apart from Alaska and Hawaii', () => {
  const us = feats.find((f) => f.properties.a2 === 'US').properties;
  assert.equal(us.a3, 'USA'); assert.equal(us.continent, 'North America'); assert.equal(us.flag, true);
  assert.deepEqual(us.main_bbox, [-124.69, 25.08, -66.96, 49.39]);
  /* France and Norway, which plain ISO_A2 leaves as -99, carry their codes */
  assert.ok(feats.some((f) => f.properties.a2 === 'FR') && feats.some((f) => f.properties.a2 === 'NO'));
});

test('a flag ships for every country shown with one, under its licence, and in the atlas', () => {
  const sprite = JSON.parse(read('assets/flags/flag-sprite-4x3.json'));
  const shown = feats.filter((f) => f.properties.flag).map((f) => f.properties.a2);
  assert.equal(shown.length, 174);
  for (const a2 of shown) {
    assert.ok(statSync(ROOT + `assets/flags/4x3/${a2.toLowerCase()}.svg`).size > 0, a2);
    assert.ok(sprite.order.includes(a2), a2 + ' missing from the atlas');
  }
  assert.ok(existsSync(ROOT + 'assets/flags/flag-sprite-4x3.webp'));
  assert.match(read('assets/flags/LICENSE-flag-icons.txt'), /MIT License[\s\S]*Panayiotis Lipiridis/);
  assert.equal(feats.find((f) => f.properties.a2 === 'AQ').properties.flag, false);
});

test('the globe credits the borders and the flags', () => {
  const html = read('action-globe.html');
  assert.match(html, /Borders: <a href="https:\/\/www\.naturalearthdata\.com\/"/);
  assert.match(html, /Flags: <a href="https:\/\/github\.com\/lipis\/flag-icons"[^>]*>flag-icons<\/a> \(MIT\) · <a href=\"https:\/\/www\.openstreetmap\.org\/copyright\"/);
  assert.match(html, /<script src="js\/world-countries\.js"><\/script><script src="js\/action-globe\.js">/);
});

test('fade: far out every country is decorated; coming down, or filling the view, it fades', () => {
  const US = [-124.69, 25.08, -66.96, 49.39];
  assert.equal(C.fadeTarget({ height: 1.9e7, view: null, box: US, mode: 'auto' }), 1);
  /* a whole-hemisphere view never fades a big country (Russia stays decorated at the home view) */
  assert.equal(C.fadeTarget({ height: 1.25e7, view: [-10, -60, 170, 85], box: [27, 41, 180, 78], mode: 'auto' }), 1);
  /* the US filling a view over it */
  assert.equal(C.fadeTarget({ height: 3e6, view: [-120, 28, -76, 50], box: US, mode: 'auto' }), 0);
  const mid = C.fadeTarget({ height: 6e6, view: [-140, 15, -55, 58], box: US, mode: 'auto' });
  assert.ok(mid > 0 && mid < 1, String(mid));
  /* a country out of view keeps its decoration until the height floor */
  assert.equal(C.fadeTarget({ height: 3e6, view: [-120, 28, -76, 50], box: [-0.3, 49, 1.7, 51], mode: 'auto' }), 1);
  assert.equal(C.fadeTarget({ height: 5e5, view: null, box: US, mode: 'auto' }), 0);
  /* keep on / off */
  assert.equal(C.fadeTarget({ height: 3e5, view: [-120, 28, -76, 50], box: US, mode: 'always' }), 1);
  assert.equal(C.fadeTarget({ height: 2e7, view: null, box: US, mode: 'off' }), 0);
  /* a view across the antimeridian still sees Fiji */
  assert.ok(C.intersects([170, -30, -170, -10], [177, -19, 180, -16]));
  assert.ok(!C.intersects([170, -30, -170, -10], [-80, -19, -70, -16]));
});

test('the ease toward the target; reduced motion jumps', () => {
  assert.equal(C.stepAlpha(1, 0, 16, true), 0);
  const a = C.stepAlpha(1, 0, 16, false);
  assert.ok(a > 0 && a < 1);
  let x = 1; for (let n = 0; n < 200; n++) x = C.stepAlpha(x, 0, 16, false);
  assert.equal(x, 0);
  assert.equal(C.stepAlpha(0.3, 1, 0, false), 1);
});

test('the Countries preference: fade (default) → keep on → off, kept in this browser only', () => {
  const store = new Map(), storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  assert.equal(C.readMode(storage), 'auto');
  assert.equal(C.nextMode('auto'), 'always'); assert.equal(C.nextMode('always'), 'off'); assert.equal(C.nextMode('off'), 'auto');
  assert.ok(C.writeMode(storage, 'off')); assert.equal(C.readMode(storage), 'off');
  assert.equal(store.get(C.PREF_KEY), 'off');
  assert.ok(!C.writeMode(storage, 'sideways')); assert.equal(C.readMode(storage), 'off');
  store.set(C.PREF_KEY, 'garbage'); assert.equal(C.readMode(storage), 'auto');
  const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(C.readMode(broken), 'auto'); assert.equal(C.writeMode(broken, 'off'), false);
  assert.equal(C.readMode(null), 'auto');
});

test('a tap finds the country under it, holes respected', () => {
  assert.equal(C.countryAt(feats, -98, 39).properties.a2, 'US');
  assert.equal(C.countryAt(feats, -150, 64).properties.a2, 'US'); /* Alaska */
  assert.equal(C.countryAt(feats, 2.35, 46.8).properties.a2, 'FR');
  assert.equal(C.countryAt(feats, -30, 30), null); /* the Atlantic */
  /* Lesotho is a hole in South Africa */
  assert.equal(C.countryAt(feats, 28.2, -29.6).properties.a2, 'LS');
  assert.equal(C.countryAt(feats, NaN, 3), null);
});

test('mission counts come from the rows, never guessed', () => {
  const regions = [{ region_key: 'GB-LND', country_code: 'GB' }, { region_key: 'US-CT', country_code: 'US' }];
  const missions = [
    { mission_id: 'a', country_code: 'US', region_key: 'US-NY' },
    { mission_id: 'a', country_code: 'us', region_key: 'US-CT' }, /* the same mission pinned twice in one country */
    { mission_id: 'b', region_key: 'GB-LND' },
    { mission_id: 'c', region_key: 'DE-BE' }, /* no country anywhere: not counted, never inferred from "DE-" */
    { mission_id: 'd', country_code: 'XXX', region_key: 'ZZ' },
  ];
  assert.deepEqual(C.missionCounts(missions, regions), { US: 1, GB: 1 });
  assert.equal(C.missionCountry(missions[3], C.regionCountryIndex(regions)), null);
  assert.equal(C.countText(0), 'No missions here yet');
  assert.equal(C.countText(1), '1 mission pinned here');
  assert.equal(C.countText(3), '3 missions pinned here');
});

test('a mission with no country code or region row is counted where its own pin sits (the regions read can be empty)', () => {
  /* production: action_globe_public_regions() is k>=5 suppressed and returns no rows while every mission pin is published */
  const missions = [
    { mission_id: 'p', region_key: 'US-CT', longitude: -72.7, latitude: 41.6 },
    { mission_id: 'q', region_key: 'FR-IDF', longitude: '2.35', latitude: '46.8' },
    { mission_id: 'r', region_key: 'XX', longitude: -30, latitude: 30 }, /* open sea: not counted */
    { mission_id: 's', region_key: 'YY' }, /* no pin: not counted */
  ];
  assert.deepEqual(C.missionCounts(missions, [], feats), { US: 1, FR: 1 });
  assert.equal(C.missionCountry(missions[0], {}, feats), 'US');
  assert.equal(C.missionCountry(missions[0], {}), null, 'without the boundaries nothing is inferred');
  assert.equal(C.missionCountry({ ...missions[0], country_code: 'GB' }, {}, feats), 'GB', 'the row\'s own code wins');
});

test('a country picked before the missions load is applied again when they arrive', () => {
  assert.match(read('js/world-countries.js'), /refresh: \(\) => \{ if \(st\.selected\) select\(/);
  assert.match(read('js/action-globe.js'), /renderFeed\(\);if\(countries&&countries\.refresh\)countries\.refresh\(\);/);
});

test('the page hook stays small and the module mounts only off the analytics surface', () => {
  const g = read('js/action-globe.js');
  assert.match(g, /function mountCountries\(\)\{if\(!window\.HuCountries\|\|ANALYTICS\|\|!viewer\)return;/);
  assert.match(g, /countries\.click\(p\.position\)/);
  assert.match(g, /inCountry\(m\)&&/);
  const css = read('css/world-countries.css');
  assert.doesNotMatch(css, /max-width\s*:\s*\d|@media[^{]*max-width/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
