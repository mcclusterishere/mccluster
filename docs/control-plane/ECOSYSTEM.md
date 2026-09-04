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
| Client payments / Stripe Connect | Control plane only — `docs/control-plane/CLIENT-PAYMENTS.md` |
| Product UI | Satellite repos in `registry.json` |
| Old website copy | `mcclusterishere/Here` — do not deploy from it |

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
5. Give the client a social backend on the Control desk. Do not invent a scheduler in the satellite.
6. If the client takes money, give them a Connect rail on the plane (`docs/control-plane/CLIENT-PAYMENTS.md`). A satellite never holds a Stripe key.

## Supabase

The project already exists (`zmnhbrjyhxzhkxmhkexs`). Do not open a second Supabase project for a client unless the owner says so.
