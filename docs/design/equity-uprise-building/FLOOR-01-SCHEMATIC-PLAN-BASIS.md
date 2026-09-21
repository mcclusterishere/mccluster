# Equity Uprise Building — Floor 01 Schematic Plan Basis

> Status: **LOCKED SCHEMATIC GEOMETRY FOR FLOOR-PLAN / 360 COORDINATION**  
> Companion to: `FLOOR-01-LOBBY-INTAKE-360-SPEC.md`  
> This file fixes the conceptual plan geometry so future renderers do not redesign the floor.  
> **Not for construction.** Final permit/construction documents require a licensed architect/engineer and site/jurisdiction-specific code, structural, MEP, accessibility, fire/life-safety and zoning review.
> Mandatory authority: `REFERENCE-AUTHORITY.md`
> Canonical plan files: `references/floor-01/equity-uprise-floor-01-core-v2-schematic-v1.{png,svg,dxf}`


> Core V2 branch authority: `BUILDING-CORE-V2-SPEC.md` + `production/building-core-v2.json`.
> Finished-floor elevation in combined model: **0'-0"**.
> Floor-specific program may not move the shared passenger elevator, freight/service shaft, Stair A, Stair B, MEP reservation or shared slab openings.

## 1. Coordinate datum

Use a fixed rectangular conceptual floor plate:

- Exterior footprint: **72'-0" east-west × 72'-0" north-south**
- Gross conceptual area: **5,184 sq ft**
- North is up.
- Southwest exterior corner = **(0,0)**.
- X increases east.
- Y increases north.
- South facade is the public street/entrance facade.

Structural coordination grid:
- X grid: **0, 18, 36, 54, 72 ft**
- Y grid: **0, 18, 36, 54, 72 ft**

The structural grid is a coordination datum only. Final columns, beams, slabs, foundations and lateral system belong to the structural engineer.

## 2. Fixed vertical-core geometry

Floor 1 inherits the shared Core V2 geometry from `BUILDING-CORE-V2-SPEC.md` and `production/building-core-v2.json`.

Finished-floor elevation:
- **0'-0"**

### Passenger elevator
- shaft: **X 54–62 / Y 34–44**
- west-facing door
- primary public vertical circulation
- floor-specific program may not intrude into the shaft or elevator approach

### West Service Core
Overall reservation:
- **X 0–18 / Y 54–72**

It contains the freight/service elevator and revised Stair B.

### Service / freight elevator
- shaft: **X 0–8 / Y 60–72**
- conceptual south-facing service door into the Y54–60 service/circulation band
- not counted as a substitute for a required exit

### Stair B — west protected stair
- enclosure: **X 8–18 / Y 54–72**
- continuous through Floors 1–6 and Level 7
- full **13'-6"** floor-to-floor rise in combined deterministic geometry
- shared slab opening approximately **X 8.75–17.25 / Y 58.25–71.25**

### Stair A — east protected stair
- enclosure: **X 60–72 / Y 54–72**
- continuous through Floors 1–6 and Level 7
- full **13'-6"** floor-to-floor rise in combined deterministic geometry
- shared slab opening approximately **X 60.75–71.25 / Y 58.25–71.25**

### MEP / risers
- approximately **X 50–60 / Y 66–72**
- vertically continuous reservation

No local floor model may replace these with shortened decorative stairs or cover the shared slab openings.

## 3. South public entrance / vestibule

### Vestibule

- Coordinates: **X 29–43, Y 0–9**
- Approximate inside dimension: **14' × 9'**
- Centered on the south facade / Grid C axis.
- One outer pair and one inner pair of glazed doors.
- Step-free public arrival.

The entrance is the canonical **180°** direction from the 360 camera.

## 4. Reception

### Arrival / Identity Wall

- Coordinates/band: approximately **X 28–44, Y 50–54**
- Contains the exact approved Equity Uprise logo in built work.
- Do not redraw the mark in schematic drawings; label the logo location instead.

### Reception desk

- Approximate footprint: **12' × 3'**
- Coordinates: **X 30–42, Y 44–47**
- One primary work position + one flexible secondary position.
- Include a lowered accessible transaction segment in detailed design.
- Desk faces south toward the entrance.

Reception is the canonical **0° / north-forward** visual anchor.

## 5. West public zone

### Visitor lounge

- Planning zone: **X 2–18, Y 12–28**
- Approximate zone: **16' × 16'**
- 6–8 seats maximum.
- Keep a clear sightline to reception and elevator.

### Intake / verification consultation room

- Planning zone: **X 2–16, Y 32–44**
- Approximate inside size: **14' × 12'**
- 4–6 seats around a meeting table.
- Framed glass on the lobby-facing side with privacy treatment.
- Solid acoustic door.
- No secondary exterior entrance.

The lounge/intake side is the canonical **-90° / west-left** side of the 360 environment.

## 6. North support band

The north band is replanned around the Core V2 west service core.

### West service approach
- **X 0–18 / Y 54–60**
- provides conceptual service approach to the freight lift and Stair B access
- must remain clear of floor-specific furniture/program

### Public/support corridor
- **X 18–60 / Y 54–60**
- target approximately **6 ft clear**

### Accessible restroom A
- **X 18–26 / Y 60–70**
- conceptual 8' × 10'

### Accessible restroom B
- **X 26–34 / Y 60–70**
- conceptual 8' × 10'

### Reception support / storage
- **X 34–42 / Y 60–72**
- conceptual 8' × 12'

### IT / electrical
- **X 42–50 / Y 60–72**
- conceptual 8' × 12'

### Janitor
- **X 50–54 / Y 60–66**

### MEP / risers
- **X 50–60 / Y 66–72**
- shared Core V2 vertical reservation

### Stair / lift protection
- freight/service shaft **X0–8 / Y60–72** remains unobstructed;
- Stair B **X8–18 / Y54–72** remains unobstructed;
- Stair A **X60–72 / Y54–72** remains unobstructed;
- floor-specific support rooms may not intrude into shared slab openings.

## 7. Elevator lobby / arrival-routing directory

### Elevator lobby

Keep approximately **6 ft or more** of clear approach in front of the elevator door.

### Arrival / Routing Directory

- One slim directory/check-in point only.
- Approximate placement: **X 49–51, Y 24–29**
- Must not obstruct entrance-to-elevator circulation.

## 8. Public circulation

### Primary route

**Main entrance → reception → elevator**

- Keep approximately **6 ft clear** where practical.
- No lounge furniture, planters or kiosks in this route.

### Secondary route

**Reception → lounge/intake**

- Keep at least approximately **4 ft clear** in schematic design.

### Accessibility

Maintain conceptual:
- 60 in turning zones at entry/reception/elevator/intake approaches where required;
- accessible reception segment;
- step-free routes;
- accessible restrooms;
- elevator access.

Do not call the plan ADA-compliant until a licensed professional completes code review.

## 9. 360 camera datum

Canonical virtual camera:
- Plan coordinate approximately **(36, 28)**
- Eye height approximately **5'-4" AFF**
- Level horizon

Cardinal directions:
- **0° / north:** reception + feature wall
- **+90° / east:** elevator/core
- **180° / south:** entrance / vestibule
- **-90° / west:** lounge + intake

Future floor panoramas should retain this camera relationship to the vertical core.

## 10. Egress / life-safety concept

The schematic intentionally includes:
- one main public entrance;
- Stair A;
- remote Stair B;
- direct exterior discharge concepts for the protected stairs;
- clear public circulation.

It does **not** establish:
- occupancy classification;
- occupant load;
- required exit count;
- exit separation;
- travel distance;
- common path;
- stair width;
- rated wall/door assemblies;
- smoke control;
- sprinkler demand;
- fire alarm device layout.

Those are final-design/code tasks.

## 11. Drawing authority

For this Core V2 migration branch:

1. `BUILDING-CORE-V2-SPEC.md`
2. `production/building-core-v2.json`
3. floor-specific written 360/spec document
4. this schematic-plan basis
5. regenerated Core V2 DXF
6. regenerated Core V2 SVG
7. regenerated Core V2 PNG preview
8. deterministic production package
9. later 3D/render/360 output

The shared Core V2 files control all vertical systems. Generated imagery is never geometry authority.

## 12. QC requirements for the next floor-plan drawing

The drawing must show:
- [ ] 72' × 72' footprint / 5,184 GSF
- [ ] 18' structural coordination grid
- [ ] both protected stair enclosures
- [ ] fixed elevator hoistway at X 54–62 / Y 34–44
- [ ] entrance vestibule centered south
- [ ] reception + feature wall north of lobby
- [ ] lounge and intake west
- [ ] two accessible restroom rooms in the north band
- [ ] reception support/storage
- [ ] IT/electrical
- [ ] janitor closet
- [ ] MEP/riser reservation
- [ ] one directory
- [ ] public vs secure/service circulation distinction
- [ ] primary 6' and secondary 4' circulation targets
- [ ] 360 camera datum
- [ ] north arrow and coordinate/grid labels
- [ ] explicit NOT FOR CONSTRUCTION note


### Core V2 migration QC addendum
- [ ] service/freight elevator shaft at X 0–8 / Y 60–72
- [ ] revised Stair B at X 8–18 / Y 54–72
- [ ] Stair A at X 60–72 / Y 54–72
- [ ] full 13'-6" stair rise represented in combined geometry
- [ ] shared slab openings remain clear
- [ ] floor elevation matches building-core-v2.json

## Repo capability authority

Program semantics for this floor are controlled by:
- `production/equity-uprise-capability-map-v2.json`
- `production/core-v2-floor-programs.json`
- the companion long-form floor spec.

This schematic basis controls plan geometry; it may not silently rename or delete a repo-backed capability represented by the floor program. Public/private and approval boundaries remain those of the source Equity Uprise system.

