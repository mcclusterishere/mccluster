# Equity Uprise Building — Canonical Geometry & Visual Reference

> **MANDATORY REFERENCE DIRECTORY**
>
> Any agent, model, designer, renderer, image generator, 3D generator, CAD/BIM workflow, game-engine workflow, lore writer, or implementation agent working on **Equity Uprise spatial material** must read this directory before generating or changing geometry, imagery, environments, floor plans, 360 scenes, architectural continuity, or spatial lore.

## Authority order

Use this order of authority:

1. `../FLOOR-01-LOBBY-INTAKE-360-SPEC.md`
2. `../FLOOR-01-SCHEMATIC-PLAN-BASIS.md`
3. `FLOOR-01-VIABLE-SCHEMATIC-v3.dxf`
4. `FLOOR-01-VIABLE-SCHEMATIC-v3.svg`
5. derived raster previews / renders / 360 images

A render is **never** permitted to redesign the geometry.

## Canonical Floor 1 reference assets

- `FLOOR-01-VIABLE-SCHEMATIC-v3.dxf` — CAD-style exchange geometry; preferred machine-readable spatial handoff.
- `FLOOR-01-VIABLE-SCHEMATIC-v3.svg` — vector plan and annotation reference; preferred visual geometry handoff.

The raster PNG is a derived preview of the same SVG and is not geometry authority. Regenerate it from the SVG when a raster preview is needed.

## Locked Floor 1 facts

- Footprint: **72'-0" × 72'-0" = 5,184 GSF**
- Grid: **18' × 18' coordination grid**
- North is up.
- Fixed elevator hoistway: **X 54–62 / Y 34–44**
- Stair A: **X 60–72 / Y 54–72**
- Stair B: **X 0–12 / Y 54–72**
- MEP/riser reservation: **X 50–60 / Y 66–72**
- Entrance vestibule: south, centered.
- Reception: north/0°.
- Elevator/core: east/+90°.
- Exterior entrance: south/180°, Floor 1 only.
- Lounge/intake: west/−90°.
- Canonical 360 camera: approximately **(36, 28)** at **5'-4" AFF**.

## Non-negotiable continuity rules

- The elevator, stairs, risers, structural grid, and exterior floor plate stack vertically and may not move between Floors 1–6 without an explicit architecture revision.
- Floors 2–6 have no public exterior doors, balconies, or terraces.
- Do not invent extra program to fill space.
- Do not use prior generative images as geometry authority.
- Do not redraw or approximate the Equity Uprise logo.
- Do not introduce HM branding into Equity Uprise architecture.
- Do not create spatial lore that contradicts the physical plan.

## 3D / image generation rule

When generating:
- 360 panoramas,
- cutaways,
- exterior massing,
- floor renders,
- room closeups,
- animation transition plates,
- textured 3D environments,
- NeRF / Gaussian-splat / mesh references,
- Blender / Unreal / Unity scenes,
- image-to-3D assets,

the generator must preserve the canonical plan dimensions and fixed-core coordinates. Stylization may change materials, lighting, furniture finish, weather, time of day, and camera treatment **only if it does not alter spatial geometry or program**.

## Status

Floor 1 geometry is locked at schematic-design level.

Floors 2–6 must receive their own written builder/360 specification and plan geometry one at a time before production imagery becomes authoritative.

**NOT FOR CONSTRUCTION.** Final architectural/engineering documents require licensed professional review for the actual site and jurisdiction.
