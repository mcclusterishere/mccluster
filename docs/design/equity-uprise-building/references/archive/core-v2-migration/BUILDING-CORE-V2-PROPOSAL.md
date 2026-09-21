> ARCHIVED 2026-09-21 — historical Core V2 migration record. Not active design authority.\n> Current authority begins at `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md`.\n\n# Equity Uprise — Building Core V2 Proposal

> Status: **APPROVED MIGRATION RATIONALE / SUPERSEDED BY `BUILDING-CORE-V2-SPEC.md`**
>
> This document records the rationale that led to Core V2. The owner approved proceeding with this migration in-chat on September 21, 2026. The controlling branch authority is now `BUILDING-CORE-V2-SPEC.md` plus `production/building-core-v2.json`. Main remains unchanged until migration validation and later promotion.
>
> **Not for construction.** Final egress, stair, elevator, structural, accessibility, fire/life-safety, MEP and code design require licensed professional review.

## Why this revision exists

The current Floor 1 and Floor 2 browser scenes are floor-local visualization models. They share the same plan coordinates, but they are not one vertically connected 3D building.

The current simplified stair geometry is also not physically complete:
- Floor-to-floor target is 13'-6".
- The browser stair placeholder currently rises only 10'-6".
- No slab openings or true upper/lower landings connect one floor scene to the next.
- The placeholder uses only nine tread objects and is not intended as code-realistic stair geometry.

Therefore the current stairs correctly reserve plan area but do **not** yet prove real floor-to-floor navigation.

## Core V2 design objective

Create one vertically connected building model in which:
- Floors 1–6 and Level 7 share real elevations.
- Stair geometry physically reaches the next finished-floor elevation.
- Floor slabs contain coordinated stair openings.
- Elevator shafts are continuous through the stack.
- A service/freight lift is added on the west side.
- Two independent protected stairs remain conceptually reserved unless later licensed code analysis establishes another compliant solution.

## Proposed shared vertical datum

Finished-floor elevations:
- Floor 1: 0'-0"
- Floor 2: +13'-6"
- Floor 3: +27'-0"
- Floor 4: +40'-6"
- Floor 5: +54'-0"
- Floor 6: +67'-6"
- Level 7 roof walking datum: +81'-0"

## Passenger elevator

Retain the existing passenger-elevator stack:
- X 54–62
- Y 34–44
- west-facing lobby door

This remains the primary public vertical circulation element.

## East protected stair — Stair A

Retain the east stair enclosure:
- X 60–72
- Y 54–72

Replace the current straight placeholder treads with a true floor-to-floor stair object:
- dogleg / U-shaped conceptual geometry;
- intermediate landing;
- coordinated slab opening;
- full 13'-6" finished-floor rise;
- continuous geometry between floor elevations.

Exact riser/tread dimensions remain pending licensed code design.

## Proposed West Service Core

Expand the present west-rear core from 12' wide to the full west structural bay:

- overall West Service Core reservation: **X 0–18 / Y 54–72**

This aligns with the 18' building grid and creates room for both a service/freight elevator and a second protected stair.

### Service / freight elevator reservation

Conceptual shaft reservation:
- **X 0–8 / Y 60–72**
- approximately 8' × 12' shaft reservation
- conceptual south-facing service door into the Y54–60 service/circulation band

This is a planning reservation only. Final car, door, pit, overhead, machine-room/MRL strategy, loading and structural requirements depend on the selected elevator system.

### West protected stair — revised Stair B

Conceptual enclosure reservation:
- **X 8–18 / Y 54–72**
- approximately 10' × 18'

This keeps the second protected stair in the west/rear part of the building while making room for the service/freight lift.

Final stair width, landing geometry, ratings and code compliance remain unresolved until professional review.

## Why Stair B should not simply be deleted

The current building concept intentionally reserves two remote protected stairs.

Replacing Stair B entirely with an elevator would leave only one protected stair in the concept. An elevator generally should not be assumed to replace a required means of egress.

Therefore Core V2 proposes:
- keep Stair A;
- retain a revised Stair B;
- add the freight/service lift within an expanded west service core.

## Consequences for every floor

This is intentionally a building-wide revision.

The west-rear support program on Floors 1–6 must be replanned around X0–18 / Y54–72. That means:
- west-side restroom/support boundaries shift;
- corridor/service-door positions change;
- floor-specific west/north support rooms are rebalanced;
- DXF/SVG/PNG plans must be regenerated;
- floor-specific written plan bases must be updated;
- deterministic production manifests and browser scenes must be regenerated.

The central public program on each floor should remain as stable as practical.

## Level 7

Level 7 must inherit:
- passenger-elevator continuation;
- Stair A continuation;
- revised Stair B continuation;
- west service/freight-lift continuation where technically appropriate;
- roof-access/service coordination.

The freight/service lift must not imply operational aviation support until actual structural/aviation feasibility exists.

## Implementation strategy

Do not patch seven viewer files independently.

Create one canonical machine-readable building-core definition and make every floor inherit it.

Recommended shared file:
- `docs/design/equity-uprise-building/production/building-core-v2.json`

It should define:
- floor elevations;
- shell;
- passenger elevator;
- freight/service elevator;
- Stair A;
- Stair B;
- MEP/riser reservations;
- slab openings;
- common vertical-circulation IDs.

Then regenerate:
- floor plan references;
- floor production manifests;
- floor viewers;
- one combined full-building 3D viewer.

## Combined building viewer requirement

Core V2 should produce:
- one stacked 3D building;
- floor-isolation controls;
- cutaway mode;
- actual continuous stairs;
- actual vertical shafts;
- selectable floor destinations;
- no illusion that Floor 2 is floating beside Floor 1.

Individual floor viewers can remain available, but they become derived views of the combined building.

## Approval status

The Core V2 migration is approved on the protected branch. This rationale does **not** itself change canonical main-branch architecture.

Migration validation is required before:
- updating REFERENCE-AUTHORITY.md;
- revising floor specs/bases;
- replacing DXF/SVG/PNG plan references;
- changing production manifests on main;
- replacing the live building scenes.
