/* CONNECTICUT WEATHER READ (./src/world-weather.js): owner only, one shared
   minute-long cache entry in front of one Supabase read, ages recomputed at
   read time, no upstream weather provider ever called. The snapshot is built
   by Core's own ingest from Core's recorded fixtures, so the Worker is tested
   against the exact shape Core writes. Fake fetch only; no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWorldWeather, ageSnapshot, WEATHER_PREFIX, WEATHER_FEEDS } from '../src/world-weather.js';
import { globeFeatureForPath, globeRelease } from '../../../packages/release-policy/globe.mjs';
import { ingestRegion, buildSnapshot } from '../../../core/src/weather/ingest.mjs';
import { fixtureFetch, fixtureNow } from '../../../core/src/weather/fixture-fetch.mjs';

const ORIGIN = 'https://matthew.mccluster.org';
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key', ALLOWED_ORIGINS: ORIGIN };
const OWNER = '11111111-1111-4111-8111-111111111111';
const HOUSE = '00000000-0000-4000-8000-0000000000aa';
const NOW = Date.parse(fixtureNow());
const PATH = `${WEATHER_PREFIX}/connecticut-pilot`;
const req = (path, { method = 'GET', token = 'owner' } = {}) => new Request(`https://api.mccluster.org${path}`, { method, headers: { origin: ORIGIN, ...(token ? { authorization: 'Bearer ' + token } : {}) } });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function memoryCache() { const m = new Map(); return { async match(k) { const v = m.get(k.url); return v ? new Response(v) : undefined; }, async put(k, r) { m.set(k.url, await r.text()); }, raw: m }; }

const { records, receipts } = await ingestRegion({ now: new Date(NOW), fetchImpl: fixtureFetch() });
const SNAPSHOT = buildSnapshot({ now: new Date(NOW), records, receipts });

function supabase({ owner = true, rows = [{ output: { snapshot: SNAPSHOT }, updated_at: new Date(NOW).toISOString() }], failJobs = false, calls = [] } = {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const h = new Headers(init.headers || {});
    calls.push(url.toString());
    if (url.hostname !== 'sb.test') throw new Error('unexpected host ' + url.hostname); // never a weather provider
    if (url.pathname === '/auth/v1/user') return h.get('authorization') === 'Bearer owner' || h.get('authorization') === 'Bearer member' ? json({ id: OWNER }) : json({}, 401);
    const table = url.pathname.replace('/rest/v1/', '');
    const q = url.searchParams;
    if (table === 'orgs') return json([{ id: HOUSE }]);
    if (table === 'org_members') return json(owner && h.get('authorization') && q.get('role') === 'eq.owner' ? [{ role: 'owner' }] : []);
    if (table === 'ops_agent_jobs') {
      assert.equal(q.get('job_type'), 'eq.weather_region_snapshot');
      assert.equal(q.get('status'), 'eq.done');
      assert.equal(q.get('org_id'), `eq.${HOUSE}`);
      assert.equal(q.get('target_id'), 'eq.connecticut-pilot');
      return failJobs ? json({ message: 'down' }, 500) : json(rows);
    }
    throw new Error('unexpected table ' + table);
  };
}
const headersOk = (r) => {
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('vary'), 'origin, authorization');
};

test('the release guard maps the weather route to the owner-only weather feature', () => {
  assert.equal(globeFeatureForPath(PATH), 'weather');
  assert.equal(globeRelease('weather', {}), 'admin_preview');
  assert.equal(globeRelease('weather', { WORLD_GLOBE_WITHDRAWN: 'weather' }), 'withdrawn');
});

test('the owner reads the snapshot with ages recomputed; others are refused', async () => {
  const cache = memoryCache();
  const later = NOW + 20 * 60_000;
  const res = await handleWorldWeather(req(PATH), ENV, { fetchImpl: supabase(), cacheImpl: cache, nowMs: later });
  headersOk(res);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.available, true);
  assert.equal(body.schema, 'mccluster.weather.snapshot.v1');
  assert.deepEqual(Object.keys(body.feeds).sort(), [...WEATHER_FEEDS].sort());
  assert.equal(body.snapshot_age_s, 20 * 60);
  assert.equal(body.feeds.rain_now.stale, true, 'MRMS 24 minutes old is stale');
  assert.equal(body.feeds.forecast_hourly.stale, false);
  assert.ok(body.feeds.radar_velocity.quality_flags.includes('relative_to_radar'));
  assert.ok(typeof body.feeds.rain_now.payload.data === 'string' && body.feeds.rain_now.payload.data.length > 100);

  const member = await handleWorldWeather(req(PATH), ENV, { fetchImpl: supabase({ owner: false }), cacheImpl: memoryCache(), nowMs: later });
  assert.equal(member.status, 403);
  headersOk(member);
  const anon = await handleWorldWeather(req(PATH, { token: null }), ENV, { fetchImpl: supabase(), cacheImpl: memoryCache(), nowMs: later });
  assert.equal(anon.status, 403);
});

test('many reads within a minute are one Supabase read; rasters=0 drops only the grids', async () => {
  const cache = memoryCache();
  const calls = [];
  const fetchImpl = supabase({ calls });
  for (let i = 0; i < 5; i += 1) {
    const res = await handleWorldWeather(req(`${PATH}${i % 2 ? '?rasters=0' : ''}`), ENV, { fetchImpl, cacheImpl: cache, nowMs: NOW + i * 1000 });
    assert.equal(res.status, 200);
    const body = await res.json();
    if (i % 2) {
      assert.equal(body.feeds.rain_now.payload.data, undefined);
      assert.equal(body.feeds.rain_now.payload.data_omitted, true);
      assert.ok(body.feeds.observation.payload.values);
    }
  }
  assert.equal(calls.filter((u) => u.includes('/ops_agent_jobs')).length, 1);
  await handleWorldWeather(req(PATH), ENV, { fetchImpl, cacheImpl: cache, nowMs: NOW + 61_000 });
  assert.equal(calls.filter((u) => u.includes('/ops_agent_jobs')).length, 2, 'the entry expires after a minute');
});

test('no snapshot yet, a foreign shape, Supabase down, a wrong region, a write', async () => {
  const none = await (await handleWorldWeather(req(PATH), ENV, { fetchImpl: supabase({ rows: [] }), cacheImpl: memoryCache(), nowMs: NOW })).json();
  assert.equal(none.available, false);
  assert.equal(none.reason, 'no_snapshot_yet');
  const foreign = await (await handleWorldWeather(req(PATH), ENV, { fetchImpl: supabase({ rows: [{ output: { snapshot: { schema: 'other', feeds: {} } } }] }), cacheImpl: memoryCache(), nowMs: NOW })).json();
  assert.equal(foreign.available, false);
  const down = await handleWorldWeather(req(PATH), ENV, { fetchImpl: supabase({ failJobs: true }), cacheImpl: memoryCache(), nowMs: NOW });
  assert.equal(down.status, 503);
  headersOk(down);
  const wrong = await handleWorldWeather(req(`${WEATHER_PREFIX}/mars`), ENV, { fetchImpl: supabase(), cacheImpl: memoryCache(), nowMs: NOW });
  assert.equal(wrong.status, 404);
  const post = await handleWorldWeather(req(PATH, { method: 'POST' }), ENV, { fetchImpl: supabase(), cacheImpl: memoryCache(), nowMs: NOW });
  assert.equal(post.status, 405);
  assert.equal(await handleWorldWeather(req('/v1/world/news'), ENV, { fetchImpl: supabase() }), null);
});

test('a missing record stays missing and stale; ages never go negative', () => {
  const snap = structuredClone(SNAPSHOT);
  snap.feeds.alerts = { ...snap.feeds.alerts, status: 'missing', observed_at: null, issued_at: null, valid_from: null, payload: null };
  const aged = ageSnapshot(snap, NOW - 3_600_000);
  assert.equal(aged.feeds.alerts.stale, true);
  assert.equal(aged.feeds.alerts.age_s, null);
  for (const r of Object.values(aged.feeds)) assert.ok(r.age_s === null || r.age_s >= 0);
});
