# Versioned Tile/editor bridge — local, unapplied

Base57367b4576b23df1dd23b6eb17bba8b10f940f63. Branch codex/tile-version-bridge-20261102. No production SQL/flag/deployment/purchase. Apply after existing pending editor and Tile schemas; SQL must be reviewed with the actual target schema before promotion.

`project_tile_editor_v2(uuid,uuid,text,text,bigint,integer,jsonb,uuid)` is service-executable only. The wrapper verifies service JWT role, active primary M link and BOTH auth-user/M ownership. It takes the global editor advisory lock before any project/Studio row locks and checks expected editor-head and Studio revisions. It reuses existing Tile save/free-publish/paid-publish functions inside audited editor context. The migration also recreates those three existing signatures with the advisory lock acquired before their original row locks; remaining behavior and grants are preserved. This prevents legacy calls from reversing lock order against the new wrapper. Old unenrolled calls continue to work; protected blind calls still fail atomically.

New routes use the SAME handler and existing document/media/visibility/entitlement validation:

- `GET /v2/projects/{slug}/tiles`: existing owner draft projection plus `editor_revision`, `studio_revision`, `owner_withdrawn`, `removed`.
- `PUT /v2/projects/{slug}/tiles`: `{expected_editor_revision,expected_revision,document}`. Both tokens are mandatory. Response wraps existing Studio result as `result` and returns both new revisions.
- `POST .../tiles/publish`: both revisions plus `confirm_public:true` and existing `org_id` when paid. Existing free flag or live paid entitlement checks remain; SQL rechecks visibility and paid membership/subscription. Missing/unapproved media remains refused by existing resolution before mutation. No test calls a real provider.
- `POST .../tiles/unpublish|withdraw|recover|switch-front`: both revision tokens. Withdrawal retains both drafts/history/slug/ID; recovery only reverses this contract's owner withdrawal and leaves publication null. `switch-front` explicitly switches to the retained cinematic/front draft UNPUBLISHED, never resurrecting stale public content. Studio drafts/revisions remain. No implicit presentation switch on save.
- Existing `/v1` routes retained. `/v2` additionally requires `EDITOR_V2_ENABLED=true`; existing WEBSITE_STUDIO_ENABLED remains required. No flags changed.

Every success advances the managed-project head and appends actor/operation evidence. Failure rolls source, Studio draft changes and history back. Conflict SQL PT409 maps to HTTP409 through the shared store. Front-only API still refuses a Tile presentation; use the Tile bridge to withdraw/recover or switch first.

## Verification

57 dedicated real SQL/HTTP/hash assertions; native simultaneous editor writers plus legacy/v2 Tile lock ordering and stale publish/withdraw; full existing Worker suite1330 pass/4skip. SQL is replayed twice. Negative anon/authenticated execute, wrong owner and wrong M identity tested. Injected downstream failure proves no Studio revision/head advance. Actual HTTP route calls retain media guard and require both tokens. Source pins include original681 Tile SQL and portable fixture sources. Synthetic dependency catalogs are NOT live media/payment proof.

```
npm ci --prefix scripts/test/editor-tools --ignore-scripts --no-audit --no-fund
PGLITE_DIR="$PWD/scripts/test/editor-tools/node_modules" node scripts/test/tile-editor-bridge-db.mjs
python3 scripts/test/tile-editor-bridge-native.py --docker
(cd workers/mccluster && npm ci --ignore-scripts && npm test)
```

CI wiring added; not run remotely. The native driver includes prior editor concurrency proofs and the new legacy/Tile races. Pending live-callers registry includes the new RPC.

## Remaining gates

Frontend adoption of both revisions and explicit switch/withdraw/recover remains required, along with all legacy writer migration and independent review. No actual Auth/Storage/browser/paid-provider acceptance was performed. Paid entitlement semantics are preserved, not expanded into the new proposed platform trial. Main/681 reconciliation remains separate. Domain registration and platform module/trial policy are untouched. Preserve newer parent front-media path hardening when integrating; refresh its entry in tile-bridge-hashes.json against the reviewed source, not this older base.
