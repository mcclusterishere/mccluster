# PRIM3 tactical slice: operate, play, review

This review branch extends the existing World builder and Transit game. It does not add another engine, administration framework or backend.

## Owner workflow

1. Open `prim3-world.html` with the house owner's account. The existing server ownership check unlocks the editor.
2. Choose **Edit**, select a mission and edit its ID, title or briefing. Keep the playable level as **Transit / Relay**.
3. Choose **Save & play test**. The editor validates the selected record and unique ID, saves the browser draft, then starts a new run. A storage failure or invalid record keeps the editor open. Starting a new run replaces that level's previous local save.
4. Select Entry, Recon and Technical, preview and confirm moves or shots, and end turns through the normal controls. Technical must link the relay twice; the squad must reach the extraction pad and extract.
5. Review the result: objective completion, squad health and extraction, turn, remaining clock and a retry suggestion. Return to World or replay the mission. Reloading reopens the same run and result.

The deployed briefing is saved with the run. Editing the browser draft later does not rewrite that briefing. A different mission URL cannot relabel the saved run; the recovery notice offers **Resume saved mission**. Older unlabelled saves remain usable through their plain level URL.

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
