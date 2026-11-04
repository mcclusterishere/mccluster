# City contract tactical consumer checkpoint

Dependency: City #748 v2 head `da0b411b9dd6db4ed88450ab6ffd41c6d51add07`,
stacked on #736; its v1 contract remains `a55e7ceed929f6dbe81c341d1097536a92744a24`.
This separate consumer branch includes that checkpoint. It does not import the
entire City stack into PRIM3 #739 or change the existing upstream engine pin.

`js/prim3-tactics/shared-spatial-preview.mjs` consumes City's region payload and reference
route/clearance exports. It returns read-only street navigation previews for square and hex,
with explicit metre budgets, checked edge costs and continuous starting positions. It cannot
execute tactical actions and does not read/write browser storage or migrate legacy saves.
There is no renderer or owner-control integration in this checkpoint.

The runnable City update adds the owner-gated Cesium lifecycle seam, but explicitly retains
the same street-only geometry and no combat interface. Its `mccluster.spatial-lifecycle/v1`
preview/confirm messages authorize only that exterior navigation flow. They cannot authorize
a PRIM3 move or spend AP. This adapter does not send those messages or represent their arrival
event as mission completion. A playable new tactical scenario is deferred until the essential
interfaces below can be implemented upstream with meaningful combat regressions.

## Semantic gaps for City/coordinator

- No vertical links, doors/door state, furniture or height-aware LOS query.
  Street-only scope cannot satisfy the multi-floor/door tactical acceptance criteria yet.
- City routes use floating metre costs. Existing Prim3 resolver uses integer costs and
  bidirectional links. Do not round hex edge costs or convert them to AP implicitly.
- City reference route has no tactical occupancy, known-information projection or combat
  phase/reaction handling. It must never be used as execution authorization.
- City's restorePosition checks walkability; graph entry additionally requires a clear
  connector. A valid stored continuous pose can therefore have no available graph route.
- Current route lookup scans candidate connectors; this consumer is tested as a deliberate
  preview request, not a per-frame hover loop. Browser performance remains unmeasured.

## Integration sequence recommendation (not merge authorization)

1. Review City #736 dependency and #748 exact contract, including their own checks.
2. Preserve #739 / upstream #21's tested tactical fixes. Reconcile the City dependency with
   the integration owner before changing #739's ancestry or adding imports to absent modules.
3. Apply this consumer-only checkpoint after City's shared files exist in that integration
   tree; run both City's contract and PRIM3 regressions on the combined exact head.
4. Agree explicit upstream metre/AP/range/occupancy/LOS semantics before gameplay wiring.
   Multi-floor work requires City to provide authoritative surfaces and directed links first.

Validation: `node --test scripts/test/bridgeport-shared-spatial.test.mjs
scripts/test/prim3-shared-spatial-preview.test.mjs` — 10 passed, zero skipped/failed.
Hex reference path 31 cells / 77.94228634059948m; square 45 cells / 88m.
Geo/local roundtrip maximum 2.9816871793412e-9m. Tests cover budget boundaries,
pose preservation, topology switching without teleportation, incompatible saves/floors,
missing budgets, unknown destination and unsupported vertical extension rejection.
No browser playability, AP parity, live ion entitlement or production readiness claim.

## V2 bounded extension

The adapter accepts the exact downtown v2 identity/revision as well as v1, without converting
old saves. Canonical closure IDs pass to City's route and clearance queries. Saved closure IDs
are retained by default; callers can explicitly supply current session closures. Returned
navigationRevision identifies the request snapshot, but no confirmation/execution consumes it
yet. Exact source entrances use City's routeToEntrance, including the final metric connector.

quoteSharedMovement is a pure advisory calculation for a new metric scenario. The caller must
provide moveRangeM, AP, MOVE/DASH, mover identity, body radius and player-known occupants. MOVE
quotes one AP and one range; DASH quotes two AP and twice the range. There is no implicit legacy
tile conversion, no AP debit and no execution authorization. Swept horizontal disc checks flag
known living/downed occupants between endpoints, excluding the mover, dead/extracted actors and
other floor identities. A blocked reference path is reported as blocked, not claimed to be the
only path; this helper does not reroute. The caller owns the information boundary: never supply
hidden actors to a player preview. Authoritative contact interruption/reactions remain unimplemented.

V2 validation: 21 contract/gate/consumer tests passed with zero failures/skips, including exact
entrance positions, closures, version rejection, AP thresholds and swept known-actor occupancy.
No scenario UI, mission execution, upstream resolver update or browser save change was introduced.
