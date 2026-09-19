# McCluster ecosystem

Canonical ecosystem map for how the house is wired. Agents: if this disagrees with a satellite README, this wins. For control-plane authority, `docs/control-plane/CANONICAL-ARCHITECTURE.md` and `docs/control-plane/canonical-architecture.json` are the explicit human- and machine-readable law.

> Products are workloads. McCluster is the platform.

## Map

```
                    mccluster.org  —alias—►  matthew.mccluster.org
                                                      │
                         Cloudflare project + Worker `mccluster`
                                      │               │
                                      │          api.mccluster.org
                                      │               │
                              GitHub mcclusterishere/mccluster
                                │          │          │
                                │          │          └── workers/mccluster
                                │          │
                                │          └────────────► Supabase zmnhbrjyhxzhkxmhkexs
                                │                           canonical durable truth
                                │
                                └── deploy/ovh-production ─► OVH McCluster Core
                                                            persistent execution
                                                                     │
                                                           specialized compute nodes
                                                                     │
                                                    products / satellites as workloads
```

## What lives where

| Concern | Where |
| --- | --- |
| Public pages | GitHub Pages from `mcclusterishere/mccluster` → matthew.mccluster.org |
| Operator desk | McCluster Control |
| API / webhooks | Cloudflare Worker `mccluster` |
| Infrastructure control | `/v1/ops` on Worker `mccluster` — see `INFRASTRUCTURE-CONTROL.md` |
| What the plane may act on | `ops_estate_nodes`, seeded from `registry.json` |
| Worker source | `workers/mccluster` |
| Stateless MCP transport | `workers/mccluster-mcp` → `mcp.mccluster.org` (activation requires deployment) |
| Persistent execution / orchestration | OVH McCluster Core from `core/` |
| Production Core promotion pointer | `deploy/ovh-production` |
| Shared durable truth | Supabase `zmnhbrjyhxzhkxmhkexs` |
| Specialized GPU / workstation execution | Compute-node protocol |
| Product UI | Satellite repos in `registry.json` |
| Identity | `m_people` + `m_auth_user_links` + `platform_profiles.mccluster_id` |
| McCluster Network | `network_profiles`, `network_follows`, `network_posts`, `network_reactions`, `network_activity` |
| Old website copy | `mcclusterishere/Here` — do not deploy from it |

## Identity law

A person has one McCluster ecosystem identity across the main McCluster property, every product satellite, and every participating customer ecosystem. `m_people.id` (`m_uid`) is the immutable internal person key. `platform_profiles.mccluster_id` is the user-chosen, globally unique public login/handle. App/org membership grants local authorization; it does not create a second identity.

Creating an account through a satellite creates/links the same McCluster ecosystem profile. Existing users sign into satellites with their existing McCluster identity. See `docs/architecture/identity-network.md` for the canonical contract.

The McCluster Network is the internal social layer for those identities: profiles, follow graph, native posts/reactions, and a privacy-controlled cross-satellite activity stream. Do not confuse it with the external social publishing subsystem (`social_accounts`, `social_posts`, campaigns, queues).

## Pipeline rules

- Never let a workflow commit generated LiDAR onto an open feature branch.
- Cloudflare Worker source is `workers/mccluster`; the canonical Worker name is `mccluster`.
- Worker deploy tooling must stay version-pinned and supply-chain guarded by CI.
- Worker `mccluster` already has Durable Objects named `HereTenantAgent`. That class must stay exported or deploys fail (error 10064). Do not delete-class it.
- There is no second Worker named `mccluster-core`. Do not create one.
- Supabase is durable truth; Cloudflare is ingress/routing; OVH Core is persistent execution. Do not collapse those roles into a parallel stack.
- Routine OVH production promotion goes through `deploy/ovh-production`; historical branches are not deployment sources.
- Compute nodes are capability workers and must not receive Supabase service-role credentials.
- Humans retain consequential authority; models do not directly merge, deploy, purchase, or sign contracts. `/v1/ops` enforces this: `infra.mutate` is high risk and needs an owner-decided approval bound to the exact request.
- Infrastructure changes go through `/v1/ops`, on the estate, in the ledger. Agents do not hold provider tokens of their own.
- Humans push product; CI must not push onto an open PR branch.
- `Here` does not ship matthew.mccluster.org or mccluster.org.

## Adding a satellite

1. Create the GitHub repo.
2. Copy `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md` from this kit.
3. Write an `AGENTS.md` that starts with the control-plane block and then any local law.
4. Add a row to `docs/control-plane/registry.json`.
5. Consume canonical McCluster identity. Do not add a satellite username/account namespace.
6. Register app/org membership and permissions separately from identity.
7. Publish any internal social/activity events into the McCluster Network contract rather than creating a separate satellite social graph.
8. Give the client an external-social backend on the Control desk when they need publishing/scheduling. Do not invent a scheduler in the satellite.
9. Use shared capabilities and Core execution rather than introducing a product-local control plane.

## Historical branch rule

Old branches are evidence, not architecture authority. Known superseded control-plane branches are quarantined in `canonical-architecture.json`, and CI rejects PRs directly from them. If one contains a useful concept, rebuild that concept on a fresh branch from current `main` and prove it against current privacy, security, idempotency, deployment and authority contracts.

## Supabase

The canonical project already exists (`zmnhbrjyhxzhkxmhkexs`). Do not create a second McCluster control-plane Supabase project. Product-specific isolation should use the existing tenancy/authorization model unless an explicit architecture change is reviewed.
