# Database migration audit — 2026-11-24

## Scope and evidence boundary

This inventory covers all **51 forward SQL candidates** in `supabase/pending/` at
[`7f2644b417994d1b994d763485b6448906bdfdb0`](https://github.com/mcclusterishere/mccluster/tree/7f2644b417994d1b994d763485b6448906bdfdb0).
It also accounts for the **41 rollback SQL files**, reset-only replay files,
already-applied migrations, and shipped database calls for which no migration
exists. A filename in `pending/` is not evidence that an object is absent or that
the file is safe to apply unchanged.

The current owner instruction is **“Audit everything that needs a database
migration and make it happen.”** The four verified repairs listed below were applied under that instruction.
The owner subsequently supplied a narrower handoff: production is SELECT-only,
each further file needs explicit approval by name, and changes remain draft PRs
with no merge. That later boundary governs all remaining candidates.
Historical requests for a separate generic approval in the pending README and
promotion order are not a new permission gate. Concrete compatibility, data,
access-control, rights, and provider prerequisites still need to be satisfied.
Applying schema does not authorize sending messages, publishing old catalog
content, provisioning paid services, enabling providers, or installing modules.

This document records the audit baseline and remaining checks; it is **not an
apply receipt**. It must be accompanied by actual migration versions, exact
stored-SQL comparisons, reset evidence, and live checks for changes subsequently
applied. No production mutation was performed by the inventory author.

### Refreshed production observations

| Observation | Time on 2026-11-24 UTC | Result and evidence boundary |
|---|---|---|
| Production migration ledger | 16:29 | 384 rows; last applied group is the network consent guard plus environment event parts 03–05. The workstream tables/RPCs were absent. |
| Names in `supabase/pending/live-callers.json` | 16:37:09.626299 | All 102 `pending_only` names were absent; all 15 `missing_everywhere` names were absent. The read-only query used the exact main manifest and matched functions in `pg_proc`, relations in `pg_class` (`r/v/m/p/f`), and buckets in `storage.buckets`, by name and kind. The schema scope was `public` and `ai_context`. This does not prove all existing functions replaced by pending SQL remain unchanged. |
| Additional direct DML names | 16:37:09.626299 | `crm_touches` and `vault_faces`, found outside the manifest's static patterns, were absent too. |
| Existing bounty implementation | Same audit pass | `claim_action_bounty` matched the latest applied implementation, `20261004000628`: 4,284 bytes and `md5(pg_get_functiondef)=4fe5eb07e627670703d70272168f88d5`. The pending existing-row repair is therefore still relevant. |
| Creator publisher signature | Same audit pass | Only the four-argument implementation existed. The shipped Worker uses the five-argument form supplied by the cohort entitlement migration. Apply the grants file before that replacement. |
| Module installation and lyrics columns | 16:38:36.719997 | `eup_module_policies` contained zero installed modules. `creator_tracks` had `lyrics jsonb`, but not `lyrics_sheet` or `lyrics_input_rev`. |
| Expanded Core static dependencies | 16:38:53.693485 | 64 unique names across `core/src` and `core/scripts`; 58 present and 6 absent: `ops_ai_workstream_checkpoint`, `ops_ai_workstream_resume`, `ops_character_provision`, `ops_character_publish_post`, `ops_character_publications`, and `music_stem_sets`. This extends the web/Worker manifest, which does not scan Core. |
| Commerce v3 live preflight | 16:44:48–16:45:06 | The four affected live function bodies/signatures matched canonical v2 exactly and grants were service-only. `refunded_cents` was absent; the payments table was empty and the backfill-risk check returned zero. No observed preflight blocker. |
| Clipping live preflight | 16:44:48–16:45:06 | Campaigns were empty, seven added columns were absent, the foreign-key target existed, only the expected old source check was present, and invalid-destination check returned zero. No observed preflight blocker. |

These catalog results were obtained by the parallel read-only caller audit in
this session. They are timestamped observations, not a fresh schema snapshot
file or a claim that every pending replacement has been compared byte for byte.
Production apply receipts must supersede this baseline explicitly.

### Superseding apply observations: 16:45:56 UTC

The live ledger advanced to **386 rows** while the repository's `main` remained
`7f2644b4`. The new ledger digest is
`76e69aef337a0af41a9ab7f37712647bd82d0221ab944b635eb00fcd4134dc75`.
These observations supersede the corresponding absence claims above without
changing what the earlier baseline showed:

| Actual migration version/name | Recorded statement and postchecks |
|---|---|
| `20261124164529_ai_context_workstreams_v1` | Applied by this release: 52,769 bytes, SHA-256 `5baa5f09f1b2d7a823f63bbe78ae74065da57022ac854593e8d5790a6c9c03f0`, MD5 `c12c6a14e494fe76c96f6550b40cedbd`. Table RLS and denial of anonymous/member access verified; four RPCs are service-only SECURITY DEFINER with empty search paths. Core promotion/runtime and Prime synchronization remain separate completion checks. |
| `20261124164026_member_fronts_shared_revision_directory` | Applied concurrently by another session: 26,851 bytes, SHA-256 `34258d5855f2785f38f293e85a388d1a4ae92df36ff361e29713b6fa014bf943`, MD5 `fa5f4ab5d0a7ea206e8a865828c883db`. Source and caller compatibility are being reconciled. **Do not replay the old `member_fronts_v1.sql`**; this concurrent schema may supersede it. |

The 51-file table remains the pinned baseline inventory. Its workstreams and
member-front rows must be interpreted with this dated supersession, not as an
instruction to apply those old pending files again.

### Superseding applied ledger: through 16:49:04 UTC

Three further verified migrations were applied and recorded:
`20261124164724_commerce_stripe_reconciler_v3`,
`20261124164851_equity_uprise_clipping_sources`, and
`20261124164904_action_bounty_claim_existing_row_guard_v1`.
Together with workstreams and the concurrently applied member-front schema,
the reconciled ledger is now **389 rows**, digest
`08f933eb60484f323e910569915afa365684deba0d5063fbd2c88ece5592bf8b`.
Their pending files have been moved to the actual recorded versions; the updated
`supabase/production-ledger.json` and
`production-schema-snapshot-2026-11-24.json` capture the live delta. The baseline
table remains historical for those entries; do not apply them a second time.

### Small-migration preflight and reviewed revisions

Read-only live catalog checks at **16:48:26–16:49:08 UTC** found:

- `ops_signals`: 64 rows, 155,648 total bytes, zero duplicate digest windows and
  no equivalent uniqueness index. The reviewed pending revision replaces
  `CREATE INDEX CONCURRENTLY` with a **normal transactional unique-index build**
  and a five-second lock timeout. Its measured size supports the standard
  migration flow; no DDL through `execute_sql` or out-of-band ledger entry is
  needed. A duplicate or lock timeout aborts without deleting existing signals.
- `ops_agent_jobs`: 47,099 rows, 53,321,728 heap bytes, 234,274,816 total bytes;
  neither reflection index exists. Live EXPLAIN still uses sequential scan plus
  sort for both the latest health lookup and recent non-health jobs. The
  existing short-lock-timeout migration is still applicable.
- `media_news_sources`: 10,039 rows, 1,900,544 total bytes, only its original four
  columns and primary/domain unique constraints. RLS is on; table privileges are
  service-only. The pending geography revision makes its named completeness
  check idempotent, leaves transaction ownership to the migration runner, and
  bounds its lock wait to five seconds.
- `private.ops_ingest_ensure_connector`: the live seven-argument function still
  overwrites omitted policies, and its ACL grants only the owner execution.
  Seventeen connectors exist. The pending replacement is therefore relevant;
  its existing signature and ACL must remain intact. The service-only readiness
  probe does not yet exist.

`scripts/test-small-pending-native.mjs` **passed all 10 native scenario groups
on PostgreSQL 17.6** in this session. All four migrations apply in ordinary
transactions twice; both reflection result sets stay identical while their
plans use the new indexes; a real two-session digest race commits one row;
duplicate-data build failure preserves both conflicting rows; the five-second
lock timeout aborts and a later build succeeds. Geography boundary/role checks,
omitted/null/empty connector policies, explicit policy replacement, retained
private ACL and service-only readiness also pass. This uses source-extracted
canonical table DDL with peripheral role/FK stand-ins, not a full reset.
`supabase/tests/small_pending_migrations.integration.sql` is the separate
full-reset proof: it requires the real ontology/rescore triggers, inserts only
synthetic rows in a rollback transaction, and never replaces or disables base
objects. It is prepared for CI; it has not been claimed as a locally executed full
reset. Exact reviewed SQL hashes and actual application results belong in the
subsequent apply receipt.

## Priorities and proof standard

- **P1 — repair a shipped dependency or existing behavior:** prioritize current
  unavailable paths, missing signatures, reliability, and security fixes. The
  listed remaining proof and live preflight are still required.
- **P2 — coupled change or dependency chain:** prepare and verify the necessary
  code and prerequisite SQL together; some migrations change existing writes or
  publication rules immediately.
- **P3 — gated or preparatory:** schema has a real implementation, but the
  relevant provider, module, executor, release flag, or workflow is not active.
  Apply verified preparation if needed without claiming the feature is enabled.
- **H — concrete hold:** source, compatibility, data, rights, or proof issues
  prevent applying the current file unchanged. Resolve the issue instead of
  replaying the directory wholesale.
- **X — superseded:** do not apply this file as written.

“Proof source” below means a checked-in test or documented command exists. It
does **not** mean that this session ran it. A mocked Worker test, PGlite fixture,
native PostgreSQL fixture with stubbed base tables, and full migration reset
answer different questions. Keep their results separate. Existing evidence on
exact main includes the real reset and economic regressions in
[API Economic Core run 45344420161](https://github.com/mcclusterishere/mccluster/actions/runs/45344420161)
for commerce v3 and clipping. Its
[native database job 138275439983](https://github.com/mcclusterishere/mccluster/actions/runs/45344420161/job/138275439983)
records the full reset, old/v3 commerce assertions, both concurrent delivery
orders reaching refunded, randomized replay **24 passed / 0 failed / 0 skipped**,
all clipping assertions and the bounty scratch proof. The refreshed commerce
and clipping preflights above found no blocker to applying the reviewed files.

The new world-member native proof found and fixed
an equal-timestamp ordering defect: `ORDER BY uid, at DESC, id DESC` now chooses
deterministically. Native PostgreSQL 17.6 passes 12 scenario groups twice,
including actual denied-role calls, apply twice, transaction rollback and RPC
drop/reapply; Worker tests pass 7/7. This uses canonical events DDL with auth/API
role stand-ins, not a full reset. The corrected SQL SHA-256 is
`1862a63cc2d80fda820d21440e4be394e7ae439be67fcf52d1a859cc110e0b27`.
Full-reset integration and production results remain release-receipt work.

## Per-file inventory: all 51 forward candidates

Paths in the first column are relative to `supabase/pending/`. They identify the
pinned baseline even when a successful promotion subsequently moves the file to
`supabase/migrations/<actual-version>_<name>.sql`.

### Current dependency and reliability repairs

| Forward file | Class | Why it matters; dependencies and remaining proof |
|---|---|---|
| `ai_context_workstreams_v1.sql` | P1 | Supplies the two missing Core workstream calls and two additional service-only RPCs in the existing private context store. Uses existing organizations, owner memberships, decisions, objectives and jobs; no pending prerequisite. Proofs: `scripts/ai-context-workstreams-sql-check.mjs`, `supabase/tests/ai_context_workstreams_v1.integration.sql`, Core checkpoint and sync tests. Earlier work established 313 native assertions and two real-reset integration passes; retain their exact CI/source boundary. After apply, verify owner checkpoint/resume, anonymous/authenticated denial, and the deployed Core health receipt before syncing Prime. Preserve the SQL atomically; do not split function bodies to fit a tool limit. |
| `action_bounty_claim_existing_row_guard_v1.sql` | P1 | Repairs overwritten PL/pgSQL `FOUND` state in the existing claim path. Live function still has the old implementation. Proof: `scripts/test-action-bounty-claim-db.sh`, `supabase/tests/action_bounty_claim_guard.behaviour.sql`, and `bounty-claim-guard-db.yml`; exact-main Economic CI also passes its scratch proof. Verify preserved denied/unfunded behavior and same-row retries on the current baseline. |
| `commerce_stripe_reconciler_v3.sql` | P1 | Serializes existing Stripe delivery/refund paths, preserves manual payments, and records partial-refund cents. Uses existing economic tables/RPCs. Exact-main full-reset CI passes; regression and race proofs are `commerce_stripe_reconciler_v3_regression.sql` and `commerce_stripe_concurrency.sh`. Live replacement definitions/grants and empty-table/backfill guards were checked at 16:44–16:45 with no blocker; ready for the repository's transactional apply and recorded postchecks. |
| `equity_uprise_clipping_sources.sql` | P1 | Supplies missing Control clipping functions/view while reusing canonical missions and clipping records. Exact-main full-reset CI passes `supabase/tests/action_clipping_regression.sql`; refreshed live columns, constraints, empty-table and destination checks found no blocker. Ready for recorded application. The media-pointer hardening has a separate fixture/compatibility dependency; do not assume these are interchangeable. |
| `world_member_regions_v1.sql` | P1 | Missing service-only RPC leaves the ungated World member card unavailable. Reads coarse location of the latest signed-in event; adds no location collection. This session fixed equal-timestamp ordering and added `scripts/test-world-member-regions-db.sh` plus `supabase/tests/world_member_regions.behaviour.sql`: native PG17.6 passes 12 scenario groups twice, Worker tests 7/7. Canonical events DDL with role/auth stand-ins is not a full reset; wire the fixture into current reset CI before promotion. |
| `20261020170000_news_region_leads.sql` | P1 | Missing `news_region_leads` degrades leader reads/cron while `NEWS_BRIEFS_ENABLED=true`. Worker tests: `news-briefs.test.mjs` and `news-brief-resilience.test.mjs`. Re-run on the current reset with real role/grant checks; mock responses do not prove table access. |
| `20261010009000_creator_site_cohort_grants.sql` | P1 | Missing grant table is called by creator site publishing. Written against the older October baseline: re-run SQL and access behavior on the current reset. Apply immediately before the next entitlement file. |
| `20261010009100_creator_publish_cohort_entitlement.sql` | P1 | Depends on the preceding grant table and supplies the five-argument publisher used by the Worker; live has only four arguments. Verify entitlement rejection/acceptance, overload resolution, and grants together with the grant migration. |
| `member_fronts_v1.sql` | P2 | Adds private forced-RLS front documents plus the per-owner `front-media` Storage paths and quota function; API currently returns 503 without schema. Couple to the repaired Worker public-read and publication gates: missing/private profiles must not publish, and missing-profile public reads must return 404. The narrow fix is prepared with 9/9 API tests in this session; rollout remains part of the release. Native proof `scripts/test-member-fronts-db.sh` applies twice using role/Storage stand-ins; supplement with current reset and deployed publish/read checks. |
| `20261022015000_market_layer1_preserve_source_policy.sql` | P1 | Preserves nonempty retention/license policy when existing connector-ensure calls omit it. Live function still has the old overwrite behavior and owner-only ACL. The new native proof passes omitted/null/empty preservation, explicit replacement, retained private ACL and service-only readiness. Full-reset integration fixture is prepared; SQL itself is unchanged. |
| `core_reflection_read_indexes_v1.sql` | P1 | Two partial indexes support existing Core reflection job reads. Live equivalent indexes are absent and both plans sequential-scan/sort; measured heap is 50.9 MiB. Native proof preserves both result sets and demonstrates actual index plans after applying twice. Use the existing five-second lock timeout; full-reset integration is prepared. |
| `ops_signals_digest_window_unique_v1.sql` | P1 | Unique partial index prevents duplicate Core morning digest windows; code currently tolerates its absence. Baseline source used `CONCURRENTLY`; the measured 64-row live table supports the reviewed normal transactional revision described above, with a five-second lock timeout and duplicate-preservation proof. Recheck size/duplicates before applying. `core/test/digest-persistence.test.mjs` is the caller proof. |
| `world_publisher_verified_geo_v1.sql` | P1 | Adds nullable publisher/HQ fields to existing news sources without new grants; live seven columns/checks are absent. Reviewed revision fixes named-check idempotence and bounds lock wait. Native proof passes apply twice, unchanged legacy insert shape, valid/invalid completeness/ranges, RLS and actual denied-role calls; full-reset integration is prepared. |

### Existing features with runtime or acceptance prerequisites

| Forward file | Class | Why it matters; dependencies and remaining proof |
|---|---|---|
| `20261009220000_at_night_adult_verification.sql` | P2 | Missing table is called by the shipped At Night API. October 9 draft needs a fresh current-reset replay, role/ownership proof and current verification-flow compatibility before enabling access. A caller match alone does not prove a verification policy is ready. |
| `whip_booking_authority_v1.sql` | P2 | Adds booking idempotency, driver clearances and reserve RPC to existing WHIP authority. Proof: `workers/mccluster/test/whip-booking.test.mjs`; add native current-baseline enforcement proof. Applying schema does not enable dispatch or establish a driver's clearance. |
| `music_label_artists_v1.sql` | P2 | Adds artist-manager authority and owner-management RPCs, replaces creator/track/license guards and policies, and seeds two loginless label artists. Preflight that the `prim3`/`equity-uprise` handles are free and the house owner resolves through actual organization membership and auth links. Proof: `scripts/test-music-label-db.sh`, behavior SQL and `music-label-db.yml`; verify rollback hashes against current definitions. Existing Control falls back to the static catalog. |
| `20261031180000_lyrics_machine_v1.sql` | P2 | Adds revisioned lyrics input and queues `lyrics_align` jobs via triggers; those columns are absent. **Deploy/verify Core's executor before applying** so newly queued jobs are supported. The deployed old-schema fallback does not prove trigger readiness. Proof: Core lyrics-machine and format tests; add current-reset trigger and queue checks. |
| `20261031190000_music_stem_sets_v1.sql` | P2 | Missing private stem-manifest table is used by Core and owner-only music access. **Verify the deployed `stems_separate` executor first.** Reuses private `mcc-gated-audio/stems` storage and introduces no public Storage access. Proofs: `core/test/stems.test.mjs`, `scripts/test/stems-private.test.mjs`; verify native table/role behavior and private listing after apply. |
| `prim3_level_builder_v1.sql` | P2 | Missing owner-only level drafts and immutable playable versions block the shipped builder. `supabase/tests/prim3_level_builder.db.mjs` runs PGlite with owner/role stubs, despite its broad PostgreSQL comment. Obtain current-reset/native proof before promotion. “Publish” freezes a private version; it is not a public release. No destructive routine rollback should erase saved levels. |
| `compute_claim_task_yield_v3.sql` | P3 | Adds an optional fifth yield argument to the existing compute claim RPC, carries priority and removes overload ambiguity. Applied lease-authority v2 is prerequisite. Live remains four-argument; Core falls back and GPU yield is off by default. Proofs: `scripts/compute-lease-yield-sql-check.mjs`, `supabase/tests/compute_claim_task_yield.behaviour.sql`, rollback/reapply. This is an optional scheduler improvement, not a missing critical consumer. |

### Gated preparation

| Forward file | Class | Why it matters; dependencies and remaining proof |
|---|---|---|
| `20261010008000_action_connect_recipients.sql` | P3 | Missing recipient table has a shipped caller, but `ACTION_CONNECT_TEST_PILOT` is absent and the path requires a test Stripe key. Rebase the October SQL and prove role/recipient constraints. Schema alone does not enable a pilot, payouts or real recipients. |
| `20261019235000_network_sfu_audio_rooms.sql` | P3 | Adds private room state and eight mapped calls; `AUDIO_SFU_ROOMS_ENABLED=false`. Native/fixture entry point: `scripts/test/audio-rooms-db.mjs`. Verify current baseline, provider credentials and privacy re-acknowledgement before actual room use; schema application must not silently enable the flag. |
| `20261020150000_network_web_push.sql` | P3 | Missing subscriptions table; `WEB_PUSH_ENABLED=false`. `workers/mccluster/test/web-push.test.mjs` is a mock/caller proof. Verify database ownership/access and provision VAPID only as an explicit feature step. No notification sending follows merely from schema preparation. |
| `live_missions_v1.sql` | P3 | Adds live-session records, consent and mission/live-bounty enforcement using canonical assignments. `LIVE_MISSIONS_ENABLED=false`; mandatory live proof also ships off. No hard pending prerequisite, but apply after approval rules if both are promoted. Proof: `scripts/test-live-missions-db.sh`, including the approval variant. Does not automatically award points or initiate payments. |
| `mnet_character_cast_v1.sql` | P3 | Adds the three missing Core character objects; no existing data path is altered. Proof: `scripts/test-mnet-character-cast-db.sh` covers apply twice, behavior, rollback and reapply. `MCCLUSTER_CHARACTER_POSTS=live` is off by default. Provisioned profiles start disabled; provisioning, enabling and scheduling public posts are separate actions. |
| `prim3_reviewed_releases_v1.sql` | P3 | Builds owner-reviewed releases and revocable/expiring session bindings on applied learning-evidence/news tables. `PRIM3_RELEASES_ENABLED` is absent. Proof: `scripts/test-prim3-adaptive-postgres.mjs`, `prim3-adaptive-postgres.yml`, optional release browser acceptance. Verify signing-key/runtime readiness before enabling; schema alone releases no level. |

### Mission, identity and module dependencies

| Forward file | Class | Why it matters; dependencies and remaining proof |
|---|---|---|
| `policy_fellowship_ladder_v1.sql` | P2 / H seed | Supplies ten missing names and the foundation for the following approval/identity chain. Native proof: `scripts/test-policy-fellowship-db.sh`. Remove or deliberately reconcile the obsolete mission-kind seed: two deleted missions are skipped but the remaining free-ride mission would still be written. Authorization to migrate is not evidence that obsolete curated content is desired. Counsel-restricted Equity rules remain disabled. |
| `mission_admin_approval_v1.sql` | P2 | Depends on the ladder. Changes existing mission/proof/completion/publication enforcement, so test current callers and existing rows rather than treating it as an additive unused table. Proof: `scripts/test-mission-admin-approval-db.sh`; admin-approved completion and audit-history checks are required. |
| `20261015230000_identity_verification_levels_v1.sql` | P2 | Depends on the ladder; supplies thirteen mapped names and extends verification/unlock state. Proof: `scripts/test-identity-verification-db.sh`. `PERSONA_ENABLED=false`; private video/consent and provider identity flows need their own acceptance. The Halo-related rule remains disabled. Applying schema must not assert that external verification occurred. |
| `gated_track_mission_identity_v1.sql` | P2 | Depends on mission approval, preferably identity next to it. Adds the two missing music-gate calls and enforces verified missions/identity. Proof: the mission-admin DB suite plus gated-track behavior tests. Verify existing music access and avoid granting incomplete evidence. |
| `20261016010000_profile_edit_gate_v1.sql` | P2 | Depends on ladder and identity. Locks already-populated protected profile fields and requires approved verification for later edits, changing existing writes immediately. Proof: `scripts/test-profile-edit-gate-db.sh`, which reruns identity/ladder behavior. Promote only with working recovery and verification UI/provider behavior; a disabled provider can otherwise strand edits. |
| `20261015230000_action_mission_pins_arcs_black_business.sql` | P2 | Three missing shipped calls plus countries, lists, arcs, origins and business listings. The extracted join-scope prerequisite is already applied. Its six old curation targets were deleted; do not restore them. Proof: `scripts/test-mission-pins-db.sh` and behavior SQL. The header's “do not apply as written” warning refers to the older curated-catalog file below, not this whole file. Compare current definitions and seed effects; after applying the full file, old join-scope rollback must not overwrite it. |
| `20261107120000_world_environment_v1.sql` | P3 | Adds canonical environmental mission/review helpers and an open Environmental Justice group; five mapped calls are absent. `scripts/test-environment-postgres.mjs` is native but explicitly uses source-extracted mission/group DDL and peripheral stubs, not a full reset. Also has PGlite and Worker proofs. No E=Up module is installed; schema, group creation and actual module enablement are distinct effects. |
| `20261108120000_world_environment_proofs_v1.sql` | P3 | Depends on the preceding environment schema. Extends canonical proof/share intents with exact consent and reviewed publication snapshots; five mapped calls absent. `scripts/test-environment-proofs-pglite.mjs` tests behavior/rollback. Add current-reset/native trigger interaction proof; generic old shares must remain without automatic publication permission. |
| `eup_intake_v1.sql` | P3 | Depends on the already-applied module policy. Eight mapped names missing; private intake/snapshot/review records and guarded service RPCs. Native concurrency proof: `scripts/test/eup-intake.native.integration.mjs` (historical 33 checks); policy has separate PGlite/native proofs. No module installed; import runner is unscheduled and connectors disabled. Applying SQL does not establish source rights or enable imports. |
| `eup_league_v1.sql` | P3 | Same applied module-policy prerequisite. Adds 26 private tables, outbox and three service-only command surfaces. Historical tests: League PGlite 1,427, journey 1,529 and native 1,578; rerun relevant current-baseline compatibility. Large SQL must retain transaction/function boundaries. Zero installed modules means this is preparation, not restoration of an enabled league. Campaign publication, payments and public broadcasting do not follow from schema. |
| `20261119140000_mission_catalog_sources_v1.sql` | P2 | Depends on the already-applied Drawdown publish record. Adds the missing owner source-page calls and creates public organization metadata with a draft page. Proofs: `mission-catalog-sources.integration.mjs`, `.native.integration.mjs`, owner integration and SQL tests. Verify current content and organization uniqueness. Source quotation/branding permission cannot be invented; “Show” remains a separate rights-checked publication action. |

### Catalog seed files and concrete hardening holds

| Forward file | Class | Why it matters; dependencies and remaining proof |
|---|---|---|
| `20261031180100_whip_equipped_catalog_objects.sql` | H data | Upserts nine active catalog rows from an October snapshot. Compare exact current album data, artists, asset paths and live rows before promoting; this is publication/data mutation, not missing infrastructure. The file's artist/credit labels also need alignment with the current catalog. Do not replace later catalog decisions with an old seed. |
| `20261031190000_prim3_catalog_objects.sql` | H data | Upserts thirteen active rows, including one existing recording, under stable PRIM3 keys. Confirm current public catalog and actual assets. Three titles are marked draft text while their SQL status is active: preserve intentional current publication state rather than assuming every seed is still desired. |
| `network_media_assets_pointer_guard_v1.sql` | H compatibility | Security hardening removes direct member table/Storage writes and makes pointers immutable. Requires canonical legacy-path precheck to be zero, current trusted-writer/grant review, and evidence older clients do not depend on direct writes; four client fallbacks still exist when upload tokens are absent. Native PG16/17 proof and actual Storage-flow proof are separate. Update the clipping fixture's legacy path before promotion. Do not rewrite/delete legacy uploads to make a check pass. This file does not fix the separate finalize/discard lifecycle issues documented in the README. |
| `20261013180000_qt6kv_creator_isrc_ledger.sql` | H rights/schema | Explicitly not safe as written: reconcile current ISRC allocations, prefix/rights authority, schema versions and function security before adopting this draft. A migration must not imply authorization to issue codes under a borrowed prefix. |
| `20261013180100_music_cohort_isrc_grants.sql` | H dependency | Depends on the reviewed/reconciled ISRC ledger; inherits its rights and current-schema blockers. Re-run allocation uniqueness and role/grant tests once the actual canonical allocator is decided. |
| `20261014170000_action_mission_curated_catalog_resources.sql` | X | Superseded by later catalog decisions. Most updates target deleted missions, while two inserts reference deleted campaigns and can fail foreign keys. Restoring those campaigns would restore content deliberately removed. Do not apply; use the existing Drawdown/current catalog path and deliberately archive this draft when cleanup is reviewed. |

### Older staged economy/creator proposals

These eight files have no direct mapped shipped dependency in the current
manifest. Some replace existing behavior, so absence of a new-name caller is not
proof they are harmless. They require a current product need, canonical-model
review and a full-reset rebase, rather than automatic application to empty a
directory.

| Forward file | Class | Dependency or concrete readiness question |
|---|---|---|
| `20261009223000_action_economy_risk_ledger.sql` | H rebase | Older risk-ledger design; reconcile with the current economic model and trusted event sources. Contains repeated DDL blocks, but duplicate trigger creation is preceded by a drop; repetition alone is not proof of SQL failure. Verify the whole file instead of guessing from text. |
| `20261009233000_creator_lifecycle_events.sql` | H rebase | Staged lifecycle-event source and projections; establish current authoritative producer and replay/access rules before enabling new records. |
| `20261009234500_creator_clip_lifecycle_reporting.sql` | H dependency | Needs lifecycle events and clipping semantics; refresh schema/caller integration and distinguish reporting from settlement authority. |
| `20261009235900_creator_team_decision_matrix.sql` | H rebase | Staged team/decision authority; reconcile with existing canonical membership and decision records and prove role boundaries. |
| `20261010004000_creator_super_verification_rewards.sql` | H behavior | Depends on team/verification and clipping structures; introduces an issuer guard that can change existing reward workflows. Verify current reward authority and required evidence before enforcement. |
| `20261010005000_creator_selection_api_draft.sql` | H dependency | Depends on team and super-verification proposals. Functions are revoked from authenticated callers and do not establish a shipped access path. Keep staged until a tested current integration needs them. |
| `20261010006000_creator_fan_payment_evidence.sql` | H integration | Requires an actual trusted payment/webhook producer and reconciliation with current paid-order authority; schema alone cannot make fan-payment evidence trustworthy. |
| `20261010007000_action_financial_journal.sql` | H model | Confirm it belongs to the canonical economic ledger rather than creating a second journal/authority. No mapped shipped consumer establishes a present need for this October draft. |

## Already applied: reconcile records, do not replay

The audit starts from the 384-row production ledger already reconciled by #825.
The published digest is
`8af712520bdf7daf353b36b801eb568849ed9bb1088e57b48ffd2e364c97ed9c`.
See [the 384-row receipt](releases-2026-11-23/LEDGER-384-APPLIED.md),
`supabase/production-ledger.json`, `supabase/schema-manifest.json`,
`core/drift-contract.json`, and the November 23 production schema snapshot.

| Applied group | Recorded production migration(s) / boundary |
|---|---|
| Privilege, view and RLS hygiene; EU runtime/rollup | `20261029010919`, `20261029011001`, `20261029011314`, `20261029011534`; lean music reads `20261029011108` is also applied. |
| Music release integrity and direct sales | Integrity `20261030001000`, direct sales `20261031180839`, direct asset versions `20261109175747`. Integrity's original ledger has `statements=null`: do not claim a stored-SQL byte comparison that cannot be made. Never replay the superseded direct-asset draft. |
| Core signatures, arcade and paid-media recovery | `20261109180829`, `20261109181623`, media claims v1 `20261109194957`, v2 `20261110220135`. These are not pending missing schema. |
| E=Up registry/workspace and module policy | `20261114015120`, `20261114060150`, `20261117144103`. Registry/workspace were imported from actual stored statements; the registry's guarded reset twin is not another production migration. Module-policy schema exists while zero modules are installed. |
| Mission join scope/details and Drawdown | Join scope `20261117222809`, details `20261118021521`; seven Drawdown import parts on November 18; credit fallback `20261120061538`, publish `20261120061714`. Unsupported quotation/permission claims were removed. Do not recreate the superseded curated-mission seed. |
| Network consent and environment event store | Latest consent guard `20261123173626`; event parts 01/02 `20261120061725` / `20261120061759`, parts 03/04/05 `20261123173831` / `20261123173951` / `20261123174034`. All five event-store parts are applied. This is separate from the still-pending environment mission/proof helpers. |
| Earlier reconciliation | Intel canon, World place/news, listener state, analytics country/region, Action archive/reset and news discussions already have recorded applied equivalents documented in the pending README. Their old pending/recovery names are not new work. |

For the four most recent November 23 imports, the committed file is the stored
statement plus one documented final LF. The receipt explicitly pins that
normalization; comparison after removing that one LF is exact. Earlier
November 20 statements retain their LF. Do not alter applied SQL or invent new
versions to erase this documented representational difference.

### Files excluded from forward application

- All **41 `*.rollback.sql` files** in the baseline pending directory are recovery
  instructions, including rollbacks left behind by already-applied migrations.
  They are not a backlog to execute. Several intentionally reopen defects or
  refuse nonempty data; use only for a concrete, reviewed recovery operation.
- `supabase/replay_migrations/` contains reset compatibility files, including
  `20261028230000_schema_reconcile_production_only_v1.sql` and the E=Up registry
  replay twin. Preserve their guarded production no-op behavior. A local reset
  cannot be used as authority to run replay-only SQL on production.
- `supabase/tests/action_globe_demo_pins_v1.applied.sql` is a test/history fixture
  for demo data already applied, not a fresh migration. The full pins/arcs file
  remains a distinct forward candidate in the table above.
- Test stubs, behavior SQL, seed fixtures, archived source, provenance JSON and
  schema snapshots are evidence or test inputs, not pending deployment SQL.
- The removed private decision-evidence proposal was superseded by canonical
  intel/context records. Do not introduce a second memory or source registry.

## Shipped names with no migration: repair the contract first

The 15 manifest entries below, plus two additional direct-DML names, are absent
from production and from the forward inventory. Creating empty lookalike tables
would hide the mismatch and could establish parallel CRM, vault or accounting
authority. Reconcile each caller with existing canonical stores, or remove its
unsupported route, before proposing narrowly scoped schema.

| Caller area | Missing names |
|---|---|
| `desk.html`, `js/control-room/work-tools.js` | `crm_contacts`, `crm_pipeline`, `crm_signals`, `crm_templates`; additional direct DML: `crm_touches` |
| `js/network.js` | `deals` |
| `js/backend.js` | `entitlements`, `likes`, `plays` |
| `js/control-room/music-ops.js`, `vault.html`, `lanes.html` | `vault_assets`, `vault_credentials`, `vault_gate_status`, `vault_house`, `vault_lane_readiness`, `vault_people`, `vault_targets`; additional direct DML: `vault_faces` |

The manifest's 102 pending-only names map to 25 of the 51 candidate files; the
remaining files include replacements, indexes, seed data, Core-only calls and
staged proposals. Neither a missing direct caller nor an empty manifest entry
is an adequate safety or necessity test.

## Execution order and completion evidence

1. **Preserve the reconciled baseline.** Confirm the live ledger and current
   deployed code before each batch. Work from reviewed SQL with recorded hashes;
   compare every replaced live definition and all affected privileges. Keep
   real production statements separate from reset stand-ins.
2. **Close the original context issue and immediate existing-path defects.**
   Workstreams is independent of the other pending files. Bounty, commerce,
   clipping, World members and news leader state can be proved independently.
   Creator grants must precede the five-argument entitlement publisher. Deploy
   the member-front gate correction before exposing the new publishable store.
3. **Verify runtime-dependent preparation.** Confirm Core executors before
   lyrics/stems trigger activation; prove private builder/label/WHIP paths and
   current data before exposing them. Preserve provider flags and explicit
   module states unless actual feature activation is part of the proven change.
4. **Handle the dependency chain as a coherent behavior change.** Reconcile the
   ladder seed; ladder precedes approval and identity; the gate follows approval
   and preferably identity; profile-edit enforcement follows working identity
   recovery. The full pins migration follows the already-applied join-scope
   extract. Environment proof helpers follow environment missions. Intake and
   League depend on the already-applied module policy, not each other.
5. **Apply verified SQL through the repository's production flow.** Preserve
   atomicity, actual ledger versions and exact stored statements. Use the reviewed
   transactional digest-index revision justified by the live size preflight;
   do not apply its old concurrent-build draft through a side channel. A failed preflight must
   produce a bounded repair, not deletion of conflicting production data.
6. **Reconcile after each successful batch.** Move only actually applied files
   under their recorded versions; update pending references/proof runners,
   production ledger, manifest, live-callers and drift contract as needed.
   Re-run the full reset and targeted native/role proofs on the resulting tree.
   Verify live RPC/health behavior, denied roles and relevant feature behavior;
   record unchanged provider/module states where appropriate.

Completion means applied necessary migrations have concrete live receipts and
the repository reproduces them. The staged, superseded and compatibility-held
items remain explicit with their actual reason; they are not silently marked
complete merely because this inventory exists.

## Sources

- Pinned repository [pending README](https://github.com/mcclusterishere/mccluster/blob/7f2644b417994d1b994d763485b6448906bdfdb0/supabase/pending/README.md), [promotion order](https://github.com/mcclusterishere/mccluster/blob/7f2644b417994d1b994d763485b6448906bdfdb0/supabase/pending/PROMOTION-ORDER.md), and [live caller manifest](https://github.com/mcclusterishere/mccluster/blob/7f2644b417994d1b994d763485b6448906bdfdb0/supabase/pending/live-callers.json).
- [All baseline pending SQL](https://github.com/mcclusterishere/mccluster/tree/7f2644b417994d1b994d763485b6448906bdfdb0/supabase/pending), with file headers, relevant definitions, documented prerequisites and proof sources cross-checked for the inventory.
- [Repository agent contract](https://github.com/mcclusterishere/mccluster/blob/7f2644b417994d1b994d763485b6448906bdfdb0/AGENTS.md), including the single shared database and canonical-state requirements.
- [Economic Core CI at the audited main](https://github.com/mcclusterishere/mccluster/actions/runs/45344420161), plus checked-in proof scripts named per candidate. Historical counts are labeled and do not stand in for a new execution.
- Read-only Supabase catalog observations at the UTC times above, supplied by the session's caller audit; no personal row contents, credentials or private checkpoint payloads are included here.
