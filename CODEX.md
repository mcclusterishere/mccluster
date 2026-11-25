# Codex — McCluster

Read `AGENTS.md` first. Completely. It is the law; this file only points at it. Read `docs/control-plane/AI-HARNESS.md` before AI, agent, memory, RAG, conversation-history, provider-routing, or autonomous-company work.

You are in the McCluster ecosystem. The GitHub repository `mcclusterishere/mccluster` and the Cloudflare Worker `mccluster` are the backend AND the control plane. Supabase project `zmnhbrjyhxzhkxmhkexs` is the shared data plane.

Private cross-model context lives in Supabase schema `ai_context`. Do not commit raw ChatGPT, Claude, Grok, Gemini, Copilot, local-model, or other AI transcripts into public Git. All providers are replaceable adapters to the same McCluster context plane. Do not create a shadow vector store, second conversation database, separate memory service, or competing context source.

Satellites render product UI. They do not grow a second auth, database, social scheduler, billing, Worker, admin, CRM, or AI memory stack. Client social is a McCluster service. If you were about to create a new backend: stop.

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

## One platform, tenant properties, separate entities

`docs/control-plane/DOMAINS-AND-ENTITIES.md` is the authority. `https://mccluster.org` is **McCluster Corp's** platform, set in one place (`data/seo/domain-architecture.json` → `platform.origin`, written everywhere by `tools/build-site-hosts.mjs`) and served by Worker `mccluster` by host; its root is the Equity Uprise World (Equity Uprise is the public brand, owner 2026-10-28) and the company page is `/company`. Stage now: P1, the platform serves everything: every page answers at its path on the platform, and Matthew's host keeps answering every page (what P1 changes: `edge.now.p1_changes` in the record; what P0 changed before it: `edge.now.p0_changes`). P2 and P3 are planned, not shipped: P2 moves each page's canonical, sitemap entry, share card and WebSite to its set's host; P3 makes Matthew's host answer 301 to the same path on the platform for the pages that moved. `https://equityuprise.com` becomes the platform later by changing that one setting. `https://matthew.mccluster.org` is **Matthew McCluster's** personal profile, a tenant of the platform (GitHub Pages, this repo); from P3 its pages that moved answer 301 to the platform. `https://humanuprise.com` is a legacy-named door to the World, a McCluster Corp host, never a third entity. Hosting is not identity: never collapse the two entities.

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

- Equity Uprise building, floors, B1, roof, 3D, 360, plans, renders, hotspots or spatial lore: `docs/design/equity-uprise-building/AGENTS.md` (run its context audit), then `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md` and the files it orders. Generated images are never geometry authority. Program status lives there and in `PROJECT-STATE.md`, not here.
- Uprise World / Living Sketch: `AGENTS.md` → "Uprise World" and `docs/uprise-world/`.
- PRIM3 Site 0 / Ground Zero: `assets/3d/prim3-site0/AGENTS.md`.
- Game worlds, portals, per-world saves: `docs/universe/UNIVERSE-SCHEMA.md`.
