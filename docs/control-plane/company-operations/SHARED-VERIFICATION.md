# Shared ledger and organization architecture verification

Review branch `codex/shared-contribution-ledger-20261109`, based on the published
company-operation commit `cc9e0d606d7cfa4a073f402f02bf92490efa9e3b`.
Evidence date: 2026-11-09. All records and identities used in tests are synthetic.
No real trust/account, participant records, model execution or financial transfer
was created or verified.

## Test commands and results

| Check | Final local result |
| --- | --- |
| `node --import ./workers/mccluster/test/support/offline-network.mjs --test workers/mccluster/test/company-operations.test.mjs workers/mccluster/test/company-shared-ledger.test.mjs workers/mccluster/test/company-organization.test.mjs` | 63 passed |
| `COMPANY_TEST_DEPENDENCIES=<existing local node_modules> node --import ./workers/mccluster/test/support/offline-network.mjs workers/mccluster/test/company-operations/native-db.mjs` | 31 native PostgreSQL assertions passed |
| `node --import ./workers/mccluster/test/support/offline-network.mjs --test --test-concurrency=4 workers/mccluster/test/*.test.mjs` | 1,522 passed |
| `node --test --test-concurrency=4 scripts/test/*.test.mjs` | 2,045 passed, three existing skips |
| `python3 -m unittest discover -s scripts/test -p 'test_*.py'` | Seven passed |
| Syntax checks on shared-ledger, organization and service modules; `git diff --check` | Passed |
| `python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py` | Passed after classifying this receipt |
| Independent review and recheck | Confirmed fixes for both findings below; ledger and organization tests passed |

Node 24.22.1; native PostgreSQL 17.7. Existing installed test dependencies were
used. No package install, hosted credentials or network provider was involved.
The extension changes no Core code. The underlying company branch's Core proof
remains in its own receipt; it is not a new composed-product CI result.

## New proofs

- Distinct participant, recorder and reviewer; money/pledges/work/asset quantities
  and valuations remain separate and never become an invented bank balance.
- Private immutable evidence scope/hash checks; appropriate evidence kinds;
  currency/type validation; owner-only ingress and AI review denial.
- Policy versions, rejected/accepted contributions, disputes and corrections;
  permanent supersession, no predecessor resurrection or sibling/cousin double
  counting, and stale proposal rejection without approval.
- Exact allocation totals, complete period reconciliation, preserved differences,
  held mismatches, stale dependent handoffs and permanently disabled execution.
- Base history replay through the extension without changing existing records;
  base-only readers fail closed on unfamiliar extension history.
- Human operational sponsor, role/campaign/milestone versions and seat history;
  evidence-backed reported work is distinct from verified execution.
- Canonical reporting timezone and explicit periods; immutable historical/as-of
  report snapshots; per-role submitted/approved/blocked/missing-entry indicators.
- Native SQL stores the complete contribution and role/daily-entry/weekly-report
  journey through the same narrow RPCs. The report contains one approved AI work
  **report**, but zero verified completions because no executor ran.
- Logical restoration into a second disposable database reproduces both the
  distribution handoff and weekly report fingerprints.
- Existing native eight-session concurrency, duplicate retry, tenant/role denial,
  immutable records and interrupted first-install rollback tests remain passing.

## Defects found before publication

Independent review reproduced a serious correction-lineage error: disputing a
corrected entry could revive an older entry and its old handoff, and permit
cousin corrections to double count. Approved supersession is now permanent even
when the successor is disputed. Regressions cover no resurrection, no revived
handoff, multilevel lineage, competing pending corrections and cousin forks.

Review also found stale proposals could not be rejected because approval-only
freshness checks ran on both decisions. Rejection now retains independent-review
and pending-status checks but does not require approval readiness. Tests cover
stale contributions, valuations, reconciliations and distribution proposals.

An organization review identified that accepting arbitrary entry reporting zones
could silently omit members from a weekly report. The human mandate now records
a canonical timezone; mismatches and inconsistent stored zones fail closed.

## Boundaries not verified or enabled

No direct member/AI ingress, identity-bound seat resolver, trusted canonical job
completion resolver, autonomous executor, Control browser/mobile UI, full
production-schema reset, hosted upgrade, production restore or composed #793
acceptance was run. No report schedule or delivery, blockchain transaction,
wallet, bank account, legal trust/office, ownership grant or payment was created.

Only an architecture and synthetic local workflows are tested. Public branch
availability is separate from deployment or production readiness. The native
restore is module-scoped, not a full corporate disaster-recovery claim. Hash
chaining alone is not independent tamper-proof auditing. All existing legal,
financial, production and external-communication approval boundaries remain.
