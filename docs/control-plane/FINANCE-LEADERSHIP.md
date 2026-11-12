# Finance company leadership and address layer

Status: preserved in draft [PR #803](https://github.com/mcclusterishere/mccluster/pull/803).
Not merged or deployed. The published baseline at `b33bd663` passed the actual
390/1280px Cesium module integration in [Finance CI](https://github.com/mcclusterishere/mccluster/actions/runs/43126463349).
No production migration, provider activation or investment action is included.
This builds on the existing Halo Finance implementation, not a new globe,
brokerage, identity service or database.

## Existing-work and data audit

Current main at the start of this work was `3ad888d798278045cc7437a2459f3f6a3461a327`.
It already includes the Finance globe panel, Alpaca adapter, server-valued paper
ledger, historical chart and portfolio valuation. The separate dividend-research
branch is not copied here. Repository reference data contained exchanges, but no
public executive/director dataset. A read-only canonical Supabase metadata query on
2026-11-11 found no finance/holdings/watchlist/issuer/leadership tables; the live
schema does contain the existing Intel and CRM tables. No private holdings or
brokerage ownership were inferred. The five companies are a public reference set,
not a persisted private watchlist or evidence of shares owned.

## Owner journey and architecture

The existing World mode bar gains **Finance** for the owner, alongside Travel,
Missions, News feed and E=UP. Other visitors retain their current modes. The module
waits for the existing globe's server-derived owner answer, then mounts the existing
Finance panel in the World content column. It uses the same Cesium iframe/viewer,
canonical Worker routes and existing authentication. The static mode preference is
not authorization; the Worker still applies the house-owner gate on every read.

Entering Finance places the five public company headquarters business addresses on
that globe. Select a company button or pin to read its executives/directors, source
links, date observations, coverage limits and scheduled changes. Locate focuses the
business address. Hovering a pin or using **Show financial snapshot** requests the
existing source adapter's single-symbol quote. Bid/ask, source/feed, market session,
status and as-of time stay attached. It is a snapshot, not a trade or guaranteed
real-time feed. Cached snapshots age into stale status after the source's 30-second
freshness threshold. Missing provider configuration stays unavailable. No price or
fundamental metric is fabricated.

Switching modes, denied access, session changes and page departure clear the panel
or pins as appropriate. Finance hides unrelated news/mission layers while selected.
The existing Halo Finance entry remains available; it consumes the same roster.
Private paper accounts and watchlists remain in the existing account path, and no
private ownership list is placed in checked-in reference data or public responses.

## Reference import and provenance

`data/markets/company-leadership.json` is the first reviewed public-facts import:

| Issuer | Unique people | Listed roles |
| --- | ---: | ---: |
| AMD | 32 | 33 |
| Chevron | 28 | 29 |
| Verizon | 19 | 20 |
| AEP | 32 | 33 |
| AT&T | 19 | 20 |
| Total | 130 | 135 |

The 35 sources include official issuer pages, SEC filings/submissions metadata and
business-address geocoding. SEC CIK and listing MIC identify each company; a ticker
or company-name coincidence is not enough. Scope includes the selected public
leadership and board pages, plus AEP's seven regional presidents. It is not every
employee, subsidiary officer or corporation in the market. The import is factual
names/titles/citations only: no copied biography/photo corpus, personal contacts,
homes, travel or executive-location inference.

Observation date is **2026-11-11**. An undated page's publication/as-of fields remain
null. A recently retrieved page is not a guarantee that every role is current.
After 30 days the API marks observed roles `review_due`; it never silently re-dates
them. Chevron's roster was available through an index of its official page after a
direct HTTP 403, explicitly disclosed in the source record; it was not verified by
bypassing that restriction. Announced January 2027 changes stay separate from the
observed roster, including the CFO transition. Proxy nominees are not assumed elected.

All five headquarters addresses were checked against SEC/company sources. AMD,
Chevron, Verizon and AT&T use exact normalized Census address matches with
**address-range-interpolated** coordinates. These are not surveyed rooftops. AEP
uses the OSM-mapped office building at 1 Riverside Plaza, with its exact source,
© OpenStreetMap contributors and ODbL attribution. Confidence describes address
matching, not survey accuracy. City/ZIP centroids are never substituted. No person
is geolocated from their employment.

SEC's public data and Wikidata's CC0 structured facts avoid a paid roster vendor,
but no complete/current executive-roster API was established. SEC submissions/XBRL
are not such an API. Official role pages still need extraction/reconciliation and
source-rights review. This implementation performs no automated collection and
makes no general commercial-redistribution claim for issuer page media/text.
Nominatim is not installed as a generic runtime lookup service. Licenses and source
caveats travel with the reference and are visible in its coverage details.

## Canonical API and controls

- `GET /v1/intel/finance/leadership` returns the reviewed company directory.
- `GET /v1/intel/finance/leadership?symbol=AMD&mic=XNAS` returns the evidenced roster.
- `GET /v1/intel/finance/leadership-quote?symbol=AMD&mic=XNAS` resolves only a covered
  listing and calls the existing quote adapter, checking returned instrument identity.

All require the existing owner gate and `FINANCE_DEV_ENABLED=true`; responses are
private/no-store. Quote reads additionally require the existing Alpaca flags,
credentials, permissions and shared quota infrastructure. No new secret or switch
is installed. Reference reads need no paid feed or finance-account schema.

The JSON is a versioned public reference like `data/markets/exchanges.json`, served
by the existing Worker. It does not become a second private financial datastore.
There is no new production table, automatic refresh job or import endpoint. For a
reviewed replacement, run the offline importer and review its diff:

```
node scripts/import-company-leadership.mjs reviewed.json
node scripts/import-company-leadership.mjs reviewed.json data/markets/company-leadership.json
```

The validator rejects unexpected fields, nested untyped metadata, personal-location
fields, mismatched SEC identity, unsafe sources, geocoder-only role citations, date
errors, duplicate listings and city-only coordinates. It checks structural/provenance
integrity, not the truth of a newly supplied document. A human source review remains
necessary. Revert the reference commit for recovery; no private history is rewritten.

## Verification and release gates

Passed locally: backend reference/auth/source/missing-key tests; actual Finance DOM
with a simulated Cesium API; repeated mode switches; latest-selection wins; access
revocation cleanup; cached quote aging; correct address/precision/citation rendering;
no writes/trades; news-layer isolation. Aggregate results are recorded in the handoff.
Local results on this review candidate:

- Root JavaScript: 2,491 total, 2,486 passed, 5 skipped, 0 failed.
- Worker JavaScript: 1,913 total, 1,904 passed, 9 skipped, 0 failed.
- Focused Finance: 39 passed, including the final identifier/source validation changes.
- Finance DOM and mode contracts: 9 passed.
- Root Python: 7 passed.
- Offline import: 5 companies, 130 people, 135 roles, 35 sources, 5 address coordinates.

DOM tests do not establish pixels, mobile overflow or real WebGL rendering.

The browser test `scripts/e2e/finance-leadership.mjs` is prepared for 390/1280px with
an actual Cesium viewer, intercepted network and fixture identity/quotes. It isolates
unrelated World modules and is a Finance/World-mode module integration test, not a
complete end-to-end product/authentication acceptance. Local Chromium launch was
blocked by the executor's socket restriction, including after a reviewed escalation.
The published baseline later passed that 390/1280px test in the CI run linked above.
The existing Finance workflow reruns the reference, DOM and actual browser checks
for subsequent changes; baseline evidence is not proof of an untested extension.

Before release: owner selects this candidate; reconcile the active Travel/Halo
branches against then-current main; run all exact-head CI, browser and full World
flows; verify 390px width and pin hover/tap, keyboard alternatives and mode teardown;
confirm actual owner/non-owner behavior; retain source attribution; then use the
normal coordinated Worker/static deployment. Provider configuration and database
rollout remain separate explicit steps. Until then this is not merged or live.
