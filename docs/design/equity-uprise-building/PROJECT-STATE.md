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
- detailed Floor 5 is inserted at FFE +54 ft;
- detailed Floor 6 is inserted at FFE +67.5 ft;
- detailed Level 7 Roof / Mobility Portal is inserted at FFE +81 ft;
- the combined Core V2 chassis supplies continuous B1→roof protected stair geometry, while Level 7 isolation includes the actual Floor 6→roof stair transition and roof-door arrival condition;
- each future refinement occurs **inside this stack**, not as an isolated experiment.

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

Floor 4 is **visually reviewable, not user-approved complete**. Final approval depends on direct visual review in the isolated viewer.

Required references:
- `FLOOR-04-PROGRAM-RECONCILIATION.md`;
- `FLOOR-04-V1-V2-PRESERVATION-MAP.md`;
- `production/floor-04/floor-04-object-inventory.json`;
- `production/floor-04/build_equity_uprise_floor_04_v2.py`.

Visual approval remains iterative.

## Floor 5 — RECONCILED / REAL 3D ACTIVE / STACKED

Canonical identity: **Policy + Proof**.

Current state:
- program reconciliation complete;
- historical Floor 5 spec/schematic audited;
- preservation map complete;
- machine inventory: **80 stable records / 106 total instances**;
- inventory-driven GLB builder active;
- standalone viewer active;
- inserted into the working building at **FFE +54 ft**;
- building-level Floor 5 control truly isolates the detailed Floor 5 model;
- builder requires both inventory coverage and a dedicated visual-completeness gate;
- public surfaces are limited to public/source-backed records, while drafts, sensitive notes, private review state, approval tokens and submission credentials remain authenticated/private.

Required references:
- `FLOOR-05-PROGRAM-RECONCILIATION.md`;
- `FLOOR-05-V1-V2-PRESERVATION-MAP.md`;
- `production/floor-05/floor-05-object-inventory.json`;
- `production/floor-05/build_equity_uprise_floor_05_v2.py`.

Floor 5 is **visually reviewable, not user-approved complete**. Final approval depends on direct visual review in the isolated viewer.

## Floor 6 — RECONCILED / REAL 3D ACTIVE / STACKED

Canonical identity: **Penthouse Command**.

Current state:
- program reconciliation complete;
- historical Floor 6 spec/schematic audited;
- Halo boundary and Level 7 transition reviewed;
- preservation map complete;
- machine inventory: **74 stable records / 96 total instances**;
- inventory-driven GLB builder active;
- standalone viewer active;
- inserted into the working building at **FFE +67.5 ft**;
- building-level Floor 6 control truly isolates the detailed penthouse model;
- protected Stair A and Stair B continuity to Level 7 is preserved;
- passenger-elevator direct Level 7 service remains unassumed;
- Halo remains one restrained suspended read-only instrument in public/member/staff modes;
- requested Halo Globe placement correction is now authoritative at **(55,12) ft local, 8.25 ft AFF, radius 2.25 ft** — the open south-east plan pocket that reads as the user's circled lower-left corner in the current Floor 6 viewer;
- the old **(24.5,34.5)** checkpoint placement and the interim **(22,22.5)** placement are superseded;
- authoritative inventory, builder-driven 3D placement, generated manifest/hotspot/lighting data, plan assets and standalone Halo camera/light targeting are synchronized to the corrected location;
- no other approved Floor 6 layout is to move as part of this correction;
- builder requires both inventory coverage and a dedicated visual-completeness gate.

Required references:
- `FLOOR-06-PROGRAM-RECONCILIATION.md`;
- `FLOOR-06-V1-V2-PRESERVATION-MAP.md`;
- `HALO-GLOBE-SPATIAL-INTELLIGENCE-SPEC.md`;
- `FLOOR-07-ROOF-MOBILITY-PORTAL-PREPROGRAM.md`;
- `production/floor-06/floor-06-object-inventory.json`;
- `production/floor-06/build_equity_uprise_floor_06_v2.py`.

Floor 6 is **visually reviewable with the requested Halo placement correction committed**. Final visual confirmation should verify the globe appears in the circled open corner; no further Floor 6 redesign is authorized unless that preview reveals a collision or placement error.

## Level 7 — RECONCILED / REAL 3D ACTIVE / STACK-INTEGRATED

Canonical identity: **Roof / Mobility Portal**.

Current state:
- current-pass program reconciliation complete;
- historical/origin roof intent preserved without restoring obsolete geometry;
- machine inventory: **45 stable records**;
- deterministic detailed roof builder active;
- standalone Level 7 viewer is a real 3D roof viewer rather than a redirect to the chassis;
- working-stack viewer loads the detailed roof at **FFE +81 ft** and truly isolates it;
- exactly three repo-backed Level 7 capabilities are represented: **ecosystem-routing**, **roof-mobility**, and optional-route-only **uprise-world**;
- Uprise World is represented as a **disabled, read-only optional route state** and cannot launch until explicitly enabled; it does not control roof geometry or branding;
- candidate mobility geometry remains explicitly conceptual/non-operational — no runway, no certified helipad/TLOF/FATO claim;
- passenger-elevator direct Level 7 service remains unassumed;
- Stair A and Stair B each preserve the complete **13.5 ft Floor 6→roof rise**, 22-riser conceptual geometry, upper landing at +81 ft, and a real 3 ft south-facing roof-door opening;
- the combined building stair enclosures are now segmented around canonical access openings on every served level instead of visually sealing the south stair wall;
- a dedicated B1→Level 7 walkability audit is part of CI;
- legacy validators that formerly required Level 7 to remain provisional have been promoted to require the reconciled Level 7 state;
- inventory coverage and visual-completeness gates are required before user visual approval.

Required references:
- `FLOOR-07-PROGRAM-RECONCILIATION.md`;
- `FLOOR-07-V1-V2-PRESERVATION-MAP.md`;
- `FLOOR-07-ROOF-MOBILITY-PORTAL-360-SPEC.md`;
- `FLOOR-07-SCHEMATIC-PLAN-BASIS.md`;
- `FLOOR-07-ECOSYSTEM-ROUTING-CONTRACT.md`;
- `production/floor-07/floor-07-object-inventory.json`;
- `production/floor-07/build_equity_uprise_floor_07_v2.py`;
- `production/audit_vertical_circulation_walkability.py`.

Level 7 is **implementation-complete for the current review pass but still awaits direct user visual approval**. Real construction/aviation feasibility is explicitly outside this digital-twin approval.

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
9. **DONE:** Floor 5 — Policy + Proof — reconciliation → inventory → real 3D → visual-completeness gate → true isolation → working-stack integration.
10. **DONE:** Floor 6 — Penthouse Command — reconciliation → Halo/roof boundary → inventory → real 3D → visual-completeness gate → true isolation → working-stack integration → requested Halo relocation to (55,12) with synchronized authority/generated artifacts.
11. **DONE FOR REVIEW:** Level 7 — Roof / Mobility Portal — reconciliation → historical preservation → inventory → real rooftop environment → human-walkable Stair A/B roof arrivals → true isolation → working-stack integration.
12. **CURRENT GATE:** deterministic regeneration + whole-repo/source/program/authority/plan/building/walkability CI, then direct visual approval of isolated Level 7 and the complete stacked building.
13. **AFTER ROOF VISUAL APPROVAL:** final exterior/crown/context pass and later B1 cinematic/detail refinement; do not reopen approved floor programs without a new repo capability or explicit design correction.

## Do not waste time on

- re-auditing already locked Floor 1 authority unless a new design change invalidates it;
- treating PNG/SVG/DXF as final deliverables;
- replacing V1 design qualities with generic debug geometry;
- rebuilding the whole stack from scratch when a validated assembly already exists;
- inventing new floor identities without current program authority.
