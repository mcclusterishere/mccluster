# Claude / Codex / Cursor — stop

You are in the McCluster ecosystem. `AGENTS.md` is the law; this file is the stop list for a Claude session and points there. It carries no prose rules of its own beyond the list below.

1. Read `AGENTS.md` completely before any edit.
2. Read `docs/control-plane/ECOSYSTEM.md` if this is the control repo (`mcclusterishere/mccluster`).
3. Read `docs/control-plane/AI-HARNESS.md` before AI, agent, memory, RAG, conversation-history, provider-routing, or autonomous-company work.
4. **McCluster is the backend and the control plane.** GitHub `mcclusterishere/mccluster` + Cloudflare Worker `mccluster` + Supabase `zmnhbrjyhxzhkxmhkexs`.
5. This repo is either the plane or a satellite. Satellites do not grow a second auth, database, social, billing, Worker, admin stack, CRM, vector store, conversation database, or memory service.
6. Private cross-model context lives in Supabase schema `ai_context`. Do not commit raw Claude, ChatGPT, Grok, Gemini, Copilot, local-model, or other AI transcripts into public Git. When an adapter is available, ingest and retrieve through the canonical McCluster context plane.
7. Do not auto-push GitHub Actions onto feature branches.
8. Do not rewrite `index.html` or revive rejected visual systems.
9. If you were about to create a new backend or a Worker named `mccluster-core`: stop. That Worker does not exist. The canonical API Worker is `mccluster`; the stateless `mccluster-mcp` transport shares its authority (see CANONICAL-ARCHITECTURE.md).

One platform, tenant properties, separate entities (`docs/control-plane/DOMAINS-AND-ENTITIES.md`). Stage now: P1, the platform serves everything: every page answers at its path on the platform, and Matthew's host keeps answering every page (`data/seo/domain-architecture.json` → `stage_now`; what P1 changes: `edge.now.p1_changes`; what P0 changed before it: `edge.now.p0_changes`). P2 and P3 are planned, not shipped: P2 moves each page's canonical, sitemap entry, share card and WebSite to its set's host; P3 makes Matthew's host answer 301 to the same path on the platform for the pages that moved.
`https://mccluster.org` is **McCluster Corp's** platform (Worker `mccluster` by host; set in one place, `data/seo/domain-architecture.json` → `platform.origin`, which `tools/build-site-hosts.mjs` writes everywhere): its root is the Equity Uprise World (owner, 2026-10-15); **the public brand is Equity Uprise, not Human Uprise** (owner, 2026-10-28), and the company page is `/company`. It serves the whole site (stage P1): music, albums, artists, Creator Studio and the account (owner, 2026-11-23), every page at its path, with the HERE front door at `/index.html`, never at `/`. `https://equityuprise.com` becomes the platform later by changing that one setting (owner, 2026-11-23).
`https://matthew.mccluster.org` is **Matthew McCluster's** personal profile, a tenant of the platform (GitHub Pages, this repo; McCluster is his artist name, the same Person). Today it serves every page; from P3 its pages that moved answer 301 to the platform. Hosting is not identity: the two are not the same entity.
`https://humanuprise.com` is a legacy-named door to the World, a **McCluster Corp** host (the same entity as `mccluster.org`, never a third one), served by Worker `mccluster` by host (`workers/mccluster/src/human-uprise/router.js`) and inert until the owner routes it (until then the World's door is `mccluster.org`); once routed it answers 301 to the platform (owner default, 2026-11-23; the router answers so since P1).
API Worker: `mccluster` on `https://api.mccluster.org`.
Source: `workers/mccluster`.

10. **Never draw a logo.** The artwork the owner supplies is the only source of truth for any mark, forever. Do not trace it, approximate it, recolour it, or add a plate or tile it does not already contain. Do not crop supplied artwork. Scale the complete supplied artwork proportionally only. Adding a shape is drawing. Where a mark is the control (the Equity Uprise emblem is the join on the World screen), it stands alone: never write the mark out in words beside it or in product copy. If the variant you need does not exist, ask. See `AGENTS.md` → "THE LOGOS ARE NOT YOURS TO DRAW".
11. **`mcclusterishere/Here` is the old repo and publishes nothing.** Do not write to it. If a task looks like it belongs there, say so in the chat and work in this repo instead.

12. **Mobile first, responsive up.** Anything built from a Mobbin reference, or any reference, is designed at phone width first and then given room on tablet and desktop. Breakpoints only ADD; they never hide what the phone was shown. `min-width` queries only, `minmax(0,1fr)` never a bare `1fr`, form controls at `max(16px,…)`, never `user-scalable=no`. Verify by rendering at 390px and checking `scrollWidth === clientWidth`. Full rule and the reasons: `AGENTS.md` → Hard rules → 14.

13. **Never collapse McCluster Corp and Matthew McCluster.** What the platform shows as its own carries McCluster Corp's metadata (today its root and `/company`; every platform page from P2; Organization `url` `https://mccluster.org/`); Matthew's profile pages are Matthew-first wherever they are shown, with their canonical on `matthew.mccluster.org` (the I AM HERE album is a front door there, not the identity). Whip Equipped LLC is Matthew's separate company, not a McCluster Corp brand; PRIM3 is McCluster Corp's learning product. Keep stable `@id`s; the Organization's `url` is `https://mccluster.org/`. Read `docs/control-plane/DOMAINS-AND-ENTITIES.md` and `data/seo/domain-architecture.json` before touching the platform's or a tenant's metadata, structured data or navigation.

## The plane

| Piece | Canonical |
| --- | --- |
| Control plane (GitHub control repo) | `mcclusterishere/mccluster` |
| Cloudflare project + Worker: public edge and API `https://api.mccluster.org` (`mccluster-mcp` is its stateless MCP transport) | `mccluster`, source `workers/mccluster` |
| Supabase (shared durable truth) | `zmnhbrjyhxzhkxmhkexs` |
| Persistent execution | OVH McCluster Core from `core/`, promoted through `deploy/ovh-production`: not a Worker, not a second backend |
| McCluster Corp's platform | `https://mccluster.org`, set in one place (`data/seo/domain-architecture.json` → `platform.origin`), Worker `mccluster` by host: the whole site today (stage P1), the World at `/` and every other page at its path, canonicals moving in P2; `https://humanuprise.com` is a McCluster Corp door too |
| Matthew McCluster's profile | `https://matthew.mccluster.org` (GitHub Pages, this repo): a tenant of the platform; it still serves every page, and from P3 the pages that moved answer 301 to the platform |

There is no Worker named `mccluster-core`. Do not create one.

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
15. One platform, tenant properties, separate entities. Never collapse them.

## Local product gates (control repo only; satellites do not copy these)

Hard rule 7 keeps them. Read the gate itself before the work, never a summary of it:

- Equity Uprise building, floors, B1, roof, 3D, 360, plans, renders, hotspots or spatial lore: `docs/design/equity-uprise-building/AGENTS.md` (run its context audit), then `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md` and the files it orders: `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`, `docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md`, `docs/design/equity-uprise-building/BUILDING-CORE-V2-SPEC.md`, `docs/design/equity-uprise-building/production/equity-uprise-capability-map-v2.json`, and the relevant floor's spec, schematic basis, DXF/SVG and production package as listed in `REFERENCE-AUTHORITY.md`. Generated images are never geometry authority. Program status lives there and in `PROJECT-STATE.md`, not here.
- Uprise World / Living Sketch: `AGENTS.md` → "Uprise World" and `docs/uprise-world/`.
- PRIM3 Site 0 / Ground Zero: `assets/3d/prim3-site0/AGENTS.md`.
- Game worlds, portals, per-world saves: `docs/universe/UNIVERSE-SCHEMA.md`.
