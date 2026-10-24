# Analytics tab audit — 24 October 2026

Scope: every Analytics chapter, its principal controls, phone (390 px), tablet (820 px), desktop (1280 px), and the existing embedded workspace variants. Baseline: main `39f6e8d0967793ab5ec522db1a5c971bfbe212ca`.

## Findings and repairs

- The shared profile chip covered the final chapter tabs on desktop. A live Setup click opened Profile instead. The chapter rail now reserves the chip's space; the duplicate account button is removed only where shared navigation supplies it.
- The general page editor floated over charts and actions. It is suppressed inside the Analytics operational surface; the editor on public pages is unchanged.
- The deck disabled the existing responsive container, leaving legacy cards in narrow layouts on large screens. Restored the container and harmonized metrics, table/body text, controls and spacing.
- Setup reused the header's `cra-live` class, turning its activity list into a squeezed inline row. Its activity feed now has an explicit full-width grid layout.
- Event disclosures inherited a three-column dataset-button grid. Details now expand across the row, with readable metadata and native disclosure semantics.
- Journeys stopped at 60 accounts and 20 songs; event names stopped at 150. Added incremental account/event disclosure, kept all returned songs available, and tested the last returned row. Backend result limits and measurement semantics are unchanged.
- Dataset, event, field and source searches required leaving the field. They now update on input while retaining field focus.
- Data status said it inspected connections but opened Datasets. It now opens Connections directly.
- Wide tables and hourly charts now advertise sideways scrolling and are keyboard reachable. Hourly axis text no longer collides; small-count charts use unique, correctly positioned integer ticks.
- Connected operations used an unstyled native select. It now shares the other Analytics form styles.
- Instagram's guidance claimed Channels could renew authorization, although that page has no reconnect control. Guidance now identifies the existing server integration and describes the Channels link accurately.
- World intelligence’s archive read only entities, hiding ingested earthquake events and observations. The owner-only, house-scoped archive now merges bounded samples from all three record kinds and fails visibly if any read fails. A live pre-fix check showed zero records alongside successful earthquake ingestion runs. A read-only production query confirmed 50 earthquake events in the bounded sample and zero entities; the new query’s selected columns were verified against production.
- Concurrent News context and Connected operations requests invalidated each other’s owner verification, silently dropping a result. Verification now shares only an in-flight request for the same session and authorization epoch; completed grants are not cached by this change. Regression checks keep both results and retain sign-out/failure protections.
- Site health displayed historically misdecoded location labels such as `Nuevo LeÃ\u0083Â³n`. Valid UTF-8 byte sequences are now repaired for display in session and visitor locations; original measurements, valid non-Latin names and HTML escaping are preserved. Ten Forensics tests cover this and existing interactions.
- Camera failures discarded their cause. The owner API now distinguishes absent configuration, invalid address, rejected authorization, timeout and upstream failure without revealing credentials or upstream response bodies.
- The final deployed 30-day Site health check exposed an intermittent session-query timeout. Three API reads failed at about 8.2–8.8 seconds; the database role reproduced SQLSTATE 57014. An analyzed plan took 9.17 seconds, dominated by identity and unsessioned-event scans. Two narrow partial indexes cover those reads without changing queries, data, permissions or the eight-second deadline. A rolled-back experiment took 1.69 seconds; after applying the migration, Sessions took 3.30 seconds and Visitors 0.92 seconds as `service_role`. The live session list then recovered.

## All-tab matrix

| Tab | Appearance and interaction checks | Live observation / limitation |
| --- | --- | --- |
| Overview | Six metric shortcuts; chapter arrows; keyboard Home/End; chart; bounded scrolling | Live metrics and updated status rendered |
| Audience | Metric layout; country/state selection; exact chart values; page cards | Live selected-window audience, stages, acquisition and paths rendered |
| Journeys | Source/track filtering and reset; all returned songs; 65 synthetic accounts reached in pages | Live attribution and accounts rendered; no identifying production records included in this report |
| Content | Track selection updates readout; track list; scrollable ledger | Live track activity, media mix and detail rendered |
| Action & business | Participation, sales and community cards; workspace links; dataset shortcut | Live cards rendered; verified sales remain distinct from client reports |
| World intelligence | Source selection/search; permission states; snapshot failure; record browsing/comparison regression suites | 32 sources listed; World Bank indicators, news comparisons, connected record browsing and Site health subviews returned live data; earthquake collection enabled with successful recorded run. Source configuration is not proof of a live feed |
| Cameras | Catalog loading, visible failure, retry, provider selection, image decoding and verification | Deployed diagnostic confirms the Halo connection is not configured. Cloudflare Worker-read scope blocks inspecting the existing service settings; camera coverage is not restored |
| Adaptive | Responsive metrics; policies, experiment empty state and ledger | Live decision totals, production policy, research record and ledger rendered |
| Site health | Sessions, Visitors, Flows, Errors; search/filter/sort controls; nested module mounting | Live session counts and detail rows rendered. Subviews are independently requested |
| Data explorer | Datasets/Events/Connections/Fields; all event pages; instant search; disclosure layout; empty/missing states | Previous repair measured all 24 datasets. Instagram still requires renewed Meta authorization (stored error 190) |
| Setup | Installation pulse, checklist, activity layout, property form validity | Live receiving-data status confirmed. No production property created for this audit |

## Verification

The new `scripts/e2e/analytics-tabs.e2e.mjs` runs the actual Control renderer with synthetic responses, exercises all 11 tabs at three widths, measures document and panel overflow, checks that selected tabs are not covered, and captures chapter tops, ends and interaction results. It runs in the existing Control workspace visual workflow; screenshots and machine-readable checks are retained in that workflow's artifact. These images contain synthetic fixtures, not production telemetry.

Local validation before the PR: 201 all-tab browser assertions, 44 Analytics UI unit tests, 197 Worker Analytics/spatial tests; existing unified browser regression across five viewport/workspace combinations; connected-operations concurrency and shared-navigation authorization regressions; repository source classification 1,634/1,634; control-plane migration ledger contract (346 migrations) and whitespace checks. Final CI and deployment receipts belong to the PR, not to an assumed production result.

The task did not create provider accounts, grant access, publish content, create production test records, or alter payment/identity measurement definitions. Missing credentials and provider authorization cannot be repaired by styling or invented zero values.

## Live deployment verification

PR #605 deployed backend commit `c8daa8e2335a9de6400ad2df3d783f9c5d7e3363` and matching frontend assets. The live 24-hour and 30-day windows reached 23/23 ready reads. All 228 event names and all 62 returned 30-day accounts were reachable. The USGS archive returned its bounded 50-record sample instead of zero. Setup reported receiving data. The subsequent location-label correction is covered by the Forensics regression suite; its release receipt is recorded in the follow-up PR.

PR #606 deployed frontend `e6fee2ab8def00d6511cb95cf1cd76c0cb608ad1`; all six PR checks passed, including 75 UI unit tests, 94 Worker tests and the full Analytics browser suite. Production now renders Nuevo León correctly. Concurrent connected-record and news requests also completed together in the deployed browser: 27 records / 30 relationships and 12 stories / 14 annual indicators.

The subsequent database-only fix is applied as `20261024014226_analytics_forensics_read_indexes_v7`. Its exact SQL matches the production migration record. The 347-entry production ledger hash is `0ebf03faa940fe98390f5670ce294c879449e12c6b44167783947e9bbdb6776b`. Final 30-day Sessions returned 1,684 sessions / 1,021 devices; counts move as the rolling window advances. Cameras and Instagram retain the explicit integration limitations above.
