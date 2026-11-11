# Halo Finance review build — 2026-11-04

> Historical checkpoint. For current implementation and coordinated activation, see [FINANCE-ROLLOUT.md](FINANCE-ROLLOUT.md). Earlier unimplemented/draft-only statements describe the original checkpoint, not current main.

This is the current implementation record. Earlier FOUNDATION/RELEASE/ACCEPTANCE documents preserve research and pre-integration history; this file and the PR describe the new build, not a production release.

## What the owner can use after an authorized release

In the actual Halo World panel, Finance opens inside the existing Markets panel, keeping the Cesium globe mounted. The existing exchange pins, country economy and geographic news remain available. New US symbol/company search leads to Alpaca IEX quotes and 1-month/1-year/5-year historical charts. An in-globe ticket previews and confirms a Halo simulated order, then updates a persisted watchlist, cash, holdings, cost basis, realized result and saved fill history. Reload restores the portfolio after reopening Finance.

No credentials: explicit connection/setup state, no fabricated securities or prices. No schema: storage unavailable, not a fake empty/saved account. The previous detached finance-dev.html remains a synthetic developer harness and is no longer the globe entry.

## Code and data flow

- js/action-globe.js loads js/halo/finance.js before Markets; js/halo/halo.js activates Markets without navigation; js/halo/markets.js mounts the component in its existing geographic panel.
- js/halo/finance.js → owner-gated /v1/intel/finance/market, /account, /control → canonical Worker. No direct browser-to-provider calls.
- workers/mccluster/src/finance/alpaca.js reads ONLY GET paper-api.alpaca.markets/v2/assets and /v2/clock, and GET data.alpaca.markets/v2/stocks/quotes/latest and /v2/stocks/bars. No brokerage orders, account funding or positions endpoints. Feed is hardcoded iex; keys are server headers.
- Account-wide SQL quota reserves at most 180 requests/minute per SHA-256 key-ID fingerprint. Cache TTL: assets 1 hour, quote 5 seconds, clock 10 seconds, history 1 minute. Shared in-flight reads, capped cache; server-confirmed orders bypass quote/clock caches. 429 respects reset/backoff, 401/403 disables that connection until rotation, five transient request failures open a one-minute circuit. No provider-switch fallback; failure stays unavailable rather than relabeled live.
- Historical IEX daily/weekly bars explicitly use adjustment=all; end is 16 minutes before request time. At most 1,000 bars in the bounded period; an unexpected next page is labeled partial, not silently complete. This is adjusted analytical history, never execution price.
- workers/mccluster/src/finance/account.js values each order on the server from a fresh IEX bid/ask observation plus fresh regular-session clock, then appends one immutable event through SQL compare-and-swap. Exact ID retries return the saved result; changed retries fail. Watchlist uses the same persisted event stream. Each event retains source quote/instrument/timestamps; no client price, balance or owner accepted.
- docs/control-plane/sql/finance-market-draft.sql defines service-only owner-checked RPCs, owner/org rows with RLS, append-only event history and shared quota. Existing synthetic-v1 table/records are unchanged. Neither draft has been applied to production.

## Secure configuration after review and release authorization

1. Owner creates a free Alpaca Paper Only account through https://docs.alpaca.markets/us/docs/paper-trading and generates paper keys. This task does not create accounts or credentials.
2. For local private testing, use ignored workers/mccluster/.dev.vars (verify ignored before writing) or an approved local secret manager. Required names are APCA_API_KEY_ID and APCA_API_SECRET_KEY. Never put values in chat, source, screenshots or frontend env files.
3. For an approved hosted environment, use its secret dashboard or the repository-locked Wrangler CLI's interactive `wrangler secret put APCA_API_KEY_ID` and `wrangler secret put APCA_API_SECRET_KEY`, explicitly targeting the approved environment. Do not run these against production merely to try the PR. No new secret was installed here.
4. Apply the reviewed finance-market-draft schema through the approved migration workflow to the authorized staging target. Its owner checks depend on canonical orgs/org_members and existing Supabase service binding. The synthetic draft is required only for the legacy developer harness.
5. Set FINANCE_DEV_ENABLED=true, FINANCE_PERSISTENCE_ENABLED=true and FINANCE_ALPACA_ENABLED=true in that approved environment after confirming personal-use access. Existing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY remain server-only. No MARKETS_PROVIDER change is required: the new Finance component uses its dedicated read-only adapter; existing global Markets adapters remain independent.
6. Deploy only after separate authorization; log in as verified house owner. Check owner source/storage status, search AAPL, inspect IEX/timestamps, load history, preview/confirm a PAPER order during regular hours, reload, and test denial as non-owner. Absent or rejected credentials remain a visible error. Runtime is implemented now; real provider acceptance cannot be claimed before this test.

Alpaca official sources: https://docs.alpaca.markets/us/docs/about-market-data-api ; https://docs.alpaca.markets/us/reference/stockbars ; https://docs.alpaca.markets/us/reference/stocklatestquotes-1 . Basic is $0 with IEX venue scope. Hosting cost is unverified; no new paid resource is authorized. Future customer redistribution needs separate entitlements.

## Deliberate limits and remaining work

- Simulation fills immediately at the eligible observed bid/ask, rounded to whole cents; no subsequent-trade execution model, liquidity, slippage, commissions or taxes. No real-money execution. Quote age must be <=30 seconds and market clock <=15 seconds old.
- Whole shares, USD, active supported US listings, long-only, initial $10,000 paper cash. Maximum 30 watch symbols and 500 saved actions. Reset archives prior session in the event ledger and resets cash; it does not erase history or bypass capacity.
- Holdings spanning an Eastern calendar day are frozen for new orders while positions remain. The owner can archive/reset. Dividends, splits, delistings and other corporate actions are not automated. This bounded build is not yet a long-term paper-performance tracker.
- Holdings show cost basis, not an invented live portfolio total. Individual selected quotes can be inspected. Aggregate valuation, unrealized P&L and restoring selected context automatically on reload remain work.
- Country news and exchange geography exist; company ownership/boards/resource/supplier exposure and historical direct congressional filings are not populated. Foundation code has provenance/as-of/amendment tests, not collectors. Relationship graph integration and research evaluation remain future work, related to existing evidence-graph draft #408.
- Owner diagnosis and server activation flags are usable. No credential UI, delegated configuration writes, billing/member release or new administration framework. Member Travel/Missions gates are not reactivated.
- Browser uses fixture identity/provider transport with real local PostgreSQL, not live authentication/provider verification. The loopback harness MUST NOT be exposed as a hosted preview. Device-accessible staging requires approved identity, isolated configuration/storage and explicit deployment authorization.

## Review coordination

Base main 4fc32c84970d1a5cbc69c2df218e700bcea14032 checked against origin before publication. No existing open Halo Finance PR found. Related #408 is research-graph scope, not an implementation dependency. Existing owner Games #726, city #736/#738 and PRIM3 #739/upstream #21 remain separate and unchanged. Coordinate shared js/action-globe.js, js/halo/halo.js and intel/router.js hunks at merge review; this branch does not import their code or alter city geometry.

## Reproduce verification

- `node --import ./workers/mccluster/test/support/offline-network.mjs --test workers/mccluster/test/finance-*.test.mjs workers/mccluster/test/world-markets.test.mjs scripts/test/halo-markets.test.mjs`
- `node scripts/finance-preview.mjs` uses already-installed postgres:17.6 with network=none, applies both drafts only inside that temporary container, verifies permissions and quota exhaustion/reset, and emits a loopback URL. Every price/security response is an explicit test stub; credentials are fictional constants.
- `CESIUM_DIR=<local Cesium Build/Cesium> FINANCE_PREVIEW_URL=<loopback URL> node scripts/e2e/finance-globe.e2e.mjs` loads actual globe/Finance code with all hosted traffic intercepted. Checks 390/1280, same document/viewer through trade, history labels, saved watchlist/order/reload and access-revocation clearing.
- Root `npm test`, Worker `npm test`, repo secret-scan workflow script and `git diff --check` are the broader checks. Actual results are recorded in the draft PR, not inferred from these commands.

## Main reconciliation and release-gate verification — 2026-11-04

Merged main `5b23c317abb41ab1cfa24f4f7ffc71b41efb7efe` normally into this branch; generated Chemistry sources are unchanged from main. No new Finance features or provider calls. Targeted checks pass 50/50; root tests pass 1,674 with three pre-existing skips plus seven Python tests; Worker tests pass 1,366/1,366.

New failure-path tests prove disabled/mistyped flags make no storage or provider calls, and absent quota SQL blocks provider fetch even with enabled flags and credentials. Finance flags remain unset in checked-in configuration. Both SQL files remain unapplied review drafts under docs, outside automatic migrations. Owner authorization, exact-string development/provider/persistence activation, credentials and quota schema are separate gates.

The composer CI partition retains all eight assertions and normal Playwright click behavior; its job passed on `11bbcb0b`. Full local editorial reproduction passed 533/533. That head's remaining editorial CI job was still active with no downloadable live log at publication preparation, so its completion and the refreshed merge-head checks must not be inferred. No assertion was skipped or weakened.

The code can be reviewed with Finance disabled; operating the feature still needs separately authorized SQL/configuration and deployment. Main has a static deployment workflow, so a future PR merge is not represented as operationally inert. This work does not authorize or perform that merge, deployment, production SQL, credentials or provider collection.
