# McCluster ecosystem

Single source of truth for how the house is wired. Agents: if this disagrees with a satellite README, this wins.

## Map

```
                    mccluster.org  ──alias──►  matthew.mccluster.org
                                                      │
                         Cloudflare project `mccluster` (static edge)
                                                      │
                              GitHub mcclusterishere/mccluster
                                      │           │
                                      │           └── workers/mccluster-core
                                      │                    │
                                      │           Cloudflare Worker `mccluster-core`
                                      │                    │
                                      │              api.mccluster.org
                                      │                    │
                                      └────────► Supabase zmnhbrjyhxzhkxmhkexs
                                                       │
                          client satellites + product satellites (GitHub)
```

## What lives where

| Concern | Where |
| --- | --- |
| Public pages, twin, civic directory | `mccluster` static → matthew.mccluster.org |
| Operator desk (this Control app) | McCluster Control (auth + desk DB) |
| API / webhooks | Worker `mccluster-core` |
| Shared tables (fellowships, inbox, checkout, social) | Supabase `zmnhbrjyhxzhkxmhkexs` |
| Product UI | Satellite repos listed in `registry.json` |
| Client social calendars | McCluster Control social layer |

## Pipeline rules (the failures we already paid for)

- **PR merge dirty:** never let a workflow commit generated LiDAR (or any binary) onto an open feature branch. Use `workflow_dispatch` + artifacts.
- **Cloudflare pending/failed in 0s:** Git integration must see a root `wrangler.toml`. Project name `mccluster` is the edge. Do not point it at a missing Worker compile of the whole tree. Worker API is a second project: `mccluster-core`.
- **Push rejected (fetch first):** two writers on `feature/s477-smart-church`. Humans push product; CI must not.

## Adding a satellite

1. Create the GitHub repo.
2. Copy `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md` from this kit.
3. Write an `AGENTS.md` that starts with the control-plane block and then any local law.
4. Add a row to `docs/control-plane/registry.json`.
5. Give the client a social backend on the Control desk. Do not invent a scheduler in the satellite.

## Supabase

The project already exists (`zmnhbrjyhxzhkxmhkexs`). Do not open a second Supabase project for a client unless the owner says so. Control-plane tables can land as `supabase/migrations/` here, with RLS, or on the Control desk database. The public REST surface for Equity Uprise is documented in `llms.txt`.