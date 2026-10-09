# Action Network Enterprise — white-label managed influencer network

## Commercial proposal (not yet launched)
- $9,000/year per customer ($750/month equivalent), with a roster capacity of 10 influencers.
- Confirmed payout rule: each of 10 influencers receives $50/month, in two $25 installments (start and middle of each month), for $600/year per influencer and $6,000/year total. The $25 installment is not the monthly rate.
- Annual client fee $9,000 minus annual influencer compensation $6,000 leaves $3,000/year ($250/month) before all other operating expenses.
- Influencer compensation is included in the $9,000 annual client price; do not invoice separately by default.
- Payout allocations, advance vs milestone conditions, and service obligations must be set by signed program terms and tracked in the ledger.
- Payment model must distinguish client-to-McCluster subscription, client-funded creator incentives, creator advance, conditional milestone remainder, refunds, chargebacks, and payout eligibility.
- No guaranteed audience growth or plays. Quotas should be mutually agreed, measured from trusted first-party data, and reviewed by humans.

## Multi-tenant architecture
Add enterprise_customer_orgs and enterprise_programs to existing org structure, not a second identity system.
- enterprise_programs: id, customer_org_id, provider_org_id, plan_version, roster_limit=10, annual_fee_cents=900000, monthly_equivalent_cents=75000, monthly_incentive_budget_cents=50000, billing_status, contract_signed_at, status.
- enterprise_program_members: program_id, partnership_id, influencer_person_id, role, effective_from/to; cap active roster at 10 transactionally.
- enterprise_program_staff: program_id, person_id, role (client_owner, client_manager, mccluster_admin, producer, influencer), permissions.
- enterprise_campaigns, enterprise_campaign_quotas, enterprise_campaign_assignments, enterprise_monthly_reviews, enterprise_invoices and enterprise_creator_payouts reference program_id and org_id.
- Scope analytics, media, tasks, notifications, Stripe customers, domains and exports by tenant. Enforce RLS plus server-side permission checks, including cross-tenant negative tests.
- Client-branded dashboard, ten influencer sites, monthly quota overview, task and review inbox, notification preferences, invoices and budget reconciliation.
- Provider Control dashboard manages multiple customer programs, staffing capacity, SLA and margin reporting without exposing other tenants.
- Device push is opt-in, delivery deduplicated and scoped to assigned staff. Escalate missed milestones to the designated account manager.

## Launch gates
1. Implement two $25 installments per influencer per month (e.g. 1st and 15th), with idempotent payment records, clear eligibility rules, and exception handling.
2. Define deliverable and service limits, creator ownership and licensing, contract term, termination, platform costs, and disclosures for paid endorsements.
3. Prove unit economics with production labor estimates and pilot conversion results.
4. Build migrations, API/RLS, dashboards, Stripe invoicing and reconciled payouts, creator-site provisioning, quota scheduler, and notification pipeline.
5. Validate tenant isolation, financial idempotency, accessible UI and deployment rollback before selling or activating accounts.

**Status:** commercial architecture specification only. No billing, customer tenancy, provisioning or payments implemented.
