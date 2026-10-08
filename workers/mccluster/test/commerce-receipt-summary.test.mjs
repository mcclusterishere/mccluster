/* Commerce reads: the buyer's receipt after Stripe, and the verified-sales
   totals Control and Analytics share. What matters: the receipt answers by
   Checkout Session id only, carries nothing personal, and says when it is a
   test; the totals count verified live money net of refunds and never add a
   test payment. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkoutReceipt, receiptFromRecords, SESSION_ID } from '../src/commerce/receipt.js';
import { commerceSummary, loadCommerceSummary, refundedOf } from '../src/commerce/summary.js';
import { businessSnapshot } from '../src/analytics/router.js';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const SID = 'cs_live_a1B2c3D4e5F6g7H8';
const ORDER = {
  id: '9a1c2b3d-0000-4000-8000-000000000001', state: 'paid', amount_cents: 15000, currency: 'usd', livemode: true,
  placed_at: '2026-10-07T12:00:00Z',
  items: [{ title: 'Booking deposit', offering: 'booking-deposit', fulfillment_type: 'service_scheduling', shipping: { line1: '1 Main St' } }]
};
const PAYMENT = { id: 'p1', state: 'paid', amount_cents: 15000, provider: 'stripe', provider_reference: 'pi_secret', note: 'buyer@example.com', refunded_cents: 0 };

function fakeDb(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    calls.push(u.pathname.replace('/rest/v1/', '') + u.search);
    for (const [prefix, rows] of routes) if (u.pathname.endsWith(`/rest/v1/${prefix}`)) return reply(typeof rows === 'function' ? rows(u) : rows);
    return reply({ message: 'unexpected' }, 500);
  };
  return { calls, fetchImpl };
}

test('the receipt answers by session id and carries nothing personal', async () => {
  const { calls, fetchImpl } = fakeDb([['work_orders', [ORDER]], ['work_payments', [PAYMENT]], ['work_bookings', [{ state: 'proposed', starts_at: null }]]]);
  const r = await checkoutReceipt(env, SID, fetchImpl);
  assert.deepEqual(r, {
    ok: true, recorded: true, test: false, item: 'Booking deposit', state: 'paid', amount_cents: 15000, currency: 'usd',
    refunded_cents: 0, next: 'schedule', billing_interval: null, booking: { state: 'proposed', starts_at: null }, placed_at: '2026-10-07T12:00:00Z'
  });
  const text = JSON.stringify(r);
  for (const secret of ['buyer@example.com', 'pi_secret', '1 Main St', ORDER.id]) assert.ok(!text.includes(secret), `no ${secret} in the receipt`);
  assert.match(calls[0], /^work_orders\?source_table=eq\.stripe_checkout&source_id=eq\.cs_live_a1B2c3D4e5F6g7H8&/);
  assert.match(calls.find((c) => c.startsWith('work_payments')), /renewal_id=is\.null&select=\*/, 'the checkout payment, with refunded_cents when v3 has it');
});

test('the receipt refuses anything but a Checkout Session id, before any read', async () => {
  for (const bad of ['', 'cs_live_short', "cs_live_abcdefgh' or 1=1", 'pi_3Abc12345678', 'cs_prod_abcdefgh12']) {
    const { calls, fetchImpl } = fakeDb([]);
    await assert.rejects(() => checkoutReceipt(env, bad, fetchImpl), (e) => e.status === 400, bad);
    assert.equal(calls.length, 0);
  }
  assert.ok(SESSION_ID.test('cs_test_a1B2c3D4e5F6g7H8'));
});

test('not recorded yet, test mode, refunds, renewals and shipping each say what happens next', () => {
  assert.deepEqual(receiptFromRecords('cs_test_a1B2c3D4e5F6', null, null, null), { ok: true, recorded: false, test: true });
  assert.equal(receiptFromRecords(SID, { ...ORDER, livemode: false }, PAYMENT, null).test, true, 'a test record says so');
  assert.equal(receiptFromRecords(SID, { ...ORDER, state: 'cancelled' }, { ...PAYMENT, state: 'refunded' }, null).next, 'refunded');
  const partly = receiptFromRecords(SID, ORDER, { ...PAYMENT, refunded_cents: 5000 }, null);
  assert.equal(partly.refunded_cents, 5000);
  assert.equal(partly.next, 'schedule');
  const monthly = receiptFromRecords(SID, { ...ORDER, items: [{ title: 'Hosting', fulfillment_type: 'none', billing_interval: 'month' }] }, PAYMENT, null);
  assert.equal(monthly.next, 'renews');
  assert.equal(receiptFromRecords(SID, { ...ORDER, items: [{ title: 'Print', fulfillment_type: 'physical_shipping' }] }, PAYMENT, null).next, 'ship');
  assert.equal(receiptFromRecords(SID, { ...ORDER, items: [{ title: 'File', fulfillment_type: 'digital_delivery' }] }, PAYMENT, null).next, 'deliver');
  assert.equal(receiptFromRecords(SID, { ...ORDER, items: [] }, PAYMENT, null).next, 'follow_up');
});

const P = (o) => ({ provider: 'stripe', verification: 'provider_verified', state: 'paid', currency: 'usd', livemode: true, paid_at: '2026-10-07T12:00:00Z', ...o });

test('verified live sales are counted net of refunds; test money is apart and never added', () => {
  const payments = [
    P({ amount_cents: 4000 }),
    P({ amount_cents: 10000, refunded_cents: 2500 }),                 // partial refund (v3)
    P({ amount_cents: 3000, state: 'refunded' }),                      // full refund recorded by v1/v2
    P({ amount_cents: 87500, renewal_id: 'r1', paid_at: '2026-09-01T00:00:00Z' }),
    P({ amount_cents: 15000, livemode: false }),                       // test mode
    P({ amount_cents: 999, currency: 'eur' }),                         // not converted
    { ...P({ amount_cents: 5000 }), verification: 'owner_recorded' },  // typed in, not verified
    P({ amount_cents: 700, state: 'due' })
  ];
  const orders = [{ id: 'o1', livemode: true, placed_at: '2026-10-07T12:00:00Z' }, { id: 'o2', livemode: false, placed_at: '2026-10-07T12:00:00Z' }];
  const bookings = [{ id: 'b1', order_id: 'o1', state: 'proposed', created_at: '2026-10-07T13:00:00Z' }, { id: 'b2', order_id: null, state: 'confirmed', created_at: '2026-09-02T00:00:00Z' },
    { id: 'b3', order_id: 'o2', state: 'proposed', created_at: '2026-10-07T13:00:00Z' }];
  const s = commerceSummary({ payments, orders, bookings }, { since: '2026-10-01T00:00:00Z', until: '2026-10-08T00:00:00Z' });
  assert.deepEqual(s.live, { payments: 4, renewal_payments: 1, gross_cents: 104500, refunded_cents: 5500, net_cents: 99000, orders: 1,
    bookings: { total: 2, proposed: 1, confirmed: 1, completed: 0 } });
  assert.deepEqual(s.live_in_window, { payments: 3, renewal_payments: 0, gross_cents: 17000, refunded_cents: 5500, net_cents: 11500, orders: 1,
    bookings: { total: 1, proposed: 1, confirmed: 0, completed: 0 } });
  assert.equal(s.test.payments, 1);
  assert.equal(s.test.gross_cents, 15000);
  assert.equal(s.test.orders, 1);
  assert.equal(s.other_currency_payments, 1);
  assert.equal(refundedOf({ amount_cents: 100, refunded_cents: 400 }), 100, 'never more than the payment');
  assert.equal(commerceSummary({}).live.net_cents, 0);
});

test('the house org only: a connected seller’s sales are not McCluster revenue', async () => {
  const seen = [];
  const s = await loadCommerceSummary(async (path) => {
    seen.push(path);
    if (path.startsWith('orgs?')) return [{ id: 'house-1' }];
    if (path.startsWith('work_payments?')) return [P({ amount_cents: 100 })];
    return [];
  });
  assert.equal(s.available, true);
  assert.equal(s.live.net_cents, 100);
  assert.ok(seen.slice(1).every((p) => p.includes('org_id=eq.house-1')), 'every read is scoped to the house');
  assert.ok(seen.some((p) => /^work_payments\?.*provider=eq\.stripe&verification=eq\.provider_verified/.test(p)));
  assert.deepEqual(await loadCommerceSummary(async () => []), { available: false, reason: 'house org not found' });
});

test('the business snapshot carries commerce, and a commerce failure leaves the rest intact', async () => {
  const original = globalThis.fetch;
  const handler = (failCommerce) => async (url) => {
    const u = new URL(String(url));
    const path = u.pathname;
    if (path.startsWith('/auth/v1/admin/users')) return reply({ users: [] });
    if (path.endsWith('/rest/v1/orgs')) return failCommerce ? reply({ message: 'down' }, 500) : reply([{ id: 'house-1' }]);
    if (path.endsWith('/rest/v1/work_payments')) return reply([P({ amount_cents: 4000 }), P({ amount_cents: 1500, livemode: false })]);
    if (path.endsWith('/rest/v1/work_orders') || path.endsWith('/rest/v1/work_bookings')) return reply([]);
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
  };
  try {
    globalThis.fetch = handler(false);
    const snap = await businessSnapshot(env);
    assert.equal(snap.commerce.available, true);
    assert.equal(snap.commerce.live.net_cents, 4000, 'live only');
    assert.equal(snap.commerce.test.gross_cents, 1500, 'test reported apart');
    globalThis.fetch = handler(true);
    const degraded = await businessSnapshot(env);
    assert.equal(degraded.commerce.available, false);
    assert.ok(degraded.music && degraded.users, 'the rest of the snapshot still answers');
  } finally {
    globalThis.fetch = original;
  }
});
