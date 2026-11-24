/* The typed layers' runtime seams (js/environment-layers.js), run in a vm realm over a fake Cesium that resolves instance attributes
   by the id's identity as Cesium 1.131 does, a fake viewer, a fake director and a fake layer client. Each case is a review finding of
   slice G1 (2026-11-18) that the module's pure encodings could not catch:
   - G1R-1: the tour queue follows the pins whenever what it is built from changed (an item's significance, its recorded time) even
     when no geometry changed, and a flag change alone never rebuilds the primitives;
   - G1R-3: a layer's state and a selection speak for the record that produced what is drawn (the water-level readings, never the
     station catalogue; the ShakeMap contours, never the event detail), so a reading is never shown as retrieved before it was observed;
   - G1R-8: every polygon of a multi-polygon row has its own pick id, so the selection fade and the ShakeMap dim reach all of them;
   - G1R-9: a selection the panel's list made is told as via 'focus', never 'panel';
   - G1R-10: a feed item's selection and the earthquake legend answer with the terms the pins carried, never a client copy.
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
const FEED = JSON.parse(read('scripts/e2e/fixtures/environment/feed.json'));
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function realm({ shakemap = null, doc = null, policy = null } = {}) {
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
  const client = { start(h) { handlers = h; }, stop() {}, isPolicy: () => !!policy, policy: () => (policy ? { ...policy } : null), shakemap: (id) => Promise.resolve(shakemap ? shakemap(id) : { ok: false, status: 'unavailable', reason: 'invalid_event', http: null }) };
  const window = { matchMedia: () => ({ matches: true }), setTimeout, clearTimeout, performance, document: null };
  window.window = window;
  vm.runInNewContext(source, window);
  const L = window.MCC_ENVIRONMENT_LAYERS;
  assert.equal(L.mount({ viewer, Cesium, tell: (m) => told.push(m), governor: null, director, document: doc, client }), true);
  const on = () => L.onMessage({ type: 'hu:environment-layers', on: true, selected: '', replay: null, layers: {} });
  const layer = (name, body) => { const result = { ok: true, status: 'available', http: 200, body, fetched_at: null, generated_at: body.generated_at || null }; handlers.onData(name, body, result); handlers.onState(name, result); return result; };
  return { L, queues, told, scene, window, on, layer, state: (name, result) => handlers.onState(name, result), ground: () => scene.primitives.list.filter((p) => p instanceof Ground) };
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

test('G1R-8: every polygon of a multi-polygon perimeter or alert has its own pick id; the selection fade reaches all of them and a pick on any part resolves to the row; an EONET polygon fades too', () => {
  const { L, told, on, layer, ground } = realm();
  on();
  layer('perimeters', { schema: 'world-environment-perimeters/v1', generated_at: '2026-11-17T20:00:00.000Z', sources: [{ id: 'wfigs', label: 'NIFC WFIGS perimeters', status: 'available', fetched_at: '2026-11-17T19:57:00.000Z' }], perimeters: [{ id: 'two', name: 'Two Lobes', gis_acres: 12, polygon_captured_at: '2026-11-17T06:10:00.000Z', last_edited_at: null, discovered_at: null, polygons: [[ring(-118, 34)], [ring(-117, 34)]], polygons_dropped: 0, geometry_truncated: false }], count: 1, total: 1 });
  layer('alerts', { schema: 'world-environment-alerts/v1', generated_at: '2026-11-17T20:00:00.000Z', sources: [{ id: 'nws', label: 'NOAA NWS', status: 'available', fetched_at: '2026-11-17T20:00:00.000Z' }], alerts: [{ id: 'nws:split', event: 'Flood Warning', headline: 'Flood Warning', severity: 'Severe', certainty: 'Likely', urgency: 'Expected', sent: '2026-11-17T15:21:00.000Z', area: 'Two counties', geometry: 'polygon', polygons: [[ring(-98, 28)], [ring(-97, 28)], [ring(-96, 28)]] }], count: 1, counts: { polygon: 1, zone_only: 0, rejected: 0 }, total: 1 });
  layer('eonet', { schema: 'world-environment-eonet/v1', generated_at: '2026-11-17T14:00:00.000Z', sources: [{ id: 'eonet', label: 'NASA EONET', status: 'stale', fetched_at: '2026-11-17T14:00:00.000Z' }], events: [{ id: 'eonet:ice', title: 'Iceberg', categories: ['Sea and Lake Ice'], kind: 'ice', url: 'https://eonet.gsfc.nasa.gov/', reported_by: [], track: [{ date: '2026-11-16T00:00:00.000Z', placeholder_time: true, type: 'Polygon', polygons: [[ring(-45, -62, 0.4)]] }], track_count: 1 }], count: 1, total: 1 });
  const c = L.debug().counts;
  assert.equal(c.perimeters, 1); assert.equal(c.perimeterRings, 2); assert.equal(c.alerts.drawn, 1); assert.equal(c.eonetPolygons, 1);
  const fills = ground().filter((p) => p.geometryInstances.some((i) => i.attributes && i.attributes.color) && p.geometryInstances.every((i) => !(i.geometry instanceof Object && 'positions' in i.geometry && 'width' in i.geometry)));
  const perimeterFill = fills.find((p) => p.geometryInstances.length === 2 && p.geometryInstances[0].id.layer === 'perimeters');
  const alertFill = fills.find((p) => p.geometryInstances.length === 3 && p.geometryInstances[0].id.layer === 'alerts');
  const eonetFill = fills.find((p) => p.geometryInstances.length === 1 && p.geometryInstances[0].id.layer === 'eonet');
  assert.ok(perimeterFill && alertFill && eonetFill, 'one fill primitive per layer');
  const ids = perimeterFill.geometryInstances.map((i) => i.id);
  assert.notEqual(ids[0], ids[1], 'two polygons, two pick ids');
  assert.deepEqual(plain(ids.map((i) => [i.layer, i.id, i.part, i.index])), [['perimeters', 'wfigs:two', 'polygon', 0], ['perimeters', 'wfigs:two', 'polygon', 1]]);
  /* select the perimeter: both polygons take the highlight (alpha 0.28 + 0.25), through their own instance attributes */
  assert.equal(L.select('wfigs:two', 'pick', { layer: 'perimeters' }), true);
  const alphas = ids.map((id) => perimeterFill.getGeometryInstanceAttributes(id).color.alpha);
  assert.deepEqual(plain(alphas.map((a) => Math.round(a * 100))), [53, 53], 'every polygon of the row highlighted: ' + JSON.stringify(alphas));
  assert.equal(selectedMessages(told).pop().id, 'wfigs:two');
  /* a pick on the second polygon's part resolves to the row */
  assert.equal(L.pick({ id: ids[1] }), true);
  assert.equal(selectedMessages(told).pop().id, 'wfigs:two'); assert.equal(selectedMessages(told).pop().via, 'pick');
  /* the alert: three polygons, three highlights; the previous selection fades back to its base colour */
  assert.equal(L.select('nws:split', 'pick', { layer: 'alerts' }), true);
  const alertAlphas = alertFill.geometryInstances.map((i) => alertFill.getGeometryInstanceAttributes(i.id).color.alpha);
  assert.deepEqual(plain(alertAlphas.map((a) => Math.round(a * 100))), [51, 51, 51], 'Severe 0.26 + 0.25 on all three');
  assert.deepEqual(plain(ids.map((id) => Math.round(perimeterFill.getGeometryInstanceAttributes(id).color.alpha * 100))), [28, 28], 'the perimeter is back to its base');
  /* an EONET polygon instance carries a part id; the fade reaches it as well */
  assert.equal(L.select('eonet:ice', 'pick', { layer: 'eonet' }), true);
  assert.equal(Math.round(eonetFill.getGeometryInstanceAttributes(eonetFill.geometryInstances[0].id).color.alpha * 100), 47, '0.22 + 0.25');
});

test('replay returns the cursor to a quake on each arrival after an earlier scrub', () => {
  const { L, told } = realm();
  const older = quake('usgs:older', { observed_at: '2026-11-19T01:00:00.000Z' });
  const later = quake('usgs:later', { observed_at: '2026-11-19T02:00:00.000Z' });
  L.onMessage({ type: 'hu:environment-layers', on: true, replay: 'quakes-24h', layers: {} });
  L.setEvents([older, later], { on: true });

  for (const seq of [1, 2]) {
    L.onMessage({ type: 'hu:environment-time', at: older.observed_at, seq, input: true });
    assert.ok(L.debug().cursor.hidden.includes(later.id));
    const before = told.length;
    // The real director calls select(id, 'tour') on arrival, including at an already selected scene.
    L.select(later.id, 'tour');
    assert.equal(L.debug().cursor.at, later.observed_at, `replay arrival after scrub ${seq}`);
    assert.ok(L.debug().cursor.shown.includes(later.id));
    const times = told.slice(before).filter(m => m.type === 'hu:environment-time-state');
    assert.equal(times.length, 1);
    assert.equal(times[0].at, later.observed_at);
    assert.equal(times[0].ack, seq);
  }
  L.onMessage({ type: 'hu:environment-time', at: older.observed_at, seq: 3, input: true });
  L.select(later.id, 'pick');
  assert.equal(L.debug().cursor.at, older.observed_at, 'a visitor selection does not impersonate a replay arrival');
});

test('G1R-9: a selection the panel\'s list made is told as via focus (the contract\'s vocabulary), never as panel', async () => {
  const { L, told, on } = realm({ shakemap: () => ({ ok: true, status: 'available', http: 200, body: SHAKEMAP_NONE, fetched_at: '2026-11-17T20:01:00.000Z', generated_at: null }) });
  on();
  L.setEvents([quake('usgs:a', { significant: true })], { on: true, selected: 'usgs:a' });
  assert.equal(L.debug().selected.id, 'usgs:a', 'the pins message\'s selected field selects the quake');
  await flush();
  const answers = selectedMessages(told);
  assert.ok(answers.length >= 1, 'the ShakeMap answer is told');
  assert.ok(answers.every((m) => ['pick', 'focus', 'tour'].includes(m.via)), 'only the contract\'s via values: ' + JSON.stringify(answers.map((m) => m.via)));
  assert.equal(answers.pop().via, 'focus');
});

test('RV2-3: the fires layer and a 1-degree area speak for every satellite that served them (the Worker sums both); a detection for its own satellite; one satellite serving speaks alone', () => {
  const { L, told, on, layer } = realm();
  on();
  layer('fires', FIRES);
  const state = told.filter((m) => m.type === 'hu:environment-layer-state' && m.layer === 'fires').pop();
  const byId = Object.fromEntries(FIRES.sources.map((s) => [s.id, s]));
  assert.equal(state.sources.length, 2, 'every record still travels');
  assert.equal(state.source_id, 'firms_viirs_noaa20+firms_viirs_noaa21');
  assert.equal(state.label, 'NASA FIRMS VIIRS NOAA-20 and NOAA-21', 'one label naming both, their shared words once');
  assert.equal(state.coverage, byId.firms_viirs_noaa20.coverage + ' · ' + byId.firms_viirs_noaa21.coverage, 'the coverage of each');
  assert.match(state.attribution, /\(NOAA-20, near real-time\).* · .*\(NOAA-21, near real-time\)/); assert.equal(state.license, byId.firms_viirs_noaa20.license, 'one licence, said once');
  assert.equal(state.fetched_at, byId.firms_viirs_noaa21.fetched_at, 'the newest retrieval (19:59): no acquisition in the merged cells can follow it');
  for (const sat of ['NOAA-20', 'NOAA-21']) {
    const row = FIRES.detections.find((d) => d[5] === sat);
    assert.equal(L.select(`fire:${row[5]}:${row[4]}:${row[0]}:${row[1]}`, 'pick', { layer: 'fires' }), true);
    const m = selectedMessages(told).pop();
    const own = FIRES.sources.find((s) => s.label.includes(sat));
    assert.equal(m.source.label, own.label, 'a detection names its own satellite'); assert.equal(m.fetched_at, own.fetched_at); assert.equal(m.coverage, own.coverage);
    assert.ok(Date.parse(m.fetched_at) >= Date.parse(m.observed_at), 'retrieved no earlier than acquired');
  }
  const c = FIRES.summary.cells[0];
  assert.equal(L.select(`cell:${c[0]}:${c[1]}`, 'pick', { layer: 'cells' }), true);
  const cell = selectedMessages(told).pop();
  assert.equal(cell.source.label, 'NASA FIRMS VIIRS NOAA-20 and NOAA-21', 'an area summed from both satellites names both');
  assert.equal(cell.coverage, state.coverage); assert.equal(cell.source.attribution, state.attribution); assert.equal(cell.fetched_at, byId.firms_viirs_noaa21.fetched_at);
  assert.ok(Date.parse(cell.fetched_at) >= Date.parse(cell.observed_at), 'retrieved no earlier than its latest overpass');
  /* NOAA-20 did not answer and had no copy to serve: its record travels, but only NOAA-21 served the cells, and it speaks alone */
  const one = realm();
  one.on();
  const body = JSON.parse(JSON.stringify(FIRES));
  body.sources[0] = { ...body.sources[0], status: 'unavailable', reason: 'timeout', fetched_at: null };
  one.layer('fires', body);
  const alone = one.told.filter((m) => m.type === 'hu:environment-layer-state' && m.layer === 'fires').pop();
  assert.equal(alone.source_id, 'firms_viirs_noaa21'); assert.equal(alone.label, 'NASA FIRMS VIIRS NOAA-21'); assert.equal(alone.coverage, byId.firms_viirs_noaa21.coverage);
  assert.equal(alone.sources.length, 2);
  assert.equal(one.L.select(`cell:${c[0]}:${c[1]}`, 'pick', { layer: 'cells' }), true);
  assert.equal(selectedMessages(one.told).pop().source.label, 'NASA FIRMS VIIRS NOAA-21');
});

test('RV2-4: a focus kept pending is honoured by the pins that bring its id, with no layer data at all', () => {
  const { L, told, on } = realm();
  on();
  /* "Show on globe" for a feed id the frame does not hold yet: kept pending, nothing selected */
  L.focus('usgs:late');
  assert.equal(L.debug().pendingFocus, 'usgs:late'); assert.equal(L.debug().selected, null);
  /* the pins bring the id; no layer route ever answers */
  L.setEvents([quake('usgs:late')], { on: true, selected: '' });
  assert.equal(L.debug().pendingFocus, null, 'the pins honoured it');
  assert.deepEqual(plain(L.debug().selected), { id: 'usgs:late', layer: 'events', kind: 'quake' });
  const answer = selectedMessages(told).pop();
  assert.equal(answer.id, 'usgs:late'); assert.equal(answer.via, 'focus');
});

/* the frame's legend as a tiny document: the details box and its list, the lines as written */
const legendDoc = () => { const box = { hidden: true }, list = { lines: [], replaceChildren(...items) { this.lines = items.map((i) => i.textContent); } }; return { hidden: false, getElementById: (id) => (id === 'envLegend' ? box : id === 'envLegendList' ? list : null), createElement: () => ({ textContent: '' }), list }; };
test('G1R-10: a feed item answers with the terms the pins carried (the feed\'s own source records), the legend too; without them nothing is invented', () => {
  const doc = legendDoc();
  const { L, told, on } = realm({ doc });
  on();
  const sources = FEED.sources.map((s) => ({ id: s.id, label: s.label, url: s.url, attribution: s.attribution, license: s.license, coverage: s.coverage }));
  const usgs = sources.find((s) => s.id === 'usgs');
  L.setEvents([quake('usgs:a', { significant: true, source: { label: 'USGS', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/a' } })], { on: true, selected: '', sources });
  assert.equal(L.select('usgs:a', 'pick'), true);
  let m = selectedMessages(told).pop();
  assert.deepEqual(plain(m.source), { id: 'usgs', label: 'USGS', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/a', attribution: usgs.attribution, license: usgs.license });
  assert.equal(m.coverage, usgs.coverage);
  const quakeLine = doc.list.lines.find((l) => /^Earthquakes: /.test(l));
  assert.ok(quakeLine && quakeLine.endsWith(` ${usgs.attribution} · ${usgs.license}`), 'the legend credits USGS in the feed\'s words: ' + quakeLine);
  /* the Worker's words change: the globe follows them, as it holds no copy of its own */
  L.setEvents([quake('usgs:a', { significant: true })], { on: true, selected: '', sources: sources.map((s) => s.id === 'usgs' ? { ...s, attribution: 'USGS, as the Worker now words it', coverage: 'Global earthquakes in the past day, as now worded' } : s) });
  assert.equal(L.select('usgs:a', 'focus'), true);
  m = selectedMessages(told).pop();
  assert.equal(m.source.attribution, 'USGS, as the Worker now words it', 'the globe follows the Worker\'s words, it holds no copy'); assert.equal(m.coverage, 'Global earthquakes in the past day, as now worded');
  assert.deepEqual(plain(L.debug().feedTerms), ['eonet', 'nhc', 'nws', 'usgs']);
  /* the terms are keyed by provider id with no inherited keys: a provider named like an Object property is still a provider */
  L.setEvents([quake('usgs:a', { significant: true })], { on: true, selected: '', sources: [...sources, { id: 'constructor', label: 'A provider named constructor', url: 'https://example.org/', attribution: 'Its attribution', license: 'Its licence', coverage: 'Its coverage' }] });
  assert.deepEqual(plain(L.debug().feedTerms), ['constructor', 'eonet', 'nhc', 'nws', 'usgs']);
  /* a pins message without terms keeps the last ones; a realm that never received any answers with empty terms, never invented ones */
  const bareDoc = legendDoc(), bare = realm({ doc: bareDoc });
  bare.on();
  bare.L.setEvents([quake('usgs:b')], { on: true, selected: '' });
  assert.match(bareDoc.list.lines.find((l) => /^Earthquakes: /.test(l)), /capped at 1,000 km; colour shows depth: red shallow \(<33 km\) to blue deep \(>=300 km\)\.$/, 'no terms given, none written');
  assert.equal(bare.L.select('usgs:b', 'pick'), true);
  const b = selectedMessages(bare.told).pop();
  assert.equal(b.source.attribution, ''); assert.equal(b.source.license, ''); assert.equal(b.coverage, '');
  assert.equal(b.source.id, 'usgs');
});

test('RV2-10: the feed and pins fixtures never have an event, or a feed source record, retrieved before it was observed', () => {
  const PINS = JSON.parse(read('scripts/e2e/fixtures/environment/pins.json'));
  const time = (iso) => (typeof iso === 'string' ? Date.parse(iso) : NaN);
  for (const [name, rows] of [['feed.json', FEED.events], ['pins.json', PINS]]) {
    let checked = 0;
    for (const e of rows) {
      if (!Number.isFinite(time(e.observed_at)) || !Number.isFinite(time(e.fetched_at))) continue;
      checked += 1;
      assert.ok(time(e.observed_at) <= time(e.fetched_at), `${name} ${e.id}: observed ${e.observed_at} after its retrieval ${e.fetched_at}`);
    }
    assert.ok(checked >= 55, `${name}: ${checked} rows carry both times`);
  }
  for (const s of FEED.sources) {
    if (!Number.isFinite(time(s.observed_at))) continue;
    assert.ok(time(s.observed_at) <= time(s.fetched_at), `feed.json source ${s.id}: latest observation ${s.observed_at} after its retrieval ${s.fetched_at}`);
    assert.ok(time(s.fetched_at) <= time(s.last_success_at) || s.status !== 'available', `feed.json source ${s.id}: an available source succeeded when it was retrieved`);
  }
});

/* E=UP slice S0 (2026-11-19): off, outage, the visitor's network and no data, each named in the legend in its own words; before, one line
   covered off and outage alike and a layer whose provider answered with nothing simply vanished from the legend */
test('S0: the legend names off, an outage, an unreachable network and a layer with nothing to report, each in its own words', () => {
  const E = realm().L.encodings;
  for (const [policy, line, other] of [[{ reason: 'module_disabled', http: 404, gate: 'off' }, E.OFF_LINE, E.POLICY_LINE], [{ reason: 'module_policy_unavailable', http: 503, gate: 'outage' }, E.POLICY_LINE, E.OFF_LINE]]) {
    const doc = legendDoc(), r = realm({ doc, policy });
    r.on();
    assert.ok(doc.list.lines.includes(line), `${policy.gate}: ${JSON.stringify(doc.list.lines)}`);
    assert.ok(!doc.list.lines.includes(other));
  }
  assert.equal(E.OFF_LINE, 'Environmental layers are turned off for now');
  assert.equal(E.POLICY_LINE, 'Environmental layers are not available right now');
  /* every layer route out of reach from this browser: said, and never called off or an outage */
  const netDoc = legendDoc(), net = realm({ doc: netDoc });
  net.on();
  for (const name of ['fires', 'perimeters', 'alerts', 'eonet', 'tides']) net.state(name, { ok: false, status: 'unavailable', reason: 'network', http: null });
  assert.ok(netDoc.list.lines.includes(E.NETWORK_LINE), JSON.stringify(netDoc.list.lines));
  assert.ok(!netDoc.list.lines.includes(E.OFF_LINE) && !netDoc.list.lines.includes(E.POLICY_LINE));
  /* no data: the provider answered and reported nothing; one layer down for its own reason is not "nothing" */
  const zeroDoc = legendDoc(), zero = realm({ doc: zeroDoc });
  zero.on();
  zero.layer('perimeters', { ok: true, schema: 'world-environment-perimeters/v1', generated_at: '2026-11-19T02:00:00.000Z', sources: [{ id: 'wfigs', label: 'NIFC WFIGS perimeters', status: 'available', fetched_at: '2026-11-19T02:00:00.000Z' }], perimeters: [], count: 0, total: 0 });
  zero.state('alerts', { ok: false, status: 'unavailable', reason: 'http_500', http: 500 });
  assert.ok(zeroDoc.list.lines.includes('Fire perimeters: none reported right now'), JSON.stringify(zeroDoc.list.lines));
  assert.ok(!zeroDoc.list.lines.some((l) => /^Alerts: none/.test(l)), 'an unavailable layer is not "none reported"');
  assert.ok(!zeroDoc.list.lines.includes(E.NETWORK_LINE));
});
