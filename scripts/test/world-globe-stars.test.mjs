import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../js/action-globe.js', import.meta.url), 'utf8');
const start = source.indexOf('function styleScene(){');
const end = source.indexOf('\nconst CONTINENTS=', start);
assert.ok(start >= 0 && end > start, 'exercise the actual production scene styling');
const styleSource = source.slice(start, end);

function sceneStyle({ editorial = true, sky = true } = {}) {
  const scene = {
    globe: { tilesLoaded: true }, skyAtmosphere: {},
    skyBox: sky === null ? undefined : { show: sky },
    sun: { show: true }, moon: { show: true }
  };
  const context = {
    viewer: { scene, clock: {}, camera: { changed: { addEventListener() {} } } },
    Cesium: {
      Color: { fromCssColorString: value => value },
      Ellipsoid: { WGS84: { maximumRadius: 6378137 } },
      ClockStep: { SYSTEM_CLOCK: 'system' }, SunLight: class SunLight {}
    },
    EDITORIAL: editorial, window: {}, dayLayer: {}, nightLayer: {}, cloudLayer: {},
    NIGHT_LIGHTS: { brightness: 6, contrast: 1.1, gamma: .85 },
    EDITORIAL_CLOUD_ALPHA: .65,
    sizeEditorialResolution() {}, travelStyle() {}, cullLabels() {}
  };
  runInNewContext(`${styleSource}\nstyleScene();`, context);
  return { scene, context, style: context.window.__huGlobeStyle() };
}

test('the public globe keeps Cesium stars with its existing Earth, cloud and lighting treatment', () => {
  const { scene, context, style } = sceneStyle();
  assert.equal(scene.skyBox.show, true, 'the public globe must not suppress its starfield');
  assert.equal(style.stars, true, 'the browser acceptance hook reports the actual skybox state');
  assert.equal(scene.globe.enableLighting, true);
  assert.equal(scene.globe.dynamicAtmosphereLightingFromSun, true);
  assert.equal(scene.sun.show, false, 'preserve the existing Sun-disc treatment');
  assert.equal(scene.moon.show, false, 'preserve the existing Moon-disc treatment');
  assert.equal(context.dayLayer.saturation, 1.1);
  assert.equal(context.cloudLayer.alpha, .65);
  assert.equal(context.nightLayer.show, true);
});

test('reapplying the public scene style restores the same starfield without replacing it', () => {
  const { scene, style } = sceneStyle({ sky: false });
  assert.equal(scene.skyBox.show, true);
  assert.equal(style.stars, true);
});

test('the public scene tolerates an absent skybox without claiming stars are rendered', () => {
  const { style } = sceneStyle({ sky: null });
  assert.equal(style.stars, false);
});

for (const sky of [true, false]) test(`Analytics keeps its own skybox choice (${sky})`, () => {
  const { scene, style } = sceneStyle({ editorial: false, sky });
  assert.equal(scene.skyBox.show, sky);
  assert.equal(style.stars, sky);
  assert.equal(scene.sun.show, true);
  assert.equal(scene.moon.show, true);
});
