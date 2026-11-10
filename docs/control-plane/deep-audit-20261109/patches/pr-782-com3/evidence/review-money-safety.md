# COM-3 independent money-safety and authority review

Date: 2026-11-10 UTC.
Base: 53dcd55243e6d847b4ced44817bb22d11bdcce18.
Scope: uncommitted COM-3 recovery implementation, pending SQL and rollback, synthetic provider tests, native SQL tests. Read root AGENTS.md and the COM-3 BRIEF from 9d29616021337806860bab891163844dca2f1d26. Read the existing owner predicate and billing webhook/subscription persistence for context.

## Final decision

No remaining actionable money-safety or authority blockers found in the reviewed snapshot. Two independently reproduced P2 recovery defects were reported during review and repaired before this decision. No code was edited by this reviewer.

## Findings and repair verification

1. **P2, repaired: idempotent POST response mistaken for current provider state.** Original location: creator-checkout-recovery.js POST branch and status decision (then lines 65, 75-86); fixture replay branch (then creator-checkout-fixture.mjs:76). Reproduction: provider accepts, response is lost, session later expires, original POST retry replays cached status=open while current GET status=expired. Before repair the retry returned an expired checkout URL and retained the guard; only another resume released it. Final helper lines 85-100 verifies and binds the returned ID, retrieves current state, re-verifies identity, and only then releases verified expiry. Fixture now separates cached POST responses from mutable sessions. The original-expiry acceptance passes using that distinction.

2. **P2, repaired: bound-session owner escalation vanished.** Original location: mark_creator_checkout_outcome session_bound early return (then pending SQL lines 191-195), with creator-billing.js recovery queue filter at line 55. Reproduction: successful bound checkout, then mismatching request metadata on provider GET. Before repair resume returned requires_owner, but status returned ready/recoverable and the owner queue excluded the attempt. Final SQL permits requires_owner while preserving the bound session ID and active guard. The new handler test proves persistent status and queue visibility; native SQL proves that session replacement remains refused and the same verified binding can be restored.

## Checks independently executed after repairs

- node --test scripts/test/creator-checkout-recovery.test.mjs scripts/test/customer-billing.test.mjs: 19 passed, zero failures or skips (18 recovery cases plus the existing billing case).
- scripts/test/creator-checkout-native-db.mjs on PostgreSQL 16.15: all 16 checks passed.
- The same native suite on PostgreSQL 17.11: all 16 checks passed.
- Both native servers were disposable, ran as non-root UID 1000, listened only on 127.0.0.1, disabled Unix sockets, and were stopped and removed by the runner. No external DB URL was supplied.
- git diff --check: clean.

Reviewed safeguards include immutable persisted provider body and owner/request/price binding; permanent rejected/expired receipts; first-dispatch-only proven rejection release; fail-closed later rejection and uncertainty; original idempotency key and 23-hour retry cutoff; serialized owner reservation transitions and competing-dispatch protection; non-replacement of bound sessions; stale negative outcomes; provider-confirmed expiry; active-subscription exclusion; house-owner-only recovery routes and audited reconciliation; anonymous/authenticated SQL denial; append-only audit; mode changes; account switching; and replay retirement. The real recovery helper also ran against native RPCs with synthetic Stripe responses in the final native suites.

## Limits

This is local review and synthetic-provider evidence, not production or live Stripe certification. No live provider call, charge, deployment, push, or real-database migration occurred. The existing webhook was reviewed and exercised with signed synthetic delayed/out-of-order events, not a live webhook stream. This review does not approve applying SQL or deploying. It does not replace the separate UI/mobile review or independent git-am patch-series application. The decision is tied to the hashes below; later substantive changes require re-review.

## Reviewed SHA-256 snapshot

- 4f6d8323b509584ac2506775336ce48498bb925237f152caa6e7a5dfbaf14fa2  workers/mccluster/src/creator-billing.js
- 9dcbb1483f9685f7723b569513e002d52ab6b6c8d3c1b5d5324641758a406a17  workers/mccluster/src/creator-checkout-recovery.js
- 3d11804f28d9965e407a65d4556bfca485c3e76cc748bdf678f0e566955dce0a  workers/mccluster/src/whip/stripe.js
- 15aad9fb8d6688ee0a54592d43da898533ed7adb976e865c2ce951f893296b7e  supabase/pending/20261026009200_creator_checkout_reservations.sql
- 48a8d26836015f64354b985bca8167cb23ae2d33798b3e1ea6e6f6ef0442a6db  supabase/pending/20261026009200_creator_checkout_reservations.rollback.sql
- d4095d6a649a7c77013aed2d93f82123f4017270a51906702f12522ea4f75509  scripts/test/creator-checkout-recovery.test.mjs
- 9a5b07347a15eede26f5aef5bd30d53ed3125798a1b808be88349e66d4b4c4d8  scripts/test/creator-checkout-native-db.mjs
- 7478d54722af4a6d962d5a38193d108d9ce1109bf2c45a2bca2c8a1b0f563592  scripts/test/support/creator-checkout-fixture.mjs
