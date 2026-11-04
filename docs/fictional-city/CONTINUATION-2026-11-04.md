# City continuation: routing, bicycles, upstairs reproduction and load audit

This continues local commit `218e0c21`. Nothing is published, deployed, merged into main or applied
to a production database. Shared PRIM3, arcade, globe and owner-controls files are not changed.
The prior navigation audit remains the source reconciliation record; this file supersedes its
bike/route/upstairs status where stated below.

## Implemented in the city

**Bicycle controls and model.** Walk/Ride bike controls drive a session locomotion controller.
The original procedural bicycle has a 1.08 m collision-disc radius, 11 m/s maximum preview speed
and 5.5 m/s² acceleration. Steering uses left/right; forward/back pedals; release brakes.
The same swept metric collision prevents crossing thin walls or leaving supported land. Mounting
requires clear outdoor space. Indoor entry, teleport and tap-to-walk dismount; position uses the
existing save. Reload starts on foot: this is not a persistent vehicle-ownership/inventory system.
No currencies, purchases, database schema, permission rules or shared policy changed.

**Preview → confirm → current/next waypoint.** Choose a destination and Preview route. Preview is
stationary and shows a dashed legal walking path on the minimap. Confirm walk begins movement.
The mini-map marks the next waypoint, the scene ring marks it on the ground, and the status shows
bearing, distance, waypoint index and destination. Reroute replans from the actual current position;
confirmation recalculates rather than trusting a stale preview. Keyboard movement or a modal pauses
an active route. Cancel clears it. A stalled route attempts a new collision-aware plan.

From an interior, the first leg leads to the actual room exit; the scene exits through its existing
door transition and continues on the outdoor path. It does not teleport directly to the destination.
Both legs are checked before confirmation. This is a room→street transition, not an invented
multi-floor shop. Ordinary city interiors still have one playable floor.

Navigation reports identify the current metric frame. Authored room-local coordinates explicitly
have no geographic projection; outdoor points name the existing Bridgeport projection. Availability
of that projection does not make the authored district surveyed geography.

**Stale chunk cancellation.** The existing #738 chunk pipeline now passes AbortSignal to the real
fetch, aborts in-flight chunks outside the existing unload radius, and rejects responses whose
request token no longer matches. The regression intentionally ignores abort in a fake source,
returns the old response after re-entry, and proves it cannot attach over the new request. Resident
collision is retained; detached render geometry is disposed. Existing 72/112 m load/unload hysteresis
is preserved. There is no newly introduced unbounded payload cache or speculative globe loader.

## Upstairs: reproduced in the actual browser

`scripts/e2e/fictional-city-upstairs-audit.e2e.mjs` uses actual local Transit UI, Three.js and raycast
picking, with fixture owner access and a save walked to the stair foot by the real resolver. Only
camera framing is controlled through the renderer; no unit is moved by a browser debug setter.

| Viewport | Stair link | From | Intended upper landing | Reachable? | Actual canvas pick |
|---|---|---|---|---|---|
| 390×1000 | stair-a-1-2 | (8,4,1) | (8,3,2) | yes | (8,2,0) |
| 390×1000 | stair-b-1-2 | (4,4,1) | (4,3,2) | yes | (4,2,0) |
| 1280×1000 | stair-a-1-2 | (8,4,1) | (8,3,2) | yes | (8,2,0) |
| 1280×1000 | stair-b-1-2 | (4,4,1) | (4,3,2) | yes | (4,2,0) |

All four cases have cut=1, no upper-floor move preview, and no uncaught browser error. The lower-level
resolver tests independently traverse both links up and back successfully.

**Concrete PRIM3 handoff:** `transit.mjs:cutStorey` chooses the selected operative's current storey;
`level3d.mjs:tileAt` excludes every surface above that cut before searching the reachable candidates.
Consequently a reachable upstairs tile cannot be picked in this view. Do not solve this by resizing
geometry or changing stair coordinates. The shared task should offer explicit legal stair-transition
selection/preview/confirmation at the current floor, or make reachable destination floors selectable
without blanket-revealing other floors. Verify through actual pointer/touch UI after repair. The
shared renderer/UI was deliberately left untouched to avoid concurrent edits with that task.

## Coordinate/topology and arcade handoff

- PRIM3 owns the shared square/hex contract. City free walk and bicycle collision remain continuous
  metres. Keep source footprints/roads and saved positions fixed; derive cell occupancy from them.
- `fine-occupancy.mjs` remains an isolated square 2×2 review adapter. Its cardinal-only adjacency
  must not be reused as hex adjacency. Consume the shared contract's metric cell centres/polygons
  and neighbor list once finalized; no independent hex schema has been introduced here.
- City `navigationView()` supplies current frame, destination ID, phase, status, remaining metric
  points, current/next waypoint and waypoint index. Arcade should share an agreed **data** contract,
  not import this city engine. Its own rules should validate and confirm its own route segments.
- Vertical links need explicit source/destination floor IDs and elevations in the shared contract.
  Room-local points must never be projected onto the globe as if they were outdoor points.
- `tools/fictional-city/audit-city-placement.mjs` reproduces the police/Harding displacement and
  available-land check from existing attributed address points, and inventories 16 footprint places
  and 62 road polylines. Jimmy's check is explicitly **centroid-only**, not footprint intersection;
  an empty point-overlap list does not overturn #730's documented full-footprint placement conflict.
  No City Trust binding was found or invented. No geographic source was changed.

## Globe and loading audit

The parent supplied independent live-source measurements: Cesium.js alone about 1.61 MB gzip /
5.48 MB decoded; existing aerial gate below 3,000 km; OSM-building creation below 120 km with
50–60 km visibility hysteresis; access/ion wait up to 1.5 s and terrain ground delay up to 2.5 s.
Those are the parent's static measurements, not this task's browser benchmark. The parent also
confirmed #738 is absent from live deployment; its neighborhood module returns 404 there.

This task independently inspected #726 at `2f46f6116e24ab07b4e5d2b9f7c255b5837c8d9b`: the Games registry
fetch begins on overlay open, and Start uses a route link. It does not eagerly import the city engine
or render the city inside Cesium. Its small registry cache is page-local; close currently does not
cancel an in-flight registry fetch. Reuse that existing owner-gated directory and the existing globe
altitude gates. Do not add a competing games registry or infer that hiding already-created buildings
reduces download/parse work.

**Measured local city load** (Chromium SwiftShader, DPR 1, fixture auth/API, actual local modules):

| Width | Run | Ready | Settled | Decoded app assets | Script execution | Draws / triangles |
|---|---|---:|---:|---:|---:|---:|
| 390 | cold context | 1529 ms | 1569 ms | 3,627,869 B / 47 responses | 0.149 s | 68 / 44,270 |
| 390 | repeat page load | 1160 ms | 1178 ms | 3,613,361 B / 46 responses | 0.101 s | 68 / 44,270 |
| 1280 | cold context | 1363 ms | 1412 ms | 3,627,869 B / 47 responses | 0.144 s | 79 / 44,478 |
| 1280 | repeat page load | 1316 ms | 1332 ms | 3,627,869 B / 47 responses | 0.088 s | 79 / 44,478 |

12 active chunks at each sample. These are decoded asset response bodies, not gzip wire bytes;
Playwright routing disables HTTP caching. The repeat is **not a production warm-cache test**.
ScriptDuration is execution, not isolated parse time. Different response counts can reflect late
asset timing. Heap samples and individual asset sizes are in the metrics JSON; no real-device FPS,
network improvement or memory-leak conclusion is inferred. Before/after production benchmarks and
isolated parse profiles remain outstanding.

**Owner policy prerequisite for geographic experience loading:** reuse the canonical versioned
owner-controls service, with approved revision, region/frame ID and geographic bounds, entry/exit
altitude and proximity hysteresis, asset manifest hashes/byte budgets, concurrency/cache budgets,
and explicit-entry behavior. Owner edits need draft/preview/publish/history/restore; lower-role
changes must be scoped and server-validated. Runtime eligibility must require server permission
as well as viewport/zoom, revoke access by canceling/disposal, and preserve per-experience saves and
deep links. No new policy storage/API was invented while the shared owner-controls contract is
unresolved. Automatic proximity activation, configurable production thresholds and in-Cesium city
rendering are **not implemented by this continuation**.

## Verification and review

- 107 focused city tests passed.
- 14 deterministic real-Three scenarios passed, including preview/confirmation, indoor→street
  routing, bicycle behavior, thin blockers, stale cancellation and actual HQ doorway walking.
- 89 full city browser checks passed; 46 final navigation/bike checks passed at 390/768/1440 px.
- Root suite: 1,638 passed, 3 skipped, 0 failed, plus 7 Python tests.
- Four upstairs browser reproductions recorded the defect above; these are findings, not a stair fix.

```sh
node tools/fictional-city/audit-city-placement.mjs
THREE180_DIR=/tmp/three180 node scripts/e2e/fictional-city-camera-inputs.mjs
CITY_NAV_ONLY=1 CHROMIUM_PATH=/usr/bin/chromium THREE180_DIR=/tmp/three180 \
  node scripts/e2e/fictional-city.e2e.mjs /tmp/city-route-browser
CITY_LOAD_ONLY=1 CHROMIUM_PATH=/usr/bin/chromium THREE180_DIR=/tmp/three180 \
  node scripts/e2e/fictional-city.e2e.mjs /tmp/city-load-audit
CHROMIUM_PATH=/usr/bin/chromium THREE_DIR=/tmp/three-package/package \
  node scripts/e2e/fictional-city-upstairs-audit.e2e.mjs /tmp/city-upstairs-audit
```

Browser harnesses require Playwright via `PLAYWRIGHT_DIR`/`CODEX_PRIMARY_RUNTIME_NODE_MODULES` and the
exact Three 0.180 files. These are local fixture previews, not public sites. Review screenshots,
JSON findings, metrics and patches are in `/workspace/city-review-evidence`. A public review URL
requires a separately approved publication target; none was created. Physical-device testing and
production warm/cold benchmarks remain release checks.
