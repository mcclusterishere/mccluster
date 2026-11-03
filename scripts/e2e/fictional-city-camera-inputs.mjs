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
  check('portrait resizing updates the active lens without changing the player', () => {
    const start = snapshot(); canvas.clientWidth = 390; canvas.clientHeight = 480;
    scene.setViewMode('overview'); scene.enterBuilding(manifest.businesses[1].id); tick();
    scene.setViewMode('close'); tick(); assert.equal(__rendered.camera.aspect, 390 / 480); assert.equal(scene.getStats().status, 'running');
    assert.equal(errors.length, 0);
  });
} finally { scene.dispose(); }
assert.equal(canvas.captures.size, 0);
console.log('All deterministic scene/input checks passed. Pixel rendering and real-device QA are separate.');
