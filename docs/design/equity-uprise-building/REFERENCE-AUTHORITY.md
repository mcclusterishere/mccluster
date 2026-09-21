# Equity Uprise — Canonical Reference Authority

> **MANDATORY READ BEFORE EQUITY UPRISE VISUAL / SPATIAL WORK**
>
> Any agent, model, designer, renderer, developer, image generator, 3D tool, CAD workflow, or lore/worldbuilding task that touches Equity Uprise architecture, rooms, floors, geometry, 360 environments, building imagery, spatial navigation, physical-world continuity, or architectural narrative **must read and obey this file and the references below before producing work**.

## Core V2 authority

>
> The old floor-local core coordinates are superseded by:
> 1. `BUILDING-CORE-V2-SPEC.md`
> 2. `production/building-core-v2.json`
> 3. `production/building-v2-validation.json`
> 4. `production/equity-uprise-capability-map-v2.json`
> 5. `production/core-v2-floor-programs.json`
>
> These shared files control vertical systems before any floor-specific spec, plan basis, DXF/SVG, production manifest, GLB or browser scene.
>
> `main` remains unchanged until this reconciled Core V2 snapshot is validated and explicitly merged.

## Core V1 archive rule

The superseded Core V1 DXF/SVG/PNG plan sets have been removed from the active per-floor reference folders and preserved only under:

`docs/design/equity-uprise-building/references/archive/core-v1/`

Those archived files are **historical / non-canonical / traceability only**.

No agent, renderer, generator, CAD workflow, 3D scene, hotspot workflow or plan revision may use an archived Core V1 asset as current geometry. Active plan references are the versioned `core-v2` files in each `references/floor-0X/` folder.

## Compatibility filename rule

Two historical filenames remain as compatibility stubs only:

- `FLOOR-01-LOBBY-INTAKE-360-SPEC.md`
- `BASEMENT-B1-TECHNICAL-SERVICE-PROGRAM.md`

They are **non-canonical** and may not be cited by new renderers, generators, manifests or design work. Their only purpose is to redirect old links to:

- `FLOOR-01-ARRIVAL-ORIENTATION-INTAKE-360-SPEC.md`
- `BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md`

## Trigger conditions

This authority applies whenever a task involves any of the following in connection with Equity Uprise:

- building / headquarters / institute / facility;
- floor plan, floor, room, corridor, lobby, elevator, stair, core or service area;
- architecture, geometry, dimensions, coordinates, scale or stacking;
- 360 panorama / equirectangular environment;
- image generation, rendering, visualization or animation of the building;
- camera position, transition, hotspot or room navigation;
- exterior/interior continuity;
- environmental lore, spatial story, room identity or worldbuilding;
- props/furniture whose placement affects circulation or room function;
- any future 3D reconstruction of this building.

If the task is only about Equity Uprise policy/data/application behavior and has no visual/spatial component, use the normal Equity Uprise platform documentation. If it becomes spatial, this authority activates immediately.

## Mandatory authority order

Read program and geometry authority in this order:

1. `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`
   - Current repo-to-building reconciliation.
   - Defines what Equity Uprise actually contains and the status/boundaries of those capabilities.

2. `docs/design/equity-uprise-building/production/equity-uprise-capability-map-v2.json`
   - Machine-readable capability inventory.
   - Assigns every audited capability a primary floor, optional secondary floors, implementation status, visibility boundary and physical expression.

3. `docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md`
   - Defines the six enclosed-floor + Level 7 compression, vertical narrative and architectural interaction model.

4. Core V2 shared geometry:
   - `docs/design/equity-uprise-building/BUILDING-CORE-V2-SPEC.md`
   - `docs/design/equity-uprise-building/production/building-core-v2.json`
   - `docs/design/equity-uprise-building/production/building-v2-validation.json`

5. Shared floor-program authority:
   - `docs/design/equity-uprise-building/production/core-v2-floor-programs.json`
   - Floor program may name/route capabilities but may not redefine shared vertical geometry.
   - Floor 1 additional activity/simulation authority:
     - `docs/design/equity-uprise-building/FLOOR-01-DIGITAL-TWIN-PROGRAM.md`
     - `docs/design/equity-uprise-building/production/floor-01/floor-01-digital-twin-program.json`
     - `docs/design/equity-uprise-building/FLOOR-01-SITE-EGRESS-SIMULATION.md`
     - `docs/design/equity-uprise-building/production/floor-01/floor-01-site-egress.json`
   - B1 support-level authority:
     - `docs/design/equity-uprise-building/BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md`
     - `docs/design/equity-uprise-building/production/basement-b1-program.json`
   - Underground-network authority:
     - `docs/design/equity-uprise-building/UNDERGROUND-TUNNEL-NETWORK-SPEC.md`
     - `docs/design/equity-uprise-building/production/underground-tunnel-network.json`
   - Code/safety research profile:
     - `docs/design/equity-uprise-building/SIMULATION-CODE-REFERENCE-PROFILE.md`
   - These files define institutional activity, simulation systems, site/egress behavior, the non-developmental technical basement and training scenarios. They do not override the shared Core V2 vertical chassis.

6. Floor-specific program / spatial reference:
   - **Floor 1 — current program authority:** semantic identity **Arrival / Orientation / Intake**; long-form file retained under legacy-compatible filename `docs/design/equity-uprise-building/FLOOR-01-ARRIVAL-ORIENTATION-INTAKE-360-SPEC.md`.
   - **Floors 2–6 — provisional program references only:** the existing long-form specs remain useful spatial/history inputs, but their room/activity programs are **not final authority** until each floor receives the same iterative development-program reconciliation completed for Floor 1.
     - Floor 2: `docs/design/equity-uprise-building/FLOOR-02-PUBLIC-FORUM-360-SPEC.md`
     - Floor 3: `docs/design/equity-uprise-building/FLOOR-03-FELLOWSHIP-NETWORK-360-SPEC.md`
     - Floor 4: `docs/design/equity-uprise-building/FLOOR-04-MEDIA-CULTURE-360-SPEC.md`
     - Floor 5: `docs/design/equity-uprise-building/FLOOR-05-POLICY-PROOF-360-SPEC.md`
     - Floor 6: `docs/design/equity-uprise-building/FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md`
   - Floor 6 Halo instrument remains separately authoritative for the Halo boundary: `docs/design/equity-uprise-building/HALO-GLOBE-SPATIAL-INTELLIGENCE-SPEC.md`.
   - **Level 7 — provisional program reference only:** `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-360-SPEC.md`; roof chassis/vertical-access constraints remain active while launch/culmination programming awaits iterative rewrite.

7. Floor-specific schematic-plan basis.

8. Active Core V2 generated plan references. Floor 1 requires both the interior Core V2 triplet and the separate site/life-safety triplet; B1 requires its restricted plan triplet. Floors 2–7 are chassis/provisional plan references only until their iterative rewrites.

9. B1 / floor deterministic production package (generated-only).

10. Generated GLB / browser viewer / render / 360 output.

### Level 7 additional authority

Before Floor 6 roof-interface, rooftop, exterior-master, cross-site mobility, destination-building or ecosystem-navigation work also read:
- `FLOOR-07-ECOSYSTEM-ROUTING-CONTRACT.md`
- `FLOOR-07-ROOF-MOBILITY-PORTAL-PREPROGRAM.md` as origin/context only.

Program authority and geometry authority are complementary: the capability map controls **what the building represents**; Core V2 controls **where the shared building systems physically are**.

### Render-readiness rule

- **B1:** restricted support/operations program is current enough for a basic restricted render.
- **Floor 1:** program is reconciled and basic-render-ready for the current iterative pass.
- **Floors 2–7:** shell/core/vertical-system geometry is current, but room/activity programs remain pre-iterative and must render as **chassis only by default**.
- A design-debug viewer may expose provisional zones only when explicitly requested and must label them provisional.

The machine-readable render rule lives in `production/core-v2-floor-programs.json` and `production/building-v2-validation.json`.

## Deterministic production packages

Derived scene packages are generated from the active machine authorities. They are **generated-only** implementation artifacts and may not override the source JSON/specs above.

B1 restricted production package:
- `docs/design/equity-uprise-building/production/basement-b1/README.md`
- `docs/design/equity-uprise-building/production/basement-b1/basement-b1-scene-manifest.json`
- companion material, lighting, camera, hotspot, routing and state JSON files in the same folder.
- live access remains restricted; learner/instructor use is sandbox-only.

Floor 1 production package:
- `docs/design/equity-uprise-building/production/floor-01/README.md`
- `docs/design/equity-uprise-building/production/floor-01/floor-01-scene-manifest.json`
- companion material, lighting, camera, hotspot, routing and state JSON files in the same folder.

Floor 2 production package:
- `docs/design/equity-uprise-building/production/floor-02/README.md`
- `docs/design/equity-uprise-building/production/floor-02/floor-02-scene-manifest.json`
- companion material, lighting, camera, hotspot, routing and state JSON files in the same folder.


Floor 3 Core V2 production package:
- `docs/design/equity-uprise-building/production/floor-03/README.md`
- `docs/design/equity-uprise-building/production/floor-03/floor-03-scene-manifest.json`

Floor 4 Core V2 production package:
- `docs/design/equity-uprise-building/production/floor-04/README.md`
- `docs/design/equity-uprise-building/production/floor-04/floor-04-scene-manifest.json`

Floor 5 Core V2 production package:
- `docs/design/equity-uprise-building/production/floor-05/README.md`
- `docs/design/equity-uprise-building/production/floor-05/floor-05-scene-manifest.json`

Floor 6 Core V2 production package:
- `docs/design/equity-uprise-building/production/floor-06/README.md`
- `docs/design/equity-uprise-building/production/floor-06/floor-06-scene-manifest.json`

Floor 7 Core V2 production package:
- `docs/design/equity-uprise-building/production/floor-07/README.md`
- `docs/design/equity-uprise-building/production/floor-07/floor-07-scene-manifest.json`

Core V2 authority order is:
**BUILDING-CORE-V2-SPEC.md → building-core-v2.json → floor written spec → floor schematic basis → DXF → SVG → floor deterministic production package → generated 3D/render/web output**.

The production package operationalizes the architecture; it may never override canonical dimensions, core placement, circulation, access, or room program.

## Repo-to-building coverage gate

Before declaring the building program complete, run both repo/program gates:

- `docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py`
- `docs/design/equity-uprise-building/production/verify_equity_uprise_program_coverage.py`
- when plan references are regenerated: `docs/design/equity-uprise-building/production/verify_core_v2_plan_semantics.py`

The exhaustive source-classification ledger is:

`docs/design/equity-uprise-building/production/equity-uprise-repo-source-map-v2.json`

The repo-source gate must prove that every discovered Equity Uprise-specific product/support source is either mapped to one or more canonical capabilities or explicitly classified as support-only. The program gate must verify that every capability in the canonical map is represented on its primary and declared secondary floors, that floor route keys resolve, that private/high-risk routes are not marked public, that the Floor 6 Halo Globe resolves to a sanitized read-only projection with owner-only operational handoff, and that passenger-elevator semantics do not imply Level 7 service. The plan-semantic gate must prove that active Core V2 DXF/SVG/PNG outputs carry the canonical program labels and do not retain stale semantic labels.

## Which source controls what

### Program / developmental intent / room identity

Authority:
1. repo reconciliation audit;
2. capability map;
3. Lifetime Development journey / competency / evidence authority;
4. building inventory;
5. shared floor-program JSON;
6. floor-specific digital-twin/activity authority when present;
7. floor written spec **only to the maturity level declared by the shared floor-program JSON**.

For a floor marked `pre-iterative-program-rewrite`, its legacy long-form room program is a working reference, not final authority.

Generated plan labels for a provisional floor describe the **current legacy program snapshot only**. They are not evidence that the later-floor program has been finalized. Only Floor 1 is currently program-reconciled and basic-render-ready for the present iterative pass.

Do not invent a room, department, floor function or public-facing feature merely because it looks cinematic.

### Geometry / dimensions / vertical continuity

Authority:
1. `BUILDING-CORE-V2-SPEC.md` + `production/building-core-v2.json` for shell, elevations, shafts, stairs, risers and vertical continuity;
2. floor schematic-plan basis for floor-local coordination that does not conflict with the shared core;
3. generated DXF;
4. generated SVG;
5. generated PNG preview;
6. later renders.

Generated DXF/SVG/PNG are **derived artifacts** and never override the machine-readable/shared written Core V2 authority. A generated image is never geometric authority.

### Visual materials / atmosphere

Use the written floor spec and building inventory. Visual interpretation may add non-structural detail only when it does not alter:
- dimensions;
- floor plate;
- structural/core placement;
- room program;
- circulation;
- access;
- egress concept;
- camera datum;
- floor-to-floor continuity.

## B1 + Floor 1 coordinated geometry

The Core V2 stack now includes a non-developmental **B1 Underground Operations / Technical Service Basement** at FFE **-13'-6"**. B1 is support/training infrastructure and does not consume an E-Q-U-I-T-Y letter.

Floor 1 remains the principal building datum and the modeled **level of exit discharge**:

- B1 and Floor 1 coordination plate: **72'-0" × 72'-0"**;
- B1 FFE: **-13'-6"**;
- Floor 1 FFE: **0'-0"**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- service/freight elevator shaft: **X 0–8 / Y 60–72**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 8–18 / Y 54–72**;
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**;
- 360 camera datum: approximately **(36, 28), 5'-4" AFF**;
- protected stairs and both elevator shafts continue to B1;
- Floor 1 stair landings require discharge-direction control to prevent accidental descent to B1 during evacuation;
- 0° north: Reception / Concierge / Security + Journey Wall;
- +90° east: elevator/core;
- 180° south: entrance/vestibule on Floor 1 only;
- -90° west: Orientation Lounge / intake.

Floors 2–6 and Level 7 roof access must stack on this shell/core logic unless the owner explicitly approves a formal building-wide revision.

## Floor 2 Core V2 chassis geometry — program provisional

Floor 2 preserves the Floor 1 building datum:

- floor plate: **72'-0" × 72'-0" = 5,184 GSF**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- service/freight elevator shaft: **X 0–8 / Y 60–72**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 8–18 / Y 54–72**;
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**;
- forum table: approximately **12 ft diameter**, centered near **(36,39)**;
- member check-in: adjacent to elevator, approximately **X 49–51 / Y 24–29**;
- conversation/lounge zone: **X 2–18 / Y 14–30**;
- feature wall: approximately **X 24–48 / Y 50–54**;
- 360 camera datum: approximately **(36,28), 5'-4" AFF**;
- 0° north: forum table / Topics / Perspectives / Conversations Wall;
- +90° east: elevator + member check-in;
- 180° south: sealed upper-floor glazing — **no exterior door**;
- -90° west: conversation/listening lounge.

Floor 2 has **no exterior public entrance, balcony, or terrace**.

Current generated Floor 2 chassis-plan assets:
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-core-v2-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-core-v2-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-core-v2-schematic-v1.png`

## Floor 3 Core V2 chassis geometry — program provisional

Floor 3 preserves the same building datum:

- floor plate: **72'-0" × 72'-0" = 5,184 GSF**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- service/freight elevator shaft: **X 0–8 / Y 60–72**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 8–18 / Y 54–72**;
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**;
- Opportunity Exchange table: **16' × 4'**, centered near **(36,41)**;
- People + Network lounge: **X 2–18 / Y 18–34**;
- Interview / Stakeholder Meeting A: **X 2–14 / Y 4–16**;
- Interview / Stakeholder Meeting B: **X 16–28 / Y 4–16**;
- member/meeting check-in: approximately **X 49–51 / Y 24–29**;
- 360 camera datum: approximately **(36,28), 5'-4" AFF**;
- 0° north: Opportunity Exchange / Fellowship + Network wall;
- +90° east: elevator + member/interview check-in;
- 180° south: interview / stakeholder meeting rooms + sealed upper-floor glazing;
- -90° west: People + Network lounge.

Floor 3 has **no exterior public entrance, balcony, or terrace**.

Current generated Floor 3 chassis-plan assets:
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-core-v2-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-core-v2-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-core-v2-schematic-v1.png`

## Floor 4 Core V2 chassis geometry — program provisional

Floor 4 preserves the same building datum:

- floor plate: **72'-0" × 72'-0" = 5,184 GSF**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- service/freight elevator shaft: **X 0–8 / Y 60–72**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 8–18 / Y 54–72**;
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**;
- Media / Listening planning zone: approximately **X 24–48 / Y 28–50**;
- Culture Archive / Rally Gallery: approximately **X 2–18 / Y 18–38**;
- Creator Recording Room: **X 2–15 / Y 4–16**;
- Edit / Review Suite: **X 17–31 / Y 4–16**;
- Media / Release Control: approximately **X 49–51 / Y 24–29**;
- Media / Release Wall: approximately **X 22–50 / Y 50–54**;
- 360 camera datum: approximately **(36,28), 5'-4" AFF**;
- 0° north: Media / Release Wall + listening-screening room;
- +90° east: elevator + Media / Release Control;
- 180° south: recording/edit rooms + sealed upper-floor glazing;
- -90° west: Culture Archive / Rally Gallery.

Floor 4 has **no exterior public entrance, balcony, or terrace**.

Current generated Floor 4 chassis-plan assets:
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-core-v2-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-core-v2-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-core-v2-schematic-v1.png`

The raster preview is derivative and cannot override the DXF/SVG/written geometry.

## Floor 5 Core V2 chassis geometry — program provisional

Floor 5 preserves the same building datum:

- floor plate: **72'-0" × 72'-0" = 5,184 GSF**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- service/freight elevator shaft: **X 0–8 / Y 60–72**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 8–18 / Y 54–72**;
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**;
- Policy Lab table: **16' × 5'**, centered near **(36,41)**;
- Evidence + Proof Archive: **X 2–18 / Y 18–40**;
- Source Review Room: **X 2–15 / Y 4–16**;
- Publication / Submission Review Room: **X 17–32 / Y 4–16**;
- Research / Publication Navigator: approximately **X 49–51 / Y 24–29**;
- Policy / Publication / Impact Wall: approximately **X 22–50 / Y 50–54**;
- 360 camera datum: approximately **(36,28), 5'-4" AFF**;
- 0° north: Policy Lab / Policy / Publication / Impact Wall;
- +90° east: elevator + Research / Publication Navigator;
- 180° south: review rooms + sealed upper-floor glazing;
- -90° west: Evidence + Proof Archive.

Floor 5 has **no exterior public entrance, balcony, or terrace**.

Current generated Floor 5 chassis-plan assets:
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-core-v2-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-core-v2-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-core-v2-schematic-v1.png`

The raster preview is derivative and cannot override the DXF/SVG/written geometry.

## Floor 6 Core V2 chassis geometry — program provisional

Floor 6 preserves the building datum and the Level 7 roof interface:

- floor plate: **72'-0" × 72'-0" = 5,184 GSF**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- service/freight elevator shaft: **X 0–8 / Y 60–72**;
- Stair A: **X 60–72 / Y 54–72**, with upward continuity reserved;
- Stair B: **X 8–18 / Y 54–72**, with vertical continuity reserved;
- MEP / roof-service reservation: **X 50–60 / Y 66–72**;
- Penthouse Command table: **16' × 5'**, centered near **(36,41)**, six seats maximum;
- Halo Globe / Spatial Intelligence: suspended sphere centered approximately **(24.5,34.5)**, radius **2.25 ft**, center **8.25 ft AFF**;
- Institutional Salon / Join Lounge: **X 2–18 / Y 18–38**;
- Strategy Review Room: **X 2–15 / Y 4–16**;
- Partner / Executive Briefing Room: **X 17–32 / Y 4–16**;
- Roof Access / Mobility Transition terminal: **X 49–51 / Y 24–29**;
- Institutional Command Wall: **X 22–50 / Y 50–54**, with **NOW / PAST WORK / JOIN**;
- 360 camera datum: approximately **(36,28), 5'-4" AFF**;
- 0° north: Institutional Command Wall / NOW-PAST WORK-JOIN;
- +90° east: elevator + Level 7 roof transition;
- 180° south: Strategy/Partner rooms + sealed glazing;
- -90° west: Institutional Salon.

Floor 6 has **no exterior public entrance, balcony, or terrace**. It is the last enclosed level and must preserve vertical/core/service continuity to **Level 7 — Roof / Mobility Portal**.

Current generated Floor 6 chassis-plan assets:
- `docs/design/equity-uprise-building/references/floor-06/equity-uprise-floor-06-penthouse-command-core-v2-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-06/equity-uprise-floor-06-penthouse-command-core-v2-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-06/equity-uprise-floor-06-penthouse-command-core-v2-schematic-v1.png`

The raster preview is derivative and cannot override the DXF/SVG/written geometry.

### Floor 6 Halo Globe rule

Floor 6 may contain exactly one canonical **Halo Globe / Spatial Intelligence** instrument under `HALO-GLOBE-SPATIAL-INTELLIGENCE-SPEC.md`. It is a permissioned viewport into the shared McCluster Seek First / Hitman's Halo plane, not a new backend, room, floor, or tactical-surveillance authority. Public and non-owner modes are read-only. Owner/admin interaction must hand off to the protected spatial console and preserve source entitlements, provider terms, approvals, provenance and audit boundaries.

## Level 7 Core V2 roof chassis and ecosystem-routing constraints — program provisional

Level 7 preserves the inherited 72' × 72' roof datum and is the canonical **ecosystem plane**.

Current chassis/coordination conditions:
- roof plate: **72' × 72'**;
- grid: **18' × 18'**;
- elevator shaft: **X 54–62 / Y 34–44**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 8–18 / Y 54–72**;
- MEP/roof services: approximately **X 50–60 / Y 66–72**;
- conceptual roof-access/core envelope: **X 50–64 / Y 30–48**;
- ecosystem routing beacon: **X 46–50 / Y 24–30**;
- candidate mobility-zone reservation: **X 10–48 / Y 8–46**;
- city-overlook band: **X 12–46 / Y 0–6**;
- rooftop service/equipment band: approximately **X 34–60 / Y 60–72**, excluding shared core/MEP zones;
- roof camera datum: approximately **(36,28), 5'-4" above roof walking surface**.

Canonical Level 7 assets:
- `docs/design/equity-uprise-building/references/floor-07/equity-uprise-level-07-roof-mobility-portal-core-v2-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-07/equity-uprise-level-07-roof-mobility-portal-core-v2-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-07/equity-uprise-level-07-roof-mobility-portal-core-v2-schematic-v1.png`

The roof is **portal infrastructure**. Ecosystem destinations are dynamic routing data. Do not bake the website ecosystem into the roof geometry.

The candidate mobility zone is **not** an approved helipad/vertiport. Final operational aviation geometry remains pending site/aircraft/regulatory/structural feasibility.

## Current building program and iterative status

The developmental building contains **six enclosed occupied floors plus one navigable roof level**, supported by one restricted non-developmental B1 infrastructure level:

- B1 — **Underground Operations / Technical Service** (restricted support level; no E-Q-U-I-T-Y letter)
- Floor 1 — **Arrival / Orientation / Intake** — reconciled current iterative pass
- Floor 2 — Public Forum — working identity / pre-iterative rewrite
- Floor 3 — Fellowship + Network — working identity / pre-iterative rewrite
- Floor 4 — Media + Culture — working identity / pre-iterative rewrite
- Floor 5 — Policy + Proof — working identity / pre-iterative rewrite
- Floor 6 — Penthouse Command — working identity / pre-iterative rewrite
- Level 7 — **Roof / Mobility Portal** — working identity / pre-iterative rewrite

Level 7 is the roof, not a normal enclosed floor. It is the canonical cross-site departure/arrival layer and may contain a **candidate rooftop mobility pad / helipad zone** subject to later real-world feasibility.

Do not add further developmental levels without explicit owner approval. B1 is an approved restricted support level. Future tunnel-connected buildings are separate canonical facilities, not additional Equity Uprise developmental floors.

Floor 1 program identity is reconciled for the current pass. Floors 2–7 retain working identities only until their own iterative activity/space reconciliations. The final E-Q-U-I-T-Y acronym words remain intentionally deferred and may rename those working identities without changing the approved physical level count or shared vertical chassis.

## Core V2 shared vertical systems

- passenger elevator: **X 54–62 / Y 34–44**;
- west service core: **X 0–18 / Y 54–72**;
- service/freight elevator: **X 0–8 / Y 60–72**;
- revised Stair B: **X 8–18 / Y 54–72**;
- Stair A: **X 60–72 / Y 54–72**;
- east MEP/riser: approximately **X 50–60 / Y 66–72**;
- finished-floor elevations: **B1 -13.5, Floor 1 0, Floor 2 13.5, Floor 3 27, Floor 4 40.5, Floor 5 54, Floor 6 67.5, Level 7 81 ft**;
- per-floor stair placeholders may not redefine or shorten shared vertical geometry;
- the combined stacked building model is the required proof of vertical continuity.

## Building-wide continuity rules

- Floor 1 is the only **ground-level public entrance** to the building.
- Floors 2–6 do not get exterior doors merely because a generated image wants one.
- Floors 2–6 have no balconies/terraces unless the shell is formally revised.
- Level 7 is intentionally an **open-air roof destination**, reached from the building's vertical circulation. It is not a second ground entrance.
- Floor 6 must preserve vertical access/core/service continuity to Level 7.
- Elevator, stairs, structural coordination grid and service risers are vertical systems; they do not move from floor to floor.
- Upper floors must be designed as levels of the same building, not unrelated rooms.
- Empty space is valid. Do not fill the building with props to make an image look impressive.
- Equity Uprise uses the approved Equity Uprise identity. Do not substitute HM graphics.
- Supplied logos are exact artwork; never redraw, crop, reinterpret or approximate them.

## Image-generation rule

Before generating an Equity Uprise building image:

1. identify the floor;
2. read the floor spec;
3. inspect its canonical plan assets;
4. state/verify the fixed core and cardinal orientation;
5. preserve all current shared/chassis geometry;
6. generate only after those checks pass.

If a requested floor/level does not yet have a canonical written builder/360 spec, **stop the image-generation workflow and write/review the description first**. For Floor 6 roof-interface or Level 7 work, read the Level 7 canonical spec, schematic basis, and ecosystem-routing contract; the pre-program is historical context only.

## Lore / worldbuilding rule

Spatial lore must emerge from actual Equity Uprise functions documented in the repo.

Allowed:
- naming a circulation space consistently;
- describing how a visitor experiences a current room/program state;
- non-structural atmosphere/material details;
- narrative transitions that respect actual floor purpose.

Not allowed without owner approval:
- inventing new departments;
- inventing extra developmental floors/levels beyond the six EQUITY floors + Level 7 roof; B1 is the explicitly approved non-developmental support level;
- moving functions to different floors;
- inventing a second public entrance;
- inventing additional restricted underground rooms, tunnel branches, or destination buildings without canonical authority;
- altering core geometry for narrative convenience.

## Relationship to Uprise World

`docs/uprise-world/` is a separate visual/interactive project with its own reference authority.

Do not merge its Living Sketch geometry, protagonist rules, Proof Room visual experiment or world architecture into the six-floor Equity Uprise building unless the owner explicitly requests a crossover.

Likewise, the six-floor building does not supersede Uprise World.

## Future-level rule

Each floor/roof level must receive, in order:

1. written builder/program spec;
2. owner review;
3. schematic-plan basis coordinated to the building core;
4. vector/CAD plan assets;
5. 360/image-generation spec;
6. generated imagery;
7. audit against the written/plan authority.

No later generated image can retroactively redefine the shared Core V2 chassis or a reconciled floor authority.
