# McCluster Initiative OS v1

Status: implementation contract for owner-operated portfolio autonomy.

## Purpose

Initiative OS turns McCluster Core from a queue runner into an owner-directed operating system for a portfolio of businesses, products, creative projects, research, infrastructure, funding, and client work.

It is not a second backend. Supabase remains authoritative for objectives, jobs, approvals, audit records, costs, and durable state. Cloudflare remains public ingress. OVH McCluster Core remains the persistent execution plane.

## Operating loop

The target loop is:

`Dream -> Rank -> Reflect -> Work -> Review -> Morning brief -> Owner decision -> Execute -> Verify -> Remember`

The system is designed around two owner-controlled accelerator windows:

1. Night dream window: expensive compute is reserved for work that materially benefits from acceleration. Core ranks initiatives, expands the highest-value work, and prepares reversible outputs.
2. Morning execution window: after explicit owner approval, approved initiatives receive a second accelerator burst for completion, validation, artifact generation, or bounded implementation.

CPU/network waiting, polling, CI waiting, webhooks, durable queue state, and ordinary orchestration remain on the always-on Core host instead of burning premium GPU time.

## Canonical hierarchy

Initiative OS uses this conceptual hierarchy:

`portfolio -> project -> initiative -> objective -> plan -> task -> job -> artifact/result -> decision`

v1 deliberately does not create a new database schema for every level. It reads the existing canonical `ops_objectives` and `ops_agent_jobs` records and derives project/initiative grouping defensively from fields already present. Future schema migrations may materialize additional hierarchy only after the live production shape has been verified.

## Initiative scoring

`core/src/initiative-os.mjs` normalizes heterogeneous objective rows and ranks active initiatives using bounded signals:

- owner/objective priority;
- expected impact;
- urgency;
- confidence;
- deadline proximity;
- blocker status.

Completed, cancelled, archived, and paused objectives cannot win the nightly priority auction.

The scoring algorithm is deterministic. LLM output does not decide the ranking policy.

## Department lanes

Each initiative is routed to a stable logical owner lane:

- chief_of_staff
- engineering
- creative
- business_development
- funding
- operations
- research

These are logical work queues, not separate always-loaded models. One local or rented model may serve many department contexts through the same controlled execution fabric.

## Nightly v1 flow

At 02:00 America/New_York, `mccluster-core-portfolio-plan.timer` seeds one `portfolio_plan` job unless one is already pending.

The `portfolio_plan` executor:

1. reads canonical active objectives and recent job history from Supabase;
2. groups related objectives into initiatives;
3. ranks initiatives deterministically;
4. builds an executive portfolio snapshot;
5. queues up to three `objective_reflection` jobs for the highest-value initiatives.

Those reflection jobs retain the existing deterministic safety policy. They may create only `local_analysis` and `repo_health` work. They cannot directly create code patches, deployments, merges, communications, spending, legal actions, auth changes, destructive mutations, or production changes.

The existing 02:30 portfolio-wide objective reflection remains as a second safety/evidence pass. The 07:30 digest remains the morning reporting surface.

## Why v1 is intentionally bounded

The first milestone is dependable organizational cognition, not unrestricted action.

Before Initiative OS can autonomously create code, contact people, spend money, deploy, or mutate production, Core must have durable approval contracts for those action classes and evidence-producing executors that can prove what they intend to do.

The intended next sequence is:

1. dependency-aware plans and task DAGs;
2. stable `repo.inspect` capability;
3. approval-gated `code.build` producing draft PRs;
4. `deploy.preview` with tests, screenshots, metrics, and rollback evidence;
5. owner approval records that release consequential jobs;
6. GPU burst scheduler with a monthly budget and a hard per-window ceiling;
7. morning execution coordinator;
8. project/org memory ingestion with provenance;
9. capability-specific reviewers so builders never grade their own work.

## GPU burst contract

A future accelerator coordinator must treat premium GPU time as a budgeted scarce resource, not an always-on dependency.

Candidate GPU work should be ranked by a bounded utility function derived from business priority, expected impact, urgency, confidence, accelerator benefit, and estimated compute cost. Jobs that do not materially benefit from the accelerator stay on Core or another cheaper implementation.

The compute fabric remains provider-neutral. A B300, B200, H200, external API, local Ollama instance, or future accelerator is an implementation binding, never part of the stable capability name.

## Production safety

Initiative OS must never:

- create a shadow queue, database, memory plane, CRM, or auth system;
- treat an LLM recommendation as authorization;
- bypass budget or approval policy;
- expose Core loopback services publicly;
- give a compute node Supabase, GitHub production, Twilio, or other Core credentials;
- claim a planned capability is executable without a healthy implementation;
- silently promote generated work into production.

## Current v1 components

- `core/src/initiative-os.mjs` — deterministic normalization, grouping, scoring, department routing, and executive plan generation.
- `core/src/executors/portfolio-plan.mjs` — canonical objective/job reader and bounded reflection dispatcher.
- `core/src/seed-portfolio-plan.mjs` — duplicate-safe nightly seed.
- `core/systemd/mccluster-core-portfolio-plan.service` — hardened one-shot seed service.
- `core/systemd/mccluster-core-portfolio-plan.timer` — 02:00 nightly schedule.
- `core/test/initiative-os.test.mjs` — ranking, grouping, routing, and plan regression coverage.

## Deployment gate

Do not deploy this branch merely because it exists. Merge only after Reconciliation CI is green. Production synchronization must then install the new service/timer files, daemon-reload systemd, enable the timer, and verify that the runner advertises `portfolio_plan` as a supported job type.
