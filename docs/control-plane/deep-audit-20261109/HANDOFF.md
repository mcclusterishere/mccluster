# Deep-audit response handoff, 9 November 2026

> **Session 2 (later on 2026-11-09) is recorded first; the original session follows unchanged below it.**

## Session 2: reconciliation of the owner-run releases, C5 completion, admin-only E=Up

Branch `claude/new-session-83ken5`; starting head `15523e187d1800dcbe7cd2c19f4ddfe6f203f556` (verified equal to the packet's snapshot; main still `578e6830`). Commits for this session are listed at the end of this section. Nothing was merged, deployed, applied to a database, or sent anywhere by this session.

### Completed source

| Area | What changed |
| --- | --- |
| Production reconciliation | Exact applied SQL imported under returned versions `20261109175747_music_direct_asset_versions_v1`, `20261109180829_core_signed_nonces_v1`, `20261109181623_city_arcade_v1` (SHA-256 match the receipts); branch draft `20261109120000_…` deleted (superseded, never replay); 362-entry `supabase/production-ledger.json` + `core/drift-contract.json`; four deployed Edge files (`music-direct-access` v42) and the release's three test scripts; DB script proves the zero-order rollout guard then applies the real file; Arcade workflow/support/docs point at the applied file; receipts copied to `docs/control-plane/evidence/releases-2026-11-09/`. |
| RPC-name index and schema verifier | New `applied_awaiting_evidence` state (`scripts/test/rpc-names-exist.test.mjs`, `live-callers.json`): names applied by receipt whose manifest/snapshot evidence was not regenerated (no CI reset or production read possible here). Retire the entries by running the supported clean reset and capturing a snapshot. `docs/control-plane/evidence/ledger-receipts.json` likewise lets `production-ledger.json` run ahead of the latest snapshot only for receipted versions (`production-schema-verifier.test.mjs`); a new snapshot retires those too. |
| C5 completion | `supabase/pending/media_operation_claims_v1.sql` (+rollback): service-only `media_operation_claims`, RPCs `media_claim_operation_v1` / `media_bind_operation_v1` / `media_fail_operation_v1`; router: atomic claim → winner reserves + binds + submits, losers get the same job / recorded failure / `operation_pending`; payload-fingerprint mismatch refused; uncertain provider acceptance → job `reconciling` with reservation kept, never auto-resubmitted; Core `mcp-http.mjs` carries one stable `operation_id` per logical call with one same-id transport retry; `media.compare` child ids per model; `CORE_REPLAY_STORE = "supabase"` added to `wrangler.toml` (the DB prerequisite is applied). |
| E=Up admin workspace | Worker `/v1/eup` router (owner-only at every route, private/no-store, fail closed) with sections overview, league, civic, companies, sources; Control › System › E=Up shell (`js/control-room/eup.js`, five local tabs, one shared Analytics globe, bounded requests, authority-generation conceal, honest 503 states); Products door `E=Up` in the shared bar (`js/site-navigation.js`) pointing at `control.html#system:eup`. |
| Environmental Justice League (admin-only) | `supabase/pending/eup_league_v1.sql` (+rollback): 11 private tables + `eup_league_command` (house ownership rechecked, CAS, idempotency key + payload digest, atomic capacity, self-review denial, version-bound acceptance; publication private; points/payouts/broadcast 501). Five unpublished, unpriced campaign templates as a fixture; first complete mission is "Write a song for a healthier world". |
| Civic League, Companies & Finance, Sources & Review (admin-only) | `supabase/pending/eup_intake_v1.sql` (+rollback): 25 private intake tables (registry state, import runs, append-only snapshots, civic entities incl. boundary versions/terms/vacancies/bills/versions/actions/amendments/roll calls/elections/certification, company identifiers/typed locations/facts/awards, review items, corrections); six pure adapters with synthetic fixtures (SEC, GLEIF, Congress.gov, Census TIGER, CT General Assembly, Bridgeport council); all 12 registry connectors disabled and answering 503 until configured AND access-approved; nothing writes to `civic_*` or `action_policy_bills`; OpenFEC, disclosures and market quotes held. |

### Exact tests run on the final tree (this container, Node v22.23.4)

| Command | Result |
| --- | --- |
| `node --test --test-timeout=60000 scripts/test/*.test.mjs` | first run 2137 tests: 2133 pass, 1 fail, 3 skipped (pre-existing publish-time skips); the one failure was `production-schema-verifier` requiring the committed ledger to equal the stale 2026-11-03 snapshot; fixed by the `ledger-receipts.json` mechanism below, verifier 10/10; full rerun: ROOT_RERUN |
| `python3 -m unittest discover -s scripts/test -p 'test_*.py'` | 7 pass |
| `cd core && node --test test/*.test.mjs` / `npm run check` | 585 pass, 0 fail; check pass |
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/*.test.mjs` | 1590 pass, 0 fail |
| `node scripts/control-plane-drift-contract-check.mjs` | pass, 362 active migration files |
| `node --test scripts/test/rpc-names-exist.test.mjs` | 3/3 |
| `PGHOST=127.0.0.1 PGPORT=5499 PGUSER=postgres bash scripts/test-music-direct-sales-db.sh` (disposable PostgreSQL 16.15) | `music direct sales: ok` with the applied migration; guard refuses first application while an order exists |
| `EMBEDDED_PG_MODULE=… node scripts/test/music-direct-release.integration.mjs` (native PostgreSQL 17.7, run as `postgres`, locale generated) | PASS: both rollbacks, reapply and both behaviour suites, native lock-race regressions |
| `node scripts/test/music-direct-release-handler.integration.mjs` | PASS: 9 extracted exact Edge-handler scenarios |
| `scripts/test/eup-league.integration.mjs`, `eup-intake.integration.mjs` (PGlite) | 58 and 118 assertions |
| `scripts/test/city-arcade-start-recovery.integration.mjs`, `city-arcade-database.integration.mjs` (PGlite, applied SQL path) | 17 and 31 assertions |
| `CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium node scripts/e2e/control-eup.e2e.mjs` | 53/53 at 390 and 1440 plus reduced motion (Cesium CDN blocked: mount-once proven, rendering not) |
| `node scripts/e2e/world-environment.mjs` | PASS at 390 and 1440, fixtures only |
| `media_operation_claims_v1.sql` on disposable PostgreSQL 16 (C5 worker) | applied twice; claim/mismatch/bind/fail and anon denial |

NOT RUN: `supabase/schema-manifest.json` regeneration (needs the Supabase CLI reset); production schema snapshot (Supabase connector not authorised in this session); Deno typecheck of the Edge files (no Deno; `stripTypeScriptTypes` only); native multi-session concurrency for League/intake/Arcade (PGlite is serial); live sources, keys, entitlements, geocoder, scheduled jobs; real purchase/download; live Worker isolates/provider.

### Merge, deployment and verified use

Nothing merged or deployed. Live identities unchanged from the receipts: Worker `bbeb8acd…` (deployment `23b34bef…`, 2026-11-07), Pages `22259d57` (still carries W1), Core `9c5b7503`, Edge `music-direct-access` v42, database ledger 362. No production journey verified. Verified journeys are local and synthetic only: E=Up shell at 390/1440 with fixture routes; League command lifecycle and intake pilot in PGlite; environment mode fixtures; Arcade recovery.

### Gates and owner decisions (release order)

1. **Merge = deploy.** `wrangler.toml` now carries `CORE_REPLAY_STORE="supabase"`, and the Worker requires `media_operation_claims_v1.sql` for paid generations that carry an `operation_id` (503 `operation_claims_unavailable` without it), plus the Arcade `startKey` handler is needed before any `ARCADE_CLOUD_ENABLED`. Apply `media_operation_claims_v1.sql` (reviewed, service-only) before this branch reaches main; do not set the Arcade flag.
2. **Regenerate evidence.** Run the supported clean reset to refresh `schema-manifest.json` and capture a production snapshot so the five `applied_awaiting_evidence` names retire.
3. **E=Up pending SQL.** `eup_league_v1.sql` and `eup_intake_v1.sql` are unapplied review candidates; until applied the admin workspace answers 503 `schema_not_applied` honestly. Decide pilot jurisdiction (Connecticut/Bridgeport proposed), which sources to review/configure first (Census TIGER, SEC, GLEIF, then Congress.gov with a securely configured key), points policy, audience beyond `admin_preview`, retention, who reviews (a second house owner today).
4. **Navigation placement.** The NAV leaf lives under Control › System › E=Up with a Products door in the shared bar; confirm or move it.
5. **E=Up mark.** No supplied E=Up artwork exists under `assets/img/`; the header uses text. Supply the mark if wanted; nothing was drawn.
6. **Consumer environment.** The two `world_environment` SQL files stay held; the consumer globe mode on this branch keeps working against fixtures and is not activated.
7. Unchanged from session 1: A7 disabled-house policy, A2 expired-session replacement, C6 gateway requirement, EQ1/EQ2 upstreaming to `Equity-Uprise`, #792/#787 rebases, COM-3/A3/A4/A6/W4/W5/C8 on their PRs.

### Deferred

Member-facing apply/accept/proof routes (consumer release); live broadcasting, payouts, white-label agency economics (rates/payer/levels unchosen; FTC and 501(c)(3) gates); platform votes/candidate support; market quotes; any collector; composition of the control follow-on; independent installation proofs; `attempt_key` from the buyer UI; `reconciling` job operator reconciliation path; `registry.mjs` forwarding a job-scoped `operationId`.

### Recovery

All SQL added this session is pending with rollback files; applied releases keep their rollback artifacts (`music_direct_asset_versions_v1.rollback.sql`; nonce and Arcade schemas are additive and should stay in place). Edge v41 source is retained in the owner's packet for Edge rollback. No destructive SQL rollback after purchases without inspection.

### Session 2 commits

- `4989365` reconciliation of the three applied releases, RPC-index state, E=Up router scaffold
- `836e4f3` League backend
- `e6687cf`, `83f593c` work-in-progress checkpoints (superseded by the final commit)
- FINAL_COMMIT final integration: C5 completion, E=Up shell and Products door, civic/companies/sources intake, allowlist, docs

---

Branch `claude/new-session-83ken5` in `mcclusterishere/mccluster`, built on main `578e683088fdd49fb77848733e70dd4f3af039c3` (the exact SHA the packet audited; `git merge-base --is-ancestor` confirmed). The commit SHAs for this work are listed at the end of this file. Nothing was merged, deployed, applied to a database, or sent anywhere. Read `DEFECT-LEDGER.md` for the per-finding detail, `OPEN-PR-DISPOSITION.md` for all 93 PRs, `CAPABILITY-MATRIX.md` for the evidence columns, `EQUITY-PRODUCT-COMPOSITION.md` for the product plan, `CLASSROOM-EVIDENCE-CHECKLIST.md` for Tuesday.

## Completed source (on this branch)

| Area | What changed | Finding |
| --- | --- | --- |
| Published artifact | Recipe compiler relocated to `js/prim3-tactics/levels/recipe.mjs` (private path is a shim); importers, Worker and tests repointed; `scripts/test/published-import-closure.test.mjs` gates every literal published dependency against the workflow's own strip; e2e harness can serve an emitted export (`MCC_SERVE_ROOT`) | W1 |
| Identity lifecycle | Control authority generation with abortable loads and synchronous conceal; handoff commit fence with paired writes and bounded fetch; auth loader retry with terminal state | A1, A2, A5 |
| Commerce | `supabase/pending/20261109120000_music_direct_asset_versions_v1.sql` (+ rollback): immutable asset versions pinned to orders/entitlements, download attempt reserve/settle; Edge handler and shared refusals updated; backfill policy and review view | COM-1, COM-2 |
| Core | Lease-fenced claims with lost-lease abort, idempotent reflection children, persisted-report-or-fail digest with stable window id, house-org lookup fix, unknown-evidence health, complete-inventory code-patch policy, local-model readiness and deploy gate | C3, C2, C7, C7b, C1, C4, C6 |
| Worker | Shared replay store for Core-signed mutations (pending `core_signed_nonces_v1.sql`), fail-closed default, `operation_id` dedupe before reservation | C5 |
| Arcade | Account-scoped result outbox, reconnect/discard controls, `start_key` idempotent start and `current` read in pending SQL and Worker | W2, W3 |
| Building adapter | Elevator links board/alight on landings; shafts stay blocked | EQ3 |
| Environment consumer | Local consumer patch applied (E=Up mode on the existing globe, vendored product, Worker routes, pending SQL, PGlite scripts, e2e); EQ1/EQ2 fixed in the vendored copy with a lifecycle suite; e2e fixtures match the transport contract | EQ1, EQ2, EQ4 |
| Docs | This directory; Arcade activation handoff notes the stale reviewed hash; music release note; `live-callers.json` lists the four new pending-only names | |

## Exact tests run on the final integrated tree (this container, Node v22.23.4)

| Command | Result |
| --- | --- |
| `node --test --test-timeout=60000 scripts/test/*.test.mjs` | 2126 tests: 2123 pass, 0 fail, 3 skipped (pre-existing publish-time skips) |
| `python3 -m unittest discover -s scripts/test -p 'test_*.py'` | 7 pass |
| `cd core && node --test test/*.test.mjs` | 581 pass, 0 fail (baseline 555) |
| `cd core && npm run check` | pass |
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/*.test.mjs` | 1537 pass, 0 fail (baseline 1458 pass + 1 failure from the uninstalled fal client, installed `--no-save` here) |
| `PGHOST=127.0.0.1 PGPORT=5499 PGUSER=postgres bash scripts/test-music-direct-sales-db.sh` on disposable PostgreSQL 16.15 | `music direct sales: ok` (v1 twice, new behaviour file fails on v1 alone, backfill, v2 twice, both rollbacks, re-apply, both behaviours) |
| `PGLITE_MODULE=<scratch>/pglite node scripts/test/city-arcade-start-recovery.integration.mjs` / `city-arcade-database.integration.mjs` | 17 / 31 assertions pass (serial PGlite) |
| `scripts/test-environment-pglite.mjs`, `-proofs-pglite`, `-planning-pglite` | PASS (environment worker run) |
| `MCC_SERVE_ROOT=<stripped export> THREE_DIR=<three@0.180.0> GENERATED_COMPLETION_ONLY=1 node scripts/e2e/prim3-generated-missions.e2e.mjs` | 6 completion cases (390 and 1280), denied owner, recipe save failure: all PASS, exit 0. Negative control from an export of unmodified HEAD: generator never renders (timeout), exit 1 |
| `node scripts/e2e/world-environment.mjs` (pre-installed Chromium) | PASS at 390 and 1440, `scrollWidth === clientWidth`, no page errors |
| `node scripts/e2e/city-arcade-recovery.e2e.mjs`, `city-arcade-cloud-gate.e2e.mjs`, `city-arcade-action.e2e.mjs` | PASS (Arcade worker run, `CHROMIUM_PATH=/opt/pw-browsers/chromium`) |
| `bash -n scripts/ovh-core-health.sh scripts/deploy-ovh-core.sh` | ok |
| `node scripts/control-plane-drift-contract-check.mjs` | pass; active migrations 359 (unchanged ledger) |
| `python3 docs/design/equity-uprise-building/production/audit_building_context.py` and `verify_equity_uprise_program_coverage.py` | pass |

Skips and NOT RUN: `scripts/test-environment-postgres.mjs` (native multi-session, no PostgreSQL 17 here); Deno runtime of the Edge function; browser checkout e2e for music; native concurrency for Arcade and Core queue; physical devices; iPad BFCache.

## Integration and merge state

Nothing merged. The branch is one review unit; the owner may prefer splitting it by area for review (the per-area file lists are in the ledger). Three PR heads (#737, #745, #749) were reconfirmed as main ancestors on this checkout.

## Deployments

None performed. Dated receipts in the packet remain the latest: Worker/Pages main `578e6830` (Pages `22259d57`, which still carries W1), Core `9c5b7503`.

## Verified journeys (local, synthetic)

Generated PRIM3 side operations from the stripped export; environment mode on the globe with membership, assignment, proof and review fixtures; Arcade lost-response, restart-preserves-receipt, reload, revoked denial, idempotent retry. All with fixture identities and software GL. No production journey was verified.

## Unresolved blockers and owner decisions (in release order)

1. **C5 deploy gate.** Apply `supabase/pending/core_signed_nonces_v1.sql` and set `CORE_REPLAY_STORE="supabase"` in `workers/mccluster/wrangler.toml` `[vars]` before this branch reaches main, or Core-signed media mutations answer 503 (the Worker auto-deploys from main). `"isolate"` restores today's window explicitly if you prefer to stage it.
2. **COM-1/COM-2 rollout.** Promote the pending migration with its ledger entry, redeploy the Edge function in the same window, then resolve legacy unpinned orders through `music_direct_asset_review` (they refuse download with `asset_unresolved` until resolved). Decide the backfill policy (default: pin only when the offer was unchanged since the order).
3. **A7 decision.** Break-glass owner access to a disabled house: keep and scope, or align the Worker helper with the SQL boundary.
4. **A2 decision.** Whether an expired stored session with no refresh token may be replaced by an arriving handoff (this branch allows it).
5. **C6.** Whether the compute gateway is required-active; whether to enable the inference probe on the unit.
6. **W3.** Re-review `supabase/pending/city_arcade_v1.sql` (new hash `b03081d4…`) before activation.
7. **Environment.** Approve the pending environment/proof SQL rollout; confirm the 2026-11-07 World gate wording now in `AGENTS.md`; upstream the EQ1/EQ2 patches to `Equity-Uprise` (this session cannot write there) before re-pinning.
8. **#792 / #787.** Rebase #792 onto this branch's `digest.mjs`/`objective-reflection.mjs`; #787 must promote `topology-learning.mjs` like the recipe or the closure test fails.

## Deferred scope

Executors honouring the lost-lease `signal` mid-execution; a dedicated `lease_token` column; a unique index for digest windows; `attempt_key` from `js/music-purchase.js`; composition of the control follow-on with the mission follow-on; independent installation proofs; Admin stack composition (#789); COM-3; A3/A4/A6; W4/W5; C8; the historical backlog dispositions marked salvage/park in the PR table.

## Rollback and data recovery

Every change is on a branch; main is untouched. SQL is pending only; each new pending file has a rollback file (`music_direct_asset_versions_v1.rollback.sql`, environment proofs rollback) or is additive (`core_signed_nonces_v1.sql`). The Core lease format is backward compatible with existing `locked_by` rows. The Arcade outbox migrates legacy session receipts forward and never deletes one without an explicit confirmed discard.

## Reproduction commands for the W1 artifact proof

```
# build the stripped export from any tree (reads the rm lines from deploy-pages.yml)
scripts/build-public-export.sh <out>
MCC_SERVE_ROOT=<out> THREE_DIR=<three@0.180.0> GENERATED_COMPLETION_ONLY=1 \
  node scripts/e2e/prim3-generated-missions.e2e.mjs <proof-dir>
```

## Commits

- `b3a822730226618cbf4c2ead68d25c2d10dbdbd6` on `claude/new-session-83ken5`: every source, test, SQL and document change described above, on main `578e683088fdd49fb77848733e70dd4f3af039c3`.
- The commit after it adds only this SHA line.
