/* THE ENVIRONMENTAL JUSTICE PANEL IN SLICE G1 (owner, 2026-11-17: "the environmental globe updates should be updates like as
   posts from the admin system … make the cinematic experience way more cinematic"; docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md
   targets 11 and 13). The panel's new behaviour, on the lifecycle harness (synthetic DOM, a captured sendGlobe, captured DOM
   CustomEvents, a fake message channel from the frame): the message spine in its fixed order (hu:environment-layers before the
   pins, the pins-off object last on destroy), the additive pin fields and the significant flag, per-source health rows for the
   feed and for the globe's layer states, the scene and 2D controls, the globe-selection card, the mcc:world-environment-events
   detail after every load (with the gate's code when it refused), the first load at mount, the autostart rule, and that no
   private row ever leaves the panel. Fixtures only: no network, no production state.
     node --test scripts/test/world-environment-panel.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mountEnvironment } from '../../vendor/equity-uprise/src/environment/panel.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
const P = createRequire(import.meta.url)(ROOT + 'js/world-environment-posts.js');
const FEED = JSON.parse(read('scripts/e2e/fixtures/environment/feed.json'));
const feedBody = () => JSON.parse(JSON.stringify(FEED));
const EVENTS = 'mcc:world-environment-events';

class E {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.textContent = ''; this.hidden = false; this.attrs = {}; this.value = ''; this.checked = false; this.disabled = false; }
  set innerHTML(s) { this.ids = Object.fromEntries([...s.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)].map(m => { const n = new E(m[1]); n.id = m[2]; return [m[2], n]; })); this.children = Object.values(this.ids); }
  querySelector(s) { if (s.startsWith('#')) return (this.id === s.slice(1) ? this : null) || this.ids?.[s.slice(1)] || this.children.map(c => c.querySelector(s)).find(Boolean) || null; return this.querySelectorAll(s)[0] || null; }
  querySelectorAll(s) { const out = []; const walk = n => { for (const c of n.children) { if (c.tag === s) out.push(c); walk(c); } }; walk(this); return out; }
  append(...x) { this.children.push(...x); }
  replaceChildren(...x) { this.children = x; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; }
  scrollIntoView() {}
  get text() { return [this.textContent, ...this.children.map(c => c.text)].filter(Boolean).join(' '); }
}
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const find = (e, label) => e.textContent === label ? e : e.children.map(x => find(x, label)).find(Boolean);
const ORIGIN = 'https://test.example.invalid';
/* every mount is destroyed after its test, so a failing assertion never leaves the panel's refresh interval holding the process */
const live = new Set();
test.afterEach(() => { for (const m of live) m.destroy(); live.clear(); });

/* mode: the tab the page is on ('feed' | 'environment'); reduced: prefers-reduced-motion; observer: a fake IntersectionObserver
   reporting the frame in view; hidden: document.hidden; answer: what the feed read returns (a body, or an Error to throw) */
function harness({ mode = 'environment', reduced = false, observer = false, hidden = false, answer = feedBody } = {}) {
  const panel = new E('div'), frame = { contentWindow: {} }, handlers = new Map(), docHandlers = new Map(), sent = [], events = [], reads = [];
  let current = mode;
  const w = {
    location: { origin: ORIGIN }, confirm: () => true,
    addEventListener: (k, v) => handlers.set(k, v), removeEventListener: (k) => handlers.delete(k),
    dispatchEvent: (ev) => { events.push(ev); return true; }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    matchMedia: (q) => ({ matches: /reduced-motion/.test(q) && reduced }),
    ...(observer ? { IntersectionObserver: class { constructor(cb) { this.cb = cb; } observe(target) { this.cb([{ target, isIntersecting: true, intersectionRatio: 1 }]); } disconnect() {} } } : {})
  };
  const d = { createElement: tag => new E(tag), documentElement: { dataset: {} }, getElementById: () => null, hidden,
    addEventListener: (k, v) => docHandlers.set(k, v), removeEventListener: (k) => docHandlers.delete(k) };
  const adapter = { panel, frame, token: () => null, signIn() {}, sendGlobe: data => sent.push(JSON.parse(JSON.stringify(data))),
    request: async (path) => { reads.push(path); const a = typeof answer === 'function' ? answer() : answer; if (a instanceof Error) throw a; return a; },
    mode: () => current, eventsEvent: EVENTS, significance: P.significance };
  const mounted = mountEnvironment(w, d, adapter);
  live.add(mounted);
  return {
    panel, mounted, sent, events, reads, w, d,
    byId: id => panel.querySelector('#' + id),
    setMode(m) { current = m; handlers.get('environment:mode')(); },
    message(data) { handlers.get('message')({ origin: ORIGIN, source: frame.contentWindow, data }); },
    foreign(data) { handlers.get('message')({ origin: 'https://evil.example', source: frame.contentWindow, data }); },
    visibility(h) { d.hidden = h; (docHandlers.get('visibilitychange') || handlers.get('visibilitychange') || (() => {}))(); },
    types: () => sent.map(m => m.type + ':' + (m.on === undefined ? (m.action || m.mode || '') : m.on))
  };
}
const layerState = (layer, over = {}) => ({ type: 'hu:environment-layer-state', layer, status: 'available', reason: null, http: 200, schema: 'world-environment-' + layer + '/v1', generated_at: '2026-11-17T20:00:00Z', fetched_at: '2026-11-17T20:00:30Z', last_success_at: '2026-11-17T20:00:30Z',
  coverage: 'Global VIIRS active-fire detections from NOAA-20 in the 24 hours before retrieval', attribution: 'NASA FIRMS, VIIRS 375 m active fire product (NOAA-20, near real-time)', license: 'NASA data, CC0 1.0 (U.S. public domain)', url: 'https://firms.modaps.eosdis.nasa.gov/',
  count: 600, total: 600, truncated: false, sources: [{ id: 'firms_viirs_noaa20', label: 'NASA FIRMS VIIRS NOAA-20', status: 'available', reason: null, fetched_at: '2026-11-17T20:00:30Z', last_success_at: '2026-11-17T20:00:30Z', coverage: 'Global VIIRS active-fire detections from NOAA-20 in the 24 hours before retrieval', attribution: 'NASA FIRMS, VIIRS 375 m active fire product (NOAA-20, near real-time)', license: 'NASA data, CC0 1.0 (U.S. public domain)', url: 'https://firms.modaps.eosdis.nasa.gov/' }], digest: null, ...over });

test('the first feed load happens at mount, before the tab is open; activation sends hu:environment-layers on:true and then the pins with the additive fields and the significant flags', async () => {
  const h = harness({ mode: 'feed' });
  await flush(8);
  assert.deepEqual(h.reads, [''], 'one public GET at mount while the tab is not open');
  assert.equal(h.panel.hidden, true);
  const closed = h.types().filter(t => /environment-(layers|pins)/.test(t));
  assert.deepEqual(closed.slice(0, 2), ['hu:environment-layers:false', 'hu:environment-pins:false'], 'inactive: layers off, then pins off');
  assert.ok(closed.every(t => /:false$/.test(t)), 'while the tab is closed every such message is off (the feed load\'s own pins sync is idempotent): ' + closed.join(' '));
  h.sent.length = 0;
  h.setMode('environment'); await flush(8);
  assert.deepEqual(h.reads, [''], 'the tab opening reads nothing again');
  const kinds = h.types().filter(t => /environment-(layers|pins)/.test(t));
  assert.deepEqual(kinds.slice(0, 2), ['hu:environment-layers:true', 'hu:environment-pins:true'], 'layers before pins');
  const layers = h.sent.find(m => m.type === 'hu:environment-layers');
  assert.deepEqual(layers, { type: 'hu:environment-layers', on: true, selected: '', replay: null, layers: { fires: true, perimeters: true, alerts: true, eonet: true, tides: true } });
  const pins = h.sent.find(m => m.type === 'hu:environment-pins');
  assert.equal(pins.on, true); assert.equal(pins.items.length, 62, 'the mapped rows only');
  assert.equal(pins.items.some(i => i.id === 'nws:fx-heat-ca'), false, 'a zone-only alert is never placed');
  const quake = pins.items.find(i => i.id === 'usgs:us7000tyca');
  assert.deepEqual(Object.keys(quake).sort(), ['category', 'facts', 'fetched_at', 'id', 'lat', 'location_kind', 'lon', 'observed_at', 'significant', 'source', 'stale', 'title']);
  assert.equal(quake.significant, true); assert.equal(quake.category, 'quake'); assert.deepEqual(quake.source, { label: 'USGS', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000tyca' });
  assert.deepEqual(quake.facts, [{ label: 'Magnitude', value: '5.6' }, { label: 'Depth', value: '560 km' }]);
  assert.equal(pins.items.find(i => i.id === 'usgs:us7000tyhr').significant, false, 'M5.4');
  assert.equal(pins.items.find(i => i.id === 'nhc:fx-al19').observed_at, null, 'no observation time stays null, never the fetch time');
  assert.equal(pins.items.filter(i => i.significant).length, 16);
  h.mounted.destroy();
});

test('deactivation sends layers off then pins off; destroy sends layers off and then exactly the pins-off object, last', async () => {
  const h = harness();
  await flush(8);
  h.sent.length = 0;
  h.setMode('feed'); await flush();
  const off = h.sent.filter(m => /environment-(layers|pins)/.test(m.type));
  assert.equal(off[0].type, 'hu:environment-layers'); assert.equal(off[0].on, false);
  assert.equal(off[1].type, 'hu:environment-pins'); assert.equal(off[1].on, false); assert.deepEqual(off[1].items, []);
  h.setMode('environment'); await flush();
  h.sent.length = 0;
  h.mounted.destroy();
  assert.deepEqual(h.sent.at(-1), { type: 'hu:environment-pins', on: false, items: [] }, 'the lifecycle test\'s last message, byte for byte');
  assert.equal(h.sent.at(-2).type, 'hu:environment-layers'); assert.equal(h.sent.at(-2).on, false);
  assert.deepEqual(h.events.at(-1).detail.events, []); assert.equal(h.events.at(-1).detail.code, 'off'); assert.equal(h.events.at(-1).detail.unavailable, true);
  const before = h.sent.length; h.mounted.destroy(); assert.equal(h.sent.length, before, 'idempotent');
});

test('hu:globe-ready resends both, in order; a message from another origin is ignored', async () => {
  const h = harness();
  await flush(8);
  h.sent.length = 0;
  h.message({ type: 'hu:globe-ready', missionIds: [] });
  assert.deepEqual(h.types(), ['hu:environment-layers:true', 'hu:environment-pins:true']);
  h.sent.length = 0;
  h.foreign({ type: 'hu:globe-ready' }); h.foreign({ type: 'hu:environment-scene-state', playing: true, index: 0, total: 1, id: 'x', title: 'x', queue: 'significant', reason: null });
  assert.deepEqual(h.sent, []); assert.equal(h.byId('wePlay').textContent, 'Play tour');
  h.mounted.destroy();
});

test('health rows: every feed source with its status, the reason in plain words, Retrieved and Last success with how long ago, coverage, attribution, licence and link; the globe\'s layer states join them', async () => {
  const h = harness();
  await flush(8);
  const rows = () => h.byId('weSources').children.map(li => li.text);
  assert.equal(rows().length, 4);
  const eonet = rows().find(t => /NASA EONET/.test(t));
  assert.match(eonet, /stale/); assert.match(eonet, /the provider refused, failed or answered an error/, 'the reason in plain words, not a code alone');
  assert.match(eonet, /Retrieved .+ · /); assert.match(eonet, /Last success .+ · /);
  assert.match(eonet, /Global open event reports in the last 30 days/); assert.match(eonet, /NASA Earth Observatory Natural Event Tracker/); assert.match(eonet, /NASA open data/);
  const nws = h.byId('weSources').children.find(li => /NOAA NWS/.test(li.text));
  assert.match(nws.text, /available/); assert.equal(nws.querySelectorAll('a')[0].href, 'https://www.weather.gov/');
  assert.doesNotMatch(nws.text, /never known/);
  const list = h.byId('weEvents').children, quake = list.find(li => /Anamizu/.test(li.text)), storm = list.find(li => /Sara/.test(li.text));
  assert.match(quake.text, /Observed: .+ · (now|\d+[mhd]|[A-Z][a-z]{2} \d)/, 'the relative time beside the absolute one');
  assert.match(storm.text, /Observed: Not supplied by provider/);
  /* the globe reports a layer: its row joins the list with the Worker's own health, never invented */
  h.message(layerState('fires'));
  assert.equal(rows().length, 5);
  const fires = rows().find(t => /Fires/.test(t));
  assert.match(fires, /available/); assert.match(fires, /NASA FIRMS, VIIRS 375 m/); assert.match(fires, /CC0 1\.0/); assert.match(fires, /600 of 600/);
  h.message(layerState('tides', { status: 'stale', reason: 'timeout', sources: [{ id: 'coops_latest', label: 'NOAA CO-OPS latest water levels', status: 'stale', reason: 'timeout', fetched_at: '2026-11-17T18:00:00Z', last_success_at: '2026-11-17T18:00:00Z', coverage: 'The latest observed water level at 20 documented NOAA stations', attribution: 'NOAA CO-OPS', license: 'Public domain (U.S. Government work); NOAA asks to be credited', url: 'https://tidesandcurrents.noaa.gov/' }], count: 14, total: 20 }));
  const tides = rows().find(t => /Water levels/.test(t));
  assert.match(tides, /stale/); assert.match(tides, /did not answer in time/); assert.match(tides, /14 of 20/);
  h.message(layerState('alerts', { status: 'unavailable', reason: 'upstream_error', fetched_at: null, last_success_at: null, count: 0, total: 0, sources: [{ id: 'nws', label: 'NOAA NWS', status: 'unavailable', reason: 'upstream_error', fetched_at: null, last_success_at: null, coverage: 'United States active alerts', attribution: 'NOAA National Weather Service', license: 'Public domain (U.S. Government work)', url: 'https://www.weather.gov/' }] }));
  const alerts = rows().find(t => /Alerts/.test(t));
  assert.match(alerts, /unavailable/); assert.match(alerts, /Retrieved: Not supplied/); assert.match(alerts, /Last success: never known/);
  /* a second state for the same layer replaces its row (its record says stale too, as the Worker's own health would) */
  h.message(layerState('fires', { status: 'stale', reason: 'upstream_error', sources: [{ ...layerState('fires').sources[0], status: 'stale', reason: 'upstream_error' }] }));
  assert.equal(rows().filter(t => /Fires/.test(t)).length, 1); assert.match(rows().find(t => /Fires/.test(t)), /stale/);
  /* the gate refused the layers: one honest line */
  assert.equal(h.byId('weLayersNote').hidden, true, 'no honest line while the gate has not refused');
  h.message(layerState('fires', { status: 'policy', reason: 'module_policy_unavailable', http: 503, fetched_at: null, last_success_at: null, count: 0, total: 0, sources: [] }));
  assert.equal(h.byId('weLayersNote').hidden, false);
  assert.equal(h.byId('weLayersNote').textContent, 'Environmental layers are not available right now (the module policy could not be read).');
  assert.match(rows().find(t => /Fires/.test(t)), /policy/);
  h.message({ type: 'hu:environment-layer-state', layer: 'halo', status: 'available' });
  assert.equal(rows().length, 7, 'an unknown layer is ignored');
  /* G1R-3: a layer's row renders every source record it carries. The water levels have two: the station catalogue (retrieved 08:00)
     and the readings (retrieved 19:56); each is shown with its own status, Retrieved and Last success, and the layer's counts once,
     at the head of its row, so no record's retrieval stands for another's */
  const local = iso => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stations = { id: 'coops_stations', label: 'NOAA CO-OPS stations', status: 'available', reason: null, fetched_at: '2026-11-17T08:00:00Z', last_success_at: '2026-11-17T08:00:00Z', coverage: 'NOAA CO-OPS water-level stations: U.S. coasts, the Great Lakes and territories', attribution: 'NOAA CO-OPS', license: 'Public domain (U.S. Government work); NOAA asks to be credited', url: 'https://tidesandcurrents.noaa.gov/' };
  const readings = { ...stations, id: 'coops_latest', label: 'NOAA CO-OPS latest water levels', fetched_at: '2026-11-17T19:56:00Z', last_success_at: '2026-11-17T19:56:00Z', coverage: 'The latest observed water level at 20 documented NOAA stations' };
  h.message(layerState('tides', { status: 'available', reason: null, fetched_at: '2026-11-17T19:56:00Z', last_success_at: '2026-11-17T19:56:00Z', coverage: readings.coverage, source_id: 'coops_latest', sources: [stations, readings], count: 14, total: 20 }));
  assert.equal(rows().length, 7, 'still one row per layer');
  const tideRow = h.byId('weSources').children.find(li => /^Water levels/.test(li.text));
  assert.match(tideRow.text, /NOAA CO-OPS latest water levels/, 'the readings record is shown, not only the first record');
  assert.match(tideRow.text, new RegExp('Retrieved ' + local('2026-11-17T08:00:00Z')), 'the catalogue keeps its own retrieval time');
  const records = tideRow.querySelectorAll('ul')[0].children;
  assert.equal(records.length, 2, 'every record the layer carries');
  assert.match(records[0].text, /^NOAA CO-OPS stations available/); assert.match(records[0].text, new RegExp('Retrieved ' + local('2026-11-17T08:00:00Z')));
  assert.match(records[1].text, /^NOAA CO-OPS latest water levels available/); assert.match(records[1].text, new RegExp('Retrieved ' + local('2026-11-17T19:56:00Z')));
  assert.match(records[1].text, /latest observed water level/); assert.match(records[0].text, /water-level stations/);
  assert.equal((tideRow.text.match(/14 of 20 shown/g) || []).length, 1, 'the layer\'s counts once, never credited to one record');
  assert.doesNotMatch(records[0].text, /14 of 20/); assert.doesNotMatch(records[1].text, /14 of 20/);
  /* each record its own state: the catalogue available, the readings stale with their reason */
  h.message(layerState('tides', { status: 'stale', reason: 'timeout', fetched_at: '2026-11-17T18:00:00Z', last_success_at: '2026-11-17T18:00:00Z', source_id: 'coops_latest', sources: [stations, { ...readings, status: 'stale', reason: 'timeout', fetched_at: '2026-11-17T18:00:00Z', last_success_at: '2026-11-17T18:00:00Z' }], count: 14, total: 20 }));
  const again = h.byId('weSources').children.find(li => /^Water levels/.test(li.text)).querySelectorAll('ul')[0].children;
  assert.match(again[0].text, /available/); assert.doesNotMatch(again[0].text, /did not answer in time/);
  assert.match(again[1].text, /stale/); assert.match(again[1].text, /did not answer in time/);
  h.mounted.destroy();
});

test('the scene controls send play, pause, previous and next and follow hu:environment-scene-state; the replay toggle resends the layers', async () => {
  const h = harness();
  await flush(8);
  h.sent.length = 0;
  h.byId('wePlay').onclick();
  assert.deepEqual(h.sent.at(-1), { type: 'hu:environment-scene', action: 'play' });
  h.message({ type: 'hu:environment-scene-state', playing: true, index: 2, total: 12, id: 'usgs:fx-m71', title: 'M7.1 · Fixture event, Andreanof Islands, Alaska', queue: 'significant', reason: null });
  assert.equal(h.byId('wePlay').textContent, 'Pause tour'); assert.equal(h.byId('wePlay').getAttribute('aria-pressed'), null, 'the label names the next action; no aria-pressed beside it (G1R-11)');
  assert.match(h.byId('weSceneStatus').textContent, /Scene 3 of 12/); assert.match(h.byId('weSceneStatus').textContent, /Andreanof/);
  h.byId('wePlay').onclick();
  assert.deepEqual(h.sent.at(-1), { type: 'hu:environment-scene', action: 'pause' });
  h.message({ type: 'hu:environment-scene-state', playing: false, index: 2, total: 12, id: 'usgs:fx-m71', title: 'x', queue: 'significant', reason: 'user' });
  assert.equal(h.byId('wePlay').textContent, 'Play tour'); assert.equal(h.byId('wePlay').getAttribute('aria-pressed'), null);
  h.byId('wePrev').onclick(); assert.deepEqual(h.sent.at(-1), { type: 'hu:environment-scene', action: 'prev' });
  h.byId('weNext').onclick(); assert.deepEqual(h.sent.at(-1), { type: 'hu:environment-scene', action: 'next' });
  h.message({ type: 'hu:environment-scene-state', playing: false, index: 11, total: 12, id: null, title: null, queue: 'significant', reason: 'end' });
  assert.match(h.byId('weSceneStatus').textContent, /ended/i);
  h.message({ type: 'hu:environment-scene-state', playing: false, index: 0, total: 0, id: null, title: null, queue: 'significant', reason: 'reduced-motion' });
  assert.match(h.byId('weSceneStatus').textContent, /reduced motion/i);
  h.message({ type: 'hu:environment-scene-state', playing: false, index: 0, total: 0, id: null, title: null, queue: 'significant', reason: 'empty' });
  assert.match(h.byId('weSceneStatus').textContent, /No significant event/);
  h.sent.length = 0;
  h.byId('weReplay').onclick();
  assert.equal(h.byId('weReplay').getAttribute('aria-pressed'), 'true');
  assert.equal(h.sent.at(-1).type, 'hu:environment-layers'); assert.equal(h.sent.at(-1).on, true); assert.equal(h.sent.at(-1).replay, 'quakes-24h');
  h.byId('weReplay').onclick();
  assert.equal(h.sent.at(-1).replay, null); assert.equal(h.byId('weReplay').getAttribute('aria-pressed'), 'false');
  h.mounted.destroy();
});

test('the 2D toggle sends hu:environment-view and follows hu:environment-view-state', async () => {
  const h = harness();
  await flush(8);
  h.sent.length = 0;
  assert.equal(h.byId('weView2d').textContent, '2D map'); assert.equal(h.byId('weView2d').getAttribute('aria-pressed'), 'false');
  h.byId('weView2d').onclick();
  assert.deepEqual(h.sent.at(-1), { type: 'hu:environment-view', mode: '2d' });
  h.message({ type: 'hu:environment-view-state', mode: '2d', morphing: true });
  assert.equal(h.byId('weView2d').getAttribute('aria-pressed'), 'true');
  h.message({ type: 'hu:environment-view-state', mode: '2d', morphing: false });
  assert.equal(h.byId('weView2d').textContent, '3D globe');
  h.byId('weView2d').onclick();
  assert.deepEqual(h.sent.at(-1), { type: 'hu:environment-view', mode: '3d' });
  h.message({ type: 'hu:environment-view-state', mode: '3d', morphing: false });
  assert.equal(h.byId('weView2d').getAttribute('aria-pressed'), 'false'); assert.equal(h.byId('weView2d').textContent, '2D map');
  h.mounted.destroy();
});

test('hu:environment-selected: a feed id selects its row as before; a layer-only id draws the globe-selection card with its own time labelled, never a fetch time in the observed slot', async () => {
  const h = harness();
  await flush(8);
  h.message({ type: 'hu:environment-selected', id: 'usgs:us7000tyhr', layer: 'quakes', kind: 'quake', via: 'pick' });
  assert.equal(h.byId('weDetail').hidden, false); assert.match(h.byId('weDetail').text, /Anamizu/); assert.match(h.byId('weDetail').text, /Observed/);
  const pick = { type: 'hu:environment-selected', id: 'fire:NOAA-20:2026-11-17T19:30:00Z:-118.4:34.1', layer: 'fires', kind: 'fire_detection', title: 'VIIRS detection', facts: [{ label: 'Satellite', value: 'NOAA-20' }, { label: 'Radiative power', value: '12.5 MW' }, { label: 'Confidence', value: 'nominal' }],
    source: { id: 'firms_viirs_noaa20', label: 'NASA FIRMS VIIRS NOAA-20', url: 'https://firms.modaps.eosdis.nasa.gov/', attribution: 'NASA FIRMS, VIIRS 375 m active fire product (NOAA-20, near real-time)', license: 'NASA data, CC0 1.0 (U.S. public domain)' },
    observed_at: '2026-11-17T19:30:00Z', observed_label: 'Acquired', observed_date_only: false, fetched_at: '2026-11-17T20:00:30Z', coverage: 'Global VIIRS active-fire detections from NOAA-20 in the 24 hours before retrieval', status: 'available', reason: null, lat: 34.1, lon: -118.4, via: 'pick', illustrative: null, modelled: false };
  h.message(pick);
  const card = h.byId('weDetail');
  assert.equal(card.hidden, false);
  assert.match(card.text, /Selected on the globe/); assert.match(card.text, /VIIRS detection/);
  assert.match(card.text, new RegExp('Acquired ' + new Date(pick.observed_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(card.text, /Retrieved/); assert.match(card.text, /Coverage/); assert.match(card.text, /Status available/); assert.match(card.text, /Radiative power 12\.5 MW/);
  assert.equal(card.querySelectorAll('a')[0].href, 'https://firms.modaps.eosdis.nasa.gov/');
  assert.doesNotMatch(card.text, /Observed/, 'the item\'s own label, not the feed\'s word');
  h.message({ ...pick, id: 'coops:8518750', layer: 'tides', kind: 'station', title: 'The Battery, NY', observed_at: null, observed_label: 'unknown', facts: [{ label: 'Status', value: 'unavailable' }], status: 'unavailable', reason: 'timeout' });
  assert.match(h.byId('weDetail').text, /Time not supplied by provider/); assert.match(h.byId('weDetail').text, /Status unavailable \(the provider did not answer in time\)/);
  assert.doesNotMatch(h.byId('weDetail').text, /unknown .*2026/, 'no date is written where the provider gave none');
  h.message({ ...pick, id: 'shakemap:us7000tyhr:2', layer: 'shakemap', kind: 'quake', title: 'ShakeMap', modelled: true, observed_label: 'Computed', illustrative: 'Ripple is illustrative: not a recording of shaking' });
  assert.match(h.byId('weDetail').text, /modelled/i); assert.match(h.byId('weDetail').text, /Ripple is illustrative/);
  h.message({ ...pick, id: 'x'.repeat(400), source: { label: 'Evil', url: 'javascript:alert(1)' }, facts: [{ label: 'x', value: 'y' }].concat(new Array(40).fill({ label: 'f', value: 'v' })) });
  assert.equal(h.byId('weDetail').querySelectorAll('a').length, 0, 'no link without https');
  assert.ok(h.byId('weDetail').querySelectorAll('dt').length <= 30, 'facts are capped');
  h.mounted.destroy();
});

test('the DOM CustomEvent carries the feed after every load, with the gate\'s code when it refused, and the globe\'s digests when they arrive', async () => {
  let answer = feedBody;
  const h = harness({ answer: () => answer() });
  await flush(8);
  assert.equal(h.events.length, 1);
  const first = h.events[0];
  assert.equal(first.type, EVENTS);
  assert.equal(first.detail.events.length, 65); assert.equal(first.detail.sources.length, 4); assert.equal(first.detail.fetched_at, '2026-11-17T20:05:00Z'); assert.ok(Number.isFinite(Date.parse(first.detail.checked_at)));
  assert.equal(first.detail.unavailable, false); assert.equal(first.detail.code, null); assert.deepEqual(first.detail.layers, {});
  assert.equal(first.detail.events[0].id, FEED.events[0].id); assert.equal(first.detail.events[0].notice, FEED.events[0].notice, 'the normalized rows as normalizeFeed returns them');
  /* the fires digest: re-dispatched with the current feed and the cells */
  h.message(layerState('fires', { digest: { cells: [[-119, 34, 220, 1830.4, 212.5, '2026-11-17T19:30:00Z']], cell_degrees: 1, count: 600, total: 600, windows: [] } }));
  const withFires = h.events.at(-1).detail;
  assert.equal(h.events.length, 2); assert.equal(withFires.events.length, 65);
  assert.deepEqual(withFires.layers.fires.cells, [[-119, 34, 220, 1830.4, 212.5, '2026-11-17T19:30:00Z']]);
  assert.equal(withFires.layers.fires.status, 'available'); assert.equal(withFires.layers.fires.fetched_at, '2026-11-17T20:00:30Z'); assert.equal(withFires.layers.fires.cell_degrees, 1);
  assert.equal(withFires.layers.fires.attribution, 'NASA FIRMS, VIIRS 375 m active fire product (NOAA-20, near real-time)'); assert.equal(withFires.layers.fires.url, 'https://firms.modaps.eosdis.nasa.gov/'); assert.equal(withFires.layers.fires.label, 'NASA FIRMS VIIRS NOAA-20');
  h.message(layerState('perimeters', { digest: { top: [{ id: 'wfigs:2026-CAXXX-000001', name: 'Fixture Ridge', gis_acres: 45210.5, polygon_captured_at: '2026-11-17T06:10:00Z', last_edited_at: null, discovered_at: null, lon: -118.9, lat: 34.6 }] } }));
  h.message(layerState('alerts', { digest: { counts: { polygon: 70, zone_only: 25, rejected: 5 } } }));
  h.message(layerState('shakemap', { digest: { event_id: 'us7000tyhr', available: true, reason: null, version: 5, max_mmi: 2.9 } }));
  h.message(layerState('fires', { generated_at: '2026-11-17T20:30:00Z' }), 'no digest: no event');
  const all = h.events.at(-1).detail;
  assert.equal(h.events.length, 5);
  /* G1R-7: the same digest again (the tour selecting the same quake, a refresh whose words did not change) is not handed on again;
     a digest that changed is */
  h.message(layerState('shakemap', { digest: { event_id: 'us7000tyhr', available: true, reason: null, version: 5, max_mmi: 2.9 } }));
  h.message(layerState('alerts', { digest: { counts: { polygon: 70, zone_only: 25, rejected: 5 } } }));
  assert.equal(h.events.length, 5, 'identical digests dispatch nothing');
  h.message(layerState('shakemap', { digest: { event_id: 'us7000tyca', available: true, reason: null, version: 3, max_mmi: 1.7 } }));
  assert.equal(h.events.length, 6, 'a changed digest is handed on');
  assert.equal(all.layers.perimeters.top[0].name, 'Fixture Ridge'); assert.deepEqual(all.layers.alerts.counts, { polygon: 70, zone_only: 25, rejected: 5 }); assert.deepEqual(all.layers.shakemap, { event_id: 'us7000tyhr', available: true });
  assert.match(h.byId('weSources').text, /25 name zones only/); assert.match(h.byId('weSources').text, /5 .*rejected/);
  /* a ShakeMap marks its quake on the feed row and the pins are sent again with it significant */
  assert.equal(all.events.find(e => e.id === 'usgs:us7000tyhr').shakemap_available, true);
  assert.equal(h.sent.filter(m => m.type === 'hu:environment-pins').at(-1).items.find(i => i.id === 'usgs:us7000tyhr').significant, true);
  /* the gate refuses: the next load says so, with its code, and there are no events */
  const refusal = (status, code) => Object.assign(new Error('refused'), { status, code });
  answer = () => refusal(503, 'module_policy_unavailable'); h.byId('weRefresh').onclick(); await flush(8);
  assert.equal(h.events.at(-1).detail.unavailable, true); assert.equal(h.events.at(-1).detail.code, 'module_policy_unavailable'); assert.deepEqual(h.events.at(-1).detail.events, []);
  answer = () => refusal(404, 'module_disabled'); h.byId('weRefresh').onclick(); await flush(8);
  assert.equal(h.events.at(-1).detail.code, 'module_disabled');
  answer = () => new Error('offline'); h.byId('weRefresh').onclick(); await flush(8);
  assert.equal(h.events.at(-1).detail.code, 'network');
  answer = () => ({ schema: 'something-else/v9' }); h.byId('weRefresh').onclick(); await flush(8);
  assert.equal(h.events.at(-1).detail.code, 'bad_response');
  answer = feedBody; h.byId('weRefresh').onclick(); await flush(8);
  assert.equal(h.events.at(-1).detail.unavailable, false); assert.equal(h.events.at(-1).detail.events.length, 65);
  h.mounted.destroy();
});

test('G1R-3: with two satellites the digest handed to the page names the record the layer\'s own fields came from (source_id), never the first by position', async () => {
  const h = harness();
  await flush(8);
  const noaa21 = { ...layerState('fires').sources[0], id: 'firms_viirs_noaa21', label: 'NASA FIRMS VIIRS NOAA-21', fetched_at: '2026-11-17T20:01:00Z', last_success_at: '2026-11-17T20:01:00Z', coverage: 'Global VIIRS active-fire detections from NOAA-21 in the 24 hours before retrieval', attribution: 'NASA FIRMS, VIIRS 375 m active fire product (NOAA-21, near real-time)' };
  h.message(layerState('fires', { fetched_at: noaa21.fetched_at, last_success_at: noaa21.last_success_at, coverage: noaa21.coverage, attribution: noaa21.attribution, source_id: 'firms_viirs_noaa21', sources: [layerState('fires').sources[0], noaa21], digest: { cells: [[-119, 34, 221, 1830.4, 212.5, '2026-11-17T19:30:00Z']], cell_degrees: 1, count: 600, total: 600, windows: [] } }));
  const fires = h.events.at(-1).detail.layers.fires;
  assert.equal(fires.label, 'NASA FIRMS VIIRS NOAA-21', 'the label of the record the layer speaks for'); assert.equal(fires.attribution, noaa21.attribution); assert.equal(fires.coverage, noaa21.coverage); assert.equal(fires.fetched_at, noaa21.fetched_at);
  h.mounted.destroy();
});

test('autostart: play is sent once per activation only while the tab is open, the frame is in view, the page is visible, motion is allowed and the visitor has not paused', async () => {
  const quiet = harness({ observer: true, reduced: true });
  await flush(8);
  assert.equal(quiet.sent.some(m => m.type === 'hu:environment-scene'), false, 'never under reduced motion');
  quiet.mounted.destroy();
  const hidden = harness({ observer: true, hidden: true });
  await flush(8);
  assert.equal(hidden.sent.some(m => m.type === 'hu:environment-scene'), false, 'never while the page is hidden');
  hidden.mounted.destroy();
  const unseen = harness();
  await flush(8);
  assert.equal(unseen.sent.some(m => m.type === 'hu:environment-scene'), false, 'no observer, no proof the frame is in view: no autostart');
  unseen.mounted.destroy();
  const h = harness({ observer: true });
  await flush(8);
  assert.deepEqual(h.sent.filter(m => m.type === 'hu:environment-scene'), [{ type: 'hu:environment-scene', action: 'play' }], 'once');
  const plays = () => h.sent.filter(m => m.type === 'hu:environment-scene' && m.action === 'play').length;
  h.message({ type: 'hu:environment-scene-state', playing: true, index: 0, total: 12, id: 'x', title: 'x', queue: 'significant', reason: null });
  assert.equal(plays(), 1, 'not again within the same activation');
  assert.equal(h.byId('wePlay').textContent, 'Pause tour');
  /* the globe says ready after the panel spoke (landing on the tab before the frame booted, or a frame that reloaded): a fresh globe
     has no tour, so the stale words clear and the one autostart is said again, with the layers and the pins before it */
  h.message({ type: 'hu:globe-ready' });
  assert.equal(plays(), 2, 'a fresh globe is played at once more');
  assert.equal(h.byId('wePlay').textContent, 'Play tour', 'no tour is claimed until the fresh globe says so');
  assert.deepEqual(h.sent.slice(-3).map(m => m.type + ':' + (m.on === undefined ? m.action : m.on)), ['hu:environment-layers:true', 'hu:environment-pins:true', 'hu:environment-scene:play'], 'layers, pins, then play');
  h.message({ type: 'hu:environment-scene-state', playing: true, index: 0, total: 12, id: 'x', title: 'x', queue: 'significant', reason: null });
  assert.equal(plays(), 2, 'not again within the same activation');
  h.setMode('feed'); h.setMode('environment'); await flush();
  assert.equal(plays(), 3, 'once per activation');
  /* the tab change cleared the old tour state (the globe stops its director on layers off); the globe reports the new tour, then the visitor pauses it */
  h.message({ type: 'hu:environment-scene-state', playing: true, index: 0, total: 12, id: 'x', title: 'x', queue: 'significant', reason: null });
  h.byId('wePlay').onclick();
  assert.deepEqual(h.sent.at(-1), { type: 'hu:environment-scene', action: 'pause' });
  h.message({ type: 'hu:environment-scene-state', playing: false, index: 0, total: 12, id: 'x', title: 'x', queue: 'significant', reason: 'user' });
  h.setMode('feed'); h.setMode('environment'); await flush();
  assert.equal(plays(), 3, 'a visitor who paused is not played at again this page session');
  h.message({ type: 'hu:globe-ready' });
  assert.equal(plays(), 3, 'not even by a globe that says ready again');
  h.mounted.destroy();
});

test('no private row leaks into any message to the globe or the page', async () => {
  const body = feedBody();
  body.events.push({ id: 'usgs:leak', title: 'Leak check', lat: 1, lon: 2, category: 'quake', source: { label: 'USGS', url: 'https://earthquake.usgs.gov/' }, facts: [], assignment_id: '22222222-2222-4222-8222-222222222222', user_id: 'private-user', address: '1 Private Street', display_name: 'A Person' });
  const h = harness({ answer: () => JSON.parse(JSON.stringify(body)) });
  await flush(8);
  const sent = JSON.stringify(h.sent);
  assert.doesNotMatch(sent, /assignment_id|user_id|Private Street|A Person|display_name/, 'the pins carry the public fields only');
  assert.ok(h.sent.some(m => m.type === 'hu:environment-pins' && m.items.some(i => i.id === 'usgs:leak')));
  assert.doesNotMatch(read('vendor/equity-uprise/src/environment/panel.mjs'), /MCC_SUPA|MCC_WORLD_MODE|api\.mccluster\.org|mccdb_session|mcc:auth-changed|MCC_ENVIRONMENT_POSTS/, 'host globals stay in the adapter');
  h.mounted.destroy();
});

test('G1R-9: typing in the search narrows the list at once and re-sends the pins once the typing pauses, never per keystroke', async () => {
  const h = harness();
  await flush(8);
  h.sent.length = 0;
  const input = h.byId('weSearch');
  for (const value of ['A', 'An', 'Ana', 'Anam']) { input.value = value; input.oninput({ target: input }); }
  assert.match(h.byId('weCount').textContent, /^1 observations shown/, 'the list narrowed at once');
  assert.equal(h.sent.filter(m => m.type === 'hu:environment-pins').length, 0, 'no pins message per keystroke');
  await new Promise(r => setTimeout(r, 400));
  const pins = h.sent.filter(m => m.type === 'hu:environment-pins');
  assert.equal(pins.length, 1, 'one pins message once the typing paused');
  assert.deepEqual(pins[0].items.map(i => i.id), ['usgs:us7000tyhr']);
  /* typing then leaving: the pending resend is cancelled with the mount, nothing is said after the last pins-off */
  input.value = 'Sara'; input.oninput({ target: input });
  h.mounted.destroy();
  const last = h.sent.length;
  await new Promise(r => setTimeout(r, 400));
  assert.equal(h.sent.length, last, 'nothing after destroy');
  assert.deepEqual(h.sent.at(-1), { type: 'hu:environment-pins', on: false, items: [] });
});

test('G1R-10: the pins carry the feed providers\' terms as the feed\'s own source records give them, six public fields each; never when off', async () => {
  const h = harness();
  await flush(8);
  const pins = h.sent.filter(m => m.type === 'hu:environment-pins' && m.on).at(-1);
  assert.deepEqual(pins.sources, FEED.sources.map(s => ({ id: s.id, label: s.label, url: s.url, attribution: s.attribution, license: s.license, coverage: s.coverage })));
  for (const s of pins.sources) assert.deepEqual(Object.keys(s), ['id', 'label', 'url', 'attribution', 'license', 'coverage']);
  assert.doesNotMatch(JSON.stringify(pins.sources), /fetched_at|last_success_at|status|reason|observed_at/, 'terms only, never health');
  h.setMode('feed'); await flush();
  const off = h.sent.filter(m => m.type === 'hu:environment-pins').at(-1);
  assert.equal(off.on, false); assert.equal('sources' in off, false, 'an off message carries no terms');
  h.mounted.destroy();
  assert.deepEqual(h.sent.at(-1), { type: 'hu:environment-pins', on: false, items: [] });
});

test('G1R-6: the panel\'s buttons are form controls at 16px or more (AGENTS.md hard rule 14), whatever the panel\'s 15px body says', () => {
  const css = read('css/world-environment.css');
  const rule = /\.we-panel button,\.we-button \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the button rule');
  assert.match(rule[1], /font:inherit;font-size:max\(16px,1em\);/, 'font-size after the font shorthand, so it wins');
  assert.match(css, /\.we-panel \{[^}]*font:400 15px\/1\.5/, 'the body text stays at 15px');
  assert.doesNotMatch(css, /@media\s*\(\s*max-width/, 'min-width queries only');
});

test('G1R-7: a ShakeMap digest seen before still reaches the page when it marks a row of a freshly loaded feed', async () => {
  const h = harness();
  await flush(8);
  const shakemap = layerState('shakemap', { digest: { event_id: 'us7000tyhr', available: true, reason: null, version: 5, max_mmi: 2.9 } });
  h.message(shakemap);
  const marked = () => h.events.at(-1).detail.events.find(e => e.id === 'usgs:us7000tyhr').shakemap_available === true;
  assert.equal(marked(), true);
  h.byId('weRefresh').onclick(); await flush(8);
  assert.equal(marked(), false, 'the reloaded feed has lost the mark');
  const before = h.events.length;
  h.message(shakemap);
  assert.equal(h.events.length, before + 1, 'the same digest, but it marked the row again: the page is told');
  assert.equal(marked(), true);
  h.message(shakemap);
  assert.equal(h.events.length, before + 1, 'and only once');
  h.mounted.destroy();
});
