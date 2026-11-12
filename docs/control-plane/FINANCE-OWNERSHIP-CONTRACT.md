# Ownership baseline contracts (development only)

`baseline.js` is a pure calculation boundary, not a live ownership integration.
It has no imports, requests, persistence, broker actions or order methods. It does
not import the paper account, paper valuation or dividend plan-eligibility paths.
No actual owner assets, contribution target or private evidence belong in checked-in
data. All test values are invented and confined to the test file.

## Trust boundary

Only a future authenticated, owner/org-scoped read from the canonical McCluster
Supabase data plane may supply `baseline`. Do not accept it from request bodies,
query parameters, UI state, directory entries, paper fills or generic import JSON.
The exact source labels below prevent accidental schema confusion; they are not
credentials and do not authenticate a caller. The validator checks structure and
consistency, not whether the user owns anything or whether a document is genuine.
There is no ingestion, evidence review or reconciliation implementation here.

The eventual store must reconcile lots/accounts into one row per stable listing,
check source authenticity, corporate actions, current ownership and scope. Existing
owner-only authorization and release gates must surround any integration. No
public/member release or financial execution is authorized by these helpers.

## Exports and units

- `validateOwnershipBaseline(input, { now = Date.now() })`: returns a new validated
  snapshot or throws `BaselineError` with a bounded `code`. Stale snapshots remain
  valid historical data; freshness gates are applied by the display helper.
- `ownershipBaseline({ baseline = null, marks = [], now = Date.now() })`: returns a
  clean `finance-ownership-display/v1` projection. `null` input means `unknown`, with
  null counts and value, never zero. Invalid input returns `invalid` without rows.
- `contributionPlan(input)`: pure target/progress and per-issuer planned-spend math.
- `portfolioWeights(input)`: pure comparisons, explicitly not a live valuation.
- Constants: `OWNERSHIP_SCHEMA`, `OWNERSHIP_SOURCE`, `BASELINE_POLICY`.

All amounts are nonnegative safe integers; owned quantities must be positive.
`quantity_microshares` means millionths of a share, not floating-point quantities.
Every `_cents` field means **one hundredth of its explicit currency**, including
JPY/KRW; it is not an ISO minor-unit exponent or a vendor-native unit. Adapters must
convert vendor units explicitly, without rounding an unavailable price into data.
V1 supports USD, CAD, EUR, GBP, CHF, AUD, NZD, HKD, SGD, JPY, CNY, SEK, NOK, DKK,
INR, BRL, ZAR, MXN, KRW, TWD and ILS; other codes require a deliberate extension.
There is no FX conversion. Values use exact BigInt intermediates and half-up
rounding once per position. Aggregate overflow returns no portfolio total.

## Strict ownership input

All keys below are required; undeclared keys, getters, non-plain objects, sparse
arrays and duplicate stable listing IDs are rejected. Arrays are capped at 20,000
rows each; they are never silently truncated.

- `schema`: `finance-ownership-baseline/v1`
- `source`: `canonical_owner_store`
- `source_id`: `mccluster:finance:ownership`
- `owner_id`, `org_id`: opaque scoped tokens, never account numbers
- `as_of`: valid UTC ISO timestamp, no future data
- `coverage`: `complete` or `partial`; only complete inventory can produce a total
- `currency`: reporting currency
- `corporate_actions_reconciled_through`: UTC ISO timestamp or `null`; the trusted
  store must have reconciled all corporate actions from the evidence through this
  instant. It must cover both the snapshot and each price observation. Unknown or
  incomplete reconciliation suppresses totals, even when statements are recent.
- `positions`: rows with `issuer_id`, `listing_id`, `currency`,
  `quantity_microshares`, `evidence`
- `pending_orders`: rows with `order_id`, `issuer_id`, `listing_id`, `currency`,
  `quantity_microshares`, `side` (`buy`/`sell`), `source_id`, `as_of`
- `watchlist`: rows with `issuer_id`, `listing_id`, `currency`

Issuer IDs are namespaced, e.g. `sec:<10-digit CIK>` or an opaque issuer namespace.
Listing IDs must identify a listing, never only a ticker: either
`sec:<10-digit CIK>|<exchange label>|<ticker>` (issuer must match), or an opaque
namespaced stable ID. Directory IDs are identifiers, not evidence of ownership,
market-data entitlement or tradability. Repeated issuer IDs across share classes
are allowed; conflicting issuer/currency definitions for one listing are rejected.

Evidence requires `type`, `reference_id`, `source_id`, `as_of`. References are
opaque private store IDs, not document content or URLs. Types are
`owner_attestation`, `custodian_statement`, `transfer_agent_statement`. Attestation
source must match `owner_id`; external sources use `custodian:` or
`transfer-agent:` namespaces. All three remain `evidence_verified: false` in this
module. A custodian/transfer-agent label is distinguishable from an attestation,
not a claim that this code authenticated the document.

Pending-order IDs must be unique and sources must be custody/transfer-agent
namespaces. Pending orders are never treated as filled holdings or subtracted
from current holdings. Watch candidates never become holdings. Current positions,
orders and watch candidates may refer to the same listing without being combined.

## Marks and display

Each mark requires exactly `schema: finance-listing-mark/v1`, `issuer_id`,
`listing_id`, `currency`, `price_cents`, `as_of`, `source_id: market-data:<opaque>`,
`feed`, and `status` (`real_time`, `delayed` or `end_of_day`). Source/feed identity
must come from the trusted provider adapter, not an end-user assertion.

The helper requires exact listing/issuer/currency matches, positive price,
real-time status, age <=30 seconds and no future timestamp. Baseline/evidence
age must be <=24 hours, and explicit corporate-action reconciliation must cover
the snapshot and quote. These are conservative development freshness limits, not
a claim of exchange session/calendar support. A closed-session old quote cannot
produce a current total. No FX, corporate-action processing, market entitlement
check or market provider adapter is implemented here.

`status` is `unknown`, `invalid`, `stale`, `partial` or `complete`.
`total_value_cents` stays null if any owned row is unvalued or inventory is partial.
Fresh individually marked rows may be shown when the overall total is unavailable.
`holdings_count`, distinct `issuer_count`, `pending_count` and `watch_count` are
separate. Display excludes owner/org IDs, evidence refs, order IDs and custody
source IDs. Evidence type/time and market source/feed/time remain visible.
The total is securities value only: it is not cash, net worth, cost basis,
unrealized gain, returns or an executable liquidation value.

## Contributions and weighting

`contributionPlan` requires `currency`, `target_cents`, `remaining_months`.
Optional `verified_contributed_cents` and `manual_contributed_cents` remain separate;
missing/null amounts remain unknown. Only reconciled canonical-store values may
populate the former; this function cannot verify them. Optional `issuer_spend`
contains unique `{ issuer_id, spend_cents }` planned rows, not settled transactions.
Remaining amounts are floored at zero. Monthly requirements use exact ceiling
division; zero months with unmet target returns null and `deadline_reached`.
Over-target contributions and planned spend are reported separately. No asset
value, ownership or expected returns are inferred.

`portfolioWeights` requires `method`, reporting `currency`, `constituents`.
Each constituent has `issuer_id`, `listing_id`, `currency`, with optional
`quantity_microshares`, `price_cents`, `market_cap_cents` as the method requires:

- `share_count`: quantity proportions, not comparable economic exposure
- `equal_share_price`: equal shares imply price-weighted dollar exposure
- `holding_value`: quantity times price
- `equal_dollar`: hypothetical equal-dollar target allocations, one row per issuer
- `market_cap`: one row per issuer, proportional to comparable issuer market caps

Missing required constituent data or unavailable FX returns null weights.
Duplicate listings always fail; duplicate issuers fail for market-cap and equal-dollar
weighting so cross-listings/classes cannot double-count issuer capitalization or
receive duplicate equal-dollar allocations. Exact fraction
numerator/denominator strings and largest-remainder basis points are returned;
basis points sum to 10,000 with stable listing-ID tie breaks. These comparisons do
not establish source freshness, complete market coverage, investability, future
performance or actual ownership. Buying one to three shares of many issuers is
not an equal-dollar or market-cap-weighted index.
