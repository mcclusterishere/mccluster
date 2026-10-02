/* Going live. Only the owner desk and accepted fellows can start a broadcast;
   the publish URL goes only to the host and never into the database; ending
   deletes the Cloudflare live input; a stranger can neither end, re-publish,
   nor put someone else's broadcast on air. Driven against fake Supabase and a
   fake Cloudflare Stream API. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi } from '../src/platform-api.js';

const BASE = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const ENV = { ...BASE, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok' };
const HOST = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const OLD = '44444444-4444-4444-8444-444444444444';
const MUID = '55555555-5555-4555-8555-555555555555';
const WHIP = 'https://customer-x.cloudflarestream.com/SECRET/webRTC/publish';
const WHEP = 'https://customer-x.cloudflarestream.com/in1/webRTC/play';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fake({ me = HOST, canHost = true, admin = false, open = [], status = 'starting' } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    calls.push({ u, m, body: init.body ? String(init.body) : '' });
    const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (u.endsWith('/auth/v1/user')) return ok({ id: me });
    if (u.includes('/rpc/live_can_host')) return ok(canHost);
    if (u.includes('/rpc/eu_is_admin')) return ok(admin);
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: MUID }]);
    if (u.startsWith('https://api.cloudflare.com/')) {
      if (m === 'POST') return ok({ success: true, result: { uid: 'in1', webRTC: { url: WHIP }, webRTCPlayback: { url: WHEP } } });
      if (m === 'GET') return ok({ success: true, result: { uid: 'in1', webRTC: { url: WHIP } } });
      return ok({ success: true, result: null });
    }
    if (u.includes('/network_live_sessions') && m === 'GET' && u.includes('status=in.')) return ok(open);
    if (u.includes('/network_live_sessions') && m === 'GET') return ok([{ id: SESSION, host_user_id: HOST, host_m_uid: MUID, title: 'Block clean-up', status, cf_input_uid: 'in1', whep_url: WHEP, post_id: null }]);
    if (u.includes('/network_live_sessions') && m === 'POST') return ok([{ id: SESSION, title: 'Block clean-up', status: 'starting' }], 201);
    if (u.includes('/platform_apps')) return ok([{ id: 'app1' }]);
    if (u.includes('/network_posts') && m === 'POST') return ok([{ id: 'post1' }], 201);
    return ok([]);
  };
  return calls;
}
const call = (path, method = 'GET', body) => handlePlatformApi(new Request(`https://api.test${path}`, { method, headers: { authorization: 'Bearer user', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), ENV);
const cf = (calls) => calls.filter((c) => c.u.startsWith('https://api.cloudflare.com/'));

test('a member who is not a fellow cannot go live, and Cloudflare is never asked', async () => {
  const calls = fake({ canHost: false });
  const res = await call('/v1/mnet/live', 'POST', { title: 'Hi' });
  assert.equal(res.status, 403);
  assert.equal(cf(calls).length, 0);
});

test('without the Stream secrets, going live says it is not switched on', async () => {
  fake();
  const res = await handlePlatformApi(new Request('https://api.test/v1/mnet/live', { method: 'POST', headers: { authorization: 'Bearer user' }, body: JSON.stringify({ title: 'Hi' }) }), BASE);
  assert.equal(res.status, 503);
});

test('a fellow goes live: one new input, the publish URL only in the reply, never stored', async () => {
  const calls = fake({ open: [{ id: OLD, cf_input_uid: 'old-input' }] });
  const res = await call('/v1/mnet/live', 'POST', { title: 'Block clean-up' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.whip_url, WHIP);
  assert.equal(body.session.whep_url, WHEP);
  const insert = calls.find((c) => c.u.endsWith('/network_live_sessions') && c.m === 'POST');
  assert.ok(insert, 'session written');
  assert.ok(!insert.body.includes('SECRET'), 'the publish URL is not written to the database');
  assert.ok(cf(calls).some((c) => c.m === 'DELETE' && c.u.endsWith('/live_inputs/old-input')), 'the broadcast left running is ended first');
  assert.ok(cf(calls).some((c) => c.m === 'POST' && c.u.endsWith('/stream/live_inputs')));
});

test('only the host can put a broadcast on air, heartbeat it, or fetch its publish URL', async () => {
  for (const act of [['on-air', 'POST'], ['heartbeat', 'POST'], ['publish', 'GET']]) {
    const calls = fake({ me: OTHER });
    const res = await call(`/v1/mnet/live/${SESSION}/${act[0]}`, act[1]);
    assert.equal(res.status, 404, act[0]);
    assert.equal(cf(calls).length, 0, act[0]);
    assert.ok(!calls.some((c) => c.m === 'PATCH'), act[0]);
  }
});

test('on air: the host gets a public feed post that points at the broadcast', async () => {
  const calls = fake();
  const res = await call(`/v1/mnet/live/${SESSION}/on-air`, 'POST');
  assert.equal(res.status, 200);
  const post = calls.find((c) => c.u.endsWith('/network_posts') && c.m === 'POST');
  assert.ok(post && JSON.parse(post.body).metadata.live.session_id === SESSION);
  const patch = calls.find((c) => c.m === 'PATCH' && c.u.includes('/network_live_sessions'));
  assert.equal(JSON.parse(patch.body).status, 'live');
});

test('a stranger cannot end a broadcast; the desk can, and the input is deleted', async () => {
  let calls = fake({ me: OTHER, admin: false, status: 'live' });
  assert.equal((await call(`/v1/mnet/live/${SESSION}/end`, 'POST')).status, 404);
  assert.equal(cf(calls).length, 0);
  calls = fake({ me: OTHER, admin: true, status: 'live' });
  assert.equal((await call(`/v1/mnet/live/${SESSION}/end`, 'POST')).status, 200);
  assert.ok(cf(calls).some((c) => c.m === 'DELETE' && c.u.endsWith('/live_inputs/in1')));
  const patch = calls.find((c) => c.m === 'PATCH');
  assert.equal(JSON.parse(patch.body).end_reason, 'desk');
});

test('an ended broadcast cannot be re-published', async () => {
  fake({ status: 'ended' });
  assert.equal((await call(`/v1/mnet/live/${SESSION}/publish`)).status, 410);
});

test('the cron ends broadcasts with no heartbeat and deletes their Stream inputs', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    calls.push({ u, m, body: init.body ? String(init.body) : '' });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (u.includes('/network_live_sessions') && m === 'GET') return ok([{ id: SESSION, cf_input_uid: 'gone1' }]);
    if (u.startsWith('https://api.cloudflare.com/')) return ok({ success: true, result: null });
    return ok([]);
  };
  const { reapStaleLiveSessions } = await import('../src/platform-api.js');
  const out = await reapStaleLiveSessions(ENV);
  assert.equal(out.ended, 1);
  const q = calls.find((c) => c.u.includes('/network_live_sessions') && c.m === 'GET').u;
  assert.match(q, /status=in\.\(starting,live\)/);
  assert.match(q, /last_seen_at\.lt\./, 'only broadcasts whose heartbeat stopped');
  assert.ok(cf(calls).some((c) => c.m === 'DELETE' && c.u.endsWith('/live_inputs/gone1')));
  assert.equal(JSON.parse(calls.find((c) => c.m === 'PATCH').body).end_reason, 'stale');
});

test('a person can be looked up by m_uid, so the watch screen can name the host', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url); calls.push(u);
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (u.endsWith('/auth/v1/user')) return ok({ id: OTHER });
    if (u.includes('/m_auth_user_links?m_uid=eq.')) return ok([{ auth_user_id: HOST }]);
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: '66666666-6666-4666-8666-666666666666' }]);
    if (u.includes(`/platform_profiles?user_id=eq.${HOST}`)) return ok([{ user_id: HOST, display_name: 'Kofi', mccluster_id: 'kofi' }]);
    if (u.includes('/network_profiles')) return ok([{ m_uid: MUID, display_name: 'Kofi', visibility: 'public' }]);
    return ok([]);
  };
  const res = await call(`/v1/mnet/people/${MUID}`);
  assert.notEqual(res.status, 404, 'an m_uid resolves');
  assert.ok(calls.some((u) => u.includes(`/m_auth_user_links?m_uid=eq.${MUID}`)));
});
