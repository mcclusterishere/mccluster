# McCluster Platform launch implementation checklist

Status: design and static pricing UI in PR #400; **not production ready**. Do not claim any task is complete until it is tested end-to-end.

## Actual customer flow (acceptance criteria)

1. An unauthenticated visitor sees the accurate Starter price ($7.50 monthly / $60 yearly) and transparent Plus, Pro and Business plans.
2. Customer authenticates and receives a free, editable, basic creator profile without having to be selected for a cohort or paying. Public publishing requires opt-in, rights declarations and moderation.
3. Customer can edit safe template fields (bio, links, images, approved palette); view a preview; save and reopen changes; public visitors can see approved content only. The central M in a creator profile context points to that profile, regardless of identity verification.
4. Customer selects a plan and billing period. Server creates a Stripe Checkout session from a server-owned price mapping. Never trust plan price or entitlement sent by browser.
5. A verified, idempotent webhook activates the subscription and provisions an organization workspace. Handle failed checkout, delayed events, duplicate events, renewals, cancellations, upgrades, downgrades, disputes and refunds.
6. Plan limits are enforced on server operations (storage bytes, egress bandwidth, API requests, team seats, sites, active campaigns, active workers, analytics retention, processing jobs). Deny or queue over-limit work with a clear upgrade path; no silent overage fees.
7. Paid creators can access a client-scoped clipping dashboard and browse only consented, available workers. They can create a draft, invite workers, configure Founder 20/40 annual capacity presets or custom targets, and issue transparent compensation offers.
8. Only provider-verified, reconciled client funding can authorize a paid assignment and subsequent worker earnings. Browser-entered receipts or internal allocations must not masquerade as Stripe-confirmed funding. Preserve existing clipping ledger invariants.
9. Domain availability and actual registrar quotes are checked before purchase; renewal pricing, ownership and transfers are disclosed. Domain lifecycle is separate from site subscription and free profile.
10. Creator-specific brand, campaign attribution, analytics, payouts and worker consents remain tenant-scoped. A client can never read unrelated worker private contact details or another tenant's campaign.
11. Tests cover RLS cross-tenant denial, webhook replay, failed payment, plan enforcement, funding collision/replay, domain renewal, media rights and accessibility. Run staging E2E before production migration/deployment.

## Confirmed existing reuse

- `orgs` and owner authorization for tenant boundaries.
- `action_clip_campaigns`, `clip_campaign_create`, `clip_campaign_fund`, `clip_campaign_dashboard`, `action_clip_earnings` and existing clipping UI.
- `network_profiles`, `music_creator_profiles`, `creator_tracks`, `network_media_assets` for creator identity and portfolios.
- Existing Stripe and Control infrastructure must be audited before integration; do not duplicate economic ledgers.

## Immediate known blockers

- Pricing is currently static UI; no subscription checkout.
- Paid subscription does not yet grant creator-org provisioning and secure campaign authorization.
- Creator profile editor, media upload, public publishing and moderated discovery are not yet end-to-end.
- Existing clipping UI explicitly says card funding is not connected; manual funding records are not equivalent to provider-verified client payment.
- Plan quotas shown on the website are proposed, not enforced.
- No registrar-backed domain purchase/renewal flow.
- No proof of full CI/staging deployment for this PR.

## Pricing source of truth to implement

Starter monthly 750 cents; Starter annual 6000 cents (equivalent 500 cents/month). Proposed Plus 1500 cents monthly, Pro 4000 cents monthly, Business 9900 cents monthly; no annual discount for these until explicitly approved. Domain registration and renewals are additional; worker budgets are separate. The first 10,000 eligible unique creator accounts may receive founding offer eligibility, without conferring verification or guaranteed cohort selection.
