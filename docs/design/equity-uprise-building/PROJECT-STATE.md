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
- deterministic committed B1 report: **382 meshes, 67/67 inventory records represented, 18/18 checks passing**, GLB SHA-256 `2cf95b25d6b40568b3039f2cdb5dad55a54e989339f824e64ff40c65037f4a37`;
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

B1 is **implementation-complete for the current review pass with the deterministic GLB/report pinned by green CI; direct visual approval is the remaining B1 gate**.

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
13. **NEXT GATE:** direct visual approval of isolated B1 and the complete B1→roof stack; deterministic B1 generation and whole-building CI are green.
14. **AFTER B1 VISUAL APPROVAL:** exterior/facade/branding/material pass, including coherent glazing, crown/base composition and Equity Uprise building identity; do not reopen approved floor programs without a new repo capability or explicit design correction.

## Do not waste time on

- re-auditing already locked Floor 1 authority unless a new design change invalidates it;
- treating PNG/SVG/DXF as final deliverables;
- replacing V1 design qualities with generic debug geometry;
- rebuilding the whole stack from scratch when a validated assembly already exists;
- inventing new floor identities without current program authority.


## Facade V1 structural shell checkpoint / architectural finish pass — ACTIVE AUTHORITY / NO FINISH GEOMETRY YET

User visual review determined that the current facade is structurally coherent but not architecturally finished.

Canonical status is now:

**Facade V1 structural shell complete — architectural finish pass active.**

Checkpoint:
- `checkpoint/equity-uprise-facade-v1-structural-shell`
- SHA `2fe78f264237c905cd002365de747b3da071ea5b`

New authority:
- `FACADE-ARCHITECTURAL-FINISH-PASS-SPEC.md`

The finish pass must add/resolve:
- recessed glazing and window jamb/head/sill/reveal depth;
- resolved corners;
- deeper mineral base/plinth;
- completed south entry portal, door leaves, frames, hardware, transom/sidelights and threshold;
- canopy fascia, soffit and recessed lighting;
- exact approved Equity Uprise repo logo + Equity Uprise institutional wordmark;
- stronger Floor 6 crown / parapet / roof-service screen integration;
- intentional north/service-facade finish;
- material realism for glass, metal, opaque panels, mineral base and entrance accents;
- exterior lighting;
- building-to-ground contact.

**No finish geometry, builder changes, viewer changes or generated GLB changes are included in this authority step.**

Finish inventory gate: **COMPLETE**.

- `production/facade/facade-finish-inventory.json` is now canonical.
- **68 stable finish records** are locked before geometry work.
- inventory covers all 238 window-like modules plus frame hierarchy, acoustic/service panels, four corners, all-side base/plinth, complete entry/canopy/branding, crown/parapet/headhouse integration, exterior lighting and entry ground contact.
- existing Facade V1 geometry remains unchanged.

Step 4 geometry is now implemented in source on the architectural-finish branch:
- all **238 window-like modules** receive recessed installed-assembly treatment;
- jamb/head/sill returns and perimeter reveal/gasket shadow geometry are generated;
- secondary mullion caps, 18 ft primary-fin finish and story-band/spandrel reveals are added;
- Floor 4 acoustic and north/west service panels receive deeper finish geometry;
- genuine north service louvers receive finished frames/blades;
- all four corners are resolved as distinct south-light / north-heavy assemblies;
- mineral plinth/base treatment now grounds all four elevations with a continuous shadow reveal;
- **32 of 68 finish-inventory records** are in Step 4 scope;
- entry, canopy, branding, crown, exterior-lighting and site-contact finish records remain deliberately deferred.

Step 4 deterministic verification: **GREEN**.

Verified generated snapshot: `0c9ed33abcd679d2efc316ca82e998d3524e7ffe`

- facade GLB: **3,995 meshes / 2,499,212 bytes**;
- **238/238 window-like modules** receive finish assemblies;
- **32/32 Step 4 finish records modeled**;
- **36 finish records intentionally deferred** to later entry/canopy/branding/crown/lighting/site passes;
- facade checks: **22/22 passing**;
- GLB SHA-256: `891192539b9d827f0060dea4b311c58f4df517023f7ef306d772d8055d2a8a6c`;
- whole Core V2 CI run passed.

Step 4 is now a stable checkpoint and remains unchanged.

Step 5 source implementation is now active on the architectural-finish branch:
- the south entrance has finished portal wraps, paired door leaves, real frames, pull hardware, sidelights, transom and threshold;
- canopy fascia, soffit, edge returns and six recessed downlight fixtures are modeled;
- the entrance uses the **actual approved repo logo** from `assets/img/equity-uprise-logo.webp` via `production/facade/equity-uprise-logo-vector.json`;
- literal `E=U` substitution has been removed from the entrance;
- the same approved logo replaces the stale literal `E=U` crown identity while the crown's structural finish remains deferred;
- the Equity Uprise canopy wordmark is now stroke-based architectural geometry rather than pixel-block text;
- entry grazing/base fixtures and a simple entry apron/threshold-paving contact zone are modeled;
- **22 additional finish records** are in Step 5 scope, bringing cumulative implemented scope to **54 of 68**;
- **14 records remain deliberately deferred** for crown/parapet/service-screen and crown-lighting finish.

Step 5 deterministic verification: **GREEN**.

Verified generated snapshot: `39305ef8b27a5c521aa7c8de68e1dac73691dc3b`

- facade GLB: **3,877 meshes / 2,428,900 bytes**;
- **32/32 Step 4 records remain modeled**;
- **22/22 Step 5 entrance/logo records modeled**;
- cumulative architectural-finish coverage: **54/68 records**;
- **14 crown/roof-edge/crown-lighting records remain intentionally deferred**;
- all **238/238 window-like modules** remain detailed;
- exact approved logo asset: `assets/img/equity-uprise-logo.webp`;
- exact approved logo SHA-256: `3dd74068b984173a3c88bfd124f150653cdf04e35657006df2cf8961e57ce29f`;
- facade checks: **32/32 passing**;
- GLB SHA-256: `fc414f4609173b7c572830ef605c11db711440b7de69ff109ba5d17ec899cab3`;
- whole Core V2 CI passed.

Step 5 is now a stable checkpoint and remains unchanged.

Step 6 source implementation is now active:
- all four Floor 6 crown bands are deepened and tied to the existing 6 ft facade rhythm;
- all four Level 7 roof edges receive resolved parapet-cap geometry;
- north MEP/service screens are refined as open slatted architectural screens rather than a fake enclosed story;
- Stair A and Stair B roof headhouses receive crown trim while preserving their modeled-open roof doors;
- the passenger-elevator overrun receives trim/cap integration without asserting a passenger roof stop;
- the approved crown logo receives restrained halo treatment;
- six crown/service-screen light fixtures are modeled;
- **14/14 remaining finish records** are now represented in source;
- cumulative facade architectural-finish scope is **68/68 records** with nothing intentionally deferred.

Step 6 deterministic verification: **GREEN**.

Verified generated snapshot: `65a0bd0f886b1dc2714a8dd4685d92fefc12be52`

- facade GLB: **3,975 meshes / 2,492,132 bytes**;
- Step 4: **32/32 modeled**;
- Step 5: **22/22 modeled**;
- Step 6: **14/14 modeled**;
- total architectural-finish inventory: **68/68 modeled**;
- deferred finish records: **0**;
- all **238/238 window-like modules** remain detailed;
- facade checks: **40/40 passing**;
- GLB SHA-256: `cffae5cf77f29c65b1273c4872241dca939b1c0ae31d6de6545b7e3f31c4ba31`;
- Level 7 remains open-air;
- Stair A/B roof-door openings remain preserved;
- passenger-elevator roof service remains unassumed;
- whole Core V2 CI passed.

The **architectural facade finish inventory is now complete at 68/68**. Remaining exterior work, if any, is visual-review refinement rather than missing canonical finish scope.

## Exterior facade implementation — DETAILED CURRENT PASS ACTIVE / VISUAL APPROVAL PENDING

The facade has moved from authority-only into deterministic 3D implementation.

Current pass:
- **288/288 canonical facade modules modeled** across Floors 1–6 and all four elevations;
- **9/9 facade feature records modeled**;
- deterministic builder preflight: **1,578 meshes / 15 of 15 checks passing**;
- 6 ft facade module remains aligned to the 18 ft structural grid;
- real mullion, transom, primary-fin, spandrel, glazing, privacy-glass, acoustic-opaque, service-opaque, stair-slot, clerestory and louver geometry exists;
- Floor 1 south entry has a dimensional portal, paired glazed entry modules, projecting canopy and supports; the active architectural-finish branch supersedes its old E=U placeholder with the exact approved Equity Uprise repo logo;
- the active architectural-finish branch replaces the old south crown E=U placeholder with the exact approved Equity Uprise repo logo; full crown finish remains pending;
- Floor 4 recording-room acoustic exception is physically represented;
- north service/support facade is intentionally more opaque while retaining clerestory/stair/louver articulation;
- facade exists as a coordinated independent shell GLB so approved floor interiors are preserved;
- working-stack viewer now hides obsolete floor-local exterior placeholders in Stack mode, shows the new facade shell, restores floor-local perimeters during floor isolation, and provides facade-only isolation;
- viewer now includes South / East / North / West / Entry / Crown review cameras plus Day / Night and Wireframe states;
- B1 remains below grade and receives no fake exterior windows;
- Level 7 remains open-air; the facade crown stops at the roof datum and does not create a fake enclosed seventh floor.

Current deterministic preflight output:
- GLB bytes: **952,416**;
- meshes: **1,578**;
- facade modules: **288/288**;
- facade features: **9/9**;
- checks: **15/15 passing**.

Remaining gate: deterministic generated artifact commit, PR/main CI, live deployment, then direct visual review. The model remains not-for-construction.

## Exterior facade upgrade spec — DETAILED AUTHORITY LOCKED / GEOMETRY PENDING

The exterior-facade design is now coordinated to the existing Core V2 math rather than remaining a generic future aspiration.

Locked current-pass facade authority:
- 72 ft exterior control planes preserved;
- 18 ft structural grid retained;
- **6 ft secondary facade module / 12 modules per elevation**;
- base / middle / crown composition locked;
- Floor 1 south entrance remains aligned to the existing X29–43 vestibule, with a larger X24–48 architectural entrance composition;
- Floors 2–6 remain sealed exterior glazing with no new balconies/terraces/doors;
- south elevation = primary civic/public face;
- north elevation = intentionally more opaque support/service face;
- east/west elevations transition from occupied glazing to north core/service opacity;
- Floor 4 recording-room acoustic opacity is an explicit facade exception;
- conceptual material family now distinguishes primary glass, privacy glass, dark metal frames, opaque panels, mineral base and limited warm entry material;
- primary entry E = U / Equity Uprise identity and one restrained south crown E = U mark are coordinated;
- Level 7 remains open-air and existing parapets/headhouses/service screens remain authoritative;
- review requirements now include all four elevations, street perspectives, human-eye entry, crown, day/night, isolation and wireframe states.

Machine authority: `production/facade-system-core-v2.json` schema **1.1.0**.

**No facade geometry has been implemented in this step.** The next facade stage is per-module classification/object inventory and deterministic geometry generation after this detailed spec is accepted.

## Whole-building facade + nervous-system authority — AUTHORITY PASS ONLY

The post-B1 realism phase now has a canonical written + machine-readable authority set covering:
- exterior facade / glazing / base-middle-crown composition;
- E = U / Equity Uprise architectural branding;
- interior envelope / ceiling / support-space realism;
- electrical, lighting, data/telecom/AV, BAS/controls, security, HVAC, plumbing, sanitary, storm, fire protection and life-safety system logic;
- shared vertical service/riser coordination;
- interior-envelope audit requirements.

Core rule: every meaningful building system must trace **source → vertical route → floor branch → representative endpoint → monitoring/service access**.

**Implementation has intentionally not started in this authority snapshot.** Existing B1/F1–F7 geometry remains unchanged. The next phase is per-floor services coordination + facade/riser geometric implementation after this authority set is accepted.


## Facade Step 7 material pass — SOURCE IMPLEMENTED / VERIFICATION PENDING

This pass changes the actual rendered facade, not only documentation.

Implemented in the deterministic facade GLB builder:
- glTF PBR materials embedded directly into generated facade meshes;
- separate clear-glass and privacy-glass material behavior;
- high-metalness / controlled-roughness dark facade metal;
- rough, non-metallic mineral/plinth material;
- distinct opaque/service panel response;
- warm entrance accent response;
- canonical navy logo material;
- pale sign plate;
- architectural paver/site-edge materials;
- emissive warm architectural-light material.

Implemented in the whole-building viewer:
- neutral reflection environment via Three.js RoomEnvironment / PMREM;
- soft shadow map support;
- facade meshes cast/receive shadows where appropriate;
- transparent glazing does not cast opaque shadows;
- material-dependent environment intensity;
- day exposure improved;
- night mode now activates real facade emissive materials.

Current gate: deterministic PBR regeneration + CI, then human-eye visual preview.


## Facade Step 8 solar environment — SOURCE IMPLEMENTED / VERIFICATION PENDING

Step 8 makes the exterior light respond automatically to the viewer's device clock.

Default behavior:
- `Sun: Auto` is active on page load;
- the device's local date drives seasonal solar declination;
- the device's local wall-clock time drives the sun's east → south → west daily path;
- sunlight direction, shadow direction, sun warmth, sky/fog tone, hemisphere fill, exposure and facade emissive-light intensity update together;
- the environment refreshes once per minute;
- night architectural lights rise automatically as solar altitude falls;
- no browser geolocation permission is required and no location is transmitted or stored;
- a Connecticut/New Haven design latitude is used only to shape seasonal solar altitude/day length while the user's device clock remains authoritative.

Manual QA overrides remain available by cycling `Sun: Auto → Sun: Day → Sun: Night → Sun: Auto`.

The viewer also supports camera deep links such as:
- `?view=facade&camera=entry`
- `?view=facade&camera=crown`

Current gate: Step 8 viewer CI + deployment + live visual review.
