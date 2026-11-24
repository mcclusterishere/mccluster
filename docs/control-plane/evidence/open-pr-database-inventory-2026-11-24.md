# Open-PR database inventory — 2026-11-24

Equity Uprise shared-platform support-only evidence. This records repository and database metadata; it adds no product capability, changes no runtime policy, and approves no migration.

## Result and coverage

**All 120 open PRs at the 18:30:47 UTC capture were inventoried.** The API returned 100, 20, then 0 records. All 120 complete changed-file lists were retrieved; all 253 SQL changes agree exactly with pinned Git diffs. There were no retrieval errors or file-list discrepancies. The initial 18:09:58 capture had 119 PRs; the final pass included the new #839 and refreshed changed heads.

The comparison baseline is main `7f2644b417994d1b994d763485b6448906bdfdb0`. The JSON companion contains every PR number, full pinned head/base, all 3,183 changed filenames, the database-related subset, and all SQL status/path/blob/hash records. The largest PR has 325 files; filename pagination was used throughout. SQL changes comprise 214 additions, 30 modifications and 9 renames, across 171 distinct paths and 185 path/content variants (175 distinct content blobs).

There are 62 distinct branch-only forward paths in the current and historical pending folders, represented by 69 path/content variants and 65 content blobs. **These are not 62 ready migrations.** They include one exact applied copy, separately reviewed current preparation lanes, conflicting variants, and older unmerged proposals. The original 51-forward-file audit was strictly main’s `supabase/pending` inventory; it did not cover every open PR.

## Production correspondence

Main records 384 migrations. The read-only production ledger still records 389, latest `20261124164904_action_bounty_claim_existing_row_guard_v1`. The five new canonical records carried by #836 (also inherited by #839) match the live stored SQL bytes exactly. Recording them in Git must not replay them in production.

Across the snapshot, 22 distinct SQL path/content variants exactly match recorded live SQL; two further variants exactly match main SQL at another path. The table below lists exact live-byte matches. Name resemblance is deliberately insufficient: the old `city_arcade_v1` proposal has live declared objects but different bytes, and the historical `music_workspace` proposal has a similarly named live migration while its seven declared names remain absent.

| PRs | SQL path | Exact live version |
|---|---|---|
| [#376](https://github.com/mcclusterishere/mccluster/pull/376), [#384](https://github.com/mcclusterishere/mccluster/pull/384) | `supabase/migrations/20261006021431_commerce_stripe_reconciler_v1.sql` | `20261006021431` |
| [#376](https://github.com/mcclusterishere/mccluster/pull/376), [#384](https://github.com/mcclusterishere/mccluster/pull/384) | `supabase/migrations/20261006022702_leads_status_vocabulary_reconcile_v1.sql` | `20261006022702` |
| [#376](https://github.com/mcclusterishere/mccluster/pull/376), [#384](https://github.com/mcclusterishere/mccluster/pull/384) | `supabase/migrations/20261006023453_commerce_stripe_reconciler_v2.sql` | `20261006023453` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261013233000_action_globe_regions.sql` | `20261014013557` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261013234500_action_globe_song_portfolios.sql` | `20261014013601` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261014030000_action_globe_adm1_boundaries.sql` | `20261014014033` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261014033000_action_globe_presence.sql` | `20261014014747` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261014050000_action_policy_memo_bounties.sql` | `20261014020454` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261014060000_civic_global_discovery.sql` | `20261014021057` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261014070000_candidate_labs_media_graph.sql` | `20261014021258` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261014080000_media_geo_ingestion.sql` | `20261014023302` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261014081000_media_ingest_rpc.sql` | `20261014023317` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261014081500_media_news_namespace.sql` | `20261014023548` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261014083000_gdelt_backoff_cache.sql` | `20261014023813` |
| [#427](https://github.com/mcclusterishere/mccluster/pull/427) | `supabase/migrations/20261014120000_action_globe_join_authorization.sql` | `20261014184518` |
| [#428](https://github.com/mcclusterishere/mccluster/pull/428) | `supabase/migrations/20261014130000_action_bounty_claim_existing_row_guard.sql` | `20261124164904` |
| [#431](https://github.com/mcclusterishere/mccluster/pull/431) | `supabase/pending/20261014170100_equity_policy_memo_application_path.sql` | `20261014185932` |
| [#836](https://github.com/mcclusterishere/mccluster/pull/836), [#839](https://github.com/mcclusterishere/mccluster/pull/839) | `supabase/migrations/20261124164026_member_fronts_shared_revision_directory.sql` | `20261124164026` |
| [#836](https://github.com/mcclusterishere/mccluster/pull/836), [#839](https://github.com/mcclusterishere/mccluster/pull/839) | `supabase/migrations/20261124164529_ai_context_workstreams_v1.sql` | `20261124164529` |
| [#836](https://github.com/mcclusterishere/mccluster/pull/836), [#839](https://github.com/mcclusterishere/mccluster/pull/839) | `supabase/migrations/20261124164724_commerce_stripe_reconciler_v3.sql` | `20261124164724` |
| [#836](https://github.com/mcclusterishere/mccluster/pull/836), [#839](https://github.com/mcclusterishere/mccluster/pull/839) | `supabase/migrations/20261124164851_equity_uprise_clipping_sources.sql` | `20261124164851` |
| [#836](https://github.com/mcclusterishere/mccluster/pull/836), [#839](https://github.com/mcclusterishere/mccluster/pull/839) | `supabase/migrations/20261124164904_action_bounty_claim_existing_row_guard_v1.sql` | `20261124164904` |

The two additional exact main copies are #427’s retired public-projection placeholder and region-activation SQL under their actual canonical filenames. Historical bytes and stale function variants must not overwrite newer live definitions. Full hashes and counterpart paths are in the JSON.

## Current review priorities

| Lane | Pinned head | Database finding and disposition |
|---|---|---|
| [#836](https://github.com/mcclusterishere/mccluster/pull/836) | `1cfb1a3613f24a877b7255f457844a0daa3fb6d1` | Five actual ledger records; record-only reconciliation. |
| [#821](https://github.com/mcclusterishere/mccluster/pull/821) | `ce65f0bc39a787837657835464ef1af3dc359d6b` | Owner enrollment/workspace SQL: separately prepared lane, explicit per-file approval still governs. |
| [#823](https://github.com/mcclusterishere/mccluster/pull/823) | `0571242dfcc760d48df792053e0fb26bc1005dd2` | Music/compute SQL: separately prepared lane; keep its native proof and current CI receipts together. |
| [#839](https://github.com/mcclusterishere/mccluster/pull/839) | `2d159551cba83b471089f8f93d59cce1167412f5` | Nine selected main repairs plus guarded recovery/native proof: separate preparation lane. |
| [#822](https://github.com/mcclusterishere/mccluster/pull/822) | `f0c90541b2de4b1ab41f350a88638813ab943b16` | Optional World display preference. Three declared names absent; new callers are unmerged. SQL/auth/cache/recovery review required. |
| [#831](https://github.com/mcclusterishere/mccluster/pull/831) | `b9c2ed1d86de175b5a5d1f8ce1a442ec6d45312d` | Independent contribution-accounting proposal. 24 declared names absent; not a checkpoint-store prerequisite. |
| [#833](https://github.com/mcclusterishere/mccluster/pull/833) | `765f3b0981ab236f690999e5660a234e8754e761` | Optional Halo registration. Expands two CHECK constraints and three existing policy RPC bodies; creates no policy row. No Halo route reads the policy yet. SQL was only text-tested at this head; native drift/concurrency/recovery proof required. |
| [#834](https://github.com/mcclusterishere/mccluster/pull/834) | `f3407f8d9e6c8db25fc75470368495a7e51ef9f1` | A distinct attestation/device_facts variant. It still omits service_role from REVOKE, retaining inherited mutation privileges; reconcile with the corrected #823 contract before review. Do not apply both variants. |

For #833, `docs/control-plane/HALO-MODULE.md` and `workers/mccluster/src/eup/modules.js` explicitly support the unregistered state and separate owner access from policy registration. Its [forward SQL](https://github.com/mcclusterishere/mccluster/blob/765f3b0981ab236f690999e5660a234e8754e761/supabase/pending/eup_module_policy_halo_v1.sql) lacks exact current-definition preflight; its [recovery SQL](https://github.com/mcclusterishere/mccluster/blob/765f3b0981ab236f690999e5660a234e8754e761/supabase/pending/eup_module_policy_halo_v1.rollback.sql) checks for Halo policy/history before ALTER locking. Those are unproved concurrency/drift boundaries, not evidence that existing owner access needs immediate SQL. For #834, the grant issue is concrete: its [forward file](https://github.com/mcclusterishere/mccluster/blob/f3407f8d9e6c8db25fc75470368495a7e51ef9f1/supabase/pending/compute_job_attestations_v1.sql) revokes PUBLIC/anon/authenticated, then grants service_role SELECT/INSERT without first clearing inherited service_role UPDATE/DELETE/TRUNCATE.

Older direct-under-migrations proposals in #385/#428 and the legacy pending locations in #411/#414 are included. They require canonical reconciliation if revisited. Nothing in this inventory authorizes reviving old CRM, commerce, research or publication workflows. No proposal is declared abandoned merely because it is old.

## Complete branch-only pending forward path index

“Staged/unreviewed” means the unmerged file needs its own review, dependency/preflight proof and explicit approval. “Current lane” links to the separate preparation work and is not a production approval. Multiple variants at one path remain separately hashed in the JSON. The two historical pending directory layouts are included.

| Forward SQL path absent main | PRs | Disposition |
|---|---|---|
| `supabase/migrations/pending/20261010009100_creator_publish_cohort_entitlement.sql` | [#625](https://github.com/mcclusterishere/mccluster/pull/625) | Legacy-location variant of current main candidate; do not substitute |
| `supabase/migrations/pending/20261012023000_research_intelligence_plane_v1.sql` | [#414](https://github.com/mcclusterishere/mccluster/pull/414) | Staged/unreviewed; no production requirement established |
| `supabase/migrations/pending/20261026009200_creator_checkout_reservations.sql` | [#625](https://github.com/mcclusterishere/mccluster/pull/625) | Staged/unreviewed; no production requirement established |
| `supabase/migrations/pending/20261026009300_creator_store.sql` | [#625](https://github.com/mcclusterishere/mccluster/pull/625), [#633](https://github.com/mcclusterishere/mccluster/pull/633) | Staged/unreviewed; no production requirement established; 2 content variants |
| `supabase/migrations/pending/20261026009400_music_workspace.sql` | [#629](https://github.com/mcclusterishere/mccluster/pull/629) | Staged/unreviewed; no production requirement established |
| `supabase/migrations/pending/20261026009500_creator_store_commerce_adapter.sql` | [#633](https://github.com/mcclusterishere/mccluster/pull/633) | Staged/unreviewed; no production requirement established |
| `supabase/pending/20260928001500_refresh_fal_video_quality_routes.sql` | [#269](https://github.com/mcclusterishere/mccluster/pull/269) | Staged/unreviewed; no production requirement established |
| `supabase/pending/20261013210000_action_three_paths.sql` | [#426](https://github.com/mcclusterishere/mccluster/pull/426) | Staged/unreviewed; no production requirement established |
| `supabase/pending/20261014170100_equity_policy_memo_application_path.sql` | [#431](https://github.com/mcclusterishere/mccluster/pull/431) | Exact applied copy; do not replay |
| `supabase/pending/20261016_resident_learning_v1.sql` | [#476](https://github.com/mcclusterishere/mccluster/pull/476) | Staged/unreviewed; no production requirement established |
| `supabase/pending/20261019210000_house_agent_accounts_v1.sql` | [#548](https://github.com/mcclusterishere/mccluster/pull/548) | Staged/unreviewed; no production requirement established |
| `supabase/pending/20261019211500_character_studio_v1.sql` | [#550](https://github.com/mcclusterishere/mccluster/pull/550) | Staged/unreviewed; no production requirement established |
| `supabase/pending/20261019213000_hitman_us_50_state_chapters_v1.sql` | [#551](https://github.com/mcclusterishere/mccluster/pull/551) | Staged/unreviewed; no production requirement established |
| `supabase/pending/20261026009200_creator_checkout_reservations.sql` | [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established; 2 content variants |
| `supabase/pending/20261026009300_creator_store.sql` | [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/20261026009400_music_workspace.sql` | [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/20261026009500_creator_store_commerce_adapter.sql` | [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/20261123013000_eup_world_display_v1.sql` | [#822](https://github.com/mcclusterishere/mccluster/pull/822) | Optional new feature; unproved SQL/caller lane |
| `supabase/pending/20261123180000_tinderfessions_catalog_objects.sql` | [#823](https://github.com/mcclusterishere/mccluster/pull/823) | Current preparation lane; separate approval/proof gates |
| `supabase/pending/20261123190000_in_hot_pursuit_catalog_objects.sql` | [#823](https://github.com/mcclusterishere/mccluster/pull/823) | Current preparation lane; separate approval/proof gates |
| `supabase/pending/20261123200000_music_creator_distribution_v1.sql` | [#823](https://github.com/mcclusterishere/mccluster/pull/823) | Current preparation lane; separate approval/proof gates |
| `supabase/pending/analytics_session_evidence_v6.sql` | [#642](https://github.com/mcclusterishere/mccluster/pull/642) | Staged/unreviewed; no production requirement established |
| `supabase/pending/analytics_tenant_history_restrict_v1.sql` | [#640](https://github.com/mcclusterishere/mccluster/pull/640), [#642](https://github.com/mcclusterishere/mccluster/pull/642) | Staged/unreviewed; no production requirement established |
| `supabase/pending/analytics_visitor_event_identity_v6.sql` | [#640](https://github.com/mcclusterishere/mccluster/pull/640), [#642](https://github.com/mcclusterishere/mccluster/pull/642) | Staged/unreviewed; no production requirement established; 2 content variants |
| `supabase/pending/canonical_artist_bindings_v1.sql` | [#641](https://github.com/mcclusterishere/mccluster/pull/641), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/city_arcade_v1.sql` | [#776](https://github.com/mcclusterishere/mccluster/pull/776) | Live names exist, bytes differ; reconcile historical source |
| `supabase/pending/compute_contribution_ledger_v1.sql` | [#831](https://github.com/mcclusterishere/mccluster/pull/831) | Staged new accounting feature; independent review |
| `supabase/pending/compute_job_attestations_v1.sql` | [#823](https://github.com/mcclusterishere/mccluster/pull/823), [#834](https://github.com/mcclusterishere/mccluster/pull/834) | Current #823 lane plus conflicting #834 variant; reconcile first; 2 content variants |
| `supabase/pending/compute_owner_enrollment_v1.sql` | [#821](https://github.com/mcclusterishere/mccluster/pull/821) | Current preparation lane; separate approval/proof gates |
| `supabase/pending/compute_owner_workspace_v1.sql` | [#821](https://github.com/mcclusterishere/mccluster/pull/821) | Current preparation lane; separate approval/proof gates |
| `supabase/pending/compute_scheduler_lease_v1.sql` | [#823](https://github.com/mcclusterishere/mccluster/pull/823) | Current preparation lane; separate approval/proof gates |
| `supabase/pending/creator_cf_registration_attempts_v1.sql` | [#637](https://github.com/mcclusterishere/mccluster/pull/637), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/creator_domain_orders_v1.sql` | [#626](https://github.com/mcclusterishere/mccluster/pull/626), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/creator_domain_provider_bindings_v1.sql` | [#641](https://github.com/mcclusterishere/mccluster/pull/641), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/creator_domain_targets_v1.sql` | [#636](https://github.com/mcclusterishere/mccluster/pull/636), [#641](https://github.com/mcclusterishere/mccluster/pull/641), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established; 2 content variants |
| `supabase/pending/creator_domains_v1.sql` | [#626](https://github.com/mcclusterishere/mccluster/pull/626), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/creator_inline_domain_contacts_v1.sql` | [#637](https://github.com/mcclusterishere/mccluster/pull/637), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/customer_site_addresses_v1.sql` | [#638](https://github.com/mcclusterishere/mccluster/pull/638), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/customer_site_modules_v1.sql` | [#638](https://github.com/mcclusterishere/mccluster/pull/638), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/customer_site_storage_v1.sql` | [#638](https://github.com/mcclusterishere/mccluster/pull/638), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/customer_social_selfservice.sql` | [#624](https://github.com/mcclusterishere/mccluster/pull/624), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/eup_module_policy_halo_v1.sql` | [#833](https://github.com/mcclusterishere/mccluster/pull/833) | Optional registration; text checks only at pinned head |
| `supabase/pending/learning_portfolio_v1.sql` | [#765](https://github.com/mcclusterishere/mccluster/pull/765), [#776](https://github.com/mcclusterishere/mccluster/pull/776) | Staged/unreviewed; no production requirement established; 2 content variants |
| `supabase/pending/managed_project_identity_v1.sql` | [#641](https://github.com/mcclusterishere/mccluster/pull/641), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/managed_projects_v1.sql` | [#623](https://github.com/mcclusterishere/mccluster/pull/623), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/member_fronts_publication_visibility_guard_v1.sql` | [#839](https://github.com/mcclusterishere/mccluster/pull/839) | Current preparation lane; separate approval/proof gates |
| `supabase/pending/merch_marketplace_v1.sql` | [#679](https://github.com/mcclusterishere/mccluster/pull/679) | Staged/unreviewed; no production requirement established |
| `supabase/pending/music_research_pipeline_reconciled.sql` | [#635](https://github.com/mcclusterishere/mccluster/pull/635), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/music_research_pipeline_v1.sql` | [#543](https://github.com/mcclusterishere/mccluster/pull/543) | Staged/unreviewed; no production requirement established |
| `supabase/pending/music_workspace_release_handoff.sql` | [#635](https://github.com/mcclusterishere/mccluster/pull/635), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/music_workspace_research_bridge.sql` | [#635](https://github.com/mcclusterishere/mccluster/pull/635), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/music_workspace_research_state.sql` | [#635](https://github.com/mcclusterishere/mccluster/pull/635), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/owner_analytics_layout_v1.sql` | [#788](https://github.com/mcclusterishere/mccluster/pull/788) | Staged/unreviewed; no production requirement established |
| `supabase/pending/owner_front_publication_v1.sql` | [#741](https://github.com/mcclusterishere/mccluster/pull/741), [#776](https://github.com/mcclusterishere/mccluster/pull/776) | Staged/unreviewed; no production requirement established |
| `supabase/pending/owner_widget_definitions_v1.sql` | [#776](https://github.com/mcclusterishere/mccluster/pull/776), [#780](https://github.com/mcclusterishere/mccluster/pull/780) | Staged/unreviewed; no production requirement established |
| `supabase/pending/project_tiles_free_v1.sql` | [#638](https://github.com/mcclusterishere/mccluster/pull/638), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/project_tiles_v1.sql` | [#636](https://github.com/mcclusterishere/mccluster/pull/636), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/website_studio_v2.sql` | [#493](https://github.com/mcclusterishere/mccluster/pull/493), [#636](https://github.com/mcclusterishere/mccluster/pull/636), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established; 2 content variants |
| `supabase/pending/whip_driver_application_consent_v1.sql` | [#453](https://github.com/mcclusterishere/mccluster/pull/453) | Staged/unreviewed; no production requirement established |
| `supabase/pending/world_directory_v1.sql` | [#628](https://github.com/mcclusterishere/mccluster/pull/628), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending/world_social_delivery.sql` | [#634](https://github.com/mcclusterishere/mccluster/pull/634), [#681](https://github.com/mcclusterishere/mccluster/pull/681), [#782](https://github.com/mcclusterishere/mccluster/pull/782) | Staged/unreviewed; no production requirement established |
| `supabase/pending_migrations/20261011093000_l3_refund_reservations.sql` | [#411](https://github.com/mcclusterishere/mccluster/pull/411) | Staged/unreviewed; no production requirement established |

## Caller and live-object checks — precise limits

At 18:26:56 UTC a read-only `pg_class`/`pg_proc` query checked 405 qualified names extracted from CREATE statements across the changed SQL; 161 names exist and 244 do not. This includes fixture declarations, so those totals are coverage measures, not a count of missing production dependencies. Each candidate’s declaration results are recorded separately.

None of the absent CREATE names from the branch-only pending candidates had a same-line call with a quoted name in current main runtime source under `core/`, `workers/`, `supabase/functions/` or `js/`. This is a bounded source check: it does not identify multiline or dynamically assembled calls, establish which commit is deployed, prove every ALTER-column or seed dependency, or prove that all existing function overloads/bodies match. It therefore supports routing these candidates to their feature reviews; it is not a blanket database all-clear.

The 62-path index excludes rollback artifacts, tests/fixtures, design SQL and diagnostics from forward candidates while retaining them in the complete SQL inventory. A filename containing “recovery” is not automatically a rollback: the Action transfer-failure recovery migration remains a forward proposal in the JSON.

## Reproduction and handoff

Enumerate open PRs with `state=open`, `sort=created`, `direction=asc`, `per_page=100` until an empty page; use the connector’s all-pages changed-filename operation. Pin base/head commits, compute their merge base, and compare `git diff --name-status --find-renames <merge-base> <head> -- '*.sql'` against the file lists. Read each SQL blob by object id, compare main tree identities, and compare complete-file MD5 with the actual ledger statement array joined by newline. Never execute historical branch SQL to classify it.

The final open-list/head capture is 18:30:47 UTC. Later active-lane commits, including CI-only corrections and the commit carrying this inventory itself, are outside that immutable snapshot and require a normal release-head recheck. All 120 pinned PRs remain listed even when they contain no SQL. The inventory performed no production writes and modified no external PR.

The existing Release2 evidence separately covers #837’s assembly (no new SQL/Core dependency; album containment preserved) and #838’s Creator Studio change (browser-local IndexedDB v2 upgrade, no Supabase SQL/new backend caller). Its 15 inherited absent/gated names remain explicit debt; this inventory does not erase them.

Machine-readable companion: [open-pr-database-inventory-2026-11-24.json](open-pr-database-inventory-2026-11-24.json). Source references are the pinned PR heads and paths in that file; production metadata has only schema identifiers and hashes, with no business/private row contents.
