/* THE EARTH UP CLOSE (owner, 2026-10-15: "I added an ion, cesium ion key to the McCluster worker"): the World's Earth draws
   Cesium ion through the Worker and never holds the account's token; NASA's Earth far out is untouched; ion is credited.
   The behaviour is driven in a real browser by scripts/e2e/world-ion.e2e.mjs; these pin the contract in the source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

test('the page asks the Worker, with a trailing slash, and clears Cesium\'s built-in token', async () => {
  const js = await read('js/action-globe.js');
  assert.match(js, /Cesium\.Ion\.defaultAccessToken=undefined;Cesium\.Ion\.defaultServer=API\+'\/v1\/world\/ion\/';/);
  assert.match(js, /fetch\(API\+'\/v1\/world\/ion',\{headers:\{accept:'application\/json'\}\}\)/, 'the status comes first');
  assert.doesNotMatch(js, /defaultAccessToken\s*=\s*['"`]/, 'no token is ever written into the page');
  assert.doesNotMatch(js, /eyJhbGciOi/, 'no JWT in the page');
  assert.doesNotMatch(js, /api\.cesium\.com/, 'the page never names ion\'s API');
});

test('the Earth far out is NASA\'s, as before', async () => {
  const js = await read('js/action-globe.js');
  assert.match(js, /const DAY_TILES='https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/BlueMarble_NextGeneration\//);
  assert.match(js, /const NIGHT_TILES='https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/VIIRS_Black_Marble\//);
  assert.match(js, /baseLayer:\(dayLayer=new Cesium\.ImageryLayer\(new Cesium\.UrlTemplateImageryProvider\(\{url:DAY_TILES/);
  assert.match(js, /const ION_HI=3000000,ION_FULL=1200000,ION_OFF=3400000,BUILD_ON=50000,BUILD_OFF=60000,/, 'ion eases in from 3,000 km, whole by 1,200, buildings under 50');
  assert.match(js, /if\(!ionImageryTried&&auto&&h<ION_HI\)/, 'imagery is not even asked for far out');
});

test('terrain never blanks the Earth and never breaks day and night', async () => {
  const js = await read('js/action-globe.js');
  assert.doesNotMatch(js, /setTerrain\(/, 'Scene.setTerrain leaves the globe blank if the terrain fails');
  assert.doesNotMatch(js, /requestVertexNormals\s*:\s*true/, 'vertex normals switch off dayAlpha and nightAlpha');
  assert.match(js, /setTimeout\(\(\)=>land\(null\),TERRAIN_WAIT\)/, 'a slow terrain gives way to the flat Earth');
  assert.match(js, /const land=p=>\{if\(landed\)return;landed=true;ionGround=!!p;g\.terrainProvider=p\|\|flat\}/, 'and a late one is never swapped in');
});

test('ion\'s imagery falls through its assets; any failure leaves the Earth as it was', async () => {
  const js = await read('js/action-globe.js');
  assert.match(js, /layer\.errorEvent\.addEventListener\(e=>\{ionWarn\('imagery '\+id,e\);/);
  assert.match(js, /addIonImagery\(k\+1\)\}\);/);
  assert.match(js, /viewer\.imageryLayers\.add\(layer,viewer\.imageryLayers\.indexOf\(dayLayer\)\+1\)/, 'under the night lights, over the day');
  assert.match(js, /function streetAuto\(h\)\{return h<900000&&!\(ionImagery&&ionImagery\.ready\)\}/, 'the street map yields only to imagery that loaded');
  assert.match(js, /\.then\(ts=>\{ts\.show=false;/, 'buildings start hidden');
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
  assert.match(js, /const land=p=>\{if\(landed\)return;landed=true;ionGround=!!p;/);
  assert.match(js, /if\(!ionBuildingsTried&&ionGround&&auto&&h<BUILD_OFF\*2\)/, 'OSM Buildings only on Cesium World Terrain');
  assert.match(js, /box\.addEventListener\('click',e=>\{if\(!\(e\.target\.closest&&e\.target\.closest\('a\[href\]'\)\)\)viewer\.creditDisplay\.hideLightbox\(\)\}\)/, 'a phone\'s credits panel closes on any tap');
  assert.match(js, /wireDataLayers\(\);const ionP=ionStatus\(\),dataP=Promise\.all\(\[rpc\('action_globe_public_region_missions'\),rpc\('action_globe_public_regions'\)\]\);/, 'the layout and the mission data start before the ion status answers');
  assert.match(js, /\[missions,cities\]=await dataP;/);
  assert.doesNotMatch(js, /function wireControls\(\)\{const on=\(id,f\)=>\{const b=\$\(id\);if\(b\)b\.onclick=f\};wireDataLayers\(\);/, 'wired once');
});
