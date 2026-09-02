# MCCLUSTER CONTROL PLANE — READ THIS FIRST

This file is the law for every McCluster repository, every Cloudflare project, and every agent (ChatGPT, Claude, Codex, Cursor, Gemini, Copilot, Grok).

If you skip it, you will invent a second backend, race a git push, or break a client product. That is exactly how the last agents failed.

## The plane

| Piece | Canonical |
| --- | --- |
| GitHub control repo | `mcclusterishere/mccluster` |
| GitHub org | `McCluster-Corp` |
| Cloudflare project (public edge + Git integration) | `mccluster` |
| Cloudflare Worker (API) | `mccluster-core` (`workers/mccluster-core`) |
| Public site | `https://matthew.mccluster.org` |
| Apex | `https://mccluster.org` → same property, not a second site |
| API | `https://api.mccluster.org` |
| Supabase | project `zmnhbrjyhxzhkxmhkexs` (`https://zmnhbrjyhxzhkxmhkexs.supabase.co`) |

**McCluster is the backend AND the control plane.** Product repos are satellites. Client sites are tenants. None of them own auth, billing, social, CRM, or admin.

## Hard rules

1. **Do not create a competing backend.** No new auth stack, no new Postgres, no new admin, no new social scheduler, no new Stripe account, in a satellite repo.
2. **Do not auto-push CI onto feature branches.** LiDAR and other heavy jobs use `workflow_dispatch` and artifacts. They never `git push` onto an open PR branch.
3. **Do not overwrite `index.html` or a client's shipping UI** unless the owner named that file in the task.
4. **Cloudflare project `mccluster` is not a Node compile of the whole git tree.** The Worker lives at `workers/mccluster-core`. The public site is static and ships to `matthew.mccluster.org`. Root `wrangler.toml` exists so Git integration does not fail in zero seconds looking for a Worker named `mccluster`.
5. **Supabase `zmnhbrjyhxzhkxmhkexs` is the shared data plane.** New tables belong there (or on the Control desk). Public anon key is public by design; RLS is the wall.
6. **Client social is a McCluster service.** Every client backend gets accounts, campaigns, and a queue on the plane. Satellites may display and submit. They are not the source of truth.
7. **Preserve local product law.** PRIM3 Site 0, Uprise World, and any repo-specific gates below this section still apply. Control-plane law does not delete them.
8. **If a task wants you to "rebuild", "simplify", or "migrate to a new stack": stop.** Route the work through McCluster. Ask only if the owner is explicitly retiring a satellite.

## Files every agent must honor

On the control repo:

- `AGENTS.md` (this law + local product gates)
- `CLAUDE.md` / `GEMINI.md` / `.cursorrules` / `.github/copilot-instructions.md`
- `docs/control-plane/ECOSYSTEM.md`
- `docs/control-plane/registry.json`

On every satellite: the same four agent files, pointing here.

## Owner

Matthew McCluster / McCluster Corp (Connecticut public charity CHR.0069693). Operator desk is the McCluster Control admin.