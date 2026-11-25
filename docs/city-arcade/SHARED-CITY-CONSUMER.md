# Sole Run shared City consumer — downtown v2

The original #743 consumer and City v2 are integrated on main. This progression follow-through
preserves City #767 (`0d4f696de8a13749619aa3a446a8231f616ba198`) and adds bounded route
correlation to the existing lifecycle. #767 must be integrated before this follow-through;
merges and rollout remain with release coordination. No coordinate contract, graph or geometry
is copied or reauthored. The consumer continues to require v2 and rejects v1 replies.

## Actual entry and routes

Open city-arcade.html?game=designer-kicks-sole-run&location=bridgeport-main-golden-hill or use location=bridgeport-main-elm . Play the actual street game, then choose **Walk Sole routes on globe**. The consumer pauses and persists the existing Sole session, disables gameplay/configuration controls and sends bridgeport:enter with regionId bridgeport-downtown.v2 to the existing same-origin arcade iframe. The actual Cesium viewer is retained.

The Street objective selector follows the owner's configured four-checkpoint order, defaults to the current objective (or return entrance after four pairs), and also offers main-south and return to the original entrance. Existing aliases map exactly to City's published IDs: main-elm, main-fairfield, middle-golden-hill, main-golden-hill and main-south each receive the bridgeport- prefix. **Preview selected route on globe** sends the chosen destination ID to City; City supplies the expanded graph route and exact final entrance connector. The UI does not claim success merely because it sent a request. Review the route or blocked message, then use City's Confirm/Stop and square/hex controls. Return to Sole Run sends bridgeport:leave and waits for the pinned returned event; resume is explicit.

Confirmed, correlated arrivals now advance the existing Sole mission. Start a local or saved
mission first. While shared walking is active, the 2D inputs and timer stay paused. A matching
arrival at the current configured stop collects one pair using the same reducer/reward as 2D
play. After all four, a confirmed route to the original entrance completes the run. Visiting
another stop awards nothing. The next objective is selected automatically but still requires
preview and explicit confirmation.

Named checkpoints map back to their existing legacy street points; continuous ENU coordinates
are never interpreted as legacy positions. The updated checkpoint, score and original cloud run
ID are persisted immediately in the existing Sole session key. Return resumes 2D play at that
checkpoint. Reload preserves earned pairs but cancels any pending route correlation; enter and
preview again. Terminal cloud results persist before return and use the existing finish/retry
path after return acknowledgement. No schema, reward authority or save-key migration is added.
These are still self-reported private practice results, not anti-cheat-verified benefits.

City retains its own position save and topology. Its Find me and terrain-status behavior from
#767 is preserved. Geometry, footprint identity and navigation data are unchanged.


## Closure policy and lifecycle

Sole blockedRoads contain clipped IDs such as bridgeport-osm-186839735-0; City accepts whole OSM way IDs. The explicit conservative policy is to close the ENTIRE corresponding source way in the shared simulation, not just its clipped segment. Duplicate segment closures collapse to one way. Only the six source ways declared by City v2 are accepted; unrecognized IDs block entry rather than bypassing a restriction. The visible UI discloses this broader closure. On ready the consumer applies the current mission's closure list (including reopening all ways when empty) and keeps route controls disabled until City acknowledges it. City cancels stale previews/motion and remains the authority for reachability. Subsequent changes from City's own closure controls invalidate its navigation and are reported to the consumer. These are simulation restrictions, not real road reports.

Messages must match source iframe, same origin, lifecycle schema, region bridgeport-downtown.v2, revision2, frame bridgeport-golden-hill.enu.v1, street floor and selected entrance. Metric position is validated but never reinterpreted as a legacy pose. Navigation revision cannot go backwards; road-closure capability and recognized closure IDs are required. Missing/older hosts time out and leave Sole paused. Revocation is enforced by existing page and City owner gates. Disposal leaves City and removes listeners. Initial deep-link flight cannot cancel explicit entry before an in-region camera observation; subsequent departure still saves/unloads.

City owns its 845,560-byte v2 payload and budgets; Arcade's own legacy district load is separate. This is not a claim that their combined transfer fits one shared budget. No surveyed road width/elevation, door, stair, furniture, combat/AP or live ion capability is added. All 16 source footprints remain City blockers. Live ion remains unverified.

## Verification

- node --test scripts/test/city-arcade-spatial.test.mjs : lifecycle/version gates, unsupported aliases, conservative closures, timeout/late replies and closure-acknowledged route enabling.
- node --test scripts/test/*.test.mjs : standalone #743 root regression.
- In an isolated combination with exact City da0b411b: node scripts/test/city-arcade-spatial-contract.integration.mjs . Uses the actual published graph and reference math; verifies all five source aliases and rounded legacy points, <1mm round trips, both complete five-stop sequences and exact swept-clear connectors, Main-way closure denial and reopening. No fixture graph substitutes.
- In that same checkout: node tools/publish-fictional-city.mjs; serve loopback port8768; ARCADE_BASE=http://127.0.0.1:8768 node scripts/e2e/city-arcade-spatial.e2e.cjs . Requires Playwright, /usr/bin/chromium and pinned Cesium1.131 Build/Cesium via CESIUM_BUILD (default /tmp/arcade-cesium/node_modules/cesium/Build/Cesium).
- Browser fixture router denies hosted traffic. At390 it enters Golden Hill and previews/walks to Elm; at1280 it enters Elm and walks to Golden Hill. It verifies actual Sole play/pause, actual City arrival, square switching with metric position retained, earned checkpoint persistence with unchanged timer, same viewer, shared resume and revoked-owner return. API identity, imagery and ion-unavailable replies are fixtures, not production verification.

## Return acknowledgement recovery

Explicit Return cancels the entry deadline and waits for City. If no valid returned reply arrives within10seconds, **Retry return** resends the leave request to the same frame. Sole gameplay and route controls remain paused; timeout alone does not claim a completed return. A late valid acknowledgement still completes the return. Finish, iframe reload and disposal cancel the retry timer.

Regression: ARCADE_WIDTHS=390 ARCADE_DROP_RETURN=1 ARCADE_BASE=http://127.0.0.1:8768 node scripts/e2e/city-arcade-spatial.e2e.cjs deliberately drops all actual City returned acknowledgements for the first request, verifies controls stay paused, retries and completes the return. The fixture harness waits for the lazy iframe to navigate before accessing its renderer.

Reviewed against the auditor's portable repair in PR743 comment6644003305. The adapter retains its leaving state while retry is offered, so late ready/closure messages cannot re-enable navigation before return acknowledgement. This strengthens the proposed deadline/retry approach; regression coverage also includes duplicate acknowledgements and disposal cleanup. City owns the separately identified pending-import cancellation/acknowledgement companion repair.

## Correlated arrivals (additive lifecycle contract)

`bridgeport:preview` may carry a bounded alphanumeric/hyphen `requestId` (1–80 characters).
The existing owner-checked dispatcher forwards it to City. City advertises `correlated-arrival`
and echoes `requestId` plus `destinationId` only after that named route is confirmed and its
actual movement reaches the exact entrance connector. Preview replacement, Stop, topology
change, closures, import, unload and leave clear the correlation. Picking arbitrary cells or
using City's own destination selector has no Arcade request ID and awards no Sole progress.

Arcade creates a fresh random ID per preview and accepts an arrival only from its exact iframe
and origin, pinned region/frame/floor/revision/entrance, matching navigation revision, desired
closures, request ID and destination. It consumes the request once before calling Sole's reducer;
the reducer independently checks paused status, remaining time, current index and configured
objective. Return/retry, reload and disposal invalidate pending requests. Older City hosts can
still navigate but cannot award progress. Owner checks remain in both host entry and City motion;
cloud result submission reuses canonical authorization and actor-bound runs.

`sole-shared-progression.test.mjs` covers custom checkpoint order, configured rewards, duplicate
and wrong-order arrivals, inactive/expired runs and final entrance completion.
`city-arcade-spatial.test.mjs` covers correlation and invalidation. The full browser regression
`city-arcade-progression.e2e.cjs` uses actual Cesium routing/movement at 390px/1280px with a
**test-only accelerated animation clock**, synthetic auth/imagery and isolated PGlite. It checks
all pairs, explicit entrance completion, return/reload midway, duplicate events and cloud result
persistence. It does not measure real-time walking speed, production auth or ion entitlement.
