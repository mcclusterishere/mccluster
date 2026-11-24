/* RETURNS FOLLOW THE REQUEST (SPEC-PLATFORM 2.9).

   Where Stripe sends a buyer back after Checkout or Connect onboarding, where a cohort claim links, and where a
   published Reel's action link opens: the request's Origin when it is EXACTLY one of the generated return origins
   (RETURN_ORIGINS in src/platform/hosts.generated.js: scheme and host, nothing else), and today's default otherwise
   (RETURN_FALLBACK_ORIGIN; at stage P0 Matthew's host, where every one of these pages is served today). No suffix or
   substring match, and neither a Referer nor X-Forwarded-Host is ever trusted. One test per module, driven against a
   fake Supabase and a fake Stripe. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RETURN_ORIGINS, RETURN_FALLBACK_ORIGIN } from '../src/platform/hosts.generated.js';
import { handleCreatorCheckout } from '../src/creator-billing.js';
import { handleActionConnect } from '../src/action-connect.js';
import { handleActionArchive } from '../src/action-archive.js';
import clientConnect from '../src/connect.js';
import { handleSocialRequest } from '../src/social/router.js';
import { reply, fail, logEvent } from '../src/lib/http.js';

const PLAT = 'https://mccluster.org';
const PROF = 'https://matthew.mccluster.org';
const DEFAULT = PROF;

test('the generated lists are the ones this test reads: the platform and Matthew\'s host, falling back to his host at P0', () => {
  assert.deepEqual([...RETURN_ORIGINS].sort(), [PLAT, PROF].sort());
  assert.equal(RETURN_FALLBACK_ORIGIN, DEFAULT);
});

/* [what the request carries, the origin a return must name] */
const CASES = [
  ['the platform', { origin: PLAT }, PLAT],
  ['Matthew\'s host', { origin: PROF }, PROF],
  ['no Origin at all', {}, DEFAULT],
  ['a look-alike host', { origin: 'https://evilmccluster.org' }, DEFAULT],
  ['plain http', { origin: 'http://mccluster.org' }, DEFAULT],
  ['the platform as a prefix of another host', { origin: 'https://mccluster.org.evil.com' }, DEFAULT],
  ['an opaque origin', { origin: 'null' }, DEFAULT],
  ['upper case', { origin: 'https://MCCLUSTER.ORG' }, DEFAULT],
  ['a trailing slash', { origin: 'https://mccluster.org/' }, DEFAULT],
  ['another port', { origin: 'https://mccluster.org:8443' }, DEFAULT],
  ['www, a door that serves no page', { origin: 'https://www.mccluster.org' }, DEFAULT],
  ['the legacy-named door', { origin: 'https://humanuprise.com' }, DEFAULT],
  ['a Referer on the platform and no Origin', { referer: `${PLAT}/account.html` }, DEFAULT],
  ['X-Forwarded-Host and Forwarded naming the platform', { 'x-forwarded-host': 'mccluster.org', forwarded: 'host=mccluster.org;proto=https' }, DEFAULT],
  ['a hostile Origin beside a platform Referer', { origin: 'https://evil.example', referer: `${PLAT}/x` }, DEFAULT]
];
const originOf = (u) => new URL(u).origin;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });
function network(answer) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    const method = init.method || (input instanceof Request ? input.method : 'GET');
    const body = init.body ?? null;
    calls.push({ url: String(url), method, body });
    const r = answer(String(url), method, body);
    if (!r) throw new Error(`unexpected request ${method} ${url}`);
    return r;
  };
  return calls;
}
const form = (calls, needle) => new URLSearchParams(calls.find((c) => c.url.includes(needle)).body);

test('creator billing: Checkout returns to mccluster-platform.html on the request\'s origin when it is a return origin, else today\'s', async () => {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', STRIPE_SECRET_KEY: 'sk_test_fixture', CREATOR_STARTER_MONTHLY_PRICE_ID: 'price_fixture1' };
  for (const [label, headers, want] of CASES) {
    const calls = network((url) => {
      if (url === 'https://db.test/auth/v1/user') return json({ id: 'user-1', email: 'buyer@example.test' });
      if (url.startsWith('https://api.stripe.com/v1/checkout/sessions')) return json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
      return null;
    });
    const r = await handleCreatorCheckout(new Request('https://api.mccluster.org/v1/creator-billing/checkout', {
      method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json', ...headers }, body: JSON.stringify({ plan: 'starter', period: 'monthly' })
    }), env);
    assert.equal(r.status, 200, label);
    const sent = form(calls, 'checkout/sessions');
    assert.equal(sent.get('success_url'), `${want}/mccluster-platform.html?checkout=returned&session_id={CHECKOUT_SESSION_ID}`, label);
    assert.equal(sent.get('cancel_url'), `${want}/mccluster-platform.html?checkout=cancelled`, label);
  }
});

test('action connect: Connect onboarding returns to the hire page on the request\'s origin when it is a return origin, else today\'s', async () => {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', STRIPE_SECRET_KEY: 'sk_test_fixture', ACTION_CONNECT_TEST_PILOT: 'true' };
  for (const [label, headers, want] of CASES) {
    const calls = network((url) => {
      if (url === 'https://db.test/auth/v1/user') return json({ id: 'user-1' });
      if (url.startsWith('https://db.test/rest/v1/an_connect_recipients?')) return json([{ user_id: 'user-1', stripe_account_id: 'acct_fixture', environment: 'test' }]);
      if (url.startsWith('https://api.stripe.com/v1/account_links')) return json({ url: 'https://connect.stripe.com/setup/x', expires_at: 1 });
      return null;
    });
    const r = await handleActionConnect(new Request('https://api.mccluster.org/v1/action-connect/onboard', {
      method: 'POST', headers: { authorization: 'Bearer user-token', ...headers }
    }), env);
    assert.equal(r.status, 200, label);
    const sent = form(calls, 'account_links');
    assert.equal(sent.get('refresh_url'), `${want}/action-network-hire.html?connect=refresh`, label);
    assert.equal(sent.get('return_url'), `${want}/action-network-hire.html?connect=returned`, label);
  }
});

test('action archive: a claimed profile links its pages on the request\'s origin when it is a return origin; an origin the API refuses never gets a link', async () => {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' };
  const allowed = ['https://matthew.mccluster.org', 'https://mccluster.org', 'https://humanuprise.com'];
  for (const [label, headers, want] of CASES) {
    network((url) => {
      if (url === 'https://db.test/auth/v1/user') return json({ id: '11111111-1111-4111-8111-111111111111' });
      if (url === 'https://db.test/rest/v1/rpc/action_archive_claim') return json({ project_slug: 'cohort-one', participant_slug: 'ana', m_uid: '22222222-2222-4222-8222-222222222222' });
      return null;
    });
    const r = await handleActionArchive(new Request('https://api.mccluster.org/v1/action-archive/claim', {
      method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json', ...headers }, body: JSON.stringify({ token: 'a'.repeat(64) })
    }), env);
    const data = await r.json();
    if (headers.origin && !allowed.includes(headers.origin)) {
      assert.equal(r.status, 403, `${label}: refused before anything is built`);
      assert.equal(data.profile_url, undefined, label);
      continue;
    }
    assert.equal(r.status, 200, label);
    for (const key of ['profile_url', 'provider_url', 'account_profile_url']) assert.equal(originOf(data[key]), want, `${label}: ${key}`);
    assert.equal(data.profile_url, `${want}/cohort-profile.html?project=cohort-one&person=ana`, label);
  }
});

test('client connect: an onboarding link returns to control.html on the request\'s origin when it is a return origin, else today\'s; an explicit return_url still needs a trusted origin', async () => {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', STRIPE_SECRET_KEY: 'sk_test_fixture', ALLOWED_ORIGINS: 'https://matthew.mccluster.org,https://mccluster.org' };
  const answer = (url) => {
    if (url === 'https://db.test/auth/v1/user') return json({ id: 'user-1' });
    if (url.startsWith('https://db.test/rest/v1/orgs?')) return json([{ id: 'org-1', slug: 'acme', name: 'Acme', kind: 'client' }]);
    if (url.startsWith('https://db.test/rest/v1/org_members?')) return json([{ role: 'owner' }]);
    if (url.startsWith('https://db.test/rest/v1/org_stripe_accounts?')) return json([{ org_id: 'org-1', stripe_account_id: 'acct_fixture', onboarding_status: 'onboarding' }]);
    if (url.startsWith('https://api.stripe.com/v1/account_links')) return json({ url: 'https://connect.stripe.com/setup/x', expires_at: 1 });
    return null;
  };
  const ask = (headers, body = { org: 'acme' }) => {
    const request = new Request('https://api.mccluster.org/v1/connect/onboarding-link', { method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return clientConnect.fetch(request, env, new URL(request.url), reply, fail, logEvent);
  };
  for (const [label, headers, want] of CASES) {
    const calls = network(answer);
    const r = await ask(headers);
    assert.equal(r.status, 200, label);
    const sent = form(calls, 'account_links');
    assert.equal(sent.get('return_url'), `${want}/control.html?connect=return&org=acme`, label);
    assert.equal(sent.get('refresh_url'), `${want}/control.html?connect=refresh&org=acme`, label);
  }
  let calls = network(answer);
  await ask({ origin: PROF }, { org: 'acme', return_url: 'https://mccluster.org/control.html?from=body', refresh_url: 'https://evil.example/x' });
  let sent = form(calls, 'account_links');
  assert.equal(sent.get('return_url'), 'https://mccluster.org/control.html?from=body', 'a trusted explicit return_url stands, as today');
  assert.equal(sent.get('refresh_url'), `${PROF}/control.html?connect=refresh&org=acme`, 'an untrusted one falls back to the request\'s return origin');
  calls = network(answer);
  await ask({ origin: 'https://evil.example' }, { org: 'acme', return_url: 'https://evil.example/steal' });
  sent = form(calls, 'account_links');
  assert.equal(sent.get('return_url'), `${DEFAULT}/control.html?connect=return&org=acme`);
});

test('social: a published Reel\'s action link opens the mission on the request\'s origin when it is a return origin, else today\'s', async () => {
  const ORG = '123e4567-e89b-42d3-a456-426614174000';
  const ACCOUNT = '223e4567-e89b-42d3-a456-426614174000';
  const MISSION = '523e4567-e89b-42d3-a456-426614174000';
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', META_GRAPH_API_VERSION: 'v26.0' };
  for (const [label, headers, want] of CASES) {
    const calls = network((url, method, body) => {
      const ok = (d, s = 200) => json(d, s);
      if (url.includes('/org_members?')) return ok([{ org_id: ORG, role: 'owner' }]);
      if (url.includes('/m_auth_user_links?')) return ok([{ m_uid: '423e4567-e89b-42d3-a456-426614174000' }]);
      if (url.includes('/action_missions?')) return ok([{ id: MISSION, campaign_id: 'end-racism-002', title: 'Do the work', description: 'Complete it.', status: 'open' }]);
      if (url.includes('/social_accounts?')) return ok([{ id: ACCOUNT, org_id: ORG, platform: 'instagram', external_account_id: 'ig-1' }]);
      if (url.includes('/social_content_items') && method === 'POST') return ok([{ ...JSON.parse(body), id: JSON.parse(body).id }], 201);
      if (url.includes('/network_posts?') && method === 'GET') return ok([]);
      if (url.endsWith('/network_posts') && method === 'POST') return ok([{ id: '723e4567-e89b-42d3-a456-426614174000', ...JSON.parse(body) }], 201);
      if (url.includes('/social_publish_jobs') && method === 'POST') return ok([{ id: '323e4567-e89b-42d3-a456-426614174000', ...JSON.parse(body) }], 201);
      return ok([]);
    });
    const request = new Request('https://api.mccluster.org/v1/social/publish', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({
      org_id: ORG, account_id: ACCOUNT, storage_path: `${ORG}/action.mp4`, caption: 'Do something useful.', publish_mode: 'reel',
      action_campaign_id: 'end-racism-002', action_mission_id: MISSION, publish_to_action_network: true
    }) });
    const data = await handleSocialRequest(request, env, { id: 'user-1' });
    assert.equal(originOf(data.action_url), want, label);
    assert.equal(new URL(data.action_url).pathname, '/mnet.html', label);
    const job = JSON.parse(calls.find((c) => c.url.includes('/social_publish_jobs') && c.method === 'POST').body);
    assert.ok(job.payload.caption.includes(`Take action: ${want}/mnet.html?`), label);
    assert.equal(job.payload.action_url, data.action_url, label);
  }
});
