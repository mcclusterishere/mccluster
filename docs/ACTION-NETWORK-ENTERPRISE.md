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


## Founder 20 fulfillment capacity gate and geography fix
- Before any Founder 20 checkout is enabled, reserve each promised deliverable against an explicit quarterly capacity ledger: deliverable_id, founder_contract_id, quarter, owner creator_id, role, location, required collaborators, estimated hours, production window, approval date, usage rights, budget and status.
- Founder 20 guarantees a scoped output inventory, **not** 20 simultaneous on-demand creators or unrestricted labor. Each placement can have a defined campaign contribution; reserve exclusive production slots to prevent double-selling.
- U.S.-based videographers handle local founder shoots only when same-metro scheduling and studio access are confirmed. International teams complete colocated local artist/engineer/videographer shoots; remote producers, editors and promotional creators support founder campaigns across borders. Any cross-border travel, equipment rental or local substitute production requires separate quote and approval.
- Cohort artist video, founder video and McCluster corporate commercial are distinct deliverables with separate source assets, approvals and acceptance tests; reposts/derivative edits may count as distribution, not new original shoots.
- Client sales gate: only accept paid founder commitments once project manager availability, creative team assignments, verified filming location, rights templates, production cost assumptions, and per-quarter delivery capacity are validated. Otherwise collect nonbinding inquiries, not payment.
- Budget safeguard: quote separately for travel, rentals, additional shooting days, extensive revisions, mixing/mastering beyond defined scope, ad spend, and usage beyond the contract. Audit effective compensation and local labor law before relying on low stipend assumptions.


## Founder 20 positioning: your branded clipping platform (Oct 9)
- Lead pitch: **“Run your own branded clipping platform, powered by Action Network, with 20 distinct creators rotating through your campaigns each year.”** Do not imply transfer of ownership of McCluster source code, social graph or shared identity infrastructure; the client licenses a branded hosted experience.
- The contractual rotation is five NEW, non-repeating creator placements per quarter, 20 distinct placements over 12 months, not 20 simultaneous workers. Each placement has specified campaign deliverables and attribution; no guarantee of unique audience reach or results.
- Founder-facing feature set: branded campaign portal and URLs, product/music briefs, eligible clip submissions, campaign rules, fan bounty pool controls, creator approvals, usage-rights records, verified signups/returning-user attribution, campaign analytics and monthly reports. Mark each feature as planned until production implementation is confirmed.
- Distinguish **Founder 20 placements** from the total accelerator supply of 40 annual U.S. + international placements: specify which 20 are contractually reserved and avoid selling the same exclusive capacity to multiple clients. A founder may receive a blended domestic/international roster only when allocations and collaboration constraints permit.
- Sales pricing proposal remains $12,000 prepaid annual or $1,200/month on a 12-month commitment. Client-funded advertising and fan bounties must be separately budgeted and disclosed; never promise a $20 fan incentive per participant as included in both accelerator and founder contract without accounting for who pays.
- Reconcile the earlier music-production inventory as optional scoped campaign services rather than the primary pitch; avoid guarantees of founder music video shoots, studio time, or exclusive copyrights under a basic clipping platform contract without capacity and price approval.


## Founder 40 correction — authoritative Oct 9
- **McCluster artist internal beta is Founder 40, not Founder 20.** It uses both U.S. and international quarterly production tracks: 5 distinct new U.S. creators plus 5 distinct new international creators per quarter, 10 active per quarter, 40 distinct creators annually (20 per track), subject to actual recruitment and completion.
- All 40 annual creator placements are scoped to the founder's coordinated music/content campaigns for this internal beta, with domestic/international production collaboration, distributed recording and video shoots, editing and clipping. A shared production may include many credited contributors; count deliverables separately from placements.
- Founder 20 remains the proposed external 20-placement product ($12,000 annual prepaid or $1,200 monthly on annual commitment). Founder 40 is a distinct larger tier; **no external Founder 40 price is approved yet** and no paid Founder 40 offer should be published until costed.
- Preserve nonbillable internal entitlement, actual-cost accounting, funded incentives, security/rights gates, and clear cross-border responsibilities. Supersedes prior wording treating international collaboration as merely optional Founder 20 overage for the McCluster beta.
