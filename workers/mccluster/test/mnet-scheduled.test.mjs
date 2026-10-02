/* SCHEDULED ACTION NETWORK POSTS, run against a fake Supabase.
   The create page can post now or pick a time. These tests drive the real
   handler and the real cron publisher with fetch replaced, and pin:
     1. a future publish_at holds the post instead of publishing it
     2. too-soon and too-far times are refused, and replies never wait
     3. the cron claims each row before publishing it (no double posts)
     4. a held post re-runs the checks at publish time and fails visibly
     5. a clip is shaped and bounded, never trusted
     6. before the table exists, scheduling says so and posting still works */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi, publishDueNetworkPosts } from '../src/platform-api.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const MUID = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const ROW = '44444444-4444-4444-8444-444444444444';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fakeDb({ tableMissing = false, assetsReady = true, claimWins = true, stalePublishing = false, existingScheduledPost = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ u, method, body });
    const ok = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (u.endsWith('/auth/v1/user')) return ok({ id: 'user-1' });
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: MUID }]);
    if (u.includes('/platform_apps')) return ok([{ id: null }]);
    if (u.includes('/network_media_assets') && method === 'GET') {
      return ok(assetsReady ? [{ id: ASSET, media_type: 'video', mime_type: 'video/mp4', duration_ms: 9000 }] : []);
    }
    if (u.includes('/network_media_assets')) return new Response(null, { status: 204 });
    if (u.includes('/network_scheduled_posts')) {
      if (tableMissing) return ok({ code: 'PGRST205', message: 'Could not find the table' }, 404);
      if (method === 'POST') return ok([{ id: ROW, publish_at: body.publish_at, status: 'scheduled', payload: body.payload }], 201);
      if (method === 'GET') {
        if (u.includes('status=eq.publishing')) return ok(stalePublishing ? [{ id: ROW, author_m_uid: MUID, status: 'publishing', payload: { body: 'later', media_asset_ids: [ASSET], visibility: 'public', metadata: {}, app_key: 'mnet-web' } }] : []);
        return ok(stalePublishing ? [] : [{ id: ROW, author_m_uid: MUID, status: 'scheduled', payload: { body: 'later', media_asset_ids: [ASSET], visibility: 'public', metadata: {}, app_key: 'mnet-web' } }]);
      }
      if (method === 'PATCH' && (u.includes('status=eq.scheduled') || u.includes('status=eq.publishing'))) return ok(claimWins ? [{ id: ROW }] : []);
      return new Response(null, { status: 204 });
    }
    if (u.includes('/network_posts') && method === 'GET' && u.includes('scheduled_post_id=')) return ok(existingScheduledPost ? [{ id: POST }] : []);
    if (u.includes('/network_posts') && method === 'POST') return ok([{ id: POST, author_m_uid: MUID, ...body }], 201);
    if (u.includes('/network_reactions') || u.includes('/network_posts?reply_to_id') || u.includes('/network_bookmarks')) return ok([]);
    if (u.includes('/network_profiles') || u.includes('/platform_profiles')) return ok([]);
    return ok([]);
  };
  return calls;
}
const post = (b) => handlePlatformApi(new Request('https://api.test/v1/mnet/posts', {
  method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' }, body: JSON.stringify(b),
}), ENV);
const later = (ms) => new Date(Date.now() + ms).toISOString();

test('a future publish_at holds the post and does not publish it', async () => {
  const calls = fakeDb();
  const res = await post({ body: 'later', media_asset_ids: [ASSET], publish_at: later(3600e3) });
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(out.scheduled.status, 'scheduled');
  assert.ok(!calls.some((c) => c.u.includes('/network_posts') && c.method === 'POST'), 'nothing reached the feed');
  const held = calls.find((c) => c.u.endsWith('/network_scheduled_posts') && c.method === 'POST');
  assert.equal(held.body.author_m_uid, MUID);
  assert.deepEqual(held.body.payload.media_asset_ids, [ASSET]);
  assert.ok(!calls.some((c) => c.u.includes('/network_media_assets') && c.method === 'PATCH'), 'media stays unattached until it publishes');
});

test('too soon, too far, unreadable and replies are refused', async () => {
  fakeDb();
  for (const [publish_at, msg] of [[later(30e3), /two minutes/], [later(91 * 86400e3), /90 days/], ['soon', /could not be read/]]) {
    const res = await post({ body: 'x', publish_at });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, msg);
  }
});

test('the cron claims each row before it publishes, then records the post', async () => {
  const calls = fakeDb();
  const out = await publishDueNetworkPosts(ENV);
  assert.deepEqual(out, { published: 1, failed: 0 });
  const claim = calls.findIndex((c) => c.method === 'PATCH' && c.u.includes('status=eq.scheduled'));
  const insert = calls.findIndex((c) => c.u.endsWith('/network_posts') && c.method === 'POST');
  assert.ok(claim > -1 && claim < insert, 'claimed before inserting');
  const done = calls.find((c) => c.method === 'PATCH' && c.body?.status === 'published');
  assert.equal(done.body.post_id, POST);
});

test('a stale publishing claim is recovered after a Worker dies', async () => {
  const calls = fakeDb({ stalePublishing: true });
  assert.deepEqual(await publishDueNetworkPosts(ENV), { published: 1, failed: 0 });
  const insert = calls.find((c) => c.u.endsWith('/network_posts') && c.method === 'POST');
  assert.equal(insert.body.scheduled_post_id, ROW);
});

test('a post inserted before a Worker crash is acknowledged, never duplicated', async () => {
  const calls = fakeDb({ stalePublishing: true, existingScheduledPost: true });
  assert.deepEqual(await publishDueNetworkPosts(ENV), { published: 1, failed: 0 });
  assert.ok(!calls.some((c) => c.u.endsWith('/network_posts') && c.method === 'POST'), 'existing scheduled post is reused');
  const done = calls.find((c) => c.method === 'PATCH' && c.body?.status === 'published');
  assert.equal(done.body.post_id, POST);
});

test('a lost claim publishes nothing', async () => {
  const calls = fakeDb({ claimWins: false });
  assert.deepEqual(await publishDueNetworkPosts(ENV), { published: 0, failed: 0 });
  assert.ok(!calls.some((c) => c.u.endsWith('/network_posts') && c.method === 'POST'));
});

test('a held post whose media went away fails visibly instead of posting', async () => {
  const calls = fakeDb({ assetsReady: false });
  assert.deepEqual(await publishDueNetworkPosts(ENV), { published: 0, failed: 1 });
  const failed = calls.find((c) => c.method === 'PATCH' && c.body?.status === 'failed');
  assert.match(failed.body.error, /media assets are unavailable/);
});

test('a clip is shaped and bounded', async () => {
  const calls = fakeDb();
  await post({ body: 'clip', media_asset_ids: [ASSET], clip: { start_ms: 1500.4, end_ms: 7000, muted: true, evil: '<script>' } });
  const ins = calls.find((c) => c.u.endsWith('/network_posts') && c.method === 'POST');
  assert.deepEqual(ins.body.metadata.clip, { start_ms: 1500, end_ms: 7000, muted: true });
  const calls2 = fakeDb();
  await post({ body: 'bad clip', clip: { start_ms: 5000, end_ms: 5100 } });
  const ins2 = calls2.find((c) => c.u.endsWith('/network_posts') && c.method === 'POST');
  assert.equal(ins2.body.metadata.clip, undefined, 'an empty stretch is dropped');
});

test('before the table exists, scheduling says so and posting now still works', async () => {
  fakeDb({ tableMissing: true });
  const res = await post({ body: 'later', publish_at: later(3600e3) });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not switched on yet/);
  assert.equal((await post({ body: 'now' })).status, 201);
  assert.deepEqual(await publishDueNetworkPosts(ENV), { published: 0, failed: 0 });
});
