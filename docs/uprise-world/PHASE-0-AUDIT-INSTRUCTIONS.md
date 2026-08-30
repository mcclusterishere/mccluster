# UPRISE WORLD — PHASE 0 AUDIT INSTRUCTIONS

Version 1.0

## Purpose

Phase 0 is a **gated, read-first architecture audit**. It exists to understand the real HERE/Uprise World implementation before any Proof Room or Living Sketch code is written.

This is not a refactor task, not an implementation task, and not an opportunity to redesign the architecture from assumptions.

The required permanent deliverable is:

`docs/uprise-world/AUDIT-REPORT.md`

## Mandatory instruction

**PHASE 0 AUDIT ONLY — DO NOT MODIFY APPLICATION CODE.**

Read, in full:

- `AGENTS.md`
- `docs/uprise-world/CODEX-IMPLEMENTATION-BIBLE.md`
- `docs/uprise-world/REFERENCE-MANIFEST.md`
- `docs/uprise-world/PROOF-ROOM-SPEC.md`
- `docs/uprise-world/SCREENSHOT-ACCEPTANCE-CRITERIA.md`
- `docs/uprise-world/PERFORMANCE-BUDGET.md`
- `docs/uprise-world/UPRISE-WORLD-ROADMAP.md`
- this file

Then audit the existing Uprise World implementation.

Inspect the actual repository and runtime architecture. **Do not infer architecture from documentation alone.**

Identify and cite the actual repository path, function, class, module, component, route, configuration file, or asset that supports every important conclusion.

## Required inspection areas

Codex must inspect:

- application/framework structure
- Uprise World entrypoints and routes
- rendering engine and scene architecture
- Three.js/WebGL setup where applicable
- spherical-world implementation
- scene graph / world composition
- player locomotion
- camera behavior
- touch/mobile controls and joystick behavior
- interaction and landmark/check-in systems
- WebGL fallback path
- asset pipeline and loading behavior
- materials, shaders, and postprocessing
- state management and persistence
- data/content architecture
- build configuration
- deployment configuration
- existing tests/build scripts
- current performance risks
- reusable systems
- code that should not be touched during Proof Room work

## Required nine audit outputs

`docs/uprise-world/AUDIT-REPORT.md` must contain these nine sections exactly or with clearly equivalent headings:

### 1. Current architecture map

Document:

- framework/runtime
- entrypoints
- routes
- renderer
- Three.js/WebGL integration
- spherical-world code
- scene graph / world assembly
- state
- assets
- mobile controls
- fallback path
- build/deploy path

For each major subsystem, cite the actual repository path and relevant function/class/component.

### 2. What already works

Identify and cite existing working systems, including where applicable:

- locomotion
- touch joystick
- camera
- landmarks/check-ins
- interactions
- data-driven content
- persistence
- shaders/materials
- fallback behavior
- deployment/build path

Do not call something "working" without code evidence and, where safely measurable, runtime/build evidence.

### 3. What is reusable for Living Sketch

List the exact files/functions/components that should be preserved and reused.

For each item, explain:

- what it currently does
- why it is reusable
- whether it can be reused unchanged or behind an adapter
- what must not be broken

### 4. Conflicts and gaps against the Bible

Compare the real implementation against the Living Sketch and Proof Room requirements.

Look for conflicts such as:

- conventional PBR assumptions
- fullscreen sketch filters masquerading as the art system
- uniform outlines
- hard-coded content
- desktop-only assumptions
- unsuitable camera behavior
- overly coupled world construction
- missing illustration LOD capability
- missing draw-in/discovery state
- interaction UI that conflicts with the sketchbook language
- asset or performance assumptions that will fail on tablet

Every gap must cite the relevant code or explain that the feature is absent after repository inspection.

### 5. Performance baseline

Measure what can be measured safely without mutating application code.

Document, where available:

- current build/bundle sizes
- major asset sizes
- script/style payloads
- obvious texture/model outliers
- draw calls / renderer stats if accessible through read-only runtime inspection
- FPS/frame-time if safely measurable
- memory concerns if visible
- current mobile/tablet risks

If a metric cannot be measured in the available environment, mark it **NOT MEASURED** and explain why. Do not invent numbers.

### 6. Proposed isolated Proof Room architecture

Propose the smallest architecture that:

- does not replace the current world
- does not require destructive rewrites
- keeps current Uprise World behavior available
- can prove Paper, Graphite, Ink, Watercolor, Charcoal, and Annotation material families
- can prove illustration LOD
- can prove world draw-in/discovery behavior
- can use the canonical McCluster character and wardrobe references
- can be tested on tablet

Explain how the Proof Room can be isolated behind a route, feature flag, dev entrypoint, or equivalent architecture-consistent boundary.

### 7. Exact file plan

Provide four explicit lists:

**CREATE** — new files/directories needed for Phase 1.

**MODIFY** — existing files that require minimal changes.

**PRESERVE / DO NOT TOUCH** — working files/systems that should remain unchanged.

**POSSIBLE FUTURE DEPRECATION** — files that may later be retired, but must not be deleted during Phase 0 or Phase 1 without approval.

Every file path must be exact.

### 8. Risk register

At minimum consider risks to:

- touch controls
- mobile Safari/iPad performance
- current spherical-world behavior
- camera
- WebGL fallback
- route/navigation behavior
- deployment/build pipeline
- asset loading
- memory
- shader compatibility
- canonical visual references
- regression risk to current users

For each risk include:

- severity: LOW / MEDIUM / HIGH / BLOCKER
- likelihood: LOW / MEDIUM / HIGH
- evidence
- mitigation

### 9. Recommended Phase 1 implementation order

Recommend the exact build sequence after audit approval.

The sequence must remain inside Phase 1 / Proof Room scope and must not jump ahead to world expansion.

Explain dependencies between steps.

## Allowed actions during Phase 0

Codex may:

- read/search repository files
- inspect git history where useful
- run read-only diagnostics
- run existing builds/tests if they do not modify tracked application code
- run safe profiling commands
- inspect generated build output if created outside tracked production source or if existing project tooling does so normally
- inspect asset metadata and file sizes

## Forbidden actions during Phase 0

Codex must not:

- modify application source code
- refactor application code
- install new dependencies
- remove dependencies
- replace architecture
- create the Proof Room implementation
- create shaders/materials for the Proof Room
- change routes
- change controls
- change deployment configuration
- regenerate visual assets
- merge branches
- expand Uprise World

The audit document itself is the only intended repository write for Phase 0, unless a clearly necessary audit-only note is explicitly approved.

## Evidence standard

Generic statements are unacceptable.

Bad:

> The app uses Three.js and mobile controls.

Good:

> `path/to/file.js` imports `THREE` and creates the renderer in `createRenderer()`. Touch movement is initialized in `path/to/mobile-controls.js` through `initJoystick()`.

Every architecture claim should be grounded this way.

## Stop condition

After writing `docs/uprise-world/AUDIT-REPORT.md`:

1. stop;
2. do not begin Phase 1;
3. return a concise human-readable summary;
4. explicitly state any measurements that could not be obtained;
5. wait for user approval.

## Phase 0 completion gate

Phase 0 is complete only when:

- `docs/uprise-world/AUDIT-REPORT.md` exists;
- all nine required sections are present;
- material conclusions cite actual repo paths/functions/components;
- unsupported assumptions are clearly labeled;
- unmeasured metrics are not fabricated;
- no application implementation code was changed;
- the user has reviewed and approved the audit.

**No Phase 1 implementation may begin before explicit user approval.**

## Codex handoff prompt

Use this exact task framing when starting the audit:

> PHASE 0 AUDIT ONLY — DO NOT MODIFY APPLICATION CODE. Read `AGENTS.md` and every required Uprise World specification named in `docs/uprise-world/PHASE-0-AUDIT-INSTRUCTIONS.md`. Inspect the actual repository and runtime architecture, not documentation alone. Produce `docs/uprise-world/AUDIT-REPORT.md` with the nine required sections, grounding every important conclusion in actual repository paths/functions/components. You may run safe read-only inspections, existing builds/tests, and profiling that do not modify application source. Do not refactor, install dependencies, build the Proof Room, change routes, or modify application code. Stop after writing the audit report and return a concise summary for human approval.