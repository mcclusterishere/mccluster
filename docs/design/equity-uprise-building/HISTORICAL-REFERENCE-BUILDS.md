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
