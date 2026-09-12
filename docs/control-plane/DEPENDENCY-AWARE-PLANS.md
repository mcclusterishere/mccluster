# Dependency-Aware Objective Plans

McCluster Core can decompose a bounded objective into a directed acyclic graph (DAG) of unattended jobs while keeping Supabase `ops_agent_jobs` authoritative.

## Purpose

Reflection answers: **what should Core work on next?**

Objective planning answers: **what sequence and parallel structure should that work have?**

The planner does not introduce a second scheduler, workflow database, or orchestration service. Plan metadata is stored inside canonical `ops_agent_jobs.input.plan` and queue state remains in the existing job row.

## Plan shape

A planner emits topologically ordered steps:

```json
{
  "summary": "Inspect the repo, analyze the evidence, then synthesize findings.",
  "steps": [
    {
      "key": "inspect",
      "job_type": "repo_health",
      "task": "Run the installed repository health checks.",
      "depends_on": []
    },
    {
      "key": "analyze",
      "job_type": "local_analysis",
      "task": "Analyze the repository-health result.",
      "depends_on": ["inspect"]
    }
  ]
}
```

Accepted steps are persisted as normal `ops_agent_jobs` rows. Each step receives:

```json
{
  "plan": {
    "plan_id": "uuid",
    "planner_job_id": "uuid",
    "step_key": "analyze",
    "depends_on_step_keys": ["inspect"],
    "depends_on_job_ids": ["uuid-of-inspect-job"]
  }
}
```

## Queue semantics

Before Core claims a queued job it evaluates `depends_on_job_ids`.

- no dependencies -> runnable;
- every dependency is `done` -> runnable;
- any dependency is still queued/running -> remain queued;
- a referenced dependency is temporarily missing -> remain queued and fail closed;
- any dependency is `failed` -> dependent job is marked `failed` without consuming an execution attempt.

This gives Core fan-out and fan-in behavior without adding a shadow queue.

Example:

```text
             +--> repo_health B --+
objective A -|                     +--> local_analysis D
             +--> local_analysis C-+
```

B and C can execute independently. D cannot be claimed until both B and C finish successfully.

## Safety boundary

The first planner version can schedule only:

- `repo_health`
- `local_analysis`

It cannot autonomously schedule `code_patch`, merges, deployments, external communications, spending, legal actions, authentication changes, destructive data operations, or production mutations.

`objective_plan` itself is safe for the reflection layer to enqueue because its deterministic post-model policy can only materialize the two safe job types above.

Model output is never trusted directly. `plan-policy.mjs` validates:

- allowed job type;
- unique bounded step key;
- non-empty bounded task;
- maximum plan size;
- bounded priority;
- dependency references only to already accepted steps.

Requiring references to earlier accepted steps makes the accepted graph acyclic by construction.

## Overnight integration

```text
02:30 reflection seed
        |
        v
objective_reflection
        |
        +--> one-off local_analysis/repo_health
        |
        `--> objective_plan
                 |
                 v
          validated DAG
                 |
                 v
          ops_agent_jobs
                 |
          dependency gate
                 |
                 v
             executors
                 |
                 v
          07:30 digest
```

## Non-goals

This version does not:

- create another database or workflow engine;
- auto-approve consequential work;
- automatically merge or deploy code;
- infer dependencies from arbitrary existing jobs;
- mutate completed plan topology after creation;
- treat missing prerequisite rows as success.

## Future extension

A later approval-aware planner may represent consequential steps as proposed/gated work, but those steps must remain non-runnable until the canonical approval plane authorizes them. Do not weaken the current unattended-safe allowlist to achieve that.
