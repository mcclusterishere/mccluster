# Finance inside Hitman's Halo — corrected acceptance contract

> Historical checkpoint. For current implementation and coordinated activation, see [FINANCE-ROLLOUT.md](FINANCE-ROLLOUT.md). Earlier unimplemented/draft-only statements describe the original checkpoint, not current main.

2026-11-04. Planning and code audit only in this correction; no runtime build or release performed. This supersedes any interpretation that a link from the globe to finance-dev.html completes integration.

## Product and primary journey

Finance is a product variation of the shared globe template, alongside Music/PRIM3 and other products. In the actual Halo globe, choose Finance → search a real security or select a geographic news/event/exchange feature → inspect company, evidence, exposure and sourced price history → preview a paper buy/sell → submit → see holdings/cash on that same globe → reload and retain portfolio and selected context. The globe remains mounted throughout. No navigation to a detached finance page, no copied globe and no static concept standing in for the application.

First release is owner-only. Detailed private research, contacts, portfolios and licensed datasets never become member data merely because the reusable product core later supports members. $6/month/module is a future pricing proposal; no checkout or customer release is part of this work.

## Audit: what actually exists

| Surface | Evidence | Actual state |
|---|---|---|
| Globe Markets | js/halo/markets.js; js/halo/halo.js | Existing exchange pins, country/GDP/market-news panel, paged listing search and company selection inside actual Cesium globe. Provider-backed data requires credentials and permissions. |
| Price observations | js/halo/markets.js; workers/mccluster/src/intel/world-markets.js | Up to 120 selected-security observations at one-minute visible polling; not historical bars. Finnhub/EODHD adapters exist, but no configured keys verified. Provider coverage strings need reconciliation with verified account entitlements. |
| Finance entry | js/halo/halo.js:645 | Anchor navigates to finance-dev.html. Fails required in-globe interaction. |
| Paper persistence | workers/mccluster/src/finance/paper.js, portfolio.js; intel/router.js | Owner-gated, idempotent, revision-checked persisted commands. Synthetic DEMO only, 100 commands, one holding; not a real-security paper engine. |
| Research foundation | workers/mccluster/src/finance/foundation.js | Normalization/provenance/amendment/as-of logic with fixtures. No live disclosure collector, entity graph, board/ownership or exposure dataset. |
| Owner controls | /v1/intel/finance/control; js/finance-dev.js | Read-only flags, storage diagnosis and portfolio reload. Provider configuration/refresh writes and delegated roles missing. |
| SQL | docs/control-plane/sql/finance-paper-draft.sql | Tested only in isolated local PostgreSQL fixture schema. Not a production migration; not hosted/applied. |
| Browser evidence | scripts/e2e/finance-globe.e2e.mjs | Earlier 390/1280 test proves real globe → separate Finance document → synthetic save/reload, with fixture auth/network. It does NOT prove same-globe order flow, hosted identity, live prices or history. |
| Hosting | workers/mccluster/wrangler.toml; FINANCE-RELEASE-REVIEW.md | workers_dev=false, no staging environment established in checkout. Local harness is fixture-authenticated and must not be exposed. |

Previously recorded verification: 41 focused tests pass; local SQL denies anon/member; browser checks pass at 390/1280. Those are prior evidence, not rerun or expanded by this audit. No device-accessible authenticated preview currently established.

## Acceptance checklist

All boxes below are unmet or only partial unless explicitly described above. A no-data screen is honest behavior, but cannot pass the actual-data acceptance milestone.

- [ ] Finance mounts through existing globe/product navigation. Keep the same Cesium viewer, camera, geographic selection and shared shell. Replace the detached link with an in-globe activation action; retain finance-dev only as a developer harness if needed.
- [ ] Existing Markets country/exchange search becomes the Finance discovery panel. Add broad US symbol/name search without requiring users to know an exchange; retain stable instrument + MIC + currency identity. International coverage is incremental, not an invented global-live promise.
- [ ] Company selection highlights explicitly typed locations: listing exchange, headquarters, operating asset or sourced exposure. Never treat listing country as all operational exposure.
- [ ] News/events retain source URL, publication/event/first-seen times and confidence. Geographic associations and industry/resource/supply relationships show evidence and dates; inferred relationships are distinguishable from reported facts.
- [ ] Price chart uses a permitted provider and real source-timestamped historical bars with period/session/adjustment labels. Display live venue-limited, delayed, stale, unavailable and market-closed states accurately. The 120-observation chart is not renamed history.
- [ ] Order ticket remains in the globe: selected instrument, side, quantity, indicative price/age/feed, estimated cash effect, explicit PAPER label, preview and confirmation. No order if price is unsuitable. No provider brokerage order calls.
- [ ] Persist multi-instrument paper orders/fills/positions/cash with idempotency and concurrency checks, server-selected quote evidence and immutable execution assumptions. Client cannot supply trusted price/owner/balance. Reload and another owner session reconcile correctly; member/direct API access fails.
- [ ] Keep synthetic DEMO portfolios separate from real-market simulation by engine/schema version; never silently reinterpret existing records. Synthetic fixtures may prove mechanics but do not fulfill real-security acceptance.
- [ ] Mark holdings and show cash, cost basis, realized/unrealized results and source ages. Handle splits/dividends or block affected simulation until supported. Document spread/slippage/fees, market session behavior and no-short constraints; do not imply executable NBBO from IEX-only quotes.
- [ ] Provide historical ownership, legal/beneficial/voting distinctions, boards/current-former roles, public corporate contact channels and evidence-linked corrections. No private contact inference/outreach. Unknown values remain unknown.
- [ ] Disclosures preserve owner uncertainty, reported value ranges/options, transaction/filing/public-availability/first-seen times and amendment lineage. Direct collection remains disabled until source access/use is verified. No copied Quiver data/code or inference of misconduct.
- [ ] Long-horizon reports use as-of evidence, retrieval with citations and explicit uncertainty. Walk-forward evaluation includes delisted securities/constituent changes, corporate actions, costs and benchmarks. Predictive claims require evaluation; no promises of trade profits.
- [ ] Owner controls are delivered with each capability: source status/entitlement, bounded refresh/pause, quota/error health, portfolio reset/archive and audit history. Controls use existing control plane; do not postpone the usable journey for a complete generalized admin framework.
- [ ] Preserve member Travel/Missions retirement and existing News/Music/PRIM3 behavior. Owner legacy mission controls are not permission to reactivate member products. Verify product gates at actual navigation entry points before any nav edit.
- [ ] Same-globe E2E asserts unchanged document/viewer identity from search through fill/reload; 390/1280 layouts; denied member; expired token; quota exhaustion; missing schema; ambiguous retry; provider outage; stale quote; listing collision; corporate-action basis; no production-network leakage.

## Build sequence and coordination

1. Finance UI work: extend js/halo/markets.js and its stylesheet; replace only Finance entry behavior in halo.js. Reuse portfolio service, error states and idempotent pending-command behavior from js/finance-dev.js rather than embed the whole standalone document. First local milestone is in-globe fixture flow clearly labeled synthetic, plus unavailable-data behavior.
2. Data work: add permitted Alpaca IEX adapter/history path and capability/quota registry at existing world-markets boundary after secure owner connection. Correct hardcoded provider coverage assertions. Test fixtures first; actual bounded source test only after authorization. Existing listing/profile adapters remain useful where entitled.
3. Ledger work: version the synthetic-only command model into an independently tested real-security paper model; keep old records intact. Extend persistence SQL as a reviewed staging candidate. Wire chart → ticket → holdings within Markets panel. Do not claim completion by merely pointing the DEMO engine at a real ticker.
4. Research work: progressively attach sourced news/entity/exposure/disclosure views to the same selected instrument/geography. Full graph/history is retained scope, not a precondition for the first usable trade. The pilot is a verification sample, not a 10–15-company product cap.
5. Owner task interface: existing identity, source configuration, flags and audit controls; coordinate changes in shared router/nav with Finance before editing. City task interface: shared camera/selection and typed geographic places only; no city geometry, furnishing, game or building changes required for Finance. Parent should route these interfaces to active owner/city sessions; this audit has not contacted or restarted those sessions. Reserve shared halo.js/router.js edits to one integrator to avoid parallel overwrites.

## Device-accessible isolated preview: exact release path

The result must serve the actual action-globe assets and canonical Worker Finance/Markets routes, not a screenshot/static concept and not the fixture harness behind a tunnel.

1. Read-only inventory must identify a permitted isolated environment of the canonical deployment, actual HTTPS hostname, real owner authentication configuration, storage isolation, capacity and billing. No staging hostname/resource is established here; do not invent a new competing backend. Repository AGENTS.md requires canonical Worker/control plane/shared data authority. Any proposed separate staging database/environment topology needs explicit approval consistent with that rule.
2. Prepare environment config with one explicit staging API origin throughout globe and Finance. Fail closed if missing; no default to api.mccluster.org. Use the existing verified auth path with server-side owner membership and tight CORS/origin allowlist. Gateway authentication alone cannot replace API authorization.
3. Apply the reviewed paper schema only to the authorized isolated staging target. No production DB, corpus, service credentials, billing, ingestion jobs or trading credentials. Run permission/concurrency tests against production-shaped schema, not just minimal fixtures.
4. Stage the actual integrated globe assets and canonical Worker build with owner-only flags. Keep customer activation/collection disabled. Use synthetic data only if visibly labeled; label that release a mechanics preview, not accepted market-data functionality. Add authorized personal provider keys later via secrets for the real-data acceptance test.
5. Test owner login on the actual HTTPS host/device, same-globe symbol search/history/order/holdings/reload, outsider/member denial and network allowlist. Deliver URL only after verification. Record build revision, configuration, data mode and expiry; rollback disables API flags and preserves records.

Required approval, after the target and review package are concrete: staging-only code/asset publication, precise staging schema application, owner identity/access configuration, and any provider secret installation plus bounded data test. These are not approvals for production migration/deployment, paid feeds, real trades or public/member release.

Costs: local fixture testing requires no new paid service; recommended Alpaca Basic data has a published $0 tier, subject to permission. Hosted preview incremental cost is UNKNOWN until actual existing capacity/plan is inventoried; no $0 hosting claim or paid provisioning authorized. If capacity is unavailable, report an exact quote and resource scope before requesting spending approval.

Current blocker status: no denied operation, no attempted deployment. Integrated UI, real-security paper engine, historical adapter and hosted preview configuration are still missing. Provider credentials/collection authorization and staging target/publication/schema approval are pending. This checklist does not mark them complete or request blanket approval before the code is reviewable.
