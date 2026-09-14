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

## Architectural laws

1. Supabase is canonical durable truth. Do not create a second McCluster control-plane database or memory database.
2. Cloudflare is the public edge, not the durable brain. There is one canonical Worker named `mccluster`; do not create `mccluster-core` as a second Worker.
3. OVH McCluster Core is the persistent execution plane. Do not create a parallel scheduler or workflow engine that duplicates `ops_agent_jobs`, objective planning, or Core execution.
4. Products are workloads. They consume shared identity, data, capabilities and execution rather than creating their own platform spine.
5. Compute nodes are workers. They do not receive Supabase service-role credentials or independent control-plane authority.
6. Models propose bounded actions through policy gates. Models do not directly merge, deploy, purchase, sign contracts, or bypass human authority.
7. Production promotion flows through tested source and `deploy/ovh-production`; arbitrary historical branches are never production architecture authorities.
8. Historical branches may be mined for ideas, but useful concepts must be rebuilt fresh from current `main`.

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
- a second memory store duplicating private `ai_context` or canonical durable state;
- direct model-to-production deploy/merge/purchase/contract authority;
- Supabase service-role credentials on compute nodes;
- product-local McCluster identity namespaces;
- routine production deployment from arbitrary SSH checkouts rather than the promoted deployment ref.

If a future architecture intentionally needs to change one of these laws, update the canonical manifest and this document in the same reviewed PR as the implementation. Do not bypass the contract with an exception hidden in code.
