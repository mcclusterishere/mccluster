# The autonomy loop: what runs, what it can reach, what is switched off

Audited 2026-09-19 against live production, not against intent.

## It already runs

Five systemd timers on `ovh-primary` drive the loop. Nobody needs to start it:

| timer | schedule | what it does |
| --- | --- | --- |
| `mccluster-core-reflection` | nightly | the model reviews the portfolio and proposes its next jobs |
| `mccluster-core-portfolio-plan` | nightly | plans across objectives |
| `mccluster-core-digest` | 07:30 America/New_York | writes the morning report |
| `mccluster-core-system-health` | periodic | host health |
| `mccluster-vps-reconcile` | periodic | reconciles the node against the repo |

Plus `ops_maintenance_tick()` in Postgres every 15 minutes, and the Core runner
claiming from `ops_agent_jobs` continuously.

## What the loop can actually execute

`core/src/runner.mjs` registers **19 job types**. The notable one is
`code_patch`, which is not a toy: it cuts a worktree off `origin/main`, runs the
local model against a bounded task, refuses paths outside `allowed_paths` and
anything matching the sensitive-path rules, commits, pushes the branch, and
opens a **draft** PR. It never merges.

**`code_patch` has never run once in production.** Neither has anything else
outside the five job types below.

## What actually reaches the queue

`core/src/reflection-policy.mjs` only lets the model propose three job types —
`local_analysis`, `repo_health`, `code_patch` — and the nightly history shows
only these five ever executing at all:

`host_health` · `lead_rescore` · `portfolio_plan` · `local_analysis` ·
`objective_reflection`

So the ceiling on autonomy today is not capability. It is that almost nothing
asks the loop to do anything.

## Two failures, and what they actually were

**`repo_health` failed every night from the 14th.** Not a broken executor — a
broken target. The reflection model names its own `target_id` and kept naming
the *objective*: `McCluster`, `McCluster/autonomous-data-center-pipeline`, once
the literal `owner/repo`. Each failed on the node with "repository not cloned".
A later allowlist check stopped the failures by **skipping** the job, which was
quieter and no more useful.

Fixed: an unusable target now falls back to the canonical repo instead of
dropping the job. `code_patch` deliberately does **not** get that fallback —
reading a repo you were not pointed at is cheap to get wrong, writing to one is
not. Proved by queueing a correct job: it came back `done`, and reported the
node holds the repo at `/srv/mccluster/repos/mccluster` on branch
`oauth/mcp-owner-auth-v1` with two uncommitted files.

**`objective_reflection` fails intermittently with `fetch failed`.** It calls
Ollama directly on `127.0.0.1:11434`. The node runs `max_leases: 1`, so when a
compute task holds the model, a second caller can time out. Transient, and the
job succeeds on most nights.

## The morning report was being thrown away

`digest.mjs` built the report at 07:30 daily, tried to text it, got
`twilio_not_configured` back, and then recorded it **only `if (ORG_ID)`** —
where `ORG_ID` comes from `MCCLUSTER_ORG_ID`, which is not set on the node.
`ops_signals` held exactly one row, a hand-run test.

Fixed: the digest resolves the house org itself when the variable is missing,
and **records before it tries to deliver**. Delivery is allowed to be absent;
the report is not. Configure Twilio and the same report starts arriving as a
text as well.

## Hard limits worth knowing

- `ovh-primary` is **CPU-only** — `load.gpu` is `[]`. Capabilities like
  `model3d.generate` in `core/compute-capabilities.example.json` need a GPU
  backend and cannot run here. `ai.chat` via Ollama is the realistic ceiling for
  node-served *models*.
- Node capabilities are read from `/etc/mccluster-node/capabilities.json`,
  deployed from `core/node-manifests/ovh-primary.json`. Adding one without a
  backend that implements it just advertises a lie.
- Five job types (`crm_reconcile`, `stakeholder_map`, `exposure_scan`,
  `campaign_optimizer`, `objective_discovery`) were queued **once, on
  6 September**, were never claimed, and were quarantined on 19 September. No
  executor was ever written for them. They are names, not features — the
  quarantine was correct, not a regression.
