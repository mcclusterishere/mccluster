# PRIM3 Level Forge

An additive level-authoring workspace for McCluster Control → Create → PRIM3 levels.
The entry point is `/prim3-level-builder/index.html`.

## What this package contains

- A portrait-phone-compatible drag-and-drop editor, numbered signed-coordinate grid,
  JSON import/export, exact transforms, deployments, traversal links, and undo/redo.
- Twenty-four reusable static GLB environment meshes, rendered thumbnail previews,
  collision/surface metadata, and a repeatable generator under `assets/`.
- A dedicated **Black Signal** mission-test runtime under `play/`, with the same
  data-only level compiler used by the editor.
- An optional client for the canonical owner-authorized
  `https://api.mccluster.org/v1/prim3/levels` API.

The assets are starter static meshes. They are not final photorealistic assets,
rigged actors, or replacements for the owner-supplied operator references. The
play view retains its existing procedural animated characters and exact supplied
portrait files. The complete PRIM3 header mark comes from the existing canonical
`assets/img/prim3-lockup-512.png`, proportionally scaled without cropping.

## Runtime boundary

This is the dedicated Black Signal preview runtime, not a replacement or local
edit of the separately vendored canonical tactical resolver. The builder shares
data through a versioned document; gameplay rules remain separate from rendering.
It adds no universe portal, new auth stack, alternative backend, or database.
It does not modify the canonical Site 0 geometry or Uprise World.

The canonical Control navigation owns discovery and return navigation. The editor
loads the existing `../js/backend.js` M Account integration. Every cloud request
obtains a current bearer token and the server enforces house-owner authorization.
No token is stored in an exported level or in browser draft metadata.

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

`model.js` compiles the signed-grid level document. `render.js` provides PlayCanvas
WebGL and the projected Canvas2D compatibility renderer. All editor models and
previews are local files. The bundled PlayCanvas license is in
`vendor/LICENSE-playcanvas.txt`. `play/standalone-export.js` embeds local runtime
scripts, styles, supplied portraits, and the selected custom level when saving an
offline playable HTML.

The current environment kit metadata and actual-mesh overview are available in
`assets/README.md`, `assets/catalog.json`, and `assets/asset-kit-overview.png`.

## Validation

The merged source build was checked with level/compiler tests, mission-engine
tests, original-map replay, browser editor interactions, and a portrait-width
overflow measurement. The portrait Test Level view also completed a verified
one-cell movement that consumed one action point.

Run `node prim3-level-builder/tests/storage-cloud.test.cjs` from the repository
root for 13 storage and cloud safety regressions. These tests execute the shipped
editor, catalog, model, and client without rewriting their source; DOM and renderer
test doubles isolate persistence and request races from browser rendering. The
scenarios cover recovery copies, quota failures, invalid imports, create/update
revision ownership, late save/freeze responses, unsaved edits, and token handling.

Live cloud behavior requires the canonical migration and Worker
deployment; it must not be described as already live merely because this directory
exists.
