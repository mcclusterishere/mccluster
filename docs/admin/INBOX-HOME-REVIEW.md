# Inbox, Home and System review slice

Source baseline: main `4fc32c84970d1a5cbc69c2df218e700bcea14032`, plus open Games PR #726 at `2f46f6116e24ab07b4e5d2b9f7c255b5837c8d9b`. This branch is stacked on #726, not a replacement for it. Published as draft PR #745 for review; no deployment, production write or account change is part of this slice.

## Implemented

- The server-verified owner's bar is Play, Inbox, Home, supplied M, Analytics, World/Halo, Games. Inbox is immediately before Home; Games immediately follows the existing owner globe and opens #726's `action-globe.html?explore=1&games=1`. Public/member navigation and the existing Missions gates are unchanged.
- Home retains the established single-tap destination picker and double-tap Today action, with keyboard access. Inbox and Analytics preserve the current organization and switch hashes inside the same document. The duplicate section rail disappears only after the shared navigator is ready; it remains the loading-failure fallback.
- People is presented as Inbox. Three local categories expose Messages; People (Contacts, Companies, Clients); Follow-through (Deals, Outreach). Client projects, deliverables, relationships, pipeline and tasks retain their original child routes and handlers. Every old `#people:*` and `#work:*` route survives; `#inbox` and `#inbox:*` also resolve. No records or renderers were removed.
- AI reply keeps the thread switch and existing owner-controlled backend operations. A concise explanation maps Knowledge, Models & spend, Delivery log, Channels, and Tools & approvals to their actual functions. Model selection and trigger editing are explicitly unavailable in this editor; no synthetic controls or automatic enabling were added. The existing settings buttons retain their real consequences when an authorized owner uses them.
- Analytics is a first-class bottom destination, not a Home section card. Its chapters, charts, metrics and retained globe remain intact and searchable. Overview now leads with three compact summary groups: Audience, Content and Business. Each value retains its labeled time window and opens its existing detail view. The phone carousel is a keyboard-focusable region; wider containers show the cards together. Failed reads hide stale metric values, zero remains zero, and external properties never inherit first-party commerce or account figures. The existing trend, stage activity, attention panel and expandable full metrics remain intact.
- System labels Observability as Activity & errors. Error badge wording says **error log entries**, not incidents. A read-only dependency flow shows API/database/Core checks as passed, failed or unknown and shows snapshot age. This flow does not claim to diagnose cause.
- The event summary deduplicates identical source/ID pairs and groups only shared trace IDs. Untraced events remain separate, even if their text is similar. Groups show explicit severity, latest age/time, a recorded success if present, limited plain-language interpretation, reported record scope, next inspection step, and expandable original evidence. Success does not imply recovery. Filters, pagination, full tables, traces and inspectors remain available.
- Job failures and audit/source-read context move under a plainly labeled expandable section. Its records can overlap the retained timeline, so they are not added to the displayed error count. No private live incident rows are embedded in source or fixtures.

## Design evidence

NN/g's [Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/) supports timely feedback and showing enough state to choose the next action. Its [Error-Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/) support understandable explanations near the relevant operation and recovery guidance. Applied here as status, scope, time and inspection action beside each group, with technical evidence retained on expansion.

[W3C Use of Color](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html) requires meaning beyond color. Severity and service checks therefore have text and symbols; native buttons, links and details provide keyboard interaction. [W3C Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) informs the existing status feedback. This is targeted browser/accessibility verification, not a WCAG certification.

## Reproduce review

Install Playwright outside the repository if necessary. Example commands (all browser suites intercept network with synthetic fixtures):

```sh
node --test scripts/test/control-*.test.mjs scripts/test/appbar-consistency.test.mjs scripts/test/globe-games-gate.test.mjs
PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/e2e/site-navigation.e2e.mjs /tmp/admin-inbox-proof
PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/e2e/control-room-nav.e2e.mjs /tmp/admin-nav-proof
PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/e2e/control-desk-bot.e2e.mjs /tmp/admin-desk-proof
```

Review routes are `control.html?org=o1#people:inbox:conversations`, `#people:inbox:ai-reply`, `#home:today`, `#system:overview` and `#system:observability` within the fixture browser. Screenshots include `inbox-390.png`, `system-390.png` and their tablet/desktop counterparts. These are local review artifacts, not published production URLs. The ordinary app remains authenticated; no demo bypass was added.

Validation on the initial slice: 104/104 focused source tests; 291/291 shared navigation/browser checks; 214/214 Control navigation checks; 78/78 AI-settings browser checks. Browser widths were 390, 820 and 1280 pixels. The shared suite exercises repeated same-document Inbox navigation, category visibility, current-tab state, touch target sizes, grouped System evidence, source fallback, keyboard focus, browser Back, all route inventory entries, owner revocation, sign-out races, guest/member navigation and embedded opt-outs. No full-platform or production acceptance is claimed.

## Integration boundaries and remaining work

Owner self-service is a separate dependency, draft [#741](https://github.com/mcclusterishere/mccluster/pull/741). Its exact runtime revision `1b26c37189a8e8b067da001d3144fe48970f9d04` was composed with this slice at `07431821fce402c8bb41cbb152f6a5da77575432` in an isolated worktree. The patch applied cleanly without overlapping runtime files. `js/control-room/front-page.js` and `js/site-editor.js` match that owner revision byte for byte. Its later head `6a9ea1bee00f511c529f1e0778af802fa96247c8` changes only AGENTS.md guidance. No owner implementation, SQL or test files were copied into #745; review and land dependencies deliberately.

The larger mini-app redesign is not complete: other Sell/Create/System editors retain their current local layouts. Trigger/model controls need an owner-scoped backend contract before implementation. Historical last-success and user-impact data are not supplied by the current service snapshot; unknown is displayed. Trace grouping is not root-cause analysis. Physical-device and authenticated production acceptance remain outstanding. The separate incident investigation owns diagnosis and repairs; this UI performs none.


## Follow-up reconciliation and evidence

The exact owner-controls integration passed **104/104 full-shell browser checks**, including history preview, explicit restore publication, stale-version conflict preservation, deliberate reload/reconciliation, missing-migration refusal and account-change clearing. The isolated SQL-backed browser flow also passed private draft save/reload/resume, publish, history preview, restore, discard, two-tab conflict, denied identities, phone overflow and JavaScript-error checks. These tests used synthetic identities and local in-memory PGlite, never production.

The owner database suite passed **10/10 tests**, covering owner/member/anonymous authorization, private draft isolation, stale revisions, history, restart and rollback/reapply. The combined focused source suite passed **117/117 tests**. Full Postgres concurrency, canonical migration replay, managed-auth and physical-device/production acceptance remain release gates owned jointly with #741; local tests do not establish those results.

Reproduce composition from this branch at `07431821` in a disposable worktree: apply the binary diff from main `4fc32c84` to owner revision `1b26c371`, then run the commands below. The database harness uses `@electric-sql/pglite@0.3.14` installed outside the repository. It applies proposed SQL only inside the isolated local database.

```sh
PGLITE_DIR=/tmp/admin-ui-tools/node_modules node --test scripts/test/owner-front-publication-db.mjs
PGLITE_DIR=/tmp/admin-ui-tools/node_modules PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/e2e/owner-front-sql.e2e.mjs
PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/e2e/control-front-page.e2e.mjs /tmp/admin-owner-combined-proof
node --test scripts/test/control-*.test.mjs scripts/test/appbar-consistency.test.mjs scripts/test/globe-games-gate.test.mjs scripts/test/owner-front-publication.test.mjs
```

System fixtures now mirror `core/src/runner.mjs`, `core/src/observability.mjs` and the Worker's event contract: separate terminal jobs with attempt/status fields, shared trace IDs, a request with HTTP 502, and provider warnings. They are generated examples, not copied private records. Warnings and error rows stay separate; an `ok` outcome on a warning or an HTTP failure cannot count as a successful event. No automated fix is attempted.

Additional reproduction:

```sh
node --test scripts/test/control-*.test.mjs scripts/test/appbar-consistency.test.mjs scripts/test/globe-games-gate.test.mjs
PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_PATH=/usr/bin/chromium CESIUM_DIR=/tmp/admin-ui-tools/node_modules/cesium/Build/Cesium node scripts/e2e/admin-insights-summary.e2e.mjs /tmp/admin-insights-summary-proof
PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_PATH=/usr/bin/chromium CESIUM_DIR=/tmp/admin-ui-tools/node_modules/cesium/Build/Cesium node scripts/e2e/analytics-tabs.e2e.mjs /tmp/admin-insights-proof-final
PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/e2e/control-front-page.e2e.mjs /tmp/admin-frontpage-proof
```

The analytics browser fixture uses the app-pinned Cesium **1.131**, installed outside the repository. No dependency manifest was changed. Latest focused source result: 109/109 passed. Published review screenshots under `docs/admin/review/` contain only synthetic fixture data.

Latest bounded Insights browser result: 36/36 checks at 390, 820 and 1280 pixels, including all three drilldowns, carousel keyboard access, missing-read behavior and recovery. Existing front-page preview/save/reset: 90/90 checks.

Full Analytics chapter suite: 372/372 checks at 390, 820, 1024 and 1440 pixels, including nested 340px panels, chart labels, keyboard chapter navigation, metric drilldowns, scroll restoration, source failures, camera verification and existing data explorers. All fixtures intercept production endpoints.
