# Founding influencer program — implementation contract

Status: landing page implemented; authenticated onboarding, quotas, notifications and payouts NOT implemented.

## Scope
Five invitation-only founding creators. $50 monthly subscription per creator, $25 advance credited against the $50 and up to $25 milestone balance. Never automatically transfer money from unverified analytics.

## Data model
- influencer_partnerships: id, person_id, owner_org_id, status, invitation_token_hash, terms_version, signed_at, monthly_subscription_cents, advance_cents, creator_site_id, start_at, end_at.
- influencer_social_accounts: partnership_id, platform, handle, profile_url, verification_status, follower_baseline, consent_at; unique(partnership_id, platform, handle).
- influencer_assets: partnership_id, asset_id, kind, usage_license, review_status.
- influencer_sites: partnership_id, hostname, deployment_status, analytics_property, owner_of_domain, hosting_terms.
- influencer_quotas: partnership_id, period_start, period_end, metric, target, baseline, measurement_source, approved_at.
- influencer_metric_daily: partnership_id, site_id, metric, date, verified_value, provenance, dedupe_key.
- influencer_tasks: partnership_id, assignee_person_id, title, due_at, status, evidence_asset_id, reviewer_person_id.
- influencer_notifications: recipient_person_id, partnership_id, event_type, channel, delivered_at, read_at, dedupe_key.
- influencer_milestones: partnership_id, period, review_status, approved_by, approved_at, payout_eligible_cents, ledger_reference.

## Security and integration
Reuse existing person/auth/org identity, Control work, media storage, analytics, notification infrastructure and Stripe ledger. Enforce org+partnership-scoped RLS and server-side authorization for every read/write. Never trust browser-submitted play counts or follower counts for payouts. Use consented provider integrations where available; clearly label unverified social metrics. Store only hashed invitation tokens, expire and rate-limit invitations. Push requires device opt-in; use a queue and idempotent delivery. Admin reminders must target assigned admins, not every admin indiscriminately.

## Onboarding
Invitation -> consent/terms -> social inventory (Instagram, TikTok, YouTube, Facebook, Twitch, other) -> asset submission -> missing-account checklist -> domain/brand decisions -> site preview -> approval -> quota agreement -> activation. No payments before signed terms and payout verification.

## Admin and creator UI
Creator: overview, site analytics, social accounts, asset requests, tasks, quota progress, payout statements, service requests.
Control: five-slot roster, intake review, site production queue, monthly targets, owner/assignee, alert thresholds, review and approve milestones, ledger reconciliation, notification history.
Quotas: unique visitors and qualified plays with explicit time window, anti-bot rules, attribution, and source; show progress and projected pace, never promise traffic.

## Follow-on delivery
1. Confirm program terms and actual approved contact inbox (landing page email is placeholder pending verification).
2. Implement migrations in normal migration ledger and RLS tests; no production apply without review.
3. Wire secure onboarding + asset uploads.
4. Build per-creator site template and analytics instrumentation.
5. Build role-scoped Control and creator dashboards.
6. Implement quota jobs, notifications, manual milestone approvals, and reconciled payments.
7. Run security, financial and accessibility regressions; deploy via existing workflows.

The landing page is intentionally unlinked from global navigation and uses noindex. Noindex is not authentication: protect applications and personal analytics with real authorization.
