/* THE WORLD FIRST, AND THE WORLD'S DATA LAYERS (owner, 2026-10-15).

   "Me as a signed in user … I see no globe in the globe section": a member
   whose profile was unfinished got the form instead of the World. Now the
   World is theirs, the step waits in a card, and the actions that need it
   ask. And the Earth carries demo data: flights for everyone (with the
   owner's Vaunt lead), satellites and launches for members, gated by the
   Worker. The behaviour is proven in a browser by scripts/e2e; these pin
   the contract in the source. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');

test('a member with an unfinished profile or contact step gets the World, with the step in a card', async () => {
  const js = await read('js/mnet.js'), html = await read('mnet.html'), css = await read('css/mnet.css');
  assert.match(js, /function needsStep\(\) \{\n    var s = state\.boot && state\.boot\.next_step;\n    return s === "profile" \|\| s === "contact" \? s : "";/);
  assert.match(js, /if \(needsStep\(\)\) \{[\s\S]{0,400}showGate\("app"\);\n        setView\("feed"\);\n        paintSelf\(\);\n        paintFinishCard\(\);/, 'the World, not the form');
  assert.doesNotMatch(js, /location\.replace\("account\.html\?complete=contact"\)/, 'no redirect away from the World at boot');
  assert.doesNotMatch(js, /if \(boot\.next_step === "profile"\) \{\n        fillProfileForm\(false\);\n        showGate\("profile"\);/, 'the old gate is gone');
  assert.match(js, /var publicRead = state\.guest \|\| !!needsStep\(\);/, 'public posts until the step is done');
  assert.match(js, /if \(askToFinish\("mission"\)\) return;/, 'joining a mission asks to finish');
  assert.match(js, /if \(name !== "feed" && name !== "missions" && askToFinish\(name\)\) return;/, 'the member rooms ask to finish; the feed and the missions stay open');
  assert.match(js, /\$\("mnFinishGo"\)\.onclick = function \(\) \{ askToFinish\("act"\); \};/);
  assert.match(js, /setView\(needsStep\(\) \? "feed" : "profile"\)/, 'a finished profile lands back on the feed');
  assert.match(js, /if \(step === "contact"\) \{ location\.assign\("account\.html\?complete=contact"\); return true; \}/, 'the contact step still lives on the account page, opened on purpose');
  assert.match(html, /<aside class="mn__guest-card mn__finish-card" id="mnFinishCard" hidden>/);
  assert.match(html, /<button class="mn__world-go" type="button" id="mnFinishGo">Finish your profile \u2192<\/button>/);
  assert.match(css, /\.mn__finish-card:not\(\[hidden\]\) \{ display: block; \}/);
});

test('the globe carries three data layers: flights for everyone, satellites and launches for members', async () => {
  const globe = await read('js/action-globe.js'), page = await read('action-globe.html'), css = await read('css/action-globe.css');
  assert.match(page, /<div class="globe-data" role="group" aria-label="Data layers"><button id="ctlFlights"[^>]*aria-pressed="false">[\s\S]*?<button id="ctlSats"[^>]*data-members="1">[\s\S]*?<button id="ctlLaunch"[^>]*data-members="1">/);
  assert.match(page, /<span id="layerCredits"><\/span>Imagery: /, 'each source is credited on the imagery line while it is on');
  assert.match(globe, /const API='https:\/\/api\.mccluster\.org';/);
  assert.match(globe, /flights:\{id:'ctlFlights',members:false/); assert.match(globe, /satellites:\{id:'ctlSats',members:true/); assert.match(globe, /launches:\{id:'ctlLaunch',members:true/);
  assert.match(globe, /if\(spec\.members&&!sessionToken\(\)\)\{tell\(\{type:'hu:ask-sign-in',reason:'layers'\}\);return\}/, 'a guest\'s lock opens sign-in and sends nothing');
  assert.match(globe, /if\(r\.status===401\)throw Error\('members'\)/, 'the Worker\'s refusal, not the page\'s flag, is the gate');
  assert.match(globe, /headers\.authorization='Bearer '\+t/);
  assert.match(globe, /new Cesium\.PointPrimitiveCollection\(\)/, 'thousands of points, one primitive');
  assert.match(globe, /t\.src='vendor\/satellite\.min\.js'/, 'SGP4 loads only when the layer is on');
  assert.match(globe, /L\.timer=setInterval\(stepSatellites,1500\)/, 'satellites move');
  assert.match(globe, /window\.__huLayerCounts=\(\)=>/);
  assert.match(css, /\.globe-data\{position:absolute;z-index:6;left:10px;bottom:34px;display:flex;gap:8px\}/);
  assert.match(css, /\.globe-ctl\.is-locked::after\{content:"";/, 'the lock is a red dot, drawn in CSS');
  await access(join(ROOT, 'vendor/satellite.min.js'));
  assert.match(await read('vendor/satellite.LICENSE.txt'), /satellite\.js 5\.0\.0[\s\S]*MIT/);
  assert.match((await read('vendor/satellite.min.js')).slice(0, 200), /satellite-js v5\.0\.0/);
});

test('the page writes the layers\' line over the Earth, and Flights carries the owner\'s Vaunt lead', async () => {
  const js = await read('js/mnet.js'), html = await read('mnet.html'), css = await read('css/mnet.css');
  assert.match(html, /<p class="mn__world-layers" id="mnWorldLayers" aria-live="polite" hidden><\/p>/);
  assert.match(js, /var VAUNT_LEAD = "https:\/\/vauntapi\.flyvaunt\.com\/referral\/nuao1K";/, 'the referral link the front page\'s VR wall already carries');
  assert.equal((await read('index.html')).includes('https://vauntapi.flyvaunt.com/referral/nuao1K'), true, 'the same link, not a new one');
  assert.match(js, /aircraft in the air right now/);
  assert.match(js, /<a class="mn__world-lead" href="' \+ VAUNT_LEAD \+ '" target="_blank" rel="noopener sponsored">Don\\u2019t want to fly commercial\? Fly private with Vaunt \\u2192<\/a>/);
  assert.match(js, /satellites overhead, moving live/);
  assert.match(js, /launches coming up/);
  assert.match(js, /d\.type === "hu:ask-sign-in"/); assert.match(js, /d\.type === "hu:layer" && typeof d\.layer === "string"/);
  assert.match(js, /layers:"Sign in to see satellites and space missions on the Earth\."/);
  assert.match(css, /\.mn__world-layers \{ position: absolute; z-index: 4; left: 12px; bottom: 82px;/);
});

test('the Worker serves the three layers, members only for two, and the pins SQL waits for the owner', async () => {
  const w = await read('workers/mccluster/src/world-layers.js');
  assert.match(w, /flights: \{ public: true, ttl: 600/); assert.match(w, /satellites: \{ public: false, ttl: 7200/); assert.match(w, /launches: \{ public: false, ttl: 1800/);
  assert.match(w, /const user = await bearerUser\(request, env, fetchImpl\);\n    if \(!user\) return fail\(/);
  assert.match(w, /OpenSky's data is for non-commercial research/, 'the licence caveat is written where the code is');
  await access(join(ROOT, 'workers/mccluster/test/world-layers.test.mjs'));
  const sql = await read('supabase/pending/action_globe_demo_pins_v1.sql');
  assert.match(sql, /insert into public\.action_globe_regions \(region_key, country_code, subdivision_code, region_label, centroid_lat, centroid_lon\)/);
  assert.match(sql, /\('US-CT', 'US', 'CT', 'Connecticut', 41\.6032, -73\.0877\)/);
  assert.match(sql, /when m\.campaign_id = 'critical-minerals-drc-001' then 'CD-HK'/);
  assert.match(sql, /on conflict \(mission_id\) do update/);
  assert.match(await read('supabase/pending/README.md'), /action_globe_demo_pins_v1\.sql/);
});
