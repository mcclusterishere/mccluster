# McCluster ecosystem

Single source of truth for how the house is wired. Agents: if this disagrees with a satellite README, this wins.

## Map

```
                    mccluster.org  ──alias──►  matthew.mccluster.org
                                                      │
                         Cloudflare project + Worker `mccluster`
                                                      │
                              GitHub mcclusterishere/mccluster
                                      │           │
                                      │           └── workers/mccluster
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
| Public pages, twin, civic directory | static → matthew.mccluster.org |
| Operator desk | McCluster Control |
| API / webhooks | Cloudflare Worker `mccluster` |
| Shared tables | Supabase `zmnhbrjyhxzhkxmhkexs` |
| Product UI | Satellite repos in `registry.json` |
| Client social calendars | McCluster Control social layer |

## Pipeline rules

- Never let a workflow commit generated LiDAR onto an open feature branch.
- Git integration must see root `wrangler.toml` with `name = "mccluster"`.
- There is no second Worker named `mccluster-core`. Do not create one.
- Humans push product; CI must not push onto an open PR branch.

## Adding a satellite

1. Create the GitHub repo.
2. Copy `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md` from this kit.
3. Write an `AGENTS.md` that starts with the control-plane block and then any local law.
4. Add a row to `docs/control-plane/registry.json`.
5. Give the client a social backend on the Control desk. Do not invent a scheduler in the satellite.

## Supabase

The project already exists (`zmnhbrjyhxzhkxmhkexs`). Do not open a second Supabase project for a client unless the owner says so.
