# Fifteen-day database reconciliation and historical migration inventory

**Snapshot:** 2026-10-21 ~01:00 America/New_York; GitHub `main` `e25179a74247ff5fb474689bb4325b30d1e631b4`; Supabase production project `zmnhbrjyhxzhkxmhkexs`. This is an audit, **not** release authorization.

## Scope and evidence
- GitHub PRs created 2026-10-06 04:45Z through audit: **189**; **148 merged**, **38 open**, **3 closed unmerged**. PR authorship is not attributable to Claude solely from these counts. Includes both application-only and DB-changing PRs.
- Repository recursive tree: **5,550 blobs**, **352 files under `supabase/migrations/`** (including non-SQL if present), **34 pending SQL files**: **25 forward** and **9 rollback**. Also includes legacy/replay SQL, `platform/sql/` (not assumed to be Supabase), tests and historical documentation. Do not treat every .sql file as an unapplied production migration.
- Supabase production: **336** applied ledger entries, latest `20261021050105_music_creator_one_click_v1`. Exact source equality verified for the new 10,368-character migration; public RPC permissions and absence of anon EXECUTE checked. Canonical repo ledger reconciliation is in draft **#581**, not yet merged. No new schema applied in this audit.
- Last 12 released migrations from Oct 20–21 exist in the production ledger and their main objects were checked in the preceding audit. **Full byte-for-byte source comparison of all 336 historical migrations has not been completed.**

## Forward SQL under `supabase/pending/` (25 at pinned main)

| Candidate | Classification | Action / gate |
|---|---|---|
| `20261011190000_decision_intelligence_evidence_v1` | **Superseded** | Do not apply. Intel canon is already applied; document retirement. |
| `20261013180000_qt6kv_creator_isrc_ledger` | **Staged only** | Reconcile historical allocations, uniqueness, rights and auth; no automatic apply. |
| `20261013180100_music_cohort_isrc_grants` | **Staged only** | Depends on ISRC rights/eligibility review. |
| `20261014170000_action_mission_curated_catalog_resources` | **Data mutation / review** | Compare live mission rows and active assignments; preserve identifiers. |
| `20261015230000_action_mission_pins_arcs_black_business` | **Staged / owner approval** | Reconcile region pin data, partner review, policy arc and provenance. |
| `20261015230000_identity_verification_levels_v1` | **Staged / high sensitivity** | Requires fellowship ladder, identity/consent review, private video storage and ID provider. |
| `20261016010000_profile_edit_gate_v1` | **Staged / high sensitivity** | Requires ladder and identity levels; avoid locking members without a working review process. |
| `20261019222500_world_place_scope_v1` | **Staged / feature off** | Country-feed privacy, access and E2E; then approved flag. |
| `20261019235000_network_sfu_audio_rooms` | **Staged / feature off** | SFU credentials, concurrency, privacy reacknowledgement and RLS tests. |
| `20261020150000_network_web_push` | **Staged / consent** | Subscription lifecycle, opt-in, VAPID and delivery security tests. |
| `20261020170000_news_region_leads` | **Staged / delegated authority** | Country-scoped authorization and publishing review. |
| `action_bounty_claim_existing_row_guard_v1` | **Potential correctness fix** | Run bounty regression and concurrent claim tests before promotion. |
| `action_globe_demo_pins_v1` | **Live data overlap** | Production already has 3 regions and 27 published mission-pin rows. Do not replay; reconcile provenance and retired seed. |
| `commerce_stripe_reconciler_v3` | **Potential financial correctness fix** | v1/v2 applied; v3 not. Test refund races, partial refunds, operator entries, rollback and payment reconciliation before promotion. |
| `equity_uprise_clipping_sources` | **Staged** | Reconcile creator campaign source schema, budget/rights and anti-fraud tests. |
| `gated_track_mission_identity_v1` | **Staged / dependent** | Requires admin mission approval and identity verification. |
| `listener_state_v1` | **Confirmed missing runtime relation** | `js/pip.js` expects `public.listener_state`; absent in production. Test role-isolated RLS, signed-in GET/upsert, cross-device resume and deletion, then promote. |
| `live_missions_v1` | **Staged / high impact** | Media/consent/retention, live-run validation and admin approval; no automatic apply. |
| `mission_admin_approval_v1` | **Staged / foundational** | Depends on fellowship ladder; verify admin/non-self-review, proof and bounty lifecycle. |
| `music_creator_one_click_v1` | **Already applied, awaiting source reconciliation** | Production version `20261021050105`; #581 promotes exact SQL and updates ledger. Do not replay. |
| `policy_fellowship_ladder_v1` | **Staged / dependency root** | Owner/counsel approval, admin-reviewed missions and cohort rules; precedes identity/mission approval. |
| `public_music_reads_lean_v1` | **Potential performance fix** | Benchmark event-read parity, grants, view security and explain plans before promotion. |
| `whip_booking_authority_v1` | **Staged / separate company** | Review commercial authority, permissions and rollback; do not activate ride dispatch. |
| `world_news_discussions_v1` | **Overlaps deployed schema** | `media_news_comments` already exists from `royce_platform_actor`; compare function/policy definitions before retiring or replacing. Do not replay old SQL. |
| `world_publisher_verified_geo_v1` | **Staged / editorial provenance** | Confirm source identity, verified geography semantics and safe existing-data backfill. |

**Counts:** 25 forward candidates = 1 superseded + 1 applied/reconciling + 2 live overlaps + 21 remaining candidates. The 9 rollback files are not forward migrations.

## Confirmed production object checks
- Present: `media_news_comments`, `ops_platform_actors`, `ops_actor_publications`, `ops_live_actor_turns`, `private.ops_connected_nodes`, `private.ops_connected_edges`, `public.ops_connected_graph_service`, `public.ops_ai_context_search`, knowledge read/consolidate RPCs and the three creator-onboarding RPCs.
- Absent: `listener_state`, `network_audio_rooms`, `network_audio_members`, `network_audio_subscriptions`, `network_push_subscriptions`, `news_region_leads`, `action_live_sessions`, `action_mission_live_policies`, `action_unlock_rules`, `action_member_verifications`, `identity_submissions`, `profile_protected_fields`, `music_isrc_creator_registry`, `music_cohort_isrc_grants`, `whip_driver_clearances`.
- Live seed: `action_globe_regions` has 3 rows; 27 published `action_globe_mission_regions`; `media_news_comments` has 4 rows. Counts do not establish that the pending seed's exact statements were applied.
- Production ledger has v1/v2 commerce reconciler and ISRC registry but no named v3, cohort ISRC, listener state, audio rooms or news region leads migration.

## Recommended controlled sequence
1. Merge **#581** after exact-head CI and required review; reconcile applied creator SQL without replay.
2. Isolate `listener_state_v1` in a fresh reviewable PR. Test a real authenticated read/upsert and RLS; verify no auth bypass. Do not apply until reviewed.
3. Prioritize **commerce v3** and **bounty-claim guard** for financial correctness, with real concurrent DB regression and settlement proof.
4. Compare pending `world_news_discussions_v1` with current Royce schema/function signatures; retire redundant SQL or write a narrowly scoped correction.
5. Establish pin-seed provenance. Preserve existing live rows; do not duplicate or overwrite.
6. Prepare a dependency graph for ladder → mission approval → identity → profile edit/gated track; keep private ID/recording flows disabled until approvals and policy are ready.
7. Independently gate country feed, SFU rooms, web push, regional leaders, creator clipping, ISRC, Whip, publisher geography and media/analytics performance SQL.
8. Expand audit to **all 336** historical applied SQL statements and old PR branches: compare hashes, aliases, permissions, object existence, data backfills, Edge Function versions, Worker flags and real end-to-end behavior. No claim of full historical equivalence until this is done.

## Controls
- A migration ledger entry proves application, **not** operational feature health.
- A GitHub merge does not apply `supabase/pending/` files.
- No schema changes, production data writes, role grants, feature flags or releases are authorized by this document.
- Historical PRs and branches may contain superseded, conflicting or duplicate SQL. Compare exact source and live object semantics; never bulk-apply by filename or timestamp.
