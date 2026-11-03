# PRIM3 city levels — research and recommendation

Status: research + working prototype, 2026-11-03. Not canon, not a shipped level.
Owner direction, 2026-11-03: *"I really want this to be part of a big city, like a literal city. We should build levels on a real city … That's what I really want to build."*

Prototype: `tools/prim3-city-grid.html` (owner tool, noindex; `tools/` is stripped from the published site) over
`tools/prim3-city/city-grid.mjs`, with tests in `scripts/test/prim3-city-grid.test.mjs`.

---

## 1. Recommendation (read this first)

**Build the rules from open data, build the look ourselves, stream both in small chunks, and never let a
proprietary photo-mesh be the level.**

1. **Rules layer = open footprints + heights → the 3.54 m tactical grid, deterministically.** OpenStreetMap
   (and, where OSM is thin, Overture Maps buildings, which conflate OSM with Microsoft/Esri/Google Open
   Buildings footprints) gives every building's outline, `height` / `building:levels`, parts, water, piers,
   parks and streets. `city-grid.mjs` turns that into exactly what the canonical Prim3 resolver eats:
   `surfaces`, `links`, `blockers`, `cover`, units, `battlefield.coordinateFrame`. Same input → same bytes.
2. **Heights are evidence-graded.** Each building says whether its height came from a `height` tag, a
   `levels` tag or a per-type guess. In the Jersey City block, 123 of 146 buildings are guesses; phase 2
   replaces guesses with public-domain USGS 3DEP lidar (roof height = lidar first-return median inside the
   footprint) computed on OVH Core, never from Google tiles.
3. **Visual layer = our own procedural city from the same footprints**, in the game's field/studio looks
   (`js/prim3-tactics/level3d.mjs`): CityEngine-style rules (storey bands, window modules, parapets, roof
   kit, storefronts on street faces) generated per building, merged per chunk, meshopt-compressed, KTX2
   textures. This is the only visual layer we can legally cache, modify, ship offline and turn into a game.
4. **Google Photorealistic 3D Tiles: not for levels.** Allowed only as an optional, live-streamed,
   attributed "establishing shot" (e.g. the Level 7 roof overlook) with nothing derived from it. Its policies
   forbid caching/pre-fetching, extraction and derived geometry; our own objects may sit on top only if
   they are not derived from the tiles. It also costs $6 per 1,000 root-tileset events after 1,000 free a month.
5. **Streaming for phones = chunks of 16 × 16 tiles (56.6 m)**: a rules chunk (JSON, a few KB gzipped) and a
   visual chunk (one GLB, ≤ 150 draw calls for everything on screen). Publish the visual chunks as
   **3D Tiles 1.1** (implicit quadtree, GLB content) so NASA-AMMOS `3DTilesRendererJS` streams, caches and
   LODs them with no custom loader, on WebGL today and WebGPU later.
6. **Where the plane does the work:** OVH McCluster Core runs the converter + mesher as batch jobs (it is the
   persistent-execution tier; not a Worker, not a second backend). Outputs go to **Supabase Storage** (a
   public bucket, because ODbL output is public anyway) with one row per area/chunk in Supabase
   `zmnhbrjyhxzhkxmhkexs`. Worker `mccluster` (`api.mccluster.org`) serves the level manifest and signs or
   proxies chunk URLs, as it already does for platform assets (`platform-api.js` storage signing). No new
   Worker, no new database. An R2 bucket for chunks would be a new infrastructure name: owner decision only.
7. **Gameplay on city geometry stays the resolver's grid**, not a navmesh. A navmesh
   (`recast-navigation-js`) is useful later for ambient crowds/traffic and for free-walk camera collision in
   the 3D view, generated from the same chunk meshes on Core.
8. **ODbL is accepted, not fought:** every level built from OSM is a derivative database; we publish its
   data (the extract and the level JSON) under ODbL with "© OpenStreetMap contributors". Our art, code, story
   and characters are separate works and stay ours. Do not mix in any data whose licence forbids that.
9. **First real area:** Paulus Hook / Exchange Place, Jersey City (the New Jersey side of the Upper Bay):
   166 × 169 tiles (588 × 598 m), 146 buildings, the Hudson, Little Basin and the piers. It converts in
   ~0.4–1 s in a browser or in Node and loads into the Prim3 resolver as-is (checked: `createState` 6–15 ms,
   a 40-step reach 30–40 ms, a ladder path from the street to a roof found).
10. **Renderer path:** stay on three.js 0.180 `WebGLRenderer` for shipping; prototype `WebGPURenderer`
    (`three/webgpu`, TSL, automatic WebGL2 fallback) behind a flag now that Safari 26 ships WebGPU, and
    move when post-processing (bloom, the field look) is ported to TSL.

---

## 2. What the prototype does

`node tools/prim3-city/fetch-osm-extract.mjs` fetches one small box (Overpass first; one OSM API `/map`
call as fallback, which is what produced the committed file because Overpass returned 503) and writes
`tools/prim3-city/data/jersey-city-paulus-hook.osm-extract.json` (163 KB): buildings, parts, water,
coastline, piers, parks, streets, with the ODbL block inside the file.

`buildCityLevel(extract)` (pure, deterministic, no DOM):

| Step | Rule |
| --- | --- |
| Frame | Local east/north tangent plane at the bbox centre; grid centred on the box. Engine `x` west→east, `y` north→south; display `X = x − x0`, `Y = y0 − y` (north is +Y), the Transit / Relay convention. |
| Scale | 1 tile = `TILE_M` = 3.54 m (`js/prim3-tactics/scale.mjs`). Heights stay metres. |
| Footprints | A tile is covered when its centre is inside (even-odd: courtyards stay open). A footprint that covers no centre takes its centroid tile. |
| Heights | `height` (m or ft) → `building:levels` (+ `roof:levels`) × 3.2 m → per-type storeys. Source recorded per building. `building:part`s override their outline where they cover it; parts with `min_height` ≥ 3 m (overhangs, bridges) do not block the street. |
| Water | `natural=water` polygons; the coastline by side test (land on the left, pseudo-normal at vertices, tiles beyond an open end left as land); piers re-open water. Water is a z0 blocker of height 0 (no walking, sight passes), like the Transit / Relay canal. |
| Streets | Rasterised by class width, for drawing only: every street tile is ordinary walkable ground to the rules. |
| Roofs | Every roof is a walkable surface. Neighbouring roof tiles within 0.75 m form one patch; neighbouring patches get different `z` by greedy colouring (tallest first). The resolver walks freely between same-`z` neighbours, so this is what stops a unit stepping up a 30 m wall. `z` is a roof *layer*, not a storey; the block needs 4 layers. |
| Links | A fire-escape ladder street→roof for each patch ≤ 18 m (cost 2 + storeys); a roof-to-roof step between neighbouring patches ≤ 4.5 m apart. Towers are reachable only once interiors exist. |
| Cover | Derived, never placed: street tiles beside a building wall get HIGH cover on that side; roof edges get LOW (parapet) or HIGH (a taller neighbour). |
| Output | `{ W, H, FLOORS, FRAME, SCENE, MISSION, engineConfig, attribution, licence, geo, stats }`; `engineConfig` is `createState()` input. A `levels/city-<id>.mjs` adapter is `export const engineConfig = () => structuredClone(data.engineConfig)` plus the same constants. |

Jersey City block: 28,054 tiles, 8,386 building tiles, 6,059 water tiles, 116 roof patches on 4 layers,
56 ladders/steps, 5,639 cover entries, level JSON 838 KB raw (76 KB gzipped).

What it deliberately does **not** do yet: interiors, doors, stairs inside buildings, sloped terrain,
bridges over water, multi-way multipolygon stitching (an incomplete relation is skipped, not guessed), lidar
heights, art.

---

## 3. Evidence

Dates are publication/last-updated dates as shown by the source when retrieved on 2026-11-03.

| Topic | Finding | Source |
| --- | --- | --- |
| Google Photorealistic 3D Tiles — policy | Attribution must be aggregated and shown; "you must not pre-fetch, index, store, or cache any Content except under the limited conditions stated in the terms"; must honour `Cache-Control`; visualisation only (no geodata extraction, no offline use for analysis); you may overlay your own 3D objects only if they are not "extracted, traced, or otherwise derived by hand or machine" from the tiles. | [Map Tiles API Policies](https://developers.google.com/maps/documentation/tile/policies) (undated page, read 2026-11-03) |
| Google 3D Tiles — measurements are derivative | "Programmatically reading and recording measurements (heights, distances, elevations, etc.)" from the 3D imagery is derivative and prohibited. | [Google Maps Platform blog FAQ](https://mapsplatform.google.com/resources/blog/commonly-asked-questions-about-our-recently-launched-photorealistic-3d-tiles/) (2023) |
| Google 3D Tiles — cost | SKU *Map Tiles API: Photorealistic 3D Tiles* (Enterprise): 1,000 free events/month, then $6.00 per 1,000 (to 100k), down to $2.40 above 5M. 2D tiles: 100k free, $0.60/1,000. | [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing) (read 2026-11-03) |
| Google 3D Tiles — EEA | Third-party report: unavailable to new projects with an EU/EEA billing address created after 2025-07-08. | [Blosm listing](https://prochitecture.gumroad.com/l/blender-osm) (unverified secondary) |
| Cesium OSM Buildings | 350M+ buildings from OSM as a 3D Tiles tileset on Cesium ion, updated quarterly; requires an ion account; attribution "© OpenStreetMap contributors"; terms via ion ToS. Google 3D Tiles via ion are SaaS-only (not self-hosted). | [Cesium OSM Buildings](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/) (©2026); [Cesium ion pricing](https://cesium.com/platform/cesium-ion/pricing/) |
| 3DTilesRendererJS | NASA-AMMOS three.js (and Babylon/PlayCanvas) 3D Tiles renderer; v0.5.3 (2026-09-18) added Potree/point-cloud effects; 0.5.0 (2026-07-15) shares queues/caches between renderers; plugins for Cesium ion, Google tiles, quantized-mesh, MVT annotations, `BatchedTilesPlugin` (three ≥ r170) to cut draw calls. | [CHANGELOG](https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/master/CHANGELOG.md); [BatchedTilesPlugin docs](https://gkjohnson.github.io/tools/docs/3d-tiles-renderer/three/plugins/BatchedTilesPlugin/) |
| Overture Maps buildings | Buildings theme is ODbL; conflates OSM (highest priority), Esri Community Maps, Microsoft ML footprints, Google Open Buildings and others; schema has `height`, `num_floors`, `min_height`, `building_part`. Release paths at 2026-10-21.0. | [Overture buildings guide](https://docs.overturemaps.org/guides/buildings/) (updated 2026-10-14) |
| OSM licence — games | OSMF Attribution Guidelines have a "Computer games and simulations" section: attribution on a splash screen, in-game view, credits or menu, legible long enough to read. | [OSMF Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) (edited 2026-09-10) |
| OSM licence — produced work vs derivative database | Most uses are Produced Works (any terms you like, attribution required); but if the result is intended for extraction of the data it is a database; a level's rules JSON is a derivative database (share-alike). Community advice: when in doubt treat it as a derivative database. | [OSMF Licence and Legal FAQ](https://osmfoundation.org/wiki/Licence_and_Legal_FAQ); [legal-talk 2021-02](https://lists.openstreetmap.org/pipermail/legal-talk/2021-February/009059.html) |
| OSM API usage | `/api/0.6/map` is for editing-scale reads; bulk readers use Overpass or extracts. One small call per area, never looped. | [OSMF API usage policy](https://operations.osmfoundation.org/policies/api/) |
| Procedural from footprints | Blosm (Blender) builds OSM buildings from height/levels, many roof shapes; premium adds facade textures/geometry nodes; GPL source to buyers. CityEngine is the commercial reference for rule-based facades (CGA rules on OSM lots). | [Blosm docs](https://github.com/vvoovv/blosm/wiki/Documentation); [Blosm](https://prochitecture.gumroad.com/l/blender-osm) |
| Gaussian splatting on the web | Spark (World Labs, MIT) renders splats inside three.js (examples on three 0.180), PLY/SPZ/SPLAT/KSPLAT/SOG, "fast even on low-powered mobile devices"; Spark 2.0 added LoD capping splats per frame (~0.5–2.5M) and a paged streaming format. | [sparkjsdev/spark](https://github.com/sparkjsdev/spark); [Radiance Fields: Spark 2.0 preview](https://radiancefields.com/world-labs-previews-spark-2.0) (2026-02) |
| WebGPU in three.js | `WebGPURenderer` from `three/webgpu`, WebGPU backend with WebGL2 fallback (`forceWebGL`), TSL compiles to WGSL or GLSL; `EffectComposer` passes are not supported (post-processing must move to the node system); `WebGLRenderer` remains maintained and recommended for pure WebGL2 apps. | [three.js manual: WebGPURenderer](https://threejs.org/manual/en/webgpurenderer) |
| WebGPU on iPhone | WebKit shipped WebGPU in Safari 26 (macOS/iOS/iPadOS/visionOS), 2025. | [WWDC25 WebKit post (repost)](https://discuss.privacyguides.net/t/news-from-wwdc25-webkit-in-safari-26-beta/28226) |
| Draw-call batching | `BatchedMesh`: many geometries, one material, multi-draw where `WEBGL_multi_draw` exists, per-instance culling/sorting; helps only when draw-call overhead is the bottleneck. | [BatchedTilesPlugin docs](https://gkjohnson.github.io/tools/docs/3d-tiles-renderer/three/plugins/BatchedTilesPlugin/); [three.js forum](https://discourse.threejs.org/t/why-did-the-performance-worsen-significantly-when-i-used-multidrawinstances-in-batchedmesh/78581) |
| Navmesh | `recast-navigation-js` 0.43.x: Recast/Detour in WASM; `@recast-navigation/three` builds solo/tiled navmeshes and tile caches from `THREE.Mesh`; crowd simulation. | [npm recast-navigation](https://npmjs.com/package/recast-navigation); [three README](https://cdn.jsdelivr.net/npm/@recast-navigation/three@0.43.1/README.md) |
| Public-domain heights | USGS 3DEP lidar is public domain; NJ coverage includes 2014 post-Sandy lidar for all of Hudson County; NJGIN publishes the lidar project extents. | [NOAA InPort: 2014 USGS CMGP LiDAR Post Sandy (NJ)](https://www.fisheries.noaa.gov/inport/item/49867); [USGS 3DEP](https://pubs.usgs.gov/fs/2014/3091) |
| Mesh compression measured here | On the HQ building GLBs: meshopt (EXT_meshopt_compression, medium) cut gzipped bytes 44% (616 → 348 KB); the real cost was 8,566 separate primitives. See `docs/design/HQ-BUILDING-VIEWER-UPGRADE-PLAN.md`. | measured 2026-11-03 |

---

## 4. Licensing

| Source | Licence | Game use | Cache / ship offline | Derivatives | Red flag |
| --- | --- | --- | --- | --- | --- |
| OpenStreetMap | ODbL 1.0 | Yes | Yes | Yes; **share-alike** for derivative databases (our extract and level JSON) | Must offer the derived data publicly and attribute "© OpenStreetMap contributors" in game (splash/credits/map view). Do not combine with data under incompatible terms. |
| Overture buildings | ODbL (theme) | Yes | Yes | Same as OSM | Attribution names more parties (OSM, Microsoft, Esri, Google Open Buildings, Overture). Check `sources` per feature. |
| Microsoft / Google Open Buildings footprints | ODbL / CC BY 4.0 (via Overture) | Yes | Yes | Yes | Footprints only, no reliable heights. |
| USGS 3DEP lidar | Public domain | Yes | Yes | Yes | None; credit USGS as courtesy. |
| Cesium OSM Buildings | ion ToS (+ OSM attribution) | Via ion account | Ion terms, not raw ODbL freedom | Per ion terms | A hosted service between us and the data; use raw OSM instead for levels. |
| Google Photorealistic 3D Tiles | Google Maps Platform ToS + Map Tiles policies | Not named; risky | **No** (no pre-fetch/store/cache beyond `Cache-Control`) | **No** (no extraction, no measurements, no traced/derived objects) | Paid per root request; EEA restriction reported; cannot be the level, the collision, the heights, or an offline asset. |
| Spark / 3DTilesRendererJS / recast-navigation-js / three.js | MIT / Apache-2.0 / MIT / MIT | Yes | Yes | Yes | None. |
| Blosm premium | GPL source | Tool only | n/a | Output is ours | Do not ship GPL code in the game. |

**Hard red flags:** (1) any pipeline step that reads geometry, heights or textures out of Google tiles;
(2) committing raw Google responses anywhere; (3) shipping an OSM-derived level without publishing its data
and attribution; (4) presenting the fictional Harborline site, or any mission, as a real, identifiable
building or tenant: real streets and massing are the stage, the facility and its people stay fictional.

---

## 5. Phone budgets (aligned with `docs/uprise-world/PERFORMANCE-BUDGET.md`)

| Budget | Target | Prototype today |
| --- | --- | --- |
| Frame | 60 fps (16.7 ms), 30 fps floor | Turn-based: renders on change only |
| Draw calls on screen | ≤ 150 on a tablet/phone | 12 for the whole block (2 instanced meshes + lines + markers) |
| Triangles on screen | ≤ 300k mid phone | 140k (28k instanced tiles; boxes are 12 tris each) |
| Initial download | ≤ 5 MB compressed preferred, ≤ 8 MB hard | extract 163 KB raw (33 KB gz) + three.js |
| One rules chunk (16 × 16) | ≤ 20 KB gz | n/a (whole block, 76 KB gz) |
| One visual chunk (16 × 16) | ≤ 250 KB (meshopt + KTX2) | n/a |
| Textures resident | ≤ 64 MB GPU, KTX2/Basis, 1024 px tiles | none |
| Resolver | `createState` < 20 ms; reach < 50 ms | 6–15 ms; 30–40 ms (Node, whole 166 × 169 × 5 grid) |

Rules of thumb: one material per chunk (atlas), `BatchedMesh` or merged chunk meshes, LOD by chunk distance,
frustum + occlusion culling by chunk (towers hide whole blocks), no real-time shadows on phones (bake AO into
vertex colour), pixel ratio ≤ 1.5 on coarse pointers.

---

## 6. Phased plan

| Phase | Deliverable | Where it runs |
| --- | --- | --- |
| 0 (this PR) | Converter + tests, committed Jersey City extract, owner tool page, research | repo |
| 1 | `js/prim3-tactics/levels/city-<id>.mjs` adapter; the first city mission on the existing renderer (`level3d.mjs`) with authored objectives on top of the real block; OSM attribution in the briefing and credits | repo (after the whole-platform tactics branch lands) |
| 2 | Heights from USGS 3DEP lidar per footprint; interiors for mission buildings only (lobby, stair, lift links); street furniture from OSM points (benches, lamps, trees) as cover | OVH Core batch → Supabase Storage |
| 3 | Procedural facades: storey bands/windows/storefront rules per building type, roof kit, chunked GLB (meshopt + KTX2), one atlas; 3D Tiles 1.1 tileset for streaming via 3DTilesRendererJS | OVH Core |
| 4 | Area pipeline: owner picks an area → Worker `mccluster` queues a job (existing ops job tables) → Core builds rules + visual chunks → rows in Supabase + files in Storage → game fetches the manifest from `api.mccluster.org` | Worker + Core + Supabase |
| 5 | WebGPU renderer path (TSL port of the field look), navmesh for ambient crowds, optional Spark splat interiors captured on site (our own captures only) | repo + Core |

Open questions for the owner: which neighbourhoods; whether the Level 7 roof of the HQ building
should look out on a real city chunk built this way (the roof spec already asks for an overlook and dynamic
destinations); whether a Google-tiles establishing shot is worth the cost and terms at all.
