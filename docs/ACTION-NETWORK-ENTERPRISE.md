# Action Network Enterprise — white-label managed influencer network

## Commercial proposal (not yet launched)
- $9,000/year per customer ($750/month equivalent), with a roster capacity of 10 influencers.
- Interpretation pending confirmation: customer funds **2× the internal $50/month incentive**, or $100 per influencer monthly ($1,000 total).
- If the $100/month per influencer incentive is included, annual payouts are $12,000, exceeding annual revenue by $3,000 before operating expenses. This structure is not viable without subsidy or a changed incentive.
- If client funds incentives separately, annual charges would be $9,000 platform fee plus $12,000 incentive budget, totaling $21,000, before any additional services.
- Specify whether the $12,000 annual incentive budget is included in or added to the $9,000 annual fee; no default until owner confirms. Prohibit double billing.
- Payment model must distinguish client-to-McCluster subscription, client-funded creator incentives, creator advance, conditional milestone remainder, refunds, chargebacks, and payout eligibility.
- No guaranteed audience growth or plays. Quotas should be mutually agreed, measured from trusted first-party data, and reviewed by humans.

## Multi-tenant architecture
Add enterprise_customer_orgs and enterprise_programs to existing org structure, not a second identity system.
- enterprise_programs: id, customer_org_id, provider_org_id, plan_version, roster_limit=10, annual_fee_cents=900000, monthly_equivalent_cents=75000, monthly_incentive_budget_cents=100000, billing_status, contract_signed_at, status.
- enterprise_program_members: program_id, partnership_id, influencer_person_id, role, effective_from/to; cap active roster at 10 transactionally.
- enterprise_program_staff: program_id, person_id, role (client_owner, client_manager, mccluster_admin, producer, influencer), permissions.
- enterprise_campaigns, enterprise_campaign_quotas, enterprise_campaign_assignments, enterprise_monthly_reviews, enterprise_invoices and enterprise_creator_payouts reference program_id and org_id.
- Scope analytics, media, tasks, notifications, Stripe customers, domains and exports by tenant. Enforce RLS plus server-side permission checks, including cross-tenant negative tests.
- Client-branded dashboard, ten influencer sites, monthly quota overview, task and review inbox, notification preferences, invoices and budget reconciliation.
- Provider Control dashboard manages multiple customer programs, staffing capacity, SLA and margin reporting without exposing other tenants.
- Device push is opt-in, delivery deduplicated and scoped to assigned staff. Escalate missed milestones to the designated account manager.

## Launch gates
1. Confirm meaning of 2× incentive, who funds it, and whether included in $9,000 annually.
2. Define deliverable and service limits, creator ownership and licensing, contract term, termination, platform costs, and disclosures for paid endorsements.
3. Prove unit economics with production labor estimates and pilot conversion results.
4. Build migrations, API/RLS, dashboards, Stripe invoicing and reconciled payouts, creator-site provisioning, quota scheduler, and notification pipeline.
5. Validate tenant isolation, financial idempotency, accessible UI and deployment rollback before selling or activating accounts.

**Status:** commercial architecture specification only. No billing, customer tenancy, provisioning or payments implemented.
