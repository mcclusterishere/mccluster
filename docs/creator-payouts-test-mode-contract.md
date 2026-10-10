# McCluster-funded creator payouts — test-mode implementation contract

Status: implementation scaffold; **no live transfers enabled**.

## Invariants
- Creator publication never requires Stripe onboarding; payment does.
- Every payable earning references a verified clip, mission, or signed retainer milestone and its approving owner.
- Financial amounts are integer minor units with explicit currency; no floating-point balances.
- A campaign has a budget ceiling. Available = funded - reserved - spent; reservations must be transactional and never negative.
- A creator cannot approve their own earnings. Owner approvals require server-side authorization and an immutable audit entry.
- Payment execution must verify account eligibility, sufficient platform Stripe available balance, approved payable earnings, and unspent reservation.
- Use Stripe Connect account IDs stored server-side. Never accept arbitrary destination accounts from the client.
- Every transfer uses a stable idempotency key derived from the earning payment ID. Retries must not create additional transfers.
- Persist Stripe transfer ID, transfer_group, status, and the source charge or funding reconciliation reference where applicable.
- Transfers and connected-account bank payouts are separate events; webhook handling must tolerate out-of-order, repeated, and delayed events.
- Never mark bank payout complete merely because a transfer succeeded.
- Reversals, disputes, failed payouts, and adjustments create compensating ledger entries, never silently rewrite history.
- No payout or bank-funding operation in live mode until an explicit release gate and owner approval.

## Proposed data model (requires reconciliation against existing production schema)
campaign_funding_accounts(org_id, campaign_id, currency, budget_minor, funded_minor, reserved_minor, spent_minor)
creator_payout_accounts(org_id, creator_id, stripe_account_id, onboarding_status, payouts_enabled)
creator_earnings(org_id, creator_id, campaign_id, source_kind, source_id, amount_minor, currency, verification_status, approved_by, approved_at)
creator_payouts(org_id, earning_id, idempotency_key, stripe_transfer_id, amount_minor, currency, state)
creator_payout_events(org_id, payout_id, provider_event_id, event_type, payload_hash, recorded_at)
creator_ledger_entries(org_id, campaign_id, creator_id, payout_id, kind, amount_minor, currency, created_at)

All tables must enforce tenant isolation, unique source-to-earning and earning-to-payment constraints, and deny public writes. Confirm existing naming and RLS conventions before generating migrations.

## Test-mode acceptance
1. Create a campaign with simulated $100 budget and reserve $30; available shows $70.
2. Two concurrent reservations cannot oversubscribe a campaign.
3. A clip is submitted and verified; no payout without owner approval.
4. A creator may publish without a connected account; payouts remain blocked until onboarding and eligibility complete.
5. Approved $20 earning creates at most one Stripe test transfer even after retries and webhook replay.
6. Insufficient Stripe test balance blocks transfer without changing earning to paid.
7. Out-of-order and duplicate webhook deliveries do not double-post ledger entries.
8. A transfer reversal creates a compensating entry and restores correct financial state.
9. Cross-organization attempts to approve or pay earnings fail.
10. Control displays funding, reserved, spent, payable, transfer, and bank-payout states separately.

## Next engineering step
Inspect existing Stripe checkout/sales ledger, Connect integrations, migration ledger, Worker auth routes, and Control Work payment tables. Reuse canonical financial records rather than creating competing ledgers. Implement migrations, Worker routes, webhook processors, Control UI and automated integration tests on this branch. Do not apply production migrations or enable live transfers as part of test-mode validation.
