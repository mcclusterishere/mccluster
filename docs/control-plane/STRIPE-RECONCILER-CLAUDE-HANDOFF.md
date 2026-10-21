# Claude handoff — Stripe reconciler (2026-10-07 EDT / 2026-10-08 UTC)

## Assignment and priorities
User authorized proceeding with a **repeatably testable** Stripe-to-Control sales ledger and bookings pipeline. Keep implementation costs low and avoid expanding speculative systems. **Do the work, do not stop at an audit.** First reconcile/test Stripe, then paid booking end-to-end and revenue analytics. Do not change production or merge without proof.

## Verified GitHub history
- Repo: `mcclusterishere/mccluster`.
- PR #395 Analytics Overview / redesigned Page Performance leaderboard **merged to main**, merge commit `bb90da8a3321bf422db5ff16324a845de5147d63`. Four checks passed. Production deployment not verified.
- Original PR #376 `claude/commerce-stripe-reconciler` head `4eb85a817ab845764ba417fec95a67d800595a4e` had ten passing workflows at its historical head but was 18 commits behind main and unmergeable. **Do not force-merge or overwrite newer main.**
- New **draft PR #396**: https://github.com/mcclusterishere/mccluster/pull/396 ; branch `fix/stripe-reconciler-current-main`, created from main at `bb90da8`. Original #376 remains untouched.
- Initial #396 commit `8ab13c17d907118231f522e6f3d317b76f6de50b` was mergeable, but not green. Production Security, Music, Analytics, Social, Architecture passed; Control Plane Drift Guard and MCP Continuity failed; API Economic Core, Equity Uprise, Reconciliation were still running at last inspection.
- Drift Guard failure: active migrations `20261006021431_commerce_stripe_reconciler_v1.sql`, `20261006022702_leads_status_vocabulary_reconcile_v1.sql`, `20261006023453_commerce_stripe_reconciler_v2.sql` are **not in `supabase/production-ledger.json`**. Reconcile truthfully: distinguish applied production migrations from pending ones; do not falsely mark migrations applied.
- MCP failure: `scripts/test/stripe-commerce-reconciler.test.mjs` test 444 requires commerce SQL regression be wired into API Economic Core CI. A subsequent commit `c46b4c14e9f85de0ddb5bc892069f9d3aa15c95f` added the SQL regression step to `.github/workflows/api-economic-core-ci.yml`. Check fresh CI on latest head.

## What has been ported to #396
Eight new files from #376: `docs/control-plane/COMMERCE-RECONCILER.md`, `scripts/test/stripe-commerce-reconciler.test.mjs`, `supabase/functions/stripe-webhook/commerce.ts`, three migrations listed above, `supabase/tests/commerce_stripe_reconciler_regression.sql`, `workers/mccluster/test/work-provider-verified.test.mjs`.
Four existing files were ported from #376: `supabase/functions/stripe-webhook/index.ts`, `supabase/functions/checkout/index.ts`, `workers/mccluster/src/work.js`, `js/control-room/work-records.js`. They had no detected changes relative to current main before port, but independently inspect diffs and newer integration points. Webhook includes paid checkout, async payment, refund, renewal invoice, subscription-ended handlers; helper reads Stripe subscription/invoice details and invokes DB RPC. Work UI separates test payments and protects provider-verified fields. Checkout propagates metadata to PaymentIntent.
**Important:** The migration ledger and drift contract were deliberately NOT copied from old #376, to avoid discarding newer main migrations. Work them through properly.

## Test requirements — repeated testing is non-negotiable
1. Use Stripe **test-mode** credentials and isolated test data; never real charges for routine tests. Each new checkout creates one new payment/order/lead/follow-up, correct org/offer metadata and booking scheduling action.
2. Replay the same webhook multiple times and out of order: no duplicate order, payment, renewal or entitlement; proper idempotency and error/retry semantics.
3. Verify async-payment success, full and partial refunds, refunded-before-checkout race, subscription initial invoice and subsequent renewals, cancellation, connected-account scoping.
4. Test-mode transactions visible as TEST, excluded from all live revenue aggregates and Analytics; live provider-verified records cannot be manually rewritten in Control.
5. Run fresh migration rebuild + SQL regression, Worker/node tests, economic core, drift guard, security, reconciliation. Verify CI on latest head, not historical green statuses. Check that all three new migrations can apply safely on current schema.
6. Make a documented repeatable test script / runbook with expected records and cleanup, and ideally automated replay tests so user can run it many times.
7. Validate checkout-to-booking-to-confirmation-to-Control-to-Analytics end-to-end. Do not claim actual production Stripe events were tested without proof.
8. Once green and reviewed, merge PR #396; consider closing/superseding #376 only after feature parity and safe merge. Do not enable production payment changes prematurely.

## Portfolio scope
Near-term priority: Stripe #396, Analytics #395 (already merged), lean AI continuity #261, essential Control functionality #356; consolidate overlapping #354. Defer speculative adaptive policy #385 and lab expansion #200; budget-cap FAL #269. User wants revenue-producing workflows, not endless audits.

## Immediate next steps (as handed over)
Fetch fresh main and PR #396 head; inspect CI, ledger format and migration deployment truth; fix failures in branch; add repeatable tests; push, rerun, report exact status. Do not imply deployed or tested until independently verified.

## State after the takeover (2026-10-08)
- **Drift Guard.** The three migrations were checked against production's `supabase_migrations.schema_migrations` (read-only): v1 `20261006021431`, the leads vocabulary `20261006022702` and v2 `20261006023453` are applied and byte-identical, so they are now in `supabase/production-ledger.json` and `core/drift-contract.json`. `here_album_commerce_v1` is recorded under the version production gave it, `20261006233518_here_album_commerce_v1_reconcile`. Nothing unapplied is marked applied.
- **Reconciler v3** (`supabase/pending/commerce_stripe_reconciler_v3.sql`) is **pending, not applied in production.** It serialises deliveries for one sale (a refund racing its checkout was lost on v2; `supabase/tests/commerce_stripe_concurrency.sh` reproduces that), promotes an owner-typed payment instead of shadowing it, and keeps partial refunds as `refunded_cents`. CI applies it to the rebuilt database and runs both regressions, the race and the replay harness. The deployed webhook works before and after it.
- **Repeatable testing.** `scripts/stripe-test/replay.mjs` (no Stripe; every scenario in random orders, repeats and races; CI runs it) and `scripts/stripe-test/stripe-test-mode.mjs` (Stripe test mode against the real site; refuses live keys). Runbook: `COMMERCE-RECONCILER.md` → "Repeatable testing".
- **Test mode end to end** needs the owner: a Stripe test-mode endpoint for the same function and the `STRIPE_WEBHOOK_SECRET_TEST` and `STRIPE_SK_TEST` secrets, then a deploy. A test-endpoint event writes TEST commerce rows only: no plan, music licence or provider flag changes.
- **Booking flow.** Service → `pay.html?offer=booking-deposit` → Stripe → `pay.html` asks `GET /v1/commerce/receipt` and shows the item, amount and the next step (an email to agree the date; no scheduling link is promised because none exists) → Control Work (order, verified payment, proposed booking, Schedule task) → Analytics Sales card (verified live sales net of refunds; test money named apart).
- **Not verified in production:** v3 apply, any real test-mode event through the deployed function, and the live endpoint itself (`stripe_events` has never held a row).
