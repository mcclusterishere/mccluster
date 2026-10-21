# Private news context

This change adds an on-demand comparison inside **Control → Analytics → World intelligence**. Select a country on the existing globe or enter its two-letter code, then compare its ingested news. Inspecting an individual story uses that stored article's UUID and resolves its country on the server.

The report reads **headline metadata**, finds explainable topic keywords, and shows relevant national indicators with their latest and previous observations, exact units and dates. It also compares city-level news mentions with retained USGS evidence. A deterministic summary cites the displayed values; it does not call a language model, read publisher article bodies, verify headline claims, or assert causality.

## Existing authority and scope

Everything stays in the canonical `mccluster` Worker, shared Supabase project, existing house-owner gate, and Control workflow. No new backend, database table, migration, provider account, paid service, credential, scheduler, global navigation or public news surface is added. The existing GDELT and USGS collectors remain the ingestion authority. Nothing is written to evidence, claims, briefings, decisions, missions or public projections by this report.

Related branches were reviewed before implementation: #408 is a bounded evidence graph; #414 adds research citations/evidence in its own pending scope; #416 restores infrastructure adapters. The public geolocated news work remains with its active owner. None is replaced by this private read projection.

### What the report actually uses

| Source | Existing implementation | Added by this change | What remains unknown or outside scope |
| --- | --- | --- | --- |
| GDELT GKG | Existing `media_news_articles` and ingestion pipeline | Bounded reads by selected country or article UUID, deterministic headline topics, country conversion | Actual runtime population/ingestion health must be read from the deployed environment. Stored rows are metadata, not licensed article bodies. Screening, language and retention limit coverage. |
| World Bank WDI | Existing owner-only latest-indicator integration | One bounded request for 14 fixed annual series and six completed years; latest/previous comparison; per-isolate cache | No current city measurement, intraday economic feed, nowcast or historical publication-vintage reconstruction. Some countries/series have missing observations. |
| USGS earthquakes | Existing collector and `intel_evidence → ops_ingest_records → ops_ingest_connectors` lineage | Nearby retained evidence, revision deduplication, distance/time context, review status | Collector enablement, ingestion success and archive completeness are not assumed. An empty archive means no eligible stored rows returned, not no earthquakes. |
| Other registered source families | Existing `seek-first/source-registry.js` includes Census, BLS, FRED, EIA, Data Commons, EPA, USAspending, Grants.gov, Open-Meteo, transport, space, infrastructure and camera adapters | No changes to their registry, credentials or live collection | They remain available through the existing source catalog, subject to actual credentials/entitlements. They are **not** automatically compared by this report. |

## Request and response

```http
GET /v1/intel/news-context?economy=US&hours=72&limit=12
GET /v1/intel/news-context?article_id=<stored-article-uuid>&hours=72
Authorization: Bearer <existing-owner-session>
```

- The actual `requireHouseOwner` gate runs before any news/provider read. Anonymous users and ordinary members cannot use the endpoint. Every response from this route, including known authorization failures, is `Cache-Control: private, no-store`.
- `economy` is a supported two-letter country code. World/region aggregates are rejected. A story query derives its country from stored metadata; an inconsistent supplied country or incorrect returned article ID is rejected.
- `hours` is an integer from 1 to 168; default 72. `limit` is an integer from 1 to 20; default 12. Unknown/repeated parameters, arbitrary URLs and indicator codes are rejected. No caller-supplied article text is accepted.
- The result schema is `news-context/v1`: selected economy, generated time, explicit news window, section coverage, source status/provenance, national `indicators`, and `stories` with topics, comparisons, summaries and nearby events.
- A failed source section is labeled unavailable. A successful empty source is labeled empty. Missing indicator values remain null; zeros remain real observations. Source errors never fall back to fabricated values or expose upstream response bodies.

## Country and time alignment

GDELT GKG stores **FIPS 10-4**, while the World Bank query uses country codes corresponding to the ISO crosswalk. The committed crosswalk is derived from GeoNames' ISO and FIPS columns, retrieved October 17, 2026, with source checksum and attribution in `news-country-codes.js`. It performs exact lookup; it never assumes that equal-looking codes identify the same country. Examples: FIPS `GM → DE` (Germany), `GA → GM` (Gambia), `AS → AU` (Australia), `AU → AT` (Austria), `UK → GB` (United Kingdom). Obsolete ISO `CS` and `AN` economies are excluded; the valid FIPS `CS` and `AN` entries still map to Costa Rica and Andorra. Unknown mappings do not trigger a guessed country query.

A GDELT place is an **automated location mention**, not proof of an article's event location, geographic scope or publisher headquarters. The stored timestamp is GDELT's seen time; publication and event times are not verified. Raw title numbers never become statistical observations.

WDI requests cover six completed years, ending before the current calendar year. Per-story comparisons exclude any annual period that had not completed before that story's seen-year. Each result distinguishes observation year, data retrieval time and provider update date. It explicitly says that current revisions may differ from what was available when a story appeared. The report is not a backtest.

Comparisons only subtract observations from the same indicator, country and unit. Percentage-valued series use **percentage-point changes**. Nonconsecutive years say “between available observations” and retain the year gap. No country totals are summed, no demographic ratios are reinterpreted as audience data, and no economic figure is represented as platform revenue.

## Fixed annual indicator catalog

| Indicator | WDI code | Unit |
| --- | --- | --- |
| Real GDP growth | `NY.GDP.MKTP.KD.ZG` | % |
| GDP per capita, current US dollars | `NY.GDP.PCAP.CD` | USD/person |
| Consumer price inflation | `FP.CPI.TOTL.ZG` | % |
| Unemployment, modeled ILO estimate | `SL.UEM.TOTL.ZS` | % of labor force |
| Trade share of GDP | `NE.TRD.GNFS.ZS` | % of GDP |
| Population | `SP.POP.TOTL` | people |
| Urban population share | `SP.URB.TOTL.IN.ZS` | % |
| Internet use | `IT.NET.USER.ZS` | % |
| Electricity access | `EG.ELC.ACCS.ZS` | % |
| Basic drinking water access | `SH.H2O.BASW.ZS` | % |
| Basic sanitation access | `SH.STA.BASS.ZS` | % |
| Life expectancy at birth | `SP.DYN.LE00.IN` | years |
| Arable land share | `AG.LND.ARBL.ZS` | % of land area |
| Cereal yield | `AG.YLD.CREL.KG` | kg/hectare |

All values carry indicator-specific World Bank links and the dataset's terms link. These series are context for the matched subject; for example, electricity access does not measure whether a particular grid is experiencing an outage, and urbanization is not a rent index. A keyword match tells the owner what may be useful to inspect.

## Stored spatial context

The query follows the existing composite foreign keys from `intel_evidence` to its source record and connector. It restricts evidence to the house organization, canonical `usgs.earthquakes` connector, source-published coordinates, accepted or explicitly unreviewed rows, unexpired retention, and observations at or before the report time. The projection validates the same fields again, including the USGS provider reference and source URL, before display.

Only GDELT **city** location types 3 and 4 are eligible for distance matching. Country/state centroids are excluded. The report considers at most 150 recent retained records, deduplicates a USGS event by its latest returned revision **before** checking proximity, then displays at most five events within **300 km** and **24 hours** of the city mention and news seen time. A newer correction outside that area suppresses an older matching position. Great-circle distance handles the international date line.

This is bounded stored evidence, not comprehensive hazard monitoring. The response reports when the row cap is reached. Events can occur before or after the news seen time; signed hour offsets state which. Spatial/time proximity is not verification that the earthquake is the event described in the news, and it does not establish any economic effect.

## Resource and security boundaries

- After existing auth/house resolution: one bounded news-store request, at most one WDI request, and one optional USGS evidence read. No article fetch, model request or per-story provider fan-out.
- Each projection fetch times out after eight seconds by default (hard option cap ten seconds) and limits the streamed body to 512 KiB. Redirects are refused. Database service credentials are used only with the configured Supabase origin; WDI receives only an Accept header.
- WDI success cache: one day, at most 32 entries per isolate; failures: one minute; at most four concurrent distinct requests; identical pending requests coalesce. The cache holds public indicator output only. Private stories and evidence remain request-local; UI results are memory-only and cleared on session/owner changes.
- Every title, URL, timestamp and numeric field is treated as untrusted. The report does not interpret instructions in news text, execute markup or derive “facts” from headline numbers. Control escapes all supplied text.
- No automatic polling, scheduler, ingestion-triggered analysis, private report publishing or irreversible side effect is added.

## Validation

Run `node workers/mccluster/test/news-context.test.mjs` for focused contract tests covering owner gating before data reads, exact article/country matching, FIPS collisions, malformed/future timestamps, null/zero values, annual lag, unit-safe changes, missing years, provider conflicts, malicious headlines/URLs, source failure, body/timeout bounds, caching, USGS scope and revision behavior. UI tests and mobile browser evidence are delivered with the Control module.

Production ingestion counts, actual credentials and provider availability are not established by fixture tests. No deployment or schema change was performed for this implementation.

The public World Bank US response contract was also checked directly on October 17, 2026: one page, 84 rows covering the exact 14 requested series and six years, provider update date October 8, 2026. The actual response passed the committed normalizer/comparison functions with 75 non-null observations and a latest/previous pair for all 14 series. This verifies that public provider payload and adapter contract; it does not verify the deployed private endpoint, stored GDELT coverage or USGS archive.

## Official source references

- World Bank API access/authentication: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
- World Bank date ranges, multiple indicators, paging and source IDs: https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures
- WDI series metadata: https://datahelpdesk.worldbank.org/knowledgebase/articles/898599-indicator-api-queries
- Indicator examples and underlying organizations: https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG ; https://data.worldbank.org/indicator/SL.UEM.TOTL.ZS ; https://data.worldbank.org/indicator/SH.H2O.BASW.ZS
- World Bank source terms: https://data.worldbank.org/summary-terms-of-use
- GeoNames country crosswalk: https://download.geonames.org/export/dump/countryInfo.txt ; attribution/license: https://www.geonames.org/export/
- USGS event service: https://earthquake.usgs.gov/fdsnws/event/1/ ; source credits: https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits

Stripe Directory was checked for provider-selection workflow. No new provider was provisioned or engaged for this change; the runtime uses the existing WDI integration and existing stored GDELT/USGS evidence.
