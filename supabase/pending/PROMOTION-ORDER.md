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
| `music_label_artists_v1.sql` (+ rollback) | the label model (owner, 2026-11-02): `music_creator_managers`, `music_can_act_for()`, `music_my_artists()`, `music_label_create_artist()`, `music_label_grant()`, `music_label_revoke()`, `music_label_hand_over_login()` (service role); replaces `music_creator_guard()`, `music_track_guard()`, `music_license_guard()` and alters the creator tables' authenticated policies; seeds PRIM3 and Equity Uprise's music act as login-less artists with the house owner as `label_admin`. Its caller degrades, it does not fail: Control shows the static catalog with a "backend is pending" note | `js/control-room/music-label.js` | `scripts/test-music-label-db.sh` (also `.github/workflows/music-label-db.yml`; its rollback is checked against production's guard and policy hashes) and `scripts/test/music-label.test.mjs`. Before apply, read-only: the handles `prim3` and `equity-uprise` are free in `music_creator_profiles` (the seed refuses a handle a person holds), and the house owner resolves (`orgs` slug `mccluster` → `org_members` owner → `m_auth_user_links`) |

## 2. The owner-approval chain (apply in this order)

1. `policy_fellowship_ladder_v1.sql`: `action_unlock_rules`, the ladder,
   memos. Replaces `admit_fellow_to_cohort()` (production hash matches
   `20261005054040`). Callers: `js/policy-fellowship-desk.js`,
   `js/member-desk.js`, `js/control-room/action-network.js`.
   Proof: `scripts/test-policy-fellowship-db.sh`.
   Design: `docs/control-plane/POLICY-FELLOWSHIP-LADDER.md`.
   **Mission-specific part superseded (checked read-only 2026-11-17):** its seed of
   `action_ladder_mission_kinds` maps three missions. Two were deleted on 2026-10-31
   (`053cbd0d…` write_song, `ba803367…` attend_rally) and are skipped, because the insert joins
   `action_missions`. The third, "Give someone a free ride" (`302dcb4e…`), is still live, so that
   one row (help_person) WOULD still be written: it is not a no-op. Decide it with the owner, or
   drop that seed, before this file is proposed. The ladder, rules and memos are not mission
   content and are unchanged.
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
   Its join fix alone is now `20261117100000_action_globe_join_scope_v1.sql`
   (section 10), which goes first; this whole file may still follow it
   (`scripts/test-mission-pins-db.sh` runs it on top of the extract). Once this
   file is in, 10.1 must not run again and 10.1's rollback must wait until this
   file is rolled back: both would put an older `join_action_mission` over this
   file's and drop its arc check, so both refuse (55000), changing nothing.
   **Section 8 (the owner's curation) is superseded:** every one of its statements
   reads its mission from `action_missions`, and all six missions it names
   (`d7fc0ca4…`, `ba66d4a3…`, `368fd75a…`, `df26314d…`, `9144bd42…`, `49d654e1…`) were
   deleted on 2026-10-31, so it writes nothing today (checked read-only 2026-11-17).

## 3. Fixes and performance, no caller change

| File | What | Proof |
|---|---|---|
| `action_bounty_claim_existing_row_guard_v1.sql` | replaces `claim_action_bounty()` so an aggregate `SELECT INTO` cannot fake an existing claim | `scripts/test-action-bounty-claim-db.sh` (also `.github/workflows/bounty-claim-guard-db.yml`) |
| `commerce_stripe_reconciler_v3.sql` | serialises concurrent Stripe deliveries, partial refunds as money; production has v1 and v2 | API Economic Core CI: `supabase/tests/commerce_stripe_reconciler_v3_regression.sql` and `commerce_stripe_concurrency.sh` |
| **applied 2026-10-29** as `20261029011108_public_music_reads_lean_v1` (was `public_music_reads_lean_v1.sql`) | `play_counts()` and the `v_track_*` views read the lean events copy; after 0.2 (it replaces 0.2's two track functions) | `scripts/test/journey-errors.test.mjs`, the lean step in `scripts/test-schema-hygiene-db.sh`; compare timings on the album pages after apply |
| **applied 2026-10-31** as `20261031180839_music_direct_sales_v1.sql` (rollback remains here) | security + feature: Matthew's direct checkout. Guards on the existing `music_direct_*` tables (orders paid only from pending under their stored session at the offer's price, terms immutable, refund revokes; entitlements only for a paid order with a snapshotted download limit and window), public read of on-sale offers' buy-button columns only, `music_direct_fulfil()` and `music_direct_claim_download()`. No prerequisite; orders and entitlements must be empty; inactive legacy offers are preserved. Production checks passed, four guards installed, public asset-path and download-RPC access denied. Applied first; then merge (the deploy replaces the hand-deployed `music-direct-checkout` and `music-direct-access` and redeploys `stripe-webhook`); see `README.md` | `scripts/test-music-direct-sales-db.sh` (also `.github/workflows/music-direct-sales-db.yml`) and `scripts/test/music-direct-sales.test.mjs` |
| `world_publisher_verified_geo_v1.sql` | nullable publisher/HQ columns on `media_news_sources`, no grants | additive `alter table ... add column if not exists`; check the ingest still runs |
| **applied 2026-10-30** as `20261030001000_music_release_payment_integrity_v1` (was `music_release_payment_integrity_v1.sql`; rollback stays here) by the owner in the SQL Editor, ledger row recorded by hand; health queries 0, functions deployed (#666, run 40978491536); step 5 (test release, Verify + listen, test purchase) deferred to the first real release, see `README.md` | security: creator asset ownership from the server's record (`music_creator_assets`, `music_track_assets_verified()`), reviewed releases return to review on any change (`reviewed_snapshot`), server-only commission (`music_platform_fee_bps()`), and order/entitlement guards for Stripe fulfilment; approved masters pinned as immutable Storage versions (`music_asset_versions`, storage trigger) and purchases delivered from the pinned version; approval bound to the SHA-256 of the master's bytes (`music_prepare_review`, `music_record_asset_sha256`, `music_operator_review`: the reviewer verifies and listens to the pinned object, and approval carries the hash shown). APPLY FIRST, run the health queries in `README.md`, THEN deploy `music-access`, `music-checkout`, `stripe-webhook` (the new `music-access` fails closed without it), then the hash backfill (`README.md` step 4a; production had 0 creator tracks on 2026-10-29) until no approved release lacks `content_sha256`; it backfills the registry, pins existing reviewed masters and records existing purchases' versions, and sends any published release with a foreign or missing asset back to review | `scripts/test-music-release-integrity-db.sh` (also `.github/workflows/music-release-integrity-db.yml`) and `scripts/test/music-payment-integrity.test.mjs` |

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
  **Superseded; never apply it (checked read-only 2026-11-17).** Its UPDATEs name 31
  missions, all deleted on 2026-10-31, and its title matches find no row, so they
  change nothing; its campaign, cohort and bounty updates also find no row (production
  has no campaign, no such cohort and no such bounty). It is NOT a no-op as a whole: it
  INSERTs two missions that never existed in production ("One Safe Night" and "Write a
  Song for Equity Uprise", `51000000-…-000000000006` and `…007`, the second as `open`)
  under the campaigns `homelessness-action-001` and `equity-uprise-003`, which were
  deleted on 2026-10-31, so as written the whole file fails on the campaign foreign
  key; restoring those campaigns would publish content the owner removed. Missions now
  arrive through section 10.
- `20261015210000_intel_mission_canon_v1.rollback.sql`: the rollback of a
  promoted file (`20261017030617_intel_mission_canon_v1`), kept on purpose.

## 6. MNET character cast (written 2026-11-03)

| File (+ rollback) | Creates | Callers | Proof before apply |
|---|---|---|---|
| `mnet_character_cast_v1.sql` (+ `mnet_character_cast_v1.rollback.sql`) | `ops_character_publications`, `ops_character_provision()`, `ops_character_publish_post()`; additive, nothing existing is altered | McCluster Core only: `core/src/executors/character-post.mjs`, `core/src/seed-character-posts.mjs`, `core/scripts/provision-characters.mjs`, all behind `MCCLUSTER_CHARACTER_POSTS=live` (off by default). No browser or Worker caller. | `scripts/test-mnet-character-cast-db.sh` (apply twice, behaviour, rollback, re-apply, behaviour). Design: `docs/fictional-city/MNET-CHARACTER-CAST.md` |

No prerequisite beyond what production has (`ops_platform_actors`, `network_posts`, `network_post_comments`,
`media_news_articles`, `ops_agent_jobs`). After apply: provision (profiles are created disabled), then enable, then
switch the flag and the timer on; each is a separate owner step.

## 7. Paid media operation recovery (written 2026-11-10)

| File (+ rollback) | Creates | Callers | Proof before apply |
|---|---|---|---|
| **Applied 2026-11-10:** `../migrations/20261110220135_media_operation_claims_v2.sql` (+ `media_operation_claims_v2.rollback.sql`) | additive on the applied `20261109194957_media_operation_claims_v1` (its table, state check and three RPCs are not touched; nor are 0053 and 0054): unique indexes `media_jobs_org_operation_uidx` (one job per organization and operation id) and `media_jobs_provider_request_uidx` (one job per provider request), index `media_jobs_fal_open_updated_idx`, four evidence columns on `media_operation_claims` (`attempt`, `history`, `resolved_at`, `resolution`) with `media_operation_claims_claimed_idx`, and six service-role functions: `media_claim_operation_v2()` (claim, repair, takeover), `media_bind_operation_v2()`, `media_fail_operation_v2()`, `media_release_cost_reservation_v2()`, `media_resolve_operation_job_v1()` (the operator decision), `media_operation_recovery_candidates_v1()` | `workers/mccluster/src/media/router.js`, `workers/mccluster/src/media/recovery.js` (production applied; reset evidence is reconciled in the release receipt) | `scripts/test-media-recovery-db.sh` (the applied chain, v1 checked against production's stored statement, the file twice, 24 behaviour scenarios as the owner, `service_role`, `anon` and `authenticated`, a three-session takeover race, a takeover held inside its UPDATE by a test-only trigger while two sessions wait (the claim-row `FOR UPDATE`), an operator bind racing a same-id retry on one open claim without deadlock (the decision's `FOR NO KEY UPDATE`), the rollback, the file again, both duplicate guards); Worker: `workers/mccluster/test/media-operation-recovery.test.mjs`, `media-operation-claims.test.mjs`, `fal-submit.test.mjs` |

**The order is load-bearing, in both directions.** Apply the file BEFORE the Worker that calls the v2 names
ships (merge deploys the Worker), as ONE transaction. Roll the Worker back BEFORE running the rollback file.
A Worker that runs without the file fails closed: every paid generation that carries an operation id answers
503 `operation_claims_unavailable` with nothing reserved, the operator routes answer 503 `recovery_unavailable`,
and a failed job is still released, through `media_release_cost_reservation` (0054), with the event
`media.operation.release_v1_fallback`.

Before apply, read-only on production. The first two must return no rows (the file's own guards stop the
whole transaction otherwise; resolve such rows through the normal RPCs, never by deleting a job). The third
must return `NO`: `media_jobs.error` is NOT NULL and the Worker now writes `{}` there, never null.

```sql
select org_id, routing ->> 'operation_id' as operation_id, count(*)
  from public.media_jobs where routing ->> 'operation_id' is not null
  group by 1, 2 having count(*) > 1;
select provider, provider_request_id, count(*)
  from public.media_jobs where provider_request_id is not null
  group by 1, 2 having count(*) > 1;
select is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'media_jobs' and column_name = 'error';
```

Two optional Worker secrets, by name only (`wrangler secret put`), neither needed for the file itself:
`MEDIA_WEBHOOK_HINT_SECRET` (32+ random characters) lets the provider webhook find a job whose submit outcome
was unknown; without it such jobs wait for an operator decision. `FAL_WEBHOOK_USER_ID` (the house's fal account
id) refuses a signed webhook from any other fal account. After apply and deploy: the operator surface is
`GET /v1/media/recovery` and `POST /v1/media/jobs/:id/reconcile`, and the MCP tools `media.recovery.list` and
`media.job.reconcile`, each for the house owner's session or McCluster Core's signature.

Read-only on production, 2026-11-10 01:21 UTC: the three checks above returned no duplicate
(organization, operation id), no duplicate (provider, provider request id) and `NO`. `media_jobs` held 18 rows,
none with an operation id, all with a provider request id.

Three things to know before the Worker ships:

- **The recovery sweep does not start on deploy.** The five-minute cron runs it only when the Worker variable
  `MEDIA_RECOVERY_SWEEP_ENABLED` is `"true"`. Leave it unset until the file is applied and the operator surface
  has been read once; without the sweep, a stale open job waits for its webhook or for a read that polls the
  provider (a member's `GET /v1/media/jobs/:id`). An operator decision settles or releases an open job only
  while it carries no provider request id, or once three consecutive provider 404s have parked it as
  `unknown_request`; any other answers `job_has_provider_request`. Not covered yet, sweep or not: a request the
  provider failed whose ERROR webhook never arrives (fal reports it COMPLETED and its result read errors, as the
  recovery suite's R3 test models it) stays open with its reservation held, because no poll can finish it and the
  decision refuses it; the candidate list shows it as `pollable_stale`.
- **Set both webhook secrets or neither.** fal signs every customer's webhooks with the same keys and the
  signature does not cover the URL, so with the hint secret alone the per-job token is the only thing that
  binds a signed webhook to a job. `FAL_WEBHOOK_USER_ID` is the second lock. The token is never written to
  events: the recorded route stops at `/v1/media/webhooks/fal`.
- **An operator's reason and evidence are readable by the job's organization.** They are kept on the job row
  (`routing.operator_resolution` and its history) and in the audit row, both of which the organization's
  members can read. Write them accordingly and put no secret in them. McCluster Core's signing key carries
  the same two operator actions for every organization; both signed routes, the read included, claim their
  nonce in the shared replay store.

## 8. E=Up module policy (written 2026-11-10)

| File (+ rollback) | Creates | Callers | Proof before apply |
|---|---|---|---|
| **Applied 2026-11-17:** `../migrations/20261117144103_eup_module_policy_v1.sql` (+ `eup_module_policy_v1.rollback.sql`, `eup_module_policy_v1.provenance.json`) | `eup_module_policies`, `eup_module_policy_commands` (append-only), and six service-role functions: `eup_module_policy_read`, `eup_module_control_read`, `eup_module_policy_install`, `eup_module_policy_command`, `eup_module_guard`, `eup_module_guard_reduce`, plus the trigger function `eup_module_guard_trigger` | `workers/mccluster/src/eup/modules.js`, `workers/mccluster/src/world-environment.js`, and the guard calls inside `eup_intake_v1.sql` | `scripts/test/eup-module-policy.integration.mjs` (257 assertions, PGlite); under real concurrency `scripts/test/eup-module-policy.native.integration.mjs` (96) and `scripts/test/eup-intake.native.integration.mjs` (33), on PostgreSQL 16 and 17 |

| `eup_league_v1.sql` (+ `eup_league_v1.rollback.sql`) | the League tables (26, each with RLS on, no policy, no API-role privilege, the module guard trigger except the access record), `eup_outbox` (its sequence revoked from every API role) and three service-role functions: `eup_league_command`, `eup_league_member_command`, `eup_league_media_seal` | `workers/mccluster/src/eup/league-contract.js` (RPC names), `league.js`, `league-member.js`, `league-media.js`, `overview.js` | `scripts/test/eup-league.integration.mjs` (1427, PGlite); `scripts/test/eup-league-journey.integration.mjs` (1529, the real router over this SQL); `scripts/test/eup-league.native.integration.mjs` (1578 on PostgreSQL 16 and 17) |

**Where it stands (2026-11-18).** `eup_module_policy_v1.sql` is applied, with the owner's approval, as ledger version
`20261117144103`; the stored statement is the file byte for byte (26,070 bytes, md5 `1f1daee2582fd0a6f3a659350a07491e`),
and it is promoted to `supabase/migrations/` (README, "Promoted 2026-11-18"). Its rollback and provenance record stay
here. `eup_league_v1.sql` and `eup_intake_v1.sql` are not applied. Whether any module is installed or enabled was not
read.

**Order.** Apply `eup_module_policy_v1.sql` first, then `eup_league_v1.sql` and `eup_intake_v1.sql`
(`eup_intake_v1.sql` raises 55000 when the guard functions are absent). Roll back in the reverse order: the
domain files first, the policy file last, or the backstop triggers go with the cascade and direct table
writes are unguarded.

**After apply nothing is enabled.** The file creates no row. Every guarded write, and the consumer E=Up tab
on the World, refuses until the house owner installs a module (it starts `disabled` at revision 0) and then
enables it, from Control, System, E=Up, Overview. States are `enabled`, `draining`, `disabled`; a drain waits
for writes already in flight and refuses later ones; reads, exact replays and actions that only stop work or
remove exposure stay open in every state. The API login role runs with 8 second statement and lock timeouts
(read on production, 2026-11-09); the policy functions wait at most 5 seconds for a lock and then change
nothing.

**Native proofs.** The two `*.native.integration.mjs` files start a disposable server on 127.0.0.1 and remove it
afterwards; they refuse to run without consent:
`ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres> node scripts/test/eup-module-policy.native.integration.mjs`
(and the same for the intake file). They prove what one PGlite session cannot: a drain waits for writes in
flight and queues later writers behind itself, reduce-only work survives a disable, the reduce marker is a mode
and never a bypass, SKIP LOCKED claims, same-key races, bounded lock waits. Mutated copies of the SQL (marker as
a bypass, no fair-queue lock, no shared writer lock, no SKIP LOCKED, no key lock) each fail them.

The import job (`workers/mccluster/src/eup/import-runner.js`) is tested and unscheduled: no route and no
cron calls it, nothing writes a run's cursor, and every connector is still disabled.

## 9. Core daily report window (written 2026-11-10)

| File (+ rollback) | Creates | Callers | Proof before apply |
|---|---|---|---|
| `ops_signals_digest_window_unique_v1.sql` (+ `ops_signals_digest_window_unique_v1.rollback.sql`) | the unique partial index `ops_signals_core_digest_window_key` on `ops_signals (org_id, payload->>'window_id')` for `core_morning_digest` rows that carry a window id | `core/src/digest.mjs` (a 23505 on insert reads the other run's report; a report recorded under 10 minutes ago is left to the run that recorded it, so two runs together send one text) | `core/test/digest-persistence.test.mjs` (6); the file on PostgreSQL 16: applies twice, refuses a second report for a window with 23505, refuses inside a transaction block, and with a duplicate present the build fails and leaves an invalid index |

**Apply on its own, outside a transaction** (`create index concurrently`); it blocks no writes. Run the
duplicate check in its header first. Read-only on production at 2026-11-10 02:29 UTC: 48 daily-report rows,
none with a window id yet (the host's Core predates window ids), no duplicate windows, index absent. The Core
code works with or without the index.

## 10. World missions: join scope, mission details, the Drawdown catalog (updated 2026-11-20)

The production steps 1 to 3 of `docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md`. **Owner approval
required for each file, each on its own**, in this order; roll back in the reverse order. Each is one
transaction and safe to run twice. Apply each with the Supabase MCP `apply_migration`, which runs as postgres,
the owner of everything they change. The service role cannot apply 10.1 or 10.2, or roll them back: it owns
none of those objects and has no CREATE on schema public (read 2026-11-17).

**Current production state, 2026-11-20:** 10.1, 10.2, all seven import parts and 10.4 are applied.
Publication followed the shipped feed and expired cache window. Before publication, the new guarded
`20261120061538_action_mission_drawdown_credit_fallback` removed all 87 website excerpts and unsupported
permission claims while preserving all 43 assessment citations. The exact publish is recorded as
`20261120061714_action_mission_drawdown_publish`: 125 catalog missions open, 126 open missions overall.
The four new release migrations bring the ledger to 380 rows (including Environment parts 01 and 02).
See `docs/control-plane/evidence/releases-2026-11-20/RELEASE-FINISH.md` and the November 20 production snapshot.
Historical import counts and procedure below describe their original application, not current publication.

| # | Applied as | Ledger version | Stored statement, equal to the file |
|---|---|---|---|
| 10.1 | `action_globe_join_scope_v1` | `20261117222809` | 9,521 bytes, md5 `acbb15a8fa25400006d39a586abd834f` |
| 10.2 | `action_mission_details` | `20261118021521` | 6,809 bytes, md5 `26965b3fe8bf077d1f5e9fb5f4b22557` |
| 10.3 | `action_mission_drawdown_import_01` to `_07` | `20261118034753` to `20261118035654` | the seven parts, in the 10.3 table below |

After 10.2, production has `public.action_mission_details` with row level security on, the policies "public
reads open mission details" (SELECT, anon and authenticated) and "admins manage mission details" (ALL,
authenticated), SELECT as the only client grant, and 0 rows; `public.action_missions` holds 1 mission, open;
there are 0 mission pins. After part 07 (the operator's read, 2026-11-18 03:58 UTC) `public.action_missions` holds 1
open and 125 draft missions and `public.action_mission_details` 125 rows; as `anon`, 1 mission, 0 drafts, 0 details.

Promoted 2026-11-18 (README, "To promote one" and "Promoted 2026-11-18"): each file moved unchanged to
`supabase/migrations/<version>_<name>.sql`, with `supabase/production-ledger.json`, `core/drift-contract.json`, the
production snapshot `docs/control-plane/evidence/production-schema-snapshot-2026-11-18.json`, the schema manifest and
`live-callers.json`. The rollbacks stay here under their pending names, and the moved files' headers keep the words
they were applied with ("PENDING. Not applied to production."), as an applied file's bytes must. A rollback is not
applied, so its first line now names its forward file where that file is, under `supabase/migrations/`, and then the
name it was staged and reviewed under (review of the release polish, 2026-11-18, RP-4; `scripts/test/mission-import.test.mjs`).

| # | File (+ rollback) | What | Callers | Proof before apply |
|---|---|---|---|---|
| 10.1 | `../migrations/20261117222809_action_globe_join_scope_v1.sql`, staged as `20261117100000_action_globe_join_scope_v1.sql` (+ `20261117100000_action_globe_join_scope_v1.rollback.sql`) | **Applied 2026-11-17** as `action_globe_join_scope_v1` (version `20261117222809`). Decouples joining from pins: `action_globe_mission_regions.join_scope` (default `anywhere`); `join_action_mission()` and `action_globe_can_join_mission()` gate only on a PUBLISHED pin marked `region_members`. The minimal extract of 20261015230000's sections 3 and 5, nothing else from that file. The rollback restores production's bodies byte for byte (md5(prosrc) `e0684ebe350296c5e6c06de55624ed42` for `join_action_mission`) and drops the column. Both refuse (55000), changing nothing, unless the two functions are production's or 10.1's own, so neither runs over the whole pins file (section 2, item 7) once it is in: roll that file back first | `join_action_mission` and its `_attributed`, `_live` and `_origin` wrappers (`js/mnet.js`, `js/action.js`) | `scripts/test/mission-catalog.native.integration.mjs`; `scripts/test-mission-pins-db.sh` (the whole pins file still applies on top of it) |
| 10.2 | `../migrations/20261118021521_action_mission_details.sql`, staged as `20261117100100_action_mission_details.sql` (+ `20261117100100_action_mission_details.rollback.sql`) | **Applied 2026-11-18** as `action_mission_details` (version `20261118021521`). Creates `action_mission_details`: one row per mission (proof hint, safety note, credit line, quotation and its credit, source URL, licence, DOI), readable by anon and authenticated exactly when its mission is (the test of "public reads open missions"), written by the service role only. Creates no row. The rollback refuses while the table holds a row | none in shipped code at the time of writing; the World's mission posts and dialog are to read it and must tolerate its absence | the native suite above |
| 10.3 | the seven import parts below, staged as `20261117100200_action_mission_drawdown_import_01.sql` to `_07.sql`, now `../migrations/<version>_action_mission_drawdown_import_01.sql` to `_07.sql` (+ `20261117100200_action_mission_drawdown_import.rollback.sql`, one rollback for every part), generated by `tools/build-mission-import.mjs` from `data/missions/drawdown/missions.json` | **Applied 2026-11-18** as the seven parts, versions `20261118034753` to `20261118035654`. Inserts the 125 Drawdown missions as `draft` (ids: UUID v5 of `mccluster:mission:drawdown:<slug>`), each part its missions and then their details rows (43 with a CC BY 4.0 licence and DOI in all), in catalog order. Every part refuses before 10.2, and every part from 02 on until the part before it is in. The rollback deletes exactly those ids, however many parts ran, and refuses while any assignment, proof, pin or other row references one; it locks the missions, and the two tables that name a mission without a foreign key (`action_creator_payout_intents`, `action_creator_funding`), before it counts | none; drafts are invisible to the public | `node tools/build-mission-import.mjs --check`; `scripts/test/mission-import.test.mjs`; the native suite |
| 10.4 | `../migrations/20261120061714_action_mission_drawdown_publish.sql`, staged as `20261117100300_action_mission_drawdown_publish.sql` (+ `20261117100300_action_mission_drawdown_publish.rollback.sql`) | **Applied 2026-11-20**, after the credit correction. Exact statement 23,619 bytes, md5 `9d5e9f4e9178bf52fac4255453787798`. Opens exactly the 125 catalog IDs; recovery changes only those still open back to draft | public World feed and mission details | existing native catalog proof plus the new credit-fallback proof |

### 10.3 in seven parts (2026-11-18)

The import was one file, `20261117100200_action_mission_drawdown_import.sql` (188,022 bytes, md5
`29271e66339a48f4133d1f7171d04cce`, never applied). That is more than one `apply_migration` call can safely
carry, and the statement production stores must be the committed file byte for byte so the promotion can prove
it. Seven parts replace it, each at most 32,000 bytes: `tools/build-mission-import.mjs` cuts the catalog, in
order, into the fewest parts that fit (six cannot hold the rows and their headers), as even in size as seven
allows (applied 2026-11-18 and promoted: the File column below is each part's migration under `supabase/migrations/`;
the SQL names the parts by the staged names above, as applied). Each part is self-contained and one transaction:
`lock_timeout` 5s and `standard_conforming_strings` on;
the guard that the details table exists; from part 02 on, a guard that the part before it is in (its last mission
is there with its details row: a part is one transaction, so that row stands for all of it); its missions,
`ON CONFLICT (id) DO NOTHING`; then those missions' details rows, `ON CONFLICT (mission_id) DO NOTHING`. A short
header names the part, the total, the catalog's sha256, the order, the rollback and the proof. The rows are the
one file's, byte for byte and in the same order (`scripts/test/mission-import.test.mjs`).

**The one file is removed, not kept beside the parts.** Two appliable copies of the same import under different
migration names could put the same rows in the ledger twice, and the promotion proves one stored statement per
committed file. So the parts are the only copy on disk: `node tools/build-mission-import.mjs --check`, and with it
the unit test, fails while the one file, or a part this catalog does not build, is in this folder, and a build
removes them. The tool still rebuilds the one file in memory, byte for byte (`singleImportReference()`, its bytes
and md5 pinned by the unit test), only so the native proof can apply it beside the parts; applied over each other,
in either order, the two change nothing. The publish and the import rollback now name the parts instead of the one
file, and that is their only change (the unit test checks it against their reviewed md5s); the publish rollback is
unchanged.

| Part | File | Migration name | Catalog missions | Bytes | md5 |
|---|---|---|---|---|---|
| 01 | `20261118034753_action_mission_drawdown_import_01.sql` | `action_mission_drawdown_import_01` | 1 to 14 (14) | 29,656 | `310178698d117f2a6ffe2f672fddd73a` |
| 02 | `20261118034926_action_mission_drawdown_import_02.sql` | `action_mission_drawdown_import_02` | 15 to 29 (15) | 31,009 | `4d29872c1f27f70bdea39151ed98f1eb` |
| 03 | `20261118035056_action_mission_drawdown_import_03.sql` | `action_mission_drawdown_import_03` | 30 to 44 (15) | 30,085 | `3de9c9a8c30dff70adccb7b5d4537b3f` |
| 04 | `20261118035221_action_mission_drawdown_import_04.sql` | `action_mission_drawdown_import_04` | 45 to 61 (17) | 30,241 | `2b5458737baa0e8899db5d8490b4dd92` |
| 05 | `20261118035346_action_mission_drawdown_import_05.sql` | `action_mission_drawdown_import_05` | 62 to 79 (18) | 30,478 | `15e9667dbf5e3baae43efbdc930061c3` |
| 06 | `20261118035521_action_mission_drawdown_import_06.sql` | `action_mission_drawdown_import_06` | 80 to 100 (21) | 30,418 | `5d9b005eba3c3f9df54f54ecfd9be40a` |
| 07 | `20261118035654_action_mission_drawdown_import_07.sql` | `action_mission_drawdown_import_07` | 101 to 125 (25) | 31,243 | `866f1f4b52bd1f1005e5634e369bcaee` |

**How they were applied** (2026-11-18, the owner having approved 10.3; kept as the procedure):

1. Read production first (read-only): the ledger holds `action_globe_join_scope_v1` and `action_mission_details`
   and no `action_mission_drawdown_import%` row; `public.action_mission_details` exists and is empty; none of the
   125 ids is in `public.action_missions`.
2. Apply part 01 with the Supabase MCP `apply_migration`, which runs as postgres (never as the service role),
   under its migration name, `action_mission_drawdown_import_01`, sending the committed file exactly, in one call.
3. Read production again before the next part: the ledger's newest row has that name and its stored statement
   has the bytes and md5 in the table; `public.action_mission_details` holds as many `drawdown` rows as the part's
   last catalog position (14, 29, 44, 61, 79, 100, 125), and every one of those missions is a draft.
4. Then part 02, and so on to part 07: one call per part, one read between every two. A part applied before its
   turn refuses (55000), changes nothing and names the part to apply first. If a call ends without an answer, read
   the ledger before anything else: a part is one transaction, so it is either all in, with its ledger row, or not
   in at all. Do not send a part the ledger already holds: its rerun inserts nothing, but it may add a second ledger
   row under the same name.
5. After part 07 production holds 125 drafts with 125 details rows, and a visitor sees nothing new. The parts were
   promoted with 10.1 and 10.2 on 2026-11-18.

Rollback, at any point: if 10.4 ran, `20261117100300_action_mission_drawdown_publish.rollback.sql` first; then
`20261117100200_action_mission_drawdown_import.rollback.sql` (owner approval, as postgres). It deletes exactly the
catalog ids that are there, however many parts ran, and refuses, deleting nothing, while anything references one.
Once a part is applied, `missions.json` must not change: the parts in production must stay the committed files
byte for byte, so a later change to the catalog is a new migration, never a regenerated part.

**Historical publication decision** (2026-11-18; completed 2026-11-20 after the new feed shipped).
The live build (`fc1986ec`) reads open missions straight from
the database, in its swipe deck, its guest door and the Worker's lists, so the moment 10.4 commits, all 125
missions show on the live site. The parts write drafts only and change nothing a visitor sees, and 10.4 refuses,
changing nothing, until all 125 missions are there with their details rows.

**Pins.** With 10.1 applied, a pin no longer locks its mission: joining is gated only by a published pin marked
`region_members`. Production has 0 pins (2026-11-18). Pins themselves are step 4 of the brief, a separate owner
decision with its own SQL.

The native proof starts a disposable PostgreSQL on 127.0.0.1 and refuses without consent:
`ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres> node scripts/test/mission-catalog.native.integration.mjs`.
It builds production's shape (`supabase/tests/action_mission_catalog.stub.sql` and the four applied globe
migrations; seven function bodies checked against production's md5(prosrc)), applies 10.1, 10.2, the seven parts
in order and 10.4, reruns them, reads as a guest, a member and an admin, joins with and without pins, then rolls
each back and checks the state before it, `join_action_mission`'s md5 included. For the parts it sees every part
refuse before 10.2; every part from 02 on refuse, changing nothing, when applied one or two ahead of its turn; one
failing row abort a whole part; every rerun change nothing; the rows after the seven parts equal, byte for byte,
the rows a second database gets from the one file (ordered dumps of both tables, every column but the two
apply-time timestamps); the parts over the one file, and the one file over the parts, change nothing; the publish
refuse while part 07 is missing, then open exactly the 125; and the one import rollback undo two parts as it undoes
seven. It also sees 10.1 and its rollback refuse over a join function another migration replaced, the service role
fail to apply 10.1 and 10.2, the import rollback wait for a funding row another session is still writing and then
refuse, and the publish leave a draft outside the catalog alone. Run on 2026-11-18: 156 checks passed on
PostgreSQL 16.15 and on 17.7 (production runs 17.6); two mutated copies, the parts without their order guard and
one title changed in part 03, each fail it. Before the parts (2026-11-17), 100 checks passed on both, and
`scripts/test-mission-pins-db.sh` passed on both.

Rerun the production reads immediately before each apply. Superseded by this section: the mission-specific parts
of `20261014170000_action_mission_curated_catalog_resources.sql` (section 5), of `policy_fellowship_ladder_v1.sql`
(section 2, item 1) and section 8 of `20261015230000_action_mission_pins_arcs_black_business.sql` (section 2,
item 7); each entry says what it would still do.

## 11. Compute fabric preference (additive, deploy-gated; written 2026-11-17)

| File (+ rollback) | Creates | Callers | Proof before apply |
|---|---|---|---|
| `compute_claim_task_yield_v3.sql` (+ `compute_claim_task_yield_v3.rollback.sql`) | nothing: it replaces one function's signature. `public.compute_claim_task` gets a fifth optional parameter, `p_yield_seconds integer default 0` (clamped 0..300): a claim that passes it skips tasks younger than that many seconds, so a CPU node can leave fresh work to a live GPU node; the returned `task` JSON also carries `priority`. The 4-argument call keeps working through the default; the 4-argument signature is dropped in the same transaction because a second overload would make the gateway's named call ambiguous | `core/src/compute/store.mjs` (`claimLease`, which sends `p_yield_seconds` only when a node asks to yield and, on PostgREST 404 PGRST202, retries without it and remembers for the life of the process), reached through `core/src/compute/gateway.mjs` (`POST /v1/compute/lease` clamps `body.yield_seconds`) from `core/src/compute/node-agent.mjs` (`MCCLUSTER_NODE_YIELD_TO_GPU_MS`, off by default). Nothing fails without it | `PGLITE_MODULE_PATH=<pinned PGlite>/dist/index.js node scripts/compute-lease-yield-sql-check.mjs` (base chain, apply, `supabase/tests/compute_claim_task_yield.behaviour.sql`, the v2 lease assertions on the v3 function, rollback, the 5-argument call gone, re-apply, assertions again); passed here on PGlite 0.5.10 on 2026-11-17 |

Apply only when the owner wants the OVH node to yield to a live GPU node (then set
`MCCLUSTER_NODE_YIELD_TO_GPU_MS` on that node); harmless otherwise. No prerequisite beyond the
applied `20261020210718_compute_lease_authority_v2` and an unchanged reviewed claim function.
The 2026-11-24 compatibility guards additionally refuse any installed owner-workspace
schema, function or cleanup column (section 16), in both forward and rollback files.
The workspace forward file reciprocally refuses the five-argument yield signature.
These schedulers are an unsupported combination; neither file may silently overwrite
the other's admission rules. Each file runs in the migration runner's transaction,
with a shared advisory transaction lock and a five-second lock timeout. PostgREST reloads its schema cache on DDL; if
a claim still answers PGRST202 afterwards, run `notify pgrst, 'reload schema';`. Never applied here.

## 12. E=UP environmental event store (written 2026-11-19)

The canonical, revisioned store behind the signed-out E=UP timeline (slice S1 of `docs/control-plane/EUP-EVENT-TIMELINE.md`):
one record per public government observation, its revisions, aliases, provider rules, a source-health log, the owner's decision
log and news coverage bound to an event's revision. Five parts, each one transaction of at most 32,000 bytes (what one
`apply_migration` call carries safely, as section 10.3), and one rollback:

| # | File | Migration name | Creates |
|---|---|---|---|
| 12.1 | `20261120061725_eup_environment_events_v1_01.sql` | `eup_environment_events_v1_01` | the seven tables (row level security on, no policy, no API-role privilege), their append-only and identity guards, the commit-time revision check, the pure helpers |
| 12.2 | `20261120061759_eup_environment_events_v1_02.sql` | `eup_environment_events_v1_02` | the reads: the public page and event read (gated by the environment module policy: EUM01 / EUM03), the owner's preview |
| 12.3 | `20261123173831_eup_environment_events_v1_03.sql` | `eup_environment_events_v1_03` | the ingest (USGS only), idempotent per run id, one health row per run; and the ingest's read, `eup_environment_ingest_state` (added by slice S3: the rule, the switches and the published events to look for) |
| 12.4 | `20261123173951_eup_environment_events_v1_04.sql` | `eup_environment_events_v1_04` | the house owner's read and commands (hold, release, retract, restore, rollback, provider pause and hide, the publication rule, coverage decisions), each logged |
| 12.5 | `20261123174034_eup_environment_events_v1_05.sql` | `eup_environment_events_v1_05` | the coverage intake |
| | `20261119100000_eup_environment_events_v1.rollback.sql` | `eup_environment_events_v1_rollback` | drops everything the parts create, however many ran; the store's rows are lost |

**All five parts are applied (2026-11-20 and 2026-11-23); the store is empty and nothing public changed.** Every forward
file is under `supabase/migrations/` with the version in the table, its bytes and original header unchanged.

- Parts 01 and 02, 2026-11-20: the assigned ledger rows each contain one stored statement equal to the file byte for byte,
  verified by byte count, MD5 and SHA-256 (`docs/control-plane/evidence/releases-2026-11-20/ENVIRONMENT-TIMELINE-APPLIED.md`).
- Parts 03, 04 and 05, 2026-11-23, with Matthew's approval ("Approve the last 3 EUP database changes."), as
  `20261123173831`, `20261123173951` and `20261123174034`: each ledger row holds one stored statement, the committed file
  without its final line feed (31,084, 26,707 and 12,177 bytes; md5 `f4a2c6df817f2e963f9c6e1b0a486bc8`,
  `d379700f7f371b9a8803f6aa6e6e05b9`, `2583ace662ac0494c07065e7e93ce633`, which the files give with their last byte
  removed). The files moved unchanged, so the reviewed SHA-256 of each still holds
  (`docs/control-plane/evidence/releases-2026-11-23/LEDGER-384-APPLIED.md`). After part 05 (read 2026-11-23,
  17:48 UTC): 29 store functions, the five entry points of parts 03 to 05 executable by `service_role` only; 0 events,
  0 providers, 0 source-health rows; 0 environment module policy rows.

The original staging plan called for separate approval of the exact text; the owner-authorized completion proceeded after
the mission publish, with the Supabase MCP `apply_migration`, as postgres, under the names above, in order, one call per
part and a ledger read between calls. Each call asked a person to confirm it before it ran, and Matthew answered each one
from the main session. Part 01 refuses (55000) without the module policy (section 8); every later part refuses (55000),
changing nothing, until the part before it is in. An unanswered call is resolved from the live ledger before a retry: an
attempt at 17:29 UTC on 2026-11-23 by an unattended agent timed out waiting for that confirmation and changed nothing.

The recovery file stays pending. It destroys the store's records, so ordinary operational recovery pauses ingest and drains
then disables the module. If destructive recovery is needed, disable callers and export records first; the store must be
removed before the module policy's own rollback because its public reads depend on that policy.

**Applying them changes nothing public until the ingest flag and the environment module are turned on.** The parts create no
row. The owner controls, scheduled ingest and public routes shipped in PR #818. With all five parts in, a signed-out
visitor's `GET https://api.mccluster.org/v1/world/environment/events?limit=20` still answers 404 `module_disabled`
(2026-11-23, 17:49 UTC). What remains, in this order, and none of it is an agent's step:

1. **The USGS rule**: Matthew, in his signed-in Control session, System > E=Up > Environmental events > Sources, "Set the
   default rule" (the owner command of part 04, with its reason, the revision read and an idempotency key). The default
   admits magnitude 4.5 and up, automatic readings included, or significance over 600, a PAGER alert or a tsunami flag.
2. **The ingest switch ships on in Release 1 of 2026-11-23.** Matthew: "Switching the module on for sure, alright?" and,
   for that release, "ship it all baby". The release commits the Worker variable `EUP_ENVIRONMENT_USGS_INGEST_ENABLED` as
   `"true"` in `workers/mccluster/wrangler.toml` (it was `"false"` until then), so its merge and Worker deploy turn it on and
   the existing five-minute cron runs the ingest. With no rule (item 1) the ingest asks nothing: each run reads the store's
   view once and stops, with no USGS request and nothing stored. The rule can come before or after the deploy.
3. Verify a durable source-health row (Sources) and the owner preview (Preview) before the module.
4. **The module**: System > E=Up > Overview > Modules > Environment, Install (it starts disabled), then Enable, each with a
   reason. Only then does the public timeline answer.

The four `live-callers.json` exceptions for parts 03 and 04 (`eup_environment_ingest`, `eup_environment_ingest_state`,
`eup_environment_owner_read`, `eup_environment_owner_command`) are removed: the 2026-11-23 production snapshot and the schema
manifest both have the functions.

The original headers preserve the reviewed defaults for canonical IDs and aliases (D5), revisions (D6), the publication rule
(D7), tombstones and holds (D12), and the owner preview (D11). The authorized completion uses these exact statements.
Later rule or event decisions use the existing owner controls and their revision, reason and idempotency checks.

Proof before apply:
`PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/eup-environment-events.integration.mjs` (294 assertions, CI
matrix entry `environment-store` in `.github/workflows/human-uprise-editorial.yml`; eight mutated copies of the parts each fail
it) and, under real concurrency on a disposable server,
`ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres> node scripts/test/eup-environment-events.native.integration.mjs`
(29 checks, passed on PostgreSQL 16.15 and 17.7 on 2026-11-19; production runs 17.6). The static checks are in the root suite:
`node --test scripts/test/eup-environment-events-sql.test.mjs`.

## Names with no SQL anywhere

`live-callers.json` → `missing_everywhere`: the `crm_*` tables
(`desk.html`, `js/control-room/work-tools.js`), the `vault_*` tables
(`vault.html`, `lanes.html`, `js/control-room/music-ops.js`), `deals`
(`js/network.js`), and `plays`, `likes`, `entitlements` (`js/backend.js`).
Production has none of them (checked read-only 2026-10-27). Those pages fail
today; the fix is SQL written here or the calls removed, then the entry.

## PRIM3 reviewed release learning (pending, 2026-11-07)

`prim3_reviewed_releases_v1.sql` follows the existing media news article schema and
`20261103182544_learning_evidence_v1.sql`. It adds private owner-reviewed releases,
transactional session claims and an expiry/revocation guard on bound learning events.
Test: `node scripts/test-prim3-adaptive-postgres.mjs` in disposable Docker containers;
optional browser acceptance: `PRIM3_RELEASE_BROWSER=1` with the documented pinned tools.
See `docs/prim3/REVIEWED-RELEASE-LEARNING.md`. No production apply has occurred.
Keep `PRIM3_RELEASES_ENABLED` absent/false until serial promotion and acceptance.
Dedicated signing-key provisioning requires its separate action-time approval.

## 2026-11-10 release receipt

Paid-media claims v2 is applied at `20261110220135` and is no longer pending.
See `docs/control-plane/evidence/releases-2026-11-10/CLAIMS-V2-APPLIED-VERIFICATION.md`.
The rollback stays here for operator-controlled recovery, after rolling back the Worker.
No other candidate in this document was applied by that release.

## Network media assets pointer guard (pending, 2026-11-10)

`network_media_assets_pointer_guard_v1.sql` (+ rollback) is pending source-only hardening with no caller change: it takes the write of
`public.network_media_assets` from members, pins `id`, `bucket_id` and `object_path` against every UPDATE (the service
role's and SECURITY DEFINER code's too; only the table's owner can switch the trigger off), gives `owner_m_uid` one
audited path after an identity merge, and takes the member's own token off the `mnet-media` bucket's writes. No pending
prerequisite and nothing shipped calls what it creates. It does have production prerequisites, all read-only and all in
`README.md`: `scripts/db/media-asset-legacy-count.sql` must answer `not_canonical = 0` (the guard checks this itself
under the table's lock and refuses to apply, changing nothing, otherwise;
`scripts/db/media-asset-pointer-guard-precheck.sql` is the breakdown), the API logs must show no member-token write
to the table or the bucket, the deployed `mnet-media` function must be this repository's, and the two SECURITY DEFINER
writers must still be SECURITY DEFINER and owned by a role that is neither `anon` nor `authenticated`. It is
complementary to the Worker's signing fix, already on main: retain that signing check because this candidate
does not repair historical owner/path mismatches. This source merge is not promotion or permission to apply SQL. Proof before apply: `bash scripts/test-network-media-pointer-guard-db.sh` (PostgreSQL 16 and 17),
`node --test scripts/test/network-media-pointer-guard.test.mjs` and, with Docker,
`bash scripts/test-network-media-storage-flow.sh` (the real Storage API; with
`SUPABASE_DB_IMAGE=supabase/postgres:17.11.0.018` on the official Supabase Postgres image, every statement as its
restricted `postgres` role). After apply: the smoke and the `validate constraint` step in `README.md`, then a
production snapshot. After any later `m_merge_people`: one service-role call of
`public.network_media_assets_follow_merge(p_keep, p_merge, p_reason)`, or the merged person's uploads stay unsigned.
The rollback does nothing where the guard is not applied and keeps the record of merges when it holds a row. At
promotion, fix the one fixture `README.md` names (`supabase/tests/action_clipping_regression.sql`).

## 13. Network connections: consent (security fix; written 2026-11-19)

| File | Changes | Callers | Proof before apply |
|---|---|---|---|
| `../migrations/20261123173626_network_connections_consent_guard_v1.sql`, staged as `20261119062110_network_connections_consent_guard_v1.sql` (+ `20261119062110_network_connections_consent_guard_v1.rollback.sql`) | **Applied 2026-11-23** as `network_connections_consent_guard_v1` (version `20261123173626`). Drops the policies `network_connections_self_write` and `network_connections_self_update` and revokes INSERT, UPDATE and DELETE on `public.network_connections` from `authenticated`; keeps `network_connections_member_read`, SELECT and everything else | none new: the World already writes the table only through `request_connection`, `answer_connection` and `withdraw_connection` (SECURITY DEFINER, owned by the table's owner), and the Worker reads it with the service role | see below |

The hole. Production carries two policies no migration here created (recorded in
`supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql:938-946`) and grants INSERT, UPDATE and DELETE
on the table to `authenticated`. Any member, with their own session, through the REST API, can therefore insert a connection
naming anyone with status `accepted`, accept their own pending request, or move a row to another member. An accepted pair turns
a message request into a conversation (`mnet_open_direct`, live: 119 of 120 profiles take messages from `network`) and is the
only partner check of `publish_antisocial_collaboration` (a public post crediting both; latent today, the Anti-Social mission row
is absent in production). Read-only production checks on 2026-11-19 found no other writer (no trigger, rule, view, cron job or
other function writes the table; the writer RPCs equal this repository's text and none lets a member accept their own request),
2 rows (1 accepted, 1 pending; no accepted row has `created_at` equal to `updated_at`, the trace an insert as accepted would
usually leave, which is not proof that none was forged) and a ledger of 376 rows. The file's header records all of it.

The fix checks before it commits that neither `anon` nor `authenticated` can still write the table, that no member write policy
is left and that the three writer RPCs are still SECURITY DEFINER and owned by the table's owner; otherwise it stops with 55000
and changes nothing. One transaction, safe to run twice, a 5 s lock bound. Independent of the World release and of every other
section here; no prerequisite.

**Applied 2026-11-23, with Matthew's approval** ("Apply the connections fix."), through the Supabase MCP `apply_migration`
(it runs as postgres, the table's owner) under the name `network_connections_consent_guard_v1`, ledger version
`20261123173626`. The call asked a person to confirm it before it ran, and Matthew answered from the main session; an
earlier attempt at 17:29 UTC by an unattended agent timed out waiting for that confirmation and changed nothing. Before it,
the header's check answered the three policies, true for all four member privileges and `authenticated=arwdm` (read on
2026-11-23 before 17:29 UTC, and again at 17:29:45 UTC). The stored statement is one statement, the committed file without its final line feed (11,395
bytes, md5 `a08e29b94ffe898174c199f5eac0cecf`); the file moved unchanged (11,396 bytes, its reviewed header kept) with the
steps in `README.md` ("To promote one"). Evidence: `docs/control-plane/evidence/releases-2026-11-23/LEDGER-384-APPLIED.md`.

The CI reset held the same hole (`supabase/schema-manifest.json`: `authenticated=damrw` and the two policies, from the replay
record). Now that the file is under `supabase/migrations/`, the reset applies it after that record and closes it there too;
the manifest was changed in the same change to what the reset builds after the file (its own `network_connections` row now
`authenticated=mr`, the two policies gone). The next Reconciliation CI reset is the arbiter: if its artifact differs, refresh
the manifest from it.

**Verified** on 2026-11-23 at 17:48 UTC with the same query: only `network_connections_member_read SELECT authenticated`;
member SELECT true and INSERT, UPDATE, DELETE false; acl
`{postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=rm/postgres,service_role=arwdDxtm/postgres}`; the three writer
RPCs still SECURITY DEFINER and owned by the table's owner; the ledger one row longer for this file. Not checked in production
by this record (no member session was used): that Connect, Accept, Decline, Withdraw and End keep working in the World and
that a member's direct POST or PATCH to `/rest/v1/network_connections` answers 403; the proofs below show both.

**Roll back** with the rollback file (owner approval too; as postgres, name `network_connections_consent_guard_v1_rollback`). It
puts back exactly the two policies, with production's expressions, and the three grants, touches nothing else, and reopens the
hole; the query then answers what it answered before 2026-11-23.

Proof before apply (disposable databases only):
`PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/network-connections-consent.integration.mjs` (137 checks; CI matrix
entry `connections-consent` in `.github/workflows/human-uprise-editorial.yml`) and
`ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=<PostgreSQL 16 or 17 bin> PG_MODULE=<node-postgres> node scripts/test/network-connections-consent.native.integration.mjs`
(140 checks: the file applied statement by statement as psql does, members on another session, the 5 s lock bound; passed on
PostgreSQL 16.15 and 17.7 on 2026-11-19, production runs 17.6). Both build production's layer from this repository's SQL and check
it against the 2026-11-19 reads: the policies' expressions, every grant, the constraints and indexes, and the bodies of the eight
functions that name the table, byte for byte. The static checks run in the root suite
(`node --test scripts/test/network-connections-consent-sql.test.mjs`). `node scripts/test/network-connections-consent.mutants.mjs`
removes each of the file's seven statements in turn: each mutant fails a check.

For Matthew to decide, not changed here:
- anon keeps SELECT (and PostgreSQL 17's MAINTAIN) on the table. No policy admits anon, so a visitor reads no row, and no shipped
  code reads the table signed out (the connection RPCs refuse anon). Revoking it would only turn a visitor's empty answer into a
  401.
- MAINTAIN for `anon` and `authenticated` on this and other tables is a platform-wide question (the Data API cannot use it), left
  as the media pointer guard left it.

## 14. Mission catalog sources: Project Drawdown's source page (written 2026-11-19)

| File | Changes | Callers | Proof before apply |
|---|---|---|---|
| `20261119140000_mission_catalog_sources_v1.sql` (+ `20261119140000_mission_catalog_sources_v1.rollback.sql`) | inserts the organization `project-drawdown` (nonprofit, unverified, no creator); creates `public.mission_catalog_sources` (catalog-keyed, draft/shown/hidden, the named words, facts and role line checks; SELECT for anon and authenticated, a shown row only; no write for any API role) and two SECURITY DEFINER functions for the house owner, `mission_catalog_source_owner_state` and `mission_catalog_source_command`, executable by `service_role` only; inserts one draft link for the catalog `drawdown` | the owner route `workers/mccluster/src/mission-sources.js` (the two functions) and the World's source page (the World's half of this work, B2, which lands separately; the table, read with `state=eq.shown`); both answer honestly while it is not applied | see below |

What it is: the data and the owner controls of Project Drawdown's source page in the World, a page McCluster Corp makes and
keeps, never Project Drawdown's account (`docs/control-plane/WORLD-MISSION-SOURCES.md`; decisions D1 to D14 there, each a
default adopted pending Matthew's confirmation). **Inserting the organization row publishes it**: `network_organizations` is
readable by anyone, so approving the file approves its name, type, description and website. The page itself stays a draft
until the house owner shows it.

**Prerequisite:** the mission publish (section 10.4, release step 9) applied and recorded (release step 11). The file refuses
(55000, nothing changed) while no Drawdown mission is open, and when a `project-drawdown` organization exists that is not the row
it writes. Independent of section 12 (E=UP) and section 13 (connections consent): any may come first, but the records that move
them under `supabase/migrations/` are serial, one records change for every version applied since the last.

**Not applied. Owner approval required.** Read production first (SELECT only): its ledger equals
`supabase/production-ledger.json` (no unrecorded version), the publish row is present, the open Drawdown missions counted, no
`project-drawdown` organization. Then apply on Matthew's approval of the exact text, with the Supabase MCP `apply_migration` (it
runs as postgres) under the name `mission_catalog_sources_v1`, byte for byte. The ledger version is whatever the next row is then.

**Verify** right after: one organization row and one draft link; anon REST answers `[]` for `mission_catalog_sources`; Control
(Missions & fellows, Mission sources) shows Draft at revision 1; `?source=project-drawdown` says "That page is not available.".
**Before Show:** Matthew confirms, outside this repository, that the written permission covers (a) a page headed by Project
Drawdown's name on McCluster Corp's platform, which also sells sponsorships, (b) the 87 quotations there and (c) the citation;
Show records only that date. Then Preview, then Show: that is the page's publication.

**Roll back:** Hide in Control is instant for every new visit (pages already open keep the page until they reload). To withdraw
the data, the rollback file with the owner's approval, as postgres, under `mission_catalog_sources_v1_rollback`: it refuses
(55000), changing nothing, while the organization differs from the forward file's row or anything names it (an authenticity
check, a group, a campaign, a member); otherwise it drops the two functions and the table and deletes the organization row,
keeping the `control_audit` rows and touching no mission.

**Records** after the apply, as release step 11 does: move the file to `supabase/migrations/` under its ledger version; the
ledger, the drift contract, the schema manifest from the CI reset, the snapshot, `ledger-receipts.json`; remove its
`live-callers.json` entries once the snapshot has the names; this section and `README.md`.

Proof before apply (disposable databases only):
`PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/mission-catalog-sources.integration.mjs` (76 checks over
`supabase/tests/mission_catalog_sources.stub.sql`, production's default privileges, role check and organization checks, then nine
mutated copies each failing a named check; CI matrix entry `mission-sources-store`) and
`ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=<PostgreSQL 16 or 17 bin> PG_MODULE=<node-postgres> node scripts/test/mission-catalog-sources.native.integration.mjs`
(87 checks: the same proof, one key from two sessions recorded once, a moved revision refused, the 5 s lock bound; passed on
PostgreSQL 16.15 and 17.7 on 2026-11-19). The route over the real SQL: `scripts/test/mission-sources-owner.integration.mjs` (CI
`mission-sources-owner`); the static checks: `node --test scripts/test/mission-catalog-sources-sql.test.mjs`.

## 15. AI context workstream checkpoints (written 2026-11-23)

**Pending. Never applied. Owner approval required.** Contract: `docs/control-plane/WORKSTREAM-CHECKPOINTS.md`.

| File (+ rollback) | Creates | Callers | Proof before apply |
|---|---|---|---|
| `ai_context_workstreams_v1.sql` (+ `ai_context_workstreams_v1.rollback.sql`) | `ai_context.workstreams` (where each line of work stands) and `ai_context.workstream_events` (append-only log; `UPDATE`, `DELETE`, `TRUNCATE` refused by trigger), RLS on with no policy and no privilege for any role but the owner; fourteen private `ai_context.workstream_*` helpers; four `SECURITY DEFINER`, `search_path = ''`, `service_role`-only functions: `public.ops_ai_workstream_upsert`, `_event_append`, `_checkpoint`, `_resume`. They verify an `owner` actor against `public.org_members`, hold a non-owner writer to the `internal` sensitivity ceiling, order events by the plane's own `seq` and bound volume per organization (500 workstreams, 5000 events and 200 proposed decisions per 24 hours). Changes no existing object. A decision event may insert one `proposed` row into the existing `ai_context.decisions`; it never approves one | Core only: `core/src/tools/workstream.mjs` (`core.workstream.checkpoint`, `core.workstream.list`) and `core/src/tools/resume.mjs` (the `workstreams` source of `core.resume`). Both tolerate its absence: on PostgREST PGRST202 the tools answer 503 `WORKSTREAMS_NOT_APPLIED` and `core.resume` reports `sources.workstreams: missing` with every other section unchanged. No Worker, page or Edge Function calls these names, so `live-callers.json` has no entry | `PGLITE_MODULE_PATH=<pinned PGlite>/dist/index.js node scripts/ai-context-workstreams-sql-check.mjs` (310 checks on PGlite, 313 on native PostgreSQL: the guard on a database without the context plane, apply twice, privileges and RLS, behaviour, the append-only trigger, idempotency on the operation key (a replay never rewinds the workstream; every field the caller said is content), every bound, credential and transcript refusal in every text column, proposed decisions, owner membership, the write-path sensitivity ceiling, append-order blockers, volume caps, resume order and caps, rollback refused with data then forced, re-apply, second behaviour pass); `node --test core/test/workstream-checkpoints.test.mjs` (37); `node --test scripts/test/workstream-sync.test.mjs` (12) |

**Prerequisites, all already in production:** schema `ai_context` with `ai_context.decisions`, `public.orgs`, `public.org_members` (read to verify an owner actor),
`public.ops_objectives`, `public.ops_agent_jobs`. The file's guard refuses (55000), changing nothing, without them.
It adds a foreign key from `ai_context.workstreams.objective_id` to `public.ops_objectives(id)` (`on delete set null`),
which takes a brief lock on `ops_objectives`; `lock_timeout` is 5 s, so a busy table fails the apply instead of
waiting. Independent of every other file in this folder.

**Apply** only on the owner's approval of this exact text, in one transaction, as postgres, under the name
`ai_context_workstreams_v1`. The standalone proof passes 310 checks on PGlite and 313 on native PostgreSQL 17.6;
the native pass includes three concurrent final-slot quota checks. Both standalone modes use minimal base fixtures.
Before applying, require the exact PR head's Reconciliation CI database job to pass: it runs the native proof and
`supabase/tests/ai_context_workstreams_v1.integration.sql` against the complete repository reset, twice applying the
pending SQL and testing rollback/re-apply with the real ontology and decision triggers. PostgREST
reloads its schema cache on DDL; if `core.resume` still reports `workstreams: missing` afterwards, run
`notify pgrst, 'reload schema';`.

**Verify** right after: `core.resume` reports `sources.workstreams: ok` with `workstreams.items: []`; anon and
authenticated REST calls to the four functions are refused (neither role has execute); `ai_context` is still not an
exposed schema; one `workstream.checkpoint` through the owner's MCP session returns `created: true`, and the same
call again returns `replayed: true` for its event and `applied: false` for its workstream.

**Roll back:** `ai_context_workstreams_v1.rollback.sql`, owner approval, as postgres. It refuses (55000), changing
nothing, while either table holds a row: the log is a record, and dropping it is a data deletion. To delete it on
purpose, export it, then run the rollback with `set local mccluster.workstreams_drop_data = 'on';` after `begin`.
It leaves `ai_context.decisions` untouched. Core needs no rollback: without the functions it reports `missing`.

**Records** after the apply: move the file to `supabase/migrations/` under its ledger version; the ledger, the drift
contract, the schema manifest from the CI reset, a new production snapshot; this section and `README.md`.

## 16. Owner enrollment and workspace (reviewed 2026-11-24; pending)

**Prepare and prove only. Neither forward file has been applied. Production application
requires explicit approval for each exact file.** Finish the separate 389-row applied-ledger
reconciliation first; do not replay any of those recorded migrations. This SQL review does
not enable the owner-workspace runtime flag or prove a physical device or inference run.

| Order | Forward file | Dependency and effect | Recovery file |
|---|---|---|---|
| 16.1 | `compute_owner_enrollment_v1.sql` | Applied canonical compute node and lease authority; adds `ops_compute_enrollments` and the service-only `compute_enroll_once(text,jsonb)` function. Core checks current owner membership before issuing a credential; the database consume function trusts that broker-issued record and enforces its expiry, scope and single use. | `compute_owner_enrollment_v1.rollback.sql` |
| 16.2 | `compute_owner_workspace_v1.sql` | 16.1, canonical `orgs`, `ops_compute_nodes`, `ops_compute_tasks`, `ops_compute_leases`, `ops_ai_threads`, `ops_ai_messages`, `ops_agent_jobs`, and the exact applied four-argument lease-authority-v2 claim function. Adds pair/reservation records, cleanup state and 13 workspace functions; replaces the claim function with a four-argument wrapper of `compute_claim_task_v4`. | `compute_owner_workspace_v1.rollback.sql` |

### Preflight and application boundary

Read production with SELECT only. Require repository ledger/version parity, the expected
function body and metadata, no partial workspace installation, no installed five-argument
yield signature and a current count of nodes, tasks, leases and active work. The read-only
2026-11-24 preflight found two nodes, 30 tasks, 40 leases, no active leased/running lease,
no unfinished task and no scoped node; these counts are dated evidence, not a future guard.
Keep runtime admission disabled while changing the scheduler and reread live state before
an approved application. File guards enforce known function bodies and schema shape;
they do not replace that operational check.

All six related files (these four and the two yield files in section 11) run as postgres
in **one transaction owned by the migration runner**. They set a five-second `lock_timeout`
and take the same advisory transaction lock before the guard and changes. Do not feed a
file statement by statement without a transaction. A disposable psql run uses `-1 -v
ON_ERROR_STOP=1`; production uses `apply_migration` through the existing flow.

The guards pin SHA-256 of reviewed `pg_proc.prosrc` and verify the language, signature,
argument names/defaults, return type, volatility, parallel mode, owner, security mode and
search path. An unknown body or partial installation fails with SQLSTATE `55000` and
`COMPUTE_BASELINE_CHANGED`. Missing enrollment fails with `WORKSPACE_ENROLLMENT_REQUIRED`.
The five-argument yield scheduler and workspace are deliberately mutually exclusive:
`COMPUTE_WORKSPACE_YIELD_CONFLICT` refuses both apply orderings and prevents the yield
rollback from overwriting the workspace wrapper. If yield is present, its separately
approved guarded rollback must restore the exact v2 baseline before 16.2 can be considered.
This review does not add a combined yield/workspace implementation.

After approval, apply 16.1 and verify its version and exact stored bytes before considering
16.2. After each, follow README's "To promote one": move only the actually applied file to
its actual ledger version, update the ledger/drift contract and fresh schema evidence,
then remove the pending apply step from CI. Do not assign a version in advance. Runtime
deployment and activation remain separate steps with their existing review gates.

### Recovery preserves records

First disable the feature and stop admitting new owner work. Roll back workspace before
enrollment. Neither rollback has a force or cascade option, and neither deletes a node,
task, lease or transcript row. Their locks make the inspection and removal one transaction.

Workspace rollback refuses any pair/reservation row, any cleanup hold or receipt, any scoped
node, any queued/leased/running task or lease, any routed or pinned task, any active resident
turn, or any workspace-route message. It verifies the full workspace installation before
removing only its functions, empty pair tables and cleanup columns. It restores the exact
canonical v2 claim body only after verifying the installed reviewed wrapper; an empty repeat
accepts only the exact v2 baseline. Enrollment is retained.

Enrollment rollback refuses an installed workspace, **any** issued/expired/consumed enrollment
record, a scoped node or active lease. Only an empty reviewed enrollment table/function pair
can be removed. The refusal tokens are `WORKSPACE_ROLLBACK_REQUIRED`,
`WORKSPACE_ROLLBACK_DATA_PRESENT` and `ENROLLMENT_ROLLBACK_DATA_PRESENT`. If any record exists,
retain the schema and prepare a reviewed export/forward repair; this recovery does not erase
history to make itself pass.

### Proof and remaining gate

`scripts/owner-workspace-native-check.mjs` applies each actual file in a transaction and runs
180 assertions on PostgreSQL 17.6. It observes 15 real blocked-session races and a separate
expiry-during-lock wait; tests all 15 RPCs and three tables through the denied browser roles;
checks canonical owner/member RLS; refuses scheduler conflicts, altered known bodies and
partial schema; applies twice; and proves rollback/reapply preserves two synthetic existing
nodes, 30 tasks and 40 leases, including exact legacy function ownership and grants.

```sh
POSTGRES_MODULE_PATH=<pinned-postgres-module> \
NATIVE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
node scripts/owner-workspace-native-check.mjs

# Only on the disposable, complete Supabase reset used by Reconciliation CI:
POSTGRES_MODULE_PATH=<pinned-postgres-module> \
NATIVE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
node scripts/owner-workspace-native-check.mjs --full-reset
```

Local mode uses selected canonical compute/queue migrations plus explicit peripheral Auth
stand-ins. **The full-reset mode has not yet run on the reviewed PR head.** That CI step verifies
the entire reset ledger before testing and does not replace baseline tables, functions,
triggers or grants. Require it and the existing owner-device/workspace/yield CI lanes green
on the final head before approval of any file. Safe before/after evidence and exact SQL hashes:
`docs/control-plane/evidence/owner-workspace-migration-proof-2026-11-24.md`.
