/* The merch marketplace routes (src/merch/router.js) over fetch doubles: the
   database functions answer as supabase/pending/merch_marketplace_v1.sql
   does, Stripe answers as its API does. What is pinned: the server prices,
   the 15% fee rides on the seller's account as application_fee_amount, tax
   is on and fails closed, US shipping only, a refused checkout gives the unit
   back, sellers only touch their own orders, the owner's actions need
   ops.use on the house org. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleMerchRequest, cleanVariants, cleanListing, TAX_COMPONENTS } from '../src/merch/router.js';
import { MARKETPLACE_PLATFORM_FEE_BPS, marketplaceFee, orderAmounts, orderFeeMismatch } from '../src/merch/fee.js';
import { __resetCapabilityCache } from '../src/lib/capabilities.js';

const SB = 'https://db.fixture';
const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'srv', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const ALICE = { id: 'a1111111-1111-4111-8111-111111111111', email: 'alice@example.com' };
const BOB = { id: 'b2222222-2222-4222-8222-222222222222', email: 'bob@example.com' };
const OWNER = { id: '0aaaaaaa-0000-4000-8000-000000000000', email: 'matthew@mccluster.org' };
const CAROL = { id: 'c3333333-3333-4333-8333-333333333333', email: 'carol@example.com' };
const DAVE = { id: 'd4444444-4444-4444-8444-444444444444', email: 'dave@example.com' };
const ORG_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const HOUSE = 'cccccccc-3333-4333-8333-cccccccccccc';
const ORG_C = 'cccccccc-9999-4999-8999-cccccccccccc';
const LISTING = 'dddddddd-4444-4444-8444-dddddddddddd';
const VARIANT = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const ORDER = 'ffffffff-6666-4666-8666-ffffffffffff';

function world(overrides = {}) {
  const w = {
    calls: [], stripe: [], released: [], attached: [],
    tax: 'active', orderFee: null, stock: 2, sessionFails: false, listingStatus: 'published', stockNow: 1,
    listingPatches: [], variantPatches: [], variantInserts: [], stockCalls: [],
    orders: [{ id: ORDER, seller_org_id: ORG_A, status: 'paid', payment_intent_id: 'pi_1', stripe_account_id: 'acct_1Alpha', total_cents: 5850, amount_refunded_cents: 0 }],
    ...overrides
  };
  w.fetch = async (input, init = {}) => {
    const u = new URL(String(input)), method = init.method || 'GET';
    const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    w.calls.push({ url: u.toString(), method, body, headers: init.headers || {} });
    if (u.origin === 'https://api.stripe.com') {
      const form = new URLSearchParams(init.body || '');
      w.stripe.push({ path: u.pathname, method, form, headers: init.headers || {} });
      if (u.pathname === '/v1/tax/settings') return json({ status: w.tax, status_details: { pending: { missing_fields: w.tax === 'active' ? [] : ['head_office'] } } });
      if (u.pathname === '/v1/checkout/sessions') return w.sessionFails ? json({ error: { message: 'Stripe Tax has not been activated on your account' } }, 400) : json({ id: 'cs_test_Session0001', url: 'https://checkout.stripe.com/c/pay/cs_test_Session0001' });
      if (u.pathname === '/v1/refunds') return json({ id: 're_1', status: 'succeeded', amount: Number(form.get('amount')) });
      if (u.pathname === '/v1/account_sessions') return json({ object: 'account_session', account: form.get('account'), client_secret: 'accs_secret_fixture', expires_at: 1793000000 });
      return json({ error: { message: 'unexpected stripe ' + u.pathname } }, 404);
    }
    if (u.pathname === '/auth/v1/user') {
      const who = { 'Bearer alice': ALICE, 'Bearer bob': BOB, 'Bearer owner': OWNER, 'Bearer carol': CAROL, 'Bearer dave': DAVE }[(init.headers || {}).authorization];
      return who ? json(who) : json({ msg: 'bad jwt' }, 401);
    }
    const p = u.pathname.replace('/rest/v1/', '');
    const q = (k) => (u.searchParams.get(k) || '');
    if (p === 'org_members') {
      const profile = q('profile_id').replace('eq.', '');
      if (q('select').includes('orgs(')) {
        return json(profile === OWNER.id ? [{ role: 'owner', orgs: { id: HOUSE, slug: 'mccluster', name: 'McCluster', kind: 'studio', enabled: true } }] : []);
      }
      const members = { [ALICE.id]: [{ org_id: ORG_A, role: 'owner' }], [BOB.id]: [{ org_id: ORG_B, role: 'owner' }], [CAROL.id]: [{ org_id: ORG_C, role: 'owner' }], [DAVE.id]: [{ org_id: ORG_A, role: 'staff' }] }[profile] || [];
      const roles = (q('role').match(/^in\.\((.*)\)$/) || [, 'owner,staff,viewer'])[1].split(',');
      return json(members.filter((m) => roles.includes(m.role)));
    }
    if (p === 'control_role_capabilities') return json([{ role: 'owner', capability: 'ops.use', allowed: true }]);
    if (p === 'marketplace_sellers') {
      const rows = [{ org_id: ORG_A, slug: 'alpha', display_name: 'Alpha', status: 'approved' }, { org_id: ORG_B, slug: 'bravo', display_name: 'Bravo', status: 'approved' }, { org_id: ORG_C, slug: 'carol', display_name: 'Carol', status: 'applied' }];
      if (method === 'PATCH') return new Response(null, { status: 204 });
      return json(rows.filter((r) => q('org_id').includes(r.org_id) || q('slug') === 'eq.' + r.slug || (!q('org_id') && !q('slug'))));
    }
    if (p === 'marketplace_listings') {
      if (method === 'PATCH') { w.listingPatches.push(body); return new Response(null, { status: 204 }); }
      return json(q('id') === 'eq.' + LISTING && (!q('seller_org_id') || q('seller_org_id') === 'eq.' + ORG_A) ? [{ seller_org_id: ORG_A, id: LISTING, status: w.listingStatus }] : []);
    }
    if (p === 'marketplace_variants') {
      if (method === 'PATCH') { w.variantPatches.push({ query: u.search, body }); return new Response(null, { status: 204 }); }
      if (method === 'POST') { w.variantInserts.push(body); return new Response(null, { status: 201 }); }
      return json([{ id: VARIANT, inventory_count: w.stockNow }]);
    }
    if (p === 'rpc/marketplace_variant_set_stock') {
      w.stockCalls.push(body);
      if (body.p_expected !== w.stockNow) return json({ code: 'P0001', message: 'stock_changed' }, 400);
      w.stockNow = body.p_count; return json({ id: VARIANT, inventory_count: body.p_count });
    }
    if (p === 'org_stripe_accounts') {
      const rails = [
        { org_id: ORG_A, livemode: false, stripe_account_id: 'acct_1Alpha', onboarding_status: 'ready', charges_enabled: true, payouts_enabled: true, details_submitted: true },
        { org_id: ORG_B, livemode: false, stripe_account_id: w.bobAccount === undefined ? 'acct_1Bravo' : w.bobAccount, onboarding_status: 'onboarding', charges_enabled: false, payouts_enabled: false, details_submitted: w.bobAccount !== null },
        { org_id: ORG_C, livemode: false, stripe_account_id: 'acct_1Carol', onboarding_status: 'ready', charges_enabled: true, payouts_enabled: true, details_submitted: true }
      ];
      return json(q('org_id') ? rails.filter((r) => q('org_id') === 'eq.' + r.org_id) : rails);
    }
    if (p === 'marketplace_orders') {
      return json(w.orders.filter((o) => q('id') === 'eq.' + o.id && q('seller_org_id') === 'eq.' + o.seller_org_id));
    }
    if (p === 'rpc/marketplace_order_create') {
      if (w.stock < body.p_quantity) return json({ code: 'P0001', message: 'out_of_stock' }, 400);
      w.created = body;
      return json({ id: ORDER, seller_org_id: ORG_A, stripe_account_id: 'acct_1Alpha', title: 'Alpha Tee', variant_label: 'M / Black',
        quantity: body.p_quantity, unit_price_cents: 2500, subtotal_cents: 2500 * body.p_quantity, shipping_cents: 500,
        fee_basis_cents: 2500 * body.p_quantity + 500, platform_fee_bps: 1500, platform_fee_cents: w.orderFee ?? Math.round((2500 * body.p_quantity + 500) * 0.15), currency: 'usd', livemode: false });
    }
    if (p === 'rpc/marketplace_order_release') { w.released.push(body); return json(true); }
    if (p === 'rpc/marketplace_order_attach_session') { w.attached.push(body); return json(true); }
    if (p === 'rpc/marketplace_seller_set_status') return json({ org_id: body.p_org, status: body.p_status });
    if (p === 'rpc/marketplace_order_by_token') return json(body.p_token === 'T'.repeat(43) ? { id: ORDER, status: 'shipped' } : null);
    if (p === 'rpc/marketplace_public_listings') return json([{ id: LISTING, title: 'Alpha Tee', images: [`${ORG_A}/x.jpg`], seller: { slug: 'alpha', logo_path: null }, variants: [] }]);
    return json({ message: 'unexpected ' + p }, 404);
  };
  return w;
}
async function call(w, path, { method = 'GET', body, auth, env = ENV } = {}) {
  const prev = globalThis.fetch;
  globalThis.fetch = w.fetch;
  __resetCapabilityCache();
  try {
    const headers = { origin: 'https://matthew.mccluster.org', 'content-type': 'application/json' };
    if (auth) headers.authorization = 'Bearer ' + auth;
    const res = await handleMerchRequest(new Request('https://api.mccluster.org/v1/merch/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, body: await res.json() };
  } finally { globalThis.fetch = prev; }
}

test('the platform fee is 15% of subtotal plus shipping, and equals the database constant', async () => {
  assert.equal(MARKETPLACE_PLATFORM_FEE_BPS, 1500);
  assert.equal(marketplaceFee(5500), 825);
  assert.equal(marketplaceFee(10), 2);
  assert.equal(marketplaceFee(0), 0);
  assert.throws(() => marketplaceFee(-1));
  assert.throws(() => marketplaceFee(1.5));
  assert.deepEqual(orderAmounts({ unitPriceCents: 2500, quantity: 2, shippingCents: 500 }), { subtotalCents: 5000, shippingCents: 500, feeBasisCents: 5500, platformFeeCents: 825, sellerNetBeforeStripeCents: 4675 });
  const sql = await readFile(new URL('../../../supabase/pending/merch_marketplace_v1.sql', import.meta.url), 'utf8');
  assert.match(sql, new RegExp(`create or replace function public\\.marketplace_platform_fee_bps\\(\\)\\s+returns integer language sql immutable set search_path = '' as \\$\\$ select ${MARKETPLACE_PLATFORM_FEE_BPS} \\$\\$;`));
  const order = { unit_price_cents: 2500, quantity: 2, shipping_cents: 500, subtotal_cents: 5000, fee_basis_cents: 5500, platform_fee_bps: 1500, platform_fee_cents: 825 };
  assert.equal(orderFeeMismatch(order), null);
  assert.equal(orderFeeMismatch({ ...order, platform_fee_cents: 0 }), 'fee_mismatch');
  assert.equal(orderFeeMismatch({ ...order, platform_fee_bps: 1000 }), 'fee_bps_mismatch');
  assert.equal(orderFeeMismatch({ ...order, fee_basis_cents: 5000 }), 'fee_basis_mismatch');
  assert.equal(orderFeeMismatch({ ...order, quantity: 'x' }), 'invalid_order');
});

test('checkout: a direct charge on the seller account with the server fee, Stripe Tax and US shipping', async () => {
  const w = world();
  const r = await call(w, 'checkout', { method: 'POST', body: { listing_id: LISTING, variant_id: VARIANT, quantity: 2, price_cents: 1, application_fee_amount: 0, account: 'acct_1Evil' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.url, 'https://checkout.stripe.com/c/pay/cs_test_Session0001');
  assert.match(r.body.order_token, /^[A-Za-z0-9_-]{43}$/);
  const s = w.stripe.find((x) => x.path === '/v1/checkout/sessions');
  assert.equal(s.headers['Stripe-Account'], 'acct_1Alpha', 'charged on the seller, not on McCluster');
  assert.equal(s.headers['Idempotency-Key'], 'merch-checkout-' + ORDER);
  assert.equal(s.form.get('payment_intent_data[application_fee_amount]'), '825', 'the fee comes from the database order');
  assert.equal(s.form.get('automatic_tax[enabled]'), 'true');
  assert.equal(s.form.get('shipping_address_collection[allowed_countries][0]'), 'US');
  assert.equal(s.form.get('shipping_address_collection[allowed_countries][1]'), null);
  assert.equal(s.form.get('line_items[0][price_data][unit_amount]'), '2500', 'the browser price is ignored');
  assert.equal(s.form.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
  assert.equal(s.form.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '500');
  assert.equal(s.form.get('metadata[kind]'), 'marketplace_sale');
  assert.equal(s.form.get('metadata[marketplace_order_id]'), ORDER);
  assert.equal(s.form.get('metadata[mccluster_org_id]'), ORG_A);
  assert.equal(s.form.get('payment_intent_data[metadata][mccluster_org_id]'), ORG_A, 'refunds find the seller org');
  assert.match(s.form.get('success_url'), /^https:\/\/matthew\.mccluster\.org\/market\/order\.html\?t=[A-Za-z0-9_-]{43}&done=1$/);
  assert.match(w.created.p_token_hash, /^[0-9a-f]{64}$/, 'only the hash of the buyer token is stored');
  assert.notEqual(w.created.p_token_hash, r.body.order_token);
  assert.deepEqual(w.attached, [{ p_order: ORDER, p_session: 'cs_test_Session0001' }]);
  assert.deepEqual(w.released, []);
});

test('checkout fails closed: tax not active, Stripe refusal, inventory exhausted, fee drift, bad input', async () => {
  let w = world({ tax: 'pending' });
  let r = await call(w, 'checkout', { method: 'POST', body: { listing_id: LISTING, variant_id: VARIANT } });
  assert.equal(r.status, 409); assert.equal(r.body.detail.code, 'seller_tax_not_ready');
  assert.equal(w.created, undefined, 'no unit is taken when the seller cannot charge tax');
  w = world({ sessionFails: true });
  r = await call(w, 'checkout', { method: 'POST', body: { listing_id: LISTING, variant_id: VARIANT } });
  assert.equal(r.status, 409); assert.equal(r.body.detail.code, 'seller_tax_not_ready');
  assert.deepEqual(w.released, [{ p_order: ORDER, p_session: null }], 'a checkout Stripe would not open gives the unit back');
  w = world({ stock: 0 });
  r = await call(w, 'checkout', { method: 'POST', body: { listing_id: LISTING, variant_id: VARIANT } });
  assert.equal(r.status, 409); assert.equal(r.body.detail.code, 'out_of_stock');
  assert.equal(w.stripe.filter((x) => x.path === '/v1/checkout/sessions').length, 0);
  w = world({ orderFee: 1 });
  r = await call(w, 'checkout', { method: 'POST', body: { listing_id: LISTING, variant_id: VARIANT } });
  assert.equal(r.status, 500); assert.equal(r.body.detail.code, 'fee_mismatch');
  assert.equal(w.released.length, 1);
  assert.equal(w.stripe.filter((x) => x.path === '/v1/checkout/sessions').length, 0, 'a drifted fee never reaches Stripe');
  for (const body of [{ listing_id: 'x', variant_id: VARIANT }, { listing_id: LISTING, variant_id: VARIANT, quantity: 11 }, { listing_id: LISTING, variant_id: VARIANT, quantity: 0.5 }]) {
    r = await call(world(), 'checkout', { method: 'POST', body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  r = await call(world(), 'checkout', { method: 'POST', body: { listing_id: '99999999-9999-4999-8999-999999999999', variant_id: VARIANT } });
  assert.equal(r.status, 404);
});

test('a seller refunds only its own paid orders, on its own account, returning the fee', async () => {
  let w = world();
  let r = await call(w, `seller/orders/${ORDER}/refund`, { method: 'POST', auth: 'bob', body: {} });
  assert.equal(r.status, 404, 'another seller cannot see the order');
  assert.equal(w.stripe.length, 0);
  w = world();
  r = await call(w, `seller/orders/${ORDER}/refund`, { method: 'POST', auth: 'alice', body: { amount_cents: 1000 } });
  assert.equal(r.status, 202);
  const s = w.stripe.find((x) => x.path === '/v1/refunds');
  assert.equal(s.headers['Stripe-Account'], 'acct_1Alpha');
  assert.equal(s.form.get('refund_application_fee'), 'true');
  assert.equal(s.form.get('payment_intent'), 'pi_1');
  r = await call(world(), `seller/orders/${ORDER}/refund`, { method: 'POST', auth: 'alice', body: { amount_cents: 999999 } });
  assert.equal(r.status, 400, 'never more than was paid');
  r = await call(world(), `seller/orders/${ORDER}/refund`, { method: 'POST', body: {} });
  assert.equal(r.status, 401);
});

test('shipping needs a carrier and a tracking number', async () => {
  const r = await call(world(), `seller/orders/${ORDER}/fulfil`, { method: 'POST', auth: 'alice', body: { status: 'shipped', carrier: 'USPS', tracking_number: '' } });
  assert.equal(r.status, 400);
  const bad = await call(world(), `seller/orders/${ORDER}/fulfil`, { method: 'POST', auth: 'alice', body: { status: 'refunded' } });
  assert.equal(bad.status, 400, 'a seller cannot mark an order refunded');
});

test('owner actions need ops.use on the house org', async () => {
  let r = await call(world(), `admin/sellers/${ORG_A}/approve`, { method: 'POST', auth: 'alice', body: {} });
  assert.equal(r.status, 403);
  r = await call(world(), `admin/sellers/${ORG_A}/approve`, { method: 'POST', body: {} });
  assert.equal(r.status, 401);
  const w = world();
  r = await call(w, `admin/sellers/${ORG_A}/approve`, { method: 'POST', auth: 'owner', body: {} });
  assert.equal(r.status, 200);
  const sent = w.calls.find((c) => c.url.endsWith('/rpc/marketplace_seller_set_status'));
  assert.equal(sent.body.p_status, 'approved');
  assert.equal(sent.body.p_actor, OWNER.id, 'the actor is the signed-in owner, never a body field');
});

test('buyer status by token; public reads carry image URLs; validation of seller input', async () => {
  let r = await call(world(), 'orders/status?token=' + 'T'.repeat(43));
  assert.equal(r.body.order.status, 'shipped');
  r = await call(world(), 'orders/status?token=short');
  assert.equal(r.status, 404);
  r = await call(world(), 'listings');
  assert.equal(r.body.listings[0].image_urls[0], `${SB}/storage/v1/object/public/marketplace-media/${ORG_A}/x.jpg`);
  assert.throws(() => cleanListing({ title: '', price_cents: 1000 }), /title/);
  assert.throws(() => cleanListing({ title: 'Tee', price_cents: 50 }), /Price/);
  assert.throws(() => cleanVariants([{ label: 'M', sku: 'bad sku!' }]), /SKU/);
  assert.deepEqual(cleanVariants([{ label: 'M / Black', options: { Size: 'M', colour: 'Black' }, inventory_count: 3 }])[0],
    { id: null, label: 'M / Black', options: { size: 'M', colour: 'Black' }, sku: null, price_cents: null, inventory_count: 3, expected_inventory: undefined, active: true, position: 0 });
});

test('wiring: the platform entry routes /v1/merch, its preflight is answered, and the Connect rail is reused', async () => {
  const entry = await readFile(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  assert.match(entry, /const merch = await handleMerchRequest\(request, env\);\s+if \(merch\) return merch;/);
  const pre = await readFile(new URL('../src/preflight.js', import.meta.url), 'utf8');
  assert.match(pre, /'\/v1\/merch'/);
  const router = await readFile(new URL('../src/merch/router.js', import.meta.url), 'utf8');
  assert.match(router, /from '\.\.\/connect\.js'/, 'the Express account comes from the Client Connect rail');
  assert.match(router, /from '\.\.\/whip\/stripe\.js'/, 'one Stripe request helper in this Worker');
  assert.doesNotMatch(router, /api\.printful\.com/i, 'no Printful calls in v1');
});

test('sales tax: an Account Session only for the caller\'s own approved seller account, tax components only', async () => {
  let w = world();
  let r = await call(w, 'seller/account-session', { method: 'POST', auth: 'alice', body: { account: 'acct_1Bravo', org: ORG_B } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.client_secret, 'accs_secret_fixture');
  assert.equal(r.body.publishable_key, 'pk_test_fixture');
  const s = w.stripe.find((x) => x.path === '/v1/account_sessions');
  assert.equal(s.form.get('account'), 'acct_1Alpha', 'the body cannot pick another seller\'s account');
  assert.equal(s.headers['Stripe-Account'], undefined, 'created by the platform for the connected account');
  const enabled = [...s.form.keys()].filter((k) => k.startsWith('components[')).map((k) => k.match(/^components\[([a-z_]+)\]/)[1]);
  assert.deepEqual([...new Set(enabled)].sort(), ['notification_banner', 'tax_registrations', 'tax_settings'], 'nothing but tax (+ the banner)');
  assert.deepEqual(Object.keys(TAX_COMPONENTS).sort(), ['notification_banner', 'tax_registrations', 'tax_settings']);
  w = world();
  r = await call(w, 'seller/account-session', { method: 'POST', auth: 'carol', body: {} });
  assert.equal(r.status, 403); assert.equal(r.body.detail.code, 'seller_not_approved', 'not before McCluster approves the shop');
  r = await call(w, 'seller/account-session', { method: 'POST', auth: 'dave', body: {} });
  assert.equal(r.status, 403, 'staff of the shop cannot open the owner\'s tax settings');
  r = await call(w, 'seller/account-session', { method: 'POST', auth: 'owner', body: {} });
  assert.equal(r.status, 403, 'the house owner is not a seller here; Control never mints a seller session');
  r = await call(w, 'seller/account-session', { method: 'POST', body: {} });
  assert.equal(r.status, 401);
  r = await call(world({ bobAccount: null }), 'seller/account-session', { method: 'POST', auth: 'bob', body: {} });
  assert.equal(r.status, 409); assert.equal(r.body.detail.code, 'connect_not_ready');
  r = await call(world(), 'seller/account-session', { method: 'POST', auth: 'alice', env: { ...ENV, STRIPE_PUBLISHABLE_KEY: '' } });
  assert.equal(r.status, 503);
  r = await call(world(), 'seller/account-session', { method: 'POST', auth: 'alice', env: { ...ENV, STRIPE_PUBLISHABLE_KEY: 'pk_live_wrongmode' } });
  assert.equal(r.status, 503, 'a live publishable key with a test secret key is refused');
  assert.equal(w.stripe.filter((x) => x.path === '/v1/account_sessions').length, 0, 'no refused caller reached Stripe');
});

test('saving a listing never writes stock from the snapshot: a changed count is a compare-and-set', async () => {
  /* the seller loaded 3 and typed 5; a checkout reserved one since, so the database holds 2 */
  let w = world({ stockNow: 2 });
  let r = await call(w, `seller/listings/${LISTING}`, { method: 'PATCH', auth: 'alice', body: { title: 'New title', variants: [{ id: VARIANT, label: 'M', inventory_count: 5, expected_inventory: 3 }] } });
  assert.equal(r.status, 409); assert.equal(r.body.detail.code, 'stock_changed', 'a stale stock write is refused');
  assert.ok(w.variantPatches.every((p) => !('inventory_count' in p.body)), 'no PATCH ever carries a stock count');
  assert.equal(w.stockNow, 2, 'the reservation survives');
  w = world({ stockNow: 2 });
  r = await call(w, `seller/listings/${LISTING}`, { method: 'PATCH', auth: 'alice', body: { title: 'New title', variants: [{ id: VARIANT, label: 'M', inventory_count: 3, expected_inventory: 2 }] } });
  assert.equal(r.status, 200, 'after a reload the seller sets 3 against the 2 they now see');
  assert.equal(w.stockNow, 3);
  w = world({ stockNow: 2 });
  r = await call(w, `seller/listings/${LISTING}`, { method: 'PATCH', auth: 'alice', body: { title: 'Only the title', variants: [{ id: VARIANT, label: 'M', inventory_count: 2, expected_inventory: 2 }] } });
  assert.equal(r.status, 200);
  assert.equal(w.stockCalls.length, 0, 'an edit that leaves stock alone does not touch it');
  assert.equal(w.stockNow, 2);
  r = await call(w, `seller/listings/${LISTING}`, { method: 'PATCH', auth: 'alice', body: { variants: [{ id: VARIANT, label: 'M', inventory_count: 9 }] } });
  assert.equal(w.stockCalls.length, 0, 'without the loaded count, stock is left alone');
});

test('a seller can take a waiting (pending_review) or published listing back to draft', async () => {
  for (const status of ['pending_review', 'published']) {
    const w = world({ listingStatus: status });
    const r = await call(w, `seller/listings/${LISTING}`, { method: 'PATCH', auth: 'alice', body: { unpublish: true } });
    assert.equal(r.status, 200);
    assert.deepEqual(w.listingPatches, [{ status: 'draft' }], status);
  }
  const w = world({ listingStatus: 'draft' });
  await call(w, `seller/listings/${LISTING}`, { method: 'PATCH', auth: 'alice', body: { unpublish: true } });
  assert.deepEqual(w.listingPatches, [], 'a draft stays a draft');
});
