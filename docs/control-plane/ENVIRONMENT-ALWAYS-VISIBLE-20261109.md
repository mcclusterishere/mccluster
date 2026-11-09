# Public environmental evidence on the Equity Uprise globe

Status: review-branch implementation and automated-test handoff, not deployed. Prepared 2026-11-09.

## Change boundary

Base: Claude's `claude/new-session-83ken5` at `4bc22564af4c3a2f86719ef4b9cef4ea0d6fd3e8`.
Review branch: `codex/equity-environment-always-visible-20261109` in `mcclusterishere/mccluster`.

The existing McCluster consumer adapter now opts into continuously present public environmental evidence. News and Environment are navigation destinations, not an environmental layer on/off switch. The same globe iframe, existing official-source normalizers, canonical API, identity and mission backend remain in use. No new backend or provider subscription is introduced.

- Public observations load in the initial News view and remain mapped across navigation.
- Refresh checks run every five minutes while the page is visible. This is polling, not a live push or emergency-warning guarantee. Provider cache TTLs remain unchanged.
- The map label starts with the source name. Selecting a pin opens the existing observation detail, retaining that navigation intent if the mode controller is still starting, including source link, observation time, retrieval time, coverage and limitations.
- An Environment-only search filters the map while that panel is open. Its hidden search does not silently filter the News-view map.
- Missing coordinates stay unmapped. Missing data is not synthesized. Old or undated observations retain their stale status and cannot create actionable source-based proposals.
- Source outages do not become made-up empty live feeds. The panel retains its existing unavailable/partial status handling.
- Public initial loading does not read the user's token or private mission data. Private operations still require the existing authenticated backend checks and explicit participation actions. Opening details from News is a deliberate navigation; selecting a second detail does not re-trigger mode loading or erase an open editor.
- Civic League, E=Up admin workspaces, private Halo data, people, devices, cameras, tracking, financial accounts, private weather snapshots and proof files are not included in public pins.

The portable product's default mode behavior is preserved for other hosts. `ambientEvidence: true` is a host composition setting, not a visitor-visible toggle or an authorization grant. Internal pin teardown still sends `on: false` when the component is destroyed.

## Existing reusable sources, rather than a second Halo backend

`workers/mccluster/src/world-environment.js` uses the same underlying official-source fetchers as Halo, exposes only four allowlisted sources through the public `/v1/world/environment` contract, and uses its own `consumer-environment-v1-*` cache keys. Do not point the public globe at owner-only Halo endpoints.

| Source | Existing implementation and exact upstream | Coverage and freshness boundary |
| --- | --- | --- |
| NOAA NWS | `world-events.js:fetchWeather`; https://api.weather.gov/alerts/active?status=actual | U.S. active alerts. Zone-only alerts remain list entries with no fabricated location. 120-second cache TTL. Polygon label points are not exact hazard extents. |
| NASA EONET | `world-events.js:fetchNatural`; https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=500 | Global open event reports over the last 30 days, not exhaustive coverage. Uses latest reported geometry, not continuous incident extent. 600-second cache TTL. |
| USGS | `world-halo-layers.js:fetchQuakes`; https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson | Global reported earthquakes from the past day. Feed-generation and event timestamps are distinct. 120-second cache TTL. |
| NOAA NHC | `world-halo-layers.js:fetchCyclones`; https://www.nhc.noaa.gov/CurrentStorms.json | Atlantic, eastern and central Pacific, not global cyclone coverage. Missing observation timestamps remain unknown/stale. 600-second cache TTL. |

The product currently caps each source at 150 normalized observations and reports truncation. A marker is a report, not evidence of pollution exposure, environmental injustice, causation, a live sensor or a confirmed mission. Do not label this feed as live AQI, global pollution, comprehensive flooding, or environmental-justice scoring. Preserve source links and review any separately linked imagery or third-party material before expanding redistribution; an official source is not a blanket license for all linked assets.

### Broader Halo inventory, intentionally not published by this change

Halo has existing FIRMS thermal detections, NOAA tide functionality, wildfire perimeters and a deeper Connecticut weather/radar workflow. These need separate public-safe DTOs, coverage/freshness checks and any credential/licensing review before adding them. Do not relax their owner routes as a shortcut.

`world-weather.js` reads completed `weather_region_snapshot` jobs from canonical Core state for the owner-only Connecticut pilot. A read-only check of the latest jobs on 2026-11-09 returned zero rows. That does not prove the entire Halo collector system is inactive; it means this snapshot source cannot be represented as populated from that query.

## Evidence captured on 2026-11-09

These are point-in-time observations, not an uptime promise.

1. At 19:43 UTC, `https://mccluster.org/` returned HTTP 200 without redirect. Title: `Equity Uprise · McCluster`. It served the older `578e683088fd` globe revision in News mode and did not contain the new environmental panel/script. The established root is suitable for a QR described as **Explore the current platform**. A QR cannot guarantee future domain, routing or hosting availability.
2. At 19:43:44 UTC, `https://api.mccluster.org/v1/world/environment` returned HTTP 404 with `{"error":"Not found"}`. The feature in source is not evidence of a deployed public API.
3. The existing adapter was called locally without credentials, database access or cache, fetching the real four official providers. All four sources responded. The completed sample was read at 19:44:47.118 UTC:

| Source | Retrieved UTC | Normalized reports | Reports with coordinates | Stale reports in sample |
| --- | --- | ---: | ---: | ---: |
| NOAA NWS | 19:44:46.498 | 150, capped | 12 | 0 |
| NASA EONET | 19:44:46.784 | 38 | 38 | 1 |
| USGS | 19:44:45.612 | 150, capped | 150 | 0 |
| NOAA NHC | 19:44:47.106 | 1 | 1 | 1, observation time missing |

The USGS feed-generation timestamp was 19:44:12 UTC. For NWS, EONET and NHC the source-level observation timestamp was absent; individual event timestamps are separate. Source availability does not imply that every observation is new, safe to act on, complete or currently occurring. The combined response declared `truncated: true`.

## Files and integration directions

1. Review the isolated branch diff against the exact base above. Do not reset, force-push, or overwrite Claude's current branch.
2. Apply the host adapter and portable panel changes together, plus the tests. The vendored product lock records this as an explicit local patch and updates the panel digest; it does not pretend this was already committed upstream. Reconcile the patch deliberately if the product source advances.
3. Preserve Claude's identity-change and idempotent teardown guards. No migration, backend route change, billing activation, public proof sharing or source credential change is part of this patch.
4. Run the focused commands and the 390px/1440px browser journey below on an authorized browser-capable development environment. Also verify actual Cesium labels, picking, map readability and coexistence with news pins because the browser harness isolates Cesium rendering.
5. Integrate with the greater Environmental Justice League mission work; this is a display/composition change, not a replacement for that work. Keep civic/finance admin data separate.
6. Only through the approved release process, publish the matching Worker API and consumer page assets after their existing release/migration gates are satisfied. Confirm the anonymous endpoint, CORS, source outages, no-token initial load and guest/owner separation in the real environment. This handoff does not authorize a deployment.

### Fetch and integrate without disturbing ongoing work

```sh
git fetch origin codex/equity-environment-always-visible-20261109
git diff 4bc22564af4c3a2f86719ef4b9cef4ea0d6fd3e8..origin/codex/equity-environment-always-visible-20261109 -- js/world-environment-mccluster.mjs vendor/equity-uprise scripts/test/world-environment-ambient.test.mjs scripts/e2e/world-environment.mjs docs/control-plane/ENVIRONMENT-ALWAYS-VISIBLE-20261109.md
```

From a clean integration branch based on your latest work, inspect the fetched branch head and, if it is not already integrated, run `git cherry-pick origin/codex/equity-environment-always-visible-20261109`. The published branch contains one review commit on the base above, including the tested implementation, regression tests and this handoff. Do not reset your branch to this branch or overwrite newer work.

If the adapter or vendored product has advanced, resolve deliberately: preserve current authorization and lifecycle fixes, apply the always-present public-evidence behavior, retain the navigation readiness contract, and update the local-patch declaration and SHA-256 digest for the actual panel file. Rerun the tests below on the resulting merged tree. Do not blindly replace a newer product lock with this older base.

The reviewed repository workflows limit production pushes to `main` or the explicit production branch, or require manual dispatch. Publishing this feature branch is for discovery and integration only. No release workflow is requested or dispatched by this handoff.

## Verification

Focused frontend/product regressions:

```sh
node --test scripts/test/world-environment-ambient.test.mjs scripts/test/world-environment-lifecycle.test.mjs scripts/test/world-environment.test.mjs scripts/test/equity-product-consumer.test.mjs
```

Result: 56 passed. Includes initial News loading, no initial private reads, attributed safe pins, source failure, trusted-origin/source selection, repeated navigation, search scope, teardown during a public fetch, portable-host compatibility, no redundant detail navigation, delayed-controller selection replay and destruction before replay.

Worker environment/proof/planning regressions:

```sh
cd workers/mccluster
node --import ./test/support/offline-network.mjs --test test/world-environment.test.mjs test/environment-mission-planning.test.mjs test/environment-planning-mccluster.test.mjs test/environment-proofs.test.mjs test/world-environment-action-media.test.mjs
```

Result: 65 passed. No production writes were performed.

Python root tests: 7 passed.

The first default-concurrency `npm test` attempt had 2,133 passing Node tests, 3 skips and one process-level failure in the unrelated `music-payment-integrity.test.mjs` module. That module then passed all 24 tests when run alone. The result must not be described as a clean initial aggregate run; the runner supplied no specific failing assertion in that attempt.

After the final navigation fixes, the bounded-concurrency full Node run (`node --test --test-concurrency=2 scripts/test/*.test.mjs`) passed 2,145 tests with 3 skips and zero failures. Independent code review found no remaining blocking issues and separately exercised late Posts/Environment controller initialization, latest-selection retention and no later unwanted replay. These results do not replace browser rendering acceptance.

Browser acceptance harness:

```sh
CHROMIUM_PATH=/usr/bin/chromium node scripts/e2e/world-environment.mjs
```

The harness now includes initial ambient pins, public-only loading, pin-to-detail navigation, navigation persistence and source failure at both 390px and 1440px. Syntax checks passed, but the browser flow could not execute here. The Playwright-managed binary was absent; the installed Chromium launch then failed at its socket operation with `Operation not permitted`. No permission workaround was attempted. No screenshot, overflow measurement or browser-rendering pass is claimed.

No production API, database, scheduled collector, public deployment or QR destination was changed by this implementation. Publishing the review branch is separate from merging or deploying it.
