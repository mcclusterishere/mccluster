# Action economy: Gap 2 before Gap 4
Status: staged only; no financial routes authorized for production.

## Gap 2 — ledger acceptance gates
- [x] Code: canonical idempotency fingerprint; conflicting reuse raises an error.
- [x] Code: deterministic account lock ordering, account/currency constraints and platform-account uniqueness.
- [x] Code: currency-balanced postings and nonnegative spendable balances.
- [ ] Execute SQL migration in isolated staging; verify pgcrypto extension schema, privileges, functions and RLS.
- [ ] Execute two-session concurrent debit tests: same wallet, different keys, insufficient combined balance.
- [ ] Execute simultaneous reversed account ordering test: no deadlocks or partial postings.
- [ ] Execute same-key exact replay and different-payload replay, including simultaneous requests.
- [ ] Test missing account, duplicate account, zero amount, overflow, rollback and malformed UUID.
- [ ] Review role grants and ensure no privileged bypass via alternate write paths.
- [ ] Design provider-backed chargeback/refund/recovery with event provenance and bounded negative-liability policy.
- [ ] Review payout holds and withdrawal reservation transitions; do not permit double payout.
- [ ] Review schema against existing clipping ledger to avoid duplicated liabilities.
- [ ] Security, accounting and provider review before production apply.

## Gap 4 — settlement acceptance gates (blocked on Gap 2)
- [ ] Immutable purchase lot: provider-confirmed purchase, units issued, channel, purchase price, taxes/fees, refund status and policy version.
- [ ] FIFO consumption in one transaction with row locks; never accept client-supplied lot prices or available units.
- [ ] Gift event idempotency and atomic A-unit debit, creator pending USD accrual, and platform offsets.
- [ ] Promotional lots contribute zero monetary compensation; validate policy/terms.
- [ ] Deterministic fractional-cent rounding with auditable remainder treatment.
- [ ] Refund/chargeback reversals linked to original lots, gifts and creator compensation; freeze withdrawals when required.
- [ ] Verified tests for parallel gifts, same gift retries, partially refunded lots and race with payout.
- [ ] No purchase/gift/withdraw endpoints until legal/provider authorization and end-to-end reconciliation.

## Operational constraints
Use staging first; no direct production migrations, real payments or live payout activation. The current JS FIFO settlement is a pure prototype, not connected to the database.
