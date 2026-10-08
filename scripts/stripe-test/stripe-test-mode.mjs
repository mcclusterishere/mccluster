#!/usr/bin/env node
/* Stripe TEST MODE against the real site: a repeatable purchase, refund and
   cancellation that moves no money.

   It only ever uses a Stripe test key (sk_test_… or rk_test_…) and refuses
   anything else before making a request. Test-mode payments are recorded by
   the stripe-webhook function as TEST (livemode = false): shown in Control,
   never counted as revenue, and they book, ship and contact nobody.

   Setup (once) and the full runbook: docs/control-plane/COMMERCE-RECONCILER.md
   ("Repeatable testing").

   usage (STRIPE_TEST_KEY=sk_test_… in the environment):
     node scripts/stripe-test/stripe-test-mode.mjs checkout --offer print-11x14
     node scripts/stripe-test/stripe-test-mode.mjs checkout --offer booking-deposit --amount 150
     node scripts/stripe-test/stripe-test-mode.mjs checkout --offer hosting-monthly --interval month
     node scripts/stripe-test/stripe-test-mode.mjs status --session cs_test_…
     node scripts/stripe-test/stripe-test-mode.mjs refund --session cs_test_… [--amount-cents 500]
     node scripts/stripe-test/stripe-test-mode.mjs cancel --session cs_test_…
   options: --site https://matthew.mccluster.org  --api https://api.mccluster.org */
import { readFile } from 'node:fs/promises';

export const isTestKey = (key) => /^(sk|rk)_test_[A-Za-z0-9]+$/.test(String(key || ''));
export const isTestSession = (id) => /^cs_test_[A-Za-z0-9]{8,200}$/.test(String(id || ''));

/* Stripe's form encoding: nested objects and arrays in brackets. */
export function form(params, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? form(item, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

/* The Checkout Session the checkout function would create for this
   offering, with the same metadata the reconciler reads. */
export function sessionParams(offering, { amount, interval, site, run }) {
  const subscribe = offering.action === 'subscribe';
  if (subscribe && interval !== 'month' && interval !== 'year') throw new Error(`${offering.slug} renews: pass --interval month or --interval year (as its database row says)`);
  let usd = offering.price_type === 'custom' ? Number(amount) : Number(offering.price);
  if (offering.price_type === 'custom') {
    const min = Number(offering.min ?? 1), max = Number(offering.max ?? 25000);
    if (!(usd >= min && usd <= max)) throw new Error(`${offering.slug} takes a custom amount: pass --amount between ${min} and ${max}`);
  }
  if (!(usd > 0)) throw new Error(`${offering.slug} has no price`);
  const metadata = { offering: offering.slug, payment_account_reference: 'mccluster-primary', test_run: run };
  const done = `${site}/pay.html?offer=${encodeURIComponent(offering.slug)}`;
  return {
    mode: subscribe ? 'subscription' : 'payment',
    'payment_method_types': ['card'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(usd * 100),
        product_data: { name: `${offering.title} (test)` },
        ...(subscribe ? { recurring: { interval } } : {})
      }
    }],
    ...(/^print-/.test(offering.slug) ? { shipping_address_collection: { allowed_countries: ['US'] } } : {}),
    phone_number_collection: { enabled: true },
    metadata,
    ...(subscribe ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
    success_url: `${done}&done=1&s={CHECKOUT_SESSION_ID}`,
    cancel_url: done
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opt = (name, fallback = null) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : fallback;
  };
  const KEY = process.env.STRIPE_TEST_KEY || process.env.STRIPE_SK_TEST || '';
  if (!isTestKey(KEY)) {
    console.error('Set STRIPE_TEST_KEY to a Stripe TEST key (sk_test_… or rk_test_…). Live keys are refused: this tool never moves real money.');
    process.exit(2);
  }
  const SITE = (opt('site', 'https://matthew.mccluster.org')).replace(/\/+$/, '');
  const API = (opt('api', 'https://api.mccluster.org')).replace(/\/+$/, '');

  async function stripe(method, path, params) {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: params ? form(params).toString() : undefined
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${body?.error?.message || 'request failed'}`);
    if (body && body.livemode === true) throw new Error('Stripe answered with a live object; stopping.');
    return body;
  }
  const session = async (id) => {
    if (!isTestSession(id)) throw new Error('pass --session cs_test_… (a test-mode Checkout Session)');
    return stripe('GET', `checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent&expand[]=invoice`);
  };

  if (command === 'checkout') {
    const slug = opt('offer');
    const { offerings } = JSON.parse(await readFile(new URL('../../data/offerings.json', import.meta.url), 'utf8'));
    const offering = offerings.find((o) => o.slug === slug);
    if (!offering) throw new Error(`no offering "${slug}" in data/offerings.json`);
    const run = `t${Date.now().toString(36)}`;
    const s = await stripe('POST', 'checkout/sessions', sessionParams(offering, { amount: opt('amount'), interval: opt('interval'), site: SITE, run }));
    console.log(`Test checkout for ${offering.title}: ${s.id}\n\n  ${s.url}\n`);
    console.log('Pay on that page with a Stripe test card (any future date, any CVC, any ZIP):');
    console.log('  4242 4242 4242 4242   succeeds');
    console.log('  4000 0000 0000 0002   declined: then pay again on the same page with 4242 (a failed payment, retried)');
    console.log('  4000 0025 0000 3155   asks for 3-D Secure authentication');
    console.log(`\nThen: node scripts/stripe-test/stripe-test-mode.mjs status --session ${s.id}`);
    return;
  }

  if (command === 'status') {
    const id = opt('session');
    const s = await session(id);
    const receipt = await fetch(`${API}/v1/commerce/receipt?session=${encodeURIComponent(id)}`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    const pi = s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent : null;
    console.log(JSON.stringify({
      stripe: { session: s.id, status: s.status, payment_status: s.payment_status, mode: s.mode, livemode: s.livemode,
        amount_total: s.amount_total, payment_intent: pi?.id || null, subscription: s.subscription || null },
      site_receipt: receipt
    }, null, 2));
    if (receipt && receipt.recorded === false && s.payment_status === 'paid') {
      console.log('\nPaid at Stripe but not recorded yet: wait a few seconds and run status again. If it never records, check the');
      console.log('test-mode webhook endpoint and its signing secret (STRIPE_WEBHOOK_SECRET_TEST) and the stripe-webhook function logs.');
    }
    return;
  }

  if (command === 'refund') {
    const s = await session(opt('session'));
    let pi = s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent.id : s.payment_intent;
    if (!pi && s.invoice) {
      const inv = typeof s.invoice === 'object' ? s.invoice : await stripe('GET', `invoices/${encodeURIComponent(s.invoice)}`);
      pi = typeof inv.payment_intent === 'object' ? inv.payment_intent?.id : inv.payment_intent;
    }
    if (!pi) throw new Error('that session has no payment to refund (was it paid?)');
    const cents = opt('amount-cents');
    const refund = await stripe('POST', 'refunds', { payment_intent: pi, ...(cents ? { amount: Number(cents) } : {}) });
    console.log(`Refund ${refund.id}: ${refund.amount} cents, ${refund.status}. Stripe now sends charge.refunded; run status to see it land.`);
    return;
  }

  if (command === 'cancel') {
    const s = await session(opt('session'));
    if (!s.subscription) throw new Error('that session is not a subscription');
    const sub = await stripe('DELETE', `subscriptions/${encodeURIComponent(s.subscription)}`);
    console.log(`Subscription ${sub.id}: ${sub.status}. Stripe now sends customer.subscription.deleted.`);
    return;
  }

  console.error('commands: checkout --offer <slug> [--amount <usd>] [--interval month|year] | status --session <cs_test_…> | refund --session <cs_test_…> [--amount-cents <n>] | cancel --session <cs_test_…>');
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message || err); process.exit(1); });
}
