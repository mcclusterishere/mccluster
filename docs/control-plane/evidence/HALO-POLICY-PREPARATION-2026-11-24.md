# Halo policy database preparation — 2026-11-24

**Prepared, unapplied, and awaiting execution checks on the exact draft head.** This is Equity Uprise shared-platform database support only. Registration remains optional; no Halo route, owner-access rule, UI, Worker, Core setting or module activation changes here.

## Scope and authority

PR #833, branch `prime/hitmans-halo`, was reviewed at head `765f3b0981ab236f690999e5660a234e8754e761`. Current main `7f2644b417994d1b994d763485b6448906bdfdb0` is the integration base. The canonical database is `zmnhbrjyhxzhkxmhkexs`. Production actions for this preparation were SELECT-only schema-catalog reads. No application rows, migration authors or credentials were read, and no production change occurred.

The migration adds `halo` to two CHECK constraints and to the allowlists of three existing policy RPCs. Their bodies remain the applied ones except the allowlists. Applying it creates no policy row; installation and enablement remain separate owner actions. A missing registration already has a supported caller response.

## Findings and changes

The original pair accepts unfamiliar function/schema state and does not require a fresh READ COMMITTED snapshot. Recovery also inspected history before table locking. The corrected pair:

1. Refuses every transaction isolation other than READ COMMITTED before catalog or application-row reads.
2. Takes the same transaction advisory lock in both directions.
3. Takes ACCESS EXCLUSIVE locks on the policy and command tables in the same order before checking schema or history.
4. Accepts only the complete applied-baseline state or complete known-Halo state, using exact catalog fingerprints. Function definitions/properties, owners and ACLs, relation/sequence permissions, columns/defaults, all constraints/indexes, protection triggers, RLS, policies and rules are included.
5. Refuses recovery once either table records Halo in any organization. It deletes no history.

The five-second lock timeout remains in place. Migration pair coordination and table DDL are covered by the locks; administrative function DDL must be serialized with a release. This work makes no security claim against a database administrator changing objects independently.

## Evidence that actually completed

At **19:01:57 UTC**, production PostgreSQL **17.6** returned the catalog evidence in [halo-policy-catalog-2026-11-24.json](halo-policy-catalog-2026-11-24.json). The live ledger count was 389 in the preceding catalog read at 19:00:30 UTC.

A disposable PostgreSQL **17.6** process executed the exact applied `20261117144103_eup_module_policy_v1.sql` with bounded identity fixtures. Its entire collected catalog detail equaled production's detail. The original Halo file then executed there and produced the recorded extension fingerprints. The command exited 0 and stopped the disposable server.

The three forward RPC definitions were compared directly with the applied file plus only the Halo allowlist; all three recovery definitions equal the applied file. All six comparisons passed during preparation.

## Proof prepared; no corrected run claimed

`scripts/halo-module-policy-native-check.mjs` has two modes:

| Mode | Baseline | Purpose |
|---|---|---|
| Default | Exact applied policy SQL; bounded Auth/organization fixtures | Reproduce the historical pair's drift/isolation failures and prove the corrected candidates, roles, data preservation and real concurrency. |
| `--full-reset` | Actual isolated Supabase database after the repository's complete canonical/replay reset | Verify exact reset ledger rows and run the corrected suite with real base roles, Auth, tenancy, grants and triggers. No base substitutes are installed. |

The historical SQL is an explicitly labeled test fixture, pinned to its original Git blob identities. It is not another pending migration.

The suite includes both-direction drift refusal across function body/security/configuration/grants, table/column/sequence grants, unknown or unvalidated constraints, disabled/missing protection triggers, unexpected columns/policies/overloads, RLS and indexes. Deliberate drift is fault injection inside rolled-back transactions. It also exercises the three old modules, optional absent-Halo behavior, install/enable/drain/disable and replay, role denials, empty recovery, either type of history, two-way migration serialization, concurrent table DDL, a five-second timeout, install racing recovery, and an obsolete snapshot.

The executor became unavailable before the corrected behavioral suite ran. **No pass count is claimed for either mode.** Reconciliation CI is wired to run the static checks, both native modes and upload `halo-policy-proof` reports. The source-map and contract jobs remain mandatory. Do not approve or apply the candidate until the exact draft head is green and its reports are read.

## Promotion decision

The file to approve, after those gates pass, is:

`supabase/pending/eup_module_policy_halo_v1.sql`

Its recovery file is separately approved only if needed:

`supabase/pending/eup_module_policy_halo_v1.rollback.sql`

Immediately before an approved action, run the read-only preflight again and require one complete known fingerprint set. Unknown state blocks the action. Use README's existing per-file promotion flow, record the actual ledger version and statement bytes, and refresh the ledger/manifest/snapshot together. No new object names or missing live callers are introduced, so `live-callers.json` does not change for this extension. Do not merge, deploy, install or enable the module as part of this preparation.
