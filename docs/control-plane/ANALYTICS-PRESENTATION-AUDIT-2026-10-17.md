# Analytics presentation and connection audit — 2026-10-17

This pass follows the production data repair in PR #478. It improves the existing Analytics product without changing collection, authorization, database schema, or provider ingestion.

## Presentation and source map

| View | Data source | Scope and presentation |
| --- | --- | --- |
| Overview | Traffic totals/series, business snapshot, mission stats, funnel, site errors | Six linked first-party metrics; four property metrics for external sites. Mission assignment counts are all time; traffic and business use the selected window. |
| Audience | Hourly/daily, page performance, acquisition, paths, visitors, flows, audience science | Reach and return visits first; page performance directly reachable; detailed listening methodology expandable. |
| Journeys | `/v1/analytics/identity`, conversion funnel | First-party account journeys; loading, failed reads and successful empty results have different states. |
| Content | Content and content-event RPCs, business snapshot | Track engagement and music totals. Business response values are under `snapshot`. |
| Action & business | Business commerce and community snapshot, mission stats, coverage | Verified commerce uses available live sales, net of refunds; community activity is surfaced; mission status counts are explicitly all time. |
| World intelligence | Owner evidence projection, source catalog/readiness, archive and explicit provider snapshots, World Bank indicators | Owner evidence can include unreviewed records. Configuration is not a measured feed. Annual context is separate from audience metrics. |
| Cameras | Camera catalog and explicit image checks | Catalog count and successfully decoded image count remain separate. Verification is on request. |
| Adaptive | `/v1/analytics/experience` | Decisions and experiments; pending responses do not imply zero activity. |
| Site health | `/v1/analytics/errors` | Errors, friction and interrupted journeys in the selected window. |
| Data coverage | Completed/error state for each applicable initial read, coverage endpoint, schema metadata | Connection status, stored counts, data-family destinations and searchable fields. A successful empty read is ready; it does not imply populated data. |
| Setup | Analytics sites and domain records | Property collection and verification controls. |

Country selection narrows the geographic trend and signup journey list. Other cards remain worldwide unless explicitly labeled. The interface now states that scope rather than suggesting the country filter changes every metric.

## Corrections

- Fixed legacy account, music and community cards reading outside the business response's `snapshot` envelope.
- Added direct navigation from overview metrics and surfaced music, mission reviews and community activity.
- Added source-by-source initial connection status and a visible failed-read summary.
- Distinguished waiting, failed and genuinely empty journey/adaptive reads.
- Kept external-property overviews free of unrelated first-party account, commerce and mission metrics.
- Added accessible exact-value chart points, larger primary touch controls, clearer notes and a quieter rose chart accent.
- Preserved the anchored black globe, swipe/keyboard chapter navigation, shared bottom bar, profile access and nested metric carousels.
- Refreshed the application schema directory from live public-schema metadata: 465 tables/views, including the ten intelligence relations. This is field discoverability, not a claim that every stored column is an aggregated dashboard metric. No row values or private authentication metadata are included.

## Validation and limits

837 root tests passed. The browser regression passed at 390×844, 820×1180, 1280×1000, and workspace variants at 390×844 and 1180×820. It verifies bounded layout, swipe and keyboard navigation, linked overview metrics, chart focus targets, connection status, camera decoding, provider failure states, field search, retained globe and absence of automatic ingestion/runtime errors.

Phone, tablet and desktop screenshots were inspected. Browser checks use deterministic API fixtures; they are not a signed-in production data audit. The schema directory was checked against live metadata. Prior production RPC/schema verification is recorded in `ANALYTICS-DATA-REPAIR-2026-10-17.md`.

The request-status list covers initial dashboard reads; on-demand state/country drilldowns, camera checks and provider queries retain their own local statuses. A successful business response can contain an unavailable commerce sub-result, shown as a dash rather than invented revenue. Unpopulated intelligence archives remain empty until authorized data is actually written.


## Deeper data coverage repair — October 17 follow-up

Production reads distinguish real ingestion gaps from display failures:

| Check | Observed result |
| --- | --- |
| Raw and lean analytics events | 117,665 rows each at the audit; a separate anti-join found no missing lean event IDs |
| News collection | 4,237 headlines; latest import October 17 at 05:05 UTC |
| House ingestion | 36 stored records, latest October 2; four registered connectors; no recorded runs |
| House intelligence evidence | Zero records |
| House social metric snapshots | Zero records |
| Spatial archive | `seek_first_sources`, entities and ingestion-run relations absent |

Counts are point-in-time audit evidence, not values hardcoded into the interface.
The governed spatial replay migrations have not been applied by this change.
An absent schema, disabled collector, empty archive and failed query require
different remedies; no provider is automatically enabled or copied into storage.

### Repaired connections and representation

- The field directory fetched `docs/analytics/application-schema-inventory.json`,
  but deployment strips `docs`. Its shipping copy now lives under `data/analytics`.
  Directory retries are available after transient failures.
- Business measurements previously used one all-or-nothing `Promise.all` over
  37 database reads. Reads now have bounded concurrency and independent failure
  results. Unknown music components remain unknown when combined. Partial results
  are marked visibly rather than blanking working measurements.
- Business event counts now use the same first-party and non-bot boundary as the
  audience data. Other customer properties and bot traffic are excluded.
- Data explorer measures 21 explicit datasets with total count, selected-window
  count, latest activity, time field, family, scope and destination. It never adds
  different record types into a misleading total. Range-read failures retain a
  successful total count. Quiet activity is a prompt to inspect collection, not
  a claim that a provider has failed.
- Dataset measurement runs on demand, with three concurrent table reads, rather
  than scanning every table on each Analytics open. The existing owner gate and
  house organization filters remain authoritative.
- Datasets, Connections and Field directory are separate local tools. Family,
  status and text filters narrow the explorer; selecting a row reveals its detail.
- World intelligence now exposes the existing USGS collector health endpoint:
  enabled/off, schema readiness, latest attempt and last successful run. A provider
  snapshot remains distinct from stored history.

No database migration, background collector activation, credential change or
provider persistence change is part of this repair. Spatial provisioning,
collector operation and missing external social measurements remain explicitly
visible follow-up work, rather than being presented as connected data.

### Follow-up validation

- 890 root and Worker analytics tests passed before final review; the 24 focused
  tests passed after tightening range-error handling and the on-demand workspace link.
- Browser regression passed all five phone, tablet, desktop and workspace viewports,
  including dataset filters/details, field-directory loading, preserved globe,
  no overflow and no automatic ingestion. Screenshots use deterministic fixtures.
- Live schema metadata confirms each provisioned dataset's time and organization
  columns; only the already-identified spatial relations are absent.
- Program coverage gate: 466 passed, zero failed.
