# Existing admin interface continuity — W04 / W10

This is local implementation and fixture evidence against main `e9d8604988496783fa25f4c450bd49fec69ba476`, on `feat/admin-evidence-20261020`. No production mutation, deployment, commit, push, or merge was performed by the interface workstream. A browser fixture is not production data or independently validated measurement.

## Preserved surface

No Control HTML or CSS changed. The eleven Analytics chapters, shared bottom navigation, profile entry point, existing hash routes, workspace state, desktop `0.8fr 1.2fr` split, scrolling panes, carousels, Data status / Refresh / Auto controls, and persistent Cesium globe remain in the existing components. Funding stays under the existing Create → Funding Intelligence destination and uses its existing Funding programs cards. There is no new dashboard or destination.

The supported Control theme is **dark**: `control.html` explicitly sets `data-theme-lock="dark"`. Both stored dark and light user preferences were captured; both correctly render the locked dark theme. These are not evidence of a supported light Control skin.

## Changes

- `analytics.js` derives one projection selection key from the existing property, country/state, time window, timezone, metric/layer, source and event selection. The same context is attached to the globe payload and rendered panel. Geography remains audience network-derived country versus evidence geometry, with unknown values and suppression distinct. No raw identity was added to the projection.
- The display context records metric version, scope, geography, half-open window, timezone, unit, unknown numerator/denominator, completeness, suppression, explicit unknown freshness, and the available server measurement contexts. Legacy reads honestly identify `independent_live_reads` and `watermark: null`; they do not claim a frozen snapshot.
- The new `analytics_stage_totals` RPC is preferred when installed. It counts distinct device IDs across the whole window and keeps auth accounts separate. Its canonical page-view stage is `view`; this drives the Arrived count. A missing-function response alone falls back to the old daily RPC, labeled **device-days**. It never presents a sum of daily distinct IDs as distinct people or computes a cross-population conversion rate.
- Checkout activity is intent; purchase-stage telemetry is a **Purchase report**. Verified sales remain in the existing authoritative commerce cards. Legacy `converted` behavior labels are shown as an unverified legacy action signal. The unmatched legacy song-signup percentage is withheld pending a matching cohort. Adaptive outcomes are **Client outcome reports**; absent rates remain unavailable and absent counts remain unknown.
- Server completeness metadata remains visible in the existing summary, health details and Measurement context expansion. A successful capped response marks the dashboard partial while retaining its measured values. Missing country totals remain unknown, not zero. The current backend's explicit limits are displayed without claiming lossless telemetry.
- Auth revocation/sign-out invalidates private datasets, source catalogs, funding details, in-flight responses and refresh callbacks. A reload is required to verify a changed session. This is cache hygiene, not a replacement authorization system.
- The existing globe failure message is a concise ARIA live status; the third-party error overlay is removed on failure. Its existing country selector and cards remain usable without WebGL. Opening/closing the filter sheet now moves focus into the sheet and returns it to the trigger; Escape closes it.
- Funding programs read `/v1/control/funding/register` and open `?route_id=…` inside the selected card. Technical fit, applicant eligibility, application readiness, blocking criteria, source review, proposed targets and evidence references are shown separately. A missing register keeps the legacy catalog and private mission drafts available while showing the missing-read state. No application, payout or grant eligibility is authorized by these cards.

## Screenshot evidence

Baseline captures were taken **before the UI edits**, with the real Control DOM and real Cesium 1.131.0 renderer, using the existing analytics suite's intercepted in-memory API fixtures. Fixed clock: `2026-10-20T12:00:00Z`; timezone UTC; reduced motion; device scale factor 1. Browser: Chromium 131.0.6778.0 via the locally available `@sparticuz/chromium` 131.0.1 binary and SwiftShader. No production request supplied these screenshots.

| Viewport | Before | After | Geometry | Changed pixels |
| --- | --- | --- | --- | --- |
| 390 × 844 | [before](interface-proof/before/dark-390.png) | [after](interface-proof/after/dark-390.png) | Exact match | 926 / 329,160 (0.2813%) |
| 820 × 1180 | [before](interface-proof/before/dark-820.png) | [after](interface-proof/after/dark-820.png) | Exact match | 1,323 / 967,600 (0.1367%) |
| 1280 × 1000 | [before](interface-proof/before/dark-1280.png) | [after](interface-proof/after/dark-1280.png) | Exact match | 38,665 / 1,280,000 (3.0207%) |

Exact geometry comparison covers `.cra-stage`, `.cad-body`, `.appbar`, and `.cu-geography`; the legacy nonexistent `.cra-shell` probe is null in both runs and is not counted as evidence. The intended stage wording, population note and resulting card contents explain the pixel differences. These are Overview captures, not pixel-perfect screenshots of every chapter. Both preference sets have identical comparison results. Real globe rendering, no horizontal overflow and no browser errors passed for all six captures. The current screenshot suite explicitly checks the actual dark theme lock.

Artifacts: [geometry and pixel comparison](interface-proof/comparison.json), [baseline geometry](interface-proof/before/geometry.json), [after geometry](interface-proof/after/geometry.json), [baseline harness](interface-proof/baseline-harness.mjs), and [artifact hashes](interface-proof/sha256.json).

Additional evidence: [partial read, phone](interface-proof/states/partial-390.png), [partial read, tablet](interface-proof/states/partial-820.png), [partial read, desktop](interface-proof/states/partial-1280.png), [no WebGL](interface-proof/states/no-webgl-390.png), [funding phone](interface-proof/states/funding-390.png), [funding tablet](interface-proof/states/funding-820.png), [funding desktop](interface-proof/states/funding-1280.png).

## Reproduction and verification

Runtime environment for this run:

```sh
export PLAYWRIGHT_DIR=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules
export CHROMIUM_PATH=/tmp/mccluster-admin-chromium
export CESIUM_DIR=/tmp/mccluster-admin-ui-qa/node_modules/cesium/Build/Cesium
export LD_LIBRARY_PATH=/tmp
```

These are temporary test-runtime paths, not application dependencies or deployment settings. Supply equivalent Playwright, Chromium and pinned Cesium paths in another environment.

```sh
node --test scripts/test/analytics-measurement-ui.test.mjs scripts/test/control-analytics.test.mjs scripts/test/analytics-state-selection.test.mjs scripts/test/analytics-unified.test.mjs scripts/test/funding-register-ui.test.mjs
node scripts/e2e/analytics-measurement.e2e.mjs /tmp/analytics-measurement
node scripts/e2e/analytics-unified.e2e.mjs /tmp/analytics-navigation
node scripts/e2e/funding-register.e2e.mjs /tmp/funding-register
```

The retained baseline harness accepts `ANALYTICS_REPO_ROOT` pointing to the checkout being captured. It preserves the original fixture/capture method. The regular measurement suite now imports the existing unified suite fixtures instead of maintaining a second fixture authority. Set `ANALYTICS_PROOF_ONLY=1` for six deterministic Overview captures, or `ANALYTICS_SKIP_CAPTURE=1` for focused behavior checks.

Measured results (all exit 0):

| Check | Result | Evidence |
| --- | --- | --- |
| Targeted Node suites | 62 passed, 0 failed | [unit log](interface-proof/unit-tests.log) |
| Existing unified browser suite | 159 assertions passed, 0 failed | [navigation log](interface-proof/navigation.log) |
| New full capture/measurement run | 54 assertions passed before the final canonical-stage/focus refinements | [full run log](interface-proof/measurement-initial.log) |
| Final focused measurement run | 39 assertions passed with canonical `view` stage, keyboard focus return, shared selection, partial reads, one globe and sign-out | [focused log](interface-proof/measurement-final.log) |
| Final no-WebGL run | 4 assertions passed after clearing Cesium's injected error panel and shortening the fallback message | [fallback log](interface-proof/fallback-final.log) |
| Funding browser suite | 15 assertions passed at 390 / 820 / 1280 | [funding log](interface-proof/funding.log) |

The existing navigation suite includes keyboard chapter changes, touch gestures, country/state filtering, persistent globe identity, the original bottom tabs, workspace views, explicit source failures, dataset state distinctions, and input/search paths. The Node tests verify unfinished custom dates, missing-RPC fallback, late response ordering, revocation, unknown values, unsupported legacy conversion labels, unavailable adaptive rates, and funding detail races. `node --check` and the scoped `git diff --check` pass. These counts describe separate runs; they are not a claimed count of independent experiments.

## Limits and remaining work

This work does **not** establish immutable cross-RPC snapshots, an ordered conversion cohort, full card/table/export reconciliation, projection lag measurement, or a production-wide freshness guarantee. Those require durable server/database contracts beyond a UI selection key. The visible labels retain each card's applicable scope instead of pretending that live all-time commerce or mission data is the selected audience window. No new export was added. W04 should remain partial until its broader reconciliation requirements are met.

The new stage RPC and funding criteria register depend on separately reviewed pending migrations and Worker promotion. Before those are installed, the legacy daily stage unit and missing-register status are intentional. Browser tests intercept API calls, and do not prove deployed authorization or direct database RLS; use the backend role/security evidence for those boundaries. Cross-origin sign-in and real hardware rendering were not exercised by these local fixture runs. Chromium's two expected WebGL initialization console diagnostics are retained in the no-WebGL test; any other browser error fails it.
