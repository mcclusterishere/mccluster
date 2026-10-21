# W04 measurement corrections — implementation evidence

Base: `e9d8604988496783fa25f4c450bd49fec69ba476`, inspected 20 October 2026.
This is implemented and locally tested source, not a production deployment.

## What changed

- Audience Science v2 distinguishes checkout intent, browser-reported completion and unmeasured verified outcomes. `conversion_events` is `null`, never a fabricated zero or verified payment/account count. Shared devices associated with several accounts are left at device scope rather than assigned to the last account seen. The 12-track profile display cap no longer removes long-tail tracks from affinity totals; the cap is reported.
- Audience, identity attribution and Adaptive responses carry a versioned measurement context: exact half-open UTC window, site/geography scope, metric/dictionary version, units, identity basis, per-read caps, completeness and unknown watermark/freshness. Live offset pagination is explicitly not a frozen evaluation snapshot. A cap reached is incomplete even when the actual row count might equal the cap.
- Identity attribution exposes capped bridge/behavior reads. The previous signup percentage combined seven-day lookback accounts with current-window device listeners; it is now unavailable until an ordered matching cohort exists. Missing listener data stays unknown. Mean delay excludes accounts without a timing observation.
- Adaptive counts exclude events referencing decisions outside the selected cohort. Percentage numerators belong to their denominator populations, empty denominators are unknown, duplicate events do not duplicate decisions, and the same-window/right-censored/client-reported outcome limitations are explicit.
- `GET /v1/analytics/measurement-contract` uses the existing house-owner gate. The dictionary includes all 116 names in the retrieved live taxonomy, literal browser emissions found at the base source and all Audience accepted names: **229 event definitions**, **34 named metric families**, and all **24 coverage datasets**. Every entry has producer, unit, identity, numerator/denominator, permitted dimensions, deduplication, time, lateness, retention, privacy, owner and destination fields. Unconfirmed producer semantics, domain deduplication, retention enforcement and accountable reviewer assignment remain explicitly unverified/unassigned. This inventory is not a claim that dynamic emitter names are exhaustively discoverable or deployed.
- Coverage now returns unit, responsible technical area and a health contract per dataset. Stored rows, provider availability and adjudicated data quality are separate; dataset counts are never summed into a total of independent observations.

## Database and route delta

The CLI-created migration `supabase/pending/20261020193436_analytics_measurement_semantics_v1.sql` is **pending only**. It adds no tables and rewrites no historical event bytes.

| Object | Change |
| --- | --- |
| `v_events_staged` | Unknown taxonomy becomes `unclassified` instead of engagement; preserves security-invoker behavior |
| `analytics_signups_window` | Account/confirmation daily buckets use UTC, independent of connection timezone; existing narrow auth helper and grants retained |
| `analytics_funnel` | Existing output shape retained; first-party/nonbot filters, UTC days, unknown events excluded from engagement |
| `analytics_geo_audience` | Unknown stage remains visible as `unclassified`; geographic and suppression behavior retained |
| `analytics_stage_totals` | New admin-gated/security-invoker RPC: whole-window distinct devices per independent stage; authoritative auth counts separate; tenant results never inherit all-site account totals |
| `event_taxonomy` | Explicit checkout-intent mappings and client account-report annotation for four events |
| Worker | New owner-only read route `/v1/analytics/measurement-contract`; additive measurement metadata on existing routes |

No release gates, `HereTenantAgent`, identity permissions, global navigation or CSS are changed by this package. The UI package consumes the whole-window RPC when available and handles its pre-migration absence.

## Metric compatibility and interpretation

| Existing field | Actual meaning / treatment |
| --- | --- |
| `analytics_funnel.arrived` and other behavioral columns | Distinct observed device IDs per UTC day; summing days produces **device-days**, not distinct people |
| `analytics_funnel.paid` | Legacy **client purchase-stage device-days**, not verified payments or revenue; preserved only for compatibility |
| `analytics_acquisition.conversions` | Existing count of lead/checkout/purchase-stage client events, not verified conversion; UI labels this intent/report activity |
| `analytics_stage_totals.stages[].value` | Distinct device IDs over the complete selected window for that stage; stages are independent and do not imply ordered conversion |
| `analytics_stage_totals.accounts` | `auth.users` accounts created / email-confirmed within exact window; available only for first-party scope |
| `audience.conversion_events` | `null`: not measured from client telemetry |
| `audience.completion_rate` | Existing bounded ratio of completion/start event counts, **not matched playback instances**; dictionary records this limitation |
| `identity.signup_rate_pct` | `null`: incompatible numerator/denominator populations removed |
| `experience.*_rate_pct` | Observed event co-occurrence per decision with intersected populations, not ordered or causal conversion |
| Commerce payment / refund fields | Existing canonical commerce summary; this package does not repair its unknown legacy refund/mode/currency limitations |

The taxonomy correction changes historical projections on read. Unknown events stop inflating engagement; first-party daily stages stop including tenant and bot rows. `v_event_taxonomy_unmapped` remains the existing name/count inspection surface. Exact production count differences were not executed or invented; review a bounded comparison before promotion.

## Verification

`node --test test/analytics-*.test.mjs test/audience-science.test.mjs` from `workers/mccluster` passed **69/69** after the changes. This includes the eight new measurement contracts/behavior cases, existing ownership gates, attribution, self-service, privacy/session races and user integration. Root runs the final integrated suites.

The independent SQL fixture runs in isolated PGlite 0.5.10:

```bash
PGLITE_MODULE_PATH=/path/to/@electric-sql/pglite/dist/index.js node scripts/test-analytics-measurement-db.mjs
```

It passed whole-window repeat-device deduplication; the 23-hour spring-DST reporting interval; before-start/at-start/at-end boundaries; tenant/bot isolation; unknown taxonomy on map and daily/whole-window stage counts; canonical account authority; UTC bucketing under a Los Angeles session; and anon/member denial. The fixture emulates required auth roles/RLS, not the complete deployed Supabase policy matrix. No production SQL writes occurred.

`analytics-query-plans.json` records four **read-only EXPLAIN plans**, not EXPLAIN ANALYZE, against the existing production lean table. At the recorded cutoff, 24h, 7d and 30d use `events_lean_at_idx`; the historical window from July 17 uses a sequential scan. Estimated input rows are 142 / 4,130 / 31,869 / 58,773. These are planner estimates, not measured workload size, hardware capacity, query latency or costs. No index was added solely from an estimate. A representative authorized execution baseline is still needed before setting numeric production budgets.

## Promotion / rollback

1. Review the pending migration, final integrated test results and UI evidence; retain existing human promotion authority.
2. Capture current definitions of the four replaced objects and the four affected taxonomy rows in the authorized deployment evidence store. Confirm actual current migration ledger (parent's read found latest `20261017214808`; recheck at promotion).
3. Apply through the existing migration flow, refresh schema cache through that flow, deploy the tested Worker/UI source and check owner-only dictionary and stage RPC behavior.
4. Roll back application code by the established source promotion mechanism. If SQL must be rolled back, restore the captured definitions and taxonomy rows in a reviewed transaction; do not delete or rewrite event history. The additive stage RPC can remain unused or be revoked/dropped after checking dependencies. Historical migration files remain untouched.

## Remaining limits

- A true ordered conversion cohort with a declared follow-up horizon is **not implemented** by independent stage totals. Browser collection loss, late-arrival completeness and projection watermark are not measured.
- Full collection-to-raw-to-lean accepted/duplicate/rejected receipt instrumentation, exact historical impact counts, production latency baselines and privacy threshold redesign remain separate work.
- Underlying source rows can change during offset pagination. Frozen research manifests must use an authorized snapshot/export rather than claiming this interactive view is reproducible.
- The current completion/start event ratio and legacy acquisition field retain explicit limitations. Commerce money semantics and direct database grants outside the modified objects need their own acceptance evidence.
- No guarantee of funder eligibility, research validity, human-subject approval or deployed community impact follows from this implementation.
