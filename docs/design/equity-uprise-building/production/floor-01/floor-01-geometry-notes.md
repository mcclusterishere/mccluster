# Floor 01 — Deterministic Geometry Notes

## Purpose

These notes define how to turn the canonical Floor 1 plan into a repeatable visualization/web model.

This is **not** a permit or BIM model.

## Locked plan geometry

Use the existing canonical Floor 1 basis:

- shell: 72' × 72'
- grid: 18'
- elevator: X 54–62 / Y 34–44
- Stair A: X 60–72 / Y 54–72
- Stair B: X 0–12 / Y 54–72
- vestibule: X 29–43 / Y 0–9
- reception wall: approximately X 28–44 / Y 50–54
- reception desk: X 30–42 / Y 44–47
- lounge: X 2–18 / Y 12–28
- intake: X 2–16 / Y 32–44
- directory: X 49–51 / Y 24–29
- camera: approximately (36,28), 5'-4" AFF
- north support/service rooms as defined by the schematic basis

The DXF remains the preferred geometry handoff.

## Deterministic visualization defaults

The scene manifest includes production-only wall/ceiling/door defaults so the initial 3D model can be rebuilt consistently.

Those values are **visualization defaults**, not architectural dimensions.

If later architectural documents establish a wall thickness, ceiling height, door size, glazing head, structural member, or code requirement, update the production package to follow the new authority.

## Modeling sequence

1. import or parse the canonical DXF in feet;
2. set world origin to SW exterior corner (0,0,0);
3. convert to meters only at the engine/export boundary if required;
4. build floor slab and shell;
5. build fixed core and support rooms;
6. build vestibule and intake partitions;
7. preserve reception wall/desk and directory coordinates;
8. place production-default furniture;
9. assign materials by material ID;
10. place lights from `floor-01-lighting.json`;
11. place cameras from `floor-01-camera.json`;
12. attach hotspots/routes/states from the JSON package;
13. export deterministic GLB/glTF without changing plan geometry.

## Collision / navigation

Collision meshes should follow actual walls/core/closed rooms.

Do not create collision from decorative furniture when that would make navigation unusable; use simplified furniture collision volumes.

Primary entrance → reception → elevator path must remain clear.

Secondary reception → lounge/intake path must remain clear.

## Elevator / stairs

For the first web model:
- model the elevator shaft, west-facing doors, and lobby accurately in plan;
- stairs may use simplified deterministic geometry inside their locked enclosures;
- do not move or shrink the enclosures to make modeling easier.

## Logo

Use the existing exact asset:

`assets/img/equity-uprise-logo.webp`

Do not redraw, crop, reinterpret, or substitute it.

## Output targets

Preferred:
- editable master scene
- GLB/glTF for browser/interchange
- optional Blender master
- 2:1 equirectangular 360 output
- still-camera derivatives

Generated imagery is never geometry authority.
