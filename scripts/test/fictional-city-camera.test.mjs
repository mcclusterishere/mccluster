import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCameraControls, safeCameraDistance, viewHeading } from '../../js/fictional-city/camera-controls.mjs';
import { interiorWorld, isWalkable } from '../../js/fictional-city/spatial.mjs';

test('close camera starts at walking height; zoom increases magnification and remains bounded', () => {
  const view = createCameraControls();
  assert.equal(view.mode, 'close'); assert.ok(view.pitch < .3);
  view.zoomBy(1.25); assert.equal(view.zoom, 1.25);
  view.zoomBy(.8); assert.equal(view.zoom, 1);
  view.zoomBy(100); assert.equal(view.zoom, 5);
  view.zoomBy(.001); assert.equal(view.zoom, .7);
  for (const invalid of [NaN, Infinity, 0, -2]) view.zoomBy(invalid);
  assert.equal(view.zoom, .7);
});
test('turning and tilting are bounded; reset centers behind the player and overview remains available', () => {
  const view = createCameraControls();
  view.look(20, -10000); assert.equal(view.yaw, -.12); assert.equal(view.pitch, -.16);
  view.look(0, 10000); assert.equal(view.pitch, .75);
  view.reset({ playerYaw: 1 }); assert.equal(view.yaw, Math.PI + 1); assert.equal(view.zoom, 1);
  assert.equal(view.setMode('overview', { island: true }), true);
  assert.equal(view.zoom, .7); assert.equal(view.yaw, Math.PI + .35);
  view.zoomBy(99); assert.equal(view.zoom, 3);
  view.look(0, -10000); assert.equal(view.pitch, .25);
  view.look(0, 10000); assert.equal(view.pitch, 1.2);
  assert.equal(view.setMode('invalid'), false); assert.equal(view.mode, 'overview');
  view.setMode('close', { playerYaw: 0 }); assert.equal(view.yaw, Math.PI); assert.equal(view.zoom, 1);
});
test('camera boom shortens before walls, counters, and unsupported ground, including thin blockers', () => {
  const room = interiorWorld(false);
  const clear = (x, z) => isWalkable(x, z, room, .18);
  assert.equal(safeCameraDistance({ x: 0, z: 0 }, 0, 4, clear), 4);
  const toWall = safeCameraDistance({ x: 0, z: 4.8 }, 0, 5, clear);
  assert.ok(toWall > 0 && toWall < .53); assert.ok(clear(0, 4.8 + toWall));
  const toCounter = safeCameraDistance({ x: 0, z: 0 }, Math.PI, 5, clear);
  assert.ok(toCounter < 1.6); assert.ok(clear(0, -toCounter));
  const thin = safeCameraDistance({ x: 0, z: 0 }, 0, 5, (_x, z) => z < 1.4 || z > 1.65);
  assert.ok(thin < 1.4, 'sample the whole boom instead of jumping to a clear endpoint');
  assert.equal(safeCameraDistance({ x: 0, z: 0 }, 0, 5, () => false), .02);
});
test('north-up map heading follows camera look direction, not the opposite boom direction', () => {
  for (const [yaw, label] of [[0, 'N'], [Math.PI / 2, 'W'], [Math.PI, 'S'], [-Math.PI / 2, 'E'], [-Math.PI / 4, 'NE'], [Math.PI * 4, 'N']]) assert.equal(viewHeading(yaw).label, label);
});
test('host exposes close/overview, real zoom direction, map, and browser accessibility zoom', async () => {
  const text = async path => readFile(new URL('../../' + path, import.meta.url), 'utf8');
  const html = await text('fictional-city.html'), app = await text('js/fictional-city/app.mjs'), scene = await text('js/fictional-city/scene.mjs');
  assert.match(html, /data-city-view="close"/); assert.match(html, /data-city-view="overview"/);
  assert.match(html, /id="city-map-mini"/); assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
  assert.match(app, /city-zoom-in'\).addEventListener\('click', \(\) => scene\?\.zoomBy\(1.25\)/);
  assert.match(app, /city-zoom-out'\).addEventListener\('click', \(\) => scene\?\.zoomBy\(\.8\)/);
  assert.match(scene, /touchAction = 'pinch-zoom'/);
  assert.match(scene, /e.ctrlKey \|\| e.metaKey\) return/);
  assert.match(scene, /lostpointercapture/);
});
