# Equity Uprise HQ — Interior Rebuild v2 (Floors 1–7), Blender set

> Status: **editable Blender set built and machine-verified (80/80 checks), now merged with the existing furnished
> floors (v2.1, below); visual approval by the owner is open.**
> Schematic visualization only. **NOT FOR CONSTRUCTION.** Generated images are never geometry authority.

`EU_HQ_Interiors_v2.blend` is a new, separate Blender file (Blender 4.2 LTS format; opens in 4.2 and later). It rebuilds
the interiors of Floors 1–7 on the canonical Core V2 shell, using the seven approved GPT Image boards for furniture,
materials, equipment, lighting and mood and the seven north-up placement overlays plus `asset-map.csv` (52 anchors) for
placement. No existing `.blend` or `.glb` was opened for writing, and nothing in the website, Worker or database changed.

## v2.1 — merged with the existing interior layer (2026-11-28)

The first v2 build threw away the floors' existing furnishing and redrew it from the boards. Its shell classifier
dropped **all 286 pieces of the v3 interior layer** (`floor-0X-interior-layout-v3.json`: catalog-sized pieces with
stable IDs, zones and program sources, including the named staff desks), about 100 other builder objects (room
displays, gallery and archive frames, review surfaces) and never loaded the 98-device workstation layer. That broke
the building contract ("no destructive forgetting: apply new research to the best existing design").

v2.1 keeps the existing design and applies the pack to it. `hq_interior_v2_merge.py` decides piece by piece, using
the real mesh outlines and heights:

- **R0** a whole existing zone an owner requirement replaces (only F6 `command-preparation`, see open items).
- **R1** an approved anchor is always built at its CSV point; an existing piece it sits on is superseded. When the
  anchor is a re-make of that piece at the same point (F2 forum, F3 exchange and Interview A, F5 policy, F6 command
  tables), the table is replaced and **its existing seating is kept**.
- **R2** the seats of a superseded table or desk go with it.
- **R3** an anchor's companions (chairs, screens, lamps) give way as a group to the existing composition.
- **R4/R5** board dressing (S-tags) and board rugs are dropped where an existing piece or rug already does the job.

Everything else that exists is kept and restyled with the floor's board palette (the builder's vertex-colour roles
are remapped: upholstery, leather, wood, rug, stone, metal...). Repeated existing pieces share mesh data. Devices
stay where their bound support stays. Every decision, with its reason, is in `EU_HQ_Interiors_v2-build-report.json`
(`floors.N.merge`) and on each floor collection (`eu_merge`); every kept piece and device is in the inventory CSV.

| Floor | v3 pieces kept | superseded | restored builder objects | pack rows dropped | devices kept | existing pieces moved |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | 21 / 35 | 14 | 2 | 10 | 4 / 8 | 0 |
| F2 | 44 / 48 | 4 | 2 | 15 | 4 / 4 | 0 |
| F3 | 43 / 49 | 6 | 4 | 26 | 8 / 8 | 2 |
| F4 | 43 / 52 | 9 | 7 | 12 | 21 / 24 | 2 |
| F5 | 36 / 55 | 19 | 11 | 11 | 24 / 24 | 0 |
| F6 | 32 / 47 | 15 | 5 | 9 | 18 / 18 | 7 |
| **Total** | **219 / 286** | **67** | **31** | **83** | **79 / 86** | **11** |

Notable outcomes: F2 keeps its eight forum armchairs (the historical eight-seat composition) around the approved oval
table instead of the board's twelve; F3 keeps its six exchange chairs; the named staff desks on every floor (Grace,
Valeria, Chioma, Thandiwe, Sari, Nusrat, Arjun, Rafael, Aya, Priya, Maren, Oksana, Leila, Amira, Li, Marc, Helen) are
back; the F2 cohort workshop, F3 field-ops planning, F4 interview set and brand studio, F5 carrels and reading corner
and F6 director's office are back. Superseded pieces are mostly the tables/chairs the anchors re-make (intake, passport,
source/publication review, strategy/briefing rooms) and the F6 strategy and briefing room furniture.

Moved existing pieces (the walking routes now count furniture as obstacles, and these blocked a room door or grazed
a wall): `F3-LOUNGE-PLANT-02`, `F3-INTERVIEW-B-PLANT-01`, `F4-RECORDING-SCREEN-01`, `F4-EDIT-VISITOR-CHAIR-01`,
`F6-SALON-PLANT-02`; the board's F6 salon
round table moved north from Y21.4 to Y23 with diagonal seats for the same reason.

**Meshes upgraded in place.** After the merge, 131 kept v3 pieces have their mesh swapped for the matching board-kit
master (`MG.UPGRADE`): side and wood chairs, lounge and club armchairs, meeting tables, desks, stools, planters, side,
coffee and round tables, credenzas, bookcases, library stacks (archive shelving), sofas, banquettes, poufs and mobile
boards. Each is a kit instance with the same ID (`eu_existing_id`), world position and facing (v3 faces +Y, the kit
-Y, so +180 deg), scaled to the v3 catalog footprint; tables, desks and storage also take the catalog height, so
clearances, device supports and device heights are unchanged, while seats and plants keep the kit's proportions. They
pick up the kit's wood-grain, stone and fabric shaders and the floor's board palette. The scale applied is stored on
each instance (`eu_upgrade_scale`). Task and executive task chairs stay v3: the kit's task chair is a plainer slab
(checked in the F6 eye render), as do rugs, files, carrels, the F4 set equipment, the sectional, the L-desk and other
specialist pieces the kit has no equivalent for. Two upgraded pieces grazed a wall and were nudged 0.5–1.2 ft
(`F3-INTERVIEW-B-PLANT-01`, `F4-EDIT-VISITOR-CHAIR-01`; recorded in `ADJUST`).

## Where it was built, and how to get it onto Prime

Prime (the Windows HP) was **not connected** to the cloud session that did this work: no Remote Control folder was
available, so the source pack under `C:\Users\Mattm\Documents\Equity Uprise Show\HQ Blender Studio\References\HQ Interior Concept v2`
and any `.blend` files on Prime could not be read or written. The build therefore ran in the session's Linux container
with the official Blender 4.2.0 Python module, from the same pack, which is committed on the reference branch
(`docs/equity-uprise-hq-interior-concepts`, draft PR #871). All 17 files in that pack match its `SHA256SUMS.txt`, and the
uploaded ZIP is byte-identical to the branch copy for the 10 files it contains (it carries no PNG boards).

To put it on Prime, pull this branch and copy `EU_HQ_Interiors_v2.blend` into the Show project, for example
`...\Equity Uprise Show\HQ Blender Studio\EU_HQ_Interiors_v2.blend`. It is self-contained (no linked libraries, no
external images). To rebuild it on Prime from the same sources:

```bat
REM 1) generate the gitignored floor GLBs with the official builders (Python with trimesh)
for %f in (01 02 03 04 05 06) do python docs\design\equity-uprise-building\production\floor-%f\build_equity_uprise_floor_%f_v2.py
REM 2) build the set (point --pack at the Show project's copy of the approved pack)
blender --background --factory-startup --python docs\design\equity-uprise-building\production\hq-interior-v2\build_hq_interior_v2.py -- ^
  --repo . --pack "C:\Users\Mattm\Documents\Equity Uprise Show\HQ Blender Studio\References\HQ Interior Concept v2" ^
  --out "C:\Users\Mattm\Documents\Equity Uprise Show\HQ Blender Studio\EU_HQ_Interiors_v2.blend"
REM 3) verify in a fresh Blender process, 4) render the review set
blender -b --factory-startup --python ...\hq-interior-v2\verify_hq_interior_v2.py -- --blend <file> --repo . --pack <pack> --out hq-interior-v2-verification.json
blender -b <file> --python ...\hq-interior-v2\render_hq_interior_v2.py -- --outdir renders --samples 64
```

`--out` must be a new path. The script never touches the canonical GLBs; it imports them.

## Files

| File | What it is |
| --- | --- |
| `EU_HQ_Interiors_v2.blend` | the editable set (compressed) |
| `build_hq_interior_v2.py` | deterministic builder (authority order below) |
| `eu_hq_kit.py` | the instanced furniture/equipment kit (original procedural geometry; no marks) |
| `hq_interior_v2_layout.py` | per-floor placement: the 52 CSV anchors plus board dressing |
| `hq_interior_v2_merge.py` | v2.1 merge rules with the existing v3 interior layer, devices and restored objects (pure Python) |
| `verify_hq_interior_v2.py` | fresh-process reopen and verification; writes the report and the inventory |
| `render_hq_interior_v2.py` | review renders (top-down, eye level, board-matching, before/after) |
| `hq-interior-v2-verification.json` | 80/80 checks with details (stacking, routes, collisions, merge, deviations) |
| `hq-interior-v2-asset-inventory.csv` | every placed asset keyed to the overlay tags, with source and inferred/anchored status |
| `EU_HQ_Interiors_v2-build-report.json` | source GLB hashes, pack hashes, per-floor counts |
| `source/` | hash-checked copies of `asset-map.csv`, `place-asset-proxies.py` and the seven `F0X-Asset-Placement.svg` |
| `renders/` | review images (JPEG) |

## Source inventory (what the build read)

- Rules: repository `AGENTS.md`, `docs/design/equity-uprise-building/AGENTS.md` (context audit passes), `REFERENCE-AUTHORITY.md`,
  `BUILDING-CORE-V2-SPEC.md`, the F1–F7 specs, `HALO-GLOBE-SPATIAL-INTELLIGENCE-SPEC.md`, `production/brand/brand-manifest.json`.
- Canonical HQ model (imported unchanged into `_SOURCE_REFERENCE_readonly`, excluded from the view layer; SHA-256 in the build report):
  `production/generated/equity-uprise-building-core-v2.glb` (combined chassis), `equity-uprise-basement-b1-core-v2.glb`,
  `equity-uprise-floor-07-core-v2.glb`, and `equity-uprise-floor-01…06-core-v2.glb` regenerated with the official builders
  (they are gitignored build outputs). **No `.blend` of the HQ exists in this repository**; the `.blend` files on Prime
  could not be inventoried from this session.
- Overlays: seven north-up `F0X-Asset-Placement.svg` (11.5 px/ft from the south-west corner); every room rectangle was
  parsed to plan feet. All 52 coloured markers match the 52 CSV rows (F1 7, F2 7, F3 9, F4 8, F5 8, F6 8, L7 5).
- DXF links: the seven Core V2 DXF/SVG plan pairs in `references/floor-0X/` (all present). The shell is not traced from
  them; it is the official builders' geometry, which derives from the same authority, and is checked against the
  overlay plans (below).
- Proxy placement script: the pack's own `place-asset-proxies.py` is executed inside the build, creating
  `EU_Concept_Asset_Proxies/EU_CONCEPT_F0X/EU_PROP_<tag>_<asset>`; every anchored asset reads its X/Y back from that empty.
- Boards: `EU-HQ-01…07` PNGs (1312 × 1199), used for furniture, materials, equipment, lighting and mood only.

## Collections

```
EU_HQ_Interiors_v2
  B1_CrewHub_existing_unchanged        canonical B1 model at -13.5 ft, as built (crew hub kept)
  F01_Arrival_Intake … F07_Roof_Mobility
    F0X_Shell                          exterior walls, cores, shafts, stairs, partitions, doors, glazing, slab (from the builders)
    F0X_ArchFinishes                   feature walls, rugs, felt, fixtures, signage; F0X_Ceilings (toggle for plan views)
    F0X_Furniture                      collection instances of the kit
    F0X_Equipment                      kit equipment, kept back-of-house equipment; F0X_LifeSafety_kept
    F0X_Lighting                       ceiling panels, pendants, lamps (instanced lights)
    F0X_Cameras                        CAM_F0X_TOP (plan, cut 9.5 ft AFF), CAM_F0X_EYE (datum 36,28 at 1.65 m), CAM_F0X_BOARD
    F0X_Interaction_and_Anchors        interaction anchors, brand slots, story markers
  EU_Concept_Asset_Proxies             the pack's 52 anchor empties (hidden)
KIT_Assets (excluded)                  67 masters, instanced 343 times (mean reuse 5.2×)
_SOURCE_REFERENCE_readonly (excluded)  combined chassis + official F1–F7 "before" models
WORLD_Light_and_Sky                    sun, sky, neutral ground plane (backdrop only)
```

Per-floor finishes come from custom properties on each instance (`eu_wood`, `eu_fabric`, `eu_stone`, `eu_accent`,
`eu_rug`), so one kit mesh serves every floor: oak/olive F1, oak/terracotta F2, walnut/teal F3, walnut/burgundy felt F4,
oak/olive-grey F5, walnut/cognac/dark stone/brass/smoked glass F6, galvanized steel/teak L7, pale concrete and blackened
steel throughout. To restyle one object, edit its custom properties; to restyle every instance, edit the master in `KIT_Assets`.

## Floor by floor

- **F1 Arrival + Intake:** fluted olive reception counter with stone top (1.1), oak slat Journey Wall with light lines and a
  planter crown (from the board) behind the Journey display (1.7), passport stations (1.2 + one more from the board),
  hot desk (1.3), orientation banquette with cafe tables and boucle chairs (1.4), glass intake room (1.5), directory (1.6),
  atrium lounge kept west of the vestibule-to-reception axis, vestibule trees, and the **Arrival & Intake coat rack** (kept).
- **F2 Public Forum:** 12 × 10 ft oval forum table with 12 terracotta chairs on a terracotta rug (2.1), terracotta slat wall
  with the three-screen media unit (2.4), listening banquette with cafe tables (2.2), check-in (2.3), three workpoints (2.5–2.7).
- **F3 Fellowship + Network:** 16 × 4 exchange table with 10 teal chairs (3.1), teal network wall with pin boards,
  Matthew's fellowship desk (3.2), four workpoints and the tech bench (3.3–3.6), interview rooms A/B (3.7, 3.8), lounge.
- **F4 Media + Culture (rooms preserved):** burgundy felt release wall with the cinema screen (4.2), screening group (4.1),
  Culture Archive with vitrine and framed releases (4.3), Creator Recording Room with vocal rig (4.4), Edit / Review
  Suite (4.5), production desks, gear locker and road cases in Media Equipment / Storage (4.8).
- **F5 Policy + Proof (archives preserved):** 16 × 5 policy table (5.1), oak policy/publication wall, Evidence + Proof
  Archive with steel archive shelving, olive flat files and the reading station (5.2, 5.3), research carrels, source
  and publication review rooms (5.4, 5.5), secure evidence locker (5.8).
- **F6 Executive Command:** stone command table, **six seats** (spec maximum) (6.1); dark stone and walnut command wall;
  **`F06_PRIM2_SCREEN`** — a separate interactive object with anchor `IA_F06_PRIM2_SCREEN`; salon (6.3); Li and Marc in
  the strategy/briefing rooms (6.4, 6.5); Helen at the command floor (6.6); roof transition kiosk (6.7); the one
  **`F06_HALO_GLOBE`**, suspended (no plinth; glass sphere, luminous graticule, three rods to a ceiling canopy) with anchor
  `IA_F06_HALO_GLOBE`; and **Matthew McCluster's executive suite** beside it (furniture-height smoked-glass screens, executive
  desk, credenza, globe-view chairs; story staging, no new walls). The **McCluster office brand slot** exists only here, as
  an empty named slot `F06_BRAND_SLOT_mccluster-office`: no artwork is drawn; assign the supplied artwork at runtime.
- **L7 Roof + Mobility:** canonical L7 deck, parapets, headhouses, overruns, mobility reservation and routing objects kept;
  routing beacon (7.1), overlook bench, bollards and planters (7.2, 7.3), weather console (7.4, moved, see below),
  plant (7.5 = the existing L7 mechanical unit). Signage stays destination-agnostic.

## Verification (fresh-process reopen) — 80/80

From `hq-interior-v2-verification.json`:

- Reopens with no linked libraries and no missing images; all 343 instances resolve to their kit masters.
- Each floor has the seven separate collections and its top + eye cameras; B1 present unchanged; sources excluded.
- 52/52 anchors are realised as named objects; 50 sit on their CSV X/Y (≤ 0.05 ft); two are documented deviations (below).
- Stacking: on F1–F6 the passenger elevator (X54–62/Y34–44), freight (X0–8/Y60–72), Stair B (X8–18/Y54–72) and Stair A
  (X60–72/Y54–72) sit on the Core V2 lines, and each slab top is at its FFE (0, 13.5, 27, 40.5, 54, 67.5 ft). The
  combined chassis agrees. The passenger elevator door is identical on F1–F6 (west face X54, Y37–41), **including the F6
  arrival**; on L7 the overrun sits over the same shaft and no roof elevator stop is modelled.
- Every enclosed room and core shaft on the seven overlay plans is closed by the shell; the only openings are door-width (≤ 3.5 ft).
- Walking routes, 36 in clear on open floor: on every floor from the elevator arrival to both stairs, the freight
  elevator, the north corridor and each room door; on F1 also from the public entrance to the reception visitor side.
  On L7 from Stair A to Stair B, the overlook, the routing beacon, the console and the plant-access face. All 52 anchors
  are reachable; the anchors inside enclosed rooms (1.5, 3.7, 3.8, 4.4, 4.5, 4.8, 5.4, 5.5, 5.8, 6.4, 6.5) are reached
  through their 3 ft doors, which the 6 in grid resolves as at least 30 in.
- No furniture or equipment intersects a wall, core, shaft, stair or glazing (exact boxes; plants measured at the pot).
- v2.1: the walking routes count the kept existing furniture as obstacles. Every v3 piece on F1–F6 is either present
  or superseded with a recorded reason (213 + 73 = 286). Every kept device stands on a kept support. No kept existing
  piece overlaps a pack piece (convex hulls of the real vertices, same height band, > 0.25 sq ft).
- One Halo Globe, centre (55, 12) at 8.25 ft AFF, radius 2.25 ft, nothing beneath it; one PRIM2 screen; both interaction
  anchors exist and point at their objects; the McCluster office slot is on F6 only; no logo or wordmark geometry.

These are geometric checks of the model, not code, egress or accessibility certification.

## Renders

`renders/` (Cycles, CPU, 40 samples + denoise, AgX): for each floor `F0X_TOP` (plan check, cut at 9.5 ft AFF, north up),
`F0X_EYE` (canonical datum (36, 28), 1.65 m, facing north) and `F0X_BOARD` (south, elevated, framed like the approved
board), plus `F06_HALO_SUITE` and `F01_ENTRY`. Before/after for F1 and F6 use the same cameras on the unchanged
official builder models (`BEFORE_F0X_*`), with the same ceiling lights; `compare/` holds side-by-side sheets with the
approved board.

## Inferred dimensions and placements (please review)

- **All "board dressing" rows** (tag `S…` and companions such as chairs, screens and lamps of an anchored desk) are
  placed by this build from the boards; each is listed in the inventory with `inferred placement`. Notable ones: the
  coat rack at (6.5, 8.0) on F1; the second passport station (36.5, 37); the atrium lounge group at X20–31/Y14–24; the F4
  production desks (30.5, 30.4) and (41.5, 30.4); the F5 research carrels at Y32.4; and Matthew's suite on F6 at X35–49/Y1–17.
- **Display anchors at Y51.5** (1.7, 2.4, 4.2, 6.2), 0.8 ft deep, are built as freestanding media-wall units in front of the
  feature walls; the feature walls themselves (Y53.2–53.75, 9 ft high, 10 ft on F6) are inferred and leave both ends of
  the north band open to the corridor.
- **Ceiling height:** taken as the builders' 11 ft wall height (ceiling panels at 10.2 ft; Halo canopy at 11 ft).
- **Eye height 1.65 m** (pack README) rather than the specs' 5'-4" (1.626 m) 360 datum.
- **Kit sizes** (chairs, sofas, lamps, plants, credenzas, rugs) are generic proxies, not vendor measurements; the CSV
  envelopes are honoured for every anchored asset.
- **Halo headroom:** the canonical envelope puts the sphere's underside at 6.0 ft AFF, below normal door headroom (6'-8").
  A dark stone floor inlay with a brass ring marks the envelope and the nearest furniture stays 4.5 ft clear of the sphere's footprint. This needs an owner
  or design decision before the space is treated as walkable underneath.

## Deviations from the overlay (source geometry wins)

- **7.4 WEATHER_CONSOLE:** the CSV point (38, 66) falls inside the canonical L7 model's `F7-MECH-UNIT-01` (X35–40/Y62–68).
  Moved 6.5 ft to (31.5, 66), facing west, with plant access kept clear.
- **7.5 MEP_PLACEHOLDER:** a visual plant proxy for plant the L7 model already has (`F7-MECH-UNIT-02`, X41–46/Y62–68).
  Realised by tagging that existing unit (2.5 ft from the CSV centre); no duplicate added.

## Image drift not followed (the plan wins)

Stair, freight and riser positions drawn differently on several boards; the F6 globe pedestal (README: do not build);
the F6 board's 12-seat table (spec: six seats maximum); the F5 board's glazed east room and the F7 board's pergola duty
station (not in the plans); concrete piers and east/west window bays (the source floor shells have none; the facade is a
separate canonical layer); the F2 board's oval check-in desk (the plan's kiosk zone is 2 × 5 ft); the PRIM2 wordmark on
the F6 screen (no wordmark is modelled; the screen is the interface).

## Open items

- **F6 preparation desks (resolved, owner 2026-11-28):** Matthew's suite occupies the old `command-preparation` zone, so
  `F6-BRIEFING-PREP-DESK-01..03` moved next to Helen's office, continuing Li's and Marc's governance desk line along
  the east wall (centres X69 / Y34.5, 41, 47.5, facing west). Each desk moved as a rigid group with its chair and its
  bound devices (`F6-USER-WS-04..06` and their monitors), so every device still sits on its own desk (`MG.RELOCATE`).
- **Duplicate people (v2.1):** the CSV names Grace (1.2), Valeria (1.3), Chioma (2.5), Thandiwe (2.7), Sari (2.6),
  Nusrat (3.3), Arjun (3.5), Rafael (3.6), Aya (3.4), Oksana (5.4), Leila (5.5), Amira (5.6), Li (6.4), Marc (6.5) and
  Helen (6.6), plus Priya (4.6) and Maren (4.5), at the anchored stations, while the kept workplace layer still has their own named desks. Both are in the
  set; the owner should say whether the anchors replace those desks or are second work points.

- Owner visual approval on Prime, and a pass at the higher sample counts Prime's GPU allows.
- McCluster office artwork for `F06_BRAND_SLOT_mccluster-office` (no supplied variant exists in `brand-manifest.json`).
- Halo underside headroom (above).
- The kit is proxy-grade: real products, fabrics and plant models can replace kit masters in place (instances update).
