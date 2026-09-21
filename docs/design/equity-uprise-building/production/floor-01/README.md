# Floor 01 — Deterministic Production Scene Package

This folder is the machine-readable implementation layer for **Equity Uprise Floor 1 — Lobby + Intake**.

It exists so Blender, Three.js, future AI/3D systems, and website code can reconstruct the same room from the same data instead of improvising geometry or interaction.

## Authority order

1. `../../FLOOR-01-LOBBY-INTAKE-360-SPEC.md`
2. `../../FLOOR-01-SCHEMATIC-PLAN-BASIS.md`
3. `../../references/floor-01/equity-uprise-floor-01-viable-schematic-v3.dxf`
4. `../../references/floor-01/equity-uprise-floor-01-viable-schematic-v3.svg`
5. this production package
6. rendered/interactive outputs

The production package **cannot override canonical architecture**.

## Files

- `floor-01-scene-manifest.json` — master scene graph, coordinates, zones, fixed core, canonical objects and production furniture defaults
- `floor-01-materials.json` — reusable PBR-style material definitions
- `floor-01-lighting.json` — deterministic lighting intent
- `floor-01-camera.json` — canonical 360 camera plus authored transition cameras
- `floor-01-hotspots.json` — interaction anchors
- `floor-01-routing.json` — semantic website/scene navigation
- `floor-01-states.json` — idle/selected/after-hours scene states
- `floor-01-geometry-notes.md` — modeling rules and known unresolved architectural dimensions

## Coordinate system

- origin: southwest exterior corner
- +X: east
- +Y: north
- +Z: up
- authoring unit: feet
- glTF conversion: 1 ft = 0.3048 m
- canonical camera: approximately (36, 28, 5.333)

## Critical rule

If this package conflicts with the written floor spec, schematic basis, DXF, or SVG, **the canonical architectural source wins**.

## Status

**CANONICAL PRODUCTION V1 / NOT FOR CONSTRUCTION.**
