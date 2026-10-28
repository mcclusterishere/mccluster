---
applyTo: "**"
---

This repository is part of the McCluster control plane. Read `AGENTS.md` before editing: it is the law, and this file only points at it. Read `docs/control-plane/AI-HARNESS.md` before AI, agent, memory, RAG, conversation-history, provider-routing, or autonomous-company work.

The plane: GitHub `mcclusterishere/mccluster` (control repo) + Cloudflare Worker `mccluster` (source `workers/mccluster`; public edge and API `https://api.mccluster.org`; `mccluster-mcp` is its stateless MCP transport) + Supabase `zmnhbrjyhxzhkxmhkexs` (shared durable truth) + OVH McCluster Core (`core/`, persistent execution; not a Worker, not a second backend). There is no Worker named `mccluster-core`. Do not create one. Do not scaffold a parallel API, auth provider, or database.

Two properties, two entities (`docs/control-plane/DOMAINS-AND-ENTITIES.md`): `matthew.mccluster.org` is Matthew McCluster's personal property (GitHub Pages, this repo); `mccluster.org` is McCluster Corp's company property served by Worker `mccluster` by host once routed; `humanuprise.com` is a McCluster Corp host, never a third entity. Never collapse them.

Hard rules — headings only; the law is `AGENTS.md` → Hard rules:
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

Local product gates (control repo only; satellites do not copy these): Equity Uprise building, floor, B1, roof, 3D, 360, plan, render or spatial-lore work reads `docs/design/equity-uprise-building/AGENTS.md` (run its context audit) and then `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md` and the files it orders, and generated images are never geometry authority; Uprise World / Living Sketch reads `AGENTS.md` → "Uprise World" and `docs/uprise-world/`; PRIM3 Site 0 reads `assets/3d/prim3-site0/AGENTS.md`; game worlds and portals read `docs/universe/UNIVERSE-SCHEMA.md`.
