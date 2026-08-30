# HERE UNIVERSE SCHEMA — one world, many universes

**Version:** v1 · **Status:** proposed, owner review pending · **Date:** 2026-08-15
**Governs:** every game world, level selector, portal/teleport, and per-universe state in this repo.
**Does not authorize:** any application-code change. Uprise World remains under its gated roadmap
(`docs/uprise-world/UPRISE-WORLD-ROADMAP.md`); Site 0 remains under `assets/3d/prim3-site0/AGENTS.md`.

---

## 0. TL;DR for agents entering this repo

HERE is **one underlying world with many universes**. The bottom tab bar
(`js/tabbar.js`) is the universe switcher: **each tab is its own universe**, with its own
entrance, its own engine, and its own play style. Universes are **separate but connected**:
you teleport between them through registered **portals**, and every universe keeps its own
saved state, so you **continue exactly where you left off** in each one.

Two play styles exist:

- **`visual`** — a decision tree. You click/tap things; each choice plays a **generated
  transition clip** that carries you from A to B (Google-Earth feel, real animation instead
  of a blur). Tapping a *picture* of a place takes you into that place.
- **`fps`** — a first-person shooter. Independent engine, pointer lock, WASD, its own rules.
  You relearn the whole game when you cross over. That relearning is the point.

The flagship portal is **The Crossing**: finish the Uprise World path (all four check-ins),
"go to the dark" / the Deep End, and you teleport into the **HITMAN PRIM3 Site 0** universe —
a different world on the other side, running a different engine.

If you only read one more file, read `docs/universe/universe-registry.json` — it is the
machine-readable form of everything above.

---

## 1. The vision, distilled

The owner's directive (2026-08-15):

1. The game plays like **Messenger** (messenger.abeto.co) at the traversal level.
2. The **Hitman section is a first-person shooter** — a different play style and engine entirely.
3. Everything we have already designed (Uprise World, the PRIM3 Site 0 facility, the selector,
   the asset lab) is **one underlying world with separate entrances**.
4. Each bottom tab gets **its own universe under one schema** — separate, but connected.
5. Teleporting into the Hitman universe must restore that universe's state — it is its own game.
6. The **level selector becomes a picture map**: tap a picture, a generated animation flies you
   into that section of the building. (Clips will be generated with Higgsfield — **not yet**.)
7. The repo itself must teach this to every agent that enters it.

---

## 2. Reference posture — Messenger (Abeto, 2025)

Messenger is a free browser game: a mail carrier on a tiny spherical planet, five deliveries,
lightweight multiplayer with emoji communication, per-area soundscapes, hidden easter eggs,
no invisible walls (walk straight and you circle the world). Built with Three.js +
three-mesh-bvh, Houdini/Blender models, ~5.7 MB initial load.

**What we take (principles, never assets or code):**

- **Small and dense beats big and empty.** Visual quality comes from art direction, not polygon count.
- **Technology is the engine, never the decoration.** Every object serves play.
- **Discovery without tutorials.** Low stakes; the player learns by trying.
- **Each area owns a soundscape** — you can find things with your ears.
- **One continuous world** — no invisible walls where a path should exist.

Per `AGENTS.md`: we build original work. We never copy Messenger's assets, models, code, copy,
or text. It is a posture reference, like the Living Sketch board is a technique reference.

---

## 3. Definitions

| Term | Meaning |
|---|---|
| **Shell** | The HERE platform layer every universe lives inside: tab bar (`js/tabbar.js`), page-transition veil (`.pt-veil`), accounts (`MCC_AUTH`), tracking (`MCC_TRACK`), and the universe registry. The shell never contains gameplay code. |
| **Universe** | A self-contained world with its own route, engine, art direction, controls, state slot, and agent contract. One tab = one universe. |
| **Entrance** | The scene/route a universe drops you into. Each universe has at least one; portals target specific entrances. |
| **Portal** | A typed, registered connection `universe A → universe B`, with a trigger, a transition, and a spawn mapping. Portals are **data** (registry entries), never cross-imported code. |
| **Play style** | `visual` or `fps` (see §4). A universe declares exactly one primary style. |
| **Selector** | The level/destination picker inside a universe. Target form: a **picture map** — tap a picture, watch the flight, arrive (see §8). |

---

## 4. The two play styles

### 4.1 `visual` — the decision tree

- The world is a **network of scenes**. Moving = choosing.
- Every choice (a zone, a door, a face of the building, a tab wing room) triggers a
  **transition clip**: a short generated animation that carries the camera from the current
  scene into the chosen one. No hard cuts, no loading-bar blur.
- The decision layer is **Level 1 of the game**: before you can walk a place, you can choose it.
- Input grammar: tap/click only. No WASD teaching, no joystick.
- Reference feel: Google Earth's fly-to — but each transition is a real generated clip
  (planned: Higgsfield), art-directed per universe.
- Persistence: the decision tree remembers which nodes you have unlocked/visited.

### 4.2 `fps` — the Hitman universe

- First-person shooter inside **PRIM3 Site 0 / Ground Zero**: pointer lock, WASD + mouse,
  weapon/equipment systems, AI presence, stealth/social-engineering grammar.
- **Independent engine.** It shares nothing with the traversal world except the schema:
  registry entry, portal data, state slot, and the canonical Site 0 asset contract.
- The difficulty/controls reset is a feature: *you relearn the game, and that is the fun.*
- Canonical geometry: `assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v03.glb` (nine levels,
  Central Mobility Canyon, P1 flush-deck lift, B3 escape spine — see that directory's AGENTS.md;
  its rules are not repeated here and are not negotiable here).

---

## 5. The registry contract

`docs/universe/universe-registry.json` is the source of truth. Every universe MUST have an
entry before any route for it ships. Required fields:

```jsonc
{
  "id": "prim3-site0",            // stable slug, used in state keys and portals
  "title": "HITMAN PRIM3 SITE 0 — Ground Zero",
  "playStyle": "fps",              // "visual" | "fps"
  "engine": "...",                 // free text; must name the actual stack
  "entry": "site0.html",           // public route (or "planned:")
  "contract": "assets/3d/prim3-site0/AGENTS.md",  // mandatory reading for this universe
  "stateKey": "here.universe.prim3-site0.state",
  "tab": { "appnav": "hitman", "order": null },   // shell tab identity (null = not on the bar yet)
  "portals": [ /* see §6 */ ]
}
```

The shell reads the registry; universes never read each other's code.

---

## 6. Portals and The Crossing

A portal entry:

```jsonc
{
  "id": "the-crossing",
  "from": "uprise-world",
  "to": "prim3-site0",
  "trigger": "uprise.all-four-check-ins + seam crossing",  // human-readable gate
  "transition": "cinematic:uprise-intro (exists) → site0.arrival (planned)",
  "spawnAt": "site0.entrance.north-portal",
  "returnPortal": "site0.the-way-back"
}
```

**The Crossing is canonical and already half-built**: `uprise-world.html` + `js/uprise-intro.js`
play the title sequence the first time the player crosses the seam with all four check-ins.
Today it ends on the Deep End. Under this schema, the Deep End's terminus is the portal into
the Hitman universe — "go to the dark" literally changes engines.

Rules:

- Portals are **one-way pairs**; a return trip is its own registered portal with its own spawn.
- A portal always lands at a **named entrance** with the target universe's state restored (§7).
- Gate conditions live in the *departing* universe (Uprise owns the four-check-in rule).
- Nothing about a portal may require editing the target universe's engine code.

---

## 7. State — "continue right where you left off"

- Every universe owns one state slot: `here.universe.<id>.state`.
- **Now:** `localStorage`, JSON, universe-defined shape. The shell never parses it.
- **Later (Supabase phase):** table `universe_state(user_id, universe_id, state jsonb,
  updated_at)`; sync on sign-in, local cache stays authoritative offline.
- A universe must restore (a) position/scene, (b) progression flags, (c) held items,
  at minimum. What else is saved is the universe's own business.
- Entering through a portal = load target universe route → it restores its slot → spawn
  overrides position to the portal's `spawnAt` entrance, then normal play resumes.

---

## 8. The Selector — from list to picture map

The Hitman facility selector (landed from `codex/hitman-facility-selector-v1`) and the Uprise
Proof Room are early forms of the same grammar. Target form for every universe:

1. **The selector is a picture map**, not a list of buttons. Zones/levels are shown as images
   (design-bible renders, plan views, concept frames).
2. **Tap a picture → transition clip plays → you arrive inside that section.**
   Clip production is two-track (owner decision, 2026-08-15): batch A→B route clips via a
   direct Seedance-family API (cheap, programmatic); hero transitions via Higgsfield.
   Site 0's full game design lives in `docs/universe/SITE-0-GAME-DESIGN.md`.
3. Until clips exist, the transition is the shell veil (`.pt-veil`) plus the universe's own
   arrival animation. The *contract* (picture → fly → arrive) ships before the clips do.
4. Unlock state persists per §7, so the picture map fills in as the player discovers.

---

## 9. Production pipelines feeding the universes

| Pipeline | Feeds | Where it lives | Status |
|---|---|---|---|
| **World Labs Marble** (`marble-1.1-plus`) | Navigable Gaussian-splat vistas (Site 0 L3 flight deck first; later per-zone worlds) | external platform; assets land under `assets/3d/` | awaiting owner API key |
| **HERE 3D Asset Lab** (Tripo adapter) | Prop/emblem GLBs from reference images | `asset-lab.html` + `apps/api/src/three-d/` (PR #23) | draft PR, unmerged |
| **Transition clips — two-track** | A→B movement in `visual` play | batch: Seedance-family API (fal/Atlas) → `assets/transitions/`; hero: Higgsfield | decided 2026-08-15 — batch API + Higgsfield hero; prototypes via Kimi video pipeline |
| **Concept render pipeline** | Selector pictures, design bible, image prompts for Marble | Kimi-side now; outputs should be committed under `assets/` when used | active |
| **Canonical Site 0 GLB** | FPS collision/massing, plan geometry | `assets/3d/prim3-site0/` (PR #24) | draft PR, unmerged |

---

## 10. Universe inventory

| Universe | Style | Engine | Status |
|---|---|---|---|
| `uprise-world` — Uprise World | visual (+ walking traversal) | vendored Three.js toon sphere (`js/uprise-world.js`) | **live**; gated roadmap active (Phase 0 audit on `main`, Proof Room = PR #8) |
| `prim3-site0` — HITMAN PRIM3 Site 0 | fps | independent FPS (stack TBD; canonical GLB + Marble splats) | designing; game design: `docs/universe/SITE-0-GAME-DESIGN.md`; canonical assets in PR #24 |
| future tabs | one style each | one engine each | need registry entry + owner approval first |

---

## 11. Repo map — where every piece lives

```
js/tabbar.js .................. the shell's universe switcher (5 tabs, wings, veil)
js/uprise-world.js ............ Uprise production sphere (DO NOT TOUCH outside its gates)
js/uprise-intro.js ............ The Crossing cinematic (portal preamble)
uprise-world.html ............. Uprise route; onCross: theCrossing()
docs/uprise-world/ ............ Uprise governance: bible, roadmap, audit, specs
uprise-proof-room.html + js/uprise-proof-room/ ... Phase 1 isolated shell (PR #8)
assets/3d/prim3-site0/ ........ Site 0 canonical universe contract + GLB + plans (PR #24)
asset-lab.html + apps/api/src/three-d/ ... prop fabrication (PR #23)
docs/3d-asset-lab.md .......... Asset Lab doc
docs/universe/UNIVERSE-SCHEMA.md ...... this file
docs/universe/SITE-0-GAME-DESIGN.md ... Hitman-universe game design (layers, PRIME, both-sides)
docs/universe/universe-registry.json .. machine-readable registry
```

---

## 12. Hard rules for agents

1. **Universes never share engine code.** Shared things are data only: registry, portal
   entries, state keys.
2. **Read the universe's contract before touching it.** Site 0 → `assets/3d/prim3-site0/AGENTS.md`.
   Uprise → all of `docs/uprise-world/`. This schema never overrides either.
3. **This file authorizes no code.** It is the map, not the territory. Uprise work still
   follows its phased gates; Site 0 geometry still follows its canonical contract.
4. **New universe checklist:** registry entry + `contract` file + entrance route + state slot
   + owner approval. No exceptions.
5. **Portals are data.** Cross-universe imports are a schema violation.
6. **References are postures, not sources.** No copied assets, code, text, or likenesses —
   from Messenger or anywhere else.
7. **Branding law for Site 0 work:** HM bullet-halo marks only. No third-party game marks,
   mottos, or UI chrome anywhere in renders or plans (owner rule, 2026-08-14).

---

## 13. Branch consolidation map (the 33)

Mapping the existing branch sprawl onto this schema. Execution order follows
`Here-Repo-Assessment.md`; this table only adds intent.

| Branches | Universe/track | Action |
|---|---|---|
| `codex/prim3-site0-master-v02` (PR #24) | prim3-site0 | **Merge first** — schema depends on the canonical asset contract |
| `agent/3d-asset-lab` (PR #23) | pipelines | **Merge second** — prop pipeline for all universes |
| `codex/verify-file-existence-and-report-commit-sha` (PR #8) | uprise-world | Merge only through the Uprise gate (Phase 0 approved on `main`; Gate 1 review) |
| `codex/hitman-facility-selector-v1` | prim3-site0 selector | Already landed on `main` — **delete branch**; future work is the picture-map selector (§8) |
| `codex/uprise-world-independent-v2` = `-v3` | uprise-world | Identical SHAs — delete one, review the other against gates |
| `codex/uprise-world-living-sketch` | uprise-world | Parked by owner decision → rename `parked/uprise-world-living-sketch` |
| `codex/uprise-world-messenger-lab`, `claude/uprise-world`, `claude/uprise-material-spike-5q2icu`, `codex/uprise-visual-pack` | uprise-world | Review against the current toon renderer + gates; merge or convert to issues |
| `agent/site0-game-staging` | prim3-site0 | Review after PR #24 lands; fold into FPS planning or close |
| music/platform/agency branches (`claude/*`, `codex/platform-*`, `agent/*`) | shell / platform | Follow the assessment's Phase A–C plan; out of this schema's scope |

---

## 14. Open questions for the owner

1. Which tabs beyond Uprise + Hitman become universes, and in what order? (Music? Prayer Closet?)
2. FPS engine pick for Site 0: extend vendored Three.js (keeps static deploy) vs a heavier
   engine shell. Recommendation: Three.js FPS shell, `three-mesh-bvh` collision against the
   canonical GLB, Marble splats as vista layers.
3. Naming/branding of the Hitman universe on the tab bar (`data-appnav` key, icon).
4. When do Higgsfield transition clips enter production (which A→B routes first)?
5. Supabase `universe_state` sync: tie to existing `MCC_AUTH` sign-in, or stay local-first?
