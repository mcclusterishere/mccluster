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

## Room Mode v2 — IPAD INPUT FIX + INTERIOR RESPONSE PASS

The canonical working-stack viewer now includes a human-scale **Room Mode** before full free-walk locomotion:
- initial playable room: **Floor 1 — Arrival / Orientation**;
- camera starts from a room-center human-eye viewpoint rather than an exterior/orbit-debug view;
- mobile/tablet users can tap **Enable Motion** and, where the browser requires it, approve device-orientation access from that direct user gesture;
- device orientation is treated relatively: the current holding direction becomes forward and **Recenter** establishes a new zero heading;
- mouse/touch drag remains the non-sensor fallback;
- canonical Floor 1 objects are subtly highlighted and selected by raycast;
- tapping a highlighted object smoothly moves the camera to a nearby inspection position;
- **Step Back** returns along the interaction loop to the room-center anchor;
- an active matching lab can reuse the same canonical object interaction path;
- raw electronics-fabric geometry and the services/X-ray layer are hidden while Room Mode is active, so player view remains architectural rather than a topology/debug visualization;
- Room Mode camera anchors are viewer viewpoints only and do **not** redefine building geometry or object placement authority;
- direct prototype entry is supported with `?room=1`.
- iPad input now requests both orientation and motion permission when required, uses absolute/relative device-orientation quaternions when delivered, and falls back to integrated rotation-rate motion when orientation events do not arrive;
- the Room HUD explicitly reports when permission was granted but the browser delivered **0 sensor events**, instead of falsely claiming tracking is active;
- touch selection no longer depends on a secondary browser click: pointer-up selects directly, with click fallback and center-reticle/near-target hit assistance;
- Floor 1 receives a viewer-side PBR-response pass (roughness/metalness/transparency/emissive tuning by canonical mesh semantics) plus warm human-scale room lights for better depth/material readability.

Current curated Floor 1 interaction targets include Reception Desk, Building Directory, Journey Wall, Development Passport Kiosk, Elevator Call Station, and Intake Display.
### X-Ray engineering presentation — ACTIVE

The X-Ray control is now a true visible engineering view rather than a state-only toggle:
- X-Ray waits for the complete B1→F7 building geometry before binding devices, eliminating the prior early-load race that could resolve zero anchors.
- Each activation re-runs canonical electronics spatial binding against the loaded building.
- The architectural shell is ghosted while X-Ray is active, and bound electronics are rendered high-contrast with class-colored through-wall engineering markers.
- Isolating a floor scopes X-Ray to that level; stack/facade views may show the whole-building device set.
- Room Mode suppresses X-Ray markers, and leaving Room Mode restores the engineering view if it was previously active.
- The HUD reports visible bound-device count, total bound devices, and unresolved-hidden devices. Zero resolved anchors is treated as an explicit X-Ray error state.
- The full cable graph remains hidden; scenario-specific traces still render only between canonical rebound endpoints.
- X-Ray lifecycle hardening keeps the engineering view active across lab visual clears/resets, rejects stale async activation work after rapid toggles, and detaches/disposes engineering markers before rebuilding them.

### Play / Engineering spatial separation — ACTIVE

The canonical viewer now separates the finished player environment from unresolved engineering design intent:
- **Play / Room Mode** renders the canonical building and only canonical building-resolved interactables; the conceptual electronics-fabric GLB is not treated as finished physical installation.
- **Engineering / X-Ray Mode** is explicit and opt-in. It may expose conceptual electronics devices for inspection, but the complete cable graph is hidden by default.
- executable labs reveal only scenario-relevant engineering connections when X-Ray is intentionally enabled.
- placeholder device coordinates and direct graph-edge cable geometry are therefore no longer allowed to visually masquerade as a completed physical interior.
- **Spatial binding is now active:** the electronics overlay is authored in feet and the viewer explicitly converts it by **0.3048** to match the meter-authored building; this fixes the prior ~3.28× scale/offset error that pushed equipment outside the building.
- generated physical electronics are rebound to canonical floor object/room anchors through `production/electronics/equity-uprise-electronics-spatial-bindings-v1.mjs`; rack/network gear resolves to support/IT spaces, user endpoints to actual work surfaces, WAPs/sensors/fire devices to ceiling/room anchors, security to access/circulation anchors, and AV to actual media/display zones.
- X-Ray renders only electronics with a valid spatial binding. Any unresolved design-intent device remains in the systems/data model but is hidden as physical geometry until it receives a canonical anchor.
- scenario cable traces are drawn only between rebound physical endpoints; the legacy generic full-cable GLB remains hidden rather than masquerading as installed routing.
- iPad Room Mode now prioritizes rotation-rate gyroscope input with explicit screen-orientation remapping so horizontal device rotation maps to camera yaw and vertical tilt maps to camera pitch; absolute device orientation is fallback-only.

### Floor 1 visual-realism truth

The current Floor 1 GLB is still a deterministic inventory-backed architectural model, not a photoreal final environment. The active preservation map explicitly says the scaffold proves geometry but is not the aesthetic target. Room Mode v2 improves surface response and lighting without changing geometry, but the remaining realism gate is still to replace schematic furniture/casework with believable forms and finish the interior material/detail pass in the canonical Floor 1 builder.

Next Room Mode work is to convert this Floor 1 proof into room-by-room canonical camera/inspection anchors and scenario-scoped interactions across the rest of the building before free-walk locomotion.

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


## Facade Step 8 solar environment — VERIFIED / LIVE

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

Verification:
- PR #162 merged to main at `96362e7f26085e9bf8baa0f91a210c22591f97f4`;
- Equity Uprise Core V2 CI: green;
- Canonical Architecture Contract: green;
- MCP Continuity and Preview: green;
- live-site deployment: green.

Step 8 is live. Remaining work is visual QA/refinement against the real rendered experience, not missing implementation.


## Building services / nervous system — SERVICES STEP 1 COMPLETE

The next whole-building implementation section is now active.

Services Step 1 locked:
- the fixed service reservation remains **X50–60 / Y66–72**;
- nine conceptual system risers are allocated inside that reservation;
- the east-side **X59–60** band remains a digital-twin separation/access buffer at the Stair A boundary;
- B1 through L7 are covered by `production/services/floor-services-addenda.json`;
- each level now has explicit served systems, representative endpoints and branch-routing intent;
- no canonical room, protected stair, elevator, door or primary circulation has been moved.

This is the coordination prerequisite for visible systems geometry.

**Next: Services Step 2 — generate a real 3D services/backbone GLB and add a Services layer to the working building viewer.**


## Building services / nervous system — SERVICES STEP 2 SOURCE IMPLEMENTED

Services Step 2 now creates **real 3D building-services geometry**, not only documents.

Implemented:
- dedicated deterministic services builder: `production/services/build_equity_uprise_services_v2.py`;
- dedicated generated GLB/report: `equity-uprise-building-services-core-v2.glb` / report;
- nine color/material-coded service risers from B1 through Level 7;
- story-by-story riser segmentation so floor isolation remains meaningful;
- floor handoff stubs only at levels actually served by each system;
- protected X59–60 separation/access buffer at the Stair A boundary;
- working-stack viewer **Services: Off / Services: Exposed** control;
- exposed-services mode ghosts the architecture so the internal backbone can be inspected;
- floor isolation filters the services overlay to the relevant story/adjacent riser segments;
- deploy pipeline publishes the services GLB/report.

Services Step 2 deterministic verification: **GREEN**.

Verified generated snapshot: `768a6270fa945dd5fb4c6c572bb72c2caade5d9d`

- dedicated services GLB: **135 meshes / 86,488 bytes**;
- **9/9 system risers modeled**;
- **63 story riser segments**;
- **63/63 authorized floor handoff stubs modeled**;
- **8 level markers** from B1 through L7;
- shared reservation remains X50–60 / Y66–72;
- Stair A separation band remains X59–60 / Y66–72;
- services checks: **12/12 passing**;
- GLB SHA-256: `4fa994486889fa135d9dae163df3b8d9dabb81eef692520b642f53ad8dc3d1ef`;
- full Equity Uprise Core V2 CI passed.

Services Step 2 is a stable checkpoint.

## Building services / nervous system — SERVICES STEP 3 COMPLETE / VERIFIED

Services Step 3 now closes the first two links of the building-services trace:

**B1 source / plant → B1 distribution → vertical riser**

Implemented in the existing Services layer:
- mechanical AHUs/pumps and a representative overhead HVAC route to **R-HVAC**;
- main switchgear/distribution and a distinct normal-power busway route to **R-ELEC-NORMAL**;
- UPS-backed emergency distribution and a distinct emergency feeder route to **R-ELEC-EMERGENCY** — **no generator was invented**;
- telecom racks + ladder-tray/backbone pathway to **R-DATA**;
- Building Systems Lab / plant BAS panel and controls raceway to **R-CONTROLS**;
- authorized fire pump / water equipment with distinguishable fire and domestic-water headers to **R-FIRE** and **R-WATER**;
- internal sanitary/vent B1 header to **R-SANITARY-VENT**, with no municipal/site connection invented;
- sump pumps / flood sensor interface and drainage route to **R-STORM**, with no external discharge geometry invented;
- nine source-to-riser connection collars that make the handoff into the Step 2 backbone visually legible;
- B1 isolation + Services shows the B1 source/distribution geometry, including direct deep link **`?floor=0&services=1`**.

Canonical generated Step 3 snapshot:
- branch checkpoint: `51ca8b1b5dbc269390c7a1fd0b376eda3f19e309`;
- services GLB: **216 meshes / 151,760 bytes**;
- **38** B1 source-equipment meshes;
- **34** B1 distribution segments;
- **9/9** source-to-riser connections;
- existing **9 risers / 63 story segments / 63 floor handoff stubs** retained;
- Step 3 verification: **28/28 checks passing**;
- GLB SHA-256: `1c1772aaac2410dbe8b8c9e601a969ab715215df30f596dbdf8bea436cec5e91`;
- full Equity Uprise Core V2 validation and deterministic generated-artifact publication passed.

The work remains conceptual digital-twin coordination and **not for construction**.

**Next: Services Step 4 — Floors 1–3 representative branches/endpoints.**


## Digital-to-Physical Asset Registry — STEP 1 SCHEMA COMPLETE

The post-services bridge between the digital twin, future physical infrastructure and training system now has a canonical schema and source contract.

Step 1 covers:
- **512** B1–L7 stable inventory records;
- **288** facade module records;
- **68** facade finish/assembly records;
- **14** service families;
- **10** riser/separation allocations;
- **56** program/capability records;
- **8** canonical levels from B1 through Level 7.

Locked policy:
- preserve stable existing object IDs;
- future physical tags encode the same canonical asset ID;
- quantity records expand to individual instances only when tagging/state/telemetry/commissioning/maintenance/training requires it;
- SIMULATION is sandboxed;
- SHADOW is read-only;
- LIVE control is deny-by-default and requires explicit authorization;
- manufacturer/model/serial/BACnet/protocol/as-built values remain unassigned until verified from a real source.

Canonical files:
- `DIGITAL-PHYSICAL-ASSET-REGISTRY-SPEC.md`
- `production/asset-registry/asset-registry-schema-v1.json`
- `production/asset-registry/asset-registry-source-contract-v1.json`
- `production/asset-registry/verify_asset_registry_schema.py`

**NEXT:** Step 2 deterministic registry ingestion, including explicit aggregate-vs-instance decisions and digital-only vs future-physicalizable classification.


## Digital-to-Physical Asset Registry — STEP 2 DETERMINISTIC INGESTION IMPLEMENTED

Step 2 now generates the first populated canonical registry from the complete B1–L7 source surface.

Each canonical source record receives exactly one ingestion decision:
- `digital_only`
- `aggregate_physicalizable`
- `individual_physicalizable`
- `system_semantic`
- `capability_semantic`

The generator preserves every raw source record as a zero-loss `source_snapshot`. Repeated records classified as `individual_physicalizable` expand deterministically to `<source-id>-I001`, `-I002`, etc.; aggregate assemblies do not expand prematurely.

Physical floor glazing records are intentionally digital/programmatic where the facade-module inventory already owns the actual envelope identity, preventing duplicate future physical tags.

Step 2 explicitly leaves manufacturers, models, serials, as-built locations, QR/NFC tags, IFC/BACnet identities, protocol addresses, commissioning results and LIVE control unassigned.

Generated artifacts:
- `production/asset-registry/generated/equity-uprise-asset-registry-v1.json`
- `production/asset-registry/generated/equity-uprise-asset-registry-step2-report.json`

**NEXT:** Step 3 builds the upstream/downstream/dependency relationship graph across these canonical asset identities.


## Digital-to-Physical Asset Registry — STEP 3A B1 OPERATIONAL GRAPH IMPLEMENTED

Step 3A turns the populated registry into a causal B1 nervous-system graph using existing service authority only.

It materializes:
- every authority-backed B1 source asset instance → service-family `feeds` edge;
- all nine source-connected service families → their dedicated riser `routes_through` edge;
- every declared inter-system `depends_on` edge across the 14 service families;
- per-asset upstream/downstream/dependency fields for direct runtime queries;
- source → system → riser trace paths suitable for first lab-scenario derivation.

Expanded Step 2 source records are resolved to their individual instance IDs. No new physical equipment, capacities, utility boundaries, protocol addresses or LIVE controls are invented.

Canonical Step 3A files:
- `production/asset-registry/build_asset_registry_step3a.py`
- `production/asset-registry/verify_asset_registry_step3a.py`
- `production/asset-registry/generated/equity-uprise-asset-registry-step3a-report.json`

**NEXT:** Step 3B connects service/riser semantics to floor branches and representative endpoints and begins resolving the highest-value placement gaps.


## Digital-to-Physical Asset Registry — STEP 3B FLOOR BRANCH / ENDPOINT GRAPH

Step 3B extends the operational graph from the B1 source/system/riser layer into modeled F1-L7 service branches and canonical endpoint assets.

The services build now emits deterministic branch topology records with:
- floor handoff ID;
- branch ID;
- service family;
- endpoint label;
- canonical inventory reference when verified;
- route points;
- modeled connection XY;
- source services implementation step.

Step 3B links only references that resolve to real current registry assets. Ambiguous legacy endpoints remain semantic-only instead of becoming fabricated equipment. Modeled service connection points are retained for training/navigation but do not overwrite unverified as-built asset locations.

Canonical files:
- `production/asset-registry/build_asset_registry_step3b.py`
- `production/asset-registry/verify_asset_registry_step3b.py`
- `production/asset-registry/generated/equity-uprise-asset-registry-step3b-report.json`

**NEXT:** generate the first lab scenario set from causal source → system → riser → branch → endpoint traces.


## Whole-Building Electronics / IT Fabric — STEP 4A IMPLEMENTED

The current Step 3B registry now has a deterministic whole-building electronics overlay.

Step 4A generates:
- a B1 MDF/edge/core/server/security/fire-gateway design-intent stack;
- per-floor IDF/access switching sized from modeled endpoint demand;
- WAPs plus spare WAP Cat6A drops;
- workstations, monitors, IP phones, MFPs, cameras, access control, intercom, BAS controllers/sensors and AV electronics;
- logical VLANs, SSIDs and building services including DHCP, DNS, NTP, AAA/RADIUS, VPN, monitoring, VMS, BAS and AV control;
- typed physical connection objects for copper, fiber, local AV, BAS field bus, access reader bus, fire alarm circuits and power;
- transient Wi-Fi/cellular client profiles rather than pretending personal phones are permanent building assets;
- a five-tier / 40-lab IT training catalog;
- a GLB electronics/wiring overlay for later viewer integration.

Important boundary:
- this is a research-grounded **design-intent/training model**, not a construction, code, RF, fire-alarm or stamped engineering design;
- physical diversity, exact AP placement, exact circuit sizes/capacities, IP addressing, carrier services and as-built rack/port assignments remain verification/commissioning work.

Canonical Step 4A source:
- `ELECTRONICS-IT-INFRASTRUCTURE-SPEC.md`
- `production/electronics/electronics-population-policy-v1.json`
- `production/electronics/build_equity_uprise_electronics_v1.py`
- `production/electronics/verify_equity_uprise_electronics_v1.py`

**NEXT:** load the generated electronics GLB/manifest into the viewer and turn the generated lab definitions into executable scenarios.


## Federal Training Catalog — V1 IMPLEMENTED

The repository now has one canonical, issuer-grounded federal training layer instead of mixing exact FEMA IDs with unresolved agency names.

Implemented:
- exact FEMA IS-100.C, IS-120.C, IS-130.A, IS-200.C, IS-201.A, IS-235.C and IS-238 records;
- current-year IRS VITA/TCE Basic/Advanced, Volunteer Standards of Conduct and Intake/Interview + Quality Review records with Practice Lab boundaries;
- HHS/OHRP human-subjects and participant-centered informed-consent training;
- CISA ICS 300/401 virtual and ICS 301 later in-person Red/Blue pathways;
- DOE/FEMP, EPA ENERGY STAR, NOAA Digital Coast and NASA ARSET dynamic-program records;
- CDC EHTER Awareness/Operations and ATSDR PHAT;
- explicit non-course classification for OSHA/FHWA/NIST/NVD/CISA KEV references;
- exact competency, floor, Floor 1 scenario, Step 4A lab and verified asset bindings where applicable;
- CI validation that catalog IDs resolve against current competency, scenario, lab and asset authority;
- federal authority files included in the building context index.

Truth boundary remains unchanged: federal credential state is not competency mastery, and learner B1/OT activity remains sandboxed-clone-only with LIVE control disabled.

**NEXT:** use the merged Step 4A electronics fabric plus these federal bindings to promote the highest-value generated labs into executable Lab Runtime scenarios, beginning with CISA-aligned IT/OT incident labs, FEMA exercise/evaluation scenarios, and IRS/OHRP Floor 1 service-intake simulations.

## Lab Runtime — STEP 1 FOUNDATION IMPLEMENTED

The generated Step 4A training catalog now has a real execution foundation instead of definition-only lab records.

Step 1 adds a browser-compatible, dependency-free ES module that:
- adapts all 40 canonical Step 4A labs into stable executable-scenario envelopes;
- enforces the `CREATED -> RUNNING -> COMPLETED` lifecycle plus deterministic reset/restart;
- activates catalog fault declarations as abstract sandbox state;
- records inspections, simulated learner actions and criterion evidence in an append-only monotonic event ledger;
- refuses completion until all required canonical success criteria have evidence;
- exports a deterministic evidence bundle for later competency assessment;
- hard-rejects LIVE execution at both session and action level.

Canonical Step 1 files:
- `LAB-RUNTIME-SPEC.md`
- `production/lab-runtime/lab-runtime-schema-v1.json`
- `production/lab-runtime/equity-uprise-lab-runtime.mjs`
- `production/lab-runtime/verify_lab_runtime_v1.mjs`

The Core V2 CI now executes the runtime verifier against the live 40-lab Step 4A catalog.

Boundary: Step 1 does not yet change asset/link/service state. Faults remain abstract declarations until Step 2 binds target selectors to the electronics fabric and asset graph. B1/OT remains sandboxed-clone-only; LIVE control remains disabled.

**NEXT:** Step 2 connects runtime target selectors + fault declarations to the Step 4A electronics manifest/connections and canonical asset identities so simulated devices, links and services actually respond to lab state.

## Lab Runtime — STEP 2 ELECTRONICS / ASSET-STATE BINDING IMPLEMENTED

Step 2 connects the Step 1 session engine to the canonical Step 4A electronics fabric.

Implemented:
- deterministic resolution for all current Step 4A lab target selectors;
- independent in-memory state for canonical registry assets and typed electronics connections;
- explicit support for every current non-`none` Step 4A fault token;
- physical/logical propagation across representative copper, fiber, PoE, access-switch, BAS, OSDP, UPS, hosted-service, identity, firewall-HA and whole-building incident paths;
- runtime evidence containing exact changed canonical asset/connection IDs;
- sandbox-aware inspection and changed-state evidence export;
- deterministic reset to baseline with scenario binding preserved;
- hard rejection of LIVE execution and any registry asset that enables live control.

Canonical Step 2 files:
- `production/lab-runtime/equity-uprise-electronics-sandbox.mjs`
- `production/lab-runtime/verify_electronics_sandbox_v1.mjs`

The Core V2 CI now verifies both the Step 1 runtime foundation and Step 2 electronics binding.

Boundary: this is a training sandbox bound to the design-intent digital twin. It does not write to live systems and does not promote unverified design intent to as-built truth.

**NEXT:** Step 3 builds the first richer CISA-aligned IT/OT executable incident scenarios on this state engine.

## Lab Runtime — STEP 3 CISA / IT-OT GUIDED INCIDENT SCENARIOS IMPLEMENTED

The Step 2 electronics state engine now drives the first three task-specific executable IT/OT incident labs:

- `IT-LAB-029` — IT/OT Firewall Segmentation;
- `IT-LAB-038` — SIEM Cross-Domain Correlation;
- `IT-LAB-039` — Cross-System Building Incident Response.

Implemented:
- explicit learner objectives and allowlisted simulated actions;
- prerequisite/order gates;
- deterministic correct/incorrect decision handling;
- state-backed inspections plus scenario-specific observations;
- simulation-only mitigation that clears only the intended fault and recomposes the remaining sandbox state;
- safe restoration-order enforcement for the cross-system incident;
- automatic canonical criterion evidence when guided objectives are complete;
- deterministic replay;
- verification that every referenced CISA federal binding actually includes the source lab;
- continued SANDBOX-only / LIVE-disabled enforcement.

Canonical Step 3 files:
- `production/lab-runtime/cisa-itot-scenario-pack-v1.json`
- `production/lab-runtime/equity-uprise-guided-scenarios.mjs`
- `production/lab-runtime/verify_cisa_itot_scenarios_v1.mjs`

Boundary: Step 3 does not add live control, exploit tooling, secure proctoring, numeric scoring, timing penalties, or 3D failure visualization.

**NEXT:** Step 4 adds FEMA building-operations exercises using the same runtime/evidence architecture.

## Lab Runtime — STEP 4 BUILDING-OPERATIONS EXERCISES IMPLEMENTED

The eight approved Floor 1 operations scenarios now have executable simulation flows on the Lab Runtime.

Implemented:
- evacuation + accountability;
- blocked Stair A alternate routing;
- passenger-elevator outage accessibility response;
- power-interruption continuity response;
- medical-incident escalation and responder handoff;
- public-service surge / queue continuity;
- network/check-in outage fallback;
- service-area hazard boundary and responder-access control.

The exercises reuse canonical Floor 1 objects such as Stair A/B discharge doors, egress walks, assembly areas, passenger-elevator interfaces, AED/two-way communication, service access, reception/directory objects, plus canonical `ELEC-NORMAL` and `LOGIC-SVC-DIRECTORY-IDP` identities.

Wrong choices and out-of-order actions do not advance completion. Successful completion records the canonical Floor 1 scenario evidence fields through the same Step 1 evidence spine.

Canonical Step 4 files:
- `production/lab-runtime/fema-building-ops-scenario-pack-v1.json`
- `production/lab-runtime/equity-uprise-building-ops-runtime.mjs`
- `production/lab-runtime/verify_fema_building_ops_scenarios_v1.mjs`

Boundary: no LIVE control, no code-compliance claim, no medical-treatment instruction, and no hazardous-area entry/cleanup instruction.

**NEXT:** Step 5 builds the Floor 1 public-service intake labs.

## Lab Runtime — STEP 5 FLOOR 1 PUBLIC-SERVICE LABS IMPLEMENTED

Step 5 extends the runtime into the existing Floor 1 intake/service environment using the canonical `privacy_error_intake` scenario.

Implemented:
- VITA/TCE intake/privacy/scope/quality-review synthetic workflow;
- OHRP participant-centered consent/privacy synthetic workflow;
- cross-program intake privacy-containment workflow;
- existing IRS VITA and OHRP federal-training binding verification;
- canonical Floor 1 reception/intake object binding;
- prerequisite gates and deterministic wrong-answer handling;
- fault-specific privacy/scope/review/consent remediation;
- automatic evidence capture against canonical `privacy_error_intake` evidence;
- hard rejection of non-synthetic case fixtures;
- fixture checks preventing SSN/email/phone-shaped data and direct PII field keys;
- continued SANDBOX-only / LIVE-disabled enforcement.

Canonical Step 5 files:
- `production/lab-runtime/public-service-scenario-pack-v1.json`
- `production/lab-runtime/equity-uprise-public-service-runtime.mjs`
- `production/lab-runtime/verify_public_service_scenarios_v1.mjs`

Boundary: Step 5 does not provide tax advice, authorize VITA/TCE service, provide IRB/protocol authority, or handle real client/taxpayer/research-participant data.

**NEXT:** Step 6 adds full assessment/evidence capture and competency evaluation across the executable lab runtime.

## Lab Runtime — STEP 6 ASSESSMENT / EVIDENCE LAYER IMPLEMENTED

Step 6 adds a common assessment wrapper across the Step 3 CISA/IT-OT, Step 4 building-operations, and Step 5 public-service executable runtimes.

Implemented:
- ordered action ledger;
- correct / incorrect / blocked / runtime-error counts;
- deterministic per-action timing through an injectable clock;
- diagnosis and restoration elapsed-time milestones;
- hint history and canonical assistance-level derivation;
- safety-violation records with a critical-safety gate;
- learner-produced artifact/training/performance evidence metadata;
- SHA-256 evidence and assessment provenance;
- AI-assistance declaration and Evidence Defense recommendation;
- competency-to-rubric/version mapping against all 42 canonical rubrics;
- bounded Level 1 machine evidence signals;
- hard prevention of automated Verified / Applied / Mentor awards;
- rejection of simulation evidence mislabeled as Applied;
- rejection of fabricated automated Reviewer evidence.

Canonical Step 6 files:
- `production/lab-runtime/equity-uprise-assessment-runtime.mjs`
- `production/lab-runtime/assessment-policy-v1.json`
- `production/lab-runtime/verify_assessment_runtime_v1.mjs`

The verifier covers:
- a clean independent CISA/IT-OT run;
- a building-operations run with blocked/incorrect actions plus a hint;
- a public-service run with a critical safety/privacy-boundary violation;
- deterministic replay;
- evidence hashing;
- rubric mapping;
- human-review boundaries.

**NEXT:** Step 7 adds difficulty-level policy/behavior across Foundation → Technician → Admin → Advanced → Expert.

## Lab Runtime — STEP 7 DIFFICULTY PROGRESSION IMPLEMENTED

Step 7 adds the five-level progression layer over Step 6 assessed exercises:

- FOUNDATION
- TECHNICIAN
- ADMIN
- ADVANCED
- EXPERT

Implemented:
- progressively reduced learner-facing action/objective/fault disclosure;
- per-tier hint budgets and allowed hint levels;
- per-tier learner artifact expectations;
- deterministic presentation contracts;
- explicit difficulty qualification separate from exercise completion;
- Expert multi-fault complexity gate;
- preservation of Step 6 evidence, safety, provenance, and human-review boundaries;
- verification across Step 3 CISA/IT-OT, Step 4 building operations, and Step 5 public-service runtime families.

Canonical Step 7 files:
- `production/lab-runtime/difficulty-progression-policy-v1.json`
- `production/lab-runtime/equity-uprise-difficulty-runtime.mjs`
- `production/lab-runtime/verify_difficulty_progression_v1.mjs`

Boundary: Step 7 does not modify canonical scenario truth or convert difficulty qualification into a human `Verified` competency award.

**NEXT:** Step 8 integrates executable lab state, assessment, and difficulty into the 3D viewer.



## Lab Runtime — STEP 8 DEEP 3D VIEWER INTEGRATION IMPLEMENTED

Step 8 completes the current 1–8 Lab Runtime sequence by connecting the existing executable runtime to the canonical `equity-uprise-building-core-v2-3d.html` viewer without making the viewer a second simulation authority.

Implemented:
- lazy Lab mode layered over the existing B1→Level 7 viewer;
- `?lab=<id>&difficulty=<level>` startup using the existing query convention;
- one canonical `equity-uprise-viewer-lab-integration.mjs` runtime/presentation adapter;
- canonical Step 3 CISA/IT-OT, Step 4 building-operations, and Step 5 public-service exercise construction;
- Step 6 assessment and Step 7 learner-presentation wrapping inside the same runtime chain;
- direct visual binding to canonical electronics asset IDs and connection IDs from the generated electronics GLB;
- failed/degraded/at-risk electronics highlighting plus typed connection/path highlighting;
- canonical Floor 1 object/site overlays for blocked egress, alternate paths, assembly areas, service hazards, responder keep-clear, elevator/public-service objects and privacy/intake state;
- runtime-derived system-state HUD;
- difficulty-filtered learner tasks that do not expose hidden fault/objective/target/prerequisite data beyond Step 7 policy;
- 3D double-click inspection routed through the existing runtime action API rather than direct state mutation;
- bounded Step 6 assessment display with a `Demonstrated` automation ceiling and no automated human competency awards;
- anonymous synthetic occupancy/context markers only where a scenario needs people-state context;
- reset that reconstructs the sandbox session at canonical baseline and clears all viewer fault/path/area/occupancy overlays;
- browser-safe deterministic SHA-256 provenance in Step 6 so the same assessment runtime can execute in the browser;
- deploy publication of the canonical runtime/data/electronics bundle required by the viewer;
- deterministic Step 8 verification plus coverage in the existing browser smoke suite.

Canonical Step 8 files:
- `production/lab-runtime/equity-uprise-viewer-lab-integration.mjs`
- `production/lab-runtime/verify_viewer_lab_integration_v1.mjs`
- `equity-uprise-building-core-v2-3d.html`

Boundary: Step 8 is presentation/interaction over SANDBOX state only. It creates no live building control, does not convert electronics design intent into as-built truth, does not expose real public-service PII, and does not award Verified / Applied / Mentor competency states.

**CURRENT 1–8 LAB RUNTIME SEQUENCE: COMPLETE.**
