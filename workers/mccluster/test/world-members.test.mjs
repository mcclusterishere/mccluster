/* THE PLACE CARD'S MEMBERS (owner, 2026-10-21: "count how many people have logged in with an account from that IP region.
   Make it exact down to the state"). GET /v1/world/members: exact counts and places for the house owner; the country
   totals of five or more for everyone else; never a uid, IP or city. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleWorldMembers, shapeMemberRows, publicMembers, MEMBERS_PATH, MEMBERS_K } from '../src/world-members.js';

const KEY = 'service-role-SECRET';
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: KEY, ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const OWNER = '11111111-1111-4111-8111-111111111111', MEMBER = '22222222-2222-4222-8222-222222222222', HOUSE = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-10-21T12:02:00Z');
const get = (token = '') => new Request(`https://api.mccluster.org${MEMBERS_PATH}`, { headers: { origin: 'https://matthew.mccluster.org', ...(token ? { authorization: 'Bearer ' + token } : {}) } });
function memoryCache() { const m = new Map(); return { async match(k) { const v = m.get(k.url); return v ? new Response(v) : undefined; }, async put(k, r) { m.set(k.url, await r.text()); }, raw: m }; }

const ROWS = [
  { country: 'US', region_code: 'CT', lon: -72.93, lat: 41.31, accounts: 3 },
  { country: 'US', region_code: 'CA', lon: -118.24, lat: 34.05, accounts: 2 },
  { country: 'US', region_code: null, lon: null, lat: null, accounts: 1 },
  { country: 'GB', region_code: 'ENG', lon: -0.12, lat: 51.51, accounts: 4 },
  { country: 'IT', region_code: '82', lon: 13.36, lat: 38.12, accounts: 1 },
  { country: 'zz', region_code: 'X', lon: 1, lat: 1, accounts: 9 },
  { country: 'FR', region_code: 'IDF', lon: 2.35, lat: 48.86, accounts: 0 }
];
/* Supabase as the route sees it: the session check, the house owner's org, and the RPC */
function supabase(rows = ROWS, { rpcStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url)), h = new Headers(init.headers || {});
    calls.push({ path: u.pathname, search: u.search, body: init.body || null, auth: h.get('authorization') });
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/auth/v1/user') return h.get('authorization') === 'Bearer owner' ? json({ id: OWNER }) : h.get('authorization') === 'Bearer member' ? json({ id: MEMBER }) : json({}, 401);
    if (u.pathname === '/rest/v1/orgs') return json([{ id: HOUSE }]);
    if (u.pathname === '/rest/v1/org_members') return json(u.searchParams.get('profile_id') === 'eq.' + OWNER ? [{ role: 'owner' }] : []);
    if (u.pathname === '/rest/v1/rpc/world_member_regions') return rpcStatus === 200 ? json(rows) : json({ message: 'down' }, rpcStatus);
    return json({ message: 'unexpected ' + u.pathname }, 404);
  };
  return { fetchImpl, calls };
}

test('the house owner gets every country exactly, the total, and the places to count states by', async () => {
  const sb = supabase();
  const res = await handleWorldMembers(get('owner'), ENV, { fetchImpl: sb.fetchImpl, cacheImpl: memoryCache(), now: () => NOW });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store', 'the exact answer is never kept on the way out');
  assert.match(res.headers.get('vary'), /authorization/);
  const body = await res.json();
  assert.equal(body.exact, true);
  assert.deepEqual(body.countries, { US: 6, GB: 4, IT: 1 }, 'one count per account, every country, the unplaced one too');
  assert.equal(body.total, 11);
  assert.deepEqual(body.cells, [[-72.93, 41.31, 3, 'US', 'CT'], [-118.24, 34.05, 2, 'US', 'CA'], [-0.12, 51.51, 4, 'GB', 'ENG'], [13.36, 38.12, 1, 'IT', '82']]);
  assert.equal(body.basis, 'accounts_by_latest_signed_in_ip_place');
  const rpc = sb.calls.find((c) => c.path === '/rest/v1/rpc/world_member_regions');
  assert.deepEqual(JSON.parse(rpc.body), { p_days: 400 });
  assert.equal(rpc.auth, 'Bearer ' + KEY, 'the RPC is the service role\'s, never the viewer\'s session');
  assert.ok(!JSON.stringify(body).includes(KEY));
});

test('everyone else gets the countries of five or more, and nothing finer', async () => {
  for (const token of ['', 'member', 'expired']) {
    const sb = supabase();
    const res = await handleWorldMembers(get(token), ENV, { fetchImpl: sb.fetchImpl, cacheImpl: memoryCache(), now: () => NOW });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
    const body = await res.json();
    assert.equal(body.exact, false, token || 'signed out');
    assert.equal(body.k, MEMBERS_K);
    assert.deepEqual(body.countries, { US: 6 }, 'Britain\'s 4 and Italy\'s 1 are under five');
    assert.equal(body.cells, undefined, 'no places');
    assert.equal(body.total, undefined, 'no total');
    if (!token) assert.ok(!sb.calls.some((c) => c.path === '/auth/v1/user'), 'no session, no owner check');
  }
});

test('the database is read once per five minutes, whoever asks', async () => {
  const sb = supabase(), cache = memoryCache();
  await handleWorldMembers(get('owner'), ENV, { fetchImpl: sb.fetchImpl, cacheImpl: cache, now: () => NOW });
  const pub = await (await handleWorldMembers(get(), ENV, { fetchImpl: sb.fetchImpl, cacheImpl: cache, now: () => NOW })).json();
  assert.equal(sb.calls.filter((c) => c.path === '/rest/v1/rpc/world_member_regions').length, 1);
  assert.deepEqual(pub.countries, { US: 6 }, 'the kept read is shaped for the viewer every time');
});

test('a database that cannot answer is unavailable, never zero, and is not kept', async () => {
  const sb = supabase(ROWS, { rpcStatus: 404 }), cache = memoryCache();
  const res = await handleWorldMembers(get(), ENV, { fetchImpl: sb.fetchImpl, cacheImpl: cache, now: () => NOW });
  const body = await res.json();
  assert.equal(body.unavailable, true);
  assert.deepEqual(body.countries, {});
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(cache.raw.size, 0);
  const unconfigured = await (await handleWorldMembers(get(), {}, { fetchImpl: sb.fetchImpl, cacheImpl: memoryCache(), now: () => NOW })).json();
  assert.equal(unconfigured.unavailable, true);
});

test('only GET on its own path', async () => {
  const sb = supabase();
  assert.equal(await handleWorldMembers(new Request('https://api.mccluster.org/v1/world/membersx'), ENV, { fetchImpl: sb.fetchImpl }), null);
  const post = await handleWorldMembers(new Request(`https://api.mccluster.org${MEMBERS_PATH}`, { method: 'POST' }), ENV, { fetchImpl: sb.fetchImpl });
  assert.equal(post.status, 405);
});

test('rows are checked: a bad country, a zero, an out-of-range place or a strange region code never pass', () => {
  const d = shapeMemberRows([{ country: 'US', region_code: 'C;T', lon: 200, lat: 41, accounts: 2 }, { country: 'USA', accounts: 3 }, { country: 'DE', region_code: 'BE', lon: 13.4049, lat: 52.52, accounts: '2' }, null]);
  assert.deepEqual(d.countries, { US: 2, DE: 2 });
  assert.deepEqual(d.cells, [[13.4, 52.52, 2, 'DE', 'BE']]);
  assert.deepEqual(publicMembers({ countries: { US: 5, GB: 4 } }), { exact: false, k: 5, countries: { US: 5 } });
});

test('the route is wired, outside the release guard (the public count is a public feature), and the SQL is service-role only', () => {
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /if \(path === MEMBERS_PATH\) \{\s*const members = await handleWorldMembers\(request, env\);/);
  const policy = readFileSync(new URL('../../../packages/release-policy/globe.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(policy, /\/v1\/world\/members/);
  const sql = readFileSync(new URL('../../../supabase/pending/world_member_regions_v1.sql', import.meta.url), 'utf8');
  assert.match(sql, /revoke all on function public\.world_member_regions\(integer\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.world_member_regions\(integer\) to service_role;/);
  assert.match(sql, /select distinct on \(e\.uid\) e\.uid,/, 'one place per account');
  assert.match(sql, /join auth\.users u on u\.id = l\.uid/, 'a deleted account no longer counts');
  assert.doesNotMatch(sql.slice(sql.indexOf('as $$')), /e\.ip\b|e\.city|e\.postal|device_id|session_id/, 'no address, city, device or session is read');
});
