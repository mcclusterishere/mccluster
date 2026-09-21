# Codex — McCluster

Read `AGENTS.md` first. Completely. Read `docs/control-plane/AI-HARNESS.md` before AI, agent, memory, RAG, conversation-history, provider-routing, or autonomous-company work.

You are in the McCluster ecosystem. The GitHub repository `mcclusterishere/mccluster` and the Cloudflare Worker `mccluster` are the backend AND the control plane. Supabase project `zmnhbrjyhxzhkxmhkexs` is the shared data plane.

Private cross-model context lives in Supabase schema `ai_context`. Do not commit raw ChatGPT, Claude, Grok, Gemini, Copilot, local-model, or other AI transcripts into public Git. All providers are replaceable adapters to the same McCluster context plane. Do not create a shadow vector store, second conversation database, separate memory service, or competing context source.

Satellites do not grow a second auth, database, social scheduler, billing, Worker, admin, CRM, or AI memory stack. Public edge is `matthew.mccluster.org` (apex `mccluster.org` aliases it). API is Worker `mccluster` on `api.mccluster.org`.

There is no Worker named `mccluster-core`. Do not create one.

Client social is a McCluster service. If you were about to create a new backend: stop.

## Never draw a logo

The artwork the owner supplies is the only source of truth for any mark,
forever. Do not trace, approximate, reconstruct, recolour, or composite one —
not as a placeholder, not "until the real one arrives", not at a size where
you think it will not matter. Do not crop supplied artwork. Scale the complete supplied artwork proportionally only. adding a
shape it does not contain is drawing. If the variant you need does not
exist, ask for it.

An agent shipped a hand-drawn `we-icon.svg` into three repositories once and
it had to be torn out of four. See `AGENTS.md` → "THE LOGOS ARE NOT YOURS TO
DRAW" for the supplied Whip Equipped kit.

## mcclusterishere/Here is dead

It publishes nothing — deploy workflows disabled, no CNAME. Do not write to
it. If a task looks like it belongs there, say so in the chat and work in
`mcclusterishere/mccluster` instead.


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

**Mandatory:** before generating, editing, describing, implementing, or reasoning about any Equity Uprise building geometry, architecture, floor plan, 360 environment, 3D environment, room image, building cutaway, exterior, transition animation, spatial lore, or location continuity, read:

1. `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`
2. `docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md`
3. `docs/design/equity-uprise-building/reference/README.md`
4. the relevant floor's canonical spec and schematic-plan basis.

For Floor 1 specifically, also read:
- `docs/design/equity-uprise-building/FLOOR-01-LOBBY-INTAKE-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-01-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/reference/FLOOR-01-VIABLE-SCHEMATIC-v3.dxf`
- `docs/design/equity-uprise-building/reference/FLOOR-01-VIABLE-SCHEMATIC-v3.svg`

These files are geometry authority. **Generative images are not geometry authority.** Never move the elevator, stairs, risers, structural grid, building footprint, entrances, floor program, or 360 datum merely to improve a render. Never invent spatial lore that conflicts with the canonical geometry.
