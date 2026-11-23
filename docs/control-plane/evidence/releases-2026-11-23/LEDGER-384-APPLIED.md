# Connections consent guard and Environment parts 03 to 05 applied (ledger 380 to 384), 2026-11-23

**Four migrations were applied to production project `zmnhbrjyhxzhkxmhkexs` on 23 November 2026, with Matthew's approval.**
The ledger went from 380 to 384 rows. The network connections consent hole is closed. The E=UP environmental event store is
complete and empty, and nothing public changed: a signed-out visitor still gets `404 module_disabled`. The USGS rule, the
ingest switch and the Environment module remain to be done, and none of them is an agent's step.

This record was written from the records session after the applies. Every production read in it was a single `SELECT`
through the Supabase `execute_sql` connector, over `supabase_migrations.schema_migrations` (version, name, and the stored
statements counted, measured or hashed; never `created_by`), the catalog, grants and aggregate counts. No business row, id,
name or e-mail address was read. Nothing was applied, altered or written by this record.

## Who approved, and how the confirmation worked

Matthew approved in the working session of 2026-11-23, in his words:

| His words | What they approved | Procedure |
| --- | --- | --- |
| "Apply the connections fix." | `network_connections_consent_guard_v1` | `supabase/pending/PROMOTION-ORDER.md`, section 13 |
| "Approve the last 3 EUP database changes." | `eup_environment_events_v1_03`, `_04` and `_05` | the same, section 12 |
| "Switching the module on for sure, alright?" | the Environment module, once its prerequisites are in | section 12, "What remains"; **not done** (below) |

Each statement was sent with the Supabase MCP `apply_migration` from the main session, under its migration name and with the
committed file's text. The connector asks a person to confirm each such call before it runs. The calls were made from the
main session so that Matthew could answer, and he answered each one. The ledger versions are the moments production recorded
them (UTC): 17:36:26, 17:38:31, 17:39:51 and 17:40:34.

Earlier the same afternoon an unattended workflow agent sent the consent guard. Its call timed out after 230 seconds with the
confirmation unanswered ("The server asked the user a question, and no answer came before the time limit."). A live read at
17:29:45 UTC found nothing changed (380 rows, the three policies, `authenticated=arwdm`), and it did not retry. A records
agent that started at 17:34 UTC stopped at 17:39 UTC when the ledger changed under it, and wrote nothing. Nothing else was
applied: the ledger has exactly these four new rows, and the whole-schema delta below shows only their changes.

## Before

Read by the apply step before the applies (SELECT only):

- 17:23:31 UTC: 380 ledger rows, latest `20261120061759` `eup_environment_events_v1_02`; SHA-256 of the sorted
  `version:name` lines `898061432b00aec947b1757df7997c043a2020ba9d69c7e83be417645496b678`, equal to
  `supabase/production-ledger.json` and `core/drift-contract.json`.
- Section 13's check (the forward file's header query), before the apply: policies
  `network_connections_member_read SELECT authenticated; network_connections_self_update UPDATE authenticated;
  network_connections_self_write INSERT authenticated`; member SELECT, INSERT, UPDATE and DELETE all true; acl
  `{postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=arwdm/postgres,service_role=arwdDxtm/postgres}`. That is the
  state the section requires before applying.
- 17:30:20 UTC: Environment parts 01 and 02 recorded (30,895 and 20,775 bytes, as on 2026-11-20); the seven store tables
  empty; 22 store functions; the entry points of parts 03 to 05 absent; no module policy row.
- 17:31:05 UTC, signed out: `GET https://api.mccluster.org/v1/world/environment/events?limit=20` answered
  `404 {"ok":false,"code":"module_disabled"}`.

## What production stored

Read at 17:43:45 UTC. Each row holds one stored statement.

| Version | Name | Bytes | md5 | SHA-256 |
| --- | --- | ---: | --- | --- |
| `20261123173626` | `network_connections_consent_guard_v1` | 11,395 | `a08e29b94ffe898174c199f5eac0cecf` | `13dccf8bc0cae65d862826a4caa96e23b3f9c1786b0c3b5d57865c1d8d3fdfc7` |
| `20261123173831` | `eup_environment_events_v1_03` | 31,084 | `f4a2c6df817f2e963f9c6e1b0a486bc8` | `cec2d77814a870ebbe65a7eb6fd269d4c5fd782e89176a800d38cc79d0a78b59` |
| `20261123173951` | `eup_environment_events_v1_04` | 26,707 | `d379700f7f371b9a8803f6aa6e6e05b9` | `0df3629af91b52957626371e791445a1a65d3a08002cb13b4018910077c1f21b` |
| `20261123174034` | `eup_environment_events_v1_05` | 12,177 | `2583ace662ac0494c07065e7e93ce633` | `c33638cce4225a3276573c0bf5743bad93a2743cbcd649895f0b6b8bb19c8706` |

The ledger has **384 rows**, latest `20261123174034` `eup_environment_events_v1_05`. The digest production computes for itself
(SHA-256 over `version:name` lines in version order) is
`8af712520bdf7daf353b36b801eb568849ed9bb1088e57b48ffd2e364c97ed9c`, the digest of the 384-entry
`supabase/production-ledger.json` and of `core/drift-contract.json`. Its first 380 rows still hash to `898061432b00…b678`.

## The stored statement and the committed file: the final line feed

Each of the four stored statements ends `commit;` with no line feed after it. Each committed file ends `commit;` and one line
feed (0x0a); none contains a carriage return. Removed of that last byte, each file is its stored statement exactly:

| File (moved unchanged) | File bytes | File md5 (reviewed) | Without its final line feed | md5 | Stored statement |
| --- | ---: | --- | ---: | --- | --- |
| `20261119062110_network_connections_consent_guard_v1.sql` | 11,396 | `d08715fed336758bfd385e26678de7e2` | 11,395 | `a08e29b94ffe898174c199f5eac0cecf` | equal |
| `20261119100000_eup_environment_events_v1_03.sql` | 31,085 | `266184de8d6d6e1e1556410192b4b7a9` | 31,084 | `f4a2c6df817f2e963f9c6e1b0a486bc8` | equal |
| `20261119100000_eup_environment_events_v1_04.sql` | 26,708 | `18eb00ad69066973fff41deaad91aa63` | 26,707 | `d379700f7f371b9a8803f6aa6e6e05b9` | equal |
| `20261119100000_eup_environment_events_v1_05.sql` | 12,178 | `3bc2d43c92e0bf08068b802ce4011027` | 12,177 | `2583ace662ac0494c07065e7e93ce633` | equal |

The SHA-256 of each file without its final line feed also equals the stored statement's (the table above). The 2026-11-20
rows (Environment parts 01 and 02, the credit fallback and the publish) kept that final line feed and equal their files
whole. Why these four did not is not recorded; the executable SQL is the same either way. The ledger's code md5 (comments
removed, whitespace runs collapsed, `scripts/db/schema-queries.mjs`) equals the files': `295a71a7c8383a8a7e13fec60413acc1`,
`15c5abce5770972a33d9e078abd6e5d2`, `882f6eda1df15ae1cb8ba04229401ab3` and `1415511d0513b2cada3403c36469507c`.

The files were moved with `git mv` and not edited: their bytes are the reviewed bytes the tests pin (the Environment parts'
SHA-256 in `scripts/test/eup-environment-events-sql.test.mjs`; the reviewed headers, "PENDING. Not applied to production." and
"(pending; NOT applied in production)", are part of those bytes). Each migration file is therefore its stored statement plus
one trailing line feed. `scripts/db/verify-production-schema.mjs` counts the four as a comments-only difference (the same
executable SQL), not as SQL that differs.

## After

Read-only, 2026-11-23:

- **Connections (17:48:38 UTC), section 13's check:** policies `network_connections_member_read SELECT authenticated` only;
  member SELECT true; member INSERT, UPDATE and DELETE false; acl
  `{postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=rm/postgres,service_role=arwdDxtm/postgres}`, exactly the
  expected result. `request_connection`, `answer_connection` and `withdraw_connection` are still SECURITY DEFINER and owned
  by the table's owner, so the World's Connect, Accept, Decline, Withdraw and End keep their path. A member's direct write is
  refused by the missing privilege. Neither was exercised in production here (no member session was used); the proofs named in
  section 13 show both.
- **Environment store (17:48 UTC):** 29 store functions and 7 tables. `eup_environment_ingest`,
  `eup_environment_ingest_state`, `eup_environment_owner_read`, `eup_environment_owner_command` and
  `eup_environment_coverage_propose` are SECURITY DEFINER with an empty `search_path`, EXECUTE for `service_role` only
  (`anon`, `authenticated` and `PUBLIC` false). The two input helpers, `eup_environment_usgs_input` and
  `eup_environment_coverage_input`, execute for their owner only.
- **Aggregate counts (17:48:50 UTC):** 0 events, 0 providers, 0 source-health rows, 0 decisions, 0 coverage rows; 0
  Environment module policy rows and 0 module commands (no module of any kind is installed); no session running these
  migrations.

## Whole-schema evidence captured in the same session

`docs/control-plane/evidence/production-schema-snapshot-2026-11-23.json` is a full production schema snapshot (384 ledger rows,
583 relations, 573 functions, 470 policies, 172 triggers, 14 buckets, 11 extensions, 4 schemas, 1 cron job), captured between
17:49 and 17:51 UTC as a delta against the 20 November snapshot with `scripts/db/snapshot-delta.mjs`. Every section hashes to
the database's own md5, and everything outside the four migrations hashed to the 20 November rows. Changed since 20 November,
all from the four: 4 ledger rows; `public.network_connections` (its acl, `authenticated=damrw` to `authenticated=mr`); 7
functions added (the five entry points and two helpers above); 2 policies removed (`network_connections_self_update` and
`network_connections_self_write`). Schemas, extensions, triggers, buckets and cron jobs are identical.
`node scripts/db/verify-production-schema.mjs --snapshot <file>` rechecks it offline: the committed ledger matches the live
one, nothing is missing from or extra in `supabase/migrations/`, and production differs from the schema manifest by the same
keys as on 20 November.

## Records in this change

- The four files moved unchanged to `supabase/migrations/` under their ledger versions. The rollbacks stay in
  `supabase/pending/` under their pending names: `20261119100000_eup_environment_events_v1.rollback.sql` unchanged, and the
  consent rollback's first lines now name its forward file where it is.
- `supabase/production-ledger.json` and `core/drift-contract.json`: 384 rows, latest `20261123174034`, the digest above.
- `supabase/schema-manifest.json`: the seven functions (rows taken from the snapshot, as parts 01 and 02's 22 functions were
  the same in the CI reset and in production), the two policies removed, and `authenticated=mr` on the reset's own
  `network_connections` row (only the acl; the reset's constraint and index signatures stay its own). These are what the CI
  reset builds once the files are under `supabase/migrations/`; it has not yet run on them, so its next run is the arbiter, and
  if its artifact differs the manifest is refreshed from it.
- `supabase/pending/live-callers.json`: the four exceptions for parts 03 and 04 removed (now in the snapshot and the
  manifest). `docs/control-plane/evidence/ledger-receipts.json` stays empty: the snapshot covers all 384 rows.
- `workers/mccluster/src/eup/environment/owner.js` names the five parts where they now are (the Worker's own test reads each
  path); two comments in `ingest.js` and `usgs.js` follow part 03. No behaviour changes.
- The CI path filter of the `connections-consent` job follows the migration; `supabase/pending/PROMOTION-ORDER.md` sections
  12 and 13 and `supabase/pending/README.md` say what is applied and what remains.

## What a visitor gets

At 17:49:04 UTC, signed out, with `Origin: https://mccluster.org`:
`GET https://api.mccluster.org/v1/world/environment/events?limit=20` answered `404 {"ok":false,"code":"module_disabled"}`
(`cache-control: private, no-store`), and `GET /v1/world/environment` the same. `GET https://api.mccluster.org/v1/health`
answered 200 for Worker `mccluster`, deployment `b51ede03a4faefe000749ec71630b1a584146fed` (the merge of PR #820,
2026-11-20), the same as before the applies. This change deploys nothing.

## Not done: needs Matthew or a deploy

1. **The USGS rule.** An owner command in Matthew's signed-in Control session: System > E=Up > Environmental events >
   Sources > "Set the default rule", with a reason. No provider row exists.
2. **The ingest switch.** The Worker variable `EUP_ENVIRONMENT_USGS_INGEST_ENABLED`, committed `"false"` in
   `workers/mccluster/wrangler.toml`. Turning it on needs a pull request, a merge and a Worker deploy; the existing
   five-minute cron then runs the ingest.
3. **Check before the module:** a durable source-health row under Sources and the timeline in Preview.
4. **The module.** Install, then Enable, in Control: System > E=Up > Overview > Modules > Environment, each with a reason.
   Matthew's "Switching the module on for sure, alright?" is recorded here; the switch itself is his command in his session
   after steps 1 to 3, and this record does not claim it. Until then the public timeline answers `404 module_disabled`.

## Recovery

The connections rollback, `supabase/pending/20261119062110_network_connections_consent_guard_v1.rollback.sql` (owner approval,
as postgres), puts back the two policies and the three grants and reopens the hole. The Environment store is empty and
dormant; ordinary recovery uses the provider and module controls (pause, hide, drain, disable) with fresh revisions and keys.
`supabase/pending/20261119100000_eup_environment_events_v1.rollback.sql` destroys the store and stays a recovery artifact.

## What this does not establish

- No business row was read; the counts above are aggregates. No member session was used.
- The CI "Supabase migration reset" has not run on the moved files.
- Why the four stored statements lack the final line feed that the 2026-11-20 rows kept.
- Managed backup and point-in-time recovery status were not checked.

Not a production change, recorded in the same change: Matthew's attestation of 2026-11-23 about Project Drawdown's permission
for the quotations, in `data/missions/drawdown/README.md` and `docs/control-plane/WORLD-MISSION-SOURCES.md`. No mission data
changed.
