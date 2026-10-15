/* One M Account, every host: the sign-in handoff route.
   workers/mccluster/src/auth-handoff.js */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleAuthHandoff, HANDOFF_PATH } from '../src/auth-handoff.js';

const ENV = { SUPABASE_URL: 'https://zmnhbrjyhxzhkxmhkexs.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-fixture' };
const URL_ = 'https://api.mccluster.org' + HANDOFF_PATH;
const req = (method, headers = {}, body) => new Request(URL_, { method, headers, body });

/* a fake Supabase: who the bearer is, and the admin link endpoint */
function supabase({ user = { id: 'u-1', email: 'ana@example.org' }, userOk = true, linkOk = true, linkBody } = {}) {
  const asked = [];
  const fetchImpl = async (u, init = {}) => {
    asked.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify(userOk ? user : { msg: 'invalid' }), { status: userOk ? 200 : 401, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/auth/v1/admin/generate_link')) return new Response(JSON.stringify(linkBody || { action_link: 'https://x/verify?token=abc', hashed_token: 'hash-fixture', verification_type: 'magiclink' }), { status: linkOk ? 200 : 422, headers: { 'content-type': 'application/json' } });
    throw new Error('unexpected fetch ' + u);
  };
  return { asked, fetchImpl };
}

test('the route answers only its own path, and preflights with the ecosystem CORS', async () => {
  assert.equal(await handleAuthHandoff(new Request('https://api.mccluster.org/v1/mnet/feed'), ENV), null);
  const pre = await handleAuthHandoff(req('OPTIONS', { origin: 'https://humanuprise.com' }), ENV);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://humanuprise.com');
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  const get = await handleAuthHandoff(req('GET', { origin: 'https://humanuprise.com' }), ENV);
  assert.equal(get.status, 405);
});

test('only the ecosystem\'s own origins may carry a sign-in across', async () => {
  const { fetchImpl, asked } = supabase();
  for (const origin of ['', 'https://evil.example', 'https://humanuprise.com.evil.example', 'http://humanuprise.com']) {
    const r = await handleAuthHandoff(req('POST', { origin, authorization: 'Bearer tok' }), ENV, fetchImpl);
    assert.equal(r.status, 403, origin || '(no origin)');
  }
  assert.equal(asked.length, 0, 'nothing is asked of Supabase for a foreign origin');
  for (const origin of ['https://humanuprise.com', 'https://www.humanuprise.com', 'https://matthew.mccluster.org', 'http://127.0.0.1:4173']) {
    const r = await handleAuthHandoff(req('POST', { origin, authorization: 'Bearer tok' }), ENV, fetchImpl);
    assert.equal(r.status, 200, origin);
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
  }
});

test('the bearer is the arriving page\'s proof, checked live; an API key or no token is refused', async () => {
  const { fetchImpl } = supabase();
  assert.equal((await handleAuthHandoff(req('POST', { origin: 'https://humanuprise.com' }), ENV, fetchImpl)).status, 401);
  assert.equal((await handleAuthHandoff(req('POST', { origin: 'https://humanuprise.com', authorization: 'Bearer mcc_apikey' }), ENV, fetchImpl)).status, 401);
  const bad = supabase({ userOk: false });
  const r = await handleAuthHandoff(req('POST', { origin: 'https://humanuprise.com', authorization: 'Bearer expired' }), ENV, bad.fetchImpl);
  assert.equal(r.status, 401);
  assert.equal(bad.asked.length, 1, 'no link is minted for a token Supabase rejects');
  assert.equal(bad.asked[0].headers.authorization, 'Bearer expired', 'the page\'s own token is what Supabase checks');
  assert.equal(bad.asked[0].headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
});

test('a magic-link token for the same account comes back, and nothing else', async () => {
  const { fetchImpl, asked } = supabase();
  const r = await handleAuthHandoff(req('POST', { origin: 'https://humanuprise.com', authorization: 'Bearer good', 'content-type': 'application/json' }, '{}'), ENV, fetchImpl);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const body = await r.json();
  assert.deepEqual(body, { token_hash: 'hash-fixture', type: 'magiclink', origin: 'https://humanuprise.com' });
  assert.ok(!('refresh_token' in body) && !('access_token' in body) && !('action_link' in body), 'no session material and no clickable link leaves the route');
  const link = asked[1];
  assert.equal(link.url, ENV.SUPABASE_URL + '/auth/v1/admin/generate_link');
  assert.equal(link.method, 'POST');
  assert.deepEqual(link.body, { type: 'magiclink', email: 'ana@example.org' });
  assert.equal(link.headers.authorization, 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY, 'the admin API takes the service role');
});

test('the supabase-js shape (properties.hashed_token) is read too; a failed link is a 502; no email is a 409; no config is a 503', async () => {
  const shaped = supabase({ linkBody: { properties: { hashed_token: 'nested-hash' } } });
  assert.equal((await (await handleAuthHandoff(req('POST', { origin: 'https://humanuprise.com', authorization: 'Bearer good' }), ENV, shaped.fetchImpl)).json()).token_hash, 'nested-hash');
  const failed = supabase({ linkOk: false });
  assert.equal((await handleAuthHandoff(req('POST', { origin: 'https://humanuprise.com', authorization: 'Bearer good' }), ENV, failed.fetchImpl)).status, 502);
  const noEmail = supabase({ user: { id: 'u-2', email: '' } });
  const r = await handleAuthHandoff(req('POST', { origin: 'https://humanuprise.com', authorization: 'Bearer good' }), ENV, noEmail.fetchImpl);
  assert.equal(r.status, 409);
  assert.equal(noEmail.asked.length, 1, 'no link is minted without an email');
  assert.equal((await handleAuthHandoff(req('POST', { origin: 'https://humanuprise.com', authorization: 'Bearer good' }), {}, supabase().fetchImpl)).status, 503);
});

test('the platform entry consults the handoff after the rate limit and before the creator routes', async () => {
  const src = await readFile(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  const i = src.indexOf('enforceApiRateLimit(request, env)');
  const j = src.indexOf('await handleAuthHandoff(request, env)');
  const k = src.indexOf('handleCreatorSiteView(request, env)');
  assert.ok(i > 0 && j > i && k > j, 'the handoff is rate-limited like every route and answers before the catch-alls');
});
