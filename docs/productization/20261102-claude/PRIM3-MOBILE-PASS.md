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
