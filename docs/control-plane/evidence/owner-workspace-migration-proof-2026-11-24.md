# Owner enrollment and workspace migration proof — 2026-11-24

## Status and scope

Prepared for draft PR #821. **Neither owner migration was applied to production.**
The user's current direction is prepare/prove only, with explicit per-file approval before
production application. The separate 389-row applied-ledger reconciliation comes first.
No runtime deployment, feature activation or physical-device proof is claimed here.

Reviewed starting head: `e996acf2f5a2d560262fdf382d5b60664163904d`.
The local review integrated main `7f2644b417994d1b994d763485b6448906bdfdb0` in merge
`50c63e9d` before preparing this correction. Those commits identify the baseline;
the exact content reviewed by the final native proof is pinned below. A later main merge
still requires green exact-head CI and fresh source-hash review.

## Defect reproduced before the correction

The original PR had no rollback for either owner migration. Its workspace file installed
a safe four-argument claim wrapper, but the older pending yield migration could drop that
wrapper and install the v2-derived five-argument claim body. The yield rollback could also
replace it with legacy v2. This bypassed workspace pin/reservation/cleanup admission rules.
The original workspace file also accepted an already installed yield function.

The same native regression runner, against the original SQL on disposable PostgreSQL 17.6,
stopped at this assertion before any proposed correction:

```text
AssertionError [ERR_ASSERTION]: Missing expected rejection:
workspace refuses installed yield without modifying it
```

This is a reproduced database behavior failure, not a PGlite concurrency claim. The failure
receipt is reduced to its assertion text to exclude machine-local stack paths. No production
record, credential, token, transcript or private identity is included in this evidence.

## Correction and boundaries

- All six forward and recovery files require `READ COMMITTED` before taking a lock or
  reading catalog/data state. A transaction-wide snapshot could otherwise miss rows
  committed while recovery waits. Refusal uses SQLSTATE `55000` and
  `COMPUTE_READ_COMMITTED_REQUIRED`; isolation is never silently changed for the caller.
- Forward and recovery files then take a common advisory transaction lock and set a
  five-second lock timeout. The migration runner owns one transaction for the whole file.
- Workspace and legacy yield refuse both unsupported apply orderings and refuse a yield
  rollback over workspace. No combined scheduler feature was invented.
- Exact SHA-256 function-body pins and metadata checks refuse altered or partial baseline
  state before replacing any function. The workspace rollback accepts a full reviewed
  installation or the exact already-restored legacy baseline, never an orphan wrapper.
- Both new rollbacks refuse saved or active new state. Workspace recovery retains enrollment;
  enrollment recovery refuses workspace. No force-delete option or cascading drop exists.
- Empty rollback restores the canonical lease-authority-v2 body and its original owner and
  grants. Node/task/lease/transcript data is never deleted by these recovery files.
- Runtime function bodies are otherwise unchanged. Core's owner membership check authorizes
  credential issuance; the SQL consume function trusts the resulting service-issued record
  and enforces credential scope, expiry and one use. This is not a claim that the database
  independently reauthorizes `issued_by` membership.

## Dated read-only production preflight

The 2026-11-24 read-only review found enrollment/workspace objects absent, two compute nodes,
30 tasks and 40 leases. The corrected active-state query at 17:11:37 UTC found zero
`leased`/`running` leases, zero queued/leased/running tasks, zero scoped nodes, zero pinned
workspace tasks, zero routed workspace messages and zero active resident jobs. These are
aggregate dated observations, not a guarantee of future state.

The live four-argument claim body matched the applied source
`supabase/migrations/20261020210718_compute_lease_authority_v2.sql`:

- `prosrc` SHA-256: `f58ca22a92c5950fe79adb88e1b0f64d0a815f2e42a90c88aea8ae251df8dc15`.
- `prosrc` MD5: `325ea1f3b1a23e1dc49a07b775968678`.
- `pg_get_functiondef` MD5: `d0be1228eb84144084935752de0c1185`.
- Owner `postgres`, language `plpgsql`, security definer, fixed
  `search_path=public, extensions, pg_temp`, four expected arguments, default lease 120.
- Start, heartbeat and complete lease functions were present and service-only.

A production apply remains disallowed without the per-file approval and a fresh preflight.

## Final native result

The final run used PostgreSQL 17.6 and the actual six migration/recovery files, applying each
inside an explicit driver transaction. It passed **196 assertions**, including 15 logged
blocked-session races and an additional observed expiry-during-lock wait. The runner checks:

- Single-use consumption, reissue invalidation, expiry after waiting, and two credentials
  competing for the same device key without burning the losing credential.
- Admission through v4 and the legacy wrapper, pair-versus-ordinary work in both lock orders,
  reservation renewal/expiry recovery, release/enqueue and cleanup admission fences.
- Concurrent turn identity, stop/enqueue, stop/lease and stop/answer orderings.
- Actual denied calls for all 15 RPCs under `anon` and `authenticated`, all three new tables,
  plus canonical owner/member row-level security on conversations.
- Both scheduler installation orders and rollback conflicts, altered function bodies,
  incomplete cleanup columns and orphan wrapper refusal without partial mutation.
- All six files refuse Repeatable Read while another native connection holds the shared
  migration lock, proving refusal precedes that lock wait. Historical rows and the claim
  definition remain unchanged. Separate enrollment and workspace recovery cases establish
  an empty Repeatable Read snapshot, commit a new row from another native connection,
  confirm the old snapshot cannot see it, and verify refusal preserves the committed row
  exactly. These isolation and preservation cases add 16 assertions to the prior proof.
- Apply twice, refused rollback with data and with a cleanup-only hold, empty rollback,
  reapply and rollback again, preserving two synthetic preexisting nodes, 30 tasks and
  40 historical leases byte for byte, plus original legacy function ownership and grants.

The sentinel rows are synthetic and use a separate fixture organization. They demonstrate
preservation of the same shape/count of existing compute history; production rows were not
copied into the proof database.

```json
{
  "suite": "owner-workspace-native",
  "engine": "PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 7.5.0-3ubuntu1~18.04) 7.5.0, 64-bit",
  "checks": 196,
  "passed": true,
  "concurrent_sessions": true,
  "full_reset": false,
  "existing_history_preserved": {
    "nodes": 2,
    "tasks": 30,
    "leases": 40
  },
  "production_changes": false,
  "physical_hardware_verified": false
}
```

## Full reset and CI gate

The local successful proof uses selected canonical compute/queue SQL with explicitly bounded
peripheral Auth stand-ins. **It is not proof of the complete repository reset.**
Reconciliation CI runs the same runner with `--full-reset`. Its initial attempt in
[run 45449866610, job 138643647250](https://github.com/mcclusterishere/mccluster/actions/runs/45449866610/job/138643647250)
failed before the native behavioral proof: the guard incorrectly expected only the 384
production versions, while the repository reset correctly staged 468 versions, including
84 replay-only foundations. This was a test precondition defect, not a migration failure.

The corrected guard follows `scripts/supabase-local-reset-with-replay.sh`: canonical
filenames must exactly match `production-ledger.json`; replay files replace equal filenames
or add replay-only foundations; duplicate versions are rejected. The reset database must
match every planned **version and name**, with no missing or unexpected rows. Replay-only
versions are never inserted into the production ledger. The plan at this reviewed baseline
contains 384 canonical files plus 84 replay-only files. A later ledger update is derived
from its actual files rather than a hard-coded count.

Full-reset mode uses the real baseline roles, grants, tables and triggers and never executes
the stand-in setup. The corrected head `83671ec493287c04ef177d76508daa69f4b647f2`
passed [run 45452504057, job 138653087813](https://github.com/mcclusterishere/mccluster/actions/runs/45452504057/job/138653087813)
on PostgreSQL 17.6: **181 assertions, full_reset: true**, with the exact 468-row
canonical-plus-replay plan and preserved synthetic history. The retrieved job log identifies
tested PR merge `a27594545c20f0a8536c7f1b9c3ea16941178abf`, combining that head with main
`7f2644b417994d1b994d763485b6448906bdfdb0`, and records the successful native receipt at
`2026-11-24T17:50:12.6154556Z`. The pinned PGlite device/workspace/yield CI job and Core/Worker
contracts also passed on that head.

Later follow-ups add truthful source-map context comments, move the owner proof after the
transactional workstream integration test so its retained synthetic history cannot affect
later baseline checks, and add the strict isolation preconditions and 16 assertions described
above. Runtime SQL function bodies remain unchanged. The **196-check local result is the
new guarded revision and remains a bounded proof**. That head must pass full-reset CI again;
the cited 181-check run establishes the preceding corrected full-reset result, not the newer
isolation-guard revision.

Commands and operational recovery order are in `supabase/pending/PROMOTION-ORDER.md`, section 16.
The new test is executable CI infrastructure, not an unrun standalone test added to the repo.
The regenerated repository source-coverage report classifies the proof and every reviewed
forward/recovery file as support, with no new building capability. Syntax and whitespace
checks pass. No fresh local browser or PGlite run is claimed.

## Exact reviewed bytes

Hashes cover the complete UTF-8 file, including its final line feed. These are review hashes,
not invented production ledger versions or receipts. The workflow and runner hashes identify
the proof implementation as well as the SQL it exercised.

| File | Bytes | SHA-256 |
|---|---:|---|
| `supabase/pending/compute_owner_enrollment_v1.sql` | 8,658 | `6fffa6e41a4be022555da1d757e2fc4bfc95bead4f34a486ff7cb71310d0c723` |
| `supabase/pending/compute_owner_enrollment_v1.rollback.sql` | 5,018 | `3e076196ef16ae8f22aa15924fa9fd319f749c78cccfd8a53cc349441fec3476` |
| `supabase/pending/compute_owner_workspace_v1.sql` | 50,124 | `5e9ce6a9866c64676c2094d9bc22bb6563286a0f7cd4ad6b9aab47a29db92be1` |
| `supabase/pending/compute_owner_workspace_v1.rollback.sql` | 22,345 | `032f6ce7df045ced48cf7555a28e2dfbff923751c7c5bfeb06ee6e21a3ebf486` |
| `supabase/pending/compute_claim_task_yield_v3.sql` | 14,203 | `a05f1ae4fec5684629142004a5ced08625faa466b7309d25428c244e211c80c5` |
| `supabase/pending/compute_claim_task_yield_v3.rollback.sql` | 12,595 | `b5ce2e5f206fc9197ea019e5c38bf45dde984250d1528365663623da7f78d057` |
| `scripts/owner-workspace-native-check.mjs` | 37,019 | `8b3177577891211132b854b2ecef4671e03eaad699bc59370357c2723f9b43d0` |
| `scripts/native-admin-test-db.mjs` | 3,842 | `43ab5d522112d8a4569a69556669d389f2a644cf1fcc747155fde2e5664908cb` |
| `.github/workflows/reconciliation-ci.yml` | 18,960 | `a642f29b3cb892496bd66131791f13b099a1ee6dfa7ae5b1a50d2e9b1346aeca` |
