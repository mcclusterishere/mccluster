# PRIM3 — Tactical Courtyard Prototype

**Status: DRAFT / playable prototype.** This is a standalone, buildless source project for the styled PRIM3 courtyard. It uses the locally included PlayCanvas **2.23.1** engine and procedural 3D characters. It is a separate implementation reference, not a replacement for the existing PRIM3 client or its tactical resolver.

## Run locally

Requirements: Python 3 for a local static server, and a browser with working WebGL graphics. There is no package installation or build step. Node.js is needed only for the optional logic tests.

From the supplied project directory, run:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open **http://127.0.0.1:4173/** in the browser. Stop the server with `Ctrl+C`.

For the original workspace copy, the complete command sequence is:

```sh
cd /workspace/scratch/132434166d7e/prim3-styled-build
python3 -m http.server 4173 --bind 127.0.0.1
```

If that port is occupied, choose another port in the command and open the matching URL. Serve this directory as the document root, keeping `vendor/` beside the HTML, CSS and JavaScript files. The engine is included locally; the game does not need a CDN, API key, account, backend or runtime model download.

## Play the exercise

1. Tap an operative on the board, their E/R/T label, or their squad card.
2. Tap a cyan tile to preview a legal route. Amber marks the route and destination; the action panel shows the origin, target, grid steps and AP cost.
3. Press **Confirm move** to spend one AP and animate along the route.
4. Move **Aya / T** to a tile immediately beside the relay at **(7, 6)**. The relay's own tile is blocked.
5. With at least one AP remaining, press **Connect relay** to complete the exercise.

Each operative begins with two AP. **End turn** restores the squad to two AP each. This exercise has no enemy phase. Its prototype movement ranges are E: five tiles, R: six tiles, T: four tiles per move. Paths cannot pass through occupied or blocked cells.

### Controls

| Control | Behavior |
| --- | --- |
| Tap a character, label or squad card | Select that operative. |
| Tap a cyan tile | Preview a destination; does not spend AP. |
| Confirm move | Execute the previewed legal path for one AP. |
| Drag the 3D board | Rotate the camera. |
| 3D / Top | Change camera view without changing game state. |
| Camera reset icon | Return to the initial 3D angle. |
| Inspect | Show the selected operative's role, equipment, range and coordinates. |
| Get hint | Open optional coordinate practice while normal movement remains available. |
| End turn | Start the next turn and restore squad AP. |
| Restart icon | Reset the entire exercise. Disabled during movement. |
| Arrow keys while the board is focused | Adjust the proposed destination by one grid cell. |
| Enter while the board is focused | Confirm the current legal move. |

The coordinate exercise asks for the **minimum distance along rows and columns, ignoring cover**: `abs(target.x - origin.x) + abs(target.y - origin.y)`. Its feedback explains both coordinate changes. The actual movement preview uses the shortest available BFS path, which may be longer because of obstacles. These two distances are deliberately kept distinct. Answers clear when the operative or destination changes or movement completes. Practice does not spend AP or gate movement.

## Source file map

| File | Responsibility |
| --- | --- |
| `index.html` | Complete page structure, accessible controls and local script/style references. |
| `styles.css` | Phone-first portrait layout and larger-screen layouts; additive `min-width` breakpoints at 371, 561, 851 and 1050px. |
| `rules.js` | Pure game state, bounded BFS paths, occupancy, AP spending, turn changes and relay completion. Browser global `PRIM3Rules`; also exports to Node for tests. |
| `game.js` | PlayCanvas scene construction, procedural models, camera/picking, limb animation, route display and UI events. |
| `rules.test.cjs` | Four focused tests for path correctness, illegal moves, AP/turn behavior and relay completion. |
| `vendor/playcanvas-2.23.1.min.js` | Locally included PlayCanvas Engine 2.23.1, revision `c3eb403`. |
| `vendor/LICENSE-playcanvas.txt` | PlayCanvas's MIT license and copyright notice. Keep it with redistributed engine copies. |

The renderer consumes `rules.js` state; the rules do not depend on the DOM, rendering or animation timers. A move is validated and spends AP once before animation begins. A second movement or turn change cannot commit during that animation. The final cell is committed when movement finishes.

For integration and reproducible inspection, a successfully started scene exposes `window.__PRIM3` with `snapshot()`, `projectTile(x, y)`, `projectUnit(id)`, and the corresponding movement/camera controls. This inspection API is unavailable if graphics initialization fails.

## Character and visual scope

All exposed mannequin heads and hands use a featureless matte black material. The models have articulated procedural parts; they are **not imported, skinned GLB character assets**.

- **E / Arjun Mehta / India:** low-profile heavier carrier and compact entry tool.
- **R / Rafael Costa / Brazil:** light field layers, handheld optics and sensor equipment.
- **T / Aya Shinoda / Japan:** lighter technical kit, cyberdeck and wrist interface.

Role and nationality metadata follow the audited repository roster. The field-kit silhouettes are informed by the repository's operator kit descriptions and recovered mannequin references. The country identity is shown in the interface. Company mark zones remain blank; no trademark artwork was recreated. There are no facial features, hair, full Prime helmets or Mission Cores on these field operatives.

The courtyard contains a fixed 10 × 10 grid, low cover, planters, a low city frontage and an interactive relay. Cyan is reserved for reachability/selection and amber for the proposed route/objective. The same grid state drives both camera views.

## Tests and recorded QA

Use Node.js 18 or newer. From this directory:

```sh
node --check rules.js
node --check game.js
node rules.test.cjs
```

The four rule checks also run with `node --test rules.test.cjs`.

### Recorded results

- **JavaScript syntax:** passed for `rules.js` and `game.js`.
- **Four rules tests:** passed. They cover a forced detour that is longer than Manhattan distance; blocked, occupied and out-of-range rejection without AP loss; one AP spent exactly once with movement/turn locking; and adjacent-Aya-only relay completion.
- **Engine inspection:** the local bundle identifies as PlayCanvas 2.23.1. The Entity and StandardMaterial constructors and methods used by the scene were checked directly against that bundle.
- **CSS source checks:** passed for additive `min-width` viewport queries, bounded `minmax(0,1fr)` grid tracks, 16px answer input and 13px contextual action labels. Map controls have at least 44px hit targets.
- **Managed browser preview:** the page interface and WebGL failure screen loaded. The current cloud browser reported **WebGL unavailable** during `pc.Application` creation.
- **Phone interface QA:** in the managed browser's 390px iframe, the document had a 375px client width after the 15px scrollbar and a matching 375px scroll width: no horizontal overflow. The Get Hint button measured approximately 105.6 × 44 CSS pixels. This checked the interface in the WebGL-unavailable state, not the rendered 3D scene.

**The new scene's GPU rendering, animated movement, shadows and performance have not been verified in that cloud browser.** Logic tests and engine API inspection do not establish a successful rendered scene. No alternative browser, graphics flags or sandbox workaround was used to bypass the environment limitation. The earlier movement study's successful rendering does not count as visual verification of this revised scene.

Before treating this as a production release, run the page in a WebGL-capable desktop browser and a target phone. Check actual character selection, a confirmed move, blocked-cell refusal, both camera views, the optional coordinate lesson and relay completion. Check a 390px-wide viewport for horizontal overflow and verify the visible grid and labels while rotating. Measure performance on the intended device and representative content; no frame-rate claim is made here.

## Current limitations

- One fixed courtyard and one relay objective; no campaign, larger-map streaming or boss mission.
- No combat, hostile AI, damage, attack animations, cover-based combat calculations or real-time mode.
- Procedural character geometry and hierarchical limb animation, not the final modeled/rigged asset pipeline.
- State is in memory only. Reloading resets progress; there is no save system or account synchronization.
- No networking, multiplayer, server authority, telemetry or backend integration.
- The renderer's current performance and visual quality on physical phones remain unmeasured.
- Browsers without WebGL cannot play. In that case, game controls and inputs disable, the preview is marked unavailable, and a working **Reload game** action is shown.

## Third-party license

The included **PlayCanvas Engine 2.23.1** is distributed under the **MIT License**, copyright **2011–2026 PlayCanvas Ltd.** Its full license is preserved in `vendor/LICENSE-playcanvas.txt`, and the engine bundle retains its original license header. Include that notice when copying or distributing the engine.

Official project: https://github.com/playcanvas/engine

Engine documentation: https://developer.playcanvas.com/user-manual/engine/

This third-party license notice applies to PlayCanvas. It does not grant rights to PRIM3 story material, character references or brand assets.
