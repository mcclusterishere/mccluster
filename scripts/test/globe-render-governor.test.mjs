/* The render governor (js/globe-render-governor.js, adapted from gods-eye-view): on-demand rendering only while
   enabled, owner-keyed bounded holds, the legacy rule for the CallbackProperty pulses. A fake scene and camera. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const source = read('js/globe-render-governor.js');
function load() {
  const window = {};
  vm.runInNewContext(source, { window, console });
  return window.MCC_GLOBE_GOVERNOR;
}
const G = load();
const evt = () => { const listeners = new Set(); return { addEventListener: fn => listeners.add(fn), removeEventListener: fn => listeners.delete(fn), raiseEvent: (...a) => [...listeners].forEach(fn => fn(...a)), size: () => listeners.size }; };
function fakeViewer() {
  const scene = { requestRenderMode: false, maximumRenderTimeChange: 0, renders: 0, requestRender() { this.renders++; }, morphStart: evt(), morphComplete: evt(), primitives: { primitiveAdded: evt(), primitiveRemoved: evt() } };
  return { scene, camera: { moveStart: evt(), moveEnd: evt() }, entities: { collectionChanged: evt() }, imageryLayers: { layerAdded: evt(), layerRemoved: evt(), layerMoved: evt(), layerShownOrHidden: evt() } };
}
function timers() {
  const list = []; let n = 0;
  return { list, setTimeout: (fn, ms) => { const id = ++n; list.push({ id, fn, ms, fired: false, cleared: false }); return id; }, clearTimeout: id => { const t = list.find(x => x.id === id); if (t) t.cleared = true; },
    pending: () => list.filter(t => !t.fired && !t.cleared), fire: pred => { const t = list.find(x => !x.fired && !x.cleared && (!pred || pred(x))); if (!t) throw new Error('no timer'); t.fired = true; t.fn(); return t; } };
}
const make = () => { const viewer = fakeViewer(), T = timers(); let now = 0; const governor = G.create(viewer, { ...T, now: () => now }); return { viewer, scene: viewer.scene, T, governor, tick: ms => { now += ms; } }; };
/* arrays made inside the vm realm have another Array prototype: copy them before a strict deep comparison */
const arr = x => Array.from(x);

test('disabled by default: the continuous loop is byte-identical and holds have no effect', () => {
  const { scene, governor } = make();
  assert.equal(governor.enabled(), false);
  assert.equal(scene.requestRenderMode, false); assert.equal(scene.maximumRenderTimeChange, 0);
  governor.hold('x'); governor.release('x'); governor.hold('legacy');
  assert.equal(scene.requestRenderMode, false); assert.equal(scene.maximumRenderTimeChange, 0);
  assert.deepEqual(arr(governor.diagnostics().holds), ['legacy']);
  assert.equal(governor.diagnostics().mode, 'continuous');
});
test('enable(): maximumRenderTimeChange 60 and on-demand rendering with no holds (the terminator moves at most once a minute)', () => {
  const { scene, governor } = make();
  governor.enable();
  assert.equal(governor.enabled(), true);
  assert.equal(scene.maximumRenderTimeChange, 60);
  assert.equal(scene.requestRenderMode, true);
  assert.equal(governor.diagnostics().mode, 'on-demand');
  governor.enable();
  assert.equal(scene.maximumRenderTimeChange, 60, 'idempotent');
});
test('a hold flips to continuous, the last release flips back and asks for a settling frame', () => {
  const { scene, governor } = make();
  governor.enable();
  const before = scene.renders;
  governor.hold('a'); assert.equal(scene.requestRenderMode, false); assert.equal(governor.diagnostics().mode, 'continuous');
  governor.hold('b'); governor.release('a'); assert.equal(scene.requestRenderMode, false, 'b still holds');
  governor.release('b'); assert.equal(scene.requestRenderMode, true);
  assert.ok(scene.renders > before, 'a settling frame was requested');
});
test('holds are identity-keyed: a double hold or double release cannot corrupt the mode', () => {
  const { scene, governor } = make();
  governor.enable();
  governor.hold('a'); governor.hold('a'); governor.hold('a');
  governor.release('a');
  assert.equal(scene.requestRenderMode, true);
  governor.release('a'); governor.release('never');
  assert.equal(scene.requestRenderMode, true);
  assert.deepEqual(arr(governor.diagnostics().holds), []);
});
test('a bounded hold releases itself after maxMs, and re-holding re-arms the bound', () => {
  const { scene, governor, T } = make();
  governor.enable();
  governor.hold('env-ripple', 6000);
  assert.equal(scene.requestRenderMode, false);
  assert.equal(T.pending().filter(t => t.ms === 6000).length, 1);
  governor.hold('env-ripple', 6000);
  assert.equal(T.pending().filter(t => t.ms === 6000).length, 1, 'the earlier timer was cleared');
  T.fire(t => t.ms === 6000);
  assert.equal(scene.requestRenderMode, true);
  assert.deepEqual(arr(governor.diagnostics().holds), []);
});
test('the camera holds from moveStart to moveEnd, with a 15 s safety release', () => {
  const { viewer, scene, governor, T } = make();
  governor.enable();
  viewer.camera.moveStart.raiseEvent();
  assert.equal(scene.requestRenderMode, false); assert.deepEqual(arr(governor.diagnostics().holds), ['camera']);
  viewer.camera.moveEnd.raiseEvent();
  assert.equal(scene.requestRenderMode, true);
  viewer.camera.moveStart.raiseEvent();
  assert.equal(T.pending().some(t => t.ms === 15000), true);
  T.fire(t => t.ms === 15000);
  assert.equal(scene.requestRenderMode, true, 'a moveEnd that never comes still releases');
});
test('the morph holds from morphStart to morphComplete (max 3 s)', () => {
  const { scene, governor, T } = make();
  governor.enable();
  scene.morphStart.raiseEvent();
  assert.deepEqual(arr(governor.diagnostics().holds), ['morph']); assert.equal(T.pending().some(t => t.ms === 3000), true);
  scene.morphComplete.raiseEvent();
  assert.deepEqual(arr(governor.diagnostics().holds), []); assert.equal(scene.requestRenderMode, true);
});
test('the legacy rule: a pulse with one halo or any per-tick data layer keeps the loop continuous; none goes on demand', () => {
  assert.equal(G.legacyAnimators({ pulse: true, halos: 1, livePins: 0, dataLayersOn: false, intelOn: false, cctvOn: false, haloObjects: false }), true);
  assert.equal(G.legacyAnimators({ pulse: true, halos: 0, livePins: 2, dataLayersOn: false, intelOn: false, cctvOn: false, haloObjects: false }), true);
  assert.equal(G.legacyAnimators({ pulse: false, halos: 5, livePins: 2, dataLayersOn: false, intelOn: false, cctvOn: false, haloObjects: false }), false, 'reduced motion: the halos stand still');
  assert.equal(G.legacyAnimators({ pulse: true, halos: 0, livePins: 0, dataLayersOn: true, intelOn: false, cctvOn: false, haloObjects: false }), true);
  assert.equal(G.legacyAnimators({ pulse: true, halos: 0, livePins: 0, dataLayersOn: false, intelOn: true, cctvOn: false, haloObjects: false }), true);
  assert.equal(G.legacyAnimators({ pulse: true, halos: 0, livePins: 0, dataLayersOn: false, intelOn: false, cctvOn: true, haloObjects: false }), true);
  assert.equal(G.legacyAnimators({ pulse: true, halos: 0, livePins: 0, dataLayersOn: false, intelOn: false, cctvOn: false, haloObjects: true }), true);
  assert.equal(G.legacyAnimators({ pulse: true, halos: 0, livePins: 0, dataLayersOn: false, intelOn: false, cctvOn: false, haloObjects: false }), false);
  const { scene, governor } = make();
  governor.enable();
  governor.sync('legacy', G.legacyAnimators({ pulse: true, halos: 1, livePins: 0, dataLayersOn: false, intelOn: false, cctvOn: false, haloObjects: false }));
  assert.equal(scene.requestRenderMode, false, 'PULSE and one halo: continuous');
  governor.sync('legacy', G.legacyAnimators({ pulse: true, halos: 0, livePins: 0, dataLayersOn: false, intelOn: false, cctvOn: false, haloObjects: false }));
  assert.equal(scene.requestRenderMode, true, 'zero halos and no layers: on demand');
  governor.sync('legacy', G.legacyAnimators({ pulse: true, halos: 0, livePins: 0, dataLayersOn: true, intelOn: false, cctvOn: false, haloObjects: false }));
  assert.equal(scene.requestRenderMode, false, 'a data layer on: continuous');
  governor.sync('legacy', false); governor.sync('legacy', false);
  assert.equal(scene.requestRenderMode, true);
});
test('entity, primitive and imagery changes request a frame while enabled; requestRender always forwards and records only on demand', () => {
  const { viewer, scene, governor } = make();
  const n0 = scene.renders;
  viewer.entities.collectionChanged.raiseEvent();
  governor.requestRender('disabled-mutation');
  assert.ok(scene.renders > n0, 'forwards even while disabled');
  assert.deepEqual(arr(governor.diagnostics().recentRequests), [], 'nothing recorded in continuous mode');
  governor.enable();
  const n1 = scene.renders;
  viewer.entities.collectionChanged.raiseEvent(); scene.primitives.primitiveAdded.raiseEvent(); scene.primitives.primitiveRemoved.raiseEvent();
  viewer.imageryLayers.layerAdded.raiseEvent(); viewer.imageryLayers.layerRemoved.raiseEvent(); viewer.imageryLayers.layerMoved.raiseEvent(); viewer.imageryLayers.layerShownOrHidden.raiseEvent();
  assert.equal(scene.renders - n1, 7);
  governor.requestRender('env-set');
  assert.deepEqual(arr(governor.diagnostics().recentRequests).map(r => r.reason), ['env-set']);
  governor.hold('camera'); governor.requestRender('held');
  assert.deepEqual(arr(governor.diagnostics().recentRequests).map(r => r.reason), ['env-set'], 'held requests are not recorded');
  governor.release('camera');
  for (let i = 0; i < 20; i++) governor.requestRender('r' + i);
  assert.equal(governor.diagnostics().recentRequests.length, 16);
});
test('disable() restores the continuous loop and the default maximumRenderTimeChange and clears the bounded timers', () => {
  const { viewer, scene, governor, T } = make();
  scene.maximumRenderTimeChange = 0.5;
  governor.enable();
  governor.hold('env-ripple', 6000); governor.hold('legacy');
  governor.disable();
  assert.equal(governor.enabled(), false);
  assert.equal(scene.requestRenderMode, false);
  assert.equal(scene.maximumRenderTimeChange, 0.5, 'Cesium\'s own value is back');
  assert.deepEqual(T.pending().filter(t => t.ms === 6000), [], 'the bounded timer was cleared');
  assert.deepEqual(arr(governor.diagnostics().holds), ['legacy'], 'an unbounded owner stays recorded for the next enable');
  governor.enable();
  assert.equal(scene.requestRenderMode, false, 'legacy still holds after re-enable');
  governor.release('legacy');
  assert.equal(scene.requestRenderMode, true);
  governor.destroy();
  assert.equal(scene.requestRenderMode, false);
  assert.equal(viewer.camera.moveStart.size(), 0, 'listeners removed');
  assert.equal(viewer.entities.collectionChanged.size(), 0);
});
test('diagnostics shape and the header pointer', () => {
  const { governor } = make();
  const d = governor.diagnostics();
  assert.deepEqual(Object.keys(d).sort(), ['enabled', 'holds', 'maximumRenderTimeChange', 'mode', 'recentRequests']);
  assert.match(source.slice(0, 600), /Adapted from gods-eye-view src\/renderGovernor\.js, MIT, Copyright \(c\) 2026 Bilawal Sidhu, see THIRD-PARTY-NOTICES/);
});
