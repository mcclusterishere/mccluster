/* THE NEWS HEAT MAP (owner, 2026-10-21: "instead of pins on the map ... aggregate each mention of a state or country with a
   heat map of how many articles or mentions it has"). GET /v1/world/news-heat counts the last day's stories by the country
   each mentions, or, for one country, by place on a 0.05° grid; only counts and rounded places leave the Worker. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWorldNewsHeat, NEWS_HEAT_PATH } from '../src/world-news.js';

const KEY = 'service-role-SECRET';
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: KEY, ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const NOW = Date.parse('2026-10-21T12:02:00Z');
const get = (q = '') => new Request(`https://api.mccluster.org${NEWS_HEAT_PATH}${q}`, { headers: { origin: 'https://matthew.mccluster.org' } });
function memoryCache() { const m = new Map(); return { async match(k) { const v = m.get(k.url); return v ? new Response(v) : undefined; }, async put(k, r) { m.set(k.url, await r.text()); }, raw: m }; }
/* the table, served a page at a time the way PostgREST does (limit/offset), with every request kept */
function db(rows, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ url: u, headers: init.headers || {} });
    if (status !== 200) return new Response('{"message":"down"}', { status });
    const limit = Number(u.searchParams.get('limit')), offset = Number(u.searchParams.get('offset') || 0);
    const fips = u.searchParams.get('location_country_fips');
    const want = fips ? (fips.startsWith('in.(') ? fips.slice(4, -1).split(',') : [fips.slice(3)]) : null;
    const list = rows.filter((r) => !want || want.includes(r.location_country_fips)).slice(offset, offset + limit);
    const cols = u.searchParams.get('select').split(',');
    return new Response(JSON.stringify(list.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])))), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}
const story = (fips, lat, lon) => ({ location_country_fips: fips, headline_latitude: lat, headline_longitude: lon });

test('counts the last day\'s stories by country, ISO codes from GDELT\'s FIPS, nothing else leaves', async () => {
  const rows = [story('UK', 51.5, -0.12), story('UK', 53.4, -2.2), story('GM', 52.5, 13.4), story('US', 40.7, -74), story('US', 34, -118), story('US', 41.3, -72.9), story('RS', 55.7, 37.6), story('ZZ', 0, 0)];
  const d = db(rows);
  const res = await handleWorldNewsHeat(get(), ENV, { fetchImpl: d.fetchImpl, cacheImpl: memoryCache(), now: () => NOW });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  const body = await res.json();
  assert.deepEqual(body.countries, { GB: 2, DE: 1, US: 3, RU: 1 }, 'FIPS UK, GM, RS are the UK, Germany and Russia');
  assert.equal(body.total, 7);
  assert.equal(body.window_hours, 24);
  assert.equal(body.capped, false);
  assert.equal(body.attribution.name, 'The GDELT Project');
  const q = d.calls[0].url.searchParams;
  assert.equal(q.get('select'), 'location_country_fips', 'only the country column is read');
  assert.equal(q.get('ingestion_provider'), 'eq.gdelt_gkg_v2');
  assert.equal(q.get('published_at'), 'gte.2026-10-20T12:00:00.000Z', 'a day back from the five-minute slot');
  assert.ok(!JSON.stringify(body).includes(KEY));
});

test('reads page after page, and says when it stopped at the cap', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => story(i % 2 ? 'US' : 'FR', 10, 10));
  const d = db(rows);
  const body = await (await handleWorldNewsHeat(get(), ENV, { fetchImpl: d.fetchImpl, cacheImpl: memoryCache(), now: () => NOW })).json();
  assert.deepEqual(body.countries, { FR: 1250, US: 1250 });
  assert.equal(d.calls.length, 3, 'two full pages and a short one');
  assert.deepEqual(d.calls.map((c) => c.url.searchParams.get('offset')), ['0', '1000', '2000']);
  assert.equal(d.calls[0].url.searchParams.get('order'), 'id.asc', 'a stable order, so pages do not overlap');
  const many = db(Array.from({ length: 16000 }, () => story('US', 1, 1)));
  const capped = await (await handleWorldNewsHeat(get(), ENV, { fetchImpl: many.fetchImpl, cacheImpl: memoryCache(), now: () => NOW })).json();
  assert.equal(capped.capped, true);
  assert.equal(capped.total, 15000);
});

test('one country: its stories as places on a 0.05° grid, for the globe to count by state', async () => {
  const rows = [story('US', 41.31, -72.91), story('US', 41.32, -72.92), story('US', 34.05, -118.24), story('US', null, null), story('UK', 51.5, -0.12)];
  const d = db(rows);
  const body = await (await handleWorldNewsHeat(get('?country=US'), ENV, { fetchImpl: d.fetchImpl, cacheImpl: memoryCache(), now: () => NOW })).json();
  assert.equal(body.country, 'US');
  assert.equal(body.cell_degrees, 0.05);
  assert.deepEqual(body.cells.sort((a, b) => a[0] - b[0]), [[-118.25, 34.05, 1], [-72.9, 41.3, 2]], 'two New Haven stories share a cell; no place, no cell');
  assert.equal(body.total, 3);
  assert.equal(d.calls[0].url.searchParams.get('location_country_fips'), 'eq.US');
  assert.equal(d.calls[0].url.searchParams.get('select'), 'headline_latitude,headline_longitude');
  /* Palestine's stories are filed under the West Bank and Gaza */
  const ps = db([story('WE', 31.9, 35.2), story('GZ', 31.5, 34.45)]);
  const p = await (await handleWorldNewsHeat(get('?country=PS'), ENV, { fetchImpl: ps.fetchImpl, cacheImpl: memoryCache(), now: () => NOW })).json();
  assert.equal(ps.calls[0].url.searchParams.get('location_country_fips'), 'in.(WE,GZ)');
  assert.equal(p.total, 2);
});

test('a bad country is refused; a database that cannot answer gives an empty 200, and nothing is cached', async () => {
  for (const q of ['?country=us', '?country=USA', '?country=']) assert.equal((await handleWorldNewsHeat(get(q), ENV, { fetchImpl: db([]).fetchImpl, cacheImpl: memoryCache(), now: () => NOW })).status, 400, q);
  const cache = memoryCache();
  const down = await handleWorldNewsHeat(get(), ENV, { fetchImpl: db([], { status: 503 }).fetchImpl, cacheImpl: cache, now: () => NOW });
  assert.equal(down.status, 200);
  const body = await down.json();
  assert.equal(body.unavailable, true);
  assert.equal(cache.raw.size, 0);
  const unconfigured = await (await handleWorldNewsHeat(get(), {}, { fetchImpl: db([]).fetchImpl, cacheImpl: memoryCache(), now: () => NOW })).json();
  assert.equal(unconfigured.unavailable, true);
  assert.equal((await handleWorldNewsHeat(new Request('https://api.mccluster.org' + NEWS_HEAT_PATH, { method: 'POST' }), ENV, {})).status, 405);
  assert.equal(await handleWorldNewsHeat(new Request('https://api.mccluster.org/v1/world/news'), ENV, {}), null);
});

test('kept five minutes: a second ask in the same slot reads nothing', async () => {
  const d = db([story('US', 1, 1)]), cache = memoryCache();
  await handleWorldNewsHeat(get(), ENV, { fetchImpl: d.fetchImpl, cacheImpl: cache, now: () => NOW });
  await handleWorldNewsHeat(get(), ENV, { fetchImpl: d.fetchImpl, cacheImpl: cache, now: () => NOW + 60e3 });
  assert.equal(d.calls.length, 1);
});

test('with the feed in native-reader-only mode, nothing is counted', async () => {
  const d = db([story('US', 1, 1)]);
  const body = await (await handleWorldNewsHeat(get(), { ...ENV, WORLD_NEWS_READER_ONLY: 'true' }, { fetchImpl: d.fetchImpl })).json();
  assert.deepEqual(body.countries, {});
  assert.equal(d.calls.length, 0);
});

/* THE COUNTRY CARD (owner, 2026-10-21): the whole-world answer also counts the member posts placed in each country, but only
   once the place scope (network_posts.country_code) is on; until then posts is null, never a zero */
test('posts placed in each country ride along once the place scope is on, and are null while it is off', async () => {
  const stories = [story('US', 1, 1)];
  const placed = [{ country_code: 'KE' }, { country_code: 'KE' }, { country_code: 'US' }, { country_code: 'ke' }, { country_code: null }];
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(String(url));
    calls.push(u);
    if (u.pathname.endsWith('/network_posts')) return new Response(JSON.stringify(placed), { status: 200 });
    return db(stories).fetchImpl(url, init);
  };
  const off = await (await handleWorldNewsHeat(get(), ENV, { fetchImpl, cacheImpl: memoryCache(), now: () => NOW })).json();
  assert.equal(off.posts, null);
  assert.ok(!calls.some((u) => u.pathname.endsWith('/network_posts')), 'the column is never read while the place scope is off');
  const on = await (await handleWorldNewsHeat(get(), { ...ENV, WORLD_PLACE_SCOPE_ENABLED: 'true' }, { fetchImpl, cacheImpl: memoryCache(), now: () => NOW })).json();
  assert.deepEqual(on.posts, { KE: 2, US: 1 }, 'only ISO codes count');
  const q = calls.find((u) => u.pathname.endsWith('/network_posts')).searchParams;
  for (const [k, v] of [['visibility', 'eq.public'], ['deleted_at', 'is.null'], ['removed_at', 'is.null'], ['reply_to_id', 'is.null'], ['group_id', 'is.null'], ['country_code', 'not.is.null'], ['select', 'country_code']]) assert.equal(q.get(k), v, k);
  assert.deepEqual(on.countries, { US: 1 }, 'the news counts are unchanged');
  /* a posts read that fails leaves posts null and the news intact */
  const broken = async (url, init) => (new URL(String(url)).pathname.endsWith('/network_posts') ? new Response('{}', { status: 500 }) : db(stories).fetchImpl(url, init));
  const partial = await (await handleWorldNewsHeat(get(), { ...ENV, WORLD_PLACE_SCOPE_ENABLED: 'true' }, { fetchImpl: broken, cacheImpl: memoryCache(), now: () => NOW })).json();
  assert.equal(partial.posts, null);
  assert.deepEqual(partial.countries, { US: 1 });
});
