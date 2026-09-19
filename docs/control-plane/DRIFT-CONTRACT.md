# McCluster Control-Plane Drift Contract

## Objective

McCluster must never silently operate in a state where GitHub, Supabase, Cloudflare, OVH, or compute-node configuration disagree about the intended control plane.

Absolute prevention of every transient mismatch is impossible during deployments. The enforceable invariant is **zero silent drift**: every mismatch is detected, reported, and either reconciled automatically or blocks further promotion.

## Source of truth

1. GitHub is desired state.
2. Supabase is durable operational state, never the source for unrecorded schema design.
3. OVH and compute nodes are observed runtime state.
4. Cloudflare is observed edge state.
5. Production mutations that are not represented in Git are emergency-only and must be reconciled into Git before feature work continues.

## Deployment law

- Production deploys use an exact 40-character Git SHA already contained in canonical `main`.
- The OVH reconciler compares the live Core tree, installed McCluster systemd units, and deployment provenance against the exact promoted checkout every cycle.
- Matching Git SHA alone is not proof of parity.
- Runtime drift at the same SHA triggers a redeploy from the approved revision.
- Secrets stay outside Git. Non-secret node capability manifests are Git-managed.

## Supabase law

- Every new production schema mutation must have a migration file under its actual production version and name.
- `supabase/production-ledger.json` records the complete ordered production ledger returned by Supabase, including the historical era that predates canonical Git reconciliation.
- Legacy `0001_...` style migrations are clean-replay reconstruction files. They rebuild historical state but do **not** claim to be the original Supabase migration versions.
- `production_sql_cutover_version` in the ledger marks the point from which exact production-version SQL is mandatory. The current cutover is `20260919020830`.
- The backend-only `system_migration_attestation()` RPC exposes only:
  - migration count;
  - latest version and name;
  - SHA-256 of the ordered migration ledger.
- `core/drift-contract.json` pins the expected canonical production attestation.
- CI recomputes the SHA-256 of the complete committed production ledger and rejects count, ordering, version, name, or hash drift.
- CI also requires every post-cutover ledger entry to have the exact `<version>_<name>.sql` file and rejects post-cutover migration files that are not in the production ledger.
- Host health treats migration-ledger mismatch as **critical**.
- Emergency live migrations must be mirrored into Git with their actual production version before unrelated work continues.

## Compute-node law

- Node private identity stays local.
- Enrollment secrets are bootstrap-only and removed after enrollment.
- Non-secret capability manifests are stored under `core/node-manifests/`.
- A node may advertise only capabilities whose local executor passes its health probe.
- Node heartbeats publish observed inventory and capability readiness back to canonical Supabase.

## Emergency mutation procedure

When production must be changed before the normal promotion path:

1. Record the exact mutation and reason.
2. Apply the smallest reversible change.
3. Verify production behavior.
4. Create the matching migration/config/code change in Git using the actual production version.
5. Update the drift contract if the Supabase ledger changed.
6. Run the drift guard.
7. Do not resume unrelated feature work until Git and production converge.

## Failure policy

Drift is not an informational condition.

- database ledger mismatch: critical;
- unknown or mismatched deployment SHA: degraded/critical according to reachability;
- same-SHA runtime file/unit mismatch: automatic redeploy;
- stale autonomous job lock: automatic recovery;
- unapproved repository target: rejected before enqueue;
- compute node unavailable or capability unhealthy: capability removed from readiness until healthy.

The target state is not "nothing ever changes." The target state is **nothing changes silently**.
