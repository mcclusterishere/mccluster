# Sole Run shared City consumer

Review dependency: City #736 at 3dc414857b17fb758945d930f81c88e22e44c69a, then City #748 runnable head 8cadf264613a091ecbdf058dbec50f8883b5cf42 (contract checkpoint a55e7ceed929f6dbe81c341d1097536a92744a24), then this #743 consumer. These are dependency/review order, not merge authorization. No City files or topology definitions are copied into this PR.

Entry: city-arcade.html?game=designer-kicks-sole-run&location=bridgeport-main-golden-hill . Play/pause the actual street game, then choose **Walk Golden Hill on globe**. The consumer pauses and persists the existing Sole session, disables its gameplay/configuration controls, and sends City's versioned bridgeport:enter to the existing same-origin arcade iframe. The actual Cesium viewer is retained. Use City's square/hex, preview/confirm and stop controls inside that globe. **Return to Sole Run** sends bridgeport:leave and waits for City's pinned returned event; resume is explicit.

City alone owns navigation geometry, graph, square/hex conversion, floor street, local region save, animation and camera restoration. Its valid separate region save takes precedence over the default entrance spawn. The consumer never reads/writes City's save, transforms old player coordinates, awards mission progress or changes shoes/points/timer on City arrival. It accepts only same-origin/exact-frame lifecycle replies pinned to region bridgeport-golden-hill.v1, revision1, frame bridgeport-golden-hill.enu.v1, floor street and entrance bridgeport-main-golden-hill. Unsupported senders/versions/entrances are ignored. Elm has explanatory text only. Configured mission road closures prevent entry because this consumer does not translate those restrictions into City's independent graph.

Deep-link startup also preserves the selected entrance when the iframe becomes ready. An initial distant camera report no longer cancels explicit game entry before the first in-region observation; subsequent departure still unloads and saves.

No data/module request is made for City until explicit entry; City then owns camera-gated loading, unload and its budgets. Missing City integration times out, requests leave, and leaves Sole paused. Owner denial/revocation is enforced by the existing page gate and City owner check; a returned event releases the paused game controls, not authorization. Disposing Sole requests City leave and removes the listener. Live ion is not established by this change.

Scope limit: this is an entrance/walk/return consumer. The four-shoe Sole mission remains on the legacy sourced road frame and is NOT square/hex end to end. City v1's Golden Hill graph cannot reach Main/Elm, Main/Fairfield or Middle/Golden Hill. No expansion, inferred legal road, floor link, AP conversion or building interior is added. The shared walk and Sole mission intentionally retain separate saves and progress.

Validation commands:
- node --test scripts/test/city-arcade-spatial.test.mjs
- node --test scripts/test/*.test.mjs
- Against an isolated local combination with the exact City dependency above: node tools/publish-fictional-city.mjs; serve that checkout on loopback port8767; ARCADE_BASE=http://127.0.0.1:8767 node scripts/e2e/city-arcade-spatial.e2e.cjs . Requires locally installed Playwright, /usr/bin/chromium, and pinned Cesium1.131 Build/Cesium (CESIUM_BUILD override). No hosted requests escape the fixture router.
- Existing city-arcade-action.e2e.mjs covers keyboard/touch action play, private local database fixtures and return/resume independently.

The real-renderer integration harness verifies actual Sole play then pause, City hex arrival, square switching without position change, exact legacy save preservation, same Cesium viewer, City saved resume and revoked-owner return at390/1280. Auth, imagery and ion-unavailable responses are explicit fixtures, not production verification.
