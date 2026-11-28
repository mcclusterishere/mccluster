# PRIM3 desktop

The PC build of the PRIM3 tactical game, made with **Godot 4.4** (GDScript, GL Compatibility
renderer so it runs on ordinary laptop GPUs). It exports to a single Windows `.exe` and a Linux
binary. The web game (`prim3*.html`, `js/prim3-tactics/`) is unchanged and stays the version that
runs in a browser and on phones.

## Play

Windows: run `PRIM3.exe`. It is not code-signed, so the first launch shows Windows SmartScreen:
choose **More info → Run anyway**. Progress (missions finished, best rounds) is saved on the
machine in `%APPDATA%\Godot\app_userdata\PRIM3\prim3-desktop-save.json`.

Three missions, unlocked in order, each set on a Site 0 level:

| # | Mission | Level | Objective |
| - | --- | --- | --- |
| 1 | Through-Road | L1 | Breach and verify the V1 lift control, extract north |
| 2 | Drone Pad | L2 | Open the blast gate from the pad console, extract east |
| 3 | Heavy Hall | B3 | Verify both transfer controls, the south portal gate opens, extract |

Squad: **E** Entry, **R** Recon, **T** Technical (only the Technical runs objectives). Lose the
Technical before the objective is verified, lose everyone, or run out the clock, and the mission
fails. Every mission starts with the squad concealed.

Controls: left-click an operative to select it, a blue tile to move (1 AP), a small yellow tile to
dash (2 AP), a visible hostile to fire. Hovering a tile shows the route and its cover; hovering a
hostile shows the hit chance. Tab next operative · O overwatch · H hunker · R reload · F objective ·
X extract · Space / Enter end turn · WASD / arrows pan · Q / E rotate · wheel zoom · Esc menu ·
F11 fullscreen. **Auto turn** lets the autopilot play the squad's turn.

**Site 0 facility** on the title screen shows the canonical master
(`assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v04.glb`) as it is, with each level toggleable.
The mission boards are game layouts set on those levels by name; they are not Site 0 geometry, and
geometry authority stays with `assets/3d/prim3-site0/AGENTS.md`.

## Rules

`scripts/rules.gd` is a GDScript port of the rule subset these missions use, from the vendored PRIM3
resolver (`js/prim3-tactics/tactical-resolver.mjs`, source `mcclusterishere/Prim3`). Same numbers:
2 AP; MOVE 1 AP and DASH 2 AP at twice the range; cover HIGH −40 / LOW −20; flanked +15 aim and
+20 crit; −4 aim per tile past 6; hunkered −20; overwatch reaction −15; hit 5–95 %, crit 0–75 %;
the mission clock's DEGRADED / CRITICAL / TERMINAL escalation; and the same deterministic dice.
`tests/resolver-vectors.json` holds dice and shot numbers generated from the web resolver, and both
the Godot tests and `scripts/test/prim3-desktop.test.mjs` check them, so the two cannot drift
silently.

Where the desktop build differs, the code says `DESKTOP`:

- Cover is derived from the blockers beside a tile (walls and high objects give HIGH, low objects
  LOW) instead of being authored tile by tile.
- Fog of war: the squad sees hostiles in its line of sight within 14 tiles.
- Overwatch ends the operative's activation.
- A downed operative cannot be shot again; a stabilised one gets up with 1 HP.
- Extraction is refused until the objective is verified.
- Threat AI (`scripts/ai.gd`, the policy of `tactical-threat-ai.mjs`): awareness is per hostile, so
  guards wake in groups (seeing an unconcealed operative, being shot at, or an awake guard within 6
  tiles seeing the squad), and an awake guard that loses contact hunts towards the last sighting.
- Machines (cameras, turrets, doors) and weapon switching from the web resolver are not in these
  missions yet.

## McCluster game studio

The project answers Core's Godot launch contract (`core/src/game-studio/godot-runtime.mjs`):

```
godot --headless --path PRIM3/desktop -- --mccluster-scenario=<id> --mccluster-seed=<n> --mccluster-max-steps=<n> [--mccluster-mission=<mission id>]
```

It plays the mission with the autopilot on the real rules and prints `MCCLUSTER_EVENT {json}`
observation, action and terminal lines in the shapes the tactical sandbox fixture
(`core/fixtures/prim3-tactical-sandbox`) emits, so Core's `game_playtest` executor can be pointed at
this project with `project_path`. The fixture itself is unchanged.

## Build

Godot 4.4.1 and its export templates (Windows and Linux) are needed.

```
GODOT=/path/to/godot ./build.sh          # copy in the Site 0 master, test, playtest, export to build/
GODOT=/path/to/godot ./build.sh --sync   # only copy the Site 0 master in, for opening in the editor
```

`build.sh` copies the master from `assets/3d/prim3-site0/` after checking its SHA-256 against the v04
manifest, so the file is never duplicated in git (`assets/site0/` and `build/` are ignored).

Tests: `godot --headless --path PRIM3/desktop -s res://tests/run_tests.gd`, and from the repository
root `MCCLUSTER_GODOT_BIN=/path/to/godot node --test scripts/test/prim3-desktop.test.mjs` (without the
variable the Godot step is skipped and the rest still runs).

To capture a screen without a person: `godot --path PRIM3/desktop -- --prim3-capture=out.png
--prim3-screen=menu|brief|board|facility [--prim3-mission=<index>]`.
