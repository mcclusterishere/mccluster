# TARGET STATE: McCluster distributed control and execution plane

Status: current architecture as of 2026-09-12. This replaces the earlier Railway/container target.

## Shape

```text
GitHub mcclusterishere/mccluster
      |
      +--> Cloudflare Worker `mccluster` --> api.mccluster.org / remote MCP
      |              |                              |
      |              v                              v
      |       Supabase authoritative state <--> OVH McCluster Core
      |                                      persistent execution
      |
      +--> static/product deployments and satellite repositories
```

## Canonical responsibilities

### Cloudflare Worker `mccluster`

- public HTTPS API and remote MCP transport;
- authentication, authorization, validation, rate and budget gates;
- short-lived orchestration and webhook ingress;
- delegation of durable or machine-level work to Core;
- preservation of the `HereTenantAgent` Durable Object export.

There is no Worker named `mccluster-core`.

### Supabase `zmnhbrjyhxzhkxmhkexs`

Supabase remains authoritative for identities, organizations, private AI context, CRM, jobs, approvals, costs, lineage, audit history, creative entities, and asset metadata. Browser clients never receive service-role credentials. RLS and server-side authorization remain mandatory.

### OVH McCluster Core

The registered host `vps-af4e71d9.vps.ovh.us` runs persistent execution that does not fit the Worker lifecycle:

- Hitman's Halo / Seek First;
- the model-agnostic AI and agent harness;
- scheduled and long-running agents;
- queue consumers and reconciliation workers;
- controlled GitHub workspaces, builds, and code execution;
- infrastructure MCP tools;
- approved caches and provider/API brokers;
- monitoring and operational diagnostics.

Core uses native Ubuntu packages and systemd. Do not require Docker. Core is not a second database or competing control plane; every durable outcome is written through canonical contracts.

## MCP contract

Remote clients connect to the authenticated MCP endpoint on `api.mccluster.org`. The implementation must support the actual negotiated MCP transport and lifecycle, including initialization, tool discovery, tool invocation, structured errors, and authentication.

Short work may finish at the Worker. Long-running work is dispatched to Core and returns a durable job identifier. Status, approvals, outputs, cost, and lineage remain authoritative in Supabase.

## AI and media

Provider adapters remain replaceable. The existing media registry, budgeted job creation, cost reconciliation, asset saving, and comparison runner are reused. The persistent harness adds durable execution without copying their state.

Generated assets are copied to private McCluster storage, hashed, inspected, and assigned canonical storage paths. Provider URLs are provenance, not permanent storage.

## Resource and reliability policy

Managed Core workloads target no more than roughly 80% sustained CPU and RAM, leaving roughly 20% operational headroom. Disk alerts fire before 80% utilization. Each systemd service receives appropriate limits, restart behavior, health checks, and log rotation. Capacity is assigned to useful work; artificial load is prohibited.

## Security baseline

- key-only SSH;
- no public application ports;
- authenticated Cloudflare or equivalently reviewed HTTPS ingress;
- dedicated rotatable Worker-to-Core credentials with replay-resistant validation;
- restricted server-side secret files;
- least privilege and auditable actions;
- no raw private transcript or credential commits;
- no production deploy, external communication, spending, destructive change, or authorization change outside its approval policy.

## Repository structure

Existing code remains in place. New Core integration belongs in explicit packages or infrastructure paths in the control repo; Halo runtime code stays in `mcclusterishere/hitmans-halo`. Satellite repositories remain clients of the plane.

See `docs/control-plane/MCCLUSTER-CORE.md`, `AI-HARNESS.md`, and `GENERATIVE-MEDIA-HARNESS.md`.
