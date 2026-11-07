# Productization release checkpoint — 2026-10-31

Status: staged integration, not a completed product release. Do not tag or activate paid offers from this checkpoint alone.

## Changes made

- PR #680 merged as `3340bbcdfb3776499017d0489f96939233b14888`. Pages, Edge Function deployment and OVH promotion now require every configured CI check on the exact target commit. Reconciliation checks run on main.
- Production Cloudflare Builds command pinned to `npx --no-install wrangler deploy`. Worker auto-deploy still needs coordinated cutover to the GitHub gated path; branch protection also remains a separate administration task.
- `deploy/ovh-production` advanced by a forward-only, expected-head update from `da5a44ad895492a1979bae6e428ec405ce08a4ec` to `3340bbcdfb3776499017d0489f96939233b14888` after exact-main CI and 353 Core tests passed. Fresh host job `cb9318b0-736f-4a08-8dbc-9d0d9a7fa687` subsequently verified the running SHA, no promotion lag and exact migration parity. Infrastructure is OK; overall health remains degraded by workload/Studio issues.
- PR #678 reconciles direct music checkout with main. Its pending migration retains the inactive legacy offer, blocks unsafe legacy-path writes, locks the preflight against concurrent checkout writes, and refuses migration if purchases need review.
- PR #681 reconciles the stacked onboarding source through #641 with current main. Feature activation remains disabled until the corresponding production schema is present.

## Verification

- Release-gate PR: all applicable checks passed before merge. Main deployment checks passed before OVH promotion.
- Direct music integration: 1,321 root JavaScript tests plus 7 Python tests; database apply/reapply/rollback, fulfillment and entitlement behavior; inactive legacy preservation and rejected reactivation; intercepted browser checkout, purchase recovery, download limits and operator controls pass.
- Merch PR #679: 10 source tests, database role/stock/payment/rollback behavior, and 126 browser checks at 390, 820 and 1280 pixels pass. These tests do not make provider requests or charge money.
- Onboarding: 1,313 root JavaScript tests plus 7 Python tests; minimal free-site schema create/edit/publish, private reads, modules, addresses, storage quota and owner binding pass. Domain provider recovery and fencing proof passes.
- Onboarding browser evidence includes landing/sign-in return, incomplete profile recovery, quota display, persisted module toggles, account switching, repeated/reloaded checkout identity, outage/retry, and phone/desktop overflow. The repaired private music draft fixture and targeted newsroom owner/member checks pass. Vaunt navigation/history passes at 390, 820, 1180 and 1440 pixels. Member-page upload/publication/cleanup passes 70 checks; video-poster editing passes 34 checks; the targeted homepage smoke is clean; Studio actual FFmpeg processing and failure/retry proof passes. Wider integration CI must also be green; passing selected journeys is not full release acceptance.

## Remaining release gates

1. Core runtime and migration drift are repaired: host job `cb9318b0-736f-4a08-8dbc-9d0d9a7fa687` completed successfully on `3340bbcdfb3776499017d0489f96939233b14888`; 354 migrations match the repository ledger hash `701b901500a31f2e28da85435a1724b2a8e191e6167e63d3c829c6d7d464d9fa`. Infrastructure is OK, with remaining workload/Studio degradation. Reflection diagnostic `7c46fda2-71f9-4b64-bce9-67ea2c1a0497` ran with `max_next_jobs=0` and failed with a SQL statement timeout. Production EXPLAIN reproduced a 51.7-second scan extracting JSON from 10,539 health records. PR #682 stages a two-phase identity/payload read plus optional pending indexes; all 355 Core tests pass. The repair is not yet deployed or verified live.
2. Apply the reviewed pending schemas through the migration tool. The direct-sales migration confirmation expired twice; no migration was applied. Reconcile the actual server migration version/statements into the repository ledger, snapshot, manifest and drift contract after successful application. Never invent the recorded version.
3. Finish all onboarding integration CI and apply only the free-site dependency set before enabling its offer. Registrar, paid subscriptions, Studio and other dependent features require their own schemas and provider proof.
4. Connect a Stripe sandbox. Both available connections report live mode for the same platform account. No real charges were made. Prove checkout, webhook replay, fulfillment, refund and account isolation in sandbox before enabling sales.
5. Run the complete acceptance path against the deployed candidate, including account isolation, payment failure/retry, download expiry/refund and seller shipping. Then record the actual deployment identifiers and tag the accepted commit.

## Rollback preparation

- OVH prior production ref: `da5a44ad895492a1979bae6e428ec405ce08a4ec`. Use the explicit rollback promotion workflow with the prior SHA and rollback authorization; verify the resulting runtime health. This checkpoint did not execute a production rollback.
- Direct-sales database rollback: `supabase/pending/music_direct_sales_v1.rollback.sql`; scratch apply/rollback/reapply proof passed. Review live purchases before any production rollback.
- Merch database rollback: `supabase/pending/merch_marketplace_v1.rollback.sql`; scratch rollback/reapply proof passed. Preserve order and fulfillment history in production.
- Keep default-off offer flags and existing inactive offers off until acceptance. Record existing Worker/Pages versions before future activation so an application rollback is tied to an actual deployed version.

No final release tag was created because production migration, payment-provider and runtime acceptance evidence are incomplete.
