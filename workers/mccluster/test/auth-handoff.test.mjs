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

test('retired handoff fails closed even for a valid bearer on an allowed origin', async () => {
  const { fetchImpl, asked } = supabase();
  for (const origin of ['https://humanuprise.com', 'https://www.humanuprise.com', 'https://matthew.mccluster.org']) {
    const r = await handleAuthHandoff(req('POST', { origin, authorization: 'Bearer tok' }), ENV, fetchImpl);
    assert.equal(r.status, 410);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal(asked.length, 0, 'no user lookup or admin link generation');
});
test('foreign and absent origins remain refused without upstream calls', async () => {
  const { fetchImpl, asked } = supabase();
  for (const origin of ['', 'https://evil.example', 'https://humanuprise.com.evil.example']) {
    assert.equal((await handleAuthHandoff(req('POST', { origin }), ENV, fetchImpl)).status, 403);
  }
  assert.equal(asked.length, 0);
});

test('the platform entry consults the handoff after the rate limit and before the creator routes', async () => {
  const src = await readFile(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  const i = src.indexOf('enforceApiRateLimit(request, env)');
  const j = src.indexOf('await handleAuthHandoff(request, env)');
  const k = src.indexOf('handleCreatorSiteView(request, env)');
  assert.ok(i > 0 && j > i && k > j, 'the handoff is rate-limited like every route and answers before the catch-alls');
});
