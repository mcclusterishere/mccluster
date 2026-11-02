# Native news eligibility and planetary indicators

Status: draft implementation and research, 2026-10-16. No deployment, new paid
service, database migration, or production source approval in this change.

## What is actually implemented

1. A pure, deny-by-default native-reader source/article policy. It requires a
   current reviewed permission record, exact URL scope, a permitted content
   adapter, original attribution, complete text blocks, and review of publisher
   requirements. Feed fields cannot grant themselves rights. Images are excluded.
2. A strict-mode wrapper at the existing world-news module. The former GDELT
   implementation is moved unchanged to `world-news-discovery.js`; all exports
   and normal behavior remain available. `WORLD_NEWS_READER_ONLY=true` stops GKG
   metadata ingestion and returns an explicit waiting-for-full-text state from
   `GET /v1/world/news`, bypassing the metadata cache. No articles are deleted.
3. A key-free, bounded World Bank WDI adapter for eight indicators, with typed
   observations, actual year/unit/source, explicit missing values and mixed-year
   warning, timeouts/size limits, fixed provider URL, and per-instance cache.
4. 57 local new fixture tests and 20 existing news tests passed. No live provider
   response or physical device claim. Fresh-head repository CI is a separate gate.

## What is NOT implemented

No publisher grant is approved: APPROVED_READER_GRANTS is empty. GDELT titles
and links are not article bodies or republication rights. Therefore enabling
strict mode TODAY would produce an empty news feed, explicitly labeled pending.
The flag is not set by this PR. Do not enable it until an authorized full-text
adapter, canonical storage and the actual native reader are reviewed together.
The filter covers the existing World news cron and `/v1/world/news`; legacy
Edge Functions or separate discovery APIs are not claimed to be migrated.

The indicator adapter is wired behind the canonical owner gate in the existing
intel/router.js (`GET /v1/intel/world-indicators`) and, since 2026-11-02, feeds
the owner-only Markets card below; it is not a public route and no new auth
stack/Worker exists. The black globe and #470
workspace files are unchanged. No catalog is represented as already live.

## World markets on the owner's Halo globe (2026-11-02)

Owner, 2026-11-02: "live financial markets on the globe, geographically placed,
so when you click country, you can look at its GDP ... the stock market, all the
stocks and businesses that are registered there ... and news tied to that."
Decisions the same day: **owner globe only first** (not the public World) and
**start free, upgrade later** (a paid global feed must be config + secret).

What is connected (code in this repository; nothing deployed by the change):

| Piece | Where | State |
|---|---|---|
| Routes, all behind the house-owner gate in `workers/mccluster/src/intel/router.js` | `GET /v1/intel/markets/exchanges`, `/country/:iso2`, `/country/:iso2/listings?mic=&q=&offset=&limit=&type=&quotes=`, `/company/:symbol?mic=` | Implemented, fixture-tested |
| Adapter + provider interface | `workers/mccluster/src/intel/world-markets.js` | Implemented |
| Exchange reference set (49 venues: MIC, city, lat/lon, time zone, regular sessions, provider codes) | `data/markets/exchanges.json` | Checked in |
| Halo layer + card | `js/halo/markets.js`, `css/halo-markets.css`, the "Markets" group in `js/halo/halo.js`; `js/action-globe.js` announces a country tap as a `hu:country` window event | Implemented, e2e at 390/820/1280 |

What each number is, and is not:

- **GDP** (key-free, real today): World Bank WDI latest reported year (existing
  adapter: nominal, per capita, real growth) plus the IMF DataMapper WEO
  current-year figure (`NGDPD`, `NGDPDPC`, `NGDP_RPCH`; the API returns every
  economy, cached 12 h per isolate). The current year is an IMF estimate or
  projection. Always `is_live:false` with period, source and `retrieved_at`.
  The IMF row is joined by the ISO3 code World Bank returns; if WDI is down the
  IMF block says `iso3_unresolved` rather than guessing.
- **Exchanges** (real today): placed at their main venue's city. Open/closed is
  the regular schedule in the venue's time zone; holidays, auctions, half days
  and seasonal changes are not modeled. An exchange pin is where the exchange
  is, not where its companies operate (HQ, exchange, assets and revenue remain
  different relations).
- **Listings** (needs the owner's key): Finnhub free tier `/stock/symbol` per
  exchange code, common stock by default, searchable and paged server-side,
  cached in the Cache API for 24 h under an internal key with no secret. Until
  the secret exists every listings answer is `state:"needs_key"` with no rows.
- **Quotes**: Finnhub free tier quotes US listings only (first 8 rows of a page
  and the selected company; per-isolate budget of 50 provider calls/minute,
  60 s quote cache). Every non-US row is `price:null,
  price_status:"needs_paid_feed"`; a 403 from the provider is reported the same
  way, a 429 as `rate_limited`. Never a guessed or carried-over price.
- **Market news**: stored GDELT headline metadata from the existing World news
  ingest (`media_news_articles`, last 72 h, the country's FIPS code, finance
  words in the headline; headlines only, unverified). With a key, Finnhub
  global market headlines and the selected company's last 7 days of news.

What still needs the owner:

1. `wrangler secret put FINNHUB_API_KEY` on Worker `mccluster` (free key from
   https://finnhub.io/register). Until then listings say `needs_key`.
2. Deploy Worker `mccluster` (this change deploys nothing).
3. Paid global feed later: set `MARKETS_PROVIDER = "eodhd"` in `[vars]` and
   `wrangler secret put EODHD_API_KEY`. The EODHD adapter is implemented to the
   published API and fixture-tested only; confirm the `eodhd` codes in
   `data/markets/exchanges.json` against EODHD `/api/exchanges-list` first, and
   check the plan's redistribution terms. Twelve Data or another vendor is one
   more adapter object of the same shape in `world-markets.js`.
4. Venues with no reviewed provider code (Cairo, Lagos, Nairobi, Dubai, Karachi,
   Manila) show a pin and GDP but `not_covered` listings until a code is added.

Run: `cd workers/mccluster && node --import ./test/support/offline-network.mjs
--test test/world-markets.test.mjs`, `node --test
scripts/test/halo-markets.test.mjs`, and `scripts/e2e/halo-markets.e2e.mjs`
(Playwright + local Cesium; all answers are fixtures).

## Reader product rule

The platform supplies its own navigation/header. The article's author,
publisher, canonical link and required notices remain visible. A publisher
being iframe-compatible does not grant permission to remove its header or
republish its text. Never strip CSP/X-Frame-Options, proxy paywalls, or use
summary metadata as fabricated full text.

Source grants are trusted server-side deployment/owner-reviewed records, never
browser inputs or fields obtained from a source article. Review at admission and
again before serving stored content; revocation must purge/invalidate readable
caches. Each publisher adapter must prove preservation of required links and
notices. Text must be rendered as text nodes, not innerHTML. Rich HTML, photos,
tracking tags and media require their own reviewed handling. The policy boolean
is not a legal determination or HTML sanitizer.

Candidate access, not approvals:
- Guardian Open Platform: developer plan offers full article text, 1 call/sec,
  500 calls/day for qualifying noncommercial uses; commercial enterprises need
  the appropriate agreement. https://open-platform.theguardian.com/access/
- ProPublica: individual republication; automatic wholesale use not allowed.
  https://www.propublica.org/steal-our-stories
- Own newsroom and separately licensed content: scope each grant to actual
  ownership; do not assume every post under an owned domain is owned content.

## First indicator catalog (implemented adapter)

| Metric | WDI code | Unit |
|---|---|---|
| Population | SP.POP.TOTL | people |
| Urban population share | SP.URB.TOTL.IN.ZS | percent |
| GDP, nominal | NY.GDP.MKTP.CD | current USD |
| GDP per capita, nominal | NY.GDP.PCAP.CD | current USD/person |
| Real GDP growth | NY.GDP.MKTP.KD.ZG | annual percent |
| Life expectancy | SP.DYN.LE00.IN | years |
| Internet use | IT.NET.USER.ZS | percent |
| Electricity access | EG.ELC.ACCS.ZS | percent |

The adapter uses v2, source=2, mrnev=1, one selected two-letter economy or WLD,
one page capped at 100, and a 512 KiB response bound. No credentials are sent.
No live counter, interpolation, global summing or capital-city population pin.
WLD is a provider aggregate. Other responses are called World Bank economies;
a reviewed boundary-ID join must precede mapping (not every provider code is a
sovereign ISO country). GDP per capita, growth, and nominal GDP remain distinct.
Errors are errors, null is missing, and zero is a value only when reported.
Cached source readings retain their original retrieval time and actual period.

Official specification and terms:
- https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
- https://datahelpdesk.worldbank.org/knowledgebase/articles/898581
- https://datahelpdesk.worldbank.org/knowledgebase/articles/898599
- https://data.worldbank.org/summary-terms-of-use
  Defaults include CC BY 4.0 and additional terms; check each indicator's metadata
  for third-party restrictions. Do not blanket-approve every World Bank dataset.

## Larger source catalog (researched, not connected by this change)

| Domain | Sources and usable forms | Important distinction |
|---|---|---|
| World/country population | UN WPP, WDI | Estimates/projections, not live counts |
| Cities | GHSL UCDB R2024A / GHS-WUP R2025A, UN WUP 2025 | Urban centres vs administrative cities vs metros |
| US small areas | Census PEP / ACS | Official population estimates vs survey attributes; keep margins of error |
| Macro and local economy | WDI, BEA, FRED/ALFRED | Nominal vs real vs PPP; period and geography must agree |
| Markets and companies | Finnhub (connected, owner-only, needs key), EODHD (adapter, paid), Alpaca Basic, SEC EDGAR | IEX is partial market coverage; filings are not trade prices |
| Energy | EIA Open Data | Hourly grid conditions vs monthly/annual series |
| Buildings, roads, places | Overture / OSM | Feature-level license and geometry provenance |
| Transit | Agency GTFS / GTFS Realtime | Static schedule vs observed vehicle vs predicted arrival |
| Road conditions | CTroads | Regional, key required; media permission separately reviewed |
| Weather | NOAA NWS API | Forecast vs observation vs warning; US scope |
| Earthquakes | USGS GeoJSON / existing collector | Event origin time vs revision time |
| Ocean | Copernicus Marine | Model vs observation; surface vs depth |
| Biodiversity | GBIF API | Occurrence evidence and uncertainty, not every animal's location |

Source references:
- https://population.un.org/wpp
- https://population.un.org/wup
- https://human-settlement.emergency.copernicus.eu/ucdb2024Overview.php
- https://human-settlement.emergency.copernicus.eu/ghs_wup_mtuc_r2025a.php
- https://api.census.gov/data/2024.html
- https://apps.bea.gov/api/signup/
- https://fred.stlouisfed.org/docs/api/fred/
- https://docs.alpaca.markets/us/docs/about-market-data-api
- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://www.eia.gov/opendata/
- https://docs.overturemaps.org/getting-data/cloud-sources/
- https://docs.overturemaps.org/gers/
- https://gtfs.org/documentation/realtime/reference/
- https://ctroads.org/developers/doc
- https://www.weather.gov/documentation/services-web-api
- https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
- https://help.marine.copernicus.eu/en/articles/7949409-copernicus-marine-toolbox-introduction
- https://techdocs.gbif.org/en/openapi/

## Integration order and boundaries

First wire owner-only country/world data to the existing Intelligence inspector.
Retain the black base material; show a selected-region card before choropleths.
Second ingest a versioned city dataset offline, reproject EPSG:54009 to the map's
coordinate system and tile it. Do not deliver a gigabyte-scale city download to
an iPhone or equate urban centres with legal city limits.
Third add separately entitled personal market/watchlist data. A company HQ,
exchange, operating asset and revenue geography are different relations.
Fourth add licensed infrastructure/environmental tiles and versioned time series.

Use existing McCluster services, Supabase authority and connector/evidence
registry. Large static public layers should be compressed/partitioned artifacts;
heavy ETL should not run in an interactive Worker request. The iPad requests its
viewport and selected time, not all records on Earth. Private platform analytics
and bank data never enter public source caches or location joins automatically.

A useful observation needs metric, value, unit, entity id/type, boundary version,
period, observed/reported/retrieved times, source and license, uncertainty,
coverage and revision. A catalog entry needs state: discovered, reviewed,
connected, cached, stale, unavailable or blocked; discovery is not completion.

## Validation and rollout

Run `node --test scripts/test/world-data-core.test.mjs` and the existing
`workers/mccluster/test/world-news.test.mjs`. Repository CI is authoritative for
full regression tests. Fixture tests do not establish World Bank uptime or rights
for a specific publisher. No scheduled collection, spending or deployment here.

Before strict news rollout: approve one source, prove real full text, implement
native reader and retention/revocation handling, review screenshots, then enable
the flag and refresh existing client feed caches. Existing metadata rows and
browser-cached content are not retroactively deleted by this code.
