# Floor 02 — Public Forum — Core V2 Plan References

> Branch: `architecture/equity-uprise-core-v2`
>
> Status: **CORE V2 BRANCH-CANONICAL SCHEMATIC GEOMETRY / NOT FOR CONSTRUCTION**

## Core V2 files

- `equity-uprise-floor-02-public-forum-core-v2-schematic-v1.dxf`
  - CAD exchange geometry;
  - preferred derived geometric reference after the written Core V2 authority.
- `equity-uprise-floor-02-public-forum-core-v2-schematic-v1.svg`
  - browser/vector inspection reference.
- `equity-uprise-floor-02-public-forum-core-v2-schematic-v1.png`
  - raster preview only; never overrides DXF/SVG/written geometry.

## Shared authority

Read before using these files:

1. `../../BUILDING-CORE-V2-SPEC.md`
2. `../../production/building-core-v2.json`
3. the floor-specific written 360/spec document
4. the floor-specific schematic-plan basis
5. Core V2 DXF
6. Core V2 SVG
7. Core V2 PNG

Shared vertical systems on this branch:
- passenger elevator: X54–62 / Y34–44
- service/freight elevator: X0–8 / Y60–72
- revised Stair B: X8–18 / Y54–72
- Stair A: X60–72 / Y54–72
- MEP/riser: approximately X50–60 / Y66–72

Both stairs must connect the full 13'-6" floor-to-floor datum in the combined building model.

## Legacy Core V1 files

The following files are retained for traceability only and are **not branch-canonical**:

- `equity-uprise-floor-02-public-forum-schematic-v1.dxf`
- `equity-uprise-floor-02-public-forum-schematic-v1.svg`
- `equity-uprise-floor-02-public-forum-schematic-v1.png`

Do not use the legacy files for new Core V2 3D, rendering, floor planning, hotspot placement, or vertical-circulation work.

## Regeneration

The Core V2 set is generated from:

- `../../production/building-core-v2.json`
- `../../production/core-v2-floor-programs.json`
- `../../production/generate_core_v2_plans.py`

The generation workflow is:
`.github/workflows/equity-uprise-core-v2-plans.yml`

## Limitations

These are schematic coordination drawings only. Final architecture, structure, MEP, fire/life-safety, accessibility, elevator and code design require licensed professional review.
