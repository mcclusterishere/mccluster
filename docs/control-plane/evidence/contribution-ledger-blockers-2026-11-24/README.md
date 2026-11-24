# Contribution ledger: optional pilot blocked before promotion

Reviewed 2026-11-24. Equity Uprise platform support and evidence only; this is not a new product capability, an activation decision, or permission to apply SQL.

## Scope and actual need

PR [#831](https://github.com/mcclusterishere/mccluster/pull/831) is pinned at `b9c2ed1d86de175b5a5d1f8ce1a442ec6d45312d`. The current main read through GitHub was `7f2644b417994d1b994d763485b6448906bdfdb0`. The pilot is stacked on an older #823 head, with contribution code behind `CORE_CONTRIBUTION_LEDGER_ENABLED=1`; unset means no ledger calls. The new callers are in the unmerged branch. Missing ledger objects do not constitute a broken current-main dependency.

Production catalog and aggregate-only SELECT at **2026-11-24 18:33:45 UTC** found all 13 candidate tables absent, no `compute_ledger_*` functions, and the scheduler-lease and attestation tables absent. The ledger held 389 migration rows, latest `20261124164904`; the existing `compute_claim_task` had its four-argument signature. No account, node credential, personal record or migration author was read. Nothing was applied or activated.

The branch's pending README and PROMOTION-ORDER are behind current main's recorded releases. Its new section 11 identifies the scheduler candidate as a prerequisite. #821 enrollment/workspace, #823 attestation/scheduler, and #824 consent/device work remain separate release lanes. The old versions embedded in #831 must not overwrite their later corrections.

## Native reproductions

`native-audit.mjs` is a deliberately bounded defect reproducer. It requires the exact forward and recovery hashes in `receipt.json`, localhost port 54322, and a unique disposable database. It uses the actual compute protocol and lease-authority SQL, the branch's scheduler and attestation candidates, and explicit peripheral organization/role fixtures. It does **not** claim a full Supabase reset or production test. PostgreSQL **17.6** reproduced all four findings:

| Finding | Reproduction | Consequence |
| --- | --- | --- |
| Daily cap excludes carried remainder | Work 2 at ratio 3 leaves carry 2 and mints 0. With daily cap 0, work 1 passes the cap check as `floor(1/3)=0`, then mints 1 from `(2+1)/3`. | Even sequential settlement exceeds the configured cap. |
| Daily cap is checked before account serialization | Two distinct nodes belong to the same worker. Two real PostgreSQL sessions each accept work 3 against cap 1. A third session holds the existing carry row until both settlements are observably waiting. Both then commit mint 1, totaling 2. | The carry lock prevents lost carry updates but does not protect the earlier daily aggregate. |
| Append-only claim omits TRUNCATE | An owner `TRUNCATE` empties the nonempty ledger; the audit transaction deliberately rolls back and confirms its rows restored. | The UPDATE/DELETE trigger does not protect every destructive operation claimed by the contract. API roles do not have TRUNCATE; this is the privileged-maintenance/recovery boundary. |
| Recovery deletes accounting history | The supplied rollback drops nonempty ledger, reservations, carry, operations and configuration tables. Base compute task rows remain. | Recovery destroys the only accounting record without a data-presence, body/shape, isolation, or concurrent-writer guard. |

The log is a successful reproduction of defects, **not a passing release proof**. The source SQL was unchanged. The fixture uses synthetic implementation labels and performs no model inference; the revised reproducer was rerun on native PostgreSQL with all four findings retained. Reproduction command, from a checkout of the pinned PR:

```bash
NATIVE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54322/postgres \
POSTGRES_MODULE_PATH=/absolute/path/to/postgres/src/index.js \
node /absolute/path/to/native-audit.mjs /absolute/path/to/pinned-pr831
```

Use a disposable PostgreSQL server only. The adapter rejects a remote host, creates its own uniquely named test database, and drops that database after the run. The supplied original 29-group proof uses one connection; its `Promise.all` and source-position lock checks do not establish these interleavings. The audit adapts JSON parameters to the native driver's JSON wrapper without changing SQL.

## Requirements still open before promotion

These are unresolved requirements, not product decisions made by this audit.

1. **Atomic integer accounting.** Check the actual carry-adjusted mint under the same account-level serialization as the daily aggregate and carry mutation. Establish a compatible lock order with reserve, correction, settlement and device lease RPCs. Add native cap-edge and distinct-node concurrency proofs. Bound arithmetic before multiplying node counters or class weights so malformed or oversized values cannot turn a terminal rejection into a permanently unsettled reservation.
2. **Durable acceptance and retries.** `reserveForTask()` reprices from the current model class on every submission retry; changing the class or unit version can conflict with an already accepted operation and the refusal path cancels a queued task. A replay must recover the accepted reservation without repricing or canceling it. Prove activation failures and response loss through the real SQL path.
3. **One metering contract.** The pilot caps prompt counters at a 2048 floor while `inferenceSettings()` raises the actual context to the resident size, default 16384. The JavaScript validator accepts zero generated tokens with zero generation duration; settlement requires positive generation duration unconditionally. Resolve these differences explicitly and test the executor receipt through validation and settlement. A digest read from the daemon after generation also needs evidence that it identifies the model used for that attempt.
4. **Complete reconciliation.** The sweep reads only the first 100 open reservations, with no cursor or pagination. Long-running early rows can indefinitely hide later completed or expired rows. Its stale-held cleanup uses only the page's IDs to decide which holds lack a reservation. Prove progress and correct reservation lookup beyond the first page.
5. **Scheduler fencing.** `compute_ledger_term_ok()` reads the scheduler row without locking it; the old holder's settlement may wait after that check. Verify the transaction boundary against expiry, handover and reacquisition using the corrected #823 scheduler contract and real independent sessions. The current source-only lock-order assertion is insufficient.
6. **Consent and routing.** The contract requires opted-in devices and private work restricted to owned or explicitly permitted nodes. `ops_compute_private_grants` has no claim-time consumer in this branch. The desktop/doctor consent, limits, pause and revoke work is on separate #824; neither the table nor ledger availability proves it shipped. Keep community/private routing unavailable until those actual fences are demonstrated.
7. **Owner controls and lifecycle.** Account, node-account binding, class, quota, review and correction controls are not implemented; the document proposes direct service writes. The repository's build-forward rule requires usable configure/operate/verify/recover controls with explicit authorization. Define how frozen worker accounts, class revisions, carry, corrections and related accounts behave before enabling the pilot; do not infer those semantics from missing checks.
8. **Safe recovery and drift protection.** Replace destructive default rollback with a fail-closed policy preserving accounting records, explicit READ COMMITTED and bounded locks, exact known definitions/metadata and role grants, no-op/partial-state handling, and real data/race/refusal tests. Strengthen the forward file's permissive `CREATE TABLE IF NOT EXISTS` behavior so an incompatible preexisting object is not silently adopted.
9. **Current integration and repeatable evidence.** Reconcile with the later #821/#823/#824 work without replacing its guarded SQL or runtime fixes. Add native behavior, real-role and full canonical reset CI coverage, source-map classification and an exact-head receipt. Only three PR workflows ran on the audited #831 head (API Economic Core CI, Control Plane Drift Guard, Production Security Contract); none invokes its ledger proof. A stale branch's general green checks do not prove this migration.

## Disposition

**BLOCKED — optional pilot; unsafe to apply as currently written.** Keep its flag unset. This audit does not move either SQL file into migrations, invent a migration version, configure accounts or classes, enable routing, merge the stack, or deploy Core. Production application still requires explicit approval of each final file after its relevant proof and integration requirements are met.
