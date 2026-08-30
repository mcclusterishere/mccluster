# PRIM3 SITE 0 — GAME DESIGN (the Hitman universe)

**Version:** v1 · **Status:** proposed, owner review pending · **Date:** 2026-08-15
**Parent schema:** `docs/universe/UNIVERSE-SCHEMA.md` · **Canonical geometry:** `assets/3d/prim3-site0/AGENTS.md`
**Owner directives encoded here:** layered progression to PRIME Commander · both attacker and defender scenarios ·
mobile-first · Tacticool-grade interface grammar · mega-facility scale · front-gate check-in · Prayer Closet becomes
the Armory · generated transition clips instead of scrolling.

---

## 1. The one-line game

**Site 0 is a mega-facility that is itself the hardest level in the game** — it spawns people,
it spawns tanks, its own defenses shoot at you — and you play **both sides**: you attack it,
and you defend it, and both are meant to be hard to beat.

Mobile-first. First-person shooter at the core. Interface grammar: Tacticool — twin-zone touch
controls, fully adjustable layout/sensitivity, haptics, physics-driven destruction, vehicles you
can drive and fight from, short intense rounds — but played **first-person**, in worlds far
larger than Tacticool's arena maps.

Traversal between areas is never a scroll and never a loading blur: **every move is a generated
transition clip** that carries you from the spot you're in to the spot you chose (see §7).

---

## 2. The layered facility — the game's progression ladder

The canonical nine-level stack *is* the difficulty ladder. You descend as you master each layer.
You experience every zone peacefully before you ever attack or defend it.

| Layer | Canonical levels | Role | Play |
|---|---|---|---|
| **0 — FRONT GATE** | Exterior / north portal | Peaceful entrance | Check-in experience. You walk up, you get cleared, you learn the world's face. No weapons. The picture-map selector lives here. |
| **1 — LEARNING** | **L4 + L3** (one loop, two environments) | Air operations apprentice | The command tower and the flight deck are interactively one level — two environments of the same loop. Learn air-traffic control: launch, recover, sequence the lanes. Flight-simulation flavor at the tower. |
| **2 — GROUND WAR** | **L2 + L1** | Production & deployment | Drones, planes, mechanized infantry and tanks are built/repaired on L2; you take them up and deploy them through L1 onto the field. RTS-flavored deployment under time pressure. |
| **3 — PRIME** | **B3** (PRIME Command & Sustainment) | **You become PRIME — the Commander** | Full-spectrum command: air traffic *and* ground war *and* facility defenses at once. Defense waves start light and escalate without a ceiling. This is the deepest level of the game. |

Gating rule: **you cannot pass the learning layer into PRIME until you have actually learned it.**
The flight-deck qualification is a real skill check, not a cutscene.

### Why this fits the canonical architecture

This ladder is not painted onto the building — it *is* the building:
`L4` island superstructure / flight control · `L3` flight/landing-launch deck · `L2` business +
aviation support · `L1` through-road ground deck · `B3` PRIME Command + Heavy Deployment.
Game tiers map 1:1 onto `PRIM3_Site0_CANONICAL_ARCHITECTURE_v03.json`. No level functions change;
only the *order the player earns them* is new.

---

## 3. Both-sides doctrine — attacker and defender

- **Defend (PRIME path):** waves escalate from light probes to combined arms. The facility's
  own systems are yours: gates, turrets, the V1/V2 lifts, the R1/R2 ramps, deployed units.
- **Attack (raider path):** the same facility is the boss. It spawns defenders and armor,
  its automated defenses engage you, and its geometry — built to be defensible — is the puzzle.
- **Both must be hard to beat.** If the facility falls easily to attack, defense means nothing;
  if defense is effortless, PRIME is a participation trophy.
- Asymmetric win states: the attacker never needs to "destroy" the building — they need to
  *take the thing it protects* (B3) and hold it for one wave cycle.

### Comparable games, honestly assessed

| Game | What we take | What we reject |
|---|---|---|
| **Tacticool** (mobile, top-down 5v5) | Mobile control grammar: twin zones, adjustable buttons/sensitivity, haptics; physics destruction; drivable vehicles; ~1-minute intensity | Top-down camera (ours is first-person); small arena maps (ours is a mega-facility) |
| **EVE Online** (base warfare) | The stakes: a structure worth attacking *and* worth dying to defend | Desktop-first UX, spreadsheet pace — not mobile |
| **Outpost: Infinity Siege / Meet Your Maker** | Proof that FPS + build/raid loops work | Desktop-first; session length; build complexity |
| **Messenger** (Abeto) | Traversal joy, discovery without tutorials, soundscape-per-area | — |

---

## 4. Mobile-first law

Every interface decision is made for a phone first, then scaled up:

- Twin-zone touch: left zone move, right zone aim/fire — positions and sensitivity fully
  adjustable, per Tacticool's adjustable-controls precedent.
- Haptics on weapons, explosions, deployment confirmations.
- Rounds/waves sized for minutes, not hours. PRIME command playable one-handed-ish in short sessions.
- Tablet and desktop inherit, never lead. (Uprise's `PERFORMANCE-BUDGET.md` philosophy applies:
  sustained <30 FPS on a tablet is a blocking failure.)

---

## 5. The mega-facility scale doctrine

Problem stated by the owner: *the facility is very small right now; it needs to be a mega-facility
so the facility itself can be its own whole level.*

- The canonical contract already specifies a **1,268 m × 824 m** conceptual footprint across nine
  levels — the scale problem is not the number, it is **playable interior density**: rooms,
  corridors, cover, sightlines, spawn logic, and second-to-second traversal time.
- Scale work therefore means: interior fit-out density per zone, traversal-time budgets
  (e.g., L1 end-to-end on foot vs vehicle), vertical route timings (V1/V2, R1/R2, cores A–D),
  and spawn/defense coverage maps — before any massing number changes.
- Any change to canonical massing/dimensions must follow the Site 0 AGENTS.md rule: contract,
  manifest, specs, and plans updated in the same commit. A "mega-facility scale pass" is a
  governed change, not a casual edit.
- The World Labs Marble generations (per-zone splat vistas) respect the same scale anchors so
  generated interiors and canonical geometry never disagree about the size of a door.

---

## 6. The Front Gate and the Armory (Prayer Closet)

- **The Front Gate is the first screen of the Hitman universe**: a check-in, not a menu.
  You are cleared through the gate, and only then does the game teleport you directly inside
  the building (first transition-clip moment).
- **The Prayer Closet interface becomes the Armory inside the building.** The existing Closet
  grammar (drops, garments with meaning, seasonal cuts) maps onto loadouts, gear, and kit.
  The armory is *buried inside the facility* — you cannot reach it from outside the gate.
- Design consequence: Closet/Armory UI work happens inside the Site 0 universe and follows this
  document plus the Site 0 AGENTS.md branding law (HM marks only, no third-party game marks).

---

## 7. Transitions — "the scroll is not scrolling"

Same principle as the main page's veil, one layer deeper: **navigation is a sequence of
generated clips**, each one carrying the user from the current spot to the next area.

- Contract first (per Universe Schema §8): picture-map selector → tap → transition plays → arrive.
  This contract ships before any generated clip exists.
- **Clip production decision (owner asked, 2026-08-15):** two-track approach —
  - **Batch/route clips → direct Seedance-family API** (fal.ai Fast tier ≈ $0.022/sec,
    ~$0.22 per 10 s clip, true REST, no subscription). Rationale: dozens of A→B routes need
    programmatic, per-clip-cheap generation. (Seedance 2.0 third-party API is still rolling
    out as of mid-2026; Seedance 1.5 Pro via BytePlus is the official enterprise route.)
  - **Hero shots → Higgsfield** (Seedance 2.0 partner tier, 70+ camera presets, multi-reference
    consistency, MCP/CLI but no public REST). Used manually for marquee transitions.
  - **Prototypes → the built-in video-generation pipeline in the Kimi workspace**, today,
    no external account needed.
- Audio rides inside the clip (Seedance/Veo generate native audio), so a transition can carry
  its own soundscape — consistent with the Messenger posture.

---

## 8. Entrances, state, and portals (schema hooks)

`prim3-site0` registry additions implied by this design:

- **Entrances:** `site0.entrance.north-portal` (The Crossing arrival) ·
  `site0.entrance.front-gate` (default start) · `site0.entrance.selector` (picture-map arrival).
- **State slot** saves per layer: gate clearance, L4/L3 air-traffic qualification, L2/L1
  deployment record, PRIME wave record, armory loadout.
- **Exit portal** (`the-way-back`) registered in the registry; arrival target `uprise.deep-end`.

---

## 9. Open questions for the owner

1. Round structure: Tacticool-style ~1-minute bursts, or longer siege sessions with a pause/save?
2. Attacker path: human raider (infiltration, Hitman-style) or raider-with-armor (assault)?
   Both? Which ships first?
3. Multiplayer: async (defend others' facilities, raid ghosts) or live co-op defense first?
4. Mega-facility scale pass: approve a governed revision to the canonical contract with
   traversal-time budgets, or hold massing and densify interiors first?
5. Armory/Prayer Closet: does real merch stay linked inside the in-world armory, or does the
   armory carry game items only with a door back to the Closet universe?
