# Claude / Codex / Cursor — stop

You are in the McCluster ecosystem.

1. Read `AGENTS.md` completely before any edit.
2. Read `docs/control-plane/ECOSYSTEM.md` if this is the control repo (`mcclusterishere/mccluster`).
3. Read `docs/control-plane/AI-HARNESS.md` before AI, agent, memory, RAG, conversation-history, provider-routing, or autonomous-company work.
4. **McCluster is the backend and the control plane.** GitHub `mcclusterishere/mccluster` + Cloudflare Worker `mccluster` + Supabase `zmnhbrjyhxzhkxmhkexs`.
5. This repo is either the plane or a satellite. Satellites do not grow a second auth, database, social, billing, Worker, admin stack, CRM, vector store, conversation database, or memory service.
6. Private cross-model context lives in Supabase schema `ai_context`. Do not commit raw Claude, ChatGPT, Grok, Gemini, Copilot, local-model, or other AI transcripts into public Git. When an adapter is available, ingest and retrieve through the canonical McCluster context plane.
7. Do not auto-push GitHub Actions onto feature branches.
8. Do not rewrite `index.html` or revive rejected visual systems.
9. If you were about to create a new backend or a Worker named `mccluster-core`: stop. That Worker does not exist. The canonical API Worker is `mccluster`; the stateless `mccluster-mcp` transport shares its authority (see CANONICAL-ARCHITECTURE.md).

Public edge: `https://matthew.mccluster.org` (apex `mccluster.org` is the same property).
API Worker: `mccluster` on `https://api.mccluster.org`.
Source: `workers/mccluster`.

10. **Never draw a logo.** The artwork the owner supplies is the only source of truth for any mark, forever. Do not trace it, approximate it, recolour it, or add a plate or tile it does not already contain. Do not crop supplied artwork. Scale the complete supplied artwork proportionally only. Adding a shape is drawing. If the variant you need does not exist, ask. See `AGENTS.md` → "THE LOGOS ARE NOT YOURS TO DRAW".
11. **`mcclusterishere/Here` is the old repo and publishes nothing.** Do not write to it. If a task looks like it belongs there, say so in the chat and work in this repo instead.


## EQUITY UPRISE BUILDING / 360 / SPATIAL AUTHORITY — MANDATORY

For **any Equity Uprise task involving geometry, architecture, floors, rooms, building imagery, 360 panoramas, environmental rendering, physical navigation, spatial transitions, or spatial lore/worldbuilding**, you MUST read:

`docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md`

before designing, generating, rendering, coding, or describing the environment.

That authority file points to the required repo audit, locked six-floor building inventory, floor-specific builder/360 specs, schematic-plan basis, and canonical PNG/SVG/DXF plan references.

Non-negotiable:
- generated images are never geometry authority;
- floor/core geometry may not drift between renders;
- Floor 1 establishes the fixed 72' × 72' shell/core datum currently used for building coordination;
- elevator, stairs, risers and structural coordination remain vertically aligned;
- Floor 1 is the only public exterior entrance under the current locked scheme;
- do not invent rooms/floors/departments as canonical lore when they are not supported by the audited Equity Uprise program;
- if a floor does not yet have a reviewed floor-specific builder/360 spec, write/review that spec before generating its production imagery.

Do not confuse the six-floor Equity Uprise building with the separate `docs/uprise-world/` Living Sketch / Uprise World project. Each retains its own authority unless the owner explicitly requests a crossover.

## Equity Uprise spatial / geometry authority

**Mandatory:** before generating, editing, describing, implementing, or reasoning about any Equity Uprise building geometry, architecture, floor plan, 360 environment, 3D environment, room image, building cutaway, exterior, transition animation, spatial lore, or location continuity, read and obey:

1. `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md`
2. `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`
3. `docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md`
4. the relevant floor's canonical written spec and schematic-plan basis;
5. the relevant canonical assets under `docs/design/equity-uprise-building/references/`.

For Floor 1 specifically, the canonical asset set is:
- `docs/design/equity-uprise-building/FLOOR-01-LOBBY-INTAKE-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-01-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-viable-schematic-v3.dxf`
- `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-viable-schematic-v3.svg`
- `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-viable-schematic-v3.png`

These files are geometry authority. **Generative images are not geometry authority.** Never move the elevator, stairs, risers, structural grid, building footprint, entrances, floor program, or 360 datum merely to improve a render. Never invent spatial lore that conflicts with the canonical geometry.
