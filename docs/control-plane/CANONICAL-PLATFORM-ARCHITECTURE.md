# Canonical McCluster Platform Architecture

Status: **canonical**.

> Products are workloads. McCluster is the platform.

This document is the human-readable companion to `architecture/platform-contract.json`. If an older branch, PR, note, or architecture document conflicts with this contract, this contract wins unless `main` is deliberately changed through review and the architecture contract CI is updated in the same change.

## Authority boundaries

### Supabase — durable truth
Supabase is the canonical durable data plane for identity, organizations, objectives, jobs, communications, media, compute, learning, product state, audit, and provenance. Runtime components may cache or materialize data, but they do not become a second system of record.

### Cloudflare — public edge
Cloudflare owns public ingress, authentication boundaries, routing, API normalization, and rate limiting. It is not the canonical database, workflow engine, or compute host.

### OVH McCluster Core — execution and intelligence
McCluster Core owns persistent execution, the runner, tool broker, local model access, objective execution, semantic capability resolution, and host supervision. Core executes against canonical Supabase state; it does not become a second public system of record.

### GitHub — source and promotion
GitHub owns source control, CI, review, and tested promotion/deploy refs. Git branches are not runtime truth. `deploy/ovh-production` is a promotion pointer, not an alternate code line.

### Compute nodes — specialized execution
Compute nodes execute bounded capabilities. They do not receive the Supabase service role, become canonical schedulers, or expose a parallel public control plane.

### Products — workloads
Whip Equipped, PRIM3, Equity Uprise, HERE, Seek First, client products, and future products are workloads on McCluster. A product may own product-specific UX and state, but must not create a competing platform control plane.

## Canonical orchestration

The canonical durable job system is `ops_agent_jobs`. The canonical objective system is `ops_objectives`. Semantic capabilities are resolved through the McCluster capability layer rather than binding platform architecture to individual vendors.

Conversation ingestion, objective synthesis, dependency-aware plans, communications turns, game-studio jobs, code-patch drafts, host health, and future autonomous work must converge on these canonical systems rather than inventing parallel queues or schedulers.

## Superseded Fabric-era branches

The following branches are historical/superseded and **must not be merged directly into `main`**:

- `db/reconcile-live-fabric-v1`
- `reconcile/autonomy-fabric-stack-v1`
- `reconcile/autonomy-fabric-stack-v1-clean`
- `reconcile/autonomy-fabric-stack-v2`

Useful ideas from those branches may be recovered only by rebuilding them on a fresh branch from current `main`, preserving current privacy, idempotency, security, deployment, capability, and authority contracts.

## Change rule

Changing this architecture is allowed, but it must be explicit. A legitimate architecture change must update both this document and `architecture/platform-contract.json`, pass architecture-contract CI, and explain why the authority boundary is changing. Silent architectural drift is a failure condition.
