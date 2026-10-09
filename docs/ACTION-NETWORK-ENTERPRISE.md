# Action Network Enterprise — scalable white-label influencer network

## Pricing policy (proposed; not live)
- Capacity selector: integer 1 through 1,000,000. Presets for 5 and 10 are shortcuts, not separate products. A million is a pricing-input ceiling, **not** a claim of current operational capacity.
- Annual rate: $1,200 per active contracted influencer, inclusive of $600 annual influencer compensation and $600 retained by McCluster before other costs.
- Annual prepaid: 12 × $100 × N, due upfront.
- Annual contract with quarterly installments: 4 × ($300 × N), each installment covering three months; 12-month commitment.
- Month-to-month trial/flexible contract: 1.5 × annual-equivalent monthly rate = $150 × N per month; $50 × N creator compensation, $100 × N retained before costs. Do not call this an annual commitment.
- Influencer compensation: $50 per influencer per month, in two $25 installments at the start and middle of the month, with agreed eligibility rules. Do not mistake the $25 installment for the monthly rate.
- For N=5: annual prepaid $6,000; quarterly $1,500; flexible monthly $750.
- For N=10: annual prepaid $12,000; quarterly $3,000; flexible monthly $1,500.
- Contract amendment, prorations, roster changes, cancellations, refunds, payment failures, reserves, and trial-to-annual conversions require explicit billing rules. Never charge on the basis of a client-only count input without validated entitlements.
- Separate client billing ledger from influencer payouts; no payout until contract, funding, identity and eligibility checks succeed.
- No guaranteed audience growth or plays; quotas should be mutually agreed, sourced from trustworthy analytics, and human-reviewed.

## Implementation requirements
- Price server-side in integer cents: annual_total = 120000*N; quarterly_installment = 30000*N; flexible_monthly = 15000*N. Enforce safe integer bounds and versioned price quotes.
- Per-program roster_limit is purchased capacity; active seats are constrained by the contract. Allow seat increments with explicit amendments and invoicing.
- Stripe invoices/subscriptions must use idempotent reconciliation and webhooks; never trust client-calculated totals.
- Annual installment terms must make all four quarterly payments and renewal behavior explicit. Quarterly prepayment is three months of coverage, not a three-month contract.
- Large capacities require sales approval, capacity planning, support staffing, rate-limit design, queue-based provisioning, and load tests before acceptance.
- Preserve multi-tenant RLS, creator privacy, delegated roles, notifications, asset licenses and payout auditability.

## Multi-tenant architecture
Add enterprise_customer_orgs and enterprise_programs to existing org structure, not a second identity system.
- enterprise_programs: id, customer_org_id, provider_org_id, plan_version, roster_limit, price_version, billing_cadence, annual_rate_per_seat_cents=120000, monthly_creator_comp_per_seat_cents=5000, billing_status, contract_signed_at, status.
- enterprise_program_members: program_id, partnership_id, influencer_person_id, role, effective_from/to; cap active roster at purchased roster_limit transactionally.
- enterprise_program_staff: program_id, person_id, role (client_owner, client_manager, mccluster_admin, producer, influencer), permissions.
- enterprise_campaigns, enterprise_campaign_quotas, enterprise_campaign_assignments, enterprise_monthly_reviews, enterprise_invoices and enterprise_creator_payouts reference program_id and org_id.
- Scope analytics, media, tasks, notifications, Stripe customers, domains and exports by tenant. Enforce RLS plus server-side permission checks, including cross-tenant negative tests.
- Client-branded dashboard, contracted influencer sites, monthly quota overview, task and review inbox, notification preferences, invoices and budget reconciliation.
- Provider Control dashboard manages multiple customer programs, staffing capacity, SLA and margin reporting without exposing other tenants.
- Device push is opt-in, delivery deduplicated and scoped to assigned staff. Escalate missed milestones to the designated account manager.

## Launch gates
1. Implement two $25 installments per influencer per month (e.g. 1st and 15th), with idempotent payment records, clear eligibility rules, and exception handling.
2. Define deliverable and service limits, creator ownership and licensing, contract term, termination, platform costs, and disclosures for paid endorsements.
3. Prove unit economics with production labor estimates and pilot conversion results.
4. Build migrations, API/RLS, dashboards, Stripe invoicing and reconciled payouts, creator-site provisioning, quota scheduler, and notification pipeline.
5. Validate tenant isolation, financial idempotency, accessible UI and deployment rollback before selling or activating accounts.

**Status:** commercial architecture specification only. No billing, customer tenancy, provisioning or payments implemented.


## Founder 20 commercial package — revised Oct 9, 2026
- Founder is a **paying client** rather than a $75/month paid star-creator role. Founder 20 is a proposed 12-month managed music creator and distribution package: $12,000 annual upfront or $1,200/month ($14,400 over 12 months), subject to signed term, service limits and fulfillment capacity.
- “20 Clippers” means 20 annual creator placements across four quarterly five-person pods, **not** 20 full-time simultaneous contractors. Client receives defined campaign output and reporting, not an unrestricted claim on each participant's time or copyrights.
- Initial supported vertical: music founder (recording artist/label/music brand). Proposed annual minimums: four founder-focused shoots, four finished founder videos, four music collaborations or production packages (scope and rights to be agreed), 24 vertical promotional clips, 20 coordinated creator collaboration posts, and 12 monthly performance reports. Per quarter: 1 shoot, 1 finished video, 1 music collaboration/production, 6 clips, 5 collaboration posts, 3 reports.
- Founder-specific output is separate from cohort artist work, McCluster company campaigns, and creator training objectives. Allocate exact hours, usage rights, travel, revisions, approval deadlines, posting windows, cancellation and make-good policies before sale. Do not promise simultaneous geographic production access or guaranteed audience conversions.
- Founder-client revenue is not a replacement for the existing creator stipend/fan reward ledger; separately track delivery cost, coordinator wages, creator payments, hosting, promotion and margin. Founder role no longer counts as a $75/month program cost, unless a distinct founder-creator service contract is approved.
- Future founder verticals (videographer, producer, engineer, editor) require separate service inventories and economics; do not publish them as purchasable until scoped.
