/* A COMMENT IS HEARD (owner, 2026-10-20). A new comment tells the post's author and the people who commented on that
   post in the last fortnight; never the commenter, never across a block, never someone who muted the commenter, at
   most 20 people, and a failed alert never fails the comment. Driven against a fake Supabase. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi } from '../src/platform-api.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const ME = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';
const EARLIER = '44444444-4444-4444-8444-444444444444';
const BLOCKED = '55555555-5555-4555-8555-555555555555';
const MUTER = '66666666-6666-4666-8666-666666666666';
const POST = '33333333-3333-4333-8333-333333333333';
const COMMENT = '77777777-7777-4777-8777-777777777777';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fake({ author = AUTHOR, earlier = [], blocks = [], mutes = [], notifyStatus = 201 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url)), m = init.method || 'GET';
    calls.push({ u, m, body: init.body ? JSON.parse(init.body) : null });
    const ok = (d, status = 200) => new Response(JSON.stringify(d), { status });
    if (u.endsWith('/auth/v1/user')) return ok({ id: 'user-1' });
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: ME }]);
    if (u.includes('/network_posts?id=eq.' + POST)) return ok([{ id: POST, author_m_uid: author, visibility: 'public', deleted_at: null, group_id: null }]);
    if (u.endsWith('/network_post_comments') && m === 'POST') return ok([{ id: COMMENT, post_id: POST, author_m_uid: ME, body: 'yes' }], 201);
    if (u.includes('/network_post_comments?')) return ok(earlier.map((id) => ({ author_m_uid: id })));
    if (u.includes('/network_blocks?or=')) return ok(blocks);
    if (u.includes('/network_mutes?')) return ok(mutes.map((id) => ({ muter_m_uid: id })));
    if (u.endsWith('/network_notifications') && m === 'POST') return notifyStatus < 300 ? ok(null, notifyStatus) : ok({ message: 'down' }, notifyStatus);
    return ok([]);
  };
  return calls;
}
const comment = () => handlePlatformApi(new Request(`https://api.test/v1/mnet/posts/${POST}/replies`, {
  method: 'POST', headers: { authorization: 'Bearer t', origin: 'https://matthew.mccluster.org', 'content-type': 'application/json' }, body: JSON.stringify({ body: 'yes' })
}), ENV);
const sent = (calls) => calls.filter((c) => c.u.endsWith('/network_notifications') && c.m === 'POST').flatMap((c) => c.body);

test('the author and earlier commenters hear about a new comment, each once, with a link back to the post', async () => {
  const calls = fake({ earlier: [ME, EARLIER, AUTHOR, EARLIER] });
  const res = await comment();
  assert.equal(res.status, 201);
  const rows = sent(calls);
  assert.deepEqual(rows.map((r) => r.recipient_m_uid).sort(), [AUTHOR, EARLIER].sort());
  const author = rows.find((r) => r.recipient_m_uid === AUTHOR), other = rows.find((r) => r.recipient_m_uid === EARLIER);
  assert.equal(author.body, 'commented on your post');
  assert.equal(other.body, 'also commented on a post you commented on');
  for (const r of rows) {
    assert.equal(r.type, 'comment'); assert.equal(r.actor_m_uid, ME); assert.equal(r.object_id, POST);
    assert.deepEqual(r.metadata, { post_id: POST, comment_id: COMMENT });
  }
  assert.ok(calls.some((c) => c.u.includes('/network_post_comments?') && c.u.includes('created_at=gte.')), 'only the last fortnight of commenters');
});

test('commenting on your own post with no one else around tells no one', async () => {
  const calls = fake({ author: ME, earlier: [ME] });
  assert.equal((await comment()).status, 201);
  assert.equal(sent(calls).length, 0);
  assert.equal(calls.some((c) => c.u.includes('/network_blocks?')), false, 'no lookups when nobody would be told');
});

test('a block either way and a live mute keep a person out of it', async () => {
  const calls = fake({ earlier: [BLOCKED, MUTER, EARLIER], blocks: [{ blocker_m_uid: BLOCKED, blocked_m_uid: ME }], mutes: [MUTER] });
  assert.equal((await comment()).status, 201);
  assert.deepEqual(sent(calls).map((r) => r.recipient_m_uid).sort(), [AUTHOR, EARLIER].sort());
  const mute = calls.find((c) => c.u.includes('/network_mutes?'));
  assert.match(mute.u, /muted_m_uid=eq\.11111111/);
  assert.match(mute.u, /expires_at\.is\.null,expires_at\.gt\.\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\)/, 'an expired mute no longer quiets anything');
});

test('a busy post tells at most 20 people', async () => {
  const many = Array.from({ length: 40 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`);
  const calls = fake({ earlier: many });
  assert.equal((await comment()).status, 201);
  assert.equal(sent(calls).length, 20);
});

test('an alert that cannot be written never fails the comment', async () => {
  fake({ earlier: [EARLIER], notifyStatus: 500 });
  const res = await comment();
  assert.equal(res.status, 201);
  assert.equal((await res.json()).comment.id, COMMENT);
});
