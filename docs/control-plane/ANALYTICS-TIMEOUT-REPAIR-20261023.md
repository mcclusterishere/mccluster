# Analytics query timeout repair — October 23, 2026

Production logs confirmed SQLSTATE `57014` for `analytics_business_event_counts`,
`analytics_region_totals`, and the coverage inventory's exact event/news reads.
The earlier combined business RPC was deployed, but still scanned the lean heap;
regional totals still read raw events; news freshness sorted the whole catalog.
These failures leave measurements unavailable and can trigger **Partial data**.

## Applied database repair

Production migrations, whose stored SQL matches these files byte for byte:

- `20261023230851_analytics_read_hotpaths_v2`: first-party count/freshness index,
  news imported-time index, and regional totals on the existing lean projection.
- `20261023231954_analytics_region_covering_v3`: fully covering country index and
  separate first-party/tenant page-view cutoff queries. The explicit NULL branch
  lets PostgreSQL find the historical cutoff using an index instead of visiting
  every page-view row. This supersedes and removes the intermediate country index.

All indexes were built concurrently using the corresponding `supabase/ops/`
statements and checked for `indisvalid`/`indisready` before migration application.
The production ledger and Core drift contract now contain 343 migrations.
No Worker or browser asset change is required for these database fixes to take
effect. Existing exact counters, half-open windows, legacy page-view fallback,
bot/site exclusions, region folding, SECURITY INVOKER and service-role-only RPC
grants are retained. No event rows, auth settings or RLS policies were changed.

## Evidence

Observed production plans; elapsed times vary with cache and server load:

| Read | Before | After |
| --- | ---: | ---: |
| US regions, seven days | 10,632 ms | 193 ms |
| US regions, 24 hours | — | 128 ms |
| US regions, 30 days | Still timed out after intermediate v2 | 412 ms |
| Business event counters, seven days | Live timeout recorded | 630 ms |
| Business event counters, 24 hours / 30 days | — | 687 ms / 52 ms |
| Newest news record | 17,422 ms, full scan and sort | 6 ms, index-only scan |
| Exact news count | Live timeout recorded | 1,369 ms, index-only scan |

Final plan checks ran as `service_role` with an explicit eight-second statement
timeout. Before switching regional sources, the old and replacement reads were
compared within one live seven-day snapshot: 15 rows each, zero differences.
After both repairs, a full ID reconciliation found 128,866 raw events and 128,866
lean events, zero missing and zero orphaned projections. A 500-record recent
sample also had zero timestamp/name/country/region projection mismatches.

The isolated PostgreSQL/WASM regression exercises nine region windows/scopes,
legacy fallback, unknown/folded regions, tenant/bot exclusions, browser-role
denial, all eighteen business counts and the three indexed access paths.
The existing Worker diagnostics, coverage and region tests also run. No test
fixtures are inserted into production.

## Authenticated follow-up and longer ranges

With the owner's approval, the signed-in page on `matthew.mccluster.org` was
checked. A fresh 24-hour and seven-day load each reached **Updated**, but the
30-day load reproduced **Partial data**. Identity, audience science and visitor
reads intermittently failed. Live SQLSTATE `57014` records also identified the
country, daily/total and geographically located news reads. The initial 24-hour
success was not sufficient evidence that longer ranges were healthy.

Applied follow-up: `20261023234659_analytics_long_range_v4`, exact stored SQL
verified. Four concurrent indexes support ordered identity pagination, covering
identity links, summary windows, audience pages and located-news windows. The
temporary identity index was replaced by its covering form. Daily, hourly,
total and country functions use explicit NULL-site branches and indexed legacy
page-view cutoffs. Counting definitions and all existing function grants remain
unchanged; no event records, auth configuration or RLS policies were modified.
Production ledger: 344 migrations.

The isolated regression compares 96 old/new function cases (including DST,
empty windows, NULL bot values, tenants and legacy fallback), identity page
parity, unchanged grants and four planner-selected access paths. All pass.
Service-role live reads, each bounded to eight seconds: 30-day totals 205 ms,
daily 197 ms, countries 278 ms, visitor list 3,103 ms. Sample identity pages took
97–222 ms, with JSON serialization checks at 544–644 ms. These are observations,
not latency guarantees.

After the follow-up migration, the signed-in 30-day dashboard reached **Updated**
at 7:47 PM America/New_York, with no source-failure warning. A separate dataset
inventory read reported one unavailable range count near the end of its work:
first adaptive decisions, then system events on retry. The adaptive query passed
directly in 236 ms, with no matching database timeout. The inventory previously
made 48 database fetches plus authentication and owner checks. This is consistent
with a 50-external-subrequest limit, but Cloudflare runtime logs were unavailable
to confirm the exact thrown error. The client now reads sequential pages of 12
datasets (at most 24 fetches per request), and known empty sets skip redundant
range counts. Tests cover all-populated catalogs, malformed continuation, and
failed subsequent pages so an incomplete inventory cannot appear complete.
External-provider completeness and browser event loss remain separate from
whether these stored-data reads complete. The warning has not been suppressed.

## Recovery

Retain the covering indexes if reverting the region function. Replacing only
`analytics_region_totals` with the function definition from
`20261017030554_analytics_region_v1.sql` restores the previous raw-source read and
its grants, but also restores its expensive access path. Do not replay either
applied migration or modify the recorded SQL; use a new migration for changes.

## Index payload safeguard

Follow-up migration `20261023235817_analytics_audience_index_width_v5` replaces the audience covering index with `(at,id,name)` and the same predicate. URL and event payload text are unbounded in the lean projection, so they must not be included in a B-tree entry. A regression reproduces the covering-index failure with a 16 KB incompressible referrer and verifies insertion after the replacement. The replacement is valid and ready; a late 30-day page uses its ordered index scan in 3.22 seconds under the 8-second service-role limit. The production ledger now has 345 entries.

## Reproduced API call and repeated-page load

A further stress run still timed out identity, country and visitor reads. Matching PostgREST’s lateral JSON argument wrapper reproduced a 5.91-second country read with 51,491 buffer hits, despite the direct call being much faster. `20261024000310_analytics_summary_parameter_plans_v6` preserves the four summary queries and binds actual parameters through PL/pgSQL EXECUTE USING. The same API-shaped read then took 1.43 seconds with 2,602 total buffer accesses. These measurements supersede direct-call timings as the useful API comparison. Grants and invoker security are unchanged. Production now records 346 migrations.

Event reads ordered by `(at,id)` now use a timestamp/UUID cursor and zero offset, preserving PostgreSQL microseconds and ties. Other tables retain their existing bounded pagination. The dashboard starts one read family at a time, preserving incremental rendering while reducing overlap with ingestion. Tests cover ascending/descending cursors, timestamp ties, caps, invalid continuation, 192 direct/API-shaped old/new SQL cases, and all 88 analytics Worker tests. Deployment and live verification are required before declaring the remaining symptoms resolved.
