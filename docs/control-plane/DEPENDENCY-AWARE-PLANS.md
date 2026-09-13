# Dependency-Aware Objective Plans

McCluster Core may decompose a bounded objective into a small directed acyclic graph without introducing a second workflow database or scheduler. `public.ops_agent_jobs` remains the durable execution source of truth.

## Flow

`objective_reflection` may emit one `objective_plan` job when a goal genuinely requires dependent work. The planner itself may create only `local_analysis` and `repo_health` child jobs. Consequential work such as code changes, deploys, merges, communications, spending, legal actions, authentication changes, destructive data changes, and production mutations remains outside this unattended planner.

Each plan is identified by the durable planner job id. Each child job receives a deterministic UUID derived from the planner job id plus the step key. Retrying a partially materialized plan therefore recovers the existing child rows rather than creating a second DAG.

## Dependency semantics

Child jobs record prerequisite child job ids in `input.plan.depends_on_job_ids`.

Before claiming a queued job, Core classifies its prerequisites:

- a known failed prerequisite fails the dependent job immediately without consuming a new execution attempt;
- a missing or unfinished prerequisite defers the job briefly;
- all completed prerequisites make the job runnable.

Failure takes precedence over missing rows so impossible plans cannot wait forever.

## Evidence propagation

A dependency is not merely a scheduling barrier. When all prerequisites complete, Core copies a bounded representation of their job metadata and outputs into `input.evidence.dependencies` on the dependent job before claiming it. This lets downstream `local_analysis` consume the evidence produced by earlier steps instead of reasoning without the prerequisite results.

Individual dependency outputs are bounded before they are copied into downstream evidence. This prevents a large upstream result from expanding the operational queue without limit.

## Retry safety

`enqueueJob` accepts an optional deterministic job id. For deterministic plan children, insertion uses an id conflict boundary. If a retry finds that the child already exists, Core retrieves and reuses it; a deterministic id that belongs to a different organization or job type fails closed as a collision.

This provides at-least-once planner execution with exactly-once logical child identity.

## Relationship to Initiative OS

Initiative OS remains the portfolio-level planner. Its nightly portfolio plan can queue bounded objective reflections. Reflection can now choose either a direct safe evidence job or a bounded `objective_plan`. The hierarchy is therefore:

`portfolio_plan -> objective_reflection -> objective_plan -> safe evidence jobs`

The existing 02:00 portfolio timer, 02:30 reflection timer, and morning digest remain intact.

## Security boundary

The model proposes structure; deterministic policy authorizes execution. `core/src/plan-policy.mjs` is the allowlist boundary for plan children. `core/src/dependency-policy.mjs` is the prerequisite-state boundary. Neither may be bypassed by model output.
