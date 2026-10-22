# OVH Global Market Intelligence — Layer 1: Observe

Status: **implemented on feature branch; production activation intentionally blocked pending approval and observed health checks.**
Scope: verified structured observations, source provenance, retention and replay. This phase **does not**
produce predictions, recommendations, order requests, brokerage connections or autonomous trading.
Use the canonical OVH Core/Supabase/Worker/Control plane; no new database or Worker.

## Existing pipelines reused without duplication

- World news: GDELT GKG -> `media_news_articles` via `WORLD_NEWS_INGEST_ENABLED` (15-minute source files, Worker cron).
- Earthquakes: USGS -> existing `ops_ingest_*` / `intel_evidence` collector.
- World Bank WDI: the owner-only Worker indicator explorer remains unchanged. The OVH collector writes **bounded periodic observations** of selected WDI metrics to the existing `ops_ingest_records`; it does not replace the inspector or scrape article bodies.
- Morning briefs, Halo, World news, production OVH reconcile, PR release train #509 and incident #510 remain untouched.

## New OVH collectors

The systemd timer invokes `core/src/market/layer-one.mjs` every 15 minutes. Every collector is gated by an operator flag, an approved policy migration, its configured credentials and its own cadence.
A missing credential reports `blocked`, not successful collection.

| Connector | What is recorded | Minimum interval | Admission |
|---|---|---:|---|
| `market.wdi` | GDP level/growth, population, CPI inflation, unemployment, trade share from WDI; actual year | 24 h | Keyless; default WLD, US, CN, IN, DE, JP, GB, BR; up to 12 validated economies |
| `market.bls` | U.S. CPI-U index, unemployment rate, nonfarm jobs by published month | 24 h | Keyless unregistered BLS v1, one request/day; max 25 unregistered requests/day |
| `market.eia` | U.S. weekly crude field production and crude inventories including SPR; true week-end date | 6 h | EIA registered API key (`EIA_API_KEY`); no key stored in records or logs |
| `market.sec` | 8-K/10-K/10-Q/20-F/6-K filing notice metadata by exact CIK | 1 h | Explicit CIK allowlist and declared SEC User-Agent with operator contact |
| `market.alpaca.iex` | Most recent 1-minute IEX stock/ETF bars for at most 10 symbols | 15 min | Alpaca key pair **and** explicit market-data storage/licence review flag |

WDI annual statistics are **not live**. BLS period-end timestamps are the *reference month*, not the original release timestamp. SEC filing notices use the filing date (no invented acceptance timestamp). Alpaca's IEX view is **not** consolidated real-time U.S. market coverage, and stale bars retain their true observed time.

World news location mentions are not event coordinates or validated event facts. The GDELT news collector stores metadata, not licensed publisher article bodies.

## Canonical persistence contract

Each new source is an `ops_ingest_connectors` row with the publisher, attribution terms, internal-use distribution policy and retention duration. A run uses **existing** `ops_ingest_begin_run_service`, `ops_ingest_write_record_service`, `ops_ingest_finish_run_service` RPCs.

Each observation stores stable external id, typed record, value and unit, genuine period or observation timestamp, official source, retrieval time, source status and effective licensing policy. Payloads do **not** include retrieval timestamps; changing source values produces a distinct content hash, while re-fetching the same value is idempotent. Run state and cursor are committed together only after all accepted writes; failed reads keep the previous source cursor.

A discovered platform integration is not a live source. Existing data must always be labelled `existing_pipeline`, `stale`, `blocked`, or `unverified` based on observed database state, never marketing copy.

### Mandatory DB safety repair before activation

The **existing production** `private.ops_ingest_ensure_connector` presently overwrites `retention_policy` and `license_policy` with `{}` when the canonical record-writer upserts an existing connector. That violates provenance retention. This branch includes the narrow pending migration:

`supabase/pending/20261022015000_market_layer1_preserve_source_policy.sql`

It preserves source policies when the inner writer supplies empty policy objects and creates a service-role-only `market_layer1_policy_ready_service` sentinel. Until that migration is **reviewed, approved and applied to the canonical production Supabase project**, the Layer 1 job exits `blocked: policy_migration_not_applied` before **any** source registrations or writes. Do not set the activation flag as a substitute.

The rollback companion intentionally deactivates the market connectors without bringing back the unsafe policy-reset implementation or deleting audit history. Post-migration test: register a source with a nonempty license/retention policy, write a fixture observation inside a rolled-back transaction, and assert both the connector and record retain the policies. Check DB advisors, grants, service-only execution and schema/production ledger parity before promotion.

## Operator controls

Environment variables (names only, no credentials in Git):

- `MCCLUSTER_MARKET_LAYER1_ENABLED=true` — enables ingestion *after* migration validation; defaults OFF.
- `MCCLUSTER_MARKET_ECONOMIES=WLD,US,CN,IN,DE,JP,GB,BR` — vetted economy codes, up to 12.
- `EIA_API_KEY` — optional registered U.S. Energy Information Administration credential; never stored in the database.
- `MCCLUSTER_MARKET_SEC_CIKS` and `MCCLUSTER_MARKET_SEC_USER_AGENT` — declared identity, up to eight CIKs. No SEC calls without both.
- `MCCLUSTER_MARKET_ALPACA_STORAGE_APPROVED=true`, `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY` — optional private market data. No calls or credentials stored in observations without review.
- `MCCLUSTER_MARKET_SYMBOLS=SPY,QQQ,TLT,GLD,USO` — validated list, at most ten names.

No FRED ingestion is added; FRED API terms require separate review for use in AI workflows. Comtrade, IMF, international exchanges and deeper country coverage remain source-catalog research, **not represented as connected collectors**. Source approvals and data licenses are per dataset; no feed is implicitly licensed for public redistribution or model training.

Commands on the OVH host:

```bash
# Native deployment paths per MCCLUSTER-CORE.md
node /opt/mccluster/core/src/market/layer-one.mjs --status
node /opt/mccluster/core/src/market/layer-one.mjs --source=market.wdi
node /opt/mccluster/core/src/market/layer-one.mjs --source=market.wdi --replay

sudo install -m 0644 core/systemd/mccluster-market-observer.service /etc/systemd/system/
sudo install -m 0644 core/systemd/mccluster-market-observer.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mccluster-market-observer.timer
systemctl list-timers mccluster-market-observer.timer
journalctl -u mccluster-market-observer.service --since today --no-pager
```

Those commands are documented acceptance steps, **not evidence they have run**. The unit runs as the existing unprivileged `mccluster-core` identity with the existing restricted Core environment file. It adds no unauthenticated port, no shadow memory database, and no model access to provider credentials.

## Quality checks and measurable acceptance

1. `npm test --prefix core` including `core/test/market-layer1.test.mjs`; format/syntax checks.
2. Readiness tests prove opt-in for credentialed sources, refusal of untrusted URLs/redirects, bounded HTTP bodies, exact geography/units, genuine observation timestamps, no leaked keys.
3. Database-backed proof of policy preservation before enabling live records. Migration must be approved and recorded; no orphan migration in the production ledger.
4. Live OVH pilot: one successful WDI run and BLS run (plus EIA when the key is provisioned), with nonempty `ops_ingest_records`, explicit provenance/policies, `ops_ingest_runs` completion and a working `--status` report; repeat a replay and confirm unchanged records are not duplicated.
5. Failure drill: simulate an upstream HTTP 5xx; verify failed run status, unadvanced cursor, no fabricated observation, no source credential in logs, and recovery on the next interval.
6. After admission and observed health, measure freshness, completeness and source coverage, plus storage and compute pressure, before increasing economy/market breadth.

This is *Layer 1 observation infrastructure*, not predictive or profit-guaranteeing software. Layer 2 will attach verified event semantics, entity resolution and contradictory evidence; Layer 3 can then model economic exposures; only later phases can backtest hypotheses and paper-trade.
