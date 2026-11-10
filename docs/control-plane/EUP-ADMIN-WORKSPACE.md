# E=Up admin workspace (Control › System › E=Up)

Owner, 2026-11-09: "an admin only experience … the E=Up tab in the admin experience". The deeper E=Up product ships first as a workspace inside the existing Control shell, for the verified house owner only. This document is the presentation contract; it creates no permission, data or backend.

## Where it lives

- NAV leaf `#system:eup` ("E=Up") in `js/control-room/nav.js`, a `slot` mount point with `module: "eup"`. The destination panel of the shared bottom bar, the ⌘K palette and the owner registry all list it because they read NAV. The old-style hash `#products:eup` and the names "Products · E=Up", "Environmental Justice League", "Civic League", "Companies & Finance", "Sources & Review" resolve to it (`NAV.resolve` now checks an old route that names a surface NAV never had).
- Module `js/control-room/eup.js` registers `window.CR.eup = { render, bind, helpers }`; `control.html` loads it with `css/control-eup.css` after the product-readiness module. The shell passes `{ request, orgId }` to every slot module's `bind` (one-line change in `control-room-v2.js`).
- The five sections are LOCAL tabs inside the one destination (role=tablist, arrow/Home/End keys, focus kept on redraw). They are not six NAV tabs and no second global menu exists.
- One globe: `window.CR.analyticsGlobe.mount` on `[data-eup-globe]`, mounted once per bind (`data-eup-globe-mounts`), kept across tab switches; its selection drives Overview geography and the Civic breadcrumb (country › state › county/municipality › district/ward). Flights respect `prefers-reduced-motion`.

Not done here: a "Products" door row in the shared bar's product list (`js/site-navigation.js`) was outside this change's file set; the leaf already appears under System in that panel.

## Worker contract it reads (owner-only, `workers/mccluster/src/eup/router.js`)

`GET /v1/eup`, `/overview`, `/league/campaigns|applications|proofs`, `/civic/jurisdictions?parent=`, `/civic/offices|bills|elections?jurisdiction=`, `/civic/terms?office=`, `/companies/search?q=`, `/companies/:id`, `/sources`, `/sources/review`; `POST /sources/:id/refresh|pause` with `{ idempotency_key }`. Every answer is private/no-store.

## Honesty rules the module enforces

- 401 → "Signed out"; 403 → the whole workspace is concealed ("House owner access required"), data cleared, no further reads.
- 503 `not_implemented` / `not_configured` → said plainly per pane or per block; an answer without `ok:true` is never drawn as success; an empty list reads "returned 0 …; coverage may be absent, not zero"; a null count reads "unknown".
- Every request carries an AbortSignal and a 15 s deadline. A timed-out write is reported as "outcome unknown", disables only that connector's buttons, is never resent, and is followed by a read-back (audit A6).
- Every private read is stamped with the authority epoch; `mcc:auth-changed`, a session storage change, a restored page or an owner loss bumps the epoch, aborts in-flight requests and clears panes synchronously (audit A1).
- Provenance line on every record that carries it: source, record, observed, effective, upstream updated, fetched, parser, review state, coverage. Freshness chips are the contract's states (current, stale, partial, unavailable, corrected, held, empty, unknown); nothing is inferred.
- Companies shows a quote only when `quote.licensed === true` and a value is present.

## Tests

- `scripts/test/control-nav.test.mjs` (NAV still covers the old IA; the new slot; `#products:eup` resolution; palette search).
- `scripts/test/control-eup.test.mjs` (state machine over fixtures: owner, 401, 403, 503, timeout, account change, civic breadcrumb, companies, keyboard).
- `scripts/e2e/control-eup.e2e.mjs` (real `control.html` at 390 and 1440 with fixture routes: tabs switch without remounting the globe host, no horizontal overflow, keyboard, idempotency key on refresh, 403 denied state, account change, reduced motion).

This is a presentation layer over synthetic fixtures and the owner-gated Worker. It is not a data-population milestone, a public release or a deployment.
