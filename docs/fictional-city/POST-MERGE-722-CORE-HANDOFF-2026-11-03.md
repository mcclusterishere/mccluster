# McCluster City / Bridgeport / OVH Core — post-merge #722 engineering handoff

**Date:** 2026-11-03  
**Status:** Research and review specification only. Not an implementation, runtime audit, approval to deploy, or performance claim.  
**Scope:** McCluster City expansion and its boundary with surveyed Bridgeport, Equity Uprise HQ, PRIM3, and OVH Core.  
**Base evidence:** [Merged PR #722](https://github.com/mcclusterishere/mccluster/pull/722) (merge commit `f1150c2c72ef03348aacc960f1f18a45d643a2a3`). PR #722 reports 1,580 root JS tests, 430 Core tests and 81 browser checks; these were recorded by the PR author, **not rerun by this review**.

## 1. Authoritative system boundaries — preserve without redesign

1. **Authored fictional geography:** `core/data/fictional-city/places.v1.json`; lore, characters, interactions and names in `core/data/fictional-city/district.v1.json`; bind by stable place/parcel IDs. Do not add real-world coordinates or physical names to invented parcels as if they were surveyed.
2. **Surveyed Bridgeport:** `district.v1.json → neighborhoods`, `js/fictional-city/bridgeport-geometry.mjs`, CT 2023 footprints and OSM streets. The surveyed area X −165…165, Z −345…−58 remains reserved from the authored expanded city. Distinguish measured footprints from authored doors, heights, signage, tenants, interiors and narrative.
3. **Original playable district:** freeze original 8 shops, 3 garage characters, 27 original cast, coordinates, footbridge, HQ island, garage, save key, and narrative chapter structure; retain existing v1 → v2 state migration including `arcs`, `discoveries` and `payments`.
4. **HQ:** canonical Equity Uprise B1–L7 building authority is read-only to the city renderer. HQ exterior in the city is only a lightweight proxy; the doorway goes through the existing `prim3-transit.html?level=equity-uprise-hq`. Ordinary users can enter B1 through normal Stair B/Stair A traversal without an admin gate.
5. **Modes:** `WORKPLACE`, `PRIM3 MISSION`, and `TRAINING` remain isolated. B1 mission camera faults appear only on MISSION screens and clear on restoration; never leak to live devices or workplace state.
6. **Coordinate frames:** city metres (+Y up, +Z south), HQ GLBs metres Z-up, HQ tactical/adapter cells 3.6576 m, PRIM3 tactics 3.54 m tiles. Follow `EXPANSION.md` transform and existing tests; do not casually rescale or flip axes. #711's Jersey City example remains a converter fixture, not Bridgeport.
7. **Trust/authority:** Existing Cloudflare Worker edge, Supabase durable state and approved OVH Core execution plane. No second auth or state database, no raw production credentials in the viewer, no destructive data reset.

## 2. Actual review findings (code-read, not newly benchmarked)

**A. Bridgeport is not included in #722's render-chunk path.** The chunk source in `js/fictional-city/chunks.mjs` and `places.v1.json` describes fictional parcels/streets. The surveyed `neighborhoods` are still constructed into the base scene through `buildNeighborhoodGround` / `buildNeighborhoodPlace` in `js/fictional-city/scene.mjs`. This is a concrete likely reason why #722's fictional-city streaming does not materially reduce the Bridgeport opening cost. First measure before changing.

**B. Building geometry has expensive near-detail candidates.** `js/fictional-city/bridgeport-geometry.mjs` uses `THREE.ExtrudeGeometry` for exact polygon footprint volumes and `polygonWindows` to place multiple box layers per window across long exterior edges, then signs/details. The scene's existing `createGeometryKit` does batch repeated primitives with `InstancedMesh`, so don't introduce a competing rendering subsystem. Profile geometry, draw calls, memory, shaders, CPU and GPU separately before selecting optimizations.

**C. The current test gate is geometric, not hardware-performance validation.** `scripts/e2e/fictional-city.e2e.mjs` checks `triangles < 150000` and `drawCalls < 300` under Chromium/SwiftShader, and records renderer stats. The PR explicitly states that SwiftShader achieves roughly 2–3 fps on the full city and does *not* measure physical mobile performance. The reported approximate 100k Bridgeport / 114k total opening-view triangles needs a fresh, reproducible baseline capture.

**D. Publication contract is strong but must be proven on the actual release.** #722 adds hashed 64 m chunks with load radius 72 m, unload radius 112 m, backoff and fallback; collision stays resident. `.github/workflows/deploy-pages.yml` stages and verifies the places manifest/chunks by HTTP response and SHA. Local green does not establish that a live Pages release and the Core runtime are serving the same revision.

**E. The gameplay integration is partially complete.** Existing doorway, B1 traversal, PRIM3 tactical adapter, camera state mirroring, business entry and NPC routes are demonstrated by tests. Free-roam HQ interior continuity, enterable houses, per-business interiors, regional streaming and on-device performance are *not* demonstrated.

## 3. Research-backed optimization sequence

### P0 — Profile, preserve visual semantics
- Establish *same-spot/same-camera* before/after numbers on desktop and **real Android/mobile hardware**, plus software-renderer fixture separately. Capture p50/p95 frame duration, FPS, long tasks, scene triangles, draw calls, JS heap, GPU textures/geometry, network bytes, cold-to-interactive time, chunk failures, and 10-minute roaming memory trend.
- Break down scene draw/triangle cost by original district, Bridgeport footprint bodies, window/detail meshes, actors, new fictional chunks, signage, and the HQ proxy. Instrument a development-only breakdown; do not add expensive telemetry to every shipping frame.
- Treat `30 fps on a defined mid-range phone and 60 fps desktop` as **proposed release targets**, subject to device test evidence, not achieved metrics. Prevent significant regression in interactive controls and 390 px touch layout.

### P1 — Move Bridgeport into compatible visual LOD/streaming
- Reuse the existing city chunk/tile-source contract rather than importing a new engine.
- Keep original georeferenced footprint geometry and collision provenance fixed; **only render detail** varies by distance/device profile.
- Proposed tiers: far = low-poly silhouette/massing, medium = authentic roofline/footprint body with minimal facade detail, near = selective windows, signs and detail for the current viewport. Use hysteresis to avoid popping; maintain stable raycast and interaction IDs.
- Ensure no real Bridgeport footprint is replaced by a generic rectangle at close range. Preserve all selected 16 polygons and their source data. Use preprocessing/LOD generated from evidence, not random geometry reduction that breaks holes or door boundaries.
- Avoid allocating all window instances at startup for distant/unseen surfaces. Consider shared window geometry/instancing, per-chunk/region visibility culling, and selective facade instantiation. Measure impact before making texture-atlas or geometry-batching changes.
- Preserve stable pedestrian collision, saved position, routes and camera occlusion when visual mesh LOD switches. No holes in the walkable ground when chunks fail.

### P2 — Geospatial and real-institution verification
- The source dataset is Connecticut's **2023 LiDAR-derived 2D footprint layer**. Its footprints do not establish a real building's occupant, door, height, security layout, or current operational status.
- Validate the chosen real police site against the City of Bridgeport's official Police Department page (headquarters: 300 Congress Street). Validate any selected school **by exact school name and address** against Bridgeport Public Schools' official district directory; 45 Lyon Terrace is the district office, not proof that it is a selected school building.
- For a real landmark: provenance/attribution + surveyed footprint + independently verified institution identity, geocoordinate/footprint mapping, and explicit `verified` vs `authored` field-level provenance. Keep original fictional precinct/school/church as authored story places; do **not** silently move or rename them as real city sites.
- Story re-enactments involving real institutions must be explicitly fictionalized where invented, and must not imply that actual identifiable staff committed misconduct. Preserve students/minors protections and non-bribe restrictions.
- OSM-derived road data must retain ODbL attribution in the map/game and legal/provenance documentation.

### P3 — Gameplay quality and world continuity
- Run the five approach/egress routes, waterfront/footbridge, all 30 business doors, family/home restrictions, all 76 cast interactions, all original save versions, and the complete Bridgeport story sequence.
- Keep canonical HQ via doorway and create a documented *future adapter* for seamless city → HQ free roam, not a replacement building. Maintain ordinary B1 access and mission-only camera fault consequences.
- Arcade, Designer Kicks, seven-floor Suite, federal training and music are separate tracks; integrate only through existing route/capability boundaries and tests.

## 4. OVH McCluster Core assignment — read-only first

**Host is a coordinator, not a real-time 3D GPU renderer.** Prior repo docs describe a CPU-only OVH node (8 vCPU/24 GB), persistent Core runner, Ollama models, capability registry and durable job queue. Confirm actual host status; don't infer it from source.

First collect: service/timer states, local and public `/health` (HTTP/body/actual `deployment_sha`), `git` reconciliation exit codes and authentication mode, CPU/RAM/disk headroom, Ollama downloaded vs loaded models, Core queue backlog and failed job receipts. Redact tokens/credentials; never inspect or print any private key. Mark externally inaccessible facts `unverified`, not `down`.

Then use existing capabilities for **bounded** city validation: read-only repo/city manifest checks, geospatial source checks, incremental build/publish verification, screenshot QA coordination, issue triage, and low-priority AI-assisted dialogue/metadata checks. Proposal: queue accepted finite jobs through current Core APIs; no new queue type or schema just to claim autonomy. Any `code_patch` action stays in disposable worktrees with limited paths, tests and a **draft PR**; no autonomous merge, deployment or production data writes.

Tie results to task ID, source SHA, evidence/checksums, model/provider, elapsed time, input/output paths, approval state, and verifiable browser/host observation. Keep 24 regional news agents from consuming the interactive owner/CI budget.

Before any new code ships, confirm that the Core OVH runtime SHA actually matches the intended promoted revision. GitHub workflow success alone is not runtime proof. Keep OVH incident #510 separate from release train #509; do not close #510 until two successful authenticated Git-over-SSH reconciliation cycles under private-repository access are proven.

## 5. Required regression and acceptance evidence

- `scripts/test/fictional-city-places.test.mjs`: stable city geometry, reserved Bridgeport ground, coordinates, parcels/routes/bridge.
- `scripts/test/bridgeport-story.test.mjs`: authored story, 16 footprints, route/beat progression, minors and provenance.
- `scripts/test/fictional-city-hq-b1.test.mjs`: street → Stair B → B1 → Stair A → F1, no special gate.
- `scripts/test/equity-uprise-mission-screens.test.mjs`: mission camera failures/restoration visible in MISSION, never WORKPLACE.
- `scripts/test/fictional-city-publication.test.mjs`: hashes, file lists, chunks, fallback.
- `scripts/e2e/fictional-city.e2e.mjs`: guest/member/owner access, save compatibility, all original shops/cast, phone widths 390/768/1440, no-WebGL fallback, chunk failure/retry/cleanup, ten-minute roam; verify these are *actually implemented* checks, not presumed coverage.
- Existing Equity Uprise building context, PRIM3, B1 and Core tests still pass.
- Produce *real-device* screenshots/frame profiles, not just SwiftShader results.
- Do not merge anything without owner's explicit signoff. For code changes, output review-only draft PRs and compare before/after evidence.

## Primary research

- Three.js LOD distance/hysteresis: https://threejs.org/docs/pages/LOD.html
- Three.js InstancedMesh: https://threejs.org/docs/pages/InstancedMesh.html
- Three.js WebGL renderer diagnostics: https://threejs.org/docs/pages/WebGLRenderer.html
- Chrome Performance profiling: https://developer.chrome.com/docs/devtools/performance/overview
- State of CT 2023 building footprints: https://catalog.data.gov/dataset/2023-connecticut-buildings-beta
- CT aerial/LiDAR provenance: https://maps.cteco.uconn.edu/data/flight2023/
- Bridgeport Police Department: https://www.bridgeportct.gov/government/departments/police-department
- Bridgeport Public Schools district directory: https://www.bridgeportedu.net/information/district-directory
- OSMF attribution for games/simulations: https://osmfoundation.org/wiki/Attribution_Guidelines

**First Claude response expected:** report the *live* host evidence and exact main/branch SHAs; current performance bottleneck with measured profiles; any gaps in this research; an ordered implementation matrix and review-only PR plan. Do not claim the city is finished or the VPS has run a task unless execution receipts exist.
