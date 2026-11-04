# Bridgeport shared navigation v1 — consumer checkpoint

Authoritative descriptor: `core/data/spatial/bridgeport-golden-hill.v1.json`.
Derived, engine-independent consumer payload: `data/spatial/bridgeport-golden-hill.v1.json`.
Compiler: `tools/spatial/build-bridgeport-slice.mjs`; `--check` verifies byte-for-byte freshness.
Numerical reference exports: `js/spatial/metric-frame.mjs` (`metricFrame`, `cellCenter`,
`localCell`, `polygon`, `cellId`) and `js/spatial/region-graph.mjs` (`walkable`, `clearEdge`,
`closestNode`, `route`, `restorePosition`). These contain no tactical engine or renderer.
Consumers should use the payload's baked nodes/edges and geometry, not import a City engine.

The region is `bridgeport-golden-hill.v1`, revision 1; frame `bridgeport-golden-hill.enu.v1`.
WGS84 ellipsoid anchor is longitude -73.1897895, latitude 41.1804834, ellipsoid height 0 m.
Local axes are east/up/south. Geo↔local conversion is reversible double-precision ECEF/ENU.
Source vertices and CT footprint identities stay unchanged. The legacy city/arcade
equirectangular frame and its [0,-220] offset are **not this frame**. No existing save migrates.

Hex is pointy axial q/r, circumradius 1.5 m, local origin x=0,z=0; neighbour order and cube
rounding ties are explicit in the descriptor. Square is 2 m, cardinal-only, same origin.
Discrete cells cannot reversibly encode every continuous position: preserve metric position,
derive the containing cell by inverse rounding, and use a swept-clear connector to enter a graph.
Switching topology never changes geometry or teleports the saved metric position.

Cell IDs are `street:hex:q:r` or `street:square:q:r`. `street` is a floor identity, not a height
index or cube coordinate. Its authored navigation height is 0 m relative to the anchor; there
are no vertical links in this exterior slice. Terrain-clamped rendering is visual only. No
surveyed street elevation, slope acceptance, public entrance or courthouse interior is claimed.

The OSM Golden Hill Street centreline is source way 10181430. The 8 m corridor width is an
authored estimate, **not legal pedestrian guidance**. Body radius is 0.43 m. Candidate nodes
stay in bounds/corridor and outside all 16 sourced CT footprint solids. Edges sample the swept
body at ≤0.2 m, adding half that step to clearance. Graph edges carry Euclidean metre costs;
AP, combat ranges, LOS, missions and road closures remain the consuming engine's authority.
Consumers must reject/disable closed edges themselves and cannot treat this graph as tactical
combat approval. CT 279819 retains Bridgeport Superior Court · G.A. 2 identity; its 12 m visual
extrusion is illustrative. Destination is a reachable street approach, not a verified doorway.

The separate save key is `here.universe.bridgeport-golden-hill.v1`. Persist schema, region ID,
revision, frame ID, floor ID, metric position and topology; reject mismatches. Arcade entrance
IDs `bridgeport-main-elm` and `bridgeport-main-golden-hill` keep their existing meanings and saves.
The latter's source intersection equals this anchor, but there is no implicit legacy save import.

Owner gate: existing server-verified `HuGlobe.owner()` and session; no new backend/role grant.
Gating and budgets in the descriptor are immutable review configuration, not persisted owner
administrative controls. Production configurable policies still require the canonical control plane.
This checkpoint defines the bounded data contract; Cesium rendering is implemented separately.
Ion terrain/imagery entitlement must be checked through the existing proxy; offline render tests
cannot establish live ion access. No broad City relocation, building-source mutation or SQL.

## Parent-frame lifecycle seam

The existing globe iframe accepts these messages only from its same-origin parent, only with
the existing server-verified owner answer. Every request carries
`schema: "mccluster.spatial-lifecycle/v1"`:

| type | payload / result |
|---|---|
| `bridgeport:enter` | `entranceId`: `golden-hill-west` or `bridgeport-main-golden-hill`; lazily loads and flies into the region |
| `bridgeport:preview` | `destinationId: "court-exterior-approach"`; creates a legal stationary preview after `ready` |
| `bridgeport:confirm` | validates and starts the current preview |
| `bridgeport:leave` | saves this region, unloads entities and restores the pre-entry globe camera |

Replies use `type: "bridgeport:state"` with the same schema and `event` of `ready`, `saved`,
`arrived`, `unloaded` or `returned`. Every reply pins region ID/revision/frame/floor and includes
metric `position`, topology, entry ID and explicit capability list. Consumers retain their own
mission/return state. No cross-engine inventory, AP, RNG, objectives or combat state is transferred.
An existing valid slice save resumes before applying a default entrance spawn. With no slice save,
Golden Hill entry starts at ENU (0,0,0); west entry uses the graph's published entry cell. Unsupported
entrances are rejected. Main/Elm and the other Arcade mission stops are outside this region, so the
four-shoe mission is **not** enabled end to end. There is no stair, door or furniture lifecycle here.

Dependencies inspected: City #736 at 3dc414857b17fb758945d930f81c88e22e44c69a; #738 incorporated;
PRIM3 #739 at e53b27e5f1a0216299e4f39ac5ab1fff5ba0e70d; Arcade #743 at
8a44faf2f2e5c26edf765fe0b2c33969ac961787; Games #726 at
2f46f6116e24ab07b4e5d2b9f7c255b5837c8d9b. No consumer implementation is copied here.

## Tactical adapter boundary

The existing 3.54 m tactical, 1 m Courtyard and 3.6576 m HQ cells remain unchanged. HQ floor
IDs are not heights: site z0, Floor 1 z1=0 m, z2–6=4.1148/8.2296/12.3444/16.4592/20.574 m,
roof z7=24.6888 m, basement z8=-4.1148 m. None has a geographic anchor in this contract.
This slice supplies no door/furniture state and no inter-floor links; consumers must not
reinterpret its empty link list as certification of those features. Source footprint solids
and street edges are the complete supported collision scope here.

PRIM3's current positive-integer link costs/bidirectional indexing cannot directly accept
arbitrary directed metre-cost edges. Its upstream adapter must explicitly choose AP/range policy
and adapt LOS, cover, fog, hints and AI together before claiming hex combat. Preserve phase,
hidden-contact interruption, living/downed occupancy, RNG and original save readers. Use a new
scenario/revision; never reinterpret square saves as axial cells. The legacy three door and
48 radius-0.43 m discrepancies remain outside this bounded region, not solved by shrinking actors.

## Cesium integration checkpoint

`action-globe.html?explore=1&bridgeport=1` uses the existing server owner answer and existing
Cesium/ion viewer. The owner can also select **Bridgeport walk**. Explicit entry flies to the
region; geometry fetch waits for the low, nearby camera. Source footprints, Golden Hill Street,
selectable legal cells and a moving position are rendered in that viewer. Preview/Confirm/Stop,
square↔hex switching, Return to globe and separately saved resume are local review controls.
Camera departure unloads entities and cancels stale loads; revocation also closes the slice.
The 178 KB region is not fetched for visitors or the initial distant globe. Failed loads do not
retry endlessly. No production administrative configuration or cross-engine combat is claimed.

Rendering uses [Cesium PolygonGraphics](https://cesium.com/learn/cesiumjs/ref-doc/PolygonGraphics.html)
ground-relative geometry and [CustomDataSource](https://cesium.com/learn/cesiumjs/ref-doc/CustomDataSource.html)
for grouped lifecycle. The existing ion proxy/terrain pipeline is reused unchanged. The UI
explicitly says when ion is unavailable; ground-clamped rendering is not surveyed elevation.

## Verified integration evidence

- Root suite: 1,645 Node passes, 3 skips, plus 7 Python passes. Final focused contract/gate/Halo
  checks: 17/17. Source coverage remains 2,350/2,350 over 613 sources.
- Real pinned Cesium 1.131 in software Chromium at 390×1000 and 1280×1000: no region fetch
  on distant globe; explicit owner entry; 227 initial slice entities (209 legal hex cells,
  16 exact footprint outlines/extrusions, one source road, one position indicator).
- Actual pointer-to-geographic-cell picking previews a 5.2 m three-cell path, confirmation
  traverses it to the intended cell. Street primitives cannot steal selection from the cell
  underneath. Existing Halo picking retains priority.
- Full court-route preview, stop, square switch without position movement, return/re-entry,
  full page reload/resume, zoom-out disposal and revoked-owner refusal all passed.
- Same-origin parent iframe entry at the Golden Hill entrance, ready event, preview/confirm,
  explicit leave and returned event passed. This is an integration seam, not an Arcade mission test.
- Region payload: 177,796 decoded bytes including newline. Re-entry reloads it; no unbounded
  payload cache is introduced. This does not measure production gzip transfer or real-device FPS.
- API/owner replies and imagery are fixtures. The viewer is real Cesium; no production owner
  session or live ion entitlement was used. When ion is absent the UI says so. Existing proxy
  credentials/entitlement are required for live ion, and were neither created nor changed.

Reproduce with `node --test scripts/test/bridgeport-shared-spatial.test.mjs
scripts/test/bridgeport-region-gate.test.mjs scripts/test/halo-console.test.mjs`, then
`node tools/spatial/build-bridgeport-slice.mjs --check`.
`node scripts/e2e/bridgeport-shared-globe.e2e.mjs` needs Playwright via
`CODEX_PRIMARY_RUNTIME_NODE_MODULES`, Chromium at `/usr/bin/chromium`, and the exact Cesium 1.131
Build/Cesium folder through `CESIUM_BUILD` (default `/tmp/bridgeport-cesium/package/Build/Cesium`).
Screenshots, JSON results and logs are preserved under `/workspace/bridgeport-review-evidence`.
The entrypoint above is source ready for the preview coordinator, not an already deployed URL.

This is stacked on #736; stacked-base CI does not run the complete main-target workflow set.
Full integration checks are still required after the base is incorporated. Do not merge #738's
already incorporated streaming changes twice. PRIM3 and Arcade adapter implementation stays with
its owning tasks; this checkpoint changes no resolver, legacy mission or save reader.
