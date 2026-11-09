# Verification receipt

2026-11-09. Implementation branch `codex/company-operations-20261109`, based on main `578e683088fdd49fb77848733e70dd4f3af039c3`. The commit containing this receipt is the review artifact. This evidence belongs to this independent tree, not the composed #793 tree and not production.

## Final checks

| Command / check | Result |
| --- | --- |
| `node --import ./workers/mccluster/test/support/offline-network.mjs --test workers/mccluster/test/company-operations.test.mjs` | 32 passed, no skips |
| `COMPANY_TEST_DEPENDENCIES=<installed dependency directory> node --import ./workers/mccluster/test/support/offline-network.mjs workers/mccluster/test/company-operations/native-db.mjs` | 24 assertions passed on native PostgreSQL 17.7 |
| `node --import ./workers/mccluster/test/support/offline-network.mjs --test --test-concurrency=4 workers/mccluster/test/*.test.mjs` | 1,491 passed, no skips |
| `node --test --test-concurrency=4 scripts/test/*.test.mjs` | 2,045 passed, three existing skips, no failures |
| `python3 -m unittest discover -s scripts/test -p 'test_*.py'` | Seven passed |
| `cd core && npm test` | 555 passed |
| `cd core && npm run check` | Passed |
| `python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py` | 2,446 checks passed, 637 sources classified |
| `node --check` on the three new implementation modules | Passed |
| `git diff --check` | Passed |
| Independent code review and focused recheck | Two validation/projection defects corrected; 32 focused tests passed on recheck |

Runtime: Node 24.22.1. Native database: PostgreSQL 17.7, Linux x86_64. The fixture dependency directory already contained `embedded-postgres` 17.7.0-beta.16 and `pg` 8.23.1. Pre-existing Worker suite needed `@fal-ai/client` 1.10.1, satisfied from an already installed matching dependency tree. No dependencies or provider assets were downloaded and no secret was read.

## Native database proof

- Fresh installation works on fixture versions of canonical `orgs` / `org_members`.
- A failure inserted before candidate COMMIT rolls back all module objects; clean retry then succeeds.
- Anonymous/authenticated roles cannot call RPCs or read records. Service role cannot read/mutate the table directly. The narrow service RPCs recheck enabled tenant ownership.
- Different tenants/companies can reuse command IDs without sharing state.
- Eight actual PostgreSQL sessions with different commands and the same expected revision produce one winner and seven revision conflicts.
- Eight sessions retrying the same command produce one durable event and the same receipt.
- Update/delete of committed events is refused, including through the fixture administrator connection.
- Committed owner revocation or disabled organization blocks a previously authorized application's later read.
- Complete synthetic register → document references → cap table → declaration draft → separate human review → external resolution record → disabled handoff survives service reconstruction.
- The module event history is logically exported and restored through narrow append RPCs into a second disposable database. Canonical history fingerprint and final handoff fingerprint match.

The restore is module-scoped. No full platform backup, N-1 upgrade, hosted database migration or production-recovery proof is claimed. Hash chaining is not an external signature. No new legal rights, balances or payments arise from these records.

## Failures found and repaired

- Initial Worker aggregate: 1,490 passed and one failed because the fresh checkout lacked the already-pinned fal client dependency. Supplying the installed 1.10.1 dependency produced 1,491 passing tests; no test or product source was weakened.
- Initial root aggregate: two new RPC names were absent from `pending_only`. Added the exact review-candidate definitions/callers to the existing registry. Final aggregate passed. No migration was promoted.
- Review found regular-expression coercion accepted a JSON array as currency. Added explicit string checks for currency and document hash, with regressions.
- Review found the standalone accounting-proposal projection did not reject corrected ownership while the handoff did. Added the same supersession guard and regression.
- Handoff digest now includes the accounting proposal as well as the distribution packet; the digest field alone is excluded.

## Not run / not implemented

No live authentication or artifact-storage integration, Control browser/mobile UI, composed #793 acceptance, full canonical-schema reset/advisor suite, CI on the published branch, hosted upgrade, payment provider, tax/withholding, securities processing, legal filings or real company documents. No production migration, deployment, feature activation, external communication, financial transfer or public publication occurred.

Integrators must rerun relevant aggregate, browser and database checks on their actual composed tree. Merging main triggers deployment in this repository; green isolated tests are not permission to merge or release.
