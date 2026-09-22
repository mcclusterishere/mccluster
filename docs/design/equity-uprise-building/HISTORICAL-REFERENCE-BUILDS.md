# Equity Uprise Building — Historical Reference Builds

Historical does **not** mean disposable. These builds have different jobs in the current process.

## Reference A — V1 Floor 1 interior/design language

### Deterministic GLB generator
Commit: `59af7f6386ee69edc023927971ea5918fffa6acc`

Use it to understand:
- volumetric interior construction;
- walls/glass/furniture rather than plan plates;
- reception feature wall + desk;
- lounge furniture;
- intake furniture;
- elevator enclosure;
- stair visualization;
- material assignment.

### Interactive interior viewer
Commit: `752c70444e12f44abdeacdd19697f7db88937d44`

Use it to understand:
- dark architectural atmosphere;
- warm task/ambient lighting;
- fog/depth;
- dedicated Lobby / Reception / Elevator / Lounge / Intake views;
- removable ceiling / cutaway inspection;
- human-scale 3D presentation.

**Do not copy its obsolete west-core/Stair B geometry.**

## Reference A2 — V1 Floor 2 Public Forum

Interactive deterministic viewer:
- commit `7c7726289781f270da25eef70789b704b63b30bd`.

Preserve from it:
- centered forum orbit/navigation;
- Forum / Feature Wall / Elevator / Listening Lounge / South Glazing views;
- Wireframe / Solid;
- ceiling toggle;
- one-table / eight-seat composition;
- feature wall + three surfaces;
- west listening lounge;
- member check-in beside elevator;
- sealed south glazing;
- dark/gunmetal/wood/charcoal material family.

Do **not** preserve its obsolete west Stair B/service-core geometry.

See `FLOOR-02-V1-V2-PRESERVATION-MAP.md`.

## Reference A3 — historical Floor 3 Fellowship + Network

Historical architecture references:
- canonical Floor 3 program/spec commit `9207174f179ea419396a9827d2d26cb025b859a1`;
- locked Floor 3 schematic geometry commit `54f8579b8ef5bb804fe8a3967199953e910e8d95`.

Preserve:
- Opportunity Exchange;
- 16' × 4' / six-seat shared table;
- Fellowship + Network wall;
- MATCH / PEOPLE / APPLICATIONS hierarchy;
- west People + Network lounge;
- two south interview rooms;
- elevator-side member/interview check-in;
- dark/gunmetal/warm-wood material family.

There was no comparable standalone historical Floor 3 3D viewer in repo history. Do not invent one as precedent.

Do **not** preserve obsolete west Stair B/service-core coordinates.

See `FLOOR-03-V1-V2-PRESERVATION-MAP.md`.

## Reference A4 — historical Floor 4 Media + Culture

Historical architecture references:
- canonical Floor 4 program/spec commit `07cc968e80f7c703cdea739ac38554331cad5a7c`;
- locked Floor 4 schematic geometry commit `8f3847d171864dcd721fe98ff8c1b2a469c41906`.

Preserve:
- central listening/screening room;
- MEDIA + CULTURE wall with LISTEN / WATCH / ARCHIVE;
- west Culture Archive / Rally Gallery;
- compact Creator Recording Room;
- Edit / Review Suite;
- elevator-side media control;
- dark/gunmetal/warm-wood/charcoal material family.

There was no comparable standalone historical Floor 4 3D viewer in repo history. Do not invent one as precedent.

Do **not** preserve obsolete west Stair B/service-core coordinates.

See `FLOOR-04-V1-V2-PRESERVATION-MAP.md`.

## Reference A5 — historical Floor 5 Policy + Proof

Historical architecture references:
- canonical Floor 5 program/spec commit `06eaae3221f91c4d2c418a24df964af0a6db98af`;
- locked Floor 5 schematic geometry commit `73016c8f98120088db87975f7128cc43429e6935`.

Preserve:
- central Policy Lab;
- 16' × 5' / eight-seat maximum research table;
- POLICY + PROOF wall with RESEARCH / EVIDENCE / RECORD hierarchy;
- west Evidence + Proof Archive;
- Source Review Room;
- Publication / Submission Review Room;
- elevator-side Research / Publication Navigator;
- quiet research-institute character;
- dark/gunmetal/warm-wood/charcoal material family.

There was no comparable standalone historical Floor 5 3D viewer in repo history. Do not invent one as precedent.

Do **not** preserve obsolete west Stair B/service-core coordinates.

See `FLOOR-05-V1-V2-PRESERVATION-MAP.md`.

## Reference B — fully assembled Core V2 building

### Combined generator
Commit: `c674e07daf772ea739d93cc515657deb028e8b75`

### Assembled GLB
Commit: `ef3fd47d543318fd3ed129fa3f58fc7fab5fabce`

Historical report:
- 667 meshes;
- 27/27 continuity checks;
- seven-level stack before B1 extension;
- full stair transitions;
- passenger/freight continuous shafts.

### Stacked viewer
Commit: `7ea458406cc862656b5952a350fe87bcdc16110b`

Use it to understand:
- whole-building orbit;
- all-floors mode;
- cutaway mode;
- core-only mode;
- floor isolation;
- common coordinates;
- visible vertical continuity.

This is the primary historical stacking/assembly reference.

## Reference C — current B1→roof Core V2 continuity model

Current source:
- `production/build_equity_uprise_building_v2.py`
- `production/generated/equity-uprise-building-core-v2.glb`
- `production/generated/equity-uprise-building-core-v2-report.json`

Current committed report:
- 792 meshes;
- 41/41 checks;
- eight levels including B1;
- 14 stair transitions;
- site/egress integration;
- restricted B1 semantics;
- Halo Globe integration.

Use current Core V2 for geometry/program truth.

## Decision rule

When references disagree:
- **appearance / interior feel** → learn from V1, then adapt;
- **stacking / whole-building behavior** → learn from the assembled building;
- **current geometry / program / permissions / safety simulation** → obey current Core V2 authority.

Never let one reference class erase the other two.
