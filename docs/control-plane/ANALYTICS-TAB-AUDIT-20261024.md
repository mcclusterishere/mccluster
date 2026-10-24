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
- Wide tables and hourly charts now advertise sideways scrolling and are keyboard reachable. Hourly axis text no longer collides.
- Connected operations used an unstyled native select. It now shares the other Analytics form styles.
- Instagram's guidance claimed Channels could renew authorization, although that page has no reconnect control. Guidance now identifies the existing server integration and describes the Channels link accurately.
- Camera failures discarded their cause. The owner API now distinguishes absent configuration, invalid address, rejected authorization, timeout and upstream failure without revealing credentials or upstream response bodies.

## All-tab matrix

| Tab | Appearance and interaction checks | Live observation / limitation |
| --- | --- | --- |
| Overview | Six metric shortcuts; chapter arrows; keyboard Home/End; chart; bounded scrolling | Live metrics and updated status rendered |
| Audience | Metric layout; country/state selection; exact chart values; page cards | Live selected-window audience, stages, acquisition and paths rendered |
| Journeys | Source/track filtering and reset; all returned songs; 65 synthetic accounts reached in pages | Live attribution and accounts rendered; no identifying production records included in this report |
| Content | Track selection updates readout; track list; scrollable ledger | Live track activity, media mix and detail rendered |
| Action & business | Participation, sales and community cards; workspace links; dataset shortcut | Live cards rendered; verified sales remain distinct from client reports |
| World intelligence | Source selection/search; permission states; snapshot failure; record browsing/comparison regression suites | 32 sources listed; earthquake collection enabled with successful recorded run. Source configuration is not proof of a live feed |
| Cameras | Catalog loading, visible failure, retry, provider selection, image decoding and verification | Live catalog failed twice. Connection inspection blocked by Cloudflare Worker-read scope; do not claim camera coverage restored |
| Adaptive | Responsive metrics; policies, experiment empty state and ledger | Live decision totals, production policy, research record and ledger rendered |
| Site health | Sessions, Visitors, Flows, Errors; search/filter/sort controls; nested module mounting | Live session counts and detail rows rendered. Subviews are independently requested |
| Data explorer | Datasets/Events/Connections/Fields; all event pages; instant search; disclosure layout; empty/missing states | Previous repair measured all 24 datasets. Instagram still requires renewed Meta authorization (stored error 190) |
| Setup | Installation pulse, checklist, activity layout, property form validity | Live receiving-data status confirmed. No production property created for this audit |

## Verification

The new `scripts/e2e/analytics-tabs.e2e.mjs` runs the actual Control renderer with synthetic responses, exercises all 11 tabs at three widths, measures document and panel overflow, checks that selected tabs are not covered, and captures chapter tops, ends and interaction results. It runs in the existing Control workspace visual workflow; screenshots and machine-readable checks are retained in that workflow's artifact. These images contain synthetic fixtures, not production telemetry.

Local validation before the PR: 183 all-tab browser assertions, 44 Analytics UI unit tests, 89 Worker Analytics tests; existing unified browser regression across five viewport/workspace combinations; repository source classification 1,634/1,634; control-plane migration ledger contract (346 migrations) and whitespace checks. Final CI and deployment receipts belong to the PR, not to an assumed production result.

The task did not create provider accounts, grant access, publish content, create production test records, or alter payment/identity measurement definitions. Missing credentials and provider authorization cannot be repaired by styling or invented zero values.
