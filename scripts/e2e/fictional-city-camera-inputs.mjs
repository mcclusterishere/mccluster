/* Deterministic real-Three scene/input checks, with only WebGLRenderer and DOM canvas stubbed.
   This does not render pixels or establish browser/device performance.
   THREE180_DIR=/path/to/three180 node scripts/e2e/fictional-city-camera-inputs.mjs */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.THREE180_DIR, 'Set THREE180_DIR to the cached Three 0.180.0 build.');
const threeUrl = pathToFileURL(resolve(process.env.THREE180_DIR, 'three.module.js')).href;
const temp = await mkdtemp(join(tmpdir(), 'city-camera-inputs-'));
const shim = join(temp, 'three-shim.mjs');
await writeFile(shim, `export * from ${JSON.stringify(threeUrl)};
export class WebGLRenderer {
  constructor() { this.shadowMap = {}; this.info = {render:{calls:0,triangles:0},memory:{geometries:0,textures:0}}; }
  setPixelRatio() {} setSize() {} dispose() {}
  render(scene, camera) { scene.updateMatrixWorld(true); globalThis.__rendered = {scene,camera}; }
}`);
registerHooks({ resolve(specifier, context, next) { return specifier === 'three' ? { url: pathToFileURL(shim).href, shortCircuit: true } : next(specifier, context); } });
const THREE = await import('three');
assert.equal(THREE.REVISION, '180');
const globalEvents = new EventTarget();
globalThis.addEventListener = globalEvents.addEventListener.bind(globalEvents);
globalThis.removeEventListener = globalEvents.removeEventListener.bind(globalEvents);
globalThis.matchMedia = () => ({ matches: true });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
let frame, now = 0;
globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
globalThis.cancelAnimationFrame = () => { frame = null; };
const context = { fillRect() {}, strokeRect() {}, fillText() {}, measureText(text) { return { width: text.length * 24 }; } };
globalThis.document = { createElement: () => ({ getContext: () => context }) };
class Canvas extends EventTarget {
  clientWidth = 1024; clientHeight = 600; style = {}; captures = new Set();
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); emit(this, 'lostpointercapture', { pointerId: id }); }
}
function emit(target, type, props = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(props)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event); return event;
}
function tick(count = 1) { for (let i = 0; i < count; i++) { now += 1000 / 60; frame?.(now); } }
const manifest = JSON.parse(await readFile(new URL('../../core/data/fictional-city/district.v1.json', import.meta.url)));
const { createCityScene } = await import('../../js/fictional-city/scene.mjs');
const canvas = new Canvas(), errors = [], reports = [];
const scene = createCityScene({ canvas, manifest, onError: e => errors.push(e), onView: view => reports.push(view) });
const snapshot = () => JSON.stringify(scene.getPlayer());
const down = (id, x, y) => emit(canvas, 'pointerdown', { pointerId: id, clientX: x, clientY: y, button: 0 });
const move = (id, x, y) => emit(canvas, 'pointermove', { pointerId: id, clientX: x, clientY: y });
const up = (id, x, y, type = 'pointerup') => emit(canvas, type, { pointerId: id, clientX: x, clientY: y });
const check = (name, action) => { action(); console.log('PASS ' + name); };
try {
  tick();
  check('default close view uses a perspective camera and overview remains orthographic', () => {
    assert.equal(__rendered.camera.isPerspectiveCamera, true);
    scene.setViewMode('overview'); tick(); assert.equal(__rendered.camera.isOrthographicCamera, true);
    scene.setViewMode('close'); tick(); assert.equal(__rendered.camera.isPerspectiveCamera, true);
  });
  check('zoom and 2-axis look change camera, not player coordinates', () => {
    const start = snapshot(), view = scene.getView();
    scene.zoomBy(1.25); tick(); assert.ok(scene.getView().zoom > view.zoom);
    down(1, 450, 250); move(1, 490, 210); up(1, 490, 210); tick(30);
    assert.ok(scene.getView().yaw !== view.yaw); assert.ok(scene.getView().pitch < view.pitch); assert.equal(snapshot(), start);
  });
  check('cancel, lost capture and two-finger browser pinch never become walk taps', () => {
    for (const type of ['pointercancel', 'lostpointercapture']) {
      const start = snapshot(); down(1, 500, 350); up(1, 500, 350, type); tick(30); assert.equal(snapshot(), start);
    }
    const start = snapshot(); down(1, 400, 350); down(2, 500, 350);
    move(1, 380, 350); move(2, 520, 350); up(1, 380, 350); up(2, 520, 350); tick(30);
    assert.equal(snapshot(), start); assert.equal(canvas.captures.size, 0);
  });
  check('modal pause and blur clear held inputs, gestures and captures', () => {
    const start = snapshot(); down(1, 450, 250); scene.setInput({ x: 1 }); scene.setPaused(true);
    up(1, 450, 250); emit(canvas, 'wheel', { deltaY: -100 }); const view = scene.getView();
    scene.zoomBy(2); scene.setViewMode('overview'); tick(20);
    assert.equal(snapshot(), start); assert.equal(scene.getView().zoom, view.zoom); assert.equal(scene.getView().mode, view.mode);
    assert.equal(canvas.captures.size, 0); scene.setPaused(false); tick(20); assert.equal(snapshot(), start);
    down(1, 450, 250); scene.setInput({ x: 1 }); emit(globalEvents, 'blur'); up(1, 450, 250); tick(20); assert.equal(snapshot(), start);
  });
  check('Ctrl-wheel remains browser zoom; ordinary wheel magnifies the scene', () => {
    const zoom = scene.getView().zoom;
    assert.equal(emit(canvas, 'wheel', { deltaY: -100, ctrlKey: true }).defaultPrevented, false); tick(); assert.equal(scene.getView().zoom, zoom);
    assert.equal(emit(canvas, 'wheel', { deltaY: -100 }).defaultPrevented, true); tick(); assert.ok(scene.getView().zoom > zoom);
  });
  check('tap on projected ground still walks in close view, and dragging stops an existing path', () => {
    scene.teleport({ x: 0, z: 2.5, interior: null }); scene.setViewMode('close'); tick();
    const ground = new THREE.Vector3(0, .16, -3).project(__rendered.camera);
    const x = (ground.x + 1) * canvas.clientWidth / 2, y = (1 - ground.y) * canvas.clientHeight / 2;
    assert.ok(Math.abs(ground.x) < 1 && Math.abs(ground.y) < 1, 'walk target is visible');
    down(1, x, y); up(1, x, y); tick(20); assert.ok(scene.getPlayer().z < 2, 'tap began walking');
    down(1, 450, 250); move(1, 480, 260); up(1, 480, 260); const stopped = snapshot(); tick(40); assert.equal(snapshot(), stopped);
  });
  check('camera-relative d-pad and recenter work after rotating', () => {
    scene.teleport({ x: 0, z: 2.5, interior: null }); scene.setViewMode('close'); tick();
    const start = scene.getPlayer(); scene.setInput({ x: 1 }); tick(10); scene.setInput({ x: 0 });
    assert.ok(scene.getPlayer().x > start.x); scene.resetView(); tick(); assert.ok(Number.isFinite(scene.getView().yaw));
  });
  check('repeated interiors report room orientation, shorten at walls, and avoid shelf products', () => {
    for (let i = 0; i < 4; i++) { assert.equal(scene.enterBuilding(manifest.businesses[i].id), true); tick(10); assert.ok(reports.at(-1).room); scene.exitBuilding(); tick(10); assert.equal(reports.at(-1).interior, null); }
    scene.teleport({ x: 4.3, z: -.6, interior: manifest.businesses[0].id });
    scene.setViewMode('close'); tick();
    down(1, 500, 300); move(1, 500 - Math.PI / 2 / .006, 300); up(1, 500 - Math.PI / 2 / .006, 300);
    scene.zoomBy(2); tick();
    const [x, y, z] = scene.getView().position;
    assert.ok(!(x >= 6.45 && x <= 7.15 && y >= 2.205 && y <= 2.655 && z >= -.925 && z <= -.275), 'camera is outside the rendered shelf product');
    assert.ok(x < 6.45, 'camera boom shortens before the shelf');
  });
  check('HQ navigation follows the bridge to the doorway without teleporting', () => {
    scene.teleport({ x: 0, z: 2.5 });
    assert.equal(scene.walkTo({ x: 0, z: 74 }), true);
    tick(1000);
    const p = scene.getPlayer();
    assert.ok(Math.hypot(p.x, p.z - 74) < .3, JSON.stringify(p));
  });
  check('first-person camera sits at the player eye and locked third person steers without strafing', () => {
    scene.teleport({ x: 0, z: 2.5 });
    scene.setViewMode('first'); tick();
    const eye = scene.getView().position, player = scene.getPlayer();
    assert.ok(Math.abs(eye[0] - player.x) < 1e-9 && Math.abs(eye[2] - player.z) < 1e-9);
    assert.equal(eye[1], 1.65);
    scene.setViewMode('close'); scene.setFollow(true); tick();
    const before = snapshot(), yaw = scene.getView().yaw;
    scene.setInput({ x: 1 }); tick(30); scene.setInput({});
    assert.equal(snapshot(), before); assert.ok(Math.abs(scene.getView().yaw - yaw) > .5);
    scene.setInput({ z: -1 }); tick(20); scene.setInput({});
    assert.notEqual(snapshot(), before);
    scene.setFollow(false);
  });
  check('bike mounts outdoors, moves, dismounts for walking routes and refuses interiors', () => {
    scene.teleport({ x: 0, z: 2.5 }); scene.setViewMode('close');
    assert.equal(scene.setTravelMode('bike'), true); tick();
    assert.equal(scene.getStats().travel, 'bike');
    const before = scene.getPlayer(); scene.setInput({ z: -1 }); tick(30); scene.setInput({});
    assert.ok(Math.hypot(scene.getPlayer().x - before.x, scene.getPlayer().z - before.z) > .2);
    scene.walkTo({ x: 0, z: 2.5 }); assert.equal(scene.getStats().travel, 'walk');
    scene.enterBuilding(manifest.businesses[0].id);
    assert.equal(scene.setTravelMode('bike'), false); assert.equal(scene.getStats().travel, 'walk');
  });
  check('route preview stays still, confirmation walks the route and indoor routing exits through the door', () => {
    scene.teleport({ x: 0, z: 2.5 });
    const target = { id: 'equity-uprise-hq', name: 'Equity Uprise HQ', x: 0, z: 74 };
    assert.equal(scene.previewNavigation(target), true);
    const before = snapshot(); tick(30); assert.equal(snapshot(), before);
    assert.equal(scene.getNavigation().status, 'preview');
    assert.equal(scene.confirmNavigation(), true); tick(1000);
    assert.equal(scene.getNavigation().status, 'arrived');
    scene.enterBuilding(manifest.garage.id);
    assert.equal(scene.previewNavigation(target), true); assert.equal(scene.getNavigation().phase, 'exit');
    assert.equal(scene.confirmNavigation(), true); tick(2300);
    assert.equal(scene.getPlayer().interior, null); assert.equal(scene.getNavigation().status, 'arrived');
    assert.ok(Math.hypot(scene.getPlayer().x, scene.getPlayer().z - 74) < .3);
    scene.previewNavigation({ ...target, z: 40 }); scene.confirmNavigation(); scene.setInput({ x: 1 }); tick(); scene.setInput({});
    assert.equal(scene.getNavigation().status, 'paused');
    assert.equal(scene.confirmNavigation(), true); scene.cancelNavigation(); assert.equal(scene.getNavigation(), null);
  });
  check('camera and focus interruptions pause routes without arrival or an early interior exit', () => {
    const target = { id: 'equity-uprise-hq', name: 'Equity Uprise HQ', x: 0, z: 74 };
    const interruptions = [
      () => scene.setViewMode('overview'),
      () => scene.resetView(),
      () => { down(1, 450, 250); move(1, 480, 260); up(1, 480, 260); },
      () => emit(globalEvents, 'blur'),
    ];
    for (const indoor of [false, true]) for (const interrupt of interruptions) {
      scene.teleport({ x: 0, z: 2.5 }); scene.setViewMode('close');
      if (indoor) scene.enterBuilding(manifest.garage.id);
      assert.equal(scene.previewNavigation(target), true);
      assert.equal(scene.confirmNavigation(), true);
      const before = snapshot(); interrupt(); tick(30);
      assert.equal(scene.getNavigation().status, 'paused');
      assert.equal(snapshot(), before, 'interruption must neither move nor exit the player');
      assert.equal(scene.getPlayer().interior, indoor ? manifest.garage.id : null);
      assert.equal(scene.confirmNavigation(), true, 'the paused route can be replanned explicitly');
      scene.cancelNavigation();
    }
  });
  check('portrait resizing updates the active lens without changing the player', () => {
    const start = snapshot(); canvas.clientWidth = 390; canvas.clientHeight = 480;
    scene.setViewMode('overview'); scene.enterBuilding(manifest.businesses[1].id); tick();
    scene.setViewMode('close'); tick(); assert.equal(__rendered.camera.aspect, 390 / 480); assert.equal(scene.getStats().status, 'running');
    assert.equal(errors.length, 0);
  });
} finally { scene.dispose(); }
assert.equal(canvas.captures.size, 0);
// Deferred source intentionally ignores abort to prove both cancellation and stale-result rejection.
const pending = [], streamCanvas = new Canvas();
const streamed = createCityScene({ canvas: streamCanvas, manifest: { ...manifest, neighborhoods: [] },
  chunkIndex: { chunks: [{ id: 'c0_0', bounds: { minX: 60, maxX: 61, minZ: 0, maxZ: 1 } }] },
  loadChunk: (id, { signal }) => new Promise(resolve => pending.push({ id, signal, resolve })) });
const flush = () => new Promise(resolve => setImmediate(resolve));
try {
  await flush(); assert.equal(pending.length, 1);
  streamed.teleport({ x: -60, z: 2.5 }); tick(20); await flush();
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(streamed.getStats().chunks.cancellations, 1);
  streamed.teleport({ x: 0, z: 2.5 }); tick(20); await flush(); assert.equal(pending.length, 2);
  const payload = { id: 'c0_0', roads: [], props: [], parcels: [] };
  pending[0].resolve(payload); await flush(); assert.equal(streamed.getStats().chunks.loads, 0);
  assert.equal(streamed.getStats().chunks.loading, 1);
  pending[1].resolve(payload); await flush(); assert.equal(streamed.getStats().chunks.loads, 1);
  console.log('PASS chunk exit aborts downloads and stale replies cannot replace a new region request');
} finally { streamed.dispose(); }
console.log('All deterministic scene/input checks passed. Pixel rendering and real-device QA are separate.');
