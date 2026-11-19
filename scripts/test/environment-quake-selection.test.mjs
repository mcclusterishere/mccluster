/* A quake chosen on the globe, end to end inside the frame (event timeline slice S5, 2026-11-19): js/environment-layers.js with
   the three modules it mounts (js/environment-quake-marks.js, js/environment-ripple.js, js/environment-camera.js), in one vm
   realm over a fake Cesium whose globe is a sphere seen from straight above, projected 8 CSS px per degree onto a 390 x 844 frame.
   What the pure tests of each module cannot see: the glyph replaces the quake's dot; a tap within 22 px of a glyph selects it and
   pushes to it, a tap 30 px away does not, and a mission pin keeps its own tap; the tour never pushes; a new choice cancels the
   push under way; the rings wait for the camera to land; the replay hides later quakes' glyphs; the rupture is asked only from M6
   and speaks in the selection; reduced motion moves nothing by itself; the frame is told when the layers go on and off (D16).
     node --test scripts/test/environment-quake-selection.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const SCRIPTS = ['js/environment-quake-marks.js', 'js/environment-ripple.js', 'js/environment-camera.js', 'js/environment-layers.js'].map((p) => [p, read(p)]);
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const plain = (x) => JSON.parse(JSON.stringify(x));

const R = 6371000, RAD = Math.PI / 180;
const ecef = (lon, lat, h = 0) => ({ lon, lat, h, x: (R + h) * Math.cos(lat * RAD) * Math.cos(lon * RAD), y: (R + h) * Math.cos(lat * RAD) * Math.sin(lon * RAD), z: (R + h) * Math.sin(lat * RAD) });
/* the frame looks straight down on (20 E, 10 N): 8 CSS px per degree, (20, 10) at the frame's centre */
const screen = (lon, lat) => ({ x: 195 + (lon - 20) * 8, y: 422 - (lat - 10) * 8 });

function realm({ reduced = false, rupture = null, onActive = null } = {}) {
  const color = (r, g, b, a) => ({ red: r, green: g, blue: b, alpha: a, withAlpha(x) { return color(r, g, b, x); } });
  const event = () => { const fns = new Set(); return { addEventListener: (f) => fns.add(f), removeEventListener: (f) => fns.delete(f), fire: (...a) => [...fns].forEach((f) => f(...a)), size: () => fns.size }; };
  class Collection { constructor() { this.items = []; this.show = true; this.ready = true; } add(o) { this.items.push(o); return o; } isDestroyed() { return false; } }
  class Billboards { constructor() { this.items = []; this.show = true; } add(o) { const b = Object.assign({ image: null, setImage(key) { this.image = key; } }, o); this.items.push(b); return b; } isDestroyed() { return false; } }
  class Ground { constructor(o) { this.o = o; this.geometryInstances = Array.isArray(o.geometryInstances) ? o.geometryInstances : [o.geometryInstances]; this.appearance = o.appearance; this.ready = true; this.show = true; this.attrs = new Map(); } isDestroyed() { return false; } static isSupported() { return true; } static supportsMaterials() { return true; }
    getGeometryInstanceAttributes(id) { const inst = this.geometryInstances.find((i) => i.id === id); if (!inst) return undefined; if (!this.attrs.has(id)) this.attrs.set(id, Object.assign({}, inst.attributes)); return this.attrs.get(id); } }
  class Plain { constructor(o) { Object.assign(this, o || {}); } }
  class Material { constructor(o) { this.fabric = o.fabric; this.uniforms = Object.assign({}, o.fabric.uniforms); } static fromType(type, o) { return { uniforms: { color: (o && o.color) || color(1, 1, 1, 1) } }; } }
  const Cesium = {
    Color: Object.assign(function Color(r, g, b, a) { return color(r, g, b, a); }, { fromCssColorString: (hex) => { const n = parseInt(hex.slice(1), 16); return color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1); }, WHITE: color(1, 1, 1, 1), BLACK: color(0, 0, 0, 1), fromAlpha: (c, a) => color(c.red, c.green, c.blue, a) }),
    Cartesian3: { fromDegrees: (lon, lat, h) => ecef(lon, lat, h || 0), fromDegreesArray: (a) => a },
    Cartesian2: class { constructor(x, y) { this.x = x || 0; this.y = y || 0; } }, DistanceDisplayCondition: Plain, LabelStyle: { FILL_AND_OUTLINE: 1 },
    VerticalOrigin: { BOTTOM: 1, CENTER: 0 }, HorizontalOrigin: { LEFT: 1, RIGHT: -1, CENTER: 0 },
    PointPrimitiveCollection: Collection, LabelCollection: Collection, PolylineCollection: Collection, BillboardCollection: Billboards,
    GroundPrimitive: Ground, GroundPolylinePrimitive: Ground,
    GeometryInstance: Plain, EllipseGeometry: Plain, PolygonGeometry: Plain, PolygonHierarchy: class { constructor(p, h) { this.positions = p; this.holes = h || []; } }, GroundPolylineGeometry: Plain,
    PerInstanceColorAppearance: Object.assign(class extends Plain {}, { VERTEX_FORMAT: 1 }), PolylineColorAppearance: Plain, MaterialAppearance: Plain, Material,
    ColorGeometryInstanceAttribute: { fromColor: (c) => c, toValue: (c) => c }, ShowGeometryInstanceAttribute: class { constructor(v) { this.v = v; } static toValue(v) { return v; } },
    DistanceDisplayConditionGeometryInstanceAttribute: class { constructor(near, far) { this.near = near; this.far = far; } },
    Math: { toRadians: (d) => d * RAD, toDegrees: (r) => r / RAD }, SceneMode: { SCENE2D: 2, SCENE3D: 3 }, EasingFunction: { CUBIC_IN_OUT: 'cubic' },
    SceneTransforms: { worldToWindowCoordinates: (scene, p) => screen(p.lon, p.lat) },
    BoundingSphere: class { constructor(c, r) { this.center = c; this.radius = r; } }, HeadingPitchRange: class { constructor(h, p, r) { this.heading = h; this.pitch = p; this.range = r; } }, Matrix4: { IDENTITY: 'I' }
  };
  const canvasListeners = new Map(), docListeners = new Map();
  const canvas = { clientWidth: 390, clientHeight: 844, addEventListener: (n, f) => canvasListeners.set(n, f), removeEventListener: (n) => canvasListeners.delete(n) };
  const scene = { primitives: { list: [], add(p) { this.list.push(p); return p; }, remove(p) { const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); return true; } }, preRender: event(), postRender: event(), morphStart: event(), morphComplete: event(), renders: 0, requestRender() { this.renders += 1; }, mode: 3, canvas };
  const cameraCalls = [];
  let flight = null;
  const camera = {
    changed: event(), heading: 0.3, positionCartographic: { height: 2e7, longitude: 20 * RAD, latitude: 10 * RAD },
    positionWC: ecef(20, 10, 2e7), directionWC: { x: -1, y: 0, z: 0 }, upWC: { x: 0, y: 0, z: 1 },
    setView(o) { cameraCalls.push(['setView', o]); }, flyTo(o) { cameraCalls.push(['flyTo', o]); },
    flyToBoundingSphere(sphere, o) { cameraCalls.push(['fly', sphere, o]); flight = o; },
    viewBoundingSphere(sphere, offset) { cameraCalls.push(['view', sphere, offset]); }, lookAtTransform(m) { cameraCalls.push(['lookAtTransform', m]); },
    cancelFlight() { cameraCalls.push(['cancelFlight']); if (flight) { const o = flight; flight = null; o.cancel(); } }
  };
  const viewer = { scene, camera };
  const holds = [], released = [];
  const governor = { hold: (o, ms) => holds.push([o, ms]), release: (o) => released.push(o), requestRender: () => { scene.renders += 1; }, enable() {}, disable() {} };
  const queues = [];
  let tourScene = null;
  const director = { setQueue: (items, o) => queues.push({ ids: items.map((i) => i.id), queue: o.queue }), state: () => ({ total: 0 }), scene: () => tourScene, interrupt() {}, stop() {}, pause() {}, play() {}, next() {}, prev() {}, pure: null, attachInput() {} };
  const told = [], asked = { shakemap: [], rupture: [] };
  let handlers = null;
  const client = {
    start(h) { handlers = h; }, stop() {}, isPolicy: () => false, policy: () => null,
    shakemap: (id) => { asked.shakemap.push(id); return Promise.resolve({ ok: false, status: 'unavailable', reason: 'no_shakemap', http: 200 }); },
    rupture: (id) => { asked.rupture.push(id); return Promise.resolve(rupture ? rupture(id) : { ok: true, status: 'available', http: 200, body: { available: false, reason: 'point_source', edges: [] } }); }
  };
  /* a 2D context that measures 7 px a character and draws nothing */
  const ctx = new Proxy({ measureText: (t) => ({ width: String(t).length * 7 }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const legend = { envLegend: { hidden: true }, envLegendList: { lines: [], replaceChildren(...items) { this.lines = items.map((i) => i.textContent); } } };
  const document = { hidden: false, createElement: () => ({ width: 0, height: 0, textContent: '', getContext: () => ctx }), getElementById: (id) => legend[id] || null, addEventListener: (n, f) => docListeners.set(n, f), removeEventListener: (n) => docListeners.delete(n) };
  const window = { matchMedia: (q) => ({ matches: reduced && /reduce/.test(q) }), setTimeout, clearTimeout, performance, devicePixelRatio: 1, document };
  window.window = window;
  const context = vm.createContext(window);
  for (const [path, source] of SCRIPTS) vm.runInContext(source, context, { filename: path });
  const L = window.MCC_ENVIRONMENT_LAYERS;
  const active = [];
  assert.equal(L.mount({ viewer, Cesium, tell: (m) => told.push(m), governor, director, document, client, onActive: onActive || ((v) => active.push(v)) }), true);
  const on = () => L.onMessage({ type: 'hu:environment-layers', on: true, selected: '', replay: null, layers: {} });
  const frame = () => scene.preRender.fire();
  return {
    L, Cesium, scene, camera, cameraCalls, holds, released, told, asked, queues, active, canvasListeners, docListeners, on, frame,
    setTour: (id) => { tourScene = id ? { id } : null; },
    land: () => { if (flight) { const o = flight; flight = null; o.complete(); } },
    flying: () => !!flight,
    billboards: () => scene.primitives.list.filter((p) => p instanceof Billboards),
    dots: () => scene.primitives.list.filter((p) => p instanceof Collection && p.items.some((i) => 'pixelSize' in i)),
    selected: () => told.filter((m) => m.type === 'hu:environment-selected'),
    handlers: () => handlers
  };
}
const quake = (id, lon, lat, mag, over = {}) => ({ id, title: `12 km NW of ${id.slice(5)}, Somewhere`, lat, lon, stale: false, category: 'quake', observed_at: '2026-11-17T10:00:00.000Z', fetched_at: '2026-11-17T20:00:00.000Z', facts: [{ label: 'Magnitude', value: String(mag) }, { label: 'Depth', value: '10 km' }], ...over });
const alert = { id: 'nws:x', title: 'Flood warning', lat: 12, lon: 18, stale: false, category: 'alert', observed_at: '2026-11-17T09:00:00.000Z', fetched_at: '2026-11-17T20:00:00.000Z', facts: [] };
const EVENTS = [quake('usgs:big', 20, 10, 6.3), quake('usgs:mid', 28, 4, 4.8, { observed_at: '2026-11-17T12:00:00.000Z' }), quake('usgs:small', 12, 16, 3.1, { observed_at: '2026-11-17T08:00:00.000Z' }), alert];
function ready(opts) {
  const w = realm(opts);
  w.on();
  w.L.setEvents(EVENTS, { on: true, selected: '' });
  w.frame();
  return w;
}

test('each quake is a glyph, not a dot: one billboard per quake, the other events keep their dots; the largest are labelled', () => {
  const w = ready();
  const d = w.L.debug();
  assert.equal(d.counts.quakes, 3); assert.equal(d.counts.glyphs, 3);
  assert.equal(d.marks.glyphs, 3); assert.equal(d.marks.visible, 3);
  const [glyphs] = w.billboards();
  assert.equal(glyphs.items.length, 3);
  assert.ok(glyphs.items.every((b) => b.disableDepthTestDistance === Infinity && /^g\|/.test(b.image)), 'drawn over the terrain, from a drawn image');
  const dots = w.dots().flatMap((c) => c.items);
  assert.deepEqual(dots.map((p) => p.id.id), ['nws:x'], 'the alert keeps its dot; no quake has one');
  /* M6.3 and M4.8 carry a label; M3.1 is below M4.5 */
  assert.deepEqual(plain(d.marks.labels).sort(), ['usgs:big', 'usgs:mid']);
  /* sized by magnitude: M6.3 larger than M3.1 */
  const size = (id) => glyphs.items.find((b) => b.id.id === id).width;
  assert.ok(size('usgs:big') > size('usgs:mid') && size('usgs:mid') > size('usgs:small'));
});

/* Cesium 1.131's EllipseGeometry steps round the rim by eight times its granularity, whatever the radius */
const rimPoints = (granularity) => 4 * Math.ceil(Math.PI / 2 / (8 * granularity) - 1e-9);
test('every quake disc is round where the push lands: 48 points round its rim, never the octagon of PI / 32, never thousands', () => {
  const w = ready();
  const discs = w.scene.primitives.list.flatMap((p) => p.geometryInstances || []).filter((i) => i.geometry && typeof i.geometry.semiMajorAxis === 'number' && i.id && /^usgs:/.test(i.id.id));
  assert.deepEqual(discs.map((i) => i.id.id).sort(), ['usgs:big', 'usgs:mid', 'usgs:small'], 'one disc a quake');
  /* the same step at every size: a step scaled to the radius gave a small disc tens of thousands of points and crashed the renderer */
  assert.deepEqual(discs.map((i) => rimPoints(i.geometry.granularity)), [48, 48, 48]);
  assert.equal(rimPoints(Math.PI / 32), 8, 'the step used before drew an octagon');
});

test('an energy disc steps back at a regional frame: hidden within five of its radii of the camera, 600 km at the least', () => {
  const w = ready();
  const discs = w.scene.primitives.list.flatMap((p) => p.geometryInstances || []).filter((i) => i.geometry && typeof i.geometry.semiMajorAxis === 'number' && i.id && /^usgs:/.test(i.id.id));
  const near = Object.fromEntries(discs.map((i) => [i.id.id, i.attributes.distanceDisplayCondition && i.attributes.distanceDisplayCondition.near]));
  /* M6.3: a 236 km disc, gone within 1,180 km; M4.8 and M3.1 within 600 km; the push lands 120-300 km away, so none of them covers it */
  assert.equal(Math.round(near['usgs:big'] / 1000), 1180);
  assert.deepEqual([near['usgs:mid'], near['usgs:small']], [600000, 600000]);
  assert.ok(discs.every((i) => i.attributes.distanceDisplayCondition.far === Number.MAX_VALUE), 'and seen from any distance beyond');
  const E = w.L.encodings;
  assert.equal(E.discNearM(null), 600000); assert.equal(E.discNearM(E.quakeRadiusM(7)), 5 * E.quakeRadiusM(7));
});

test('a tap within 22 px of a glyph selects that quake and pushes to it; 30 px away it selects nothing; a mission pin keeps its tap', () => {
  const w = ready();
  const at = screen(20, 10);
  /* 30 px to the right of the M6.3 glyph: no glyph within 22 px */
  assert.equal(w.L.pick(undefined, { x: at.x + 30, y: at.y }), false);
  assert.equal(w.selected().length, 0);
  /* a mission pin (an entity the World drew, not an environment pick) under the finger keeps its tap, glyph or not */
  assert.equal(w.L.pick({ id: { name: 'mission pin' } }, { x: at.x + 2, y: at.y }), false);
  assert.equal(w.selected().length, 0);
  /* 15 px away: the M6.3 quake is chosen and the camera pushes to its regional frame */
  assert.equal(w.L.pick(undefined, { x: at.x + 15, y: at.y }), true);
  const sel = w.selected().pop();
  assert.equal(sel.id, 'usgs:big'); assert.equal(sel.via, 'pick');
  const fly = w.cameraCalls.find((c) => c[0] === 'fly');
  assert.ok(fly, 'a flight');
  assert.deepEqual([fly[1].center.lon, fly[1].center.lat, fly[1].radius], [20, 10, 0]);
  assert.equal(fly[2].offset.range, 228000, 'M6.3: 120 km + 60 km a unit above M4.5');
  assert.equal(fly[2].offset.heading, 0.3, 'the heading kept');
  assert.ok(w.holds.some(([o, ms]) => o === 'env-focus' && ms <= 2600), 'a bounded focus hold');
  assert.equal(w.L.debug().marks.selected, 'usgs:big');
  /* over a fire cell's fill (an environment pick that is not a quake) the glyph still wins */
  const w2 = ready();
  const cell = { id: w2.L.pickId({ layer: 'cells', id: 'cell:1', kind: 'cell' }) };
  const mid = screen(28, 4);
  assert.equal(w2.L.pick(cell, { x: mid.x - 10, y: mid.y + 10 }), true);
  assert.equal(w2.selected().pop().id, 'usgs:mid');
});

test('the rings wait for the camera to land; a new choice cancels the push under way; the visitor\'s hand stops it at once', () => {
  const w = ready();
  const big = screen(20, 10), mid = screen(28, 4);
  w.L.pick(undefined, big);
  assert.equal(w.L.debug().ripple.phase, 'waiting', 'nothing moves on the ground while the camera flies');
  assert.ok(w.holds.some(([o]) => o === 'env-ripple'), 'the ripple holds the loop from the choice (bounded)');
  w.land();
  w.frame();
  assert.equal(w.L.debug().ripple.phase, 'rings', 'landed: the rings go');
  assert.equal(w.L.debug().camera.last.how, 'complete');
  /* a second tap while a push flies: the first is cancelled, the second flies */
  w.L.pick(undefined, mid);
  assert.ok(w.flying());
  w.L.pick(undefined, big);
  assert.ok(w.cameraCalls.some((c) => c[0] === 'cancelFlight'), 'Cesium told to stop');
  assert.equal(w.cameraCalls.filter((c) => c[0] === 'fly').length, 3);
  assert.equal(w.L.debug().camera.id, 'usgs:big');
  /* the visitor's own gesture on the globe stops the push where it is */
  w.canvasListeners.get('pointerdown')();
  assert.equal(w.flying(), false);
  assert.equal(w.L.debug().camera.last.how, 'cancel'); assert.equal(w.L.debug().camera.last.reason, 'input');
  /* cancelled is landed: the rings begin there */
  w.frame();
  assert.equal(w.L.debug().ripple.phase, 'rings');
});

test('the tour never pushes: its arrival selects, the rings start at once, the camera is the director\'s', () => {
  const w = ready();
  w.L.select('usgs:mid', 'tour');
  assert.equal(w.cameraCalls.filter((c) => c[0] === 'fly' || c[0] === 'view').length, 0);
  w.frame();
  assert.equal(w.L.debug().ripple.phase, 'rings');
  assert.equal(w.selected().pop().via, 'tour');
});

test('a post\'s Show on globe pushes (focus); the panel\'s row selects first and its focus pushes, the rings waiting for the landing', () => {
  const w = ready();
  w.L.onMessage({ type: 'hu:environment-focus', id: 'usgs:mid' });
  const fly = w.cameraCalls.filter((c) => c[0] === 'fly');
  assert.equal(fly.length, 1); assert.equal(fly[0][2].offset.range, 138000, 'M4.8');
  /* the panel's row: pins carrying the selection, then its focus */
  const p = ready();
  p.L.setEvents(EVENTS, { on: true, selected: 'usgs:big' });
  assert.equal(p.L.debug().ripple.phase, 'waiting');
  p.L.onMessage({ type: 'hu:environment-focus', id: 'usgs:big' });
  assert.equal(p.cameraCalls.filter((c) => c[0] === 'fly').length, 1, 'one push, from the focus');
  p.land(); p.frame();
  assert.equal(p.L.debug().ripple.phase, 'rings');
});

test('the replay hides the glyphs (and labels) of quakes recorded after the current scene', () => {
  const w = ready();
  w.setTour('usgs:big');
  w.L.onMessage({ type: 'hu:environment-layers', on: true, selected: '', replay: 'quakes-24h', layers: {} });
  w.frame();
  const m = w.L.debug().marks;
  assert.equal(m.cutoff, Date.parse('2026-11-17T10:00:00.000Z'));
  assert.equal(m.visible, 2, 'usgs:mid (12:00) is hidden at the 10:00 scene');
  assert.ok(!m.labels.includes('usgs:mid'));
  w.L.onMessage({ type: 'hu:environment-layers', on: true, selected: '', replay: null, layers: {} });
  w.frame();
  assert.equal(w.L.debug().marks.visible, 3, 'the replay off: every glyph again');
});

test('the rupture is asked from M6 only; a modelled edge is drawn and named a model, a point source says why nothing is', async () => {
  const body = { available: true, reason: null, modelled: true, label: 'modelled rupture plane (USGS finite fault)', edges: [[[19.9, 9.8], [20.2, 10.3]]], top_depth_km: 0.1, bottom_depth_km: 22.7, reference: 'Source: USGS NEIC Rapid Finite Fault', reviewed: true };
  const w = ready({ rupture: () => ({ ok: true, status: 'available', http: 200, body }) });
  w.L.pick(undefined, screen(28, 4));
  await flush();
  assert.deepEqual(w.asked.rupture, [], 'M4.8: never asked');
  w.L.pick(undefined, screen(20, 10));
  await flush();
  assert.deepEqual(w.asked.rupture, ['usgs:big']);
  const d = w.L.debug();
  assert.deepEqual([d.rupture.quakeId, d.rupture.lines, d.rupture.available], ['usgs:big', 1, true]);
  const fact = w.selected().pop().facts.find((f) => f.label === 'Rupture');
  assert.match(fact.value, /modelled/i);
  assert.ok(d.legend.some((l) => /up-dip edge/.test(l)), 'the legend says what the line is');
  /* deselected: the line goes */
  w.L.clearSelection();
  assert.equal(w.L.debug().rupture, null);
  const p = ready();
  p.L.pick(undefined, screen(20, 10));
  await flush();
  const none = p.selected().pop().facts.find((f) => f.label === 'Rupture');
  assert.ok(none && /point/i.test(none.value), 'a point source: nothing drawn, and the reason given: ' + (none && none.value));
  assert.equal(p.L.debug().rupture.lines, 0);
});

test('reduced motion: a tap selects without moving the camera; a chosen post jumps; the ripple is a still outline', () => {
  const w = ready({ reduced: true });
  assert.equal(w.L.pick(undefined, screen(20, 10)), true);
  assert.equal(w.cameraCalls.length, 0, 'the camera untouched');
  assert.equal(w.L.debug().ripple.phase, 'outline');
  assert.equal(w.selected().pop().illustrative, 'Ripple is illustrative: not a recording of shaking');
  w.L.onMessage({ type: 'hu:environment-focus', id: 'usgs:mid' });
  assert.deepEqual(w.cameraCalls.map((c) => c[0]), ['view', 'lookAtTransform'], 'placed at once, no flight');
});

test('D16: the frame is told when the layers go on and off, and isOn follows', () => {
  const w = realm();
  assert.equal(w.L.isOn(), false);
  w.on();
  assert.equal(w.L.isOn(), true);
  w.L.onMessage({ type: 'hu:environment-layers', on: false, selected: '', replay: null, layers: {} });
  assert.equal(w.L.isOn(), false);
  assert.deepEqual(w.active, [true, false]);
});
