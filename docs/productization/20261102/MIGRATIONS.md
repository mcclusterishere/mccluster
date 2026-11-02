# Prepared versus applied migration plan

**Target if later approved:** Supabase `zmnhbrjyhxzhkxmhkexs`. **Applied by this task: none.** Live ledger: 355 entries, captured in `evidence/production-migrations.json`. Prepared copies are exact #681 SQL, not production ledger rows and not a clean customer installer.

## Minimum sequence

1. Existing `auth.users`, M identity/link/profile and org/membership authority must match the inspected schema.
2. `member_fronts_v1.sql`: front config storage, forced RLS, public front-media bucket and owner storage policies.
3. `managed_projects_v1.sql`: owner-scoped named websites; no auth/org duplication.
4. `managed_project_identity_v1.sql`: immutable project UUID/slug/owner/M identity guard.
5. `customer_site_storage_v1.sql`: quota/reservations/recovery and restrictive browser-write policy. Coordinate Worker and editor upload routing; this changes existing upload authorization semantics. No direct-upload fallback.
6. `customer_site_modules_v1.sql`, then `customer_site_addresses_v1.sql`: opt-in switches and immutable free addresses, with no customer seeds.
7. Optional `canonical_artist_bindings_v1.sql`: explicit operator grant/bind/revoke audit; no display-name authority or seeded owner. Apply only once. Repetition deliberately errors inside its transaction; verify ledger/catalog before retry.

Exact SHA256, source path, commit, reapplication and containment notes are in `migration-manifest.json`. Six foundation definitions replay twice on a disposable fixture; optional artist definition is verified once and its duplicate failure is asserted. This is not proof that `IF NOT EXISTS` repairs schema drift. No new migration filename/version was invented or promoted.

## Read-only preflight before proposing production application

Re-query ledger and actual tables/columns, constraints, indexes, triggers, policy expressions, role grants, function signatures/bodies/search paths, storage buckets/public flags and known signed-upload lifetime. Compare exact function definitions, not just names. The current evidence shows the seven listed free-site tables absent and the selected front-media bucket absent. Existing metadata checks are point-in-time, not permanent permission to create.

Capture an approved database/storage backup with a verified restore target and retention plan before changes. Keep customer content, private transcripts and credentials out of Git/this report. Inspect existing `front-media` bytes and unknown/missing size metadata if a concurrent release creates that bucket before execution. Preserve over-quota content; block new writes until reconciliation. Let older signed upload URLs expire before relying on restrictive Storage RLS.

Each SQL apply must fail closed on errors; never continue a blanket directory loop. Snapshot the catalog before/after, exercise actual anon/authenticated/service access under approved test identities, and record exact SQL bytes and actual assigned version. Only then promote to canonical `supabase/migrations` and refresh ledger/schema evidence/live-caller contracts. Names-only ledger parity is insufficient.

`member_fronts_v1` and `managed_projects_v1` are not wrapped together in one cross-file transaction; a failed later stage can leave an installed but inactive subset. Keep entry points disabled, inspect the partial state and complete/reconcile deliberately. Do not blindly rerun the optional artist file or auto-delete rows.

## Containment and rollback

Prefer disabling the affected entry point/feature and reverting to a compatible application release while preserving tables, audit history and uploaded objects. The quota restrictive policy blocks legacy browser writes, so a rollback to a pre-quota frontend alone is not a working upload rollback. Either keep the compatible upload Worker available or explicitly show uploads unavailable. Do not automatically drop populated tables/buckets, relax RLS, restore public writes or return to mutable asset grants. Review a data-preserving corrective migration separately if necessary.

Schema approval does not approve public content, owner grants, DNS, legal terms, payment configuration, paid compute, provider publishing or deletion. A combined Worker/static SHA, staged rollout plan, real Storage verification and exact target/data impact are still required.

## Reproduction

On an authorized disposable machine with Docker and the pinned image available:

```sh
python3 docs/productization/20261102/replay-prepared.py /path/to/checkout-at-5e020833
```

The runner verifies every source hash, creates only its own network-isolated container, exercises ordering and repeat behavior, checks forced RLS/browser revokes/identity trigger/restrictive Storage policy and prints RPC grants. It cleans up its own container. Native owner-storage and concurrent-quota tests were additionally run from #681's existing scripts. The PGlite minimum-flow and domain-recovery scripts use the exact existing SQL with fixture auth/storage services. These are separate from a full 355-migration Supabase reset or real managed Storage proof; neither was claimed here.
