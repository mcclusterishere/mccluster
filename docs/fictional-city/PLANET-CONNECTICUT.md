# McCluster Planet: Connecticut pilot data foundation

Status, 2026-11-03: Phase A region contract plus the data-preparation half of Phase B. Nothing here is wired
into the scene yet. The city runtime (`js/fictional-city/` outside `planet/`, `fictional-city.html`, places and
chunk loading, saves) belongs to the city work, and this pilot does not edit it.

Owner rule: real geography supplies **geometry and heights only**. Every name, use, tenant, person and story in
the game is invented and lives in the city lore. The region data carries source IDs, outlines, heights and
terrain. The scrub test enforces that.

## Files

| Path | What it is |
| --- | --- |
| `core/data/fictional-city/regions/connecticut-pilot.v1.json` | The canonical region descriptor: frame, statewide and pilot bounds, sources with licences, capture dates and what was verified, height provenance, budgets, the authored-overlay proposal, the environment probe and the generated `chunkIndex` (per-chunk bytes, gzip bytes, SHA-256). |
| `js/fictional-city/planet/georeference.mjs` | A pure module covering WGS84/NAD83 ↔ ECEF ↔ ENU, the owner's named city projection, CT State Plane (EPSG:6434/6433), floating origin, scale contracts and control points. |
| `tools/fictional-city/build-connecticut-region.py` | Stage 1, network: a bounded fetch and crop that writes one normalized source file. |
| `tools/fictional-city/data/connecticut-pilot/bridgeport-harbor-west.source.json` | The committed stage-1 output (181 KB). It holds source coordinates, only the OBJECTID and GlobalID attributes, roof statistics and a 4 m terrain grid. |
| `tools/fictional-city/build-connecticut-region.mjs` | Stage 2, deterministic and offline. It georeferences the crop, simplifies it, builds the LODs and chunks, and writes the manifest. |
| `scripts/test/fictional-city-planet.test.mjs` | Tests for control points, round trips, the named projection, the descriptor schema, rebuild hashes, stable IDs, height provenance, the scrub rule, the budget and the git boundary. |

The derived chunks are written to `data/fictional-city/regions/connecticut-pilot/`. That directory is gitignored
like the rest of `/data/fictional-city/`. Git holds the inputs (the descriptor and the source crop). The builder
regenerates the chunks byte-for-byte, and the descriptor's `chunkIndex` pins every chunk's SHA-256.

```bash
node tools/fictional-city/build-connecticut-region.mjs           # write chunks + index.v1.json
node tools/fictional-city/build-connecticut-region.mjs --check   # fail if descriptor chunkIndex is stale
node tools/fictional-city/build-connecticut-region.mjs --write   # refresh descriptor chunkIndex after a source change
# re-acquire the crop (needs network; raw downloads go to the cache, never git):
python3 -m venv .venv && .venv/bin/pip install pyogrio shapely rasterio numpy
.venv/bin/python -I tools/fictional-city/build-connecticut-region.py --cache /path/outside/git
```

## Frames and units

| Frame | Contract | Owner |
| --- | --- | --- |
| City | metres, +X east, +Y up, +Z south (north is −Z) | `js/fictional-city/` |
| Owner projection `mccluster-city.bridgeport-equirect.v1` | `x = (lon + 73.1903)·111320·cos(41.1798°)`, `z = −(lat − 41.1798)·111320 − 220`, rounded to 4 dp, no rescaling | `georeference.mjs` → `FRAMES` |
| ENU tangent plane | the exact local frame (`createEnuFrame`), used as the measuring reference | `georeference.mjs` |
| CT State Plane | NAD83(2011) / Connecticut LCC; EPSG:6434 ftUS (buildings) and EPSG:6433 m (NOAA DEM mirror) | `georeference.mjs` |
| Vertical | NAVD88 orthometric metres everywhere in region data; never ellipsoidal | the descriptor |
| HQ model | metres, Z-up GLBs; 12 ft = 3.6576 m display cells | the HQ tactical level module in `js/prim3-tactics/levels/` (`WORLD_M`) |
| Tactics | 3.54 m rule tiles | `js/prim3-tactics/scale.mjs` (`TILE_M`, imported, never copied) |

The owner projection is a fixed placement contract. It uses a constant 111,320 m per degree, so against the ENU
plane at 41.18° N it reads about 0.25 % long north–south: about 2.5 m per km, or 6 m at a 2 km corner. That
error is tested and documented, and it must not be "corrected" in place, because placed content depends on it.

NAD83(2011) is treated as WGS84 for placement. The offset in Connecticut is about 1–1.5 m.

Floating origin: `createFloatingOrigin()` keeps world positions in doubles and moves the render origin in 128 m
steps once the player is more than 512 m from it.

Control points come from an independent PROJ run (pyproj, EPSG:6318 → 6434/6433, EPSG:4979 → 4978) at Bridgeport,
New Haven Green, the Hartford Old State House and the State Plane projection origin. The module matches them to
better than 1 mm.

## Sources: confirmed and unconfirmed

All of the following were checked from this environment on 2026-11-03.

| Source | Licence evidence | Capture / publication | Notes |
| --- | --- | --- | --- |
| CT 2023 3D Buildings (CT ECO deliverables page; catalog item `9b42059a…`, scene service `a7a66b43…`, owner `ctgisoffice`) | **CC0**, read from the ArcGIS item `licenseInfo` of the official "Connecticut 3D Buildings" web scene and its scene service. The FGDC metadata says "Access constraints: No restrictions apply to these data" and "Use constraints: None…" with temporal caveats. | Lidar flown 2023-03-22 to 2023-05-07. FGDC pubdate 2025-02-07. Block zips Last-Modified 2025-02-19. | **Confirmed:** statewide 1.4 GB; blocks 117 / 492 / 568 / 251 MB (Block 2 is 503,546,483 bytes); EPSG:6434 ftUS; NAVD88 GEOID18 ftUS. **Unexpected:** the geodatabase holds multipatch "cells" with CAD attributes and **no per-building ID**, and some cells merge many buildings. Its faces supply heights only. |
| 2023 Connecticut Buildings (2D footprints feature service, item `1fc14681…`) | The item's licence field is literally "None", and its access information reads "State of Connecticut GIS Office". The FGDC metadata matches the 3D product (no access or use restrictions). This item is **not** explicitly labelled CC0. | Same flight; FGDC pubdate 2025-02-07. Item modified 2026-01-27. | **Confirmed:** the fields are OBJECTID, Shape__Area, Shape__Length and GlobalID. There are no names. OBJECTIDs can change on a republish, so rebuilds must re-match by GlobalID. |
| 2023 hydro-flattened bare-earth DEM, through the NOAA Digital Coast mirror (dataset 10316) | The metadata gives "Limitations of use: None" with temporal caveats and no access constraints. There is no licence statement. NOAA adds a distribution liability disclaimer. | Captured 2023-03-22 to 2023-05-07. Publication 2024-06-25. | The CT original uses 2 ft cells. The NOAA mirror is EPSG:6433 at 0.5 m. CT metadata names GEOID18, while the NOAA VRT's CRS name says Geoid12B. That discrepancy is recorded and not resolved. Hydro-flattened water reads about −1.17 m NAVD88 here, which is Bridgeport MLLW. |
| CT ECO 2026 flight | n/a | The 2026 imagery and elevation are listed as "coming soon". The 2026 2D and 3D buildings are listed as "coming in 2027". | Use 2023 now and keep capture dates visible. This is not a live building map. |
| OpenStreetMap | ODbL 1.0, © OpenStreetMap contributors | n/a | Not used by this crop. It is the next layer, for street centrelines. Any derived street file keeps the credit and a licence link. |

Fetch notes:

- `https://cteco.uconn.edu` and `maps-cteco.media.uconn.edu` fail TLS verification through this environment's
  proxy, while the CT ECO page itself (`maps.cteco.uconn.edu`) is fine. The zip and the metadata were therefore
  read over plain HTTP. Integrity is pinned instead by zip size, Last-Modified, the zip CRC-32 of each member,
  and the SHA-256 values recorded in the source file.
- The User-Agent is the generic `mccluster-planet-prep/0.1 (+repo URL)` and carries no personal contact.
- No statewide or full-block archive was downloaded. Stage 1 range-reads the zip's central directory, the
  FileGDB system tables and the single feature-class table `a0000003b` (`Block02_C2`: 103.6 MB, 68 MB
  compressed). It asserts that GDAL sees exactly that layer.

## The crop: `bridgeport-harbor-west`

- **Bounding box:** lon −73.1940…−73.1830, lat 41.1695…41.1745. That is about 920 × 560 m on the west bank of
  the inner harbour in downtown Bridgeport.
- **Selection:** complete footprints whose exterior area centroid lies inside the box. The centroid is computed
  relative to the first vertex, because raw State Plane coordinates cancel catastrophically.
- **Why this box:**
  - It holds real waterfront massing, hydro-flattened water and a shoreline in one small box.
  - It sits inside one 3D table, so the lidar read stays bounded.
  - It lies 230 m south of the authored frame bounds, so it overlaps neither the authored district nor the
    separately merged northern neighbourhood. A test checks this.
- **City-frame position:** X −310.0…611.6, Z 370.0…926.6.
- **Result:**

  | Item | Count |
  | --- | --- |
  | Buildings | 59 (all 59 with lidar heights; 2.5 to 57 m) |
  | Chunks | 48 (128 m) |
  | Raw bytes | 286,177 |
  | Gzip bytes | 77,012 (budget: 5 MB) |
  | Largest chunk, gzip | 2.9 KB (budget: 250 KB) |
  | LOD0 triangles, whole crop | 2,258 |
  | LOD2 triangles, whole crop | 590 |

- **IDs:** `ct2023:<OBJECTID>` from the official footprint layer, with the GlobalID recorded beside each one. A
  test reverses the input and drops a building, and every other building keeps an identical ID and geometry.
- **Heights:**
  - `roofY` is the area-weighted 95th percentile of roof-face elevations inside the footprint. The multipatch
    bottom slab is excluded.
  - `groundY` is the median bare-earth post inside the footprint.
  - `heightSource` is `lidar-2023-3d-buildings`, or `estimated-default` when no lidar face exists, which then
    uses a 6 m fallback. The minimum height is 2.5 m.
- **LODs:**
  - LOD0 is Douglas–Peucker at 0.15 m.
  - LOD1 is Douglas–Peucker at 1.5 m.
  - LOD2 is the minimum-area oriented rectangle.

  All are counter-clockwise in (x, z). Coordinates are chunk-relative at 0.01 m.
- **Terrain:** 33 × 33 posts at 4 m per chunk, in NAVD88 centimetres, with null outside the crop.
- **Format:** compact JSON extrusions. Meshopt GLBs were not produced because no glTF or meshopt tooling is
  installed in this repo. Building the visual chunks (merged GLB, meshopt, one atlas) is the next step and runs on
  Core.

## Authored overlay proposal (not implemented)

The McCluster City district, its harbour basin and the HQ island are **authored fiction**. They are
placed over real Bridgeport by the owner projection. **The surveyed coastline does not contain this island.**

The anchor:

- City (0, 0) is lon −73.1903, lat 41.177824.
- The island centre (0, 88) is lon −73.1903, lat 41.177033.
- Heading is 0°: +X is true east and −Z is true north.

The proposal:

- **Mask.** These areas are masked out of real data:
  - the authored district, X −168…168, Z −150…140 (lon −73.192305…−73.188295, lat 41.176566…41.179171);
  - the northern neighbourhood, X −165…165, Z −345…−58, which is merged separately.

  A real building whose centroid lies in a mask plus a 24 m skirt is not drawn. Real terrain inside the skirt
  blends toward the authored ground.
- **Coastline transition.** The authored basin south of the block opens east through an authored channel (about
  Z 90…140, X 168 → ~450) into the real inner harbour. The NOAA Bridgeport gauge stands there, at city X 530.4,
  Z 223.1. The channel banks are authored quays that step down to real DEM terrain across the skirt. All water is
  one plane at the snapshot water level.
- **Vertical.** The proposal is `cityY = NAVD88 − 0.23`. That puts Bridgeport mean sea level (−0.067 m NAVD88,
  1983–2001 epoch) on the authored water top (−0.3 m). Real streets then stand about 3–5 m above the authored
  quay and meet it on the skirt ramp. Region data stays in NAVD88 until the owner accepts an offset.
- **The strip between the mask and this crop** (Z 140…370) is real geography. The statewide overview fills it
  later.

## Phase C prep: read-only probes, 2026-11-03

**NWS** (`api.weather.gov`). All calls returned HTTP 200.

- `points/41.1720,-73.1885` resolves to grid **OKX 58,67**, with forecast zone CTZ009 and county CTC001.
- The nearest stations are **KBDR** and then KHVN.
- `stations/KBDR/observations/latest` returned an observation at 2026-11-03T14:10Z. Each value carries its own
  `unitCode` and `qualityControl`. Precipitation was null with QC `Z`.
- The hourly forecast reported `generatedAt` 14:24Z and `updateTime` 10:22Z.
- `alerts/active?point=` returned 0 alerts.
- The NWS documentation says the data is "open data, free to use for any purpose". It asks for an identifying
  User-Agent and a cache-friendly client.

**NOAA CO-OPS 8467150 Bridgeport.** All calls returned HTTP 200.

- The station sits at 41.17582, −73.18397. It is tidal, and its PORTS code is null (it is not a PORTS member).
- `water_level&date=latest` returned 1.045 m MLLW at 14:24Z. The quality flag `q:"p"` means preliminary.
- `datum=NAVD` works. It returned −0.126 m, the same vertical datum as the DEM.
- `predictions&interval=hilo` returned four high/low events for the day.
- Station datums (metres above station datum, epoch 1983–2001): MLLW 0.604, MSL 1.708, MHHW 2.835, NAVD88 1.775.

The normalized snapshot to cache, once per region on Core and never per player, extends the handoff record:

```json
{
  "schema_version": 1,
  "id": "noaa-coops:8467150:water_level:2026-11-03T14:24Z",
  "region": "connecticut-pilot",
  "source_id": "noaa-coops",
  "source_url": "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&station=8467150&datum=NAVD&units=metric&time_zone=gmt&date=latest",
  "data_kind": "observation",
  "geometry": { "type": "Point", "coordinates": [-73.18397, 41.17582] },
  "observed_at": "2026-11-03T14:24:00Z",
  "issued_at": null,
  "valid_from": "2026-11-03T14:24:00Z",
  "valid_to": "2026-11-03T14:30:00Z",
  "ingested_at": "<UTC>",
  "expires_at": "<UTC, about 6 min later>",
  "units": { "water_level": "m" },
  "vertical_datum": "NAVD88",
  "quality_flags": ["preliminary"],
  "attribution": "NOAA/NOS/CO-OPS",
  "derived_from": [],
  "payload": { "water_level": -0.126, "sigma": 0.011 }
}
```

The shape is the same for each data kind:

- `data_kind` is one of `observation`, `forecast` or `simulated`.
- An NWS observation takes `observed_at` from `timestamp`, keeps each value's `unitCode` and maps QC codes into
  `quality_flags`.
- An NWS hourly forecast is `forecast`, with `issued_at` from `generatedAt`, and `valid_from`/`valid_to` from each
  period.
- CO-OPS hilo predictions are `forecast`, with the datum stated.
- When a feed is missing, the record is `simulated`, with `derived_from: []` and a visible label. The city always
  loads.

No ingestion job was added.

## Remaining wiring (for the city/scene owner)

### 1. Publication (not done here; the city work owns both files)

Two edits wire the region into publishing.

**`tools/publish-fictional-city.mjs`:** import `buildRegion` and `loadInputs` from
`tools/fictional-city/build-connecticut-region.mjs`. Fail the publish when
`JSON.stringify(descriptor.chunkIndex) !== JSON.stringify(index)`. Then write each `files[i].bytes` to
`data/fictional-city/regions/connecticut-pilot/<path>`, plus `index.v1.json`, after removing the directory first.
Also write the descriptor's bytes unchanged to `data/fictional-city/regions/connecticut-pilot.v1.json`.

**`.github/workflows/deploy-pages.yml`:** make two changes.

- In the "Publish the fictional city…" step, `git add -f -- data/fictional-city/regions` and output
  `region_index_sha256`.
- In "Verify the published city manifest…", fetch `index.v1.json` and every listed chunk, and compare HTTP 200 and
  SHA-256, exactly as the city chunks are checked.

### 2. Scene integration (Phase B)

1. Load the descriptor, then `index.v1.json`.
2. Select 128 m chunks within a travel buffer of the player, in the city frame, through the owner projection.
3. Extrude LOD0, LOD1 or LOD2 by chunk distance, merged per chunk with one material.
4. Build a terrain mesh from the posts.
5. Cancel stale requests and dispose GPU resources on unload. Use `createFloatingOrigin`.
6. Add the mask and skirt so that real chunks never draw inside the authored district or the northern
   neighbourhood.
7. Build the authored channel and quays from the coastline transition.
8. Add collision from LOD0 footprints outside the mask.
9. Add a validated planet-position field to the save, separate from the bounded city-return position.
10. Add the OSM street layer (ODbL credit in game credits) and the strip between the mask and this crop.

## Limitations

- Heights come from roof faces inside each footprint. Merged multipatch cells can give a footprint a neighbour's
  roof where the footprints touch.
- There is no roof shape yet, only flat-topped extrusions.
- There is no water polygon. The hydro-flattened terrain at about −1.17 m stands in for water.
- No phone measurements have been taken. The budgets are targets, not results.
