# Commerce release receipt, 9 November 2026

## Completed in production

Project: `zmnhbrjyhxzhkxmhkexs` (existing canonical McCluster Supabase, PostgreSQL 17.6).

1. Applied `20261109175747_music_direct_asset_versions_v1` successfully.
2. Deployed `music-direct-access` from v41 to **ACTIVE v42**. Existing gateway setting `verify_jwt=false` was preserved; operator authorization is unchanged. Bundle SHA-256: `3a6d96eb760f68e903bb7e9d4b9c9cf917573a5a467e2eb34eb8291f8d77335a`.
3. Read all four deployed files back and verified exact content equality with this packet.
4. Verified RLS on both new private tables. anon/authenticated cannot read the new tables or call reserve/settle. service_role retains those operations.
5. Live HTTP smoke checks: unknown download token 404/not_found; malformed token 400; unauthenticated operator request 401. Responses preserve Matthew's CORS origin and no-store.
6. Post-cutover: 0 orders, 0 entitlements, 0 attempts, 0 review rows, 0 active offers. One existing inactive legacy offer and its object were preserved; one historical version row was recorded. No sale was activated or real purchase/refund/download performed.

The order count was read immediately before release. The migration also locks the commerce tables and aborts first-time application if any order appeared meanwhile. This guard did not fire.

No remote GitHub branch, main, Cloudflare Worker, Pages, Core, payment settings or storage bytes were changed. No message was sent to Claude as part of this release.

## Changes beyond Claude's branch

Origin: `mcclusterishere/mccluster`, branch `claude/new-session-83ken5`, substantive commit `b3a822730226618cbf4c2ead68d25c2d10dbdbd6`, documentation head `15523e187d1800dcbe7cd2c19f4ddfe6f203f556`, based on main `578e683088fdd49fb77848733e70dd4f3af039c3`.

The original commerce patch was NOT deployed verbatim. Independent native PostgreSQL tests proved:
- Reserve -> refund -> settle('issued') returned success and counted a revoked entitlement.
- Reservation cleanup and settlement locked entitlement/attempt in opposite order and deadlocked (40P01).

This release fixes both: entitlement is always locked before attempt; settlement rechecks refund/revocation/payment/expiry before issuance. Expired holds are released and refused even without another reservation. An issued attempt can be replayed only for 300 seconds, rather than refreshing URLs throughout the full entitlement window. The Edge handler returns the actual refusal and never hands out a URL after a failed settlement. Null settlement outcome is rejected explicitly.

The original immutable asset-version and reserve/sign/settle fixes are retained. Existing old-Edge compatibility was preserved through the legacy claim RPC for DB-first deployment.

## Verification

- Native disposable PostgreSQL 17.7: migration applied twice; original v1 and new version behavior suites passed; both rollback scripts and reapplication passed.
- Native concurrent-session regression: no deadlock; a released expired hold cannot issue.
- Refund during signing, entitlement expiry, hold expiry, bounded replay and null outcome regressions passed.
- Existing commerce source/behavior contract suite: 23/23 passed.
- Extracted exact Edge handler: 9/9 scenarios passed.
- Deno 2.5.6 typecheck passed with the exact source, local official npm dependencies and official Supabase ambient types. Direct Deno dependency downloads stalled, so dependencies were resolved locally without changing deployed imports.
- Second independent read-only review found no release blocker.
- Post-release security advisors added only two expected INFO entries for service-only RLS tables without user policies. Existing warnings were unchanged.
- Local drift contract check passes with the live-verified 360-entry ledger and new applied migration.

Not tested: real paid checkout, successful production signed download, browser buyer journey, physical devices. No synthetic paid purchase was inserted into production.

## Exact source identity

- Applied SQL SHA-256: `a76d1335df38e781c90e9fdcb61e4245d2f98830627f26b88d2422f3578abfcc`.
- Edge entrypoint SHA-256: `7c967f7809bf5ee15b5fc9ff82fcc14e1a060e0536f14f12c36004c9a828236e`.
- Shared music-direct SHA-256: `57da67b9f06467e5770a63bce99b4e17444dff6e0c16a8b312969a50b5bf4591`.
- Production ledger after commerce: count 360, latest `20261109175747`, SHA-256 `6a6e02a5793b354171dab00156003919bfb658c3cae0cde31f3633e5e9120433`.

Refresh the ledger before merging if another authorized migration has subsequently been applied.

## Instructions for Claude's continuation

1. Reconcile this completed release before any merge/deploy. Import the exact applied SQL under `supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql` and these four Edge files. Do not reapply or deploy the original pending commerce patch over the fixed production functions.
2. Remove/supersede `supabase/pending/20261109120000_music_direct_asset_versions_v1.sql` in your branch. It is not the applied migration version. Preserve the rollback file as a recovery artifact, not an automatic action.
3. Import the verified production ledger and drift contract after refreshing for any newer migrations. Regenerate `supabase/schema-manifest.json` through the repository's supported clean-reset workflow; do not edit its hashes manually. This full manifest regeneration was not done here.
4. Update `scripts/test-music-direct-sales-db.sh` to point at the actual applied filename. Its legacy backfill setup should now explicitly expect the zero-order deployment guard to reject first application with orders present, then clear the disposable fixtures before applying. The migration remains idempotent once installed. Update workflow paths to include applied asset-version migrations and the new behavior/regression files.
5. Keep the native lock-race and eligibility regressions. Portable standalone verification scripts are included; `music-direct-release.integration.mjs` accepts `EMBEDDED_PG_MODULE` for an installed embedded-postgres entrypoint. It uses only a new disposable local database. Run it from the repository root.
6. Buyer UI still does not supply attempt_key. Add a stable key for uncertain retries, new key after a final refusal/new deliberate download, then test real buyer recovery. Claim/status still display the current offer title/format, while actual bytes are pinned to the purchase; correct that display in follow-up.
7. The 300-second replay window bounds new issuance; a replay near the end can mint another URL valid for 300 seconds. It is not an exact-original-URL replay. Consider persisting the original receipt if stricter semantics are required.
8. Do not merge all 119 unrelated files merely to incorporate commerce. C5 and the other release gates remain separate. In particular, the C5 operation_id check-before-insert and ambiguous provider-outcome handling have independent reproduced issues; use the separate C5 report.

## Recovery

The old v41 source is retained in `previous-edge-v41/`. If v42 fails, redeploy that exact old Edge bundle with its unchanged settings while leaving the additive pinned schema in place; old claim compatibility was tested. This temporarily restores old count-before-sign semantics.

Do not blindly run SQL rollback after new purchases. It removes version/attempt history and pins. Inspect current orders and coordinate recovery before any destructive rollback.
