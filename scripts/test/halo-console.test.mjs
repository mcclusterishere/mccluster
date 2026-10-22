/* Hitman's Halo on the admin globe (docs/control-plane/HALO-ADMIN-GLOBE.md, docs/design/halo/HALO-VIEW-DESIGN.md): the view loads
   for the house owner only, on the server's word, and only from a Halo link; it reads only the Worker; it draws no logo; it never
   puts a person on the Earth; the Control Room no longer points at Seek First. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('the globe loads Halo only for the owner the Worker names, only on the full-screen globe from a Halo link, and unmounts it on role loss', () => {
  const js = read('js/action-globe.js');
  assert.match(js, /function isOwner\(\)\{const t=sessionToken\(\);return !!\(t&&access&&access\.release\?\.version==='globe-admin-preview\/v1'&&access\.release\.admin_preview===true&&accessToken===t\)\}/);
  const sync = js.slice(js.indexOf('function haloSync()'), js.indexOf('/* what the Halo console may use'));
  assert.match(sync, /if\(!EXPLORE\|\|BARE\|\|!viewer\)return;/, 'only the full-screen globe mounts the view');
  assert.match(sync, /if\(!owner\)\{if\(window\.HaloConsole\)HaloConsole\.unmount\(\);return\}/, 'role loss unmounts');
  assert.match(sync, /if\(HALO_OPEN===null\)return;/, 'the view opens only from a Halo link (?halo=…)');
  assert.ok(sync.indexOf('if(!owner)') < sync.indexOf('haloScript('), 'no Halo code is fetched before the owner answer');
  assert.match(sync, /enter\.hidden=!owner\|\|HALO_OPEN!==null;/, 'the header door shows for the owner only');
  assert.match(sync, /Promise\.all\(\['css\/halo\.css','css\/halo-hud\.css'\]\.map\(haloStyle\)\)/, 'the styles land before the view mounts');
  assert.match(js, /paintLayerCredits\(\);haloSync\(\)\}/, 'every access repaint re-decides');
  assert.match(js, /const e=pickSolid\(p\.position\);if\(window\.HaloConsole&&HaloConsole\.pick\(e\)\)return;/, 'picks go to Halo first');
  assert.match(js, /halo\.id='ctlHalo';halo\.className='globe-ctl';halo\.hidden=true;halo\.href='action-globe\.html\?explore=1&halo=1';halo\.target='_top'/);
  assert.match(js, /const HU_V=\(\(\)=>\{try\{return new URL\(document\.currentScript\.src\)\.searchParams\.get\('v'\)\|\|''\}catch\(e\)\{return ''\}\}\)\(\);/);
  for (const f of ['vision', 'hud', 'layers', 'data', 'chart', 'halo']) assert.ok(sync.includes("'js/halo/" + f + ".js'"), f + ' is loaded');
});

test('the view talks only to the Worker, through the globe bridge', () => {
  for (const f of ['js/halo/halo.js', 'js/halo/layers.js', 'js/halo/data.js', 'js/halo/chart.js']) {
    const js = read(f);
    assert.doesNotMatch(js, /https:\/\//, f + ' names no provider to call (official links are checked as patterns only)');
    assert.doesNotMatch(js, /fetch\((?!G\.api)/, f + ' fetches only G.api');
  }
  const data = read('js/halo/data.js');
  for (const path of ['/v1/world/halo/missions', '/v1/world/halo/people', '/v1/intel/evidence', '/v1/intel/health', '/v1/news-briefs?day=', '/v1/world/tides/']) assert.ok(data.includes(path), path);
  const halo = read('js/halo/halo.js');
  assert.match(halo, /fetch\(G\.api \+ '\/v1\/world\/geocode\?q=' \+ encodeURIComponent\(q\.slice\(0, 120\)\)/);
  assert.match(halo, /C\.Cesium3DTileset\.fromIonAssetId\(assets\.photoreal,/, 'photoreal through the ion route the globe already set up');
});

test('the view\'s layers are the Worker\'s release features', () => {
  const ctx = { window: {}, document: { addEventListener() {}, removeEventListener() {} } };
  vm.runInNewContext(read('js/halo/layers.js'), ctx);
  const ids = Object.keys(ctx.window.HaloLayers.SPECS).sort();
  assert.deepEqual(ids, ['cyclones', 'fires', 'military', 'perimeters', 'quakes', 'tides', 'vessels']);
  const policy = read('packages/release-policy/globe.mjs');
  for (const id of ids) assert.match(policy, new RegExp("'" + id + "'"), id + ' is a release feature, owner-only by the guard');
  assert.match(policy, /\/v1\/world\/geocode/, 'place search is a release feature too');
  assert.match(policy, /'halo-ops'/, 'missions and people are a release feature');
  assert.equal(ctx.window.HaloLayers.PROVENANCE.tides, 'reference', 'a station is reference data, not a reading');
});

test('a share link reproduces the shared layers exactly, and a stale layer reads the provider\'s own age (Codex #588)', () => {
  const halo = read('js/halo/halo.js');
  assert.match(halo, /for \(const it of ALL_ITEMS\) \{ if \(it\.planned\) continue; const want = v\.l\.includes\(it\.id\); if \(want !== isOn\(it\)\) await setItem\(it, want\); \}/, 'names on, everything else off');
  assert.match(halo, /l: Array\.isArray\(p\.layers\) \? p\.layers : null/, 'a first visit keeps the globe\'s defaults');
  const layers = read('js/halo/layers.js');
  assert.match(layers, /L\.fetched = Number\.isFinite\(provided\) \? provided : body \? L\.checked : L\.fetched;/, 'freshness from the Worker\'s fetched_at');
  assert.match(layers, /if \(Date\.now\(\) - L\.checked >= SPECS\[id\]\.every - 500\) load\(id\);/, 'polling on this page\'s own clock');
});

test('a picked Halo item opens only what its provider said, and links only to the official page', () => {
  const ctx = { window: {}, document: { addEventListener() {}, removeEventListener() {} } };
  vm.runInNewContext(read('js/halo/layers.js'), ctx);
  ctx.window.Cesium = { Cartesian3: { fromDegrees: (lon, lat, h) => ({ lon, lat, h }) } };
  const L = ctx.window.HaloLayers.create({ viewer: () => null, api: 'https://api.mccluster.org', token: () => 'x' });
  const quake = L.describe({ haloPick: true, layer: 'quakes', item: { mag: 5.4, place: 'Fixture', time: '2026-10-21T00:00:00Z', lon: -71.5, lat: -33.4, depth: 12, url: 'https://evil.example/x', tsunami: false, alert: '' } });
  assert.equal(quake.title, 'M5.4 · Fixture');
  assert.equal(quake.link, '', 'a link off USGS is never offered');
  assert.equal(L.describe({ haloPick: true, layer: 'quakes', item: { url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1', lon: 0, lat: 0 } }).link, 'https://earthquake.usgs.gov/earthquakes/eventpage/us1');
  assert.equal(L.describe({ haloPick: true, layer: 'vessels', item: { mmsi: '123', name: '', lon: 1, lat: 2, sog: 12.3, cog: 90, heading: null } }).title, 'MMSI 123');
  assert.equal(L.describe({ layer: 'quakes', item: {} }), null, 'only Halo picks');
  assert.match(L.describe({ haloPick: true, layer: 'fires', item: { lon: 0, lat: 0, frp: 12.5, confidence: 'h', acq: '', satellite: 'N20', daynight: 'N' } }).note, /not a confirmed wildfire/);
  const station = L.describe({ haloPick: true, layer: 'tides', item: { id: '8465705', name: 'New Haven', lon: -72.9, lat: 41.28, state: 'CT' } });
  assert.equal(station.tide, '8465705', 'a station opens its water level');
  assert.match(station.note, /not a tide prediction/);
});

test('the Halo mark is the supplied artwork, scaled; nothing is drawn in its place', () => {
  const halo = read('js/halo/halo.js');
  assert.match(halo, /<a class="hx-brand"[^>]*><img src="assets\/img\/hm-mark-96\.png" alt="" width="96" height="96"><span>Hitman’s Halo<\/span><\/a>/);
  assert.doesNotMatch(halo.slice(halo.indexOf('hx-brand'), halo.indexOf('hx-brand') + 300), /<svg/, 'no drawn mark beside it');
  assert.match(read('css/halo.css'), /\.hx-brand img\{flex:none;width:36px;height:36px;object-fit:contain\}/, 'scaled whole, never cropped');
});

test('People never puts a person on the Earth: its marks are mission places, and a location always reads Not shared', () => {
  const halo = read('js/halo/halo.js');
  const people = halo.slice(halo.indexOf("} else if (view === 'people') {"), halo.indexOf("} else if (view === 'intel') {"));
  assert.match(people, /const m = missionById\(x\.id\); if \(placed\(m\)\)/, 'a person is counted at their mission\'s place');
  assert.match(people, /lon: m\.place\.lon, lat: m\.place\.lat/);
  assert.doesNotMatch(halo, /\bp\.(lat|lon|location|region|last_seen)/, 'no person coordinates, region or presence are read');
  assert.match(halo, /\['Location', 'Not shared'\]/);
});

test('the Control Room and the site menu no longer point at Seek First; every Halo door opens the one Halo', () => {
  const cr = read('js/control-room-v2.js');
  assert.doesNotMatch(cr, /href: "auth\/seek-first-handoff\.html"/);
  assert.match(cr, /halo: \{ title: "Hitman’s Halo", href: "action-globe\.html\?explore=1&halo=1"/);
  assert.doesNotMatch(cr, /bridge\.spatial/);
  assert.doesNotMatch(read('js/control-room/workspace.js'), /seek-first-handoff/);
  const nav = read('js/site-navigation.js');
  assert.doesNotMatch(nav, /seek-first-handoff|context:'Seek First'/);
  /* one Halo (owner, 2026-10-22: "it takes you to multiple different places"): the menu's Hitman's Halo is the four screens,
     never the separate app, and there is no second Halo entry */
  assert.match(nav, /label:'Hitman’s Halo', group:'Products', href:new URL\('action-globe\.html\?explore=1&halo=1', house\)\.href/);
  assert.doesNotMatch(nav, /prime\.mccluster\.org|Halo on the globe/);
  for (const f of ['js/control-room-v2.js', 'js/control-room/workspace.js', 'js/control-room/workspace-core.js', 'js/action-globe.js', 'js/halo/halo.js'])
    assert.doesNotMatch(read(f), /prime\.mccluster\.org/, f + ' links no other Halo');
});

test('the view keeps to the mobile rules: 44px targets, 16px inputs, minmax columns, min-width breakpoints only', () => {
  const css = read('css/halo.css');
  assert.doesNotMatch(css, /@media[^{]*max-width/, 'no max-width media queries');
  assert.doesNotMatch(css, /repeat\(\d+,\s*1fr\)|grid-template-columns:[^;}]*(?<!minmax\(0,)\b1fr/, 'minmax(0,1fr), never a bare 1fr');
  for (const sel of ['.hx-find input{', '.hx-search input{', '.hx-window{', '.hx-filter select{']) assert.match(css.slice(css.indexOf(sel)), /^[^}]*font:400 max\(16px,1rem\)/, sel + ' never zooms the page');
  for (const sel of ['.hx-tabs button{', '.hx-seg button{', '.hx-operator{', '.hx-layers-btn{', '.hx-collapse{', '.hx-close{', '.hx-grip{', '.hx-disclose{', '.hx-axis__ev{', '.hx-cta,.hx-btn{', '.hx-brand{'])
    assert.match(css.slice(css.indexOf(sel)), /^[^}]*(min-height:44px|height:44px)/, sel + ' is a full tap target');
  assert.match(css, /\.hx-ctl button\{display:grid;place-items:center;width:44px;height:44px/);
  assert.match(css, /@media \(min-width:768px\)/);
  assert.match(css, /@media \(min-width:1200px\)/);
});
