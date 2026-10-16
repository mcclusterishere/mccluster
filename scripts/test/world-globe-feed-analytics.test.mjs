/* THE WORLD IS THE FEED (owner, 2026-10-15): globe-first shell for members,
   the chrome-less "just the globe" mode, the 60/40 analytics globe with
   privacy-safe country aggregates, and the mission-gated CCTV layer.
   docs/control-plane/WORLD-GLOBE-FEED-AND-ANALYTICS.md */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (p) => readFile(p, 'utf8');

function analyticsModule(js) {
  const context = { window: { CR: {} }, console };
  vm.createContext(context);
  vm.runInContext(js, context);
  const A = context.window.CR.analytics;
  A.init({ request: () => Promise.resolve({}), supa: () => Promise.resolve([]) });
  return A;
}
const PLACES = { US: [-97.5, 39.5, 'United States'], GB: [-2, 53, 'United Kingdom'], FR: [2.5, 46.5, 'France'], DE: [10, 51, 'Germany'] };

test('analytics globe: country only, under five folded, unknown disclosed, never a made-up position', async () => {
  const A = analyticsModule(await read('js/control-room/analytics.js'));
  const S = A.state;
  S.geo.places = PLACES;
  S.data.traffic = { totals: { page_views: 200 } };
  /* US 120, GB 30, FR 4 (under five), XX (Cloudflare unknown) 6, ZZ (no label point) 9; the totals carry 31 more with no country */
  S.data.geo = [{ key: 'US', n: 120 }, { key: 'GB', n: 30 }, { key: 'ZZ', n: 9 }, { key: 'XX', n: 6 }, { key: 'FR', n: 4 }];
  const a = A.geo.aggregate();
  assert.deepEqual(JSON.parse(JSON.stringify(a.points.map((p) => [p.code, p.value]))), [['US', 120], ['GB', 30]]);
  assert.equal(a.located, 150);
  assert.equal(a.suppressed, 4, 'France under five is folded, not drawn');
  assert.equal(a.unknown, 31 + 6 + 9, 'no country, Cloudflare unknown and no label point are all disclosed as unknown');
  assert.equal(a.total, 200);
  assert.equal(a.located + a.suppressed + a.unknown, a.total, 'every page view is accounted for exactly once');
  for (const p of a.points) assert.ok(!(p.lat === 0 && p.lon === 0));
});

test('analytics globe: the sign-up layer honours the shared source filter and the same threshold', async () => {
  const A = analyticsModule(await read('js/control-room/analytics.js'));
  const S = A.state;
  S.geo.places = PLACES;
  const j = (country, source) => ({ country, source, last_track: null });
  S.data.identity = { journeys: [...Array(6)].map(() => j('US', 'x.com')).concat([j('US', 'direct'), j('DE', 'x.com'), j(null, 'x.com')]) };
  S.geo.layer = 'signups';
  let a = A.geo.aggregate();
  assert.deepEqual(JSON.parse(JSON.stringify(a.points.map((p) => [p.code, p.value]))), [['US', 7]]);
  assert.equal(a.suppressed, 1); assert.equal(a.unknown, 1); assert.equal(a.total, 9);
  S.geo.source = 'x.com';
  a = A.geo.aggregate();
  assert.deepEqual(JSON.parse(JSON.stringify(a.points.map((p) => [p.code, p.value]))), [['US', 6]]);
  assert.equal(a.total, 8);
});

test('analytics globe: Intel events by the /v1/intel/geo contract: cells not points, honest when switched off', async () => {
  const js = await read('js/control-room/analytics.js');
  const A = analyticsModule(js);
  const S = A.state;
  S.geo.layer = 'intel';
  /* switched off: 503 intel_schema_not_ready */
  S.errors.intel = Object.assign(new Error('intel_schema_not_ready'), { status: 503 });
  let a = A.geo.aggregate();
  assert.equal(a.awaiting, true); assert.equal(a.points.length, 0);
  assert.match(a.unavailable, /not switched on yet/);
  delete S.errors.intel;
  S.data.intel = { ok: true, schema: 'mccluster-intel-geo/v1', layer: { attribution: ['U.S. Geological Survey'] },
    totals: { records: 30, located: 26, unknown_location: 4, suppressed_records: 0, suppressed_buckets: 0 },
    buckets: [
      { cell: 'g10:3:-12', cell_center: { lat: 35, lon: -115 }, cell_bounds: [-120, 30, -110, 40], count: 7 },
      { cell: 'g10:3:-12', cell_center: { lat: 35, lon: -115 }, cell_bounds: [-120, 30, -110, 40], count: 16 },
      { cell: 'g10:5:1', cell_center: { lat: 55, lon: 15 }, cell_bounds: [10, 50, 20, 60], count: 3 }
    ] };
  a = A.geo.aggregate();
  assert.equal(a.points.length, 1);
  assert.equal(a.points[0].code, 'g10:3:-12'); assert.equal(a.points[0].value, 23);
  assert.deepEqual(JSON.parse(JSON.stringify(a.points[0].bounds)), [-120, 30, -110, 40], 'drawn as its cell');
  assert.equal(a.suppressed, 3); assert.equal(a.unknown, 4); assert.equal(a.total, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(a.attribution)), ['U.S. Geological Survey']);
  assert.match(js, /\/v1\/intel\/geo\?since="\+encodeURIComponent\(f\.toISOString\(\)\)\+"&until="/);
  assert.match(js, /u\.getTime\(\)-92\*86400000/, 'the window is clamped to the API limit');
  const globe = await read('js/action-globe.js');
  assert.match(globe, /rectangle:\{coordinates:Cesium\.Rectangle\.fromDegrees\(bd\[0\],bd\[1\],bd\[2\],bd\[3\]\)/);
  assert.match(globe, /fetch\(API\+'\/v1\/intel\/geo\?cell=10&bucket=day'/);
  assert.match(globe, /Intel events are not switched on yet\./);
});

test('analytics: 60/40 shell, shared filters, both-way selection, and every existing metric still rendered', async () => {
  const js = await read('js/control-room/analytics.js');
  const A = analyticsModule(js);
  const html = A.render(), sheet = A.filters();
  /* the shared filters live in the Filters sheet over the globe now; the same ids, the same meanings */
  for (const id of ['craLayer', 'craRegion', 'craSource', 'craEvent']) assert.match(sheet, new RegExp('id="' + id + '"'));
  assert.match(sheet, /Program \/ mission<select class="cra-filter-select" disabled>/);
  assert.match(html, />On the globe</);
  for (const card of ['Traffic trend', 'Acquisition sources', 'Geography', 'Page performance', 'Networks', 'Music leaderboard', 'Content event mix']) assert.match(html, new RegExp(card));
  /* both ways, in one page: a tap on the globe selects (onSelect -> pickRegion without a flight); the country pill and
     the rows select and fly (syncGlobe(true) -> flyTo) */
  assert.match(js, /onSelect:function\(code\)\{pickRegion\(code,false\);\}/);
  assert.match(js, /if\(g&&g\.ready\)\{g\.setData\(geoPayload\(\)\);if\(fly\)g\.flyTo\(S\.geo\.region\);\}/);
  assert.match(js, /var c=root\.querySelector\("#craCountry"\);if\(c\)c\.onchange=function\(\)\{pickRegion\(c\.value\);\}/);
  const globe = await read('js/control-room/analytics-globe.js');
  assert.match(globe, /if \(opts\.onSelect\) opts\.onSelect\(next\)/);
  assert.match(globe, /baseLayer: false/, 'no imagery: no paid map, no ion');
  assert.match(globe, /requestRenderMode: true/);
  assert.doesNotMatch(globe, /Ion\.defaultAccessToken\s*=\s*['"]/);
});

test('the bottom app bar never leaves: no experience hides it; Music stays in the bar, not the account menu', async () => {
  const [js, css, html, globe, gcss] = await Promise.all([read('js/mnet.js'), read('css/style.css'), read('mnet.html'), read('js/action-globe.js'), read('css/action-globe.css')]);
  assert.doesNotMatch(js + css + globe, /mn-globe-only/, 'no signed-in "no bar" mode');
  assert.doesNotMatch(html, /id="mnMenuMusic"/, 'Music is a bar column again, not a menu item');
  // just the globe keeps the bar: no data-no-appbar and no CSS that hides it
  assert.doesNotMatch(globe.slice(globe.indexOf('const BARE='), globe.indexOf('const BARE=') + 200), /data-no-appbar/);
  assert.doesNotMatch(gcss, /\.globe-bare[^{]*\.appbar/);
});

test('just the globe: ?explore=1&chrome=0 drops every control but keeps the credit and a way back', async () => {
  const [js, css, html] = await Promise.all([read('js/action-globe.js'), read('css/action-globe.css'), read('action-globe.html')]);
  assert.match(js, /const BARE=EXPLORE&&new URLSearchParams\(location\.search\)\.get\('chrome'\)==='0'/);
  assert.match(css, /\.globe-bare header,\.globe-bare \.globe-controls,\.globe-bare \.globe-data/);
  assert.doesNotMatch(css, /\.globe-bare[^{]*\.osm-credit\{display:none/);
  assert.match(html, /id="bareExit"[^>]*aria-label="Show the controls again"/);
  assert.match(html, /id="bareEnter"[^>]*href="action-globe\.html\?explore=1&amp;chrome=0"/);
});

test('CCTV on the globe: shaded for guests (tap asks to sign in), locked with the three reasons, only through the Worker, never a fallback frame', async () => {
  const [js, html] = await Promise.all([read('js/action-globe.js'), read('action-globe.html')]);
  assert.match(html, /<button id="ctlCctv"[^>]*aria-pressed="false">/);
  assert.match(js, /async function toggleCctv\(\)\{[^\n]*if\(!sessionToken\(\)\)\{tell\(\{type:'hu:ask-sign-in',reason:'layers'\}\);return\}/);
  assert.match(js, /'\/v1\/world\/cctv\/eligibility'/);
  assert.match(js, /'\/v1\/world\/cctv\/sources'/);
  assert.match(js, /'\/v1\/world\/cctv\/frame\/'\+encodeURIComponent\(id\)/);
  assert.doesNotMatch(js, /prime\.mccluster\.org|\/api\/cctv\//, 'the page never talks to Halo directly');
  for (const words of ['Signed in', 'Privacy Policy agreed', 'A mission completed', 'Find a mission', 'I agree to the Privacy Policy']) assert.ok(js.includes(words), words);
  assert.match(js, /mnet\.html\?view=missions/);
  assert.match(js, /No live frame from this camera right now\. Nothing is shown in its place\./);
  /* location consent IS the privacy acknowledgement (owner, 2026-10-15): no separate consent route, no position sent */
  assert.doesNotMatch(js, /location-consent|location_consent|consent_store/);
  assert.match(js, /fetch\(SB\+'\/auth\/v1\/user',\{method:'PUT'[^\n]*privacy_policy_version:version,privacy_acknowledged_at:/, 'the member records the same two fields the join flow writes');
  assert.doesNotMatch(js.slice(js.indexOf('async function recordPrivacyAck'), js.indexOf('async function recordPrivacyAck') + 800), /coords|latitude/);
  /* near me: the approximate place first; the precise one only through the browser's own prompt */
  assert.match(js, /const ap=access&&access\.approximate_location/);
});

test('new CSS is mobile first: min-width only, no max-width queries, controls at 16px+', async () => {
  const [ag, ca, mn] = await Promise.all([read('css/action-globe.css'), read('css/control-analytics.css'), read('css/mnet.css')]);
  for (const css of [ag, ca]) assert.doesNotMatch(css, /@(media|container)[^{]*max-width/);
  assert.match(ca, /\.cra-filter-select\{[^}]*font-size:max\(16px,1rem\)/);
  assert.match(ca, /\.cra-split\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
});

test('access map: one free layer for guests, every other layer visible but shaded, data-driven from /v1/world/access', async () => {
  const [js, html] = await Promise.all([read('js/action-globe.js'), read('action-globe.html')]);
  for (const id of ['ctlFlights', 'ctlSats', 'ctlLaunch', 'ctlMusic', 'ctlCctv', 'ctlTransport']) assert.match(html, new RegExp('<button id="' + id + '"(?![^>]*hidden)'), id + ' is on screen');
  assert.match(js, /fetch\(API\+'\/v1\/world\/access'/);
  assert.match(js, /if\(id==='flights'\)return null;if\(!sessionToken\(\)\)return\{id,reason:'sign_in_required'/, 'the fallback keeps Flights as the one free layer');
  assert.match(js, /b\.hidden=false;b\.classList\.toggle\('is-locked',!!l\)/, 'locked layers are shaded, not hidden');
  assert.match(js, /if\(l\.reason==='sign_in_required'\|\|!sessionToken\(\)\)\{tell\(\{type:'hu:ask-sign-in'/);
  assert.doesNotMatch(html, /ctlTransport[^>]*McCluster/);
  assert.match(js, /Music on the Earth needs a real place/);
});

test('Whip Equipped: any signed-in member opens it; it says rides are not live and asks drivers to sign up with Whip', async () => {
  const [js, html] = await Promise.all([read('js/action-globe.js'), read('action-globe.html')]);
  assert.match(js, /const tb=\$\('ctlTransport'\);if\(tb\)tb\.onclick=\(\)=>openWhip\(\)/);
  assert.match(js, /function openWhip\(\)\{if\(lockOf\('transport'\)&&explainLock\('transport'\)\)return;/, 'a guest is asked to sign in first');
  assert.doesNotMatch(js, /if\(id==='transport'\)return\{id,reason:'pending_counsel'\}/, 'no longer locked for everyone');
  const whip = js.slice(js.indexOf('function openWhip'), js.indexOf('function openWhip') + 1200);
  assert.match(whip, /Whip Equipped rides aren’t live yet/);
  assert.match(whip, /Are you a driver, or know one\? Have them sign up today\./);
  assert.match(whip, /By Whip Equipped LLC, a separate company\./);
  assert.match(whip, /not approval/);
  assert.match(js, /const WHIP_DRIVER_SIGNUP='https:\/\/matthew\.mccluster\.org\/whip\/driver\/'/);
  assert.doesNotMatch(whip.replace(/https:\/\/matthew\.mccluster\.org\/whip\/driver\//g, ''), /McCluster|\/api\/rides|voter|registration/i, 'Whip attribution only; no ride request; no voter rule');
  assert.match(html, /id="ctlTransport"[^>]*aria-label="Whip Equipped \(by Whip Equipped LLC\): rides not live yet, driver sign-up"/);
});

test('coordinates: a missing degree is never 0 (the coordinate bug), lon/lat order pinned', async () => {
  const [js, an] = await Promise.all([read('js/action-globe.js'), read('js/control-room/analytics.js')]);
  const src = js.slice(js.indexOf('function deg(v)'), js.indexOf('function escHtml('));
  const deg = new Function(src + ';return {deg,lonLat,cellBounds}')();
  for (const v of [null, undefined, '', false, true, [], 'x', NaN, Infinity]) assert.equal(deg.deg(v), null, String(v));
  assert.equal(deg.deg('-97.75'), -97.75);
  assert.deepEqual(deg.lonLat(-97.48, 39.54), [-97.48, 39.54], '[lon, lat] in, [lon, lat] out');
  assert.equal(deg.lonLat(-97.75, null), null, 'no latitude is not the equator');
  assert.equal(deg.lonLat(0, 0), null, 'never 0,0');
  assert.equal(deg.lonLat(39.54, -97.48), null, 'a swapped pair is out of range and dropped');
  assert.deepEqual(deg.cellBounds([-120, 30, -110, 40]), [-120, 30, -110, 40]);
  assert.equal(deg.cellBounds([null, null, -70, 10]), null);
  assert.equal(deg.cellBounds([30, -120, 40, -110]), null, 'west,south,east,north or nothing');
  assert.doesNotMatch(js, /isFinite\(s\.lat\)|isFinite\(c\.lat\)|bd\.every\(isFinite\)|p\.bounds\.every\(isFinite\)/);
  assert.match(an, /var la=deg\(ctr\.lat\),lo=deg\(ctr\.lon\)/);
});
