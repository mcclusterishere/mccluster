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

## Whole-building assembly — CONTINUITY VALIDATED / DETAILED F1–F7 STACK ACTIVE

Current combined B1→roof chassis:
- source: `production/build_equity_uprise_building_v2.py`
- GLB: `production/generated/equity-uprise-building-core-v2.glb`
- current report: `production/generated/equity-uprise-building-core-v2-report.json`
- current committed chassis report: **840 meshes, 41/41 checks passing**
- SHA-256: `afebd08c811d083b6ae957677cedbff51d4c629e36a19341eddc385b3e8e28c7`
- both protected stairs now have real served-level access openings rather than sealed south walls;
- both stair systems close mathematically and physically from B1 through the +81 ft roof datum;
- detailed Floors 1–7 are loaded into the working stack; B1 remains the future cinematic/detail refinement layer.

Dedicated B1→roof human-walkability report: **44/44 checks passing**.

This proves the current physical stack and walking-plane logic. It remains a digital-twin/simulation artifact, not a construction document.

## Historical fully assembled reference — PRESERVE

Earlier assembled Core V2 reference:
- generator commit: `c674e07daf772ea739d93cc515657deb028e8b75`
- assembled GLB build: `ef3fd47d543318fd3ed129fa3f58fc7fab5fabce`
- stacked viewer: `7ea458406cc862656b5952a350fe87bcdc16110b`
- historical report: **667 meshes, 27/27 continuity checks**
- useful for stacking, floor isolation, cutaway/core views, elevations, and whole-building behavior.

## Floor 1 — ARRIVAL / ORIENTATION / INTAKE — APPROVED CURRENT PASS / STACKED

- detailed inventory-backed real 3D floor active at **FFE 0 ft**;
- V1 premium interior/navigation feel preserved while Core V2 geometry and Stair B/service corrections remain authoritative;
- vestibule, reception, orientation lounge, intake, Development Passport, Journey Wall, directory/elevator relationship, support and life-safety systems modeled;
- true floor isolation and whole-stack integration active;
- shared protected-stair access openings remain aligned with the combined building.

Required references:
- `FLOOR-01-V1-V2-MERGE-MAP.md`;
- `FLOOR-01-V1-V2-PRESERVATION-MAP.md`;
- `production/floor-01/floor-01-object-inventory.json`;
- `production/floor-01/build_equity_uprise_floor_01_v2.py`.

## Floor 2 — PUBLIC FORUM — APPROVED CURRENT PASS / STACKED

- detailed inventory-backed real 3D floor active at **FFE +13.5 ft**;
- central ~12 ft / max-8-seat forum table;
- CURRENT ISSUES / PERSPECTIVES / OPPORTUNITIES wall;
- west listening lounge and elevator-side member check-in;
- politically neutral civic discussion program preserved;
- true isolation and whole-stack integration active.

Required references:
- `FLOOR-02-PROGRAM-RECONCILIATION.md`;
- `FLOOR-02-V1-V2-PRESERVATION-MAP.md`;
- `production/floor-02/floor-02-object-inventory.json`;
- `production/floor-02/build_equity_uprise_floor_02_v2.py`.

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

## Floor 3 — FELLOWSHIP + NETWORK — APPROVED CURRENT PASS / STACKED

- detailed inventory-backed real 3D floor active at **FFE +27 ft**;
- Opportunity Exchange and MATCH / PEOPLE / APPLICATIONS wall;
- west People/Network lounge;
- two south interview/mentorship rooms;
- elevator-side member/interview check-in;
- true isolation and whole-stack integration active.

Required references:
- `FLOOR-03-PROGRAM-RECONCILIATION.md`;
- `FLOOR-03-V1-V2-PRESERVATION-MAP.md`;
- `production/floor-03/floor-03-object-inventory.json`;
- `production/floor-03/build_equity_uprise_floor_03_v2.py`.

## Floor 4 — MEDIA + CULTURE — APPROVED CURRENT PASS / STACKED

- detailed inventory-backed real 3D floor active at **FFE +40.5 ft**;
- central listening area and LISTEN / WATCH / ARCHIVE wall;
- Culture Archive / Rally Gallery;
- Creator Recording Room and Edit / Review Suite;
- media storage + media/IT support;
- enclosure/support-room/ceiling visual-completeness gate active;
- true isolation and whole-stack integration active.

Required references:
- `FLOOR-04-PROGRAM-RECONCILIATION.md`;
- `FLOOR-04-V1-V2-PRESERVATION-MAP.md`;
- `production/floor-04/floor-04-object-inventory.json`;
- `production/floor-04/build_equity_uprise_floor_04_v2.py`.

## Floor 5 — POLICY + PROOF — APPROVED CURRENT PASS / STACKED

- detailed real 3D floor active at **FFE +54 ft**;
- **431 meshes**;
- **80/80 inventory records** represented;
- **22/22 checks passing**;
- Policy Lab, RESEARCH / EVIDENCE / RECORD wall, Evidence + Proof Archive, Source Review, Publication / Submission Review and Research / Publication Navigator;
- visual-completeness gate and true isolation active;
- checkpoint: `ce23d6eb8c0b036f963ce4864254a5510995459c`;
- recovery branch: `checkpoint/equity-uprise-floor5-final`.

Required references:
- `FLOOR-05-PROGRAM-RECONCILIATION.md`;
- `FLOOR-05-V1-V2-PRESERVATION-MAP.md`;
- `production/floor-05/floor-05-object-inventory.json`;
- `production/floor-05/build_equity_uprise_floor_05_v2.py`.

## Floor 6 — PENTHOUSE COMMAND — APPROVED CURRENT PASS / STACKED

- detailed real 3D penthouse active at **FFE +67.5 ft**;
- **436 meshes**;
- **74/74 inventory records** represented;
- **24/24 checks passing**;
- central six-seat command table, NOW / PAST WORK / JOIN wall, Institutional Salon, Strategy Review, Partner / Executive Briefing and Roof Access / Mobility Transition terminal;
- Stair A and Stair B remain physically continuous toward Level 7; passenger-elevator direct roof service remains unassumed;
- Halo Globe remains one restrained suspended instrument, now permanently corrected to **(55,12) ft local / 8.25 ft AFF / radius 2.25 ft** in the user-selected open corner;
- true isolation, visual-completeness gate and whole-stack integration active;
- original Floor 6 checkpoint: `85447f7b0191f568cbb7e4a58fe525afa92d475f`;
- corrected Halo checkpoint branch: `checkpoint/equity-uprise-floor6-globe-final`.

Required references:
- `FLOOR-06-PROGRAM-RECONCILIATION.md`;
- `FLOOR-06-V1-V2-PRESERVATION-MAP.md`;
- `HALO-GLOBE-SPATIAL-INTELLIGENCE-SPEC.md`;
- `production/floor-06/floor-06-object-inventory.json`;
- `production/floor-06/build_equity_uprise_floor_06_v2.py`.

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

## B1 — UNDERGROUND OPERATIONS / TECHNICAL SERVICE — DETAILED CURRENT PASS IMPLEMENTED

- canonical B1 program retained at **FFE -13.5 ft**;
- current-pass reconciliation + preservation map + schematic basis added;
- **67 stable inventory records** define the detailed B1 environment;
- deterministic detailed B1 builder added;
- local preflight build produced **382 meshes, 67/67 inventory records represented, 18/18 checks passing**;
- all ten canonical B1 zones are physically expressed;
- mechanical, electrical, fire/water, telecom, flood, workshop, systems-lab, service-staging, tunnel-ops and transfer-lock equipment/furniture are modeled;
- both protected stairs include the complete **13.5 ft B1→Floor 1 rise** for isolated review;
- passenger/freight/MEP core relationships remain aligned to Core V2;
- standalone B1 viewer and detailed working-stack integration are implemented;
- live operations remain restricted and learner/instructor use remains sandbox-only;
- tunnel geometry stops at the building-side Transfer Lock.

Required references:
- `BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md`;
- `BASEMENT-B1-PROGRAM-RECONCILIATION.md`;
- `BASEMENT-B1-V1-V2-PRESERVATION-MAP.md`;
- `BASEMENT-B1-SCHEMATIC-PLAN-BASIS.md`;
- `production/basement-b1/basement-b1-object-inventory.json`;
- `production/basement-b1/build_equity_uprise_basement_b1_v2.py`.

B1 is **implementation-complete for the current review pass pending deterministic CI/generated snapshot and direct visual approval**.

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
12. **CURRENT:** B1 detailed pass — reconciliation → inventory → real technical environment → B1→Floor 1 stair review → true isolation → stack integration.
13. **NEXT GATE:** deterministic B1 generation + whole-building CI, then direct visual approval of isolated B1 and the complete B1→roof stack.
14. **AFTER B1 VISUAL APPROVAL:** exterior/facade/branding/material pass, including coherent glazing, crown/base composition and Equity Uprise building identity; do not reopen approved floor programs without a new repo capability or explicit design correction.

## Do not waste time on

- re-auditing already locked Floor 1 authority unless a new design change invalidates it;
- treating PNG/SVG/DXF as final deliverables;
- replacing V1 design qualities with generic debug geometry;
- rebuilding the whole stack from scratch when a validated assembly already exists;
- inventing new floor identities without current program authority.
