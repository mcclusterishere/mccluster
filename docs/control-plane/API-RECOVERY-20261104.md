# API recovery audit: October 5–November 4, 2026

The audit found useful implemented integrations, overlapping unmerged work,
and unfinished services. Missing credentials are **not** a reason to stop building
adapters, disconnected UI, fixtures or reviewable code. They also are not the only
remaining dependency for domains, rides, voice or customer publishing.

## Evidence and coverage

- Canonical main fetched and inspected: `4fc32c84970d1a5cbc69c2df218e700bcea14032`.
- [Machine inventory](API-RECOVERY-20261104.json): 254 fully paginated branch names,
  89 open PR search results, selected exact branch heads and related-repository PRs.
  Branch names alone do not establish equivalence, shipping or implementation.
- Reused the [November 2 recovery inventory](https://github.com/mcclusterishere/mccluster/blob/17ed110d52a425c1570e67fbbdc6308d7b064559/docs/productization/20261102/PR-INVENTORY.md),
  [current source snapshot](https://github.com/mcclusterishere/mccluster/blob/17ed110d52a425c1570e67fbbdc6308d7b064559/docs/productization/20261102-current/SNAPSHOT.md),
  and [Claude's newer handoff](https://github.com/mcclusterishere/mccluster/blob/18efd235528b9281b39924bc3f96d954b0f325ad/docs/productization/20261102-claude/HANDOFF.md).
  September's branch ledger is historical context, not today's branch disposition.
- Personal Context returned unavailable. The room-history fallback was searched
  for API, recovery, travel, social and finance, following returned pagination.
  Relevant explicit requests: October 26 creator cross-posting and owned-site
  offers; November 3 event prospecting and city/game follow-through; November 4
  Halo financial geography, paper-only Alpaca, complete wiring without keys, and
  this recovery audit. Raw conversations are deliberately not copied into Git.
  Retrieval does **not** establish exhaustive access to all prior conversations.
- Owned repo listing and PR searches included Seek-First, Prim3, Whip-Equipped,
  Driver, Rentals and Mnet. Read the current Seek-First, Prim3 and Whip README
  surfaces. This is not an exhaustive code audit of every owned satellite.
- No production database, deployed secrets, current account entitlements or
  authenticated browser runtime was inspected in this task. Historic production
  claims in earlier handoffs are attributed historical evidence, not fresh proof.

## Prioritized recovery inventory

| Priority / workstream | Request evidence | Main / branch evidence | Real remaining dependency and next step |
|---|---|---|---|
| P0 Halo Finance | Explicit Nov 4: finance inside Halo/globe, charts, paper portfolio/orders, secure Alpaca connection | Main #689, `workers/mccluster/src/intel/world-markets.js`, `intel/router.js`, `js/action-globe.js`: GDP, exchanges, listings, quotes and news. Finnhub/EODHD selectors exist. | Alpaca paper/chart/portfolio integration is a separate active task. Missing key blocks authenticated data, not code. Keep owner gate, paper-only endpoint and source times. Do not count the detached finance demo as delivery. This audit does not claim the active task's unpublished code. |
| P0 BLS economic observations | Inferred recovery candidate supporting explicitly requested geographic financial context; no separate BLS feature request found | Main canonical Seek First BLS adapter required `BLS_API_KEY` before any request | **Recovered in this change:** optional key; v1 keyless access; v2 when key supplied; per-request series/year bounds; real provider errors remain failures. Existing authenticated gateway and Control source inventory consume this adapter. No new Finance tab or BLS chart UI is claimed. |
| P0 owner/self-service | Explicit Oct 26 owned sites and Nov 4 owner-first controls | #681 at `5e020833`; recovery branch `17ed110d`; Claude frontend `18efd235`. Existing editor and canonical backend preserved | Reconcile latest combined source once; pending schemas, real Auth/Storage, revision recovery and browser acceptance. Do not merge 18 ancestor PRs individually. Keep this with active owner/admin task. Keys alone do not create missing tables or CAS behavior. |
| P1 Instagram cross-posting | Explicit Oct 26 creator/business multi-platform posting and in-context composer | Main social engine; #624 → #628 → #634, consolidated #681/recovery; actual OAuth, Vault, queue and delivery contracts on branch | Meta app/scopes/callback, pending SQL, atomic tenant/module gates, sandbox OAuth and publishing proof. Existing branch covers Instagram Professional Reels, not every social network. Preserve World posting when provider unavailable. No new parallel scheduler. |
| P1 Connecticut weather | Existing adopted regional-weather contract; inferred recovery review, not a new request to activate | Merged #733 (`e114bc4e`), Core decoder/job, owner Worker route, `weather-desk.html`; [runbook](CONNECTICUT-WEATHER.md) | No provider key needed. Runbook records ingest off; actual host not inspected. Verify Core promotion, timer and bzip2, then approved activation and snapshot freshness. Globe weather overlay remains integration work; don't report main as live. |
| P1 navigation / traffic | Existing October owner Travel direction in AGENTS and travel runbooks | Main `travel-routing-provider.js`, `travel-routing.js`, quota object, globe/GPS UI. #617 is a separate old UI fix, not the entire feature | TomTom adapter is already fixture-tested. Key is `TRAVEL_TOMTOM_API_KEY`, not Halo's `TOMTOM_API_KEY`. FOSSGIS pilot already offers a keyless path under its terms. Provider capacity, private trip handling and actual runtime proof remain. |
| P1 open/research data | Inferred from geographic data request and existing source registry | Canonical source registry, gateway, verified EPA/Data Commons adapters; owner Control `analytics-unified.js` reads source/readiness routes | Preflight enumerates required/optional bindings and adapter kind. No-key data, configuration-only terrain, and academic license lanes must stay distinct. Validate each provider separately before scheduling. Do not buy keys for data already available without one. |
| P1 City / Arcade | Explicit Nov 3–4 city camera/map, game and storyline work | Main #722 city, #725 Arcade, #731 institutions. Open #736 camera, #738 streaming, #726 Games overlay | Geometry, performance, mobile interactions and game integration; not API-key blockers. Active City/Arcade tasks own these files. #726 head `2f46f611` remains unmerged in this snapshot. |
| P1 PRIM3 | Explicit Nov 4 tactical/game improvement | Main #706 games and #710 Level Forge; #739 `e53b27e5` active; upstream Prim3 #21 active | Gameplay, stairs/camera/interaction acceptance and cross-device save prerequisites. #694 is a donor superseded by #710 for the canonical Forge, not a second independent missing game. Preserve #739/upstream #21. |
| P2 market ingest | Branch objective; related to financial research, not the same as paper trading | #600 `e7b0fc26`, `feat/ovh-market-layer1-ingestion-20261021`: Core observation adapters and health tool | Branch notes a destructive policy-reset defect in existing connector RPC plus storage rights and default-off timer. Reconcile schema semantics before activation; do not implement a second Alpaca adapter blindly. |
| P2 domain registration / storefront | Explicit Oct 26 owned-site offers; existing platform scope | #637 `f06fb545`, consolidated recovery; #679 marketplace; current canonical commerce | Registrar charge/registrant readback, renewal/refund/terms, payment identities and sandbox proof remain. API key alone is insufficient. No purchase, charge or production SQL authorized here. |
| P2 Whip rides / rentals | Existing satellite product and branch scope; no new ride launch requested | Canonical `workers/mccluster/src/whip/*`; satellite PR4s and old #453 | Operational launch, driver consent/schema, provider service and payment verification. A route/ride handoff is not dispatch. Satellite Whip README still names retired `mccluster-core`; canonical `AGENTS.md` overrides it. Do not resurrect that Worker. |
| P2 full-duplex voice | Existing branch objective, not a newly inferred API-key task | #619 `1e3f7b4c`, default-off broker and Moshi reference | Branch explicitly says Dessa has no callable public protocol; GPU/WSS gateway and browser codec/UI absent. This is service/implementation work, not a missing free key. |
| P2 event prospecting | Explicit Nov 3 event platforms, venues and organizer acquisition | Existing CRM/ops architecture; no completed provider-to-CRM ingestion was proven by this audit | Find permitted sources and dedupe/qualification contract, then build draft review. Don't imply Eventbrite/Meetup general event access exists or send outreach. This remains a scoped discovery/implementation follow-up. |

## What was built here

The BLS adapter is reached through the existing `POST /v1/seek-first/fetch/bls`
gateway. Authorization and entitlement checks are unchanged. Without a key it
uses the official v1 endpoint; supplying `BLS_API_KEY` selects v2. It rejects
requests above 25 series/10 inclusive years unregistered or 50/20 registered,
instead of silently slicing inputs. Default span is three inclusive years.
Redirects are refused, reads are bounded to 2 MB and a 12-second abort covers the
fetch/body. HTTP-200 provider failures and incomplete series do not become false
successes. Output drops raw provider bodies, preserves period and footnote codes,
and labels timestamps as reporting-period starts rather than release times.
Monthly, quarterly and half-year periods use their first calendar day; A01 and
annual averages (M13/Q05/S03) use January 1 of the reported year. Original period
codes and period kind survive persistence. Unsupported period codes fail closed.
This meets the existing archive's NOT NULL timestamp contract without SQL; storage
rejects missing BLS timestamps instead of falling back to today's fetch date.
Missing numeric observations remain null instead of becoming zero. The regression
exercises the real owner-gated HTTP handler, default persistence and archive read
against provider/PostgREST fixtures, not a live database. Existing previously
stored rows are not rewritten by this change.

The source catalog now describes `BLS_API_KEY` as optional. Existing Control →
Analytics setup source inventory can show that keyless availability; no new
global navigation or separate dashboard was added. The new local
`scripts/integration-readiness.mjs` additionally rehearses all registered sources,
markets, Travel and weather without network access or credential values.
The [connection manual](API-CONNECTION-MANUAL.md) supplies official links,
binding names, quota distinctions, validation and rotation steps.

Limits: BLS daily quota remains provider-enforced (25 unregistered / 500 registered);
there is no shared account-wide local daily limiter or new cache in this slice.
Use bounded manual reads, not a new poller. Numeric units are not invented when
the series response lacks them. No provider request or production enablement was
performed, and the source list is not a new BLS chart experience. [Official BLS
limits](https://www.bls.gov/developers/api_faqs.htm) and [v1 contract](https://www.bls.gov/developers/api_signature.htm).

## Verification and release handoff

- New readiness fixtures: six tests covering disconnected state, optional and
  partial credentials, secret-value exclusion, invalid selectors and zero fetches.
- BLS, all canonical Seek First suites and readiness: 117 passing.
- Existing markets, Travel and world-layer suites: 55 passing.
- Existing Core weather suite: 20 passing.
- These are local Node/fixture proofs, not provider, live database or browser
  acceptance. No schema migration is introduced.
- Pinned Wrangler 4.131.1 `deploy --dry-run` passes against the canonical
  entrypoint. This compiles/packages locally without upload; it is not workerd
  runtime or provider verification. Local cache/config paths were redirected
  to writable scratch directories; no dependency or lockfile was changed.

Review this bounded slice against current main. Keep Finance, owner/admin,
City/Arcade, Chemistry, missions and PRIM3 modifications in their existing tasks.
Re-fetch main and task heads before integration. Merge/deploy, production
migrations, credential changes and scheduled ingest need their separate release
authorization. This audit does not declare the full 30-day backlog completed.
