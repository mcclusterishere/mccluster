# PRIM3 mobile game acceptance pass — work packet (2026-11-02)

Part of the same PRIM3 work packet as the optional learning-unlocked hints (HANDOFF.md → "PRIM3 optional learning-unlocked tactical hints"). Same engine and rules: `js/prim3-tactics/tactical-resolver.mjs` and `tactical-hints.mjs` are exact, hash-pinned copies of `mcclusterishere/Prim3` `claude/tactical-hints-20261102` = `f4aac22386b938ffc6b74c89eab90911636733d8` (`SOURCE.json`; `scripts/test/prim3-tactics-vendor.test.mjs`). The page is `prim3-tactics-preview.html`, a noindex review-branch preview, not public canon and not deployed.

Status words:
- **designed**: specified here, not built.
- **implemented**: code on this branch.
- **verified**: an automated check exercises it (no "verified" claim rests on a screenshot alone).

## Interaction

| Requirement | Status | Evidence / note |
|---|---|---|
| Tap the character on the board to select | implemented · verified | e2e "tapping E1 on the board opens its action menu" |
| Compact contextual menu with only currently legal actions | implemented · verified | **Menu contents:** Move (≥1 AP), Dash (≥2 AP), Fire at each known hostile the engine's `shotPreview` allows, Reload (only below a full magazine with reserve), Overwatch, Hunker, Inspect, Get hint, Close. **Placement:** docked directly under the board, so it never covers a tile. **Checks:** e2e "no Reload with a full magazine", "R1 is offered Reload", "Fire only at a known hostile in line of sight". |
| Movement range + destination preview | implemented · verified | Lit tiles come from `knownPaths` (orthogonal steps over known walls/units), and the e2e checks they equal the engine's `legalCandidates`. A tap previews the path, step count, AP and which known hostiles would have a shot there, using the engine's own `shotPreview`. |
| Tap-to-preview, deliberate Confirm, clear Back/cancel; no accidental spend | implemented · verified | e2e: the preview spends nothing; Back cancels; an unreachable tap spends nothing; Confirm goes through `moveUnit` (−1 AP). Fire also previews hit%, then Confirm rolls. Esc cancels. |
| No turn expenditure from a learning interaction | implemented · verified | e2e "the hint did not move E1 or spend AP"; engine tests. |
| Active unit, AP, objective shown without covering the board | implemented | The status card sits above the board and is not sticky, so it never overlays tiles (fixed after a screenshot showed a sticky bar covering the top rows when scrolled). No automated overlay check yet; screenshot-reviewed only. |
| Phone touch targets | implemented · verified | e2e: every control ≥ 44px at 390 and 1280 |
| Pinch / zoom / pan | implemented · partly verified | + / − zoom (1×–2.5×) and drag-to-pan when zoomed are e2e-verified, including that a pan is never treated as a tap. Two-finger pinch is implemented with pointer events but **not** automated (Playwright has no multi-touch pinch); it needs a device check. |
| Readable contrast | implemented | Dark tactical palette with cyan/amber accents and a light-scheme fallback. No automated contrast audit of this page yet (axe is not run on it). |
| Reduced motion | implemented · verified | e2e with `reducedMotion:'reduce'`: no transitions or animations |

## Make the math visible

| Requirement | Status | Evidence / note |
|---|---|---|
| x/y axes and tile coordinates | implemented · verified | Axes 0–9 on top (x, columns) and left (y, rows). Each tile's accessible name starts "x N, y M". The e2e checks that E1's cell matches the engine's (1,2). The orientation is the engine's: `sourceSide` treats +y as south, i.e. down. |
| Origin and target from the current challenge highlighted | implemented · verified | The engine returns `geometry {origin, target, dx, dy}`, and the board rings the origin cyan and the target amber. e2e: origin (3,3) → target (4,1). |
| Trace horizontal then vertical steps | implemented · verified | "Trace", or each wrong answer, reveals the x run (numbered x1…) and then the y run (y1…). e2e: one x step, then two y steps. |
| Challenge tied to the highlighted path | implemented · verified | "Optional: how far is that?" on a move preview opens a target-bound challenge. The target is in the binding, so swapping it makes the session stale (engine test). |
| Board and short challenge visible together | implemented | The intro and legend are collapsed into "How this works". The challenge card sits under the board. Opening a hint leaves move mode, so lit tiles don't compete with the math (e2e). |
| Wrong answers scaffold; normal play unrestricted | implemented · verified | A wrong answer gets a progressive step plus the board trace. After all steps the worked answer can be revealed, and a revealed answer never counts as mastery. Play stays open throughout. |
| Equivalent answers | verified | e2e accepts "3.0" for 3; engine tests accept "9/5" = "1.8" = "1.80" |

## Progress, grading, stale turns, hidden information, isolation

| Requirement | Status | Evidence / note |
|---|---|---|
| Saved progress | implemented · verified | `localStorage` in this browser, keyed by tenant:player:mission. e2e: survives a reload (position and round); Start over clears it. **Not** server persistence: that needs a route and table (designed only). |
| Grading | implemented · verified | Exact-rational checking in `tactical-hints.mjs` (no AI). The verified private LMS generator `88ec88a2…` is **not reachable** from this session ("not our ref"), so it is not reused. |
| Stale-turn checks | verified | e2e: after End turn the old hint returns `STALE_BOARD`. Engine tests cover a moved unit, a new round and a changed target. |
| Hidden-information safety | verified | The unseen hostile H2 is never drawn or announced (e2e). Engine test: adding a hidden hostile changes neither the hint nor the binding. |
| Account isolation | verified | e2e: another player gets `NOT_YOUR_HINT`; the save key is scoped. **Limit:** the preview holds the challenge secret in the page. A production route must keep it server-side (designed, not built). |

## Visual direction

- **Implemented:**
  - Near-future tactical look: dark board with depth (gradients, inset lines, shadows) and controlled cyan (reach and origin) and amber (path, destination, target, objective, hint) accents.
  - Architectural cover drawn as bars on the protected side(s), thick for high cover and thin for low; raised wall blocks; a glowing objective diamond.
  - Role-tinted E/R/T tokens with AP pips; hostiles in red.
  - The square grid stays readable. The board and action contracts are unchanged.
- **Designed, not built:** a richer illustrated scene under the grid (for example a courtyard backdrop or 3D renderer), and character art. Logos and marks are untouched.
- **Screenshots** (Playwright, 390 px, dark scheme), in `evidence/prim3-mobile/`: `390-unit-menu.jpg`, `390-move-preview.jpg`, `390-challenge-trace.jpg`. Full-page e2e captures are also written to the e2e output folder.

## Game-only arcs / boosts

**Not implemented, by design for this pass.** No arcing ability and no answer-unlocked modifier was added. The engine has no such rule, and adding one is a rules change for the owner to approve. If approved, the design constraints are:
- explicit fictional grid rules (for example "lob: target ≤ N tiles by Manhattan distance, ignores LOW cover only, never HIGH, never walls");
- a visible preview of the affected tiles and the resulting hit chance from the same `shotPreview`;
- a disclosed modifier with tests;
- no secret bypass of range or cover, and no promise of a perfect hit;
- no real mortar or weapon aiming calculations.

The no-auto-action and no-hidden-enemy hint boundary is unchanged.

## Not done / needs the owner

- Server route plus persistence for challenges and saves: designed only (`../../20261102-claude/HANDOFF.md`).
- A device check of two-finger pinch on a real phone.
- An axe and contrast audit of this page.
- The richer scene and art.
- An arcs/boosts rule decision.
- Access to the private math LMS ref `88ec88a29edd90f21da7eeb6155c6b9c8fd678d5` (not on the remote) to replace the self-built challenge bank.
- **Hostile AI:** this preview's End turn advances phases without one, because the engine has no threat AI yet.

## 3D pass (owner, 2026-11-02: "more like this … we gotta make it 3D", with a concept mockup)

The concept image is a mockup, not proof of working code. What exists now:

| Item | Status | Evidence / note |
|---|---|---|
| 3D courtyard renderer | implemented · verified | `js/prim3-tactics/board3d.mjs` uses three.js **0.180.0**, the version the repo's 3D building pages already load from jsDelivr. It is loaded on demand. It draws the engine's own board: tile (x, y) → world (X = x, Z = y), Y up. **Scene contents:** lit stone tiles with a readable grid, brick wall pillars for walls, cover slabs (with planters on low cover) on the protected side, the relay cabinet with a glowing marker, and operatives with role-coloured bands. Warm low sun, sky fill, soft shadows. e2e checks that the WebGL canvas renders: the centre pixel is non-empty under SwiftShader. |
| Same rules | verified | The 3D view is a renderer only. Taps go through a raycast to a tile, then the same `onBoardTap`, which uses the resolver's `moveUnit`/`fireWeapon` and the shared `knownPaths`. e2e: a tap through the canvas on E1's body opens its menu; a tap on a lit tile previews without spending; an unreachable tap spends nothing; Confirm moves through the resolver. |
| Mockup layout | implemented | **Layout:** turn bar ("Turn 01 / Your move", using the supplied `prim3-logo.png`, scaled whole) above an objective strip ("Secure the relay · (7, 6)"). Under the board sit the preview strip ("(x, y) → (x, y) · steps · AP · cover · AP left") and the challenge card with "Continue playing". At the bottom, the unit dock shows the role token, "E · Entry", the AP pill and a red End turn button. **Menu and tags:** the operative's menu floats beside it with Move, Fire, Inspect and Get hint, and More for Dash, Reload, Overwatch and Hunker; Origin, Target, Relay and hostile tags are drawn in the scene. **Fixed dark theme:** the page uses one dark tactical palette whatever the system theme. Character portraits from the mockup are **not** added: no supplied portrait art exists, and none was generated. |
| Visible math in 3D | implemented · verified | Axis labels 0–9 sit along the scene edges; the Origin and Target rings and labels and the x1/x2…, y1… step tiles are drawn on the floor (e2e checks the labels). |
| Zoom / pan / pinch | implemented · partly verified | The camera zooms by dolly (+/−, wheel, two-finger pinch) and pans by drag; a pan never fires a tap. e2e checks + moves the camera closer; pinch needs a device check. |
| 2D grid | implemented · verified | The "2D grid" toggle (also `?view=2d`) shows the same board as labelled buttons. It is the accessible view and the fallback. e2e: with three.js blocked, the page falls back to 2D, says why, and still plays. |
| Hidden information in 3D | verified | The unseen hostile is neither drawn nor labelled (e2e). |

Tests: `scripts/e2e/prim3-tactics-hints.e2e.mjs` **96/96**. That is 65 checks on the 2D grid, 14 in 3D at 390 and 1280 (WebGL via SwiftShader), and 3 for the fallback. The 3D checks need three@0.180.0 installed locally (`THREE_DIR`); without it they print SKIP and are not counted.

Still designed only:
- authored character models (GLB) and animation;
- a hand-built courtyard environment (architecture beyond blocks, props, decals);
- post-processing (bloom on the relay);
- camera rotation;
- a fog-of-war shroud rendered over unknown tiles;
- a real-device performance budget for low-end phones (not measured).
