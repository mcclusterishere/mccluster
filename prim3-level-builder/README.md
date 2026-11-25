# PRIM3 Level Forge

An additive level-authoring workspace for McCluster Control → Create → PRIM3 levels.
The entry point is `/prim3-level-builder/index.html`.

## What this package contains

- A portrait-phone-compatible drag-and-drop editor, numbered signed-coordinate grid,
  JSON import/export, exact transforms, deployments, traversal links, and undo/redo.
- No asset copies: the editor reads the game's White Industrial kit in place,
  `../assets/3d/prim3-kit/white-industrial/` (24 GLBs, previews, catalog, generator).
- **Play test** opens the level in the PRIM3 game itself:
  `../prim3-transit.html?level=forge&new=1`, through
  `js/prim3-tactics/levels/forge.mjs`, which exports the document into the game's
  level shape on 3.54 m tiles and checks it with the canonical resolver. The game's
  settings sheet links back here; the draft reopens from this device.
- An optional client for the canonical owner-authorized
  `https://api.mccluster.org/v1/prim3/levels` API.

The assets are starter static meshes. They are not final photorealistic assets,
rigged actors, or replacements for the owner-supplied operator references. The
complete PRIM3 header mark comes from the existing canonical
`assets/img/prim3-lockup-512.png`, proportionally scaled without cropping.

## Runtime boundary

The Forge authors; it does not play. There is one game: the canonical PRIM3 tactics
page and the vendored resolver (`js/prim3-tactics/`, `SOURCE.json`). The former
Black Signal mission-test runtime and its movement budgets were removed when this
was integrated (2026-11-03). `model.js` holds the document's structural checks and
the editor's own preview compiler; whether a level can be played is
`validateForgeLevel` in `forge.mjs`, the same function the Worker runs before a
version is frozen. It adds no universe portal, new auth stack, alternative backend,
or database. It does not modify the canonical Site 0 geometry or Uprise World.

The page is owner-only (`../js/owner-only.mjs`) and `noindex`, like every PRIM3 game
page. The canonical Control navigation (`control.html#create:level-forge`) owns
discovery and return navigation. The editor loads the existing `../js/backend.js`
M Account integration. Every cloud request obtains a current bearer token and the
server enforces house-owner authorization. No token is stored in an exported level
or in browser draft metadata.

## Storage and private versions

Device-local autosave is labelled as such. Before replacing an open document, the
editor durably retains a recovery draft; a storage failure aborts replacement.
Cloud creation uses POST. Updates require the exact revision from an explicit
load or a successful save in the current session. Stale writes never automatically
reload and overwrite. A frozen version is a private immutable playable snapshot;
it does not publish a game or deploy a website.

**The accompanying canonical API code and database migration still need their
normal review and deployment before live cloud saving is available.** The static
editor can be reviewed and used with local drafts independently. Missing schema,
denied permission, sign-in, network, and revision-conflict failures remain visible.

## Files and dependencies

`model.js` holds the signed-grid level document and its structural checks.
`render.js` provides the editor's PlayCanvas WebGL view and the projected Canvas2D
compatibility renderer (an editor viewport, not a game). The bundled PlayCanvas
license is in `vendor/LICENSE-playcanvas.txt`.

## Validation

Run from the repository root:

```sh
node prim3-level-builder/tests/storage-cloud.test.cjs     # storage, cloud and Play test hand-over
node --test scripts/test/prim3-forge-level.test.mjs       # export, resolver check, a played round trip
```

The client suite executes the shipped editor, catalog, model, and client without
rewriting their source; DOM and renderer test doubles isolate persistence and
request races from browser rendering. Live cloud behavior requires the canonical
migration and Worker deployment; it must not be described as already live merely
because this directory exists.
