# Gemini

Read `AGENTS.md`, `CLAUDE.md`, and `docs/control-plane/AI-HARNESS.md` first. Same law.

McCluster (`mcclusterishere/mccluster` + Cloudflare Worker `mccluster` + Supabase `zmnhbrjyhxzhkxmhkexs`) is the backend and control plane for every product and every client backend. Do not invent a parallel stack. Do not create a Worker named `mccluster-core`. Do not race git pushes from CI. Ship public pages to `matthew.mccluster.org`. API is `https://api.mccluster.org`.

Private cross-model context lives in Supabase schema `ai_context`. Do not commit raw ChatGPT, Claude, Grok, Gemini, Copilot, local-model, or other AI transcripts into public Git. Treat every model as a replaceable adapter to the canonical McCluster context plane. Do not create a second conversation database, vector store, memory service, CRM, or competing context source.

## Never draw a logo

The artwork the owner supplies is the only source of truth for any mark,
forever. Do not trace, approximate, reconstruct, recolour, or composite one —
not as a placeholder, not "until the real one arrives", not at a size where
you think it will not matter. Do not crop supplied artwork. Scale the complete supplied artwork proportionally only. adding a
shape it does not contain is drawing. If the variant you need does not
exist, ask for it.

An agent shipped a hand-drawn `we-icon.svg` into three repositories once and
it had to be torn out of four. See `AGENTS.md` → "THE LOGOS ARE NOT YOURS TO DRAW" for the supplied Whip Equipped kit.

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

For Floor 2 specifically, the canonical asset set is:
- `docs/design/equity-uprise-building/FLOOR-02-PUBLIC-FORUM-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-02-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.png`

For Floor 3, also read:
- `docs/design/equity-uprise-building/FLOOR-03-FELLOWSHIP-NETWORK-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-03-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-03/README.md`
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-schematic-v1.svg`

For Floor 4, also read:
- `docs/design/equity-uprise-building/FLOOR-04-MEDIA-CULTURE-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-04-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-04/README.md`
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-schematic-v1.png`

For Floor 5, also read:
- `docs/design/equity-uprise-building/FLOOR-05-POLICY-PROOF-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-05-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-05/README.md`
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-schematic-v1.png`

Before any Floor 6, roof, exterior-master, rooftop 3D, cross-site-flight, helicopter/VTOL, or building-crown work, also read `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-PREPROGRAM.md`.

For Floor 6 specifically, also read and obey:
- `docs/design/equity-uprise-building/FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-06-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-06/README.md`
- the canonical Floor 6 DXF/SVG/PNG under `docs/design/equity-uprise-building/references/floor-06/`.

Floor 6 is the last enclosed level; its core/roof-service continuity to Level 7 is non-negotiable. The building has six enclosed occupied floors plus **Level 7 — Roof / Mobility Portal**. Floor 6 must preserve vertical access/core/service continuity to the roof. The rooftop helipad/mobility zone is conceptual until site/aircraft/regulatory/structural feasibility is established.

These files are geometry authority. **Generative images are not geometry authority.** Never move the elevator, stairs, risers, structural grid, building footprint, entrances, floor program, or 360 datum merely to improve a render. Never invent spatial lore that conflicts with the canonical geometry.
