# Current production status and reconciliation

Snapshot: November 9, 2026, using the final migration-release receipt and current local package inputs. Re-read live state before committing or releasing. Migration version strings are exact returned identifiers, not guessed timestamps or local filenames.

## Applied and verified

Canonical project: `zmnhbrjyhxzhkxmhkexs`, PostgreSQL 17.6.

- **Commerce:** `20261109175747_music_direct_asset_versions_v1`. Supabase Edge `music-direct-access` is ACTIVE **v42**. Exact corrected SQL and deployed source are in `commerce-release/`. Source readback, permissions and refusal checks passed. No real checkout/refund/successful buyer download was performed. One inactive offer/object preserved; zero active offers/orders/entitlements at receipt time.
- **C5 database only:** `20261109180829_core_signed_nonces_v1`. RLS, primary key, expiry index, service insertion/duplicate behavior and client-role denial verified. Rolled-back test left zero rows. **CORE_REPLAY_STORE configuration and Worker deployment were not changed.** Paid-operation atomicity and uncertain-provider reconciliation remain unresolved.
- **City Arcade database only:** `20261109181623_city_arcade_v1`. Three empty service-only RLS tables and two invoker functions. Native and rolled-back production behavior checks passed. **ARCADE_CLOUD_ENABLED is absent; no feature activation.** Upgrade to the reviewed startKey-aware Worker before any enablement, then run owner/browser acceptance.
- **Already-existing civic schema:** `20261014021057_civic_global_discovery` is in the production ledger. Do not replay it under a mistaken alternative version. Populated coverage and safe admin ingestion do not follow from ledger presence.

The final live ledger contains **362 entries**, latest `20261109181623_city_arcade_v1`. The receipt records its ledger fingerprint as `713f3c2db09f87e41f8b35621c7143484e1f79420b1142d72ee5d9bdee887594`. This is distinct from the SHA-256 of the serialized JSON file, which the manifest records. Use `migration-release/release-copy/supabase/production-ledger.json` and its matching `core/drift-contract.json`, not the older ledger in the commerce folder. The drift check passed; full schema-manifest regeneration and aggregate final release CI were not run.

## Not applied or activated

- `20261107120000_world_environment_v1.sql`: held for admin-only scope, despite rehearsal success.
- `20261108120000_world_environment_proofs_v1.sql`: held with its dependency; no public/member activation.
- Forty-two other older forward pending candidates: inventoried, not bulk-approved or applied.
- Twenty-three rollback SQL files: recovery artifacts, not forward migrations.
- Owner-only environment planning: existing canonical tables/permissions suffice; no new SQL prerequisite.
- E=Up admin workspace, Environmental Justice League, 12 proposed source connectors, referral payouts, political support features and live broadcasting: plans/prototypes or existing partial source, not newly deployed by this work.
- Main, Claude branch, Cloudflare Worker, Pages and OVH Core were not changed by these three database/commerce release tasks, except for the explicitly named Supabase Edge deployment.

## Exact import paths

From this archive, reconcile these into the actual repository, checking the current tree first:

1. `migration-release/release-copy/supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql`
2. `migration-release/release-copy/supabase/migrations/20261109180829_core_signed_nonces_v1.sql`
3. `migration-release/release-copy/supabase/migrations/20261109181623_city_arcade_v1.sql`
4. `migration-release/release-copy/supabase/production-ledger.json`
5. `migration-release/release-copy/core/drift-contract.json`
6. `commerce-release/supabase/functions/music-direct-access/index.ts`
7. `commerce-release/supabase/functions/_shared/music-direct.ts`
8. `commerce-release/supabase/functions/_shared/house-ops.ts`
9. `commerce-release/supabase/functions/_shared/checkout-binding.ts`

Applied SQL SHA-256 values:

- Commerce: `a76d1335df38e781c90e9fdcb61e4245d2f98830627f26b88d2422f3578abfcc`
- C5: `f07410354ae4cd5d48aea9b95e71b81c6fdc3a4d258c44e4f6dca7520b368503`
- Arcade: `b03081d4be03ed85673b1f5f401ba8de5cef8c88dc59e241436734e8f323aba0`

Supersede old pending entries, update caller exemptions and tests/workflows to real returned versions, retain recovery files as recovery-only, and regenerate schema-manifest with the supported clean-reset workflow. Do not edit its hashes by hand. Do not replay the original commerce pending SQL over the independently repaired functions. Do not blindly overwrite current unrelated work or a fresher live ledger.

## Release and recovery cautions

A merge to main can trigger Worker deployment. A source merge is therefore not automatically harmless bookkeeping. Keep source reconciliation, final tests, permission, deployment and real acceptance explicit.

The commerce package retains Edge v41 for recovery, with additive DB compatibility tested. Do not run destructive SQL rollback after purchases without fresh inspection and coordinated recovery. Keep nonce/Arcade additive schema in place while their Workers/features remain dormant. No managed backup/PITR or complete database restore was verified. Targeted snapshots and prior Edge source are not a full backup.

Existing reports are timestamped evidence, not an instruction to repeat production tests or external side effects. Synthetic fixture values in included code are not credentials. No real keys, sessions, private media or business-row dumps are required for this handoff.
