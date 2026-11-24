/* RETURNS FOLLOW THE REQUEST (SPEC-PLATFORM 2.9, stage P0).

     node --test scripts/test/supabase-function-returns.test.mjs

   Every Supabase function that names a page for Stripe or Square to send the browser back to builds that
   address with returnOrigin (supabase/functions/_shared/site-hosts.ts, generated from
   data/seo/domain-architecture.json): the request's Origin when it is EXACTLY one of the origins that serve
   pages (scheme and host as the browser sends them; no suffix, prefix or substring match), otherwise today's
   default: the generated fallback (the profile host at P0, where every return went before). shake-order keeps the
   precedence it had before P0: an operator's SITE_URL, when set, is the return for every request; only without one
   does its return follow the request. The three functions that named the dead mcclusterishere.github.io/Here
   address (it answers 404) now land on today's live page for the same flow.

   Each function runs as written (./support/edge-function-handler.mjs): its real handler and the real shared
   modules, with Stripe, Square and the database faked. Per function: the two origins that serve pages, the
   hostile ones, a null Origin and none at all. The two other files of the functions lane, collect and
   gev-proxy, keep answering exactly as before, now from the same generated lists. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEdgeFunction, fakeStripe, fakeSupabase, jsonResponse } from './support/edge-function-handler.mjs';
import { STAGE, RETURN_ORIGINS, RETURN_FALLBACK_ORIGIN, SITE_HOSTS, PLATFORM_ORIGIN, PROFILE_ORIGIN } from '../../supabase/functions/_shared/site-hosts.ts';
import { parseDeclaredFunctions, planDeploy } from '../supabase-functions-deploy.mjs';
import { scanHostLiterals, readPending } from '../../tools/build-site-hosts.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SB = 'https://fixture.supabase.invalid';
const ENV = { STRIPE_SK: 'local-fixture-only', SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'local-fixture-only' };

/* the origins that serve pages, from the generated table; everything else must not steer a return */
const LISTED = [...RETURN_ORIGINS];
const HOSTILE = [
  'https://evilmccluster.org',            /* a suffix match would take it */
  'http://mccluster.org',                 /* the right host on the wrong scheme */
  'mccluster.org.evil.com',               /* no scheme at all */
  'https://mccluster.org.evil.com',       /* a prefix match would take it */
  'https://matthew.mccluster.org.evil.com',
  'https://evil.example',
  'https://www.mccluster.org',            /* a door: it serves no page */
  'https://humanuprise.com',              /* a door, inert */
  'https://MCCLUSTER.ORG',                /* no browser sends it; exact means exact */
  'https://mccluster.org/',               /* an origin has no path */
  'https://mccluster.org:443',            /* nor a default port */
  'null',                                 /* an opaque origin (sandboxed frame, file:) */
  ''
];
const MISSING = undefined;                /* no Origin header at all */
const ORIGINS = [...LISTED, ...HOSTILE, MISSING];
const label = (o) => (o === MISSING ? '(no Origin header)' : JSON.stringify(o));
const expected = (origin, fallback = RETURN_FALLBACK_ORIGIN) => (LISTED.includes(origin) ? origin : fallback);

function post(name, body, headers = {}, origin = MISSING) {
  const h = { 'content-type': 'application/json', ...headers };
  if (origin !== MISSING) h.origin = origin;
  return new Request(`${SB}/functions/v1/${name}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
}

/* a fetch that answers only the calls a scenario expects; anything else fails the test */
function routes(table, seen) {
  return async (url, init = {}) => {
    const href = String(url);
    const method = init.method || 'GET';
    seen.push({ href, method, body: init.body });
    for (const [match, answer] of table) if (match(href, method)) return answer(href, init);
    throw new Error(`unexpected network call: ${method} ${href}`);
  };
}

/* ---------------- the ten return builders (SPEC-PLATFORM 1.2) ---------------- */

const OFFERING = {
  slug: 'fixture-offer', title: 'Fixture offering', short_description: 'A fixture', status: 'live', price_type: 'fixed',
  price: 25, currency: 'usd', payment_provider: 'stripe', payment_account_reference: 'mccluster-primary',
  fulfillment_type: 'digital_delivery', billing_interval: null, inventory_policy: 'available', legal_entity_id: 'fixture',
  revenue_type: 'fixture'
};
const TRACK_ID = '1c6f8d2b-9e3a-4d4c-8b2f-6a7e8f9a0b1c';
const LICENCE = {
  id: '0b5e7c1a-8d2f-4c3b-9a1e-5f6d7e8f9a0b', track_id: TRACK_ID, creator_m_uid: 'creator-fixture', title: 'Non-exclusive licence',
  license_type: 'non_exclusive', price_cents: 2500, currency: 'usd', terms_text: 'Fixture terms.', active: true, checkout_enabled: true,
  creator_tracks: { id: TRACK_ID, title: 'Fixture Song', artist: 'Fixture', status: 'published', rights_status: 'cleared', slug: 'fixture-song',
    approved_master_version_id: '2d7a9e3c-0f4b-4e5d-9c3a-7b8f9a0b1c2d' }
};
const DIRECT = {
  offer_key: 'here--here', catalog_key: 'here:here', title: 'HERE', price_cents: 199, currency: 'usd', active: true,
  sale_starts_at: null, sale_ends_at: null, asset_path: 'direct-sales/here/here/fixture-here.mp3'
};
const ORG = { id: 'org-fixture-id', slug: 'fixture-org', name: 'Fixture Org', enabled: true };
const ORG_ID = '3e8b0f4d-1a5c-4f6e-8d4b-8c9a0b1c2d3e';

const stripeArgs = (calls, method) => calls.filter((c) => c.method === method).map((c) => c.params);
const retire = (on) => (source) => source.replace('const RETIRED = true;', `const RETIRED = ${on};`);

/* name, how to load it, the request, and the return addresses it produced as [key, url] pairs with the
   path and query each must keep (only the origin in front of them follows the request) */
const SCENARIOS = [
  {
    name: 'checkout',
    load: (k) => ({ env: ENV, Stripe: fakeStripe(k.calls), fetch: routes([
      [(u) => u.startsWith(`${SB}/rest/v1/offerings?slug=eq.fixture-offer&status=eq.live`), () => jsonResponse([OFFERING])]
    ], k.seen) }),
    request: (origin) => post('checkout', { offer: 'fixture-offer' }, {}, origin),
    returns: (k) => stripeArgs(k.calls, 'checkout.sessions.create').flatMap((p) => [['success_url', p.success_url], ['cancel_url', p.cancel_url]]),
    paths: () => [['success_url', '/pay.html?offer=fixture-offer&done=1&s={CHECKOUT_SESSION_ID}'], ['cancel_url', '/pay.html?offer=fixture-offer']]
  },
  {
    name: 'checkout (a Square offering)',
    fn: 'checkout',
    load: (k) => ({ env: { ...ENV, SQUARE_ACCESS_TOKEN: 'local-fixture-only', SQUARE_LOCATION_ID: 'LFIXTURE', SQUARE_ENV: 'sandbox' },
      Stripe: fakeStripe(k.calls), fetch: routes([
        [(u) => u.startsWith(`${SB}/rest/v1/offerings?slug=eq.fixture-offer&status=eq.live`), () => jsonResponse([{ ...OFFERING, payment_provider: 'square' }])],
        [(u, m) => u === 'https://connect.squareupsandbox.com/v2/online-checkout/payment-links' && m === 'POST', () => jsonResponse({ payment_link: { url: 'https://square.link/u/fixture' } })]
      ], k.seen) }),
    request: (origin) => post('checkout', { offer: 'fixture-offer' }, {}, origin),
    returns: (k) => k.seen.filter((s) => s.href.includes('online-checkout')).map((s) => ['redirect_url', JSON.parse(s.body).checkout_options.redirect_url]),
    paths: () => [['redirect_url', '/pay.html?offer=fixture-offer&done=1']]
  },
  {
    name: 'music-checkout',
    load: (k) => ({ env: ENV, Stripe: fakeStripe(k.calls), createClient: () => fakeSupabase({
      users: { 'fixture-buyer-token': { id: 'buyer-fixture', email: 'buyer@example.invalid' } }, tables: { music_license_offers: [LICENCE] } }, k.writes) }),
    request: (origin) => post('music-checkout', { offer_id: LICENCE.id }, { authorization: 'Bearer fixture-buyer-token' }, origin),
    returns: (k) => stripeArgs(k.calls, 'checkout.sessions.create').flatMap((p) => [['success_url', p.success_url], ['cancel_url', p.cancel_url]]),
    paths: () => [['success_url', '/listen.html?purchase=success&session_id={CHECKOUT_SESSION_ID}'], ['cancel_url', `/listen.html?purchase=canceled&track=${TRACK_ID}`]]
  },
  {
    name: 'music-direct-checkout',
    load: (k) => ({ env: ENV, Stripe: fakeStripe(k.calls), createClient: () => fakeSupabase({ tables: { music_direct_offers: [DIRECT] } }, k.writes) }),
    request: (origin) => post('music-direct-checkout', { action: 'checkout', offer_key: 'here--here' }, {}, origin),
    returns: (k) => stripeArgs(k.calls, 'checkout.sessions.create').flatMap((p) => [['success_url', p.success_url], ['cancel_url', p.cancel_url]]),
    paths: () => [['success_url', '/purchase.html?session_id={CHECKOUT_SESSION_ID}'], ['cancel_url', '/purchase.html?canceled=1&offer=here--here']]
  },
  {
    name: 'connect-org',
    load: (k) => ({ env: ENV, Stripe: fakeStripe(k.calls), createClient: () => fakeSupabase({
      users: { 'fixture-owner-token': { id: 'owner-fixture' } },
      tables: { orgs: [ORG], org_members: [{ org_id: ORG.id, profile_id: 'owner-fixture', role: 'owner' }], org_stripe_accounts: [] } }, k.writes) }),
    request: (origin) => post('connect-org', { org_slug: 'fixture-org' }, { authorization: 'Bearer fixture-owner-token' }, origin),
    returns: (k) => stripeArgs(k.calls, 'accountLinks.create').flatMap((p) => [['refresh_url', p.refresh_url], ['return_url', p.return_url]]),
    paths: () => [['refresh_url', '/account.html?stripe=refresh&org=fixture-org'], ['return_url', '/account.html?stripe=return&org=fixture-org']]
  },
  {
    name: 'org-connect-onboard',
    load: (k) => ({ env: ENV, Stripe: fakeStripe(k.calls), fetch: routes([
      [(u) => u === `${SB}/auth/v1/user`, () => jsonResponse({ id: 'owner-fixture', email: 'owner@example.invalid' })],
      [(u) => u.startsWith(`${SB}/rest/v1/org_members?`), () => jsonResponse([{ org_id: ORG_ID }])],
      [(u) => u.startsWith(`${SB}/rest/v1/orgs?`), () => jsonResponse([{ id: ORG_ID, name: 'Fixture Org', slug: 'fixture-org' }])],
      [(u, m) => u.startsWith(`${SB}/rest/v1/org_stripe_accounts?org_id=`) && m === 'GET', () => jsonResponse([])],
      [(u, m) => u.startsWith(`${SB}/rest/v1/org_stripe_accounts?on_conflict=`) && m === 'POST', () => new Response(null, { status: 201 })]
    ], k.seen) }),
    request: (origin) => post('org-connect-onboard', { org_id: ORG_ID }, { authorization: 'Bearer fixture-owner-token' }, origin),
    returns: (k) => stripeArgs(k.calls, 'accountLinks.create').flatMap((p) => [['refresh_url', p.refresh_url], ['return_url', p.return_url]]),
    paths: () => [['refresh_url', `/account.html?stripe=refresh&org=${ORG_ID}`], ['return_url', `/account.html?stripe=return&org=${ORG_ID}`]]
  },
  ...[undefined, 'https://shop.fixture.invalid'].map((siteUrl) => ({
    name: siteUrl ? 'shake-order (an operator SITE_URL)' : 'shake-order',
    fn: 'shake-order',
    /* an operator's SITE_URL wins for every request, the origins that serve pages included, as before P0 */
    fixed: siteUrl,
    load: (k) => ({ env: siteUrl ? { ...ENV, SITE_URL: siteUrl } : ENV, Stripe: fakeStripe(k.calls), fetch: routes([
      [(u) => u === `${SB}/rest/v1/shake_open_window?select=*`, () => jsonResponse([{ id: 'window-fixture', fee_cents: 0, taken: 0, max_orders: 10 }])],
      [(u) => u.startsWith(`${SB}/rest/v1/shake_stops?id=eq.stop-fixture&`), () => jsonResponse([{ id: 'stop-fixture', name: 'Fixture Hall', active: true }])],
      [(u) => u.startsWith(`${SB}/rest/v1/shake_products?slug=in.(vanilla)&`), () => jsonResponse([{ slug: 'vanilla', name: 'Vanilla', price_cents: 500, options: [], available: true }])],
      [(u, m) => u === `${SB}/rest/v1/shake_orders` && m === 'POST', () => jsonResponse([{ id: 7 }], 201)],
      [(u, m) => u === `${SB}/rest/v1/shake_orders?id=eq.7` && m === 'PATCH', () => jsonResponse(null, 204)]
    ], k.seen) }),
    request: (origin) => post('shake-order', { action: 'create', stop_id: 'stop-fixture', customer_name: 'Fixture', room_detail: '101',
      contact_phone: '555 0100', items: [{ slug: 'vanilla', qty: 1 }] }, {}, origin),
    returns: (k) => stripeArgs(k.calls, 'checkout.sessions.create').flatMap((p) => [['success_url', p.success_url], ['cancel_url', p.cancel_url]]),
    paths: (k) => [['success_url', `/shakes.html?order=${k.body.claim_token}&session={CHECKOUT_SESSION_ID}`], ['cancel_url', `/shakes.html?order=${k.body.claim_token}&canceled=1`]]
  })),
  {
    name: 'backend-sub',
    here: true,
    load: (k) => ({ env: { ...ENV, PREMIUM_PRICE_ID: 'price_fixture' }, Stripe: fakeStripe(k.calls), fetch: routes([
      [(u) => u === `${SB}/auth/v1/user`, () => jsonResponse({ id: 'desk-fixture', email: 'desk@example.invalid' })],
      [(u) => u.startsWith(`${SB}/rest/v1/providers?uid=eq.desk-fixture&`), () => jsonResponse([{ slug: 'fixture-desk', stripe_customer: 'cus_fixture' }])]
    ], k.seen) }),
    request: (origin) => post('backend-sub', {}, { authorization: 'Bearer fixture-desk-token' }, origin),
    returns: (k) => stripeArgs(k.calls, 'checkout.sessions.create').flatMap((p) => [['success_url', p.success_url], ['cancel_url', p.cancel_url]]),
    paths: () => [['success_url', '/album.html?premium=1'], ['cancel_url', '/album.html']]
  },
  {
    name: 'pay-now (its retired code, switched back on here only)',
    fn: 'pay-now',
    here: true,
    load: (k) => ({ env: ENV, Stripe: fakeStripe(k.calls), edit: retire(false) }),
    request: (origin) => post('pay-now', { slug: 'mccluster', amount: 5, title: 'Fixture' }, {}, origin),
    returns: (k) => stripeArgs(k.calls, 'checkout.sessions.create').flatMap((p) => [['success_url', p.success_url], ['cancel_url', p.cancel_url]]),
    paths: () => [['success_url', '/pay.html?to=mccluster&done=1'], ['cancel_url', '/pay.html?to=mccluster']]
  },
  {
    name: 'connect-onboard (its retired code, switched back on here only)',
    fn: 'connect-onboard',
    here: true,
    load: (k) => ({ env: ENV, Stripe: fakeStripe(k.calls), edit: retire(false), fetch: routes([
      [(u) => u === `${SB}/auth/v1/user`, () => jsonResponse({ id: 'desk-fixture', email: 'desk@example.invalid' })],
      [(u, m) => u.startsWith(`${SB}/rest/v1/providers?uid=eq.desk-fixture&`) && m === 'GET', () => jsonResponse([{ slug: 'fixture-desk', stripe_acct: null, charges_enabled: false }])],
      [(u, m) => u.startsWith(`${SB}/rest/v1/providers?slug=eq.fixture-desk`) && m === 'PATCH', () => jsonResponse(null, 204)]
    ], k.seen) }),
    request: (origin) => post('connect-onboard', {}, { authorization: 'Bearer fixture-desk-token' }, origin),
    returns: (k) => stripeArgs(k.calls, 'accountLinks.create').flatMap((p) => [['refresh_url', p.refresh_url], ['return_url', p.return_url]]),
    paths: () => [['refresh_url', '/album.html'], ['return_url', '/album.html']]
  }
];

async function run(scenario, origin) {
  const k = { calls: [], seen: [], writes: [] };
  const { handler, logged } = await loadEdgeFunction(scenario.fn || scenario.name, scenario.load(k));
  const response = await handler(scenario.request(origin));
  const text = await response.text();
  k.status = response.status;
  k.headers = response.headers;
  try { k.body = JSON.parse(text); } catch { k.body = text; }
  k.logged = logged;
  return k;
}

for (const scenario of SCENARIOS) {
  test(scenario.fixed ? `${scenario.name}: the operator's SITE_URL for every request, whatever the Origin, as before P0`
    : `${scenario.name}: back to the request's origin only when it serves pages, else today's default`, async () => {
    for (const origin of ORIGINS) {
      const k = await run(scenario, origin);
      const where = `${scenario.name}, Origin ${label(origin)}`;
      assert.ok(k.status < 300, `${where}: answered ${k.status} ${JSON.stringify(k.body)} ${JSON.stringify(k.logged)}`);
      const back = scenario.fixed || expected(origin);
      assert.deepEqual(scenario.returns(k), scenario.paths(k).map(([key, path]) => [key, back + path]), where);
    }
  });
}

test('the three that named the dead Here address land on today\'s live page for their flow, never on github.io', async () => {
  const here = SCENARIOS.filter((s) => s.here);
  assert.deepEqual(here.map((s) => s.fn || s.name), ['backend-sub', 'pay-now', 'connect-onboard']);
  for (const scenario of here) {
    for (const origin of [...HOSTILE, MISSING]) {
      const k = await run(scenario, origin);
      for (const [key, url] of scenario.returns(k)) {
        assert.doesNotMatch(url, /github\.io/, `${scenario.name} ${key}`);
        assert.equal(new URL(url).origin, RETURN_FALLBACK_ORIGIN, `${scenario.name} ${key} for ${label(origin)}`);
        const page = new URL(url).pathname.replace(/^\//, '');
        assert.ok(existsSync(join(ROOT, page)), `${page} is a page this repository publishes`);
      }
    }
  }
});

test('pay-now and connect-onboard, as deployed, still refuse every request before Stripe is touched', async () => {
  for (const name of ['pay-now', 'connect-onboard']) {
    for (const origin of ORIGINS) {
      const calls = [];
      const { handler } = await loadEdgeFunction(name, { env: ENV, Stripe: fakeStripe(calls) });
      const response = await handler(post(name, { slug: 'mccluster', amount: 5 }, { authorization: 'Bearer fixture-desk-token' }, origin));
      assert.equal(response.status, 410, `${name} for ${label(origin)}`);
      assert.equal((await response.json()).error, 'gone');
      assert.deepEqual(calls, [], `${name} made no Stripe call`);
    }
  }
});

test('with P0\'s table nothing visible moves: a stranger\'s return lands where every return of the seven went before', () => {
  if (STAGE !== 'P0') return;
  assert.deepEqual(LISTED, ['https://mccluster.org', 'https://matthew.mccluster.org']);
  assert.equal(RETURN_FALLBACK_ORIGIN, 'https://matthew.mccluster.org');
  assert.equal(RETURN_FALLBACK_ORIGIN, PROFILE_ORIGIN);
  assert.ok(LISTED.includes(PLATFORM_ORIGIN) && LISTED.includes(PROFILE_ORIGIN));
});

/* ---------------- CORS of the direct sales functions (_shared/music-direct.ts) ---------------- */

test('music-direct-checkout lets the origins that serve pages read its answer, and names the host the buyer downloads on', async () => {
  const scenario = SCENARIOS.find((s) => s.name === 'music-direct-checkout');
  for (const origin of ORIGINS) {
    const k = await run(scenario, origin);
    const back = expected(origin);
    assert.equal(k.headers.get('access-control-allow-origin'), back, `CORS for ${label(origin)}`);
    assert.equal(k.headers.get('vary'), 'Origin');
    const [params] = stripeArgs(k.calls, 'checkout.sessions.create');
    assert.equal(params.line_items[0].price_data.product_data.description,
      `Full-quality MP3 file by Matthew McCluster, delivered as uploaded (not converted) on ${new URL(back).host}.`);
  }
});

test('the shared CORS rule of the direct sales functions is the generated return list, by exact origin', async () => {
  const shared = await import('../../supabase/functions/_shared/music-direct.ts');
  assert.deepEqual([...shared.ALLOWED_ORIGINS], LISTED);
  assert.equal(shared.SITE, RETURN_FALLBACK_ORIGIN);
  for (const origin of ORIGINS) {
    const headers = shared.corsHeaders(origin === MISSING ? null : origin);
    assert.equal(headers['Access-Control-Allow-Origin'], expected(origin), label(origin));
  }
});

/* ---------------- the other two files of the lane: collect and gev-proxy, unchanged answers ---------------- */

async function collectHost(headers) {
  const env = (name) => (name === 'SUPABASE_URL' ? SB : 'not-a-real-secret');
  const seen = [];
  const { handler } = await loadEdgeFunction('collect', { env, fetch: routes([
    [(u, m) => u.startsWith(`${SB}/rest/v1/events?on_conflict=id`) && m === 'POST', (u, init) => jsonResponse(JSON.parse(init.body).map(({ id }) => ({ id })), 201)]
  ], seen) });
  const response = await handler(new Request('https://api.mccluster.org/functions/v1/collect', {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'fixture', ...headers },
    body: JSON.stringify({ device_id: 'fixture-device', session_id: 'fixture-session', events: [{ name: 'page_view', path: '/' }] })
  }));
  assert.equal(response.status, 200);
  const insert = seen.find((s) => s.href.includes('/rest/v1/events?on_conflict=id'));
  return JSON.parse(insert.body)[0].source_host;
}

test('collect counts a visit as first-party only from the site\'s own hosts (the generated list), never a look-alike', async () => {
  for (const host of SITE_HOSTS) assert.equal(await collectHost({ origin: `https://${host}` }), host, host);
  assert.deepEqual(new Set(SITE_HOSTS), new Set(['mccluster.org', 'www.mccluster.org', 'matthew.mccluster.org', 'humanuprise.com', 'www.humanuprise.com']),
    'the hosts collect named before it read the generated list');
  for (const origin of ['https://evilmccluster.org', 'https://mccluster.org.evil.com', 'https://matthew.mccluster.org.evil.com', 'mccluster.org.evil.com',
    'https://api.mccluster.org', 'https://here.mccluster.org', 'https://evil.example', 'null']) {
    assert.equal(await collectHost({ origin }), null, origin);
  }
  /* a host label, not a return: the scheme never mattered to it and still does not */
  assert.equal(await collectHost({ origin: 'http://mccluster.org' }), 'mccluster.org');
  assert.equal(await collectHost({ referer: 'https://humanuprise.com/a?b=c' }), 'humanuprise.com');
  assert.equal(await collectHost({}), null);
});

test('gev-proxy answers CORS to the origins that serve pages and its old and local previews, by exact origin, as before', async () => {
  const allowed = [...LISTED, 'https://mcclusterishere.github.io', 'http://localhost:4173', 'http://localhost:5173'];
  for (const origin of [...allowed, ...HOSTILE, MISSING]) {
    const { handler } = await loadEdgeFunction('gev-proxy', { env: {} });
    const headers = origin === MISSING ? {} : { origin };
    const preflight = await handler(new Request(`${SB}/functions/v1/gev-proxy?path=health`, { method: 'OPTIONS', headers }));
    const health = await handler(new Request(`${SB}/functions/v1/gev-proxy?path=health`, { headers }));
    const want = allowed.includes(origin) ? origin : RETURN_FALLBACK_ORIGIN;
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), want, `preflight ${label(origin)}`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), want, `health ${label(origin)}`);
  }
});

/* ---------------- the lane is done, and a change to the table reaches production ---------------- */

const LANE = ['checkout', 'music-checkout', 'music-direct-checkout', 'connect-org', 'org-connect-onboard', 'shake-order', 'backend-sub', 'pay-now',
  'connect-onboard', 'collect', 'gev-proxy'];

test('no Supabase function names a site host in code any more; each reads the generated module', () => {
  assert.deepEqual(scanHostLiterals().filter((r) => r.file.startsWith('supabase/functions/')), []);
  assert.deepEqual(readPending().functions.files, [], 'scripts/test/site-hosts-pending/functions.json is empty');
  for (const name of LANE) {
    const src = readFileSync(join(ROOT, 'supabase/functions', name, 'index.ts'), 'utf8');
    assert.match(src, /^import \{[^}]*\} from "\.\.\/_shared\/site-hosts\.ts";$/m, `${name} imports the generated module`);
    assert.doesNotMatch(src, /mcclusterishere\.github\.io\/Here/, `${name} never names the dead Here address`);
  }
  assert.match(readFileSync(join(ROOT, 'supabase/functions/_shared/music-direct.ts'), 'utf8'), /^import \{[^}]*\} from "\.\/site-hosts\.ts";$/m);
});

test('a change to the generated module redeploys every function that reads it (scripts/supabase-functions-deploy.mjs)', () => {
  const dir = join(ROOT, 'supabase/functions');
  const declared = parseDeclaredFunctions(readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8'));
  const existing = new Set(readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_shared' && existsSync(join(dir, e.name, 'index.ts'))).map((e) => e.name));
  const sources = new Map();
  const walk = (rel) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (/\.(m?[jt]sx?|json)$/.test(e.name)) sources.set(p, readFileSync(join(ROOT, p), 'utf8'));
    }
  };
  walk('supabase/functions');
  const plan = planDeploy({ changedPaths: ['supabase/functions/_shared/site-hosts.ts'], declared, existing, sources });
  for (const name of [...LANE, 'music-direct-access', 'stripe-webhook']) assert.ok(plan.functions.includes(name), `${name} is redeployed`);
  assert.deepEqual(plan.undeclared, []);
  /* and CI type-checks exactly that set with Deno, the runtime it deploys on */
  const workflow = readFileSync(join(ROOT, '.github/workflows/supabase-functions-site-hosts.yml'), 'utf8');
  const listed = /for fn in ([a-z0-9 -]+); do/.exec(workflow);
  assert.ok(listed, 'the workflow names the functions it type-checks');
  assert.deepEqual(listed[1].trim().split(/\s+/).sort(), [...plan.functions].sort());
  assert.match(workflow, /deno check --node-modules-dir=auto supabase\/functions\/_shared\/site-hosts\.ts/);
});
