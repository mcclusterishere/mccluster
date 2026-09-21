# Equity Uprise — Canonical Reference Authority

> **MANDATORY READ BEFORE EQUITY UPRISE VISUAL / SPATIAL WORK**
>
> Any agent, model, designer, renderer, developer, image generator, 3D tool, CAD workflow, or lore/worldbuilding task that touches Equity Uprise architecture, rooms, floors, geometry, 360 environments, building imagery, spatial navigation, physical-world continuity, or architectural narrative **must read and obey this file and the references below before producing work**.

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

Read in this order:

1. `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`
   - Defines what Equity Uprise actually contains.
   - Prevents invented generic rooms that do not correspond to the program.

2. `docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md`
   - Defines the locked six occupied-floor program plus Level 7 roof, vertical narrative, continuity rules and one-level-at-a-time design process.

2A. Level 7 roof / ecosystem authority:
   - `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-360-SPEC.md`
   - `docs/design/equity-uprise-building/FLOOR-07-SCHEMATIC-PLAN-BASIS.md`
   - `docs/design/equity-uprise-building/FLOOR-07-ECOSYSTEM-ROUTING-CONTRACT.md`
   - `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-PREPROGRAM.md` is retained as origin/context only.
   - Mandatory before Floor 6 roof-interface, roof, exterior-master, rooftop 3D, cross-site mobility, destination-building, helicopter/VTOL transition, or ecosystem-navigation work.

3. The floor-specific written specification.
   - Floor 1: `docs/design/equity-uprise-building/FLOOR-01-LOBBY-INTAKE-360-SPEC.md`
   - Floor 2: `docs/design/equity-uprise-building/FLOOR-02-PUBLIC-FORUM-360-SPEC.md`
   - Floor 3: `docs/design/equity-uprise-building/FLOOR-03-FELLOWSHIP-NETWORK-360-SPEC.md`
   - Floor 4: `docs/design/equity-uprise-building/FLOOR-04-MEDIA-CULTURE-360-SPEC.md`
   - Floor 5: `docs/design/equity-uprise-building/FLOOR-05-POLICY-PROOF-360-SPEC.md`
   - Floor 6: `docs/design/equity-uprise-building/FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md`
   - Level 7: `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-360-SPEC.md`
   - Floor 6: `docs/design/equity-uprise-building/FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md`

4. The floor-specific schematic-plan basis.
   - Floor 1: `docs/design/equity-uprise-building/FLOOR-01-SCHEMATIC-PLAN-BASIS.md`
   - Floor 2: `docs/design/equity-uprise-building/FLOOR-02-SCHEMATIC-PLAN-BASIS.md`
   - Floor 3: `docs/design/equity-uprise-building/FLOOR-03-SCHEMATIC-PLAN-BASIS.md`
   - Floor 4: `docs/design/equity-uprise-building/FLOOR-04-SCHEMATIC-PLAN-BASIS.md`
   - Floor 5: `docs/design/equity-uprise-building/FLOOR-05-SCHEMATIC-PLAN-BASIS.md`
   - Floor 6: `docs/design/equity-uprise-building/FLOOR-06-SCHEMATIC-PLAN-BASIS.md`
   - Level 7: `docs/design/equity-uprise-building/FLOOR-07-SCHEMATIC-PLAN-BASIS.md`
   - Floor 6: `docs/design/equity-uprise-building/FLOOR-06-SCHEMATIC-PLAN-BASIS.md`

5. The canonical floor-plan assets.
   - Floor 1: `docs/design/equity-uprise-building/references/floor-01/`
   - Floor 2: `docs/design/equity-uprise-building/references/floor-02/`
   - Floor 3: `docs/design/equity-uprise-building/references/floor-03/`
   - Floor 4: `docs/design/equity-uprise-building/references/floor-04/`
   - Floor 5: `docs/design/equity-uprise-building/references/floor-05/`
   - Floor 6: `docs/design/equity-uprise-building/references/floor-06/`
   - Level 7: `docs/design/equity-uprise-building/references/floor-07/`
   - Floor 6: `docs/design/equity-uprise-building/references/floor-06/`

For geometry, prefer DXF → SVG → raster preview → later renders.

## Which source controls what

### Program / lore / room identity

Authority:
1. repo audit;
2. building inventory;
3. floor written spec.

Do not invent a room, department, floor function or public-facing feature merely because it looks cinematic.

### Geometry / dimensions / vertical continuity

Authority:
1. floor schematic-plan basis;
2. DXF;
3. SVG;
4. PNG preview;
5. later renders.

A generated image is **never** geometric authority.

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

## Floor 1 locked geometry

Floor 1 currently establishes the building datum:

- floor plate: **72'-0" × 72'-0" = 5,184 GSF**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 0–12 / Y 54–72**;
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**;
- 360 camera datum: approximately **(36, 28), 5'-4" AFF**;
- 0° north: reception / feature wall;
- +90° east: elevator/core;
- 180° south: entrance/vestibule on Floor 1 only;
- -90° west: lounge/intake.

Floors 2–6 and Level 7 roof access must stack on this shell/core logic unless the owner explicitly approves a formal building-wide revision.

## Floor 2 locked geometry

Floor 2 preserves the Floor 1 building datum:

- floor plate: **72'-0" × 72'-0" = 5,184 GSF**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 0–12 / Y 54–72**;
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**;
- forum table: approximately **12 ft diameter**, centered near **(36,39)**;
- member check-in: adjacent to elevator, approximately **X 49–51 / Y 24–29**;
- conversation/lounge zone: **X 2–18 / Y 14–30**;
- feature wall: approximately **X 24–48 / Y 50–54**;
- 360 camera datum: approximately **(36,28), 5'-4" AFF**;
- 0° north: forum table / feature wall;
- +90° east: elevator + member check-in;
- 180° south: sealed upper-floor glazing — **no exterior door**;
- -90° west: conversation/listening lounge.

Floor 2 has **no exterior public entrance, balcony, or terrace**.

Canonical Floor 2 assets:
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.png`

## Floor 3 locked geometry

Floor 3 preserves the same building datum:

- floor plate: **72'-0" × 72'-0" = 5,184 GSF**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 0–12 / Y 54–72**;
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**;
- Opportunity Exchange table: **16' × 4'**, centered near **(36,41)**;
- People + Network lounge: **X 2–18 / Y 18–34**;
- Interview Room A: **X 2–14 / Y 4–16**;
- Interview Room B: **X 16–28 / Y 4–16**;
- member/interview check-in: approximately **X 49–51 / Y 24–29**;
- 360 camera datum: approximately **(36,28), 5'-4" AFF**;
- 0° north: Opportunity Exchange / Fellowship + Network wall;
- +90° east: elevator + member/interview check-in;
- 180° south: interview rooms + sealed upper-floor glazing;
- -90° west: People + Network lounge.

Floor 3 has **no exterior public entrance, balcony, or terrace**.

Canonical Floor 3 assets:
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-schematic-v1.png`

## Floor 4 locked geometry

Floor 4 preserves the same building datum:

- floor plate: **72'-0" × 72'-0" = 5,184 GSF**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 0–12 / Y 54–72**;
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**;
- Media / Listening planning zone: approximately **X 24–48 / Y 28–50**;
- Culture Archive / Rally Gallery: approximately **X 2–18 / Y 18–38**;
- Creator Recording Room: **X 2–15 / Y 4–16**;
- Edit / Review Suite: **X 17–31 / Y 4–16**;
- media-control terminal: approximately **X 49–51 / Y 24–29**;
- media/identity wall: approximately **X 22–50 / Y 50–54**;
- 360 camera datum: approximately **(36,28), 5'-4" AFF**;
- 0° north: Media + Culture wall / listening-screening room;
- +90° east: elevator + media control;
- 180° south: recording/edit rooms + sealed upper-floor glazing;
- -90° west: Culture Archive / Rally Gallery.

Floor 4 has **no exterior public entrance, balcony, or terrace**.

Canonical Floor 4 assets:
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-schematic-v1.png`

The raster preview is derivative and cannot override the DXF/SVG/written geometry.

## Floor 5 locked geometry

Floor 5 preserves the same building datum:

- floor plate: **72'-0" × 72'-0" = 5,184 GSF**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 0–12 / Y 54–72**;
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**;
- Policy Lab table: **16' × 5'**, centered near **(36,41)**;
- Evidence + Proof Archive: **X 2–18 / Y 18–40**;
- Source Review Room: **X 2–15 / Y 4–16**;
- Publication / Submission Review Room: **X 17–32 / Y 4–16**;
- research-navigation terminal: approximately **X 49–51 / Y 24–29**;
- Policy + Proof wall: approximately **X 22–50 / Y 50–54**;
- 360 camera datum: approximately **(36,28), 5'-4" AFF**;
- 0° north: Policy Lab / Policy + Proof wall;
- +90° east: elevator + research navigation;
- 180° south: review rooms + sealed upper-floor glazing;
- -90° west: Evidence + Proof Archive.

Floor 5 has **no exterior public entrance, balcony, or terrace**.

Canonical Floor 5 assets:
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-schematic-v1.png`

The raster preview is derivative and cannot override the DXF/SVG/written geometry.

## Floor 6 locked geometry

Floor 6 preserves the building datum and the Level 7 roof interface:

- floor plate: **72'-0" × 72'-0" = 5,184 GSF**;
- grid: **18' × 18' coordination module**;
- elevator hoistway: **X 54–62 / Y 34–44**;
- Stair A: **X 60–72 / Y 54–72**, with upward continuity reserved;
- Stair B: **X 0–12 / Y 54–72**, with vertical continuity reserved;
- MEP / roof-service reservation: **X 50–60 / Y 66–72**;
- Penthouse Command table: **16' × 5'**, centered near **(36,41)**, six seats maximum;
- Institutional Salon / Join Lounge: **X 2–18 / Y 18–38**;
- Strategy Review Room: **X 2–15 / Y 4–16**;
- Partner / Executive Briefing Room: **X 17–32 / Y 4–16**;
- Roof Access / Mobility Transition terminal: **X 49–51 / Y 24–29**;
- Penthouse Command wall: **X 22–50 / Y 50–54**, with **NOW / PAST WORK / JOIN**;
- 360 camera datum: approximately **(36,28), 5'-4" AFF**;
- 0° north: Penthouse Command / NOW-PAST WORK-JOIN;
- +90° east: elevator + Level 7 roof transition;
- 180° south: Strategy/Partner rooms + sealed glazing;
- -90° west: Institutional Salon.

Floor 6 has **no exterior public entrance, balcony, or terrace**. It is the last enclosed level and must preserve vertical/core/service continuity to **Level 7 — Roof / Mobility Portal**.

Canonical Floor 6 assets:
- `docs/design/equity-uprise-building/references/floor-06/equity-uprise-floor-06-penthouse-command-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-06/equity-uprise-floor-06-penthouse-command-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-06/equity-uprise-floor-06-penthouse-command-schematic-v1.png`

The raster preview is derivative and cannot override the DXF/SVG/written geometry.

## Level 7 locked geometry and ecosystem semantics

Level 7 preserves the inherited 72' × 72' roof datum and is the canonical **ecosystem plane**.

Locked schematic conditions:
- roof plate: **72' × 72'**;
- grid: **18' × 18'**;
- elevator shaft: **X 54–62 / Y 34–44**;
- Stair A: **X 60–72 / Y 54–72**;
- Stair B: **X 0–12 / Y 54–72**;
- MEP/roof services: approximately **X 50–60 / Y 66–72**;
- conceptual roof-access/core envelope: **X 50–64 / Y 30–48**;
- ecosystem routing beacon: **X 46–50 / Y 24–30**;
- candidate mobility-zone reservation: **X 10–48 / Y 8–46**;
- city-overlook band: **X 12–46 / Y 0–6**;
- rooftop service/equipment band: **X 28–60 / Y 60–72**;
- roof camera datum: approximately **(36,28), 5'-4" above roof walking surface**.

Canonical Level 7 assets:
- `docs/design/equity-uprise-building/references/floor-07/equity-uprise-level-07-roof-mobility-portal-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-07/equity-uprise-level-07-roof-mobility-portal-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-07/equity-uprise-level-07-roof-mobility-portal-schematic-v1.png`

The roof is **portal infrastructure**. Ecosystem destinations are dynamic routing data. Do not bake the website ecosystem into the roof geometry.

The candidate mobility zone is **not** an approved helipad/vertiport. Final operational aviation geometry remains pending site/aircraft/regulatory/structural feasibility.

## Locked building program

The building contains **six enclosed occupied floors plus one navigable roof level**:

- Floor 1 — Lobby + Intake
- Floor 2 — Public Forum
- Floor 3 — Fellowship + Network
- Floor 4 — Media + Culture
- Floor 5 — Policy + Proof
- Floor 6 — Penthouse Command
- Level 7 — **Roof / Mobility Portal**

Level 7 is the roof, not a normal enclosed floor. It is the canonical cross-site departure/arrival layer and may contain a **candidate rooftop mobility pad / helipad zone** subject to later real-world feasibility.

Do not add further levels or rename/reassign them without explicit owner approval.

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
5. preserve all locked geometry;
6. generate only after those checks pass.

If a requested floor/level does not yet have a canonical written builder/360 spec, **stop the image-generation workflow and write/review the description first**. For Floor 6 roof-interface or Level 7 work, read the Level 7 canonical spec, schematic basis, and ecosystem-routing contract; the pre-program is historical context only.

## Lore / worldbuilding rule

Spatial lore must emerge from actual Equity Uprise functions documented in the repo.

Allowed:
- naming a circulation space consistently;
- describing how a visitor experiences a locked room;
- non-structural atmosphere/material details;
- narrative transitions that respect actual floor purpose.

Not allowed without owner approval:
- inventing new departments;
- inventing extra floors/levels beyond the six occupied floors + Level 7 roof;
- moving functions to different floors;
- inventing a second public entrance;
- inventing secret rooms as canonical;
- altering core geometry for narrative convenience.

## Relationship to Uprise World

`docs/uprise-world/` is a separate visual/interactive project with its own reference authority.

Do not merge its Living Sketch geometry, protagonist rules, Proof Room visual experiment or world architecture into the six-floor Equity Uprise building unless the owner explicitly requests a crossover.

Likewise, the six-floor building does not supersede Uprise World.

## Future-level rule

Each floor/roof level must receive, in order:

1. written builder/program spec;
2. owner review;
3. schematic-plan basis locked to the building core;
4. vector/CAD plan assets;
5. 360/image-generation spec;
6. generated imagery;
7. audit against the written/plan authority.

No later generated image can retroactively redefine an earlier locked floor.
