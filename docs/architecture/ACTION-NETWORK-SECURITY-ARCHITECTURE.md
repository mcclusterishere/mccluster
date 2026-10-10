# Action Network — Secure multi-tenant architecture v1

Status: proposed implementation architecture; not evidence that controls are deployed.

## Trust boundaries
- Shared Mnet authentication provides one canonical subject ID across founder-branded portals. Tenant identity is an explicit server-validated context, never inferred from client-supplied org IDs alone.
- Membership is scoped to tenant and role. Distinguish network operator, founder owner, tenant admin, cohort manager, creator, fan and service worker. Users can hold multiple memberships. Founder permissions never imply global fan-data access.
- Each tenant-scoped resource (campaign, assignment, clip, submission, reward, wallet ledger, payout, media, analytics, CRM record, rights agreement, hosted domain) carries tenant_id and is guarded by database RLS plus API authorization. Deny by default, force RLS on tenant tables, and test cross-tenant denial.
- Use scoped object storage paths and short-lived signed URLs; no direct public access to private originals, raw analytics or contracts.
- Do not equate verified creator/brand status with verified fan identity; they have distinct verification states and badges.

## Proposed service boundaries
1. Identity: signup, verified email, abuse risk, sessions, device/rate-limit signals, membership and revocation.
2. Tenant and branded portal: verified handle and domain mapping, theme, entitlements, subscription lifecycle and isolation.
3. Campaigns and assignments: founder-funded briefs, eligible creators, deliverables, approvals, publishing windows and capacity reservations.
4. Attribution and anti-abuse: signed referral tokens, first/last touch, consent, signup source, bot filters, deduplicated distinct return activity.
5. Incentives and ledger: campaign funding, reservation, unique claim, redemption, refund/release, immutable transaction log and payout reconciliation.
6. Media and rights: uploads, malware scanning, copyright/license attestations, signed split sheets, publishing and master rights, access grants.
7. Reporting: creator-scoped funnels, tenant-scoped dashboards, network operator aggregate deduplication; protect raw event access.

## Core data model (migration plan, reconcile against existing schema first)
- network_subjects (canonical auth user mapping); subject_verifications (verification evidence/state, expires_at)
- tenant_memberships (tenant_id, subject_id, role, status, granted_by)
- founder_contracts (tenant_id, pricing, term, capacity, deliverables, signed agreement)
- creator_placements (tenant_id, cohort_id, subject_id, role, quarter, capacity, no-repeat check)
- production_assignments (tenant_id, creator_placement_id, deliverable_type, location, deadline, approval, campaign_id)
- campaign_attribution (tenant_id, campaign_id, subject_id nullable, anonymous_session_id, touch_type, consent_state, event_time)
- verified_return_activity (subject_id, tenant_id, creator_id, event_day, event_type, risk_decision, attribution_id)
- incentive_offers (tenant_id, campaign_id, type, max_claims, per_subject_limit, expires_at, funding_source)
- incentive_claims (offer_id, tenant_id, subject_id, state, idempotency_key, reserved_at, redeemed_at)
- financial_ledger_entries (tenant_id, transaction_id, account, debit_credit, amount_minor, currency, external_ref, immutable)
- media_rights (asset_id, tenant_id, copyright_role, rightsholder, license, effective_at, signed_evidence)
- audit_events (tenant_id nullable, actor_subject_id, action, resource_type, resource_id, trace_id, outcome, occurred_at)

Reuse existing repo tables when they provide these semantics. Never create a second source of truth for identity, payments or campaigns.

## Mandatory security invariants
- I1 Cross-tenant reads and writes are denied by default, including aggregate queries and signed media URLs.
- I2 No founder can alter a creator's global identity, another tenant's subscriptions, or platform-wide verification.
- I3 An offer claim is atomically reserved and unique per (offer_id, subject_id); single-inventory offers cannot oversubscribe under concurrent requests. Self-claims and self-referrals are ineligible.
- I4 Every money movement uses idempotency keys, a double-entry ledger and verified payment-provider webhooks; client callbacks cannot mark a payout complete.
- I5 Verified returning user = one verified canonical subject with eligible human-reviewed/risk-passed meaningful events on >=2 distinct days. Count each subject once network-wide and separately track subject-creator relationships.
- I6 No raw view count, unverified signup, bot challenge completion, or self-visit independently qualifies as a returning user.
- I7 Signed music/video rights and approved usage precede distribution. Paid catalog isolation never rewrites preexisting rights.
- I8 Founder 20 sells 20 distinct annual placements, five per quarter; assign capacity before billing and reject double-booking of exclusive deliverables.
- I9 All admin actions, milestone decisions, claims, refunds, permissions and verification changes generate immutable audit events with trace correlation.
- I10 Minimize PII; retain risk evidence for defined periods, limit privileged access, encrypt sensitive data and provide review/appeal process.

## Release gates
G0 Inventory current Supabase schemas, RLS, auth claims, API routes, media access and Stripe events; publish threat model.
G1 Add failing tests for unauthorized cross-tenant access, privilege escalation, spoofed referrals, duplicate claims, webhook replay and analytics inflation.
G2 Implement RLS/API guards, creator identity and fraud state, auditable returning-user events.
G3 Implement atomic offers/claims and ledger reservations with provider-backed settlement reconciliation.
G4 Implement domain/portal entitlement enforcement, rights evidence and Founder 20 capacity ledger.
G5 Run migration tests, adversarial concurrency tests, privacy review and staged production rollout with rollback.

No payments, real user verification, domain white labeling, or founder sales may be represented as ready until the corresponding release gate passes.


## Qualified creator acquisition — account AND subscription (Oct 9 authoritative)
- A creator's **qualified acquisition** is counted only when all conditions hold: (1) visitor arrives using an attributable, server-validated creator referral token tied to campaign/creator; (2) visitor creates a **new canonical Mnet account** and completes account verification; (3) the same account actively subscribes/follows **that referring creator**; (4) acquisition passes self-referral, duplicate and abuse checks. All three identity, referral and subscription facts must join server-side; do not trust client-only success events.
- Track raw link clicks, sessions, signup starts, accounts created, verified accounts, creator subscriptions and qualified acquisitions as separate events. A signup without the correct subscription is a pending conversion, not a qualified acquisition. Subscription to another creator does not qualify the original creator.
- Preserve signed first-touch referral attribution through signup, email verification and subscription using server-side short-lived state plus durable pending attribution after account creation. Publish explicit attribution-window and consent policy. Never rely exclusively on UTM parameters, local storage or client cookies for authoritative credit.
- Use a unique database constraint for qualifying acquisition per (referring_creator_id, new_subject_id), with transactionally validated new-account timestamp, referral association, subscription state and verification status. No duplicate credit after refresh, retries or webhook replay. An existing account or existing subscriber may count as engagement or follow growth, but not a **new-account acquisition**.
- Keep qualified acquisitions separate from verified returning users (meaningful eligible activity on >=2 distinct days), and separate from follower/subscription totals. Preserve the attribution ledger and subscription cancellation events; define whether reward eligibility requires the subscription to remain active for a minimum retention window before payout.
- Test: referral A -> account -> subscribe B => zero A qualified acquisitions; referral A -> account -> subscribe A before verification => pending then qualify on verification; existing account -> subscribe A => new follower, not new-account acquisition; same subject repeated clicks/joins => at most one acquisition per creator; self-referral => rejected.
