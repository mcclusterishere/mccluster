# UPRISE WORLD — SCREENSHOT ACCEPTANCE CRITERIA

Version 1.0

This document converts the Living Sketch visual target into literal pass/fail QA. Visual implementation is not complete because code compiles; it is complete only when required screenshots are captured, compared against canonical references, and pass this checklist.

## Canonical references

Before evaluating screenshots, Codex must read:

- `AGENTS.md`
- `docs/uprise-world/CODEX-IMPLEMENTATION-BIBLE.md`
- `docs/uprise-world/PROOF-ROOM-SPEC.md`
- `docs/uprise-world/REFERENCE-MANIFEST.md`
- `docs/uprise-world/references/character/mccluster-character-likeness-sheet-approved.png`
- `docs/uprise-world/references/emblems/kingdom-stepper-approved.png`
- all approved wardrobe/emblem/style files present under `docs/uprise-world/references/`

## Required capture set

Capture screenshots at the following states. Use consistent viewport and quality settings for comparison when possible.

### A. Spawn frame

Capture immediately after scene becomes interactive.

PASS only if:
- McCluster is visibly present and proportionally readable.
- The first frame immediately reads as hand-drawn mixed media, not normal 3D.
- Warm white paper/negative space is visible.
- Nearby objects have charcoal/ink grounding rather than floating like stickers.
- At least one distant form is visibly less complete than nearby forms.

FAIL if:
- the scene reads as conventional Three.js/PBR with a sketch filter;
- paper is hidden by a fully rendered sky/environment;
- the protagonist does not resemble the canonical sheet.

### B. Far landmark — graphite state

Capture from the authored far-distance test marker, approximately the far LOD threshold from the main building.

PASS only if:
- building/environment is graphite-dominant;
- contour lines are thin, incomplete, and low-density;
- saturation is minimal;
- significant paper shows through;
- windows/sign/details are suggestions rather than fully resolved geometry.

FAIL if color/detail is already near-state quality.

### C. Medium landmark — ink state

Capture from the authored medium-distance marker, approximately 5 m from the building unless the scene scale requires an equivalent documented distance.

PASS only if:
- ink contours are stronger than the far state;
- silhouette, entrance, roofline, and selected window geometry are readable;
- some wash may appear, but the scene is not yet fully colored;
- line weight is visibly irregular and broken.

FAIL if transition is only a uniform opacity fade.

### D. Near landmark — wash/detail state

Capture from the authored near-distance marker/interact radius.

PASS only if:
- watercolor/marker color appears selectively;
- paper remains visible within and around surfaces;
- charcoal masses ground the object;
- detail is strongest here but remains intentionally selective;
- no glossy clearcoat/metallic PBR appearance dominates.

### E. Interaction frame

Capture when the document interaction first becomes available.

PASS only if:
- a hand-drawn red annotation identifies the object;
- no glowing RPG marker is used;
- the functional interaction affordance is readable on touch;
- the annotation visually belongs to the same sketchbook medium.

### F. Document-open frame

Capture the opened artifact.

PASS only if:
- it reads as a physical paper/document inserted into the sketchbook world;
- it is not a generic browser/game modal;
- real/scanned evidence remains legible if used;
- controls are clear and tablet-sized.

### G. Completed-discovery frame

Capture after closing the document and completing the discovery sequence.

PASS only if:
- the landmark is visually more complete than before interaction;
- the persistent red note/mark remains;
- the change survives normal camera movement during the session.

### H. Character front/three-quarter close view

PASS only if:
- face resembles the approved McCluster likeness sheet;
- medium-length twist silhouette is preserved;
- mustache/goatee structure is recognizable;
- anatomy and posture remain natural;
- character is rendered in the same ink/graphite/wash language as the environment;
- front hoodie has approved KINGDOM STEPPER mark;
- lower-front hoodie has approved 33 target mark;
- one sleeve has WARROOM sword;
- opposite sleeve has SEEK FIRST with drone above it.

### I. Character back close view

PASS only if:
- approved HM + vertical AMMO bullet + halo composition is centered on the back;
- bullet is between H and M in the approved geometry;
- no extra symbols, lines, lettering, artifacts, or invented decoration appear;
- back artwork follows garment perspective and fabric folds without redesigning the mark.

### J. Pants mark view

PASS only if:
- approved 33 target/circle mark appears on the front of the joggers in the approved placement;
- the mark is not substituted or omitted.

## Global visual pass/fail matrix

Every required screenshot must pass all applicable rules below.

### Likeness
PASS: recognizable as the approved McCluster character under abstraction.
FAIL: generic Black male avatar, wrong hair, wrong facial proportions, wrong facial-hair pattern, or unrelated generated character.

### Medium
PASS: broken ink, graphite construction, uneven marker/watercolor wash, charcoal grounding, exposed paper.
FAIL: clean cel shading, uniform toon outlines, photorealism, glossy PBR, generic anime, or fullscreen sketch filter carrying the entire look.

### Lines
PASS: thickness varies; contours break, overlap, double, and disappear selectively.
FAIL: mechanically uniform vector outlines.

### Color
PASS: selective pigment with uneven coverage and paper breakthrough.
FAIL: every surface fully filled with smooth digital color.

### Distance behavior
PASS: far = graphite/low detail; medium = ink; near = wash/detail; completed discovery = annotation/persistent finish.
FAIL: same material/detail at all distances.

### Paper negative space
PASS: white/warm-white substrate remains a compositional element.
FAIL: environment is visually filled edge-to-edge like a conventional game.

### Canonical graphics
PASS: exact approved marks in exact approved locations.
FAIL: AI-regenerated text/logo approximation, moved marks, missing marks, or invented artifacts.

### Interaction
PASS: annotations look drawn onto the world and discovery changes illustration state.
FAIL: generic glowing marker/modal with no persistent world change.

## Completion rule

A visual task is **NOT COMPLETE** unless:

1. all applicable screenshots exist;
2. each screenshot has been evaluated against this file;
3. Codex records PASS/FAIL with one-sentence evidence for every criterion;
4. any FAIL blocks phase completion;
5. failed criteria are corrected and re-captured before progression.

Do not accept "implemented", "build succeeded", or "works locally" as visual completion evidence.