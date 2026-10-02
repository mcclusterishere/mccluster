/* Spam limits on the Action Network (network_rate_limits_v2). The tables
   refuse a post over 2,000 characters or a reply over 1,000 (MN413), a member
   going too fast or past a daily cap (MN429), and a repeat (MN409); the Worker
   turns those into a 413, 429 or 409 with the table's own sentence on every
   route, and refuses an over-long post itself before ever writing it, instead
   of cutting it short. Driven against a fake Supabase. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi } from '../src/platform-api.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const USER = '11111111-1111-4111-8111-111111111111';
const MUID = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const OTHER = '44444444-4444-4444-8444-444444444444';
function fake({ insertError = null, patchError = null, followError = null, existing = { id: POST, author_m_uid: MUID, body: 'old', media: [] } } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    calls.push({ u, m });
    const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (u.endsWith('/auth/v1/user')) return ok({ id: USER });
    if (u.includes(`/m_auth_user_links?m_uid=eq.${OTHER}`)) return ok([{ auth_user_id: 'other-user' }]);
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: MUID }]);
    if (u.includes('/platform_profiles?user_id=eq.other-user')) return ok([{ user_id: 'other-user' }]);
    if (u.includes('/network_follows') && m === 'POST') return followError ? ok(followError, 400) : new Response(null, { status: 201 });
    if (u.includes('/platform_apps')) return ok([{ id: 'app1' }]);
    if (u.includes('/network_posts') && m === 'POST') return insertError ? ok(insertError, 400) : ok([{ id: POST, author_m_uid: MUID, body: 'hi' }], 201);
    if (u.includes('/network_posts') && m === 'PATCH') return patchError ? ok(patchError, 400) : ok([{ id: POST, author_m_uid: MUID, body: 'x' }]);
    if (u.includes('/network_posts') && m === 'GET') return ok([existing]);
    return ok([]);
  };
  return calls;
}
/* entry-platform.js answers a thrown error with its status and message;
   the same mapping here, so the test sees what a client sees. */
const call = async (path, method, body) => {
  const req = new Request(`https://api.test${path}`, {
    method, headers: { authorization: 'Bearer user', 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  try { return await handlePlatformApi(req, ENV); }
  catch (error) { return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 }); }
};
const inserts = (calls) => calls.filter((c) => c.u.includes('/network_posts') && c.m === 'POST');

test('a post over 2,000 characters is refused, never cut short and never written', async () => {
  const calls = fake();
  const res = await call('/v1/mnet/posts?app_key=mccluster-web', 'POST', { body: 'a'.repeat(2001) });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /2,000 characters/);
  assert.equal(inserts(calls).length, 0, 'nothing is written');
});

test('a post of exactly 2,000 characters goes through', async () => {
  fake();
  const res = await call('/v1/mnet/posts?app_key=mccluster-web', 'POST', { body: 'a'.repeat(2000) });
  assert.equal(res.status, 201);
});

test('a reply over 1,000 characters is refused before the write', async () => {
  const calls = fake();
  const res = await call('/v1/mnet/posts?app_key=mccluster-web', 'POST', { body: 'a'.repeat(1001), reply_to_id: POST });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /Replies are limited to 1,000 characters/);
  assert.equal(inserts(calls).length, 0, 'nothing is written');
});

test('going too fast answers 429 with the table\'s sentence', async () => {
  fake({ insertError: { code: 'MN429', message: 'Slow down. Give it a minute.' } });
  const res = await call('/v1/mnet/posts?app_key=mccluster-web', 'POST', { body: 'hello' });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'Slow down. Give it a minute.');
});

test('the daily cap answers 429 with the table\'s sentence', async () => {
  fake({ insertError: { code: 'MN429', message: 'That is the limit for today: 50 posts a day.' } });
  const res = await call('/v1/mnet/posts?app_key=mccluster-web', 'POST', { body: 'hello' });
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /50 posts a day/);
});

test('the table\'s length refusal on a direct-shaped write answers 413', async () => {
  fake({ insertError: { code: 'MN413', message: 'Posts are limited to 2,000 characters.' } });
  const res = await call('/v1/mnet/posts?app_key=mccluster-web', 'POST', { body: 'hello' });
  assert.equal(res.status, 413);
});

test('posting the same thing twice answers 409', async () => {
  fake({ insertError: { code: 'MN409', message: 'You already posted that.' } });
  const res = await call('/v1/mnet/posts?app_key=mccluster-web', 'POST', { body: 'hello' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'You already posted that.');
});

test('the follow cap answers 429 too, not a generic 400', async () => {
  fake({ followError: { code: 'MN429', message: 'That is the limit for today: 400 follows a day.' } });
  const res = await call(`/v1/mnet/people/${OTHER}/follow`, 'POST', {});
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /400 follows a day/);
});

test('an ordinary database error keeps its own status', async () => {
  fake({ followError: { code: '23503', message: 'violates foreign key' } });
  const res = await call(`/v1/mnet/people/${OTHER}/follow`, 'POST', {});
  assert.equal(res.status, 400);
});

test('editing a post past 2,000 characters is refused before the write', async () => {
  const calls = fake();
  const res = await call(`/v1/mnet/posts/${POST}`, 'PATCH', { body: 'b'.repeat(2001) });
  assert.equal(res.status, 413);
  assert.ok(!calls.some((c) => c.m === 'PATCH'), 'nothing is written');
});

test('editing a reply past 1,000 characters is refused before the write', async () => {
  const calls = fake({ existing: { id: POST, author_m_uid: MUID, body: 'old', media: [], reply_to_id: OTHER } });
  const res = await call(`/v1/mnet/posts/${POST}`, 'PATCH', { body: 'b'.repeat(1001) });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /Replies are limited to 1,000/);
  assert.ok(!calls.some((c) => c.m === 'PATCH'), 'nothing is written');
});
