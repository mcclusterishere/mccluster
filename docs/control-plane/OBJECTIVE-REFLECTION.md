# McCluster Core objective reflection

Status: implementation contract for the bounded overnight autonomy loop.

## Purpose

The Core runner already executes durable `ops_agent_jobs`. Objective reflection adds the missing feedback step: periodically inspect canonical objectives and recent job outcomes, choose a very small number of safe next tasks, and place those tasks back onto the same Supabase queue for the existing runner to execute.

This is not a second scheduler, queue, memory store, or control plane. Supabase remains authoritative for objectives, jobs, outputs, and operational history.

## Overnight flow

```text
02:30 America/New_York
        |
        v
mccluster-core-reflection.timer
        |
        v
seed-reflection.mjs
        |
        v
ops_agent_jobs: objective_reflection
        |
        v
Core runner + local Ollama
        |
        v
canonical objectives + recent job outcomes
        |
        v
bounded next-job plan
        |
        v
ops_agent_jobs: local_analysis / repo_health
        |
        v
existing Core executors
        |
        v
07:30 morning digest
```

## Safety boundary

Model output is never trusted as executable authority. `core/src/reflection-policy.mjs` performs a deterministic allowlist pass after model generation.

Reflection v1 may autonomously enqueue only:

- `local_analysis`
- `repo_health`

It may not enqueue `code_patch`, deployment, merge, external communications, spending, legal actions, authentication changes, destructive data changes, or production mutations. Adding a new unattended job type requires an explicit code change plus tests and review.

The reflection plan is limited to at most three jobs per run. The default is two.

## Duplicate protection

The nightly seed checks the canonical queue for an existing queued or running `objective_reflection` job for the configured organization/target. If one already exists, the timer exits without creating another.

## Runtime configuration

The service uses the existing `/etc/mccluster/core.env` and `MCCLUSTER_ORG_ID`.

Optional controls:

- `MCCLUSTER_REFLECTION_TARGET_ID` default `McCluster`
- `MCCLUSTER_REFLECTION_OBJECTIVE` default is the safe portfolio-review objective embedded in `seed-reflection.mjs`
- `MCCLUSTER_REFLECTION_PRIORITY` default `20`
- `MCCLUSTER_REFLECTION_LOOKBACK_HOURS` default `18`
- `MCCLUSTER_REFLECTION_MAX_NEXT_JOBS` default `2`, hard bounded to `3`

## Install on Core

After deploying the updated `core/` tree:

```bash
sudo install -m 0644 core/systemd/mccluster-core-reflection.service /etc/systemd/system/
sudo install -m 0644 core/systemd/mccluster-core-reflection.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mccluster-core-reflection.timer
sudo systemctl list-timers mccluster-core-reflection.timer
```

Manual seed test:

```bash
cd /opt/mccluster/core
sudo -u mccluster-core /usr/bin/node src/seed-reflection.mjs
```

The durable job should then be visible in `ops_agent_jobs`; the already-running Core runner claims and executes it.

## Next increments

The next autonomy layers should preserve this same boundary:

1. connect provider conversation ingestion to objective/recommendation synthesis;
2. introduce dependency-aware multi-step plans rather than time-based guessing;
3. persist model-run provenance for every reflection decision;
4. add approval-request jobs for consequential proposed actions rather than executing them;
5. incorporate capability success/cost history into routing and reflection;
6. feed reflection outcomes and rejected suggestions into evaluation metrics.
