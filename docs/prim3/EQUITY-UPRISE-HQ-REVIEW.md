# Equity Uprise HQ drill — review for the owner

Status: review branch `claude/equity-uprise-hq-real-20261103` (2026-11-03). Not merged, not public canon.
Play it at `prim3-transit.html?level=equity-uprise-hq`. The building's authority stays in
`docs/design/equity-uprise-building/`. This level reads that authority and never edits it.

## What Codex built (the building, before this pass)

The building pipeline is real and deterministic. Python builders turn the Core V2 JSON authority into
GLB models, reports and validators. Every GLB is in metres, Z up, with the building's south-west corner
at the origin and Floor 1's finished floor at z = 0. Nodes are only translated, with no rotation or scale,
and colours are vertex colours (the facade uses named materials).

| GLB (`production/generated/`) | Size | Meshes | Triangles | What it is | In git? |
| --- | --- | --- | --- | --- | --- |
| `equity-uprise-building-core-v2.glb` | 523 KB | 840 | 12.1 k | The combined B1→roof chassis: slabs per level, perimeter walls, both protected stairs with real switchback flights, elevator and freight shafts, site paving, L7 parapet, plus coloured program blocks | yes |
| `equity-uprise-facade-core-v2.glb` | 2.49 MB (229 KB gzipped) | 3,975 | 48.1 k | The curtain wall F1–F6, mullions, spandrels, crown, entry canopy, doors, site apron, plus **signage** | yes |
| `equity-uprise-floor-01-core-v2.glb` | 232 KB | 348 | 5.9 k | The detailed Floor 1: vestibule, reception and security desk, journey wall, passport kiosks, intake room, lounge, restrooms, support rooms, life-safety items | no: built by `deploy-pages.yml` |
| `equity-uprise-floor-02…06-core-v2.glb` | 187–318 KB each | — | — | The detailed Floors 2–6 | no: built at publish |
| `equity-uprise-floor-07-core-v2.glb` | 194 KB | 283 | 5.5 k | The Level 7 roof: deck, headhouses, overruns, MEP screen, mechanical units, beacon, mobility ring, overlook | yes |
| `equity-uprise-basement-b1-core-v2.glb` | 250 KB | 382 | 6.1 k | B1 | yes |
| `equity-uprise-building-services-core-v2.glb` | 652 KB | 921 | 22.5 k | Services (risers, takeoffs) | yes |
| `electronics/generated/equity-uprise-electronics-fabric-v1.glb` | 13.7 MB | 23,230 | 838 k | The electronics and cabling fabric (X-ray) | yes |

The publish workflow (`deploy-pages.yml`) builds every floor and copies the GLBs to `equity-uprise-preview/`.
The asset registry, lab runtime (scenario packs, assessment, difficulty) and learner-experience JSON sit
beside them in `production/asset-registry/` and `production/lab-runtime/`.

**The 3D viewer exists and works:** `_unfinished/equity-uprise/equity-uprise-building-core-v2-3d.html`,
with per-floor viewers alongside it. It loads from `/equity-uprise-preview/` and offers Stack, Facade,
floor isolation, X-ray, cabling, services and Room Mode. Rendered at 1440 and 390 it shows the full
glass tower and the Floor 1 room. Problems I found:

- It lives in `_unfinished/` and is **not published**. Only its GLBs are on the site.
- It asks for `js/live-content.js` relative to `_unfinished/`, which returns 404.
- At 390 px the control panel covers about a third of the screen and the tower is cropped.
- In Stack view it reports "0/8 detailed floors currently resident" until you isolate a floor.
- **Its facade signage is the Equity Uprise mark rebuilt from rectangles and arrow segments**
  (`FAC-SIGN-LOGO-*`, built from `production/facade/equity-uprise-logo-vector.json`), plus extruded
  wordmark letters (`FAC-SIGN-LETTER-WORDMARK-*`). That is a drawn logo under hard rule 11. The game
  never draws it. Whether to remove it from the facade builder is your decision; see the questions below.

## What changed in the game

**Before:** the level drew the building as boxes cut from the plan rectangles. Floor 1 was a pale box
of glass, the upper storeys were see-through slabs, and a random "city" block could land between the
camera and the street.

**Now:**

- **The building is drawn from the building's own GLBs:** the chassis, the detailed Floor 1, the Level 7
  roof and the facade. Floors 2–6 load only when the cutaway first reaches them. The GLBs are read
  directly and merged into a few meshes per part: 18 at the start (43 with every floor loaded), so the
  renderer handles a few dozen draw calls at most, instead of the source's 5,446 nodes. They are baked into the level's frame through one function,
  `modelToWorld` in `levels/equity-uprise-hq.mjs`.
- **One uniform scale.** The plan sits at 12 ft a tile, so this level is now drawn at 12 ft (3.6576 m)
  per world unit in every direction (`WORLD_M`). Operatives keep their real 1.75 m height against the
  real building. The rules are untouched: blockers, links, cover, line of sight and heights still come
  from the plan data, and the engine's tile is still 3.54 m.
- **Storey cutaway.** The page tells the renderer which storey is in play: the selected operative's
  floor, or Floor 1 as soon as anyone is inside or a move can reach inside. The renderer slices the
  building 8 ft above that floor with one clipping plane, so ceilings, light grids and upper floors
  disappear. While the squad is still on the street, and in **All** (overview), the whole tower is shown.
  The plotting grid hides on floors above the cut, and taps can never land on a removed floor.
- **Floor 1 reads as glass.** On the mid and high tiers the facade's vision glass is drawn. On the
  battery tier, which skips the 2.5 MB facade, the plain procedural glass stays. Upper-floor glass and
  interior glass partitions come from the model.
- **Doors.** The public-entrance leaves are drawn open for the drill. The Stair A exit discharge is a
  door panel (a game mark) that disappears when E opens it. The building model has no door leaf there.
- **The plan boxes are kept as a fallback.** They appear until the chassis arrives and stay if it fails
  to load. They remain as invisible pick surfaces for taps.
- **Fixes along the way:**
  - The city ring was pushed out past the camera's reach for building levels. One block used to swallow
    the camera.
  - The opening camera now stands back so the tower is visible.
  - The objective label now sits just above Floor 1's ceiling, instead of floating about 9 m up.
  - The objective label is readable in the Studio look.
- **Performance and sizes.**

  | Tier | What loads first | Total |
  | --- | --- | --- |
  | Battery | chassis 523 KB + Floor 1 232 KB + roof 194 KB | 0.95 MB |
  | Mid / high | the same, plus the facade 2.49 MB | 3.44 MB |

  Each of Floors 2–6 adds 187–318 KB, and only when visited. There are no textures in any of them.
  Everything loads after the first frame. The plan boxes show until the model is ready.

## What is playable (verified)

- **Playwright, real page, 1440×900 and 390×844, Day look, mid tier**
  - The squad starts on the public way and goes in by the public entrance.
  - T reports twice at the security interface. E opens the Stair A discharge.
  - R climbs Stair B six storeys to the roof (the cutaway follows: Floor 2, …, Floor 6, then the whole
    tower), comes back down and out.
  - All three assemble at Assembly Area A. Result: **Exercise complete**, 3 of 3.
  - In this run the role-players were weakened (1 HP, aim 5) so a scripted squad could finish. The rules
    were not changed.
  - No page errors. `scrollWidth === clientWidth` at 390.
  - Real taps on Floor 1 and street tiles through the model resolve to the right tile and floor.
- **Battery tier, Night look and Studio look** were rendered and checked.
- **With the role-players at full strength,** my scripted squad lost three of three runs (see the
  questions below).
- **Tests:** `node --test scripts/test/prim3-*.test.mjs` passes 46 of 46. The new file
  `scripts/test/prim3-equity-uprise-model.test.mjs` adds:
  - Scale and height agreement.
  - The chassis plate, Stair A, Stair B (X8–18), both elevators, the public way and Assembly Area A land
    on the plan rectangles. Every storey's slab top equals the rules' floor height.
  - The roof model sits at +81 ft, with its overruns, MEP screen, mechanical unit and beacon on the plan.
  - The facade wraps the plate, and every signage node is dropped.
  - The manifest names only files the pipeline builds and publishes.
  - If you build Floor 1 locally, its reception desk and slab land on the plan. Otherwise this check is
    skipped, because that GLB is built at publish time.
  - A full squad-only drill on the real resolver: entrance, two reports, exit opened, roof, assembly,
    `missionComplete`.
- The building context audit passes. I changed nothing under `docs/design/equity-uprise-building/`.

## Screenshots

These are local review files and are not committed. In the scratchpad folder `hq-review/`:

- **Before:** `before/before-home-{390,desktop}.png`, `before/before-overview-{390,desktop}.png`, and
  `before/viewer-*.png` (Codex's building viewer).
- **After:** each beat at both sizes:
  - `01-exterior-*`
  - `02-lobby-*`
  - `03-mid-mission-*`
  - `04-roof-*`
  - `05-end-*` (Exercise complete)
- **Final pass:** `06-final-*-{home,move,all}` (home view, move into the cutaway, overview).

## Not finished / known limits

- **The model has no Stair A discharge door.** `floor-01-site-egress.json` lists
  `F1-DOOR-STAIR-A-DISCHARGE` on the east facade (x 72, y 56–60). However:
  - The chassis Stair A east wall is solid from B1 to the roof.
  - The facade module there (`FAC-EAST-F1-M10`) is a glass slit, not a door.

  Once E opens the exit, the squad walks through a drawn wall. The building builders need the door.
- **Whole-tile rules against a real model.** A stair tile's centre falls on the enclosure's south wall
  line (the plan's 12 ft tile against the 18 ft enclosure). An operative on a landing therefore stands
  at the doorway, not on the landing slab. Glass still stops movement but not sight. Edge walls in the
  engine are the real fix (an upstream Prim3 change).
- **Upper-floor stair landings are the only places to stand on Floors 2–6.** Their detailed rooms are
  scenery here.
- **Delivery size.** The 2.5 MB facade shrinks to 229 KB when compressed. If GitHub Pages does not
  compress `.glb`, a compressed copy, or a facade without its 3,000 finish trims, would help phones.

## Owner decisions, 2026-11-03, and what changed

**Phone layout.** Before: the objective card sat over the top-left of the board (at 390 px it covered
226 × 121 px of a 366 × 488 board) and the opening view showed a small tower from far above. Now the objective
is a one-line strip docked above the battlefield (title, progress chip, a chevron for the details), at every
width; on desktop it shows its details, still above the board. The opening shot is the level's own
(`OPENING` in `levels/equity-uprise-hq.mjs`): low and close from the public way, so the tower fills the board
and the squad stands in the foreground. Edge rulers no longer print coordinates beyond the board. Checked at
360, 390 and 1440 px: no horizontal scroll, the strip and the board do not overlap
(`scripts/prim3/check-tactics-layout.mjs` measures it in a real browser, including that every operative's
tile takes a tap). Screenshots: scratchpad `hq-floors/before/` and `hq-floors/after/`.

**Roof shooters at full strength.** Unchanged: H3 (5 HP, aim 62, sight 8) and H4 (5 HP, aim 58, sight 6) on
Level 7. Evidence that it is hard but winnable, with no weakening: `scripts/prim3/hq-drill-sim.mjs` plays the
drill with a heuristic squad (it sees only the player projection and moves by the engine's known paths) against
the canonical threat AI. Over 100 seeds it wins 9; the AI wins 91, almost all by downing an operative. A
recorded full-strength win (seed 8) is a test fixture and replays move for move.

The intended solution, read off the winning games:
1. Get through the public entrance in rounds 1–2. The roof sees the public way and the approach, not Floor 1:
   Floor 1 sits under Floor 2's slab.
2. Clear the two inside role-players from inside (E and T first; the reception desk is low cover).
3. T reports twice next to the security interface.
4. Cross to Assembly Area A in one turn per operative (two moves), and assemble at once: never stand in the
   roof's arc for a whole threat phase.

Hunker and overwatch are there; there is no smoke in the engine. The entrance canopy is real
(`FAC-ENTRY-CANOPY-01`, 24–48 × −5.5–0 ft at 9.5 ft) but the resolver cannot yet shelter a unit under a slab
over its own cell; that is an upstream item, as is evacuating a downed operative (the engine counts a downed
operative as someone who must assemble, so one downed operative loses the drill).

**B1.** A normal floor: both stairs go down to it, the plant rooms are shut like Floor 1's, the cutaway goes below
grade and draws the detailed B1 model. B1's mission is Blind the Floor / Restore the Picture
(`EQUITY-UPRISE-X-PRIM3-INTEGRATION-MATRIX.md`).

## Decisions for the owner

1. **The facade logo.** The building's facade rebuilds the Equity Uprise mark from primitives, with
   extruded lettering. The game hides it. Should the facade builder drop it, or carry the supplied
   artwork as the only mark (a flat texture of the complete file, scaled only)?
2. **Balance.** The two roof role-players can see and shoot the whole public way from 81 ft. With them
   and the two inside, a simple squad lost every run. Keep the drill this hard, move the roof pair
   inside the headhouses, or lower their detection?
3. **More floors as missions.** Floors 2–6 now render from their own models. Each could become a
   mission, using its reconciled program as rooms and the same covering rule and test pattern. Which
   floor first?
4. **B1.** B1 stays out of the drill. A B1 mission needs the sandboxed-clone rule (learners never touch
   live B1) and your approval.
5. **Publish the viewer?** Codex's building viewer works but sits in `_unfinished/`, with a 404 and a
   cramped phone layout. Should it be fixed and published, or left as a tool?
