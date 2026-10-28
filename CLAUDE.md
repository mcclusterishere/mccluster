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

Two public properties, two entities (`docs/control-plane/DOMAINS-AND-ENTITIES.md`):
`https://matthew.mccluster.org` is **Matthew McCluster's** property (GitHub Pages, this repo);
`https://mccluster.org` is **McCluster Corp's** property (Worker `mccluster`, host-routed once the owner routes the apex): its root is the Equity Uprise World, the company's platform (owner, 2026-10-15); **the public brand is Equity Uprise, not Human Uprise** (owner, 2026-10-28), and the company page is `/company`. They are not the same site and not the same entity.
`https://humanuprise.com` is a legacy-named door to the World, a **McCluster Corp** host (the same entity as `mccluster.org`, never a third one), served by Worker `mccluster` by host (`workers/mccluster/src/human-uprise/router.js`) and inert until the owner routes it (until then the World's door is `mccluster.org`); everything that is not the World 301s to `matthew.mccluster.org`.
API Worker: `mccluster` on `https://api.mccluster.org`.
Source: `workers/mccluster`.

10. **Never draw a logo.** The artwork the owner supplies is the only source of truth for any mark, forever. Do not trace it, approximate it, recolour it, or add a plate or tile it does not already contain. Do not crop supplied artwork. Scale the complete supplied artwork proportionally only. Adding a shape is drawing. Where a mark is the control (the Equity Uprise emblem is the join on the World screen), it stands alone: never write the mark out in words beside it or in product copy. If the variant you need does not exist, ask. See `AGENTS.md` → "THE LOGOS ARE NOT YOURS TO DRAW".
11. **`mcclusterishere/Here` is the old repo and publishes nothing.** Do not write to it. If a task looks like it belongs there, say so in the chat and work in this repo instead.

12. **Mobile first, responsive up.** Anything built from a Mobbin reference, or any reference, is designed at phone width first and then given room on tablet and desktop. Breakpoints only ADD; they never hide what the phone was shown. `min-width` queries only, `minmax(0,1fr)` never a bare `1fr`, form controls at `max(16px,…)`, never `user-scalable=no`. Verify by rendering at 390px and checking `scrollWidth === clientWidth`. Full rule and the reasons: `AGENTS.md` → Hard rules → 14.

13. **Never collapse McCluster Corp and Matthew McCluster.** Company-first metadata on `mccluster.org`, Matthew-first on `matthew.mccluster.org` (the I AM HERE album is a front door there, not the identity). Whip Equipped LLC is Matthew's separate company, not a McCluster Corp brand; PRIM3 is McCluster Corp's learning product. Keep stable `@id`s; the Organization's `url` is `https://mccluster.org/`. Read `docs/control-plane/DOMAINS-AND-ENTITIES.md` and `data/seo/domain-architecture.json` before touching either property's metadata, structured data or navigation.

## The plane

| Piece | Canonical |
| --- | --- |
| Control plane (GitHub control repo) | `mcclusterishere/mccluster` |
| Cloudflare project + Worker: public edge and API `https://api.mccluster.org` (`mccluster-mcp` is its stateless MCP transport) | `mccluster`, source `workers/mccluster` |
| Supabase (shared durable truth) | `zmnhbrjyhxzhkxmhkexs` |
| Persistent execution | OVH McCluster Core from `core/`, promoted through `deploy/ovh-production`: not a Worker, not a second backend |
| Matthew McCluster's property | `https://matthew.mccluster.org` (GitHub Pages, this repo) |
| McCluster Corp's property | `https://mccluster.org` (Worker `mccluster` by host once routed); `https://humanuprise.com` is a McCluster Corp host too |

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
15. Two properties, two entities. Never collapse them.

## Local product gates (control repo only; satellites do not copy these)

Hard rule 7 keeps them. Read the gate itself before the work, never a summary of it:

- Equity Uprise building, floors, B1, roof, 3D, 360, plans, renders, hotspots or spatial lore: `docs/design/equity-uprise-building/AGENTS.md` (run its context audit), then `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md` and the files it orders: `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`, `docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md`, `docs/design/equity-uprise-building/BUILDING-CORE-V2-SPEC.md`, `docs/design/equity-uprise-building/production/equity-uprise-capability-map-v2.json`, and the relevant floor's spec, schematic basis, DXF/SVG and production package as listed in `REFERENCE-AUTHORITY.md`. Generated images are never geometry authority. Program status lives there and in `PROJECT-STATE.md`, not here.
- Uprise World / Living Sketch: `AGENTS.md` → "Uprise World" and `docs/uprise-world/`.
- PRIM3 Site 0 / Ground Zero: `assets/3d/prim3-site0/AGENTS.md`.
- Game worlds, portals, per-world saves: `docs/universe/UNIVERSE-SCHEMA.md`.
