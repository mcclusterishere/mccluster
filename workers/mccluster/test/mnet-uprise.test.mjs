/* UPRISE, NOT LIKE (owner, 2026-10-14). The one reaction on a post, and it
   counts only from a member who has completed a mission: a verified
   assignment of their own on a mission that is not a clip job. Driven
   against a fake Supabase; the server decides, whatever the page shows. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi } from '../src/platform-api.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const MUID = '11111111-1111-4111-8111-111111111111';
const POST = '33333333-3333-4333-8333-333333333333';
const CIVIC = '55555555-5555-4555-8555-555555555555';
const CLIP = '66666666-6666-4666-8666-666666666666';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fake(verified) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url)), m = init.method || 'GET';
    calls.push({ u, m, body: init.body ? JSON.parse(init.body) : null });
    const ok = (d, status = 200) => new Response(JSON.stringify(d), { status });
    if (u.endsWith('/auth/v1/user')) return ok({ id: 'user-1' });
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: MUID }]);
    if (u.includes('/network_posts?id=eq.' + POST)) return ok([{ id: POST, author_m_uid: MUID, visibility: 'public', deleted_at: null, group_id: null }]);
    if (u.includes('/action_mission_assignments?m_uid=eq.' + MUID + '&status=eq.verified')) return ok(verified.map((v) => ({ mission_id: v.id })));
    if (u.includes('/action_missions?id=in.(')) return ok(verified.filter((v) => v.kind !== 'clip').map((v) => ({ id: v.id })));
    if (u.includes('/network_reactions')) return ok([], m === 'POST' ? 201 : 200);
    return ok([]);
  };
  return calls;
}
const call = (method) => handlePlatformApi(new Request(`https://api.test/v1/mnet/posts/${POST}/reactions`, {
  method, headers: { authorization: 'Bearer t', origin: 'https://matthew.mccluster.org', 'content-type': 'application/json' }, body: JSON.stringify({ reaction: 'uprise' })
}), ENV);

test('a member with no verified action cannot uprise: 403, the reason named, nothing written', async () => {
  const calls = fake([]);
  const res = await call('POST');
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /Complete a mission to uprise/);
  assert.equal(body.detail.reason, 'no_verified_action');
  assert.ok(!calls.some((c) => c.u.includes('/network_reactions')), 'no reaction row is written');
});

test('a verified clip job is paid work, not a completed mission', async () => {
  const calls = fake([{ id: CLIP, kind: 'clip' }]);
  assert.equal((await call('POST')).status, 403);
  assert.ok(!calls.some((c) => c.u.includes('/network_reactions')));
});

test('one verified mission unlocks it: the uprise is written as the stored reaction', async () => {
  const calls = fake([{ id: CLIP, kind: 'clip' }, { id: CIVIC, kind: 'civic' }]);
  const res = await call('POST');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { uprised: true, liked: true });
  const write = calls.find((c) => c.u.includes('/network_reactions') && c.m === 'POST');
  assert.ok(write, 'the reaction row is written');
  assert.equal(write.body.reaction, 'like', 'stored under the existing reaction value; no table change');
  assert.equal(write.body.actor_m_uid, MUID);
});

test('taking an uprise back is never gated', async () => {
  const calls = fake([]);
  const res = await call('DELETE');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { uprised: false, liked: false });
  assert.ok(calls.some((c) => c.u.includes('/network_reactions') && c.m === 'DELETE'));
});
