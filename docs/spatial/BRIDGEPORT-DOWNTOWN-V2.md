# Bridgeport downtown v2 — connected street navigation

This extends #748 without replacing its v1 contract or inventing another coordinate frame.
Source entrypoint: `action-globe.html?explore=1&bridgeport=2`. This is a review build, not a
published production URL. The existing `bridgeport=1` route and lifecycle requests without a
region ID still open v1.

## Canonical inputs and consumer seam

- Descriptor: `core/data/spatial/bridgeport-downtown.v2.json`, schema `mccluster.spatial-region/v1`,
  region `bridgeport-downtown.v2`, revision 2.
- Derived payload: `data/spatial/bridgeport-downtown.v2.json`. Build/check with
  `node tools/spatial/build-bridgeport-slice.mjs --v2 [--check]`.
- Same frame as v1: `bridgeport-golden-hill.enu.v1`, WGS84 anchor
  (-73.1897895, 41.1804834, 0), east/up/south metres. Same hex/square origin, orientation and sizes.
- Reference exports remain in `js/spatial/metric-frame.mjs` and `region-graph.mjs`.
  Additive exports: `legacyToLocal`, `localToLegacy`, `routeToEntrance`, `importCompatiblePose`.
  The legacy projection parameters are recorded in the descriptor; they are not corrected in place.
- Parent requests retain `mccluster.spatial-lifecycle/v1`. Add `regionId: "bridgeport-downtown.v2"`
  to `bridgeport:enter`; `entranceId` accepts the five IDs below or `golden-hill-west`.
  `bridgeport:preview` accepts an entrance ID as `destinationId` or `court-exterior-approach`.
  `bridgeport:closures` accepts `closedRoadIds` containing canonical source-way IDs, such as
  `186839735`. Closure changes cancel both the old preview and active movement, preserve position,
  increment `navigationRevision`, and send `closures-changed`. They are session simulation controls,
  not a claim that the real road is closed. Existing Arcade `blockedRoads` are not imported: its
  clipped segment IDs and closure semantics remain its own until its adapter explicitly reconciles them.
- Ready/arrival/return messages retain region/revision/frame/floor/metric-position identity;
  they now include closures and navigation revision. `imported` reports explicit pose import.
  No mission completion, combat action, AP spending or cross-engine inventory is inferred.

## Five source-backed stops

| Stable entrance ID | Legacy alias | Source OSM way |
|---|---|---|
| bridgeport-main-elm | main-elm | 186839735 |
| bridgeport-main-fairfield | main-fairfield | 186839735 |
| bridgeport-middle-golden-hill | middle-golden-hill | 10180837 |
| bridgeport-main-golden-hill | main-golden-hill | 186839735 |
| bridgeport-main-south | main-south | 186839735 |

These are existing street vertices, not invented storefront parcels or verified doors. Raw OSM
vertices are authoritative here; recorded legacy rounded positions agree within 1 mm. The compiler
proves every entrance connects to both graphs. `routeToEntrance` appends a swept-clear connector
from its last cell to the exact metric source approach, rather than declaring a nearby cell the
entrance. Main, Golden Hill, Elm, Middle and two Fairfield ways form the connected source network.

Both courthouse footprints retain their public identities: CT 279819, Bridgeport Superior Court ·
G.A. 2 at 172 Golden Hill Street; CT 283267, Bridgeport Superior Court · Judicial District at
1061 Main Street. All 16 source footprint rings remain blockers. No building was moved or replaced.
The new region uses 1,203 hex nodes / 5,460 directed edges and 1,774 square nodes / 5,850 directed
edges. All costs are metres. Tactical AP/LOS, hidden information, reaction rules and dynamic actor
occupancy remain the PRIM3 owner's responsibility. This is not hex combat or an Arcade mission implementation.

## Save and rendering boundaries

V2 has its own `here.universe.bridgeport-downtown.v2` slot. It does not automatically consume v1,
City, Arcade or tactical saves. **Import previous slice position** validates v1 schema/revision/frame,
old and new walkability, and a clear graph connector. It writes v2 before changing the active pose;
failed storage leaves the original save untouched. The original v1 slot is never rewritten by import.
Legacy projection conversion is available to consumers but is not authorization to migrate their saves.

Only cells within 45 m of the player render in v2; the complete bounded graph stays authoritative.
Cells refresh after 12 m of movement. The source roads/buildings, route and player stay inside the
existing Cesium viewer. This reduces cell entities, not graph transfer: the complete payload still
loads once per entry. Existing camera/owner gating, cancellation and disposal remain. A camera centre chosen for phone usability keeps the initial walk above the control panel; no permission or geometry changes with width.

## Doors and stairs: concrete source blocker

The retained CT GeoJSON supplies footprint rings and OBJECTID, not door openings, interior floors,
landing levels or accessible widths. No public courthouse interior is authorized by that dataset.
Two OSM stair traces are present: ways 395442208 and 395442209. They are recorded as
`pendingTransitions` with their original geographic coordinates, but null floor identities, rise and
clear width. Their status is `blocked-missing-vertical-survey`; neither becomes a navigation edge.
The available harbour-west terrain crop is a 4 m sampled NAVD88 DEM, not a stair/door survey and not
an ellipsoid-height or individual-step contract. It cannot establish stair rise/landing clearance.

The canonical Equity Uprise HQ has measured floor/stair authority but no verified Bridgeport site
anchor in this contract. Moving it into a convenient downtown footprint would invent geography.
Next physical milestone needs a specifically sourced door and its connected floor/landing geometry,
clear width and elevation datum. Until then, door/furniture/vertical traversal remains unsupported;
no decorative stairs are presented as functioning or surveyed stairs.

Live ion remains an independent verification boundary: the runtime reuses the existing owner gate
and ion proxy; tests use fixture owner responses and imagery with real Cesium. No live owner session,
new credentials, ion entitlement, production SQL, deployment or paid service was used.

## Checkpoint evidence

The five-stop sequence including exact entrance connectors totals 575.64 m on hex and 610.22 m
on square. Both are simulated horizontal routes, not surveyed walking distances. Closing source
way 186839735 blocks the tested Golden Hill→Elm route; reopening restores it. Unknown closure
IDs are rejected. The v1 descriptor/payload remain byte-identical and regenerate unchanged.

Validation for this checkpoint: 1,701 Node passes / 3 skips plus seven Python passes; 21 focused
spatial/gate/Halo checks; 2,354/2,354 source-coverage checks across 614 sources; building context
audit passes. Real Cesium/software Chromium with fixture owner/API/imagery passes v1 and v2 at
390×1000 and 1280×1000: pick→preview→confirm→arrival, stop, square switch, source-entrance preview,
closure invalidation/reopen, return/re-entry, reload/resume, owner revocation and parent iframe
lifecycle. V2 additionally proves explicit import leaves the original v1 saved JSON unchanged.
No uncaught page errors or horizontal overflow in those runs. Live ion remains unverified.

V2 payload is 845,560 decoded bytes including newline, compared with v1's 177,796. Cell render
culling does not reduce this transfer, and no production bandwidth/FPS improvement is claimed.
Reproduce v2 browser checks with `SLICE=v2 node scripts/e2e/bridgeport-shared-globe.e2e.mjs` using
the pinned Cesium/Playwright setup documented in the v1 contract. This update normally incorporates
refreshed #736 at 9e78fd3f7171afc74d9b24300abb43adffbb4a00; it does not merge either PR into main.
