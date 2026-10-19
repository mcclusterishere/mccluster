# McCluster OS: from control plane to production goods

Owner direction, 2026-10-19: McCluster is an operating system and an
ecosystem. From Control, an operator must be able to generate, train and ship
production goods (models, media, sites, games, missions, services) through the
same governed path, and everything must be productizable.

This plan records what is already true, what the gates are, and the first slice.
It is sequencing, not a second architecture. `CANONICAL-ARCHITECTURE.md` and
`canonical-architecture.json` remain the law; `OPERATIONAL-INTELLIGENCE-FINISH-LINE.md`
remains the acceptance ledger. Nothing here is live until its PR, migration and
runtime receipt exist.

## Verified today (2026-10-19, read-only through the Core MCP transport)

| Fact | Evidence |
| --- | --- |
| Edge, Core and the OVH node answer end to end | `ai.chat` task `b0c4190f…` queued 00:53:59Z, done 00:54:22Z on `node_de24842c…`, output from `qwen3.8b.local` |
| Core runtime is stale | `core_resume`: `core_commit 77dfb0e8…`, deployed 2026-10-05; approved ref is `e553e2dc…` (#510) |
| Core cannot read the repository | `repo.inspect` → `git exited with 255`; reconciler fails at fetch (#510) |
| Catalog | version `2026-09-22.1`, 42 capabilities, 41 bindings |
| Queue | no active, queued or stale jobs; one `objective_reflection` timeout; one objective (Autonomous Data Center Pipeline, priority 95) |
| Compute | one node, CPU only (8 vCPU, 24 GB), one implementation: `ai.chat → qwen3:8b` |

The pre-runner GitHub Actions failure (#521) and private-repository fetch failure
(#510) were observed after the repository became private. That timing does not
establish a shared root cause. #521 requires owner verification of the actual
runner/account restriction; read-only repository access must be repaired
separately for host code work. Neither infrastructure track is a blanket
prerequisite for independently safe documentation, SDK, UI, local-evaluation,
or Cloudflare work.

## What "OS" means here, in the existing terms

| OS concept | McCluster canonical system | Status |
| --- | --- | --- |
| Kernel: identity, authority, durable truth | Supabase `zmnhbrjyhxzhkxmhkexs`, M Account, orgs, RLS | live |
| Syscalls: what a program may ask for | Capability Registry, `core/capabilities/catalog.json` | live, 42 ids |
| Scheduler: durable work | `ops_agent_jobs`, `ops_objectives`, `ops_compute_tasks` | live |
| Drivers: who executes | Core runner on OVH + compute-node protocol | live, one CPU node |
| Shell: the operator's front door | Control (Intelligence / Operations / Studio) | live, see #148 |
| Package manager: sellable modules | module manifests per `MCCLUSTER-OS-REUSE-AUDIT.md` | design only |
| Memory: private cross-model context | `ai_context`, `ops_ai_threads` / `ops_ai_messages` | live |
| SDK: typed contracts for programs | RFC-001 (#518) | proposed |
| Installations and federation | RFC-002 (#519) | proposed, G0 prototype only |

The platform already has an operating control plane, durable scheduler and
one CPU worker, but it is **not yet a general installable operating system**.
What is missing is the governed product layer: additional compute bindings,
contracts and evaluations, package/publish lifecycle, and Control actions that
let operators run verified production jobs without a runbook.

## Gate status against the finish line

| Gate | State on 2026-10-19 |
| --- | --- |
| 0 canonical control plane | complete |
| 1 operational ontology | in progress; ontology capabilities exist |
| 2 universal ingestion + entity resolution | capabilities exist (`ingest.*`, `entity.*`, `facts.*`); connectors thin |
| 3 governed actions + write-back | partial (`ontology.action.apply`, approvals) |
| 4 object explorer UI | not started in Control |
| 5 ontology-bound agents + evals | #476 learning pilot (draft), RFC-001 evaluation protocol (draft) |
| 6 decision intelligence | #408 (draft, superseded branch policy applies) |
| 7 enterprise governance | partial: RLS, house-org scoping (#498), observability |
| 8 deployment and fleet control | partial: exact-SHA deploys, drift contract; reconciler currently broken |
| 9 reusable installation | RFC-002 G0 only |

## The production-goods path

Every good follows one chain, and the chain is already the law:

`objective → plan → capability job → compute → evidence → review/approval → published good → ledger`

What the operator sees in Control is a single **Build** action per good type.
What the platform runs underneath is a capability. The first goods, in order of
how much already exists:

1. **Media goods** (image, video, audio, 3D, world): capabilities exist and are
   provider-routed with budgets and lineage (`GENERATIVE-MEDIA-HARNESS.md`).
   Missing: a GPU node so the self-hosted bindings are real, and a Studio
   "Build" surface that submits, watches and publishes without the API.
2. **Code goods**: `code.build` cuts a worktree and opens a draft PR. It has
   never run in production (`AUTONOMY-STATE.md`). Missing: repository access on
   the node (#510), then a Control action and its eval.
3. **Site goods**: Website Studio (#493) and `site.edit`. Missing: migration
   replay, sandboxed processor, entitlement mapping.
4. **Game goods**: `game.build` loop exists for PRIM3. Missing: GPU media and
   the review stages proven once.
5. **Model goods** (the owner's shower thought): no capability exists yet.
   Required additions, all new forward-only work:
   - capabilities `dataset.build`, `model.finetune`, `model.evaluate`,
     `model.publish` in the catalog, risk class high, async, approval-gated;
   - a GPU compute node advertising them through the compute-node protocol
     (the current CPU-only node is not adequate for the proposed practical
   fine-tuning pipeline; tiny CPU experiments remain possible);
   - a model registry on the shared plane: `ops_models` (id, org, base,
     dataset hash, recipe hash, eval scores, cost, lineage, status) with RLS and
     no browser writes, written only by Core;
   - evals are the gate: a trained model is a good only when `model.evaluate`
     passes the pre-registered thresholds (RFC-001 evaluation protocol);
   - publication binds the trained model as a new implementation under an
     existing capability id, so products never name the model.
6. **Mission and service goods**: applications, assignments, proof, payouts
   (`MISSION-APPLICATIONS-AND-MODULAR-PRODUCTS.md`). Missing: the application
   workflow build and migration promotion.

## Productization rule

A product is a composition of modules; a module is a manifest with a stable
id, version, owned data, API/event contracts, dependencies, permissions,
readiness checks, meters and SKU mapping (`MCCLUSTER-OS-REUSE-AUDIT.md`).
Release audience, authorization, commercial entitlement and readiness are
independent axes and all must pass. Prices stay unset until the owner sets them.

## First slice, 30 days, in dependency order

1. Independent owner operations: investigate Actions runner failure #521
   (do not presume billing), establish main branch protection, and restore
   approved read-only git access for repository-dependent host work. These
   are distinct gates, **not prerequisites for safe independent PRs**.
2. Reconcile host runtime only for features that require its execution;
   verify exact serving SHA and health separately per #510.
3. Land Wave 1 in order (#512, #516, #502, #514, #520, #513, #517) on real CI.
4. Separately review and explicitly approve each required forward-only
   migration, tenant policy and ledger transition before application; do not
   infer SQL activation from a code merge. Follow `supabase/pending/README.md`.
5. Prove `code.build` once in production on a trivial task, with the draft PR
   as the receipt. This is the first autonomous production good.
6. Add one GPU compute node through the compute-node protocol and prove
   `image.generate` self-hosted end to end from Control · Studio.
7. Ratify RFC-001 contracts (schema + evaluation protocol) as a reviewed
   architecture change, both human and machine files together.
8. Add the four model capabilities and `ops_models` as a forward-only
   migration plus catalog change, behind approval; run one fine-tune on the GPU
   node with a pre-registered eval; publish nothing until the eval passes.
9. Control · Build: one surface, one "Build" per good, backed only by the
   capabilities above; no new admin shell, no new queue.
10. Module manifests for Missions, Globe, Analytics, Media, Creator presence,
    Commerce and Control, with meters and SKU placeholders.

Nothing in this slice adds a backend, a queue, an identity or a memory store.

## Parallel track: independent work Claude can execute now

These tasks must proceed on separate, reviewable PRs **without** waiting for
host credential recovery or a GPU purchase:

- Contract conformance tests for RFC-001 (#518), with synthetic identity,
  idempotency, missing-versus-empty, retry, and receipt-verification fixtures.
- A feature-flagged, house-owner-only `Control → Build → Code` interface that
  uses the **existing** `code.build` capability and canonical job records;
  never client-supplied grants, direct repo writes or a second scheduler.
- An installable module-manifest schema and offline package verification
  prototype using the canonical identity/entitlement boundary.
- A ten-task synthetic evaluation harness (A/B/C) from RFC-001, growing to
  the pre-registered 50-case set only after independent scoring works.
- Focused integration tests for Sovereign G0 and G1a in
  `mcclusterishere/McCluster-OS`, including cross-installation trust and
  replay-denial checks. Do **not** wire its experimental filesystem queue
  into the production authority plane.

No developer may claim a real production `code.build` PR, self-hosted media,
new model weights, or deployed sovereign node merely from mocked tests or
from merging these work-in-progress changes.

## What agents must not do while building this

- No `mccluster-core` Worker, no second scheduler, no filesystem queue
  (`@mccluster/task-queue` stays quarantined, RFC-001 D-decision).
- No capability advertised without a backend that executes it.
- No model, media or code good claimed live without a durable job receipt.
- No migration applied outside the ledger process; no history rewrite.
- No training on private conversations without consent and the `ai_context`
  boundary; `MCCLUSTER_LEARNING_ENABLED` stays off until #476 is promoted.
