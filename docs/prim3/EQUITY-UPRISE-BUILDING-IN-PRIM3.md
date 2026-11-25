# The Equity Uprise building in PRIM3 tactics

Status: first playable level, review branch (2026-11-03). Not public canon. The building's authority
stays in `docs/design/equity-uprise-building/`; this level only reads it and never edits it.

Play: `prim3-transit.html?level=equity-uprise-hq`, or **Equity Uprise HQ** in the tactics menu
(`prim3-tactics-preview.html`). Level module: `js/prim3-tactics/levels/equity-uprise-hq.mjs`.
Tests: `scripts/test/prim3-equity-uprise-level.test.mjs`.

## What it is

Floor 1's own **Emergency Exercise** interaction mode (`core-v2-floor-programs.json`, access:
authorized participants or an instructor), played as a PRIM3 tactics drill. The opposition is
exercise role-players. The squad starts on the south public way, goes in by the public entrance
(the only normal public entrance), and Technical **Reports** twice at the concierge/security
interface behind reception (the site-egress plan names that interface as where an emergency is
reported). Entry can open the Stair A exit discharge from inside. Everyone then assembles at
Assembly Area A. Stairs A and B climb every storey to the Level 7 roof.

## Where the geometry comes from

Every rectangle is copied in feet from the authority. The test fails if any of them drifts.

| Level data | Source |
| --- | --- |
| 72 × 72 ft plate, levels, finished-floor heights, Stair A/B, passenger and freight elevators, MEP riser | `production/building-core-v2.json` |
| Floor 1 vestibule, intake room, reception, journey wall; corridor, restrooms, support rooms, janitor | `production/core-v2-floor-programs.json` |
| Site bounds, public way, public approach, east egress walk, service apron, Assembly Areas A/B, doors | `production/floor-01/floor-01-site-egress.json` |
| Roof overruns, MEP screen, mechanical units, routing beacon, mobility ring, overlook deck | `production/floor-07/floor-07-object-inventory.json` |

No render or generated image was used. No mark, sign or lettering of the building is drawn.

## How it lands on the grid

- **12 ft a tile.** The game tile is 3.54 m. The plans are laid at 12 ft (3.66 m) a tile, which is
  3.3% over. The 72 ft plate is then exactly 6 × 6 tiles, the 18 ft structural grid falls every 1.5
  tiles, and the site (−36…108 × −48…108 ft) is exactly 12 × 13 tiles. Heights stay real metres.
- **Covering rule.** A rectangle covers a tile when it overlaps at least half of it on both axes.
  A rectangle smaller than that takes the tile under its centre. Shared vertical systems win any
  tile they share with a floor-local room, as Core V2 requires.
- **Result.** Stair A is at tiles (8, 3)–(8, 4), Stair B at (4, 3)–(4, 4) (X8–18, never the old
  X0–12), freight at (3, 3), MEP at (7, 3), passenger elevator at (7, 5), reception at
  (5, 5)–(6, 5), intake room at (3, 5), and the support band on row 3. The building's south-west
  corner reads (0, 0).

## Floors (engine z)

| z | What |
| --- | --- |
| 0 | the site at grade; the building footprint is solid here |
| 1 | Floor 1 (0 ft): the plate, entered only by its doors |
| 2–6 | Floors 2–6 (13.5 ft each): only the stair landings are open; the drill keeps the floor doors shut |
| 7 | Level 7, the open-air roof (81 ft): parapet cover, overruns, screens, mechanical units, beacon |
| 8 | B1 (−13.5 ft): a normal floor (owner, 2026-11-03). Its cells, rooms and stairs come from the building package through the PRIM3 adapter; the plant rooms are shut like Floor 1's |

Each stair climbs one storey per link (cost 3), switching back between its two enclosure tiles, so
reaching the roof takes several moves. Both stairs also go down to B1, a normal floor; the cutaway goes
below grade and draws the detailed B1 model. Elevators are not used by PRIM3 missions unless one permits them.

## Known limits of v1 (the engine has whole-tile walls only)

- **Floor 1 is glazed.** It is its own floor joined to the site only at doors, so its facade stops
  movement but not sight. Units inside and outside can see and shoot through the glass.
- **Thin features are drawn or dropped, not ruled.** The journey wall (4 ft deep) shares row 4 with
  the corridor, so the corridor stays open and the wall is left out. Restroom A falls on Stair B's
  tile and gives way to it. Lounge furniture, kiosks and the directory are below tile size.
- **Doors are two-way.** The Stair A exit discharge is modelled as a landing that stays closed until
  Entry opens it from inside. The Stair B discharge and the west service entrance stay shut.
- **Drawing assumptions.** The roof headhouse height (10 ft) and the reception desk height (1.1 m)
  are not in the inventory; they are marked as assumptions in the code.

## Next

1. **Edge walls in the resolver** (an upstream Prim3 change, never a local edit of the vendored
   engine). That would let the facade block sight and bring back the journey wall, the restrooms and
   the support rooms as rooms.
2. ~~Use the authority's generated GLBs for the look.~~ Done (2026-11-03): the level now draws the
   building from its own GLBs (chassis, Floor 1, Level 7 roof, facade; Floors 2–6 on demand), at one
   uniform 12 ft-a-unit scale, checked against the plan in `scripts/test/prim3-equity-uprise-model.test.mjs`.
   See `EQUITY-UPRISE-HQ-REVIEW.md`.
3. **More floors as missions.** The adapter (`js/prim3-tactics/adapters/equity-uprise/`) now loads every
   level, B1 to L7, with stairs between them. The first mission on it is B1's Blind the Floor / Restore the
   Picture; see `EQUITY-UPRISE-X-PRIM3-INTEGRATION-MATRIX.md`. (B1's program allows the canonical geometry in
   SANDBOX training; no separate clone is required.)
4. **Owner review** of the drill framing, the role-player opposition, and whether this level should
   appear outside the review menu.
