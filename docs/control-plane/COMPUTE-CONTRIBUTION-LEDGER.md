# Compute contribution: consent, metering, work units and the append-only ledger

Status: design and pilot implementation, pending SQL only (never applied to production). Owner brief of
2026-11-23. The platform is Core; OVH is its current coordinator; opted-in devices add capacity. One ledger
writer at a time, fenced across failover.

This document is the contract the SQL (`supabase/pending/compute_contribution_ledger_v1.sql`), the Core
service (`core/src/compute/contribution-ledger.mjs`), the Windows node doctor (`core/windows/mccluster-node.ps1`)
and the desktop Contribute panel (`desktop/windows`) implement. Where it conflicts with existing law
(`AGENTS.md`, `CANONICAL-ARCHITECTURE.md`, `DEVICE-JOBS-CONTRACT.md`), the law wins and this document is wrong.

## What already exists and is reused

- Node identity, signed requests, nonce replay table, node states `online | draining | offline | quarantined |
  revoked` (`core/src/compute/signature.mjs`, `gateway.mjs`, `ops_compute_nodes`).
- Leases fenced by `(node_id, sha256(lease_token), attempt = task.attempts, status, expires_at)` in
  `compute_transition_lease_v2`; one active lease per task; `(org_id, idempotency_key)` on enqueue.
- PR #821 (pending): single-use, scoped enrollment credentials `mcen1_…` (`compute_enroll_once`), owner
  tools for pause (`draining`), resume and revoke, node pins.
- PR #823 (pending): `mccluster-job/1`, `mccluster-job-receipt/1`, completion attestations, and the scheduler
  lease `(holder_id, term)` that makes one Core instance the only admitter of work.
- The customer-spend credit stack (`api_credit_ledger`, `compute_credit_reservations`) is NOT reused: it is
  money-denominated and belongs to API consumers. Contribution credits are a separate, internal, noncash
  unit (see "What credits are").

## Consent, limits and workloads (device side)

Contribution is opt-in per device, after the owner is signed in on the site. Before anything is enrolled the
desktop shows, in plain words, exactly: what runs on the device (the approved model class only), which
workload class the device will accept, the limits the owner sets, that no account credential and no tool
permission beyond the executor contract is ever sent to the device, and that Pause and Revoke are one click
away. Enrollment uses the existing single-use credential from the owner surface (PR #821) or, until that is
promoted, the owner's bootstrap token typed once and never stored by the desktop; the doctor keeps the
per-device Ed25519 key in the state root as today.

Limits the owner sets, enforced locally by the node agent before every claim and reported in heartbeat
labels: `idle_only`, `on_ac_only`, `max_concurrency` (1 in the pilot), `cpu_busy_percent` (no claim while
the device is busier than this), `battery_floor_percent`, `thermal` (best effort: when the platform exposes
a thermal zone reading the agent refuses claims above the limit; when it does not, the panel says
"unsupported on this device", never "off"). Pause writes a marker the agent honours within one poll and
sets heartbeat label `paused=true`; Resume removes it. Revoke stops the tasks, deletes the local key, and
prints the node id the owner revokes on the Core (the owner tool in #821; direct SQL until then). The
desktop never calls the Core; it drives the doctor, which is the only thing that touches the state root.

Workload classes: `public` (open or synthetic inputs, no owner data), `private` (an owner's own data).
Community devices accept `public` only by default. A `private` task is routed only to a node whose
enrollment trust is `owned` by the requesting account or explicitly permitted by that account
(`ops_compute_private_grants`). Routing is a claim-time fence, not a UI promise.

## Metering: what is recorded per accepted attempt

Raw counters from Ollama, recorded separately and never summed into one number:
`prompt_eval_count`, `prompt_eval_cached_count`, `eval_count`, `total_duration_ns`, `load_duration_ns`,
`prompt_eval_duration_ns`, `eval_duration_ns` (all per the Ollama usage document; durations in
nanoseconds). Plus `model` (name as served), `model_digest` (from the runtime, bound to the same execution),
`runtime_version`, `node_id`, `node_key_fingerprint`, `hardware_mode`, lease `attempt`, wall-clock
`duration_ms` of the lease. The adapter returns the digest with the result (`/execute` response), not from
a separate probe. The Core receipt carries this block as `metering`; the desktop local receipt carries the
same block for local jobs.

## Work units and credits

- One benchmarked model class in the pilot: `ops_compute_model_classes` rows name the class, its approved
  `(model, digest)` list, a `unit_version`, the unit weights `out_unit_micro` (per generated token) and
  `in_unit_micro` (per uncached prompt token), and plausibility windows `min_tokens_per_s`,
  `max_tokens_per_s`, `max_eval_count`, `max_prompt_eval_count`. Everything is integer micro-units
  (1 unit = 1,000,000 micro-units).
- Normalized work for an accepted attempt: `units_micro = eval_count * out_unit_micro +
  (prompt_eval_count - prompt_eval_cached_count) * in_unit_micro`, computed server-side from the recorded
  counters at the pinned `unit_version`: the reservation records the class and the `unit_version` it was priced
  at, and a settle after the class moved to another version is refused (`UNIT_VERSION_STALE`), never repriced.
  Cached prompt tokens earn nothing. A counter the runtime did not report (absent or `null`: Ollama never reports
  `prompt_eval_cached_count` and omits a zero counter) counts as 0.
- Contribution-to-redemption rate `redemption_ratio = 3` (configurable per class): a worker account earns
  `floor((carry + units_micro) / 3)` spendable micro-units; the remainder is carried per account in
  `ops_compute_account_carry`, so rounding can never be gamed by splitting jobs.
- Display points: `100,000` accepted units (whole units, not micro) earn 1 display point if the account opted
  in (`display_points_opt_in`). Points live in `ops_compute_display_points` and are never readable by the
  spend functions.
- What credits are: internal, nontransferable, noncash units that only buy compute through this ledger.
  No cash payout path exists or is implied. Cross-model redemption is out of scope until benchmarks, supply
  and liability are measured; the class table has one row.

## Acceptance: a signature proves who reported, not what was computed

A node's completion signature (attestation) proves which key reported a result. Minting requires the Core
to accept the attempt, which means all of the following, checked server-side in one transaction:

1. The lease is the completing lease of the task's current attempt (same fence as `compute_transition_lease_v2`).
2. The node is `online` or `draining` and not revoked or quarantined at settle time.
3. The model and digest are on the class allowlist; the class is the one the reservation pinned
   (`MODEL_CLASS_MISMATCH`) and its `unit_version` is still the pinned one (`UNIT_VERSION_STALE`).
4. Counters are bounded: all non-negative integers (an unreported one is 0), `prompt_eval_cached_count <=
   prompt_eval_count`, `eval_duration_ns > 0`, `eval_count / eval_duration_s` inside `[min_tokens_per_s,
   max_tokens_per_s]`, and the counts inside BOTH the class maxima and the task's own caps: `eval_count <=
   min(max_eval_count, max(16, input.num_predict))` and `prompt_eval_count <= min(max_prompt_eval_count, max(2048,
   input.num_ctx))` (16 and 2048 are the Ollama adapter's own floors; a task that names neither is bounded by the
   class). The reservation is priced from the same caps (`taskCounterCaps()`), and units above the reservation's
   `max_units_micro` are refused (`UNITS_EXCEED_RESERVATION`).
5. The lease's stored result is the task's stored output, and the `output_sha256` the Core passes (computed in one
   place, `hashJson()` over the stored output) equals the hash the gateway recorded with the node's completion
   attestation when one exists. The SQL does not re-derive the hash: jsonb text and `JSON.stringify` spell numbers
   differently (`1e21`, `1e-7`), so a second implementation could only disagree.
6. Not late: completed before the task's `deadline_at` (the reservation's `expires_at`).
7. Not a duplicate: at most one `settle` per `(task_id, attempt)`; a second settle with the same
   `operation_key` replays the first outcome; a different payload under the same key is refused.
8. Not self-routed or collusive: no mint when the worker node's account equals the submitting account or
   is listed as related in `ops_compute_account_relations`; the submitter still pays.
9. Known-answer sampling: tasks flagged in `ops_compute_known_answer_tasks` carry an expected sha256; a
   mismatch mints nothing, records an `ops_compute_fraud_reviews` row, and leaves the node's state to a
   human (the function never quarantines by itself).
10. No reward for idle time, failed, canceled, expired or rejected attempts: those paths only release.

Who pays. The submitter is debited only for an attempt the ledger accepts, or one it declines to mint for a reason
that is not the worker's fault (`SELF_ROUTED`, `QUOTA_DAILY_MINT`, `NODE_UNBOUND`), and never more than the
reservation's `max_units_micro`. Every worker-side verdict (`NODE_UNAVAILABLE`, `MODEL_NOT_APPROVED`,
`DIGEST_NOT_APPROVED`, `MODEL_CLASS_MISMATCH`, `UNIT_VERSION_STALE`, `COUNTERS_INVALID`,
`COUNTERS_OUT_OF_WINDOW`, `UNITS_EXCEED_RESERVATION`, `OUTPUT_HASH_MISMATCH`, `LATE`, `KNOWN_ANSWER_MISMATCH`)
records the settle entry with the claimed units and `spend_micro = 0`, mints nothing, and releases the whole
reservation (status `released`, release reason `rejected:<verdict>`).

## The ledger (append-only, one writer)

Tables (all `service_role` only, RLS on, no anon or authenticated policy):

- `ops_compute_accounts(account_id text pk, org_id, kind owner|community, status active|frozen,
  display_points_opt_in bool, created_at)`; the pilot allowlist is `status = 'active'` rows only.
- `ops_compute_contribution_ledger` append-only: `entry_id bigserial pk, operation_key text unique not null,
  kind reserve|settle|mint|release|correction, account_id, task_id, lease_id, attempt, node_id,
  scheduler_holder_id, scheduler_term, units_micro bigint, spend_micro bigint, metering jsonb,
  model_class, unit_version, correction_of bigint references entry_id, reason text, created_at`. A trigger
  rejects UPDATE and DELETE. Balances are sums, never stored columns: `pending` = open reservations,
  `earned` = sum of `mint`, `spent` = sum of `settle` + corrections against the account.
- `ops_compute_spend_reservations(reservation_id, operation_key unique, account_id, task_id unique,
  max_units_micro, model_class, unit_version, status open|settled|released, created_at, expires_at)`; the class and
  version are pinned when the reservation is opened.
- `ops_compute_account_carry(account_id pk, carry_micro bigint)`.
- `ops_compute_display_points(account_id pk, points bigint, accepted_units_remainder bigint)`.
- `ops_compute_model_classes`, `ops_compute_known_answer_tasks`, `ops_compute_fraud_reviews`,
  `ops_compute_account_relations`, `ops_compute_private_grants`, `ops_compute_account_quotas(account_id,
  max_open_reservations, max_queued_tasks, daily_mint_cap_micro)`.

Functions (`SECURITY DEFINER`, execute granted to `service_role` only, every one takes an `operation_key`):

- `compute_ledger_reserve(op_key, account_id, task_id, max_units_micro, deadline_seconds, model_class,
  unit_version)`: refuses `TASK_NOT_QUEUED` unless the task is still queued (a task a node holds, or a done,
  failed or canceled one, never gets a reservation), `MODEL_CLASS_UNKNOWN` when no class prices the task,
  `UNIT_VERSION_STALE` when the caller priced with a version the class no longer has, `OVER_BUDGET` when
  `earned - spent - pending < max`, `QUOTA_RESERVATIONS` / `QUOTA_QUEUE` when a quota is exceeded,
  `ACCOUNT_FROZEN`; pins `(model_class, unit_version)` on the reservation; replays on the same key whatever the
  task's state has become.
- `compute_ledger_settle(op_key, task_id, lease_token_hash, attempt, metering jsonb, output_sha256,
  scheduler_holder_id, scheduler_term)`: performs every acceptance check above, then in one transaction
  writes `settle` (submitter; the units charged per "Who pays", capped at the reservation), `mint` (worker
  account, spendable with carry), closes the reservation, releases the unused part (all of it for a rejected
  attempt), accrues display points. Returns the entry ids and the verdict (`accepted`, `charged`, `reason`).
  Refuses `STALE_TERM` when `(scheduler_holder_id, scheduler_term)` is not the live row of
  `ops_compute_scheduler_leases` (PR #823): once a row exists for the org, expired or released included, a null
  term is refused too; a null term passes only for an org with no scheduler row at all. Row locks are taken in the
  device RPCs' order, node then lease then task (`compute_claim_task`, `compute_transition_lease_v2`), so a
  settle and a node's lease call queue instead of deadlocking. Nodes never call it; the scheduler does.
- `compute_ledger_release(op_key, task_id, reason, scheduler_holder_id, scheduler_term)`: releases an open
  reservation on cancel, fail, expiry or rejection; same term fence.
- `compute_ledger_correct(op_key, correction_of, account_id, spend_micro, units_micro, reason)`: appends a
  correction; never edits.
- `compute_ledger_balances(account_id)`: `pending`, `earned`, `spent`, `available`, `display_points`.
- `compute_ledger_receipt(task_id)`: the per-job ledger receipt (reservation, settle, mint, release,
  corrections, verdict), the object the site and the desktop show.

Lease fencing and failover: `settle` and `release` are fenced twice, by the lease (token hash, attempt) and
by the scheduler term. A Core instance that lost the scheduler lease during a job gets `STALE_TERM` and
must not retry with its old term; the new holder settles the same `(task_id, attempt)` under its own term
with a fresh key, and the lease fence guarantees only one of them can be the completing lease. Replay with
the same key is idempotent; the unique `operation_key` is the arbiter (`INSERT … ON CONFLICT`).

Durability: the sweep. The settle a node's `/complete` triggers is one attempt, not the guarantee. The active
scheduler runs `sweepContributionLedger` on an interval (`startContributionSweep`, started by `gateway.mjs`
right after the scheduler election loop and asking that election on every pass; `CORE_CONTRIBUTION_SWEEP_MS`,
default 30 s, 5 s to 1 h; a standby does nothing). Each pass reads every OPEN reservation with its task and closes
the ones whose task has moved on:

| Task state | What the sweep does |
| --- | --- |
| `done` | settles it from the durable rows (stored output, the done lease and its token hash, the node), under its own `(holder_id, term)` and a fresh key. This is what recovers a settle that answered `STALE_TERM`, lost a deadlock, timed out, or was received by a standby (a standby does not call the ledger at all). If the settle is refused for good (`LEASE_REJECTED`) and the reservation has expired, the reservation is released instead |
| `failed`, `canceled` | releases the reservation |
| `queued`, reservation expired | nobody ever completed it: cancels the task (a conditional update that loses to a claim) and releases the reservation. If a node claimed it first, nothing happens and its settle will answer `LATE` |
| `queued`, still held after the hold grace (`CORE_CONTRIBUTION_HOLD_GRACE_MS`, default 10 min) | a submission whose hold was never lifted and whose client never retried: canceled and released |
| `leased`, `running` | left alone: its completion or failure closes it |

It then cancels held tasks older than the grace that never got a reservation.

## Tests the pilot must pass before anything is promoted

`scripts/compute-ledger-sql-check.mjs` over PGlite (same loader as the staging harness), each as its own
case with the refusal code asserted:

concurrent settle under one key (two in flight, one mint); replay same payload (`replayed: true`); same
key different payload (`CONFLICT`); revoked node (no mint, settle recorded, review not opened); stale
attempt (`LEASE_REJECTED`); cancellation (release, no settle); over-budget reserve (`OVER_BUDGET`); stale
scheduler term (`STALE_TERM`); known-answer mismatch (no mint, review row); self-routed (no mint, settle
yes); late completion (no mint); counters out of window (no mint, reason); integer accounting (ten
one-unit mints at 3:1 yield exactly three spendable units and a carry of one; display points only cross a
100,000-unit boundary once); quotas; append-only trigger refuses UPDATE/DELETE; balances arithmetic. Added by the
review of 2026-11-23: the settle's lock order (node, lease, task); reserve refuses a task that is not queued
(`TASK_NOT_QUEUED`); `unit_version` pinned at reserve and enforced at settle (`UNIT_VERSION_STALE`,
`MODEL_CLASS_MISMATCH`); a null term refused whenever a scheduler row exists (live, expired, released) and accepted
only with none; a worker-side rejection charges nothing and releases the whole reservation; an Ollama result with
`prompt_eval_cached_count` null or counters absent settles; counters above the task's `num_predict` / `num_ctx`
and units above the reservation are refused without a charge; an output carrying `1e21` and `1e-7` settles.

## Implementation status (2026-11-23, branch `prime/contribution-ledger`, source and tests only)

Nothing is applied or deployed; the SQL is pending and the Core wiring is off unless `CORE_CONTRIBUTION_LEDGER_ENABLED=1`.

- `supabase/pending/compute_contribution_ledger_v1.sql` (+ `.rollback.sql`): every table, trigger and function above,
  `service_role` only, `SECURITY DEFINER` with `search_path = public, extensions, pg_temp`. Two additions the contract did
  not name, each stated in the file header: `ops_compute_ledger_operations` (the `operation_key` arbiter: `INSERT … ON
  CONFLICT DO NOTHING`, the payload hash and the stored outcome a replay returns verbatim; a different payload under the
  same key is `CONFLICT`) and `ops_compute_node_accounts` (which account a node works for, needed by the mint and the
  self-routing rule). `compute_ledger_reserve` takes three optional arguments after the four named above:
  `p_deadline_seconds` (default 3600: the reservation's `expires_at` is the task's deadline for the late rule, since
  `ops_compute_tasks` has no deadline column and no applied table is altered), and `p_model_class` / `p_unit_version` (the
  class the Core priced the task with; without them the class is the one whose `implementations` name the task's
  implementation, else the only class). The model class of an attempt is resolved from `metering.model` (+
  `model_digest`) against `approved_models` and must be the pinned one. With no scheduler row for the org (the election
  never used) a null term is accepted and recorded; once a row exists, in any state, only the live `(holder_id, term)`
  passes and everything else is `STALE_TERM` (to return an org to the single-scheduler mode the owner deletes its
  `ops_compute_scheduler_leases` row). Refusals that write nothing (`STALE_TERM`, `LEASE_REJECTED`, `DUPLICATE_SETTLE`,
  `NO_RESERVATION`, `TASK_NOT_QUEUED`, `MODEL_CLASS_UNKNOWN`, `UNIT_VERSION_STALE` at reserve, `OVER_BUDGET`, the quotas,
  `ACCOUNT_FROZEN`) do not consume the key. Verdict reasons on a recorded settle without a mint, charged to the
  submitter: `NODE_UNBOUND`, `SELF_ROUTED`, `QUOTA_DAILY_MINT`; not charged (the reservation is released whole):
  `NODE_UNAVAILABLE`, `MODEL_NOT_APPROVED`, `DIGEST_NOT_APPROVED`, `MODEL_CLASS_MISMATCH`, `UNIT_VERSION_STALE`,
  `COUNTERS_INVALID`, `COUNTERS_OUT_OF_WINDOW`, `UNITS_EXCEED_RESERVATION`, `OUTPUT_HASH_MISMATCH`, `LATE`,
  `KNOWN_ANSWER_MISMATCH` (opens the review row). The output hash has one implementation, `hashJson()` in
  `core/src/compute/jobs.mjs`, taken over the stored output and passed in; the SQL has no canonical JSON of its own
  (an earlier draft's `compute_ledger_canonical_json` printed `1e21` and `1e-7` differently from `JSON.stringify` and is
  dropped). `accepted_units_remainder` is kept in micro-units.
- `scripts/compute-ledger-sql-check.mjs`: PGlite, the applied compute chain plus the attestation and scheduler pending
  files, seeding through `compute_enqueue_task`, `compute_claim_task`, `compute_start_lease`, `compute_complete_lease` and
  `compute_scheduler_acquire`; 29 cases covering the list above with their codes, privileges, the append-only trigger,
  balances as sums, rollback and re-apply. Passed on PGlite 0.5.17 on 2026-11-23. PGlite is one connection, so the lock
  order is proved from the function's own source (the order of its `FOR UPDATE` statements against
  `compute_transition_lease_v2`'s), not by provoking a deadlock between two sessions.
- `core/src/compute/contribution-ledger.mjs`: `reserve`, `settle`, `release`, `balances`, `receipt`, `correct` over the
  PostgREST RPC client; `schedulerIdentity(election)` gives the `(holder_id, term)` (the Core id and a null term without
  an election); `operationKey` names the scheduler so a new holder settles under a fresh key; `taskCounterCaps`,
  `estimateMaxUnitsMicro` and `resolveModelClass` price a task before it runs, from the same caps the settle enforces.
- `core/src/compute/jobs-service.mjs`, behind the flag:
  - `submitJob` enqueues the task HELD (`run_after` is the constant `9999-12-31T00:00:00.000Z`, which
    `compute_claim_task` never reaches; the submitter's own `run_after` travels in `metadata.contribution.run_after`),
    reserves its max units with the class and `unit_version` it priced with, and only then lifts the hold
    (`activateHeldTask`, a conditional update). A reserve that throws (timeout, PostgREST fault, the class read failing)
    therefore never leaves a claimable unreserved task: the answer is `503 LEDGER_RESERVE_FAILED` (retryable) and the
    task stays held. A refusal cancels the held task and answers the ledger's code. Every step is idempotent, so a
    replay under the same `Idempotency-Key` runs them again: a missing reservation is attempted, a hold that was not
    lifted is lifted (`503 LEDGER_ACTIVATE_FAILED` if lifting fails), and a replay of a refused submission answers
    `409 LEDGER_RESERVATION_REFUSED` instead of an ok response carrying a canceled job.
  - `validateCompletion` does nothing while the flag is unset (no read, no check: `/complete` is PR #823's, and a real
    Ollama result, whose `prompt_eval_cached_count` is always null, is committed as before). With the flag on it
    inspects only an `ai.*` task that holds an open reservation: counters required, an unreported one is 0, inside the
    task's caps and the pinned class. A failed read there never blocks a completion; the settle enforces the same bounds.
  - `settleCompletion` settles after `compute_complete_lease` accepted (one attempt; a standby does not call the
    ledger), `settleDoneTask` is the same settle rebuilt from the durable rows, `releaseAfterFailure` releases once the
    task is terminal (a retry keeps the reservation), and `sweepContributionLedger` / `startContributionSweep` are the
    durable path described under "Durability: the sweep". `core/src/compute/gateway.mjs` calls these on the lease
    `complete` and `fail` routes and starts the sweep next to the election loop.
  - The paying account is `account_id` on the submission, else the owner actor, else
    `CORE_CONTRIBUTION_DEFAULT_ACCOUNT`; account rows are the owner's to create (direct `service_role` writes to
    `ops_compute_accounts`, `ops_compute_node_accounts`, `ops_compute_model_classes`; no Core tool yet).
- Metering: `core/src/compute/ollama-adapter.mjs` returns `model_digest` and `ollama_version` inside `usage` on `/execute`,
  read from the same daemon right after the generation; `meteringBlock()` in `jobs.mjs` builds the receipt's `metering`
  member (`mccluster-job-receipt/1` kept, the member is additive and signed); `DEVICE-JOBS-CONTRACT.md` documents the
  block, the validation codes and the submission-time ledger behaviour.
- Tests: `core/test/contribution-ledger.test.mjs`, `core/test/metering-validation.test.mjs` (`node --test` with fakes, plus
  the real adapter against a fake daemon).
- Not done: the desktop Contribute panel and the Windows node doctor changes (consent, limits, pause, revoke), the
  owner tools for accounts, classes and reviews, and private-task routing by `ops_compute_private_grants` at claim time.
- Known limits, each a chosen rule:
  - A task submitted through `POST /v1/compute/tasks` (not the job contract) is never reserved; its settle answers
    `NO_RESERVATION` and nothing is minted or charged.
  - A submitter that declares `num_ctx` smaller than its prompt, or relies on more output than its `num_predict`, gets
    the completion refused (`422 RESULT_USAGE_OUT_OF_BOUNDS` at the gateway, `COUNTERS_OUT_OF_WINDOW` at the settle):
    the reservation was priced from those caps and is never exceeded.
  - Bumping a class's `unit_version` while reserved tasks are in flight makes their settles `UNIT_VERSION_STALE` (no
    charge, no mint): drain the queue before a bump.
  - A held task whose client got `503` and never retried is canceled by the sweep after the hold grace; it does not run.
  - While the org's scheduler row is expired or released and nobody has re-acquired, no instance settles or releases;
    the next holder's sweep catches up.

## What is not in the pilot

Cash, payouts, transfers between accounts, cross-model redemption, automatic quarantine, pooled (two-rank)
execution rewards (pooled execution is advertised only with evidence from both ranks), any change to the
existing customer credit stack, any migration under `supabase/migrations/`, any Core promotion.
