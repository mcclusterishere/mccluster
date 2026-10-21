/* Hitman's Halo on the admin globe (docs/control-plane/HALO-ADMIN-GLOBE.md): the console loads for the house owner only, on
   the server's word; its layers come only from the Worker's owner-gated routes; the Control Room no longer points at Seek First. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('the globe loads Halo only for the owner the Worker names, only on the full-screen globe, and unmounts it on role loss', () => {
  const js = read('js/action-globe.js');
  assert.match(js, /function isOwner\(\)\{const t=sessionToken\(\);return !!\(t&&access&&access\.release\?\.version==='globe-admin-preview\/v1'&&access\.release\.admin_preview===true&&accessToken===t\)\}/);
  const sync = js.slice(js.indexOf('function haloSync()'), js.indexOf('/* what the Halo console may use'));
  assert.match(sync, /if\(!EXPLORE\|\|BARE\|\|!viewer\)return;/, 'only the full-screen globe mounts the console');
  assert.match(sync, /if\(!owner\)\{if\(window\.HaloConsole\)HaloConsole\.unmount\(\);return\}/, 'role loss unmounts');
  assert.ok(sync.indexOf('if(!owner)') < sync.indexOf('haloScript('), 'no Halo code is fetched before the owner answer');
  assert.match(js, /paintLayerCredits\(\);haloSync\(\)\}/, 'every access repaint re-decides');
  assert.match(js, /const e=pickSolid\(p\.position\);if\(window\.HaloConsole&&HaloConsole\.pick\(e\)\)return;/, 'picks go to the console first');
  /* the frame's door: hidden by default, shown by haloSync for the owner, opening the full-screen globe in the top window */
  assert.match(js, /halo\.id='ctlHalo';halo\.className='globe-ctl';halo\.hidden=true;halo\.href='action-globe\.html\?explore=1&halo=1';halo\.target='_top'/);
  /* the scripts it loads carry this script's version (the deploy stamps only HTML) */
  assert.match(js, /const HU_V=\(\(\)=>\{try\{return new URL\(document\.currentScript\.src\)\.searchParams\.get\('v'\)\|\|''\}catch\(e\)\{return ''\}\}\)\(\);/);
});

test('the console talks only to the Worker, through the globe bridge', () => {
  for (const f of ['js/halo/halo.js', 'js/halo/layers.js']) {
    const js = read(f);
    assert.doesNotMatch(js, /https:\/\//, f + ' names no provider to call (official links are checked as patterns only)');
    assert.doesNotMatch(js, /fetch\((?!G\.api)/, f + ' fetches only G.api');
  }
  const layers = read('js/halo/layers.js');
  assert.match(layers, /fetch\(G\.api \+ '\/v1\/world\/layers\/' \+ id,/);
  const halo = read('js/halo/halo.js');
  assert.match(halo, /fetch\(G\.api \+ '\/v1\/world\/geocode\?q=' \+ encodeURIComponent\(q\.slice\(0, 120\)\)/);
  assert.match(halo, /C\.Cesium3DTileset\.fromIonAssetId\(assets\.photoreal,/, 'photoreal through the ion route the globe already set up');
});

test('the console layers are the Worker\'s release features', () => {
  const ctx = { window: {}, document: { addEventListener() {}, removeEventListener() {} } };
  vm.runInNewContext(read('js/halo/layers.js'), ctx);
  const ids = Object.keys(ctx.window.HaloLayers.SPECS).sort();
  assert.deepEqual(ids, ['cyclones', 'fires', 'military', 'perimeters', 'quakes', 'vessels']);
  const policy = read('packages/release-policy/globe.mjs');
  for (const id of ids) assert.match(policy, new RegExp("'" + id + "'"), id + ' is a release feature, owner-only by the guard');
  assert.match(policy, /\/v1\/world\/geocode/, 'place search is a release feature too');
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
  const ship = L.describe({ haloPick: true, layer: 'vessels', item: { mmsi: '123', name: '', lon: 1, lat: 2, sog: 12.3, cog: 90, heading: null } });
  assert.equal(ship.title, 'MMSI 123');
  assert.equal(L.describe({ layer: 'quakes', item: {} }), null, 'only Halo picks');
  const fire = L.describe({ haloPick: true, layer: 'fires', item: { lon: 0, lat: 0, frp: 12.5, confidence: 'h', acq: '', satellite: 'N20', daynight: 'N' } });
  assert.match(fire.note, /not a confirmed wildfire/);
});

test('the Control Room and the site menu no longer point at Seek First; Hitman Halo opens the admin globe', () => {
  const cr = read('js/control-room-v2.js');
  assert.doesNotMatch(cr, /href: "auth\/seek-first-handoff\.html"/);
  assert.match(cr, /halo: \{ title: "Hitman Halo", href: "action-globe\.html\?explore=1&halo=1"/);
  assert.doesNotMatch(cr, /bridge\.spatial/);
  assert.doesNotMatch(read('js/control-room/workspace.js'), /seek-first-handoff/);
  const nav = read('js/site-navigation.js');
  assert.doesNotMatch(nav, /seek-first-handoff|context:'Seek First'/);
  assert.match(nav, /label:'Halo on the globe', group:'Products', href:new URL\('action-globe\.html\?explore=1&halo=1', house\)\.href/);
});

test('the console keeps to the mobile rules: 44px targets, 16px inputs, minmax columns, min-width breakpoints only', () => {
  const css = read('css/halo.css');
  assert.doesNotMatch(css, /max-width:\s*\d+px\s*\)/, 'no max-width media queries');
  assert.doesNotMatch(css, /repeat\(\d+,\s*1fr\)/, 'minmax(0,1fr), never a bare 1fr');
  assert.match(css, /\.halo__search input\{[^}]*font:400 max\(16px,1rem\)/);
  for (const sel of ['.halo-pill{', '.halo__close{', '.halo-row{', '.halo__tabs button{']) assert.match(css.slice(css.indexOf(sel)), /^[^}]*(min-height:44px|height:44px)/, sel + ' is a full tap target');
  assert.match(css, /@media \(min-width:900px\)/);
});
