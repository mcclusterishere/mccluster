# McCluster Core Completion Evidence Contract

Status: enforced Core runtime contract.

## Purpose

McCluster Core must not treat an executor's prose or return value as proof that work is complete.

The completion boundary is now:

`executor result -> trusted evidence normalizer -> evidence policy -> durable completion write`

A job may transition to `done` only when its structured output satisfies the evidence policy for that exact `job_type` and carries a Core-generated `completion_evidence` envelope whose digest still matches the result being written.

This directly implements the operating rule:

**Proof, don't claim.**

## Trust boundary

Executors do not authorize their own completion.

`core/src/completion-evidence.mjs` owns the machine-verifiable completion policy. The Core runner calls `buildCompletionEvidence()` after an executor returns. `core/src/supabase.mjs::completeJob()` independently calls `assertCompletionEvidence()` again before it is allowed to PATCH `ops_agent_jobs.status = done`.

This second check matters: another Core code path cannot bypass the runner and write a raw result as completed work.

The executor's original top-level result remains intact for compatibility. Core adds a reserved `completion_evidence` field containing:

- schema version;
- canonical job id and job type;
- executor identity;
- execution start/completion/verification timestamps;
- SHA-256 digest of the executor result excluding the evidence envelope itself;
- deterministic evidence records required by that job type.

If any executor field changes after evidence generation, the stored digest no longer matches and completion is rejected.

## Evidence classes

The contract currently recognizes evidence classes including:

- exact Git snapshots and commit SHAs;
- Git no-change proof against an exact base revision;
- passing requested repository tests;
- model result provenance for local analysis;
- child job IDs for plans, reflection, polling, implementation and release workflows;
- private conversation reference + source fingerprint for objective synthesis;
- canonical objective mutation IDs;
- portfolio snapshot timestamps and initiative counts;
- generated media job IDs and asset lineage;
- Godot playtest artifact directories and evaluation results;
- exact implementation commit plus successful Godot import/launch checks;
- non-production preview deployment provider + HTTPS URL;
- OVH host-health timestamp, host identity, service states and deployed SHA when available;
- durable communications message IDs and relay transport for assistant SMS replies;
- explicit owner/authorization decisions for bounded game-production gates.

Every completion also carries a canonical SHA-256 digest of the full executor result.

## Consequential jobs are stricter

### Autonomous code

A changed `code_patch` cannot complete unless it reports:

- repository;
- branch;
- exact base commit SHA;
- exact produced commit SHA;
- successful `git diff --check` verification.

A no-change code job must identify the exact base SHA and prove the worktree remained clean.

The code executor still remains draft-only and cannot merge or deploy.

### Preview deployments

`preview_deploy` cannot complete unless:

- `production === false`;
- the provider is identified;
- a valid HTTPS preview URL is returned.

### Communications

An automated SMS `reply` cannot complete unless the durable outbound message ID, inbound message ID, thread ID and relay transport are present. Ignore/escalation decisions must still identify the exact thread and inbound message they acted on.

### Game implementation validation

`game_branch_smoke` cannot complete unless the exact tested commit is known and both Godot import and launch verification succeeded.

## Read-only work

Read-only cognition cannot prove that its conclusions are true merely because a model produced them. The contract therefore proves a narrower claim: which model produced a structured result, which evidence scope it was allowed to use, and the exact digest of the returned result.

For repository health, the contract is stronger: the exact Git HEAD is mandatory. If tests were requested, the health job cannot claim completion unless those tests actually ran and passed.

## Fail-closed future expansion

There is intentionally no generic fallback policy.

If a new executor is added to Core but no completion-evidence policy exists for its `job_type`, the job fails instead of becoming `done`.

That means increasing agent capability requires increasing the verification layer at the same time.

## Retry behavior

An evidence-policy rejection is handled like an executor failure by the existing Core runner. The job is returned to the canonical retry/failure path according to `max_attempts`; it is never silently marked complete.

## CI contract

Reconciliation CI runs dedicated completion-evidence tests and asserts that:

- the runner builds evidence before completion;
- the durable completion writer validates evidence again;
- future unknown executor types fail closed;
- consequential evidence requirements cannot be weakened without changing tests and policy together.

## Next use: system health

The system-health plane should consume these evidence envelopes directly. Instead of asking whether an agent said work was finished, health can answer which completion claims have cryptographic result digests and domain-specific proof, which executor/version produced them, and which claims are stale or degraded.
