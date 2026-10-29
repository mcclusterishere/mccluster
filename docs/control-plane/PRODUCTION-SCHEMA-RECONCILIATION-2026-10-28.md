# Production schema reconciliation, 2026-10-28

Owner finding: "Validate migrations against the actual production schema and applied
ledger, including RLS and storage policies. A source scan or allowlist alone doesn't
prove the database is caught up." This page is that validation for Supabase project
`zmnhbrjyhxzhkxmhkexs`, and wave 3's first step (promotion of `supabase/pending/` per
`supabase/pending/PROMOTION-ORDER.md`). **Nothing was applied.** Every production query
was a read-only catalog SELECT through the Supabase MCP `execute_sql` and `get_advisors`.

## How it was measured

| Piece | Path |
|---|---|
| The queries (one SQL text, used three ways) | `scripts/db/schema-queries.mjs` |
| Validator | `scripts/db/verify-production-schema.mjs` |
| Expected state: what the repo's migrations build | `supabase/schema-manifest.json` |
| Production snapshot (evidence) | `docs/control-plane/evidence/production-schema-snapshot-2026-10-28.json` |
| Production advisors (evidence) | `docs/control-plane/evidence/production-advisors-2026-10-28.json` |
| Offline tests | `scripts/test/production-schema-verifier.test.mjs` |
| CI wiring | `.github/workflows/reconciliation-ci.yml`, job "Supabase migration reset" |

Each query returns one row: `md5(j::text)` and `j`, a jsonb array of arrays. The evidence
stores both, and the validator recomputes the md5 from the rows, so the committed file is
provably the database's answer, byte for byte. It holds schema metadata only: names,
flags, grants and 12-hex md5 prefixes of function bodies, policy expressions, view and
index definitions and cron commands. No table rows, no `created_by` (an email address),
no secrets.

Sections: the applied ledger (with an md5 of the stored statement and a comment-insensitive
"code" md5), schemas and their USAGE grants, extensions, relations (relkind, RLS enabled and
forced, views' `security_invoker`, column/constraint/index/view-definition signatures, and
the PUBLIC/anon/authenticated table grants), functions (identity args, result, SECURITY
DEFINER, volatility, `proconfig`, body md5, EXECUTE for PUBLIC/anon/authenticated), every
policy outside `cron` (storage.objects included: name, permissive, cmd, roles, USING md5,
WITH CHECK md5), triggers, storage buckets (public, `file_size_limit`, `allowed_mime_types`)
and `cron.job`.

The expected state is not a source scan. The "Supabase migration reset" CI job rebuilds a
disposable database from `supabase/migrations/` + `supabase/replay_migrations/`, runs the
same queries, and the result is `supabase/schema-manifest.json` (the `reset-schema`
artifact of Reconciliation CI run 40791694718). From now on that job fails
when the rebuilt schema stops matching the committed manifest, and uploads the new
snapshot and manifest as the `reset-schema` artifact; no production credentials are
involved.

Re-run against production:

```
# through the MCP: paste each section, save the tool's row list as <dir>/<section>.json
node scripts/db/verify-production-schema.mjs --print-sql relations
node scripts/db/verify-production-schema.mjs --from-mcp-dir <dir> --captured-at <iso> \
  --snapshot-out docs/control-plane/evidence/production-schema-snapshot-<date>.json
# or with a connection string held only in the environment (psql must be installed)
PROD_DB_URL=... node scripts/db/verify-production-schema.mjs --database-url-env PROD_DB_URL
# verify a saved snapshot
node scripts/db/verify-production-schema.mjs --snapshot docs/control-plane/evidence/production-schema-snapshot-2026-10-28.json
```

## Result in one table

| Check | Production vs repo |
|---|---|
| Ledger rows | 348 = 348; `supabase/production-ledger.json` matches row for row (sha256 unchanged) |
| Missing / extra / out-of-order / renamed twins | 0 / 0 / 0 / 0 |
| Single-statement migrations whose committed file is byte-identical to what production ran | 102 of 321 |
| … identical once `--` comments are ignored | 77 more |
| … whose committed **executable SQL differs** from what production ran | 142 (112 before the 2026-09-19 cutover, 30 after; 3 of them are comment-only anchors) |
| Multi-statement (legacy) migrations, not byte-comparable | 27 |
| Relations: only in production / only in repo / changed | 17 / 8 / 31 (13 index sets, 18 grant sets, 6 column sets, 7 constraint sets; one relation can differ in several) |
| Functions: only in production / only in repo / changed | 10 / 20 / 79 (71 bodies, 9 EXECUTE grants) |
| Policies: only in production / only in repo / changed USING | 37 / 17 / 58 |
| Triggers: only in production / only in repo | 6 / 2 |
| Storage buckets: only in production / only in repo / changed | 2 / 0 / 0 |
| Schemas | equal |
| `supabase/pending/` files already applied | **none** (details below) |

The ledger contract (`scripts/control-plane-drift-contract-check.mjs`) passes and is right
about names and versions. It cannot see the rest: a quarter of the production schema's
history is comment-only anchors or rewritten files, and the database the repo rebuilds is
not the database production runs.

## What production has that the repo cannot rebuild

No SQL anywhere in `supabase/` (migrations, replay or legacy) creates these:

- Tables: `private.rate_limit_counters`, `private.rate_limit_salt`,
  `public._analytics_baseline_tmp` (also the advisor's only `no_primary_key`),
  `public.feed`, `public.music_direct_entitlements`, `public.music_direct_offers`,
  `public.music_isrc_allocations`, `public.music_isrc_registrants`,
  `public.network_operator_access_log`, `public.network_user_features`,
  `public.ops_recommendations` (named in `AGENTS.md` as part of the autonomous operations
  layer).
- Present in production but only referenced, never created, in the repo:
  `public.music_direct_orders` (`20261006232625_music_direct_track_sales_v1.sql` is 800 bytes
  against a 3,989-byte production statement), `public.private_song_asset_chunks`,
  `public.network_attribution`, `network_post_edges`, `network_sessions`,
  `network_telemetry_events` (only granted/altered by `20261016031123_anon_policy_scope_v1`).
- Functions: `private.enforce_anon_insert_rate_limit()`, `private.rate_limit_client_key()`,
  `public.is_org_member(uuid)`, `public.is_org_owner(uuid)`, the vector
  `public.kb_search(q, q_embedding, match_count, rrf_k)` overload,
  `public.mnet_feed_item_from_activity()`, `mnet_refresh_user_features(uuid)`,
  `mnet_seed_surface_config()`, `music_assign_isrc(uuid)`,
  `network_profile_after_auth_link()`.
- Triggers: `events_anon_rate_limit`, `leads_anon_rate_limit` (the anonymous insert rate
  limit), `network_profile_after_auth_link_trg`, `network_activity_feed_item_trg`,
  `network_posts_feed_item_trg`, `platform_apps_mnet_surface_trg`.
- Policies (37): `control_approvals_*`, `control_*_read` (6 control tables), `feed_*`,
  `mnet_onboarding_self`, `mnet_surface_config_auth_read`, `network_activity_read`,
  `network_activity_self_insert`, `network_attribution_self_insert`, the `network_*_self`
  family (blocks, bookmarks, connections, follows, mutes, post_edges, profiles, sessions,
  telemetry) and **seven storage.objects policies** `l3_private_staff_{select,insert,update,delete}`
  and `l3_public_staff_{insert,update,delete}`.
- Buckets: `l3-product-files` (private, 512 MiB, no MIME list) and `l3-public` (public,
  50 MiB, **no MIME list**).

All of these date from the pre-cutover era (2026-09-06 … 2026-09-22) whose migrations sit in
`supabase/migrations/` as comment-only anchors or rewritten files. They are real and
load-bearing (the anon rate limit, the Level 3 storefront buckets, the M Network feed), and
a reset cannot reproduce them.

58 policy USING expressions differ for the same reason: production's `eu_*_read`,
`leads_org_read`, `org_stripe_accounts_member_read`, `platform_*` policies call the
unqualified `is_org_member(...)`, i.e. the production-only `public.is_org_member`, while
the replayed history moved them to `private.is_org_member`
(`replay_migrations/20260909030000_harden_org_helper_policy_dependencies.sql` never ran in
production). 71 function bodies differ (the `control_*`, `compute_*`, `api_*`, `mnet_*`,
`site_content_*`, `action_*` families among them).

## What the repo builds that production lacks

From `supabase/replay_migrations/` (which the drift contract treats as reconstruction only,
but which `scripts/test/rpc-names-exist.test.mjs` counts as "applied history"):

- `private.eu_runtime`, `private.eu_oauth_states`, and 20 functions:
  `private.eu_claim_ddex_jobs`, `eu_claim_external_jobs`, `eu_claim_monitors`,
  `eu_cron_google`, `eu_cron_worker`, `eu_event_dispatch`, `eu_monitor_interval`,
  `eu_out_event_communication_bridge`, `eu_runtime_secret`, and the public service RPCs
  `eu_claim_ddex_jobs_service`, `eu_claim_external_jobs_service`,
  `eu_claim_monitors_service`, `eu_cron_install_service`, `eu_oauth_state_create_service`,
  `eu_oauth_state_consume_service`, `eu_oauth_state_gc_service`,
  `eu_runtime_configure_service`, `eu_vault_store_service`, plus `media_usage_rollup` and
  `touch_listener_state`; triggers `eu_events_dispatch`, `eu_out_events_communication_bridge`.
  **Shipped callers that therefore fail in production today:**
  `supabase/functions/eu-ddex-worker`, `eu-external-worker`, `eu-monitor`, `eu-orcid-oauth`
  and `workers/mccluster/src/media/router.js` (`media_usage_rollup`). `live-callers.json`
  does not list them, because the RPC-name test reads the replay folder as applied.
- `public.mc_social_accounts`, `mc_social_campaigns`, `mc_social_posts` (replay `0036`),
  `platform_ledger_allocations`, `platform_revenue_beneficiaries`, `platform_revenue_rules`
  (replay `0035`): no shipped caller.
- Policies: per-command `listener_state_{select,insert,update,delete}_own` (replay `20260918090000`,
  beside production's single `listener_state_own`), `network_{blocks,bookmarks,mutes}_owner_*`
  (the committed `20260920071811_mnet_real_network_v1.sql`, whose SQL differs from what
  production ran: production has `network_*_self`), `mc_social_posts_public_read`,
  `platform_ledger_allocations_read`, `platform_revenue_beneficiaries_read`.

## Grant and RLS drift that matters

| Object | Production | Repo rebuild |
|---|---|---|
| `campaigns`, `engagement_modules`, `engagements`, `licence_scopes`, `modules`, `offerings`, `eu_suppressions` | authenticated holds TRUNCATE, REFERENCES, TRIGGER (`damxrtDw`) | `damrw` |
| `network_blocks`, `network_bookmarks`, `network_connections`, `network_mutes` | anon holds full DML | anon has nothing |
| `control_audit`, `control_commands`, `control_leases` | read only | anon and authenticated full DML |
| `ops_lead_scores`, `ops_signals`, `network_outbox` | no client grants | anon and authenticated full DML |
| `eu_perspectives` | anon INSERT | anon read only |
| `eu_is_admin()`, `eu_is_staff()`, `eu_role()`, `eu_match_fellowships()`, `shake_is_crew()` (SECURITY DEFINER) | anon EXECUTE | authenticated only |
| `out_lower_address()` | PUBLIC EXECUTE | none |
| `eu_log(...)` | authenticated EXECUTE | none |

TRUNCATE is not subject to RLS. PostgREST cannot issue it, so this is not reachable from
the public API today, but it is outside what any migration grants and should be revoked.
Where the repo rebuild is *more* open than production (the control and ops tables), the
repo is the one that is wrong: a fresh environment built from Git would expose them.

RLS flags are otherwise identical: no table in a repo-owned schema has client grants
without RLS (`private.rate_limit_counters` and `private.rate_limit_salt` have RLS off but no
client grants). 11 policies apply to the `public` role or to anon for writes on tables anon
can write: `eu_perspectives_in`, `leads_in` (intended public intake, with checks),
`inbox_channels_admin`, `out_campaigns_org`, `out_contacts_org`, `out_sender_owner`,
`out_suppressions_add`, `out_companies_org`, and three `prim3 progress * own`. Their
expressions all require `auth.uid()`, `eu_is_admin()` or org membership, so anon is
refused, but each should name `to authenticated` and anon's DML grants should go.

## Supabase advisors (2026-10-28)

Security: `security_definer_view` ERROR ×3 (`public.v_track_signals`,
`public.v_track_affinity`, `public.media_public_world_feed`; the last also grants anon
INSERT/UPDATE/DELETE); `anon_security_definer_function_executable` WARN ×33 and
`authenticated_security_definer_function_executable` WARN ×129 (most are intended public
RPCs: the list is in the evidence; the helpers `eu_is_admin`, `eu_is_staff`, `eu_role`,
`mnet_is_admin`, `shake_is_crew` and the trigger functions `antisocial_block_legacy_proof`,
`media_apply_geo_rule` have no reason to be anon-callable); `rls_enabled_no_policy` INFO ×204
(194 public, 10 ai_context: service-role-only tables, intended); `extension_in_public` WARN ×2
(`vector`, `pg_trgm`); `auth_leaked_password_protection` WARN (an Auth setting, not SQL).

Performance: `auth_rls_initplan` WARN ×71 across 49 tables (heaviest: `creator_service_offers`
4, `prim3_course_progress` 4, `comments` 3, `eu_fellowships` 3, `eu_profiles` 3,
`fan_profiles` 3); `multiple_permissive_policies` WARN ×221; `unindexed_foreign_keys` INFO ×444;
`unused_index` INFO ×332; `no_primary_key` INFO ×1 (`_analytics_baseline_tmp`).

Findings that need migrations (each written in `supabase/pending/`, tested on the CI reset,
promoted with the README steps):

1. **Reconcile the production-only schema into Git** (`schema_reconcile_production_only_v1`,
   written from `pg_get_*def` of the objects above, applied to production as a no-op
   reconciliation like `20261016020407`). Until then every reset-based test runs against a
   database production is not.
2. **Client privilege hygiene** (`client_privilege_hygiene_v2`): revoke TRUNCATE,
   REFERENCES, TRIGGER from authenticated on the seven tables; revoke anon DML on
   `network_{blocks,bookmarks,connections,mutes}` and `media_public_world_feed`; re-scope
   the 11 public-role write policies `to authenticated`; revoke anon EXECUTE on the
   `eu_is_*`, `eu_role`, `mnet_is_admin`, `shake_is_crew`, `eu_match_fellowships` helpers
   and the two trigger functions, and PUBLIC EXECUTE on `out_lower_address`.
3. **SECURITY DEFINER views**: replace `v_track_signals`, `v_track_affinity` and
   `media_public_world_feed` with `security_invoker` views over a projection anon may read,
   or with SECURITY DEFINER functions (`set search_path = ''`) like `play_counts()`.
   `public_music_reads_lean_v1.sql` recreates the two track views *without*
   `security_invoker`, so it fixes their speed but not the advisor ERROR; fold the fix into
   it before promoting, or follow it immediately.
4. **auth_rls_initplan** (`rls_initplan_select_wrap_v1`): rewrite the 71 policies to
   `(select auth.uid())` / `(select current_m_uid())`. Expressions only; same semantics.
5. Later, measured: index the hot foreign keys among the 444, and fold the 221
   multiple-permissive pairs where a role has both an owner and a public policy.
   Not urgent and not correctness.
6. Not SQL: turn on leaked-password protection in Auth; moving `vector`/`pg_trgm` out of
   `public` is a separate, risky change (every `vector` column type moves) and is not
   recommended now.

Also fix the tooling gap that hid finding 1's twin: `rpc-names-exist.test.mjs` should
count a name as defined only when it is in `supabase/schema-manifest.json` **and** the
latest production evidence, not when a replay file defines it.

## `supabase/pending/`: what is applied, and the promotion plan

Checked object by object (tables, views, functions, policies, buckets each file creates;
the columns it adds and the bodies it replaces were checked with read-only queries the
same day). **No pending file is applied, even partially.** Where a file replaces an
existing function, production's body and grants are identical to the repo rebuild's
(`admit_fellow_to_cohort`, `claim_action_bounty`, `clip_campaigns_open`, `clip_release_due`,
`join_action_mission`, `action_globe_can_join_mission`, `action_globe_public_region_missions`,
`play_counts`, the four `commerce_record_stripe_*`, `creator_publish_site`), so those files
apply on the base they were written for. None of their added columns exists in production
(`action_cohorts.program`, `action_missions.publish_approved_at`,
`work_payments.refunded_cents`, `action_clip_campaigns.source_kind`,
`media_news_sources.publisher_kind`, `network_notifications.pushed_at`,
`action_globe_mission_regions.pin_role`, `action_globe_regions.region_level`).
`play_counts()` and both `v_track_*` views still read `public.events`, not `events_lean`.

Order. Step 0 comes first because promotions after it are proven against a rebuild that
equals production; it changes nothing in production.

| # | File | Verdict |
|---|---|---|
| 0 | reconcile the production-only schema into Git (finding 1), regenerate the manifest | **do first**; no production change |
| 1 | `member_fronts_v1.sql` | safe as-is (new table, `front-media` bucket, four own-folder storage.objects policies; no name collides with production) |
| 2 | `world_member_regions_v1.sql` | safe as-is (one service-role function over `public.events`) |
| 3 | `20261020170000_news_region_leads.sql` | safe as-is |
| 4 | `20261020150000_network_web_push.sql` | safe as-is; enabling waits on `WEB_PUSH_ENABLED` and VAPID secrets |
| 5 | `world_publisher_verified_geo_v1.sql` | safe as-is (additive nullable columns, no grants) |
| 6 | `action_bounty_claim_existing_row_guard_v1.sql` | safe as-is (replaces a body production has unchanged) |
| 7 | `commerce_stripe_reconciler_v3.sql` | safe as-is after its CI regression; production has v1+v2 exactly as the repo |
| 8 | `public_music_reads_lean_v1.sql` | **needs edit**: add the advisor fix for the two definer views (finding 3), then apply |
| 9 | `whip_booking_authority_v1.sql` | safe as-is technically; owner approval (it never enables dispatch) |
| 10 | `equity_uprise_clipping_sources.sql` | safe as-is after its API Economic Core run; it redefines the anon-callable `clip_campaigns_open`, so review the new body's grants with finding 2 |
| 11 | `policy_fellowship_ladder_v1.sql` | safe as-is on the verified base; owner approval |
| 12 | `mission_admin_approval_v1.sql` | after 11; safe as-is |
| 13 | `20261015230000_identity_verification_levels_v1.sql` | after 11; safe as-is; consent drafts need owner and counsel first |
| 14 | `gated_track_mission_identity_v1.sql` | after 12 (and preferably 13) |
| 15 | `20261016010000_profile_edit_gate_v1.sql` | after 11 and 13 |
| 16 | `live_missions_v1.sql` | after 12 (its guards read 12's tables) |
| 17 | `20261015230000_action_mission_pins_arcs_black_business.sql` | owner approval; replaces three functions production has unchanged |
| 18 | `20261019235000_network_sfu_audio_rooms.sql` | hold: its own header says provider credentials and privacy re-acknowledgement first |
| 19 | `20261009220000_at_night_adult_verification.sql`, `20261010008000_action_connect_recipients.sql`, `20261010009000_creator_site_cohort_grants.sql` | **needs edits**: written against the 2026-10-09 schema; re-base and run on the reset first (live callers fail closed until then) |
| 20 | `20261010009100_creator_publish_cohort_entitlement.sql` | **needs edits**: it adds a 5-argument `creator_publish_site` while production's 4-argument one stays callable by authenticated; drop or revoke the old overload in the same file. After 19 |
| 21 | the other `20261009…`/`20261010…` creator and action-economy files | needs edits: re-base (as `PROMOTION-ORDER.md` group 4 says) |
| — | `20261013180000_qt6kv_creator_isrc_ledger.sql`, `20261013180100_music_cohort_isrc_grants.sql` | **overlapped, do not apply as-is**: they add a second ISRC ledger (`music_isrc_creator_registry`, `music_assign_creator_isrc()`) beside production's own `music_isrc_allocations`, `music_isrc_registrants`, `music_assign_isrc()`, which no Git SQL creates (step 0 brings them in); rewrite on top of those |
| — | `20261014170000_action_mission_curated_catalog_resources.sql` | do not apply as-is (data rows later curation changed) |
| — | `20261015210000_intel_mission_canon_v1.rollback.sql` | keep; rollback of a promoted file |

After each promotion: record the new ledger row, move the file with the README steps,
re-take the production snapshot and the reset manifest, and confirm both agree on the
objects the file created.

## Follow-up, 2026-10-29: step 0 done, findings 1-4 written

Nothing applied to production; every production query was again a read-only catalog
SELECT.

- **Step 0 / finding 1**: `supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql`
  recreates the 17 tables, 10 functions, 6 triggers, 37 policies (seven on
  storage.objects) and 2 buckets above from `pg_get_functiondef`, `pg_get_triggerdef`,
  `pg_get_constraintdef`, `pg_get_indexdef`, `pg_policies`, `relacl`/`proacl` and
  `storage.buckets`. Every block is guarded by an existence check: a no-op on production
  and on a second run. `supabase/schema-manifest.json` is the CI reset's (Reconciliation
  CI "reset-schema" artifact); against it this evidence has **nothing only in
  production** (relations, functions, policies, triggers, buckets: 0), and the
  regeneration added those 72 rows and changed no other.
  `bash scripts/test-schema-reconcile-db.sh` checks the same 72 rows against this
  evidence on a scratch Postgres. Still different, by design of step 0 (it brings in
  what is missing, it does not rewrite what exists): the 31 relations, 79 functions and
  58 policies listed as changed, and the replay-only objects below.
- **Finding 2**: `supabase/pending/20261029100000_privilege_hygiene_v1.sql`. Not revoked,
  on purpose: anon EXECUTE on `eu_is_admin`, `eu_is_staff`, `shake_is_crew` (anon is
  subject to policies that call them: revoking turns public reads of `action_missions`,
  `action_campaigns`, `eu_fellowships`, `shake_products` and others into "permission
  denied"), on `eu_match_fellowships` (signed-out matching in `js/eu-api.js`); and
  `leads_in`, `eu_perspectives_in` stay open to anon (public intake). The "11 policies"
  above are 9 once those two are kept.
- **Finding 3**: `supabase/pending/20261029100100_definer_views_invoker_v1.sql`.
  security_invoker alone would empty the views (RLS on `events`, no grants on
  `media_news_*`), so each becomes an invoker view over a `private.*_rows()` SECURITY
  DEFINER function with `search_path = ''`. `public_music_reads_lean_v1.sql` was edited
  to replace those functions' bodies, not to recreate definer views.
- **Finding 4**: `supabase/pending/20261029100200_rls_initplan_select_wrap_v1.sql`, all
  71 policies; unwrapped it is production's text byte for byte
  (`scripts/test/rls-initplan-select-wrap.test.mjs`).
- **Replay-only gap**: `supabase/pending/20261029100300_eu_runtime_and_media_rollup_v1.sql`
  creates the EU worker runtime and `media_usage_rollup`. `media_usage_rollup` as written
  in its replay file could never run (its totals read a CTE from a second statement);
  fixed in both. The triggers `eu_events_dispatch` and
  `eu_out_events_communication_bridge` are not created (side effects on every insert;
  production bridges `out_events` with its own `private.eu_out_event_bridge()`), nor
  `touch_listener_state()`; those remain rebuild-only. `scripts/test/rpc-names-exist.test.mjs`
  now counts a name as existing only when the manifest and this evidence both have it,
  and scans `supabase/functions/`.

## Limits

- Column-default and constraint signatures mask uuid literals: `0026_tenancy` sets `org_id`
  defaults to the house org's id, generated afresh on every rebuild. A default that points
  at a different org in production would not show here.
- The validator compares structure and hashes, not data; `cron.job` commands, policy
  expressions and function bodies are compared by md5 prefix. Table sizes, row-level
  content and Auth settings are out of scope.
- `pg_get_*def` output is PostgreSQL 17 on both sides (production 17.6; the CI reset uses
  the CLI's default image). A major-version change on either side can change hashes without a
  schema change: regenerate both.
- The pending-file scan is a source parser over `create table|view|function|policy` and
  bucket inserts; objects built by dynamic SQL inside `DO` blocks are not seen by it (they
  are seen by the manifest once a file is promoted).
