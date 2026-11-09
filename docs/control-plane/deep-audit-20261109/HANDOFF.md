# Deep-audit response handoff, 9 November 2026

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
