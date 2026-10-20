# Halo intel implementation map and Seek First retirement plan

Status: design record, 2026-10-15. Nothing in this document is deployed,
applied, deleted or disabled. Companion: `INTEL-TO-MISSION-CANON.md` (the
schema and loop this map points at).

Owner direction (2026-10-15): Hitman's Halo is its own product and the
globe becomes the product's front door. **Seek First is retired as a
product.** Its useful first-party capabilities are absorbed into Halo and
shared McCluster services. No replacement standalone Seek First console is
to be built.

Tags: **[code]** read in source at the commit below · **[test]** ran locally ·
**[db]** SELECT-only aggregate against Supabase `zmnhbrjyhxzhkxmhkexs` ·
**[workerd]** reproduced in local workerd · **[inf]** inference.

## 1. Commit baseline

| | |
|---|---|
| Audited commit | `8be51f5` (= deployed `deployment_sha` per the 2026-10-15 audit) |
| `origin/main` when this map was written | `8be51f5edf458075ab128b3549ce9066df539dc2` (`git fetch origin main`, 2026-10-15) |
| Delta | **none**: zero commits between the audited commit and `main` |

Every file and line reference below is at `8be51f5`.

## 2. Audit findings re-checked

| Audit finding | Result | Evidence |
|---|---|---|
| The 19 `seek_first_*` tables were never migrated | **Verified** | [db] `pg_tables like 'seek_first%'` = 0. [code] They exist only in `supabase/replay_migrations/20260909034000…20260910234500_spatial_*.sql` (5 files); `supabase/production-ledger.json` (308 entries) contains no `spatial`/`seek` entry. `store.js` `schemaReady()` probes `seek_first_sources`, so stored-data routes answer `spatial_schema_not_ready`. |
| `archive.js` is unused; R2 `SEEK_FIRST_ARCHIVE` is bound but nothing writes | **Verified** | [code] No `src/` file imports `seek-first/archive.js`; only `test/seek-first-archive.test.mjs` does. `env.SEEK_FIRST_ARCHIVE` is read only inside `archive.js:64`. Binding: `workers/mccluster/wrangler.toml` `[[r2_buckets]]`. R2 object count not readable with these tools. |
| Other dead modules: `catalogs.js`, `planetary.js`, `registries.js`, `decision-intelligence/*` | **Verified** | [code] No `src/` importer; each has a test file only. |
| No geo/intel ingestion cron | **Verified, with one addition** | [code] Worker cron `*/5 * * * *` (`wrangler.toml`) runs: `entry-platform.js` (Equity Uprise scheduled posts, live-session reaper, rate-event prune) then `entry.js` `scheduled` (observability prune, fal cost reconciliation, social variant attach, Instagram health/publish/insights, clipping settlement). No geo/intel job. [db] Addition: one pg_cron job exists, `mccluster-ops-maintenance` every 15 min (not geo). |
| `ai_context.*` holds 0 rows, including `decisions` | **Verified** for `decisions` | [db] `ai_context.decisions` = 0; `ai_context` has 10 tables. |
| `eu_claims`, `ops_fact_claims`, `research_sources` hold 0 rows | **Verified** for `ops_fact_claims` and `research_sources` | [db] both 0. |
| `action_missions` 37 rows | **Verified** | [db] 37. **Addition:** `action_proofs` = **0** rows (0 verified). No member has a reviewed proof yet, which matters to the CCTV gate (owner rule: CCTV only after an approved mission proof). |
| `action_missions` schema has no link to decisions/claims | **Verified** | [db][code] Columns: id, campaign_id, title, description, domain, difficulty, base_points, proof_required, verification_mode, skills, capacity, status (`draft/open/paused/closed`), starts_at, ends_at, created_at, updated_at, kind. No org_id, no decision link. Table-level `select` grant to `anon` (`20261002061056_action_network_gamification_v1.sql`). |
| Decision routes exist (`/v1/ai/decisions`) | **Verified** | [code] `src/ai/router.js`: `GET/POST /v1/ai/decisions`, `POST /v1/ai/decisions/:id/status` (approved/rejected), all forwarding the owner's own bearer token to the Edge Function `context-decision`, which checks `org_members` owner/admin and writes `ai_context.decisions` (`approved_by`, `approved_at`). `ai_context.decisions` has no Data API grants, not even for `service_role`. |
| Three overlapping evidence/claim designs (#408, #414, #416) | **Verified, plus a fourth** | [code] #408 head `853ecdc`: pure graph projection `decision-intelligence/graph.js`; #414 head `3d7eece`: `research_evidence_snapshots/research_claims/research_claim_evidence` (pending file put in `supabase/migrations/pending/`, not the repo's `supabase/pending/`); #416 head `98f1c0f`: `halo-evidence-graph.js` + infrastructure adapters. **Fourth:** `supabase/pending/20261011190000_decision_intelligence_evidence_v1.sql` is already on `main` (landed with #407), unapplied ([db] schema `decision_intelligence` absent). Resolved in `INTEL-TO-MISSION-CANON.md`. |
| `/internal/seek-first` lacks Cloudflare Access | **Verified (config)** | [code] `SEEK_FIRST_ACCESS_REQUIRED = "false"` in `workers/mccluster/wrangler.toml`; data routes are owner-gated by `requireHouseOwner`. |
| The Cesium ion token is consumed only by the owner console | **Verified in code** | [code] `CESIUM_ION_TOKEN` read only by `seek-first/index.js` `viewerConfig()` (owner-gated `GET /v1/seek-first/viewer/config`) and listed in `source-registry.js`. Whether the secret is set: **unverified** (owner-only route). |
| Mission pins depend on unapplied `action_globe_demo_pins_v1.sql` | **Verified** | [code] the file is in `supabase/pending/` and its README entry says "Pending". |
| "142/142 Worker tests pass" | **Corrected** | [test] `npm test` in `workers/mccluster` at `8be51f5`: **607 tests, 607 pass, 0 fail** (node 22.22.0). The audit number was a different count. |
| World flights `unavailable` because of OpenSky upstream | **Corrected (cause)** | See §3: every adapter fetch in this Worker uses `redirect: 'error'`, which workerd rejects before any request is sent. |

## 3. New findings (not in the audit)

1. **`redirect: 'error'` breaks every Seek First adapter and every World
   layer fetch in production.** [workerd] With wrangler `4.131.1` and the
   Worker's own `compatibility_date = "2026-09-02"` + `nodejs_compat`,
   `new Request(url, { redirect: 'error' })` throws `Invalid redirect value,
   must be one of "follow" or "manual" ("error" won't be implemented since it
   does not make sense at the edge; use "manual" and check the response status
   code)`; `manual` and `follow` are accepted. Occurrences [code]:
   `src/seek-first/adapters.js:97` (`providerFetch`, used by ~30 adapters),
   `src/seek-first/verified-adapters.js:34`, `src/world-layers.js:47`. Unit
   tests replace `globalThis.fetch`, so they never see it. This is the same
   defect the audit found in Halo's Cyber Networks layer. [inf, strong] It is
   why World flights read `unavailable:true, count:0`, and satellites/launches
   will fail the same way for signed-in members. Fix (separate PR, owner of
   World layers): `redirect: 'manual'` and treat any 3xx as an upstream
   failure. The intel collector in the vertical slice already does this.
2. `supabase/migrations/20261005063813_canonical_ai_context_decisions_v1.sql`
   keeps the dollar quoting exactly as production recorded it (`do $ … $;`),
   which plain `psql` does not parse; the `replay_migrations/` copy does. Local
   rebuilds must use the replay copy (the repo's
   `scripts/supabase-local-reset-with-replay.sh` already overlays it).
3. `ops_ingest_connectors` / `ops_ingest_runs` / `ops_ingest_records` are
   applied and in use ([db] 16 connector rows, 36 records, 0 runs), org-scoped,
   idempotent (`unique (org_id, connector_id, idempotency_key)`), and carry
   `cursor`, `license_policy`, `retention_policy` and run status
   `running/succeeded/partial/failed`. They are the right home for source
   registry rows, run checkpoints and source snapshots; the canon reuses them
   instead of migrating `seek_first_sources` / `seek_first_ingestion_runs`.

## 4. Seek First dependency inventory (at `8be51f5`)

### 4.1 Worker routes

| Surface | Where | Auth | Live behaviour |
|---|---|---|---|
| `GET /v1/seek-first`, `/v1/seek-first/health` | `src/index.js` → `src/seek-first/index.js` | public | `mode: adapter-ready` (no schema) |
| `GET /v1/seek-first/{sources,entitlements,readiness,viewer/config,capabilities}` | `seek-first/index.js` | owner (`protectedContext`: Access if configured, then `requireHouseOwner`) | work without schema; `viewer/config` releases `GOOGLE_MAPS_API_KEY` / `CESIUM_ION_TOKEN` values to the owner |
| `POST /v1/seek-first/{fetch,ingest}/:source` | `seek-first/index.js` → `gateway.js` → `adapters.js` / `verified-adapters.js` | owner + entitlement lane | adapter fetch throws in workerd (§3.1); persistence needs schema |
| `GET /v1/seek-first/live/ais`, `POST …/live/ais/restart` | `seek-first/index.js` → Durable Object `HereTenantAgent` (`/internal/seek-first/ais/*`, `here-tenant-agent.js:353,365`) | owner | needs `AISSTREAM_API_KEY` |
| `GET /v1/seek-first/{nearby,events/nearby,timeline,bbox,entities,entities/:id,entities/:id/history,projects,layers,ingestion-runs}` | `seek-first/index.js` → `store.js` | owner | `spatial_schema_not_ready` |
| `GET/PUT /v1/seek-first/governance/*` (policies, policy, query, audit, audit/verify, transparency, retention) | `seek-first/index.js` → `governance.js` + `store.js` | owner | need schema |
| `GET /internal/seek-first` | `src/index.js` serves `seek-first/console.html` (text module, rule in `wrangler.toml`) | Access only when configured; shell has no data | owner Cesium console |
| `GET /v1/equity-uprise/halo-globe` | `src/index.js` → `seek-first/equity-uprise-halo.js` | public, role-tiered | **keep**: Floor 6 public projection of display metadata |

### 4.2 Bindings, secrets and vars (names only)

- R2: `SEEK_FIRST_ARCHIVE` → bucket `seek-first-archive` (`workers/mccluster/wrangler.toml`; local shim `workers/mccluster/host/shims/r2.mjs`, `host/server.mjs:52`).
- Vars: `SEEK_FIRST_ACCESS_REQUIRED = "false"` (`wrangler.toml`).
- Secrets read by Seek First code: `SEEK_FIRST_ACCESS_TEAM_DOMAIN`, `SEEK_FIRST_ACCESS_AUD` (`access.js`); `CESIUM_ION_TOKEN`, `GOOGLE_MAPS_API_KEY` (`viewerConfig`); adapter credentials declared in `source-registry.js`: `CENSUS_API_KEY`, `EIA_API_KEY`, `DATA_COMMONS_API_KEY`, `BLS_API_KEY`, `FRED_API_KEY`, `LL2_API_TOKEN` (optional), `FIRMS_MAP_KEY`, `COPERNICUS_CLIENT_ID`, `COPERNICUS_CLIENT_SECRET`, `PLANET_RESEARCH_API_KEY`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` (shared with `world-layers.js`), `TOMTOM_API_KEY`, `AISSTREAM_API_KEY`, `MAPBOX_ACCESS_TOKEN`.
- Durable Object: `HereTenantAgent` instance `seek-first:ais:mccluster` (the class must stay exported regardless).

### 4.3 Database

- `supabase/replay_migrations/20260909034000_spatial_intelligence.sql`, `…034100_spatial_observation_idempotency.sql`, `…040000_spatial_entity_history.sql`, `20260910230000_spatial_bitemporal_and_resolution.sql`, `20260910234500_spatial_governance_and_audit.sql` (never applied).
- Applied catalogue rows: `seekfirst.data` API product (`20260913024201_mnet_notifications_and_api_catalog_expansion.sql`) and scope `seekfirst:read` (`20260913035004_platform_api_scope_entitlements.sql`).

### 4.4 Front end and auth pages

- `auth/seek-first-start.html`, `auth/seek-first-handoff.html` (owner sign-in handoff to the console on `api.mccluster.org`).
- `js/control-room-v2.js:90,92` (Control Room tiles "Hitman Halo" and "Spatial Intelligence" both open `auth/seek-first-handoff.html`).
- Comments only: `js/tabbar.js:552`, `src/auth-handoff.js:11`, `src/world-layers.js:13,27`.
- Not Seek First (scripture "seek first", Matthew 6:33): `closet/seek-first.html`, `data/prayer-closet.json`, `data/scripture/matthew-6.json`, `docs/prayer-closet.md`, `scripts/smoke.mjs:348,1068`. **Do not touch.**

### 4.5 Tests and CI

- `workers/mccluster/test/seek-first-{archive,bootstrap,catalogs,console,entitlements,governance,planetary,registries,runtime}.test.mjs`, `network-spatial-sources.test.mjs`, `halo-projection.test.mjs`, `company-site.test.mjs:74` (handoff page 404 on the company host), `scripts/test/signup-authority.test.mjs:128`.
- No workflow names Seek First; the suites run inside the generic `npm test --prefix workers/mccluster` jobs (`mcp-continuity-ci.yml`, `reconciliation-ci.yml`).

### 4.6 Docs and hosts

- Docs: `docs/control-plane/SPATIAL-INTELLIGENCE.md` (its "What is live" overclaims a store that is not migrated), `SEEK-FIRST-PRODUCT-ARCHITECTURE.md`, `SEEK-FIRST-CLOUDFLARE-HANDOFF.md`, `SEEK-FIRST-COST-AND-ELIGIBILITY-LEDGER-2026-09.md`, `PLATFORM-API.md`, `MCCLUSTER-CORE.md`, `DECISION-INTELLIGENCE-IMPLEMENTATION.md`; Equity Uprise building canon references the Halo/Seek First capability (`HALO-GLOBE-SPATIAL-INTELLIGENCE-SPEC.md`, capability map, floor routing JSON). The building canon is geometry/program authority and is **not** edited by this plan.
- Hosts: only `api.mccluster.org` serves `/v1/seek-first/*` and `/internal/seek-first`. Root `wrangler.toml:31` comments on the console text module. The separate `mcclusterishere/seek-first` repo (stale GEV fork, 19 ahead / 1,093 behind per the audit) has no DNS of its own.

## 5. Retirement and absorption plan

Nothing is deleted or disabled by this PR. Each step below is its own
reviewed PR.

### 5.1 Absorb into shared McCluster services / Halo

| Capability | Goes to | How |
|---|---|---|
| Source registry (keys, class, persistence, attribution, credential binding names) | shared intel source registry | Move `source-registry.js` to a neutral module (for example `src/intel/sources.js`), add `license`, `commercial_ok`, `public_display`, `cadence` per source, and seed `ops_ingest_connectors.license_policy`/`retention_policy` from it. The vertical slice starts this with one source (USGS). |
| Entitlement lanes and the licensing firewall (`entitlements.js`) | shared intel service | Keep the rules; enforce them at collector time (never persist a `transient`/`none` source) and at projection time (only `public_display` sources reach members/public). |
| Adapters (`adapters.js`, `verified-adapters.js`) | shared intel collectors, one per source, behind flags | Port one at a time into the checkpointed collector pattern (begin → fetch with `redirect:'manual'` → commit/fail). Fix §3.1 first. |
| Governance purpose binding + sealed audit chain (`governance.js`) | shared governance helper | Reuse for any future query lane over people-adjacent data; the intel canon's purpose limits (`INTEL-TO-MISSION-CANON.md` §6) are the first consumer. |
| Provenance stamping (`store.js provenance()`) | `ops_ingest_records.source_ref` + `intel_evidence` publisher/URL/license/hash | Done in the canon. |
| Raw archive (`archive.js`) | collector option | Wire to R2 only when a source's terms allow raw retention; key `raw/{source}/{date}/{sha256}`, pointer in `ops_ingest_records.source_ref`. Keep the `SEEK_FIRST_ARCHIVE` binding name until a rename PR. |
| AIS live cache (Durable Object) | Halo layer via the canonical API | Keep transient; no persistence (commercial terms). |
| Owner console Cesium/Google viewer config | Halo (prime.mccluster.org) owner mode | The owner globe moves to Halo. Browser keys stay owner-released, scoped and referrer-restricted; never baked into a public bundle. |
| `/v1/equity-uprise/halo-globe` | stays | It is the Floor 6 public projection, not Seek First the product. Move the module out of `seek-first/` in the rename PR. |

### 5.2 Replaced

- `seek_first_*` stored-data model (entities/observations/events/beliefs, 19 tables): **replaced** by `ops_ingest_*` (snapshots, runs, checkpoint) + `intel_*` (evidence, claims, briefings, decision basis, mission links, outcomes). Do not apply the five spatial replay migrations. If an entity/bitemporal model is needed later, design it against measured demand on top of `ops_ingest_records`.
- `/v1/seek-first/ingestion-runs` and `/v1/seek-first/stats` (proposed by the audit): replaced by `GET /v1/intel/health`.
- Control Room tiles pointing at `auth/seek-first-handoff.html`: replaced by Halo links once Halo's owner mode reads the canonical API.

### 5.3 Retired (later PRs, in this order, each reversible)

1. Docs: mark `SEEK-FIRST-PRODUCT-ARCHITECTURE.md`, `SEEK-FIRST-CLOUDFLARE-HANDOFF.md` and `SPATIAL-INTELLIGENCE.md` "retired, see HALO-INTEL-IMPLEMENTATION-MAP.md"; correct the "What is live" overclaim.
2. Owner console: once Halo owner mode is live, `/internal/seek-first` returns 410 with a pointer; delete `console.html`, `auth/seek-first-*.html` and the Control Room tiles in the same PR, with their tests.
3. Routes: `/v1/seek-first/*` answer 410 `seek_first_retired` (health stays one release for monitors), after the absorbed modules have their own routes under `/v1/intel/*`.
4. Dead modules: delete `catalogs.js`, `planetary.js`, `registries.js` and their tests (or port if a collector needs them); `decision-intelligence/graph.js` (#408) is not merged.
5. Secrets: remove `SEEK_FIRST_ACCESS_TEAM_DOMAIN`, `SEEK_FIRST_ACCESS_AUD`, `SEEK_FIRST_ACCESS_REQUIRED`; move `CESIUM_ION_TOKEN` / `GOOGLE_MAPS_API_KEY` ownership to Halo owner mode. Owner action in the Cloudflare dashboard, after step 3.
6. Catalogue rows `seekfirst.data` / `seekfirst:read`: disable (not delete) in a reviewed migration once no key holds the scope.
7. The `mcclusterishere/seek-first` repo: archive it with a README pointer (owner action).

### 5.4 Open PRs touching this area (recommendations only; none closed)

- **#414** (Research Intelligence): keep its citation export (`research/citations.js`) for research projects; do not apply its pending migration (wrong directory, and `research_claims` would be a fifth claim table). Point research claims at `intel_claims` with `purpose = 'public_interest_research'` if they need the loop.
- **#416**: keep the infrastructure adapters only after §3.1 is fixed; drop `halo-evidence-graph.js` in favour of `intel_lineage`.
- **#408**: superseded by the canon (`intel_lineage` replaces the graph projection; it also never invents decision nodes).
- Pending `20261011190000_decision_intelligence_evidence_v1.sql`: do not apply; superseded by `20261015210000_intel_mission_canon_v1.sql` (README updated).
