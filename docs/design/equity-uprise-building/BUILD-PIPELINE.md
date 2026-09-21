# Equity Uprise Building — Canonical Build Pipeline

The pipeline exists to prevent the exact failure mode where plans are treated as the product or a floor is rebuilt without knowing the whole building.

## 1. Context preflight

Read:
- `AGENTS.md`
- `PROJECT-STATE.md`
- `MASTER-INDEX.md`
- `HISTORICAL-REFERENCE-BUILDS.md`

Run:
```bash
python docs/design/equity-uprise-building/production/audit_building_context.py
```

## 2. Authority

Resolve:
- repo/program truth;
- shared Core V2 geometry;
- floor identity/program;
- B1/roof/site relationships;
- permissions/public-private boundaries.

Do not model before conflicts are resolved.

## 3. Inventory

Create/maintain a floor inventory covering:
- furniture;
- fixtures;
- equipment;
- displays/screens;
- signage;
- plants/decor;
- life-safety/support equipment;
- program-specific objects.

Each intentional object should have a stable ID, zone, quantity, dimensions/placement rule, material/style, function, and authority status.

## 4. Real floor 3D

Build actual volumetric architecture:
- shell;
- partitions;
- openings/doors;
- glass;
- stairs/landings/rails;
- elevator/service cores;
- ceilings;
- materials;
- lighting;
- furniture/equipment;
- program features.

Plans remain construction inputs.

## 5. Floor verification

Check:
- 72' × 72' footprint where applicable;
- shared-core alignment;
- stair/elevator openings;
- inventory coverage;
- room/program coverage;
- route/public-private boundaries;
- deterministic output.

## 6. Visual QA

Use the interactive viewer.

A floor is not approved because validators pass. It also has to feel like a designed place.

For Floor 1, the visual baseline is the liked V1 interior language upgraded to current V2 truth.

## 7. Stack integration

Insert the approved floor into common world coordinates immediately.

Verify against:
- B1;
- floor above/below;
- shafts;
- stairs;
- slab openings;
- exterior/massing;
- roof.

Do not postpone stacking until all floors are independently finished.

## 8. Whole-building verification

Maintain one complete building model/viewer that supports:
- whole building;
- cutaway;
- core-only;
- per-floor isolation;
- vertical navigation/floor selection.

## 9. Iterate floor-by-floor

After Floor 1 visual approval:
Floor 2 → Floor 3 → Floor 4 → Floor 5 → Floor 6 → Level 7 → B1 cinematic/detail pass as needed.

Every floor repeats:
**authority → inventory → real 3D → verify → visual approve → stack**

## Final definition of done

The building is done only when:
- each floor is a real designed 3D environment;
- intended furniture/equipment is inventory-backed;
- floors stack without geometry rewrites;
- B1 through roof are coherent;
- vertical circulation is continuous;
- program/capability mapping is represented spatially;
- the whole building can be navigated/inspected as one 3D asset/experience.
