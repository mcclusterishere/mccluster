# Equity Uprise — Building Core V2

> Status: **CORE V2 + B1 TECHNICAL/SERVICE STACK ON `architecture/equity-uprise-core-v2`**
>
> This document controls the vertical-circulation and stacking redesign authorized after review of the original floor-local 3D scenes.
>
> **Not for construction.** Final stair, elevator, egress, structure, accessibility, fire/life-safety, MEP and code design require licensed professional review for the actual site and jurisdiction.

## 1. Reason for Core V2

Core V1 reserved appropriate plan zones for stairs and a passenger elevator, but the first browser scenes exposed an implementation defect: the floors were modeled as isolated local scenes and the simplified stair placeholders did not physically rise the full 13'-6" between finished floors.

Core V2 corrects that at the source-of-truth level.

The building is now required to be modeled as one vertical stack with:
- explicit finished-floor elevations;
- continuous elevator shafts;
- two protected stair reservations;
- actual floor-to-floor stair continuity in deterministic geometry;
- coordinated slab openings;
- a west-side service/freight elevator;
- one shared machine-readable core inherited by every floor.

## 2. Shared datum

Plan datum remains:
- 72'-0" × 72'-0" exterior footprint;
- southwest exterior corner = (0,0);
- +X east;
- +Y north;
- +Z up;
- 18' structural coordination grid.

Floor-to-floor datum remains **13'-6"**.

Finished-floor elevations:
- B1 Technical / Service Basement — **-13'-6"**
- Floor 1 — 0'-0" (**modeled level of exit discharge**)
- Floor 2 — +13'-6"
- Floor 3 — +27'-0"
- Floor 4 — +40'-6"
- Floor 5 — +54'-0"
- Floor 6 — +67'-6"
- Level 7 roof — +81'-0"

## 3. Passenger elevator

Retain the original passenger-elevator stack:
- shaft X 54–62 / Y 34–44;
- west-facing doors;
- primary public vertical circulation;
- B1 and Floors 1–6 served.

Direct passenger-elevator service to Level 7 is **not assumed** by Core V2. Roof access remains guaranteed through the protected stair system unless later professional design resolves direct elevator service.

## 4. West Service Core

The northwest/rear core expands to the full west structural bay:

**X 0–18 / Y 54–72**

It contains:
1. a service/freight elevator shaft; and
2. revised Stair B.

This replaces the old assumption that the full X0–12 / Y54–72 zone is only Stair B.

### 4.1 Service / freight elevator

Conceptual shaft:
- X 0–8 / Y 60–72;
- 8' × 12' reservation;
- south-facing service door into the Y54–60 service/circulation band;
- 5' conceptual door opening centered approximately X1.5–6.5.

The shaft is reserved continuously through the building stack. Floors 1–6 are conceptual served stops. Level 7 service is reserved for later resolution, not assumed operational.

Final elevator type, capacity, loading, pit, overhead, machine-room/MRL strategy, ratings and structural support remain professional-design tasks.

### 4.2 Revised Stair B

New enclosure:
- X 8–18 / Y 54–72;
- 10' × 18';
- south access;
- conceptual 3' access opening around X14–17.

Stair B remains a protected remote egress reservation. It is **not deleted** to make room for the freight lift.

Stair B continues to B1. At Floor 1, discharge-direction control must prevent evacuees from unintentionally continuing below the modeled level of exit discharge.

## 5. Stair A

East Stair A remains:
- X 60–72 / Y 54–72;
- 12' × 18';
- south access;
- continuous B1 through Floors 1–6 and Level 7.

## 6. Stair continuity geometry

Both stairs use a schematic dogleg/U-shaped continuity model.

Each level transition must span the full:
**13'-6" rise**

Core V2 deterministic geometry uses, for visualization/coordination only:
- 22 risers per level;
- approximately 7.36" conceptual riser height;
- 11 risers per flight;
- 10 conceptual treads per flight;
- approximately 11" conceptual tread depth;
- an intermediate landing.

Stair A conceptual flight width: 5'.  
Stair B conceptual flight width: 4'.

These dimensions prove vertical connection and fit inside the reserved envelopes. They are **not code-approved stair dimensions**.

No future browser model may substitute a short decorative flight that stops below the next finished floor.

## 7. Slab openings

Shared slab openings are reserved for:
- passenger elevator: X54–62 / Y34–44;
- service/freight elevator: X0–8 / Y60–72;
- Stair A: approximately X60.75–71.25 / Y58.25–71.25;
- Stair B: approximately X8.75–17.25 / Y58.25–71.25.

Floor-specific geometry must yield to these openings.

## 8. MEP

The east MEP/riser reservation remains approximately:
- X50–60 / Y66–72.

It now continues conceptually from B1 through Level 7.

Floor-specific service rooms may be rebalanced but may not intrude into the shared vertical systems.

## 8A. B1 Technical / Service Basement

B1 is a deliberate **support/training level**, not an additional E-Q-U-I-T-Y developmental floor.

- FFE: **-13'-6"**
- same 72' × 72' coordination footprint;
- no normal public browsing;
- authorized staff/learner/instructor access;
- passenger elevator, freight/service elevator, Stair A, Stair B and MEP continue to B1.

B1 program authority:

- `BASEMENT-B1-TECHNICAL-SERVICE-PROGRAM.md`
- `production/basement-b1-program.json`

Primary conceptual functions:

- mechanical plant;
- electrical/emergency power;
- fire protection/water;
- network/telecom core;
- sump/flood management;
- facilities workshop/storage;
- building-systems lab;
- service receiving/staging.

The basement exists because it materially improves building-systems, emergency, infrastructure, cybersecurity and operations simulation. It is not described as a code requirement.

## 9. Floor-plan consequence

The B1 plan, every Floor 1–6 plan and the Level 7 roof plan must be regenerated.

The west/north support band changes because:
- the freight shaft now occupies X0–8 / Y60–72;
- Stair B shifts to X8–18 / Y54–72;
- old west-side restroom/support boundaries may no longer survive unchanged.

The primary identity/program of each floor should remain stable where possible; support-space geometry is subordinate to the shared core.

## 10. Combined-model requirement

Core V2 is not considered spatially validated until a combined building model proves:
- B1 through roof finished-floor elevations;
- Floor 1 site/exit-discharge geometry;
- continuous shafts;
- continuous stairs;
- coordinated slab openings;
- no disconnected or floating floor scenes.

Per-floor viewers remain useful, but they become **derived isolated views** of the same building geometry.

## 11. Egress limitation

Core V2 deliberately retains two stair reservations from B1 through Level 7.

Floor 1 is the modeled level of exit discharge. Because the stairs continue below it, the simulation requires explicit discharge-direction barriers/wayfinding at Floor 1 and exterior discharge paths to grade/open space/public way.

The new service/freight elevator must never be described as replacing a required stair or exit without a licensed code analysis establishing a compliant design.

## 12. Machine-readable authority

The controlling shared implementation file is:

`docs/design/equity-uprise-building/production/building-core-v2.json`

All floor-specific production packages must reference and inherit it rather than redefining shared core coordinates locally.

## 13. Migration rule

Until Core V2 is merged to main:
- main remains Core V1 canonical;
- this branch is the approved migration workspace;
- downstream V2 files must identify themselves as Core V2;
- old artifacts must not be silently overwritten without versioning or clear legacy status.

After migration validation and owner approval, REFERENCE-AUTHORITY will designate Core V2 as canonical.


## 14. Floor 1 site / discharge layer

Canonical exterior/egress simulation authority:

- `FLOOR-01-SITE-EGRESS-SIMULATION.md`
- `production/floor-01/floor-01-site-egress.json`

The layer defines:
- public/accessible south approach;
- Stair A east discharge;
- Stair B north/rear discharge;
- secure west service entrance/apron;
- public-way connection;
- primary and alternate assembly areas;
- emergency equipment / accountability concepts.

These are simulation-grade planning assumptions, not a permit/site-plan claim.

## 15. Code/safety research reference

Read:

`SIMULATION-CODE-REFERENCE-PROFILE.md`

before changing egress, basement, accessibility, emergency-action-plan or exit-discharge semantics.
