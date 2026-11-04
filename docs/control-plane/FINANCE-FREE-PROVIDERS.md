# Free provider research — 2026-11-04

Research/design only. No signup, provider collection, credential creation, deployment or purchase performed. Earlier local and canonical Worker binding inspection found no configured Finnhub/EODHD/Alpaca credentials; adapters alone do not establish access. Existing synthetic paper portfolio remains synthetic.

## Recommended combination

Start with Alpaca Paper Only / Basic for selected US IEX quotes and historical bars, SEC EDGAR for filings, and optionally EODHD Free for a small international daily-price watchlist. Finnhub is optional additional quote/company context after account entitlements are verified. More keys are not automatically more useful coverage.

| Provider | Published free limits | Coverage / constraint |
|---|---|---|
| Alpaca Basic | 200 historical requests/minute; 30 streamed equity symbols | IEX real time, not consolidated SIP; history since 2016; latest 15 minutes of historical data restricted on Basic. Paper Only accounts have IEX entitlement. |
| Finnhub | Official indexed pricing: 60 calls/minute; docs impose additional 30/second ceiling | Direct pricing fetch timed out. Free endpoint, venue, history and retention matrix still needs account/document confirmation. Do not promise free historical candles or consolidated quotes. |
| EODHD Free | 20 API credits/day, 20 HTTP requests/minute; 500 one-time welcome credits | One year EOD history. One EOD ticker request costs one credit. Live/delayed endpoint is not free consolidated real time; streaming/intraday not included in free plan. |
| Twelve Data Basic | 8 API credits/minute; 800/day; 8 trial WS credits | Free pricing explicitly says internal non-display. Default live US feed approximately 5% of volume; daily history has full-market coverage after midnight ET next trading day. Do not enable globe display without confirmation. History depth needs endpoint verification. |
| Alpha Vantage | 25 requests/day | Select complementary historical/fundamental endpoints. Real-time and 15-minute delayed US data premium; do not assume full history or all endpoints free. |
| SEC EDGAR | 10 requests/second aggregate; no API key | Filings/company facts, not prices. Identified User-Agent and fair-access controls required; historical online coverage largely 1994/95 onward. |
| FRED/ALFRED | 120 requests/minute documented; key required | Macro/vintages, not quotes. Current API terms and 2024 official update differ on caching/storage/AI restrictions. Exclude persistent ingestion/model use pending clarification. |

Daily allocations are not monthly grants: 30 days gives at most 600 recurring EODHD credits, 750 Alpha Vantage requests or 24,000 Twelve credits, still subject to each daily/minute limit and endpoint costs. Welcome/trial credits are separate, nonrenewable benefits. No published monthly allocation verified for the other sources; do not extrapolate minute ceilings into promised monthly capacity.

## Secure connection sequence

1. Owner signs up for Alpaca Paper Only from its official paper-trading documentation, verifies email, selects paper environment, generates paper API key/secret. No funded brokerage account is needed for Paper Only. Never paste secrets into chat, browser code, screenshots or Git.
2. Put keys in the approved local secret store first. Proposed binding names APCA_API_KEY_ID and APCA_API_SECRET_KEY; Alpaca adapter is not yet implemented. Production Worker secret changes require separate authorization. Do not connect order execution endpoints; Halo keeps its own simulated ledger.
3. Optionally owner creates one EODHD Free account and stores EODHD_API_KEY securely; no paid upgrade or trial cycling. Existing Finnhub adapter would use FINNHUB_API_KEY if owner later chooses a free account.
4. Before collection, record accepted personal-use/display/storage terms and actual endpoint permissions. Then explicitly authorize a bounded test: a few liquid US names, explicit feed=iex, source timestamps, spread and historical pagination. Verify closed-market handling and denied/429 responses. Only then label returned observations live.

## Router proposal (not implemented)

Reuse canonical Worker world-markets adapter boundary. Add a provider capability registry containing account scope, endpoint/feed, instruments, quote/bar kind, currency, adjustment basis, quotas/cost/reset rules, retention/display/AI rights, terms URL and verification date. Rights and owner authorization are checked before cache lookup or dispatch. Future members cannot inherit owner licenses.

Use one atomic provider-account quota ledger shared across Worker isolates and OVH jobs in existing infrastructure. Existing per-isolate budgets are insufficient globally. Reserve credits before requests, reconcile response limits, and prioritize visible selected symbols over watchlists/backfills. Deduplicate identical in-flight requests. Start below published maxima, reserve headroom for retries, halt at daily exhaustion. No account/key/proxy rotation to defeat limits.

Cache only when rights permit. Proposed quote cache 5–15 seconds, negative-symbol cache 5 minutes, completed daily bars 24 hours with correction refresh. Cache key includes provider/feed/instrument/listing MIC/currency/interval/session/adjustment/as-of and entitlement scope. Never re-date cached observations as fresh. Fallback must be eligible for that data kind: daily EOD cannot fill a real-time order request.

429: honor Retry-After/reset and jitter; do not immediately retry elsewhere merely to defeat restrictions. 401/403: disable affected credential/endpoint until corrected, no blind retries. Proposed circuit breaker: five transient failures opens for 60 seconds then one probe. Report quota_exhausted, unauthorized, unavailable, delayed, stale, unverified and market_closed independently.

Every observation retains provider, feed/venue scope, source timestamp, received_at, delay, quote kind, currency and adjustment revision. Do not average bid/ask/last across feeds. On provider switch show the change and keep series segments separate. Rebuild consistent adjusted history after splits/dividends rather than splicing new adjusted bars into an old basis. Paper fills require eligible timestamped bid/ask and recorded slippage assumptions; a limited-venue quote is not NBBO.

Required tests before activation: shared quota concurrency/day rollover/weighted costs; entitlement failures; 429/reset and circuit recovery; stale/future/missing timestamps; market calendar; same ticker on different listings; raw versus adjusted history; fallback provenance; member denial; secrets redaction; paper fill refusal on delayed/unavailable data.

## Official evidence

- Alpaca: https://docs.alpaca.markets/us/docs/about-market-data-api and https://docs.alpaca.markets/us/docs/paper-trading
- Finnhub: https://finnhub.io/pricing (indexed official excerpt; direct timeout), https://finnhub.io/docs/api/rate-limit
- EODHD: https://eodhd.com/pricing and https://eodhd.com/financial-apis/api-for-historical-data-and-volumes and https://eodhd.com/financial-apis/terms-conditions
- Twelve: https://twelvedata.com/pricing and https://support.twelvedata.com/en/articles/9935903-us-equities-market-data and https://support.twelvedata.com/en/articles/5615854-credits
- Alpha Vantage: https://www.alphavantage.co/support/ and https://www.alphavantage.co/documentation/
- SEC: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data and https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- FRED: https://fred.stlouisfed.org/docs/api/fred/errors.html and https://fred.stlouisfed.org/docs/api/terms_of_use.html and https://fred.stlouisfed.org/news/2024/06/weve-updated-our-terms-of-use-action-requested

Remaining blockers are pending owner account/secure connection and collection authorization, not denied actions. No verified live observation exists. Twelve display rights, Finnhub endpoint entitlements and FRED storage/AI inconsistency remain unresolved. No runtime code was changed for this research request.
