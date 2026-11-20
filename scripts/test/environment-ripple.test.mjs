/* The ripple on the selected earthquake (js/environment-ripple.js, event timeline slice S5, 2026-11-19, decision D17): rings that
   travel outward to a regional radius in about 2.4 s and are gone, one ground primitive built once and asynchronously, one
   material uniform per ring written per frame and nothing else, a bounded hold, a still outline under reduced motion, never a
   CallbackProperty and never Halo's breathing pulse. Pure rules in a vm realm; the runtime over a fake Cesium whose primitive
   records what is built and written. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const source = read('js/environment-ripple.js');
const realm = () => { const window = {}; vm.runInNewContext(source, { window }); return window.MCC_ENVIRONMENT_RIPPLE; };
const R = realm();
const P = R.pure;
const plain = (x) => JSON.parse(JSON.stringify(x));

test('D17: the regional radius is 50 km below M5, rising 125 km a magnitude unit, 300 km from M7', () => {
  assert.equal(P.radiusM(null), 50000); assert.equal(P.radiusM(3.1), 50000); assert.equal(P.radiusM(4.99), 50000);
  assert.equal(P.radiusM(5), 50000); assert.equal(P.radiusM(5.4), 100000); assert.equal(P.radiusM(6), 175000);
  assert.equal(P.radiusM(6.5), 237500); assert.equal(P.radiusM(7), 300000); assert.equal(P.radiusM(9.1), 300000);
  /* before S5 the ripple was max(15 km, 1.6 x the disc): 15 km up to M4.4, 40 km at M5 */
  assert.ok(P.radiusM(4.4) > 15000 && P.radiusM(5) > 40000, 'regional, not a dot-sized blink');
});

test('two rings travel outward, 0.8 s apart, each in 1.6 s, slowing as they spread; all over at 2.4 s', () => {
  assert.equal(P.DURATION_MS, 2400); assert.equal(P.RINGS, 2);
  assert.deepEqual(plain(P.fronts(0)), [0, -1]);
  const a = P.fronts(400), b = P.fronts(800), c = P.fronts(1600), d = P.fronts(2400);
  assert.ok(a[0] > 0 && a[0] < 1 && a[1] === -1, 'only the first ring at 0.4 s');
  assert.ok(b[0] > a[0] && b[1] === 0, 'the second leaves at 0.8 s');
  assert.ok(c[0] === 1 && c[1] > 0 && c[1] < 1, 'the first reaches the radius at 1.6 s');
  assert.ok(d[0] === -1 && d[1] === 1, 'the second at 2.4 s');
  assert.deepEqual(plain(P.fronts(2401)), [-1, -1]);
  for (let t = 0; t < 1600; t += 100) assert.ok(P.fronts(t + 100)[0] >= P.fronts(t)[0], 'outward only, never back');
  assert.ok(P.fronts(400)[0] - P.fronts(0)[0] > P.fronts(1600)[0] - P.fronts(1200)[0], 'it slows as it spreads (ease-out)');
  assert.equal(P.done(2399), false); assert.equal(P.done(2400), true);
  assert.ok(P.intensity(0.1) > P.intensity(0.95) && P.intensity(-1) === 0, 'fainter as it spreads');
  assert.equal(P.LABEL, 'Ripple is illustrative: not a recording of shaking');
  assert.ok(P.HOLD_MAX_MS <= 6000, 'the hold is bounded at 6 s');
});

/* a fake Cesium: a ground primitive that becomes ready when told, materials with uniforms, a scene with preRender */
function world({ supported = true } = {}) {
  const event = () => { const fns = new Set(); return { addEventListener: (f) => fns.add(f), removeEventListener: (f) => fns.delete(f), fire: () => [...fns].forEach((f) => f()), size: () => fns.size }; };
  const built = [], holds = [], released = [], renders = [], ended = [];
  class GroundPrimitive { constructor(o) { this.o = o; this.ready = false; this.appearance = o.appearance; built.push(this); } static isSupported() { return supported; } static supportsMaterials() { return supported; } }
  class Material { constructor(o) { this.fabric = o.fabric; this.uniforms = Object.assign({}, o.fabric.uniforms); this.translucent = o.translucent; } }
  class Plain { constructor(o) { Object.assign(this, o || {}); } }
  const Cesium = { GroundPrimitive, Material, MaterialAppearance: Plain, GeometryInstance: Plain, EllipseGeometry: Plain, Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }, Cartesian3: { fromDegrees: (lon, lat, h) => ({ lon, lat, h: h || 0 }) } };
  const scene = { preRender: event(), primitives: { list: [] } };
  let t = 1000;
  const timers = [];
  const ripple = R.create({
    viewer: { scene }, Cesium, now: () => t,
    add: (p) => { scene.primitives.list.push(p); return p; }, remove: (p) => { scene.primitives.list = scene.primitives.list.filter((x) => x !== p); return null; },
    hold: (o, ms) => holds.push([o, ms]), release: (o) => released.push(o), requestRender: (why) => renders.push(why), onEnd: () => ended.push(t),
    setTimeout: (fn, ms) => { const id = { fn, at: t + ms, done: false }; timers.push(id); return id; }, clearTimeout: (id) => { if (id) id.done = true; }
  });
  /* Timer tasks and rendering can run in either order after a busy frame. Keep them independently controllable. */
  const elapse = (ms) => { t += ms; };
  const flushTimers = () => { for (const id of timers) if (!id.done && id.at <= t) { id.done = true; id.fn(); } };
  const frame = () => scene.preRender.fire();
  const advance = (ms) => { elapse(ms); flushTimers(); frame(); };
  return { ripple, built, holds, released, renders, ended, scene, advance, elapse, flushTimers, frame, now: () => t };
}

test('one ground primitive, built once and asynchronously at the regional radius, the rings written as uniforms only', () => {
  const w = world();
  const info = w.ripple.start({ id: 'usgs:a', lon: 136.7, lat: 37.4, mag: 6, still: false, wait: false });
  assert.equal(info.radiusM, 175000); assert.equal(info.label, P.LABEL);
  assert.equal(w.built.length, 1, 'one primitive');
  const prim = w.built[0];
  assert.equal(prim.o.asynchronous, true, 'built off the main thread');
  assert.equal(prim.o.allowPicking, false);
  const geometry = prim.o.geometryInstances.geometry;
  assert.equal(geometry.semiMajorAxis, 175000); assert.equal(geometry.semiMinorAxis, 175000);
  /* Cesium 1.131's EllipseGeometry steps round the rim by eight times its granularity at any radius: 96 points, not the 24 of PI / 90,
     and never the many thousands a radius-scaled step gives (that geometry crashed the renderer) */
  assert.equal(4 * Math.ceil(Math.PI / 2 / (8 * geometry.granularity) - 1e-9), 96, `rim points at granularity ${geometry.granularity}`);
  assert.deepEqual(w.holds[0], ['env-ripple', 6000], 'a bounded hold');
  /* not ready yet: nothing is written */
  w.advance(16);
  assert.deepEqual([prim.appearance.material.uniforms.front1, prim.appearance.material.uniforms.front2], [-1, -1]);
  prim.ready = true;
  const before = JSON.stringify(geometry);
  const seen = [];
  for (let i = 0; i < 12; i += 1) { w.advance(100); seen.push(prim.appearance.material.uniforms.front1); }
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'the first ring only moves outward: ' + seen.join(','));
  assert.ok(seen[seen.length - 1] > 0.5, 'it has travelled');
  assert.equal(JSON.stringify(geometry), before, 'the geometry is never touched after it is built');
  assert.equal(w.built.length, 1, 'never rebuilt per frame');
  assert.equal(w.ripple.state().phase, 'rings');
  /* over at 2.4 s after the rings began: the primitive goes, the hold is released, the record kept */
  w.advance(1300);
  assert.equal(w.ripple.state(), null);
  assert.equal(w.scene.primitives.list.length, 0);
  assert.ok(w.released.includes('env-ripple'));
  const last = w.ripple.last();
  assert.ok(last.endedAt - last.startedAt <= 6000, 'within the bound');
  assert.equal(w.scene.preRender.size(), 0, 'no frame listener left behind');
});

test('the rings wait for the push to land (go), and at most 2.5 s; the 6 s timer ends them even when no frame is drawn', () => {
  const w = world();
  w.ripple.start({ id: 'usgs:a', lon: 1, lat: 2, mag: 5.5, wait: true });
  const prim = w.built[0];
  prim.ready = true;
  w.advance(500);
  assert.equal(w.ripple.state().phase, 'waiting');
  assert.equal(prim.appearance.material.uniforms.front1, -1, 'nothing moves while the camera is still flying');
  w.ripple.go();
  w.advance(100); w.advance(100);
  assert.equal(w.ripple.state().phase, 'rings');
  assert.ok(prim.appearance.material.uniforms.front1 > 0);
  /* a second one that is never told to go: it starts on its own after 2.5 s */
  const w2 = world();
  w2.ripple.start({ id: 'usgs:b', lon: 1, lat: 2, mag: 5.5, wait: true });
  w2.built[0].ready = true;
  w2.advance(2400); assert.equal(w2.ripple.state().phase, 'waiting');
  w2.advance(200); assert.equal(w2.ripple.state().phase, 'rings');
  /* frames stop altogether: the bound still ends it */
  const w3 = world();
  w3.ripple.start({ id: 'usgs:c', lon: 1, lat: 2, mag: 5.5, wait: false });
  let t = 0; while (w3.ripple.state() && t < 7000) { t += 500; w3.advance(500); w3.scene.preRender.size(); }
  assert.equal(w3.ripple.state(), null, 'ended by the timer');
  assert.ok(w3.ripple.last().endedAt - w3.ripple.last().startedAt <= 6000);
});

test('a delayed primitive catches up to the landing clock instead of starting another 2.4 s animation', () => {
  const w = world();
  w.ripple.start({ id: 'usgs:late-build', lon: 1, lat: 2, mag: 5.5, wait: true });
  w.elapse(1800);
  w.ripple.go();
  const landedAt = w.now();
  w.elapse(1200);
  w.built[0].ready = true;
  w.frame();
  assert.equal(w.ripple.state().ringsAt, landedAt, 'the rings use the landing time, not primitive readiness');
  assert.deepEqual(plain(w.ripple.state().fronts), plain(P.fronts(1200)), 'a late frame catches up');
  const uniforms = w.built[0].appearance.material.uniforms;
  assert.deepEqual([uniforms.front1, uniforms.front2], [0.9375, 0.4375], 'the rendered material catches up too');
  w.elapse(1200);
  w.frame();
  assert.equal(w.ripple.state(), null, 'the first frame at the 2.4 s deadline cleans up before delayed timers');
  assert.equal(w.ripple.last().endedAt, w.now(), 'the receipt records actual cleanup time');
  assert.equal(w.ripple.last().endedAt - w.ripple.last().ringsAt, 2400);
  assert.deepEqual(w.released, ['env-ripple']);
  w.flushTimers();
  assert.deepEqual(w.ended, [w.now()], 'late timer delivery cannot finish the ripple twice');
});

test('the 6 s deadline is enforced by a frame even when timers and primitive readiness are late', () => {
  const w = world();
  w.ripple.start({ id: 'usgs:late-timer', lon: 1, lat: 2, mag: 5.5, wait: true });
  w.elapse(P.HOLD_MAX_MS + 125);
  w.frame();
  assert.equal(w.ripple.state(), null, 'an overdue ripple cannot wait for its timer task or start on a later frame');
  assert.equal(w.ripple.last().endedAt, w.now(), 'never clamp the recorded cleanup to a missed deadline');
  assert.equal(w.ripple.last().endedAt - w.ripple.last().startedAt, 6125);
  assert.equal(w.ripple.last().ringsAt, null, 'no rings actually began');
  assert.equal(w.scene.preRender.size(), 0);
  assert.equal(w.scene.primitives.list.length, 0);
  w.flushTimers();
  assert.deepEqual(w.released, ['env-ripple']);
  assert.deepEqual(w.ended, [w.now()]);
});

test('the landing timer ends the rings after 2.4 s even when their primitive never becomes ready', () => {
  const w = world();
  w.ripple.start({ id: 'usgs:no-frame', lon: 1, lat: 2, mag: 5.5, wait: true });
  w.elapse(1800); w.ripple.go();
  const landedAt = w.now();
  w.elapse(2400); w.flushTimers();
  assert.equal(w.ripple.state(), null);
  assert.equal(w.ripple.last().ringsAt, landedAt);
  assert.equal(w.ripple.last().endedAt, w.now());
  assert.deepEqual(w.released, ['env-ripple']);
  assert.equal(w.scene.preRender.size(), 0);
});

for (const delivery of ['timer', 'frame']) {
  test(`a late landing keeps the selection deadline with ${delivery}-first cleanup`, () => {
    const w = world();
    const selectedAt = w.now();
    w.ripple.start({ id: 'usgs:late-landing', lon: 1, lat: 2, mag: 5.5, wait: true });
    /* The 2.5 s wait task itself arrives late, as it can behind a busy software-rendered frame. */
    w.elapse(3016); w.flushTimers();
    const landedAt = w.now();
    assert.equal(w.ripple.state().ringsAt, landedAt, 'record the actual late landing');
    w.built[0].ready = true; w.frame();
    w.elapse(1883); w.frame();
    assert.notEqual(w.ripple.state(), null, 'the remaining lifetime is still available before its deadline');
    w.elapse(1);
    if (delivery === 'timer') w.flushTimers(); else w.frame();
    assert.equal(w.ripple.state(), null, 'a late landing cannot extend the 2.5 s wait plus 2.4 s animation lifetime');
    assert.equal(w.ripple.last().startedAt, selectedAt);
    assert.equal(w.ripple.last().ringsAt, landedAt, 'never backdate the late landing');
    assert.equal(w.ripple.last().endedAt, w.now(), 'record actual cleanup');
    assert.equal(w.ripple.last().endedAt - selectedAt, 4900);
    assert.equal(w.ripple.last().endedAt - landedAt, 1884, 'only the remaining lifetime is available');
    w.flushTimers(); w.frame();
    assert.deepEqual(w.released, ['env-ripple']);
    assert.deepEqual(w.ended, [w.now()], 'exactly one cleanup notification');
    assert.equal(w.scene.preRender.size(), 0);
    assert.equal(w.scene.primitives.list.length, 0);
  });
}

test('a landing at the 2.5 s wait limit keeps the full 2.4 s ring sequence', () => {
  const w = world();
  w.ripple.start({ id: 'usgs:wait-limit', lon: 1, lat: 2, mag: 5.5, wait: true });
  w.elapse(2500); w.ripple.go();
  const landedAt = w.now();
  w.built[0].ready = true; w.frame();
  w.elapse(2399); w.flushTimers(); w.frame();
  assert.notEqual(w.ripple.state(), null);
  w.elapse(1); w.flushTimers();
  assert.equal(w.ripple.state(), null);
  assert.equal(w.ripple.last().endedAt - landedAt, 2400);
  assert.deepEqual(w.released, ['env-ripple']);
  assert.deepEqual(w.ended, [w.now()]);
});

test('a landing after the selection lifetime expires cannot start or resurrect the rings', () => {
  const w = world();
  w.ripple.start({ id: 'usgs:expired-landing', lon: 1, lat: 2, mag: 5.5, wait: true });
  w.elapse(4901); w.ripple.go();
  assert.equal(w.ripple.state(), null);
  assert.equal(w.ripple.last().ringsAt, null, 'the expired animation never starts');
  assert.equal(w.ripple.last().endedAt, w.now(), 'retain the actual late cleanup time');
  assert.equal(w.ripple.last().endedAt - w.ripple.last().startedAt, 4901);
  w.flushTimers(); w.frame(); w.ripple.go();
  assert.equal(w.ripple.state(), null);
  assert.deepEqual(w.released, ['env-ripple']);
  assert.deepEqual(w.ended, [w.now()]);
  assert.equal(w.scene.preRender.size(), 0);
  assert.equal(w.scene.primitives.list.length, 0);
});

test('reduced motion: a still outline at the same radius, kept while selected, asking for no frame once built', () => {
  const w = world();
  const info = w.ripple.start({ id: 'usgs:a', lon: 1, lat: 2, mag: 7.2, still: true });
  assert.equal(info.phase, 'outline'); assert.equal(info.radiusM, 300000);
  const prim = w.built[0];
  assert.equal(prim.appearance.material.uniforms.outline, 1);
  prim.ready = true;
  w.advance(16);
  assert.ok(w.released.includes('env-ripple'), 'the build hold is let go once it is built');
  const renders = w.renders.length;
  w.advance(10000);
  assert.equal(w.ripple.state().phase, 'outline', 'still there after 10 s: it does not move, so it needs no bound');
  assert.equal(w.renders.length, renders, 'and asks for no frame');
  assert.deepEqual([prim.appearance.material.uniforms.front1, prim.appearance.material.uniforms.front2], [-1, -1]);
  w.ripple.clear();
  assert.equal(w.scene.primitives.list.length, 0);
});

test('unsupported ground materials: no ripple, and nothing else breaks', () => {
  const w = world({ supported: false });
  assert.equal(w.ripple.start({ id: 'usgs:a', lon: 1, lat: 2, mag: 6 }), null);
  assert.equal(w.built.length, 0);
  assert.equal(w.ripple.state(), null);
});

test('the source: original ring material, no CallbackProperty, no breathing pulse, the reference name only where licence attribution would be', () => {
  assert.doesNotMatch(source, /CallbackProperty/);
  assert.doesNotMatch(source, /semiMajorAxis\s*=|\.semiMajorAxis\s*=/, 'no axis is ever reassigned');
  assert.match(source, /materialInput\.st/, 'the ring is placed by the material');
  assert.match(source, /u\.front1 = f\[0\]; u\.front2 = f\[1\];/, 'per frame only the two fronts are written');
  assert.doesNotMatch(source, /god\W?s\W?eye\W?view/i, 'original code: no attribution needed, and the name stays out of product code');
});
