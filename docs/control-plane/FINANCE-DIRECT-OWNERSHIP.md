# Finance direct-ownership research directory

Status: review extension for draft [PR #803](https://github.com/mcclusterishere/mccluster/pull/803), not merged or deployed. This is a read-only extension of
Finance in the canonical Worker, not a brokerage, enrollment service, private
portfolio store or replacement for the separate Computershare plan-review engine.
No accounts are opened, securities ordered, money moved, credentials obtained or
private financial information published by this module.

## Canonical data and boundary

`data/markets/direct-ownership-routes.json` contains public primary-source research
observed on **2026-11-12**: **13 issuer routes**, **6 provider-directory entries** and
**3 market-system notes**. Those are sample counts, not coverage denominators,
provider inventories, provider rankings or claims of sector/exchange specialization.
A registrar's existence is not evidence of an issuer first-purchase facility.

Each route retains its provider role, issuer/provider/depositary sponsorship,
ordinary-share or ADR identity, new-investor access, source wording about U.S.
residents, registration description, minimums, fees, citations and caveats. Sources
retain both `documentDate` (null when unknown) and `verifiedAt` (retrieval/review
observation). An old document does not become current because it was retrieved today.

Only public issuer/plan facts belong in the JSON. No user holdings, accounts,
contribution targets, purchase budgets, private documents or investor eligibility
belong there. The reference is versioned with code and reviewed offline; replacing
it requires a reviewed repository diff. There is no import HTTP route, automated
collector, database write, external request on import or scheduled refresh.

`ownership-options.js` validates plain data before returning it. Unexpected or
missing fields, accessors, sparse arrays, coercible types, malformed dates, duplicate
route IDs, unsafe URLs and contradictory security/unit descriptions fail closed.
Only exact reviewed HTTPS publisher hosts are accepted. These checks protect
structure and provenance boundaries; they do not authenticate a document's truth
or independently verify its interpretation. New records still need human source
review. Reverting the reference change is the recovery path.

## View contract and identity

`ownershipOptionsView({ issuer_id = null, symbol = null, mic = null, now = Date.now() })`
returns `finance-direct-ownership-options/v1`. The module also exports
`validateOwnershipReference` and the 30-day review window. Explicit reference and
SEC-directory arguments exist for offline testing; HTTP clients must never supply
either reference object.

- No filter returns the catalog. `matching_basis` is `catalog_no_identity_join`.
- `issuer_id=sec:<10-digit CIK>` returns only recorded CIK matches. It does not
  resolve a live listing, certify eligibility or combine share classes into one
  security. Each route retains its distinct security and registration fields.
- Symbol filtering requires **both** symbol and MIC, and cannot be combined with
  issuer filtering. Only exact `XNYS → NYSE` and `XNAS → Nasdaq` mappings are
  implemented. The existing validated SEC listing snapshot must identify one CIK;
  the route's recorded CIK **and** ticker must match. A separate ticker belonging
  to the same issuer cannot inherit common-share terms. No `CBOE` label is guessed
  into `XBTS` or `XCBO`.
- Missing-CIK routes remain visible in the catalog with `issuer_id: null` and
  `identity_status: unresolved_for_sec_join`. An ISIN/home-listing description is
  retained when evidenced, but is not silently converted into SEC identity.
- Air Liquide's Euronext Paris `AI` route must never attach to NYSE `AI` (C3.ai).
  Likewise, the Euronext TotalEnergies route is not automatically a NYSE route,
  and Sony's ADR route is not a Japanese ordinary-share plan.

The top-level status is `available`, `not_covered`, or `identity_unresolved`.
Unknown results contain no matched routes, set `needs_review: true`, and explain
why. Absence means insufficient reviewed coverage, not proof a plan does not exist.
Symbol/MIC results carry `identity_snapshot` with SEC source URL, retrieval time and
SHA-256. This is dated issuer association evidence, not a current tradability or
listing/plan identity guarantee.

The view includes `reference_date`, `generated_at`, sample counts, limitations,
interpretation notes and the preserved source records. Provider-directory and
market notes remain separate even in issuer-filtered responses. Returned data is
cloned, so consumer mutation cannot change the bundled reference.

The parent Finance router must apply its existing house-owner authorization,
`FINANCE_DEV_ENABLED` gate, GET-only method handling, strict query-key/duplicate
checks and private/no-store response policy. The pure helper provides no access
control by itself. Reference reads need no provider key or Finance database schema.
Existing public static source files contain only the intentionally public research.

## Eligibility, registration, dates and units

Every view and route states `userEligibility: not_assessed`; ownership is
`not_asserted`. A source's `newInvestorAccess: yes` does not establish that a specific
person can enroll. `yes_general_public` is general-public wording, **not explicit
U.S.-resident acceptance**. Residence, identity, tax, banking, first-share and other
conditions still need current review. Manulife's already-registered one-share
requirement is not a first-share purchase facility.

Registration descriptions are deliberately separate:

- `plan_nominee_with_drs_exit`: plan holdings use a nominee, with an evidenced DRS
  exit/withdrawal route; whole shares and fractional balances need separate handling.
- `plan_book_entry_details_unverified`: plan book entry alone does not establish
  pure direct registration. This remains unverified even after recent retrieval.
- `registered_plan_shares`: registered plan balances with their own plan conditions.
- `pure_registered`: an issuer/registrar registered ordinary-share account route.
- `registered_adr`: registered depositary receipts, not direct registration of the
  foreign ordinary shares underlying those receipts.

`evidenceFreshness` uses the oldest required source observation. At 30 days it
becomes `review_due`; future observations are `future_observation`. Corresponding
`registrationEvidence` also expires. All states remain non-live and
`current_terms_verified` / `current_registration_verified` remain false. Dated
terms older than a year, and the source's `current_offer_older_terms` flag, remain
`older_terms_require_review` even when retrieval is recent. Undated document dates
stay null. The one-year display warning and 30-day observation window are
conservative review reminders, not legal expiry dates or live validity guarantees.

Minimums use a finite nonnegative `amount` with explicit `unit: currency` and an
ISO-shaped currency code, or a positive whole-share count with
`unit: whole_share` / `existing_whole_share` and `currency: null`. Null minimums
remain unknown. Fee descriptions preserve source wording and caveats rather than
claim to be an executable fee calculator; numeric enrollment fees retain their
source-stated currency context. Null costs are not zero/free. Fixed fees can make
small purchases expensive, independently of an issuer's purchase minimum.

## Existing plan-review authority

The separate dividend-research work already contains authenticated Computershare
review controls and a private eligibility adapter. This public directory neither
imports nor replaces them, writes an approval, seeds a verified investor record,
nor converts its research labels into authoritative eligibility. Any future
multi-provider execution or authoritative plan-review workflow requires its own
reviewed integration with the canonical private store and current user permissions.

## Verification

Focused tests cover all 13 records, CIK/MIC filtering, the Air Liquide/C3.ai
collision, absent CIKs, conflicting snapshot identities, alternate same-issuer
share classes, fees/nulls, share versus monetary units, existing-holder conditions,
ADR versus ordinary shares, sponsorship, XSS/unsafe sources, strict JSON structure,
date coercions and evidence/registration expiry. Import and view calls run with
network access disabled. The test does not prove current source terms, live owner
authentication, rendered mobile layout, account opening or trading.

Run from the repository root:

```sh
node --import ./workers/mccluster/test/support/offline-network.mjs --test workers/mccluster/test/finance-ownership-options.test.mjs
node --import ./workers/mccluster/test/support/offline-network.mjs --test workers/mccluster/test/finance-*.test.mjs
```

Publication, exact-head integration tests, browser review, merge and deployment are
separate release steps. None is implied by a passing pure-module test.

## Integration and verification

The existing owner Finance panel mounts this directory alongside the company
roster and market baseline, using the same canonical Worker and viewer. Its
existing saved research watchlist can select a route only after the market
response supplies a supported listing MIC. Directory and roster buttons use CIK.
No second watchlist, private holding assertion, signup or purchase is created.
Provider, domicile and source-described registration filters are available.
All routes retain document/retrieval dates and unknown fee fields.

The ownership module has 22 backend tests, including owner/feature-flag/cache
boundaries and invalid route parameters. Four new DOM tests cover units, fees,
ADR distinctions, identity collisions, denial/redaction and both within-panel
and cross-component stale-response races. The actual Cesium workflow checks the
13-route catalog, Japan ADR filter, issuer links and denied cleanup at 390/1280px.
CI must pass on the published extension before claiming browser acceptance.
