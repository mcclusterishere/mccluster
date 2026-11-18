/* The scene director (js/globe-scene-director.js, adapted from gods-eye-view): the pure queue and flight helpers,
   and the runtime over a fake camera. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const source = read('js/globe-scene-director.js');
function load() {
  const window = {};
  vm.runInNewContext(source, { window, console });
  return window.MCC_GLOBE_DIRECTOR;
}
const D = load();
const P = D.pure;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
/* values made inside the vm realm carry another prototype: copy them before a strict deep comparison */
const plain = x => JSON.parse(JSON.stringify(x));
const at = (n) => new Date(Date.UTC(2026, 10, 17, 0, n)).toISOString();
const item = (id, extra = {}) => ({ id, title: id, lat: 10, lon: 20, stale: false, significant: true, observed_at: at(0), facts: [], ...extra });

test('buildQueue significant: placed significant items only, newest first, null times last then by id, cap 12', () => {
  const items = [];
  for (let i = 0; i < 14; i++) items.push(item('usgs:q' + i, { observed_at: at(i), facts: [{ label: 'Magnitude', value: '6' }], category: 'quake' }));
  items.push(item('nws:zone', { lat: null, lon: null }));
  items.push(item('nws:not', { significant: false }));
  items.push(item('nhc:b', { observed_at: null, category: 'cyclone' }), item('nhc:a', { observed_at: null, category: 'cyclone' }));
  const queue = P.buildQueue(items, { queue: 'significant' });
  assert.equal(queue.length, 12);
  assert.equal(queue[0].id, 'usgs:q13'); assert.equal(queue[1].id, 'usgs:q12');
  assert.ok(queue.every(s => s.id !== 'nws:zone' && s.id !== 'nws:not'));
  const small = P.buildQueue([item('nhc:b', { observed_at: null, category: 'cyclone' }), item('nhc:a', { observed_at: null, category: 'cyclone' }), item('usgs:q', { observed_at: at(5), category: 'quake', facts: [{ label: 'Magnitude', value: '7.2' }] })], { queue: 'significant' });
  assert.deepEqual(plain(small.map(s => s.id)), ['usgs:q', 'nhc:a', 'nhc:b']);
  const q = small[0];
  assert.deepEqual(Object.keys(q).sort(), ['height_m', 'hold_ms', 'id', 'kind', 'lat', 'layer', 'lon', 'observed_at', 'pitch_deg', 'title']);
  assert.equal(q.kind, 'quake'); assert.equal(q.layer, 'events'); assert.equal(q.height_m, 1600000, 'M>=7 flies higher'); assert.equal(q.pitch_deg, -90); assert.equal(q.hold_ms, 5000);
  assert.equal(small[1].kind, 'cyclone'); assert.equal(small[1].height_m, 2000000);
  assert.deepEqual(plain(P.buildQueue([], { queue: 'significant' })), []);
  assert.deepEqual(plain(P.buildQueue(null, { queue: 'significant' })), []);
});
test('buildQueue quakes-24h: recorded order within 24 h of the newest quake, cap 50, hold 2.5 s', () => {
  const items = [];
  for (let i = 0; i < 55; i++) items.push(item('usgs:g' + i, { category: 'quake', significant: false, observed_at: new Date(Date.UTC(2026, 10, 17) + i * 25 * 60000).toISOString(), facts: [{ label: 'Magnitude', value: '3' }] }));
  items.push(item('usgs:old', { category: 'quake', observed_at: '2026-11-15T00:00:00.000Z' }));
  items.push(item('nws:a', { category: 'flood', observed_at: at(50) }));
  const queue = P.buildQueue(items, { queue: 'quakes-24h' });
  assert.equal(queue.length, 50);
  assert.equal(queue[0].id, 'usgs:g0'); assert.equal(queue[49].id, 'usgs:g49');
  assert.ok(queue.every(s => s.kind === 'quake' && s.hold_ms === 2500));
  assert.ok(!queue.some(s => s.id === 'usgs:old' || s.id === 'nws:a'));
  const two = P.buildQueue([item('usgs:late', { category: 'quake', observed_at: '2026-11-17T20:00:00.000Z' }), item('usgs:early', { category: 'quake', observed_at: '2026-11-16T20:00:00.000Z' }), item('usgs:out', { category: 'quake', observed_at: '2026-11-16T19:59:59.000Z' })], { queue: 'quakes-24h' });
  assert.deepEqual(plain(two.map(s => s.id)), ['usgs:early', 'usgs:late'], 'inclusive 24 h window, oldest first');
});
test('flight duration: 1.2 to 4.5 s, longer with distance and with a change of height', () => {
  const fd = (deg, h1 = 1e6, h2 = 1e6) => P.flightDuration({ lon: 0, lat: 0, height: h1 }, { lon: deg, lat: 0, height: h2 });
  assert.equal(fd(0), 1.2);
  assert.equal(fd(180), 4.5);
  assert.ok(fd(30) < fd(60) && fd(60) < fd(120));
  assert.ok(fd(0, 1e6, 1e8) > fd(0));
  assert.ok(near(fd(20), 0.8 + 0.045 * 20));
  assert.ok(near(P.greatCircleDeg({ lon: 0, lat: 0 }, { lon: 0, lat: 90 }), 90));
  assert.ok(near(P.greatCircleDeg({ lon: 0, lat: 0 }, { lon: 180, lat: 0 }), 180));
  assert.ok(near(P.greatCircleDeg({ lon: 170, lat: 10 }, { lon: -170, lat: 10 }), P.greatCircleDeg({ lon: 0, lat: 10 }, { lon: 20, lat: 10 })));
});
test('shortestArcMidLon crosses the antimeridian the short way', () => {
  assert.equal(Math.abs(P.shortestArcMidLon(170, -170)), 180);
  assert.equal(P.shortestArcMidLon(0, 90), 45);
  assert.equal(P.shortestArcMidLon(-10, 10), 0);
  assert.equal(Math.abs(P.shortestArcMidLon(-170, 170)), 180);
  assert.equal(P.shortestArcMidLon(150, -170), 170, 'west to east across the antimeridian: the 40 degree way, not the 320 degree way');
  assert.equal(P.shortestArcMidLon(-150, 170), -170);
  assert.equal(P.normalizeLon(190), -170); assert.equal(P.normalizeLon(-190), 170); assert.equal(P.normalizeLon(45), 45);
});
test('heightFor names a height per kind and measure', () => {
  assert.equal(P.heightFor('quake', { mag: 5 }), 900000); assert.equal(P.heightFor('quake', { mag: 7 }), 1600000); assert.equal(P.heightFor('quake', {}), 900000);
  assert.equal(P.heightFor('alert', { bboxSpanDeg: 1 }), 250000); assert.equal(P.heightFor('alert', { bboxSpanDeg: 5 }), 5 * 111000 * 1.6);
  assert.equal(P.heightFor('natural', { category: 'fire' }), 300000); assert.equal(P.heightFor('natural', { category: 'cyclone' }), 1500000); assert.equal(P.heightFor('natural', { category: 'storm' }), 1500000);
  assert.equal(P.heightFor('natural', { category: 'volcano' }), 250000); assert.equal(P.heightFor('natural', { category: 'ice' }), 600000);
  assert.equal(P.heightFor('cyclone', {}), 2000000); assert.equal(P.heightFor('perimeter', {}), 120000); assert.equal(P.heightFor('station', {}), 500000); assert.equal(P.heightFor('fire_cell', {}), 400000);
  assert.equal(P.heightFor('event', {}), 600000);
});

/* ---------- the runtime ---------- */
function timers() {
  const list = []; let n = 0;
  return { list, setTimeout: (fn, ms) => { const id = ++n; list.push({ id, fn, ms, fired: false, cleared: false }); return id; }, clearTimeout: id => { const t = list.find(x => x.id === id); if (t) t.cleared = true; },
    pending: () => list.filter(t => !t.fired && !t.cleared), fire: pred => { const t = list.find(x => !x.fired && !x.cleared && (!pred || pred(x))); if (!t) throw new Error('no timer'); t.fired = true; t.fn(); return t; } };
}
function rig({ reduced = false, hidden = false } = {}) {
  const T = timers();
  const flights = [], views = [], holds = [], releases = [], told = [], arrived = [];
  const camera = {
    positionCartographic: { longitude: 0, latitude: 0, height: 1e7 },
    flyTo(options) { flights.push(options); camera.pending = options; },
    setView(options) { views.push(options); camera.positionCartographic = { longitude: options.destination.lon * Math.PI / 180, latitude: options.destination.lat * Math.PI / 180, height: options.destination.h }; },
    cancelFlight() { const p = camera.pending; camera.pending = null; if (p && p.cancel) p.cancel(); },
    pending: null
  };
  const complete = () => { const p = camera.pending; camera.pending = null; camera.positionCartographic = { longitude: p.destination.lon * Math.PI / 180, latitude: p.destination.lat * Math.PI / 180, height: p.destination.h }; p.complete(); };
  const Cesium = { Cartesian3: { fromDegrees: (lon, lat, h) => ({ lon, lat, h }) }, Math: { toRadians: d => d * Math.PI / 180, toDegrees: r => r * 180 / Math.PI }, EasingFunction: { CUBIC_IN_OUT: 'cubic-in-out' } };
  const governor = { hold: (owner, maxMs) => holds.push([owner, maxMs]), release: owner => releases.push(owner), requestRender() {} };
  const director = D.create({ viewer: { camera }, Cesium, governor, tell: m => told.push(m), reducedMotion: () => reduced, hidden: () => hidden, ...T, now: () => 0, onArrive: scene => arrived.push(scene.id) });
  const items = [item('usgs:a', { category: 'quake', lat: 10, lon: 20, observed_at: at(3), facts: [{ label: 'Magnitude', value: '6' }] }), item('usgs:b', { category: 'quake', lat: -5, lon: 100, observed_at: at(2), facts: [{ label: 'Magnitude', value: '7.5' }] }), item('nhc:c', { category: 'cyclone', lat: 16, lon: -83, observed_at: null })];
  director.setQueue(items, { queue: 'significant' });
  return { T, flights, views, holds, releases, told, arrived, camera, complete, director };
}
test('play is refused under reduced motion, while hidden, and with an empty queue, with the stated reasons', () => {
  const a = rig({ reduced: true }); a.director.play();
  assert.equal(a.flights.length, 0); assert.equal(a.director.state().playing, false); assert.equal(a.director.state().reason, 'reduced-motion');
  const b = rig({ hidden: true }); b.director.play();
  assert.equal(b.flights.length, 0); assert.equal(b.director.state().reason, 'hidden');
  const c = rig(); c.director.setQueue([], { queue: 'significant' }); c.director.play();
  assert.equal(c.director.state().reason, 'empty'); assert.equal(c.director.state().total, 0);
});
test('play flies with CUBIC_IN_OUT and a bounded hold, dwells without a hold, advances, and ends with reason end', () => {
  const r = rig();
  r.director.play();
  assert.equal(r.flights.length, 1);
  const f = r.flights[0];
  assert.equal(f.easingFunction, 'cubic-in-out');
  assert.ok(f.duration >= 1.2 && f.duration <= 4.5);
  assert.deepEqual(plain(f.orientation), { heading: 0, pitch: -Math.PI / 2, roll: 0 });
  assert.equal(f.destination.lon, 20); assert.equal(f.destination.lat, 10); assert.equal(f.destination.h, 900000);
  assert.equal(typeof f.flyOverLongitude, 'number');
  assert.deepEqual(r.holds.at(-1), ['env-director', Math.round(f.duration * 1000 + 600)]);
  assert.equal(r.director.state().playing, true); assert.equal(r.director.state().index, 0); assert.equal(r.director.state().id, 'usgs:a'); assert.equal(r.director.state().total, 3);
  r.complete();
  assert.deepEqual(r.arrived, ['usgs:a']);
  assert.deepEqual(r.releases, ['env-director'], 'released on arrival');
  const dwell = r.T.pending().find(t => t.ms === 5000);
  assert.ok(dwell, 'the dwell is a plain timer');
  assert.equal(r.holds.length, 1, 'no hold while dwelling');
  r.T.fire(t => t.ms === 5000);
  assert.equal(r.flights.length, 2); assert.equal(r.director.state().index, 1);
  r.complete(); r.T.fire(t => t.ms === 5000);
  assert.equal(r.flights.length, 3); assert.equal(r.flights[2].destination.h, 2000000, 'the cyclone scene height');
  r.complete(); r.T.fire(t => t.ms === 5000);
  assert.equal(r.director.state().playing, false); assert.equal(r.director.state().reason, 'end'); assert.equal(r.director.state().index, 2);
  r.director.play();
  assert.equal(r.director.state().index, 0, 'play again restarts at 0'); assert.equal(r.flights.length, 4);
  assert.ok(r.told.length >= 6, 'setQueue, play, two advances, end, play again: ' + r.told.length); assert.ok(r.told.every(m => m.type === 'hu:environment-scene-state'));
  assert.deepEqual(Object.keys(r.told[0]).sort(), ['id', 'index', 'playing', 'queue', 'reason', 'title', 'total', 'type']);
  assert.equal(r.told[0].queue, 'significant');
});
test('G1R-4: play on a tour already under way is idempotent: no second flight, no restarted dwell, the state told again', () => {
  const r = rig();
  r.director.play();
  assert.equal(r.flights.length, 1);
  r.director.play();
  assert.equal(r.flights.length, 1, 'the flight in progress is not restarted');
  assert.equal(r.holds.length, 1, 'no second hold');
  assert.equal(r.told.at(-1).playing, true); assert.equal(r.told.at(-1).index, 0);
  r.complete();
  const dwells = () => r.T.pending().filter(t => t.ms === 5000).length;
  assert.equal(dwells(), 1);
  r.director.play();
  assert.equal(dwells(), 1, 'the dwell is not restarted'); assert.equal(r.flights.length, 1);
  r.T.fire(t => t.ms === 5000);
  assert.equal(r.flights.length, 2, 'the tour still advances on its own');
});
test('pause cancels the flight (through its cancel callback) and keeps the index; interrupt pauses with reason input', () => {
  const r = rig();
  r.director.play(); r.complete(); r.T.fire(t => t.ms === 5000);
  assert.equal(r.director.state().index, 1);
  r.director.pause();
  assert.equal(r.camera.pending, null, 'cancelFlight was called');
  assert.equal(r.releases.filter(x => x === 'env-director').length, 2);
  assert.equal(r.director.state().playing, false); assert.equal(r.director.state().index, 1); assert.equal(r.director.state().reason, null);
  r.director.play(); assert.equal(r.flights.length, 3); assert.equal(r.director.state().index, 1, 'resumes where it paused');
  r.director.interrupt('input');
  assert.equal(r.director.state().playing, false); assert.equal(r.director.state().reason, 'input');
  r.director.play(); r.complete();
  assert.equal(r.T.pending().some(t => t.ms === 5000), true);
  r.director.pause('hidden');
  assert.deepEqual(r.T.pending().filter(t => t.ms === 5000), [], 'the dwell timer is cleared');
  assert.equal(r.director.state().reason, 'hidden');
});
test('next and prev wrap and jump instantly under reduced motion; stop resets to 0 with reason off', () => {
  const r = rig({ reduced: true });
  r.director.next();
  assert.equal(r.views.length, 1); assert.equal(r.flights.length, 0); assert.equal(r.director.state().index, 1); assert.deepEqual(r.arrived, ['usgs:b']);
  r.director.prev(); r.director.prev();
  assert.equal(r.director.state().index, 2, 'wrapped'); assert.equal(r.views.length, 3);
  r.director.next(); assert.equal(r.director.state().index, 0);
  r.director.stop();
  assert.equal(r.director.state().index, 0); assert.equal(r.director.state().reason, 'off'); assert.equal(r.director.state().playing, false);
  const s = rig();
  s.director.play(); s.complete();
  s.director.next();
  assert.equal(s.flights.length, 2); assert.equal(s.director.state().playing, true);
  s.complete();
  assert.equal(s.T.pending().some(t => t.ms === 5000), true, 'the dwell restarts on arrival when it was playing');
  s.director.stop();
  assert.equal(s.T.pending().filter(t => t.ms === 5000).length, 0);
  assert.equal(s.director.state().index, 0);
});
test('a rebuilt queue keeps the index while the current id survives, else restarts at 0; the replay queue is named', () => {
  const r = rig();
  r.director.play(); r.complete(); r.T.fire(t => t.ms === 5000);
  assert.equal(r.director.state().id, 'usgs:b');
  r.director.setQueue([item('usgs:b', { category: 'quake', observed_at: at(2), facts: [{ label: 'Magnitude', value: '7.5' }] }), item('usgs:a', { category: 'quake', observed_at: at(3) })], { queue: 'significant' });
  assert.equal(r.director.state().id, 'usgs:b'); assert.equal(r.director.state().index, 1);
  r.director.setQueue([item('usgs:z', { category: 'quake', observed_at: at(9) })], { queue: 'quakes-24h' });
  assert.equal(r.director.state().index, 0); assert.equal(r.director.state().queue, 'quakes-24h'); assert.equal(r.director.state().total, 1);
  assert.deepEqual(plain(r.director.queueIds()), ['usgs:z']);
  const flightTimer = r.T.pending().find(t => t.ms > 1000 && t.ms !== 5000);
  assert.ok(flightTimer === undefined || flightTimer.cleared === false);
});
test('a flight that never answers resolves through the safety timeout; destroy stops everything', () => {
  const r = rig();
  r.director.play();
  const safety = r.T.pending().find(t => t.ms === Math.round(r.flights[0].duration * 1000 + 600));
  assert.ok(safety, 'duration + 600 ms safety');
  r.T.fire(t => t === safety);
  assert.deepEqual(r.arrived, ['usgs:a'], 'the scene still arrives');
  r.director.destroy();
  assert.equal(r.director.state().playing, false);
  assert.deepEqual(r.T.pending(), []);
  assert.match(source.slice(0, 800), /Adapted from gods-eye-view src\/director\/camera\.js \(shortest-arc interpolation\), src\/director\/playback\.js \(queue phases\) and src\/cameraVerbs\.js \(manual-input interrupt\), MIT, Copyright \(c\) 2026 Bilawal Sidhu, see THIRD-PARTY-NOTICES/);
});
