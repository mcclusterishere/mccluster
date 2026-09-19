# Canonical McCluster architecture

This document is the human-readable architecture authority. The machine-readable authority is `docs/control-plane/canonical-architecture.json`.

> Products are workloads. McCluster is the platform.

## Canonical planes

| Plane | Canonical system | Responsibility |
| --- | --- | --- |
| Durable truth | Supabase project `zmnhbrjyhxzhkxmhkexs` | identity, orgs, objectives, jobs, media, compute, communications, learning, audit, provenance |
| Public edge | Cloudflare Worker `mccluster` from `workers/mccluster` | ingress, auth, routing, API normalization |
| Persistent execution | OVH McCluster Core from `core/` | runner, local models, tools, objectives, orchestration |
| Source and promotion | `mcclusterishere/mccluster` | source, CI, reviewed promotion, deployment refs |
| Specialized compute | compute-node protocol | GPU/desktop/specialized execution only |

## MCP transport isolation

`mccluster-mcp` from `workers/mccluster-mcp` is a stateless transport edge on
`mcp.mccluster.org`. It uses the existing Supabase house-owner gate, capability
catalog and OVH broker. It owns no identity, durable data, scheduler or jobs.
The API Worker remains `mccluster`; the forbidden `mccluster-core` Worker is not
introduced. The legacy `/v1/core/mcp` route remains until clients migrate.
Activation is a reviewed deployment, separate from implementing this extraction.

## Canonical orchestration

The canonical durable job system is `ops_agent_jobs`. The canonical objective system is `ops_objectives`. Private conversation memory lives under `ai_context`; public jobs store bounded references rather than raw private transcripts. Semantic capabilities are resolved through `core/capabilities/catalog.json`, executed by `core/src/runner.mjs`, and exposed to Core through `core/src/tool-broker.mjs`.

Conversation ingestion, objective synthesis, dependency-aware plans, communications turns, game-studio jobs, code-patch drafts, host health, and future autonomous work must converge on those canonical systems instead of inventing parallel queues, objective stores, schedulers, workflow engines, or memory databases.

## Canonical infrastructure control

Acting on the infrastructure — GitHub, Cloudflare, the Supabase project, the OVH host, the public site and the satellites — is `/v1/ops` on Worker `mccluster`. `ops_estate_nodes` bounds what may be acted on, `ops_action_policy` binds each action to a capability, and `control_commands` is the ledger. Authorization is the existing control ladder: `infra.read`, `infra.operate`, and `infra.mutate`, which is high risk and therefore requires a `control_approvals` row a house owner decided, bound to the exact request hash.

Provider credentials live on the Worker and nowhere else. Agents, satellites and compute nodes do not hold GitHub, Cloudflare, Supabase management or OVH credentials of their own, and no second path may reach a provider around the capability gate and the ledger. See `INFRASTRUCTURE-CONTROL.md`.
## Operational ontology

The operational ontology is a semantic and kinetic layer **inside the canonical Supabase/Core architecture**, not a new control plane.

- `ops_ontology_types` defines organization-scoped object types.
- `ops_ontology_objects` materializes selected canonical records with source provenance.
- `ops_ontology_link_types` and `ops_ontology_links` create typed relationships.
- `ops_ontology_action_types` declares bounded governed actions.
- `ops_ontology_action_runs` and `ops_ontology_lineage` preserve attribution, idempotency, results, and change evidence.
- Core exposes the stable capabilities `ontology.schema`, `ontology.query`, `ontology.neighbors`, and `ontology.action.apply`.

The ontology does not replace canonical domain tables. Source-backed fields are synchronized from those tables; v1 actions may only write the ontology's owner-controlled annotations/tags or compatible typed links. External side effects, money movement, deployment, communications, and production mutations continue through their existing capability/policy gates.

Remote ontology writes are attributable to the authenticated house owner because Cloudflare overwrites actor metadata and includes it inside the signed edge-to-Core MCP request.

## Architectural laws

1. Supabase is canonical durable truth. Do not create a second McCluster control-plane database or memory database.
2. Cloudflare is the public edge, not the durable brain. There is one canonical Worker named `mccluster`; do not create `mccluster-core` as a second Worker.
3. OVH McCluster Core is the persistent execution plane. Do not create a parallel scheduler or workflow engine that duplicates `ops_agent_jobs`, `ops_objectives`, objective planning, or Core execution.
4. Products are workloads. They consume shared identity, data, capabilities and execution rather than creating their own platform spine.
5. Compute nodes are workers. They do not receive Supabase service-role credentials or independent control-plane authority.
6. Models propose bounded actions through policy gates. Models do not directly merge, deploy, purchase, sign contracts, or bypass human authority. On infrastructure this is enforced rather than asserted: `/v1/ops` refuses every `infra.mutate` action without an owner-decided approval bound to that exact request.
7. Production promotion flows through tested source and `deploy/ovh-production`; arbitrary historical branches are never production architecture authorities.
8. Historical branches may be mined for ideas, but useful concepts must be rebuilt fresh from current `main`.
9. The human-readable and machine-readable architecture contracts change together. A PR may not silently change one without the other.
10. New root-level Fabric, event-mesh, scheduler, or orchestrator control planes are forbidden unless this architecture is deliberately revised in the same reviewed change.

## Superseded branch quarantine

The branches below are retained only as historical evidence and are explicitly not merge targets. The architecture CI contract rejects pull requests whose head branch is listed here through the machine-readable manifest.

### Fabric / event-mesh era

- `reconcile/autonomy-fabric-stack-v1`
- `reconcile/autonomy-fabric-stack-v1-clean`
- `reconcile/autonomy-fabric-stack-v2`
- `reconcile/core-harness-20260912`
- `db/reconcile-live-fabric-v1`
- `openai/three-node-event-mesh-v1`
- `grok/ai-harness-plane`

### Superseded Core runtime variants

- `core/runner-v0`
- `core/runtime-v1`
- `core/node-agent-v1`
- `core/node-agent-v1-rebuild`
- `core/autonomous-game-studio-v0.1`
- `core/autonomous-game-studio-v0.2-reconciled`

### Superseded control/deployment paths

- `control-plane/agent-kit`
- `control-plane/kill-core-name-on-main`
- `ops/bootstrap-ovh-now`
- `ops/ovh-repo-sync`
- `deploy/ovh-dc6fcec`
- `backup/pr93-pre-reconcile-20260913`

This quarantine does **not** mean the history is useless. It means those branches cannot define current system shape. Their useful ideas must pass through the salvage protocol below.

## Salvage protocol

When an old branch contains something useful:

1. Identify the smallest useful concept, not the branch as a merge unit.
2. Re-implement it from current `main`.
3. Preserve current privacy boundaries, idempotency, authorization, deployment provenance, supply-chain pins and human-approval gates.
4. Add tests proving it composes with the current architecture.
5. Never resolve conflicts by restoring old control-plane assumptions.

## Explicitly forbidden resurrection patterns

Do not introduce:

- a second Supabase project as the McCluster control plane;
- a second Worker named `mccluster-core`;
- a second scheduler/workflow engine duplicating Core + `ops_agent_jobs`;
- a second objective system duplicating `ops_objectives`;
- a second memory store duplicating private `ai_context` or canonical durable state;
- direct model-to-production deploy/merge/purchase/contract authority;
- Supabase service-role credentials on compute nodes;
- product-local McCluster identity namespaces;
- routine production deployment from arbitrary SSH checkouts rather than the promoted deployment ref.

If a future architecture intentionally needs to change one of these laws, update the canonical manifest and this document in the same reviewed PR as the implementation. Do not bypass the contract with an exception hidden in code.
