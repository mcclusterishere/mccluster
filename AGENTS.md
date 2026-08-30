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

### ⛔ The Living Sketch style board is ART STYLE ONLY — it is NOT A CHARACTER REFERENCE ⛔

`docs/uprise-world/references/style/living-sketch-style-reference-board.jpg`
contains drawings of a person. **That person is not Matthew McCluster, is not the
protagonist, and is not any character in Uprise World.** The figures in STYLE REF
01–04 are anonymous stand-in bodies that exist solely to demonstrate ink,
graphite, wash, and paper technique.

- ✅ Use it for: line quality, construction marks, wash behavior, charcoal grounding, red editorial scribbles, paper negative space, unfinished hand-drawn edges.
- ❌ Never use it for: face, likeness, hair, skin tone, beard, build, age, clothing, colorway, pose-as-character-design, or identity — **for the main character or for any NPC**.

The blue jacket and black tee in those panels are **not** canonical wardrobe. The
hair in those panels is **not** the protagonist's hair. The **STYLE 01** and
**STYLE 02** panels inside `references/boards/canonical-visual-reference-board.jpg`
are the same artwork and carry the same restriction, even though
character-authoritative panels sit on the same page.

Character appearance comes only from the character likeness sheet, the raw
`assets/likeness/` photographs, the wardrobe board, the exact emblem files, and
the character panels of the composite and Proof Room boards. Read
`docs/uprise-world/references/style/README.md` before using anything in `style/`.

### Non-negotiable rules

- Never implement **Living Sketch** as conventional 3D with a sketch/post-processing filter layered over the camera. (This rule is about how Living Sketch gets built when its turn comes. It is not a prohibition on the current cel-shaded renderer, which is toon shading with inverted-hull outlines — a shading model, not a filter over the camera.)
- Canonical user-supplied visual references outrank generated interpretations.
- The Living Sketch style board is a rendering-technique reference only and must never be used as a character, likeness, or wardrobe reference for any character, player or NPC.
- Preserve working spherical locomotion, WebGL fallback behavior, landmark/check-in logic, mobile/touch controls, and data-driven world content unless a documented audit shows a concrete reason to change them.
- Do not expand the world map before the **Visual Proof Room** passes its acceptance criteria.
- Do not casually replace existing architecture, add large dependencies, or perform vanity rewrites.
- Treat the player likeness and outfit as canonical character design; do not redesign supplied emblems or substitute generated logos.
- Follow `UPRISE-WORLD-ROADMAP.md` in order. **Do not skip phases or gates merely because a later phase is technically possible.**
- Honor all mandatory stop/review points before progressing.

### Phase 0 audit gate

**Phase 0 must be completed before any Proof Room implementation or other Uprise World application-code change.**

Phase 0 must follow `docs/uprise-world/PHASE-0-AUDIT-INSTRUCTIONS.md` and produce the permanent deliverable:

`docs/uprise-world/AUDIT-REPORT.md`

Phase 0 is not complete until all of the following are true:

- `AUDIT-REPORT.md` exists;
- it contains the nine required audit sections;
- material conclusions cite actual repository paths/functions/components rather than generic assumptions;
- measurements that cannot be obtained are labeled **NOT MEASURED** rather than invented;
- no application implementation code was changed as part of the audit;
- the user has explicitly reviewed and approved the audit.

**No Phase 1 implementation may begin before explicit user approval.**

### Visual completion rule

**When visual output is part of a task, implementation is not complete until screenshots have been produced and explicitly evaluated against the canonical references and `SCREENSHOT-ACCEPTANCE-CRITERIA.md`.**

A successful compile, clean build, or working route is not sufficient evidence of visual completion.

Any screenshot criterion marked FAIL blocks phase completion until corrected and re-captured.

### Performance completion rule

Tablet is a binding target. Visual work that is not measured against `PERFORMANCE-BUDGET.md` is not considered tablet-ready. Sustained normal-play performance below 30 FPS is a blocking failure.

### First-task rule

When asked to begin Uprise World work, first complete **Phase 0** from `UPRISE-WORLD-ROADMAP.md` and `PHASE-0-AUDIT-INSTRUCTIONS.md`: audit the existing implementation against the Bible and supporting specs. Do not modify application code until the audit and proposed file plan are complete unless the user explicitly instructs otherwise.

## The Universe schema — one world, many universes

Any task that touches game worlds, level selectors, portals/teleporting between worlds, the bottom tab bar as a world switcher, or per-world saved state must first read:

- `docs/universe/UNIVERSE-SCHEMA.md`
- `docs/universe/universe-registry.json`

Summary of the law: HERE is one underlying world with many universes. Each universe has its own engine, its own play style (`visual` decision-tree or `fps`), its own entrance, and its own state slot — players continue where they left off in each universe. Universes connect only through registered portals (data, never cross-imported engine code). Adding a universe requires a registry entry, a contract file, an entrance route, and owner approval.

This schema does not relax any existing gate: Uprise World work still follows `docs/uprise-world/` phases, and Site 0 work still follows `assets/3d/prim3-site0/AGENTS.md`.
