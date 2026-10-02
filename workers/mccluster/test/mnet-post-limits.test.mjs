/* Spam limits on Action Network posts. The table refuses a post over 5,000
   characters (MN413) and a member posting too fast (MN429); the Worker turns
   those into a 413 and a 429 with the table's own sentence, and refuses an
   over-long post itself before ever writing it, instead of cutting it short.
   Driven against a fake Supabase. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi } from '../src/platform-api.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const USER = '11111111-1111-4111-8111-111111111111';
const MUID = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fake({ insertError = null, patchError = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    calls.push({ u, m });
    const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (u.endsWith('/auth/v1/user')) return ok({ id: USER });
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: MUID }]);
    if (u.includes('/platform_apps')) return ok([{ id: 'app1' }]);
    if (u.includes('/network_posts') && m === 'POST') return insertError ? ok(insertError, 400) : ok([{ id: POST, author_m_uid: MUID, body: 'hi' }], 201);
    if (u.includes('/network_posts') && m === 'PATCH') return patchError ? ok(patchError, 400) : ok([{ id: POST, author_m_uid: MUID, body: 'x' }]);
    if (u.includes('/network_posts') && m === 'GET') return ok([{ id: POST, author_m_uid: MUID, body: 'old', media: [] }]);
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

test('a post over 5,000 characters is refused, never cut short and never written', async () => {
  const calls = fake();
  const res = await call('/v1/mnet/posts?app_key=mccluster-web', 'POST', { body: 'a'.repeat(5001) });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /5,000 characters/);
  assert.equal(inserts(calls).length, 0, 'nothing is written');
});

test('a post of exactly 5,000 characters goes through', async () => {
  fake();
  const res = await call('/v1/mnet/posts?app_key=mccluster-web', 'POST', { body: 'a'.repeat(5000) });
  assert.equal(res.status, 201);
});

test('posting too fast answers 429 with the table\'s sentence', async () => {
  fake({ insertError: { code: 'MN429', message: 'You are posting too fast. Give it a minute.' } });
  const res = await call('/v1/mnet/posts?app_key=mccluster-web', 'POST', { body: 'hello' });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'You are posting too fast. Give it a minute.');
});

test('the table\'s length refusal on a direct-shaped write answers 413', async () => {
  fake({ insertError: { code: 'MN413', message: 'Posts are limited to 5,000 characters.' } });
  const res = await call('/v1/mnet/posts?app_key=mccluster-web', 'POST', { body: 'hello' });
  assert.equal(res.status, 413);
});

test('editing a post past 5,000 characters is refused before the write', async () => {
  const calls = fake();
  const res = await call(`/v1/mnet/posts/${POST}`, 'PATCH', { body: 'b'.repeat(6000) });
  assert.equal(res.status, 413);
  assert.ok(!calls.some((c) => c.m === 'PATCH'), 'nothing is written');
});
