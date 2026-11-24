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

- Forward and recovery files take a common advisory transaction lock and set a five-second
  lock timeout. The migration runner owns one transaction for the whole file.
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
inside an explicit driver transaction. It passed **180 assertions**, including 15 logged
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
  "checks": 180,
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
the stand-in setup. Its successful run on the corrected PR head is still pending. The
180-check native result above remains a local bounded-baseline result. Existing pinned
PGlite device, workspace and yield checks also remain CI gates; no fresh local PGlite
result is claimed here.

Commands and operational recovery order are in `supabase/pending/PROMOTION-ORDER.md`, section 16.
The new test is executable CI infrastructure, not an unrun standalone test added to the repo.
The complete checkout also passes all 2,978 repository source-coverage checks: 770 classified
sources, with 104 capability sources and 666 support-only sources. The new native runner is
verification support; its addition does not create a product capability. Syntax and whitespace
checks pass. No fresh local browser or PGlite run is claimed.

## Exact reviewed bytes

Hashes cover the complete UTF-8 file, including its final line feed. These are review hashes,
not invented production ledger versions or receipts. The workflow and runner hashes identify
the proof implementation as well as the SQL it exercised.

| File | Bytes | SHA-256 |
|---|---:|---|
| `supabase/pending/compute_owner_enrollment_v1.sql` | 8,111 | `2be3f91854b953eacb6c7bec8f574c409a174290026ea116752a8db029f7c0ad` |
| `supabase/pending/compute_owner_enrollment_v1.rollback.sql` | 4,471 | `a6e17ab7b741a00f107c83d6aa02a4f45788e43e922b6aeafc895439ac201890` |
| `supabase/pending/compute_owner_workspace_v1.sql` | 49,577 | `b4270aa12672f4d54cf5b765bf30752fef369485de25b8a1fc7374884f9b47f8` |
| `supabase/pending/compute_owner_workspace_v1.rollback.sql` | 21,798 | `5718c5f1498a608186c7140f54cefe157c7cdd1ccd1357c0c0121f02b6407563` |
| `supabase/pending/compute_claim_task_yield_v3.sql` | 13,656 | `8bd5e9e9d3b0c6c14fd8b07f09b657373c5441ef4769fa1934cbd428019c31e9` |
| `supabase/pending/compute_claim_task_yield_v3.rollback.sql` | 12,048 | `db474edc66c82dfa3f90089141f939ac24aff14e3d29dea5cb7913fc7be63d52` |
| `scripts/owner-workspace-native-check.mjs` | 34,326 | `1cb62cabe1c4dca9197cfad1173d2ed14421c554fe71b8d8e8da384b8bc7abf1` |
| `scripts/native-admin-test-db.mjs` | 3,842 | `43ab5d522112d8a4569a69556669d389f2a644cf1fcc747155fde2e5664908cb` |
| `.github/workflows/reconciliation-ci.yml` | 18,804 | `eacde125e3135763ec99733e0012be8b328460736d731f907398e3b0d810589f` |
