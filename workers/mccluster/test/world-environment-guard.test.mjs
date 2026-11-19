/* THE ENVIRONMENT MODULE'S PUBLIC ANSWERS AND THE BOUNDS ON ITS PUBLIC READS (./src/world-environment-guard.js; E=UP event timeline
   slice S0, 2026-11-19, docs/control-plane/EUP-EVENT-TIMELINE.md). Fake fetch and an in-memory cache only (the offline guard
   refuses anything else).
     - off, outage and no data are three answers on the wire, and the policy is read once per request;
     - release security review SEC-2: concurrent misses share one provider read (40 concurrent requests for one uncached layer
       made 40 provider requests), on-demand lookups are capped in flight, a client past its share of the public reads gets 429
       with retry-after, and the water-level crawl ends on time (81 s with every NOAA request hanging);
     - E6: the USGS source's latest observation is a quake's origin time, never the feed's generation time. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWorldEnvironment, environmentFeed } from '../src/world-environment.js';
/* imported softly, so this file also runs against the code before the guard existed (the proof that these tests fail without it) */
const { MAX_LOOKUP_FLIGHTS, OFF, OUTAGE, PUBLIC_READ_LIMITS, clientKey, createPublicReadLimits, createRateLimiter, refusalOf, sharedLayer, flightCount } = await import('../src/world-environment-guard.js').catch(() => ({}));
import { TIDES_PUBLIC, TIDE_LATEST_STATIONS } from '../src/world-environment-layers.js';

const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret', ALLOWED_ORIGINS: 'https://mccluster.org' };
const P = '/v1/world/environment';
const POLICY_RPC = '/rest/v1/rpc/eup_module_policy_read';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const policyOf = (state = 'enabled', revision = 3) => ({ schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId: 'environment', state, revision });
const req = (path, { ip = null, method = 'GET', auth = false } = {}) => new Request(`https://api.mccluster.org${path}`, { method, headers: { origin: 'https://mccluster.org', ...(ip ? { 'cf-connecting-ip': ip } : {}), ...(auth ? { authorization: 'Bearer member' } : {}) } });
function memoryCache() {
  const raw = new Map();
  return { raw, async match(k) { return raw.has(k.url) ? new Response(raw.get(k.url)) : undefined; }, async put(k, r) { raw.set(k.url, await r.text()); } };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/* the policy store plus the providers a test supplies; every call is logged */
function world(providers, { policy = () => json(policyOf()) } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith(POLICY_RPC)) return policy();
    if (u.startsWith('https://db.example/')) return json([]);
    return providers(new URL(u), init);
  };
  impl.calls = calls;
  impl.providerCalls = () => calls.filter((u) => !u.startsWith('https://db.example/'));
  impl.policyReads = () => calls.filter((u) => u.endsWith(POLICY_RPC)).length;
  return impl;
}
const EONET = { events: [{ id: 'EONET_1', title: 'Wildfire', categories: [{ id: 'wildfires', title: 'Wildfires' }], sources: [{ id: 'InciWeb' }], geometry: [{ type: 'Point', coordinates: [-72, 41], date: new Date(Date.now() - 3600e3).toISOString() }] }] };

test('off, outage and no data are three answers on the wire, each after exactly one policy read', async () => {
  const cases = [
    ['off: never installed (EUM01)', () => json({ code: 'EUM01', message: 'module_not_installed' }, 400), 404, { ok: false, code: 'module_disabled' }],
    ['off: installed and disabled', () => json(policyOf('disabled', 1)), 404, { ok: false, code: 'module_disabled' }],
    ['outage: store answers 500', () => json({ message: 'boom' }, 500), 503, { ok: false, code: 'module_policy_unavailable' }],
    ['outage: store unreachable', () => { throw new Error('offline'); }, 503, { ok: false, code: 'module_policy_unavailable' }],
    ['outage: a policy function missing (42883)', () => json({ code: '42883', message: 'function does not exist' }, 404), 503, { ok: false, code: 'module_policy_unavailable' }]
  ];
  for (const [label, policy, status, body] of cases) {
    for (const path of [P, `${P}/layers/eonet`]) {
      const f = world(() => { throw new Error('no provider expected'); }, { policy });
      const r = await handleWorldEnvironment(req(path), ENV, { fetchImpl: f, cacheImpl: memoryCache() });
      assert.equal(r.status, status, `${label} ${path}`); assert.deepEqual(await r.json(), body, `${label} ${path}`);
      assert.equal(f.policyReads(), 1, `${label} ${path}: one policy read`); assert.equal(f.providerCalls().length, 0);
    }
  }
  /* no data: the module on, every provider answering with nothing: 200 with zero events, every source available */
  const empty = world((url) => {
    if (url.hostname === 'api.weather.gov') return json({ features: [] });
    if (url.hostname === 'eonet.gsfc.nasa.gov') return json({ events: [] });
    if (url.hostname === 'earthquake.usgs.gov') return json({ metadata: { generated: Date.now() }, features: [] });
    if (url.hostname === 'www.nhc.noaa.gov') return json({ activeStorms: [] });
    throw new Error('unexpected ' + url);
  });
  const r = await handleWorldEnvironment(req(P), ENV, { fetchImpl: empty, cacheImpl: memoryCache() });
  assert.equal(r.status, 200); const feed = await r.json();
  assert.deepEqual([feed.events.length, feed.sources.every((s) => s.status === 'available')], [0, true]);
  assert.equal(empty.policyReads(), 1, 'one policy read for the feed');
  const layer = await handleWorldEnvironment(req(`${P}/layers/eonet`), ENV, { fetchImpl: world(() => json({ events: [] })), cacheImpl: memoryCache() });
  const lb = await layer.json();
  assert.deepEqual([layer.status, lb.count, lb.sources[0].status], [200, 0, 'available'], 'a layer with nothing to report is 200, zero items, its source available');
  /* the refusal a failed read stands for */
  assert.equal(refusalOf(Object.assign(new Error('x'), { sqlstate: 'EUM01', reason: 'module_not_installed' })), OFF);
  assert.equal(refusalOf(Object.assign(new Error('x'), { sqlstate: '42883', reason: 'module_not_installed' })), OUTAGE, 'a missing function is the schema, not the owner');
  assert.equal(refusalOf(Object.assign(new Error('x'), { reason: 'module_not_installed' })), OUTAGE, 'without the store\'s own code, never off');
  assert.equal(refusalOf(null), OUTAGE);
});

test('SEC-2: concurrent misses for one uncached layer share ONE provider request (40 made 40 before)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const f = world(async (url) => { if (url.hostname !== 'eonet.gsfc.nasa.gov') throw new Error('unexpected ' + url); await gate; return json(EONET); });
  const cache = memoryCache();
  const pending = Array.from({ length: 40 }, () => handleWorldEnvironment(req(`${P}/layers/eonet`), ENV, { fetchImpl: f, cacheImpl: cache }));
  await tick(20);
  release();
  const answers = await Promise.all(pending);
  assert.ok(answers.every((r) => r.status === 200));
  const bodies = await Promise.all(answers.map((r) => r.json()));
  assert.ok(bodies.every((b) => b.count === 1 && b.sources[0].status === 'available'), 'every visitor got the one answer');
  assert.equal(f.providerCalls().length, 1, `provider requests: ${f.providerCalls().length}`);
  assert.equal(flightCount(f, cache), 0, 'nothing is left in flight');
  /* and once kept, a later request asks nobody */
  await handleWorldEnvironment(req(`${P}/layers/eonet`), ENV, { fetchImpl: f, cacheImpl: cache });
  assert.equal(f.providerCalls().length, 1);
});

test('SEC-2: the feed\'s four providers are shared the same way: 30 concurrent feed reads ask each provider once', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const f = world(async (url) => {
    await gate;
    if (url.hostname === 'api.weather.gov') return json({ features: [] });
    if (url.hostname === 'eonet.gsfc.nasa.gov') return json({ events: [] });
    if (url.hostname === 'earthquake.usgs.gov') return json({ metadata: { generated: Date.now() }, features: [] });
    if (url.hostname === 'www.nhc.noaa.gov') return json({ activeStorms: [] });
    throw new Error('unexpected ' + url);
  });
  const cache = memoryCache();
  const pending = Array.from({ length: 30 }, () => handleWorldEnvironment(req(P), ENV, { fetchImpl: f, cacheImpl: cache }));
  await tick(20); release();
  const answers = await Promise.all(pending);
  assert.ok(answers.every((r) => r.status === 200));
  assert.equal(f.providerCalls().length, 4, `provider requests: ${f.providerCalls().length}`);
});

test('SEC-2: a waiter whose leader never answers asks on its own after its wait, so a cancelled request strands nobody', async () => {
  const cache = memoryCache();
  let calls = 0;
  const fetchImpl = async () => { throw new Error('no fetch'); };
  const spec = { layer: 'probe', key: 'guard-test-probe', ttl: 60, rows: 'rows', fetcher: () => { calls += 1; return calls === 1 ? new Promise(() => {}) : Promise.resolve({ rows: [1] }); } };
  const leader = sharedLayer(spec, {}, fetchImpl, cache);
  await tick(5);
  const waiter = await sharedLayer(spec, {}, fetchImpl, cache, { waitMs: 30 });
  assert.deepEqual([waiter.body.rows, calls], [[1], 2], 'the waiter fetched for itself');
  void leader;
});

test('SEC-2: at most MAX_LOOKUP_FLIGHTS distinct on-demand lookups are fetched at once; past that the kept copy or unavailable, never another provider request', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const f = world(async (url) => { if (url.hostname !== 'earthquake.usgs.gov') throw new Error('unexpected ' + url); await gate; return json({}, 404); });
  const cache = memoryCache();
  const ids = Array.from({ length: MAX_LOOKUP_FLIGHTS + 10 }, (_, i) => `us${String(7000000 + i)}`);
  const pending = ids.map((id) => handleWorldEnvironment(req(`${P}/quakes/${id}/shakemap`), ENV, { fetchImpl: f, cacheImpl: cache, limits: null }));
  await tick(20);
  assert.equal(f.providerCalls().length, MAX_LOOKUP_FLIGHTS, `in flight: ${f.providerCalls().length}`);
  release();
  const bodies = await Promise.all((await Promise.all(pending)).map((r) => r.json()));
  assert.equal(bodies.filter((b) => b.reason === 'event_not_found').length, MAX_LOOKUP_FLIGHTS, 'the lookups asked: USGS\'s own 404');
  assert.equal(bodies.filter((b) => b.reason === 'source_unavailable' && b.sources[0].status === 'unavailable').length, 10, 'the rest: unavailable, nobody asked');
  assert.equal(f.providerCalls().length, MAX_LOOKUP_FLIGHTS);
});

test('SEC-2: a cheap per-client limit: 429 rate_limited with retry-after past the public reads\' share, per client, never without an address, never on private routes', async () => {
  let now = 0;
  const limits = createPublicReadLimits({ now: () => now });
  const f = world(() => json(EONET));
  const cache = memoryCache();
  const ask = (path, ip, extra = {}) => handleWorldEnvironment(req(path, { ip, ...extra }), ENV, { fetchImpl: f, cacheImpl: cache, limits });
  for (let i = 0; i < PUBLIC_READ_LIMITS.reads.capacity; i++) assert.equal((await ask(`${P}/layers/eonet`, '203.0.113.7')).status, 200, `read ${i}`);
  const refused = await ask(`${P}/layers/eonet`, '203.0.113.7');
  assert.equal(refused.status, 429); assert.deepEqual(await refused.json(), { ok: false, code: 'rate_limited' });
  assert.equal(refused.headers.get('retry-after'), '1'); assert.equal(refused.headers.get('cache-control'), 'private, no-store');
  const reads = f.policyReads();
  assert.equal((await ask(`${P}/layers/eonet`, '203.0.113.7')).status, 429);
  assert.equal(f.policyReads(), reads, 'a refused request reads nothing, not even the policy');
  assert.equal((await ask(`${P}/layers/eonet`, '198.51.100.4')).status, 200, 'another client has its own share');
  assert.equal((await ask(`${P}/layers/eonet`, null)).status, 200, 'no client address (tests, local tools): not limited');
  now += 1000;
  assert.equal((await ask(`${P}/layers/eonet`, '203.0.113.7')).status, 200, 'refilled at two a second');
  /* the on-demand lookups have their own, tighter share */
  const look = world(() => json({}, 404));
  const lookups = createPublicReadLimits({ now: () => now });
  let ok = 0;
  for (let i = 0; i < PUBLIC_READ_LIMITS.lookups.capacity + 5; i++) {
    const r = await handleWorldEnvironment(req(`${P}/quakes/us${7000000 + i}/shakemap`, { ip: '2001:db8:1:2:3:4:5:6' }), ENV, { fetchImpl: look, cacheImpl: memoryCache(), limits: lookups });
    if (r.status === 200) ok += 1; else { assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '2'); }
  }
  assert.equal(ok, PUBLIC_READ_LIMITS.lookups.capacity);
  const same64 = await handleWorldEnvironment(req(`${P}/quakes/us7999999/shakemap`, { ip: '2001:db8:1:2:ffff::1' }), ENV, { fetchImpl: look, cacheImpl: memoryCache(), limits: lookups });
  assert.equal(same64.status, 429, 'an IPv6 client is limited by its /64');
  /* private routes are never limited here */
  const busy = createPublicReadLimits({ now: () => now });
  for (let i = 0; i < 200; i++) busy.reads.take('192.0.2.1');
  const team = await handleWorldEnvironment(req(`${P}/team`, { ip: '192.0.2.1', auth: true }), ENV, { fetchImpl: world(() => json({})), cacheImpl: memoryCache(), limits: busy });
  assert.notEqual(team.status, 429);
});

test('the limiter forgets the least recently seen client first and keys IPv6 by its /64', () => {
  const l = createRateLimiter({ capacity: 1, perSecond: 1, maxClients: 2, now: () => 0 });
  assert.equal(l.take('a'), 0); assert.equal(l.take('b'), 0); assert.equal(l.take('a'), 1);
  assert.equal(l.take('c'), 0); assert.equal(l.size(), 2);
  assert.equal(l.take('b'), 0, 'b was forgotten, so it starts full again');
  assert.equal(clientKey('203.0.113.7'), '203.0.113.7');
  assert.equal(clientKey('2001:DB8:0001:0002:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(clientKey('2001:db8:1:2::1'), '2001:db8:1:2::/64');
  assert.equal(clientKey('2001:db8::1'), '2001:db8:0:0::/64');
  for (const bad of ['', null, 'not an address', '1.2.3', '2001:db8::1::2', 'x'.repeat(80)]) assert.equal(clientKey(bad), null, String(bad));
});

test('SEC-2: the water-level crawl ends on time: with every NOAA request hanging, GET /layers/tides answers within its deadline, unasked stations unavailable (timeout)', { timeout: 20000 }, async () => {
  const f = world((url, init) => {
    if (url.pathname === '/mdapi/prod/webapi/stations.json') return json({ stations: [] });
    return new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  });
  const t0 = Date.now();
  const r = await handleWorldEnvironment(req(`${P}/layers/tides`), ENV, { fetchImpl: f, cacheImpl: memoryCache(), tideGapMs: 0, tideDeadlineMs: 300 });
  const elapsed = Date.now() - t0, b = await r.json();
  assert.equal(r.status, 200);
  assert.ok(elapsed < 4000, `answered in ${elapsed} ms (81 s before the deadline)`);
  assert.ok(TIDES_PUBLIC.latestDeadlineMs < 20000, 'the default deadline is under the browser client\'s 20 s');
  const asked = f.providerCalls().filter((u) => u.includes('date=latest')).length;
  assert.ok(asked <= TIDES_PUBLIC.concurrency, `stations asked: ${asked}`);
  assert.equal(b.latest.answered, 0); assert.equal(b.latest.readings.length, TIDE_LATEST_STATIONS.length);
  assert.deepEqual(b.sources.find((s) => s.id === 'coops_latest').reason, 'timeout');
});

test('E6: the USGS source\'s latest observation is the newest quake\'s origin time, never the summary feed\'s generation time', async () => {
  const generated = Date.parse('2026-11-19T02:00:00Z'), newest = Date.now() - 120e3, older = Date.now() - 3600e3;
  const f = world((url) => {
    if (url.hostname === 'earthquake.usgs.gov') return json({ metadata: { generated }, features: [
      { id: 'us1', geometry: { coordinates: [-72, 41, 10] }, properties: { place: 'Older', time: older, mag: 3.1, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1' } },
      { id: 'us2', geometry: { coordinates: [-73, 42, 10] }, properties: { place: 'Newest', time: newest, mag: 4.2, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us2' } }] });
    if (url.hostname === 'api.weather.gov') return json({ features: [] });
    if (url.hostname === 'eonet.gsfc.nasa.gov') return json({ events: [] });
    if (url.hostname === 'www.nhc.noaa.gov') return json({ activeStorms: [] });
    throw new Error('unexpected ' + url);
  });
  const feed = await environmentFeed(ENV, { fetchImpl: f, cacheImpl: memoryCache() });
  const usgs = feed.sources.find((s) => s.id === 'usgs');
  assert.equal(usgs.observed_at, new Date(newest).toISOString());
  assert.notEqual(usgs.observed_at, new Date(generated).toISOString());
  const none = await environmentFeed(ENV, { fetchImpl: world((url) => (url.hostname === 'earthquake.usgs.gov' ? json({ metadata: { generated }, features: [] }) : url.hostname === 'eonet.gsfc.nasa.gov' ? json({ events: [] }) : url.hostname === 'www.nhc.noaa.gov' ? json({ activeStorms: [] }) : json({ features: [] }))), cacheImpl: memoryCache() });
  assert.equal(none.sources.find((s) => s.id === 'usgs').observed_at, null, 'no quake served: no latest observation, never the generation time');
});
