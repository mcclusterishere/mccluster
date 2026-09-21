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
- `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-core-v2-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-core-v2-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-core-v2-schematic-v1.png`

For Floor 2 specifically, the canonical asset set is:
- `docs/design/equity-uprise-building/FLOOR-02-PUBLIC-FORUM-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-02-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-core-v2-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-core-v2-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-core-v2-schematic-v1.png`

For Floor 3, also read:
- `docs/design/equity-uprise-building/FLOOR-03-FELLOWSHIP-NETWORK-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-03-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-03/README.md`
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-core-v2-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-core-v2-schematic-v1.svg`

For Floor 4, also read:
- `docs/design/equity-uprise-building/FLOOR-04-MEDIA-CULTURE-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-04-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-04/README.md`
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-core-v2-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-core-v2-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-core-v2-schematic-v1.png`

For Floor 5, also read:
- `docs/design/equity-uprise-building/FLOOR-05-POLICY-PROOF-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-05-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-05/README.md`
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-core-v2-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-core-v2-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-core-v2-schematic-v1.png`

Before any Floor 6, roof, exterior-master, rooftop 3D, cross-site-flight, helicopter/VTOL, or building-crown work, also read `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-PREPROGRAM.md`.

For Floor 6 specifically, also read and obey:
- `docs/design/equity-uprise-building/FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-06-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-06/README.md`
- the canonical Floor 6 DXF/SVG/PNG under `docs/design/equity-uprise-building/references/floor-06/`.

Floor 6 is the last enclosed level; its core/roof-service continuity to Level 7 is non-negotiable. The building has six enclosed occupied floors plus **Level 7 — Roof / Mobility Portal**. Floor 6 must preserve vertical access/core/service continuity to the roof. The rooftop helipad/mobility zone is conceptual until site/aircraft/regulatory/structural feasibility is established.

These files are geometry authority. **Generative images are not geometry authority.** Never move the elevator, stairs, risers, structural grid, building footprint, entrances, floor program, or 360 datum merely to improve a render. Never invent spatial lore that conflicts with the canonical geometry.

Before any Floor 6 roof-interface, Level 7 roof, exterior-master, rooftop 3D, cross-site-flight, helicopter/VTOL, ecosystem-navigation, destination-building, or building-crown work, read and obey: `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-360-SPEC.md`, `docs/design/equity-uprise-building/FLOOR-07-SCHEMATIC-PLAN-BASIS.md`, and `docs/design/equity-uprise-building/FLOOR-07-ECOSYSTEM-ROUTING-CONTRACT.md`, plus canonical assets under `docs/design/equity-uprise-building/references/floor-07/`. Level 7 is the **ecosystem plane**: the roof is permanent portal infrastructure and website destinations are dynamic routing data, never permanent roof geometry. The helicopter/vertical-lift interaction is the canonical cross-site travel metaphor. The candidate mobility zone is conceptual and is not an approved helipad/vertiport until site/aircraft/regulatory/structural feasibility is established.

### Equity Uprise deterministic Floor 1 implementation
For any Floor 1 3D reconstruction, GLB/glTF export, Three.js/browser scene, hotspot implementation, lighting/material setup, or scene-state work, read `docs/design/equity-uprise-building/production/floor-01/floor-01-scene-manifest.json` and its companion files **after** the canonical Floor 1 written spec, schematic basis, and DXF/SVG. The production package cannot override architectural authority.

## Equity Uprise Core V2 migration authority

When working on branch `architecture/equity-uprise-core-v2` or on artifacts explicitly labeled Core V2, read these **before any floor-specific production file**:

1. `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`
2. `docs/design/equity-uprise-building/production/equity-uprise-capability-map-v2.json`
3. `docs/design/equity-uprise-building/BUILDING-CORE-V2-SPEC.md`
4. `docs/design/equity-uprise-building/production/building-core-v2.json`
5. `docs/design/equity-uprise-building/production/core-v2-floor-programs.json`
6. `docs/design/equity-uprise-building/production/building-v2-validation.json`
7. `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md`
8. the floor-specific spec, schematic basis, Core V2 DXF/SVG, and production package.

Core V2 shared geometry is not floor-local:

- passenger elevator: X54–62 / Y34–44;
- service/freight elevator: X0–8 / Y60–72;
- revised Stair B: X8–18 / Y54–72;
- Stair A: X60–72 / Y54–72;
- MEP/riser: approximately X50–60 / Y66–72;
- floor elevations: 0 / 13.5 / 27 / 40.5 / 54 / 67.5 / 81 ft.

Rules:

- Floor-specific files may add program but may not redefine shared vertical systems.
- Every Equity Uprise capability must remain mapped through `equity-uprise-capability-map-v2.json`; do not silently add, remove, relocate, or publicize a capability in spatial work.
- Preserve each capability's declared implementation status and public/private/approval boundary.
- Both stairs must span the full 13'-6" between finished floors in combined geometry.
- Do not use the old X0–12/Y54–72 Stair B assumption for new Core V2 work.
- Do not treat the service/freight elevator as a substitute for a required exit.
- Do not use Core V1 DXF/SVG/PNG files for new Core V2 modeling.
- Per-floor viewers are derived isolated views; the combined stacked building is the vertical-continuity authority.
- Generated images/renders never override the written/shared geometry.
- All architecture remains schematic and NOT FOR CONSTRUCTION pending licensed professional review.

### Equity Uprise repo-to-building program authority

For any Equity Uprise building, floor, room, 3D, 360, hotspot, navigation or spatial-program task on the Core V2 branch, read these before floor-local artifacts:

1. `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`
2. `docs/design/equity-uprise-building/production/equity-uprise-capability-map-v2.json`
3. `docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md`
4. `docs/design/equity-uprise-building/BUILDING-CORE-V2-SPEC.md`
5. `docs/design/equity-uprise-building/production/building-core-v2.json`
6. `docs/design/equity-uprise-building/production/core-v2-floor-programs.json`

The capability map controls **what the building represents**. The Core V2 spec/JSON control **shared geometry and vertical continuity**. Floor-local files may refine their level but may not silently remove/rename repo-backed capabilities, expose private or approval-gated systems publicly, restore archived Core V1 plans, or imply passenger-elevator service to Level 7.

Run `production/verify_equity_uprise_program_coverage.py` after program/routing changes.
