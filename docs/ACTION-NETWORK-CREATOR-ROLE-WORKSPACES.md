# Action Network — Five guided creator workspaces

Status: product/engineering specification; not a deployed feature.

## Account model
One canonical Mnet auth subject; five selectable creator role memberships: recording_artist, beat_producer, audio_engineer, videographer, video_editor. Multiple roles per person are supported, with a role switcher and separate assignment progress. Founder is a tenant/client entitlement, not a sixth creator identity type. Fan remains a shared-network account/subscription relationship, not one of the five creator archetypes.

## Shared guided navigation
1. **Today**: up to three next actions, due dates, prerequisites and progress indicator.
2. **My Homework**: weekly lessons, assignments, acceptance criteria, evidence submission, resubmission and reviewer feedback.
3. **My Projects**: campaign briefs, collaborator roster, handoffs, milestones and production calendar.
4. **My Content**: uploaded assets, approvals, publication scheduler and reuse permissions.
5. **My Audience**: unique creator referral link, campaign-specific URLs, verified new-account-plus-matching-subscription acquisitions, active subscribers and verified returning subscribers.
6. **My Rewards**: funded incentives, eligibility, claims, pending approvals and payout history.
7. **My Profile**: portfolio, creator-branded portal, availability, settings, role switching.

## Role-specific guided homework paths
### Recording artist
Brief acceptance -> song choice (feature or commissioned original) -> rights and split sheet -> demo/lyrics approval -> studio booking -> record/upload vocals -> local performance video -> approve release -> publish and engage -> review qualified acquisitions.

### Beat producer
Accept music brief -> reference/tempo/key -> rights/clearance check -> beat draft -> review -> final WAV/stems and metadata -> signed usage/splits -> process content -> campaign promotion -> acquisition review.

### Audio engineer
Confirm studio/location -> accept recording brief -> book session -> prepare session template -> record local artist or founder -> edit/mix -> upload labeled stems/mix -> obtain artist signoff -> publish permitted BTS -> onboard external artist with tracked invitation.

### Videographer
Accept shoot brief -> coordinate local talent/date -> shot list -> appearance/location releases -> capture shoot -> ingest/backup -> upload organized footage -> editor handoff -> BTS/social post -> acquisition review.

### Video editor
Receive and verify footage/rights -> rough cut -> submit review -> apply bounded revisions -> final export -> vertical cutdowns/captions -> upload thumbnail and files -> schedule approved posts -> monitor attribution.

## Weekly guidance
Monday production lesson/action; Wednesday publish an approved asset; Friday creator-link promotion, fan engagement and funnel review. Cap to approximately three lightweight actions weekly, not three professional deliverables. Adaptive next step appears only when prerequisites met. Overdue or blocked work routes to a manager; do not automatically fail creators for platform outages or collaborator delays.

## Assignment state machine
assigned -> accepted -> in_progress -> submitted -> in_review -> approved OR changes_requested -> resubmitted -> approved; allow blocked/cancelled with reason. Enforce server-side role permissions, deadlines, immutable review history, tenant-scoped data, media access and audit trails.

## Qualification rule
A creator earns a qualified new subscriber acquisition only when a server-validated referral yields a **new verified canonical account** that subscribes to the **same referring creator**, subject to anti-fraud checks. Count existing-member follows separately. Two-distinct-day engagement qualifies a separate returning-subscriber metric. Do not treat link clicks or raw account creation as earned acquisition.

## Proposed implementation data
creator_role_memberships(subject_id, role, status), curriculum_modules(role, week, version), homework_templates(role, module_id, acceptance_rules), homework_assignments(tenant_id, creator_id, role, project_id, due_at, status), homework_submissions(assignment_id, media_id, evidence, version), homework_reviews(assignment_id, reviewer_id, decision, reason), creator_referral_links(creator_id, campaign_id, token, state), creator_progress(creator_id, role, module_id, completion_at), creator_notifications(...).
Reuse existing platform tables and identity; inspect schema before migration. Enforce RLS/tenant authorization and signed uploads. No direct client ability to mark approved or qualified acquisition.

## MVP acceptance
Five role menus rendered from real server assignments; guided prerequisites; submit/review/resubmit loop; role switching; secure asset handoff; unique referral links; accurate account+subscription conversion; creator-facing progress; accessibility and mobile usability; tenant isolation tests.
