/* The Stripe commerce reconciler, from a verified event to the ledger.
   Before it, a paid checkout for any of the live offerings left no order, no
   payment and no follow-up anywhere McCluster could see. These tests pin the
   event mapping (supabase/functions/stripe-webhook/commerce.ts, run under
   Node's TypeScript stripping), the webhook's routing and the database
   boundary. The database behaviour itself is exercised by
   supabase/tests/commerce_stripe_reconciler_regression.sql in CI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  checkoutRecord, refundRecord, invoiceRecord, subscriptionEndedRecord, orgFor
} from '../../supabase/functions/stripe-webhook/commerce.ts';

const read = (p) => readFile(p, 'utf8');
const EVENT = { id: 'evt_1', created: 1791288000, livemode: true };
const SESSION = {
  id: 'cs_live_a1B2c3D4e5F6',
  mode: 'payment',
  payment_status: 'paid',
  payment_intent: 'pi_3Abc123',
  amount_total: 4000,
  currency: 'usd',
  customer_details: { email: 'buyer@example.com', name: 'Buyer One', phone: '+12035550100' },
  shipping_details: { name: 'Buyer One', address: { line1: '1 Main St', line2: null, city: 'Bridgeport', state: 'CT', postal_code: '06604', country: 'US' } },
  metadata: { offering: 'print-11x14', payment_account_reference: 'mccluster-primary' }
};

test('a paid offering checkout maps to one ledger record', () => {
  const r = checkoutRecord(SESSION, EVENT);
  assert.deepEqual(r, {
    session_id: 'cs_live_a1B2c3D4e5F6', payment_intent: 'pi_3Abc123', invoice: null, subscription: null,
    offering: 'print-11x14', kind: null, email: 'buyer@example.com', name: 'Buyer One', phone: '+12035550100',
    shipping: { name: 'Buyer One', line1: '1 Main St', line2: null, city: 'Bridgeport', state: 'CT', postal_code: '06604', country: 'US' },
    amount_cents: 4000, currency: 'usd', paid_at: '2026-10-06T12:00:00.000Z', livemode: true, org_id: null
  });
});

test('only paid commerce is recorded', () => {
  assert.equal(checkoutRecord({ ...SESSION, payment_status: 'unpaid' }, EVENT), null, 'an unpaid session (async methods) waits for async_payment_succeeded');
  assert.notEqual(checkoutRecord({ ...SESSION, amount_total: 0, payment_status: 'no_payment_required' }, EVENT), null, 'a fully discounted sale is still a sale');
  assert.equal(checkoutRecord({ ...SESSION, metadata: { uid: 'u1' } }, EVENT), null, 'a non-offering session (the premium plan) is not commerce');
  const music = checkoutRecord({ ...SESSION, metadata: { kind: 'music_license_sale', music_order_id: 'o1' }, shipping_details: null }, EVENT);
  assert.equal(music.kind, 'music_license_sale');
  assert.equal(music.offering, null);
  assert.equal(music.shipping, null);
  assert.equal(checkoutRecord({ ...SESSION, customer_details: {}, customer_email: 'legacy@example.com' }, EVENT).email, 'legacy@example.com');
  assert.equal(checkoutRecord(SESSION, { ...EVENT, livemode: false }).livemode, false, 'test mode is carried through');
});

test('a connected seller’s sale is booked to that seller’s org, never to the house', () => {
  const connected = { ...EVENT, account: 'acct_1Seller' };
  assert.equal(checkoutRecord(SESSION, connected), null, 'no org named: skipped, not booked as McCluster revenue');
  const withOrg = checkoutRecord({ ...SESSION, metadata: { ...SESSION.metadata, mccluster_org_id: '123e4567-e89b-42d3-a456-426614174000' } }, connected);
  assert.equal(withOrg.org_id, '123e4567-e89b-42d3-a456-426614174000');
  assert.deepEqual(orgFor(EVENT, {}), { org_id: null }, 'a platform event belongs to the house');
});

test('subscriptions, renewals, refunds and cancellations map to their records', () => {
  const sub = checkoutRecord({ ...SESSION, mode: 'subscription', payment_intent: null, invoice: 'in_1First', subscription: { id: 'sub_1Abc' }, shipping_details: null, metadata: { offering: 'anti-social-m' } }, EVENT);
  assert.equal(sub.subscription, 'sub_1Abc', 'expanded objects are read by id');
  assert.equal(sub.invoice, 'in_1First');
  assert.equal(sub.payment_intent, null, 'filled in from the invoice by the webhook');

  assert.deepEqual(refundRecord({ payment_intent: 'pi_3Abc123', amount: 4000, amount_refunded: 1000, metadata: {} }, EVENT),
    { payment_intent: 'pi_3Abc123', amount_cents: 4000, amount_refunded: 1000, livemode: true, org_id: null });
  assert.equal(refundRecord({ payment_intent: null, amount: 1 }, EVENT), null);
  assert.equal(refundRecord({ payment_intent: 'pi_x', amount: 1, metadata: {} }, { ...EVENT, account: 'acct_1' }), null, 'a connected refund needs its org, carried on the payment since this change');

  const classic = invoiceRecord({ id: 'in_2Renew', subscription: 'sub_1Abc', payment_intent: 'pi_2Renew', billing_reason: 'subscription_cycle',
    amount_paid: 87500, currency: 'usd', status_transitions: { paid_at: 1793966400 }, lines: { data: [{ period: { end: 1796558400 } }] } }, EVENT);
  assert.equal(classic.subscription, 'sub_1Abc');
  assert.equal(classic.paid_at, '2026-11-06T12:00:00.000Z');
  assert.equal(classic.period_end, '2026-12-06T12:00:00.000Z');
  const modern = invoiceRecord({ id: 'in_3Renew', parent: { subscription_details: { subscription: 'sub_1Abc', metadata: {} } }, amount_paid: 87500, billing_reason: 'subscription_cycle' }, EVENT);
  assert.equal(modern.subscription, 'sub_1Abc', 'newer API versions nest the subscription under parent');
  assert.equal(invoiceRecord({ id: 'in_4OneOff', amount_paid: 100 }, EVENT), null, 'a one-off invoice is not a renewal');

  assert.deepEqual(subscriptionEndedRecord({ id: 'sub_1Abc', metadata: {} }, EVENT), { subscription: 'sub_1Abc', livemode: true, org_id: null });
});

test('the webhook verifies the signature first, then routes each commerce event to its database function', async () => {
  const hook = await read('supabase/functions/stripe-webhook/index.ts');
  const verify = hook.indexOf('constructEventAsync');
  for (const call of ['await recordCheckout(s, event)', 'rpc("commerce_record_stripe_refund"', 'rpc("commerce_record_stripe_invoice"', 'rpc("commerce_record_stripe_subscription_ended"']) {
    const at = hook.indexOf(call);
    assert.ok(verify > 0 && at > verify, `nothing is recorded before the signature is verified (${call})`);
  }
  assert.match(hook, /event\.type === "checkout\.session\.completed"[\s\S]*?await recordCheckout\(s, event\);/);
  assert.match(hook, /event\.type === "checkout\.session\.async_payment_succeeded"[\s\S]*?await recordCheckout\(s, event\);/);
  assert.match(hook, /event\.type === "charge\.refunded"[\s\S]*?rpc\("commerce_record_stripe_refund", refund\)/);
  assert.match(hook, /event\.type === "invoice\.paid"[\s\S]*?rpc\("commerce_record_stripe_invoice", invoice\)/);
  assert.match(hook, /event\.type === "customer\.subscription\.deleted"[\s\S]*?rpc\("commerce_record_stripe_subscription_ended", ended\)/);
  assert.match(hook, /stripe\.invoices\.retrieve\(record\.invoice, opts\)/, 'a subscription’s first payment is recorded under the payment intent a refund will name');
  assert.match(hook, /return new Response\("retry", \{ status: 500 \}\)/, 'a failed write makes Stripe retry');
  assert.match(hook, /stripe_events\?event_id=eq\./, 'a delivered event is processed once');
  const checkout = await read('supabase/functions/checkout/index.ts');
  assert.match(checkout, /\{ subscription_data: \{ metadata \} \} : \{ payment_intent_data: \{ metadata \} \}/, 'the sale’s metadata travels with the payment, so refunds find their org');
});

test('the database functions are server-only, definer-safe and idempotent by construction', async () => {
  const dir = 'supabase/migrations';
  const name = (await readdir(dir)).find((f) => /_commerce_stripe_reconciler_v1\.sql$/.test(f));
  assert.ok(name, 'the reconciler migration is recorded under its production version');
  const sql = await read(`${dir}/${name}`);
  for (const fn of ['commerce_record_stripe_checkout', 'commerce_record_stripe_refund', 'commerce_record_stripe_invoice', 'commerce_record_stripe_subscription_ended']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(p jsonb\\)\\s+returns jsonb\\s+language plpgsql\\s+security definer\\s+set search_path = ''`), `${fn} pins its search path`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\(jsonb\\) from public, anon, authenticated;`), `${fn} is not callable from a browser`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\(jsonb\\) to service_role;`));
  }
  assert.match(sql, /create unique index if not exists work_orders_source_uidx\s+on public\.work_orders \(org_id, source_table, source_id\)/, 'one order per checkout session');
  assert.match(sql, /on conflict \(org_id, provider, provider_reference\) where provider_reference is not null do nothing/, 'one payment per provider reference');
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('commerce:stripe_checkout:' \|\| v_session\)\)/, 'concurrent deliveries of one session are serialised');
  assert.match(sql, /add column if not exists livemode boolean not null default true/, 'test mode is recorded, not guessed');
  const ci = await read('.github/workflows/api-economic-core-ci.yml');
  assert.match(ci, /-f supabase\/tests\/commerce_stripe_reconciler_regression\.sql/, 'the SQL regression runs in CI against a fresh database');
});
