# Uprise World — Complete Visual Reference Manifest

This manifest tells Codex exactly how to interpret the canonical visual assets in `docs/uprise-world/references/`.

## Authority order

1. Exact user-supplied canonical emblem artwork.
2. Approved McCluster character likeness sheet.
3. Approved canonical visual/wardrobe boards.
4. Raw McCluster photographs, considered jointly for likeness and body proportions.
5. Approved Living Sketch style references — **rendering technique only; never authoritative for any character's appearance or identity.**
6. Written implementation Bible and Proof Room specification.
7. AI interpretation.

If two references conflict, the higher-authority source wins. Missing details must never be invented when an exact canonical asset exists.

## Canonical asset index

### Character likeness
- `references/character/mccluster-character-likeness-sheet-approved.png`

### Consolidated visual boards
- `references/boards/canonical-visual-reference-board.jpg`
- `references/wardrobe/canonical-wardrobe-reference-board.jpg`
- `references/style/living-sketch-style-reference-board.jpg`
- `references/proof-room/proof-room-concept-board.jpg`

The Proof Room board controls the intended composition, illustration-distance progression, annotation language, and overall relationship between character and environment. The wardrobe board controls garment cut, color, and placement. Exact standalone emblem files always outrank composite boards if any graphic differs.

The Living Sketch board controls **rendering technique only** — the quality of the ink, graphite, wash, and paper. It controls nothing about character. The word "character" in the phrase "rendering character" has previously been misread here as "the player character"; it never meant that, and the phrasing has been removed to prevent it. See the warning below and `references/style/README.md`.

## Canonical wardrobe

The canonical protagonist wardrobe is:
- washed-blue oversized hoodie
- light-blue joggers
- white/neutral sneakers unless a later approved footwear reference supersedes this

### Exact hoodie and pant placement

**Front hoodie**
- `references/emblems/kingdom-stepper-approved.png` — centered chest artwork.
- `references/emblems/33-target-approved.png` — lower front hoodie near the pocket/hem placement shown in the wardrobe reference.

**Back hoodie**
- `references/emblems/hm-ammo-halo-approved.png` — centered large back mark. It is the exact HM composition with the vertical AMMO bullet/ammunition element between the H and M and the halo above. No extra artifacts, symbols, alternate lettering, or generated additions are permitted.

**Sleeves**
- `references/emblems/warroom-sword-approved.png` — WARROOM sword on one sleeve.
- `references/emblems/seek-first-drone-approved.png` — SEEK FIRST vertical treatment with the drone above it on the opposite sleeve.

**Joggers**
- `references/emblems/33-target-approved.png` — front of the pants/joggers in the placement shown by the canonical wardrobe board.

Do not redraw, regenerate, re-letter, simplify, reinterpret, or substitute any of these marks. Use the exact files.

## Canonical emblem files

- Kingdom Stepper: `references/emblems/kingdom-stepper-approved.png`
- HM / AMMO / halo: `references/emblems/hm-ammo-halo-approved.png`
- WARROOM sword: `references/emblems/warroom-sword-approved.png`
- SEEK FIRST + drone: `references/emblems/seek-first-drone-approved.png`
- 33 target: `references/emblems/33-target-approved.png`

## Living Sketch style

Primary reference:
- `references/style/living-sketch-style-reference-board.jpg`

### ⛔ ART STYLE ONLY — NOT A CHARACTER REFERENCE ⛔

**This board depicts a person who is not Matthew McCluster, not the protagonist,
and not any character in Uprise World.** The figures in STYLE REF 01–04 are
anonymous stand-in bodies drawn purely to demonstrate technique.

Use this board for **how things are drawn**. Never use it for **who anyone is** —
for the main character or for any NPC. Do not take face, hair, skin tone, beard,
build, age, clothing, colorway, or identity from it. The blue jacket and black
tee in these panels are **not** canonical wardrobe. The hair in these panels is
**not** the protagonist's hair.

The **STYLE 01** and **STYLE 02** panels inside
`references/boards/canonical-visual-reference-board.jpg` are the same artwork and
carry this identical restriction, even though character-authoritative panels sit
on the same page.

Character appearance comes only from the character likeness sheet, the raw
`assets/likeness/` photographs, the wardrobe board, the exact emblem files, and
the character panels of the composite and Proof Room boards. Full rules:
`references/style/README.md`.

The world and protagonist must appear to come from the same illustrator and the same physical sketchbook.

Core traits:
- loose variable-weight black ink contours
- visible construction marks and overdraw
- watercolor / marker washes with imperfect coverage
- paper breakthrough and large negative-space areas
- charcoal-gray grounding washes
- sparse red editorial scribbles
- selective saturation
- natural contemporary streetwear proportions
- unfinished edges
- hand-drawn rather than post-process-filtered appearance

Do **not** interpret this as generic anime, polished manga, cel shading, Spider-Verse imitation, oil painting, impasto, photoreal PBR, or a normal Three.js scene with a sketch filter.

## Proof Room visual target

Primary reference:
- `references/proof-room/proof-room-concept-board.jpg`

The Proof Room must visibly demonstrate the approved distance progression:
`graphite / ghost → ink → watercolor / marker wash → annotated completed state`

White-paper negative space must remain visible. Red editorial annotations are functional visual language, not decorative UI chrome.

## Codex usage rule

Before any visual implementation task, Codex must inspect:
1. this manifest;
2. `CODEX-IMPLEMENTATION-BIBLE.md`;
3. `PROOF-ROOM-SPEC.md` when working on the Proof Room;
4. the approved character likeness sheet;
5. every exact emblem relevant to the visible garment surfaces;
6. the canonical wardrobe board;
7. the Living Sketch style board — **for rendering technique only; it is not a character reference**;
8. the Proof Room concept board when applicable.

When visual work is claimed complete, Codex must produce screenshots and compare them against the canonical references and `SCREENSHOT-ACCEPTANCE-CRITERIA.md`. Compilation success alone is not acceptance.

## Do-not-use list

The earlier incorrect Kingdom Steppa / Kingdom Stepper chest emblem is explicitly rejected. Any old mockup containing that emblem may only be consulted for garment cut, washed-blue material direction, sleeve placement, or overall proportion. The rejected chest mark itself must never be traced, regenerated, inferred, or used.
