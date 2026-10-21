# Commerce reconciler — Stripe

A paid checkout becomes the canonical commercial record: the buyer as a lead,
a paid order, a provider-verified payment, and the follow-up work the sale
implies. Before this, `checkout` and `music-checkout` took money and nothing
recorded it anywhere McCluster could see. `stripe_events` held no rows, every
`work_*` table was empty, and `work_payments.verification =
'provider_verified'` existed but nothing could set it.

## Where it lives

| Piece | File |
|---|---|
| Event → record mapping (pure, Node-tested) | `supabase/functions/stripe-webhook/commerce.ts` (`commerceCall` is the whole event → database call mapping) |
| Signature check, routing, Stripe look-ups | `supabase/functions/stripe-webhook/index.ts` |
| Sale metadata carried on the payment | `supabase/functions/checkout/index.ts` (`payment_intent_data` / `subscription_data`) |
| Database functions + provenance columns | `supabase/migrations/20261006021431_commerce_stripe_reconciler_v1.sql`, `20261006023453_commerce_stripe_reconciler_v2.sql` (both live) |
| Concurrency, owner-typed payments, partial refunds | `supabase/pending/commerce_stripe_reconciler_v3.sql` (**pending: not applied in production**) |
| Database regressions (API Economic Core CI) | `supabase/tests/commerce_stripe_reconciler_regression.sql` (v1/v2, rerun on v3), `supabase/tests/commerce_stripe_reconciler_v3_regression.sql`, `supabase/tests/commerce_stripe_concurrency.sh` |
| Webhook replay in random orders, repeats and races | `scripts/stripe-test/replay.mjs` (API Economic Core CI, `--runs 3`) |
| Stripe test mode against the real site | `scripts/stripe-test/stripe-test-mode.mjs` |
| Buyer's confirmation after Stripe | `pay.html` → `GET /v1/commerce/receipt` (`workers/mccluster/src/commerce/receipt.js`) |
| Verified sales for Control and Analytics | `workers/mccluster/src/commerce/summary.js` → `businessSnapshot().commerce`, `js/control-room/analytics.js` |
| Mapping/routing/boundary contract | `scripts/test/stripe-commerce-reconciler.test.mjs`, `scripts/test/stripe-test-workflow.test.mjs` |
| Control locks and test-mode totals | `workers/mccluster/src/work.js`, `workers/mccluster/test/work-provider-verified.test.mjs`, `workers/mccluster/test/commerce-receipt-*.test.mjs` |

## What each event does

| Stripe event | Database function | Effect |
|---|---|---|
| `checkout.session.completed` (paid), `checkout.session.async_payment_succeeded` | `commerce_record_stripe_checkout` | Buyer found or created as a lead (by lowercased email; promoted to `confirmed` if still early in the pipeline). A `paid` order with `source_table = 'stripe_checkout'` and `source_id = <session id>`. A `provider_verified` payment referenced by the payment intent. Then, once: a monthly/annual renewal for a subscription; a proposed booking and a "Schedule …" task for a deposit (`service_scheduling`); a "Ship … to …" task carrying the address (`physical_shipping`); a "Deliver … to …" task (`digital_delivery`); otherwise a "Follow up: …" task. |
| `charge.refunded` | `commerce_record_stripe_refund` | Full refund: payment `refunded`, order `cancelled` unless already fulfilled. Partial: payment stays `paid` and its note records the amount; with v3 the amount is also `work_payments.refunded_cents` (Stripe's `amount_refunded`, never lowered by an older or repeated event), so Control and Analytics count it as money returned. A refund for a payment never recorded answers `matched: false` and invents nothing. |
| `invoice.paid` (after the first) | `commerce_record_stripe_invoice` | A renewal payment linked to the renewal and its order; `last_renewed_at` and `renews_at` advance. The first invoice (`subscription_create`) is the checkout itself and is skipped. Subscriptions not sold through an offering are left alone. |
| `customer.subscription.deleted` | `commerce_record_stripe_subscription_ended` | The renewal becomes `cancelled`. |

Sessions without `metadata.offering` (or `kind = music_license_sale`) are not
commerce. The premium plan (`metadata.uid`) keeps its own entitlement path.

## Invariants

- **Signature first.** Nothing is read or written before
  `constructEventAsync` succeeds.
- **Exactly once.** One order per session (`work_orders_source_uidx`), one
  payment per provider reference (`work_payments_provider_reference_uidx`),
  one renewal per subscription, one booking per order, and an advisory lock
  per session for concurrent deliveries. A repeat delivery answers
  `created: false` with the same ids. A failed write answers 500 so Stripe
  retries.
- **Server only.** The functions are `security definer` with an empty
  `search_path`, revoked from `public`, `anon` and `authenticated`, granted to
  `service_role`, and every write is in `control_audit`
  (`commerce.stripe.*`).
- **Out-of-order delivery.** Stripe does not promise event order. A live
  refund, renewal invoice or cancellation that arrives before its checkout
  is kept in `commerce_stripe_pending` (service-role only, audited as
  `commerce.stripe.deferred`) and applied by the checkout that creates its
  payment or renewal: renewals first, then refunds, then endings. It is
  never acknowledged and lost.
- **Tenancy.** A platform event belongs to the house org. An event from a
  connected account is recorded only when the sale named its
  `mccluster_org_id`; otherwise it is skipped, never booked as McCluster
  revenue. Refunds and renewals find that org on the payment and the
  subscription because `checkout` now copies the sale metadata onto them.
- **Test mode is not revenue and sets nothing in motion.** Every row carries
  `livemode`. A test checkout records only its order (titled `TEST · …`) and
  payment: no lead, booking, renewal or task, so nobody is contacted and
  nothing ships because of a test; `/v1/work/history` excludes them from billed, paid and
  verified totals and reports them as `test_mode_cents`; Control labels them
  "test mode, not revenue".
- **One delivery at a time per sale (v3).** Two deliveries for one sale can
  arrive together from separate Stripe retries. On v2 a refund racing its
  checkout could be lost (each saw nothing to act on);
  `supabase/tests/commerce_stripe_concurrency.sh` reproduces it. v3 takes a
  transaction lock on the subscription and then the payment reference before
  any read, in every function, so the second delivery sees the first one's
  rows.
- **A payment the owner typed in is promoted, not shadowed (v3).** If Control
  already holds an `owner_recorded` payment under the same Stripe reference,
  the checkout turns it into the `provider_verified` row with Stripe's
  amount, keeps the owner's figures in its note, and audits
  `commerce.stripe.payment_promoted`. One payment, never two.
- **A test endpoint changes no real account.** With
  `STRIPE_WEBHOOK_SECRET_TEST` set, an event only that secret verifies must say
  `livemode = false`, and it writes the commerce ledger only (flagged TEST):
  no premium plan, music licence, music refund or provider flag changes
  because of a test.
- **Provider facts are not retyped.** Control can annotate a provider-verified
  payment (title, note, links) but not its amount, currency, provider,
  reference, state or paid date. A Stripe checkout order keeps Stripe's
  amount, lines and placed date and still moves through fulfillment states.
  Resending a row unchanged is not an edit.

## What the buyer and the owner see

1. **Buyer.** A service (Who Did the Shoot, Write a Song) offers its booking
   deposit through `pay.html?offer=booking-deposit`; the checkout function
   prices it from the database row and Stripe takes the card. Stripe sends
   the buyer back to `pay.html?…&done=1&s=<session id>`. The page asks
   `GET https://api.mccluster.org/v1/commerce/receipt?session=<id>` up to 8
   times, 2.5 seconds apart, and shows what was bought, the amount and the
   next step: for a deposit, "an email from matthew@mccluster.org to agree the
   date" (no scheduling link is promised: none exists), a shipment, a file, a
   renewal, or a refund. A test session shows **TEST PAYMENT · No money
   moved**. If the record has not landed after the 8 tries the page says
   Stripe has the payment and the record is still being written. The answer
   carries no name, email, address, phone or payment reference.
2. **Control → Work.** The order, the provider-verified payment (locked
   against edits), the proposed booking and its "Schedule …" task. A test
   payment is labelled "test mode, not revenue". Totals add "Partly
   refunded" and "Net paid" once a partial refund is recorded.
3. **Control → Analytics → Sales, bookings & operations.** Verified sales
   (live Stripe payments net of refunds, house org only, US dollars),
   bookings and how many wait for a time, refunded, and music gross. Test
   payments appear only as "Test mode: N test payments ($X) kept apart, not
   revenue." If the sales read fails, the card says so and the rest of the
   report still loads.

## Repeatable testing

Two layers. The first needs no Stripe account and runs in CI on every
change; the second exercises the real site with Stripe test mode. Neither
moves money.

### 1. Local: the database and the webhook mapping (no Stripe, any number of runs)

```sh
supabase start                                   # Docker; the repo's local stack
bash scripts/supabase-local-reset-with-replay.sh # every migration, as CI rebuilds it
DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'

psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/commerce_stripe_reconciler_regression.sql
node scripts/stripe-test/replay.mjs --db "$DB" --runs 3        # v2: the v3 scenarios are skipped and named
bash supabase/tests/commerce_stripe_concurrency.sh "$DB"        # v2: FAILS, showing the race v3 fixes

psql "$DB" --single-transaction -v ON_ERROR_STOP=1 -f supabase/pending/commerce_stripe_reconciler_v3.sql
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/commerce_stripe_reconciler_regression.sql
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/commerce_stripe_reconciler_v3_regression.sql
bash supabase/tests/commerce_stripe_concurrency.sh "$DB"        # v3: both races end refunded
node scripts/stripe-test/replay.mjs --db "$DB" --runs 10        # as many runs as you like
```

`replay.mjs` options: `--runs N`, `--seed N` (replays one exact order),
`--only print-refunded,race`, `--keep` (leaves the rows to inspect; otherwise
every run deletes what it wrote). It refuses any hosted Supabase database.

| Scenario | Events, delivered in a random order with random repeats | Expected ledger |
|---|---|---|
| `print-refunded` | completed (a shipped print), partial refund, full refund | buyer a `confirmed` lead, one order (`cancelled`), one payment (`refunded`), one Ship task, nothing left waiting; v3: `refunded_cents` = 4000 |
| `deposit-booked` | completed (booking deposit) | one order, one `paid` `provider_verified` payment, one proposed booking, one "Schedule …" task on it |
| `subscription` | completed, first invoice (`subscription_create`), two renewal invoices, cancellation | one order, one renewal (`cancelled`, `renews_at` = the last period end), the first payment once, two renewal payments, nothing left waiting |
| `failed-then-paid` | payment failed, an unpaid completion, then async payment succeeded | one order, one `paid` payment, one Deliver task |
| `connected-seller` | completed on a connected account naming its org; another naming none | the first in the seller's org and not in the house; the second booked nowhere |
| `test-mode` | test completed, test partial refund (in order) | order `livemode = false` titled `TEST · …`, payment `livemode = false`, no lead, booking or task, no live revenue; v3: `refunded_cents` = 5000 |
| `owner-typed` (v3) | the owner typed a `due` payment under the same reference, then the checkout arrives | still one payment, now `provider_verified`, `paid`, Stripe's 4000, linked to the order |
| `race` (v3) | checkout and full refund for five sales, each pair sent at the same moment | five payments, all `refunded`, nothing left in `commerce_stripe_pending` |

**Reading the output.** The first line names the seed and whether the
database has v3. Each scenario prints `ok` or `FAIL`, then the deliveries in
the order it used (`delivered: completed→recorded, charge.refunded→deferred, …`;
`&` joins deliveries sent at the same moment). `recorded` wrote a row,
`repeat` was a duplicate that changed nothing, `deferred` waited in
`commerce_stripe_pending` for its checkout, `skipped` was declined by the
database function, and `ignored` is an event the webhook never sends to the
database (for example a connected sale naming no org). A failed
scenario lists each expectation it missed with `✗`. The last line counts
passed, failed and skipped; the exit code is 0 only when nothing failed.
To reproduce a failure, rerun with the same `--seed` (and the same `--runs`
and `--only`) for the same orders, and `--keep` to inspect the rows.

### 2. Stripe test mode on the real site (no real money)

One-time setup, by the owner (needs the Stripe dashboard and Supabase secrets):

1. Stripe dashboard, **test mode** → Developers → Webhooks → add an endpoint
   for `https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/stripe-webhook`
   with the same events as the live endpoint (see Owner actions). Copy its
   signing secret.
2. Set two secrets on the `stripe-webhook` Edge Function:
   `STRIPE_WEBHOOK_SECRET_TEST=<that whsec_…>` and
   `STRIPE_SK_TEST=<a sk_test_… or rk_test_… key>`. The live
   `STRIPE_WEBHOOK_SECRET` and `STRIPE_SK` are not touched.
3. Deploy `stripe-webhook` from `main` (the Edge Function deploy workflow
   does this once `SUPABASE_ACCESS_TOKEN` exists).

Each test run (`STRIPE_TEST_KEY=sk_test_…` in your shell; the tool refuses
any other key and any live object):

```sh
node scripts/stripe-test/stripe-test-mode.mjs checkout --offer booking-deposit --amount 150
#   open the printed URL, pay with 4242 4242 4242 4242 (any future date, any CVC, any ZIP)
#   Stripe returns you to pay.html: TEST PAYMENT banner, "Booking deposit · $150", next step
node scripts/stripe-test/stripe-test-mode.mjs status --session cs_test_…   # Stripe's view + the site's receipt
node scripts/stripe-test/stripe-test-mode.mjs refund --session cs_test_… --amount-cents 5000
node scripts/stripe-test/stripe-test-mode.mjs refund --session cs_test_…  # the rest
node scripts/stripe-test/stripe-test-mode.mjs checkout --offer hosting-monthly --interval month
node scripts/stripe-test/stripe-test-mode.mjs cancel --session cs_test_…
```

Cards: `4000 0000 0000 0002` is declined (pay again on the same page with
4242 for a failed-then-retried payment); `4000 0025 0000 3155` asks for 3-D
Secure. A renewal in test mode needs a Stripe test clock (Billing → Test
clocks) to advance the subscription; the replay harness covers renewals
without one.

Expected after each run, read with a read-only query:

```sql
select o.title, o.state, o.livemode, p.amount_cents, p.state, p.verification, p.livemode
from public.work_orders o left join public.work_payments p on p.order_id = o.id
where o.source_table = 'stripe_checkout' and o.source_id = 'cs_test_…';
```

One order titled `TEST · …`, one `provider_verified` payment with
`livemode = false`, no lead, booking, task or renewal; Control shows it as
"test mode, not revenue"; Analytics' Verified sales does not change and its
test-mode line grows by the amount. A refund moves the payment to
`refunded` (full) or keeps it `paid` with the amount in its note and, on v3,
in `refunded_cents` (partial). If `status` says "Paid at Stripe but not
recorded yet" for more than a minute, check the test endpoint's delivery log
in Stripe and the `stripe-webhook` function logs: a 400 means the test
signing secret is wrong or missing.

Test rows are already outside every total. To clear them from Control's
lists, check first, then delete in one transaction (it stops and changes
nothing if any other record points at a test order):

```sql
select count(*) from public.work_orders where livemode = false and source_table = 'stripe_checkout';
begin;
delete from public.work_payments where livemode = false and provider = 'stripe';
delete from public.work_orders where livemode = false and source_table = 'stripe_checkout';
commit;
```

### What has been verified, and what still needs production

- Verified in CI and locally on a rebuilt database: the v1/v2 and v3
  regressions, the two-session race (fails on v2, passes on v3), the replay
  harness across every scenario in random orders with repeats and
  concurrent deliveries, the webhook contract and the Worker routes.
- Not yet verified in production: v3 is not applied; no Stripe test-mode
  event has reached the deployed function (it needs the two secrets above
  and a deploy); `stripe_events` has never held a row, so the live endpoint
  itself is unconfirmed (Owner actions 1).

## Not covered yet

- **Square.** `checkout` hands Square-routed offerings (the
  `mission-fund-donation` donation) a Square payment link, and Square
  recurring plans start in Square. No Square webhook exists, so those
  payments are not reconciled. Staged until a Square webhook signature key
  exists.
- **Connected-account refunds of subscriptions** carry no org on the charge;
  they are skipped rather than guessed.
- Client-facing deliverable approval, entitlement linkage and
  lead → relationship → project automation are the next #14 slices
  (`PROGRAM-LEDGER.md`).

## Owner actions

1. **Stripe webhook endpoint.** In the Stripe dashboard (live mode, and test
   mode if used), confirm an endpoint for
   `https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/stripe-webhook`
   whose signing secret is the function's `STRIPE_WEBHOOK_SECRET`, subscribed
   to `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.expired`, `payment_intent.payment_failed`,
   `charge.refunded`, `invoice.paid`, `customer.subscription.deleted` and
   `account.updated`. Add a Connect endpoint with the same events for
   connected sellers. `stripe_events` has never held a row, so either the
   endpoint is missing or no sale has completed since it was added.
2. **Stripe test mode.** The three setup steps under "Repeatable testing".
3. **Apply reconciler v3.** Apply `supabase/pending/commerce_stripe_reconciler_v3.sql`
   and promote it as `supabase/pending/README.md` describes. The webhook
   works before and after it.
4. **Edge Function deploys.** Add the `SUPABASE_ACCESS_TOKEN` Actions secret
   so `supabase-functions-deploy.yml` deploys and proves `stripe-webhook` and
   `checkout` after merge (see `SECURITY-POSTURE.md`).
5. **Square.** Create a Square webhook subscription and store its signature
   key when the Square reconciler is built.
