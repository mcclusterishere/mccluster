# Shared Fate — local playable mission handoff

> Publication update (2026-11-11): draft PR publication is now authorized. Source [PR #24](https://github.com/mcclusterishere/Prim3/pull/24) is published at `2fe190a742f15beb5eb5b3b195c10f2aa64f0eab`; SOURCE.json and replay pins use that commit. The application is rebased on `8e631683b6960fee283ea923c22b1d72cfd09495`, preserving current model/timing fixes. Local-only restrictions, pins and blocked publication statements below record earlier checkpoints and are superseded for draft publication only. Merge, deployment and browser/device acceptance remain outstanding.

**PROPOSED supplemental fictional client continuity exercise. Draft review.** It does not replace any of the 21 episodes, change seven-semester chronology or rewrite the existing Equity Uprise HQ/B1 mission. Draft publication is authorized; no merge, deployment, credentials, live equipment, paid compute or mastery write is authorized.

## Placement and cast

The building audit passed all 366 indexed sources. Current B1 authority identifies a normal staffed technical-operations floor with room-level safety controls and simulation-only systems. HQ and B1 already have distinct square-grid missions; B1's Blind the Floor / Restore the Picture remains intact. Workplace/location canon permits external missions framed by headquarters.

Shared Fate is therefore a **separate fictional client-site hex level**, not a renamed B1 or Transit map. Its 191-cell graph, solids, low/high cover, spawn/relay/extraction points, scene and identity are independently authored using existing graph/render/resolver contracts. No building geometry or inventory changed.

Character introductions preserve actual sections:

| Character | Established home | Fit |
| --- | --- | --- |
| Sari Wulandari | F2 telecom/cohort desk, F2-DESK-SARI-WULANDARI | Cross-trained Field-E; service lead, physical access, approved priority choice |
| Minh Tran | B1 hardware/firmware bench, B1-WORKSHOP-BENCH-01 | Field-T; device configuration, failure test and verification |
| Rafael Costa | F3 Field-R workstation, F3-DESK-RAFAEL-COSTA | Dependency evidence and tactical picture |
| Helen Clarke | F6 director office, F6-OFFICE-HELEN-CLARKE-DESK | Command-side resource/governance authority; not a deployed technician |

The briefing introduces each at their own section; B1 is Minh's preparation, not universal staging. F3 may assemble the team. These are **narrative introductions and linked return navigation**, not newly implemented workstation traversal. The current HQ tactical loader closes F2–F6 except stairs. Generic tactical operator models are stand-ins, not claims of approved character likeness.

Authority: source `game/SHARED-FATE-PROPOSED-MISSION.md`, character dossiers, workplace roster/canon and episode location map; app `WORKPLACE-OCCUPANCY-AUTHORITY.md` and inventory-backed v3 floor layouts. The source mission document records exact station coordinates and rationale.

## Launch and entry/return

From this checkout:

```bash
PRIM3_REVIEW_PORT=8874 node scripts/prim3/local-network-review.mjs
```

Open `http://127.0.0.1:8874/prim3-shared-fate.html?view=2d` and choose **Start disposable local review**. The temporary local review server substitutes an explicit disposable bootstrap, not an account identity. It serves a narrow read-only allowlist, blocks outbound connections via CSP, and does not contact production. A same-execution-context server/HTTP check passed; another tool process could not connect across this environment's network boundary, so do not assume this loopback URL is remotely reachable. Run the command on the machine where you review it.

Normal app entry links are in owner-gated `prim3-transit.html` and the hex page. `prim3-shared-fate.html` retains the normal owner gate and shared shell/navigation. Valid building return tokens use existing `js/eu-screens/contract.mjs` and retain floor/pose/mode; unsafe external paths are refused. With no token, return goes to the existing HQ entry. The local harness explicitly returns to its own review menu because HQ geometry is not served by that narrow harness.

## Actual mission loop

Sari/Rafael/Minh deploy to the client yard under simulated pressure. Rafael inspects near X. Sari holds service access near X each working turn. Minh reaches R, edits `client-edge` prefix/gateway/reserved Mbps/uplink, tests the upstream failure, then independently verifies the fresh result. All actions spend AP; positions, combat, cover, failure and recovery use the same Friday tactical/network engine. A/B share an actual `shared-upstream` graph dependency; `fallback` uses `independent-backhaul`. Losing the former defeats both labels. Losing the latter defeats fallback.

Essential traffic is three 2-Mbps streams; broadcast is eleven, four or zero 2-Mbps streams. Fallback ceiling is 24 Mbps. At full reservation, headline/reduced/cancelled produce essential delivery 2/6/6 Mbps, modeled missed appointments 8/0/0, reach 100/65/0 and next-operation capacity 1/2/4. Sponsor-confidence values also differ. These are authored fictional metrics, not empirical effects or campaign writes.

The explicit completion threshold is **at least 1 of 6 essential Mbps on independently verified fallback**. A degraded completion may still lose appointments; it does not claim all essential services recovered. Under-reservation changes these measured outcomes. Over-reservation beyond 24 fails validation. Configured ≠ failure-tested ≠ independently verified. Policy/config changes invalidate stale test/probe revisions. Once anyone extracts, configuration-changing actions lock, preventing a stranded squad after Minh leaves.

Shared Fate has its own schema/level/save key; authentic network-workbench saves are rejected in both directions. Every action replays deterministically on reload. Consistency is not authentic learner identity: local evidence is unsigned, with no competency or credentials. Restart affects this exercise only; corrupt saves are retained until explicit restart. Configuration reset preserves the event ledger.

## Source, integration and rollback

Local branch in both repositories: `codex/prim3-shared-fate-20261111`.

- Source base: Friday `d456c4a2efc037f23dc4211a95d37a4d18624495`; final source `6bd4ecf10354d889070499ab718b8132db85c3e5`.
- App base: Friday `8589562faa26b4342472670a58a5c050c84bd642`, itself built on main `3ad888d798278045cc7437a2459f3f6a3461a327`.
- Refreshed main audit reached `8e631683b6960fee283ea923c22b1d72cfd09495`; no differences from that base affected inspected tactical/screen/Transit paths. Unrelated coordinated changes were not imported. November 9 and Friday branches/checkpoints remain intact.

Review source first, then app. SOURCE.json pins exact published source bytes and both existing replay fixtures use that source commit without changing their traces. The new lab composes the existing network arithmetic/protocol functions; `network-simulation.mjs` remains the shared action engine and the Shared Fate adapter is thin. The new level is loaded by the hex UI, not falsely registered as a square Transit level. No dependency on a new remote service exists.

Before any separately approved merge, refresh main again and preserve current renderer timing/model repairs, scope/evidence contracts and building navigation. Re-run affected tests and complete actual browser acceptance before release. Revert the new app commit to remove this mission while retaining the Friday checkpoint; retain local saves for recovery. Source proposal rollback is separate. No infrastructure rollback is necessary.

## Evidence and limitations

Executed code: subnet arithmetic, bounded config validation, valid IPv4/TCP bytes and checksum/port decoding inherited from Friday; dependency graph and priority scheduler execute deterministically. Connections, routing devices, service response, combat pressure and consequences remain **stateful simulation**. There is no hosted lab, emitted network traffic, real target, TLS session, arbitrary shell, credentials or signed assessment.

Engine acceptance covers every cell's render/pick round-trip, unique spawns, all three policies through combat/config/test/verify/extraction, reload after every action, genuine cross-mission save rejection, scope/role gates and legal Minh-first evacuation followed by remaining successful extraction. Existing network/hex and renderer regressions remain required.

Browser acceptance artifact: `scripts/e2e/prim3-shared-fate.e2e.mjs`, using `scripts/test/fixtures/shared-fate-journey.json` generated from the actual successful engine journey. It has not completed here. Chromium fails before page load with `process_singleton_posix.cc:297 socket() failed: Operation not permitted (1)` and ptrace EPERM. No screenshots, real UI mission, touch gestures, iPad performance or visual acceptance are claimed.

## Recorded checks

New runs for this checkpoint:

- Source `node --test game/runtime/*.test.mjs`: 127 passed, zero failed. Log `/tmp/shared-fate-source-tests.log`.
- App `node --test --test-concurrency=4 scripts/test/*.test.mjs`: 2,505 passed, zero failed, five existing skipped (2,510 total). Log `/tmp/shared-fate-app-final.log`.
- Final focused mission/network/hex/vendor/animation/model group: 35 passed. Log `/tmp/shared-fate-acceptance-final.log`.
- Python discovery: seven passed. Log `/tmp/shared-fate-python.log`.
- Building context audit: PASS, 366 indexed sources; no building geometry or program files changed.
- Local harness: server launch and same-context HTTP GET passed; response `/tmp/shared-fate-review-response.html`. Cross-tool loopback access was unavailable.
- Browser attempt: BLOCKED before page load; `/tmp/shared-fate-browser.log`. No actual UI/device journey verified.

Worker code was unchanged by this mission and was not rerun merely to repeat Friday's 1,898-pass/9-skip result. That is prior evidence, not a new Shared Fate run. Hosted labs, signed assessment, deployment and production checks were not run or claimed.

All three browser acceptance scripts currently resolve Playwright from `/opt/codex/cua_node/lib/node_modules`; adapt that require path to a local Playwright installation. This environment-specific runner dependency is not shipped game code.

## Publication-head checks (2026-11-11)

After rebasing onto main `8e631683b6960fee283ea923c22b1d72cfd09495` and pinning published source PR #24:

- Application aggregate: 2,524 passed, zero failed, five skipped; `/tmp/shared-fate-publication-app.log`.
- Worker aggregate: 1,898 passed, zero failed, nine skipped; `/tmp/shared-fate-publication-worker.log`.
- Python discovery: seven passed; `/tmp/shared-fate-publication-python.log`.
- Source runtime: 127 passed; registry validation and corruption self-tests passed. Published source tree exactly matches the tested local tree.
- Source exact-head Repository contract and Adaptive range contracts CI passed.
- Browser/device acceptance remains blocked as described above; no new UI claim.

These temporary log paths identify execution evidence, not repository artifacts. Reproduce with the commands above. The draft pair includes all previously unpublished hex, semester and network foundations. Integrate source PR #24 before this application; retain its exact SOURCE.json pin and hashes. API publication may consolidate preserved local checkpoints into a review commit with the same tree. Reverting that full application review commit removes all bundled foundations as well as Shared Fate; removing only the mission requires a targeted follow-up. Original checkpoints remain preserved locally.


## Walkable client interiors v2 (current)

The office and equipment bay are now walkable single-floor buildings on 217 connected hex cells. Actual wall segments, door gaps and blocked desks/rack replace the former solid volumes. The office has telemetry O and service access A rooms, connected internally and through north/south doors. The equipment bay has an aisle and backhaul R room, with north/west entry. Every graph cell reaches outdoor extraction X. These are new fictional client interiors; HQ/B1 geometry and character home sections are unchanged.

Rafael must enter telemetry to observe. Sari must enter service to choose priorities and hold access each working turn. Minh must enter backhaul to configure, failure-test and independently verify. Room, range and line-of-sight checks prevent using consoles through walls. The clock starts at 38 turns; all three policy journeys complete with combat and per-command reload. Walls remain full-height collision/cover/LOS obstacles while the clearly labeled roofless tactical cutaway draws them at 0.9 m for visibility. Floor slabs, wall segments and furniture use the same authored dimensions. Generic kit loading cannot hide these custom meshes. Both 2D and 3D label O/A/R/X from canonical cells.

Layout/schema/storage v2 is deliberate: old v1 saves remain under their original key and the UI explains that a new interior run starts separately. No old commands migrate silently. Schema/source mismatches reject before replay. Mission identity and source lab protocol remain unchanged. Source proposal is pinned at `451f631400efa8d94360da452cfad26d231fa346`; vendor runtime hashes are unchanged.

Validation: application aggregate 2,529 passed, five skipped, zero failed (`/tmp/shared-interiors-app-all.log`); source runtime 127 passed (`/tmp/shared-interiors-source.log`). Interior tests cover 217 render/pick mappings, all nodes/edges and room traversal/egress, wall-separated sight and denied indoor actions, all resource policies and recovery/extraction, repeated stale moves and old-layout rejection, prop construction and kit guard. Local browser launch was attempted and blocked before page load (`/tmp/shared-interiors-browser.log`). The existing read-only PRIM3 CI now also runs portable Shared Fate fixture-only browser acceptance using its existing pinned Playwright/Three dependencies; inspect the exact-head job and `prim3-shared-fate-browser-evidence` artifact for the actual result. Physical iPad certification remains separate.

Rollback the interiors follow-up to restore the published v1 yard; both save keys remain recoverable. Source proposal rollback is separate. No hosted system or production geometry was changed.
