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
| `eup_module_policy_v1.sql` (+ `eup_module_policy_v1.rollback.sql`, `eup_module_policy_v1.provenance.json`) | `eup_module_policies`, `eup_module_policy_commands` (append-only), and six service-role functions: `eup_module_policy_read`, `eup_module_control_read`, `eup_module_policy_install`, `eup_module_policy_command`, `eup_module_guard`, `eup_module_guard_reduce`, plus the trigger function `eup_module_guard_trigger` | `workers/mccluster/src/eup/modules.js`, `workers/mccluster/src/world-environment.js`, and the guard calls inside `eup_intake_v1.sql` | `scripts/test/eup-module-policy.integration.mjs` (257 assertions, PGlite); under real concurrency `scripts/test/eup-module-policy.native.integration.mjs` (96) and `scripts/test/eup-intake.native.integration.mjs` (33), on PostgreSQL 16 and 17 |

| `eup_league_v1.sql` (+ `eup_league_v1.rollback.sql`) | the League tables (26, each with RLS on, no policy, no API-role privilege, the module guard trigger except the access record), `eup_outbox` (its sequence revoked from every API role) and three service-role functions: `eup_league_command`, `eup_league_member_command`, `eup_league_media_seal` | `workers/mccluster/src/eup/league-contract.js` (RPC names), `league.js`, `league-member.js`, `league-media.js`, `overview.js` | `scripts/test/eup-league.integration.mjs` (1427, PGlite); `scripts/test/eup-league-journey.integration.mjs` (1529, the real router over this SQL); `scripts/test/eup-league.native.integration.mjs` (1578 on PostgreSQL 16 and 17) |

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
