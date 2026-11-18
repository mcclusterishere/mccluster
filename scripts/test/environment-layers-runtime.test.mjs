/* The typed layers' runtime seams (js/environment-layers.js), run in a vm realm over a fake Cesium that resolves instance attributes
   by the id's identity as Cesium 1.131 does, a fake viewer, a fake director and a fake layer client. Each case is a review finding of
   slice G1 (2026-11-18) that the module's pure encodings could not catch:
   - G1R-1: the tour queue follows the pins whenever what it is built from changed (an item's significance, its recorded time) even
     when no geometry changed, and a flag change alone never rebuilds the primitives;
   - G1R-3: a layer's state and a selection speak for the record that produced what is drawn (the water-level readings, never the
     station catalogue; the ShakeMap contours, never the event detail), so a reading is never shown as retrieved before it was observed.
     node --test scripts/test/environment-layers-runtime.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const source = read('js/environment-layers.js');
const TIDES = JSON.parse(read('scripts/e2e/fixtures/environment/layers-tides.json'));
const SHAKEMAP = JSON.parse(read('scripts/e2e/fixtures/environment/shakemap-us7000tyhr.json'));
const SHAKEMAP_NONE = JSON.parse(read('scripts/e2e/fixtures/environment/shakemap-none.json'));
const FIRES = JSON.parse(read('scripts/e2e/fixtures/environment/layers-fires.json'));
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function realm({ shakemap = null, doc = null } = {}) {
  const color = (r, g, b, a) => ({ red: r, green: g, blue: b, alpha: a, withAlpha(x) { return color(r, g, b, x); } });
  const event = () => { const fns = new Set(); return { addEventListener: (f) => fns.add(f), removeEventListener: (f) => fns.delete(f), fire: (...a) => [...fns].forEach((f) => f(...a)) }; };
  class Collection { constructor() { this.items = []; this.show = true; this.ready = true; } add(o) { this.items.push(o); return o; } isDestroyed() { return false; } }
  /* a ground primitive as Cesium keeps it: instance attributes are found by the id's identity, the first match wins */
  class Ground { constructor(o) { this.geometryInstances = Array.isArray(o.geometryInstances) ? o.geometryInstances : [o.geometryInstances]; this.ready = true; this.show = true; this.attrs = new Map(); } isDestroyed() { return false; } static isSupported() { return true; }
    getGeometryInstanceAttributes(id) { const inst = this.geometryInstances.find((i) => i.id === id); if (!inst) return undefined; if (!this.attrs.has(id)) this.attrs.set(id, Object.assign({}, inst.attributes)); return this.attrs.get(id); } }
  class Plain { constructor(o) { Object.assign(this, o || {}); } }
  const Cesium = {
    Color: Object.assign(function Color(r, g, b, a) { return color(r, g, b, a); }, { fromCssColorString: (hex) => { const n = parseInt(hex.slice(1), 16); return color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1); }, WHITE: color(1, 1, 1, 1), BLACK: color(0, 0, 0, 1), fromAlpha: (c, a) => color(c.red, c.green, c.blue, a) }),
    Cartesian3: { fromDegrees: (lon, lat, h) => ({ lon, lat, h: h || 0 }), fromDegreesArray: (a) => a },
    Cartesian2: Plain, DistanceDisplayCondition: Plain, LabelStyle: { FILL_AND_OUTLINE: 1 }, VerticalOrigin: { BOTTOM: 1 },
    PointPrimitiveCollection: Collection, LabelCollection: Collection, PolylineCollection: Collection,
    GroundPrimitive: Ground, GroundPolylinePrimitive: Ground,
    GeometryInstance: Plain, EllipseGeometry: Plain, PolygonGeometry: Plain, PolygonHierarchy: class { constructor(p, h) { this.positions = p; this.holes = h || []; } }, GroundPolylineGeometry: Plain,
    PerInstanceColorAppearance: Object.assign(class extends Plain {}, { VERTEX_FORMAT: 1 }), PolylineColorAppearance: Plain, MaterialAppearance: Plain,
    ColorGeometryInstanceAttribute: { fromColor: (c) => c, toValue: (c) => c }, ShowGeometryInstanceAttribute: class { constructor(v) { this.v = v; } static toValue(v) { return v; } },
    Material: { fromType: (type, o) => ({ uniforms: { color: (o && o.color) || color(1, 1, 1, 1) } }) },
    Math: { toRadians: (d) => d * Math.PI / 180, toDegrees: (r) => r * 180 / Math.PI }, SceneMode: { SCENE2D: 2, SCENE3D: 3 }, EasingFunction: { CUBIC_IN_OUT: 'cubic' }
  };
  const scene = { primitives: { list: [], add(p) { this.list.push(p); return p; }, remove(p) { const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); return true; } }, preRender: event(), postRender: event(), morphStart: event(), morphComplete: event(), renders: 0, requestRender() { this.renders += 1; }, mode: 3, canvas: { addEventListener() {} } };
  const viewer = { scene, camera: { changed: event(), positionCartographic: { height: 2e7, longitude: 0, latitude: 0 }, setView() {}, flyTo() {}, cancelFlight() {} } };
  const queues = [];
  const director = { setQueue: (items, o) => queues.push({ ids: items.map((i) => i.id), significant: items.filter((i) => i.significant === true).map((i) => i.id), queue: o.queue }), state: () => ({ total: queues.length ? queues[queues.length - 1].significant.length : 0 }), scene: () => null, interrupt() {}, stop() {}, pure: null, attachInput() {} };
  const told = [];
  let handlers = null;
  const client = { start(h) { handlers = h; }, stop() {}, isPolicy: () => false, shakemap: (id) => Promise.resolve(shakemap ? shakemap(id) : { ok: false, status: 'unavailable', reason: 'invalid_event', http: null }) };
  const window = { matchMedia: () => ({ matches: true }), setTimeout, clearTimeout, performance, document: null };
  window.window = window;
  vm.runInNewContext(source, window);
  const L = window.MCC_ENVIRONMENT_LAYERS;
  assert.equal(L.mount({ viewer, Cesium, tell: (m) => told.push(m), governor: null, director, document: doc, client }), true);
  const on = () => L.onMessage({ type: 'hu:environment-layers', on: true, selected: '', replay: null, layers: {} });
  const layer = (name, body) => { const result = { ok: true, status: 'available', http: 200, body, fetched_at: null, generated_at: body.generated_at || null }; handlers.onData(name, body, result); handlers.onState(name, result); return result; };
  return { L, queues, told, scene, window, on, layer, ground: () => scene.primitives.list.filter((p) => p instanceof Ground) };
}
const quake = (id, over = {}) => ({ id, title: id, lat: 10, lon: 20, stale: false, category: 'quake', observed_at: '2026-11-17T10:00:00.000Z', fetched_at: '2026-11-17T20:00:00.000Z', facts: [{ label: 'Magnitude', value: '5.4' }, { label: 'Depth', value: '10 km' }], ...over });
const ring = (lon, lat, d = 0.1) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
const selectedMessages = (told) => told.filter((m) => m.type === 'hu:environment-selected');
/* values made inside the vm realm carry another prototype: copy them before a strict deep comparison */
const plain = (x) => JSON.parse(JSON.stringify(x));

test('G1R-1: the tour queue follows the pins: a significance flag that changed with no geometry change re-syncs the director without a rebuild', () => {
  const { L, queues, scene } = realm();
  L.setEvents([quake('usgs:a', { significant: true }), quake('usgs:b')], { on: true, selected: '' });
  assert.equal(queues.length, 1, 'the first pins build the queue');
  assert.deepEqual(queues[0].significant, ['usgs:a']);
  const prims = scene.primitives.list.slice();
  /* the same rows, the same geometry: the ShakeMap made b significant, the panel re-sent the pins with the flag */
  L.setEvents([quake('usgs:a', { significant: true }), quake('usgs:b', { significant: true })], { on: true, selected: '' });
  assert.equal(queues.length, 2, 'the director is given the pins again');
  assert.deepEqual(queues[1].significant, ['usgs:a', 'usgs:b']);
  assert.deepEqual(scene.primitives.list, prims, 'no primitive was rebuilt for a flag change');
  /* nothing changed: nothing is re-sent */
  L.setEvents([quake('usgs:a', { significant: true }), quake('usgs:b', { significant: true })], { on: true, selected: '' });
  assert.equal(queues.length, 2, 'identical pins re-sync nothing');
  /* a recorded time that changed re-orders the tour, so the director is told, still without a rebuild */
  L.setEvents([quake('usgs:a', { significant: true, observed_at: '2026-11-17T12:00:00.000Z' }), quake('usgs:b', { significant: true })], { on: true, selected: '' });
  assert.equal(queues.length, 3);
  assert.deepEqual(scene.primitives.list, prims);
  /* a geometry change (a new row) rebuilds and re-syncs */
  L.setEvents([quake('usgs:a', { significant: true }), quake('usgs:b', { significant: true }), quake('usgs:c')], { on: true, selected: '' });
  assert.equal(queues.length, 4);
  assert.notDeepEqual(scene.primitives.list, prims, 'a new row rebuilds the events primitives');
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

test('G1R-3: the water-level layer and a station selection speak for the readings source, never the station catalogue; the fixture never has a reading retrieved before it was observed', () => {
  const { L, told, on, layer } = realm();
  on();
  layer('tides', TIDES);
  const state = told.filter((m) => m.type === 'hu:environment-layer-state' && m.layer === 'tides').pop();
  assert.equal(state.sources.length, 2, 'both records travel');
  assert.equal(state.fetched_at, '2026-11-17T19:56:00.000Z', 'the readings\' retrieval, not the catalogue\'s 08:00');
  assert.equal(state.source_id, 'coops_latest', 'the layer names the record that speaks for it');
  assert.equal(state.last_success_at, '2026-11-17T19:56:00.000Z');
  assert.match(state.coverage, /^The latest observed water level/);
  assert.equal(state.count, 14); assert.equal(state.total, 20);
  assert.equal(L.select('coops:8518750', 'pick', { layer: 'tides' }), true);
  const sel = selectedMessages(told).pop();
  assert.equal(sel.kind, 'station'); assert.equal(sel.observed_label, 'Observed'); assert.equal(sel.observed_at, '2026-11-17T15:48:00.000Z');
  assert.equal(sel.fetched_at, '2026-11-17T19:56:00.000Z');
  assert.ok(Date.parse(sel.fetched_at) >= Date.parse(sel.observed_at), 'a retrieval never precedes the observation it carries');
  assert.match(sel.coverage, /^The latest observed water level/); assert.equal(sel.source.label, 'NOAA CO-OPS latest water levels');
  /* the fixture itself: every reading was observed no later than the readings source was retrieved */
  const latest = TIDES.sources.find((s) => s.id === 'coops_latest');
  for (const r of TIDES.latest.readings) if (r.observed_at) assert.ok(Date.parse(r.observed_at) <= Date.parse(latest.fetched_at), r.station + ' observed before the readings were retrieved');
});

test('G1R-3: a ShakeMap state speaks for the contours source (usgs_shakemap), falling back to the event detail only when there is no other record', async () => {
  const bodies = { us7000tyhr: SHAKEMAP, nc75467542: SHAKEMAP_NONE };
  const { L, told, on } = realm({ shakemap: (id) => ({ ok: true, status: 'available', http: 200, body: bodies[String(id).replace(/^usgs:/, '')], fetched_at: '2026-11-17T20:01:00.000Z', generated_at: null }) });
  on();
  L.setEvents([quake('usgs:us7000tyhr', { significant: true, lat: 37.3664, lon: 136.7444 }), quake('usgs:nc75467542', { facts: [{ label: 'Magnitude', value: '3.1' }, { label: 'Depth', value: '2.1 km' }] })], { on: true, selected: '' });
  assert.equal(L.select('usgs:us7000tyhr', 'pick'), true);
  await flush();
  const state = told.filter((m) => m.type === 'hu:environment-layer-state' && m.layer === 'shakemap').pop();
  assert.equal(state.sources.length, 2);
  assert.equal(state.attribution, 'U.S. Geological Survey ShakeMap'); assert.equal(state.url, 'https://earthquake.usgs.gov/data/shakemap/');
  assert.equal(state.source_id, 'usgs_shakemap');
  assert.match(state.coverage, /^ShakeMap exists/); assert.equal(state.digest.available, true); assert.equal(state.count, SHAKEMAP.counts.lines);
  assert.equal(L.debug().counts.shakemapLines, SHAKEMAP.counts.lines, 'the contour lines are drawn');
  assert.equal(L.select('usgs:nc75467542', 'pick'), true);
  await flush();
  const none = told.filter((m) => m.type === 'hu:environment-layer-state' && m.layer === 'shakemap').pop();
  assert.equal(none.sources.length, 1); assert.equal(none.source_id, 'usgs_event'); assert.equal(none.attribution, 'U.S. Geological Survey, Earthquake Hazards Program', 'the one record there is');
  assert.equal(none.digest.available, false); assert.equal(L.debug().counts.shakemapLines, 0);
});

test('G1R-3: the fires layer speaks for its newest retrieval and a detection for its own satellite; a 1-degree area takes the layer\'s record', () => {
  const { L, told, on, layer } = realm();
  on();
  layer('fires', FIRES);
  const state = told.filter((m) => m.type === 'hu:environment-layer-state' && m.layer === 'fires').pop();
  const byId = Object.fromEntries(FIRES.sources.map((s) => [s.id, s]));
  assert.equal(state.sources.length, 2);
  assert.equal(state.fetched_at, byId.firms_viirs_noaa21.fetched_at, 'the newest retrieval (19:59) over the older one (19:58)'); assert.equal(state.coverage, byId.firms_viirs_noaa21.coverage);
  assert.equal(state.source_id, 'firms_viirs_noaa21');
  for (const sat of ['NOAA-20', 'NOAA-21']) {
    const row = FIRES.detections.find((d) => d[5] === sat);
    assert.equal(L.select(`fire:${row[5]}:${row[4]}:${row[0]}:${row[1]}`, 'pick', { layer: 'fires' }), true);
    const m = selectedMessages(told).pop();
    const own = FIRES.sources.find((s) => s.label.includes(sat));
    assert.equal(m.source.label, own.label, 'a detection names its own satellite'); assert.equal(m.fetched_at, own.fetched_at);
    assert.ok(Date.parse(m.fetched_at) >= Date.parse(m.observed_at), 'retrieved no earlier than acquired');
  }
  const c = FIRES.summary.cells[0];
  assert.equal(L.select(`cell:${c[0]}:${c[1]}`, 'pick', { layer: 'cells' }), true);
  const cell = selectedMessages(told).pop();
  assert.equal(cell.source.label, byId.firms_viirs_noaa21.label); assert.equal(cell.fetched_at, byId.firms_viirs_noaa21.fetched_at);
});
