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
   - Defines the locked six-floor program, vertical narrative, continuity rules and one-floor-at-a-time design process.

3. The floor-specific written specification.
   - Floor 1: `docs/design/equity-uprise-building/FLOOR-01-LOBBY-INTAKE-360-SPEC.md`
   - Floor 2: `docs/design/equity-uprise-building/FLOOR-02-PUBLIC-FORUM-360-SPEC.md`

4. The floor-specific schematic-plan basis.
   - Floor 1: `docs/design/equity-uprise-building/FLOOR-01-SCHEMATIC-PLAN-BASIS.md`
   - Floor 2: `docs/design/equity-uprise-building/FLOOR-02-SCHEMATIC-PLAN-BASIS.md`

5. The canonical floor-plan assets.
   - Floor 1: `docs/design/equity-uprise-building/references/floor-01/`
   - Floor 2: `docs/design/equity-uprise-building/references/floor-02/`

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

Floors 2–6 must stack on this shell/core logic unless the owner explicitly approves a formal building-wide revision.

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

## Locked six-floor program

- Floor 1 — Lobby + Intake
- Floor 2 — Public Forum
- Floor 3 — Fellowship + Network
- Floor 4 — Media + Culture
- Floor 5 — Policy + Proof
- Floor 6 — Penthouse Command

Do not add floors or rename/reassign them without explicit owner approval.

## Building-wide continuity rules

- Floor 1 is the only public floor with an exterior entrance.
- Floors 2–6 do not get exterior doors merely because a generated image wants one.
- Floors 2–6 have no balconies/terraces unless the shell is formally revised.
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

If a requested floor does not yet have a canonical written builder/360 spec, **stop the image-generation workflow and write/review the floor description first**.

## Lore / worldbuilding rule

Spatial lore must emerge from actual Equity Uprise functions documented in the repo.

Allowed:
- naming a circulation space consistently;
- describing how a visitor experiences a locked room;
- non-structural atmosphere/material details;
- narrative transitions that respect actual floor purpose.

Not allowed without owner approval:
- inventing new departments;
- inventing extra floors;
- moving functions to different floors;
- inventing a second public entrance;
- inventing secret rooms as canonical;
- altering core geometry for narrative convenience.

## Relationship to Uprise World

`docs/uprise-world/` is a separate visual/interactive project with its own reference authority.

Do not merge its Living Sketch geometry, protagonist rules, Proof Room visual experiment or world architecture into the six-floor Equity Uprise building unless the owner explicitly requests a crossover.

Likewise, the six-floor building does not supersede Uprise World.

## Future-floor rule

Each floor must receive, in order:

1. written builder/program spec;
2. owner review;
3. schematic-plan basis locked to the building core;
4. vector/CAD plan assets;
5. 360/image-generation spec;
6. generated imagery;
7. audit against the written/plan authority.

No later generated image can retroactively redefine an earlier locked floor.
