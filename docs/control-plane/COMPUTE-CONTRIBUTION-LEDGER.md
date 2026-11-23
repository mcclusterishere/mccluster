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
  counters at the pinned `unit_version`. Cached prompt tokens earn nothing.
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
3. The model and digest are on the class allowlist; `unit_version` is the current one for the class.
4. Counters are bounded: all non-negative integers, `prompt_eval_cached_count <= prompt_eval_count`,
   `eval_count <= max_eval_count`, `prompt_eval_count <= max_prompt_eval_count`, `eval_duration_ns > 0`,
   and `eval_count / eval_duration_s` inside `[min_tokens_per_s, max_tokens_per_s]`.
5. The result's `output_sha256` equals the sha256 the Core computed over the stored result.
6. Not late: completed before the task's `deadline_at`.
7. Not a duplicate: at most one `settle` per `(task_id, attempt)`; a second settle with the same
   `operation_key` replays the first outcome; a different payload under the same key is refused.
8. Not self-routed or collusive: no mint when the worker node's account equals the submitting account or
   is listed as related in `ops_compute_account_relations`; the submitter still pays.
9. Known-answer sampling: tasks flagged in `ops_compute_known_answer_tasks` carry an expected sha256; a
   mismatch mints nothing, records an `ops_compute_fraud_reviews` row, and leaves the node's state to a
   human (the function never quarantines by itself).
10. No reward for idle time, failed, canceled, expired or rejected attempts: those paths only release.

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
  max_units_micro, status open|settled|released, created_at, expires_at)`.
- `ops_compute_account_carry(account_id pk, carry_micro bigint)`.
- `ops_compute_display_points(account_id pk, points bigint, accepted_units_remainder bigint)`.
- `ops_compute_model_classes`, `ops_compute_known_answer_tasks`, `ops_compute_fraud_reviews`,
  `ops_compute_account_relations`, `ops_compute_private_grants`, `ops_compute_account_quotas(account_id,
  max_open_reservations, max_queued_tasks, daily_mint_cap_micro)`.

Functions (`SECURITY DEFINER`, execute granted to `service_role` only, every one takes an `operation_key`):

- `compute_ledger_reserve(op_key, account_id, task_id, max_units_micro)`: refuses `OVER_BUDGET` when
  `earned - spent - pending < max`, `QUOTA_RESERVATIONS` / `QUOTA_QUEUE` when a quota is exceeded,
  `ACCOUNT_FROZEN`; replays on the same key.
- `compute_ledger_settle(op_key, task_id, lease_token_hash, attempt, metering jsonb, output_sha256,
  scheduler_holder_id, scheduler_term)`: performs every acceptance check above, then in one transaction
  writes `settle` (submitter, actual units), `mint` (worker account, spendable with carry), closes the
  reservation, releases the unused part, accrues display points. Returns the entry ids and the verdict
  (`accepted`, `reason`). Refuses `STALE_TERM` when `(scheduler_holder_id, scheduler_term)` is not the
  current row of `ops_compute_scheduler_leases` (PR #823). Nodes never call it; the scheduler does.
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

## Tests the pilot must pass before anything is promoted

`scripts/compute-ledger-sql-check.mjs` over PGlite (same loader as the staging harness), each as its own
case with the refusal code asserted:

concurrent settle under one key (two in flight, one mint); replay same payload (`replayed: true`); same
key different payload (`CONFLICT`); revoked node (no mint, settle recorded, review not opened); stale
attempt (`LEASE_REJECTED`); cancellation (release, no settle); over-budget reserve (`OVER_BUDGET`); stale
scheduler term (`STALE_TERM`); known-answer mismatch (no mint, review row); self-routed (no mint, settle
yes); late completion (no mint); counters out of window (no mint, reason); integer accounting (ten
one-unit mints at 3:1 yield exactly three spendable units and a carry of one; display points only cross a
100,000-unit boundary once); quotas; append-only trigger refuses UPDATE/DELETE; balances arithmetic.

## What is not in the pilot

Cash, payouts, transfers between accounts, cross-model redemption, automatic quarantine, pooled (two-rank)
execution rewards (pooled execution is advertised only with evidence from both ranks), any change to the
existing customer credit stack, any migration under `supabase/migrations/`, any Core promotion.
