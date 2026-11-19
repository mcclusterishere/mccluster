/* THE PUBLIC ENVIRONMENTAL EVENT TIMELINE (./src/world-environment-events.js; E=UP event timeline slice S4, 2026-11-19,
   docs/control-plane/EUP-EVENT-TIMELINE.md). Fake fetch and an in-memory cache only (the offline guard refuses anything else);
   the same routes over the REAL pending store SQL in PGlite are scripts/test/eup-environment-timeline.integration.mjs.
     - the gate runs first, with the feed's and the layers' answers, and no store read while it refuses;
     - only whitelisted fields leave, for a published event and for a tombstone; a news (non-government) row never does;
     - aliases answer the canonical event with redirected_from; not found and not available are 404;
     - store reads are kept at the edge at most 60 s and shared by concurrent requests; a refusal is never kept;
     - the public feed's USGS rows come from the store (canonical ids, revisions), never from USGS's live feed, and a store that
       cannot be read makes the USGS source unavailable with its reason;
     - static: the public handlers import nothing from intel/, the news pairing or the Halo modules beyond the named shared
       provider helpers they already used, and the timeline module nothing but one response helper. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleWorldEnvironment, environmentFeed } from '../src/world-environment.js';
import { createPublicReadLimits, limitPublicRead } from '../src/world-environment-guard.js';
import { environmentRouteForPath } from '../../../packages/release-policy/globe.mjs';
/* imported softly, so this file loads against the code before slice S4 too (the proof that these tests fail without it) */
const S4 = await import('../src/world-environment-events.js').catch(() => ({}));
const { EVENTS_CACHE_SECONDS, publicEvent, publicPage, storeUsgsReader } = S4;

const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret', ALLOWED_ORIGINS: 'https://mccluster.org' };
const P = '/v1/world/environment';
const POLICY_RPC = '/rest/v1/rpc/eup_module_policy_read';
const PAGE_RPC = '/rest/v1/rpc/eup_environment_public_events';
const EVENT_RPC = '/rest/v1/rpc/eup_environment_public_event';
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const policyOf = (state = 'enabled', revision = 3) => ({ schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId: 'environment', state, revision });
const req = (path, { method = 'GET', ip = null } = {}) => new Request(`https://api.mccluster.org${path}`, { method, headers: { origin: 'https://mccluster.org', ...(ip ? { 'cf-connecting-ip': ip } : {}) } });
function memoryCache() {
  const raw = new Map();
  return { raw, async match(k) { return raw.has(k.url) ? new Response(raw.get(k.url)) : undefined; }, async put(k, r) { raw.set(k.url, await r.text()); } };
}
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.parse('2026-11-19T09:00:00Z');

/* the store's own public projection of one event, as part 02's eup_environment_project builds it, plus whatever a careless store
   might add (the extras must never leave) */
function published(id, over = {}) {
  return {
    id, revision: 2, provider: id.split(':')[0], kind: 'quake', state: 'published', title: 'M 6.3 - 46 km SSE of Example, Japan', place: '46 km SSE of Example, Japan',
    magnitude: 6.3, magnitude_type: 'mww', depth_km: 35.2, lon: 142.4, lat: 38.1, observed_at: iso(NOW - 3600e3), review_status: 'reviewed', tsunami: true, alert: 'yellow',
    source: { id: id.split(':')[1], url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id.split(':')[1]}`, updated_at: iso(NOW - 1800e3), fetched_at: iso(NOW - 600e3) },
    first_published_at: iso(NOW - 3000e3), revised_at: iso(NOW - 1200e3),
    correction: { revision: 2, cause: 'source_revised', changes: { magnitude: { from: 6.6, to: 6.3 }, magnitude_type: { from: 'mi', to: 'mww' }, location: { from: [142.1, 38.3], to: [142.4, 38.1], km: 34.2 } }, recorded_at: iso(NOW - 1200e3) },
    news_coverage: [], ...over
  };
}
function tombstone(id, over = {}) {
  return { id, revision: 2, provider: 'usgs', kind: 'quake', state: 'withdrawn_by_source', title: 'M 3.8 - 12 km W of Example, Alaska', place: '12 km W of Example, Alaska', magnitude: 3.8,
    magnitude_type: 'ml', observed_at: iso(NOW - 7200e3), source: { id: id.split(':')[1], url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id.split(':')[1]}` },
    first_published_at: iso(NOW - 7000e3), withdrawn_at: iso(NOW - 3000e3), retracted_at: null, ...over };
}
const usgsSource = (over = {}) => ({ provider: 'usgs', status: 'ok', checked_at: iso(NOW - 120e3), last_success_at: iso(NOW - 120e3), ...over });
const page = (events, over = {}) => ({ schema: 'mccluster.environment-events/v1', events, next_cursor: null, sources: [usgsSource()], ...over });

/* the policy store, the event store and the providers; every call is logged */
function plane({ policy = () => json(policyOf()), pageAnswer = () => json(page([])), eventAnswer = () => json({ schema: 'mccluster.environment-event/v1', status: 'not_found', id: null, redirected_from: null, event: null }), providers = null } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} });
    if (u.endsWith(POLICY_RPC)) return policy();
    if (u.endsWith(PAGE_RPC)) return pageAnswer(init.body ? JSON.parse(init.body) : {});
    if (u.endsWith(EVENT_RPC)) return eventAnswer(init.body ? JSON.parse(init.body) : {});
    if (u.startsWith('https://db.example/')) return json([]);
    if (providers) return providers(new URL(u));
    throw new Error('no provider expected: ' + u);
  };
  impl.calls = calls;
  impl.storeReads = () => calls.filter((c) => c.url.endsWith(PAGE_RPC) || c.url.endsWith(EVENT_RPC));
  impl.policyReads = () => calls.filter((c) => c.url.endsWith(POLICY_RPC)).length;
  impl.providerCalls = () => calls.filter((c) => !c.url.startsWith('https://db.example/'));
  return impl;
}
const get = async (path, f, cache = memoryCache(), now = () => NOW) => {
  const r = await handleWorldEnvironment(req(path), ENV, { fetchImpl: f, cacheImpl: cache, limits: null, now });
  return { status: r.status, body: await r.json(), headers: r.headers };
};

test('the timeline answers behind the module gate: off and an outage are the feed\'s own answers, with no store read', async () => {
  assert.equal(typeof S4.handleEnvironmentEvents, 'function', 'workers/mccluster/src/world-environment-events.js exists');
  const cases = [
    ['off: never installed (EUM01)', () => json({ code: 'EUM01', message: 'module_not_installed' }, 400), 404, { ok: false, code: 'module_disabled' }],
    ['off: installed and disabled', () => json(policyOf('disabled', 1)), 404, { ok: false, code: 'module_disabled' }],
    ['outage: the policy store answers 500', () => json({ message: 'boom' }, 500), 503, { ok: false, code: 'module_policy_unavailable' }],
    ['outage: the policy store unreachable', () => { throw new Error('offline'); }, 503, { ok: false, code: 'module_policy_unavailable' }],
    ['outage: a policy function missing (42883)', () => json({ code: '42883', message: 'function does not exist' }, 404), 503, { ok: false, code: 'module_policy_unavailable' }]
  ];
  for (const [label, policy, status, body] of cases) {
    for (const path of [`${P}/events`, `${P}/events/usgs:us6000u3jl`]) {
      const f = plane({ policy });
      const r = await get(path, f);
      assert.equal(r.status, status, `${label} ${path}`); assert.deepEqual(r.body, body, `${label} ${path}`);
      assert.equal(f.policyReads(), 1, `${label}: one policy read`); assert.equal(f.storeReads().length, 0, `${label}: the store is never asked`);
      assert.equal(r.headers.get('cache-control'), 'private, no-store');
    }
  }
  /* draining still answers reads */
  const draining = await get(`${P}/events`, plane({ policy: () => json(policyOf('draining', 4)) }));
  assert.equal(draining.status, 200);
  /* the routes are GET only, after the gate */
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
    const f = plane();
    const r = await handleWorldEnvironment(req(`${P}/events`, { method }), ENV, { fetchImpl: f, cacheImpl: memoryCache(), limits: null });
    assert.equal(r.status, 405, method); assert.equal(f.storeReads().length, 0);
  }
});

test('a page leaves with whitelisted fields only, for a published event and a tombstone; a news row and anything malformed never leave', async () => {
  const extras = { significance: 912, held_at: null, decided_by: '00000000-0000-4000-8000-000000000001', created_by: 'someone', actor: 'owner', snapshot: { secret: 1 }, reason: 'owner note', aliases: ['us1'], email: 'x' };
  const store = page([
    { ...published('usgs:us6000u3jl'), ...extras, source: { ...published('usgs:us6000u3jl').source, token: 'k' } },
    { ...tombstone('usgs:aka2026wpvhsf'), ...extras, lat: 61.2, lon: -149.9, depth_km: 8, news_coverage: [{ title: 'x', url: 'https://news.example/a', basis: 'official_identifier' }] },
    { ...published('gdelt:123'), provider: 'gdelt' },
    { ...published('news:abc'), provider: 'news' },
    { ...published('usgs:held1'), state: 'held' },
    { ...published('usgs:cand1'), state: 'candidate' },
    { ...published('usgs:merged1'), state: 'merged' },
    { ...published('usgs:bad1'), provider: 'nws' },
    { ...published('usgs:bad2'), revision: 0 },
    { ...published('usgs:dup1') }, { ...published('usgs:dup1'), title: 'second copy' },
    'not an object', null
  ], { sources: [usgsSource({ secret: 'x' }), { provider: 'gdelt', status: 'ok' }, { provider: 'nws', status: 'weird', checked_at: 'yesterday' }], next_cursor: 'DROP TABLE' });
  const f = plane({ pageAnswer: () => json(store) });
  const r = await get(`${P}/events?limit=20`, f);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['events', 'next_cursor', 'ok', 'query', 'schema', 'sources']);
  assert.deepEqual(r.body.events.map((e) => e.id), ['usgs:us6000u3jl', 'usgs:aka2026wpvhsf', 'usgs:dup1'], 'only government providers, only published or tombstoned, each once');
  const [pub, tomb] = r.body.events;
  assert.deepEqual(Object.keys(pub).sort(), ['alert', 'correction', 'depth_km', 'first_published_at', 'id', 'kind', 'lat', 'lon', 'magnitude', 'magnitude_type', 'news_coverage', 'observed_at', 'place', 'provider', 'review_status', 'revised_at', 'revision', 'source', 'state', 'title', 'tsunami']);
  assert.deepEqual(Object.keys(pub.source).sort(), ['fetched_at', 'id', 'updated_at', 'url']);
  assert.deepEqual(pub.correction, { revision: 2, cause: 'source_revised', changes: { location: { from: [142.1, 38.3], to: [142.4, 38.1], km: 34.2 }, magnitude: { from: 6.6, to: 6.3 }, magnitude_type: { from: 'mi', to: 'mww' } }, recorded_at: iso(NOW - 1200e3) });
  assert.deepEqual(Object.keys(tomb).sort(), ['first_published_at', 'id', 'kind', 'magnitude', 'magnitude_type', 'observed_at', 'place', 'provider', 'retracted_at', 'revision', 'source', 'state', 'title', 'withdrawn_at'], 'a tombstone carries no coordinates, depth or coverage');
  assert.deepEqual(Object.keys(tomb.source).sort(), ['id', 'url']);
  assert.equal(tomb.withdrawn_at, iso(NOW - 3000e3));
  assert.deepEqual(r.body.sources, [{ provider: 'usgs', status: 'ok', checked_at: iso(NOW - 120e3), last_success_at: iso(NOW - 120e3) }, { provider: 'nws', status: null, checked_at: null, last_success_at: null }]);
  assert.equal(r.body.next_cursor, null, 'a cursor the store did not shape is never passed on');
  const text = JSON.stringify(r.body);
  for (const leak of ['912', 'decided_by', 'created_by', 'owner note', 'secret', 'token', 'aliases', 'email', 'gdelt', 'held1', 'cand1', 'merged1']) assert.ok(!text.includes(leak), `nothing of "${leak}" leaves`);
  assert.equal(f.storeReads()[0].headers.authorization, 'Bearer server-secret', 'the store is read with the service key, server side');
});

test('whitelisting, value by value: off-host source links, plain-http coverage and unknown change fields are dropped', () => {
  assert.equal(typeof publicEvent, 'function');
  const e = publicEvent({ ...published('usgs:us7000abcd'), source: { id: 'us7000abcd', url: 'https://evil.example/eventpage/us7000abcd', updated_at: 'not a time', fetched_at: iso(NOW) },
    news_coverage: [{ title: 'A report', url: 'http://news.example/a', basis: 'official_identifier' }, { title: 'Another', url: 'https://news.example/b', domain: 'news.example', seen_at: iso(NOW), basis: 'type_place_time', decided_at: iso(NOW), event_revision: 2, note: 'x' }, { title: 'GDELT point', url: 'https://news.example/c', basis: 'gdelt_point' }],
    correction: { revision: 2, cause: 'owner_note', changes: {} }, alert: 'purple', review_status: 'deleted', magnitude: 99, lon: 200, lat: 10 });
  assert.equal(e.source.url, null); assert.equal(e.source.updated_at, null);
  assert.deepEqual(e.news_coverage, [{ title: 'Another', url: 'https://news.example/b', domain: 'news.example', seen_at: iso(NOW), basis: 'type_place_time', decided_at: iso(NOW), event_revision: 2 }]);
  assert.equal(e.correction, null, 'only the four public causes'); assert.equal(e.alert, null); assert.equal(e.review_status, null); assert.equal(e.magnitude, null);
  assert.deepEqual([e.lon, e.lat], [null, null], 'a position off the Earth is no position, never half of one');
  const withHistory = publicEvent({ ...published('usgs:us7000abcd'), history: [{ revision: 2, cause: 'source_revised', changes: { depth_km: { from: 10, to: 35.2 }, made_up: { from: 1, to: 2 } }, recorded_at: iso(NOW) }, { revision: 1, cause: 'owner_hold' }] }, { history: true });
  assert.deepEqual(withHistory.history, [{ revision: 2, cause: 'source_revised', changes: { depth_km: { from: 10, to: 35.2 } }, recorded_at: iso(NOW) }]);
  assert.equal(publicPage({ schema: 'something else', events: [], sources: [] }), null, 'not the store\'s page: unreadable');
});

test('a deep link: an alias answers the canonical event with redirected_from; a tombstone answers 200; not found and not available are 404', async () => {
  const answers = {
    'usgs:us6000u3jl': { schema: 'mccluster.environment-event/v1', status: 'published', id: 'usgs:attn6uqd', redirected_from: 'usgs:us6000u3jl', event: { ...published('usgs:attn6uqd'), history: [{ revision: 2, cause: 'source_revised', changes: { magnitude: { from: 6.6, to: 6.3 } }, recorded_at: iso(NOW - 1200e3) }] } },
    'usgs:aka2026wpvhsf': { schema: 'mccluster.environment-event/v1', status: 'withdrawn_by_source', id: 'usgs:aka2026wpvhsf', redirected_from: null, event: { ...tombstone('usgs:aka2026wpvhsf'), history: [{ revision: 2, cause: 'source_deleted', changes: {}, recorded_at: iso(NOW - 3000e3) }] } },
    'usgs:held1': { schema: 'mccluster.environment-event/v1', status: 'not_available', id: 'usgs:held1', redirected_from: null, event: null },
    'usgs:nothere': { schema: 'mccluster.environment-event/v1', status: 'not_found', id: 'usgs:nothere', redirected_from: null, event: null }
  };
  const f = plane({ eventAnswer: (args) => json(answers[args.p_id]) });
  const alias = await get(`${P}/events/usgs:us6000u3jl`, f);
  assert.equal(alias.status, 200);
  assert.deepEqual([alias.body.ok, alias.body.status, alias.body.id, alias.body.redirected_from, alias.body.event.id], [true, 'published', 'usgs:attn6uqd', 'usgs:us6000u3jl', 'usgs:attn6uqd']);
  assert.deepEqual(alias.body.event.history, [{ revision: 2, cause: 'source_revised', changes: { magnitude: { from: 6.6, to: 6.3 } }, recorded_at: iso(NOW - 1200e3) }]);
  const tomb = await get(`${P}/events/${encodeURIComponent('usgs:aka2026wpvhsf')}`, f);
  assert.equal(tomb.status, 200); assert.equal(tomb.body.event.state, 'withdrawn_by_source'); assert.equal('lat' in tomb.body.event, false);
  const held = await get(`${P}/events/usgs:held1`, f);
  assert.equal(held.status, 404); assert.deepEqual([held.body.ok, held.body.code, held.body.event], [false, 'not_available', null]);
  const none = await get(`${P}/events/usgs:nothere`, f);
  assert.equal(none.status, 404); assert.deepEqual([none.body.ok, none.body.code], [false, 'not_found']);
  /* an id that is no event id is refused before the store */
  const before = f.storeReads().length;
  for (const bad of ['gdelt:1', 'usgs:', 'usgs:a/b', 'nothing', '%E0%A4%A']) {
    const r = await get(`${P}/events/${bad}`, f);
    assert.ok(r.status === 400 || r.status === 404, bad);
  }
  assert.equal(f.storeReads().length, before, 'no store read for an invalid id');
  const nested = await get(`${P}/events/usgs:us1/extra`, f);
  assert.equal(nested.status, 404);
});

test('a refusing or failing store says so, and nothing is kept: the next request asks again', async () => {
  const cases = [
    ['the store\'s SQL not applied (PGRST202)', () => json({ code: 'PGRST202', message: 'Could not find the function' }, 404), 503, { ok: false, code: 'events_unavailable', reason: 'store_not_applied' }],
    ['a function missing (42883)', () => json({ code: '42883', message: 'x' }, 404), 503, { ok: false, code: 'events_unavailable', reason: 'store_not_applied' }],
    ['busy (55P03)', () => json({ code: '55P03', message: 'lock' }, 500), 503, { ok: false, code: 'events_unavailable', reason: 'store_busy' }],
    ['an error the public is not told about', () => json({ code: 'XX000', message: 'internal detail' }, 500), 503, { ok: false, code: 'events_unavailable', reason: 'store_unavailable' }],
    ['unreachable', () => { throw new Error('offline'); }, 503, { ok: false, code: 'events_unavailable', reason: 'store_unavailable' }],
    ['a redirect', () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }), 503, { ok: false, code: 'events_unavailable', reason: 'store_unavailable' }],
    ['not JSON', () => new Response('<html>', { status: 200 }), 503, { ok: false, code: 'events_unavailable', reason: 'store_unavailable' }],
    ['not the page', () => json({ hello: 'world' }), 503, { ok: false, code: 'events_unavailable', reason: 'store_unavailable' }],
    ['the store\'s own gate: not installed (EUM01)', () => json({ code: 'EUM01', message: 'module_not_installed' }, 400), 404, { ok: false, code: 'module_disabled' }],
    ['the store\'s own gate: disabled (EUM03)', () => json({ code: 'EUM03', message: 'module_disabled' }, 400), 404, { ok: false, code: 'module_disabled' }],
    ['a window or cursor the store refuses (22023)', () => json({ code: '22023', message: 'invalid_cursor' }, 400), 400, { ok: false, code: 'invalid_request' }]
  ];
  for (const [label, pageAnswer, status, body] of cases) {
    const f = plane({ pageAnswer }), cache = memoryCache();
    const a = await get(`${P}/events`, f, cache), b = await get(`${P}/events`, f, cache);
    assert.equal(a.status, status, label); assert.deepEqual(a.body, body, label);
    assert.deepEqual([b.status, b.body], [status, body], label);
    assert.equal(f.storeReads().length, 2, `${label}: a refusal is never kept`);
    assert.equal(cache.raw.size, 0, label);
    assert.doesNotMatch(JSON.stringify(a.body), /internal detail|lock|Could not find|function/, label);
  }
});

test('store reads are kept at the edge at most 60 seconds and shared by concurrent requests', async () => {
  assert.equal(EVENTS_CACHE_SECONDS, 60);
  let release;
  const held = new Promise((r) => { release = r; });
  const f = plane({ pageAnswer: async () => { await held; return json(page([published('usgs:us6000u3jl')])); } });
  const cache = memoryCache();
  let t = NOW;
  const now = () => t;
  const burst = Array.from({ length: 20 }, () => get(`${P}/events`, f, cache, now));
  await new Promise((r) => setTimeout(r, 10)); release();
  const answers = await Promise.all(burst);
  assert.ok(answers.every((a) => a.status === 200 && a.body.events.length === 1));
  assert.equal(f.storeReads().length, 1, '20 concurrent requests, one store read');
  t = NOW + 59e3;
  await get(`${P}/events`, f, cache, now);
  assert.equal(f.storeReads().length, 1, 'kept within the minute');
  t = NOW + 61e3;
  await get(`${P}/events`, f, cache, now);
  assert.equal(f.storeReads().length, 2, 'asked again after the minute');
  /* each query is its own read; the gate is read on every request */
  await get(`${P}/events?limit=5`, f, cache, now);
  assert.equal(f.storeReads().length, 3);
  assert.equal(f.policyReads(), 23, 'the gate is never kept: 20 + 3 requests, 23 policy reads');
});

test('the query: ISO times with since before until, a cursor this route gave, a limit of 1 to 50; anything else 400 with no store read', async () => {
  const f = plane();
  for (const q of ['since=yesterday', 'until=2026-13-45T00:00:00Z', 'since=2026-11-19T00:00:00Z&until=2026-11-18T00:00:00Z', 'cursor=abc', 'cursor=1|gdelt:1', 'limit=0', 'limit=51', 'limit=abc']) {
    const r = await get(`${P}/events?${q}`, f);
    assert.equal(r.status, 400, q); assert.deepEqual(r.body, { ok: false, code: 'invalid_request' }, q);
  }
  assert.equal(f.storeReads().length, 0);
  const ok = await get(`${P}/events?since=2026-11-18T00:00:00Z&until=2026-11-19T00:00:00Z&cursor=${encodeURIComponent('1763510400000000|usgs:us6000u3jl')}&limit=5`, f);
  assert.equal(ok.status, 200);
  assert.deepEqual(f.storeReads()[0].body, { p_since: '2026-11-18T00:00:00.000Z', p_until: '2026-11-19T00:00:00.000Z', p_cursor: '1763510400000000|usgs:us6000u3jl', p_limit: 5 });
  assert.deepEqual(ok.body.query, { since: '2026-11-18T00:00:00.000Z', until: '2026-11-19T00:00:00.000Z', cursor: '1763510400000000|usgs:us6000u3jl', limit: 5 });
  await get(`${P}/events`, f);
  assert.equal(f.storeReads()[1].body.p_limit, 20, 'twenty by default');
});

test('the public feed\'s USGS rows come from the store: canonical ids and revisions, USGS itself never asked', async () => {
  const providers = (url) => {
    if (url.hostname === 'api.weather.gov') return json({ features: [] });
    if (url.hostname === 'eonet.gsfc.nasa.gov') return json({ events: [] });
    if (url.hostname === 'www.nhc.noaa.gov') return json({ activeStorms: [] });
    if (url.hostname === 'earthquake.usgs.gov') return json({ metadata: { generated: Date.now() }, features: [{ id: 'us6000u3jl', geometry: { coordinates: [142.4, 38.1, 35] }, properties: { place: 'live id', time: Date.now() - 600e3, mag: 6.3 } }] });
    throw new Error('unexpected ' + url);
  };
  const t = Date.now();
  const events = [published('usgs:attn6uqd', { observed_at: iso(t - 3600e3), revision: 6 }), tombstone('usgs:aka2026wpvhsf', { observed_at: iso(t - 1800e3) })];
  const f = plane({ providers, pageAnswer: () => json(page(events, { sources: [usgsSource({ checked_at: iso(t - 60e3), last_success_at: iso(t - 60e3) })] })) });
  const r = await handleWorldEnvironment(req(P), ENV, { fetchImpl: f, cacheImpl: memoryCache(), limits: null });
  assert.equal(r.status, 200);
  const feed = await r.json();
  const quakes = feed.events.filter((e) => e.source.id === 'usgs');
  assert.deepEqual(quakes.map((e) => [e.id, e.revision]), [['usgs:attn6uqd', 6]], 'the canonical id with its revision; the tombstone has no globe object');
  assert.match(quakes[0].title, /46 km SSE of Example/);
  assert.equal(f.providerCalls().filter((c) => c.url.includes('earthquake.usgs.gov')).length, 0, 'never a live read with a second id');
  const read = f.calls.find((c) => c.url.endsWith(PAGE_RPC));
  assert.equal(read.body.p_limit, 150); assert.equal(read.body.p_cursor, null); assert.ok(Date.parse(read.body.p_since) <= t - 86400e3 + 5000, 'the past day');
  const usgs = feed.sources.find((s) => s.id === 'usgs');
  assert.deepEqual([usgs.status, usgs.reason, usgs.fetched_at], ['available', null, iso(t - 60e3)]);
  assert.equal(usgs.observed_at, iso(t - 3600e3), 'E6 still: the newest quake served');
  /* the owner's live provider check reads USGS itself (./src/eup/environment/owner.js passes no reader) */
  const live = await environmentFeed(ENV, { fetchImpl: f, cacheImpl: memoryCache() });
  assert.deepEqual(live.events.filter((e) => e.source.id === 'usgs').map((e) => e.id), ['usgs:us6000u3jl']);
});

test('the feed\'s USGS source tells off, outage and no data apart from what the store says, never with a live fallback', async () => {
  assert.equal(typeof storeUsgsReader, 'function');
  const t = Date.now();
  const one = [published('usgs:us7000aaaa', { observed_at: iso(t - 3600e3) })];
  const cases = [
    ['store not applied', () => json({ code: 'PGRST202' }, 404), 'unavailable', 'store_not_applied', 0],
    ['store unreachable', () => { throw new Error('down'); }, 'unavailable', 'store_unavailable', 0],
    ['USGS not shown (no rule yet, or hidden)', () => json(page([], { sources: [] })), 'unavailable', 'not_shown', 0],
    ['shown, never read', () => json(page([], { sources: [usgsSource({ status: null, checked_at: null, last_success_at: null })] })), 'unavailable', 'no_reading', 0],
    ['read, nothing to report: no data', () => json(page([], { sources: [usgsSource({ status: 'empty', checked_at: iso(t - 60e3), last_success_at: iso(t - 60e3) })] })), 'available', null, 0],
    ['the last read failed: the earlier events, stale', () => json(page(one, { sources: [usgsSource({ status: 'unavailable', checked_at: iso(t - 60e3), last_success_at: iso(t - 3000e3) })] })), 'stale', 'upstream_error', 1],
    ['paused by the owner: stale', () => json(page(one, { sources: [usgsSource({ status: 'paused', checked_at: iso(t - 60e3) })] })), 'stale', 'paused', 1],
    ['no read for over 30 minutes: stale', () => json(page(one, { sources: [usgsSource({ checked_at: iso(t - 3600e3), last_success_at: iso(t - 3600e3) })] })), 'stale', 'not_recent', 1]
  ];
  for (const [label, pageAnswer, status, reason, quakes] of cases) {
    const f = plane({ pageAnswer, providers: (url) => { if (url.hostname === 'earthquake.usgs.gov') throw new Error('USGS must not be asked'); return url.hostname === 'eonet.gsfc.nasa.gov' ? json({ events: [] }) : url.hostname === 'www.nhc.noaa.gov' ? json({ activeStorms: [] }) : json({ features: [] }); } });
    const feed = await (await handleWorldEnvironment(req(P), ENV, { fetchImpl: f, cacheImpl: memoryCache(), limits: null })).json();
    const usgs = feed.sources.find((s) => s.id === 'usgs');
    assert.deepEqual([usgs.status, usgs.reason], [status, reason], label);
    assert.equal(feed.events.filter((e) => e.source.id === 'usgs').length, quakes, label);
    assert.equal(f.providerCalls().filter((c) => c.url.includes('earthquake.usgs.gov')).length, 0, label);
    if (status === 'stale') assert.ok(feed.events.filter((e) => e.source.id === 'usgs').every((e) => e.stale && e.actions.length === 0), `${label}: no actions on a stale quake`);
  }
});

test('a deep link\'s one event counts as an on-demand lookup in the per-client limit; the page as a read', () => {
  assert.deepEqual(environmentRouteForPath(`${P}/events`), { id: 'events', module: 'environment', param: null });
  assert.deepEqual(environmentRouteForPath(`${P}/events/usgs:us6000u3jl`), { id: 'event', module: 'environment', param: 'usgs:us6000u3jl' });
  assert.equal(environmentRouteForPath(`${P}/events/usgs:1/extra`), null);
  let t = 0;
  const limits = createPublicReadLimits({ now: () => t });
  for (let i = 0; i < 30; i++) assert.equal(limitPublicRead(req(`${P}/events/usgs:us${i}`, { ip: '198.51.100.7' }), ENV, limits), null, `lookup ${i}`);
  const refused = limitPublicRead(req(`${P}/events/usgs:us99`, { ip: '198.51.100.7' }), ENV, limits);
  assert.equal(refused.status, 429, 'the 31st deep-link read in a burst waits');
  assert.equal(limitPublicRead(req(`${P}/events`, { ip: '198.51.100.7' }), ENV, limits), null, 'the page is a read, not a lookup');
});

/* ---------- static: nothing private is imported into a public handler ---------- */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const IMPORT = /(?:^|[\s;])import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|export\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/g;
function importGraph(entry) {
  const seen = new Set(), stack = [resolve(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) { const spec = m[1] || m[2] || m[3]; if (spec && spec.startsWith('.')) stack.push(resolve(dirname(file), spec)); }
  }
  return [...seen].map((f) => relative(ROOT, f).split('\\').join('/')).sort();
}
const PRIVATE = [/\/intel\//, /world-news-pairs/, /news-pairing/, /\/halo\//, /eup\/environment\/owner\.js$/, /world-halo-ops-routes/, /^core\//];
test('static: the public timeline imports one response helper and nothing else; no public handler reaches intel/, the news pairing or a Halo route', () => {
  assert.ok(existsSync(resolve(ROOT, 'workers/mccluster/src/world-environment-events.js')), 'the public timeline module exists');
  assert.deepEqual(importGraph('workers/mccluster/src/world-environment-events.js'), ['workers/mccluster/src/lib/http.js', 'workers/mccluster/src/world-environment-events.js']);
  for (const handler of ['workers/mccluster/src/world-environment.js', 'workers/mccluster/src/world-environment-layers.js', 'workers/mccluster/src/world-environment-guard.js', 'workers/mccluster/src/world-environment-events.js']) {
    const graph = importGraph(handler);
    for (const file of graph) for (const bad of PRIVATE) assert.doesNotMatch(file, bad, `${handler} reaches ${file}`);
  }
  /* the two shared Halo-named files the public handlers have long read are read for provider helpers only: the names are pinned,
     so a Halo route, owner check or intelligence export cannot arrive through them unnoticed */
  const named = (file, from) => {
    const src = readFileSync(resolve(ROOT, file), 'utf8');
    const m = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"]`).exec(src);
    return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean).sort() : [];
  };
  assert.deepEqual(named('workers/mccluster/src/world-environment.js', './world-halo-layers.js'), ['fetchCyclones', 'fetchQuakes']);
  assert.deepEqual(named('workers/mccluster/src/world-environment-layers.js', './world-halo-layers.js'), ['NIFC_PERIMETERS_URL', 'clip', 'finite', 'isoFromMs', 'latOf', 'lonOf', 'normalizeRing', 'parseFirmsCsv', 'providerUrl', 'within']);
  assert.deepEqual(named('workers/mccluster/src/world-environment-layers.js', './world-halo-ops.js'), ['STATION_ID', 'TIDES', 'boundedJson', 'normalizeStation', 'normalizeWaterLevel', 'waterLevelUrl']);
  /* and neither shared file imports intelligence, the news pairing or a route of its own */
  for (const shared of ['workers/mccluster/src/world-halo-layers.js', 'workers/mccluster/src/world-halo-ops.js']) {
    for (const file of importGraph(shared)) for (const bad of PRIVATE) assert.doesNotMatch(file, bad, `${shared} reaches ${file}`);
  }
});
