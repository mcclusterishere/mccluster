# Six Analytics tabs

Review update to draft #745. Existing Overview graphical summaries and all eleven detail renderers remain. Six primary tabs control one in-place panel; local groups have at most three buttons. Arrow keys, Home/End, previous/next and swipes move between the six primary tabs. Detail buttons retain their own scroll positions, filters, evidence and actions. No query, collection rule, backend permission or metric definition changed.

## Old → new route and metric map

The renderer IDs below remain valid. Existing `#insights:*` routes and shared navigation/search entries still resolve to those IDs; opening a detail selects its parent tab. No URL migration or redirect is necessary. Setup remains reachable from Data & setup.

| Retained detail / renderer | New primary tab | Preserved data and controls |
| --- | --- | --- |
| Overview / `overview` | Overview | Audience/Content/Business summaries, trend, all measured metrics and globe coverage |
| Audience / `audience` | Audience | Visitors, sessions, returns, acquisition, paths, page performance, listening behavior, geographic suppression |
| Journeys / `identity` | Audience | Signup journeys, attribution, track assists, stages, account pagination and path filters |
| Content / `content` | Content | Track starts/listeners/repeats, media events, engagement, track selection and full tables |
| Adaptive / `adaptive` | Content | Decision/impression/interaction/outcome counts, policies, experiments, research registry and decision evidence |
| Action & business / `action` | Action & business | Accounts, commerce, music, mission assignments and proof; existing scopes and drilldowns |
| World intelligence / `intelligence` | World intelligence | Source readiness/entitlements, stored entities/events/observations, explicit provider snapshots and original evidence |
| Cameras / `cameras` | World intelligence | Catalog, stale/verified coverage, requested image checks, failures and provenance |
| Data explorer / `inventory` | Data & setup | Datasets, event dictionary, connections, field directory, read health and searches |
| Site health / `forensics` | Data & setup | Sessions, visitors, flows, errors, filters and event details |
| Setup / `setup` | Data & setup | Existing property/collection configuration, installation checks and domain verification |

## Query and semantics audit

`analytics.js::load` retains sequential bounded fan-out. Hourly/daily and totals RPCs feed Overview and Audience; business feeds multiple summary/drilldown presentations. These are alternate presentations of shared responses, not new totals to sum. `analytics_top` intentionally uses separate source/network dimensions, and different country limits for lists versus geographic coverage. These queries were not collapsed as duplicates.

Content and identity have distinct starts, listeners, signup and attribution semantics. Stage totals are activity counts, not necessarily a cohort conversion funnel. Mission stats remain all-time; business and traffic retain their selected-window labels. Audience geographic views retain small-group suppression and country scope; other chapters keep their labeled global/property scope. Unknown, failed and incomplete data remain distinct from zero. Distinct visitors across buckets must not be added to infer a unique total.

Inventory/provider/camera reads remain on demand where already implemented. Camera catalog availability is not verified image availability. Source readiness is not live health. The provider snapshot action keeps its existing explicit request and entitlement behavior. Fewer tabs do not imply fewer data reads, lower latency or new collection.

## Access and owner layout controls

This change preserves the existing owner shell checks and server authorization. The analytics router's `requireHouseOwner` protects forensic, experience, audience-science and camera reads; first-party-only business/identity/mission values remain unavailable on external properties. Client presentation never grants a data entitlement. No SQL, permissions or production settings changed.

**Pending: persisted owner-configurable layouts.** The audited Analytics client/router provides no layout read/write contract. This PR therefore ships the six-group default, not a pretend server-backed layout editor. Before adding reorder/default-detail preferences, use the canonical owner-authorized configuration service with a versioned, validated six-group schema, explicit save/reset, stale-write handling and account-change fencing. Preferences must never change data access or hide required error/status actions. The separate owner front-page draft contract is content-specific and is not reused as an undocumented Analytics settings store.

## Pending metrics and limits

No metric was deleted or newly fabricated. Existing unavailable upstream/credential reads remain visible as unavailable; provider/camera observations still need explicit reads and valid source entitlements. Historic last-success, incident causality and measured user impact are not supplied by the System snapshot and remain unknown. The six-tab change does not repair those sources or complete the broader admin redesign.

## Verification

- 111/111 focused source checks, including coverage of all eleven detail routes exactly once and all read-health destinations.
- 376/376 full Analytics browser checks passed. The suite traverses every retained detail using the six-tab/local-button navigation at 390, 820, 1024 and 1440px, plus nested 340px panels. It checks the primary-tab count, keyboard Home/End, data drilldowns, pagination, search focus, source failures and existing camera controls.
- Browser data is synthetic; there is no production or physical-device acceptance claim. The phone review is saved at `docs/admin/review/analytics-six-tabs-390.png`.

Reproduce with the same external Playwright and Cesium 1.131 setup as `INBOX-HOME-REVIEW.md`:

```sh
node --test scripts/test/control-*.test.mjs scripts/test/appbar-consistency.test.mjs scripts/test/globe-games-gate.test.mjs
PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_PATH=/usr/bin/chromium CESIUM_DIR=/tmp/admin-ui-tools/node_modules/cesium/Build/Cesium node scripts/e2e/analytics-tabs.e2e.mjs /tmp/admin-six-tabs
```
