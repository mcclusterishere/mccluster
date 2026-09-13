# McCluster ecosystem

Single source of truth for how the house is wired. Agents: if this disagrees with a satellite README, this wins.

## Map

```
                    mccluster.org  —alias—►  matthew.mccluster.org
                                                      │
                         Cloudflare project + Worker `mccluster`
                                                      │
                              GitHub mcclusterishere/mccluster
                                      │           │
                                      │           └── workers/mccluster
                                      │                    │
                                      │              api.mccluster.org
                                      │                    │
                                      └───────► Supabase zmnhbrjyhxzhkxmhkexs
                                                       │
                          client satellites + product satellites (GitHub)
```

## What lives where

| Concern | Where |
| --- | --- |
| Public pages | GitHub Pages from `mcclusterishere/mccluster` → matthew.mccluster.org |
| Operator desk | McCluster Control |
| API / webhooks | Cloudflare Worker `mccluster` |
| Worker source | `workers/mccluster` |
| Shared tables | Supabase `zmnhbrjyhxzhkxmhkexs` |
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
- Cloudflare Git integration Root directory is `workers/mccluster`. Deploy command is `npx wrangler deploy`.
- Worker `mccluster` already has Durable Objects named `HereTenantAgent`. That class must stay exported or deploys fail (error 10064). Do not delete-class it.
- There is no second Worker named `mccluster-core`. Do not create one.
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

## Supabase

The project already exists (`zmnhbrjyhxzhkxmhkexs`). Do not open a second Supabase project for a client unless the owner says so.
