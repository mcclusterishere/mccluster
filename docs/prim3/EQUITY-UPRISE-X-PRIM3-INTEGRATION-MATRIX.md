# Equity Uprise × PRIM3 — integration matrix and the first vertical slice

Status: review branch `claude/equity-uprise-hq-floors-20261103` (2026-11-03). Not merged, not public canon.
Play: `prim3-transit.html?level=equity-uprise-b1&side=defend` (Restore the Picture) or `&side=attack`
(Blind the Floor). The tactics menu lists it as **Equity Uprise B1 · Restore the Picture**.

## The three layers

| Layer | What | Where | Rule |
| --- | --- | --- | --- |
| (a) Building authority | B1 program, Core V2 cores and levels, floor programs, site/egress, roof inventory, tunnel network, device components, asset registry, electronics connections and manifest, the B1 production model, the electronics SANDBOX engine | `docs/design/equity-uprise-building/` | **Read only.** Never edited for the game. A test hashes every source file before and after a full mission and asserts they are byte-identical. |
| (b) PRIM3 game adapter | The frozen building package; the feet ↔ grid frame; cells, traversal, cover, sight surfaces; camera, device, door and equipment placement; camera coverage and lane selection | `scripts/prim3/build-equity-uprise-package.mjs` → `js/prim3-tactics/adapters/equity-uprise/{equity-uprise-package.json, adapter.mjs, pipeline.mjs}` | Deterministic, pure. The package records the sha256 of all 12 sources; a test rebuilds it and fails on any drift. |
| (c) Sandbox simulation | The mission's fault **ledger** → the building's simulated state | `js/prim3-tactics/adapters/equity-uprise/sandbox.mjs` | SANDBOX only, `live_control_allowed: false`. The consequences of every fault a mission may author were computed by the real `ElectronicsSandbox` and are packaged; a test replays ledgers through the real engine (reset, inject each) and asserts identical asset and connection states. |

A mission is data plus a few rules: `js/prim3-tactics/missions/blind-the-floor.mjs`. The page level
(`levels/equity-uprise-b1.mjs`) only hands the page what it draws and the mission hooks.

## The frame (feet → grid → feet)

- Authority: feet, Core V2 local frame. Origin = the building's south-west corner, +x east, +y north,
  Floor 1 finished floor = 0 ft.
- Grid: **one cell = 12 ft** (3.66 m, 3.3% over the 3.54 m engine tile). The 72 ft plate is exactly 6 × 6 cells
  at true scale; the 18 ft bays fall every 1.5 cells; the site (−36…108 × −48…108 ft) is the 12 × 13 board.
  Grid +x = east, grid +y = **south**. Cell (gx, gy) covers x ∈ [12(gx−3), +12) and y ∈ [12(8−gy), +12) ft.
- Anchors: `cellToFt(gx, gy)` = the cell centre; `ftToCell(cellToFt(c)) === c` for every cell (tested), and every
  cell owns its south-west corner.
- Floors: engine z 0 = site at grade, 1–6 = Floors 1–6, 7 = L7 roof, 8 = B1. Heights are the real elevations.
- Placement: a device takes the cell of the zone (room) whose bounds contain it, the covered cell nearest to it;
  otherwise the cell containing it. Cameras, the patch panel, readers, the console, equipment and every doorway
  are placed through these functions (`deviceCell`, `deviceAnchor`, `equipmentAnchor`, `doorAnchor`).

## Prior review prerequisites

| Prerequisite | Status | Evidence |
| --- | --- | --- |
| Authoritative B1 spatial bounds | **Satisfied** | `basement-b1-program.json` zones (10 zones in feet) + Core V2 cores; B1 doorways and equipment bounds from the B1 production model's own room shells (`equity-uprise-basement-b1-core-v2.glb`, lintels and nodes). Test: "placements go through the frame". |
| Explicit operator / role assignment | **Satisfied in the adapter** | The program gives B1 `live_access` roles (staff, instructor, security, facilities, field_t, supervised learner) and `training_access: canonical_sandbox_same_geometry`; the mission binds them: R/E/T squads (E1/R1/T1) with role-gated nodes (`RACK` T only; `CONSOLE` T to verify, T or E to pull). |
| Mission-driven sandbox fault / restoration state | **Was missing; built** | The sandbox has `injectFault` and whole-floor `reset()` but no per-fault restore. The binding keeps a fault ledger; restoring = reset and replay the remaining ledger, proven identical to the real engine. |
| Deterministic feet-to-grid transform | **Was implicit; built and tested** | `adapter.mjs` frame; round-trip and corner tests; the HQ level's hand rule is the same function (tested on every core). |
| Camera selection by traversable-lane coverage | **Built; the authority placement is a placeholder** | The four B1 cameras are generator-anchored at (48, 24) ft (the electronics builder's `anchored_pos(…,"security",…,(48,24))`), all within 2.4 ft and ±6° of each other, and their registry records say `placement_authority: "unknown"`. The adapter computes each camera's coverage from its real position, aim, 92° FOV and 32 ft range, and `selectCamerasForLane` reports which cameras see B1's walkable lane and the smallest covering set: **all four see the same lane; one covers it (fully redundant)**. That redundancy is the mission's core: to blind the lane you must cut all four. Nothing was moved. |

## Capability matrix

IMPLEMENTED = works and is tested here; PARTIAL = works with a stated limit; PLACEHOLDER = stand-in;
BROKEN = wrong today; NOT STARTED.

| Capability | Status | Files | Tests / evidence |
| --- | --- | --- | --- |
| **Navigation** — cells for every level (B1, F1–F6, L7), 72 × 72 ft at true scale | IMPLEMENTED | `adapter.mjs` `levelGrid` | "generic: every level … loads" (36 cells each, cores where Core V2 puts them) |
| Stairs between consecutive levels (switchback, cost 3 a storey) | IMPLEMENTED | `adapter.mjs` `traversal` | B1→F1→…→L7, 7 links per stair; street → B1 and street → roof reachable |
| Exterior doors (site ↔ Floor 1) from site-egress openings | IMPLEMENTED | `traversal` | public entrance lands where the HQ level puts it |
| Elevators only where a mission permits | IMPLEMENTED | `traversal({ elevators })` | off by default; on, the passenger cab links its served levels |
| Interior doors as gates between rooms | PARTIAL | `adapter.mjs` | Doorways are placed through the frame, but the engine has whole-tile walls only: rooms are open to their open neighbours (the telecom core's south door opens into a 2 ft gap below cell size). Needs edge walls upstream. |
| B1 as a normal floor in the HQ drill | IMPLEMENTED | `levels/equity-uprise-hq.mjs` | "B1 is a normal floor" (both stairs down, plant rooms shut) |
| **Combat** — AP, move/dash, fire, hit chance, cover, elevation, overwatch, hunker, reload, stabilize | IMPLEMENTED (engine) | vendored resolver | Prim3 tests (98); missions play on it |
| Cover from authority geometry (rooms, shafts, B1 perimeter, equipment) | IMPLEMENTED | `buildCover` | equipment: LOW, HIGH over 5.5 ft |
| Line of sight across floors | IMPLEMENTED (fixed upstream) | Prim3 `claude/los-floor-adjacent-20261103` @ `5896e2f`, vendored | Adjacent cells on stacked floors used to see and shoot through the slab (found here: Floor 1 shot B1). Fixed in Prim3 with a test; re-vendored. |
| A slab over a unit's own cell (e.g. the entry canopy) | NOT STARTED | — | The engine checks slabs on intermediate cells only, so a canopy cannot shelter the unit under it. Upstream item. |
| A downed operative and extraction | PARTIAL | resolver | The engine counts a downed operative as a survivor who must extract but cannot move: such a mission can never complete. The missions score it as lost (`lose-downed`). Upstream: carry or evacuate. |
| **Assault / defense** — both sides, opponent on the canonical threat AI | IMPLEMENTED | `missions/blind-the-floor.mjs`, `scripts/prim3/blind-the-floor-sim.mjs` | win rates below; replay fixtures |
| **Interactive infrastructure** — cameras as engine CAMERA machines (detection = authority range on the grid, engine LOS) | IMPLEMENTED | `camerasOn`, `pipeline.mjs` | coverage on the grid equals the engine machine's sight over B1's walkable cells |
| Camera FOV (92° wedge) in the engine | PARTIAL | — | The engine camera is radius + LOS, no facing. On B1 the wedge and the engine's sight coincide on walkable cells (tested); elsewhere they may not. |
| T technology control (Jam, Sync Pulse, Take control, Door, Mark, Re-take) | IMPLEMENTED (engine) / PARTIAL (page) | resolver; `transit.mjs` | The page offers Jam, Sync Pulse and Mark when the engine's preview is legal; Take control and Door are not offered on B1 (no hostile doors in this slice). |
| Sandbox faults → camera availability → fog / AI | IMPLEMENTED | `sandbox.mjs`, `bindCameras`, mission `sync` | "consequences": the squad's fog (defend) and the threat AI's knowledge and moves (attack) change |
| Restore + separate VERIFY | IMPLEMENTED | mission `CONSOLE` node | The console has nothing to verify while the sandbox shows no live camera (the engine itself refuses VERIFY in the `DARK` state) |
| Access control, PoE/switch, power consequences | PARTIAL | package (`access_switch_failed` impacts packaged) | Packaged and replay-tested; no mission uses them yet. Note: the switch fault also takes down the core console itself. |
| **Occupancy / NPCs** — staff at workplaces | NOT STARTED | — | The workplace canon names people per floor; no non-combatant NPCs in the engine. |
| **Objectives** — nodes, technical truth, required/optional | IMPLEMENTED | mission | |
| Mission clock and escalation | IMPLEMENTED (engine) | resolver | `lose-clock` |
| **Rooftop travel / extraction** | PARTIAL | HQ level; adapter | Stairs reach L7 and the roof is a walkable floor with parapet cover; no roof extraction (mobility zone is conceptual in the authority). |
| Underground connection (tunnel) | PARTIAL | package `tunnel`, mission | The transfer lock and its outer portal door are real; beyond the portal the network's first node is `future-campus-masterplan` geometry, so the board ends at the portal (attackers enter and leave there). |
| **Modes** — WORKPLACE / PRIM3 MISSION / TRAINING | IMPLEMENTED (separation) | `sandbox.mjs`, mission state | The ledger lives only in the mission state (`battlefield.eu`, saved under the PRIM3 key per side); this slice runs as TRAINING; the authority, the package and the sandbox baseline are unchanged after a mission (tested); a restart is a clean mission. No workplace-mode UI in the game. |
| Generic pipeline for other floors | IMPLEMENTED (data) / NOT STARTED (missions) | `pipeline.buildBattlefield(spec)` | F1–F6 and L7 load and connect; no mission authored on them yet. |

## The vertical slice: Blind the Floor / Restore the Picture

Board: the site, Floor 1 and B1 (true scale), Stairs A and B between them, the public entrance, the tunnel
transfer lock. B1's plant rooms (mechanical, electrical, fire/water, flood) stay shut; the telecom core, the
workshop and the transfer lock are opened for the exercise. Interactive objects, all from the registry:
B1-SEC-CAM-01…04 (telecom core), B1-NET-PATCH-PANEL-01 (the IDF rack by the concourse, ports 10–13 are the
camera links), B1-TELECOM-CONSOLE-01, B1-LOCK-OUTER-DOOR-01.

**Restore the Picture (side `defend`)** — the squad comes down from Floor 1. The red team has applied
`camera_link_down` to all four cameras; the squad's fog has no camera picture. T restores a link next to the rack
(the sandbox removes the fault; the camera machine is live again and its sight joins the squad's fog), then
VERIFIES the picture next to the console. While the picture is unverified, a red-team member at the rack cuts a
link again. Win: verified before the clock ends. Lose: clock, T lost, everyone down.

**Blind the Floor (side `attack`)** — the squad is the red team, concealed in the transfer lock. The cameras are
the defenders' (their sight breaks concealment and feeds the threat AI). T may Jam or Sync-Pulse them, then cuts
all four links at the rack (four AP), pulls the core log next to the console and the squad leaves by the lock.
Defenders at the rack restore links; a defender next to the console with a live picture verifies it, and the
exercise is lost. Floor 1 security (H4) answers by Stair A.

Evidence (`node scripts/prim3/blind-the-floor-sim.mjs 100`, heuristic squad vs the canonical threat AI):

| Side the squad plays | Squad wins | Threat AI wins | Losses by type |
| --- | --- | --- | --- |
| defend (Restore the Picture) | 30 / 100 | 70 / 100 | everyone down 38, clock 32 |
| attack (Blind the Floor) | 48 / 100 | 52 / 100 | clock 41, downed operative 11 |

Replays: `scripts/test/fixtures/blind-the-floor-replays.json` holds four whole games (each side winning in each
role) and the test replays them move for move. The acceptance test: a red-team member cuts B1-SEC-CAM-01's link,
the camera goes offline and the squad loses its sight of the lane, T walks down Stair B to the cell between the
rack and the console, restores and verifies, the exercise is won; then the authority files are byte-identical,
the package is unchanged and the real sandbox is at its baseline.

## Upstream items

1. Edge walls in the resolver (doors as gates; a room seen only through its door).
2. A slab over a unit's own cell (canopies, overhangs).
3. Evacuating a downed operative.
4. Camera facing (FOV) in the engine.
5. The authority's camera placement (`placement_authority: unknown`; all floors use one anchor).
