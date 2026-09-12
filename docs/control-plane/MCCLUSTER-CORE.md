# McCluster Core execution plane

Status: canonical architecture decision, adopted 2026-09-12.

## Purpose

**McCluster Core** is the owner-controlled, always-on execution plane for the McCluster ecosystem. It is not a second Cloudflare Worker, a second control plane, or a second database.

Canonical host:

- OVH VPS: `vps-af4e71d9.vps.ovh.us`
- IPv4: `15.204.235.103`
- Region: US-East / Vint Hill, Virginia
- Operating system: Ubuntu 26.04 LTS
- Capacity: 8 vCPU, 24 GB RAM, 200 GB NVMe
- Deployment model: native packages and systemd; no Docker

## One system, three runtime responsibilities

| Layer | Canonical responsibility |
| --- | --- |
| Cloudflare Worker `mccluster` at `api.mccluster.org` | Public HTTPS edge, authentication, remote MCP transport, request validation, short-lived orchestration, webhook ingress |
| Supabase `zmnhbrjyhxzhkxmhkexs` | Authoritative identities, memory, CRM, jobs, costs, lineage, approvals, audit records, and asset metadata |
| OVH McCluster Core | Persistent harness, Halo runtime, long-running agents, scheduled work, queue consumers, builds, controlled code execution, infrastructure tools, caches, and approved API brokers |

The existing rule “There is no Worker named `mccluster-core`” remains true. **McCluster Core is the OVH execution plane, not a Worker name.**

The rule against a competing backend forbids a satellite from inventing parallel auth, Postgres, CRM, memory, billing, or orchestration truth. It does not forbid Core from executing durable work against the canonical Worker/Supabase contracts.

## Workload contract

Core may host:

- Hitman's Halo / Seek First as a loopback-only systemd service behind authenticated Cloudflare access;
- the persistent McCluster AI/agent harness;
- scheduled agents and reconciliation workers;
- GitHub and build automation in controlled workspaces;
- MCP tools requiring long-lived processes, machine access, or execution beyond Worker limits;
- bounded caches and provider/API brokers;
- monitoring, health checks, and operational diagnostics.

Core must not:

- create a shadow memory, CRM, asset, job, or identity database;
- become a public unauthenticated API;
- expose application ports directly to the internet;
- store secrets in Git or return them through MCP;
- bypass approval, authorization, budget, provenance, or audit requirements.

## Remote MCP flow

Claude and other remote clients connect over HTTPS to the authenticated MCP surface at `api.mccluster.org`. The Worker handles protocol/authentication and either completes short operations or dispatches durable execution to Core. Core records status and results through the canonical Supabase/Worker contracts.

An asynchronous Core operation returns a durable job identifier. Job state, output references, costs, lineage, and approvals remain authoritative in Supabase.

## Resource policy

Use the purchased machine productively without making it fragile:

- plan managed workloads around no more than roughly 80% sustained CPU and RAM;
- retain roughly 20% headroom for SSH, operating-system services, deployment, recovery, and bursts;
- keep disk below 80% and alert before the threshold;
- enforce per-service systemd limits, restart policies, log rotation, and health checks;
- do not manufacture artificial load merely to reach a utilization target.

Measure the host before finalizing service limits.

## Deployment and security

- Native Ubuntu packages and systemd are canonical. Do not require Docker.
- SSH remains key-only; do not remove verified access during deployment.
- Services bind to loopback or a private interface unless explicitly reviewed.
- Public ingress uses authenticated Cloudflare routing or an equivalently reviewed HTTPS boundary.
- Machine-to-machine dispatch uses a dedicated, rotatable credential with replay-resistant validation.
- Secrets live in restricted server-side environment files or an approved secret store.
- Services must survive reboot and publish health without exposing secrets.
- Generated assets are copied into private McCluster storage, hashed, inspected, and assigned canonical storage paths.

## Repository roles

- `mcclusterishere/mccluster`: control-plane contracts, Worker, schemas, MCP surface, policies, and Core integration.
- `mcclusterishere/hitmans-halo`: Halo application and hosted runtime deployed onto Core.
- Product/client repositories remain satellites and must not create competing sources of truth.
