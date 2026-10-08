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
  checkoutRecord, refundRecord, invoiceRecord, invoicePaymentIntent, subscriptionEndedRecord, orgFor, commerceCall
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

test('a renewal is recorded under the PaymentIntent a refund will name, on old and new invoice shapes', () => {
  assert.equal(invoicePaymentIntent({ payment_intent: 'pi_old123' }), 'pi_old123');
  assert.equal(invoicePaymentIntent({ payment_intent: { id: 'pi_expanded1' } }), 'pi_expanded1');
  assert.equal(invoicePaymentIntent({ payments: { data: [
    { status: 'canceled', payment: { payment_intent: 'pi_failed01' } },
    { status: 'paid', payment: { payment_intent: 'pi_newShape1' } }
  ] } }), 'pi_newShape1', 'newer API versions list it under invoice.payments');
  assert.equal(invoicePaymentIntent({}), null);
  const modern = invoiceRecord({ id: 'in_5Modern', subscription: 'sub_1Abc', amount_paid: 100,
    payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_modern01' } }] } }, EVENT);
  assert.equal(modern.payment_intent, 'pi_modern01');
});

test('a refund that beats its music checkout still revokes the music', async () => {
  const hook = await read('supabase/functions/stripe-webhook/index.ts');
  assert.match(hook, /clientFor\(event\)\.paymentIntents\.retrieve\(paymentIntent, \{ expand: \["latest_charge"\] \}, opts\)/, 'Stripe decides whether it was refunded');
  assert.match(hook, /if \(paymentIntent && await refundedAtStripe\(paymentIntent, event\)\) await revokeMusicByPaymentIntent\(paymentIntent\);/,
    'a grant is revoked at once when the payment was already refunded');
  assert.match(hook, /await grantMusicOrder\(s, event\);/);
  assert.match(hook, /rpc\("commerce_record_stripe_invoice", await withInvoicePayment\(invoice, event\)\)/,
    'a renewal without its PaymentIntent in the payload reads it from Stripe');
});

test('the webhook verifies the signature first, then routes each commerce event to its database function', async () => {
  const hook = await read('supabase/functions/stripe-webhook/index.ts');
  const verify = hook.indexOf('const verified = await verifiedEvent(raw, sig);');
  for (const call of ['await recordCheckout(s, event)', 'rpc("commerce_record_stripe_refund"', 'rpc("commerce_record_stripe_invoice"', 'rpc("commerce_record_stripe_subscription_ended"']) {
    const at = hook.indexOf(call);
    assert.ok(verify > 0 && at > verify, `nothing is recorded before the signature is verified (${call})`);
  }
  assert.match(hook, /event\.type === "checkout\.session\.completed"[\s\S]*?await recordCheckout\(s, event\);/);
  assert.match(hook, /event\.type === "checkout\.session\.async_payment_succeeded"[\s\S]*?await recordCheckout\(s, event\);/);
  assert.match(hook, /event\.type === "charge\.refunded"[\s\S]*?rpc\("commerce_record_stripe_refund", refund\)/);
  assert.match(hook, /event\.type === "invoice\.paid"[\s\S]*?rpc\("commerce_record_stripe_invoice", await withInvoicePayment\(invoice, event\)\)/);
  assert.match(hook, /event\.type === "customer\.subscription\.deleted"[\s\S]*?rpc\("commerce_record_stripe_subscription_ended", ended\)/);
  assert.match(hook, /client\.invoices\.retrieve\(record\.invoice, opts\)/, 'a subscription’s first payment is recorded under the payment intent a refund will name');
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
  const v2name = (await readdir(dir)).find((f) => /_commerce_stripe_reconciler_v2\.sql$/.test(f));
  assert.ok(v2name, 'the out-of-order fix is recorded under its production version');
  const v2 = await read(`${dir}/${v2name}`);
  assert.match(v2, /revoke all on public\.commerce_stripe_pending from public, anon, authenticated;/, 'deferred events are server-only');
  assert.match(v2, /perform public\.commerce_defer_stripe_event\(v_org, 'refund', v_ref, p\)/, 'a refund that beats its checkout is kept, not acknowledged and lost');
  assert.match(v2, /if v_created and v_live then/, 'a test checkout sets nothing in motion');
  assert.match(v2, /if v_live and v_email is not null then/, 'a test buyer is not made a lead');
  const ci = await read('.github/workflows/api-economic-core-ci.yml');
  assert.match(ci, /-f supabase\/tests\/commerce_stripe_reconciler_regression\.sql/, 'the SQL regression runs in CI against a fresh database');
});

test('test-mode events reach the same function without ever passing for live money', async () => {
  const hook = await read('supabase/functions/stripe-webhook/index.ts');
  assert.match(hook, /const WH_TEST = Deno\.env\.get\("STRIPE_WEBHOOK_SECRET_TEST"\) \|\| "";/, 'the test endpoint secret is optional');
  assert.match(hook, /return \{ event: await stripe\.webhooks\.constructEventAsync\(raw, sig, WH\), testEndpoint: false \};/, 'the endpoint secret is tried first');
  assert.match(hook, /const event = await stripe\.webhooks\.constructEventAsync\(raw, sig, WH_TEST\);\s+return event\.livemode === false \? \{ event, testEndpoint: true \} : null;/,
    'an event only the test secret verifies is accepted only when Stripe marks it test mode');
  assert.match(hook, /if \(!verified\) return new Response\("bad signature", \{ status: 400 \}\);/);
  assert.match(hook, /const stripeTest = \/\^\(sk\|rk\)_test_\/\.test\(SK_TEST\) \? new Stripe\(SK_TEST\) : null;/, 'only a test key is used as the test client');
  assert.match(hook, /event\.livemode === false && stripeTest \? stripeTest : stripe/, 'test objects are read back with the test key');
  assert.doesNotMatch(hook.replace(/stripe\.webhooks\.constructEventAsync/g, ''), /\bstripe\.(invoices|subscriptions|paymentIntents)\./, 'every Stripe read goes through clientFor(event)');
});

test('a test-endpoint event writes TEST commerce rows and changes nothing a real account holds', async () => {
  const hook = await read('supabase/functions/stripe-webhook/index.ts');
  assert.match(hook, /const effects = !verified\.testEndpoint;/);
  const body = hook.slice(hook.indexOf('const effects = !verified.testEndpoint;'));
  /* every write outside the commerce ledger and the livemode-scoped seller row */
  for (const [what, line] of [
    ['a premium plan', /if \(effects && s\.mode === "subscription" && s\.metadata\?\.uid\) \{\s+await patchBy\("providers", "uid", s\.metadata\.uid, \{ plan: "premium" \}\);/],
    ['a plan downgrade', /if \(effects && sub\.metadata\?\.uid\) await patchBy\("providers", "uid", sub\.metadata\.uid, \{ plan: "free" \}\);/],
    ['a provider flag', /if \(effects\) await patchBy\("providers", "stripe_acct", a\.id,/],
    ['a music refund', /if \(effects\) await revokeMusicByPaymentIntent\(/],
    ['an expired music order', /if \(effects && s\.metadata\?\.kind === "music_license_sale"/],
    ['a failed music payment', /if \(effects && p\.metadata\?\.kind === "music_license_sale"/]
  ]) assert.match(body, line, `a test changes no ${what}`);
  assert.equal(body.match(/await grantMusicOrder\(s, event\);/g).length, 2);
  assert.equal(body.match(/if \(effects\) await grantMusicOrder\(s, event\);/g).length, 2, 'a test grants no music licence');
  assert.equal(body.match(/patchBy\(/g).length, 3, 'no other account write is reachable');
  assert.match(body, /org_stripe_accounts\?stripe_account_id=eq\.\$\{encodeURIComponent\(a\.id\)\}&livemode=eq\.\$\{event\.livemode\}/, 'the seller row is scoped to the event mode');
});

test('commerceCall routes each event type exactly as the webhook does', async () => {
  const hook = await read('supabase/functions/stripe-webhook/index.ts');
  const paid = { ...SESSION };
  const cases = [
    ['checkout.session.completed', paid, 'commerce_record_stripe_checkout', /event\.type === "checkout\.session\.completed"[\s\S]*?await recordCheckout\(s, event\);/],
    ['checkout.session.async_payment_succeeded', paid, 'commerce_record_stripe_checkout', /event\.type === "checkout\.session\.async_payment_succeeded"[\s\S]*?await recordCheckout\(s, event\);/],
    ['charge.refunded', { payment_intent: 'pi_3Abc123', amount: 4000, amount_refunded: 500, metadata: {} }, 'commerce_record_stripe_refund', /event\.type === "charge\.refunded"[\s\S]*?rpc\("commerce_record_stripe_refund"/],
    ['invoice.paid', { id: 'in_2Renew', subscription: 'sub_1Abc', payment_intent: 'pi_2Renew', amount_paid: 100 }, 'commerce_record_stripe_invoice', /event\.type === "invoice\.paid"[\s\S]*?rpc\("commerce_record_stripe_invoice"/],
    ['customer.subscription.deleted', { id: 'sub_1Abc', metadata: {} }, 'commerce_record_stripe_subscription_ended', /event\.type === "customer\.subscription\.deleted"[\s\S]*?rpc\("commerce_record_stripe_subscription_ended"/]
  ];
  for (const [type, object, rpc, route] of cases) {
    const call = commerceCall({ ...EVENT, type, data: { object } });
    assert.equal(call?.rpc, rpc, type);
    assert.match(hook, route, `the webhook routes ${type} to ${rpc}`);
  }
  assert.match(hook, /async function recordCheckout[\s\S]*?rpc\("commerce_record_stripe_checkout"/);
  assert.equal(commerceCall({ ...EVENT, type: 'payment_intent.payment_failed', data: { object: { id: 'pi_x' } } }), null, 'a failed attempt records no sale');
  assert.equal(commerceCall({ ...EVENT, type: 'checkout.session.completed', data: { object: { ...SESSION, payment_status: 'unpaid' } } }), null,
    'an unpaid completion waits for async_payment_succeeded');
});

test('pending reconciler v3 serialises deliveries and is exercised in CI', async () => {
  const v3 = await read('supabase/pending/commerce_stripe_reconciler_v3.sql');
  assert.match(v3, /perform pg_advisory_xact_lock\(hashtext\('commerce:stripe_subscription:' \|\| p_subscription\)\);[\s\S]*?perform pg_advisory_xact_lock\(hashtext\('commerce:stripe_reference:' \|\| p_reference\)\);/,
    'one lock order: subscription, then payment reference');
  for (const [fn, lock] of [
    ['commerce_record_stripe_checkout', 'perform public.commerce_stripe_lock(v_sub, v_reference);'],
    ['commerce_record_stripe_refund', 'perform public.commerce_stripe_lock(null, v_ref);'],
    ['commerce_record_stripe_invoice', 'perform public.commerce_stripe_lock(v_sub, v_ref);'],
    ['commerce_record_stripe_subscription_ended', 'perform public.commerce_stripe_lock(v_sub, null);']
  ]) {
    const body = v3.slice(v3.indexOf(`create or replace function public.${fn}(p jsonb)`));
    assert.ok(body.indexOf(lock) > 0 && body.indexOf(lock) < body.indexOf('\n$$;'), `${fn} takes the shared locks`);
  }
  const checkout = v3.slice(v3.indexOf('create or replace function public.commerce_record_stripe_checkout(p jsonb)'));
  assert.ok(checkout.indexOf('commerce_stripe_lock(v_sub, v_reference)') < checkout.indexOf("'commerce:stripe_checkout:'"), 'shared locks before the session lock');
  assert.match(v3, /if v_old\.verification = 'provider_verified' then/, 'a verified row is never rewritten');
  assert.match(v3, /'commerce\.stripe\.payment_promoted'/, 'a promotion is audited');
  assert.match(v3, /if v_refunded <= v_pay\.refunded_cents then/, 'a repeated or older refund changes nothing');
  assert.equal((await readdir('supabase/migrations')).some((f) => /commerce_stripe_reconciler_v3/.test(f)), false, 'v3 is not claimed as applied before it is');
  const ci = await read('.github/workflows/api-economic-core-ci.yml');
  const apply = ci.indexOf('-f supabase/pending/commerce_stripe_reconciler_v3.sql');
  assert.ok(apply > ci.indexOf('-f supabase/tests/commerce_stripe_reconciler_regression.sql'), 'v1/v2 suite first, on production\'s shape');
  assert.ok(ci.indexOf('-f supabase/tests/commerce_stripe_reconciler_v3_regression.sql') > apply, 'then the v3 suite');
  assert.ok(ci.indexOf('bash supabase/tests/commerce_stripe_concurrency.sh') > apply, 'then the race');
});
