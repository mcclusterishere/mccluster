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
| Event → record mapping (pure, Node-tested) | `supabase/functions/stripe-webhook/commerce.ts` |
| Signature check, routing, Stripe look-ups | `supabase/functions/stripe-webhook/index.ts` |
| Sale metadata carried on the payment | `supabase/functions/checkout/index.ts` (`payment_intent_data` / `subscription_data`) |
| Database functions + provenance columns | `supabase/migrations/20261006021431_commerce_stripe_reconciler_v1.sql` (live) |
| Database regression (runs in API Economic Core CI) | `supabase/tests/commerce_stripe_reconciler_regression.sql` |
| Mapping/routing/boundary contract | `scripts/test/stripe-commerce-reconciler.test.mjs` |
| Control locks and test-mode totals | `workers/mccluster/src/work.js`, `workers/mccluster/test/work-provider-verified.test.mjs` |

## What each event does

| Stripe event | Database function | Effect |
|---|---|---|
| `checkout.session.completed` (paid), `checkout.session.async_payment_succeeded` | `commerce_record_stripe_checkout` | Buyer found or created as a lead (by lowercased email; promoted to `confirmed` if still early in the pipeline). A `paid` order with `source_table = 'stripe_checkout'` and `source_id = <session id>`. A `provider_verified` payment referenced by the payment intent. Then, once: a monthly/annual renewal for a subscription; a proposed booking and a "Schedule …" task for a deposit (`service_scheduling`); a "Ship … to …" task carrying the address (`physical_shipping`); a "Deliver … to …" task (`digital_delivery`); otherwise a "Follow up: …" task. |
| `charge.refunded` | `commerce_record_stripe_refund` | Full refund: payment `refunded`, order `cancelled` unless already fulfilled. Partial: payment stays `paid` and its note records the amount. A refund for a payment never recorded answers `matched: false` and invents nothing. |
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
- **Tenancy.** A platform event belongs to the house org. An event from a
  connected account is recorded only when the sale named its
  `mccluster_org_id`; otherwise it is skipped, never booked as McCluster
  revenue. Refunds and renewals find that org on the payment and the
  subscription because `checkout` now copies the sale metadata onto them.
- **Test mode is not revenue.** Every row carries `livemode`. Test orders are
  titled `TEST · …`; `/v1/work/history` excludes them from billed, paid and
  verified totals and reports them as `test_mode_cents`; Control labels them
  "test mode, not revenue".
- **Provider facts are not retyped.** Control can annotate a provider-verified
  payment (title, note, links) but not its amount, currency, provider,
  reference, state or paid date. A Stripe checkout order keeps Stripe's
  amount, lines and placed date and still moves through fulfillment states.
  Resending a row unchanged is not an edit.

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
2. **Edge Function deploys.** Add the `SUPABASE_ACCESS_TOKEN` Actions secret
   so `supabase-functions-deploy.yml` deploys and proves `stripe-webhook` and
   `checkout` after merge (see `SECURITY-POSTURE.md`).
3. **Square.** Create a Square webhook subscription and store its signature
   key when the Square reconciler is built.
