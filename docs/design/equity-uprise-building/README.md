# Equity Uprise Building — Start Here

This directory is the single navigation/control center for the Equity Uprise building project.

## Agent / contributor read order

1. **`AGENTS.md`** — mandatory local rules and preflight.
2. **`PROJECT-STATE.md`** — current truth: done / provisional / next.
3. **`MASTER-INDEX.md`** — human-readable map of the project.
4. **`BUILDING-FILE-INDEX.json`** — exhaustive machine-readable tracked-file index.
5. **`REFERENCE-AUTHORITY.md`** — authority hierarchy.
6. **`HISTORICAL-REFERENCE-BUILDS.md`** — what old builds are still valuable and why.
7. **`BUILD-PIPELINE.md`** — required path from research to real 3D to whole building.
8. **`WORKPLACE-OCCUPANCY-AUTHORITY.md`** — recurring named staff, floor populations and Equity Uprise-vs-Site-0 story boundary.
9. Relevant floor/B1/roof docs and production package.

Run before implementation:

```bash
python docs/design/equity-uprise-building/production/audit_building_context.py
```

## One-sentence project target

Build a **fully furnished, inhabited, program-aware, navigable 3D Equity Uprise headquarters** that preserves the best V1 design language, obeys current Core V2 geometry/research, assembles cleanly from B1 through the roof, and carries the recurring PRIM3 workplace population without being confused with Site 0 / Root HQ.

## Important distinction

Plans are blueprints. JSON is program/authority. Validators prove constraints. **The 3D environment is the product.**


## Living workplace authority

Equity Uprise HQ is the recurring workplace for the PRIM3 ensemble. It is not Site 0 / Root HQ.

Named staff desks, floor archetypes and B1 workplace access are governed by:
- WORKPLACE-OCCUPANCY-AUTHORITY.md
- production/workplace-occupancy-v1.json

B1 is a known staffed technical floor with room-level safety/access controls; it is not a secret owner-only level.
