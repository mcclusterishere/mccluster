/* The credential-free public client for the six environmental layer routes (js/environment-layers-client.js).
   A fake fetch and fake timers only: no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const source = read('js/environment-layers-client.js');
const ORIGIN = 'https://api.mccluster.org';
function load() {
  const window = {};
  vm.runInNewContext(source, { window, console, AbortController, URL });
  return window.MCC_ENVIRONMENT_LAYERS_CLIENT;
}
const CLIENT = load();
const BODIES = {
  fires: { ok: true, schema: 'world-environment-fires/v1', generated_at: '2026-11-17T20:00:00.000Z', sources: [{ id: 'firms_viirs_noaa20', status: 'available' }, { id: 'firms_viirs_noaa21', status: 'stale' }], detections: [] },
  perimeters: { ok: true, schema: 'world-environment-perimeters/v1', generated_at: '2026-11-17T20:00:00.000Z', sources: [{ id: 'wfigs', status: 'available' }], perimeters: [] },
  alerts: { ok: true, schema: 'world-environment-alerts/v1', generated_at: '2026-11-17T20:00:00.000Z', sources: [{ id: 'nws', status: 'available' }], alerts: [] },
  eonet: { ok: true, schema: 'world-environment-eonet/v1', generated_at: '2026-11-17T14:00:00.000Z', sources: [{ id: 'eonet', status: 'stale' }], events: [] },
  tides: { ok: true, schema: 'world-environment-tides/v1', generated_at: '2026-11-17T20:00:00.000Z', sources: [{ id: 'coops_stations', status: 'available' }, { id: 'coops_latest', status: 'unavailable' }], latest: { readings: [] } },
  shakemap: { ok: true, schema: 'world-environment-shakemap/v1', generated_at: '2026-11-17T20:01:00.000Z', sources: [{ id: 'usgs_event', status: 'available' }], event_id: 'us7000tyhr', available: true, contours: [] }
};
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function timers() {
  const list = []; let n = 0;
  return {
    list,
    setTimeout: (fn, ms) => { const id = ++n; list.push({ id, fn, ms, fired: false, cleared: false }); return id; },
    clearTimeout: id => { const t = list.find(x => x.id === id); if (t) t.cleared = true; },
    pending: () => list.filter(t => !t.fired && !t.cleared),
    fire: (pred) => { const t = list.find(x => !x.fired && !x.cleared && (!pred || pred(x))); if (!t) throw new Error('no timer to fire'); t.fired = true; t.fn(); return t; }
  };
}
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const layerOf = url => Object.keys(CLIENT.ROUTES).find(k => url === ORIGIN + CLIENT.ROUTES[k].path) || (/\/quakes\/[^/]+\/shakemap$/.test(url) ? 'shakemap' : null);

test('six routes, the fixed origin, GET with credentials omitted and only an accept header', async () => {
  const calls = [];
  const T = timers();
  const client = CLIENT.create({ fetchImpl: async (url, init) => { calls.push({ url, init }); return json(BODIES[layerOf(url)]); }, now: () => 0, ...T });
  for (const layer of ['fires', 'perimeters', 'alerts', 'eonet', 'tides']) {
    const result = await client.fetchLayer(layer);
    assert.equal(result.ok, true, layer); assert.equal(result.http, 200); assert.equal(result.generated_at, BODIES[layer].generated_at);
  }
  await client.shakemap('usgs:us7000tyhr');
  assert.deepEqual(calls.map(c => c.url), [
    ORIGIN + '/v1/world/environment/layers/fires', ORIGIN + '/v1/world/environment/layers/perimeters', ORIGIN + '/v1/world/environment/layers/alerts',
    ORIGIN + '/v1/world/environment/layers/eonet', ORIGIN + '/v1/world/environment/layers/tides', ORIGIN + '/v1/world/environment/quakes/us7000tyhr/shakemap'
  ]);
  for (const { init } of calls) {
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    assert.deepEqual({ ...init.headers }, { accept: 'application/json' });
    assert.ok(init.signal, 'an abort signal');
    assert.doesNotMatch(JSON.stringify(Object.keys(init)), /authorization|cookie|token|key/i);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(CLIENT.ROUTES).map(([k, r]) => [k, [r.schema, r.window]])), {
    fires: ['world-environment-fires/v1', 1800], perimeters: ['world-environment-perimeters/v1', 600], alerts: ['world-environment-alerts/v1', 120],
    eonet: ['world-environment-eonet/v1', 600], tides: ['world-environment-tides/v1', 900], shakemap: ['world-environment-shakemap/v1', 300]
  });
  assert.doesNotMatch(source, /location\.|localStorage|sessionStorage|document\./, 'the origin is a constant and nothing is stored');
  assert.match(source, /'https:\/\/api\.mccluster\.org'/);
});
test('status derives from the sources: available over stale over unavailable; a schema mismatch is bad_response', async () => {
  assert.equal(CLIENT.statusFromSources([{ status: 'stale' }, { status: 'available' }]), 'available');
  assert.equal(CLIENT.statusFromSources([{ status: 'stale' }, { status: 'unavailable' }]), 'stale');
  assert.equal(CLIENT.statusFromSources([{ status: 'unavailable' }]), 'unavailable');
  assert.equal(CLIENT.statusFromSources([]), 'unavailable');
  const T = timers();
  const client = CLIENT.create({ fetchImpl: async () => json({ ok: true, schema: 'world-environment-fires/v2', sources: [] }), ...T });
  const bad = await client.fetchLayer('fires');
  assert.deepEqual([bad.ok, bad.status, bad.reason, bad.http], [false, 'unavailable', 'bad_response', 200]);
  const client2 = CLIENT.create({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }), ...T });
  const bad2 = await client2.fetchLayer('alerts');
  assert.deepEqual([bad2.status, bad2.reason], ['unavailable', 'bad_response']);
  const client3 = CLIENT.create({ fetchImpl: async () => json({ error: 'x' }, 500), ...T });
  const bad3 = await client3.fetchLayer('alerts');
  assert.deepEqual([bad3.status, bad3.reason, bad3.http], ['unavailable', 'http_500', 500]);
  const tides = await CLIENT.create({ fetchImpl: async () => json(BODIES.tides), ...T }).fetchLayer('tides');
  assert.equal(tides.status, 'available');
  const eonet = await CLIENT.create({ fetchImpl: async () => json(BODIES.eonet), ...T }).fetchLayer('eonet');
  assert.equal(eonet.status, 'stale');
});
for (const [http, code] of [[503, 'module_policy_unavailable'], [404, 'module_disabled']]) {
  test(`${http} ${code}: every layer goes policy, pending fetches abort, no refresh timer, one retry on the next activation`, async () => {
    const T = timers();
    const seen = [], states = [], data = [];
    let holdOthers = true;
    const client = CLIENT.create({
      fetchImpl: (url, init) => {
        const layer = layerOf(url); seen.push(layer);
        if (layer === 'alerts') return Promise.resolve(json({ ok: false, code }, http));
        return new Promise((resolve, reject) => {
          if (!holdOthers) return resolve(json(BODIES[layer]));
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }, ...T, hidden: () => false
    });
    client.start({ onState: (layer, state) => states.push([layer, state.status, state.reason]), onData: (layer) => data.push(layer) });
    await flush(10);
    assert.deepEqual(seen.sort(), ['alerts', 'eonet', 'fires', 'perimeters', 'tides']);
    const policy = states.filter(([, status]) => status === 'policy');
    assert.deepEqual(policy.map(([layer]) => layer).sort(), ['alerts', 'eonet', 'fires', 'perimeters', 'shakemap', 'tides'], 'all six layers');
    assert.ok(policy.every(([, , reason]) => reason === code));
    assert.deepEqual(data, [], 'no data was handed on');
    assert.equal(client.isPolicy(), true);
    assert.deepEqual(T.pending().filter(t => t.ms >= 5000), [], 'no retry and no refresh timer against a disabled module');
    const alerts = await client.fetchLayer('alerts');
    assert.deepEqual([alerts.ok, alerts.status, alerts.reason, alerts.http], [false, 'policy', code, http]);
    client.stop();
    holdOthers = false; seen.length = 0;
    client.start({ onState() {}, onData() {} });
    await flush(10);
    assert.equal(seen.length, 5, 'the next activation retries once');
  });
}
test('a network failure retries once after 5 s, then waits for the refresh window', async () => {
  const T = timers();
  let fails = 2; const seen = [];
  const client = CLIENT.create({ fetchImpl: async (url) => { seen.push(layerOf(url)); if (fails-- > 0) throw new TypeError('network'); return json(BODIES.alerts); }, ...T, hidden: () => false });
  const states = [];
  client.start({ onState: (layer, state) => states.push([layer, state.status, state.reason]), onData() {}, layers: ['alerts'] });
  await flush(10);
  assert.deepEqual(states.filter(s => s[0] === 'alerts').map(s => s.slice(1)), [['loading', null], ['unavailable', 'network']]);
  const retry = T.pending().filter(t => t.ms === 5000);
  assert.equal(retry.length, 1, 'exactly one 5 s retry');
  T.fire(t => t.ms === 5000); await flush(10);
  assert.equal(seen.length, 2);
  assert.deepEqual(T.pending().filter(t => t.ms === 5000), [], 'no second retry: the window takes over');
  const windowTimer = T.pending().filter(t => t.ms === 120000);
  assert.equal(windowTimer.length, 1, 'the alerts window is 120 s');
  T.fire(t => t.ms === 120000); await flush(10);
  assert.equal(seen.length, 3);
  assert.equal(states.at(-1)[1], 'available');
});
test('a timeout is reported as timeout and uses the abort signal', async () => {
  const T = timers();
  const client = CLIENT.create({ fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))), timeoutMs: 20000, ...T });
  const pending = client.fetchLayer('fires');
  const t = T.pending().find(x => x.ms === 20000);
  assert.ok(t, 'a 20 s timeout is armed');
  T.fire(x => x.ms === 20000);
  const result = await pending;
  assert.deepEqual([result.ok, result.status, result.reason, result.http], [false, 'unavailable', 'timeout', null]);
});
test('shakemap: id validation, the prefix stripped, cached per activation', async () => {
  const T = timers(); const seen = [];
  const client = CLIENT.create({ fetchImpl: async (url) => { seen.push(url); return json(BODIES.shakemap); }, ...T });
  const bad = await client.shakemap('usgs:bad id!');
  assert.deepEqual([bad.ok, bad.status, bad.reason], [false, 'unavailable', 'invalid_event']);
  assert.deepEqual(await client.shakemap('us7000tyhr') && seen, [ORIGIN + '/v1/world/environment/quakes/us7000tyhr/shakemap']);
  await client.shakemap('usgs:us7000tyhr');
  assert.equal(seen.length, 1, 'cached for the activation');
  const upper = await client.shakemap('usgs:US7000TYHR');
  assert.equal(upper.reason, 'invalid_event', 'the Worker takes lower case only');
  client.stop(); await client.shakemap('usgs:us7000tyhr');
  assert.equal(seen.length, 2, 'a new activation fetches again');
});
test('a refresh whose generated_at is unchanged hands nothing on; a change rebuilds once', async () => {
  const T = timers();
  let generated = '2026-11-17T20:00:00.000Z';
  const client = CLIENT.create({ fetchImpl: async () => json({ ...BODIES.alerts, generated_at: generated }), ...T, hidden: () => false });
  const data = [], states = [];
  client.start({ onState: (layer, s) => states.push(s.status), onData: (layer, body) => data.push(body.generated_at), layers: ['alerts'] });
  await flush(10);
  assert.deepEqual(data, [generated]);
  T.fire(t => t.ms === 120000); await flush(10);
  assert.deepEqual(data, [generated], 'unchanged: no rebuild');
  generated = '2026-11-17T20:02:00.000Z';
  T.fire(t => t.ms === 120000); await flush(10);
  assert.deepEqual(data, ['2026-11-17T20:00:00.000Z', '2026-11-17T20:02:00.000Z']);
  assert.ok(states.filter(s => s === 'available').length >= 2, 'the state is re-sent when data changed');
  client.stop();
  assert.deepEqual(T.pending(), [], 'stop clears every timer');
});
test('while the document is hidden the refresh waits', async () => {
  const T = timers(); let hidden = true; const seen = [];
  const client = CLIENT.create({ fetchImpl: async () => { seen.push(1); return json(BODIES.alerts); }, ...T, hidden: () => hidden });
  client.start({ onState() {}, onData() {}, layers: ['alerts'] });
  await flush(10);
  assert.equal(seen.length, 1);
  T.fire(t => t.ms === 120000); await flush(10);
  assert.equal(seen.length, 1, 'hidden: not refreshed');
  assert.equal(T.pending().filter(t => t.ms === 120000).length, 1, 're-armed for later');
  hidden = false; T.fire(t => t.ms === 120000); await flush(10);
  assert.equal(seen.length, 2);
  client.stop();
});
