/* THE THUMBNAIL OF A POSTED VIDEO (owner, 2026-10-20: "I want people to be even able to edit the videos they previously
   posted as a thumbnail"). PATCH /v1/mnet/posts/:id takes poster_by_media {<a video of this post>: <the author's
   image>|null}: the new picture is attached to the post (or viewers' view-url answers 404), the post's media names it,
   and the old picture is let go. Body edits behave as they always did. Driven against a fake Supabase. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi } from '../src/platform-api.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const USER = '11111111-1111-4111-8111-111111111111';
const MUID = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const VIDEO = '55555555-5555-4555-8555-555555555551';
const PHOTO = '55555555-5555-4555-8555-555555555552';
const OLD = '66666666-6666-4666-8666-666666666661';
const NEW = '66666666-6666-4666-8666-666666666662';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const media = () => [
  { asset_id: VIDEO, type: 'video', mime_type: 'video/mp4', poster_asset_id: OLD },
  { asset_id: PHOTO, type: 'image', mime_type: 'image/jpeg', poster_asset_id: null },
];
function fake({ post = { id: POST, author_m_uid: MUID, body: 'my clip', media: media(), metadata: {} }, assets = {}, proofs = [] } = {}) {
  const calls = [];
  const rows = {
    [NEW]: { id: NEW, owner_m_uid: MUID, media_type: 'image', mime_type: 'image/jpeg', status: 'ready', post_id: null },
    [OLD]: { id: OLD, owner_m_uid: MUID, media_type: 'image', mime_type: 'image/jpeg', status: 'attached', post_id: POST },
    ...assets,
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url)), m = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({ u, m, body });
    const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (u.endsWith('/auth/v1/user')) return ok({ id: USER });
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: MUID, auth_user_id: USER }]);
    if (u.includes('/functions/v1/mnet-media')) return ok({ ok: true, discarded: true });
    if (u.includes('/action_proofs')) return ok(proofs);
    if (u.includes('/network_media_assets') && m === 'GET') {
      const ids = (u.match(/id=in\.\(([^)]*)\)/) || [, ''])[1].split(',');
      const owner = (u.match(/owner_m_uid=eq\.([0-9a-f-]+)/) || [])[1];
      return ok(ids.map((id) => rows[id]).filter((r) => r && (!owner || r.owner_m_uid === owner)));
    }
    if (u.includes('/network_media_assets') && m === 'PATCH') return new Response(null, { status: 204 });
    if (u.includes('/network_posts') && m === 'PATCH') return ok([{ ...post, ...body }]);
    if (u.includes('/network_posts') && m === 'GET') return ok(post ? [post] : []);
    return ok([]);
  };
  return calls;
}
const call = async (path, method, body) => {
  const req = new Request(`https://api.test${path}`, {
    method, headers: { authorization: 'Bearer user', 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  try { return await handlePlatformApi(req, ENV); }
  catch (error) { return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 }); }
};
const writes = (calls) => calls.filter((c) => c.m === 'PATCH' || c.m === 'POST' && !c.u.endsWith('/auth/v1/user'));
const postWrite = (calls) => calls.find((c) => c.u.includes('/network_posts') && c.m === 'PATCH');
const assetWrites = (calls) => calls.filter((c) => c.u.includes('/network_media_assets') && c.m === 'PATCH');

test('the author swaps a video\'s thumbnail: the new picture is attached, the old one let go', async () => {
  const calls = fake();
  const res = await call(`/v1/mnet/posts/${POST}`, 'PATCH', { poster_by_media: { [VIDEO]: NEW } });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.post.media[0].poster_asset_id, NEW, 'the hydrated post names the new picture');
  assert.equal(out.post.media[1].poster_asset_id, null, 'the photo is untouched');
  const lookup = calls.find((c) => c.u.includes('/network_media_assets') && c.m === 'GET');
  assert.match(lookup.u, new RegExp(`owner_m_uid=eq\\.${MUID}`), 'only the author\'s own assets are considered');
  const [attach, detach] = assetWrites(calls);
  assert.match(attach.u, new RegExp(`id=in\\.\\(${NEW}\\)`));
  assert.match(attach.u, /post_id=is\.null/);
  assert.deepEqual({ post_id: attach.body.post_id, status: attach.body.status }, { post_id: POST, status: 'attached' }, 'attached, or viewers would get a 404 from view-url');
  assert.match(detach.u, new RegExp(`id=in\\.\\(${OLD}\\)`));
  assert.match(detach.u, new RegExp(`post_id=eq\\.${POST}`));
  assert.deepEqual({ post_id: detach.body.post_id, status: detach.body.status }, { post_id: null, status: 'ready' });
  const write = postWrite(calls);
  assert.match(write.u, new RegExp(`author_m_uid=eq\\.${MUID}`), 'the post write is author-scoped');
  assert.equal(write.body.media[0].poster_asset_id, NEW);
  assert.ok(write.body.updated_at);
  assert.equal(write.body.body, undefined, 'the words are not touched');
  assert.ok(calls.indexOf(attach) < calls.indexOf(write) && calls.indexOf(write) < calls.indexOf(detach), 'attach, then the post, then let go');
  const discard = calls.find((c) => c.u.includes('/functions/v1/mnet-media'));
  assert.deepEqual(discard.body, { action: 'discard', asset_id: OLD }, 'the old picture is cleared out of storage');
});

test('a picture a mission proof also names is let go from the post but stays in storage', async () => {
  const calls = fake({ proofs: [{ metadata: { poster_asset_id: OLD } }] });
  const res = await call(`/v1/mnet/posts/${POST}`, 'PATCH', { poster_by_media: { [VIDEO]: NEW } });
  assert.equal(res.status, 200);
  assert.ok(!calls.some((c) => c.u.includes('/functions/v1/mnet-media')), 'nothing is discarded');
});

test('null clears a thumbnail', async () => {
  const calls = fake();
  const res = await call(`/v1/mnet/posts/${POST}`, 'PATCH', { poster_by_media: { [VIDEO]: null } });
  assert.equal(res.status, 200);
  assert.equal(postWrite(calls).body.media[0].poster_asset_id, null);
  assert.equal(assetWrites(calls).length, 1, 'nothing to attach, the old one let go');
});

test('a picture already attached to this same post may be reused', async () => {
  fake({ assets: { [NEW]: { id: NEW, owner_m_uid: MUID, media_type: 'image', mime_type: 'image/png', status: 'attached', post_id: POST } } });
  const res = await call(`/v1/mnet/posts/${POST}`, 'PATCH', { poster_by_media: { [VIDEO]: NEW } });
  assert.equal(res.status, 200);
});

const refusals = [
  ['a picture that is not the author\'s', { poster_by_media: { [VIDEO]: NEW } }, { [NEW]: { id: NEW, owner_m_uid: OTHER, media_type: 'image', mime_type: 'image/jpeg', status: 'ready', post_id: null } }],
  ['a picture that is a video', { poster_by_media: { [VIDEO]: NEW } }, { [NEW]: { id: NEW, owner_m_uid: MUID, media_type: 'video', mime_type: 'video/mp4', status: 'ready', post_id: null } }],
  ['a picture whose type is not an image', { poster_by_media: { [VIDEO]: NEW } }, { [NEW]: { id: NEW, owner_m_uid: MUID, media_type: 'image', mime_type: 'application/pdf', status: 'ready', post_id: null } }],
  ['a picture attached to another post', { poster_by_media: { [VIDEO]: NEW } }, { [NEW]: { id: NEW, owner_m_uid: MUID, media_type: 'image', mime_type: 'image/jpeg', status: 'attached', post_id: OTHER } }],
  ['a key that is the post\'s photo, not a video', { poster_by_media: { [PHOTO]: NEW } }],
  ['a key that is not in the post', { poster_by_media: { [OTHER]: NEW } }],
  ['a key that is not an id', { poster_by_media: { 'not-a-uuid': NEW } }],
  ['the post\'s own photo as the thumbnail', { poster_by_media: { [VIDEO]: PHOTO } }],
  ['a value that is not an id', { poster_by_media: { [VIDEO]: 'https://evil.example/x.jpg' } }],
  ['an empty map', { poster_by_media: {} }],
  ['a list instead of a map', { poster_by_media: [NEW] }],
];
for (const [what, body, assets] of refusals) {
  test(`refused with 400 before any write: ${what}`, async () => {
    const calls = fake({ assets });
    const res = await call(`/v1/mnet/posts/${POST}`, 'PATCH', body);
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
    assert.equal(writes(calls).length, 0, 'nothing is written');
  });
}

test('someone else\'s post answers 404 and nothing is written', async () => {
  const calls = fake({ post: { id: POST, author_m_uid: OTHER, body: 'theirs', media: media(), metadata: {}, visibility: 'public' } });
  const res = await call(`/v1/mnet/posts/${POST}`, 'PATCH', { poster_by_media: { [VIDEO]: NEW } });
  assert.equal(res.status, 404);
  assert.equal(writes(calls).length, 0);
});

test('a body edit works exactly as before and touches no media', async () => {
  const calls = fake();
  const res = await call(`/v1/mnet/posts/${POST}`, 'PATCH', { body: '  new words  ' });
  assert.equal(res.status, 200);
  const write = postWrite(calls);
  assert.equal(write.body.body, 'new words');
  assert.equal(write.body.media, undefined, 'the media is not rewritten');
  assert.equal(assetWrites(calls).length, 0);
  assert.ok(!calls.some((c) => c.u.includes('/functions/v1/mnet-media')));
});

test('if the post write fails, the new picture is let go again', async () => {
  const calls = fake();
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => (String(url).includes('/network_posts') && init.method === 'PATCH')
    ? new Response(JSON.stringify({ message: 'boom' }), { status: 500 }) : base(url, init);
  const res = await call(`/v1/mnet/posts/${POST}`, 'PATCH', { poster_by_media: { [VIDEO]: NEW } });
  assert.equal(res.status, 500);
  const [attach, release] = assetWrites(calls);
  assert.equal(attach.body.status, 'attached');
  assert.match(release.u, new RegExp(`id=in\\.\\(${NEW}\\)`));
  assert.equal(release.body.status, 'ready');
  assert.ok(!calls.some((c) => c.u.includes('/functions/v1/mnet-media')), 'the old picture stays');
});
