# Migration audit and release receipt, 9 November 2026

## Production result

Canonical Supabase project: `zmnhbrjyhxzhkxmhkexs`, PostgreSQL 17.6.

| Version | Migration | Verified outcome |
| --- | --- | --- |
| 20261109175747 | music_direct_asset_versions_v1 | Applied by commerce release; corrected SQL, Edge music-direct-access v42. Do not replace with Claude's original pending SQL. |
| 20261109180829 | core_signed_nonces_v1 | Applied by C5 release; private nonce store, zero persistent test rows. Worker replay mode was not changed. |
| 20261109181623 | city_arcade_v1 | Applied here. Three empty private tables and two service-only invoker functions. Stored SQL matches exact reviewed branch bytes. Feature remains disabled. |

No World Environment or Environment Proofs migration was applied. No unrelated historical pending migration was applied. No Git branch, main, Worker, Pages, Core, account security setting, payment setting, public mission or external message was changed here.

## City Arcade verification

Source: `mcclusterishere/mccluster`, branch `claude/new-session-83ken5`, commit `15523e187d1800dcbe7cd2c19f4ddfe6f203f556`, `supabase/pending/city_arcade_v1.sql`.

- Source SHA-256: `b03081d4be03ed85673b1f5f401ba8de5cef8c88dc59e241436734e8f323aba0`.
- Stored SQL MD5: `e8262cfde4dd80941befd9a9ba854b97`; full stored statement equality was checked, not just this digest.
- Fresh preflight found no Arcade table or function, exactly one canonical mccluster organization, and existing service-role SELECT permissions on orgs/org_members.
- RLS enabled on arcade_missions, arcade_mission_versions and arcade_runs. anon/authenticated have no table or RPC access. service_role can SELECT/INSERT/UPDATE missions/runs and only SELECT/INSERT versions. No role receives DELETE. RPC rechecks current house ownership on every command.
- Exact branch SQL passed native PostgreSQL 17.7 rehearsals: 31 database/API assertions, 17 uncertain-start/recovery assertions. Eight native concurrent sessions proved one first-create winner, seven revision conflicts, one run for repeated start key, stable repeated completion, frozen old mission versions and denial after owner revocation.
- Production transaction smoke exercised save, same-key start retry, finish/retry, null-owner refusal and anon/authenticated denials. It rolled back. All three production tables remain at zero rows.
- Afterward health advisories remained clear. Security advisory changes were exactly three INFO entries for RLS tables without client policies, as expected for service-only tables. Existing warnings were unchanged.
- Fresh Cloudflare read at 2026-11-09T18:15:47.550Z confirmed ARCADE_CLOUD_ENABLED is absent. It was not added or changed. This is a database prerequisite receipt, not an activated feature or a production browser acceptance receipt.

The live Worker must be upgraded to the reviewed startKey-aware handler before any future Arcade enablement. Old handlers omit startKey and cannot start runs against this schema. Do not enable the cloud flag just because the database is ready. Complete the owner-session capability/save/load/start/finish/history/reload and denial checks in docs/city-arcade/ACTIVATION-HANDOFF.md first.

## Environment disposition and admin-only scope

The two environment SQL files passed independent native rehearsals, including environment team/proposal/review/join checks, proof privacy/consent/retry/review/publication checks and 11 concurrent behavior checks. Sixty-five focused Worker tests also passed. These do not override the latest product scope.

The latest requested E=Up experience is admin-only. Applying the original environment SQL now would add an open Environmental Justice Team, permit any authenticated member to join/propose, and support later public mission/proof publication. Fresh production policies confirm network_groups are visible to all authenticated accounts, and open/paused/closed action_missions are visible to anon/authenticated. Hiding a tab is not an authorization boundary.

Therefore retain, but do not promote:
1. `20261107120000_world_environment_v1.sql`.
2. `20261108120000_world_environment_proofs_v1.sql`, which depends on the first file and the canonical proof/share functions.

Compatible admin-only path: use the existing owner-gated environment-planning adapter and canonical ops_recommendations, media_news_articles and out_companies for private evidence review and planning. Their required columns and service-role read/write permissions already exist. That planning layer needs no new migration. Keep consumer team/join/proof activation separate and disabled until a deliberately approved consumer release. Do not ingest admin-only previews into public civic or mission projections. This leaves the intended consumer globe work intact rather than canceling it.

## Pending inventory and dependencies

The exact branch pending directory contains 47 forward SQL candidates and 23 recovery-only SQL files. All 73 directory entries, including three documentation/JSON files, were fetched or checked against their Git blob IDs. `pending-static-inventory.json` lists each SQL file, SHA-256, created/altered tables, functions, reference dependencies and grant/drop indicators.

Release-specific classification:
- Three forward files correspond to the three applied migrations above. Original commerce pending SQL is superseded by the fixed production source, not approved for replay.
- Two environment forward files are held for scope reasons, not SQL syntax failure.
- Forty-two older forward candidates remain independently staged. They were inventoried, not certified safe for bulk application. Existing promotion order, explicit feature decisions and their focused behavior suites still apply. Do not run all of supabase/pending.
- Twenty-three rollback files are recovery artifacts, never forward migrations.
- Environment mission planning has no additional SQL prerequisite.
- `20261014021057_civic_global_discovery` is already in the production ledger. Do not reapply it as a new admin workspace dependency.

## Consolidated ledger and local bookkeeping

Fresh live ledger: 362 entries, latest `20261109181623_city_arcade_v1`.

Ledger SHA-256: `713f3c2db09f87e41f8b35621c7143484e1f79420b1142d72ee5d9bdee887594`.

`release-copy/` contains the three exact applied SQL files, refreshed `supabase/production-ledger.json`, and matching `core/drift-contract.json`. The repository drift contract check passes with all 362 local applied SQL files. These files are local handoff artifacts; no remote repository was changed.

Claude must import the exact applied sources under their actual returned versions, supersede the original pending entries, update test/workflow references, refresh production schema evidence, regenerate schema-manifest through the supported clean-reset workflow, and remove the now-stale pending-only caller exemptions. Full schema-manifest regeneration and aggregate release CI were not performed here. The prior activation handoff's old Arcade SQL hash is stale; replace it with the hash above when reconciling. Re-read the live ledger before committing if another migration has since run.

## Recovery and backup limits

All Arcade changes were additive; no existing business rows were changed. Leave the new schema in place and keep its cloud flag disabled if rollout is postponed or application checks fail. Do not drop tables as a rollback shortcut after data exists.

Targeted schema/privilege snapshots, exact applied SQL and receipts are retained. Commerce additionally retained its prior Edge v41 source bundle. Managed database backup/PITR status and a full database/data snapshot were not verified or created. No Storage bytes were copied. Do not describe this work as a full database backup.

Not tested here: real paid checkout/download, production owner browser Arcade journey, physical devices, full production schema replay, all historical pending features, or a full database restore.
