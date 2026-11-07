# Shared Cesium exterior controls

Entry remains `action-globe.html?explore=1&bridgeport=2`, behind the existing server-verified
owner gate. This continues merged release #772 and its City-to-Sole correlated-arrival flow.
It does not replace the separate street tactical simulation from #781 / upstream Prim3 #22
(pinned resolver commit 197bc2d8df4dc5638249125804eba752e534710e).

## Bounded journey

- Select Map, Follow behind, or First person. W/S move and A/D turn; touch users hold the
  directional buttons. Map restores the existing camera controls and route picking.
- Walk and Bicycle reuse the existing standalone locomotion profiles: 0.43 m / 1.08 m body
  radius, with the bicycle's bounded acceleration. Mounting requires current clearance.
- A simple original player/rider model uses the existing actor entity. Camera booms use the
  existing conservative sampled-clearance helper. Models are not real people or sourced objects.
- Position remains authoritative metric street geometry. Every manual step and confirmed route
  uses the existing `region-graph.mjs` swept collision query, source footprints, street bounds
  and closures. Bicycle queries widen the body profile in a temporary query view; the source
  descriptor and graph are never mutated. A walking route too narrow for the bike is refused;
  this does not claim to find an alternative bicycle route.
- Manual input or travel-mode changes cancel route preview/execution and its correlated arrival
  request. They cannot report a mission arrival merely by moving nearby. Fresh confirmed route
  arrivals retain the existing consumer protocol. No tactical AP, combat occupancy, threat state
  or resolver is copied into this viewer.
- Blur/hidden page stops held input. Return, unload, revoked ownership and destruction release
  camera control and input state. Re-entry starts in Map/Walk; camera and bicycle are session
  preferences, not vehicle inventory or shared administrative policy.

## Persistence and geography boundaries

The existing revision-pinned `here.universe.bridgeport-downtown.v2` position save remains in use;
v1 uses its original independent slot. Position saves on stopped input and the existing lifecycle. Explicit old-slice import stops
  movement and dismounts before continuing at the validated imported pose.
No new save schema, pose conversion or migration is introduced. Legacy fictional City, Sole and
`here.prim3.city-tactics.v1` saves remain separate. The original City stays at its authored positions.
Full relocation requires an explicit, reviewed mapping/migration; no such migration is implied.

Only existing sourced exterior road/footprint geometry is used. Street width, flat navigation
height and building extrusion remain illustrative. Loaded terrain height affects camera/model
presentation only, never the authoritative street floor. No real doors, stairs, furniture, cover
or interior landing data are invented. Live ion and physical-device performance require separate
acceptance. Close views expose the limits of the existing illustrative extrusion and imagery.

## Acceptance and integration

Run `node --test scripts/test/bridgeport-exterior.test.mjs` and
`EXTERIOR=1 SLICE=v2 WIDTHS=390,1280 node scripts/e2e/bridgeport-shared-globe.e2e.mjs`.
The browser run measures 30 animation-frame intervals and available JS heap at both widths,
using software Chromium and fixture owner/API/imagery. These are environment measurements,
not a hardware performance guarantee. `city-arcade-spatial.e2e.cjs` checks the actual same-viewer
Sole entry, confirmed arrival, return, resume and revocation contract.

This continuation is based on main after #783 and preserves its descriptor policy imports, loader
and cell budget selection. The avatar adds graphics to
one existing actor entity, not extra entities outside that budget. This branch does not modify
#783, #767, the tactical resolver, database, credentials, permissions or production settings.

Finite original-scope map: close/first-person and bicycle now operate within the bounded shared
Cesium exterior; the existing map route preview/confirm/return remains available. Full legacy-city
relocation, close-view minimap/landmark HUD parity, unsourced interiors/vertical travel, live ion,
physical-device tuning and a combined Cesium combat presentation remain unfulfilled.
