# Connect private integrations

Checked 2026-11-04 against main `4fc32c84970d1a5cbc69c2df218e700bcea14032`.
This manual separates software already in main from branch-only software. No
credentials, accounts, subscriptions, production settings or trades were changed
while preparing it. Missing keys do not prevent building and testing integrations.

## Start here

1. Open the existing owner account in McCluster. Use the existing Halo, Travel or
   Weather desk; a detached demo does not deliver these products.
2. Choose one provider below for the capability you want. Create your own account
   on its official site when needed, select the free/private-use option, and
   review its permitted uses. Do not enable automatic paid overages.
3. Store the key in the **server runtime that actually calls that provider**.
   McCluster Worker secrets belong to Worker `mccluster`; Core configuration
   belongs to OVH Core. Adding a secret to a satellite, GitHub Actions or Supabase
   does not automatically configure the Worker.
4. After the exact source is reviewed and its runtime release authorized, verify
   the provider response through the existing owner interface. Record the deployed
   commit, source, source timestamp, coverage and observed error/success. A binding
   being present proves none of those things.

Never paste keys into chat, HTML, frontend JavaScript, localStorage, Git, screenshot
reports or URL query examples. Do not reuse a provider key belonging to a different
product. Private use still has licensing, quota and infrastructure costs.

## Where keys go

For the canonical Cloudflare Worker, open Workers & Pages → **mccluster** →
Settings → Variables and Secrets. Enter sensitive bindings as **Secret**, using
the exact names below. Nonsecret provider selectors can be variables. Saving
production settings can create a new deployment; do that only during the approved
release. Use a separately approved private environment to validate first.
[Cloudflare secret instructions](https://developers.cloudflare.com/workers/configuration/secrets/).

For local Worker development use an ignored `.dev.vars` file, permissions limited
to your user, following the same Cloudflare instructions. Confirm it is ignored
before entering any key. Do not load a production secret file just to run tests.
Core's existing protected configuration is `/etc/mccluster/core.env`; do not copy
it into Git or expose it through the static website. Never send the Supabase
service-role key to the browser. Customer OAuth tokens use the existing Vault
flow after its schema and authorization contracts are accepted, not manual public
table edits.

The new local preflight is safe without credentials:

```sh
node scripts/integration-readiness.mjs --empty
node --test scripts/test/integration-readiness.test.mjs
```

Without `--empty`, it checks only environment variables already inherited by the
local process. It does **not** read `.dev.vars`, contact Cloudflare, or inspect
production. Output lists missing binding names and keeps runtime `not_checked`.
It reuses the source registry and provider selectors; configuration-only terrain
and viewer entries are distinguished from data adapters. It is an operator tool,
not a replacement for the product interface or a live-health monitor.

## First connections

| Capability | Exact binding / selector | What is ready | Free allowance and limit |
|---|---|---|---|
| Halo US quote/listing foundation | `FINNHUB_API_KEY`; `MARKETS_PROVIDER=finnhub` | Main `world-markets.js`; owner-only country, listing and company routes; missing key keeps prices absent | [Finnhub pricing](https://finnhub.io/pricing): 60 calls/min free; [rate limit](https://finnhub.io/docs/api/rate-limit) also specifies a 30/sec ceiling. Account entitlements determine endpoint coverage. Main code uses 50/min per client instance, 60-second quote memoization; that is not a cross-instance account quota. |
| Paper-only Finance | **Await the Finance task's final binding contract** | Separately assigned integration; main's market provider selector currently supports Finnhub/EODHD, not Alpaca. Do not set `MARKETS_PROVIDER=alpaca` on this main | [Alpaca data docs](https://docs.alpaca.markets/us/docs/about-market-data-api): Basic is free, IEX real-time equities, 30 streaming symbols, 200 historical requests/min; historical recent-data restrictions apply. IEX is not all-exchange coverage. |
| Real street directions | `TRAVEL_TOMTOM_API_KEY`; `TRAVEL_ROUTING_PROVIDER=tomtom` | Main adapter, guidance, globe route and GPS flow. Distinct from Halo's `TOMTOM_API_KEY` | [Current TomTom pricing](https://docs.tomtom.com/pricing/): Routing API lists 20,000 monthly free requests. Do not assume older 2,500/day articles describe the selected plan. Existing app cap is 1,000/day with 1.1-second spacing; that could exceed 20,000/month, so a monthly budget must be added before unattended use at that rate. |
| Connecticut weather | No provider key; Core `WEATHER_INGEST_ENABLED=true` is an activation flag | Eight-feed ingest, decoder, owner API and weather desk are in main; timer intentionally disabled in documented rollout | [NWS](https://www.weather.gov/documentation/services-web-api) is free, requires identifying User-Agent and does not publish its numeric rate limit. Existing Core job is every 10 minutes, Worker cache one minute. Promotion, timer and decoder checks still required. |
| Authenticated aircraft feed | `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` | Existing OAuth adapter and keyless adsb.lol fallback; owner release gate remains | [OpenSky docs](https://openskynetwork.github.io/opensky-api/rest.html): standard user 4,000 daily credits per endpoint bucket; global state query costs four credits. Verify permitted research/product use. Existing flights cache is 600 seconds. Fallback is a labeled regional sample, not complete global coverage. |
| Active-fire research layer | `FIRMS_MAP_KEY` | Existing `nasa_firms` adapter in canonical Seek First gateway | [NASA key registration](https://firms.modaps.eosdis.nasa.gov/api/map_key/): 5,000 transactions per 10 minutes; larger date ranges can cost multiple transactions. Keep bounding boxes/date ranges small and preserve acquisition time. |
| Labor/economic series | Optional `BLS_API_KEY` | This recovery adds keyless v1 to the existing gateway; a key upgrades to v2 | [BLS limits](https://www.bls.gov/developers/api_faqs.htm): 25 queries/day, 25 series/query, 10 years unregistered; 500/day, 50 series, 20 years registered. Registration renews annually. No new automatic polling or shared daily limiter. |
| Economic series | `FRED_API_KEY` | Existing FRED adapter; series/period observations, not stock trading | Obtain a key through [FRED's official key guide](https://fred.stlouisfed.org/docs/api/api_key.html). No numeric current quota was verified from that page; keep usage bounded and respect throttling. Series may have third-party rights under [FRED terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html). |

For Alpaca, create a **paper** account and generate the paper key pair through its
official dashboard. [Paper trading documentation](https://docs.alpaca.markets/docs/paper-trading)
distinguishes the paper endpoint (`https://paper-api.alpaca.markets`) from live
trading. Market data uses `https://data.alpaca.markets`. Provider HTTP headers are
`APCA-API-KEY-ID` and `APCA-API-SECRET-KEY`; those are not a promise of the Finance
task's environment variable names. Bind only after its final code names are known.
Validate read-only data/account behavior first; no orders are authorized by this
audit. Do not substitute a live account or fabricate executions when disconnected.

EODHD's existing adapter is an upgrade path, **not** the selected free-private
baseline. `EODHD_API_KEY` plus `MARKETS_PROVIDER=eodhd` requires the applicable
data package and coverage validation. No purchase is needed for this audit.

## Other registered sources

The preflight enumerates the canonical `seek-first/source-registry.js`; it does
not certify each source's UI, license, entitlement, rate limiter or runtime. More
binding names already supported include `CENSUS_API_KEY`, `EIA_API_KEY`,
`BLS_API_KEY`, `DATA_COMMONS_API_KEY`, `COPERNICUS_CLIENT_ID`,
`COPERNICUS_CLIENT_SECRET`, `PLANET_RESEARCH_API_KEY`, `TOMTOM_API_KEY`,
`AISSTREAM_API_KEY`, `MAPBOX_ACCESS_TOKEN`, `GOOGLE_MAPS_API_KEY`, and
`CESIUM_ION_TOKEN`. `LL2_API_TOKEN` is optional for Launch Library 2.

These are **not** an instruction to sign up for all providers. Several require
eligibility, billing or API-specific limits; they need their own current official
quota/terms review before activation. Main's Census adapter still requires a key. This recovery changes BLS to an
optional key, using the official v1 endpoint when absent. Do not confuse a
registry entry with an implemented player-facing feature. Start with the first
connections above and existing keyless USGS, NWS, World Bank/IMF and other feeds.

Some map viewers use intentionally public restricted tokens. This recovery does
not introduce or expose any such token; follow the existing [viewer contract](SEEK-FIRST-PRODUCT-ARCHITECTURE.md)
and provider origin/API restrictions when that separate capability is enabled.

## Instagram and customer integrations

The October 26 creator cross-posting request has code in the consolidated
self-service stack, not complete accepted delivery on current main. Reuse
`codex/productization-recovery-20261102` and the newer Claude frontend. The branch
runbook is [customer-social.md at the recovery snapshot](https://github.com/mcclusterishere/mccluster/blob/17ed110d52a425c1570e67fbbdc6308d7b064559/docs/self-service/customer-social.md).

Its Worker bindings are `META_APP_ID`, secret `META_APP_SECRET`,
`CUSTOMER_SOCIAL_REDIRECT_URI`, compatible `META_GRAPH_API_VERSION`, and default-off
`CUSTOMER_SOCIAL_ENABLED`. It also needs the reviewed pending SQL, a Meta app,
approved scopes/exact callback, test users and real OAuth validation. Use the
owner Connect flow to put tenant tokens into Vault. This branch supports Instagram
Professional Reels; it does not deliver publishing to every social network.
Check [Meta's publishing reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)
and the account's actual limits before enabling jobs; current publishing capacity
was not independently verified here. Provider tests must not publish customer
content without authorization.

Domain registration, Stripe checkout, Whip service launch, email and media/voice
compute are separate workflows. They cannot be activated merely by pasting a key.
See the recovery inventory for exact outstanding code, service and acceptance gates.

## Validate, disconnect, rotate

1. Run fixture tests first. Sign out and verify private APIs deny access; then use
   the existing owner session to open the relevant interface. Never use a
   service-role token in browser tools as an authentication shortcut.
2. For Finnhub, inspect `/v1/intel/markets/country/US/listings` through the owner
   flow. Confirm actual source timestamp, null/unavailable behavior and entitlement
   errors. GDP is annual data and exchange opening is a schedule estimate.
3. For Travel, choose two public landmarks and request one route. Confirm real
   geometry/guidance, TomTom attribution, and a safe failure on revoked credentials.
   Coordinates go to the provider; do not include precise trip data in telemetry.
4. For weather, follow [CONNECTICUT-WEATHER.md](CONNECTICUT-WEATHER.md). Verify
   Core version, timer, `bzip2`, owner access and fresh snapshot. Preserve original
   observation times on carried-forward records. Simulated game weather remains
   labeled simulated. `node core/src/weather-snapshot-cli.mjs --fixture` exercises
   the existing recorded-data pipeline without a provider request.
5. Check throttling and provider quota dashboards. Back off on 429. Shared caching
   reduces calls but is not a guarantee of a provider-wide hard budget; sources
   without a verified durable quota must stay bounded/manual until that is built.
6. To rotate, create a replacement in the provider dashboard, replace only the
   matching server secret during an approved release, validate read-only behavior,
   then revoke the old key. If exposure is suspected, revoke promptly and accept
   the disconnected state while reconnecting. Never record old/new values in logs.
7. To disconnect, disable the specific feature/provider and revoke its provider
   credential. Merely deleting a local file does not revoke a key. Instagram's
   local Disconnect removes that organization's binding/Vault token and handles
   queued jobs per its contract; provider-wide revocation is separately performed
   in Facebook Business Integrations and can affect other organizations.

Record validation results privately as timestamp, exact deployed SHA, provider,
coverage, response status and source age. Never save raw secrets or personal
payloads in the report. A successful fixture test is still not a live test.

## Rehearse BLS before connecting

Run `node --test workers/mccluster/test/bls-recovery.test.mjs`. After an approved
release, the existing authenticated `POST /v1/seek-first/fetch/bls` accepts
`{"series_id":"LNS14000000","start_year":2024,"end_year":2024,"lane":"INTERNAL","persist":false}` through its normal
gateway contract. `persist:false` prevents this validation read from requesting an ingest. Keep the existing organization/lane authorization. With no
key it uses v1; add `BLS_API_KEY` as a Worker secret to use registered v2.
Missing periods and provider failures remain unavailable. Monthly timestamps
represent period starts, not publication timestamps. This fixture example is
not an assertion that a live request was made.

## BLS owner explorer follow-through (2026-11-07 review branch)

After this review change is released, open **Control → Analytics → World
intelligence → Bureau of Labor Statistics**. Enter a series ID from the
[official BLS data directory](https://www.bls.gov/data/), choose 1–10 inclusive
years, and press **Read BLS snapshot**. The explorer intentionally requests one
series per click, within the unregistered API's bounds even when a key exists.
It reuses the existing owner/entitlement-gated `POST /v1/seek-first/fetch/bls`
route with `persist:false`, `include_raw:false` and the internal lane.

The chart and complete returned-observation table show reporting periods, not
release times. Missing values are not zero, missing periods break trend lines,
and annual averages are shown separately from the trend. Check the source's
series definition for geography, units and seasonal adjustment; absent metadata
is labeled rather than inferred. Footnote codes are preserved. Retrieval time is
separate from reporting periods, and truncated responses are explicitly marked.

No key is required for the existing BLS v1 path. `BLS_API_KEY`, if supplied in the
canonical Worker's secret settings during an approved configuration change,
selects registered v2 access. Never enter a credential into the series field.
The server remains authoritative for access and validation. This UI neither
changes permissions nor provisions credentials, storage or provider entitlement.

**Clear snapshot** discards the displayed or pending result without another
request. A pending provider request may still finish and count against its
quota. A failed read can be retried deliberately. Source changes, permission
refresh and sign-out invalidate late results. Page reload discards the snapshot
and form state; it does not read the provider automatically. There is no local
storage of observations, automatic polling or new archive write path. Existing
stored-record reads remain separate and require the existing archive schema.

### Review and validation boundary

This completes the missing owner-facing BLS inspection slice of merged #746,
not the entire October 5–November 4 recovery inventory. It does not add a Halo
Finance/geographic overlay, scheduled collection, account-wide quota service,
provider cache or production activation. No live BLS account, deployed gateway,
authenticated production browser or production database was exercised.

Run the executable local tests:

```sh
node --test scripts/test/bls-explorer.test.mjs scripts/test/analytics-unified.test.mjs workers/mccluster/test/bls-recovery.test.mjs
```

The sealed browser regression uses the actual source-inspector modules with
synthetic data at 390, 820 and 1440 px. It covers layout, explicit read, clear,
interrupted request, unavailable provider, retry, source switch, denied source,
sign-out and reload. It is added to the existing site-smoke gate:

```sh
PW_MODULE=/path/to/playwright node scripts/e2e/bls-explorer.e2e.mjs
```

Local browser launch was blocked before page load by the execution environment's
`socket() failed: Operation not permitted` restriction, including an escalated
attempt. Browser assertions and screenshots therefore require hosted CI before
this draft can be considered visually verified. The module fixture is not a
full-shell or real-owner production acceptance test.
