/* The World screen's guest feed (GET /v1/mnet/public-feed). A signed-out
   visitor reads permitted public material only: public posts outside any
   group, by members whose own profile is public, with no viewer state, no
   internal ids and no media addresses. Driven against a fake Supabase, with
   no authorization header at all. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi } from '../src/platform-api.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const OPEN = '11111111-1111-4111-8111-111111111111';    // public profile
const CLOSED = '22222222-2222-4222-8222-222222222222';  // network-only profile
const P_OK = '33333333-3333-4333-8333-333333333333';
const P_GROUP = '44444444-4444-4444-8444-444444444444';
const P_CLOSED = '55555555-5555-4555-8555-555555555555';
const P_NET = '66666666-6666-4666-8666-666666666666';
const ASSET = '77777777-7777-4777-8777-777777777777';
const POSTER = '88888888-8888-4888-8888-888888888888';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fake({ media = [{ asset_id: ASSET, type: 'image' }] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url)), m = init.method || 'GET';
    calls.push({ u, m, auth: init.headers && (init.headers.authorization || init.headers.Authorization) });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (u.includes('/network_feed_items')) return ok([
      { item_type: 'post', post_id: P_OK, actor_m_uid: OPEN, visibility: 'public', occurred_at: '2026-10-14T05:00:00Z' },
      { item_type: 'post', post_id: P_GROUP, actor_m_uid: OPEN, visibility: 'public', occurred_at: '2026-10-14T04:00:00Z' },
      { item_type: 'post', post_id: P_CLOSED, actor_m_uid: CLOSED, visibility: 'public', occurred_at: '2026-10-14T03:00:00Z' },
      { item_type: 'post', post_id: P_NET, actor_m_uid: OPEN, visibility: 'public', occurred_at: '2026-10-14T02:00:00Z' },
    ]);
    if (u.includes('/network_posts?id=in.')) return ok([
      { id: P_OK, author_m_uid: OPEN, body: 'Bagged the north bank.', post_type: 'share', visibility: 'public', media, metadata: { action: { assignment_id: 'secret' }, track: { title: 'Docket 516R', art: 'https://evil.example/x.png' }, internal: 'nope' }, content_id: null, reply_to_id: null, group_id: null, created_at: '2026-10-14T05:00:00Z', source_app_id: 'app-internal', source_org_id: 'org-internal' },
      { id: P_GROUP, author_m_uid: OPEN, body: 'group only', post_type: 'post', visibility: 'public', media: [], metadata: {}, group_id: 'g1', reply_to_id: null, created_at: '2026-10-14T04:00:00Z' },
      { id: P_CLOSED, author_m_uid: CLOSED, body: 'closed profile', post_type: 'post', visibility: 'public', media: [], metadata: {}, group_id: null, reply_to_id: null, created_at: '2026-10-14T03:00:00Z' },
      { id: P_NET, author_m_uid: OPEN, body: 'network only', post_type: 'post', visibility: 'network', media: [], metadata: {}, group_id: null, reply_to_id: null, created_at: '2026-10-14T02:00:00Z' },
    ]);
    if (u.includes('/network_profiles?m_uid=in.') && u.includes('visibility=eq.public')) return ok([{ m_uid: OPEN }]);
    if (u.includes('/network_profiles?m_uid=in.')) return ok([{ m_uid: OPEN, display_name: 'Open Member', avatar_url: '', verification_state: 'verified' }, { m_uid: CLOSED, display_name: 'Closed Member' }]);
    if (u.includes('/network_reactions')) return ok([{ post_id: P_OK, actor_m_uid: CLOSED }, { post_id: P_OK, actor_m_uid: OPEN }]);
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: OPEN, auth_user_id: 'auth-open' }]);
    if (u.includes('/platform_profiles')) return ok([{ user_id: 'auth-open', mccluster_id: 'openmember' }]);
    return ok([]);
  };
  return calls;
}
const get = (path) => handlePlatformApi(new Request(`https://api.test${path}`, { headers: { origin: 'https://matthew.mccluster.org' } }), ENV);

test('a guest reads public, non-group posts by public profiles, with no session', async () => {
  const calls = fake();
  const res = await get('/v1/mnet/public-feed?limit=50');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://matthew.mccluster.org');
  const body = await res.json();
  assert.equal(body.scope, 'public');
  assert.deepEqual(body.items.map((x) => x.post.id), [P_OK], 'group, closed-profile and network posts never reach a guest');
  assert.ok(!calls.some((c) => c.u.includes('/auth/v1/user')), 'no session is asked for');
  const feedQuery = calls.find((c) => c.u.includes('/network_feed_items')).u;
  assert.match(feedQuery, /visibility=eq\.public/);
  assert.match(feedQuery, /item_type=eq\.post/, 'activity rows are not part of the guest feed');
  assert.match(feedQuery, /limit=60/, 'the page is capped at 20, fetched three deep');
});

test('the guest projection carries no internal ids, viewer state or media addresses', async () => {
  fake();
  const [item] = (await (await get('/v1/mnet/public-feed')).json()).items;
  assert.deepEqual(Object.keys(item.actor).sort(), ['avatar_url', 'display_name', 'mccluster_id', 'verification_state']);
  assert.equal(item.actor.mccluster_id, 'openmember');
  assert.equal(item.post.like_count, 2);
  assert.equal(item.post.liked_by_me, false);
  assert.equal(item.post.media_locked, 1, 'the guest learns there is a photo, not where it lives');
  const text = JSON.stringify(item);
  for (const secret of [ASSET, OPEN, 'secret', 'app-internal', 'org-internal', 'internal', 'evil.example']) {
    assert.ok(!text.includes(secret), `${secret} must not reach a guest`);
  }
  assert.deepEqual(item.post.metadata, { track: { title: 'Docket 516R' }, action: true });
});

test('a video\'s thumbnail never reaches a guest either: no poster id, no address', async () => {
  fake({ media: [{ asset_id: ASSET, type: 'video', mime_type: 'video/mp4', poster_asset_id: POSTER }] });
  const [item] = (await (await get('/v1/mnet/public-feed')).json()).items;
  assert.equal(item.post.media_locked, 1);
  const text = JSON.stringify(item);
  assert.ok(!text.includes(POSTER) && !/poster/i.test(text), 'the guest learns there is a video, not its picture\'s id');
});

test('a malformed cursor is refused before any read', async () => {
  const calls = fake();
  const res = await get('/v1/mnet/public-feed?before=not-a-date');
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('every other network route still demands a session', async () => {
  fake();
  const res = await get('/v1/mnet/feed?app_key=mccluster-web');
  assert.equal(res.status, 401);
});

/* THE NEXT PAGE STARTS WHERE THIS ONE STOPPED. A page reads 60 rows to return 20, because rows drop out after the read.
   The cursor used to be the 60th row READ, so when 40 survived, the 20 between the last one shown and that row were never
   shown. A fake Supabase that honours the cursor (occurred_at < before) and the limit proves rows 21-40 are reachable. */
const ME_MUID = '88888888-8888-4888-8888-888888888888';
const pid = (k) => `aaaaaaaa-0000-4000-8000-${String(k).padStart(12, '0')}`;
/* newest first, one a minute */
const rowsOf = (n) => Array.from({ length: n }, (_, k) => ({ item_type: 'post', post_id: pid(k + 1), actor_m_uid: OPEN, visibility: 'public', occurred_at: new Date(Date.UTC(2026, 9, 15, 12, 0) - k * 60e3).toISOString() }));
/* by default every third row is a group post, which never reaches a feed */
function pagedFake(rows, isGroup = (k) => k % 3 === 2) {
  const page = (before, limit) => rows.filter((r) => !before || r.occurred_at < new Date(before).toISOString()).slice(0, limit);
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (u.includes('/auth/v1/user')) return ok({ id: 'auth-me' });
    if (u.includes('/m_auth_user_links?auth_user_id=eq.')) return ok([{ m_uid: ME_MUID }]);
    if (u.includes('/rpc/mnet_surface_feed')) { const b = JSON.parse(init.body); return ok(page(b.p_before, b.p_limit)); }
    if (u.includes('/network_feed_items')) return ok(page((u.match(/occurred_at=lt\.([^&]+)/) || [])[1], Number(u.match(/limit=(\d+)/)[1])));
    if (u.includes('/network_posts?id=in.')) {
      const wanted = u.match(/id=in\.\(([^)]*)\)/)[1].split(',');
      return ok(wanted.map((id) => { const k = rows.findIndex((r) => r.post_id === id); return { id, author_m_uid: OPEN, body: 'post ' + id.slice(-3), post_type: 'post', visibility: 'public', media: [], metadata: {}, content_id: null, reply_to_id: null, group_id: isGroup(k) ? 'g1' : null, created_at: rows[k].occurred_at }; }));
    }
    if (u.includes('/network_profiles?m_uid=in.') && u.includes('visibility=eq.public')) return ok([{ m_uid: OPEN }]);
    if (u.includes('/network_profiles?m_uid=in.')) return ok([{ m_uid: OPEN, display_name: 'Open Member' }]);
    return ok([]);
  };
  return rows.filter((_, k) => !isGroup(k)).map((r) => r.post_id);
}
const idsOf = (body) => body.items.map((x) => x.post_id || (x.post && x.post.id));
const memberGet = (path) => handlePlatformApi(new Request(`https://api.test${path}`, { headers: { origin: 'https://matthew.mccluster.org', authorization: 'Bearer member-session' } }), ENV);

for (const [name, read, base] of [['the public feed', get, '/v1/mnet/public-feed?limit=20'], ['the member feed', memberGet, '/v1/mnet/feed?app_key=mccluster-web&limit=20']]) {
  test(`${name}: when more than a page survives the filters, the next page starts after the last item shown, so rows 21-40 are reachable`, async () => {
    const rows = rowsOf(90), survivors = pagedFake(rows);
    const one = await (await read(base)).json();
    assert.deepEqual(idsOf(one), survivors.slice(0, 20), 'page 1: the first 20 survivors');
    assert.equal(one.next_before, rows.find((r) => r.post_id === survivors[19]).occurred_at, 'the cursor is the 20th item returned, not the 60th row read');
    const two = await (await read(base + '&before=' + encodeURIComponent(one.next_before))).json();
    assert.deepEqual(idsOf(two), survivors.slice(20, 40), 'page 2: survivors 21-40, none skipped, none repeated');
    const three = await (await read(base + '&before=' + encodeURIComponent(two.next_before))).json();
    assert.deepEqual([...idsOf(one), ...idsOf(two), ...idsOf(three)], survivors, 'every survivor, in order, once');
    assert.equal(three.next_before, null, 'the last, short read ends the feed');
  });
  test(`${name}: a full read that leaves 20 or fewer goes on from the last row read; a short read ends`, async () => {
    /* 75 rows, one in four survives: the first read of 60 is full and leaves 15, so the next page starts after the 60th row */
    const rows = rowsOf(75), survivors = pagedFake(rows, (k) => k % 4 !== 0);
    const one = await (await read(base)).json();
    assert.deepEqual(idsOf(one), survivors.slice(0, 15));
    assert.equal(one.next_before, rows[59].occurred_at, 'nothing past the last item shown survived up to the 60th row');
    const two = await (await read(base + '&before=' + encodeURIComponent(one.next_before))).json();
    assert.deepEqual(idsOf(two), survivors.slice(15), 'the rest, and nothing twice');
    assert.equal(two.next_before, null, 'a short read has no next page');
  });
}
