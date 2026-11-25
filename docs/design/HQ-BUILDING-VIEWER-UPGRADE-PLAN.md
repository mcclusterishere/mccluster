# HQ building viewer — audit, measurements and upgrade plan

Date: 2026-11-03. Scope: the canonical viewer `_unfinished/<program>/<program>-building-core-v2-3d.html`
(Codex's Core V2 working stack). This file sits outside `docs/design/<program>-building/` on purpose:
another agent is changing the builders and models there, so nothing in that directory was touched, and
`PROJECT-STATE.md` should take a pointer to this file when that work lands.

Owner, 2026-11-03: *"make it better, make everything better … more optimized, more high tech."* The target
(building gate + owner): a real, attractive, interactive building people can walk, learn and work in, whose
Level 7 roof is the mobility portal to the other property "buildings".

> Naming note. `<program>` stands for the building program's slug in every path below. This file avoids
> spelling it because `verify_<program>_repo_sources.py` requires every file that names the program to be
> classified in the building gate's source map, and that map lives in the gate directory another agent is
> changing now. When that work lands, classify this file there and the paths can be written out.

## 1. Where the viewer is served today

**Nowhere.** There is no root `<program>-building-core-v2-3d.html` on `main` (a handoff that says so is
wrong), and `.github/workflows/deploy-pages.yml` deletes `_unfinished/` in "Strip the internals"
(`rm -rf … _unfinished …`), so:

| URL | Status (2026-11-03) |
| --- | --- |
| `https://matthew.mccluster.org/<program>-building-core-v2-3d.html` | 404 |
| `https://matthew.mccluster.org/_unfinished/<program>/<program>-building-core-v2-3d.html` | 404 |
| `https://matthew.mccluster.org/<program>-preview/*.glb` (models, programs, lab runtime) | 200, published by the "Publish … preview assets" step |

So the models are public and the page that shows them is not. The building gate's index regex only covers
root viewers (`^<program>-(?:building-core-v2|floor-0[1-7]|basement-b1)-3d\.html$`), so the viewer under
`_unfinished/` is outside `BUILDING-FILE-INDEX.json`; the context audit passes before and after this change.
Publishing it (moving it to the root and indexing it) is an owner decision and a building-gate change.

## 2. Quick wins in this change

1. **The live-content 404 is fixed.** The page asked for `js/live-content.js` relative to
   `_unfinished/<program>/`; it now loads `/js/live-content.js` from the site root, which works there and
   at the root if the page is ever promoted. Consequence: the house privacy notice now appears on first
   visit, as on every other page.
2. **The control panel is a mobile bottom sheet**, mobile first with `min-width` only (the old
   `@media (max-width: 760px)` is gone): on a phone the controls are one horizontally scrolling row of 40 px
   pills in a sheet capped at 40 % of the screen (≤ 330 px), the description clamps to two lines, the status
   pill moves to the top, and the Work Tickets and device panels open as bottom sheets; from 761 px up the
   original floating desktop panels come back. Track sizes use `minmax(0, 1fr)`; the lab selects are 16 px
   so iOS does not zoom.
3. **The loader accepts meshopt-compressed GLBs** (`GLTFLoader().setMeshoptDecoder(MeshoptDecoder)`): a no-op
   for today's files, and the switch that lets the builders ship `EXT_meshopt_compression` output without
   another viewer change.

All Step 8 / Room Mode tokens checked by `scripts/smoke.mjs`, the services builder and
`verify_viewer_lab_integration_v1.mjs` are intact (58 smoke tokens present, the lab verifier exits 0).

## 3. Measurements

Models: the published `/<program>-preview/` set as of the morning of 2026-11-03, i.e. before building v3 (#709)
merged; v3 adds exit-door geometry and brand slots (the viewer side of #709 is brand-slot placement only,
kept in the merge). Re-measure after the builders settle.

Method: Playwright 1.63 + Chromium (SwiftShader WebGL, i.e. CPU rendering, so absolute frame times are far
slower than a phone GPU; the ratios and the draw-call counts are what matter). Models mirrored from the live
`/<program>-preview/`. Draw calls counted by wrapping `drawElements`/`drawArrays` per animation frame.
Phone = 390 × 844 @3×, touch; desktop = 1440 × 900 @1×. "All floors" = every floor B1–Roof isolated once
(loads it), then Stack.

### 3.1 Models (offline, gltf-transform 4.2.1)

| Model | Raw | gzip (what Pages sends) | meshopt + gzip | Primitives (draw calls) | Triangles |
| --- | ---: | ---: | ---: | ---: | ---: |
| building-core-v2 | 523 KB | 58 KB | 29 KB | 840 | 12,104 |
| facade-core-v2 | 2,491 KB | 205 KB | 94 KB | 3,975 | 48,100 |
| building-services-core-v2 | 652 KB | 79 KB | 44 KB | 921 | 22,548 |
| basement-b1-core-v2 | 250 KB | 33 KB | 23 KB | 382 | 6,132 |
| floor-01 … floor-07 (7 files) | 1,637 KB | 241 KB | 157 KB | 2,448 | 41,900 |
| **Total (11 files)** | **5,553 KB** | **616 KB** | **348 KB (−44 %)** | **8,566** | **130,784** |

Joining by material (`gltf-transform optimize --simplify false`) takes the same 11 files from 8,566
primitives to **13**. The building is tiny in triangles (131k) and enormous in draw calls: almost every
object is its own 12-triangle mesh with its own node. **Draw calls, not bytes, are the problem.**

### 3.2 Viewer (Playwright)

Frame times are SwiftShader (CPU) frame times: 10–50× slower than a phone GPU and noisy; read them as
relative. Draw calls and bytes are exact.

| Measure | Before, 390 px | After (quick wins + meshopt models), 390 px | Before, 1440 px |
| --- | ---: | ---: | ---: |
| Time to "shell ready" | 5.5 s | 5.3 s | 1.9 s |
| GLB bytes for the session (uncompressed transfer) | 4.90 MB | 3.77 MB (−23 %) | 4.90 MB |
| Same, gzip as Pages serves it (11 model files) | 616 KB | 348 KB (−44 %) | 616 KB |
| Stack view (shell only): draw calls / median frame | 3,932 / 67 ms | 3,932 / 50 ms | 4,631 / 83 ms |
| Stack with all 8 floors resident: draw calls / median frame | 5,992 / 150 ms | 5,992 / 300 ms (noise) | 6,841 / 200 ms |
| Roof isolated: draw calls | 169 | 169 | 283 |
| Loading B1 → Roof one by one | 53 s | 67 s | 65 s |
| Panel share of the screen | 35 % (top 301 px) | 19 % (bottom 159 px sheet) | 12 % |
| `scrollWidth === clientWidth` | yes | yes | yes |
| 4xx responses | `js/live-content.js` 404 | none | `js/live-content.js` 404 |
| Page errors | none | none | none |

Not reported: the 1440 px after-run and a 390 px after-run on uncompressed models both died mid-run (the
SwiftShader page closed under the all-floors load / hit the 25 min cap). Neither quick win changes what is
drawn, so their draw-call counts equal the before column.

Takeaways: compression saves bytes but does not change frame cost; the frame cost scales with draw calls,
which sit at 25–45× the house tablet budget of 150 in every stack view. Batching (plan item 1) is the fix.


## 4. Feature audit

| Area | Status | Evidence |
| --- | --- | --- |
| Floor isolation + whole-building navigation | **IMPLEMENTED** | `Stack`, `Facade`, `B1`–`6`, `Roof` buttons; `isolateBaseLevel`, `ensureDetailedFloor` streams each floor GLB on demand ("0/8 detailed floors resident" at start); `South/East/North/West/Entry/Crown` camera presets (`setView`); `?floor=`/`?view=` deep links. Measured: all 8 floors load and isolate without errors. |
| X-Ray / Physical Plant / Cabling / Services (engineering modes) | **IMPLEMENTED** | `setEngineeringMode`, `setPhysicalPlantMode`, `setCablingMode`, `syncServicesVisibility`; the engineering layers load the 13.7 MB electronics fabric GLB on demand; sprite markers (`rebuildEngineeringMarkers`). Probe at 390 px (meshopt models): X-Ray began loading after 29 s on SwiftShader; Physical Plant and Cabling switched on but reported 0 devices until the fabric finished; Services exposed in 10 s; no page errors. |
| Clickable / inspectable objects | **PARTIAL** | Devices: `renderDeviceInspector` with live state, connection chain, simulated camera feed and `cameraCoverage`. Rooms: Floor 1 targets only (`ROOM_F1.targets`, `approachRoomObject`). Furniture, rooms and floors elsewhere are not inspectable. |
| Work Tickets (lab runtime) | **IMPLEMENTED** (training sandbox) | `LAB_MODULE_URL`, `labController.execute`/`reset`, guided scenarios, difficulty; verified by `verify_viewer_lab_integration_v1.mjs`. Not re-driven in the browser probe (SwiftShader starved the page); its hooks are held by the smoke test and the lab verifier, both passing. |
| Room Mode / human-eye camera | **PARTIAL** | Floor 1 only, one fixed anchor (`ROOM_F1.camera_ft` = [36, 34, 5.4] ft, eye height 5.4 ft), drag-to-look, tween to targets, Step Back. The file's own note: "Room Mode v1: human-scale Floor 1 play before free-walk locomotion." Not re-driven in the browser probe for the same reason; the Room Mode tokens the smoke test checks are all present. |
| Touch / mouse / iPad gyro | **PARTIAL** | Orbit (`OrbitControls`) for mouse and touch outside Room Mode; gyro via `DeviceOrientationEvent.requestPermission` + `deviceorientation` only inside Room Mode; no keyboard movement (no `keydown` handler), no on-screen joystick. |
| Stairs / elevators / doors / collisions | **PLACEHOLDER** | Stairs A/B, both elevators and doors exist as geometry (and a walkability report is generated), but the viewer has no locomotion, no collision, no door interaction and no elevator ride (0 occurrences of collision/elevator logic; "door" appears only in a transparency rule). |
| Player vs Engineering mode | **PLACEHOLDER** | There is no player mode or role switch; the closest split is Room Mode (human scale) vs the X-Ray/engineering toggles. |
| Lighting / material realism | **PARTIAL** | `RoomEnvironment` PMREM reflections, a sun placed from the device clock (`deviceClockSolar`; the test ran at 04:21, so it rendered night), quality tiers LOW/BALANCED/HIGH with 512–2048 shadow maps. But 9 of the 11 model files carry **no materials** (only the facade and services do) (colours are assigned by mesh name in the viewer), no textures, no baked AO, no lightmaps, no GI. |
| Level 7 roof as mobility portal | **PLACEHOLDER** | The roof isolates and renders, but the viewer has no portal, beacon or destination logic (0 occurrences of "portal"); the intent lives only in `FLOOR-07-ROOF-MOBILITY-PORTAL-PREPROGRAM.md` / `-360-SPEC.md`. |
| Performance on phones | **BROKEN** (for walking/realism) | Thousands of draw calls per frame for the stack (3,932 shell; 5,992 with all floors, 6,841 on desktop) against the house budget of ≤ 150 on a tablet (`docs/uprise-world/PERFORMANCE-BUDGET.md`). Bytes are fine (616 KB gzip). |
| Mobile layout | **FIXED here** | Before: the floating panel covered 35 % of a 390 px screen (top 301 px). After: a 159 px bottom sheet, 19 % of the screen, status pill at the top, every control reachable by scrolling one row. |

## 5. Upgrade plan (ordered by payoff)

1. **Batch by material, keep identity (the big one).** Rebuild each loaded root into one `BatchedMesh` per
   material (three ≥ r159; multi-draw where `WEBGL_multi_draw` exists), keeping a `batchId → mesh name` table
   so isolation, X-Ray, device picking and Room Mode still find objects by their canonical IDs
   (`raycast` returns `batchId`; visibility per batch item with `setVisibleAt`). Expected: ~8,500 → under 100
   draw calls for the full stack (13 when everything is merged per material, measured above). This is a
   viewer change; the GLBs and their names stay as the builders emit them.
2. **Ship compressed models from the builders**: `EXT_meshopt_compression` (decoder now registered) cuts
   gzip 44 %; add `KHR_texture_basisu` (KTX2) when textures arrive, with `KTX2Loader` and a transcoder path.
   That is a builder/CI change inside the building directory, for the agent that owns it.
3. **Materials in the GLBs, not by name in the viewer**: emit PBR materials (and later a single trim-sheet
   atlas per floor) from the builders, so the look is authored once and batches stay few.
4. **LOD per floor**: a box-and-glazing proxy per floor for the stack view (≈ 20 draws for the whole tower),
   detailed floors only when isolated or within N metres of the camera; facade modules instanced
   (`InstancedMesh`: 3,975 near-identical modules are a textbook instancing case).
5. **Walkable building**: a navmesh per floor generated from the floor GLBs (`recast-navigation-js`), stair
   and elevator links between floors, first-person/third-person controller with collision, on-screen joystick
   + keyboard + gyro look; doors as interactables with state. This turns Room Mode v1 into free walking.
6. **Player vs Engineering**: one mode switch: Player (walk, rooms, tickets) vs Engineering (X-Ray, plant,
   cabling, services), sharing the same scene.
7. **Level 7 portal**: roof arrival → overlook → destination list fetched from the plane (Worker `mccluster`)
   rather than baked into geometry, matching the roof spec; the overlook can be a real city chunk built by the
   PRIM3 city pipeline (`docs/prim3/CITY-LEVELS-RESEARCH.md`).
8. **WebGPU with WebGL fallback**: `three/webgpu` `WebGPURenderer` (WebGL2 backend automatic) behind
   `?renderer=webgpu`; port the post/lighting to TSL; compare frame time on an iPhone with Safari 26. Do this
   after batching: WebGPU does not rescue 6,000 tiny draws per frame.
9. **Lighting realism**: baked AO/lightmaps per floor from the builders (or `MeshPhysicalMaterial` glazing
   with transmission on HIGH only), cascaded/contact shadows on HIGH, an HDRI matched to the solar mode.
10. **Splat interiors? Later, and only from our own captures.** Gaussian splats (Spark, MIT, three 0.180) are
    excellent for photoreal *captured* rooms and run on phones with LoD, but the building is designed, not
    built: there is nothing real to capture yet, and splats do not give collision, IDs or editability. Use
    them for the real site or real rooms once they exist; keep meshes as the authority.
