/* Merch marketplace v1: the webhook binding (supabase/functions/stripe-webhook/
   marketplace.ts, run under Node's TypeScript stripping), the commerce ledger
   mapping for marketplace sales, and the contracts that hold the pieces
   together: one fee constant in code and database, v1 publishes only what the
   seller ships, nothing is recorded before the signature, the pending SQL is
   listed for promotion, and the pages follow the mobile-first rule.
   The database behaviour itself: scripts/test-merch-marketplace-db.sh. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  marketplaceOrderId, marketplacePaymentRefusal, marketplacePaidRecord, marketplaceExpiry, marketplaceRefund
} from '../../supabase/functions/stripe-webhook/marketplace.ts';
import { checkoutRecord, refundRecord, commerceCall } from '../../supabase/functions/stripe-webhook/commerce.ts';
import { MARKETPLACE_PLATFORM_FEE_BPS } from '../../workers/mccluster/src/merch/fee.js';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');
const ORDER_ID = 'ffffffff-6666-4666-8666-ffffffffffff';
const ORG = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ORDER = {
  id: ORDER_ID, seller_org_id: ORG, stripe_account_id: 'acct_1Alpha', checkout_session_id: 'cs_test_Session0001',
  livemode: false, currency: 'usd', subtotal_cents: 5000, shipping_cents: 500, fee_basis_cents: 5500, status: 'pending'
};
const EVENT = { id: 'evt_1', type: 'checkout.session.completed', account: 'acct_1Alpha', livemode: false, created: 1793000000 };
const SESSION = {
  id: 'cs_test_Session0001', object: 'checkout.session', mode: 'payment', payment_status: 'paid', currency: 'usd',
  amount_subtotal: 5000, amount_total: 5850, total_details: { amount_shipping: 500, amount_tax: 350, amount_discount: 0 },
  payment_intent: 'pi_1', customer_details: { email: 'buyer@example.com', name: 'Buyer' },
  shipping_details: { name: 'Buyer', address: { line1: '1 Main St', line2: null, city: 'Bridgeport', state: 'CT', postal_code: '06604', country: 'US' } },
  metadata: { kind: 'marketplace_sale', marketplace_order_id: ORDER_ID, mccluster_org_id: ORG, marketplace_listing_id: 'x' }
};

test('a marketplace payment binds to its stored order, session, account, mode and amounts', () => {
  assert.equal(marketplacePaymentRefusal(SESSION, EVENT, ORDER), null);
  assert.equal(marketplacePaymentRefusal(SESSION, EVENT, { ...ORDER, status: 'paid' }), null, 'a replay passes the check; the database answers it unchanged');
  const cases = [
    ['wrong connected account', SESSION, { ...EVENT, account: 'acct_1Other' }, ORDER, 'account_mismatch'],
    ['a platform event', SESSION, { ...EVENT, account: undefined }, ORDER, 'platform_event'],
    ['another session', { ...SESSION, id: 'cs_test_Other0002' }, EVENT, ORDER, 'session_mismatch'],
    ['no stored session', SESSION, EVENT, { ...ORDER, checkout_session_id: null }, 'session_mismatch'],
    ['metadata pointing at another order', { ...SESSION, metadata: { ...SESSION.metadata, marketplace_order_id: '11111111-1111-4111-8111-111111111111' } }, EVENT, ORDER, 'order_mismatch'],
    ['metadata naming another org', { ...SESSION, metadata: { ...SESSION.metadata, mccluster_org_id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb' } }, EVENT, ORDER, 'org_mismatch'],
    ['a live event for a test order', SESSION, { ...EVENT, livemode: true }, ORDER, 'mode_mismatch'],
    ['currency swap', { ...SESSION, currency: 'eur' }, EVENT, ORDER, 'currency_mismatch'],
    ['subtotal swap', { ...SESSION, amount_subtotal: 100, amount_total: 950 }, EVENT, ORDER, 'amount_mismatch'],
    ['shipping swap', { ...SESSION, total_details: { ...SESSION.total_details, amount_shipping: 0 }, amount_total: 5350 }, EVENT, ORDER, 'amount_mismatch'],
    ['a discount', { ...SESSION, total_details: { ...SESSION.total_details, amount_discount: 500 }, amount_total: 5350 }, EVENT, ORDER, 'amount_mismatch'],
    ['total not basis + tax', { ...SESSION, amount_total: 1 }, EVENT, ORDER, 'amount_mismatch'],
    ['tax missing', { ...SESSION, total_details: { amount_shipping: 500 } }, EVENT, ORDER, 'amount_mismatch'],
    ['unpaid', { ...SESSION, payment_status: 'unpaid' }, EVENT, ORDER, 'not_paid'],
    ['a subscription', { ...SESSION, mode: 'subscription' }, EVENT, ORDER, 'not_a_payment'],
    ['an expired order', SESSION, EVENT, { ...ORDER, status: 'canceled' }, 'order_not_payable'],
    ['no order', SESSION, EVENT, null, 'order_not_found']
  ];
  for (const [what, s, e, o, want] of cases) assert.equal(marketplacePaymentRefusal(s, e, o), want, what);
});

test('the paid record carries Stripe tax and the shipping address; expiry and refunds are bound to the account', () => {
  const r = marketplacePaidRecord(SESSION, EVENT, ORDER);
  assert.deepEqual(r, {
    order_id: ORDER_ID, session_id: 'cs_test_Session0001', account: 'acct_1Alpha', livemode: false, currency: 'usd', payment_intent: 'pi_1',
    amount_subtotal: 5000, amount_shipping: 500, amount_discount: 0, amount_tax: 350, amount_total: 5850, email: 'buyer@example.com',
    shipping: { name: 'Buyer', line1: '1 Main St', line2: null, city: 'Bridgeport', state: 'CT', postal_code: '06604', country: 'US' }
  });
  assert.deepEqual(marketplaceExpiry(SESSION, EVENT), { order_id: ORDER_ID, session_id: 'cs_test_Session0001' });
  assert.equal(marketplaceExpiry(SESSION, { ...EVENT, account: undefined }), null, 'a platform event expires nothing');
  assert.equal(marketplaceExpiry({ ...SESSION, metadata: { kind: 'music_license_sale' } }, EVENT), null);
  const charge = { payment_intent: 'pi_1', amount: 5850, amount_refunded: 1000, metadata: SESSION.metadata };
  assert.deepEqual(marketplaceRefund(charge, EVENT), { order_id: ORDER_ID, account: 'acct_1Alpha', payment_intent: 'pi_1', livemode: false, amount_refunded: 1000 });
  assert.equal(marketplaceRefund(charge, { ...EVENT, account: null }), null);
  assert.equal(marketplaceOrderId({ metadata: { kind: 'marketplace_sale', marketplace_order_id: 'not-a-uuid' } }), null);
});

test('the commerce ledger books a marketplace sale to the seller org, never to the house', () => {
  const booked = checkoutRecord(SESSION, EVENT);
  assert.equal(booked.org_id, ORG);
  assert.equal(booked.kind, 'marketplace_sale');
  assert.equal(booked.marketplace_order_id, ORDER_ID);
  assert.equal(booked.amount_cents, 5850);
  assert.equal(checkoutRecord(SESSION, { ...EVENT, account: undefined }), null, 'a marketplace sale on the platform account is nobody\'s');
  assert.equal(checkoutRecord({ ...SESSION, metadata: { kind: 'marketplace_sale', marketplace_order_id: ORDER_ID } }, EVENT), null, 'no org named: skipped');
  assert.equal(commerceCall({ ...EVENT, data: { object: SESSION } }).payload.org_id, ORG);
  assert.equal(refundRecord({ payment_intent: 'pi_1', amount: 5850, amount_refunded: 5850, metadata: SESSION.metadata }, EVENT).org_id, ORG);
  /* an offering checkout is unchanged: no marketplace key */
  assert.equal('marketplace_order_id' in checkoutRecord({ ...SESSION, metadata: { offering: 'print-11x14' } }, { ...EVENT, account: undefined }), false);
});

test('the webhook settles a marketplace order after the signature and before the ledger, and books only a bound sale', async () => {
  const hook = await read('supabase/functions/stripe-webhook/index.ts');
  const verify = hook.indexOf('const verified = await verifiedEvent(raw, sig);');
  for (const call of ['await settleMarketplaceOrder(s, event);', 'rpc/marketplace_order_release', 'rpc("marketplace_order_record_refund"']) {
    const at = hook.lastIndexOf(call);
    assert.ok(verify > 0 && at > verify, `nothing is written before the signature (${call})`);
  }
  assert.equal(hook.match(/await settleMarketplaceOrder\(s, event\);\n\s+await recordCheckout\(s, event\);/g).length, 2, 'completed and async_payment_succeeded both settle, then record');
  assert.match(hook, /if \(record\.kind === "marketplace_sale" && !marketplaceBound\.has\(session\)\) return;/, 'an unbound session never reaches the ledger');
  assert.match(hook, /marketplacePaymentRefusal\(session as any, event as any, order\)/);
  assert.match(hook, /rpc\("marketplace_order_mark_paid", marketplacePaidRecord\(session as any, event as any, order\)\)/);
  assert.match(hook, /if \(result\?\.retry\) throw new Error/, 'a refund that beats its payment is retried by Stripe');
  assert.equal(hook.match(/patchBy\(/g).length, 3, 'no new account write: the same three provider writes as before');
});

test('one fee constant in code and database; v1 publishes only what the seller ships; money functions are server-only', async () => {
  const sql = await read('supabase/pending/merch_marketplace_v1.sql');
  assert.equal(MARKETPLACE_PLATFORM_FEE_BPS, 1500);
  assert.match(sql, new RegExp(`marketplace_platform_fee_bps\\(\\)\\s+returns integer language sql immutable set search_path = '' as \\$\\$ select ${MARKETPLACE_PLATFORM_FEE_BPS} \\$\\$`));
  assert.match(sql, /constraint marketplace_listings_v1_seller_ships check \(status <> 'published' or fulfilment_mode = 'seller_ships'\)/);
  assert.match(sql, /fulfilment_mode\s+text not null default 'seller_ships' check \(fulfilment_mode in \('seller_ships', 'pod'\)\)/);
  assert.match(sql, /provider_order_id\s+text,\s+provider_status\s+text,/, 'the POD slot on orders');
  assert.match(sql, /create table if not exists public\.marketplace_seller_providers/, 'the seller-owned Printful account slot');
  const providers = sql.slice(sql.indexOf('create table if not exists public.marketplace_seller_providers'), sql.indexOf(');', sql.indexOf('create table if not exists public.marketplace_seller_providers')));
  assert.doesNotMatch(providers, /token|secret\s+text|api_key/i, 'no provider credential column: a reference to a server-side secret only');
  assert.match(providers, /credential_ref\s+text/);
  assert.match(sql, /alter table public\.marketplace_seller_providers force row level security;/);
  for (const fn of ['marketplace_order_create', 'marketplace_order_mark_paid', 'marketplace_order_record_refund', 'marketplace_seller_set_status', 'marketplace_seller_apply', 'marketplace_listing_set_removed', 'marketplace_order_release']) {
    assert.match(sql, new RegExp(`'public\\.${fn}\\([^']*\\)',?\\n`), `${fn} is in the service-role-only list`);
  }
  assert.match(sql, /execute format\('revoke all on function %s from public, anon, authenticated', f\);\s+execute format\('grant execute on function %s to service_role', f\);/);
  assert.match(sql, /create trigger marketplace_order_guard before insert or update on public\.marketplace_orders/);
  for (const fn of sql.matchAll(/create or replace function (public\.marketplace_[a-z_]+)\([^)]*\)\s+returns[^$]*?(security definer)?[^$]*?set search_path = ''/g)) assert.ok(fn[1]);
  assert.equal((sql.match(/security definer set search_path = ''/g) || []).length >= 15, true, 'every definer pins its search path');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /security definer(?! set search_path = '')/, 'no definer without a pinned search path');
});

test('the pending file is listed for promotion, its callers are named, and its test runs in CI on pull requests only', async () => {
  const readme = await read('supabase/pending/README.md');
  const order = await read('supabase/pending/PROMOTION-ORDER.md');
  assert.match(readme, /merch_marketplace_v1\.sql/);
  assert.match(order, /merch_marketplace_v1\.sql/);
  const callers = JSON.parse(await read('supabase/pending/live-callers.json'));
  for (const name of ['marketplace_order_create', 'marketplace_public_listings', 'marketplace_order_mark_paid', 'marketplace_orders', 'marketplace_sellers']) {
    assert.equal(callers.pending_only[name]?.pending, 'merch_marketplace_v1.sql', name);
  }
  const ci = await read('.github/workflows/merch-marketplace-db.yml');
  assert.match(ci, /on:\n  pull_request:/);
  assert.match(ci, /workflow_dispatch:/);
  assert.doesNotMatch(ci, /\n  push:/, 'never pushes or runs on push');
  assert.doesNotMatch(ci, /git push/);
  assert.match(ci, /bash scripts\/test-merch-marketplace-db\.sh/);
});

test('the pages are McCluster Corp\'s, mobile first, and draw no logo', async () => {
  const domains = JSON.parse(await read('data/seo/domain-architecture.json'));
  for (const page of ['market/index.html', 'market/shop.html', 'market/item.html', 'market/order.html', 'market/sell.html']) {
    const html = await read(page);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1(, viewport-fit=cover)?">/, page);
    assert.doesNotMatch(html, /user-scalable=no|maximum-scale/, page);
    assert.match(html, /McCluster Corp/, `${page} names the company`);
    assert.doesNotMatch(html, /<svg[^>]*>(?![\s\S]*?aria-hidden)/i, `${page}: no inline drawing`);
    assert.ok(domains.url_ownership.company_hosted_on_personal_for_compatibility.includes('/' + page.replace('index.html', '')), `${page} is listed as the company's`);
  }
  const css = await read('css/market.css');
  assert.doesNotMatch(css, /max-width\s*:\s*[0-9.]+px\s*\)/, 'min-width queries only');
  assert.doesNotMatch(css, /@media[^{]*max-width/, 'min-width queries only');
  assert.doesNotMatch(css, /(?<!minmax\(0,\s*)\b1fr\b(?!\))/, 'minmax(0,1fr), never a bare 1fr');
  assert.match(css, /font-size:\s*max\(16px/, 'controls never zoom iOS');
});

test('Control has a Marketplace view in Work, gated by the server', async () => {
  const v2 = await read('js/control-room-v2.js');
  const core = await read('js/control-room/workspace-core.js');
  const html = await read('control.html');
  assert.match(v2, /var WORK_VIEWS = \[[^\]]*"marketplace"/);
  assert.match(core, /const work = \[[^\]]*'marketplace'/);
  assert.match(html, /js\/control-room\/marketplace\.js/);
  const mod = await read('js/control-room/marketplace.js');
  assert.match(mod, /\/v1\/merch\/admin/);
});
