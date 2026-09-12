# McCluster ecosystem

Single source of truth for how the house is wired. Agents: if this disagrees with a satellite README, this wins.

## Map

```text
Remote clients / product satellites
              |
              v
api.mccluster.org -- Cloudflare Worker `mccluster`
       | short work             | durable/machine work
       v                        v
Supabase                     OVH McCluster Core
authoritative state          persistent execution
       ^                        |
       +------------------------+
          job status/results
```

The public site remains `matthew.mccluster.org`; `mccluster.org` aliases the same property.

## What lives where

| Concern | Where |
| --- | --- |
| Public pages | GitHub Pages from `mcclusterishere/mccluster` |
| Operator desk | McCluster Control |
| Public API, authentication boundary, webhooks, remote MCP transport | Cloudflare Worker `mccluster` |
| Worker source | `workers/mccluster` |
| Identities, private memory, CRM, jobs, approvals, costs, lineage, audit state | Supabase `zmnhbrjyhxzhkxmhkexs` |
| Halo, persistent harness, long-running agents, schedulers, queue consumers, builds, controlled execution, caches | OVH **McCluster Core** |
| Hitman's Halo source | `mcclusterishere/hitmans-halo` |
| Product UI | Satellite repos in `registry.json` |
| Old website copy | `mcclusterishere/Here` — do not deploy |

## Pipeline rules

- Never let a workflow commit generated LiDAR onto an open feature branch.
- Cloudflare Git integration root is `workers/mccluster`; deploy with `npx wrangler deploy`.
- Worker `mccluster` must keep exporting `HereTenantAgent`.
- There is no second Worker named `mccluster-core`. Do not create one.
- **McCluster Core is allowed and required as the registered OVH execution plane.** It must not duplicate Supabase auth, memory, CRM, asset, job, or audit truth.
- Core services use native Ubuntu packages and systemd; no Docker requirement.
- Long-running MCP operations return durable job identifiers and record state through canonical Worker/Supabase contracts.
- Humans push product; CI must not push onto an open PR branch.
- `Here` does not ship the public domains.

## Adding a satellite

1. Create the GitHub repo.
2. Copy the current model instruction files from this control repo.
3. Write an `AGENTS.md` that starts with the control-plane block and preserves local product law.
4. Add the repository to `docs/control-plane/registry.json`.
5. Use McCluster identity, CRM, billing, memory, and job contracts; do not invent a competing source of truth.

## Infrastructure changes

Read [MCCLUSTER-CORE.md](MCCLUSTER-CORE.md) before backend, hosting, MCP, harness, agent, queue, or infrastructure work. The rule against a competing backend must never be interpreted as a prohibition on the registered Core execution plane.

## Supabase

The project already exists. Do not open a second Supabase project for a client unless the owner explicitly retires the canonical arrangement.
