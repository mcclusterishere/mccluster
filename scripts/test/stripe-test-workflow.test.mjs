/* The repeatable Stripe test workflow and what a buyer and the owner see
   after a payment. What matters: the tools never touch real money or a
   hosted database; the payment page confirms from the record and says when
   it is a test; Analytics counts verified live sales and keeps test money
   apart; a booking promises only the email that actually follows. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { isTestKey, isTestSession, form, sessionParams } from '../stripe-test/stripe-test-mode.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const { offerings } = JSON.parse(read('data/offerings.json'));
const offering = (slug) => offerings.find((o) => o.slug === slug);
const run = (args, env = {}) => spawnSync(process.execPath, args, {
  cwd: root, encoding: 'utf8', timeout: 20000,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }
});

test('the test-mode tool accepts Stripe test keys and test sessions only', () => {
  for (const key of ['sk_test_51Abc', 'rk_test_51Abc']) assert.ok(isTestKey(key), key);
  for (const key of ['', 'sk_live_51Abc', 'rk_live_51Abc', 'pk_test_51Abc', 'sk_test_', ' sk_test_51Abc', 'sk_test_51Abc\nsk_live_x']) {
    assert.equal(isTestKey(key), false, JSON.stringify(key));
  }
  assert.ok(isTestSession('cs_test_a1B2c3D4e5F6'));
  for (const id of ['cs_live_a1B2c3D4e5F6', 'cs_test_short', 'pi_test_a1B2c3D4e5F6', 'cs_test_a1B2c3D4/../x']) assert.equal(isTestSession(id), false, id);
});

test('the tool stops before any request without a test key, and on a live key', () => {
  for (const env of [{}, { STRIPE_TEST_KEY: 'sk_live_51Abc' }, { STRIPE_SK_TEST: 'rk_live_51Abc' }]) {
    const r = run(['scripts/stripe-test/stripe-test-mode.mjs', 'checkout', '--offer', 'print-5x7'], env);
    assert.equal(r.status, 2, JSON.stringify(env));
    assert.match(r.stderr, /Live keys are refused/);
  }
  const live = run(['scripts/stripe-test/stripe-test-mode.mjs', 'refund', '--session', 'cs_live_a1B2c3D4e5F6'], { STRIPE_TEST_KEY: 'sk_test_51Abc' });
  assert.equal(live.status, 1);
  assert.match(live.stderr, /test-mode Checkout Session/);
});

test('a test checkout carries the metadata the reconciler reads, priced like the checkout function', () => {
  const base = { site: 'https://matthew.mccluster.org', run: 'tabc' };
  const print = sessionParams(offering('print-11x14'), base);
  assert.equal(print.mode, 'payment');
  assert.equal(print.line_items[0].price_data.unit_amount, 4000);
  assert.deepEqual(print.metadata, { offering: 'print-11x14', payment_account_reference: 'mccluster-primary', test_run: 'tabc' });
  assert.deepEqual(print.payment_intent_data.metadata, print.metadata, 'a refund traces back to the sale');
  assert.deepEqual(print.shipping_address_collection, { allowed_countries: ['US'] });
  assert.match(print.success_url, /\/pay\.html\?offer=print-11x14&done=1&s=\{CHECKOUT_SESSION_ID\}$/);

  const deposit = sessionParams(offering('booking-deposit'), { ...base, amount: '150' });
  assert.equal(deposit.line_items[0].price_data.unit_amount, 15000);
  assert.equal(deposit.shipping_address_collection, undefined);
  assert.throws(() => sessionParams(offering('booking-deposit'), { ...base, amount: '5' }), /between 100 and 10000/);

  const monthly = sessionParams(offering('hosting-monthly'), { ...base, interval: 'month' });
  assert.equal(monthly.mode, 'subscription');
  assert.deepEqual(monthly.line_items[0].price_data.recurring, { interval: 'month' });
  assert.deepEqual(monthly.subscription_data.metadata, monthly.metadata, 'a renewal traces back to the sale');
  assert.throws(() => sessionParams(offering('hosting-monthly'), base), /--interval month or --interval year/);

  const encoded = form(monthly);
  assert.equal(encoded.get('line_items[0][price_data][recurring][interval]'), 'month');
  assert.equal(encoded.get('payment_method_types[0]'), 'card');
  assert.equal(encoded.get('metadata[offering]'), 'hosting-monthly');
});

test('the replay harness refuses hosted Supabase databases before it connects', () => {
  for (const db of [
    'postgresql://postgres:x@db.zmnhbrjyhxzhkxmhkexs.supabase.co:5432/postgres',
    'postgresql://postgres.abc:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
    'postgresql://postgres@zmnhbrjyhxzhkxmhkexs.example/postgres'
  ]) {
    const r = run(['scripts/stripe-test/replay.mjs', '--db', db]);
    assert.equal(r.status, 2, db);
    assert.match(r.stderr, /refusing a hosted Supabase database/);
  }
  const none = run(['scripts/stripe-test/replay.mjs']);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /usage/);
});

test('the payment page confirms from the record, says when it is a test, and can be zoomed', () => {
  const html = read('pay.html');
  const viewport = html.match(/<meta name="viewport" content="([^"]+)">/)[1];
  assert.doesNotMatch(viewport, /user-scalable=no|maximum-scale=1\b/);
  assert.match(html, /id="pwTest" hidden><b>TEST PAYMENT<\/b>/);
  assert.match(html, /id="pwNext" role="status" aria-live="polite" hidden/);
  assert.match(html, /confirmSale\(q\.get\("s"\) \|\| ""\)/);
  assert.match(html, /\/\^cs_\(test\|live\)_\[A-Za-z0-9\]\{8,200\}\$\/\.test\(sid\)/, 'only a session id is sent');
  assert.match(html, /https:\/\/api\.mccluster\.org\/v1\/commerce\/receipt\?session=" \+ encodeURIComponent\(sid\)/);
  assert.match(html, /if \(tries < 8\) \{ setTimeout\(ask, 2500\)/, 'bounded polling');
  assert.match(html, /function esc\(v\)/);
  for (const field of ['j.item', 'j.booking.starts_at']) assert.ok(html.includes(`esc(${field}`) || html.includes(`esc(new Date(${field}`), `${field} is escaped`);
  assert.doesNotMatch(html, /link to pick a time|choose a time below/i, 'no promise of a scheduling link that does not exist');
});

test('Analytics counts verified live Stripe sales and names test money apart', () => {
  const js = read('js/control-room/analytics.js');
  assert.doesNotMatch(js, /not connected to this report/);
  assert.match(js, /var cm=b\.commerce\|\|\{\},sales=cm\.available\?\(b\.window\?cm\.live_in_window:cm\.live\):null/);
  assert.match(js, /metric\("Verified sales",sales\?sales\.net_cents:null/);
  assert.match(js, /kept apart, not revenue/);
  assert.match(js, /Sales records did not load/);
  const work = read('js/control-room/work-records.js');
  assert.match(work, /Net paid/);
  assert.match(work, /refunded_cents/);
});

test('only a booking checkout mentions a time, and only the email that follows', () => {
  const ts = read('supabase/functions/checkout/index.ts');
  const at = ts.indexOf('custom_text');
  assert.ok(at > 0);
  const guard = ts.slice(ts.lastIndexOf('...(', at), at);
  assert.match(guard, /o\.fulfillment_type === "service_scheduling"/);
  assert.match(ts.slice(at, at + 200), /an email from matthew@mccluster\.org to set the time/);
});
