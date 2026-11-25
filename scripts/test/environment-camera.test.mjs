/* The push on a selection (js/environment-camera.js, event timeline slice S5, 2026-11-19, decision D14): a regional oblique frame
   by magnitude, 1.6 to 2 s cubic in-out, heading kept; cancelled at once by a pointer, a touch, a wheel or a key and by a new
   selection; never on the tour or the replay; under reduced motion a tap does not move the camera and a chosen post or row jumps
   with no animation. Pure rules in a vm realm; the runtime over a fake camera that records every call. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const source = read('js/environment-camera.js');
const window = { setTimeout, clearTimeout };
vm.runInNewContext(source, { window });
const C = window.MCC_ENVIRONMENT_CAMERA;
const P = C.pure;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('a quake\'s frame: 120 km at M4.5 out to 300 km from M7.5, pitch from -45 to -60 degrees, heading kept', () => {
  const at = (m) => P.quakeFrame(m);
  assert.equal(at(3.1).rangeM, 120000); assert.equal(at(4.5).rangeM, 120000); assert.equal(at(5.4).rangeM, 174000);
  assert.equal(at(6).rangeM, 210000); assert.equal(at(7.1).rangeM, 276000); assert.equal(at(7.5).rangeM, 300000); assert.equal(at(9).rangeM, 300000);
  assert.equal(at(null).rangeM, 120000, 'no magnitude: the closest frame');
  assert.ok(near(at(4.5).pitchDeg, -45)); assert.ok(near(at(7.5).pitchDeg, -60)); assert.ok(at(6).pitchDeg < -45 && at(6).pitchDeg > -60);
  for (const m of [3, 5, 6, 7, 8]) assert.equal(at(m).keepHeading, true);
  /* before S5: 900 km straight down (1,600 km from M7) */
  assert.ok(at(7.1).rangeM < 900000);
});

test('every other kind keeps the frame the focus always gave it (its height, straight down from 400 km), now cancellable', () => {
  const heightFor = (kind) => ({ alert: 250000, cyclone: 2000000, perimeter: 120000, station: 500000 })[kind] || 600000;
  assert.deepEqual(JSON.parse(JSON.stringify(P.frameFor('cyclone', {}, heightFor))), { rangeM: 2000000, pitchDeg: -90, keepHeading: false });
  assert.deepEqual(JSON.parse(JSON.stringify(P.frameFor('perimeter', {}, heightFor))), { rangeM: 120000, pitchDeg: -60, keepHeading: false });
  assert.equal(P.frameFor('quake', { mag: 6 }, heightFor).rangeM, 210000);
});

test('the push takes 1.6 s within view and up to 2 s across a hemisphere', () => {
  assert.equal(P.pushSeconds({ lon: 0, lat: 0 }, { lon: 0, lat: 0 }), 1.6);
  assert.equal(P.pushSeconds({ lon: 0, lat: 0 }, { lon: 90, lat: 0 }), 2);
  assert.equal(P.pushSeconds({ lon: 0, lat: 0 }, { lon: 180, lat: 0 }), 2);
  const mid = P.pushSeconds({ lon: 0, lat: 0 }, { lon: 45, lat: 0 });
  assert.ok(mid > 1.6 && mid < 2);
  assert.equal(P.pushSeconds(null, { lon: 1, lat: 1 }), 1.6);
});

test('which selections push: a tap and a chosen post or row; never the tour or the replay; reduced motion never animates', () => {
  assert.equal(P.pushMode('pick', false), 'flight');
  assert.equal(P.pushMode('focus', false), 'flight');
  assert.equal(P.pushMode('tour', false), 'none', 'the tour keeps the director\'s own flights');
  assert.equal(P.pushMode('panel', false), 'none', 'the panel\'s row arrives as a focus, which pushes');
  assert.equal(P.pushMode('pick', true), 'none', 'reduced motion: a tap does not move the camera');
  assert.equal(P.pushMode('focus', true), 'jump', 'reduced motion: a chosen post or row is placed without animation');
  assert.equal(P.pushMode('tour', true), 'none');
});

/* a fake camera and canvas */
function rig({ reduced = false } = {}) {
  const listeners = { canvas: new Map(), doc: new Map() };
  const target = (map) => ({ addEventListener: (n, f) => map.set(n, f), removeEventListener: (n) => map.delete(n) });
  const calls = [], holds = [], released = [];
  let pending = null;
  const camera = {
    heading: 0.3, positionCartographic: { longitude: 0, latitude: 0, height: 8300000 },
    flyToBoundingSphere(sphere, o) { calls.push(['fly', sphere, o]); pending = o; },
    viewBoundingSphere(sphere, offset) { calls.push(['view', sphere, offset]); },
    lookAtTransform(m) { calls.push(['lookAtTransform', m]); },
    cancelFlight() { calls.push(['cancelFlight']); if (pending) { const o = pending; pending = null; o.cancel(); } }
  };
  const Cesium = { Math: { toDegrees: (r) => r * 180 / Math.PI }, BoundingSphere: class { constructor(c, r) { this.center = c; this.radius = r; } }, HeadingPitchRange: class { constructor(h, p, r) { this.heading = h; this.pitch = p; this.range = r; } }, Cartesian3: { fromDegrees: (lon, lat, h) => ({ lon, lat, h }) }, EasingFunction: { CUBIC_IN_OUT: 'cubic' }, Matrix4: { IDENTITY: 'I' } };
  const timers = [];
  const cam = C.create({ viewer: { camera }, Cesium, hold: (o, ms) => holds.push([o, ms]), release: (o) => released.push(o), reducedMotion: () => reduced, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {} });
  cam.attachInput({ canvas: target(listeners.canvas), document: target(listeners.doc) });
  return { cam, calls, holds, released, listeners, complete: () => { if (pending) { const o = pending; pending = null; o.complete(); } }, timers };
}

test('a push: one flight to the regional frame with cubic in-out, the heading kept, the env-focus hold bounded by its duration', () => {
  const r = rig();
  const settled = [];
  assert.equal(r.cam.push({ id: 'usgs:a', lon: 136.7, lat: 37.4 }, P.quakeFrame(5.4), 'pick', (how) => settled.push(how)), 'flight');
  const [kind, sphere, o] = r.calls[0];
  assert.equal(kind, 'fly');
  assert.deepEqual([sphere.center.lon, sphere.center.lat, sphere.radius], [136.7, 37.4, 0], 'centred on the event');
  assert.equal(o.offset.range, 174000); assert.ok(near(o.offset.pitch, -49.5 * Math.PI / 180, 1e-6)); assert.equal(o.offset.heading, 0.3, 'heading kept');
  assert.equal(o.easingFunction, 'cubic');
  assert.ok(o.duration >= 1.6 && o.duration <= 2);
  assert.deepEqual(r.holds[0], ['env-focus', Math.round(o.duration * 1000 + 600)]);
  assert.equal(r.cam.state().flying, true);
  r.complete();
  assert.deepEqual(settled, ['complete']);
  assert.ok(r.released.includes('env-focus'));
  assert.equal(r.cam.state().flying, false);
});

for (const [where, name] of [['canvas', 'pointerdown'], ['canvas', 'touchstart'], ['canvas', 'wheel'], ['doc', 'keydown']]) {
  test(`the visitor's hand wins: a ${name} cancels the push at once and the camera stays where it is`, () => {
    const r = rig();
    const settled = [];
    r.cam.push({ id: 'usgs:a', lon: 10, lat: 20 }, P.quakeFrame(6), 'focus', (how) => settled.push(how));
    r.listeners[where].get(name)();
    assert.ok(r.calls.some((c) => c[0] === 'cancelFlight'), 'Cesium is told to stop the flight');
    assert.deepEqual(settled, ['cancel'], 'settled once, as cancelled');
    assert.equal(r.cam.state().flying, false);
    assert.equal(r.cam.state().last.reason, 'input');
    assert.ok(r.released.includes('env-focus'));
    /* a second input with nothing flying does nothing */
    const n = r.calls.length;
    r.listeners[where].get(name)();
    assert.equal(r.calls.length, n);
  });
}

test('a new selection cancels the push under way; the new one flies', () => {
  const r = rig();
  const first = [], second = [];
  r.cam.push({ id: 'usgs:a', lon: 10, lat: 20 }, P.quakeFrame(6), 'pick', (how) => first.push(how));
  r.cam.push({ id: 'usgs:b', lon: 11, lat: 21 }, P.quakeFrame(5), 'pick', (how) => second.push(how));
  assert.deepEqual(first, ['cancel']);
  assert.equal(r.calls.filter((c) => c[0] === 'fly').length, 2);
  assert.equal(r.cam.state().id, 'usgs:b');
  assert.equal(r.cam.cancel('selection'), true);
  assert.deepEqual(second, ['cancel']);
  assert.equal(r.cam.cancel('selection'), false, 'nothing left to cancel');
});

test('reduced motion: a tap moves nothing; a chosen post jumps with no flight; the tour never pushes', () => {
  const r = rig({ reduced: true });
  const settled = [];
  assert.equal(r.cam.push({ id: 'usgs:a', lon: 10, lat: 20 }, P.quakeFrame(6), 'pick', (how) => settled.push(how)), 'none');
  assert.equal(r.calls.length, 0, 'the camera was not touched');
  assert.equal(r.cam.push({ id: 'usgs:a', lon: 10, lat: 20 }, P.quakeFrame(6), 'focus', (how) => settled.push(how)), 'jump');
  assert.deepEqual(r.calls.map((c) => c[0]), ['view', 'lookAtTransform'], 'placed at once, back in the world frame');
  assert.equal(r.calls[0][2].range, 210000);
  assert.deepEqual(settled, ['none', 'jump']);
  const t = rig();
  assert.equal(t.cam.push({ id: 'usgs:a', lon: 10, lat: 20 }, P.quakeFrame(6), 'tour', () => {}), 'none');
  assert.equal(t.calls.length, 0);
});

test('a flight whose callbacks never come still settles through its safety timer', () => {
  const r = rig();
  const settled = [];
  r.cam.push({ id: 'usgs:a', lon: 10, lat: 20 }, P.quakeFrame(6), 'pick', (how) => settled.push(how));
  const safety = r.timers[r.timers.length - 1];
  assert.ok(safety.ms > 1600 && safety.ms <= 2600);
  safety.fn();
  assert.deepEqual(settled, ['timeout']);
  assert.equal(r.cam.state().flying, false);
});

test('the source: original code, no per-frame callback, no storage, the reference name nowhere', () => {
  assert.doesNotMatch(source, /CallbackProperty|localStorage|sessionStorage|fetch\(/);
  assert.doesNotMatch(source, /god\W?s\W?eye\W?view/i);
  assert.deepEqual([...P.INPUTS], ['pointerdown', 'touchstart', 'wheel']);
});
