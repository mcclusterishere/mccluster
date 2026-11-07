# Owner editor and learning portfolio: canonical schema promotion

Status: local preparation only, not production-applied. Base main `55befc618eb24d21a37e6c4afd66c1bb47767237`. The release coordinator owns application and relays the contract change to the separate OVH promotion worker. No Arcade or Finance tables belong to this package.

## Exact additive artifacts

Created with Supabase CLI 2.117.0 `migration new`, after command help discovery. Files preserve the audited pending SQL bytes, including historical proposal comments; those comments are provenance, not a claim of production state.

| Migration | Audited source | SHA256 |
| --- | --- | --- |
| `20261107133116_owner_front_publication_v1.sql` | #741 integrated `e21f4bb4811cdca0db45f30db2a8f9e770535f82`, `supabase/pending/owner_front_publication_v1.sql` | `dde2660db40380aa317b83dcb4a2d03e050617707c57ab3146c8817b150a78f2` |
| `20261107133124_learning_portfolio_v1.sql` | #765 `9218175e77a14a10d76849d38074871469e17239`, `supabase/pending/learning_portfolio_v1.sql` | `367bbb98ad13d467048335f9c81fed8bd46ad3c95f832ea8f670db6e537c8b6c` |

Do not concatenate rollback SQL. Do not run an unrestricted database push containing unrelated pending changes. If the authorized application mechanism assigns a different version, use its actual receipt and reconcile the canonical filename; never claim the proposed version was applied without verifying it.

## Access and publication review

Owner front adds a FORCE-RLS draft table and revision sequence with no browser table access. Four new authenticated SECURITY DEFINER RPC entry points all require non-null canonical `auth.uid()` and existing `mnet_is_admin()`, with fixed search paths. Existing identity helpers, published `site_content`, its grants, writer gates and immutable history trigger are unchanged. The validator is not browser-executable. This includes the existing owner's Publish capability, not only private draft operations; installing the functions does not publish anything or confer owner authority on members.

Learning portfolio adds an RLS table with no anon/authenticated access and a service-role-only SECURITY INVOKER RPC with empty search path. It additionally checks canonical mccluster owner membership. Save/publish/unpublish use revision CAS; null/negative revision and null/unknown action are rejected before insertion. Worker validation and the frozen allowlisted public projection remain required: direct privileged SQL is not a replacement for owner authorization or snapshot validation. Installation inserts no portfolio/public content.

Neither payload adds credentials, trading, new admins, public draft reads, or broader tenant membership. Service-role access remains confined to the trusted backend. Ordinary owner-feature migration authorization does not authorize publishing user content or changing identity/credential settings.

## Preflight and existing native evidence

Immediately before applying, refresh metadata-only object collision, dependencies, owners, grants and ledger checks. Stop on any unexpected preexisting object, incompatible definition or changed hash. Do not read or copy private draft/publication values into a public report.

- Owner front: `auth.users`, canonical M-account identity/admin helpers, `site_content`, `site_content_history`, unique page/slot index, existing set/revert RPCs and audit trigger. Earlier read-only review found compatible prerequisites and no proposed objects. Internal handoff: `/workspace/owner-front-rollout-review-20261107.md` and its preflight JSON files.
- Portfolio: `auth.users`, `orgs`, `org_members`, `learning_external_credentials`, canonical owner membership model and service read privileges. Internal handoff: `/workspace/portfolio-765-preflight.sql` and `/workspace/portfolio-765-release-review.md`. Parent confirmed table/RPC absent at prior check; rerun at action time.
- Owner native proof: [job 128407064692](https://github.com/mcclusterishere/mccluster/actions/runs/42373766439/job/128407064692), canonical reset/manifest plus 12 genuine multisession checks.
- Portfolio native proof: coordinator confirmed job `128413317069` passed at `9218175e`; includes real initial-insert and save/publication lock waits, one CAS winner, denied clients, null inputs, rollback/reapply and managed auth. This is proof of the audited payload, not yet the new two-migration reset.

## Required integration and manifest sequence

1. Integrate the two migrations with the reviewed #741/#765 application changes. Keep their pending source/rollback files while native tests reference them; do not deploy a partially integrated branch.
2. Update portfolio native proof for the promoted case. The old harness deliberately refuses an existing table. Local patch handoff `/workspace/portfolio-promotion-native.patch` requires the exact new migration receipt, complete table/RPC, zero preexisting rows, and byte-equal pending/promoted SQL. Cleanup removes only the synthetic owner row and retains the promoted schema. Pending-mode rejection and all CAS/role assertions remain. This patch requires native hosted execution; syntax alone is not proof. Owner-front harness already reapplies its SQL idempotently.
3. Run the full canonical replay reset and capture `reset-schema/reset-schema-snapshot.json` and `schema-manifest.json` from Reconciliation CI. Local attempt could not start because Docker pulls from `public.ecr.aws` returned Forbidden; no local database/reset success is claimed. No substitute auth schema or manually fabricated manifest is acceptable.
4. Regenerate `supabase/schema-manifest.json` with `scripts/db/verify-production-schema.mjs --mode reset --write-manifest` from that exact reset snapshot; rerun its integrity/diff checks. Expected changes are only these tables/sequence/RPCs and their grants/constraints/policies. The manifest is generated reset state, not evidence production already has it. Retain the failing manifest comparison gate until the correct manifest is committed; do not weaken it.
5. Run both native proof suites after manifest capture, full root checks, exact-head hosted gates and independent review. This local artifact is not merge-ready until the generated manifest and promoted native proof pass.

## Production ledger and OVH coordination

Current recorded baseline: 359 migrations; latest `20261103182544_learning_evidence_v1`; ledger SHA256 `41b4bd62a4cdd052b95aa96de6ffce745611f0bcd65cb2395b3ebc0f9a862bfc`.

The drift checker explicitly allows newer unapplied canonical migrations. Therefore this preparation leaves `supabase/production-ledger.json` and `core/drift-contract.json` unchanged. Updating either now would falsely assert application.

Only if the baseline is still exact and these two versions are the only additions, expected checkpoints are:

| Receipt state | Count | Latest version/name | Canonical ledger SHA256 |
| --- | --- | --- | --- |
| Owner front only | 360 | `20261107133116` / `owner_front_publication_v1` | `aa4f02dfc8dc3c8c42e0382882a92e418ce03fc0e00df7d640eacfe3a8379efb` |
| Both | 361 | `20261107133124` / `learning_portfolio_v1` | `3b32de70e9d84f4d2cfc7340c6e43b4bac05a7ae708c752668c7dfcf891ab138` |

These are expectations, not receipts. If Arcade or another migration lands, recompute from the actual complete ledger. Algorithm: sort `{version,name}` by version then name, join `version:name` with newline and no final newline, SHA256 UTF-8. Preserve historical alias handling; use `scripts/supabase-compare-live-ledger.mjs` on a fresh metadata export.

Before application the coordinator must tell the OVH worker the exact proposed versions, current 359 contract, and intended sequence. After each successful application, record actual SQL hash/version/receipt, verify definitions/grants and no content mutation, then reconcile production-ledger and Core contract together. Run `node scripts/control-plane-drift-contract-check.mjs`. Coordinate the matching `deploy/ovh-production` promotion and verify actual node contract/health receipts separately from repository merge. Do not suppress a temporary drift alert or claim a 359-contract node is synchronized to a 361-migration database.

## Rollout and recovery

Apply only the reviewed additive files through the authorized migration path, one at a time, with metadata recheck before each. Compare grants, function search paths/security mode, RLS, owner gates and advisor deltas after each. New anon/authenticated execute capability must match exactly the reviewed owner-front RPCs; no blanket public grants.

Use a real owner session to verify private save/reload, denied-member behavior and conflict recovery. Installation does not authorize Publish/Restore; those remain owner actions. Verify canonical app deployment and served assets independently. Do not fabricate an owner JWT or test against production with SQL impersonation.

Prefer application rollback to the recorded prior release, leaving additive schema and private rows intact. Owner-front rollback drops only its five new functions, preserves drafts/sequence/content/history, and needs caller/dependency review before use. Portfolio rollback revokes access and preserves rows; its internal proposal is `/workspace/portfolio-765-rollback.sql`. Any rollback application must have its own real migration receipt; never erase migration history or drop owner data to make checks green.

## Local checks

- Audited pending/promoted bytes and SHA256 match exactly.
- `node scripts/control-plane-drift-contract-check.mjs`: passed, identifies both as pending/unapplied.
- `node --test scripts/test/production-schema-verifier.test.mjs`: 10/10 passed.
- Promoted portfolio harness patch: syntax passed; native execution pending the accessible hosted reset.
- No production SQL/settings, remote push, merge, activation or content publication performed.
