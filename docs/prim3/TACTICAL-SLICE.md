# PRIM3 tactical slice: operate, play, review

This review branch extends the existing World builder and Transit game. It does not add another engine, administration framework or backend.

## Owner workflow

1. Open `prim3-world.html` with the house owner's account. The existing server ownership check unlocks the editor.
2. Choose **Edit**, select a mission and edit its ID, title or briefing. Keep the playable level as **Transit / Relay**.
3. Choose **Save & play test**. The editor validates the selected record and unique ID, saves the browser draft, then starts a new run. A storage failure or invalid record keeps the editor open. Starting a new run replaces that level's previous local save.
4. Select Entry, Recon and Technical, preview and confirm moves or shots, and end turns through the normal controls. Technical must link the relay twice; the squad must reach the extraction pad and extract.
5. Review the result: objective completion, squad health and extraction, turn, remaining clock and a retry suggestion. Return to World or replay the mission. Reloading reopens the same run and result.

The selected briefing is saved with the run. Editing the browser draft later does not rewrite that briefing. A different mission URL cannot relabel the saved run; the recovery notice offers **Resume saved mission**. Older unlabelled saves remain usable through their plain level URL.

## Controls and boundaries

The World editor already supplies draft editing, validation, import and export. This slice connects those controls to a saved play test. World difficulty is a briefing label; combat rules come from the selected level. Layout authoring remains in the existing Level Forge, not this editor.

The existing owner check uses `GET /v1/status`; private backend operations continue to enforce server permissions. These browser drafts and tactical saves do not call a publishing API. Delegated editor roles, cloud tactical saves and campaign progression are not implemented by this slice. No production SQL is required for its local workflow. The Level Forge's separate pending database setup is not a prerequisite for Transit.

## Reproducible acceptance

The committed browser suites intercept network requests and use synthetic owner responses; they never edit production data. Set `PLAYWRIGHT_DIR` to a directory containing Playwright, `THREE_DIR` to Three.js 0.180.0, and optionally `CHROMIUM_PATH` to a Chromium executable.

```sh
node scripts/e2e/prim3-world-controls.e2e.mjs
node scripts/e2e/prim3-transit-lifecycle.e2e.mjs
node scripts/e2e/prim3-transit-completion.e2e.mjs /tmp/prim3-completion-proof
```

The completion suite authors its mission through the editor and replays legal UI actions against full-strength Transit enemies. It fixes the browser clock to produce seed 89, rather than injecting a completed save or mutating tactical state. The reference route extracts all three operatives on turn 10. It also checks reload and aftermath at 390px and 1280px. Screenshots and structured results accompany the run.

The PRIM3 tactical workflow runs these checks alongside the existing browser regressions. Passing synthetic Chromium tests establishes a reviewable slice, not real-phone performance or a live release. Release still requires review and authorized merge/deployment of the integration and its upstream engine dependency; the Games navigation change remains in its separate draft.

## Display and floor controls

Courtyard's owner Board display settings choose perspective or a true orthographic top view, with an origin at map centre or the relay objective. Signed display X points east and Y north; Three.js ground X/Z maps to display X/Y, so north is negative Three.js Z. The labels use metres and leave saved engine columns/rows unchanged. These versioned preferences are browser-local.

Transit and HQ Settings offer Tactical cells or 2×2 guides. Transit cells measure 3.54 m, with 1.77 m guides; HQ cells measure 3.6576 m (12 ft), with 1.8288 m guides. Guides do not add movement cells or change AP costs. Preferences are separate for each level. In Move/Dash, reachable landing buttons expose legal stairs even when the upper floor is hidden by the camera cut. Preview the landing and confirm; the selected operative's floor then changes the cut.

```sh
node scripts/e2e/prim3-courtyard-display.e2e.mjs /tmp/prim3-display-proof
node scripts/e2e/prim3-spatial-controls.e2e.mjs /tmp/prim3-spatial-proof
node scripts/e2e/prim3-hq-stairs.e2e.mjs /tmp/prim3-stair-proof
node scripts/prim3/spatial-parity-audit.mjs
```

The parity audit is diagnostic: adding `--strict` intentionally fails while mismatches or unsupported cross-mode contracts remain. The [shared spatial proposal](SHARED-SPATIAL-CONTRACT.md) records the geometry authority, measured clearances, topology and save-migration requirements. Playable hex navigation and continuous shared HQ interiors are not yet implemented.

## Movement guidance

Selecting Entry, Recon or Tech shows currently available actions and affordable movement. Blue cells cost one AP; orange cells cost two. Unlit cells stay neutral. Hover with a mouse or tap once to inspect the route, next waypoint, destination and cost. A deliberate mouse double-click on an orange cell confirms one dash; touch users choose **Confirm dash**. A first click never spends AP. Blue moves use **Confirm move**.

The path comes from the canonical rules applied to player-known geometry. Unknown contacts can still interrupt execution; the preview never reveals hidden enemies or door changes. Exposure uses the same player-known state. Transit distinguishes weighted movement steps from the measured waypoint polyline: a stair's rule cost is not its physical length. Courtyard cells are one metre. The guide cache is invalidated when the state or selected operative changes.

```sh
node scripts/e2e/prim3-courtyard-movement.e2e.mjs /tmp/prim3-courtyard-movement
node scripts/e2e/prim3-transit-guidance.e2e.mjs /tmp/prim3-transit-guidance
```

These controls currently use the square resolver. They consume its routes and floor links; they do not claim a playable hex topology or add generated mission/LMS content contracts.
