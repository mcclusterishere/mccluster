# Live stock data: verified blocker and setup path

Checked 2026-11-04. Read-only inspection; no signup, credentials created, paid
request, provider collection or production change.

## Actual configuration

The current adapter module supports Finnhub and EODHD, defaults to Finnhub,
expects FINNHUB_API_KEY or EODHD_API_KEY, and returns needs_key when absent.
EODHD's existing /real-time adapter is classified delayed. Finnhub freshness is
unverified unless the operator's entitlement attestation is set; a fresh price
alone is not proof of consolidated real-time rights.

Local environment checks found no FINNHUB_API_KEY, EODHD_API_KEY,
APCA_API_KEY_ID/APCA_API_SECRET_KEY or ALPACA_API_KEY/ALPACA_SECRET_KEY.
No relevant credentials were found in the targeted conventional local env files.
Read-only Cloudflare API inspection of the canonical mccluster Worker's secret
names and settings found no FINNHUB/EODHD/ALPACA/APCA/MARKETS_/FINANCE_ bindings.
Only filtered names/types and nonsecret feature values were returned; no secret
values were retrieved. This does not claim that Matthew has no provider account
elsewhere. No authorized credential was available for a real data smoke test.

The local Wrangler binary was absent; inspection succeeded through the connected
Cloudflare API instead. No installation or deployment was necessary.

## Recommended first step: $0 Alpaca IEX personal proof

Matthew can use an existing Alpaca paper account, or create a Paper Only Account
himself and generate the key pair. Official documentation describes email signup
and IEX data entitlement for this account. Do not fund a brokerage account or buy
a plan for this proof. Supply credentials through an approved secret mechanism,
never source code, a browser bundle or chat. No signup is authorized for the agent.

https://docs.alpaca.markets/us/docs/paper-trading
https://docs.alpaca.markets/us/docs/about-market-data-api

No Alpaca adapter is currently implemented. Once the approved key pair is
available, the next local integration is:

1. Request a selected symbol from data.alpaca.markets/v2/stocks/quotes/latest
   with explicit feed=iex, symbol and USD currency. Send the key pair only in
   APCA-API-KEY-ID and APCA-API-SECRET-KEY headers. No brokerage/order endpoint.
2. Preserve quote time, receipt time, feed, venue scope and bid/ask; do not label
   the bid/ask midpoint as a traded price. Fetch the separate latest trade if a
   last-trade chart is needed. Reject future timestamps and invalid/crossed prices.
3. Fetch bounded /v2/stocks/bars history with explicit feed, timeframe, start/end,
   adjustment and pagination. Basic documentation lists history since 2016;
   dataset/instrument availability must be measured, not assumed uniform.
4. Plot historical bars and subsequent observations with timestamps and source.
   Avoid mixed IEX/SIP series unless separately labeled. No interpolation of gaps.
5. Distinguish fresh IEX observation, old observation, unavailable, rate limited,
   entitlement denied, and confirmed closed session. A stale quote does not by
   itself prove the market is closed. Use an authoritative calendar/clock when
   supported; the existing exchange reference lacks holidays/half days.
6. Start with one symbol and bounded polling; a small selected-symbol WebSocket
   subscription can follow. Never stream the full universe by default.

https://docs.alpaca.markets/us/reference/stocklatestquotes-1
https://docs.alpaca.markets/us/reference/stockbars

## Scope and cost distinctions

Basic is $0: real-time IEX, one venue, not the consolidated national market; the
published plan lists 30 streamed equity symbols and 200 historical calls/minute.
Algo Trader Plus is advertised at $99/month with all-US-exchange coverage and
higher limits. Confirm account eligibility, agreements and entitlements before
buying; Paper Only documentation itself grants IEX, not unrestricted SIP.

SIP consolidates US exchange trades/quotes through CTA/UTP. Historical SIP queries
for the most recent 15 minutes require the appropriate subscription. Provider
documentation also exposes delayed_sip for applicable endpoints; test permission
explicitly rather than silently falling back and calling it live. IEX real-time
and delayed consolidated data are different products.

https://docs.alpaca.markets/us/docs/historical-stock-data-1
https://docs.alpaca.markets/us/docs/market-data-faq

Finnhub is the quickest existing-code route if Matthew already has a permitted
Finnhub key, but its quote/history rights need verification. Direct official
Finnhub quote/pricing pages timed out in this research pass; no current paid tier
price or consolidated-feed entitlement is asserted. The present Finnhub adapter
does not implement historical bars. EODHD's existing endpoint is delayed, not the
requested demonstrated live US feed.

## Gates remaining

Credential/account action is the immediate live-proof blocker. No API price or
timestamp was observed during this pass, so no live-data success is claimed.
Personal validation does not authorize future $6/module customer distribution.
Customer data terms, provider agreements, server grant loading and release remain
separate. Hosted credentials/configuration changes and publication/deployment need
separate authorization under the current task boundary.
