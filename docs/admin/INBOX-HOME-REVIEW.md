# Inbox, Home and System review slice

Source baseline: main `4fc32c84970d1a5cbc69c2df218e700bcea14032`, plus open Games PR #726 at `2f46f6116e24ab07b4e5d2b9f7c255b5837c8d9b`. This branch is stacked on #726, not a replacement for it. No publication, deployment, production write or account change is part of this slice.

## Implemented

- The server-verified owner's bar is Play, Inbox, Home, supplied M, Analytics, World/Halo, Games. Inbox is immediately before Home; Games immediately follows the existing owner globe and opens #726's `action-globe.html?explore=1&games=1`. Public/member navigation and the existing Missions gates are unchanged.
- Home retains the established single-tap destination picker and double-tap Today action, with keyboard access. Inbox and Analytics preserve the current organization and switch hashes inside the same document. The duplicate section rail disappears only after the shared navigator is ready; it remains the loading-failure fallback.
- People is presented as Inbox. Three local categories expose Messages; People (Contacts, Companies, Clients); Follow-through (Deals, Outreach). Client projects, deliverables, relationships, pipeline and tasks retain their original child routes and handlers. Every old `#people:*` and `#work:*` route survives; `#inbox` and `#inbox:*` also resolve. No records or renderers were removed.
- AI reply keeps the thread switch and existing owner-controlled backend operations. A concise explanation maps Knowledge, Models & spend, Delivery log, Channels, and Tools & approvals to their actual functions. Model selection and trigger editing are explicitly unavailable in this editor; no synthetic controls or automatic enabling were added. The existing settings buttons retain their real consequences when an authorized owner uses them.
- Analytics is a first-class bottom destination, not a Home section card. Its chapters, charts, metrics and retained globe remain intact and searchable. Next visual iteration: use its existing Overview to lead with three groups (Audience, Content, Business), each with the same scoped time window, freshness/error state and drilldown. Do not aggregate incompatible windows or replace underlying metrics with a score.
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

Validation on this slice: 104/104 focused source tests; 291/291 shared navigation/browser checks; 214/214 Control navigation checks; 78/78 AI-settings browser checks. Browser widths were 390, 820 and 1280 pixels. The shared suite exercises repeated same-document Inbox navigation, category visibility, current-tab state, touch target sizes, grouped System evidence, source fallback, keyboard focus, browser Back, all route inventory entries, owner revocation, sign-out races, guest/member navigation and embedded opt-outs. No full-platform or production acceptance is claimed.

## Integration boundaries and remaining work

Owner self-service editor work is separate and not in this checkout. Its private-draft/publish/history/restore validation does not establish production readiness. This slice does not touch its backend, migrations, revision contracts or front-page editor. Shared integration points to reconcile deliberately are `control.html`, `js/control-room-v2.js`, the NAV registry and shared bar styles/scripts. Rebase/cherry-pick only after inspecting that task's exact source version; do not overwrite those files wholesale. #681 remains an independent open editor/onboarding PR. No cross-session coordination channel was available from this executor; this document is the handoff contract.

The larger mini-app redesign is not complete: other Sell/Create/System editors retain their current local layouts. The proposed Analytics summary grouping is not implemented. Trigger/model controls need an owner-scoped backend contract before implementation. Historical last-success and user-impact data are not supplied by the current service snapshot; unknown is displayed. Trace grouping is not root-cause analysis. Physical-device and authenticated production acceptance remain outstanding. The separate incident investigation owns diagnosis and repairs; this UI performs none.
