# Shared marketplace referral contract v1

Authority: `workers/mccluster/src/marketplace/commission-contract.mjs`.
Status: calculation-only, payouts disabled. Not deployed or connected to checkout.

## Owner-approved commercial terms
- Provider: 70% of server-verified commissionable revenue.
- Referrer of paying customer: 5%, maximum $5,000 (500000 cents) lifetime per referred account and referral role.
- Referrer of vehicle owner / driver: 5%, maximum $5,000 lifetime per referred account and referral role.
- Platform operations: 10% plus unearned, unapproved, or capped referral allocations.
- Reserve: 10%, recorded separately and not represented as insurance coverage.
- One cap ledger per (marketplace network, referred account, referral role), shared across rentals and rideshare. A new product, referral link, vehicle, or transaction must not reset the cap.
- Same eligible referrer can receive both roles when legitimately attributable. No downline commissions.
- Commissionable base excludes taxes, tips, tolls, refundable deposits, and pass-through insurance fees. Contracts must specify exclusions.
- Referrers have a contractual right to eligible commissions, not ownership of customers or their personal data.

## Persistence / concurrency requirements before launch
Canonical backend: `mcclusterishere/mccluster` Worker and existing Supabase project. Satellites must not create their own payout or identity databases.
- Versioned, accepted agreement with stable referring and referred principal IDs, role, attribution time, cap amount, product/network, status.
- Atomic lifetime cap ledger keyed by network/referred principal/role, covering **both** rentals and rideshare.
- Immutable commission event with unique transaction/role/attribution key and separate pending, earned, held, reversed, and paid states.
- Transactional lock or stored procedure to reserve cap capacity under concurrent bookings; never rely on a client quote.
- Refund, chargeback, reversal, dispute, anti-self-dealing, and cancellation reconciliation.
- Correct legal entity and verified Stripe Connect account for each provider/referrer; preserve existing payment stack.
- Reserve liability ledger and monthly margin/claims reconciliation.

## Required acceptance gates
- Confirm insurance and rideshare/rental regulatory compliance, signed agreements, and operator entity.
- Positive unit economics after card processing, Connect fees, insurance, support, fraud and expected claims.
- Test simultaneous transactions approaching a cap, duplicate webhooks, refunds, reversals and same-person dual-role commissions.
- Payout flag remains OFF until owner explicitly approves deployment following verification.
- Existing booking endpoints must not trust browser-provided attribution or amounts.
