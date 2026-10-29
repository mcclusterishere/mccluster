# Promotion order for `supabase/pending/`

Written 2026-10-27 from each file's header, the dependency it states, the
objects it creates, and `live-callers.json` (which names shipped code calls
today). Every file is applied with the steps in `README.md` ("To promote one")
and needs the owner's approval first; this page only says what goes before
what and what proves each one. Apply order inside a group is top to bottom.

Status is checked against production the same day: `applied` means the file's
objects already exist there; everything else is absent.

Re-checked object by object on 2026-10-28 with `scripts/db/verify-production-schema.mjs`
(`docs/control-plane/PRODUCTION-SCHEMA-RECONCILIATION-2026-10-28.md`): no file here is
applied, even partially, and every function a file replaces is unchanged in production.
That page also orders a step 0 before any promotion (bring the production-only schema
into Git so the CI reset equals production) and marks which files need edits first.

## 0. Before everything else (written 2026-10-29)

Step 0 is not a pending file: `supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql`
brings the production-only schema into Git (17 tables, 10 functions, 6 triggers, 37
policies, 2 buckets, read from production's catalogs). It is replay-only, a guarded no-op
on production, and the CI reset now builds it: `supabase/schema-manifest.json` was
regenerated from that reset, and nothing in the 2026-10-28 production evidence is missing
from it. Proof: `bash scripts/test-schema-reconcile-db.sh` (row for row against the
evidence) and Reconciliation CI's "Supabase migration reset".

Then these four, in this order (each independent of the others; the order only keeps
reviews small). None needs a pending prerequisite; all four are tested by
`bash scripts/test-schema-hygiene-db.sh` (stub of production's state, apply, behaviour,
rollback, re-apply, behaviour again).

**Applied 2026-10-29 (owner-approved)**, all four and `public_music_reads_lean_v1.sql`
(group 3) after 0.2. Each is now `supabase/migrations/<version>_<name>.sql` with the version
production recorded, its stored statement equal to the file byte for byte; the rollbacks
stay in this folder under the pending names. Production evidence after the apply:
`docs/control-plane/evidence/production-schema-snapshot-2026-10-29.json`.

| # | File (+ rollback) | What | Proof before apply |
|---|---|---|---|
| 0.1 | **applied** as `20261029010919_privilege_hygiene_v1` (was `20261029100000_privilege_hygiene_v1.sql`) | grants and policy roles no migration meant: TRUNCATE/REFERENCES/TRIGGER off authenticated on 7 tables, anon DML off `network_{blocks,bookmarks,connections,mutes}` and `media_public_world_feed`, 9 public-role write policies `to authenticated`, anon EXECUTE off `eu_role`, `mnet_is_admin` and three trigger functions; what is kept and why is in its header | `supabase/tests/privilege_hygiene_v1.behaviour.sql` |
| 0.2 | **applied** as `20261029011001_definer_views_invoker_v1` (was `20261029100100_definer_views_invoker_v1.sql`) | the three `security_definer_view` ERRORs: invoker views over `private.*_rows()` SECURITY DEFINER functions, same rows | `supabase/tests/definer_views_invoker_v1.behaviour.sql`; on production compare `md5(string_agg(t::text,'|' order by t::text))` of each view before and after |
| 0.3 | **applied** as `20261029011314_rls_initplan_select_wrap_v1` (was `20261029100200_rls_initplan_select_wrap_v1.sql`) | the 71 `auth_rls_initplan` policies, sub-selects only | `scripts/test/rls-initplan-select-wrap.test.mjs` (offline, all 71 against the evidence) and the access matrix in `scripts/test-schema-hygiene-db.sh` |
| 0.4 | **applied** as `20261029011534_eu_runtime_and_media_rollup_v1` (was `20261029100300_eu_runtime_and_media_rollup_v1.sql`) | the replay-only EU worker runtime and `media_usage_rollup` that `eu-ddex-worker`, `eu-external-worker`, `eu-monitor`, `eu-orcid-oauth` and `/v1/media/usage` call; the two dispatch triggers and cron jobs stay off (owner decision) | `supabase/tests/eu_runtime_and_media_rollup_v1.behaviour.sql`; its seven names were `pending_only` in `live-callers.json` and were removed once the 2026-10-29 snapshot had them |

`public_music_reads_lean_v1.sql` (group 3) went after 0.2: it replaces the bodies of 0.2's
two track functions instead of recreating the views as definer views. Applied as
`20261029011108_public_music_reads_lean_v1` on 2026-10-29.

After each: record the ledger row and move the file (README "To promote one"), take a new
production snapshot (`scripts/db/verify-production-schema.mjs`), and drop the file's names
from `live-callers.json` (the test demands it once the snapshot has them).

## 1. Called by shipped code today, no prerequisite

Each of these has a live caller that fails closed until the file is applied.
Rollback files sit beside the ones that have them.

| File | Creates | Callers (from `live-callers.json`) | Proof before apply |
|---|---|---|---|
| `member_fronts_v1.sql` | `member_fronts`, `front_media_has_room()`, bucket `front-media` | `workers/mccluster/src/member-fronts.js`, `js/front-media.js` | `scripts/test-member-fronts-db.sh` |
| `world_member_regions_v1.sql` | `world_member_regions()` | `workers/mccluster/src/world-members.js` | reads `public.events` only; the Worker test `workers/mccluster/test/world-members.test.mjs` |
| `20261020150000_network_web_push.sql` (+ rollback) | `network_push_subscriptions` | `workers/mccluster/src/platform-api.js` | `workers/mccluster/test/web-push.test.mjs`; also needs `WEB_PUSH_ENABLED` and the VAPID secrets |
| `20261020170000_news_region_leads.sql` (+ rollback) | `news_region_leads` | `workers/mccluster/src/news-briefs.js` | `workers/mccluster/test/news-briefs.test.mjs`, `news-brief-resilience.test.mjs` |
| `20261019235000_network_sfu_audio_rooms.sql` | `network_audio_*` tables and functions | `workers/mccluster/src/audio-sfu-rooms.js` (behind `AUDIO_SFU_ROOMS_ENABLED`) | `scripts/test/audio-rooms-db.mjs`; header says do not apply on merge: provider credentials and privacy re-acknowledgement first |
| `whip_booking_authority_v1.sql` | `whip_booking_idempotency`, `whip_driver_clearances`, `whip_reserve_booking_v1()` | `workers/mccluster/src/whip/booking-gate.js`, `whip/gateway.js` | `workers/mccluster/test/whip-booking.test.mjs`; never enables dispatch by itself |
| `equity_uprise_clipping_sources.sql` | `clip_campaign_create_from_action()`, `clip_campaign_set_distribution()`, `clip_campaigns_open` | `js/control-room/clipping.js` | API Economic Core CI applies it to the rebuilt database, then `supabase/tests/action_clipping_regression.sql` |
| `20261009220000_at_night_adult_verification.sql` | `at_night_verifications` | `workers/mccluster/src/at-night.js` | moved from `supabase/migrations/pending/` 2026-10-27; written against the 2026-10-09 schema, re-run its statements on a scratch reset before apply |
| `20261010008000_action_connect_recipients.sql` | `an_connect_recipients` | `workers/mccluster/src/action-connect.js` | same as above |
| `20261010009000_creator_site_cohort_grants.sql` | `creator_site_cohort_grants` | `workers/mccluster/src/creator-site-publish.js`, `creator-site-v*.js` | same as above; `20261010009100_creator_publish_cohort_entitlement.sql` goes right after it |

## 2. The owner-approval chain (apply in this order)

1. `policy_fellowship_ladder_v1.sql`: `action_unlock_rules`, the ladder,
   memos. Replaces `admit_fellow_to_cohort()` (production hash matches
   `20261005054040`). Callers: `js/policy-fellowship-desk.js`,
   `js/member-desk.js`, `js/control-room/action-network.js`.
   Proof: `scripts/test-policy-fellowship-db.sh`.
   Design: `docs/control-plane/POLICY-FELLOWSHIP-LADDER.md`.
2. `mission_admin_approval_v1.sql` (+ rollback): needs 1. Every completion
   admin-approved. No direct caller yet; `live_missions_v1.sql` is tested with
   it. Proof: `scripts/test-mission-admin-approval-db.sh`.
   Design: `docs/control-plane/MISSION-ADMIN-APPROVAL.md`.
3. `20261015230000_identity_verification_levels_v1.sql` (+ rollback): needs
   1 (extends `action_member_verifications`, `action_unlock_rules`,
   `action_unlock_progress()`). Callers: `js/identity-verify.js`,
   `js/control-room/identity-review.js`, `workers/mccluster/src/identity/router.js`.
   Proof: `scripts/test-identity-verification-db.sh`.
   Design: `docs/control-plane/IDENTITY-VERIFICATION-LEVELS.md`.
4. `gated_track_mission_identity_v1.sql` (+ rollback): needs 2, prefers 3
   (both orders apply cleanly). Callers: `workers/mccluster/src/music/router.js`
   (`music_gate_rule_state`, `music_gate_claim_rule`).
   Proof: `scripts/test-mission-admin-approval-db.sh` (runs both).
5. `20261016010000_profile_edit_gate_v1.sql` (+ rollback): needs 1 and 3.
   Callers: `js/profile-edit-gate.js`, `js/control-room/profile-edit-review.js`.
   Proof: `scripts/test-profile-edit-gate-db.sh` (reruns 1 and 3 on top).
   Design: `docs/control-plane/MEMBER-DESK-AND-PROFILE-EDIT-GATE.md`.
6. `live_missions_v1.sql` (+ rollback): no hard prerequisite; its guards
   read 2's tables when present. Callers: `workers/mccluster/src/live/*`
   (bucket `live-mission-recordings`, `action_live_*`).
   Proof: `scripts/test-live-missions-db.sh` (with `EXTRA_SQL` = 2).
   Design: `docs/control-plane/LIVE-MISSIONS.md`.
7. `20261015230000_action_mission_pins_arcs_black_business.sql`: owner
   approval required; its demo regions are already in production (see
   `README.md`). Callers: `js/action-globe.js`, `js/mnet.js`.
   Proof: `scripts/test-mission-pins-db.sh`.
   Design: `docs/action-network/MISSION-PINS-ARCS-BLACK-BUSINESS.md`.

## 3. Fixes and performance, no caller change

| File | What | Proof |
|---|---|---|
| `action_bounty_claim_existing_row_guard_v1.sql` | replaces `claim_action_bounty()` so an aggregate `SELECT INTO` cannot fake an existing claim | `scripts/test-action-bounty-claim-db.sh` (also `.github/workflows/bounty-claim-guard-db.yml`) |
| `commerce_stripe_reconciler_v3.sql` | serialises concurrent Stripe deliveries, partial refunds as money; production has v1 and v2 | API Economic Core CI: `supabase/tests/commerce_stripe_reconciler_v3_regression.sql` and `commerce_stripe_concurrency.sh` |
| **applied 2026-10-29** as `20261029011108_public_music_reads_lean_v1` (was `public_music_reads_lean_v1.sql`) | `play_counts()` and the `v_track_*` views read the lean events copy; after 0.2 (it replaces 0.2's two track functions) | `scripts/test/journey-errors.test.mjs`, the lean step in `scripts/test-schema-hygiene-db.sh`; compare timings on the album pages after apply |
| `world_publisher_verified_geo_v1.sql` | nullable publisher/HQ columns on `media_news_sources`, no grants | additive `alter table ... add column if not exists`; check the ingest still runs |
| `music_release_payment_integrity_v1.sql` (+ rollback) | security: creator asset ownership from the server's record (`music_creator_assets`, `music_track_assets_verified()`), reviewed releases return to review on any change (`reviewed_snapshot`), server-only commission (`music_platform_fee_bps()`), and order/entitlement guards for Stripe fulfilment; approved masters pinned as immutable Storage versions (`music_asset_versions`, storage trigger) and purchases delivered from the pinned version. APPLY FIRST, run the health queries in `README.md`, THEN deploy `music-access`, `music-checkout`, `stripe-webhook` (the new `music-access` fails closed without it); it backfills the registry, pins existing reviewed masters and records existing purchases' versions, and sends any published release with a foreign or missing asset back to review | `scripts/test-music-release-integrity-db.sh` (also `.github/workflows/music-release-integrity-db.yml`) and `scripts/test/music-payment-integrity.test.mjs` |

## 4. Review before anything else: moved from `supabase/migrations/pending/` on 2026-10-27

Written 2026-10-09/10 against that day's schema and never re-based. No shipped
caller except the three listed in group 1. Each needs a fresh read against the
current `supabase/migrations/` and a scratch-reset run before it is proposed.

`20261009223000_action_economy_risk_ledger.sql`,
`20261009233000_creator_lifecycle_events.sql`,
`20261009234500_creator_clip_lifecycle_reporting.sql`,
`20261009235900_creator_team_decision_matrix.sql`,
`20261010004000_creator_super_verification_rewards.sql`,
`20261010005000_creator_selection_api_draft.sql`,
`20261010006000_creator_fan_payment_evidence.sql`,
`20261010007000_action_financial_journal.sql`,
`20261010009100_creator_publish_cohort_entitlement.sql` (after
`..._creator_site_cohort_grants.sql`).
Contract tests that read them: `scripts/test/action-economy-*.test.mjs`,
`scripts/test/creator-*-contract.test.mjs`, `creator-clip-lifecycle-schema.test.mjs`.

## 5. Staged only, do not apply as-is

- `20261013180000_qt6kv_creator_isrc_ledger.sql` and
  `20261013180100_music_cohort_isrc_grants.sql`: imported from PR #424 for
  consolidation; reconcile with the live ISRC allocations, rights
  authorization and function security first (their headers).
- `20261014170000_action_mission_curated_catalog_resources.sql`: forward-only
  data changes to `action_missions`, `action_campaigns`, `action_cohorts`,
  `action_bounties`; verify row by row against production before running,
  since later curation (2026-10-15) already changed the same rows.
- `20261015210000_intel_mission_canon_v1.rollback.sql`: the rollback of a
  promoted file (`20261017030617_intel_mission_canon_v1`), kept on purpose.

## Names with no SQL anywhere

`live-callers.json` → `missing_everywhere`: the `crm_*` tables
(`desk.html`, `js/control-room/work-tools.js`), the `vault_*` tables
(`vault.html`, `lanes.html`, `js/control-room/music-ops.js`), `deals`
(`js/network.js`), and `plays`, `likes`, `entitlements` (`js/backend.js`).
Production has none of them (checked read-only 2026-10-27). Those pages fail
today; the fix is SQL written here or the calls removed, then the entry.
