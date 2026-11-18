/* The typed layers' runtime seam with the scene director (js/environment-layers.js setEvents): the tour queue follows the pins
   whenever what the queue is built from changed (an item's significance, its recorded time) even when no geometry changed, and a
   flag change alone never rebuilds the primitives. Found in the integration pass of slice G1 (2026-11-17): a ShakeMap makes a
   quake significant, the panel re-sends the pins with the flag, and the tour has to grow without a redraw. Runs the module in a
   vm realm over a fake Cesium that supports point collections only (no ground primitives), a fake viewer and a fake director. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const source = read('js/environment-layers.js');

function realm() {
  const color = (r, g, b, a) => ({ red: r, green: g, blue: b, alpha: a, withAlpha(x) { return color(r, g, b, x); } });
  const event = () => { const fns = new Set(); return { addEventListener: (f) => fns.add(f), removeEventListener: (f) => fns.delete(f), fire: (...a) => [...fns].forEach((f) => f(...a)) }; };
  class Collection { constructor() { this.items = []; this.show = true; this.ready = true; } add(o) { this.items.push(o); return o; } isDestroyed() { return false; } }
  const Cesium = {
    Color: Object.assign(function Color(r, g, b, a) { return color(r, g, b, a); }, { fromCssColorString: () => color(1, 1, 1, 1), WHITE: color(1, 1, 1, 1), fromAlpha: (c, a) => color(c.red, c.green, c.blue, a) }),
    Cartesian3: { fromDegrees: (lon, lat, h) => ({ lon, lat, h: h || 0 }), fromDegreesArray: (a) => a },
    Cartesian2: class { constructor(x, y) { this.x = x; this.y = y; } },
    PointPrimitiveCollection: Collection, LabelCollection: Collection, PolylineCollection: Collection,
    GroundPrimitive: { isSupported: () => false }, GroundPolylinePrimitive: { isSupported: () => false },
    GeometryInstance: class { constructor(o) { Object.assign(this, o); } }, EllipseGeometry: class { constructor(o) { Object.assign(this, o); } },
    PerInstanceColorAppearance: { VERTEX_FORMAT: 1 }, ColorGeometryInstanceAttribute: { fromColor: (c) => c, toValue: (c) => c }, ShowGeometryInstanceAttribute: class { constructor(v) { this.v = v; } static toValue(v) { return v; } },
    Math: { toRadians: (d) => d * Math.PI / 180, toDegrees: (r) => r * 180 / Math.PI }, SceneMode: { SCENE2D: 2, SCENE3D: 3 }, EasingFunction: { CUBIC_IN_OUT: 'cubic' },
    LabelStyle: { FILL_AND_OUTLINE: 1 }, VerticalOrigin: { BOTTOM: 1 }, DistanceDisplayCondition: class {}, Material: { fromType: () => ({ uniforms: { color: color(1, 1, 1, 1) } }) }
  };
  const scene = { primitives: { list: [], add(p) { this.list.push(p); return p; }, remove(p) { const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); return true; } }, preRender: event(), postRender: event(), morphStart: event(), morphComplete: event(), renders: 0, requestRender() { this.renders += 1; }, mode: 3, canvas: { addEventListener() {} } };
  const viewer = { scene, camera: { changed: event(), positionCartographic: { height: 2e7, longitude: 0, latitude: 0 }, setView() {}, flyTo() {}, cancelFlight() {} } };
  const queues = [];
  const director = { setQueue: (items, o) => queues.push({ ids: items.map((i) => i.id), significant: items.filter((i) => i.significant === true).map((i) => i.id), queue: o.queue }), state: () => ({ total: queues.length ? queues[queues.length - 1].significant.length : 0 }), scene: () => null, interrupt() {}, stop() {}, pure: null, attachInput() {} };
  const told = [];
  const window = { matchMedia: () => ({ matches: false }), setTimeout, clearTimeout, performance, document: null };
  window.window = window;
  vm.runInNewContext(source, window);
  const L = window.MCC_ENVIRONMENT_LAYERS;
  assert.equal(L.mount({ viewer, Cesium, tell: (m) => told.push(m), governor: null, director, document: null, client: { start() {}, stop() {}, shakemap() { return Promise.resolve({ ok: false, status: 'unavailable', reason: 'invalid_event', http: null }); }, isPolicy: () => false } }), true);
  return { L, queues, told, scene, window };
}
const quake = (id, over = {}) => ({ id, title: id, lat: 10, lon: 20, stale: false, category: 'quake', observed_at: '2026-11-17T10:00:00.000Z', fetched_at: '2026-11-17T20:00:00.000Z', facts: [{ label: 'Magnitude', value: '5.4' }, { label: 'Depth', value: '10 km' }], ...over });

test('the tour queue follows the pins: a significance flag that changed with no geometry change re-syncs the director without a rebuild', () => {
  const { L, queues, scene } = realm();
  L.setEvents([quake('usgs:a', { significant: true }), quake('usgs:b')], { on: true, selected: '' });
  assert.equal(queues.length, 1, 'the first pins build the queue');
  assert.deepEqual(queues[0].significant, ['usgs:a']);
  const dots = scene.primitives.list.slice();
  assert.equal(dots.length, 1, 'one point collection for the events layer (no ground primitive in this realm)');
  /* the same rows, the same geometry: the ShakeMap made b significant, the panel re-sent the pins with the flag */
  L.setEvents([quake('usgs:a', { significant: true }), quake('usgs:b', { significant: true })], { on: true, selected: '' });
  assert.equal(queues.length, 2, 'the director is given the pins again');
  assert.deepEqual(queues[1].significant, ['usgs:a', 'usgs:b']);
  assert.deepEqual(scene.primitives.list, dots, 'no primitive was rebuilt for a flag change');
  /* nothing changed: nothing is re-sent */
  L.setEvents([quake('usgs:a', { significant: true }), quake('usgs:b', { significant: true })], { on: true, selected: '' });
  assert.equal(queues.length, 2, 'identical pins re-sync nothing');
  /* a recorded time that changed re-orders the tour, so the director is told, still without a rebuild */
  L.setEvents([quake('usgs:a', { significant: true, observed_at: '2026-11-17T12:00:00.000Z' }), quake('usgs:b', { significant: true })], { on: true, selected: '' });
  assert.equal(queues.length, 3);
  assert.deepEqual(scene.primitives.list, dots);
  /* a geometry change (a new row) rebuilds and re-syncs */
  L.setEvents([quake('usgs:a', { significant: true }), quake('usgs:b', { significant: true }), quake('usgs:c')], { on: true, selected: '' });
  assert.equal(queues.length, 4);
  assert.notDeepEqual(scene.primitives.list, dots, 'a new row rebuilds the events primitives');
  assert.equal(L.debug().counts.events, 3);
});

test('the events layer state is told once per data change and the pins-off message empties the layer', () => {
  const { L, told, queues } = realm();
  L.setEvents([quake('usgs:a', { significant: true })], { on: true, selected: '' });
  const states = () => told.filter((m) => m.type === 'hu:environment-layer-state' && m.layer === 'events');
  assert.equal(states().length, 1);
  assert.equal(states()[0].count, 1); assert.equal(states()[0].status, 'available'); assert.equal(states()[0].fetched_at, '2026-11-17T20:00:00.000Z');
  L.setEvents([quake('usgs:a', { significant: true })], { on: true, selected: '' });
  assert.equal(states().length, 1, 'no state for identical pins');
  L.setEvents([], { on: false, selected: '' });
  assert.equal(L.debug().counts.events, 0); assert.equal(L.debug().eventsOn, false);
  assert.equal(states().length, 2); assert.equal(states()[1].status, 'unavailable'); assert.equal(states()[1].count, 0);
  assert.deepEqual(queues[queues.length - 1].ids, []);
});
