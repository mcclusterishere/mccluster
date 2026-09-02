# MCCLUSTER CONTROL PLANE — READ THIS FIRST

This file is the law for every McCluster repository, every Cloudflare project, and every agent (ChatGPT, Claude, Codex, Cursor, Gemini, Copilot, Grok).

If you skip it, you will invent a second backend, race a git push, or break a client product. That is exactly how the last agents failed.

## The plane

| Piece | Canonical |
| --- | --- |
| GitHub control repo | `mcclusterishere/mccluster` |
| GitHub org | `McCluster-Corp` |
| Cloudflare project + Worker | `mccluster` |
| Worker source | `workers/mccluster` |
| Public site | `https://matthew.mccluster.org` |
| Apex | `https://mccluster.org` → same property, not a second site |
| API | `https://api.mccluster.org` |
| Supabase | project `zmnhbrjyhxzhkxmhkexs` (`https://zmnhbrjyhxzhkxmhkexs.supabase.co`) |

**There is no Worker named `mccluster-core`. Do not create one.**
The only Cloudflare Worker is `mccluster`. Only call routes that Worker actually serves.

**McCluster is the backend AND the control plane.** Product repos are satellites. Client sites are tenants. None of them own auth, billing, social, CRM, or admin.

## Hard rules

1. **Do not create a competing backend.** No new auth stack, no new Postgres, no new admin, no new social scheduler, no new Stripe account, in a satellite repo.
2. **Do not auto-push CI onto feature branches.** LiDAR and other heavy jobs use `workflow_dispatch` and artifacts. They never `git push` onto an open PR branch.
3. **Do not overwrite `index.html` or a client's shipping UI** unless the owner named that file in the task.
4. **Cloudflare Worker `mccluster` is not a Node compile of the whole git tree.** Source lives at `workers/mccluster`. The public site is static and ships to `matthew.mccluster.org` from this repo, not from `Here`. Do not create `mccluster-core`.
5. **Supabase `zmnhbrjyhxzhkxmhkexs` is the shared data plane.** New tables belong there (or on the Control desk). Public anon key is public by design; RLS is the wall.
6. **Client social is a McCluster service.** Every client backend gets accounts, campaigns, and a queue on the plane. Satellites may display and submit. They are not the source of truth.
7. **Preserve local product law.** PRIM3 Site 0, Uprise World, and any repo-specific gates below this section still apply. Control-plane law does not delete them.
8. **If a task wants you to "rebuild", "simplify", or "migrate to a new stack": stop.** Route the work through McCluster. Ask only if the owner is explicitly retiring a satellite.
9. **Do not invent infrastructure names.** The Worker is `mccluster`. The API host is `api.mccluster.org`. If a name is not in this table, it does not exist.

## Files every agent must honor

On the control repo:

- `AGENTS.md` (this law + local product gates)
- `CLAUDE.md` / `GEMINI.md` / `.cursorrules` / `.github/copilot-instructions.md`
- `docs/control-plane/ECOSYSTEM.md`
- `docs/control-plane/registry.json`

On every satellite: the same four agent files, pointing here.

## Owner

Matthew McCluster / McCluster Corp (Connecticut public charity CHR.0069693). Operator desk is the McCluster Control admin.

---

# HERE — Codex Repository Instructions

## HITMAN PRIM3 Site 0 / Ground Zero fortress

Any task that touches Site 0, PRIM3 fortress geometry, Site 0 gameplay, level plans, collision, streaming, or the Ground Zero environment must first read:

- `assets/3d/prim3-site0/AGENTS.md`
- `assets/3d/prim3-site0/PRIM3_Site0_CANONICAL_ARCHITECTURE_v03.json`
- `assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v03_manifest.json`

The canonical production geometry is `assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v03.glb`. Do not revive the rejected v02 massing or the superseded B3-bypass-only rule. B3 Prime heavy deployment, centered V1/V2, R1/R2, the L1 through-road, the external P1 B3↔L3 lift, and the independent SOUTH B3-to-grade escape route are mandatory unless the architecture contract is deliberately revised in the same change.

### P1 / L3 interface — non-negotiable

P1 is an aircraft-carrier-style external heavy lift. At L3, its platform rises **flush with the SOUTH edge of the flight deck** and becomes a drive/tow surface into the deck apron/merge lane.

**Never recreate an elevated bridge, departure spur, viaduct, or support-pier structure projecting SOUTH from L3.** The old `L3_PRIME_ELEVATED_DEPARTURE_SPUR` and `L3_PRIME_SPUR_SUPPORT_*` geometry is rejected and forbidden.

The separate B3 SOUTH surface escape ramp reaches grade beyond the primary perimeter and does **not** reconnect to the roof.

## HERE portfolio visual direction — flat house system, no material skins

The industrial material program (Material System 2.0: marble ground, blackened-steel/chrome/obsidian/ruby-glass skins, the signature mark, `css/here-material.css`, `css/signature.css`, `js/here-material.js`, `js/signature.js`, `assets/brand/`) was **removed by the owner's call on 2026-08-15** after three visibly broken rollouts. Do not resurrect it, and do not re-skin the interface from `docs/design/INDUSTRIAL-MATERIAL-INTERFACE.md` or `docs/design/HERE-PREMIUM-RESKIN-IMPLEMENTATION.md` — those docs are kept as history only, not as direction.

The shipping aesthetic is the flat house system in `css/style.css` (cinema/gallery coats driven by `js/theme.js`). Visual work happens inside that system: tune tokens and components in place, keep the DOM-first architecture, and treat 3D as progressive enhancement, not a reason for an architectural rewrite.

This direction applies to the HERE portfolio/product shell and related business interfaces. It does **not** override Uprise World. Uprise World remains governed by the separate rules and roadmap below.

## Uprise World

Before modifying any Uprise World code, read all of the following completely:

- `docs/uprise-world/CODEX-IMPLEMENTATION-BIBLE.md`
- `docs/uprise-world/REFERENCE-MANIFEST.md`
- `docs/uprise-world/PROOF-ROOM-SPEC.md`
- `docs/uprise-world/SCREENSHOT-ACCEPTANCE-CRITERIA.md`
- `docs/uprise-world/PERFORMANCE-BUDGET.md`
- `docs/uprise-world/UPRISE-WORLD-ROADMAP.md`
- `docs/uprise-world/PHASE-0-AUDIT-INSTRUCTIONS.md`

### Current direction — decided 2026-08-10

**The shipping look is cel-shaded toon, and Living Sketch is deferred to a later skin.** The owner made this call explicitly.

What that means in practice:

- `MeshToonMaterial` + gradient ramps + `OutlineEffect` is the **current, sanctioned** renderer. It is not a stopgap and not a violation — do not "fix" it back toward Living Sketch.
- Gameplay, world, and rendering stay **separable**. New visual work goes through the material/outline layer rather than being welded into geometry or the update loop, so a Living Sketch pass can be swapped in later without touching locomotion, landmarks, keepers, or errands.
- Living Sketch remains the documented long-term target and its references stay canonical. Nothing in `docs/uprise-world/` is withdrawn. It is **parked**, not cancelled.
- The Phase 0/Phase 1 gating below still governs Living Sketch work. It does **not** block ordinary gameplay and polish work on the current toon build.

The reference for the current look is a cel-shaded low-poly spherical-world game; the technique (toon ramp + inverted-hull outlines, geometry generated from primitives, no imported meshes) is standard and was arrived at independently here. Build original work with it — never copy another site's assets, models, code, or copy.

### Living Sketch — the deferred target

**Living Sketch** is a hand-drawn mixed-media sketchbook world built from irregular ink contours, graphite construction marks, watercolor/marker washes, charcoal-gray grounding, red editorial scribbles, visible paper negative space, selective saturation, selective detail, and controlled human imperfection.

### The Living Sketch style board is ART STYLE ONLY — it is NOT A CHARACTER REFERENCE

`docs/uprise-world/references/style/living-sketch-style-reference-board.jpg` contains drawings of a person. **That person is not Matthew McCluster, is not the protagonist, and is not any character in Uprise World.** Use it for line quality only. Never use it for face, likeness, hair, clothing, or identity.

Character appearance comes only from the character likeness sheet, the raw `assets/likeness/` photographs, the wardrobe board, the exact emblem files, and the character panels of the composite and Proof Room boards. Read `docs/uprise-world/references/style/README.md` before using anything in `style/`.

### Non-negotiable rules

- Never implement **Living Sketch** as conventional 3D with a sketch/post-processing filter layered over the camera.
- Canonical user-supplied visual references outrank generated interpretations.
- Preserve working spherical locomotion, WebGL fallback behavior, landmark/check-in logic, mobile/touch controls, and data-driven world content unless a documented audit shows a concrete reason to change them.
- Do not expand the world map before the **Visual Proof Room** passes its acceptance criteria.
- Follow `UPRISE-WORLD-ROADMAP.md` in order.

### Phase 0 audit gate

**Phase 0 must be completed before any Proof Room implementation or other Uprise World application-code change.** Follow `docs/uprise-world/PHASE-0-AUDIT-INSTRUCTIONS.md`. No Phase 1 implementation may begin before explicit user approval.

## The Universe schema — one world, many universes

Any task that touches game worlds, level selectors, portals, or per-world saved state must first read:

- `docs/universe/UNIVERSE-SCHEMA.md`
- `docs/universe/universe-registry.json`

This schema does not relax any existing gate: Uprise World work still follows `docs/uprise-world/` phases, and Site 0 work still follows `assets/3d/prim3-site0/AGENTS.md`.
