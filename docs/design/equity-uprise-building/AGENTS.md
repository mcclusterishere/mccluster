# EQUITY UPRISE BUILDING — LOCAL AGENT CONTRACT

This directory is the **front door for all Equity Uprise building work**.

If a task touches the Equity Uprise building, floors, B1, roof, stairs, elevators, furniture, spatial program, 3D environments, whole-building stacking, viewers, plans, renders, 360s, site/egress, or building-linked capability mapping, this file applies in addition to the repository-root agent law.

## Mandatory preflight — do this before changing anything

1. Read this file completely.
2. Read `README.md`.
3. Read `PROJECT-STATE.md` to learn **what is already done, what is provisional, and what is next**.
4. Read `MASTER-INDEX.md`.
5. Run:
   ```bash
   python docs/design/equity-uprise-building/production/audit_building_context.py
   ```
6. Read `REFERENCE-AUTHORITY.md`.
7. Read the relevant floor/B1/roof canonical spec + schematic basis + production package.
8. For design/3D work, read `HISTORICAL-REFERENCE-BUILDS.md` and `BUILD-PIPELINE.md`.
9. For Floor 1, also read `FLOOR-01-V1-V2-MERGE-MAP.md`.

**Do not start implementation if the context audit fails.** Fix the index/context first.

## Product truth

The product is a **real 3D environment and ultimately one complete stacked 3D building**.

PNG/SVG/DXF plans, JSON program files, authority docs, validation reports, colored program plates, and diagnostic viewers are inputs and verification artifacts. They are not the final building.

### The three reference classes are mandatory

Every intelligent building decision must reconcile all three:

1. **V1 interior/design reference** — preserve the better-looking original interior language, materials, lighting, furniture composition, and human-scale feeling.
2. **Fully assembled building reference** — preserve proven stacking, world coordinates, vertical circulation, cutaway/floor-selection behavior, and whole-building continuity.
3. **Current Core V2 authority** — obey corrected geometry, B1, service/freight elevator, Stair B, site/egress, program/capability research, permissions, and current floor roles.

The target is:

**V1 interior quality + assembled-building stacking behavior + current V2 truth = next-generation complete Equity Uprise 3D building.**

## No destructive forgetting

- Do not replace a successful historical design merely because it is old.
- Do not restore obsolete geometry merely because the old design looked better.
- Apply new research/corrections to the best existing design.
- Do not delete/archive historical references until the replacement explicitly records what was preserved and what was superseded.
- Do not call a floor "done" because its plans or JSON are done.
- Do not call the building "done" until finished floor environments stack coherently into the whole-building scene.

## Index discipline

`BUILDING-FILE-INDEX.json` is the exhaustive tracked-file index.

Whenever you add, delete, rename, or move a building-related file:

```bash
python docs/design/equity-uprise-building/production/audit_building_context.py --write
python docs/design/equity-uprise-building/production/audit_building_context.py
```

Commit the refreshed index with the change.

The audit intentionally includes:
- everything under this directory;
- the two external repo/building audit documents;
- root public building viewers;
- Equity Uprise building CI/deploy workflows;
- root agent entrypoints that carry building law.

## State discipline

Update `PROJECT-STATE.md` whenever a task changes:
- completion status;
- design maturity;
- accepted visual direction;
- whole-building assembly state;
- current generated outputs;
- next approved work.

An agent should be able to read that file and avoid repeating finished work.

## Floor implementation rule

For each floor, the progression is:

**authority → program → inventory → real floor 3D → floor verification → visual approval → stack integration**

Furniture/equipment are not decoration-only afterthoughts. Each intended object belongs in a floor inventory with stable IDs and placement/role data.

## Whole-building rule

The final building is not a pile of unrelated floor scenes. Every floor must use the shared world coordinate system and preserve:
- 72' × 72' plate;
- fixed finished-floor elevations;
- passenger elevator alignment;
- service/freight elevator alignment;
- Stair A alignment;
- Stair B alignment;
- MEP/riser alignment;
- slab openings;
- B1 and roof relationships.

The assembled building is a continuous product and verification target from the start, not a final-week integration task.

## Current immediate direction

Do not restart Floor 1 from scratch.

Use the old V1 Floor 1 as the aesthetic/interior reference, current Core V2 as geometry/program authority, and the historical assembled building as the stack reference. Build the **hybrid Floor 1** with a real furniture/object inventory, review it visually, then move floor-by-floor using the same process.
