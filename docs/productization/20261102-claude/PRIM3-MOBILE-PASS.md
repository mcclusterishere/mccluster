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

Tests at the time of the first 3D pass: **96/96** (superseded below). That is 65 checks on the 2D grid, 14 in 3D at 390 and 1280 (WebGL via SwiftShader), and 3 for the fallback. The 3D checks need three@0.180.0 installed locally (`THREE_DIR`); without it they print SKIP and are not counted.

Still designed only:
- authored character models (GLB) and animation;
- a hand-built courtyard environment (architecture beyond blocks, props, decals);
- post-processing (bloom on the relay);
- camera rotation;
- a fog-of-war shroud rendered over unknown tiles;
- a real-device performance budget for low-end phones (not measured).

## 3D pass v2 (owner, 2026-11-02: "not 3D enough … XCOM … that level of game", and "check the PRIM3 repository for the mannequin photos")

**What the Prim3 repo holds.** The search covered all 16 Prim3 branches and their history, this repo, Supabase storage and Drive. The mannequin pictures are:
- `MCC-SOI-01` Security Officer (the Defense phenotype);
- `MCC-CFI-01` / `CFI-02` corporate fits (Wear-01 Company Black, which is the Cohort-02 Trainee default);
- `MCC-EI-01` Executive;
- the protected Prime −1 sheet.

There are **no committed pictures for Field E/R/T**: only their written briefs.

| Item | Status | Evidence / note |
|---|---|---|
| Canon characters | implemented | The squad are faceless matte-black mannequins in Company Black (per CFI-01). The owner said starting characters can be mannequins. Known hostiles are SOI-01 security officers: vest, body camera with a red light, one holstered sidearm, a cyberdeck, short sleeves; no helmet or long gun (the SOI style sheet's exclusions). R carries the scoped long gun and T the deck. No mark is drawn on any garment ("omit a mark rather than approximate it"). |
| Articulated rigs and animation | implemented · verified | **Rig:** hips, spine, chest, neck, arms and forearms, thighs and shins. **Motion:** a breathing idle; a walk along the engine's path after Confirm; a crouch behind low cover and a brace at high cover; facing the nearest known opposing unit. e2e checks that the body animates after Confirm and that the walk ends exactly on the engine's tile. |
| Shot sequence | implemented · verified | **Sequence:** the shooter turns and shoulders the weapon; the camera eases over the shoulder; a three-round burst with muzzle flash, light, tracers, and sparks on a hit or near-misses on a miss; a fall if the resolver killed the target; then control returns. **What it does not do:** the animation never rolls anything. It plays the result `fireWeapon` already returned. e2e checks the outcome equals the resolver's event and that control comes back. |
| Lighting and post-processing | implemented · partly verified | **Lighting and scene:** a dusk courtyard with a warm low sun, cool rim light, sodium lamps and a lit relay. Procedural wet flagstone, brick and window textures; no image downloads. **Tiers:** high = image-based light + GTAO ambient occlusion + bloom + SMAA; mid (phones) = without GTAO; low (software GL, or when the addons can't load) = the plain render. `?fx=` forces a tier. **Checks:** e2e runs the high tier under SwiftShader and checks the frame renders with no page errors. Real-phone frame rate is **not measured**. |
| Courtyard | implemented | Brick facade with lit windows, cornice, doorway and awning; steps and railing; a concrete-and-glass side; a planter wall; trees; benches; crates; puddles. Board props: brick pillars with caps; jersey barriers with a hazard band (high cover); planter boxes with shrubs (low cover); a relay cabinet with a mast and beacon. All set dressing sits off the tiles. |
| Camera | implemented · verified | Lower, closer framing. The camera eases toward the selected unit. Quarter-turn rotation (new dock button); taps still raycast correctly after rotating (e2e). The floating menu follows the camera. |
| Authored models | designed + slot implemented | `assets/3d/prim3-operators/manifest.json` (empty) + `README.md`. A listed GLB (E, R, T, H) replaces the mannequin for that role. **Not generated:** this session's McCluster Core connector returned "Authentication required", so no fal spend happened. Generation goes through McCluster `model3d.generate` (Worker `mccluster` media gateway, fal) with a budget cap, from the mannequin panels, with marks omitted. |

Tests: `scripts/e2e/prim3-tactics-hints.e2e.mjs` **110/110**:
- 65 on the 2D grid;
- 19 in 3D at each of 390 and 1280 (WebGL via SwiftShader), including walk, rotate and raycast;
- 6 for fire and the high tier;
- 3 for the fallback.

`scripts/test/prim3-tactics-vendor.test.mjs` 2/2. Screenshots: `evidence/prim3-mobile/390-3d-v2-*.jpg`.

Still designed only:
- authored GLBs (needs the connector authenticated, or the owner's pipeline);
- Field E/R/T mannequin pictures;
- a fog-of-war shroud;
- hostile AI;
- a real-device performance budget.

## Main menu and realism pass (owner, 2026-11-02: "forget that shit i sent you … just use hyper realistic shit")

The owner withdrew the toy-style reference packs. A toy-style menu built from them was replaced the same day, and **nothing from those packs remains**: no file, no geometry, no style.

| Item | Status | Evidence / note |
|---|---|---|
| Photo-scanned materials | implemented | Board tiles use Concrete Pavement; the plaza uses Cobblestone Square; the facade and wall pillars use Red Brick 03; barriers, caps, sills, steps, side walls and planters use Concrete Wall 006. Each has colour, normal and roughness maps. All are Poly Haven, CC0, recorded in `assets/3d/prim3-tactics/CREDITS.md`, and downscaled to 512 px (about 0.5 MB in total). They load after first paint; the procedural textures stand in until then, or if they fail. |
| Real lighting | implemented | Poly Haven's *Courtyard Night* HDR (CC0, 1.6 MB) drives the image-based lighting and reflections and is a blurred backdrop. The sun, rim and sodium lamps stay as direct lights for shadows. |
| Facade | implemented | Real window geometry: concrete surrounds and sills, dark glass, some windows lit from inside. Foliage is smooth and organic instead of faceted. |
| Main menu | implemented · verified | **Backdrop:** the real battlefield in a slow, low cinematic orbit (`board3d` showcase mode: no input, no labels, only what the player can see). Go plays a camera dive into the board, then the game opens. **Choices:** Continue (only with a save), Deploy / New mission, Training (opens the optional hint; moves nobody), Graphics (Automatic / High / Balanced / Battery saver, kept in this browser and applied to both scenes). A Menu button in the top bar reopens it; `?menu=0` skips it. **Without WebGL or three.js:** the buttons remain over a flat backdrop. e2e at 390 and 1280, plus the fallback. |
| Characters | unchanged | Still the canon matte-black mannequins. Realistic people need authored or generated models (`assets/3d/prim3-operators/README.md`): **blocked** on the McCluster Core connector being authenticated, so no fal spend has happened. |

## PlayCanvas courtyard study handoff (owner upload `PRIM3-Claude-source.zip`, 2026-11-02)

The handoff's ordered steps, and what happened to each:

| Step | Status | Evidence / note |
|---|---|---|
| 1. Preserve and run the study | done · verified | Installed unchanged at `demos/prim3-courtyard/` with PlayCanvas 2.23.1 and its MIT licence. `rules.test.cjs` passes 4/4. **Rendered and played in a real browser:** WebGL via SwiftShader, which the handoff's environment could not do. `scripts/e2e/prim3-courtyard.e2e.mjs` passes **31/31** at 390 and 1280: the canvas renders; a tap on E selects E; a blocked preview spends nothing; Confirm spends exactly one AP and animates; End turn cannot interrupt a walk; T walks to (6, 6); Connect needs AP left; End turn restores AP; Connect then completes; no sideways scroll; no page errors. |
| 2. Scoped site route | done (review branch) | `prim3-courtyard.html` at the root is the supplied wrapper (shared shell, same-origin frame), checked at 390 with no overflow or errors. `prim3.html` and `prim3-range.html` are untouched. **Not added:** a link from the account-gated `prim3.html`. That is shipping UI the owner has not named for this change. |
| 3. Renderer adapter | decided | **Decision: keep the Three.js renderer** (`board3d.mjs`). It already implements the study's figures, walk and camera views on the canonical engine, plus realistic PBR and HDR lighting, the shot sequence and the menu. The study stays as an independent visual reference; nothing from PlayCanvas is ported, and there is one gameplay state. |
| 4. Movement legality in the resolver | done · verified | Prim3 `claude/tactical-hints-20261102` at `e43331d3`. **What `moveUnit` now enforces:** a connected route; whole-tile, same-floor destinations; no walls; range by real route length (`findPath`). A supplied `{ path }` is checked step by step. If the route meets a unit the player could not know about, the move stops short with `MOVE_INTERRUPTED`, so refusal never reveals hidden units. Events carry the walked path. **Tests:** 6 new engine tests; 47/47 runtime tests pass. **Re-vendored:** the copy here and `SOURCE.json` (resolver sha256 `29183224…cfcb`); vendor test 2/2. The preview passes the previewed route, so preview = execution. Tactics e2e 146/146. |
| 5–7. Learning restoration, authored assets and AI, publish | not started | Publication to the site needs the owner's approval through the existing gate. |

**Owner direction, the same day: battlefield size.** No level may be under ±100 on either axis. Training is at least ±100; real scenarios at least ±150. Recorded in Prim3 `game/BATTLEFIELD-SIZE-AUTHORITY.md`. Both 10 × 10 courtyards (this preview and the study) are mechanics test beds, not levels.
