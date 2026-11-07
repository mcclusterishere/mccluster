# PRIM3 shared spatial contract

Status: implementation proposal, 2026-11-04. This document changes no runtime, assets, saved games, geographic anchors or database schema. It describes the contract needed for tactical and free-walk modes to agree about the same place while retaining their different controls and rules.

## Existing contracts and authority

| Source | Implemented contract | Boundary |
| --- | --- | --- |
| `js/prim3-tactics/scale.mjs` | Tactical tile side is 3.54 m; operative height is 1.75 m. Rules use tile positions/ranges and metre heights. | Changing this constant alone would change physical movement/range and invalidate old coordinates. |
| `js/prim3-tactics/levels/transit-relay.mjs` | Original authored compound, with display `FRAME {x0:32,y0:31,yUp:true}`. | A display origin is not a geographic anchor. Transit has no verified real-world location. |
| `js/prim3-tactics/levels/equity-uprise-hq.mjs`, `adapters/equity-uprise/adapter.mjs` | HQ plans use feet, 12 ft per cell; `WORLD_M = 3.6576`. Canonical GLBs use metres with Z up. | Preserve the measured building. Engine floor B1 `z:8` is a floor identifier, not eight metres of altitude. |
| `core/data/fictional-city/places.v1.json` | City geometry uses metres, +X east, +Y up, +Z south; stable place IDs separate geometry from authored lore. | Its geographic frame is explicitly unanchored: `wgs84` and `headingDeg` are null. |
| `js/fictional-city/planet/georeference.mjs` | Named frames, ENU/ECEF and CT State Plane conversions, floating origin, explicit Bridgeport equirectangular projection. | The Bridgeport frame has its own fixed origin/offset and approximation. Its existence does not anchor every authored place or Transit. Keep horizontal and vertical datum information. |
| `js/fictional-city/tactical.mjs` | `cityFrame`, `tacticalRegion`, HQ feet/city transforms; city tactical cells are 3.54 m. | Region export samples cell centres. It is an adapter, not proof that city gameplay currently uses a shared tactical navigation implementation. |
| `js/fictional-city/spatial.mjs` | Continuous collision uses a 0.43 m player radius; metric interior fixtures feed geometry/collision. | Interiors are separate scenes; city HQ massing/portal does not provide continuous walking through canonical HQ interiors. |
| `js/prim3-tactics/levels/forge.mjs` | Forge authors metre cells and exact prop transforms; adapter derives coarse tile footprints, blockers, cover and stair/ladder links. | Rendering exact props and snapping rules to tiles can disagree about narrow spaces. |

The HQ package builder (`scripts/prim3/build-equity-uprise-package.mjs`) already records source SHA-256 provenance. Extend that pattern rather than declaring rendered meshes a new authority. `docs/universe/UNIVERSE-SCHEMA.md` and its registry retain separate mode/universe state and registered transitions; sharing geometry does not merge all game rules or save slots.

Resolver, AI and tactical hints belong to `mcclusterishere/Prim3`. `js/prim3-tactics/SOURCE.json` pins the downstream copies. Changes to action distances, legal movement edges, occupancy or LOS belong upstream, then must be vendored with updated hashes and regression evidence. A renderer-only pathfinder must not silently replace legal tactical movement.

## What is currently missing

The implementation review found three exact city door anchors that land on blocked coarse tactical cells: `civic-center/wiggers-anonymous`, `hq-waterfront/shop-03`, and `hq-waterfront/shop-04`. It also found 48 directed adjacent open-cell movements whose movement failed continuous collision. These are review reproductions of the current adapter, not deployed repairs; preserve them as regression fixtures. `tacticalRegion` uses radius 0.3 m while free walking uses 0.43 m. Open endpoints therefore do not establish that a body can travel between them.

HQ equipment/furniture can be walkable in the adapter's cell grid while contributing coarse LOW/HIGH cover. HQ stair links and door links represent connectivity/cost rather than a tested continuous route through the measured opening, stair flight and landing. City interior furniture has a stronger shared metric basis, but these interiors are not canonical HQ rooms. A city-to-HQ portal is not evidence of free-walk stair continuity.

Current tactical saves store the battlefield and integer cells, now with mission identity, but no pinned spatial frame/geometry revision. City saves retain metric x/z and interior identity; existing migration preserves the original unmoved frame. Neither justifies reinterpreting tactical positions under a new grid spacing.

## Proposed shared geometry record

Use a versioned spatial manifest derived from the existing source authority, in local metres. Each manifest identifies `schemaVersion`, `frameId`, `frameVersion`, `sourceHash`, source paths/revisions and adapter/compiler version. Local authored frames remain explicitly unanchored. Geographic frames additionally name the actual projection, origin, heading and horizontal/vertical datum. Floating render origins are transient offsets, never saved world-coordinate changes.

Each source object needs a stable, namespaced `objectId`, source reference, metre transform, footprint/solid geometry, vertical extent, level/surface identity and semantic role. A door also needs its opening, hinge or slide transform, open/closed/locked state and approach anchors. A stair needs both landing surfaces, traversable width, flight/ramp geometry and elevation transition. Furniture needs its physical collision volume; whether it provides cover or blocks sight is explicit and can differ from movement collision. Transparent glazing can block movement without blocking vision.

Derive these products from the same revision:

- Render geometry and debug outlines, tied back to source object IDs.
- Metric colliders and support surfaces, including door-state changes and furniture clearances.
- Sight blockers with height/material semantics, plus tactical cover candidates validated against those solids.
- Navigation regions/edges and typed links for stairs, ladders, doors and other transitions. Each link records endpoint surface IDs, metric endpoints, width/clearance, direction, state prerequisites and owning object ID.
- Interaction approach anchors reachable by the applicable body profile. An inaccessible object centre is never substituted for an approach point.

Maintain an explicit actor profile (radius, standing/crouched height, step and slope limits). If modes intentionally use different profiles, the difference must be declared and shown in validation; do not disguise it as inconsistent geometry. Shared source geometry does not require identical tactical AP rules or free-walk speed.

## Evaluate 2 × 2 subdivisions without rescaling

For ordinary 3.54 m tactical tiles, a 2 × 2 subdivision gives 1.77 m candidate cells. Treat this as an optional spatial index or finer tactical candidate lattice. It does not enlarge buildings, shrink characters or automatically double action ranges. HQ's existing 12 ft cell would subdivide to 6 ft (1.8288 m), not 1.77 m; HQ geometry must remain 3.6576 m per original cell.

A 1.77 m lattice is still wider than a 0.9 m door. A 0.43 m-radius body is 0.86 m wide before clearance margin. Depending on alignment, centre sampling may erase a usable opening or allow an impossible crossing. Use exact opening/portal geometry and swept-body clearance along candidate edges, with adaptive local navigation or constrained approach points near doors. Fine occupancy alone is insufficient. Test diagonal corner cutting, a door within one coarse cell, and a doorway straddling cells.

Separate logical tactical occupancy from the metric traversal path. If finer candidate positions become real tactical positions, define upstream movement/AP cost, range, adjacency, targeting, reactions and cover rules in metric terms or with a versioned conversion. Doubling grid indices while leaving ranges or costs unchanged is not acceptable. Keep the existing 3.54 m rules until the new semantics and replay fixtures are explicitly adopted.

## Square and hex topology: proposed, not implemented

There is no working hex navigation mode in the inspected tactical runtime. The current resolver uses Manhattan distance (`gridDistance`), square-grid line traversal, four-direction cover, cardinal movement/path validation, Manhattan interaction ranges and extraction/area tests. `level3d.mjs` rounds square hit coordinates and uses a rectangular fog texture. Hints and AI also need auditing against those assumptions. Changing the grid drawing would leave legal actions square-based.

Introduce a versioned per-level topology contract upstream before offering a working switch. Its boundary must cover cell IDs and neighbours, metric cell centres/polygons, inverse picking, edge costs, occupancy/clearance, range/adjacency/area policies, deterministic LOS traversal, cover directions, fog indexing and link endpoints. The geometry authority and its metre transforms stay unchanged. A level may derive square and hex navigation from the same scene only after both satisfy clearance and objective reachability.

For a possible pointy-top hex adapter, define axial `(q,r)` and cube `(q,r,s)` with `s=-q-r`; same-floor hex step distance is `max(abs(dq),abs(dr),abs(ds))`. With circumradius `a` in metres, local horizontal centres can use `X=a*sqrt(3)*(q+r/2)`, `Z=1.5*a*r`, followed by the declared frame origin/rotation. Inverse picking uses fractional axial conversion and cube rounding with a deterministic tie rule. A flat-top orientation needs a different declared transform, never an implicit renderer swap. Axial `r` is not metric south and the floor ID is not cube `s`.

Choose hex size explicitly: side length, across-flats width, centre spacing and area are different quantities. There is no universal hex equivalent of a 3.54 m square. Preserve actual metre dimensions and agree whether a scenario matches centre spacing, movement metres or cell area. Define range/AP policies separately; switching from Manhattan to hex steps changes balance even with identical geometry. Metric LOS should query the common solids; a discrete hex visibility cache still needs deterministic boundary handling and tests for grazing edges. Furniture occupancy must test the body's swept route and polygon clearance, not merely whether a hex centre overlaps a solid.

The safe UI boundary is a per-level Forge draft setting with a named supported topology/version. Initially square remains the only playable choice. An experimental hex overlay must be labelled as preview-only and must not advertise working hex movement. A validated topology change creates a new playable revision and an explicit fresh scenario; it cannot mutate a running mission. Existing saves retain their topology and geometry revision. Migration to another topology requires the metric conversion/validation below; no axial reinterpretation of old x/y, silent snapping or loss of the original run.

Stage the work: (1) extract a square adapter upstream while preserving exact replays; (2) test a pure hex adapter for inverse transforms, six neighbours, distances, ties and floor links; (3) integrate resolver, AI, hints, cover/LOS, renderer picking/fog and serialization together; (4) compare both topologies on the same door/stair/furniture fixtures and a complete mission. Only then expose a playable topology selector. Camera projection, axis/origin display and grid topology are separate settings; orthographic projection alone changes none of these rules.

## Save compatibility proposal

1. Keep existing save keys/readers and the original payload. Add versioned spatial metadata only with an actual compatible writer/reader. Do not silently stamp an old save with today's source hash.
2. For a known legacy level/revision, use an explicit historical adapter: old tile coordinates → that revision's metric position and surface identity. Record its origin, axes, metres-per-cell and centre convention. Transit integer actor centres and city `tileCentre`'s half-cell offset are not interchangeable. HQ requires its own feet/frame/floor-elevation mapping.
3. Validate metric positions and routes against the target manifest and actor profile. Store frame version, source hash, migration version and original provenance with the candidate converted save. No automatic snapping, nearest-free-cell relocation or overwrite of the old run.
4. If the historic frame/source cannot be identified, or the target geometry blocks a position, preserve the original and offer its compatible revision or an explicit new run. Report the affected object/position for review. Loading must not partially replay a hostile phase or advance the clock.
5. Commit a converted save only after full validation and a successful storage write, with recoverable original data. Test write failure and reload. Keep random state, action phase, objectives, actor health and mission snapshot unchanged by geometry conversion.

This is a migration design, not a new migration implementation. Existing browser-only, per-level save limitations remain. Durable account saves require the existing canonical backend's separately reviewed implementation; this document introduces no service or SQL.

## Existing owner controls and review flow

Extend Level Forge's current Save draft, Check/validation, Play test, export and optional authenticated cloud revision/freeze controls. `prim3-level-builder/editor-ui.js`, `model.js`, `cloud-client.js` and `levels/forge.mjs` are the integration points. The current editor does not expose the proposed fine navigation/georeference fields.

The proposed preview adds overlays for exact geometry, tactical candidate cells, actor clearance, sight blockers, link endpoints and unreachable interactions. Validation names source object IDs and distinguishes geometry errors from intentional mode differences. The same manifest must drive free-walk preview and tactical play test.

A cloud playable-version freeze is private in the existing Forge UI; it is not public site publication. Retain the canonical McCluster auth/API and review/deployment path, revision conflict handling and existing permissions. Do not add a second editor backend or claim live cloud readiness merely because client controls exist. Public release requires reviewed artifacts and the normal deployment controls.

## Acceptance before enabling a shared runtime

| Fixture | Required evidence in both modes |
| --- | --- |
| Door | Approach, cross and leave a measured 0.9 m opening with the declared body profile; closing blocks passage; locking affects the same owned door; opening changes collision/LOS as specified. Test off-grid alignment, diagonal approach and an oversized body that must fail. |
| Stairs | Travel from lower support surface through the flight to the upper landing and back without teleporting through ceilings, falling through floors or skipping a closed landing door. Tactical link endpoints and animation follow the same route; elevation and AP cost are independently asserted. |
| Furniture | Pass through a measured aisle, fail a narrower one, and avoid clipping at corners. The visible furniture, collision outline and cover/sight result reference the same object revision. |
| Sight | Closed opaque door/wall blocks sight, glazing follows its declared transparency, and low furniture produces the intended standing/crouched result without granting passage through the solid. |
| Mode transition | A shared anchor resolves to the same metric location and surface. A universe portal preserves each mode's state and applies its registered spawn mapping rather than guessing from display grid labels. |
| Save/reload | Resume old valid runs under their known frame; migrate only explicitly supported revisions; preserve unsupported/blocked originals. Reload preserves metric pose, mission state and source identity with no relocation. |
| Geography | Known control points round-trip in their named frame; authored unanchored levels remain unanchored; render-origin shifts never alter authoritative positions. |
| Phone play | Real pointer/touch controls reach doors, stairs and interactions; route preview matches executed movement and the body stays inside clearance. Record browser, viewport, frame time and visual limitations. |

First implement regression fixtures for the reproduced door/edge failures and a minimal measured room-door-stair-furniture scene. Then integrate one shared manifest and clearance query behind existing adapters. Only after both modes pass those fixtures should upstream tactical position/range changes or a finer grid be considered. This document's inspection and review evidence do not establish that a continuous HQ free-walk mode, fine-grid resolver, save migration or shared geometry runtime already exists.

## Coordination inputs

The review observed these remote branches as coordination inputs, not integrated geometry authority: `claude/bridgeport-perf-20261103` at `d0c1d8e35bda73055b6b141dde03fb5f9e7bb416`, and `codex/city-close-camera` at `9627788cb60e535d693f6f73404e347102a39d33`. Check their current ownership and diff before proposing overlapping city changes; this document does not import or overwrite either branch.

The parallel Transit setting for “Tactical cells” versus “2×2 guides” is a visual guide change. It must leave resolver cell size, costs and saves unchanged and must not be presented as implemented fine navigation. Courtyard projection/axis/origin work is likewise separate from hex or shared traversal. Recheck the door/edge regression counts when those consumers change; the counts above describe the reviewed adapter, not a permanent invariant.
