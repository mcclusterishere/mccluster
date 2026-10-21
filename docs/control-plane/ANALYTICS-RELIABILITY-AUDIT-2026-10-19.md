# Analytics reliability and event coverage audit — 2026-10-19

Scope: `mccluster.org` first-party collection, the `api.mccluster.org` owner analytics backend, the Control Analytics client, and the production Supabase project. This is a point-in-time **read-only production investigation**, plus an application-side resilience patch; this document is not a deployment attestation.

## 1. End-to-end source contract

| Layer | Source and check | Observed result |
| --- | --- | --- |
| Browser | `js/analytics.js`, privacy-gated `MCC_TRACK` batch sender | Primary `/v1/collect` with Supabase Edge Function fallback; no durable failed-batch outbox or idempotency contract. |
| Edge collector | `supabase/functions/collect/index.ts` | Deployed production function `collect` version 10 exactly matched main's file contents at audit time. Consent/opt-out behavior is implemented. |
| Raw store | `public.events` | 121,651 events, 1,741 within 24 hours and 13,167 within seven days (snapshot). |
| Query projection | `public.events_lean` | Same 121,651/1,741/13,167 counts and latest timestamp. No missing event IDs in either direction, and no mismatches among joined `name`, `at`, `site_id`. |
| Dashboard | `js/control-room/analytics.js` | 23 initial read tasks, previously at four-in-flight, including SQL RPCs, `/v1/analytics/business`, identities, geo and forensics. A single failed read flags “Partial data.” |
| Business summary | `workers/mccluster/src/analytics/router.js` | 37 separate measured queries with per-source read errors. `snapshot.partial` is true when any fails. |
| Geographic SQL | `analytics_country_totals`, `analytics_region_totals`, `intel_geo_projection` | Functions exist now in production; the October 17 missing-function incident was addressed by merged PR #478. |
| Registered tenant properties | `analytics_sites` and `analytics_site_domains` | 0 registered properties, 0 verified domains, 0 tenant-scoped events. This is not a broken first-party collector: all first-party events intentionally use null `site_id`. |

### Failed reads are an observed reliability defect

Supabase PostgreSQL logs for the checked 24-hour period contained **97 query cancellations (SQLSTATE 57014)**; 91 were PostgREST-related and six were auth-related. Their canceled query groups included:

- **15 `public.events` INSERT operations** — actual potential loss at the collector/database boundary, despite consistent counts for accepted writes;
- analytics SQL functions (`analytics_totals`, `analytics_top`, `analytics_page_performance`, `analytics_daily`, `analytics_acquisition`, `analytics_country_totals`, and `analytics_visitor_list`);
- `events_lean` read/count queries, `play_counts`, `v_track_affinity`, and `v_track_signals`, showing system-wide database work competes for resources.

Corresponding Supabase edge logs contained HTTP **500** responses for the analytics RPCs, with failed request durations commonly in the **8–13 second** range. Production `authenticated`/authenticator roles are configured with an **8-second statement timeout**. An isolated diagnostic execution of `analytics_totals` for a 24-hour range took approximately 3.37 seconds; concurrent dashboard queries can exceed this limit.

**Important:** a one-to-one raw/projection check confirms *accepted* events are projected faithfully. It **does not** prove browser-to-database delivery is lossless: failed INSERTs must be fixed and collector delivery needs an idempotent retry contract.

## 2. Coverage gaps distinct from the Partial data warning

- **Event taxonomy:** 218 distinct event names were observed; **126 names lacked a taxonomy row**, totaling **3,497 stored events**. The taxonomy table held 116 configured names, including inactive names. Unmapped event records are stored, but specialized funnel classification uses a fallback `engage` stage, potentially distorting interpretation. Examples of unmapped names include `form_start`, `form_submit`, `account_created`, `music_play`, `music_full_play`, `music_complete`, `mnet_view`, and `world_focus`. Registration counts must continue to use verified auth records, not self-reported client `account_created`.
- **Publishing:** two Instagram account configurations exist; one was disconnected and the other showed `media_discovery_error=meta_error_190` (provider authorization failure). `social_posts` and `social_metric_snapshots` held zero rows; neither impressions nor reach can be inferred or fabricated from account registration alone.
- **World intelligence:** `seek_first_events` contained 126 records, `intel_evidence` 161, and `media_news_articles` 22,154. The enabled USGS connector had 170 recorded ingestion runs, with two failed/partial runs and a successful sync as of the snapshot. This subsystem is partially operational and must distinguish observed incidents from the headline catalog.
- **Network interaction telemetry:** `network_telemetry_events` contained zero rows. This is a separate data plane from site `MCC_TRACK`; it should not be shown as measured community engagement without accepted telemetry events.
- **Geolocation and privacy:** 81,373 historical raw records had no country, but recent collection had much higher country coverage (1,613 of 1,661 events on October 19 UTC at the snapshot). 2,649 raw events carried the opt-out flag. Historical unknowns must not be assigned invented countries, and privacy opt-outs must remain unlinked.

## 3. Remediation implemented on this branch

1. Apply the existing one-shot SQLSTATE `57014` retry to **all read-only analytics RPCs**, not only the hourly chart. Preserve the single retry limit and keep mutation endpoints untouched.
2. Bound the dashboard's initial parallel read fan-out from four to two and owner business measurement fan-out from four to three, protecting shared database capacity for event inserts.
3. Report the exact failed `read_errors` keys from a partial owner business snapshot, rather than a generic, untraceable warning.
4. Add regression tests for load-bounded fan-out, one-shot success, persistent failure visibility, and explicit business-source error reporting.

No production SQL, RLS policies, event history, collector code, source credentials, or user-visible release settings are changed here. A green PR alone does not prove the live failures stopped; deployment and post-release request-log verification are required.

## 4. Required follow-up work (not represented as completed)

**P0 — lossless first-party ingestion:** trace PostgREST insert cancellations, CPU/query contention, collector request handling, and fallback delivery. Evaluate a client-generated event/batch idempotency key with a bounded durable retry mechanism that honors consent/GPC/DNT. Prove no duplicate or missing accepted records across failover; monitor error counts after deployment.

**P0 — SQL performance:** profile the 7-day/30-day/all-time authenticated query paths using `pg_stat_statements` and `EXPLAIN (ANALYZE, BUFFERS)` in a safe test environment. Optimize/partition/materialize only where backed by query plans, and preserve RLS and first-party `site_id IS NULL` semantics. Do not raise the authenticated statement timeout to disguise inefficient scans. Apply schema changes only through the canonical migration ledger and verified CI.

**P1 — event contract completeness:** create an owner-only event inventory that shows each observed event name, volume, last seen, classification, and reporting destination. Review all 126 unmapped names before classification; explicitly separate true conversion, engagement, ops, media playback, and unknown categories. Avoid changing historical auth-derived registration counts.

**P1 — external sources:** reauthorize the affected Instagram account via the authorized Meta integration; then verify actual snapshot rows. Independently validate intelligence connector schedules and error ratios. Zero rows should display “not connected / not collected,” not “zero reach.”

**P2 — tenant product analytics:** decide whether any external sites should be registered/verified as separate analytics properties. Zero tenant data is expected until such a property is installed, verified and has consented traffic.

## 5. Reproduction / acceptance checklist

- On an owner-authenticated device, refresh Control Analytics at 24h, 7d and 30d, capture failed individual keys, and compare `analytics_totals`/hourly/daily RPC output to SQL for the same exact timestamps.
- Observe both raw `events` inserts and derived `events_lean` IDs while exercising pageviews, forms, music events, actions and signed-in flows under permitted consent.
- Confirm `PostgREST 500`/`57014` counts fall for a comparable period following release, and `Partial data` flags only genuinely failed sources.
- Ensure the dashboard never hides a persistent failed query, never presents unconnected third-party integrations as measured analytics, and preserves strict owner authorization plus privacy controls.

References: `docs/control-plane/ANALYTICS-DATA-REPAIR-2026-10-17.md`, `ANALYTICS-PIPELINE-REPAIR-2026-10-17.md`, `ANALYTICS-PRESENTATION-AUDIT-2026-10-17.md`, and the live production query/RPC inventory sampled October 19.
