# Admin measurement and evidence implementation ledger

Source baseline: `e9d8604988496783fa25f4c450bd49fec69ba476`, inspected 2026-10-20.
Branch: `feat/admin-evidence-20261020`. This is implementation for review; no production
promotion, migration, public license change, partner contact or application is authorized
by this ledger. Existing owner gates remain in force.

## Verified starting state

| Plane | Observed state | Evidence and limits |
| --- | --- | --- |
| GitHub main | `e9d8604988496783fa25f4c450bd49fec69ba476` | GitHub branches API; after brief baseline `a0169af`; main checks successful at inspection |
| API Worker | Version `ff639638-d732-4eb3-995b-0b11715eedef`, 100% traffic, deployment `7a17894f-6c4e-4dba-a6c9-7bee005c8d34` | Cloudflare deployments API, 2026-10-20T19:01:31.631Z; `/v1/health` at 19:35:35.853Z independently reports source SHA `e9d8604988496783fa25f4c450bd49fec69ba476` |
| OVH promoted/runtime source | `e553e2dc0ae312866ab00372e46cb1575b93e9c8` | `deploy/ovh-production` and latest durable `host_health:v3` receipt agree; last promotion 2026-10-19T01:55:10Z |
| OVH services | Core runner, broker and reconcile timer active | Health receipt checked 2026-10-20T19:31:55.724Z; runtime promotion lags main |
| Database | Latest applied migration `20261017214808_mcp_approval_scope_v1` | Read-only production migration ledger query; pending files are not applied schema |
| Compute | One online Linux x64 node; 8 CPUs; 24,598,257,664 bytes RAM; no reported GPU; one lease | Heartbeat 2026-10-20T19:33:58.678Z; inventory is node-reported, not an independent hardware certification |
| Local inference | Ollama `qwen3:8b`, `qwen3.8b.local`, healthy `ai.chat`, concurrency 1 | Engine probe in heartbeat; exact model digest, quantization and measured quality remain unverified |
| Apple desktop | No Apple node enrolled | One enrolled node is Linux; setup instructions do not imply a Mac exists |
| Operational health | Degraded | Health receipt reports 22 failed Core jobs, no communications relay and stale/missing Halo health snapshot; active process does not prove workload success |

Observed Worker flags: `INTEL_USGS_COLLECTOR_ENABLED=true`,
`INTEL_USGS_SPATIAL_ARCHIVE_ENABLED=true`, `NEWS_BRIEFS_ENABLED=true`,
`NEWSROOM_ENABLED=true`, `WORLD_NEWS_INGEST_ENABLED=true`;
`WORLD_PLACE_SCOPE_ENABLED=false`, `LIVE_MISSIONS_ENABLED=false`,
`PERSONA_ENABLED=false`. Flags are configuration, not authority or completion evidence.

## Concurrent work preserved

- Draft #557 (`f0c20e2`) contains incomplete lease handling; useful concepts are
  reconciled on this branch, not treated as finished orchestration.
- Draft #554 security and #553 naming work, and open #562 privacy / #563 public
  World work are separate. Current owner naming is Equity Uprise; legacy technical
  names remain compatible. Their branches are not modified here.
- The dirty newsroom checkout based on `2463c71f` is intact. This branch uses a
  separate current-main checkout and the merged #558/#559 implementation.
- #414/#408 research drafts cannot replace existing Intel / ontology authority.

## Work ledger

| Package | Implementation owner / evidence | Remaining acceptance boundary |
| --- | --- | --- |
| W01–W03 | `evidence.md`: existing Intel lineage, decision recovery, source correction and role fixtures | Deployed source-to-partner-accepted outcome, native concurrent database validation and broader regional capabilities remain unverified |
| W04 | `analytics.md`, `interface.md`: 229 event definitions, 34 metric families, 24 dataset contracts, read caps and preserved shell; production EXPLAIN plans saved | Frozen shared snapshots, a true ordered cohort, executed query timings, commerce reconciliation and richer geography privacy validation remain incomplete |
| W05 | `newsroom.md`: per-desk scheduling and reviewed output | Publication stays gated; queued drafts are not delivered or externally indexed |
| W06 | `compute.md`: lease fencing and optional desktop | Hardware test and reviewed deployment separate from simulated failure tests |
| W07/W09 | `research.md`: frozen offline evaluation tooling | Researcher-selected protocol, adjudication, valid scientific dataset, independent replication and ethics determination remain external |
| W08 | Licensing decision packet | Proprietary repository license unchanged; no OSS ecosystem/adoption claim |
| W10 | Funding register and evidence gates | Unverified applicant/PI/partner/instrument conditions never imply eligibility |

Each module document records changed contracts, tests actually run and remaining
gaps. Status is never promoted from built to tested, merged, deployed, used or
independently validated without corresponding evidence.

## Integration rules

Use Supabase domain records and the existing Core job system. Keep `HereTenantAgent`,
owner telemetry gates, organization authorization, release policy and native
publication authority. Preserve the eleven Analytics chapters, one Cesium globe,
shared bottom bar, routes, dimensions, unfinished inputs and non-WebGL fallback.
No shell CSS or replacement admin is introduced.

New SQL is pending and must be tested in isolation before promotion. Apply via the
existing reviewed migration process only after verifying prerequisites against the
current ledger. Deploy server changes before clients that require enriched contracts;
roll back application code through existing refs, never by deleting durable evidence.

## External decisions to prepare, not invent

1. Exact permissive component file/license boundary and contributor rights.
2. Actual applicant legal/tax status, institutional PI and partner authority.
3. Selected call and allowable-cost allocation; no duplicate charging.
4. Authorized production promotion after integrated checks and review.

No request for those decisions should block independent implementation or testing.

## Review and promotion order

All four schema changes are in `supabase/pending/`, not the automatically applied
migration directory. Their isolated PostgreSQL/WASM fixtures run in CI. They add or
replace contracts on existing authority tables; they do not introduce an alternative
event store, scheduler, identity service or graph.

1. Review current schema provenance and run native PostgreSQL/Supabase migration,
   role and concurrent-operation tests before moving pending SQL into the reviewed
   migration process. PGlite proves SQL behavior in one connection, not races.
2. Apply reviewed Intel SQL, then the `context-decision` function, then the Worker.
   The Worker checks the v2 handshake and fails closed against an older function.
3. Apply reviewed compute SQL before node agent 0.3.0. New clients reject old,
   incomplete authority receipts. Drain existing work before coordinated promotion.
4. Coordinate newsroom Core and Worker changes. Legacy stories lack revision-bound
   approvals; review their exact current content before relying on public visibility
   or scheduled publication. Existing stale public caches need the documented purge
   or expiry procedure. Do not fabricate approval backfills.
5. Analytics and funding additions expose unavailable/partial states until their
   pending SQL exists. Verify new endpoint contracts before promoting their UI.
6. Record actual running refs, applied migrations, supervised synthetic receipts and
   rollback refs. A merged commit, active flag or passing test alone is not deployment.

Detailed rollout/rollback boundaries are in each module document. No production
write, deployment, enrollment, funding submission, contact, or license change was
performed in this implementation.

## Integration validation

The final local suites passed 1,065 Worker tests, 300 Core tests and 985
web/script tests (2,350 tests total). Cross-review fixes have targeted regressions;
the PR adds continuous checks for these contracts. Four pending migrations have isolated fixture
harnesses; real multi-session/database-stack validation is a separate gate.

The Worker test command preloads an offline fetch guard; unit tests must supply
explicit mocks. This fixes an inherited unmocked `db.invalid` fixture without
allowing tests to contact a live backend. No real secret was present in that fixture.

The local Deno check could not download the existing JSR/npm dependencies from
this environment. The `context-decision` typecheck is added to CI; no local typecheck
success is claimed. Browser proof and its exact fixture/viewport limits are in
`interface.md`. The scorer's actual synthetic replay is in
`research-fixture-result.json`; it is not a model benchmark.

Cross-review found and corrected: excessive evaluator work/cost overflow; empty
citation approval; real SQL `view` stage mapping; null Adaptive rates; truncated
news scan recovery; and source/note clearing during article re-review. Regression
tests exercise the affected boundaries, not just copied implementation expressions.

## Capability reference status

The inspected upstream heads remain Hitman's Halo
`e18c71fd4a5df7f2bc375d1025e5b4ea811d4247` and God's Eye View
`713285b554bbc99c8ae0261fe307beb3cbeb2adf`. This increment strengthens the existing
USGS adapter, shared projections and reviewed action path. It does not claim full
upstream parity or fabricate live fire, aircraft, AIS, orbital, radar, air-quality,
transport, infrastructure or network layers. Each additional family still needs
an entitled provider, exact time/unit/geometry semantics, retention policy and
observed coverage before integration.
