# Equity Uprise Building — Current Project State

> Update this file whenever completion, maturity, visual direction, or next work changes.

## End goal

A real, fully furnished, program-aware, navigable 3D headquarters from B1 through Level 7, with finished floor environments that assemble into one coherent building.

## Current authoritative geometry

Core V2 is the active geometry authority:
- 72' × 72' plate;
- B1 -13.5';
- F1 0';
- F2 13.5';
- F3 27';
- F4 40.5';
- F5 54';
- F6 67.5';
- L7 roof 81';
- passenger elevator X54–62 / Y34–44;
- service/freight elevator X0–8 / Y60–72;
- Stair B X8–18 / Y54–72;
- Stair A X60–72 / Y54–72;
- MEP/riser approximately X50–60 / Y66–72.

## Whole-building assembly — DONE as continuity chassis, NOT finished as designed interiors

Current combined B1→roof model:
- source: `production/build_equity_uprise_building_v2.py`
- GLB: `production/generated/equity-uprise-building-core-v2.glb`
- current report: `production/generated/equity-uprise-building-core-v2-report.json`
- current committed report: **792 meshes, 41/41 checks passing**
- includes B1, site/egress context, both stair systems, passenger core, freight/service core, Halo Globe, and roof continuity.

This proves the stack. It is **not** the final visual/interior building.

## Historical fully assembled reference — PRESERVE

Earlier assembled Core V2 reference:
- generator commit: `c674e07daf772ea739d93cc515657deb028e8b75`
- assembled GLB build: `ef3fd47d543318fd3ed129fa3f58fc7fab5fabce`
- stacked viewer: `7ea458406cc862656b5952a350fe87bcdc16110b`
- historical report: **667 meshes, 27/27 continuity checks**
- useful for stacking, floor isolation, cutaway/core views, elevations, and whole-building behavior.

## Floor 1 — authority locked; visual hybrid rebuild is CURRENT WORK

Canonical identity: **Arrival / Orientation / Intake**.

Done:
- Core V2 program / schematic / digital-twin / site-egress authority reconciled.
- active plan triplets regenerated.
- B1 interface and restricted access semantics validated.
- Floor 1 completion lock exists for program/schematic authority.
- standalone V2 volumetric scaffold exists in the deploy pipeline.

Current standalone scaffold:
- builder: `production/floor-01/build_equity_uprise_floor_01_v2.py`
- deployed build has **189 meshes and 13/13 geometry sanity checks**
- it is a technical scaffold, **not the accepted aesthetic target**.

Accepted visual direction:
- the original V1 Floor 1 looked/felt better;
- preserve its dark premium interior language, glass, lighting, reception composition, lounge, furniture feel, warm wood, rugs/greenery, and human-scale camera experience;
- apply current V2 geometry/program research to that design rather than replacing it.

Required references:
- `FLOOR-01-V1-V2-MERGE-MAP.md`
- `FLOOR-01-V1-V2-PRESERVATION-MAP.md`
- `production/floor-01/floor-01-object-inventory.json`

Inventory / preservation checkpoint:
- **COMPLETE** — formal Floor 1 object inventory now exists with stable IDs, placement/function/style metadata and V1/V2 heritage decisions.
- **COMPLETE** — detailed V1→V2 preservation map records what survives, what is corrected, and what is newly added.

Hybrid builder implementation checkpoint:
- builder requires all 67 inventory records to be represented in 3D or validation fails;
- V1-style lounge, reception/Journey Wall, intake, warm lighting, glass entry, human-scale views and ceiling/cutaway behavior are restored as the design baseline;
- Development Passport Studio, life-safety/support equipment, freight core and corrected Stair B are integrated into the same environment;
- shared Core V2 geometry remains unchanged.

## Floor 2 — PROGRAM RECONCILED / V1 AUDITED / INVENTORY READY

Canonical identity: **Public Forum**.

Preparation complete:
- program reconciliation locked;
- historical V1 deterministic viewer audited at commit `7c7726289781f270da25eef70789b704b63b30bd`;
- V1→V2 preservation map created;
- machine inventory created with **48 stable records / 72 total object instances**;
- current Core V2 west service/freight + Stair B corrections retained.

Floor 2 now has an inventory-driven real 3D builder and standalone GLB/viewer. Visual approval is still pending.

Required references:
- `FLOOR-02-PROGRAM-RECONCILIATION.md`;
- `FLOOR-02-V1-V2-PRESERVATION-MAP.md`;
- `production/floor-02/floor-02-object-inventory.json`.

## Working full-building stack — ACTIVE NOW

The working viewer now treats the building as one continuous object from B1 through roof:
- validated combined Core V2 chassis remains the structural/vertical-continuity layer;
- detailed Floor 1 is inserted at FFE 0;
- detailed Floor 2 is inserted at FFE +13.5 ft;
- detailed Floor 3 is inserted at FFE +27 ft;
- detailed Floor 4 is inserted at FFE +40.5 ft;
- Floors 5–7 remain visible as chassis placeholders at their real elevations;
- each future floor pass replaces/improves its level **inside this stack**, not as an isolated experiment.

Public working-stack viewer: `equity-uprise-building-core-v2-3d.html`.

## Floor 3 — RECONCILED / REAL 3D ACTIVE / STACKED

Canonical identity: **Fellowship + Network**.

Current state:
- program reconciliation complete;
- historical locked Floor 3 architecture audited;
- preservation map complete;
- machine inventory: **63 stable records / 85 total instances**;
- inventory-driven GLB builder active;
- reliable standalone viewer active;
- inserted into the working building at **FFE +27 ft**.

Required references:
- `FLOOR-03-PROGRAM-RECONCILIATION.md`;
- `FLOOR-03-V1-V2-PRESERVATION-MAP.md`;
- `production/floor-03/floor-03-object-inventory.json`;
- `production/floor-03/build_equity_uprise_floor_03_v2.py`.

Floor 4 is **visually reviewable, not user-approved complete**. Final approval depends on direct visual review in the isolated viewer.

## Floor 4 — RECONCILED / REAL 3D ACTIVE / STACKED

Canonical identity: **Media + Culture**.

Current state:
- program reconciliation complete;
- historical locked Floor 4 spec/schematic audited;
- preservation map complete;
- machine inventory: **68 stable records / 96 total instances**;
- inventory-driven GLB builder active;
- reliable standalone viewer active;
- inserted into the working building at **FFE +40.5 ft**;
- building-level Floor 4 control now **truly isolates Floor 4** rather than only moving the camera;
- visual-completeness pass adds room enclosure detail, support-room doors, restroom fixtures, equipped media storage/IT, and completed ceiling fields;
- builder now requires both inventory coverage and a dedicated visual-completeness gate;
- public media surfaces are constrained to real/approved public Equity Uprise content; private masters, rights, DDEX, payment and approval state remain non-public.

Required references:
- `FLOOR-04-PROGRAM-RECONCILIATION.md`;
- `FLOOR-04-V1-V2-PRESERVATION-MAP.md`;
- `production/floor-04/floor-04-object-inventory.json`;
- `production/floor-04/build_equity_uprise_floor_04_v2.py`.

Visual approval remains iterative.

## Floors 5–7 — geometry/program chassis exists; iterative interior redesign NOT COMPLETE

Current `core-v2-floor-programs.json` still treats Floors 5–7 as pre-iterative program/interior work.

Do not interpret generated plan/program plates as finished 3D floors.

## B1 — program/geometry integrated; final designed environment still future work

Restricted underground operations authority and tunnel semantics exist. B1 is connected to the shared building stack and simulation model, but it is not a finished cinematic/interior environment.

## Historical V1 Floor 1 — DESIGN REFERENCE, NOT geometry authority

Key references:
- GLB generator commit `59af7f6386ee69edc023927971ea5918fffa6acc`
- interactive viewer commit `752c70444e12f44abdeacdd19697f7db88937d44`
- archived plans under `references/archive/core-v1/floor-01/`

Use these to recover design quality, not obsolete stair/core geometry.

## NEXT APPROVED WORK

1. **DONE:** formal Floor 1 furniture/equipment/object inventory with stable IDs.
2. **DONE:** detailed V1→V2 preservation map.
3. **IN PROGRESS:** hybrid Floor 1 builder now consumes the canonical inventory and is being upgraded from the technical scaffold into the V1-feel / V2-truth environment.
4. Review Floor 1 visually in the real 3D viewer.
5. Insert the approved hybrid Floor 1 into the whole-building assembly and verify stacking.
6. **DONE:** Floor 2 real 3D + working-stack integration.
7. **DONE:** Floor 3 reconciliation → inventory → real 3D → working-stack integration.
8. **DONE:** Floor 4 — Media + Culture — reconciliation → inventory → real 3D → working-stack integration.
9. **NEXT:** Floor 5 — Policy + Proof — reconciliation, preservation map, inventory, real 3D, then stack at +54 ft.

## Do not waste time on

- re-auditing already locked Floor 1 authority unless a new design change invalidates it;
- treating PNG/SVG/DXF as final deliverables;
- replacing V1 design qualities with generic debug geometry;
- rebuilding the whole stack from scratch when a validated assembly already exists;
- inventing new floor identities without current program authority.
