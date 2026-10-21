#!/usr/bin/env node
/* Stripe webhook replay: every commerce scenario, any delivery order, any
   number of repeats, against a database you can throw away. No Stripe
   account, no card, no money.

   It builds Stripe-shaped events (checkout, async payment, failed payment,
   partial and full refunds, subscription invoices and endings, a connected
   seller, test mode), turns each into the exact call the stripe-webhook
   function makes (commerceCall in supabase/functions/stripe-webhook/
   commerce.ts, the same mapping the function uses), and delivers them to the
   commerce_record_stripe_* database functions:

     - in a random order (Stripe does not promise order),
     - with random repeats (Stripe retries; a duplicate can also slip past the
       webhook's stripe_events check when two deliveries race),
     - with some deliveries sent at the same time from separate connections.

   Then it checks the ledger is exactly what one clean delivery of each
   event would leave, and deletes everything the run wrote. Every run uses
   fresh ids, so it can be run any number of times.

   usage:
     node scripts/stripe-test/replay.mjs --db 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
       [--runs 5] [--seed 1234] [--only print-refunded,race] [--keep]

   The database must have the repo's migrations (supabase start / supabase db
   reset). Reconciler v3 (supabase/pending/commerce_stripe_reconciler_v3.sql)
   is detected; the scenarios that need it are skipped and named when it is
   absent. Hosted Supabase databases are refused: use Stripe test mode
   (scripts/stripe-test/stripe-test-mode.mjs) against production. */
import { spawn } from 'node:child_process';
import { commerceCall } from '../../supabase/functions/stripe-webhook/commerce.ts';

/* ---------- arguments and safety ---------- */
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : fallback;
};
const DB = arg('db') || process.env.REPLAY_DB_URL;
if (!DB || DB === true) {
  console.error('usage: node scripts/stripe-test/replay.mjs --db <postgres url of a local or disposable database>');
  process.exit(2);
}
export function refusesDatabase(url) {
  return /supabase\.co\b|pooler\.supabase\.com|zmnhbrjyhxzhkxmhkexs/i.test(String(url));
}
if (refusesDatabase(DB)) {
  console.error('refusing a hosted Supabase database: this harness writes and deletes ledger rows. Use Stripe test mode against production.');
  process.exit(2);
}
const RUNS = Math.max(1, Number(arg('runs', 1)) || 1);
const ONLY = arg('only') ? String(arg('only')).split(',') : null;
const KEEP = arg('keep') === true;
let seed = Number(arg('seed', Date.now() % 2147483647)) || 1;

/* ---------- database ---------- */
function psql(sql) {
  return new Promise((resolve, reject) => {
    const p = spawn('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `psql exited ${code}`))));
  });
}
const lit = (json) => {
  const body = JSON.stringify(json);
  let tag = 'j';
  while (body.includes(`$${tag}$`)) tag += 'j';
  return `$${tag}$${body}$${tag}$::jsonb`;
};
const one = async (sql) => JSON.parse((await psql(`select coalesce((${sql})::text, 'null')`)) || 'null');

/* ---------- randomness (seeded, so a failing run can be replayed) ---------- */
function rng() {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- Stripe-shaped events ---------- */
let eventSeq = 0;
const ev = (type, object, { live = true, account = null, created = 1791288000 } = {}) =>
  ({ id: `evt_replay${++eventSeq}`, type, livemode: live, created, ...(account ? { account } : {}), data: { object } });
const session = (o) => ({
  object: 'checkout.session', mode: 'payment', payment_status: 'paid', currency: 'usd',
  customer_details: { email: o.email, name: o.name || null, phone: null }, ...o
});
const charge = (pi, amount, refunded, metadata = {}) => ({ object: 'charge', payment_intent: pi, amount, amount_refunded: refunded, metadata });
const invoice = (o) => ({ object: 'invoice', currency: 'usd', status_transitions: { paid_at: o.paidAt }, lines: { data: [{ period: { end: o.periodEnd } }] }, ...o });

/* ---------- scenarios ---------- */
function scenarios(R, has) {
  const t = (n) => 1791288000 + n * 86400; // a day apart, as unix seconds
  const iso = (n) => new Date(t(n) * 1000).toISOString();
  return [
    {
      name: 'print-refunded', about: 'a shipped print, refunded in two steps',
      events: () => {
        const pi = `pi_${R}print`;
        return [
          ev('checkout.session.completed', session({ id: `cs_live_${R}print`, payment_intent: pi, amount_total: 4000, email: `print.${R}@example.com`,
            name: 'Replay Buyer', metadata: { offering: `${R}-print` },
            shipping_details: { name: 'Replay Buyer', address: { line1: '1 Main St', city: 'Bridgeport', state: 'CT', postal_code: '06604', country: 'US' } } })),
          ev('charge.refunded', charge(pi, 4000, 1000)),
          ev('charge.refunded', charge(pi, 4000, 4000))
        ];
      },
      expect: async () => {
        const s = await one(`select json_build_object(
          'orders', (select count(*) from public.work_orders where source_id = 'cs_live_${R}print'),
          'order_state', (select state from public.work_orders where source_id = 'cs_live_${R}print'),
          'payments', (select count(*) from public.work_payments where provider = 'stripe' and provider_reference = 'pi_${R}print'),
          'payment_state', (select state from public.work_payments where provider_reference = 'pi_${R}print'),
          'tasks', (select count(*) from public.work_tasks where related_id = (select id from public.work_orders where source_id = 'cs_live_${R}print')),
          'waiting', (select count(*) from public.commerce_stripe_pending where reference = 'pi_${R}print' and applied_at is null),
          'lead', (select status from public.leads where email = 'print.${R}@example.com'),
          'refunded_cents', ${has.v3 ? `(select refunded_cents from public.work_payments where provider_reference = 'pi_${R}print')` : 'null'})`);
        return [
          ['one order', s.orders === 1], ['order cancelled by the full refund', s.order_state === 'cancelled'],
          ['one payment', s.payments === 1], ['payment refunded', s.payment_state === 'refunded'],
          ['one Ship task', s.tasks === 1], ['nothing left waiting', s.waiting === 0], ['buyer is a confirmed lead', s.lead === 'confirmed'],
          ...(has.v3 ? [['refunded_cents = 4000', s.refunded_cents === 4000]] : [])
        ];
      }
    },
    {
      name: 'deposit-booked', about: 'a booking deposit opens one proposed booking and one scheduling task',
      events: () => [ev('checkout.session.completed', session({ id: `cs_live_${R}deposit`, payment_intent: `pi_${R}deposit`, amount_total: 15000,
        email: `host.${R}@example.com`, name: 'Event Host', metadata: { offering: `${R}-deposit` } }))],
      expect: async () => {
        const s = await one(`select json_build_object(
          'orders', (select count(*) from public.work_orders where source_id = 'cs_live_${R}deposit'),
          'payment', (select state || ':' || verification || ':' || amount_cents from public.work_payments where provider_reference = 'pi_${R}deposit'),
          'bookings', (select count(*) from public.work_bookings b join public.work_orders o on o.id = b.order_id where o.source_id = 'cs_live_${R}deposit' and b.state = 'proposed'),
          'schedule_tasks', (select count(*) from public.work_tasks k join public.work_bookings b on b.id = k.related_id join public.work_orders o on o.id = b.order_id
                             where o.source_id = 'cs_live_${R}deposit' and k.title like 'Schedule %'))`);
        return [['one order', s.orders === 1], ['paid, provider-verified, 15000', s.payment === 'paid:provider_verified:15000'],
          ['one proposed booking', s.bookings === 1], ['one Schedule task on the booking', s.schedule_tasks === 1]];
      }
    },
    {
      name: 'subscription', about: 'monthly plan: first invoice, two renewals, then cancelled',
      events: () => {
        const sub = `sub_${R}monthly`;
        return [
          ev('checkout.session.completed', session({ id: `cs_live_${R}monthly`, mode: 'subscription', payment_intent: null, invoice: `in_${R}first`,
            subscription: sub, amount_total: 87500, email: `client.${R}@example.com`, name: 'Client Co', metadata: { offering: `${R}-monthly` } }),
            { created: t(0) }),
          ev('invoice.paid', invoice({ id: `in_${R}first`, subscription: sub, payment_intent: `pi_${R}first`, billing_reason: 'subscription_create',
            amount_paid: 87500, paidAt: t(0), periodEnd: t(30) })),
          ev('invoice.paid', invoice({ id: `in_${R}second`, subscription: sub, payment_intent: `pi_${R}second`, billing_reason: 'subscription_cycle',
            amount_paid: 87500, paidAt: t(30), periodEnd: t(60) })),
          ev('invoice.paid', invoice({ id: `in_${R}third`, subscription: sub, payment_intent: `pi_${R}third`, billing_reason: 'subscription_cycle',
            amount_paid: 87500, paidAt: t(60), periodEnd: t(90) })),
          ev('customer.subscription.deleted', { object: 'subscription', id: sub, metadata: {} })
        ];
      },
      /* what the webhook reads back from Stripe for a subscription checkout */
      enrich: (payload) => (payload.subscription ? { ...payload, payment_intent: `pi_${R}first`, current_period_end: iso(30) } : payload),
      expect: async () => {
        const s = await one(`select json_build_object(
          'orders', (select count(*) from public.work_orders where source_id = 'cs_live_${R}monthly'),
          'renewals', (select count(*) from public.work_renewals where source_id = 'sub_${R}monthly'),
          'renewal', (select state || '@' || to_char(renews_at at time zone 'utc', 'YYYY-MM-DD') from public.work_renewals where source_id = 'sub_${R}monthly'),
          'renewal_payments', (select count(*) from public.work_payments p join public.work_renewals r on r.id = p.renewal_id where r.source_id = 'sub_${R}monthly'),
          'first_payment', (select count(*) from public.work_payments where provider_reference = 'pi_${R}first'),
          'waiting', (select count(*) from public.commerce_stripe_pending where (reference like '%${R}%' or payload->>'subscription' = 'sub_${R}monthly') and applied_at is null))`);
        const end = iso(90).slice(0, 10);
        return [['one order', s.orders === 1], ['one renewal', s.renewals === 1], [`cancelled, renews_at ${end}`, s.renewal === `cancelled@${end}`],
          ['two renewal payments (the first invoice is the checkout)', s.renewal_payments === 2], ['first payment recorded once', s.first_payment === 1],
          ['nothing left waiting', s.waiting === 0]];
      }
    },
    {
      name: 'failed-then-paid', about: 'a declined card, an unpaid async completion, then the payment succeeds',
      events: () => {
        const pi = `pi_${R}retry`;
        const base = { id: `cs_live_${R}retry`, payment_intent: pi, amount_total: 4000, email: `retry.${R}@example.com`, metadata: { offering: `${R}-file` } };
        return [
          ev('payment_intent.payment_failed', { object: 'payment_intent', id: pi, metadata: { offering: `${R}-file` } }),
          ev('checkout.session.completed', session({ ...base, payment_status: 'unpaid' })),
          ev('checkout.session.async_payment_succeeded', session(base))
        ];
      },
      expect: async () => {
        const s = await one(`select json_build_object(
          'orders', (select count(*) from public.work_orders where source_id = 'cs_live_${R}retry'),
          'payments', (select count(*) from public.work_payments where provider_reference = 'pi_${R}retry' and state = 'paid'),
          'tasks', (select count(*) from public.work_tasks where related_id = (select id from public.work_orders where source_id = 'cs_live_${R}retry')))`);
        return [['exactly one order', s.orders === 1], ['one paid payment', s.payments === 1], ['one Deliver task', s.tasks === 1]];
      }
    },
    {
      name: 'connected-seller', about: 'a connected seller’s sale is booked to that seller’s org; one without an org is not booked at all',
      events: () => [
        ev('checkout.session.completed', session({ id: `cs_live_${R}seller`, payment_intent: `pi_${R}seller`, amount_total: 2500, email: `seller.${R}@example.com`,
          metadata: { offering: `${R}-file`, mccluster_org_id: '__ORG__' } }), { account: `acct_${R}` }),
        ev('checkout.session.completed', session({ id: `cs_live_${R}orphan`, payment_intent: `pi_${R}orphan`, amount_total: 2500, email: `orphan.${R}@example.com`,
          metadata: { offering: `${R}-file` } }), { account: `acct_${R}` })
      ],
      expect: async (ctx) => {
        const s = await one(`select json_build_object(
          'seller_org', (select org_id from public.work_orders where source_id = 'cs_live_${R}seller'),
          'house_has_it', (select count(*) from public.work_orders o join public.orgs g on g.id = o.org_id where g.slug = 'mccluster' and o.source_id = 'cs_live_${R}seller'),
          'orphan', (select count(*) from public.work_orders where source_id = 'cs_live_${R}orphan'))`);
        return [['booked to the seller’s org', s.seller_org === ctx.org], ['not booked as house revenue', s.house_has_it === 0],
          ['no org named: not booked anywhere', s.orphan === 0]];
      }
    },
    {
      name: 'test-mode', ordered: true, about: 'a Stripe test checkout is recorded as TEST and counted nowhere',
      events: () => [
        ev('checkout.session.completed', session({ id: `cs_test_${R}test`, payment_intent: `pi_${R}test`, amount_total: 15000, email: `tester.${R}@example.com`,
          metadata: { offering: `${R}-deposit` } }), { live: false }),
        ev('charge.refunded', charge(`pi_${R}test`, 15000, 5000), { live: false })
      ],
      expect: async () => {
        const s = await one(`select json_build_object(
          'order', (select (not livemode)::text || ':' || (title like 'TEST · %')::text from public.work_orders where source_id = 'cs_test_${R}test'),
          'payment_live', (select livemode from public.work_payments where provider_reference = 'pi_${R}test'),
          'bookings', (select count(*) from public.work_bookings b join public.work_orders o on o.id = b.order_id where o.source_id = 'cs_test_${R}test'),
          'tasks', (select count(*) from public.work_tasks where related_id = (select id from public.work_orders where source_id = 'cs_test_${R}test')),
          'lead', (select count(*) from public.leads where email = 'tester.${R}@example.com'),
          'live_revenue', (select coalesce(sum(amount_cents), 0) from public.work_payments where livemode and provider_reference = 'pi_${R}test'),
          'refunded_cents', ${has.v3 ? `(select refunded_cents from public.work_payments where provider_reference = 'pi_${R}test')` : 'null'})`);
        return [['order flagged test and titled TEST', s.order === 'true:true'], ['payment flagged test', s.payment_live === false],
          ['no booking', s.bookings === 0], ['no task', s.tasks === 0], ['buyer is not a lead', s.lead === 0],
          ['counted in no live revenue', s.live_revenue === 0], ...(has.v3 ? [['test partial refund reconciled', s.refunded_cents === 5000]] : [])];
      }
    },
    {
      name: 'owner-typed', needs: 'v3', ordered: true, about: 'the owner typed the Stripe payment in Control before the webhook landed',
      setup: () => psql(`insert into public.work_payments (org_id, title, state, amount_cents, provider, provider_reference, verification)
        select id, 'Typed by owner', 'due', 3900, 'stripe', 'pi_${R}typed', 'owner_recorded' from public.orgs where slug = 'mccluster'`),
      events: () => [ev('checkout.session.completed', session({ id: `cs_live_${R}typed`, payment_intent: `pi_${R}typed`, amount_total: 4000,
        email: `typed.${R}@example.com`, metadata: { offering: `${R}-print` } }))],
      expect: async () => {
        const s = await one(`select json_build_object(
          'payments', (select count(*) from public.work_payments where provider_reference = 'pi_${R}typed'),
          'payment', (select verification || ':' || state || ':' || amount_cents from public.work_payments where provider_reference = 'pi_${R}typed'),
          'linked', (select p.order_id = o.id from public.work_payments p, public.work_orders o where p.provider_reference = 'pi_${R}typed' and o.source_id = 'cs_live_${R}typed'))`);
        return [['still one payment', s.payments === 1], ['promoted to Stripe’s facts', s.payment === 'provider_verified:paid:4000'], ['linked to the verified order', s.linked === true]];
      }
    },
    {
      name: 'race', needs: 'v3', concurrent: true, about: 'five sales whose checkout and full refund arrive at the same moment',
      events: () => [1, 2, 3, 4, 5].flatMap((i) => [
        ev('checkout.session.completed', session({ id: `cs_live_${R}race${i}`, payment_intent: `pi_${R}race${i}`, amount_total: 4000,
          email: `race${i}.${R}@example.com`, metadata: { offering: `${R}-print` } })),
        ev('charge.refunded', charge(`pi_${R}race${i}`, 4000, 4000))
      ]),
      expect: async () => {
        const s = await one(`select json_build_object(
          'refunded', (select count(*) from public.work_payments where provider_reference like 'pi_${R}race%' and state = 'refunded'),
          'payments', (select count(*) from public.work_payments where provider_reference like 'pi_${R}race%'),
          'waiting', (select count(*) from public.commerce_stripe_pending where reference like 'pi_${R}race%' and applied_at is null))`);
        return [['five payments', s.payments === 5], ['all five refunded', s.refunded === 5], ['no refund left waiting', s.waiting === 0]];
      }
    }
  ];
}

/* ---------- delivery ---------- */
async function deliver(event, scenario, ctx) {
  const json = JSON.stringify(event).replaceAll('__ORG__', ctx.org);
  const call = commerceCall(JSON.parse(json));
  if (!call) return 'ignored';
  // like withSubscriptionDetails in the webhook: only a checkout is enriched
  const payload = scenario.enrich && call.rpc === 'commerce_record_stripe_checkout' ? scenario.enrich(call.payload) : call.payload;
  const out = await one(`select public.${call.rpc}(${lit(payload)})`);
  return out && (out.deferred ? 'deferred' : out.skipped ? 'skipped' : out.created === false || out.changed === false ? 'repeat' : 'recorded');
}

/* The delivery plan: every event at least once, a few twice, shuffled; some
   repeats sent at the same moment as their original. A concurrent scenario
   sends everything at once. */
function plan(events, scenario) {
  if (scenario.concurrent) return [events.map((e) => e)];
  const list = scenario.ordered ? events.slice() : shuffle(events.slice());
  const extra = events.filter(() => rng() < 0.5);
  const batches = list.map((e) => [e]);
  for (const e of extra) {
    if (scenario.ordered) { batches.push([e]); continue; }
    const pos = Math.floor(rng() * (batches.length + 1));
    if (rng() < 0.4 && batches[pos]) batches[pos].push(e); else batches.splice(pos, 0, [e]);
  }
  return batches;
}

async function setup(R) {
  await psql(`insert into public.offerings (slug, site_id, brand_id, legal_entity_id, offering_type, revenue_type, title, price, price_type, fulfillment_type, status, billing_interval) values
    ('${R}-print', 'here', 'mccluster', 'mccluster-corp', 'physical_product', 'product_sale', 'Replay print', 40, 'fixed', 'physical_shipping', 'live', null),
    ('${R}-file', 'here', 'mccluster', 'mccluster-corp', 'digital_download', 'digital_sale', 'Replay file', 40, 'fixed', 'digital_delivery', 'live', null),
    ('${R}-deposit', 'here', 'mccluster', 'mccluster-corp', 'booking', 'booking_deposit', 'Replay booking deposit', null, 'custom', 'service_scheduling', 'live', null),
    ('${R}-monthly', 'here', 'mccluster', 'mccluster-corp', 'subscription', 'subscription', 'Replay monthly', 875, 'fixed', 'none', 'live', 'month')`);
  return psql(`insert into public.orgs (slug, name) values ('${R}-seller', 'Replay seller') returning id`);
}

async function cleanup(R) {
  await psql(`
    with o as (select id from public.work_orders where source_id like 'cs\\_%${R}%'),
         b as (select id from public.work_bookings where order_id in (select id from o)),
         r as (select id from public.work_renewals where source_id like 'sub\\_${R}%')
    delete from public.work_tasks where related_id in (select id from o union select id from b union select id from r);
    delete from public.work_payments where provider_reference like '%${R}%';
    delete from public.work_bookings where order_id in (select id from public.work_orders where source_id like 'cs\\_%${R}%');
    delete from public.work_renewals where source_id like 'sub\\_${R}%';
    delete from public.commerce_stripe_pending where reference like '%${R}%';
    delete from public.control_audit where detail::text like '%${R}%'
      or resource_id in (select id::text from public.work_orders where source_id like 'cs\\_%${R}%');
    delete from public.work_orders where source_id like 'cs\\_%${R}%';
    delete from public.leads where email like '%.${R}@example.com';
    delete from public.offerings where slug like '${R}-%';
    delete from public.orgs where slug = '${R}-seller';`);
}

/* ---------- run ---------- */
const has = { v3: (await one(`select exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'work_payments' and column_name = 'refunded_cents')`)) === true };
console.log(`Stripe replay · seed ${seed} · reconciler ${has.v3 ? 'v3' : 'v1/v2 (v3 scenarios skipped)'} · ${RUNS} run(s)`);

let failed = 0, passed = 0, skipped = 0;
for (let run = 1; run <= RUNS; run++) {
  const R = `rp${Date.now().toString(36)}${Math.floor(rng() * 1e6).toString(36)}`.replace(/[^a-z0-9]/g, '');
  const ctx = { org: await setup(R) };
  try {
    for (const s of scenarios(R, has)) {
      if (ONLY && !ONLY.includes(s.name)) continue;
      if (s.needs === 'v3' && !has.v3) { skipped++; console.log(`  skip ${s.name}: needs reconciler v3`); continue; }
      if (s.setup) await s.setup();
      const batches = plan(s.events(), s);
      const outcomes = [];
      for (const batch of batches) {
        const results = await Promise.all(batch.map((e) => deliver(e, s, ctx)));
        outcomes.push(batch.map((e, i) => `${e.type.replace(/^(checkout\.session|customer\.subscription|payment_intent)\./, '')}→${results[i]}`).join(' & '));
      }
      const checks = await s.expect(ctx);
      const bad = checks.filter(([, ok]) => !ok);
      if (bad.length) failed++; else passed++;
      console.log(`${bad.length ? 'FAIL' : 'ok  '} ${s.name}: ${s.about}`);
      console.log(`       delivered: ${outcomes.join(', ')}`);
      for (const [label, ok] of checks) if (!ok) console.log(`       ✗ ${label}`);
    }
  } finally {
    if (KEEP) console.log(`  kept run ${R} (--keep)`); else await cleanup(R);
  }
}
console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
