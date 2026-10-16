# World transport and space selection — 2026-10-16

Branch: astra/globe-transport-and-flight-details-20261016. PR: #467.

## Built

- Keyless directions handoff for driving, transit, walking and cycling. The destination can start from a selected mission's region, explicitly requiring venue confirmation. Whip's separate driver signup and rides-not-live notice remain.
- Aircraft silhouettes and selectable telemetry. The underlying feed is a snapshot; no invented itineraries, fares, seats or synthetic motion.
- Satellite selection (point or label) opens an original, generic glTF schematic plus a one-period SGP4 orbit prediction from supplied TLEs. Its schematic scale and attitude are disclosed. No provider key or downloaded model is required.
- Launch-pad selection opens mission/schedule/status details and a generic 3D rocket schematic at the pad. It is not a measured launch vehicle or simulated ascent. Missing pad coordinates never become (0, 0).
- Closing a sheet or disabling a selected layer cleans up its model/orbit entities.

## Verify

Run `node --test scripts/test/*.test.mjs` (729 tests at this checkpoint).

Browser test: `scripts/e2e/world-transport.e2e.mjs` uses real Cesium and Playwright with fixture network responses. Set CESIUM_DIR to a local Cesium Build/Cesium directory, PLAYWRIGHT_DIR to the node_modules containing Playwright (or use CODEX_PRIMARY_RUNTIME_NODE_MODULES), and optionally CHROMIUM_PATH to a Chromium executable. QA_WIDTHS defaults to 390,820,1280. Screenshots are written to /tmp/globe-transport-qa.

The original Chromium download failed. A packaged Chromium from @sparticuz/chromium worked for local tests; this is test infrastructure only, not a new app dependency. Globe, directions, aircraft and satellite interactions were exercised at phone/tablet/desktop widths. Run the complete test on the final head before release, including launch selection.

## Remaining product scope

No in-app route rendering, booking, fares, live ride dispatch, launch trajectory, actual spacecraft mesh, or commercial integration is implied. Real provider availability and imagery need production smoke checks. Keep Halo as the full product and World as the deliberately smaller experience; do not merge unrelated PRs wholesale.

Halo's separate PR #29 provides the owner-gated hosted-ion path. It still needs a separate Halo CESIUM_ION_TOKEN secret with the selected assets enabled, then an authenticated provider check. McCluster's existing key must remain separate. No keys or subscriptions were changed in this work.
