# Twelve production-only migrations (ledger 364 to 376): independent read-only verification, 2026-11-18

This is **not** a release receipt. It is a read-only verification made from the review session on this branch
between 04:17 and 04:29 UTC on 18 November 2026, after the operator's reads at 03:58 UTC reported 376 applied
migrations where this repository recorded 364. Nothing was applied, altered or written: every
statement was a single `SELECT` through the Supabase `execute_sql` connector, over
`supabase_migrations.schema_migrations` (version, name and the stored statements, hashed or measured; never
`created_by`) and the catalog. The catalog reads are the repository's own `scripts/db/schema-queries.mjs`, sent through
`scripts/db/snapshot-delta.mjs`.

## What production holds

- Project `zmnhbrjyhxzhkxmhkexs`. `supabase_migrations.schema_migrations` has **376** rows; the latest is
  `20261118035654` `action_mission_drawdown_import_07`.
- The ledger digest production computes for itself (SHA-256 over `version:name` lines in version order, read at
  04:29 UTC) is `c3657b4bb1ffd0a926d2992ff2fc2930713dac4216a9ebff5c90f6e726d40762`. That is the digest of this
  repository's 376-entry `supabase/production-ledger.json` and of `core/drift-contract.json`. The 364-entry ledger they
  replace hashed to `6fcada89…`.
- Every one of the twelve rows newer than `20261110220135` holds one statement, equal to the repository file byte for
  byte (bytes, SHA-256 and md5 of the stored statement and of the file):

| Version | Name | Bytes | SHA-256 | md5 | Repository file |
| --- | --- | --- | --- | --- | --- |
| `20261114015120` | `equity_uprise_platform_registry` | 17044 | `6b27cc5fd891b4afeef3b9a54dbb48a88d6e3c6047af6add17b86da2a43bc5f3` | `5687d8ab0b1af7a8d6548bbd1ed0ebb6` | imported from the stored statement |
| `20261114060150` | `equity_uprise_music_workspace` | 13691 | `a1d623032934f542f598b7d988ec294ee4339f729050d603939cfe0c51fea9ed` | `ae1bd9c95a566d0a05a1ae00d0772bcb` | imported from the stored statement |
| `20261117144103` | `eup_module_policy_v1` | 26070 | `57fa1223503313480d6c3d2e04f79dfceefe0a3290b4ba8d12104b05cfd0208c` | `1f1daee2582fd0a6f3a659350a07491e` | moved from `supabase/pending/eup_module_policy_v1.sql` |
| `20261117222809` | `action_globe_join_scope_v1` | 9521 | `6510150854ace6bf8da2937218dc82b82c8b8a2c9ef344ee78464abb7c8365cf` | `acbb15a8fa25400006d39a586abd834f` | moved from `supabase/pending/20261117100000_action_globe_join_scope_v1.sql` |
| `20261118021521` | `action_mission_details` | 6809 | `e304ab01ee4361ed720c528a0eac259d757e010f98ebfaba0cb7053aefe8ac21` | `26965b3fe8bf077d1f5e9fb5f4b22557` | moved from `supabase/pending/20261117100100_action_mission_details.sql` |
| `20261118034753` | `action_mission_drawdown_import_01` | 29656 | `70e59ff1952ceb8b9d0c394c11cd7cc6faeb735bba533eed961210a7f539a796` | `310178698d117f2a6ffe2f672fddd73a` | moved from `supabase/pending/20261117100200_action_mission_drawdown_import_01.sql` |
| `20261118034926` | `action_mission_drawdown_import_02` | 31009 | `e2e487a91f2796302ab48364d3cb910c9f61364d6695fcc3235068188a877465` | `4d29872c1f27f70bdea39151ed98f1eb` | moved from `..._import_02.sql` |
| `20261118035056` | `action_mission_drawdown_import_03` | 30085 | `470cf183e01f6d8e46f72fd34884c9b3f09a802e37b25bb6ee66f10ceb137407` | `3de9c9a8c30dff70adccb7b5d4537b3f` | moved from `..._import_03.sql` |
| `20261118035221` | `action_mission_drawdown_import_04` | 30241 | `1b0d2d37754e5b614426f81afee564dc3d5646f22a7aa3e20bc7203714f557c9` | `2b5458737baa0e8899db5d8490b4dd92` | moved from `..._import_04.sql` |
| `20261118035346` | `action_mission_drawdown_import_05` | 30478 | `a6594cfeb88133a3133e2fdbe8749a86d29c211ad83e28813c6eeccd65d52b22` | `15e9667dbf5e3baae43efbdc930061c3` | moved from `..._import_05.sql` |
| `20261118035521` | `action_mission_drawdown_import_06` | 30418 | `b83a3af5fc39a2ab5881135906bb7da6b8e398efda96cee267fa604c0d8163f9` | `5d9b005eba3c3f9df54f54ecfd9be40a` | moved from `..._import_06.sql` |
| `20261118035654` | `action_mission_drawdown_import_07` | 31243 | `75a698250b57d6fda7b579ba7a944619936535d0c55bfbae70b82266e8030b10` | `866f1f4b52bd1f1005e5634e369bcaee` | moved from `..._import_07.sql` |

  Each is now `supabase/migrations/<version>_<name>.sql`. The ten moved files keep their headers ("PENDING. Not
  applied to production."), the words they were applied with; their rollbacks, and the module policy's provenance
  record, stay in `supabase/pending/` under their pending names as recovery-only artifacts.

## The two migrations applied outside Git

`20261114015120_equity_uprise_platform_registry` and `20261114060150_equity_uprise_music_workspace` were applied in
production on 14 November without a file in this repository, and their release receipt is not in it. No byte-identical
copy exists here: the working tree, `vendor/` and every blob of either size in this clone's object store were compared
by size and md5. Each file was therefore written from production's stored statement and proven equal to it
by length, md5 and SHA-256 (the table above). Each statement ends with `commit;` and then a line feed, a carriage
return and a line feed: the carriage return is production's byte, and the file keeps it.

Before commit, both texts were searched for secrets and personal data: no e-mail address, key or token, password,
host name, IP address, literal UUID or person's name. The statements read rows at apply time (organizations, their
members, creator profiles) but carry none.

What they create, read from the statements and from the catalog:

- `equity_uprise_platform_registry` refuses unless production holds one enabled McCluster organization, the four
  enabled app registrations and one authenticated McCluster owner; creates `public.eu_platform_registry`,
  `eu_platform_tenants`, `eu_platform_app_bindings`, `eu_platform_module_bindings`,
  `private.eu_platform_artist_bindings` and `private.eu_platform_release_checks` (row level security on each, with
  their policies), `private.eu_platform_org_role()`, `public.eu_platform_context()`,
  `public.eu_platform_my_memberships()` and the `security_invoker` views `public.eu_platform_mission_directory` and
  `public.eu_platform_music_directory`; inserts the Equity Uprise organization, its registry row, its two tenants, the
  existing McCluster owner's membership of it, app and module bindings and one artist space per creator profile; and
  records a before-and-after fingerprint of the legacy
  account, action and music tables, functions and policies, which must be equal, as release check
  `platform-registry-v1`.
- `equity_uprise_music_workspace` widens the module adapter check (`shared_creator_music_v1`), creates
  `private.eu_platform_music_root()`, `private.eu_platform_music_join()` with its `public` wrapper,
  `public.eu_platform_music_space()`, `public.eu_platform_music_libraries` (row level security, one policy) with
  `public.eu_platform_music_library_get()` and `private`/`public` `eu_platform_music_library_save()`, enables music for
  linked owner spaces, and records release check `music-workspace-v1` the same way.

## Whole-schema evidence captured in the same read

`docs/control-plane/evidence/production-schema-snapshot-2026-11-18.json` is a full production schema snapshot (376
ledger rows, 576 relations, 544 functions, 472 policies, 157 triggers, 14 buckets, 11 extensions, 4 schemas, 1 cron
job), captured as a delta against the 10 November snapshot with `scripts/db/snapshot-delta.mjs`: for each section the
database returned its own md5 of the full section, the rows of the objects these twelve migrations touch, and the md5
of everything else. Everything else hashed to the 10 November rows in every section, so **production's schema outside
these twelve migrations is unchanged since 10 November**, and each rebuilt section hashes to the database's md5.
`node scripts/db/verify-production-schema.mjs --snapshot <file>` rechecks those hashes offline.

Changed since 10 November, all from the twelve: 12 ledger rows; 12 relations added (the eight `eu_platform_*`
relations above, `public.eu_platform_music_libraries`, `public.action_mission_details`, `public.eup_module_policies`,
`public.eup_module_policy_commands`) and 1 changed (`public.action_globe_mission_regions`: the `join_scope` column and
its check); 19 functions added (the ten `eu_platform_*` functions and the nine `eup_module_*` functions) and 2 replaced
(`join_action_mission`, `action_globe_can_join_mission`); 10 policies added; 4 triggers added. Schemas, extensions,
buckets and cron jobs are identical. The Drawdown parts change rows only, so they add ledger rows and nothing to the
catalog.

`supabase/schema-manifest.json` gains those 45 rows and the 3 changed rows, taken from this snapshot. Production
against the manifest now differs by exactly the same keys as the 10 November snapshot did against the manifest before
(the production-versus-reset drift tracked separately). The CI reset is the arbiter of the manifest (below).

## What this does not establish

- No row of any business table was read. The mission counts (1 open and 125 draft missions, 125 details rows; as
  `anon`, 1 mission, 0 drafts, 0 details) are the operator's reads at 03:58 UTC, not repeated here. Whether any E=Up
  module is installed or enabled was not read.
- The CI "Supabase migration reset" has not run on these files. `20261114015120_equity_uprise_platform_registry`
  refuses unless the database holds an authenticated McCluster owner, which a fresh reset does not, so the reset needs
  a replay twin under `supabase/replay_migrations/` (the mechanism `scripts/supabase-local-reset-with-replay.sh`
  provides) before it can build the registry and the music workspace. That is a separate, reviewed change; nothing
  here writes one. The manifest rows for those objects are production's until a reset confirms them.
  Follow-up, the same day: the twin is `supabase/replay_migrations/20261114015120_equity_uprise_platform_registry.sql`.
  A fresh reset also lacks the `mnet-web` app the registry's app check wants, and that check refuses first; the twin
  relaxes both. Its proof, on a disposable PostgreSQL 16 and not the CI stack, is
  `scripts/test/eu-platform-replay.native.integration.mjs`; the CI reset still has not run.
- Who applied the two migrations outside Git, and why, is not recorded here.
- Not applied, and still pending: the Drawdown publish (`supabase/pending/20261117100300_action_mission_drawdown_publish.sql`,
  for the deploy window after the new feed ships, by the owner's decision), `compute_claim_task_yield_v3.sql`, and
  everything else in `supabase/pending/`.
- Nothing here is a Worker or Core deployment. The deployed OVH Core checks the drift contract it was deployed with;
  it consumes the 376 contract only through its own promotion path.
- Managed backup and point-in-time recovery status were not checked.
