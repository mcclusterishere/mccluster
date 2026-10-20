/* THE EARTH UP CLOSE (owner, 2026-10-15: "I added an ion, cesium ion key to the McCluster worker"): for a signed-in member the
   World's Earth draws Cesium ion through the Worker, sending the member's session as a bearer header, and never holds the
   account's token; a logged-out page never touches ion; NASA's Earth far out is untouched; ion is credited.
   The behaviour is driven in a real browser by scripts/e2e/world-ion.e2e.mjs; these pin the contract in the source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

test('the page asks the Worker, with a trailing slash, and clears Cesium\'s built-in token', async () => {
  const js = await read('js/action-globe.js');
  assert.match(js, /Cesium\.Ion\.defaultAccessToken=undefined;ionServer=new Cesium\.Resource\(\{url:API\+'\/v1\/world\/ion\/',headers:\{Authorization:bearer\},retryAttempts:1e9,retryCallback:ionRetry\}\);Cesium\.Ion\.defaultServer=ionServer;/);
  assert.match(js, /fetch\(API\+'\/v1\/world\/ion',\{headers:\{accept:'application\/json',authorization:ionBearer\(\)\}\}\)/, 'the status comes first');
  assert.doesNotMatch(js, /defaultAccessToken\s*=\s*['"`]/, 'no token is ever written into the page');
  assert.doesNotMatch(js, /eyJhbGciOi/, 'no JWT in the page');
  assert.doesNotMatch(js, /api\.cesium\.com/, 'the page never names ion\'s API');
});

test('the Earth far out is NASA\'s, as before', async () => {
  const js = await read('js/action-globe.js');
  assert.match(js, /const DAY_TILES='https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/BlueMarble_NextGeneration\//);
  assert.match(js, /const NIGHT_TILES='https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/VIIRS_CityLights_2012\//);
  assert.match(js, /baseLayer:\(dayLayer=new Cesium\.ImageryLayer\(new Cesium\.UrlTemplateImageryProvider\(\{url:DAY_TILES/);
  assert.match(js, /const ION_HI=3000000,ION_FULL=1200000,ION_OFF=3400000,BUILD_ON=50000,BUILD_OFF=60000,/, 'ion eases in from 3,000 km, whole by 1,200, buildings under 50');
  assert.match(js, /if\(!ionImageryTried&&auto&&h<ION_HI\)/, 'imagery is not even asked for far out');
});

test('terrain never blanks the Earth and never breaks day and night', async () => {
  const js = await read('js/action-globe.js');
  assert.doesNotMatch(js, /setTerrain\(/, 'Scene.setTerrain leaves the globe blank if the terrain fails');
  assert.doesNotMatch(js, /requestVertexNormals\s*:\s*true/, 'vertex normals switch off dayAlpha and nightAlpha');
  assert.match(js, /setTimeout\(\(\)=>land\(null\),TERRAIN_WAIT\)/, 'a slow terrain gives way to the flat Earth');
  assert.match(js, /const land=p=>\{if\(landed\)return;landed=true;ionGround=!!\(p&&ion\);g\.terrainProvider=ionGround\?p:flat\}/, 'and a late one is never swapped in, nor one that lands after ion stepped aside');
});

test('ion\'s imagery falls through its assets; any failure leaves the Earth as it was', async () => {
  const js = await read('js/action-globe.js');
  assert.match(js, /layer\.errorEvent\.addEventListener\(e=>\{ionWarn\('imagery '\+id,e\);/);
  assert.match(js, /addIonImagery\(k\+1\)\}\);/);
  assert.match(js, /viewer\.imageryLayers\.add\(layer,viewer\.imageryLayers\.indexOf\(dayLayer\)\+1\)/, 'under the night lights, over the day');
  const source = js.match(/function streetAuto\(h\)\{[^}]+\}/)?.[0];
  assert.ok(source, 'street imagery has a single automatic visibility decision');
  const street = (travelMode, roadRoute, currentLocation, ionImagery, height = 1500) =>
    new Function('travelMode', 'roadRoute', 'currentLocation', 'ionImagery', source + ';return streetAuto;')(travelMode, roadRoute, currentLocation, ionImagery)(height);
  assert.equal(street(false, null, null, null), true, 'ordinary World still has a street map while aerial imagery is absent');
  assert.equal(street(false, null, null, { ready: false }), true, 'loading aerial imagery cannot blank the street map');
  assert.equal(street(false, {}, {}, { ready: true }), false, 'outside travel, loaded aerial imagery keeps its existing priority');
  assert.equal(street(true, null, null, { ready: true }), false, 'travel without a local route or location keeps the existing aerial view');
  assert.equal(street(true, {}, null, { ready: true }), true, 'directions show the street map even when aerial imagery is ready');
  assert.equal(street(true, null, {}, { ready: true }), true, 'a current location also makes street labels available');
  assert.equal(street(true, {}, {}, { ready: true }, 900000), false, 'the wide Earth still yields to its NASA and aerial layers');
  assert.match(js, /\.then\(ts=>\{if\(!ion\)\{ts\.destroy\(\);return\}ts\.show=false;/, 'buildings start hidden, and are dropped if ion stepped aside meanwhile');
  assert.match(js, /,e=>ionWarn\('buildings',e\)\)/);
});

test('ion is credited on the imagery line, only while the World draws from it', async () => {
  const [html, css, js] = await Promise.all([read('action-globe.html'), read('css/action-globe.css'), read('js/action-globe.js')]);
  assert.match(html, /© OpenStreetMap<\/a><span id="ionCredits" class="ion-credits"><\/span><\/p>/);
  assert.match(js, /creditContainer:ion\?\$\('ionCredits'\):undefined/);
  assert.match(css, /\.ion-credits\{display:none\}/);
  assert.match(css, /\.globe-ion \.ion-credits\{display:inline\}/);
  assert.match(css, /\.ion-credits \.cesium-widget-credits\{position:static!important;/, 'Cesium positions its credits absolutely; on the line they flow');
});

test('the Worker route, its tests and the browser drive exist', async () => {
  for (const p of ['workers/mccluster/src/world-ion.js', 'workers/mccluster/test/world-ion.test.mjs', 'scripts/e2e/world-ion.e2e.mjs']) await access(new URL('../../' + p, import.meta.url));
  const worker = await read('workers/mccluster/src/world-ion.js');
  assert.match(worker, /export const ION_ASSETS = Object\.freeze\(\{ terrain: 1, imagery: Object\.freeze\(\[3, 2, 3954\]\), buildings: 96188 \}\);/);
  for (const e2e of ['scripts/e2e/world-screen.e2e.mjs', 'scripts/e2e/human-uprise-door.e2e.mjs', 'scripts/e2e/anti-social.e2e.mjs']) {
    assert.match(await read(e2e), /if \(u\.pathname === '\/v1\/world\/ion'\) return json\(route, \{ ok: true, available: false, binding: null \}\);/, e2e);
  }
});

test('the review\'s fixes hold: night lights give way, buildings wait for real ground, the credits close on a tap, nothing waits that need not', async () => {
  const js = await read('js/action-globe.js');
  assert.match(js, /if\(nightLayer\)\{const n=ionImagery\.ready&&on\?1-a:1;if\(nightLayer\.nightAlpha!==n\)nightLayer\.nightAlpha=n\}/, 'Black Marble is opaque over the aerial imagery; it fades out as the imagery fades in');
  assert.match(js, /const land=p=>\{if\(landed\)return;landed=true;ionGround=!!\(p&&ion\);/);
  assert.match(js, /if\(!ionBuildingsTried&&ionGround&&auto&&h<BUILD_OFF\*2\)/, 'OSM Buildings only on Cesium World Terrain');
  assert.match(js, /box\.addEventListener\('click',e=>\{if\(!\(e\.target\.closest&&e\.target\.closest\('a\[href\]'\)\)\)viewer\.creditDisplay\.hideLightbox\(\)\}\)/, 'a phone\'s credits panel closes on any tap');
  assert.ok(js.includes("wireDataLayers();const ionP=Promise.race([loadAccess().then(()=>lockOf('ion')?null:ionStatus())")); assert.ok(js.includes("dataP=Promise.all([NO_MISSIONS?Promise.resolve([]):rpc('action_globe_public_region_missions')"));
  assert.match(js, /\[missions,cities\]=await dataP;/);
  assert.doesNotMatch(js, /function wireControls\(\)\{const on=\(id,f\)=>\{const b=\$\(id\);if\(b\)b\.onclick=f\};wireDataLayers\(\);/, 'wired once');
});

test('members only: a logged-out page never asks the ion route, not even its status, and never reaches ion', async () => {
  const js = await read('js/action-globe.js');
  assert.match(js, /function ionBearer\(\)\{const t=sessionToken\(\);return t\?'Bearer '\+t:''\}/);
  assert.match(js, /function ionStatus\(\)\{if\(!ionBearer\(\)\)return Promise\.resolve\(null\);/, 'no session: no status request');
  assert.match(js, /function startIon\(\)\{if\(!ion\|\|!viewer\)return;const bearer=ionBearer\(\);if\(!bearer\)\{ion=null;return\}/, 'no session: no ion server, no asset request');
  assert.equal((js.match(/API\+'\/v1\/world\/ion/g) || []).length, 2, 'the status and the server are the only two places the route is named');
});

test('the member\'s session rides in a header, never in a URL; it rotates; a refusal hands the Earth back to NASA once', async () => {
  const js = await read('js/action-globe.js');
  assert.doesNotMatch(js, /access_token=|[?&]token=|queryParameters/, 'no credential in any URL');
  assert.doesNotMatch(js, /Ion\.defaultServer=API/, 'never a bare URL server, which would drop the header');
  assert.match(js, /if\(code===401\)\{const b=ionBearer\(\);if\(b&&resource\.headers\.Authorization!==b\)\{resource\.headers\.Authorization=b;if\(ionServer\)ionServer\.headers\.Authorization=b;return true\}\}/, 'a stale session is swapped for the newest one, once per change');
  assert.match(js, /if\(code===401\|\|code===403\|\|code===429\|\|code===503\)ionOff\(/, 'refused: ion steps aside');
  assert.match(js, /function ionOff\(why\)\{if\(!ion\)return;ionWarn\('off',why\);ion=null;document\.documentElement\.classList\.remove\('globe-ion'\);/, 'once, then quiet');
  assert.match(js, /function ionWarn\(what,e\)\{if\(!ion\)return;/, 'no console noise after ion stepped aside');
  assert.match(js, /if\(ionGround\)\{ionGround=false;viewer\.scene\.globe\.terrainProvider=new Cesium\.EllipsoidTerrainProvider\(\)\}/);
  assert.match(js, /window\.addEventListener\('storage',e=>\{if\(e&&e\.key&&e\.key!=='mccdb_session'\)return;if\(!ion\)return;const b=ionBearer\(\);if\(!b\)ionOff\('signed out'\);else ionServer\.headers\.Authorization=b\}\);/, 'signing out elsewhere switches ion off; a new session is used from then on');
});

test('the Worker gates the asset endpoint on a signed-in member, not on Origin alone', async () => {
  const worker = await read('workers/mccluster/src/world-ion.js');
  assert.match(worker, /const user = await bearerUser\(request, env, fetchImpl\);\n  if \(!user\) \{/);
  assert.match(worker, /members_only: true/);
});
