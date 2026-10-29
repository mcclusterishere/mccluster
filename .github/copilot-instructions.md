# GitHub Copilot — McCluster

This repository participates in the McCluster control plane. Read `AGENTS.md` first: it is the law, and this file only points at it.

Read `docs/control-plane/AI-HARNESS.md` before implementing AI, agent, memory, RAG, conversation-history, provider-routing, or autonomous-company features (`AGENTS.md` → "AI work: read the harness first"). Private AI context lives in Supabase schema `ai_context`, not in public Git; no AI provider owns memory, and there is no shadow vector store, second conversation database, raw-chat directory or separate memory service.

The autonomous operations contract (what an unattended agent may do, what needs explicit human approval, and the outreach CRM invariant) lives in `AGENTS.md` → "Autonomous operations contract". It applies to every agent, not only Copilot.

## The plane

| Piece | Canonical |
| --- | --- |
| Control plane (GitHub control repo) | `mcclusterishere/mccluster` |
| Cloudflare project + Worker: public edge and API `https://api.mccluster.org` (`mccluster-mcp` is its stateless MCP transport) | `mccluster`, source `workers/mccluster` |
| Supabase (shared durable truth) | `zmnhbrjyhxzhkxmhkexs` |
| Persistent execution | OVH McCluster Core from `core/`, promoted through `deploy/ovh-production`: not a Worker, not a second backend |
| Matthew McCluster's property | `https://matthew.mccluster.org` (GitHub Pages, this repo) |
| McCluster Corp's property | `https://mccluster.org` (Worker `mccluster` by host once routed); `https://humanuprise.com` is a McCluster Corp host too |

There is no Worker named `mccluster-core`. Do not create one. Do not scaffold a new API server, auth provider, or database; route shared work through McCluster.

## Two properties, two entities

`docs/control-plane/DOMAINS-AND-ENTITIES.md` is the authority. `https://matthew.mccluster.org` is **Matthew McCluster's** personal property (GitHub Pages, this repo). `https://mccluster.org` is **McCluster Corp's** company property served by Worker `mccluster` by host once routed; its root is the Equity Uprise World (Equity Uprise is the public brand, owner 2026-10-28) and the company page is `/company`. `https://humanuprise.com` is a legacy-named door to the World, a McCluster Corp host, never a third entity. Never collapse the two entities or properties.

## Hard rules — headings only; the law is `AGENTS.md` → Hard rules

1. Do not create a competing backend.
2. Do not auto-push CI onto feature branches.
3. Do not overwrite `index.html` or a client's shipping UI unless the owner named that file.
4. Cloudflare Worker `mccluster` is not a Node compile of the whole git tree.
5. Supabase `zmnhbrjyhxzhkxmhkexs` is the shared data plane.
6. Client social is a McCluster service.
7. Preserve local product law.
8. If a task wants you to "rebuild", "simplify", or "migrate to a new stack": stop.
9. Do not invent infrastructure names.
10. Keep exporting `HereTenantAgent`.
11. Never draw a logo.
12. `mcclusterishere/Here` is dead.
13. Canonical AI name: McCluster.
14. Mobile first, responsive up.
15. Two properties, two entities. Never collapse them.

## Local product gates (control repo only; satellites do not copy these)

Hard rule 7 keeps them. Read the gate itself before the work, never a summary of it:

- Equity Uprise building, floors, B1, roof, 3D, 360, plans, renders, hotspots or spatial lore: `docs/design/equity-uprise-building/AGENTS.md` (run its context audit), then `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md` and the files it orders. Generated images are never geometry authority. Program status lives there and in `PROJECT-STATE.md`, not here.
- Uprise World / Living Sketch: `AGENTS.md` → "Uprise World" and `docs/uprise-world/`.
- PRIM3 Site 0 / Ground Zero: `assets/3d/prim3-site0/AGENTS.md`.
- Game worlds, portals, per-world saves: `docs/universe/UNIVERSE-SCHEMA.md`.
