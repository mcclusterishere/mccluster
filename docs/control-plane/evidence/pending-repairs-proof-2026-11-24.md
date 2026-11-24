# Pending repair preparation proof — 2026-11-24

## Review boundary

**Nine candidate forward migrations and nine guarded recovery files are prepared. None was
applied to production by this preparation.** Each forward file still needs its own explicit
approval after the records reconciliation and green exact-head CI. Runtime deployment and
feature activation are separate; this evidence makes no production-release claim.

Base: `1cfb1a3613f24a877b7255f457844a0daa3fb6d1`, the reviewed 389-record reconciliation.
The earlier 51-forward-file inventory was `supabase/pending` on main
`7f2644b417994d1b994d763485b6448906bdfdb0`, excluding 41 recovery files, applied/replay SQL and
archives. It was not an audit of every open PR branch. This lane prepares eight selected
candidates plus a new guard for the concurrently recorded member-front revision schema.
Named owner-workspace, music and Release 2 branches have separate bounded reviews.

The complete per-file inventory, hashes, dated aggregate preflight and safe native receipts
are in `pending-repairs-proof-2026-11-24.json`. Every forward/recovery has an explicit source-map
entry as shared platform support used by Equity Uprise; none defines a building capability.

## What changed and why

| Area | Change and reason | Recovery result |
|---|---|---|
| World members | Add the missing aggregation RPC, with a deterministic event-ID tie-break when timestamps tie. Existing Worker threshold/privacy behavior stays in force. | Remove only the exact reviewed function; all telemetry and identities remain. |
| Member fronts | Both the applied revision RPC and legacy Worker refuse publishing for a missing/private/network-only profile. Public GET/HEAD fails closed for a missing profile. The native proof reproduces the original RPC defect before applying the guard. | Keep the visibility fix and all saved pages. Pause draft save/publication through both RPC entry points; read/get-self/unpublish/takedown remain available. |
| Creator cohorts | Add grant storage, then the identity-bound publisher overload. The old paid publisher remains, with inherited browser EXECUTE removed. | Refuse nonempty grant/history storage; remove the new overload first and retain all publications and legacy paid behavior. |
| News leads | Explicit service CRUD and an empty service-only lead table. | Refuse any saved lead record before removal. |
| Reflection/digest | Exact optional read indexes; digest uniqueness now uses the ordinary transactional migration flow on the measured small table. | Drop only exact reviewed indexes; keep every job/signal. |
| Publisher geography | Idempotent seven-column/check addition; no headquarters is inferred or populated. | Refuse any optional saved metadata or unexpected shape; otherwise remove only the empty reviewed columns. |
| Connector policy | Omitted/null/empty ensure values preserve existing reviewed policies; explicit policy changes still work. | Any connector record refuses legacy restoration; an empty store can restore only the exact original helper. |

All files use runner-owned transactions and a shared advisory transaction lock. They require
**READ COMMITTED before any catalog read or lock**, with a five-second lock timeout. A
repeatable-read snapshot could otherwise miss a writer that commits while recovery waits;
that isolation is now explicitly refused. Table and geography guards lock before inspecting
shape; new table creation also verifies the final shape. Changed function bodies/metadata,
same-name index definitions and altered/partial new schema fail closed. No recovery has a
force-delete or cascading-drop option.

Member-front recovery never reinstalls the visibility defect. It pauses `authenticated` and
`service_role` execution on the public invoker save wrapper and private delegate only. A
precise function-comment marker distinguishes this recovery from an independent owner ACL
change. Forward reapply restores the canonical grants only from the exact active state or
this exact paused ACL/marker pair. Unknown grants, comments or bodies refuse. Existing pages
and all non-save operations remain; already-admitted calls may finish, so stop new incoming
save requests first. The separate legacy Worker route retains its API guard and is not
claimed to be disabled by those RPC grants.

## Dated live preflight

SELECT-only evidence at 16:48:26 and 16:49:08 UTC on 2026-11-24 recorded PostgreSQL 17.6,
47,099 jobs (53,321,728 heap bytes), 64 signals (155,648 total bytes), 10,039 publisher rows
and 17 connector rows. The target indexes and seven publisher fields were absent, qualifying
digest duplicates were zero, and the private connector helper matched the applied canonical
body with owner-only execute access. These are dated observations, not future authorization.

The normal digest build can briefly block writes; the timeout bounds waiting to acquire a
lock, not total index build time. Recheck current size, load, duplicates and definitions before
approval. **The populated connector store is expected to refuse legacy rollback.** Retain the
fix and prepare a reviewed forward repair for that state; no existing policy is cleared merely
to pass a recovery guard.

The member-front prerequisite is the already-recorded
`20261124164026_member_fronts_shared_revision_directory.sql`, recovered from the actual stored
statement. Its whole-file SHA-256 is
`34258d5855f2785f38f293e85a388d1a4ae92df36ff361e29713b6fa014bf943`.
The old pending `member_fronts_v1.sql` must not be replayed.

An independent read-only review at 18:10:44 UTC reconfirmed every pinned catalog field,
raw function-body SHA-256, ACL and comment for the private/public member-front save entries,
the legacy four-argument creator publisher and the private connector helper. At 18:13:37 UTC
the live ledger still held 389 migrations; all newly introduced candidate objects/indexes and
the seven geography columns were absent, with 64 signals, zero duplicate windows, 10,039
publishers and 17 connectors. Jobs had grown to 47,217; the comparable heap reading at
18:14:55 UTC was 53,518,336 bytes. These fresh aggregate observations supersede the older job
count, while preserving its dated record. The independent review found no blocker in the
18 prepared files; it does not replace full-reset CI or per-file application approval.

## Local native proof

| Proof | Result and limit |
|---|---|
| World aggregation | 12 behavior groups twice, wrapped by three native apply/recovery/drift groups; real denied-role calls, repeated guarded recovery, unchanged account/event counts and unknown-body refusal. |
| Member-front correction/recovery | Four native scenario groups: original defect reproduced; privacy/CAS/media/public-read behavior; both-role/both-entry save denial while paused; byte-for-byte page preservation; read/get-self/unpublish availability; reapply; body/ACL/comment drift refusal. |
| Creator/news | 39 creator plus 17 news assertions on each of two passes (112 behavior assertions), plus 18 explicit refusal checks. Actual recovery files verify dependency order, nonempty data preservation, shape/RLS/body drift, stale-snapshot refusal, repeated empty recovery/reapply and continued paid service publishing. Complete-row digests preserve preexisting baseline data, including a nonempty synthetic prior site. |
| Four optional repairs | 15 native scenario groups. Includes real simultaneous digest inserts, the five-second lock wait bound, failed duplicate builds without row loss/partial index, genuine query-plan use, real role calls, data and metadata refusal, READ COMMITTED guards, exact legacy helper restoration, repeated recovery/reapply and unchanged base rows. |
| Worker routes | 16 tests passed, zero failed: nine member-front cases and seven World member cases. |

These ran on real PostgreSQL 17.6. The bounded fixtures use canonical selected/source-extracted
DDL plus explicitly documented peripheral Auth/Storage/FK stand-ins. They are not proof of the
entire repository reset. Assertions execute actual forward and recovery files; proof setup
removes only its own synthetic state, while recovery SQL itself never wipes saved rows.

## Exact-head CI still required

Reconciliation CI now runs all new native proof entry points and a second set against its
complete canonical migration/replay reset after the baseline snapshot comparison. Full-reset
mode does not replace baseline roles/tables/functions/triggers or apply blanket fixture grants.
The expected reset is the canonical/replay overlay, not merely a count of production-ledger
rows. No local full-reset success is claimed here; require the new draft head's CI result.

The four-optional-repairs reset fixture checks the real ontology and signal-rescore triggers,
rolls its synthetic side effects back, and tests repeated recovery. If canonical connector
rows exist, it requires the exact data-preserving refusal and compares policy bytes; it does
not clear canonical records to manufacture a rollback success. The bounded native proof
covers the distinct empty-store restore case. The new proof steps are last, before stack
cleanup, so their disposable pending schema cannot affect earlier baseline proofs.

The complete checkout passes all 3,082 source-coverage checks: 796 classified files, 104
capability sources and 692 support-only sources. All 18 prepared SQL files are explicitly
support-only. Script syntax and whitespace checks also pass.

Commands, ordering, operational boundaries and actual-version promotion steps are in
`supabase/pending/PROMOTION-ORDER.md` under "Prepared repair candidates". This review does not
remove any `live-callers.json` absence or change applied migration/ledger/schema-manifest data.
The copied Release 2 evidence reports no new branch-specific server SQL dependency while
retaining its 15 inherited missing names and separate release gates; it is not release approval.

## Reviewed file bytes

Hashes cover complete UTF-8 files including the final line feed. They identify prepared source,
not an invented migration version or production application receipt. Any later source change
requires refreshing the relevant proof and these hashes before approval.

| File | Bytes | SHA-256 |
|---|---:|---|
| `supabase/pending/world_member_regions_v1.sql` | 7,692 | `81fdd55a6b7d762c022a5e065ab8b23e9ce5d6ed5d304e6e34c630589b7b1d89` |
| `supabase/pending/world_member_regions_v1.rollback.sql` | 2,957 | `fe9020353c79c2ff48e4608157769c10b8fc5308423a2d63095e3ccbe43eca8b` |
| `supabase/pending/member_fronts_publication_visibility_guard_v1.sql` | 9,844 | `cbe8a73441349d48adcec37abd99edd142d53752aebfb21dfd8281f794afd65c` |
| `supabase/pending/member_fronts_publication_visibility_guard_v1.rollback.sql` | 5,984 | `2e5a54bc5dd22a21c20c9a16801035745316789a118ee129e36dd77e30ef8d21` |
| `supabase/pending/20261010009000_creator_site_cohort_grants.sql` | 7,390 | `ee5742c565c7a731d7a1a014dff9df75207f39798fd2aecf046f92b2af6e2a39` |
| `supabase/pending/20261010009000_creator_site_cohort_grants.rollback.sql` | 4,242 | `4e29b0b1558c99cd058e5f4d12cf80b4253c16d7d4bf33c01352225efcdf9a6b` |
| `supabase/pending/20261010009100_creator_publish_cohort_entitlement.sql` | 6,122 | `3dc01a840ed1e24c96a11336b12ebeb80f5d4d964642833fa59a4cb6008c5e0f` |
| `supabase/pending/20261010009100_creator_publish_cohort_entitlement.rollback.sql` | 3,757 | `c67269d7a13d9c1f6d3df4ac3c655531f5b6ec336553e69edcd931e804460a46` |
| `supabase/pending/20261020170000_news_region_leads.sql` | 6,886 | `d134a4564894000b3edd37da4d0bdadf2e5b60666b05b6f95a6f679519d0bc18` |
| `supabase/pending/20261020170000_news_region_leads.rollback.sql` | 3,564 | `fe283c81ed7f5dacdc1b8cd9a98bbaef934167ce583c1e62825a8b96b45e41d8` |
| `supabase/pending/core_reflection_read_indexes_v1.sql` | 2,301 | `598120c83e4148c4aa1158dcee09c1fbd326ebbe766875668d144512dbc4b873` |
| `supabase/pending/core_reflection_read_indexes_v1.rollback.sql` | 1,927 | `0e0d69d34ac346eb7dbf5a27c074c1d3e1b6cc558e09a534e7ac90735b8e75bb` |
| `supabase/pending/ops_signals_digest_window_unique_v1.sql` | 3,174 | `4a134d961224b28447e37ba2741e6822c06b4be40342977a8e345d4181e68d11` |
| `supabase/pending/ops_signals_digest_window_unique_v1.rollback.sql` | 1,676 | `aa72e20b1a0607ff014bebeaab0eba21005b2df5438cc4be82388b6e4ebf93e2` |
| `supabase/pending/world_publisher_verified_geo_v1.sql` | 6,642 | `44290416d9351b030bb615625afce94f2337cd02bec2d5e7804279d5820e3fa2` |
| `supabase/pending/world_publisher_verified_geo_v1.rollback.sql` | 5,943 | `df022f761b39ed0a1ecdc1441665b1a8c9853d8a3c59fa407bf655e05d8722b4` |
| `supabase/pending/20261022015000_market_layer1_preserve_source_policy.sql` | 5,434 | `b58ff5d5bdd13555355adb6dbca68acf7ada418f5d07282fcddf12eb9ab82127` |
| `supabase/pending/20261022015000_market_layer1_preserve_source_policy.rollback.sql` | 5,250 | `4918bd6189ac237df81438fa27974fadb94ffe58545d784ebd7187147e7d882a` |
