# Equity Uprise Floor 1 — V1 → Core V2 Merge Map

> Status: **ACTIVE DESIGN MERGE DIRECTIVE**
>
> Product rule: **the deliverable is a real 3D environment.** Plans, JSON, authority documents, inventories, and validation reports are inputs to the environment; they are not the finished experience.

## 1. Merge strategy

The target is **V1 design language + Core V2 technical truth + current Equity Uprise program research**.

Do not redesign Floor 1 from scratch when a successful V1 design element can be retained and corrected.

Use the first Floor 1 implementation as the visual/interior-design reference. Use Core V2 as the geometry, stacking, circulation, shared-core, authority, program, and validation reference.

The completed stacked building remains the reference for how individually finished floors become one whole building. Floor-local design must never break the shared vertical stack.

---

## 1A. Historical reference set — all three are mandatory

Do **not** reduce the project to a single historical reference. The rebuild depends on three different reference classes.

### A. V1 Floor 1 — interior design reference

Use the pre-Core-V2 Floor 1 implementation as the reference for:
- interior atmosphere;
- material contrast;
- lighting;
- furniture composition;
- entrance/lobby experience;
- reception/feature-wall treatment;
- camera framing;
- human-scale architectural feel.

Key historical implementation points include:
- `docs/design/equity-uprise-building/production/floor-01/build_equity_uprise_floor_01.py`;
- the original interactive Floor 1 viewer history, including commit `752c70444e12f44abdeacdd19697f7db88937d44`;
- the V1 Floor 1 deterministic GLB pipeline introduced around commit `59af7f6386ee69edc023927971ea5918fffa6acc`.

This is a **design-language reference**, not current geometry authority.

### B. Fully assembled building — stacking / whole-building reference

Use the completed stacked Core V2 building as the reference for how independently designed floors become one building.

Historical whole-building reference:
- combined-building generator: `docs/design/equity-uprise-building/production/build_equity_uprise_building_v2.py`;
- initial generator commit: `c674e07daf772ea739d93cc515657deb028e8b75`;
- assembled GLB build commit: `ef3fd47d543318fd3ed129fa3f58fc7fab5fabce`;
- stacked interactive viewer commit: `7ea458406cc862656b5952a350fe87bcdc16110b`;
- generated artifact: `production/generated/equity-uprise-building-core-v2.glb`.

That assembled reference demonstrated:
- one coherent 72' × 72' stack;
- finished-floor elevations at 0 / 13.5 / 27 / 40.5 / 54 / 67.5 / 81 ft;
- continuous passenger core;
- continuous service/freight core;
- continuous Stair A and Stair B;
- 12 full floor-to-floor stair transitions;
- coordinated slab openings;
- roof integration;
- whole-building / cutaway / core-only / per-floor viewing;
- 667 meshes in the historical assembled GLB;
- 27/27 vertical-continuity checks passing.

This assembled version is **not the final interior-design target**, but it is a primary reference for:
- stacking;
- world coordinates;
- vertical alignment;
- floor elevations;
- how complete floor scenes must be assembled;
- whole-building cutaway/navigation behavior.

Later Core V2 work extended this assembly downward to B1 and added more current program/site research. The final building must preserve the successful whole-building assembly behavior while using the latest authority.

### C. Current Core V2 research / authority — truth reference

Use current canonical authority for:
- corrected shared geometry;
- B1;
- service/freight elevator;
- revised Stair B;
- site/egress;
- current floor programs;
- capability mapping;
- public/private boundaries;
- furniture/object inventory;
- current Equity Uprise research.

### Combined target

The target is therefore not merely "V1 + V2."

It is:

**V1 interior design quality**
+
**fully assembled building stacking behavior**
+
**current Core V2 geometry/program/research**
=
**next-generation complete Equity Uprise 3D building**

The process must preserve all three reference classes.

---

## 2. KEEP FROM V1 — design DNA

These qualities were successful and should survive unless they directly conflict with Core V2 authority.

### Overall character
- sleek corporate / minimalist architectural language;
- dark, restrained, premium palette;
- strong sense of an actual interior place rather than a diagram;
- realistic room composition and visual hierarchy;
- deliberately framed views rather than only top-down inspection.

### Materials
Preserve the V1 palette as the default Floor 1 aesthetic:
- honed/polished medium gray floor;
- charcoal mineral walls;
- dark stone reception / feature surfaces;
- brushed gunmetal frames and core trim;
- clear architectural glass;
- warm muted wood accents;
- charcoal upholstery;
- restrained Equity Uprise red used for navigation/state, not full-room wash.

### Lighting / atmosphere
- warm-white practical lighting;
- stronger reception/task lighting;
- softer lounge lighting;
- natural/neutral daylight contribution;
- depth/fog/contrast sufficient to make the space read as architecture;
- lighting should make materials and furniture legible rather than flattening the scene.

### Entrance sequence
Keep the successful V1 entrance composition:
- south public entrance;
- glazed vestibule;
- dark metal/gunmetal framing;
- clear visual pull into the lobby;
- entry should feel like entering a headquarters, not stepping onto a plan.

### Reception / feature wall
Preserve:
- centered reception as the primary visual anchor;
- substantial dark reception desk;
- accessible lowered counter;
- feature wall behind reception;
- strong Equity Uprise signage / identity;
- restrained red reveal/navigation accent;
- warm focused lighting.

Core V2 renames/expands this experience into **Reception / Concierge / Security + Journey Wall**, but the successful V1 spatial composition should remain the design base.

### Lounge
Preserve the V1 left-side lounge character:
- charcoal sofa;
- lounge chairs;
- low round table;
- rug;
- warm wood;
- plant/greenery;
- softer lighting;
- clear view back toward arrival/reception.

Core V2 calls this **Orientation Lounge**. The name/program changes; the successful design language does not need to.

### Intake / consultation
Preserve:
- private/semi-private room;
- framed glass;
- meeting table;
- multiple chairs;
- acoustic/privacy feel;
- professional consultation-room character.

Core V2 expands this to **Intake / Verification Consultation**.

### Directory / elevator side
Preserve the right-side circulation identity:
- visible building directory / terminal;
- clear relationship to passenger elevator;
- strong visual cue that this is how users progress upward;
- dark core finishes contrasted against public-space finishes.

### Viewer / presentation
Preserve the first viewer's experience features:
- orbit/zoom interaction;
- named views such as Lobby, Reception, Elevator, Lounge, Intake;
- removable ceiling / cutaway inspection;
- useful isometric and human-perspective camera positions;
- real material shading and depth;
- Floor 1 presented as a 3D environment first.

---

## 3. REPLACE WITH CORE V2 — technical corrections

The following V1 geometry is historical and must not be restored.

### Shared shell / datum
Use:
- 72' × 72' canonical plate;
- Floor 1 FFE = 0';
- Floor 2 = +13.5';
- Floor 3 = +27';
- Floor 4 = +40.5';
- Floor 5 = +54';
- Floor 6 = +67.5';
- Level 7 roof = +81';
- B1 = -13.5'.

### Passenger elevator
Use Core V2:
- X54–62 / Y34–44;
- west-facing public door;
- continuous served stack;
- B1 physical stop exists but is not exposed as ordinary public navigation.

### West service/freight elevator
V1 did not correctly reserve this system.

Use Core V2:
- X0–8 / Y60–72;
- south-facing service/freight access;
- continuous B1 through Floor 6 reservation;
- restricted operational use.

### Stair B
Replace old V1 west stair assumption.

Use Core V2:
- X8–18 / Y54–72;
- actual protected stair geometry;
- continuous B1 through Level 7;
- actual flights, intermediate landing, upper/lower landings;
- Floor 1 downward B1 access controlled while B1→Floor 1 egress remains preserved.

### Stair A
Use Core V2:
- X60–72 / Y54–72;
- continuous B1 through Level 7;
- actual dogleg/U-shaped stair geometry;
- correct slab opening and landing relationships.

### MEP / riser
Use Core V2 reservation:
- X50–60 / Y66–72.

### Floor 1 as level of exit discharge
The hybrid scene must show correct Floor 1 discharge logic:
- public exit to exterior;
- Stair A discharge;
- Stair B discharge;
- secure service path;
- visual/access controls preventing normal users from unintentionally continuing down to B1.

### Whole-building stacking
No floor-local aesthetic decision may shift:
- elevator shafts;
- freight shaft;
- stairs;
- slab openings;
- MEP riser;
- floor elevation;
- exterior plate.

The finished-building stack is the integration test.

---

## 4. ADD FROM CURRENT RESEARCH — new program content

The hybrid Floor 1 must contain the newer Equity Uprise program without losing the V1 feel.

### Canonical Floor 1 identity
**Arrival / Orientation / Intake**

### Required experience zones
- Entry Vestibule
- Arrival Atrium
- Orientation Lounge
- Intake / Verification Consultation
- Development Passport Studio
- Journey Wall
- Reception / Concierge / Security Desk
- Next Action / Building Directory
- Public / Support Corridor
- restrooms and support spaces
- building operations / life-safety support
- IT / electrical
- janitor/service support

### Program concepts that must become physical/environmental objects
The new research should not live only in JSON. It must manifest visually in the environment.

#### Development Passport Studio
Provide a real furniture/equipment composition for:
- passport/profile workstations;
- guided onboarding;
- progress review;
- verification/application preparation;
- staff/user interaction;
- screen/kiosk surfaces.

#### Journey Wall
Convert the older reception feature-wall language into a richer progression element supporting:
- NEXT;
- WHY;
- DO;
- PROOF;
- UNLOCKS;
- Enter → Participate → Connect → Build → Prove progression;
- Learn → Practice → Produce → Verify logic where appropriate.

The wall should still read as premium architecture, not a dashboard pasted onto a wall.

#### Next Action / Building Directory
Make it an actual modeled terminal / wayfinding object that routes users through the building.

#### Reception / Concierge / Security
Retain V1's centered desk composition while expanding its program role to:
- welcome;
- concierge;
- first routing;
- intake handoff;
- security/verification coordination.

#### Public/private boundaries
The 3D environment must visibly communicate:
- public arrival;
- private consultation;
- staff/service;
- secure core;
- restricted B1 operations.

---

## 5. FURNITURE + OBJECT INVENTORY STANDARD

Floor 1 is not considered visually finished until every intentional object belongs to an inventory.

Each item should have:
- stable ID;
- display name;
- category;
- floor;
- zone;
- quantity;
- approximate dimensions;
- position/orientation or placement rule;
- material/style;
- functional purpose;
- route/capability association where applicable;
- authority status: canonical / production-default / decorative.

### Floor 1 inventory seed

#### Entry / Arrival
- glazed entrance door leaves;
- vestibule glazing;
- gunmetal framing;
- entrance mat / logo mat;
- arrival signage;
- directional marker / red navigation cue.

#### Orientation Lounge
- 1 sofa;
- 2+ lounge chairs;
- round low table;
- area rug;
- planter / greenery;
- side/accent surfaces as needed;
- orientation screen/signage if program calls for it.

#### Intake / Verification
- consultation table;
- 4–6 meeting chairs;
- privacy-treated glass;
- display/work surface;
- storage/credence where useful.

#### Development Passport Studio
- worktables;
- task chairs;
- digital kiosks/screens;
- staff consultation point;
- document/verification surface;
- optional storage/printing equipment as program requires.

#### Reception / Concierge / Security
- main reception desk;
- accessible counter;
- workstation/monitor;
- security/concierge equipment;
- feature/Journey Wall;
- exact Equity Uprise brand/signage treatment.

#### Directory
- interactive building directory terminal;
- wayfinding content surface;
- progression/next-action interface.

#### Building/support
- passenger elevator doors/call station;
- service/freight elevator doors/control point;
- stair doors/railings/landings;
- B1 access-control barriers/signage;
- restroom fixtures;
- janitor/service equipment;
- life-safety equipment;
- IT/electrical/support-room fixtures where visually necessary.

Decorative objects must not silently become canonical program objects.

---

## 6. HYBRID FLOOR 1 TARGET

The next approved Floor 1 should feel like the original V1 corporate lobby at first glance, but withstand Core V2 inspection underneath.

A user entering from the south should experience:

1. **Glazed headquarters entrance**
2. **Arrival Atrium** with clear visual depth
3. **V1-style Orientation Lounge** to the left
4. **Centered Reception / Concierge / Security** as the room's anchor
5. **Journey Wall** integrated into the premium reception architecture
6. **Intake / Verification** as a real private consultation room
7. **Development Passport Studio** as a furnished active workspace
8. **Next Action / Directory** near vertical circulation
9. **Passenger elevator** in the correct V2 location
10. clear but non-public service/freight presence
11. both protected stairs physically real and aligned with the building stack
12. no accidental public B1 route
13. support spaces that make the floor feel operational rather than staged.

### Visual target
The floor should look:
- premium;
- contemporary;
- grounded;
- dark but not gloomy;
- warm where people gather;
- clearly branded;
- more detailed than V1;
- less schematic than the current technical scaffold.

---

## 7. BUILD PIPELINE — mandatory progression

This is the building process to preserve.

### A. Authority
written program/spec → shared Core V2 geometry → floor program → capability mapping

### B. Inventory
room/zone schedule → furniture/equipment/object inventory → placement data

### C. Floor 3D
deterministic floor generator → volumetric GLB → interactive viewer → visual QA

### D. Floor verification
verify:
- canonical plate;
- vertical-core alignment;
- stair/elevator geometry;
- required rooms/zones;
- required inventory objects;
- public/private boundaries;
- floor visual completeness.

### E. Stack
finished floor GLBs / scene definitions → common world coordinates → whole-building stack

### F. Whole-building verification
verify:
- floor elevations;
- shaft continuity;
- stair continuity;
- slab openings;
- roof/B1 relationships;
- no inter-floor geometry collisions;
- visual continuity;
- furniture/object containment;
- route continuity.

### G. Final experience
One complete interactive 3D Equity Uprise building, with:
- finished floors;
- whole-building exterior/massing;
- navigable vertical stack;
- floor selector;
- interior navigation;
- program-aware hotspots;
- real inventory-backed environments.

---

## 8. What is NOT the target

Do not mistake any of these for the finished building:
- PNG floor plan;
- SVG floor plan;
- DXF;
- colored program plates;
- flat Canvas floor viewer;
- debug-only bounding boxes;
- empty stacked slabs;
- GLB that proves continuity but lacks designed interiors.

Those are verification/reference outputs.

The product is the **real 3D environment and eventually the complete stacked 3D building**.

---

## 9. Immediate Floor 1 implementation order

1. Use the V1 Floor 1 renderer/generator as the aesthetic implementation reference.
2. Use the current Core V2 manifest/shared-core data as geometry authority.
3. Build/commit the Floor 1 object inventory.
4. Restore V1-quality materials, lighting, camera framing, greenery, glass and furniture composition.
5. Integrate Development Passport Studio + Journey Wall + new routing objects into that design language.
6. Replace V1 Stair B / support geometry with corrected Core V2 west freight + Stair B layout.
7. Preserve real stair flights and stack-ready openings.
8. Export standalone Floor 1 GLB.
9. Review visually.
10. Only after Floor 1 approval, apply the same pipeline to Floor 2.

---

## 10. Definition of done for Floor 1

Floor 1 is done only when all are true:
- looks and feels at least as intentional as the liked V1 design;
- obeys Core V2 geometry;
- contains the current program;
- has an explicit inventory/furniture schedule;
- every important inventory item is represented in 3D or intentionally deferred;
- stairs/elevators align with the final building stack;
- has a true interactive 3D viewer;
- can be inserted into the complete building without geometry rewrites;
- passes deterministic geometry and inventory validation;
- user visual review approves the environment.

