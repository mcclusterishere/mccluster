# Human Uprise World — production migration reconciliation (2026-10-14)

**Database:** Supabase project `zmnhbrjyhxzhkxmhkexs` (production). **Branch:** `feat/human-uprise-world-feed`, draft PR #432.

## Verified production baseline

- Production ledger initially had 302 migrations. `action_globe_join_authorization` was missing and its canonical `join_action_mission(uuid)` did not check regional eligibility or rejoin capacity.
- Applied `action_globe_join_authorization` through the Supabase migration connector, which assigned **version `20261014184518`**. The ledger then had 303 entries. The subsequent draft Anti-Social schema migration brought it to **304**.
- Read-only post-apply verification found the regional eligibility call and the withdrawn-rejoin capacity check in the production function. No change to the observed 5 assignments, 26 open missions, or 3 open bounties.
- The branch's 13 expected globe/media function bodies matched production (normalized for whitespace). The 34 expected tables/views were present; all corresponding tables had RLS enabled. This is a scoped source-to-live check, **not** a complete production schema diff or a successful authenticated end-to-end browser run.
- The original branch used 14 different timestamps for SQL already present on production. The PR's migration files were **renamed to the exact production ledger versions**, without replaying the already-applied DDL.

## Migration versions on the integration branch

| Production ledger version | Migration | Status |
| --- | --- | --- |
| 20261006232625 | music_direct_track_sales_v1 | Already applied |
| 20261014013557 | action_globe_regions | Already applied |
| 20261014013601 | action_globe_song_portfolios | Already applied |
| 20261014013627 | action_globe_public_projection_retired | Already applied; no-op |
| 20261014014033 | action_globe_adm1_boundaries | Already applied |
| 20261014014547 | action_globe_region_activation | Already applied |
| 20261014014747 | action_globe_presence | Already applied |
| 20261014020454 | action_policy_memo_bounties | Already applied |
| 20261014021057 | civic_global_discovery | Already applied |
| 20261014021258 | candidate_labs_media_graph | Already applied |
| 20261014023302 | media_geo_ingestion | Already applied |
| 20261014023317 | media_ingest_rpc | Already applied |
| 20261014023548 | media_news_namespace | Already applied |
| 20261014023813 | gdelt_backoff_cache | Already applied |
| 20261014184518 | action_globe_join_authorization | Applied and verified in production |
| 20261014185154 | antisocial_get_social_three_levels_draft | Applied; mission remains draft |

## Not yet deployed

The remaining files are intentionally **outside** `supabase/migrations`, so CI/production migration runners do not execute them without explicit promotion:

- `supabase/pending/20261014170000_action_mission_curated_catalog_resources.sql` — changes existing mission statuses and pauses two bounties. Requires a reviewed catalog and financial-state preview; **not** applied.
- `supabase/pending/20261014170100_equity_policy_memo_application_path.sql` — changes fellowship eligibility; **not** applied.
The Anti-Social schema migration (`20261014185154`) **was applied**, but its mission is seeded as **draft**, with no public join or proof UI until the deployment is verified.

Do not merge PR #431 separately from PR #432. The branch includes its work. Before promoting pending migrations, run a staging migration test, verify live contract compatibility and review the mission/bounty effects. Production Pages and Worker still deploy from `main`; merging PR #432 must be gated on all required CI and real API smoke tests. The `humanuprise.com` Cloudflare route and Supabase authentication redirect settings require owner-controlled configuration.

## Release checks

1. Confirm GitHub checks on the **latest** PR #432 SHA (earlier green runs do not count).
2. Confirm migration names and versions above exactly match production; no duplicate pending migrations on production.
3. Test signed-out globe read-only endpoints and signed-in join/withdraw/rejoin against actual backend, including regional and capacity denials.
4. Test Anti-Social levels 1→2→3, upload authorization, owner review, reciprocal consent and profile credits on staging.
5. Reconcile the pending mission catalog against all active assignments and funded bounties, then apply reviewed data changes only.
6. Deploy through reviewed `main` and verify both public properties and the Cloudflare host route.
