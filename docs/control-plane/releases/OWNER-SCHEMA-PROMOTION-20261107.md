# Owner editor, learning portfolio and Arcade: canonical schema promotion

Status: local preparation only, not production-applied. Intended PR base `main`, starting at `55befc618eb24d21a37e6c4afd66c1bb47767237`. Local branch `codex/owner-schema-promotion-20261107` includes normal merges of the exact reviewed #741 and #765 heads; both native CI steps are retained. The release coordinator owns application and relays the contract change to the separate OVH promotion worker. Arcade promotion commit `c8abff9a485a2fad92f8e53f95fe1c4d7c3ea88d` is included by normal merge. Finance remains outside this package.

## Exact additive artifacts

Created with Supabase CLI 2.117.0 `migration new`, after command help discovery. Owner-front bytes remain unchanged. Portfolio adds the reviewed enabled-house guard to both source and promotion copies; Arcade includes its enabled-house repair. Each promoted file matches its pending source exactly, including historical proposal comments; those comments are provenance, not a claim of production state.

| Migration | Audited source | SHA256 |
| --- | --- | --- |
| `20261107133116_owner_front_publication_v1.sql` | #741 integrated `e21f4bb4811cdca0db45f30db2a8f9e770535f82`, `supabase/pending/owner_front_publication_v1.sql` | `dde2660db40380aa317b83dcb4a2d03e050617707c57ab3146c8817b150a78f2` |
| `20261107133124_learning_portfolio_v1.sql` | #765 `9218175e77a14a10d76849d38074871469e17239`, `supabase/pending/learning_portfolio_v1.sql` plus enabled-house repair | `e8305cb48e4f05a6f5bb8796646a675b2264b6b7c33e2a5fcd3eb40d9f9aaec7` |
| `20261107133314_city_arcade_v1.sql` | `c8abff9a`, `supabase/pending/city_arcade_v1.sql` | `dab0dc3031b9f1e0844ae8cbb3ca30f0e1fa127b5867b8b5c2ac60b02bc421e1` |

Do not concatenate rollback SQL. Do not run an unrestricted database push containing unrelated pending changes. If the authorized application mechanism assigns a different version, use its actual receipt and reconcile the canonical filename; never claim the proposed version was applied without verifying it.

## Access and publication review

Owner front adds a FORCE-RLS draft table and revision sequence with no browser table access. Four new authenticated SECURITY DEFINER RPC entry points all require non-null canonical `auth.uid()` and existing `mnet_is_admin()`, with fixed search paths. Existing identity helpers, published `site_content`, its grants, writer gates and immutable history trigger are unchanged. The validator is not browser-executable. This includes the existing owner's Publish capability, not only private draft operations; installing the functions does not publish anything or confer owner authority on members.

Learning portfolio adds an RLS table with no anon/authenticated access and a service-role-only SECURITY INVOKER RPC with empty search path. It additionally checks canonical mccluster owner membership and `orgs.enabled IS TRUE`. The former `367bbb98…` payload lacked the enabled-house revocation guard and is superseded; its hosted proof must not be represented as proof of the new hash. Save/publish/unpublish use revision CAS; null/negative revision and null/unknown action are rejected before insertion. Worker validation and the frozen allowlisted public projection remain required: direct privileged SQL is not a replacement for owner authorization or snapshot validation. Installation inserts no portfolio/public content.

Arcade adds service-only RLS mission/version/run tables and invoker RPCs, validates game documents and current enabled-house owner membership, serializes first saves, and freezes started-run versions. This installs no mission, activates no flag and does not prove live Cesium ion.

None of these payloads adds credentials, trading, new admins, public draft reads, or broader tenant membership. Service-role access remains confined to the trusted backend. Ordinary owner-feature migration authorization does not authorize publishing user content or changing identity/credential settings.

## Preflight and existing native evidence

Immediately before applying, refresh metadata-only object collision, dependencies, owners, grants and ledger checks. Stop on any unexpected preexisting object, incompatible definition or changed hash. Do not read or copy private draft/publication values into a public report.

- Owner front: `auth.users`, canonical M-account identity/admin helpers, `site_content`, `site_content_history`, unique page/slot index, existing set/revert RPCs and audit trigger. Earlier read-only review found compatible prerequisites and no proposed objects. Internal handoff: `/workspace/owner-front-rollout-review-20261107.md` and its preflight JSON files.
- Portfolio: `auth.users`, `orgs` including `enabled`, `org_members`, `learning_external_credentials`, canonical owner membership model and service read privileges. Internal handoff: `/workspace/portfolio-765-preflight.sql` and `/workspace/portfolio-765-release-review.md`. Parent confirmed table/RPC absent at prior check; rerun at action time.
- Owner native proof: [job 128407064692](https://github.com/mcclusterishere/mccluster/actions/runs/42373766439/job/128407064692), canonical reset/manifest plus 12 genuine multisession checks.
- Portfolio native proof: coordinator confirmed job `128413317069` passed at `9218175e`; includes real initial-insert and save/publication lock waits, one CAS winner, denied clients, null inputs, rollback/reapply and managed auth. This is proof of the audited payload, not yet the new three-migration reset.

- Arcade: refresh metadata-only absence/signature checks for its three tables and two functions; verify `orgs.enabled`, canonical membership and required service-role read privileges. Its separate native PostgreSQL 17.6 proof passed concurrent first-save conflict, duplicate finish/frozen score, disabled house/revocation and direct-client denial. Auth/tenancy in this proof are minimal fixtures, not managed canonical auth.

## Required integration and manifest sequence

1. Integrate the three migrations with the reviewed #741/#765 application changes and the merged Arcade schema/guard changes. Keep their pending source/rollback files while native tests reference them; do not deploy a partially integrated branch.
2. The branch updates portfolio native proof for the promoted case. The old harness deliberately refuses an existing table. The committed harness requires the exact new migration receipt, complete table/RPC, zero preexisting rows, and byte-equal pending/promoted SQL. Cleanup removes only the synthetic owner row and retains the promoted schema. Pending-mode rejection and all CAS/role assertions remain. This change requires native hosted execution; syntax alone is not proof. Owner-front harness already reapplies its SQL idempotently.
3. Run the full canonical replay reset and capture `reset-schema/reset-schema-snapshot.json` and `schema-manifest.json` from Reconciliation CI. Local attempt could not start because Docker pulls from `public.ecr.aws` returned Forbidden; no local database/reset success is claimed. No substitute auth schema or manually fabricated manifest is acceptable.
4. Regenerate `supabase/schema-manifest.json` with `scripts/db/verify-production-schema.mjs --mode reset --write-manifest` from that exact reset snapshot; rerun its integrity/diff checks. Expected changes are only these three features’ tables/sequence/RPCs and their grants/constraints/policies. The manifest is generated reset state, not evidence production already has it. Retain the failing manifest comparison gate until the correct manifest is committed; do not weaken it.
5. Run both canonical native proof suites and the separate Arcade fixture-auth native job after manifest capture, full root checks, exact-head hosted gates and independent review. This local artifact is not merge-ready until the generated manifest and promoted native proof pass.

## Production ledger and OVH coordination

Current recorded baseline: 359 migrations; latest `20261103182544_learning_evidence_v1`; ledger SHA256 `41b4bd62a4cdd052b95aa96de6ffce745611f0bcd65cb2395b3ebc0f9a862bfc`.

The drift checker explicitly allows newer unapplied canonical migrations. Therefore this preparation leaves `supabase/production-ledger.json` and `core/drift-contract.json` unchanged. Updating either now would falsely assert application.

Only if the baseline is still exact and these three versions are the only additions, expected checkpoints are:

| Receipt state | Count | Latest version/name | Canonical ledger SHA256 |
| --- | --- | --- | --- |
| Owner front only | 360 | `20261107133116` / `owner_front_publication_v1` | `aa4f02dfc8dc3c8c42e0382882a92e418ce03fc0e00df7d640eacfe3a8379efb` |
| Owner front + portfolio | 361 | `20261107133124` / `learning_portfolio_v1` | `3b32de70e9d84f4d2cfc7340c6e43b4bac05a7ae708c752668c7dfcf891ab138` |
| All three | 362 | `20261107133314` / `city_arcade_v1` | `e2e93ebf04a52d56a97a21ce103481d57d13c623b6a1ddbcf7f87d58e9362fe1` |

These are expectations, not receipts. If another migration lands, recompute from the actual complete ledger. Algorithm: sort `{version,name}` by version then name, join `version:name` with newline and no final newline, SHA256 UTF-8. Preserve historical alias handling; use `scripts/supabase-compare-live-ledger.mjs` on a fresh metadata export.

Before application the coordinator must tell the OVH worker the exact proposed versions, current 359 contract, and intended sequence. After each successful application, record actual SQL hash/version/receipt, verify definitions/grants and no content mutation, then reconcile production-ledger and Core contract together. Run `node scripts/control-plane-drift-contract-check.mjs`. Coordinate the matching `deploy/ovh-production` promotion and verify actual node contract/health receipts separately from repository merge. Do not suppress a temporary drift alert or claim a 359-contract node is synchronized to a 362-migration database.

## Rollout and recovery

Apply only the reviewed additive files through the authorized migration path, one at a time, with metadata recheck before each. Compare grants, function search paths/security mode, RLS, owner gates and advisor deltas after each. New anon/authenticated execute capability must match exactly the reviewed owner-front RPCs; no blanket public grants.

Use a real owner session to verify private save/reload, denied-member behavior and conflict recovery. Installation does not authorize Publish/Restore; those remain owner actions. Verify canonical app deployment and served assets independently. Do not fabricate an owner JWT or test against production with SQL impersonation.

Prefer application rollback to the recorded prior release, leaving additive schema and private rows intact. Owner-front rollback drops only its five new functions, preserves drafts/sequence/content/history, and needs caller/dependency review before use. Portfolio rollback revokes access and preserves rows; its internal proposal is `/workspace/portfolio-765-rollback.sql`. Any rollback application must have its own real migration receipt; never erase migration history or drop owner data to make checks green.

## Local checks

- Audited pending/promoted bytes and SHA256 match exactly.
- `node scripts/control-plane-drift-contract-check.mjs`: passed, identifies all three as pending/unapplied.
- `node --test scripts/test/production-schema-verifier.test.mjs`: 10/10 passed.
- Portfolio PGlite behavior proof passes disabled-house rejection for save/publish/unpublish before initial insertion and on existing state; native canonical suite now has the same unchanged-row assertions, pending hosted execution.
- Arcade native PostgreSQL 17.6 proof independently passed after integration. The separate CI job installs pinned `@embedded-postgres/linux-x64@17.6.0-beta.15` and `postgres@3.4.7` in an isolated temporary prefix with lifecycle scripts disabled; no external database URL or credentials. It runs even while the reset manifest comparison awaits its generated artifact.
- Promoted portfolio harness: syntax plus 13 focused guard/schema-verifier tests passed; native execution pending the accessible hosted reset.
- No production SQL/settings, remote push, merge, activation or content publication performed.

## Exact hosted artifact handoff

Root publishes this branch as a draft PR. The first Reconciliation CI run is expected to fail the strict manifest comparison, while its `Upload the rebuilt schema snapshot` step runs with `if: always()`. Confirm the reset itself succeeded and the artifact comes from the exact branch head before using it. Download the `reset-schema` artifact for that run into an isolated directory, then run from this branch:

```sh
node scripts/db/verify-production-schema.mjs --snapshot /tmp/owner-promotion-reset/reset-schema-snapshot.json --mode reset --write-manifest --manifest supabase/schema-manifest.json --report-json /tmp/owner-promotion-reset/generated-report.json --no-fail
node scripts/db/verify-production-schema.mjs --snapshot /tmp/owner-promotion-reset/reset-schema-snapshot.json --mode reset --report-json /tmp/owner-promotion-reset/verified-report.json
```

Review the manifest diff before committing. Do not copy a snapshot from the old branch without all three migrations. Push the generated manifest through the root coordinator, then require a fresh successful canonical reset plus both canonical native suites and the Arcade fixture-auth job on the new exact head; downstream native steps are skipped during the initial manifest mismatch. Keep production ledger/Core unchanged until actual apply receipts as above. A hosted reset failure before snapshot generation must be fixed, not bypassed with the old artifact.
