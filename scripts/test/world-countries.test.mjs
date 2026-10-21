/* The World's countries: data integrity, accuracy, the states, flags, the fade rule, the Countries preference, the tap, and the
   mission counts.
   node --test scripts/test/world-countries.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
const C = createRequire(import.meta.url)(ROOT + 'js/world-countries.js');
const data = JSON.parse(read('data/geo/world-countries-10m.json'));
const feats = C.decode(data);
const borders = JSON.parse(read('data/geo/world-borders-10m.json'));
const states = JSON.parse(read('data/geo/world-states/index.json'));
/* no ISO 3166-1 code in Natural Earth: the UK's bases on Cyprus, Guantanamo Bay, Bir Tawil, the Spratlys, Scarborough Reef */
const NO_ISO = new Set(['ESB', 'WSB', 'USG', 'BRT', 'PGA', 'SCR']);

test('the borders files say where they came from, their version and licence, and stay small', () => {
  for (const d of [data, borders]) {
    assert.match(d.source, /Natural Earth 1:10m/);
    assert.match(d.source, /US point of view/);
    assert.match(d.version, /v5\.1\.2.*ne_10m_admin_0_countries_usa/);
    assert.match(d.licence, /Public domain/i);
    assert.match(d.source_sha256, /^[0-9a-f]{64}$/);
    assert.equal(d.generated_by, 'tools/build-world-countries.mjs');
  }
  assert.equal(states.generated_by, 'tools/build-world-states.mjs');
  assert.ok(existsSync(ROOT + 'tools/build-world-countries.mjs') && existsSync(ROOT + 'tools/build-world-states.mjs') && existsSync(ROOT + 'tools/build-flag-sprite.mjs'));
  /* the phone downloads these with the globe: the shapes, the land borders, and one country's states at a time */
  assert.ok(gzipSync(readFileSync(ROOT + 'data/geo/world-countries-10m.json')).length < 160 * 1024);
  assert.ok(gzipSync(readFileSync(ROOT + 'data/geo/world-borders-10m.json')).length < 40 * 1024);
  for (const [cc, s] of Object.entries(states.countries)) assert.ok(gzipSync(readFileSync(ROOT + `data/geo/world-states/${cc}.json`)).length < 48 * 1024, cc);
  assert.ok(!existsSync(ROOT + 'data/geo/world-countries-110m.json'), 'the 1:110m World borders are retired');
});

test('places land in the country they are in (the 1:110m borders put these in the wrong country or the sea)', () => {
  const at = (lon, lat) => { const f = C.countryAt(feats, lon, lat); return f && (f.properties.a2 || f.properties.a3); };
  for (const [name, lon, lat, cc] of [
    ['Geneva', 6.14, 46.2, 'CH'], ['Windsor, Ontario', -83.03, 42.31, 'CA'], ['Ciudad Juárez', -106.45, 31.72, 'MX'],
    ['Brazzaville', 15.28, -4.27, 'CG'], ['Kinshasa', 15.31, -4.33, 'CD'], ['Monaco', 7.42, 43.74, 'MC'], ['Andorra la Vella', 1.52, 42.51, 'AD'],
    ['Singapore', 103.85, 1.29, 'SG'], ['Hong Kong', 114.17, 22.32, 'HK'], ['Isa Town, Bahrain', 50.548, 26.174, 'BH'], ['Valletta', 14.51, 35.9, 'MT'],
    ['Port Louis', 57.5, -20.16, 'MU'], ['Bridgetown', -59.6, 13.1, 'BB'], ['New Haven', -72.93, 41.31, 'US'], ['Moscow', 37.62, 55.75, 'RU'],
    /* the US point of view, as GDELT names these places */
    ['Simferopol', 34.1, 44.95, 'UA'], ['Sevastopol', 33.52, 44.6, 'UA'], ['Laayoune', -13.2, 27.15, 'EH'], ['Hargeisa', 44.06, 9.56, 'SO'], ['North Nicosia', 33.36, 35.19, 'CY'],
  ]) assert.equal(at(lon, lat), cc, name);
});

test('the land borders are lines two countries share; the states are lines inside one country', () => {
  const pts = borders.lines.reduce((n, l) => n + l.length / 2, 0);
  assert.ok(borders.lines.length > 300 && pts > 10000 && pts < 20000, `${borders.lines.length} lines, ${pts} points`);
  for (const l of borders.lines) { const p = C.undelta(l); assert.ok(p.length >= 2); for (const [x, y] of p) assert.ok(Math.abs(x) <= 180 && Math.abs(y) <= 90); }
  /* the US–Canada line along the 49th parallel is one of them */
  assert.ok(borders.lines.some((l) => C.undelta(l).some(([x, y]) => x > -110 && x < -100 && Math.abs(y - 49) < 0.02)));
  /* the states: where they are, so the globe asks only for the countries in view */
  for (const cc of ['US', 'CA', 'MX', 'BR', 'IN', 'CN', 'RU', 'NG', 'DE', 'AU', 'UA']) assert.ok(states.countries[cc] && states.countries[cc].lines > 0, cc);
  assert.ok(states.countries.US.bbox[0] < -120 && states.countries.US.bbox[2] > -72);
  /* the well-known level: France's regions, not its departments; Britain's four nations, not its councils */
  assert.ok(states.countries.FR.lines < 40 && states.countries.GB.lines <= 4, JSON.stringify([states.countries.FR, states.countries.GB]));
  /* every state line stays inside its own country (a step off the line may cross a coast, so each point is checked for
     being in the country or within a hair of its border) */
  const us = JSON.parse(read('data/geo/world-states/US.json'));
  assert.equal(us.c, 'US');
  const inUS = C.undelta(us.lines[0]).filter(([x, y]) => { const f = C.countryAt(feats, x, y); return f && f.properties.a2 === 'US'; }).length;
  assert.ok(inUS >= C.undelta(us.lines[0]).length - 2);
  /* Crimea's line with Kherson is inside Ukraine on the US-view map */
  const ua = JSON.parse(read('data/geo/world-states/UA.json'));
  assert.ok(ua.lines.some((l) => C.undelta(l).some(([x, y]) => y > 45.9 && y < 46.3 && x > 33.4 && x < 35)), 'the Crimea–Kherson line');
});

test('the borders stay while the camera comes down; the states come in at a continent', () => {
  assert.equal(C.lineTarget(2e7, 'auto'), 1);
  assert.equal(C.lineTarget(2.6e6, 'auto'), 1, 'over a country, the borders are still drawn');
  assert.equal(C.lineTarget(5e5, 'auto'), 0, 'the street map or aerial imagery takes over');
  assert.equal(C.lineTarget(5e5, 'always'), 1);
  assert.equal(C.lineTarget(2e7, 'off'), 0);
  assert.equal(C.stateTarget(2e7, 'auto'), 0, 'a whole-Earth view is not a tangle of states');
  assert.equal(C.stateTarget(4e6, 'auto'), 1);
  const mid = C.stateTarget((C.STATES_FAR + C.STATES_NEAR) / 2, 'auto');
  assert.ok(mid > 0 && mid < 1);
  assert.equal(C.stateTarget(5e5, 'auto'), 0);
  assert.equal(C.stateTarget(4e6, 'off'), 0);
});

test('every feature has a code, a name, a continent, a region and a real label point', () => {
  assert.equal(feats.length, 243);
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
    /* the label point is at the country (within half a degree of its box; Natural Earth sets the two ocean territories'
       a few degrees off their reefs) */
    const b = p.bbox, k = p.continent === 'Seven seas (open ocean)' ? 6 : 0.5;
    assert.ok(lon >= b[0] - k && lon <= b[2] + k && lat >= b[1] - k && lat <= b[3] + k, p.name);
  }
  assert.equal(new Set(feats.map((f) => f.properties.a3)).size, feats.length);
  assert.equal(new Set(feats.filter((f) => f.properties.a2).map((f) => f.properties.a2)).size, feats.filter((f) => f.properties.a2).length);
});

test('the United States is there, with its main body apart from Alaska and Hawaii', () => {
  const us = feats.find((f) => f.properties.a2 === 'US').properties;
  assert.equal(us.a3, 'USA'); assert.equal(us.continent, 'North America'); assert.equal(us.flag, true);
  assert.ok(Math.abs(us.main_bbox[0] + 124.7) < 0.1 && Math.abs(us.main_bbox[1] - 25.1) < 0.2 && Math.abs(us.main_bbox[2] + 66.95) < 0.1 && Math.abs(us.main_bbox[3] - 49.38) < 0.05, JSON.stringify(us.main_bbox));
  /* France and Norway, which plain ISO_A2 leaves as -99, carry their codes */
  assert.ok(feats.some((f) => f.properties.a2 === 'FR') && feats.some((f) => f.properties.a2 === 'NO'));
});

test('a flag ships for every country shown with one, under its licence, and in the atlas', () => {
  const sprite = JSON.parse(read('assets/flags/flag-sprite-4x3.json'));
  const shown = feats.filter((f) => f.properties.flag).map((f) => f.properties.a2);
  assert.equal(shown.length, 174); /* the flags the atlas carries; the countries new at 1:10m have none yet */
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
  assert.match(html, /<script src="js\/world-countries\.js"><\/script><script src="js\/action-globe\.js\?v=__STAMP__">/);
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
  assert.match(read('js/world-countries.js'), /refresh: \(\) => \{ if \(!st\.selected\) return; const keepState = st\.selectedState; select\([^;]*\); if \(keepState && st\.selected\) selectState\(keepState\); \}/, 'and a state picked in it stays picked');
  /* and selecting it again before its states arrive draws them once: only the latest selection's file is drawn */
  assert.match(read('js/world-countries.js'), /const gen = \+\+st\.selectGen;[\s\S]{0,200}gen === st\.selectGen && st\.selected === code && !st\.selectedStates/);
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

/* A STATE (owner, 2026-10-21: "once you've selected a country ... select a state thereafter, but only after selecting the
   country already and double tapping the state"). */
const areas = (a2) => C.decode(JSON.parse(read('data/geo/world-state-areas/' + a2 + '.json')));
const stateAt = (a2, lon, lat) => { const f = C.countryAt(areas(a2), lon, lat); return f && f.properties; };

test('every country whose state lines are drawn has its states as shapes, and nothing else does', () => {
  const have = readdirSync(ROOT + 'data/geo/world-state-areas').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, 2)).sort();
  assert.deepEqual(have, Object.keys(states.countries).sort());
  let total = 0;
  for (const a2 of have) { total += statSync(ROOT + 'data/geo/world-state-areas/' + a2 + '.json').size; const d = JSON.parse(read('data/geo/world-state-areas/' + a2 + '.json')); assert.equal(d.c, a2); assert.ok(d.states.length >= 2, a2); for (const s of d.states) { assert.ok(s.properties.key && s.properties.name, a2); assert.equal(s.properties.bbox.length, 4); } }
  assert.ok(total < 1.6e6, 'all of them, ' + total + ' bytes; one is fetched only when its country is selected');
  assert.ok(statSync(ROOT + 'data/geo/world-state-areas/US.json').size < 60e3);
});

test('a point names the state it is in, the way the lines draw them', () => {
  assert.equal(areas('US').length, 51, 'fifty states and the District of Columbia');
  assert.equal(stateAt('US', -119.4, 37.2).key, 'US-CA');
  assert.equal(stateAt('US', -119.4, 37.2).name, 'California');
  assert.equal(stateAt('US', -119.4, 37.2).type, 'State');
  assert.equal(stateAt('US', -99.3, 31.4).name, 'Texas');
  assert.equal(stateAt('US', -77.03, 38.9).name, 'Washington, D.C.', 'not "Washington", which is a state');
  assert.equal(stateAt('US', -120.5, 47.4).name, 'Washington');
  assert.equal(stateAt('US', -150, 64).name, 'Alaska');
  assert.equal(stateAt('CA', -85, 50).name, 'Ontario');
  assert.equal(stateAt('CA', -85, 50).type, 'Province');
  /* a grouped country: the state is the group the lines draw (France's regions, England, Scotland …) */
  assert.equal(stateAt('FR', 2.35, 48.85).name, 'Île-de-France');
  assert.equal(stateAt('GB', -1.5, 52.5).name, 'England');
  assert.equal(stateAt('GB', -4.2, 56.8).name, 'Scotland');
  assert.equal(areas('GB').length, 4);
  assert.equal(stateAt('DE', 11.5, 48.8).name, 'Bavaria');
  /* where the stories are placed: Crimea is in Ukraine on the US-view map, and its state is Ukraine's */
  assert.equal(stateAt('UA', 34.1, 45.3).name, 'Autonomous Republic of Crimea');
  assert.equal(stateAt('US', 0, 0), null);
});

test('a small country\'s units stay its own: Italy has twenty regions and no San Marino, France no Monaco', () => {
  const it = areas('IT').map((f) => f.properties.name);
  assert.equal(it.length, 20, it.join(', '));
  for (const sm of ['Domagnano', 'Faetano', 'Fiorentino', 'Montegiardino', 'Serravalle']) assert.ok(!it.includes(sm), sm);
  assert.ok(!areas('FR').some((f) => f.properties.name === 'Monaco'));
  assert.ok(!areas('CH').some((f) => ['Balzers', 'Triesen'].includes(f.properties.name)));
  assert.ok(areas('SM').length >= 2, 'San Marino keeps its municipalities');
});

test('a double tap is two taps within the gap and a thumb\'s width', () => {
  const a = { t: 1000, x: 100, y: 100 };
  assert.equal(C.isDoubleTap(a, { t: 1000 + C.TAP_GAP, x: 110, y: 95 }), true);
  assert.equal(C.isDoubleTap(a, { t: 1001 + C.TAP_GAP, x: 100, y: 100 }), false, 'too slow');
  assert.equal(C.isDoubleTap(a, { t: 1100, x: 100 + C.TAP_SLOP + 1, y: 100 }), false, 'too far apart');
  assert.equal(C.isDoubleTap(null, a), false);
  assert.equal(C.isDoubleTap(a, { t: 900, x: 100, y: 100 }), false);
});

test('only a double tap in the country already selected picks a state', () => {
  const js = read('js/world-countries.js');
  assert.match(js, /if \(isDoubleTap\(first, tap\)\) \{ if \(first\.inSelected\) pickState\(first\.lon, first\.lat\); return true; \}/, 'the tap that selected a country never arms a state');
  assert.match(js, /if \(code === st\.selected\) \{[\s\S]{0,400}st\.tap = Object\.assign\(tap, \{ inSelected: true, lon, lat \}\);/);
  assert.match(js, /select\(f\);\n\s*st\.tap = tap;/, 'a tap that selects a country is remembered unarmed');
  /* a single tap inside the country still answers, once the gap has passed */
  assert.match(js, /setTimeout\(\(\) => \{[\s\S]{0,400}if \(st\.selectedState\) selectState\(null\); else \{ select\(null\);/);
  /* taps are timed by their own events, so a busy frame cannot split a double tap in two */
  assert.match(js, /addEventListener\('pointerdown', \(e\) => \{ if \(e\.isPrimary\) st\.down = \{ t: e\.timeStamp \}; \}, true\)/);
  assert.match(js, /if \(st\.down && st\.down\.t - tap\.t <= TAP_GAP\) return;/);
  assert.match(js, /selectState\(st\.selectedState && st\.selectedState\.properties\.key === sf\.properties\.key \? null : sf\)/, 'the picked state again goes back to the country');
  /* the page is told the state with its shape */
  assert.match(js, /state: sp \? \{ key: sp\.key, name: sp\.name, type: sp\.type \|\| null, polygons: polygonsOf\(sf\) \} : null/);
});
