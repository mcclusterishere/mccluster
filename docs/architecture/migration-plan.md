# MIGRATION PLAN: McCluster Core adoption

Status: current plan as of 2026-09-12. This supersedes the earlier Railway/Docker deployment recommendation.

The migration is additive. Existing public pages, Worker routes, Supabase data, and product applications continue operating while Core is introduced.

## Fixed decisions

- Cloudflare Worker `mccluster` remains the public API and remote MCP edge.
- Supabase `zmnhbrjyhxzhkxmhkexs` remains the authoritative data plane.
- OVH `vps-af4e71d9.vps.ovh.us` is the persistent **McCluster Core** execution plane.
- Native Ubuntu packages and systemd are used; Docker is not required.
- No Worker named `mccluster-core` may be created.
- Core must not create parallel auth, Postgres, CRM, memory, asset, job, or audit truth.

## Sequence

| Phase | Deliverable | Gate |
| --- | --- | --- |
| 0 | Align agent law and architecture documentation | Documentation review |
| 1 | Harden the OVH host: updates, key-only SSH, firewall, time sync, log rotation, monitoring | Verified recovery access |
| 2 | Deploy Hitman's Halo loopback-only as a systemd service | Local health check |
| 3 | Add authenticated Cloudflare ingress for the owner-facing Halo hostname | Unauthorized access denied |
| 4 | Deploy the Core harness, scheduler, and queue-consumer skeleton with service limits | Reboot persistence and health checks |
| 5 | Establish dedicated Worker-to-Core authentication and replay protection | Negative and positive auth tests |
| 6 | Merge/deploy the Worker remote-MCP route and verify protocol initialization, `tools/list`, and non-billable `tools/call` | Real client connection |
| 7 | Dispatch one asynchronous MCP job to Core and persist status/result in Supabase | End-to-end audit trail |
| 8 | Add persistent creative entities and remaining approved tools using existing schemas/contracts | RLS, budget, lineage tests |
| 9 | Add GitHub/build agents and additional long-running workers incrementally | Per-tool approval and rollback tests |

## Resource envelope

Baseline the machine before setting limits. Plan managed services around no more than roughly 80% sustained CPU and RAM, preserve roughly 20% for the OS, SSH, deployment, recovery, and bursts, and alert before disk reaches 80%. Use systemd controls rather than artificial load.

## Operations

Every Core service must have:

- a dedicated least-privilege user where practical;
- an explicit working directory and restricted environment file;
- restart policy and bounded restart delay;
- health check;
- structured or journal-compatible logs with retention;
- resource limits;
- documented update and rollback commands;
- reboot-persistence test.

## Data and security

Supabase stores canonical state. Core may maintain bounded ephemeral caches and work directories, but cache loss must not erase authoritative job, memory, cost, lineage, approval, or asset records.

Do not expose Halo port 4173, agent control ports, build services, or administrative dashboards directly. Public access must cross an authenticated HTTPS boundary. Never print or commit secrets.

## Verification evidence

Completion requires production commit SHAs, Worker deployment identifier, active systemd units, resource-limit output, health checks, authorization rejection tests, MCP tool discovery output, and one non-billable end-to-end durable job.

The previous Railway cost table and `RAILWAY_TOKEN` dependency are retired from the target architecture. Existing Railway-era source files may remain as historical or portable scaffolding, but agents must not treat them as the current deployment plan.
