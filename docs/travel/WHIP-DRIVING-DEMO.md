# Driving preview and proposed Whip beta

The Globe transport view currently presents driving and a clearly labeled cab demo. Existing public/owner World access remains unchanged: this does not open owner-only Travel to the public. The standalone rider entry uses the same demo. No real ride, fare quote, payment, dispatch, waitlist record or delivered invitation is created. The demo collects no personal information and makes no network/storage calls. Directions elsewhere in Travel still use the existing provider and privacy notice.

The proposed initial program is sponsored free rides for qualifying riders, with others on a waitlist. Paid fares and financial design are deferred. `WHIP_BETA_PLAN.maxDrivers` models a proposed maximum of 49, not active availability, admission enforcement or a regulatory exemption. There is no admission backend to enforce a cap yet. Funding, service areas, eligibility, insurance, licensing, safety and intake consent remain review gates. A public-benefit corporation is a proposal; this work asserts no formation.

## Preserved foundations and reconciliation

Based on main `98404db7`, including merged booking PR #517. `attachWhipBooking` now mounts the inert demo. The complete commercial implementation remains as `attachLiveWhipBooking`, with no caller in the shipping UI. Changing server flags alone cannot activate this demo. No Worker, launch readiness flag, payment gate, database or migration changes are included.

Flights, trains, walking, cycling, transit, rentals, journey normalization, route clients and saved journey data remain. The `DRIVING_PREVIEW` source gate hides future controls and blocks activation; it is not a URL/local-storage switch. Opening a saved non-driving journey explains that it is preserved for later instead of converting or overwriting it. The two historical World browser suites use an explicit test-server transform to keep exercising deferred foundations. The new browser proof exercises the default gate without that transform.

Older draft #453 was inspected, not merged. Its authenticated consent version/time, offline/unapproved applications, rejection of self-approval fields, idempotency and missing-migration failure are useful requirements for future intake. Its driver consent migration is not assumed applied, and its blanket launch wrapper must not supersede #517's stronger booking gates. No driver application or rider waitlist intake is added. Before implementation, reconcile consent with the current canonical Worker, secure a reviewed minimal intake, retention and access policy, and add transactional driver admission capped at 49. An application must never mean approval. Do not collect income evidence in this demo.

The active PR search included #453, the older #417 funnel proposal and #803 Finance World work. This branch does not incorporate those drafts or change public World access/navigation. Recheck overlaps before merge, especially `world-travel.mjs` and its browser fixtures.

The stale standalone rider markup no longer loads. Its old `app.js` remains preserved but is not an entry point; no fake cars, fares, ratings or localhost service is imported. The rider service worker retires only its own `whip-equipped-*` caches and stops caching account/API traffic. Offline rider loading is not promised.

## Verification and review

- Full Worker suite: 1,898 passed, 9 skipped, no failures. Includes launch, quote, payment and dispatch refusal tests.
- Root focused demo/SEO checks: 33 passed after fixing the rider canonical URL. Python: 7 passed.
- Full root suite rerun and exact-head CI results are recorded in the PR.
- `scripts/e2e/whip-driving-demo.e2e.mjs`: 390/1280px rider and actual World transport module, example selection, invitation disclosure, Escape/reopen/focus, overflow, no form inputs, no action network/storage effects. The World shell is isolated from feed/auth/Cesium for this proof; this is not a full globe rendering or authenticated production test.
- Local Chromium cannot start: sandbox socket creation is prohibited. The dedicated read-only CI workflow runs browser proof and uploads screenshots. A green source suite is not visual verification.

Review only. No merge, deployment, migration, legal formation, sponsor funding, waitlist activation or live trip occurred. Before release, review the screenshots and full integrated World behavior, reconcile concurrent changes, and obtain release direction. Before real service, design sponsored booking separately from the preserved commercial-payment implementation and complete the existing safety gates.
