# PRIM3 Site 0 — Central Vertical Mobility Canyon

Status: **CANONICAL v03 REVISION — 2026-08-14**

## Purpose

Provide a legible, continuous operational route through the center of Site 0: tanks can drive from B3 to L2, aircraft and oversized loads can transfer from B2/B3 to L3, the L1 road runs directly through the building, and the L2 business floor can stage equipment and launch drones through a protected vertical slot.

## Route matrix

| System | Stops / route | Primary use |
|---|---|---|
| R1 / R2 | B3 ↔ B2 ↔ B1 ↔ L1 ↔ L2 | Tanks, tracked/wheeled heavy vehicles, robots and machinery |
| V1 / V2 | B3, B2, B1, L1, L2, L3 | Aircraft under tow, large drones and oversized equipment |
| L1 road | NORTH gate ↔ central canyon ↔ SOUTH operational gate | Direct surface vehicle circulation |
| L2 pad | Secured staging deck ↔ drone pad ↔ retractable L3/sky slot | Demonstration staging and drone launch/recovery |
| P1 | B3 ↔ external SOUTH shaft ↔ L3 | Independent restricted PRIME heavy lift |
| PRIME escape ramp | B3 ↔ grade beyond the primary perimeter | Independent emergency surface escape |

## Which floors are actually open — read this before cutting anything

**Only L1 and L2 have the middle carved out.** Everything else is a
regular floor.

This spec describes a route that *touches* B3 through L3, and that has
been misread as "the canyon is a full-height hole through the building".
It is not. A rebuild on 2026-08-19 came back with the middle cut out of
every plate: exterior correct, interior a shaft.

| Level | Plate |
|---|---|
| L3 | **Solid.** The flight deck. Mostly uninterrupted carrier surface; only the V1/V2 transfer aperture and the P1 flush-deck platform break it. |
| L2 | **Open.** Central void, canyon edge, drone pad and retractable sky slot. |
| L1 | **Open.** Central void with the north-south through-road running straight through it. |
| B1 | **Solid.** Clean research floor. Enclosed transit only. |
| B2 | **Solid.** Production floor. Routes pass through it, they do not open it. |
| B3 | **Solid.** Command and heavy deployment. |

On the four solid levels the canyon is still *present* — as bounded
shafts. The V1/V2 lift cores, the R1/R2 ramp runs, the stair and egress
cores and the service risers each punch their own opening, sized to the
equipment passing through, each with its own floor edge and guarding. A
shaft is a hole the size of a lift. An atrium is a hole the size of a
room. These floors get shafts.

**The section test.** Cut the model north-south through the centre of the
building. There must be exactly one two-level open volume, at L1-L2. If
that cut shows daylight from B3 to L3, the plates are wrong.

## Geometry rules

- Keep every ramp segment, lift platform, road, pad, blast lock and aperture frame separately named and editable.
- R1/R2 form two parallel switchbacks; one can be controlled for ascent and one for descent, with reversible operations.
- V1/V2 are centered inside the canyon and retain independent controls and platforms.
- B1 permits enclosed transit only; it remains a clean research floor, not a vehicle bay.
- Only L1 and L2 have open plates. B3, B2, B1 and L3 are continuous floors penetrated only by named shafts. No central atrium, light well or open canyon edge on those four levels.
- L2 offices and public areas are isolated from the armored staging deck and flight pad.
- The L3 aperture is retractable and must not compromise the main east-west runway when closed.
- Required life-safety egress uses the four protected A-D cores, never R1/R2/V1/V2/P1.

## Engineering hold points

The model and plans establish topology and use. Structural spans, blast ratings, ventilation, fire suppression, turning radii, aircraft envelope, lift capacity, pavement loading and final ramp grade require discipline engineering before construction documentation.

## Referenced drawings

- `plans/PRIM3_Site0_VERTICAL_MOBILITY_SECTION.svg`
- `plans/PRIM3_Site0_B3_MOBILITY_FLOORPLAN.svg`
- `plans/PRIM3_Site0_B2_MOBILITY_FLOORPLAN.svg`
- `plans/PRIM3_Site0_B1_MOBILITY_FLOORPLAN.svg`
- `plans/PRIM3_Site0_L2_MOBILITY_FLOORPLAN.svg`
