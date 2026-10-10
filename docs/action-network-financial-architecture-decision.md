# Action Network financial architecture — decision record (draft, not deployed)

## Economic contract
Goal: platform earns from genuine third-party sales, campaign management and optional software; track creator net earnings and subsidy separately. No pay-to-work or subscription prerequisite for earned payouts.

**Proposed fee**: marginal 1% on first $50 of cumulative eligible earnings per participant per program settlement period, 1.5% on subsequent eligible earnings. Tier calculation must use cumulative qualifying earnings, not the size or count of Stripe transfers. Round at ledger settlement, record fee basis, period, fee schedule version, and refunds. Fee charged exactly once. Sponsor-funded missions may instead use sponsor-paid fees so the advertised $1 bounty pays $1; this must be an explicit per-program policy, never hidden.

## Separate balances and roles
1. Platform operating revenue: platform-owned earned commissions and software revenue.
2. Sponsor campaign funding: actual settled external funds, matched to processor balances and campaign liabilities; NOT legally described as escrow absent approved regulated structure.
3. Campaign allocation: spending authority, not creator-owned withdrawable money.
4. Reward reservation: contingent obligations backed by available funded allocation.
5. Participant payable: verified earnings, net of explicitly disclosed commission when applicable.
6. Processor transfers and payout reconciliation: pending, paid, failed, reversed; no implicit success.
7. Refund/dispute/risk reserve: source-linked reversals and holds, never silently net against unrelated participants.
8. Action Points: separate nonredeemable utility product, $5 minimum purchase proposed; never convert points to cash or pay bounties with them until regulatory approval.

## Ledger requirements
Immutable balanced postings in integer USD cents, scoped by org, campaign, program, recipient, and funding source. Account types asset/liability/revenue/expense; every event has globally unique idempotency key and immutable journal. Database transaction with row-level locks and available-to-spend checks. No negative restricted allocation. Reserve -> approve -> payable -> transfer -> reconcile; explicit void/release/reversal. Refunds and disputes require compensating entries, not edits. Daily Stripe balance transaction reconciliation and exception queue. Audit all admin overrides.

## Connect
- Platform McCluster Corp has card, ACH and transfer capabilities active; platform payouts are manual. These do not prove connected-account fee responsibility.
- Pilot with US-only connected recipients, Stripe-hosted onboarding, KYC handled by Stripe, recipient payout eligibility checked immediately before transfer. Direct merchant sales may need separate connected merchant capability and charge architecture.
- Select `controller.fees.payer` and losses responsibility deliberately at connected account creation after Stripe approval. Evaluate account-paid fees for direct creator sales versus platform-paid fees for centrally collected mission funding. Do not assume funds segregation or top-up eligibility.
- Use separate charges/transfers for platform-collected marketplace charges where approved. Do not call a delayed transfer escrow.
- Store connected account ID, capabilities, requirements, onboarding status, transfer eligibility, country/currency, and fee responsibility. Do not store banking credentials.
- Never create a Stripe transfer before an approved payable with sufficient settled backing; retries reuse idempotency key. Record transfer ID, payout status, failures, disputes, and reversals.

## Pricing unit economics
Track per purchase: gross customer payment, platform-side service fee, creator commission, Stripe card/ACH fee, Connect monthly-active account fees allocated per month, payout fee, refunds, taxes, chargeback costs, net external revenue, recipient net earnings. Do not assume a 1% fee covers a $0.30 fixed card fee. Prefer $5 minimum checkout and batched payouts; $1 bounties are internal liabilities, not $1 card charges. Do not label platform convenience fees as card surcharges without legal review.

## Activation gates
1. Stripe written confirmation of Connect responsibility and applicable negotiated rates, supported funds segregation/top-ups, and charge flow.
2. Legal review of prepaid points, consumer fees, money transmission/escrow representations, employment and tax reporting.
3. Correct the live Stripe business profile and descriptor (currently Street Credit Bureau) before new customer-facing flows.
4. Validate and repair pending SQL migrations before applying: creator clip issuer guard references `action_clip_campaigns.created_by` (verify column); fan payment RPC must validate signed webhook and server-owned purchase mapping, refund order, anti-fraud and multi-purchase qualification. Existing draft SQL is NOT production safe.
5. Implement Stripe Checkout, verified webhook, transfer reconciliation, double-entry ledger, Connect onboarding and tests for concurrency, retries, partial refunds, disputes, failed payouts, role permissions and double fee prevention.
6. Test end-to-end in Stripe test mode, review costs and KYC, only then separately authorize live rollout.

## Metrics
External gross merchandise value; net platform revenue from outside purchases; McCluster subsidy recovery; creator net earnings after fees; creator earnings from outside customers; rewards payable and reserve coverage; fraud losses; effective processing cost per payment and per payout; voluntary software conversion/churn.
