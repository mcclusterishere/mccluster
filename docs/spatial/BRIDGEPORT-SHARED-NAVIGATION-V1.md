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

Dependencies inspected: City #736 at 3dc414857b17fb758945d930f81c88e22e44c69a; #738 incorporated;
PRIM3 #739 at e53b27e5f1a0216299e4f39ac5ab1fff5ba0e70d; Arcade #743 at
8a44faf2f2e5c26edf765fe0b2c33969ac961787; Games #726 at
2f46f6116e24ab07b4e5d2b9f7c255b5837c8d9b. No consumer implementation is copied here.
