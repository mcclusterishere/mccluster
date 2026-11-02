# Combined #681/editor checkpoint — v3

This is a local combined-source contract checkpoint and the whole-site master assignment update. The immutable c150593 bundle remains available unchanged. Use the updated [one whole-site Claude assignment](../20261102/CLAUDE-PROMPT.md) and [coverage/acceptance appendix](../20261102/WHOLE-SITE-ACCEPTANCE.md), not the old editor-only prompt as a scope ceiling.

## Exact integration approach

Base: PR681 `5e020833534b68b31e191b137e9a30da8b58314f`. Local branch `codex/backend-editor-681-integration-20261102`. Applied audit40efe75 as10ccd325 and editorc150593 as76adb129, resolving only the entry-platform import conflict and live-callers registry conflict by preserving681 entries plus editor registration. The final patch adds the changes below. No blind merge; all681 routes/imports retained. Main `e80cb0a137683393f19ba251f9beb9e66577ce64` remains14 commits ahead of the candidate's merge base and is NOT fully integrated by this work. Root test counts differ from main because this is the exact681 base, not a rewritten main.

## Changes and verified boundaries

- v2 uses681's exact offers/cinematic validator and rejects personal-front references to the owner's project-media subtree, including offer logos/images. Project media remains scoped to the exact project.
- `POST /v2/projects/{slug}/withdraw` with `{expected_revision}` soft-removes and unpublishes an ordinary front project; retains row, immutable ID, slug reservation, draft and history. No physical deletion or uploaded-byte deletion.
- `POST /v2/projects/{slug}/recover` with `{expected_revision}` clears removal only when the private head records that this API performed the owner withdrawal. Returns an unpublished retained draft. It cannot reverse prior legacy or moderation removal, change ownership or automatically publish. No restore_revision/config required.
- Responses now include `owner_withdrawn`. Withdrawal and recovery each append an immutable history event with authenticated actor and advance revision. Existing save/restore/unpublish APIs remain compatible. Wrong owner404, stale409, unauthorized recovery403; front/site withdrawal actions rejected. Failed mutations roll back the provenance marker with source/history.
- Prepared SQL remains `supabase/pending/editor_versioned_contracts_v1.sql`: adds one private-head boolean and replaces existing pending functions. No production file/version was fabricated. Replay applies exact c150 SQL, then new SQL twice; old history/baselines remain intact. Before any eventual application, review the new exact hash and schema/data impact, back up private histories and source tables, coordinate all callers, and preserve rollback compatibility. Do not drop history/protection to roll back clients; disable new enrollment and retain protected-record support.

## Combined replay and a real remaining gate

Fixtures pin exact681 validator, front/project handlers, Studio SQL and Tile RPC SQL. Synthetic media/billing dependency tables are explicitly marked; they do not prove external media/financial services. Replay includes actual website_studio_v2, project_tiles_v1 and project_tiles_free_v1. An unenrolled project's existing Tile save and free publish still work. v2 rejects Tile presentation editing via its front API.

**Mixed-editor rollout remains blocked:** after a front enrolls in v2, old project_tile_save_v1 writes fail PT409; the whole Studio transaction rolls back without a leaked draft. This is an observed compatibility gate, not feature-complete coexistence. A reviewed bridge must carry BOTH the editor-head revision and Studio revision, take the editor lock before existing row locks, reuse existing validation/publication/media/entitlement checks, and preserve an explicit presentation switch. Existing Tile RPCs take row locks before updates, so concurrent lock ordering must be proven, not inferred from our standalone races. Do not enable v2 across users who need these existing paths until bridge/caller proof. Never silently disable Tile Studio to resolve the gate.

Existing UI mounts still use legacy writes: js/front-studio.js (personal/project save and unpublish), js/customer-projects.js (soft removal), js/control-room/front-page.js (homepage save/reset), js/site-editor.js (inline save/reset). They must adopt revision/readback/conflict handling together for enrolled records. Public reads remain their existing handlers. No production UI was changed here.

## Reproduce

```
npm ci --prefix scripts/test/editor-tools --ignore-scripts --no-audit --no-fund
PGLITE_DIR="$PWD/scripts/test/editor-tools/node_modules" node scripts/test/editor-versioned-db.mjs
PGLITE_DIR="$PWD/scripts/test/editor-tools/node_modules" node scripts/test/prepared-foundation-db.mjs
python3 scripts/test/editor-versioned-native.py --docker
```

PGlite tests need no Docker. Native proof also supports local PostgreSQL via explicit localhost only; this run used the pinned network-isolated Docker image. The archive contains scoped executable sources and fixtures plus a patch against exact681; it is not a full asset checkout. The full Worker/root suites ran in the combined worktree. Local Node24; proposed CI Node22 was not remotely executed.

Evidence files record128 combined SQL/HTTP/hash assertions,28 foundation permission assertions; native simultaneous writers for Control/project/front plus withdrawal/save, duplicate recovery and publish/takedown. Existing candidate Worker1330 pass/4skip, root1313 pass. Full real Auth/Storage/browser publication journeys have NOT run. Source/hash checks and local SQL are not deployed acceptance.

## Backend queue for the whole-site assignment

1. Primary promise: ordinary user signup→supported free template→text/images→save/resume→preview→platform URL publish→signed-out public load, wrong-user edit denied. Keep owner and Control-admin authority separate. Prove free entitlements/quotas and Storage before marketing it.
2. Bridge editor enrollment with existing Tile save/publish/presentation switching; coordinate every mounted legacy writer and moderation path. Native lock-order and stale-publish tests required.
3. Main/681 reconciliation preserves recent privacy/payment/migration hygiene; do not infer full-stack readiness from this combined base.
4. Actual-service Auth/Storage/session/account-switch/public-renderer and mobile390px acceptance; no claim from fixture Auth.
5. Platform-first: reconcile canonical tenant/module catalog/entitlement authority and separately paid-domain fulfillment before a one-month platform trial; trial eligibility/end/renewal consent/prices/export/retention remain owner choices. No automatic charges or data deletion. General module controls need real dependency/disable/drain semantics; existing two switches are not that contract. Other domains, commerce, lyrics, actors and private LMS/game gates remain in the master matrix.

No push, merge, production SQL, flags, deployment, provider call, purchase or paid ad occurred. Anti-Social asset/version/rights remain unverified in this task; the master assignment prepares creative/landing locally and makes product readiness a prerequisite to campaign launch.
