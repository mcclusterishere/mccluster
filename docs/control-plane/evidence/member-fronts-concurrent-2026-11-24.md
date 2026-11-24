# Concurrent member-front migration: production provenance and remaining coupling

## Recorded production fact

During the 2026-11-24 migration audit, another session applied a member-front
migration before this audit's workstream migration. This record preserves what
production actually stored; it does not replay the SQL or identify an unverified
source branch as approved.

| Field | Observed value |
|---|---|
| Project | `zmnhbrjyhxzhkxmhkexs` |
| Recorded version | `20261124164026` |
| Recorded name | `member_fronts_shared_revision_directory` |
| Statement count | 1 |
| Exact statement bytes, UTF-8 | 26,851, including its final LF |
| MD5 | `fa5f4ab5d0a7ea206e8a865828c883db` |
| SHA-256 | `34258d5855f2785f38f293e85a388d1a4ae92df36ff361e29713b6fa014bf943` |
| Preserved source | `supabase/migrations/20261124164026_member_fronts_shared_revision_directory.sql` |

The source was recovered from
`supabase_migrations.schema_migrations.statements` for that exact version, then
written without normalization. Its byte count and SHA-256 were checked before
writing. The applied file must remain unchanged.

At `2026-11-24 16:49:00.010624+00`, a read-only aggregate of
`public.member_fronts` returned zero rows, zero published rows and zero directory
opt-ins. This observation is time-bound, not a promise that the table stays empty.

Recent open and closed PR records, targeted relevant branch heads, code search
for the exact migration name and a commit search did not establish a matching
reviewed source. The actor/session and original review/proof receipts remain
unidentified by this audit. This does not assert that no such source exists.

## What is already installed

The stored SQL creates `public.member_fronts`, `member_fronts_private`, the public
`front-media` bucket, revision-fenced save/unpublish operations, an explicit
directory opt-in and six public RPCs. Its public page and directory readers
require a public network profile. Storage includes restrictive ownership,
immutable-object and referenced-object deletion boundaries.

**Do not apply the older `supabase/pending/member_fronts_v1.sql`.** The basic
table/bucket dependency is now satisfied by this larger migration. The older
file does not describe the live revision/RPC/Storage contract. Its retirement
and the two formerly missing caller names must follow the reconciled reset
manifest and production snapshot, without running its rollback.

## Coupling still missing from deployed code

Main at `7f2644b417994d1b994d763485b6448906bdfdb0` uses direct service-role table
reads/writes in `workers/mccluster/src/member-fronts.js`. The new migration keeps
service-role table DML grants, so those calls can reach the newly created table
without going through the RPC's expected-revision, page/media locks and media
existence checks. The legacy media uploader also predates the new immutable
Storage contract.

The prepared narrow Worker repair requires `visibility === 'public'` for both
publication and public GET/HEAD. It refuses missing/private/network-only profiles
with recovery information, preserves drafts and existing owner takedown, and
reports publication availability. Its nine focused tests pass, including
network-only visibility, missing profiles, no writes on refusal and recovery.
This repair **does not adopt the new revision RPCs** or claim a coordinated
member-front feature release. Those remain explicit follow-up integration work.

The SQL itself also had a narrower publication defect: its `save` RPC could set
`published` for missing/private/network-only profiles and return success even
though the public reader hid the page. This was reproduced on native PostgreSQL
using the exact preserved production SQL, without changing production.

## Prepared forward guard; not applied

`supabase/pending/member_fronts_publication_visibility_guard_v1.sql` changes only
`member_fronts_private.save(jsonb,integer,boolean,boolean)` to require a public
profile before a publication write. Private draft saves and unpublishing remain
available. It does not change grants, enable a feature, publish any content or
adopt the RPCs in the Worker.

| Guard fingerprint | Value |
|---|---|
| File bytes | 5,031 |
| File SHA-256 | `3b24d1c3ad428047663eb4b85acffe038fc68819d618d0cadc8336a05cacbc51` |
| Observed prerequisite `md5(pg_proc.prosrc)` | `5f5579d9f617319d56cf359e0811fe89` |
| Guarded body `md5(pg_proc.prosrc)` | `a74e61a1f7ebc5c29946bc18a20f1d00` |

The migration accepts only those original/already-guarded bodies. Another
session's different function body causes `55000` before replacement. The
prerequisite fingerprint was read live at `2026-11-24 16:50:28.783486+00`.
Per-file approval is required before any production application of this guard.

## Proof and its limits

Native PostgreSQL **17.6** proof completed at
`2026-11-24T17:02:35.678Z`. It replayed the exact applied SQL, reproduced the
original nonpublic-publication failure, applied the guard twice, and passed
missing/private/network refusal, no write on refusal, public recovery, stale
revision rejection, directory consent, public-read privacy, draft saving,
unpublish and privilege checks. Fixtures rolled back completely. A deliberately
different concurrent function body was refused without being overwritten.

Files:

- `supabase/tests/member_fronts_publication_visibility_guard.behaviour.sql`
- `scripts/test-member-fronts-publication-guard-db.sh`

The local run used native PostgreSQL with the repository's auth/Storage stubs and
minimal account-table stand-ins. Because `psql` is absent in this executor,
Postgres.js executed the same SQL blocks; the fixture's two psql display/control
metacommands were handled explicitly. The shell runner passed `bash -n` but was
not itself executed end-to-end with psql here.

The behavior fixture replaces no base objects and disables no triggers. It
reuses identities/profiles created by the real auth triggers when present, and
creates only absent fixture rows in the minimal harness. It is prepared for the
following **disposable local full-reset CI** proof, which is not yet verified:

```sh
supabase db reset --local
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -X -v ON_ERROR_STOP=1 \
  -f supabase/pending/member_fronts_publication_visibility_guard_v1.sql
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -X -v ON_ERROR_STOP=1 \
  -f supabase/tests/member_fronts_publication_visibility_guard.behaviour.sql
```

Run that after the actual applied migration and ledger record are part of the
reset. Do not use the small-harness shell runner on a production database.
Neither this document nor the pending guard is an application receipt or a
completed member-front deployment claim.
