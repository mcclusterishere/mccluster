/* Per-source health on GET /v1/world/environment (additive fields beside the pinned
   product's own source fields) and the shared helpers that make it: healthReason,
   sourceHealth and trackedLayer (./src/world-layers.js). Fake fetch and an in-memory
   cache only; the offline guard refuses anything else. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentFeed, FEED_SOURCE_TERMS } from '../src/world-environment.js';
import { healthReason, sourceHealth, trackedLayer, HEALTH_REASONS } from '../src/world-layers.js';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function memoryCache() {
  const raw = new Map();
  return { raw, async match(k) { return raw.has(k.url) ? new Response(raw.get(k.url)) : undefined; }, async put(k, r) { raw.set(k.url, await r.text()); } };
}
/* move every kept answer's fetched_at back by `seconds` (the last-success records have none) */
function age(cache, seconds) {
  for (const [k, v] of cache.raw) {
    const b = JSON.parse(v);
    if (typeof b.fetched_at !== 'string') continue;
    b.fetched_at = new Date(Date.parse(b.fetched_at) - seconds * 1000).toISOString();
    cache.raw.set(k, JSON.stringify(b));
  }
}
function providers(url) {
  const u = String(url);
  if (u.startsWith('https://api.weather.gov')) return json({ features: [] });
  if (u.startsWith('https://eonet.gsfc.nasa.gov')) return json({ events: [] });
  if (u.startsWith('https://earthquake.usgs.gov')) return json({ metadata: { generated: Date.now() }, features: [] });
  if (u.startsWith('https://www.nhc.noaa.gov')) return json({ activeStorms: [] });
  throw new Error('unexpected ' + u);
}
const FIELDS = ['id', 'label', 'url', 'status', 'fetched_at', 'observed_at', 'coverage', 'stale', 'reason', 'last_success_at', 'attribution', 'license'];

test('reasons are the four documented values; provider codes map onto them and nothing else leaks', () => {
  assert.deepEqual(HEALTH_REASONS, ['not_configured', 'timeout', 'upstream_error', 'invalid_data']);
  assert.equal(healthReason(null), null); assert.equal(healthReason(''), null);
  assert.equal(healthReason('not_configured'), 'not_configured');
  assert.equal(healthReason('upstream_timeout'), 'timeout');
  for (const code of ['upstream_http', 'upstream_rate_limited', 'upstream_network', 'upstream_redirect', 'upstream_error', 'upstream_no_data', 'upstream_error_payload', 'anything else']) assert.equal(healthReason(code), 'upstream_error', code);
  for (const code of ['upstream_invalid_json', 'upstream_invalid_csv', 'upstream_invalid_station', 'upstream_empty', 'upstream_too_large']) assert.equal(healthReason(code), 'invalid_data', code);
});

test('sourceHealth: available, stale and unavailable records carry exactly the documented fields', () => {
  const source = { id: 'x', label: 'X', url: 'https://x.example/', coverage: 'c', attribution: 'a', license: 'l' };
  const when = '2026-11-17T10:00:00.000Z';
  assert.deepEqual(sourceHealth(source, { body: { fetched_at: when }, stale: false }),
    { id: 'x', label: 'X', status: 'available', reason: null, fetched_at: when, last_success_at: when, coverage: 'c', attribution: 'a', license: 'l', url: 'https://x.example/' });
  assert.deepEqual(sourceHealth(source, { body: { fetched_at: when, upstream_error: 'upstream_timeout' }, stale: true }).status, 'stale');
  assert.equal(sourceHealth(source, { body: { fetched_at: when, upstream_error: 'upstream_timeout' }, stale: true }).reason, 'timeout');
  const gone = sourceHealth(source, { body: { unavailable: true, fetched_at: null, upstream_error: 'upstream_http' }, stale: false, last_success_at: when });
  assert.deepEqual([gone.status, gone.reason, gone.fetched_at, gone.last_success_at], ['unavailable', 'upstream_error', null, when]);
  assert.equal(sourceHealth(source, undefined).status, 'unavailable');
  assert.equal(sourceHealth(source, { body: { fetched_at: 'not a time' } }).fetched_at, null, 'a time that does not parse is null, never invented');
});

test('the feed keeps every pinned source field and adds reason, last success, attribution and licence', async () => {
  const f = await environmentFeed(env, { fetchImpl: providers, cacheImpl: memoryCache() });
  assert.deepEqual(f.sources.map((s) => s.id), ['nws', 'eonet', 'usgs', 'nhc']);
  for (const s of f.sources) {
    assert.deepEqual(Object.keys(s).sort(), [...FIELDS].sort(), s.id);
    assert.equal(s.status, 'available'); assert.equal(s.reason, null); assert.equal(s.stale, false);
    assert.ok(Date.parse(s.fetched_at)); assert.equal(s.last_success_at, s.fetched_at);
    assert.equal(s.attribution, FEED_SOURCE_TERMS[s.id].attribution); assert.equal(s.license, FEED_SOURCE_TERMS[s.id].license);
  }
});

test('a provider answering 500 is unavailable with reason upstream_error; a kept copy is served stale with its own fetch time', async () => {
  const down = async () => json({ message: 'boom' }, 500);
  const none = await environmentFeed(env, { fetchImpl: down, cacheImpl: memoryCache() });
  for (const s of none.sources) assert.deepEqual([s.status, s.reason, s.fetched_at, s.last_success_at], ['unavailable', 'upstream_error', null, null], s.id);
  const cache = memoryCache();
  const good = await environmentFeed(env, { fetchImpl: providers, cacheImpl: cache });
  age(cache, 3600);
  const stale = await environmentFeed(env, { fetchImpl: down, cacheImpl: cache });
  for (const s of stale.sources) {
    const before = good.sources.find((g) => g.id === s.id);
    assert.equal(s.status, 'stale', s.id); assert.equal(s.reason, 'upstream_error');
    assert.equal(s.fetched_at, new Date(Date.parse(before.fetched_at) - 3600e3).toISOString(), 'the copy keeps the time it was retrieved');
    assert.equal(s.last_success_at, s.fetched_at);
  }
});

test('a timeout is reason timeout; once the kept copy has expired the last success is still reported', async () => {
  const timeout = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  const cache = memoryCache();
  const good = await environmentFeed(env, { fetchImpl: providers, cacheImpl: cache });
  age(cache, 8 * 3600);
  const late = await environmentFeed(env, { fetchImpl: timeout, cacheImpl: cache });
  for (const s of late.sources) {
    const before = good.sources.find((g) => g.id === s.id);
    assert.deepEqual([s.status, s.reason, s.fetched_at], ['unavailable', 'timeout', null], s.id);
    assert.equal(s.last_success_at, before.fetched_at, 'the last success outlives the copy it came from');
  }
});

test('trackedLayer writes the last success only on a fresh retrieval and never stores a failure', async () => {
  const cache = memoryCache();
  let calls = 0;
  const spec = { layer: 'demo', key: 'consumer-environment-v1-demo', ttl: 60, rows: 'items', fetcher: async () => { calls += 1; return { items: [1] }; } };
  const first = await trackedLayer(spec, env, null, cache);
  assert.equal(first.last_success_at, first.body.fetched_at); assert.equal(calls, 1);
  const marker = JSON.parse(cache.raw.get('https://cache.mccluster.internal/world/health/consumer-environment-v1-demo'));
  assert.deepEqual(marker, { last_success_at: first.body.fetched_at });
  const hit = await trackedLayer(spec, env, null, cache);
  assert.equal(calls, 1, 'a cache hit asks nobody'); assert.equal(hit.last_success_at, first.body.fetched_at);
  const empty = memoryCache();
  const failed = await trackedLayer({ ...spec, fetcher: async () => { throw Object.assign(new Error('x'), { code: 'upstream_http' }); } }, env, null, empty);
  assert.equal(failed.body.unavailable, true); assert.equal(failed.last_success_at, null); assert.equal(empty.raw.size, 0);
});
