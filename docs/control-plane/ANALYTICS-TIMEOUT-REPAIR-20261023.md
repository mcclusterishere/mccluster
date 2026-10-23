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

## Verification boundary

The authenticated owner page was **not visually verified**. Its redirect from
`mccluster.org/control.html#analytics` to `matthew.mccluster.org` was denied by
automatic browser approval review. Cloudflare's connector additionally required
reauthentication; the owner's reconnect screen reported temporarily unavailable
client metadata. Neither issue prevented the Supabase repair.

Other genuinely missing provider data or capped source reads can still cause a
partial-data indicator. This repair does not hide warnings, assert that every
provider is complete, or claim an authenticated end-to-end dashboard result.

## Recovery

Retain the covering indexes if reverting the region function. Replacing only
`analytics_region_totals` with the function definition from
`20261017030554_analytics_region_v1.sql` restores the previous raw-source read and
its grants, but also restores its expensive access path. Do not replay either
applied migration or modify the recorded SQL; use a new migration for changes.
