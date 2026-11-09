# FYRE climate-action community resource: integration handoff

## Status and scope

An isolated, dependency-free admin-preview prototype. This is a supplemental feature slice, not a replacement for the current release work. No existing application files are changed. No authentication, API, migration, scheduled job, importer, payment, recording, publication or production configuration is added. An admin label is **not** access control: this standalone preview has none and must not hold private data or be deployed as an admin route.

Integration base: `mcclusterishere/mccluster`, `claude/new-session-83ken5` at `15523e187d1800dcbe7cd2c19f4ddfe6f203f556`, refreshed November 9, 2026. Supplemental branch: `codex/drawdown-fyre-community-20261109`. Only `prototypes/drawdown-fyre/` is added. No changes to the Claude branch, no merge, no deployment.

The underlying environmental source reviewed for the portable module was consumer pin `95a133b7c02cafad09d6366b0723c751f9824b31`. Before wiring this slice, reconcile those older module paths and behavior against the current integration head. Preserve current audit fixes and release coordination.

## Run and inspect

Open `index.html` directly in a modern browser. CSS and classic scripts work offline; external source links require internet. No build, package installation, API key or server is required. Browser policies may prevent localStorage on file URLs; an explicit session-only fallback appears. Notes remain unencrypted on that device and are unsuitable for sensitive material. They are not durable account-backed mission drafts.

Run from this directory:

```sh
npm test
node --check app.js
node --check model.js
node --check integration-contract.mjs
```

Dependencies: Node.js 18+ for built-in `node:test`; zero runtime/npm dependencies. The optional browser acceptance harness requires an already approved Playwright installation and permitted browser runtime; do not install or evade sandbox restrictions just to run it.

## Files

- `index.html`: semantic admin-preview shell, conceptual globe grid, research categories, source attribution and local draft dialog.
- `style.css`: mobile-first responsive original styling; no external fonts or assets.
- `model.js`: original learning cards and normalized local-only draft storage.
- `app.js`: filter, create/edit/remove, cancellation and storage-failure feedback. Uses textContent for notes, no network calls.
- `integration-contract.mjs`: proposed read-only host-context seam; not wired to the standalone preview. Tests cover denied role, interrupted authority/selection, and teardown. This is not server authorization.
- `test.cjs`: 16 unit/contract/static tests.
- `browser-acceptance.cjs`: unrun browser acceptance harness.
- `README.md`: this integration and verification handoff.

## Integrate without replacing the globe

1. Fetch the supplemental branch, inspect its diff against the exact base, and cherry-pick **only its added prototype commits** onto the designated integration branch. Do not merge an unrelated historical branch wholesale. If the current source moved, reconcile first. No generated files or package installs are necessary.
2. Keep the existing shared Control route inventory and bottom navigation. Add FYRE as a local section under Products → E=Up, using current server-verified house-owner authority. Do not expose a consumer destination, add global navigation, change the News feed default or enable private Halo layers.
3. Reuse the same `mnWorldFrame` and Cesium viewer. This prototype's CSS sphere is only a conceptual placeholder, not a new map, geography dataset or actual globe integration. Remove that placeholder at integration; never instantiate a second viewer.
4. Adapt the existing environmental panel (`vendor/equity-uprise/src/environment/panel.mjs`), host binding (`js/world-environment-mccluster.mjs`) and transport (`vendor/equity-uprise/src/environment/transport.mjs`), after checking current revisions. Keep `hu:environment-pins` and `hu:environment-focus` limited to observation behavior. Do not convert a global mitigation estimate into local event pins. Do not call nonexistent `/solutions` or `/fyre` APIs.
5. Bind `createFyreContext` to existing authority and geography-selection subscriptions. `readAuthority()` must obtain the current server-authorized principal and return `{principalId, capability:'house-owner'}` only when actually granted; all other roles return null. This client contract is a race guard, never a substitute for server checks. `readSelection()` returns a coarse, authorized `{contextId}`. Change listeners return unsubscribe functions. `clearPrivateState()` empties owner-only views and drafts immediately. Deny capability on unavailable/malformed authority; clear at sign-out, account switch, selection change and teardown.
6. Replace device-local planning notes with the **existing** authenticated canonical draft/mission workflow only after verifying its current contract, role checks, immutable source revision, idempotency, tenant isolation and uncertain-write receipts. Do not silently upload old local notes. New server fields or migrations require separate review; this slice supplies no SQL and requires no migration.
7. Treat these three cards as learning/planning prompts, not approved missions. Existing application, capacity, safety, proof-review and optional publication controls still govern participation. No completion, CO2 savings, money or points are awarded here. Do not displace the existing first song/source-explanation mission work.

## Research and rights

The cards are original writing, with links to Project Drawdown's current solution pages. Card ratings are unassigned. Project Drawdown assessment categories (Highly Recommended, Worthwhile, Keep Watching, Not Recommended) are not a numeric leaderboard and do not rate our original missions.

The only research value reproduced is a bounded CC BY 4.0 sample: **650 t CO2-eq (100-year basis) per MW of installed capacity per year**, a global effectiveness estimate, not local avoided emissions. Source: Michael Dioha and Megan Matthews, *Deploy Distributed Solar PV – Solution Assessment Spreadsheet*, July 7, 2026, https://doi.org/10.5281/zenodo.21246308, cached `results!B20`; file MD5 `83b117d5ea93a29dd06871bf7905d6a8`. License: https://creativecommons.org/licenses/by/4.0/. Changes: one scalar extracted and original explanatory context added. No workbook is distributed and no formulas were recalculated. Cost cells with `#REF!` are excluded, not converted to zero. License/record checked November 9, 2026. These values are source-version-specific, not a continuously refreshed feed.

The methodology v5 record https://doi.org/10.5281/zenodo.20865531 is separately identified as CC BY 4.0. Those file licenses do not grant blanket rights to website photos, logos, maps, database content or branding. No website assets, copied prose, importer or endorsement claim is included. Website terms and intended additional uses require separate review: https://drawdown.org/terms-of-use and https://drawdown.org/about/faqs.

## Verification record and release gates

Passed locally: 16 unit/contract/static tests and JavaScript syntax checks. This demonstrates normalization, duplicate-save handling, storage failure/roundtrip, role rejection, stale read rejection, teardown and static UI guardrails only.

**Not run:** real browser rendering, keyboard/dialog behavior, 390px/1440px overflow measurement, visual screenshots, actual Cesium retention, server integration, full repository/Worker suites and production verification. A prior browser socket denial recorded in the environmental source was not retried. The unrun browser harness is provided for an approved environment; static checks are not a visual pass.

Before enabling any live route: verify owner/guest/member/other-tenant direct access at API/RPC/cache/storage boundaries, same viewer identity across transitions, private-state clearing, interrupted/repeated dialog flows, native keyboard focus, storage failure, reload, phone overflow and desktop layouts. Run final-head canonical root/Worker and relevant environmental suites. Independently verify current source versions, permissions and local suitability. Source code publication alone does not authorize merge, migration, production hosting or public activation.

Rollback for this isolated slice: remove its unintegrated directory. Once integrated, use the existing capability/release gate to disable the section; do not delete canonical assignments or evidence.
