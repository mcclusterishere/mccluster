# UPRISE WORLD — GATED IMPLEMENTATION ROADMAP

Version 1.0

This roadmap is mandatory. Codex may not skip phases because a later feature seems easy or because it can generate more code quickly. Every phase has an explicit gate. A failed gate blocks progression.

## Global rules

Before any implementation task, read:

- `AGENTS.md`
- `docs/uprise-world/CODEX-IMPLEMENTATION-BIBLE.md`
- `docs/uprise-world/REFERENCE-MANIFEST.md`
- `docs/uprise-world/PROOF-ROOM-SPEC.md`
- `docs/uprise-world/SCREENSHOT-ACCEPTANCE-CRITERIA.md`
- `docs/uprise-world/PERFORMANCE-BUDGET.md`

Canonical user-supplied references outrank generated approximations.

When visual output is part of a task, screenshots + evaluation are required before completion.

## Phase 0 — Audit only

Goal: understand what exists before changing it.

Codex must inspect:

- renderer/framework;
- current WebGL/spherical-world implementation;
- locomotion;
- touch/joystick controls;
- routing/navigation;
- fallback behavior;
- content/data model;
- asset loading;
- deployment/build configuration;
- performance baseline;
- reusable code.

Deliverable:

- written audit;
- preserve/change/deprecate table;
- proposed Proof Room architecture;
- exact file plan.

### Gate 0

PASS only when the audit exists and no application code has been modified unless explicitly authorized.

## Phase 1 — Visual Proof Room shell

Goal: create an isolated, tiny test route/scene without replacing the current world.

Implement only the minimum scene structure from `PROOF-ROOM-SPEC.md`:

- spawn;
- short street;
- one building;
- one tree;
- one vehicle;
- one utility prop;
- one document location.

Do not solve every material yet.

### Gate 1

PASS when:
- route loads independently;
- current Uprise World remains intact;
- touch/desktop navigation works;
- initial scene structure matches the spec;
- no major console errors.

## Phase 2 — Canonical protagonist

Goal: establish McCluster as the actual player character.

Use the approved likeness sheet and exact wardrobe placement rules.

Required clothing:

- front chest: KINGDOM STEPPER;
- back: HM + vertical AMMO bullet + halo, no extra artifacts;
- one sleeve: WARROOM sword;
- opposite sleeve: SEEK FIRST + drone above it;
- front lower hoodie: 33 target;
- front joggers: 33 target;
- neutral/white sneakers unless superseded.

### Gate 2

PASS only when required front/back/three-quarter screenshots pass `SCREENSHOT-ACCEPTANCE-CRITERIA.md`.

## Phase 3 — Living Sketch material system

Goal: prove reusable material families.

Implement/prototype:

- PaperMaterial;
- GraphiteMaterial;
- InkMaterial;
- WatercolorMaterial;
- CharcoalMaterial;
- AnnotationMaterial.

Do not hide a conventional 3D world behind one fullscreen filter.

### Gate 3

PASS when still screenshots clearly read as Living Sketch and not PBR/toon-filter rendering.

## Phase 4 — Illustration LOD

Goal: make illustrative completeness depend on distance.

Required progression:

- far: graphite, low saturation, low detail;
- medium: ink, clearer structure, some wash;
- near: selective watercolor/marker + strongest detail.

The implementation should reduce actual rendering complexity where possible rather than keeping near-state content fully active behind opacity.

### Gate 4

PASS only when far/medium/near screenshots visibly differ in the required way and transitions remain stable during camera movement.

## Phase 5 — Draw-in + discovery system

Goal: prove the signature mechanic that the world draws itself as the player approaches and becomes persistently more complete after discovery.

Implement one full sequence:

`ghost → graphite → ink → wash/detail → annotated/discovered`

At least one discovered state must persist for the session.

### Gate 5

PASS when the sequence works interactively, is not just a uniform opacity fade, and completed discovery visually remains.

## Phase 6 — UI / document language

Goal: establish the sketchbook interaction grammar.

Implement:

- red hand-drawn directional cue;
- discovery circle/arrow;
- integrated touch-readable interaction prompt;
- physical document presentation rather than generic modal;
- persistent annotation after discovery.

### Gate 6

PASS when interaction/document screenshots satisfy the acceptance file and no conventional glowing quest marker is required.

## Phase 7 — First real landmark

Goal: translate the validated renderer into one real Uprise World location/landmark.

Do not build a district. Build exactly one meaningful landmark using the validated systems.

Prioritize recognition through a few distinctive architectural/cultural features, not exhaustive geometry.

### Gate 7

PASS when the landmark retains the Proof Room visual quality and all core systems remain reusable/data-driven.

## Phase 8 — Tablet optimization

Goal: make the validated experience practical on modern iPad/tablet browsers.

Use `PERFORMANCE-BUDGET.md` as the binding target.

Required work may include:

- adaptive DPR;
- texture compression/resolution tiers;
- line-density scaling;
- instancing/batching;
- shadow simplification;
- lazy loading;
- mobile-safe material paths;
- touch responsiveness checks;
- reduced-motion validation.

### Gate 8

PASS only after Codex reports measured performance evidence and normal play does not sustain below 30 FPS.

## Phase 9 — Expand the world

Only now may content expansion begin.

Expansion should reuse validated systems for:

- additional landmarks;
- streets;
- narrative artifacts;
- discovery state;
- map completion;
- later NPC/quest/content systems if separately approved.

Do not use Phase 9 as permission for an uncontrolled procedural city rewrite.

### Gate 9

Each expansion increment must preserve visual acceptance and tablet performance budgets.

## Mandatory stop/review points

Codex must stop and request human review after:

1. Phase 0 audit/file plan;
2. first complete Proof Room render;
3. canonical protagonist first appears;
4. illustration LOD works;
5. draw-in/discovery sequence works;
6. document interaction works;
7. first real landmark render;
8. tablet performance report.

Do not autonomously continue past a failed or unreviewed gate.

## Definition of done

A phase is done only when:

- implementation requirements are met;
- relevant screenshots are captured;
- screenshot criteria are explicitly scored PASS/FAIL;
- performance requirements relevant to the phase are measured;
- no blocking FAIL remains;
- the phase's human-review gate has been honored.

"Build succeeded" is not a definition of done.