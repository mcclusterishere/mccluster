# Environment timeline: prepared, not activated — 2026-11-20

## Observed status at 06:13 UTC (historical)

This records the preparation before the connector recovered. Later applications are recorded in
[the application receipt](ENVIRONMENT-TIMELINE-APPLIED.md).

PR #818's website/API release is live at merge commit
`95db84602d8edef4e4a0143833f37ab3e67d91f7`. Its API health marker and ordinary public URLs were verified at
03:45:30 UTC. The Environment database store and USGS activation are a remaining part of the owner-authorized completion.

**No Environment migration has been applied or promoted.** All five exact forward SQL files remain under
`supabase/pending/`. `EUP_ENVIRONMENT_USGS_INGEST_ENABLED` remains `"false"` in the canonical Worker configuration.
The module and provider have not been activated by this preparation. No migration version is assigned or inferred here.

The release operator reported at 06:13 UTC that two production `apply_migration` calls returned no result before their
execution runtimes were replaced, after approximately an hour each. Neither call returned an error or approval denial.
Fresh ledger inspection found zero changes. This is an unresolved connector execution failure; the record does not claim
that an apply succeeded, that a particular permission was denied, or that a new production version exists.

Before another mutation attempt, read the live ledger and object state again. If an earlier request later appears there,
reconcile its exact stored statement and assigned version before considering a retry. Do not resend an already-recorded
migration under another name.

## Exact statements ready for application

Each part is one transaction, at most 32,000 bytes, with a five-second lock bound. Apply names are
`eup_environment_events_v1_01` through `_05`, in that order. Every filename below is under `supabase/pending/` and still
has prefix `20261119100000_`. The SQL bytes, including their original staging headers, are unchanged.

| Part | Filename suffix | Bytes | MD5 | SHA-256 |
| --- | --- | ---: | --- | --- |
| 01 | `eup_environment_events_v1_01.sql` | 30,895 | `37f0001127eac2b2bca5f5d0488aecc3` | `78d2643d476ee53eb8247fdc2dd75df9ff102e82bc95d447d0ab610cfbd686bd` |
| 02 | `eup_environment_events_v1_02.sql` | 20,775 | `6ea640c7537303965620829613e233fe` | `7bfde29564fd0335c52f5934ba7a7398de1bad5dd0771cbbb4ec8c4694d232d9` |
| 03 | `eup_environment_events_v1_03.sql` | 31,085 | `266184de8d6d6e1e1556410192b4b7a9` | `192faf1bad2e922e9e71a67f84f5ab7280a94035710f6be5ab0960dc6c9cc1fd` |
| 04 | `eup_environment_events_v1_04.sql` | 26,708 | `18eb00ad69066973fff41deaad91aa63` | `8e16e958444a256ef26e42cff490b923ae54db4961a9e6a897937eec0f713606` |
| 05 | `eup_environment_events_v1_05.sql` | 12,178 | `3bc2d43c92e0bf08068b802ce4011027` | `66a2139378e9325f21374119606245338012720a42c772ebab2c221e5d2a6249` |

The recovery artifact is `supabase/pending/20261119100000_eup_environment_events_v1.rollback.sql`, 3,792 bytes,
SHA-256 `de6f296887cdebdf4751c105a31824a3b0298328a88047aa85bcd87e38272c53`.

The 03:51:53 UTC preflight found the module policy and organization/auth prerequisites, no event store, zero installed
module policies or policy commands, and 376 ledger rows through `20261118035654`. The independent ledger read at
04:07:51 UTC also found no later migration. The release operator's later check confirmed zero changes after the failed calls.

## Preparation in this commit

The isolated test helper discovers each part's sole forward copy under `pending/` or, after a recorded promotion, under
`migrations/`. It accepts the actual filename; it never allocates a version or treats source discovery as production proof.
Missing or duplicate copies fail immediately. Exact SHA-256 checks preserve the reviewed SQL through a later move.
The recovery file stays pending. Environment CI also watches the eventual applied migration paths.

Control now describes observed missing-store and never-run states without assuming that approval is absent or that the
runtime flag is off. Its existing owner-only boundary, revision checks, command keys and recovery behavior are unchanged.
The preview and default-rule descriptions explain their behavior without historical pull-request instructions.

The seven `live-callers.json` exceptions remain pending. The global ledger, drift contract, schema manifest and production
snapshot are unchanged. No applied filename or fake receipt is introduced, and the false/absent ingest flag tests remain.

## Completion sequence after the connector recovers

1. Repeat the live preflight. Apply the five exact statements serially, reading the assigned ledger version, stored-statement
   count, byte count and MD5 after every part. Recover an unknown outcome from that read before deciding whether to retry.
2. Verify the seven tables have RLS and no API-role table/sequence privileges. Only the eight entry RPCs grant EXECUTE to
   `service_role`; `anon`, `authenticated` and `PUBLIC` remain denied. The parts seed no provider or event.
3. Move each exact forward file to `supabase/migrations/` under its actual assigned version. Reconcile the production ledger,
   drift contract, schema manifest and snapshot, then remove only the now-recorded Environment caller exceptions. Update
   the owner diagnostics and promotion records to those real filenames. Preserve the original SQL bytes and headers.
4. Configure the USGS default through the existing owner command RPC, using the actual canonical owner, expected revision
   zero only if it is still unconfigured, an explicit reason and an idempotency key. The default admits magnitude at least
   4.5, automatic readings included, or significance above 600, a PAGER alert, or a tsunami flag.
5. Enable the ingest flag in the deployed canonical Worker and its source configuration. The existing five-minute cron is
   sufficient. Verify fresh durable source health and the owner preview before installing and enabling the public module.
6. Use the existing module policy RPCs to install disabled, reread its revision, and enable. Signed-out
   `GET https://api.mccluster.org/v1/world/environment/events?limit=20` should then return 200 and schema
   `mccluster.environment-events/v1`. Open a real returned event at
   `https://mccluster.org/?feed=equity&event=<encoded-id>` and verify post, globe selection, deep link, reload and phone layout.

The authenticated administrative connection can execute the existing RPCs on behalf of the authorizing canonical owner;
the functions recheck ownership and record the reason, key and revision. This creates no user session and changes no
membership. The HTTP owner routes still require a genuine verified owner bearer. Keep private actor identifiers and
command payloads out of public receipts.

The Cloudflare preflight found Supabase bindings, the `*/5 * * * *` cron and the flag false. USGS needs no additional
credential. `FIRMS_MAP_KEY` was absent: fire detections must remain explicitly unconfigured. The older environmental
team/mission/proof SQL is separate from this public USGS timeline. This slice adds no news-to-event matcher.

## Recovery

Pause USGS or turn its flag off to stop ingest. Hide the provider, or move the module enabled → draining → disabled with
fresh revisions and keys, to withdraw public access while retaining records. For an event correction rollback, pause ingest
first; the owner rollback creates a new revision and a later source ingest may reapply the source.

The SQL recovery file destroys the event store and its rows while retaining module policies and their command log.
It is not needed for a connector call that the ledger confirms did not apply. After real use, disable callers and ingest
and export records before destructive recovery.

## Validation evidence

On the final preparatory tree, the focused SQL/Control checks passed 17/17 and the unchanged Worker owner/USGS tests
passed 32/32, including the committed false flag, zero calls while disabled, and owner authentication. The store proof
reran against the discovered pending files on isolated PGlite 0.5.10: 294 assertions passed. These checks include
pending/applied discovery, duplicate/missing refusal and exact SQL hashes. `git diff --check` passed.

Earlier in the same completion session, the same reviewed SQL passed 7 ingest integration tests and 11 public timeline
integration tests. A separate read-only review of the preparatory diff found no material issue or false applied-state claim.

The reviewed recovery head passed the original Environment jobs in
[Human Uprise responsive visual proof run 44563845184](https://github.com/mcclusterishere/mccluster/actions/runs/44563845184),
including [the event-store proof](https://github.com/mcclusterishere/mccluster/actions/runs/44563845184/job/135700106744).
Native concurrency evidence on PostgreSQL 16.15 and 17.7 remains in the implementation record; it was not rerun for this
preparatory change. Production's preflight reported PostgreSQL 17.6.
