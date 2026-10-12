# Creator payouts — production schema reconciliation (2026-10-09)

This is a **read-only schema inspection**, not a deployed payment feature. No live funds moved.

## Canonical existing structures

- `action_clip_campaigns`: keyed by `mission_id`; includes `org_id`, `currency`, `budget_cents`, caps, approval mode and status.
- `action_clip_earnings`: `id`, `mission_id`, `org_id`, `claim_id`, `submission_id`, `m_uid`, `kind`, `amount_cents`, `state`, `hold_until`, `basis`, `idempotency_key`, `payout_id`, release/paid/void timestamps.
- `action_clip_payouts`: `id`, `org_id`, `m_uid`, `amount_cents`, `provider`, `provider_ref`, `note`, `recorded_by`, `recorded_at`.
- `org_stripe_accounts`: `org_id`, `livemode`, `stripe_account_id`, `charges_enabled`, `payouts_enabled`, `details_submitted`, `onboarding_status`.
- Existing Worker source `workers/mccluster/src/connect.js` handles **client direct charges**, not McCluster-funded creator transfers. Do not repurpose its direct-charge semantics.
- Existing Supabase `stripe-webhook` handles test/live signature verification and commerce reconciliation. Extend routing deliberately; do not conflate revenue with payout expense.

## Required changes before enabling test transfer

1. Verify existing `action_clip_earnings` release and payout state machine, indexes, RLS, trigger functions, and any ledger reservations. Do not double count `action_clip_payouts` as both transfer and bank payout.
2. Add an append-only funding/commitment/expense ledger with atomic budget reservation and org-scoped RLS. Funding entries require reconciled Stripe test balance or explicitly labeled simulated budget.
3. Add creator-to-Connect-account binding (distinct from `org_stripe_accounts`, which represents merchant organizations); verify onboarding eligibility against Stripe before payment.
4. Add an owner-authorized approval endpoint with durable payout intent, unique earning references and deterministic Stripe idempotency keys.
5. Implement an outbox/retry process: reserve atomically, create test transfer, persist transfer ID, reconcile on retry. Never issue a second transfer when database persistence fails after Stripe succeeds.
6. Add signed webhook handling and deduplicated event records for transfer reversals and connected-account bank payout events; maintain independent transfer and payout status.
7. Add Control owner-only payout screen: budget/available/reserved/spent, pending approval, eligible, transferred, paid out, failed, reversed, and reconciliation exceptions.
8. Exercise concurrent reservations, retry after partial Stripe success, cross-org denial, duplicate/out-of-order webhook, insufficient test balance, and test/live isolation.

## Deployment gates

- All new payment execution routes must reject live keys explicitly during the pilot.
- No production migration until migration-ledger conventions and existing functions are reconciled and test queries pass.
- No claim of end-to-end payout readiness until a Stripe test transfer has succeeded and its resulting ledger entries and UI state are verified.
