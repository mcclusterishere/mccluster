# PRIM3 level builder: canonical integration

Status: integrated onto `mccluster` main after #706 (2026-11-03); first prepared against main at
`53cdfefbf3f99e7f18945ebb10f8c987b2636dd4`. The SQL is **pending**, not applied.
No Worker deployment or hosted database change is part of this patch.

## Control and identity

The shared Control navigation adds **Create → PRIM3 Level Forge** at
`control.html#create:level-forge`. Its existing `slot` renderer loads
`window.CR.prim3Levels`, which opens `/prim3-level-builder/index.html` as a full
workspace. Control refreshes therefore do not recreate an editing iframe.

The Forge page is **owner-only and unindexed**, like every PRIM3 game page
(`js/owner-only.mjs`, `noindex, nofollow`): until `GET /v1/status` says the
signed-in account is the house owner, the page is the gate panel alone, its
markup stays in an inert template and none of its scripts load.

### One game, one format, one kit (2026-11-03 integration)

- **Play test opens the canonical game.** The Forge writes the open document to
  `localStorage['prim3.forge.playtest.v1']` and goes to
  `prim3-transit.html?level=forge&new=1`. `js/prim3-tactics/levels/index.mjs`
  routes `forge` to `js/prim3-tactics/levels/forge.mjs`, which exports the
  document into the same level-module shape every level in `levels/` has
  (`W, H, FLOORS, FRAME, toDisplay, SCENE, MISSION, surfaces(), engineConfig()`)
  on 3.54 m tiles (`scale.mjs`). The page, the three.js renderer
  (`level3d.mjs`) and the vendored resolver play it like Transit / Relay. The
  page's settings sheet links back to the Forge, which reopens the draft it
  saved before leaving.
- **No second engine, no Black Signal balance.** The former `play/` runtime and
  its movement budgets are gone. The squad's and the hostiles' numbers are
  Transit / Relay's own `engineConfig()` units; cover is Transit's `buildCover`
  rule (`deriveCover`); stairs and ladders are resolver links.
- **Playability is the resolver's.** `validateForgeLevel` runs `computeReach`
  from `tactical-resolver.mjs` on the exported state: Technical must reach a
  tile beside the relay, every operative must reach extraction, and a link a
  unit could not cross in one dash (cost > 2 × moveRange) does not count. The
  editor's check, Play test and the Worker's publish all call this one
  function. `prim3-level-builder/model.js` keeps only structural checks and the
  editor's own preview compiler.
- **One White Industrial kit.** The editor reads
  `assets/3d/prim3-kit/white-industrial/` in place (previews, GLBs; its embedded
  `catalog.js` is that `catalog.json`). The duplicate
  `prim3-level-builder/assets/` copy was removed (53 files byte-identical by
  SHA-256, plus three operator portraits only the removed `play/` runtime used).

Mapping, cells to tiles: the Forge's cells are metres, +Y north; the engine's y
runs north → south, so engine y is measured from the Forge's north edge and
`FRAME.yUp` gives the Forge's signs back (the relay at Forge (0, 0) reads (0, 0)).
A rectangle covers the tiles it overlaps by at least half a tile; a point takes
the tile it is in; a spawn the snap lands on a blocked tile or a teammate moves
to the nearest open tile (a warning says so). A stair's landing steps on, at
most two tiles, to the first tile its roof covers. Pieces with no stand-in in
the renderer (terrain, water, walls, fences, gates, pipes, rocks, HVAC) are
drawn from the kit at their exact authored place (`SCENE.props`).

On the canonical site, load `../js/backend.js` in the builder and obtain a fresh
token through `await window.MCC_SUPA.token()`. Requests go to
`https://api.mccluster.org/v1/prim3/levels` with `Authorization: Bearer <token>`.
Use JSON bodies and `cache: 'no-store'`. No second login, client service key,
external token bridge, or new database is needed. In a standalone private
preview with no canonical session adapter, local drafts remain local and cloud
controls must describe that accurately.

Every endpoint, including catalog and version reads, calls the existing
`requireHouseOwner` gate. It verifies the bearer user and live `org_members`
membership in the `mccluster` house with role `owner`. Client metadata or a
submitted actor ID grants no authority. The mutation RPC repeats the live
membership check under server credentials before writing. This is a
house-owner workspace; it does not grant ordinary organization members editing
rights.

## HTTP contract

All paths below are relative to `/v1/prim3/levels`. Responses, including errors,
carry `Cache-Control: private, no-store`.

| Method and path | Request | Result |
| --- | --- | --- |
| `GET /` | `status=active\|archived\|all`, `limit=1..100`, `offset=0..10000` | `{ok,levels,nextOffset}`; metadata only, default 20 active rows |
| `GET /assets` | None | `{ok,kit,assets}`; fixed 24-asset metadata registry |
| `POST /` | `{level}` | 201 `{ok,level,warnings}` at revision 1 |
| `GET /:id` | None | `{ok,level}` including the current draft document |
| `PATCH /:id` | `{level,expectedRevision}` | `{ok,level,warnings}` with revision incremented |
| `DELETE /:id` | `{expectedRevision}` | Archives; `{ok,level}` with revision incremented |
| `POST /:id/archive` | `{expectedRevision}` | Same archive behavior |
| `POST /:id/restore` | `{expectedRevision}` | Reactivates; revision increments |
| `POST /:id/publish` | `{expectedRevision}` | Validates playability and freezes a private version; `{ok,level,warnings}` |
| `GET /:id/versions` | None | `{ok,versions}`; newest 100 version metadata rows |
| `GET /:id/versions/:version` | None | `{ok,version}` including its immutable document |

A `level` response contains `id`, `title`, `revision`, `status` (`draft` or
`archived`), `publishedVersion`, `createdBy`, `updatedBy`, `createdAt`,
`updatedAt`, and, except in collection listings, `document`.

A version contains `level_id`, `version`, `source_revision`, `created_by`,
`created_at`, and, only for a specific version read, `document`.

Errors are `{ok:false,code,error,detail?}`. Validation details use
`detail.errors`, an array of readable messages. Relevant statuses:

| Status | Codes | Frontend behavior |
| --- | --- | --- |
| 401 | `authentication_required` | Ask the existing M Account surface to sign in |
| 403 | `owner_required` | Explain that house-owner access is required |
| 404 | `level_not_found`, `version_not_found` | Keep the local draft; show missing record |
| 409 | `revision_conflict` | Keep the unsaved local edit and require an explicit reload or new draft |
| 409 | `level_archived`, `level_exists` | Offer restore or a different new ID as appropriate |
| 413 / 415 | `body_too_large`, `json_required` | Correct the request; never silently truncate |
| 422 | `invalid_level`, `level_not_playable` | Show validation errors |
| 428 | `revision_required` | Use the revision from the explicit load or last successful mutation |
| 503 | `schema_not_installed`, `storage_unavailable`, `authorization_unavailable` | Show cloud unavailable; do not pretend the level was saved |

A client must not fetch the latest revision immediately before overwriting an
old local draft. That would defeat concurrency protection. Save with the
revision actually loaded; a conflicting save returns 409 without retries.

Publishing here means **freezing a private playable snapshot**. It does not
release a public game, change public access, or deploy a site. Repeating
publication for the same source revision returns the same version. Publishing
does not increment the document revision. Saving later leaves prior versions
untouched. The RPC locks the draft row and checks the exact revision that the
Worker validated, so a concurrent edit cannot cause a different draft to be
published without validation.

## Level document and validation

`schemaVersion: 1` uses these top-level fields only: `id`, `title`, `bounds`,
`objects`, `spawns`, `objective`, `extraction`, `connections`, and optional
`metadata`. Requests are capped at 262,144 UTF-8 bytes, including when
`Content-Length` is missing or incorrect. Level IDs are 1–80 ASCII letters,
digits, `_` or `-`, starting with a letter or digit; `assets` is reserved.

- Bounds are integer grid cells in `-256..255`, contain the origin, and have
  width and height independently in `128..256`. The starter is `-64..63` on
  both axes; the outer ruler line can correctly display `+64`.
- Up to 500 placed objects use `{id,assetId,x,y,rotation?,elevation?,scale?}`.
  `x,y` are lower-left footprint corners, not model centers. Rotation is
  `0|90|180|270`, elevation is an integer `0..24`, and uniform scale is
  `0.5..3`. The transformed nominal footprint must fit in the map. Asset IDs
  come from `level-assets.js`; arbitrary URLs, scripts, unknown properties,
  and uploaded model references are rejected.
- Up to 32 total spawns use `{id,role,team,x,y,layer?}`. Players have IDs and
  matching roles `E`, `R`, `T` and team `player`. Hostiles use unique valid IDs
  such as `H1` or `H33`, role `guard|sentry`, and team `enemy`. The 32-spawn
  limit counts current entries, not the sequence number in an ID. Layers are
  `0|1`; layer 1 refers to a
  supported roof, whose physical height comes from the asset geometry.
- The relay remains `{type:'relay',x:0,y:0}`. Extraction is a ground location
  `{x,y,radius}` with integer radius `2..16`. Both exist even in a draft.
- Up to 64 traversal connections use
  `{id,type?,from:{x,y,layer},to:{x,y,layer},cost?}`. Type defaults to `stairs`
  and can be `stairs|ladder`; integer cost defaults to 1 and is at most 128.
  A playable connection must use supported endpoints and pay at least the
  horizontal Manhattan distance plus vertical climb, preventing teleport
  shortcuts. Aligned stair assets can produce automatic connections when
  their physical rise matches the destination roof.
- Optional metadata is closed to `description` (up to 1,000 characters),
  `theme:'white-industrial'`, and `tags` (up to 12 strings of 40 characters).

Drafts may have incomplete operative placement. Publication requires all three
operatives and then the same `validateForgeLevel` the editor's Play test runs
(see "One game, one format, one kit" above): the document exported to the game's
level shape and checked with the vendored resolver. The Worker imports it from
`js/prim3-tactics/levels/forge.mjs`, as it already imports `js/travel/route-core.mjs`.
`workers/mccluster/src/prim3/level-model.js` is the editor's `model.js` as an ES
module, structural checks only; a test holds the two bodies equal. The backend
asset registry stores nominal `footprint`, `surfaceHeight`, and collision
metadata, never decorative mesh extents or remote model URLs.

## Storage and rollout

`supabase/pending/prim3_level_builder_v1.sql` adds two tables in the existing
Supabase project: mutable `prim3_levels` and immutable
`prim3_level_versions`. RLS is enabled on both with no browser-role policies.
Explicit grants allow only the server service role to read/write the required
tables and invoke the mutation RPC. Browser roles receive no table or RPC
access. The service role cannot update/delete snapshots or hard-delete drafts;
a trigger also rejects privileged snapshot UPDATE/DELETE operations.

The SQL structural validator independently bounds the document and pins asset
IDs. The Worker performs the complete closed-schema and geometry checks.
Functions use invoker rights and an empty search path. Creator/updater IDs,
timestamps, document revision, and source revision remain available for review.

After the repository's normal review/approval, apply the pending SQL using the
established migration process, record its actual production version, deploy
the canonical Worker, and release the bundled frontend/asset files. Keep the
existing origin allowlist; a standalone Sites preview is not automatically
authorized as a production API origin. Verify owner success and signed-out
denial on the deployed route. No secret values are included in this patch.

For a rollback, disable the route/launcher and keep the stored drafts and
versions. Dropping the tables is a separate data-retention decision.

## Local verification

From the repository root:

```sh
node --import ./workers/mccluster/test/support/offline-network.mjs workers/mccluster/test/prim3-levels.test.mjs
node prim3-level-builder/tests/storage-cloud.test.cjs
node --test scripts/test/prim3-forge-level.test.mjs   # the round trip: author, resolver check, play, back
npm install --prefix .tools --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
node supabase/tests/prim3_level_builder.db.mjs
```

The Worker suite checks 19 authorization, input-boundary, optimistic-save,
publication-race, and API response cases without network access. The bundled
client suite runs 15 checks against the shipped editor and client: recovery
copies, storage failures, invalid imports, create/update revision ownership,
late save/freeze responses, unsaved edits, and current bearer-token handling.

The database suite creates an isolated in-memory PostgreSQL database and
applies the pending SQL locally. Its 16 checks cover actual privileges/RLS, membership
revocation, conflicting revisions, publication idempotence, immutable
snapshots, and archive/restore. PGlite is test tooling only; the Worker gains
no runtime dependency. Its queued connections validate the stale-revision
contract; production row locks are provided by PostgreSQL's `FOR UPDATE`.
No hosted database is contacted by these suites.
