# Finance market coverage and ownership baseline

Status: local review candidate, not published, merged, deployed or connected to real
positions. This extends the existing owner-only Finance World mode and canonical
Worker. It does not place orders, enroll in purchase plans, import private assets,
activate data feeds, create credentials or apply a database migration.

## Existing work reused

The existing Halo Finance panel already provides an owner-authenticated Alpaca IEX
quote/history adapter and an explicitly paper account/valuation path. The company
leadership/address work adds five sourced public business-address pins and 130
people with 135 roles. That layer remains separate from any actual ownership list.

This candidate was reconciled onto main `8e631683b6960fee283ea923c22b1d72cfd09495`,
including the selected Halo, owner navigation and Travel work. It does not replace
the Travel heading/follow or address-gesture logic. Separate unmerged dividend
research work already implements SEC fundamentals and evidence-reviewed direct
purchase-plan logic; this extension does not invent another plan-eligibility engine.

## Source-backed market reference

`data/markets/sec-listing-directory.json` preserves every normalized association
from the [official SEC ticker/exchange file](https://www.sec.gov/files/company_tickers_exchange.json):

- 10,414 listing associations and 8,009 distinct SEC CIKs.
- Source exchange labels: Nasdaq 4,356; NYSE 3,262; OTC 2,568; CBOE 44; TXSE 12;
  exchange missing 172. Labels are not MIC codes.
- Retrieved 2026-11-11T01:55:54.772162+00:00. Retrieval is not the effective time of
  every listing. No source modification timestamp was supplied.
- Raw source SHA-256: `362d80f1387acd3ade83c874b9c82b7d20b361547da60cf306726aca169c7c56`.

The SEC [describes the scope and limitations](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data):
associations support filing lookup, are periodically updated, and do not carry an
accuracy/completeness guarantee. They include more than operating-company common
stock. CIK is a filing-entity ID, not a tradable instrument or global company-group
identity. Ticker/exchange tuples are snapshot identities, not permanent security
identifiers. OTC and missing-exchange entries remain visibly separate.

The owner dashboard paginates and filters this reference. It never calls these
10,414 rows eligible stocks, private watch candidates or holdings. A zero-result
search does not prove a company is unavailable. No coordinates are invented for
the larger directory; only the separately verified business addresses get pins.

`data/markets/sector-research-pilot.json` adds 18 examples spanning 11 independent
research buckets: communications, consumer essentials, discretionary consumption,
energy, finance, health care, industrials, materials, real estate, technology and
utilities. These are editorial groupings informed by sourced SEC SIC and business
information, **not licensed GICS/ICB classifications, a formal index or representative
market weights**. Per-row filings, SEC submission URL/hash, observation date and
coverage limits remain attached. All ownership and purchase eligibility are unknown.

Six examples are foreign issuers' US securities, not full foreign-market coverage:

- ASML: Nasdaq ordinary registered shares, not ADRs.
- NVO: ADR representing one B share.
- TM: ADS representing ten ordinary shares.
- SAP: depositary share/receipt representing one ordinary share.
- RY: common shares, also listed in Toronto, not ADRs.
- TSM: ADS representing five ordinary shares.

Ratios come from the cited filings and require fresh corporate-action checks. Do
not double-count a home listing and US receipt as two companies. A receipt is not
the same as directly registering the underlying home-market ordinary shares.
Unknown domestic security types/countries remain null rather than being inferred.

## Eligibility is still a separate evidence gate

A complete investable universe requires current listing/instrument status,
security-type exclusions, primary/secondary listing reconciliation, corporate
changes, access/residence restrictions and the specific buying route. Exchange
availability, broker eligibility and issuer direct-purchase-plan enrollment are
three different assertions. An issuer link to a transfer agent proves none of them.

Direct-plan minimums, subsequent-purchase amounts, fees, residency conditions and
new-investor access must come from dated issuer/transfer-agent terms. Reuse the
existing reviewed plan controls when that lane is selected and integrated. No plan
has been marked eligible by this directory import. Whole/fractional support and
retail minimums cannot be derived from an exchange's standard round-lot size.

Official expansion sources identified but **not bulk imported or licensed here**:
[Nasdaq definitions](https://www.nasdaqtrader.com/Trader.aspx?id=SymbolDirDefs),
[NYSE directory](https://www.nyse.com/listings_directory/stock),
[Cboe listings](https://www.cboe.com/us/equities/market_statistics/listed_symbols/),
[JPX issues](https://www.jpx.co.jp/english/markets/statistics-equities/misc/01.html),
[TSX directory](https://www.tsx.com/en/listings/listing-with-us/listed-company-directory),
[LSE reports](https://www.londonstockexchange.com/en/reports/issuers-and-instruments),
and [HKEX securities](https://www.hkex.com.hk/Services/Trading/Securities/Securities-Lists?sc_lang=en).
Public availability is not blanket bulk-redistribution or live-price permission.
Nasdaq's specific Events Data exception must not be generalized to every product.
SEC access policy requests a genuine identifying User-Agent and caps fair-access
requests at 10/second; deployed ingestion should cache/back off and never bypass
blocking. This candidate performs no automatic collection.

## Private actual-ownership model

`workers/mccluster/src/finance/baseline.js` is a strict pure contract for a future
canonical, authenticated and owner-scoped store reader. It is not an ingestion API,
evidence authenticator or new datastore. Only public reference JSON is checked in.
See the [ownership contract](FINANCE-OWNERSHIP-CONTRACT.md)
for the exact private schema and reconciliation gates.

- Separate positions, pending orders and watch candidates. Pending shares do not
  contribute to owned value. A paper fill never becomes an actual position.
- Evidence distinguishes owner attestation, custodian statement and transfer-agent
  statement. A label or valid JSON does not verify ownership.
- Stable issuer/listing/currency identities, fixed-point quantities, source as-of
  times and opaque evidence references are mandatory. No account numbers or secret
  credentials belong in the record's display projection.
- Missing baseline has null counts and value, not zero assets. Missing, stale,
  mismatched, incomplete or unsupported-currency marks prevent a total.
- Market data, corporate-action reconciliation and holdings dates must agree.
  The contract does not invent FX rates, cost basis, total return or cash balances.

Production persistence remains the canonical Supabase project and existing owner
identity. Before enabling actual imports, design/review its private tables or
existing canonical model, owner/org access policy, append-only evidence revisions,
lot/account reconciliation, correction/revocation flow and explicit owner controls.
No public static asset or browser storage may become the actual-positions source.
Private documents should remain private; do not place statements in this repository.

## Owner controls and dashboard behavior

`GET /v1/intel/finance/dashboard` returns reference coverage plus an explicitly
unknown actual baseline. There is deliberately no configured actual-position store
adapter. `GET /v1/intel/finance/universe` accepts bounded search/scope/exchange/page
filters; `GET /v1/intel/finance/economy` reuses the existing key-free World Bank
adapter for annual US GDP context. All use the existing house-owner gate,
`FINANCE_DEV_ENABLED`, and private/no-store responses. POST is unsupported on these
new routes. No user-selected owner ID or source URL is accepted.

The Finance panel now starts with ownership status and reference coverage. Search,
sector examples and pagination are read-only. Its contribution scenario runs only
in memory and stores/sends no entered goal or contribution amount. Session changes,
401/403 and teardown clear results and entered amounts. Existing paper trading is
visibly labeled separately. No real trade is proposed or submitted.

The scenario separates contribution principal from returns: remaining contribution
goal divided by remaining months, rounding up cents. An illustrative per-issuer
amount shows a maximum count before fees/price changes, not an affordability or
eligibility claim. No private goal is embedded in public code.

One share per issuer gives price-weighted initial dollar exposure. Varying share
counts create quantity-times-price weights. Equal-dollar and market-cap weighting
are different methods. A fixed share count across tickers cannot establish broad
market representation; duplicate listings, industry counts, size, currency and
receipt ratios matter. The pure weighting helpers reject missing constituents and
unavailable conversions rather than showing a deceptively complete result.

## Freshness and economics

IEX venue quotes retain source/feed/as-of/session/status. They are not consolidated
US quotes, a global feed or a license for every listing. Automatic polling and a
whole-market live-valuation feed are not enabled. Missing configuration stays
unavailable, and cached real-time labels age into stale state.

Stock prices, GDP, inflation and employment are different signals. The existing
World Bank GDP adapter provides annual observations, with period and retrieval time
both visible and `is_live:false`. BEA GDP, BLS CPI/employment and foreign official
series have separate publication calendars; links alone are not connected feeds.
Actual portfolio performance requires reconciled positions, cash flows, valuations,
corporate actions and FX before showing comparable returns.

## Verification and release

Local source validation, pure contract tests, owner/flag/route denial tests and
actual-DOM lifecycle tests cover this extension. Final local results:

- Root JavaScript: 2,510 total, 2,505 passed, 5 skipped, 0 failed.
- Worker JavaScript: 1,943 total, 1,934 passed, 9 skipped, 0 failed.
- Focused Finance backend: 69 passed, including 24 ownership-contract tests.
- Dashboard, roster and mode DOM/contracts: 15 passed.
- Python: 7 passed; syntax, workflow YAML and diff checks passed.
- Independent review confirmed normalized directory/source equality, source hash,
  and all 18 pilot submission hashes/CIKs/SICs/filing dates.
- Wrangler 4.156.0 local dry-run packages the canonical Worker successfully, about
  940 KiB gzip. A dry-run performs no upload or deployment.

 The previous real Chromium test
could not launch because of the executor's socket restriction, including after a
reviewed escalation. DOM tests do not prove WebGL rendering or mobile overflow.

Before release: user selects the candidate, inspect then-current main, run exact-head
CI and actual browser/full World tests, verify 390px layout, all five address pins,
hover/keyboard alternatives and denied-session cleanup, then follow the coordinated
Worker/static release path. Source data is a dated review snapshot; updates require
validated diffs and source review. Roll back code/reference commits for recovery.
No migration, provider activation, account enrollment or purchase is implied by a
successful source import or code release.
