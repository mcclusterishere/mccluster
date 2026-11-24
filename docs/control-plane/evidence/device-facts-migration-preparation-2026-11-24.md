# Device-facts migration preparation — 2026-11-24

This review supports the existing Core compute fabric used by Equity Uprise.
It adds no building capability, backend, activation or production write.
The sole production project remains `zmnhbrjyhxzhkxmhkexs`.

## Candidate and ordering

Draft #834 depends on the corrected #823 attestation base. Its original branch
changed `compute_job_attestations_v1.sql` to add a column and told operators to
reapply it. The prepared branch keeps that base file and its recovery exactly
as reviewed in #823 and introduces a separate file:

1. `supabase/pending/compute_job_attestations_v1.sql`, with its own approval
   and deployed gateway prerequisite.
2. `supabase/pending/compute_job_attestations_device_facts_v1.sql`, separately
   approved after the base.

Never replay an applied migration with different SQL. The extension adds one
nullable JSONB object with a 32,768-byte UTF-8 JSON-text bound. It verifies the
base columns, row security and narrow service SELECT/INSERT grants. The
existing absent-column fallback continues to save the base signature and
reports facts unbound; its message now names the separate extension.

Both extension files require READ COMMITTED and a five-second bounded
exclusive table lock before inspecting metadata or saved state. Recovery
removes only a known empty facts column, preserving every legacy signature.
Saved facts require a reviewed forward repair.

## Recovery defect reproduced and corrected

An independent PostgreSQL 17.6 review reproduced a gap in the first prepared
recovery: `pg_index.indkey` did not reveal expression or predicate-only
dependencies. Dropping the column silently removed both a synthetic expression
index on `device_facts->>'source'` and a partial index on `node_id` with a
`device_facts IS NULL` predicate. The proof transaction was rolled back.

The corrected recovery also checks `pg_depend` for indexes depending on that
attribute. Two added native cases require SQLSTATE 55000 and preserve the exact
index definition and entire signed receipt. No destructive override exists.

## Verification record and execution boundary

Before the executor became unavailable, the prior candidate passed 29 native
checks on PostgreSQL 17.6, 11 real gateway/node-agent synthetic staging steps,
and the full Core suite (952 passed, zero failed, 22 explicit skips). Those
results describe the earlier candidate, before the two new index cases.

The forward, old recovery and old native runner were reconstructed from the
complete prior source reads and matched their recorded SHA-256 values exactly
before the recovery patch was added. Other integration files were reconstructed
from the pinned published #823 and #834 sources, preserving both branches'
changes. The former local proof receipt is unavailable with the executor; this
document does not fabricate its original timestamps or individual results.

The current candidate requires its actual GitHub Actions result:
`Compute device database proof` now runs for stacked PRs, rebuilds the entire
canonical schema, executes the native runner and scheduler proof, then runs
the real gateway/node-agent synthetic staging. The runner records individual
assertions and SQL hashes in the uploaded artifact. The two new cases are
unexecuted until that job passes. No prior 29-pass result is presented as a
pass for the corrected recovery.

Commands:

```sh
node scripts/compute-device-native-check.mjs --from-reset --report <local-proof.json>
node scripts/compute-scheduler-sql-check.mjs
node scripts/staging/device-jobs/run.mjs --out <local-proof-directory>
node --test scripts/test/rpc-names-exist.test.mjs
python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py
```

The database runners accept only an explicit disposable local PostgreSQL
configuration. Production catalog reads at 18:42:43 UTC found 389 ledger rows
and no attestation or scheduler table. The extension therefore cannot precede
the base there. Recheck the live schema immediately before an authorized
application. Records-only #836 must restore main's ledger parity before release.

## Exact SQL for named-file review

| File | Bytes | SHA-256 |
|---|---:|---|
| `compute_job_attestations_v1.sql` (unchanged #823 base) | 3,372 | `05b6d03a2e2243eb3a20bf9859cc01f4fee529d65d6ba7c9894de05d71e1ad4a` |
| `compute_job_attestations_device_facts_v1.sql` | 4,351 | `2536ef17d9d0c737fb67b4be730f7f9ecf67fedd0d37e99482ecb47d20781583` |
| `compute_job_attestations_device_facts_v1.rollback.sql` | 3,048 | `330181dc0ad9adba3798ade32378950e6fac94e86443592c3c579585592e3cc3` |
| `scripts/compute-device-native-check.mjs` | 28,438 | `33096a96af91e390a436213feb128ee1fefa3bb19957c5a1da508fbbde31ecc1` |

The facts remain node-reported observations. This database proof does not attest
physical hardware, establish engine binding, or authorize real-device access.
The original branch's physical-device and access prerequisites remain open.
No SQL was applied, no Core promoted and no feature enabled by this preparation.
