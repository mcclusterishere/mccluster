# Paid-media recovery prerequisite applied

## Production receipt

- Project: `zmnhbrjyhxzhkxmhkexs`.
- Applied with the Supabase migration runner in one transaction at version
  `20261110220135_media_operation_claims_v2`, before merging PR #793.
- Source reviewed: PR #793 head `9d29616021337806860bab891163844dca2f1d26`,
  Git blob `39bc6813f4d8e3ab05682a97cc6cf8675424e0c8`.
- The committed SQL is byte-identical to the one stored production statement:
  38,390 bytes, MD5 `f0c95ed8158bdabd4dbcac7f2de18950`,
  SHA-256 `a104b690f4a060342f574bfdc9410a9f55e8e08d8ade18e2902a950d42e0db1c`.
- Ledger: 364 rows; SHA-256
  `6fcada89fc8d3d3621b4c49242ca84a1aff050758cb1ecd60753cfbbbba35054`.
- Read-only preflight at 22:00:18 UTC found neither duplicate-operation groups
  nor duplicate-provider-request groups. The candidate was absent.
- Read-only verification at 22:01:56 UTC found all six new functions and four
  indexes. Each function permits service-role execution and denies anon and
  authenticated execution. The claims table remains RLS-protected.
- All six frozen v1/cost-control/release function-definition hashes match the
  preflight. The row counts remain 18 media jobs and zero claims.
- The dated production snapshot contains catalog hashes, grants and schema
  shapes, not user rows or function bodies:
  `../production-schema-snapshot-2026-11-10.json`.

## Independent local proof

The exact SQL passed `scripts/test-media-recovery-db.sh` against disposable
PostgreSQL 17.11 before apply: all 24 behavior scenarios; actual API-role grants;
three-session takeover; takeover held inside its update while two callers wait;
operator-bind versus retry without deadlock; rollback twice; frozen definitions
preserved; reapply; and both duplicate guards rolling back atomically. A local
Node pg client adapter supplied the script's psql interface; the server and all
concurrent sessions were native PostgreSQL, not an emulation.

## Release boundaries

The schema is applied. This receipt does not claim PR #793 is merged, the Worker
is deployed, or a live paid generation was performed. The new recovery sweep and
Arcade cloud flag remain disabled. Other pending migrations and owner decisions
are unchanged. OVH requires its separate deployment path to consume ledger 364.

The reset manifest must be regenerated from the hosted disposable Supabase reset
artifact before this release merges. Existing production-versus-reset drift is
tracked separately; a successful ledger reconciliation is not a claim that all
historical schema differences are repaired.
