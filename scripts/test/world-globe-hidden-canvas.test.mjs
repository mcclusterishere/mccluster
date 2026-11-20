/* THE GLOBE SURVIVES A HIDDEN WORLD (release review RS-2, 2026-11-19). The World hides its globe frame when a member opens the
   Action Record or the profile, and when a guest signs in from a mission's Join and lands on that mission: the canvas inside the
   frame becomes 0 x 0. The editorial globe's ResizeObserver (js/action-globe.js) then fitted a whole Earth to that canvas, and
   homeAltitude() answered Infinity for an aspect of 0; written into the camera it made every position NaN, and on the way back
   Cesium stopped rendering for good ("Rendering has stopped. RangeError: Invalid array length", its red error panel over the
   Earth). These run the production homeAltitude() and the production ResizeObserver statement, cut from js/action-globe.js, on
   a fake viewer. The round trip in a browser, with the real globe, is scripts/e2e/world-missions-guest.e2e.mjs
   ("world-hidden-and-back").
     node --test scripts/test/world-globe-hidden-canvas.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../js/action-globe.js', import.meta.url), 'utf8');
const cut = (from, to) => { const a = source.indexOf(from); assert.ok(a >= 0, 'found: ' + from); const b = source.indexOf(to, a); assert.ok(b > a, 'found the end of: ' + from); return source.slice(a, b + to.length); };
const HOME = cut('function homeAltitude(){', '\nfunction homePosition(){').replace(/\nfunction homePosition\(\)\{$/, '');
const OBSERVER = cut('if(EDITORIAL&&window.ResizeObserver){let sizeTimer;new ResizeObserver(', '.observe(viewer.scene.canvas)}');
const R = 6378137;

function world({ width, height, cameraHeight = 2.6e7, editorial = true }) {
  const views = [], observers = [];
  const canvas = { clientWidth: width, clientHeight: height };
  const viewer = {
    scene: { canvas },
    camera: { frustum: { fovy: Math.PI / 3 }, positionCartographic: { longitude: -0.6, latitude: 0.43, height: cameraHeight }, setView: (v) => views.push(v) }
  };
  const context = {
    EDITORIAL: editorial, EXPLORE: false, viewer, selectionShown: false, Number, Math,
    document: { documentElement: { classList: { contains: () => true } } },
    Cesium: { Ellipsoid: { WGS84: { maximumRadius: R } }, Cartesian3: { fromRadians: (lon, lat, h) => ({ lon, lat, h }) } },
    window: { ResizeObserver: true },
    ResizeObserver: class { constructor(cb) { observers.push(cb); } observe() {} },
    setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {},
    sizeEditorialResolution() {}
  };
  runInNewContext(`${HOME}\n${OBSERVER}\nthis.homeAltitude = homeAltitude;`, context);
  return { canvas, viewer, views, resize: () => observers.forEach((cb) => cb()), homeAltitude: context.homeAltitude };
}

test('homeAltitude() answers a finite height above the Earth for every canvas, a hidden 0 x 0 one included', () => {
  for (const [w, h] of [[390, 363], [1280, 800], [820, 520], [0, 0], [390, 0], [0, 363]]) {
    const g = world({ width: w, height: h });
    const alt = g.homeAltitude();
    assert.ok(Number.isFinite(alt) && alt > 0, `${w} x ${h}: ${alt}`);
  }
  /* a shown canvas still gets its fitted Earth, closer on a wide frame than the whole-Earth fallback */
  const shown = world({ width: 390, height: 363 }).homeAltitude(), hidden = world({ width: 0, height: 0 }).homeAltitude();
  assert.ok(shown !== hidden, 'a shown canvas is fitted, not the fallback');
  assert.equal(hidden, 12500000, 'a hidden canvas answers the network band\'s whole Earth');
});

test('the editorial ResizeObserver leaves the camera alone while the canvas is 0 x 0, and fits it again once shown', () => {
  const g = world({ width: 390, height: 363 });
  g.canvas.clientWidth = 0; g.canvas.clientHeight = 0;
  g.resize();
  assert.equal(g.views.length, 0, 'nothing is written into the camera while the World is hidden');
  g.canvas.clientWidth = 390; g.canvas.clientHeight = 363;
  g.resize();
  assert.equal(g.views.length, 1, 'the shown canvas is fitted again');
  const d = g.views[0].destination;
  assert.ok([d.lon, d.lat, d.h].every(Number.isFinite) && d.h > 0, JSON.stringify(d));
});
