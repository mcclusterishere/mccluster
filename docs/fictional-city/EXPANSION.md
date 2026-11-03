# McCluster City — expansion around Equity Uprise HQ

Date: 2026-11-03. Owner request: make the city substantially larger, richer and better connected around the
Equity Uprise HQ, keeping the city already built. This file is the plan, the placement contract and the
before/after record. Lore (names, people, dialogue, items, bribes) is authored separately in
`core/data/fictional-city/district.v1.json` (schema revision 2, PR #720); this work owns geography.

## 1. Baseline (main `d4361152`, before this change)

| Measure | Baseline | How measured |
| --- | ---: | --- |
| Walkable area | 11,978 m² | `walkableArea()` on the original collision world, 1 m grid (`scripts/test/fictional-city-places.test.mjs`) |
| Land masses | mainland block 144 × 103 m, 10 × 26 m footbridge, 40 × 40 m island | `DISTRICT_SURFACES` |
| Street-bounded blocks | 3 (north row, south row, island) | plan |
| Ways out of the original block | 1 (the footbridge) | path search |
| Enterable buildings | 9 (8 shops + garage) | manifest |
| Other destinations | HQ doorway, globe kiosk | scene targets |
| People / items | 27 / 24 | manifest |
| Opening view, 1280 × 900 | 73 draw calls, 24,026 triangles | `VERIFICATION.md` (SwiftShader) |

## 2. First-release targets and what shipped

Targets were set after measuring: at least 5× the walkable area, four new connected neighbourhoods, at least 30
new doors, more than one way out of the original block, no change to the original block's coordinates, the HQ
kept at its size and place, and an opening view within the existing preview budget (< 300 draw calls).

| Measure | Delivered | Notes |
| --- | ---: | --- |
| Walkable area | 74,386 m² (6.2×) | same method |
| Neighbourhoods | original block + island + 4 new | `civic-center`, `hq-waterfront`, `northside-residential`, `workshop-waterfront` |
| Street-bounded blocks | 15 | original 3; Civic Center 2; HQ Waterfront upland 2 and quay 2; Workshop Wharf 3; Northside 3 (north of Hillside Lane, between the lane and Harbor Boulevard, south of the boulevard) |
| Ways out of the original block | 5 + 2 reserved | footbridge; Harbor Boulevard west and east; both wharf walks south-west and south-east. The two north walk links at X ±32 belong to the separately built Bridgeport neighbourhood |
| Parcels with doors | 33 new + 9 original | 21 claimed by lore businesses, 10 houses (one per family), 2 generic scenery buildings |
| Enterable buildings | 30 | 9 original + 21 lore businesses (generic interiors until lore styles them) |
| Landmarks / discoveries | 6 landmarks + 6 neighbourhoods found on foot | two are HQ lookouts with an interaction |
| People / items / paid interactions | 76 / 48 / 4 bribes | from lore revision 2; minors never offer a bribe |

## 3. Plan (north up; −Z is north)

```
 Northside Commons (park)  │ ░░░░░░░░░ reserved: Bridgeport neighbourhood ░░░░░░░░░░░
 house-01..05              │ ░░ X −165…165, Z −345…−58, built and merged separately ░░
 ═ Hillside Lane ═         │ ░░░░░░░░░░ walk links at X ±32 on Z −58 ░░░░░░░░░░░░░░░░░
 house-06..10      N       │ Hospital Church Police │ TEA HORDASH HAWK R1S │ Apparel 01 02
 public school     A       │        Civic Plaza     │   (garage behind)    │
 ═══════════════ Harbor Boulevard (Northside ← Civic ← original → HQ Waterfront) ════════
 Northside Field   v       │ 02 01 WA Night school  │ GEAR CAMERA PTV BAD  │ shop-03 shop-04
                   e       │ 03   04                │  harbor promenade    │
                           │═ Foundry Wharf ═  ╔═══════ bay ═══════╗  ═ Harbor Quay ═
                           │ workshop-01..03   ║    footbridge     ║  HQ     Harbor hall
                           │═ Slip Lane ═ Wharf║      [ HQ ]       ║ Promenade
                           │ workshop-04..06   ║ pier  island  pier║
                           │ warehouse   Walk  ╚═══════════════════╝
                           │════════════════════════ sea wall ═══════════════════════════
```

Northside sits north-west of Civic Center (X −296…−168, Z −170…45). The area directly north of the original
block, X −165…165, Z −345…−58, is reserved in `places.v1.json → frame.reserved` and kept free of land, streets,
parcels, props, chunks and blockers for the separately built Bridgeport (Robbery 1s) neighbourhood (PR #721,
`district.v1.json → neighborhoods`, `js/fictional-city/bridgeport-geometry.mjs`), which joins the original block
by two walk links at X ±32, Z −58. A test enforces that this contract never draws there.

The island, its footbridge and the HQ are untouched: same 72 ft plate, same position, same doorway. The bay
between the two new wharves keeps the island an island; the HQ faces you from both wharf walks, both piers and
the original harbor promenade.

## 4. The placement contract (`core/data/fictional-city/places.v1.json`)

One geography authority, joined to lore only by stable IDs.

- **Frame.** Metres, +X east, +Z south, +Y up, origin on Harbor Boulevard at the original block's centre.
  `frame.georeference` is the single documented anchor a later region (a georeferenced map, WGS84 → local
  east-north-up metres with a floating origin) fills in; it is `unanchored` today and nothing assumes the
  district is the whole world. `frame.distinctFrames` records the four contracts that are never resized to
  match: city metres Y-up; canonical HQ GLBs metres Z-up; the HQ adapter's 12 ft = 3.6576 m cells; PRIM3
  tactics' 3.54 m tiles (`js/prim3-tactics/scale.mjs`). An engine floor index (B1 is z8) is not an altitude.
- **HQ placement.** The building is rotated 180° about its centre at (0, 88) so its Floor 1 public entrance
  faces the footbridge: `cityX = −(xf − 36)·0.3048`, `cityZ = 88 + (yf − 36)·0.3048`,
  `cityY = 0.16 + elevationFt·0.3048`. The public door lands on the plate's north face; the island doorway
  anchor (0, 74) maps onto the building's own public approach. Tested in `fictional-city-places.test.mjs`.
- **Surfaces** (land, quays, bridge, piers) and **streets** are rectangles; open water is everything else.
- **Parcels**: footprint, height, front, entrances, neighbourhood, chunk. The 31 contract IDs
  (`civic-center/police-station` … `workshop-waterfront/shop-06`) plus two scenery parcels.
- **Legacy parcels** mirror the original nine buildings' authored coordinates; a test keeps them equal to
  `district.v1.json`, so the original block cannot drift.
- **Anchors**: `hq-bridge`, `hq-doorway`, `garage` (alias of `whip-equipped-garage`), street junctions. The eight
  original business IDs resolve to their doors.
- **Landmarks**: discoverable on foot; `interaction: "hq-view"` opens an HQ lookout.

### Binding lore (for the lore author)

`js/fictional-city/places.mjs → bindCity()` merges `expansionBusinesses`, `expansionNpcs`, `expansionItems` and
`families` into the runtime and resolves:

| Lore field | Effect |
| --- | --- |
| business `parcelId` | the business is drawn on that parcel, enterable, its door is the parcel entrance; a second business naming the same parcel is not placed |
| resident `placement: "route"` + `routeAnchors` | walks a resolved, collision-checked path through the anchors (parcel IDs, anchors or original business IDs) |
| resident `placement: "interior"` + a parcel business | stands inside that business |
| resident `homeParcelId` with no business | stands by the house's front door |
| family `parcelId` | the house carries the family name; knocking shows the family and its members |
| `interactions: [{ type: "bribe", id, label, price, npcIds, outcome }]` | offered on the business and by each listed adult; spends city credits by the purchase rules; refused when short; logged in the save. Minors never offer one. Unknown types are ignored |

Unknown parcel or anchor IDs fail the publisher (`tools/publish-fictional-city.mjs`). Geography never goes into
the lore file (Core's 512 KB limit) and lore never goes into the places file.

## 5. Streaming, detail and performance

- **Chunks** are 64 m squares (`c{floor(x/64)}_{floor(z/64)}`), derived from places by
  `js/fictional-city/chunks.mjs`: road pieces clipped exactly at chunk edges, the parcels whose centre lies
  inside, and deterministic street furniture. The publisher writes one JSON per chunk plus an index with
  byte length and SHA-256. The scene takes any tile source with the same shape: an index
  `{ chunks: [{ id, bounds, file? }] }` and `loadChunk(id) → { id, roads, props, parcels }`, so a second
  source (a georeferenced region) can feed the same loader.
- **Load/unload**: load when the player is within 72 m of a chunk's rectangle, unload beyond 112 m
  (hysteresis). A failed download draws massing from the always-resident places data and retries with
  backoff (2, 4, 8 … 30 s); a malformed or hash-mismatched chunk counts as failed.
- **Collision is never streamed**: the city's surfaces and footprints (a few dozen rectangles) are always
  resident, so a body can never fall through a missing chunk and NPCs keep their state.
- **People**: outdoor patrols keep walking while unseen; residents farther than 85 m are not drawn.
- **HQ**: near detail (floor bands, slab edges, roof) within 115 m, one massing box beyond. The canonical HQ
  GLBs are prefetched when the player comes within 30 m of the island and open only through the existing
  doorway, `prim3-transit.html?level=equity-uprise-hq`.
- The original block, footbridge and island are the resident hub, drawn exactly as before.
- The scene reads chunks through one interface, so the reserved neighbourhood (or any later region) can be a
  second tile source rather than more entries in this file.

## 6. PRIM3 and the shared places

`js/fictional-city/tactical.mjs` derives a PRIM3 board from the same places for any rectangle of the city
(tile = `TILE_M`; tactical y grows south as city +Z does, no axis flip): parcels are blockers as tall as the
building, water is a zero-height blocker, bridges and piers stay walkable surfaces over the water mask, and
every parcel/anchor maps to a tile. A test plays the real resolver from the mainland to the island doorway
across the footbridge. #711's OpenStreetMap converter output maps into the same contract
(`tools/prim3-city/places-adapter.mjs`): geometry and height provenance only, synthetic IDs, no real names,
ODbL attribution. The committed Jersey City sample stays Jersey City and is converter verification only; the
playable city uses no real geography. Free walking stays continuous; tactics is a separate mode on the same
places.

## 7. Equity Uprise HQ and B1

- The city never edits building authority; the context audit, repo-source and program-coverage verifiers pass.
- B1 stays an ordinary floor. `scripts/test/fictional-city-hq-b1.test.mjs` walks an ordinary operative from the
  street through the public door, down Stair B to B1, across the basement and up Stair A on the real resolver,
  with no role, flag or unlock in the level configuration. #715's `equity-uprise-b1` defend/attack level is kept.
- #715 → #713: the B1 mission's live camera-link ledger is now mirrored into the building screens' MISSION
  session (`HOOKS.screenFaults`, `js/prim3-tactics/transit.mjs`); WORKPLACE never sees it, and a restore in the
  game brings the camera back on the screens (`scripts/test/equity-uprise-mission-screens.test.mjs`).
- #714's server lab is not integrated into the stacked HQ; its MDF location conflict (B1 builder telecom room
  X32–52 / Y22–34 vs. the electronics MDF rack anchor at (45, 62.8)) is recorded in `PROJECT-STATE.md` and is not
  resolved here.

## 8. Save

`here.universe.mccluster-fictional-city.state` is now version 2. A v1 save keeps credits, inventory, receipts,
met, visited, story chapter and position (the original block kept its coordinates); v2 adds `discoveries` and
`payments` and widens the bounded local position to the city's frame. The Bridgeport story's `arcs` progress
(PR #721, written as v1) migrates intact. A v1 position outside the old bounds falls back
to the spawn. Later travel state (regions, planet) will be a separate field; the city position stays local.

## 9. Implemented / partial / future

Implemented: the four neighbourhoods, streets, wharves, piers and parks; parcel doors and generic interiors;
lore binding; bribes; discoveries; HQ lookouts; streamed chunks with fallback and integrity checks; HQ LOD and
prefetch; v2 save; places-driven PRIM3 boards; #711 converter mapping; B1 traversal and mission→screens checks;
Pages publication and live verification of every new file.

Partial: generic interiors for lore businesses (one shop room, not per-business layouts); houses are not
enterable; no free-roam HQ interior in the city (the doorway opens the existing detailed exercise).

Future, not claimed: driving, traffic, combat, generative NPCs, voiced or filmed scenes, Bridgeport or any other
real-geography ingestion, region/planet travel, per-business interiors, cloud saves.

## 10. Integration notes (after #720, #721 and #723 merged)

- **Authored vs surveyed ground.** Everything in `places.v1.json` is an authored plan, not a survey. The
  Bridgeport neighbourhood (#721, `district.v1.json → neighborhoods`) is the only surveyed ground (CT State GIS
  Office 2023 footprints, © OpenStreetMap contributors streets, ODbL); the city map says so under the map and
  draws both. This contract never places parcels, streets or lore on the Bridgeport ground.
- **Lore display names.** Neighbourhood names shown to players come from the lore's `expansionNeighborhoods`
  (e.g. `northside-residential` is shown as its lore name); IDs and the places file's plain names are unchanged.
  The new neighbourhoods are not promoted into #721's `neighborhoods` array: that array is for playable areas with
  their own surfaces/roads/places and its validator; the new areas' geography lives here and lore stays in the
  expansion arrays, so there is one data contract per concern.
- **Civic institutions.** The owner named them on 2026-11-03: `civic-center/police-station` is the real
  Bridgeport Police Department (300 Congress Street) and `northside-residential/public-school` is the real Harding
  High School (379 Bond Street); `civic-center/church` stays the fictional Tabernacle. The two real
  institutions carry `realInstitution: true` on their parcels. Their parcels are in the authored harbor plan, not
  at their surveyed locations: their identity and address are `verified` and their footprint and coordinates are
  `authored` in each record's `realInstitution.fieldProvenance`. Placing them at their real addresses is a later,
  sourced geography change (CT footprint plus OSM ODbL attribution). The lore's paid
  interactions now sit on `hq-waterfront/shop-01` (Bail Mary Bail Bonds), never on a real institution.
- **Stable IDs for future portals.** Parcel IDs (`<neighbourhood>/<parcel>`) and the original business IDs are the
  stable place IDs a later `placeId` game portal can target; nothing here builds arcade or Designer Kicks mechanics.
- **A region as a second tile source (#723).** The scene's chunk loader takes `{ chunks: [{ id, bounds, file }] }`
  and `loadChunk(id)`. A region (e.g. `regions/connecticut-pilot.v1.json`) plugs in by supplying its hashed chunk
  index in city metres (after `georeference.mjs` projects it) and a loader that returns `{ id, roads, props,
  parcels }` or a richer shape the scene learns to draw; its collision must be supplied outside the authored mask.
  The authored frame is `frame.bounds` X −296…168, Z −170…140 plus Bridgeport X ±165, Z −345…−58; a mask for the
  region should use those, not the original X ±168 estimate. Not wired in this PR.
