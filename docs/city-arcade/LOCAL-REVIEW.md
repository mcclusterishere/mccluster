# Arcade review handoff

Base: `4fc32c84970d1a5cbc69c2df218e700bcea14032` (main). Prepared for authorized draft PR review.
No merge, production database write, deployment or purchase. See `PRODUCT-CONTRACT.md` for boundaries.

## What can be reviewed

- Shared Cesium globe → real Bridgeport street selection → game entry.
- Graphical Tea Rush with keyboard/touch, authoring controls, private mission versions and results.
- Continuous 2D Sole Run on sourced streets, camera follow, minimap, glowing legal path, road closure
  validation, and optional configurable Fashion Police decoy/clue/prop-confiscation/roast encounters.
- Marker-first regional loading, actual camera proximity/zoom signals, bounded geometry loads,
  deferred game imports, cancellation, unload and saved local session restoration.
- Canonical Worker owner gate plus database permission checks, revisions, immutable versions,
  run/result binding and idempotent finish. These are LOCAL implementations, not live services.

## Evidence (2026-11-04)

- 65 focused Node tests passed: arcade rules/streaming/derived geography, owner gate, ion and globe zoom regressions.
- 31 isolated PGlite database/API assertions passed. No production Supabase connection is used.
- 51 browser assertions passed at 390 and 1280 px: keyboard, actual CDP touch events, no horizontal
  overflow, authoring → save → play → result → return/reload, decoy sequence, preserved Sole state,
  marker-first requests, zoom loading/unloading. Uses real local API handler/database with auth/globe fixtures.
- Pinned actual Cesium 1.131 renderer test passed: initial markers only, real camera zoom triggers
  geometry, real canvas point-pick selects an entrance and launches Tea Rush, real zoom-out unloads it.
  Imagery/account responses are offline fixtures, not live ion data.
- Measured resources on local HTTP: markers 914 body bytes / 1,214 transfer bytes; district geometry
  596,924 body bytes / 597,224 transfer bytes. Reentry after unload fetches geometry again.
- Thirty browser rAF samples while Sole ran: mean about 16.4 ms, maximum about 16.7 ms, at both sizes.
  These are short software-browser observations, NOT physical-phone FPS or a performance guarantee.
- Syntax checks and `git diff --check` passed. Direct live Cesium CDN attempt failed with
  `ERR_TUNNEL_CONNECTION_FAILED`; live ion entitlement/imagery remain unverified.

Screenshots in this environment: `/tmp/tea-rush-390.png`, `/tmp/tea-rush-1280.png`,
`/tmp/sole-run-390.png`, `/tmp/sole-run-1280.png`, `/tmp/arcade-real-cesium.png`.
The last screenshot has intentionally blank fixture imagery; the pins and camera are actual Cesium.

## Reproduce locally

```
node tools/publish-fictional-city.mjs
node tools/build-arcade-locations.mjs
python3 -m http.server 8765 --bind 127.0.0.1
```

Normal page: `http://127.0.0.1:8765/city-arcade.html` (owner auth still required).
There is no user-accessible hosted preview/port-forwarding capability in this environment.
No auth bypass was added to the shipped page. Review screenshots and run the local harness below;
the harness uses explicit local test identities and never writes to a production service.

In another shell, with Playwright and Chromium available:

```
npm install --prefix /tmp/arcade-db --cache /tmp/arcade-npm-cache --no-audit --no-fund @electric-sql/pglite@0.3.14
npm install --prefix /tmp/arcade-cesium --cache /tmp/arcade-npm-cache --ignore-scripts --no-audit --no-fund cesium@1.131.0
node --test scripts/test/city-arcade*.test.mjs scripts/test/owner-only.test.mjs scripts/test/world-ion-globe.test.mjs scripts/test/world-globe-zoom-out.test.mjs
PGLITE_MODULE=/tmp/arcade-db/node_modules/@electric-sql/pglite/dist/index.js node scripts/test/city-arcade-database.integration.mjs
PGLITE_MODULE=/tmp/arcade-db/node_modules/@electric-sql/pglite/dist/index.js node scripts/e2e/city-arcade-action.e2e.mjs
node scripts/e2e/city-arcade-cesium.e2e.cjs
```

Optional harness overrides: `ARCADE_BASE`, `CHROMIUM_PATH` for action tests, `CESIUM_BUILD` for
actual-renderer tests. Their default browser path is `/usr/bin/chromium`. Dependency installs above
are temporary test tooling, not application dependencies or new infrastructure.

## Integration ownership / remaining review

No `js/fictional-city/*`, canonical city data, government identity, CT footprint, PRIM3 gameplay,
Control navigation, deployment workflow or existing save key was edited. The derived marker/server
road files regenerate from city authority and have parity tests. The only shared code edits are:

1. `js/action-globe.js`: optional camera observer under the explicit arcade query flag.
2. `workers/mccluster/src/index.js`: dispatch `/v1/arcade` through existing owner authority.

There was no direct task-to-task communication tool in this environment. This is the coordination
handoff for the separate city/tactical task; reconcile those two shared hooks deliberately.
Publication check: main remains the base above. Open PR #726 overlaps `js/action-globe.js`;
#736 overlaps the Worker entry point. Reconcile these hooks before merge. PR #738 city streaming
and #739 PRIM3 have no directly edited file overlap. No unmerged PR is a build dependency.
Existing integrated city history and CLAUDE-HANDOFF were inspected.

Before production: independent review, actual multi-session Postgres concurrency/revocation checks,
production session authorization, real ion/provider availability, physical touch devices and the
normal promotion process. Generate an approved migration from the pending schema only as part of
that separate process. Lower roles remain denied. Cloud result data is self-reported practice;
it cannot award real currency or cross-world benefits. Sole's pending finish now survives reload (merged in #761). The browser regression
`city-arcade-recovery.e2e.mjs` verifies lost success responses, denied sessions and idempotent retry
at 390px and 1280px against the isolated database. See `ACTIVATION-HANDOFF.md` for current rollout prerequisites.
