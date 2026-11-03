# Claude handoff: PRIM3 styled courtyard

## Goal and deliverable

The owner asked for actual styled, runnable source, a useful handoff to Claude, and a way to load the study into the existing site. This directory contains that visual/gameplay study. Preserve its presentation and working interactions while connecting production gameplay to the existing PRIM3 engine. It is a prototype, not a replacement LMS or a completed tactical game.

Serve this directory with a static HTTP server and open `index.html`. Files are `index.html`, `styles.css`, `game.js`, `rules.js`, `rules.test.cjs`, and the pinned `vendor/playcanvas-2.23.1.min.js` plus its licence. No build service or new backend is needed. The additive site wrapper is `prim3-courtyard.html`; install the demo runtime under `demos/prim3-courtyard/`.

The study implements a 10×10 courtyard, distinct procedural humanoid figures, selection, legal-tile highlighting, preview/confirm movement, an animated walk, AP, turn reset, optional coordinate practice, camera rotation/overhead view, and a Technical operative's adjacent relay interaction. The figures use articulated primitive meshes, not authored character assets. The current action panel is beside/below the board; it is not the final compact menu anchored to the selected character.

## Source authority: use these exact revisions

| Source | Pinned revision | Relevant files |
|---|---|---|
| Canonical content/game repository, `mcclusterishere/Prim3` main | `160020bdeac4afa0cd3f25638169e657af55bc29` | `game/runtime/tactical-resolver.mjs`; game and character canon |
| Prim3 optional-hints branch, `claude/tactical-hints-20261102` | `f4aac22386b938ffc6b74c89eab90911636733d8` | `game/runtime/tactical-resolver.mjs`, `tactical-hints.mjs`, their tests, `game/TACTICAL-HINTS.md` |
| Actual Claude 3D site branch, `mcclusterishere/mccluster`, `claude/whole-platform-20261102` | `4675108e86df9783c94f2ea8f40018d9567e0d06` | `prim3-tactics-preview.html`; `js/prim3-tactics/{preview,board3d,tactical-resolver,tactical-hints}.mjs`; `SOURCE.json` |
| Inspected site main | `9f5c834f6805fef6ea5fda44c509bb4c07551ffb` | `AGENTS.md`, shared shell, LMS, publishing workflow |
| Inspected published export | `gh-pages@d727e8c6ebceaf3ea557221b51f25c0d97e9bee1` | Neither the Claude tactical route nor its modules were present |

Recheck heads before writing. Claude's broad branch was 98 commits ahead and two behind main; do not merge unrelated platform work to publish this study. No associated PR was returned by the inspected commit/branch queries. The branch work packet explicitly calls its page an undeployed review preview. These are audit observations, not claims about a subsequent deployment.

Read [the existing 3D entry](https://github.com/mcclusterishere/mccluster/blob/4675108e86df9783c94f2ea8f40018d9567e0d06/prim3-tactics-preview.html), [renderer](https://github.com/mcclusterishere/mccluster/blob/4675108e86df9783c94f2ea8f40018d9567e0d06/js/prim3-tactics/board3d.mjs), [source pin](https://github.com/mcclusterishere/mccluster/blob/4675108e86df9783c94f2ea8f40018d9567e0d06/js/prim3-tactics/SOURCE.json), and [implementation ledger](https://github.com/mcclusterishere/mccluster/blob/4675108e86df9783c94f2ea8f40018d9567e0d06/docs/productization/20261102-claude/PRIM3-MOBILE-PASS.md). Supplied character references and design rules remain appearance authority. Do not promote these procedural figures into canonical likenesses. Use the full supplied PRIM3 artwork, proportionally scaled; never redraw a wordmark.

## Existing renderer contract

Claude already separates rendering from rules:

```js
createBoard3D(host, { width, height, onTap, reducedMotion })
// returns:
{ update, zoom, zoomLevel, canZoom, resetView, screenOf, tileAt, destroy }
```

`update(model)` receives player-visible `units`, `blockers`, directional `cover`, `objectiveTiles`, `selected`, and optional `reach`, `path`, `pathLine`, `dest`, `hint`, `origin`, `target`, `runs`, and DOM `labels`. `onTap(x,y)` uses the same controller as 2D. Grid x/y maps to world X/Z, Y up; Claude uses X=x/Z=y, while this study centres coordinates at x−4.5/y−4.5.

Adapt the study renderer to this contract, or port its materials, procedural rig and animation into the existing Three renderer. Decide explicitly; the study's PlayCanvas dependency does not require replacing Claude's engine. Keep one authoritative gameplay state. The study's `window.__PRIM3` exposes `snapshot`, preview/select/confirm/end-turn/connect/reset/view controls and projection helpers for inspection, not a production server API.

## Prototype rules must not become accidental canon

`rules.js` is a small independent prototype. It performs orthogonal BFS around blockers and occupied cells, spends one AP when a move starts, completes position after its visual walk, restores AP on End turn, and lets T connect while adjacent to the relay. It has no server persistence, hostile units, combat, line of sight, overwatch reactions, authored animation clips or first/third-person control.

Differences are deliberate prototype boundaries: E/R/T IDs differ from E1/R1/T1; E/R movement ranges differ; two canonical cover tiles are impassable here; the relay is blocked and adjacent connection is a local exercise rule. Do not silently import those choices into production. The study teaches obstacle-free Manhattan distance and separately reports the actual BFS route length when cover causes a detour. Every role currently gets that same coordinate exercise; it does not implement the E-math/R-science/T-IT curriculum or canonical hint scoring.

Canonical `moveUnit` still validates an endpoint rather than a shared traversable route. Claude's UI uses `knownPaths`, but UI filtering alone does not make the resolver authoritative. The pinned resolver also lacks resolved overwatch and hostile AI; its objective actions need spatial rules. End turn in Claude's preview advances phases without an enemy turn. Its browser save and locally held challenge secret are preview facilities, not authenticated production persistence. Do not advertise these gaps as completed systems.

## Ordered integration work

1. **Preserve and run the study.** Record the exact source, run its rules tests, and verify actual browser play before editing. Keep this independent demo available for visual review. Read main `AGENTS.md`, `CLAUDE.md`, ECOSYSTEM, shared-navigation and universe documents completely.
2. **Add the scoped site route.** Copy only required runtime/assets to `demos/prim3-courtyard/`, retaining the engine licence. Add the supplied wrapper at root. Keep `prim3.html` (account-gated LMS) and `prim3-range.html` (M01 classification range) intact. Add a clearly labelled study link in the existing PRIM3 surface within the approved scope.
3. **Connect a renderer adapter.** Replace the study's independent state reads with the canonical player projection and controller. Map IDs/coordinates once. Renderer meshes must never decide legality, expose hidden enemies or mutate AP. Confirm spends exactly once; animation depicts committed state and cancellation cannot refund a committed action.
4. **Fix shared movement legality in Prim3 first.** Require integer, in-bounds, connected traversable paths, occupancy and phase/AP checks in the authoritative resolver. Handle unknown occupancy without revealing hidden units. Use the same path result for preview and execution. Re-vendor exact files and update `SOURCE.json`; its hash test forbids silent local edits.
5. **Restore canonical learning.** Use exact grading and explicit field mappings. Keep origin, target, coordinate distance and traversable path length distinct. Wrong answers scaffold; revealing never earns independent mastery; normal movement remains available. A real mastery write needs the existing authenticated backend, not a client assertion.
6. **Add authored assets and real tactical systems incrementally.** Audit each side's three character types and reference sheets; preserve silhouettes/wardrobe identity. Import licensed, optimized rigs and clips, then add tested objective resolution, AI and reaction events. Large maps require chunking, visibility culling and local path queries; do not scale a per-tile scene to a million meshes.
7. **Verify and publish through the existing gate.** At 390px require document scrollWidth === clientWidth, readable coordinates, 44px controls, text inputs ≥16px, keyboard operation, reduced motion, loading/failure behavior and no duplicate shell. Test preview spends nothing, blocked movement fails, confirmation spends once, End turn cannot interrupt execution, optional questions do not gate play, and the relay rule matches the chosen engine. Report actual executed checks separately from old work-packet claims.

## Hosting and approval

The wrapper owns shared `css/style.css`, `js/mcc-auth.js` and `js/tabbar.js`; the embedded demo owns gameplay only. The demo currently loads no site bar. If one is added later, set `data-no-appbar` before it runs. Preserve pinch zoom and use min-width breakpoints/minmax(0,1fr). The wrapper reserves the account area and bottom navigation and resizes its same-origin frame to content; it does not transmit credentials.

Production is `https://matthew.mccluster.org`. Main's deploy-pages workflow waits for exact-SHA checks and publishes a stripped static export to gh-pages. Root HTML and `demos/` survive; `PRIM3/`, apps, packages and docs do not. Cloudflare Direct Upload is documented as a staged cutover, so this task needs no DNS/Worker change. Existing explicit owner approval can authorize the scoped release; do not bypass CI or treat it as permission for unrelated branch changes. Register an actual new universe if the study is later promoted into one; do not rewrite the proposed universe contract to force a prototype through it.

## Future active-turn and teaching requirements — not implemented

Plan while the simulation is paused, then commit a bounded run with genuine steering. Proposed execution must consume AP and enforce both elapsed simulation time and actual distance; attacks, dodges and crouching need explicit costs/cooldowns. A dash cannot secretly include unlimited firing. Reserve reactions at commit, resolve them in deterministic simulation order while the operative moves, then settle pending effects before planning resumes. Start solo with AI; human reaction multiplayer requires authoritative timing, latency and disconnect rules.

A global pause freezes everyone. To remain exposed while solving, the operative can stop but the simulation cannot pause. Optional assisted slow time must slow the whole simulation consistently. Separate mathematical correctness from whether a moving target/action opportunity remains available. Freeze the question's data when opened, then revalidate gameplay eligibility on submission; the current stale-on-any-board-change hint binding will not support live execution unchanged.

For numerical trajectory learning, use a harmless holographic training orb between pads: fictional grid displacement, transit ticks and clearly stated game parameters. Teach the declared model with exact grading and visible units, not real weapon targeting formulas. Keep ordinary play available and distinguish educational evidence from tactical success.
