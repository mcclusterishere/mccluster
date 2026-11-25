# City navigation reconciliation — local review, 2026-11-04

## Source and boundary

Base: `4fc32c84970d1a5cbc69c2df218e700bcea14032` (current checkout, branch `work`).
No branch publication, PR creation, merge, deployment or production database operation was performed.
No public preview URL was created. Browser evidence uses local files with fixture owner/member/guest
responses and real Chromium/Three.js, not a production account.

Recovered and reconciled:

- [#736](https://github.com/mcclusterishere/mccluster/pull/736), `9627788cb60e535d693f6f73404e347102a39d33`: close camera,
  interior camera clearance, minimap and numbered directory. Preserved #731's government-directory
  inclusion when reconciling its app conflict. Numbers now sit in category text, keeping building
  headings accessible by their actual names.
- [#738](https://github.com/mcclusterishere/mccluster/pull/738), `d0c1d8e35bda73055b6b141dde03fb5f9e7bb416`: surveyed
  neighborhood streaming and per-building window batches. Combined its import with camera controls.
- [#730](https://github.com/mcclusterishere/mccluster/pull/730), `f56a5661f6dc01b92a3dfca02a8c724991de8406`: inspected,
  not activated. Jimmy's source parcel overlaps existing authored occupants in the current frame.
- [#726](https://github.com/mcclusterishere/mccluster/pull/726), `2f46f6116e24ab07b4e5d2b9f7c255b5837c8d9b`: inspected,
  not applied. This is the existing owner-only Cesium Games directory/Bridgeport camera-flight work;
  it hands off to the city page. It does not render the playable city inside Cesium.
- Recent Claude branches and default-branch Bridgeport commits were inspected. #721/#722/#723/#731
  are already represented on the base; do not replay them. `claude/equity-uprise-hq-real-20261103`
  is an older broad branch with unrelated changes, not a safe whole-branch import. Searches found no
  separate current `align`/`geograph` branch. Unpushed work cannot be recovered through GitHub.
- PRIM3 grid, screens (#737), owner-controls and geography source files remain untouched.

## Usable local increment

The owner-gated city has explicit third-person, first-person and overview controls, optional
locked-behind steering, live heading/player minimap, floating readable building names with an off
switch, and a destination selector including Equity Uprise. Destination guidance states straight-line
metres; **Walk there** uses the existing collision-aware pathfinder and does not teleport. Yellow
minimap markers show the destination or its direction at the edge. Sourced footprint rings are used
on the minimap when present, instead of substituting bounding boxes.

Names derive from the current building records; none are renamed. Labels are limited to nearby
on-screen records and separated from the upper camera/minimap controls. Indoor labels are hidden;
the existing room/exit map remains available. Streaming, save v1→v2 migration, canonical IDs, original
shop coordinates, private gate and actual civic identities are preserved.

These controls change the current viewing session only. They are not a shared world editor or an
administrative-policy store. The database/persistence decision for this increment is **no schema or
saved-position change**. The existing server-checked owner gate applies; member/guest receive no
runtime or city data. Lower roles gain no implicit permissions. The broader shared authoring controls
still belong to the ongoing owner-controls work. Root `AGENTS.md` now records the owner's required
backbone/security/data/controls-first build sequence and honest release evidence.

## Geography audit and next region boundary

The northern neighborhood retains 16 CT 2023 footprint polygons and OSM road polylines in the fixed
`mccluster-city.bridgeport-equirect.v1` frame. Heights/doors/interiors and road widths are authored or
estimated. The rest of the original district, expansion parcels, water and island are authored.
#723's 59-building/48-chunk harbor crop is a source pilot; it is not scene-integrated.

Using the repository's sourced address points and its unchanged projection:

| Institution | Current authored X,Z (m) | Sourced-address X,Z (m) | Separation |
|---|---|---|---|
| Bridgeport Police Department | −90, −30 | −181.7707, −405.9458 | 386.98 m |
| Harding High School | −236, −32 | 1804.2225, −2048.7218 | 2868.74 m |

The official [police page](https://www.bridgeportct.gov/government/departments/police-department)
confirms 300 Congress Street; the [school's site](https://harding.bridgeportedu.net/) identifies Harding.
Address-point provenance and limitations are in `geography/real-institutions.v1.json`; these are Census
address-interpolated points, **not surveyed footprints**. Correct names do not prove correct placement.
The existing geographic tests check source-ring parity and projected coordinates.

Before relocation: preserve the legacy region and v2 saves; add a versioned region/frame reference and
explicit mapping for relocated entities; separate owner-authored tenant bindings from verified parcel
ownership/use; preview road/footprint intersections and walking routes through owner controls. Do not
snap metric geometry to tactical cells. Resolve Jimmy's partial footprint/occupied parcel and the
requested City Trust/HQ binding against an authoritative placement record. No City Trust record was
found in the inspected checkout, so no placement was invented. The existing canonical island proxy
and doorway were preserved. Bicycles, a full geographic relocation and in-Cesium city rendering are
not delivered by this navigation increment.

## 2×2 fine-cell coordination for the PRIM3 session

`js/fictional-city/fine-occupancy.mjs` is an isolated, unwired review adapter. The PRIM3 task owns the
shared schema; no tactical/shared file is changed here. Inputs are explicit metric coarse cell size,
origin, subdivisions=2 and body radius. Outputs are cell lookup/centre, sampled occupancy and swept
cardinal transitions using the same free-walk collision functions. A 3.54 m coarse tile gives 1.77 m
fine cells; an independently supplied 3.6576 m cell gives 1.8288 m cells. Those scales must not be
silently unified. Negative indices use floor; no source coordinates or saved values mutate.

Tests prove real authored interior furniture blocks both free walk and sampled occupancy, a door
approach remains reachable, and thin furniture between open cell centres still blocks transitions.
The existing HQ route regression separately proves the current tactical street→Floor 1→Stair B→B1→
Stair A route. This does **not** assert that HQ furniture or stairs have already been ported to a new
fine-grid resolver. Reconcile this input shape with PRIM3's final shared contract before activation.

Pale-overlay trace: the city has no tactical tile overlay. `scene.mjs:updateOcclusion` deliberately
fades obstructing buildings to .12; the ground target ring uses .7 opacity and contact shadow .22.
On the separate PRIM3 side, `level3d.mjs` defines the grid line opacities (.42/.7), translucent slab
material (.22), and fog plane (.62), while reach highlights are separate. These are candidate visual
sources, not a reproduced diagnosis of Matthew's pale overlay. No PRIM3 material was changed.

## Verification

- Focused city, spatial, publication, geography, B1, camera and fine-occupancy tests: **105/105 pass**.
- Deterministic real-Three scene tests: **11 scenarios pass**, including HQ walking route, eye-position
  first person, locked-behind steering, thin camera blockers, gestures and interior changes.
- Root suite before the final isolated adapter: **1,631 passed, 3 skipped, 0 failed**, plus **7 Python**.
- Real Chromium browser result: **89/89 passed**, with phone/tablet/desktop layout and owner/member/guest fixtures. Software WebGL is not phone FPS.
- Building context audit passed; no building geometry/program/source package was changed.

Commands:

```sh
node --test scripts/test/fictional-city*.test.mjs scripts/test/bridgeport-story.test.mjs
THREE180_DIR=/tmp/three180 node scripts/e2e/fictional-city-camera-inputs.mjs
CHROMIUM_PATH=/usr/bin/chromium THREE180_DIR=/tmp/three180 \
  node scripts/e2e/fictional-city.e2e.mjs /tmp/city-review-browser
```

The browser harness also needs Playwright via `PLAYWRIGHT_DIR` or
`CODEX_PRIMARY_RUNTIME_NODE_MODULES`; it fixtures all external/auth traffic and uses the publisher's
actual local data. Evidence is under `/tmp/city-review-browser`, not on the live site.

### Follow-up: hex topology and upstairs

The PRIM3 session owns the requested square/hex switch and its shared coordinate/topology schema.
The city adapter currently samples **square** fine cells only. Before wiring a topology switch, have
the shared contract supply `locate(metricPoint)`, `centre(cell)`, `neighbors(cell)` and the cell polygon,
with named frame/origin, dimensions in metres and explicit floor/elevation. The city side can run the
same body-clearance and swept-transition tests on those metric outputs. Do not reinterpret saved
square indices as axial hex coordinates, snap geography, or infer floor identity from tile numbering.
No hex support is claimed by this review and no shared PRIM3 file was edited.

The upstairs report is narrowed as follows:

- City shop interiors (`scene.mjs:buildInterior`, `spatial.mjs:interiorWorld`) are single-floor rooms.
  The saved position has X/Z/interior, not a floor/elevation/vertical link. Exterior floor/window bands
  do not provide upper-floor traversal. Upstairs free-walk in these shops is **not implemented**.
- The existing city HQ portal opens the separate tactical level. Two new read-only regressions use
  the real resolver to walk from the street to Floor 1, cross `stair-a-1-2` / `stair-b-1-2` to Floor 2,
  and return. Both pass with exact arrival coordinates. These are actual state transitions, not
  decorative-stair assertions. The existing B1/stairs regression also passes.
- This does not reproduce Matthew's particular UI failure or establish touch picking on the upstairs
  landing. The PRIM3 session should test those exact links through its rendered controls and new
  topology. City Trust, Jimmy's and the canonical HQ remain different placement/authority questions.

Final browser run of the integrated city: **89/89 checks passed**. A separate navigation-only run passed **40/40 checks**
(`CITY_NAV_ONLY=1` with the same browser command) and validates the final label spacing, steering control,
and Walk-there movement at 390/768/1440 px. Results are in `/tmp/city-navigation-final`.
The final root run before the two stair regression additions: **1,634 passed, 3 skipped, 0 failed**,
plus **7 Python tests**. The two stair regressions passed separately.
