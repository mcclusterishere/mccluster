# Financial authorization audit — 2026-10-11

Status: **NOT CLEARED**. Static source inspection only; no production runtime, Stripe test-mode, concurrency, or RLS verification performed.

## P0 — Level 3 refund integrity
File: `supabase/functions/l3-refund/index.ts`.
- Good: validates Supabase bearer token, requires `level-3-media` owner membership, and scopes order lookup to org.
- Gap: requested amount is clamped to original `o.amount_cents`, not verified remaining refundable balance. No persisted refund reservation or request idempotency key is used.
- Gap: `full` compares this single refund to original order amount. A sequence of partial refunds can sum to a full refund without revoking entitlements.
- Gap: order state is written after the external Stripe call; concurrent requests can both observe the same old state.
- Gap: a failed DB write after a successful Stripe refund can leave state inconsistent; no reconciliation path is visible here.
- Gap: amount validation uses coercion/truthiness; reject non-integer, NaN, negative, zero and excess values explicitly.
- Do not patch by simply adding a static idempotency key: separate intentional partial refunds must remain possible. Use a durable operation ID with a unique constraint, atomic reservation/locking, Stripe idempotency key derived from operation ID, and webhook-based reconciliation.

## P0 — Whip operator identity
File: `workers/mccluster/src/whip/worker.js`.
- Removed demo header-based identity/operator bypass on this branch.
- Removed operator email fallback; require immutable `auth_user_id` membership.
- Pending: live config verification and unauthorized request tests.

## P1 — Stripe Connect / creator payouts
Files: `workers/mccluster/src/connect.js`, `workers/mccluster/src/action-connect.js`, `workers/mccluster/src/creator-billing-webhook.js`.
- Source review confirms role checks on Connect mutations and signature verification on creator-billing webhook.
- Need transfer endpoint inventory, ledger-to-transfer idempotency and reversal tests, webhook replay and race tests, destination account binding, test/live key separation.

## Release gates
1. Anonymous/member/other-tenant/owner role matrix for every financial mutation (401/403 expected).
2. Concurrent refund and transfer integration tests with durable idempotency records.
3. Stripe test-mode partial-refund sequence and entitlement revocation verification.
4. RLS policy and service-role write audit; production environment flags/secrets and deployed SHA verification.
5. CI green on final commit; no production deployment before financial reconciliation checks pass.
