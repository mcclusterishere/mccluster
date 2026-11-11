# Finance: review package and device-accessible preview path

> Historical checkpoint. For current implementation and coordinated activation, see [FINANCE-ROLLOUT.md](FINANCE-ROLLOUT.md). Earlier unimplemented/draft-only statements describe the original checkpoint, not current main.

Status: local work only. This document does not authorize publication or migration.
Correction, 2026-11-04: the navigation test below leaves the globe for a separate
Finance page. It proves component wiring and persistence, NOT the requested
in-globe Finance experience. FINANCE-HALO-ACCEPTANCE.md is the governing acceptance
checklist; this package must not be presented as completion of Halo integration.
The previous loopback URL is not reachable from Matthew's device. Do not present
it as a shared preview. `scripts/finance-preview.mjs` uses a fictional identity and
must NEVER be exposed through a public tunnel or deployed as an application.

## Concrete candidate

Owner globe World panel → Finance product entry → versioned exchange reference
with source descriptions → explicit synthetic order → private database commands
→ reload. Static reference is not live price coverage. All filing collectors and
member access remain disabled. The source references are carried from the existing
repository dataset, not freshly verified venue schedules. The simulator does not
model dividends, fees, tax lots, liquidity or corporate actions.

Owner operations currently available: inspect flags/source gates, diagnose storage,
reload portfolio, place a synthetic order. Missing: setting writes through Control,
delegated operator roles, billing, customer source grants and collector approval.

## Option A: isolated, access-controlled review preview (recommended next release)

1. Identify an existing authorized staging host/Worker environment and isolated
   database, with resource ownership, capacity and billing checked read-only first.
   `workers/mccluster/wrangler.toml` declares `workers_dev=false` and no staging
   environment; this checkout does not establish an already available public URL.
   Do not invent one or deploy the canonical production Worker as a preview.
2. Review the code and SQL draft, then authorize staging-only publication and
   staging-only schema application explicitly. If resources need paid provisioning,
   obtain separate cost approval; no new purchase is currently authorized.
3. Serve the existing globe/Finance assets on that isolated host. Bind the existing
   Worker code to staging identity/database configuration. Use real verified owner
   authentication or an approved access gateway, NEVER the local fixture identity.
   Keep member release and collection disabled. The preview must not connect to
   the production database, personal corpus, billing, jobs or vendor credentials.
4. Enable `FINANCE_DEV_ENABLED` and `FINANCE_PERSISTENCE_ENABLED` only in staging
   after schema and permission tests. Configure the Finance frontend API origin
   explicitly for staging (currently production host except on loopback); verify
   every other globe API destination as well. No hidden production fallback.
5. Verify owner login, globe entry, synthetic buy/sell, reload, denied non-owner,
   missing schema, quota bounds and network destination allowlist on the staged
   artifact. Return the actual authenticated HTTPS URL only after these pass.
6. Set expiration/removal date for preview and fixture portfolios. Disabling the
   Finance flags must block API reads/writes; removing a UI link is insufficient.

This option needs a small staging configuration patch after an actual host and
identity environment are identified. The local harness is not that patch.

## Option B: owner-only production release (separate, greater impact)

Exact schema candidate: `docs/control-plane/sql/finance-paper-draft.sql`.
Objects: `public.finance_paper_portfolios`,
`public.finance_paper_read(uuid)`, and
`public.finance_paper_append(uuid,integer,jsonb)`.
The table is synthetic-v1 only, owner/org scoped, RLS enabled, revoked from public,
anon and authenticated roles. Service-role-only SECURITY INVOKER functions check
current house-owner membership; writes enforce revision and unchanged prefix.

Before production approval:
- Generate a proper reviewed migration using the repository's migration workflow;
  check name collisions, actual membership types, grants/default privileges, RLS,
  service-role behavior, schema cache and function signatures against the full
  canonical schema. The isolated test database used minimal fixture org tables.
- Run database security advisors and production-shaped integration tests in
  staging. Service-role access is powerful; API authentication and function-level
  membership checks are both necessary. Do not grant customer table access.
- Review retention/backups, row growth (100 commands per portfolio in this slice),
  engine version stability, reset/archive behavior and recovery. Current persisted
  state is a command history, not a general investment accounting ledger.
- Approve schema application, Worker/static asset deployment and activation flags
  as distinct operations. No real trades, paid launch or member release included.
- Roll back by disabling flags first, then reverting application code; preserve
  saved records. Do not drop the table as an automatic rollback.

## Source/price approval boundary

No paid data needed for the synthetic review. Real securities paper trading is a
later release requiring an approved provider/license, personal versus customer
entitlements, feed scope/delay labels, stale/closed-session behavior and corporate
actions. House/Senate collection requires documented access/use permission and an
adapter; SEC's documented API access does not make its unbuilt adapter complete.
Never represent fixture quotes as real or use today's UI clock as their timestamp.

## Evidence commands

Run the five targeted Node suites documented in FINANCE-FOUNDATION.md, including
finance-portfolio.test.mjs. Run `scripts/finance-preview.mjs` for isolated PostgreSQL.
Then run `scripts/e2e/finance-globe.e2e.mjs` with CESIUM_DIR, FINANCE_PREVIEW_URL
(the printed loopback URL), and PLAYWRIGHT_DIR as appropriate. It intercepts all
hosted network requests, loads actual globe code/Cesium, and forwards only Finance
requests to the local database harness. Fixture auth is not production-auth proof.

Screenshots/tests are local review artifacts, not hosted previews. They may be
shared only through an authorized publication path. No deployment ran here.

## Verified result, 2026-11-04

`finance-globe.e2e.mjs` passed at 390px and 1280px: actual Cesium viewer/canvas,
actual owner Halo panel expansion and Finance link, owner storage diagnostics,
versioned static reference label, synthetic order saved through actual local
PostgreSQL, browser reload retaining the fill, non-owner denial, no page errors
and no horizontal overflow. Hosted APIs/auth were intercepted as explicit fixtures;
this verifies integration, not live identity configuration or market coverage.

The test caught a cross-document view-transition opt-in mismatch; Finance now
opts into navigation transitions consistently with the globe. The rerun passed.
Evidence files are `globe-390.png`, `globe-1280.png`, `finance-390.png`,
`finance-1280.png` and `results.json` in the local review archive's evidence folder.
The code unit/integration suite previously passed 41 tests; the subsequent change
is the UI transition setting and new full-globe test/review documentation.
