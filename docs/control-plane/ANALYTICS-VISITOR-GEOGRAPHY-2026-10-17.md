# Visitor-first geographic Analytics

Owner correction: selecting a place must filter Audience, and the initial globe must show a heat map with unique visitors as the primary metric.

## Behavior

- The initial layer is unique visitors per country, from `analytics_country_totals`. Overview's leading metric and trend also use visitors. A visitor is a distinct device in the selected window.
- Country fills use continuous relative intensity; places without measured counts retain the charcoal base. Small country counts are visible to the admin. Country totals can overlap when a device appears in multiple countries, so the interface does not sum them into a worldwide unique total or infer unknown-location visitors by subtraction.
- Country/state selection replaces Audience and Overview with one geographically scoped read: unique visitors, sessions, returning visitors, single-page-session rate, music starts, page views, visitor trend, sources, paths, pages and event stages. Every card uses the same property, exact time window and location predicate.
- Other chapters retain their labeled scopes. Global account/commerce/mission figures are not shown as if they describe the selected location. Scoped event stages are measured activity, not verified account or payment counts.
- While a selection loads, worldwide metrics are not displayed under its label. A failed selection has a retry action. Late responses from prior selections are ignored. Clearing returns to worldwide data.
- Returning means two or more sessions for a distinct device inside this location/window. The single-page-session rate uses scoped recorded sessions. State groups under five page views remain suppressed in SQL, matching the existing region policy.

## Data and performance

`analytics_geo_audience` is SECURITY INVOKER with an explicit existing admin gate, authenticated execute only, and existing table RLS. It returns aggregates, never device/session IDs, IPs, city coordinates or raw events.

Three exact applied migrations preserve the production ledger:

1. `20261017040826_analytics_geo_audience_v1.sql`: geographic aggregate contract.
2. `20261017041311_analytics_geo_audience_hotpath_v2.sql`: move country aggregation onto `events_lean`.
3. `20261017041532_analytics_geo_audience_regions_v3.sql`: add existing coarse region name/code to that lean copy and preserve its complete insert/update projection, eliminating raw-event joins for state reads.

Existing derived rows were backfilled after the schema transaction, avoiding holding a schema lock through the backfill:

```sql
update public.events_lean l
set region=nullif(btrim(e.region),''),
    region_code=nullif(upper(e.edge->>'cf-region-code'),'')
from public.events e
where l.id=e.id
  and (l.region is distinct from nullif(btrim(e.region),'')
    or l.region_code is distinct from nullif(upper(e.edge->>'cf-region-code'),''));
```

No new location collection, user permissions or public globe capabilities are introduced. Existing geography privacy behavior remains upstream. Migration count: 317. All three migration files match the stored SQL MD5s. The final 30-day state RPC passed an 8-second statement limit (measured 4.79 seconds). The initial raw-event implementation timed out and is superseded by the two hot-path migrations before frontend release.

## Verification

- 839 root tests passed, including default visitor geography, exact selected values, stale response rejection and clear-to-world behavior.
- 139 browser assertions passed across five phone/tablet/desktop/workspace configurations, including actual country fill colors, country/state card filtering and clearing.
- SQL behavior tests passed in isolated PGlite: country/state/property/bot/time boundaries, unique device deduplication, returning visitors, song starts, page paths, empty countries, small-state suppression, anonymous/member denial, and insert/update trigger preservation.
- Live admin read matched the direct distinct-device count for the same country/window; 24 trend buckets returned. Anonymous execution is denied. Security advisors did not flag the new RPC or changed projection functions.
- Browser screenshots use fixtures. Production counts and query timing were checked separately.
