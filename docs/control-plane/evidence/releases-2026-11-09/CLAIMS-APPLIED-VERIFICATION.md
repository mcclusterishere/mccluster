# `media_operation_claims_v1` in production: independent read-only verification, 2026-11-09

This is **not** the release worker's receipt. That receipt is not in this repository or in either owner packet. It is a read-only verification made from the review session (branch `claude/new-session-83ken5`) at 22:17 UTC on 9 November 2026, after the owner's monitor reported that production held 363 migrations ending in `20261109194957_media_operation_claims_v1`. Nothing was applied, altered or written: every statement was a single `SELECT` through the Supabase `execute_sql` connector, and the catalog reads are the repository's own `scripts/db/schema-queries.mjs`.

## What production holds

- Project `zmnhbrjyhxzhkxmhkexs`. `supabase_migrations.schema_migrations` has **363** rows; the latest is `20261109194957` `media_operation_claims_v1`.
- The ledger digest production computes for itself (SHA-256 over `version:name` lines in version order) is `90b735eb844eaf336df508cd5ecc15b980518c12108ff3f48b9edbf373f552ef`. That is the digest of this repository's 363-entry `supabase/production-ledger.json`, and the value the OVH `host_health` diagnostics report as live. Main's 359-entry ledger hashes to `41b4bd62…`, the value the deployed Core contract still expects.
- The stored statements of the four 9 November versions are one statement each, and equal the repository files byte for byte:

| Version | Name | Bytes | SHA-256 (stored statement = repository file) | md5 |
| --- | --- | --- | --- | --- |
| `20261109175747` | `music_direct_asset_versions_v1` | 29038 | `a76d1335df38e781c90e9fdcb61e4245d2f98830627f26b88d2422f3578abfcc` | `7d0ea76d060b468e36012eb381dd280c` |
| `20261109180829` | `core_signed_nonces_v1` | 1142 | `f07410354ae4cd5d48aea9b95e71b81c6fdc3a4d258c44e4f6dca7520b368503` | `48a73f17c808cde8d71260f7d4a5d4ba` |
| `20261109181623` | `city_arcade_v1` | 13251 | `b03081d4be03ed85673b1f5f401ba8de5cef8c88dc59e241436734e8f323aba0` | `e8262cfde4dd80941befd9a9ba854b97` |
| `20261109194957` | `media_operation_claims_v1` | 5895 | `c1733f48360b901084a9af26d727a7e9e934be54cb7f2a545396bada21d008c1` | `a57f946e979bdf038aef301e1adafc86` |

  The fourth row is the file this branch carried as `supabase/pending/media_operation_claims_v1.sql` (unchanged since commit `e6687cf`, 19:25 UTC, before the 19:49 application). It is imported here as `supabase/migrations/20261109194957_media_operation_claims_v1.sql` with the same bytes.
- The objects the claims migration creates are present with the reviewed posture: table `public.media_operation_claims` (11 columns, row security enabled, no privilege for `PUBLIC`, `anon` or `authenticated`); functions `media_claim_operation_v1`, `media_bind_operation_v1`, `media_fail_operation_v1` (`SECURITY DEFINER`, `search_path=public, pg_temp`, no `EXECUTE` for `PUBLIC`, `anon` or `authenticated`).

## Whole-schema evidence captured in the same read

`docs/control-plane/evidence/production-schema-snapshot-2026-11-09.json` is a full production schema snapshot (363 ledger rows, 564 relations, 519 functions, 462 policies, 153 triggers, 14 buckets, 11 extensions, 4 schemas, 1 cron job). It was captured as a delta against the 3 November snapshot with `scripts/db/snapshot-delta.mjs`: for each section the database returned its own md5 of the full section, the rows touched by the four releases, and the md5 of everything else. Everything else hashed to the 3 November rows in every section, so **production's schema outside the four 9 November releases is unchanged since 3 November**, and each rebuilt section hashes to the database's md5. `node scripts/db/verify-production-schema.mjs --snapshot <file>` rechecks those hashes offline.

Changed since 3 November, all from the four releases: 4 ledger rows; 8 relations added and 3 changed (`music_direct_entitlements`, `music_direct_offers`, `music_direct_orders`); 12 functions added and 3 replaced (`music_direct_claim_download`, `music_direct_entitlement_guard`, `music_direct_order_guard`); 4 triggers added. Policies, buckets, extensions, schemas and cron jobs are identical.

## What this does not establish

- No row was read from any business table and no behaviour was exercised. The release worker's own rehearsal, smoke test and advisor comparison are in its receipt, not here.
- The claims table is the database prerequisite of the paid-operation protocol. The live Worker (version `bbeb8acd…`, main `578e6830`) predates that protocol and does not call it; `CORE_REPLAY_STORE` is not set in the live bindings per the owner's monitor. Nothing in this document is a Worker release.
- Managed backup and point-in-time recovery status were not checked.
