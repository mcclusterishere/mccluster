# UPRISE WORLD — CODEX IMPLEMENTATION BIBLE

Version 1.0 — Living Sketch visual system, technical architecture, interaction language, and delivery rules.

## 0. Prime directive

You are building **UPRISE WORLD**.

Do not interpret this project as a conventional 3D game, conventional website, metaverse, generic low-poly experience, or ordinary Three.js scene.

UPRISE WORLD is:

> **A living, explorable mixed-media sketchbook in which the player walks through a world that appears to have been drawn by hand.**

The canonical visual target is the approved protagonist portrait wearing the washed-blue **KINGDOM STEPPA** hoodie. Everything in the experience must appear capable of belonging to the same physical sketchbook as that illustration.

The objective is **not** to build a realistic world and apply a sketch shader. The objective is to build a world whose geometry, materials, textures, animation, composition, lighting, UI, level-of-detail behavior, and interaction systems fundamentally behave like hand-created illustration.

---

## 1. Canonical art direction — Living Sketch

Internal art-direction name: **LIVING SKETCH**.

Secondary descriptive name: **Urban Mixed-Media Sketchbook**.

The visual language combines:

- expressive black ink drawing
- visible graphite construction marks
- watercolor washes
- alcohol-marker rendering
- charcoal smudging
- dry-brush texture
- selective opaque paint accents
- unfinished fashion illustration
- contemporary streetwear character sketching
- editorial annotations
- notebook doodles
- large untouched paper regions
- imperfect color registration
- variable line weight
- selective saturation
- selective detail
- gestural anatomy
- environmental abstraction

These are not independent effects to stack. They are one unified visual system.

---

## 2. Golden visual rule

Every visual decision must pass this test:

> **Could this object plausibly have been drawn on the same sheet of paper as the canonical Uprise World protagonist?**

If no: reject it.

If uncertain: simplify it.

If something appears too polished, digital, smooth, symmetrical, physically accurate, game-like, glossy, procedural, or sterile, introduce controlled human imperfection.

---

## 3. Forbidden directions

Do not turn Uprise World into:

- photorealism
- generic anime
- conventional manga panels
- cel-shaded anime
- Spider-Verse imitation
- Fortnite-like rendering
- Roblox-like rendering
- Pixar/Disney-like rendering
- GTA-like realism
- generic low-poly art
- glossy mobile-game art
- standard toon shading
- realistic watercolor painting
- oil painting / impasto
- comic-book superhero rendering
- neon cyberpunk
- vaporwave
- generic graffiti
- children's-book watercolor
- flat vector illustration
- realistic 3D with outlines
- normal 3D with a watercolor filter

### Critical prohibition

**Do not build a conventional Three.js world and place a sketch filter over the camera.** The art direction must exist at the asset, material, shader, composition, animation, and UI levels.

---

## 4. Paper is the world

The experience begins from the idea of **paper**, not darkness or generic atmosphere.

The world substrate should resemble premium contemporary drawing paper:

- warm white
- extremely subtle fiber texture
- minimal grain
- no antique yellow
- no parchment aesthetic
- no distressed grunge overlay

Paper remains visible throughout the experience.

White space is not missing content. **White space is geometry.** It is part of the composition.

Do not feel obligated to fill every visible part of the viewport.

---

## 5. Ink system

Ink provides structural definition.

Contours should exhibit:

- irregular thickness
- incomplete lines
- doubled lines
- occasional overdraw
- slight wobble
- deliberate gaps
- scratch marks
- construction remnants

Never use perfectly consistent outlines.

The viewer should occasionally see evidence that the imaginary illustrator drew a line, reconsidered it, drew another, and left both.

Do not clean these artifacts away.

---

## 6. Line hierarchy

Line weight communicates importance.

- Primary silhouette: darkest and strongest.
- Structural features: medium strength.
- Interior details: thin and intermittent.
- Construction marks: very light.
- Atmospheric/background forms: extremely light.

The world should naturally become less defined with distance.

---

## 7. Color system

Color is not intended to fill every surface completely.

It should behave like physical pigment laid over drawing. Allow:

- uneven coverage
- transparent areas
- paper breakthrough
- overlapping washes
- multiple shades within one object
- slightly misplaced color edges
- visible brush direction
- pigment accumulation
- dry edges
- occasional bleed

Avoid flat, perfectly uniform digital fills.

---

## 8. Selective saturation

Most scenes should have a restrained base:

- paper white
- graphite gray
- charcoal
- black ink
- desaturated environmental color

Important subjects receive stronger saturation:

- player clothing
- important landmarks
- interactive artifacts
- narrative objects
- cultural symbols

This establishes hierarchy without glowing game markers.

---

## 9. Red editorial accent

Small quantities of red marks may appear as if drawn by hand with a red pencil or pen.

Red can communicate:

- emphasis
- discovery
- human annotation
- narrative importance
- interaction
- direction
- memory
- urgency

Examples:

- rough circles
- arrows
- underlines
- tiny waveforms
- brackets
- question marks
- handwritten notes

Do not turn red into a generic UI theme.

---

## 10. Character canon

The protagonist must remain visually recognizable.

Preserve structural characteristics from approved likeness references, including:

- face length and overall head silhouette
- eye spacing and eye shape
- eyebrow placement
- nose geometry
- cheek structure
- jaw
- mouth proportions
- mustache and goatee pattern
- hairline
- individual twist silhouette

Do not rely on photorealistic skin detail. **Likeness must survive abstraction.**

---

## 11. Canonical outfit

The canonical protagonist outfit is the approved washed-blue **KINGDOM STEPPA** hoodie and matching light-blue jogger direction supplied by the user.

Important hoodie graphics include:

- chest: KINGDOM STEPPA emblem
- sleeve: SEEK FIRST
- opposite sleeve: WARROOM sword
- lower/front detail: 33 target/circle motif
- back: HM/ammunition/halo composition where visible and appropriate

Do not redesign these elements. Do not invent substitutes. Do not modernize the logos.

Canonical artwork should be copied from approved source assets whenever possible rather than regenerated.

---

## 12. Clothing rendering

The hoodie should not behave like conventional realistic cloth rendering.

Represent volume using:

- blue watercolor masses
- desaturated blue washes
- indigo strokes
- charcoal folds
- white-paper highlights
- black ink seams
- dry-brush shadows

A clothing fold should often be communicated by one or two intentional marks rather than full physically based cloth shading.

---

## 13. Character proportions

Use believable human anatomy with controlled fashion-illustration exaggeration.

Permitted:

- slightly elongated legs
- mildly enlarged sneakers
- expressive hands
- exaggerated garment volume
- simplified anatomy

Avoid superhero, chibi, or anime anatomy.

Target progression:

**REAL PERSON → FASHION SKETCH → INTERACTIVE CHARACTER**

---

## 14. Player posture and idle behavior

Avoid a generic game-character stance.

Default posture should feel casual and observed.

Possible idle actions:

- weight shift
- shoulder drop
- head tilt
- looking around
- adjusting a cuff
- touching the hoodie
- glancing downward
- checking an object
- subtle foot repositioning

The player should look like somebody standing somewhere, not an avatar waiting for input.

---

## 15. Environment design

Do not render every building or object with equal detail.

Near-player architecture may include:

- structural ink contours
- selected windows
- watercolor wall mass
- charcoal shadow
- signage
- limited architectural detail

Far architecture may collapse to:

- several graphite lines
- pale gray wash
- a few window suggestions

Very distant structures may be barely visible construction marks.

---

## 16. Illustration LOD

Traditional LOD swaps polygon complexity. Uprise World must additionally swap **illustrative completeness**.

Distance may change:

- line density
- line darkness
- texture opacity
- saturation
- wash density
- detail frequency
- annotation visibility

Conceptual progression:

1. Distant: graphite suggestion.
2. Approaching: ink structure.
3. Near: watercolor/marker wash.
4. Important: detail and narrative marks.
5. Discovered: completed illustration and annotation.

---

## 17. The world draws itself

This is a signature mechanic.

Significant locations should progressively appear to be drawn as the player approaches or engages.

Suggested stages:

1. **Ghost** — faint graphite construction.
2. **Structure** — black structural ink emerges.
3. **Wash** — selective watercolor appears.
4. **Detail** — doors, windows, signage, cultural details resolve.
5. **Annotation** — handwritten information appears.
6. **Discovery** — red editorial mark confirms meaningful discovery.

This should feel organic, not like a loading animation.

---

## 18. Discovery permanently changes the drawing

Exploration should leave visual evidence.

After discovery:

- details can remain
- color can persist
- annotations can remain
- journal information becomes available
- map/record representation becomes more complete

The player's history is visible through the world's illustration state.

---

## 19. Streets

Do not build hyper-detailed asphalt.

Represent streets with combinations of:

- broad gray wash
- charcoal streaks
- ink perspective lines
- sparse cracks
- dry-brush tire marks
- incomplete lane markings

Allow paper to remain visible.

---

## 20. Buildings

Recognition is more important than completeness.

Prioritize:

- silhouette
- entrance
- culturally meaningful features
- recognizable signage
- roofline
- selected windows
- 3–7 distinctive architectural details

Abstract everything else.

---

## 21. Trees and vegetation

Avoid realistic foliage simulation.

Trees may consist of:

- gestural trunk lines
- loose branches
- green/blue/gray watercolor masses
- dry-brush leaf clusters
- sparse ink accents

Individual leaves are usually unnecessary.

---

## 22. Vehicles

Vehicles should feel like transportation sketches, not configurator renders.

Use:

- recognizable silhouette
- loose wheels
- incomplete reflections
- a few hard structural lines
- watercolor color mass
- selected windows/headlights

---

## 23. Shadows

Avoid dominant physically perfect shadows.

Prefer:

- charcoal masses
- gray watercolor pools
- scribbled hatching
- dry-brush grounding marks

Characters should often have irregular gray marks beneath their feet.

---

## 24. Lighting

Lighting exists primarily to preserve form and readability.

Prefer:

- broad soft illumination
- restrained highlights
- subtle directional shading
- ambient paper brightness

Avoid:

- glossy PBR reflections
- excessive bloom
- dramatic HDR
- lens flare
- physically perfect metallic response everywhere

---

## 25. Weather vocabulary

Weather should obey the medium.

- Rain: loose vertical ink/watercolor streaks.
- Fog: paper white swallowing distant forms.
- Wind: directional scratch marks.
- Snow: unpainted paper flecks.
- Heat: loose wavering pencil/ink distortion.
- Night: dark ink washes surrounding preserved paper highlights, not simply lowering exposure.

---

## 26. UI principle

The interface should feel native to the sketchbook.

Prefer illustrative equivalents to generic HUD components:

- waypoint → hand-drawn arrow
- object highlight → rough circle
- new location → handwritten annotation
- route line → sketched directional marks
- objective emphasis → underline/bracket/editorial mark

Do not allow these marks to overwhelm usability.

---

## 27. Typography

Use two layers:

1. **Functional typography** — clean, readable, accessible.
2. **World annotation typography** — handwritten/sketched where appropriate.

Never sacrifice readability for the sketch aesthetic.

---

## 28. Documents and evidence

Documents are central to Uprise World and should feel physically inserted into the sketchbook.

Possible presentations:

- taped page
- scanned document
- clipped article
- notebook sheet
- photograph
- highlighted excerpt
- margin note

Avoid generic modal-window treatment where a more physical artifact presentation is viable.

---

## 29. Photographs

Real photographs may intentionally contrast with the illustrated world.

Treat them as physical media:

- Polaroid
- print
- clipping
- taped photograph
- contact sheet

Do not unnecessarily redraw archival evidence. The contrast between **drawn memory** and **photographic evidence** can be part of the storytelling.

---

## 30. Audio visual language

Sound may subtly influence the drawing.

Examples:

- music creates small rhythmic ink marks
- bass produces slight line vibration
- speech can produce restrained waveform doodles
- important musical moments can increase selective saturation

Avoid generic equalizer bars.

---

## 31. Movement visual language

Walking can slightly disturb the illustration:

- subtle line vibration
- small cloth sketch movement
- faint ground marks

Running may add:

- longer directional marks
- slightly reduced background detail
- stronger gesture lines

Stopping allows nearby details to settle and resolve.

Keep effects restrained to avoid visual fatigue or nausea.

---

## 32. Camera

Camera behavior should support illustration, not imitate a cinematic AAA game camera.

Avoid excessive:

- depth of field
- lens distortion
- chromatic aberration
- bloom
- motion blur
- camera shake

The player should feel like they entered artwork, not like they are looking through an expensive virtual lens.

---

## 33. Performance philosophy

Stylization is not an excuse for poor performance.

Prioritize:

- fast initial load
- responsive controls
- progressive asset loading
- asset reuse
- mobile/tablet viability
- texture atlasing
- geometry instancing
- sensible LOD
- lazy loading
- compressed assets
- WebP/AVIF for web imagery when appropriate
- KTX2/Basis for GPU textures when appropriate
- glTF/GLB for reusable geometry when appropriate

Visual richness should come primarily from art direction rather than massive polygon counts.

---

## 34. Architecture boundaries

Separate concerns:

- world state
- rendering
- content
- interaction
- UI
- assets
- audio
- persistence

Do not tightly couple landmark narrative content to renderer implementation.

Conceptual data model:

```ts
interface Landmark {
  id: string;
  name: string;
  position: unknown;
  type: string;
  discoveryState: DiscoveryState;
  illustrationState: IllustrationState;
  content: unknown;
  artifacts: unknown[];
  audio?: unknown;
  interactions?: unknown[];
}
```

The renderer decides how those states appear.

---

## 35. Illustration state

Create a formal concept similar to:

```ts
type IllustrationState =
  | "ghost"
  | "graphite"
  | "ink"
  | "washed"
  | "detailed"
  | "annotated";
```

Keep this concept independent from gameplay state where possible.

---

## 36. Discovery state

Suggested model:

```ts
type DiscoveryState =
  | "unknown"
  | "seen"
  | "visited"
  | "examined"
  | "completed";
```

Discovery and illustration are related but not identical.

Example: seeing a structure may change `unknown → seen` while its illustration only changes `ghost → graphite`. Completing the narrative might change the illustration to `annotated`.

---

## 37. Reusable material system

Prefer reusable material primitives over bespoke rendering for every object.

Conceptual material families:

- PaperMaterial
- GraphiteMaterial
- InkMaterial
- WatercolorMaterial
- MarkerMaterial
- CharcoalMaterial
- DryBrushMaterial
- AnnotationMaterial

The goal is a coherent visual grammar, not one-off hacks.

---

## 38. Watercolor material behavior

Support approximations of:

- variable opacity
- paper breakthrough
- pigment pooling
- irregular edges
- color variation
- directional brush texture

Do not implement expensive fluid simulation unless clearly justified. Visual approximation is sufficient.

---

## 39. Ink material behavior

Support:

- variable width
- broken coverage
- irregular opacity
- imperfect edges
- optional secondary contour
- distance fade

Avoid obvious repeating procedural patterns.

---

## 40. Graphite material behavior

Graphite is quieter than ink and is ideal for:

- distant geometry
- construction lines
- incomplete objects
- navigation sketches
- background details

Graphite represents the world's **potential state**. Ink represents increased certainty.

---

## 41. Annotation material behavior

Annotations may include:

- arrows
- circles
- words
- underlines
- stars
- crosses
- hearts
- waveform marks
- brackets
- question marks

Annotations can sit visually above the environment but must still feel physical and hand-produced.

---

## 42. Imported asset rule

When importing conventional 3D assets, never expose them directly without adaptation.

At minimum:

1. simplify inappropriate visual complexity;
2. remove incompatible PBR gloss;
3. generate or author suitable contours;
4. assign sketch materials;
5. reduce unnecessary detail;
6. integrate paper breakthrough;
7. test at multiple distances.

---

## 43. Real-world landmark rule

For real locations, identify the **3–7 most distinctive visual features** that make the place recognizable.

Render those strongly. Abstract the rest.

This improves recognition, style coherence, and performance.

---

## 44. Animation frame character

Perfectly smooth interpolation can undermine the handmade feeling.

Selected non-critical secondary animation may use slight held-frame or stepped characteristics.

Player locomotion itself must remain responsive and comfortable.

---

## 45. Accessibility

Never allow visual style to make the experience unusable.

Maintain:

- readable text
- sufficient contrast
- clear focus states
- keyboard support where applicable
- touch-friendly controls
- reduced-motion mode
- captions
- audio controls

If accessibility and aesthetics conflict, accessibility wins.

---

## 46. Reduced motion

Reduced-motion mode should reduce or disable:

- line jitter
- animated drawing
- aggressive camera effects
- environmental scribble movement
- complex transition drawing

The world must remain coherent and beautiful when static.

---

## 47. Tablet/mobile rule

Do not treat mobile as a shrunk desktop.

On constrained devices, reduce:

- annotation density
- distant detail
- expensive shader layers
- texture resolution
- simultaneous interactive objects

Preserve:

- protagonist readability
- landmark identity
- core watercolor/ink appearance
- discovery mechanics
- touch responsiveness

The primary user workflow includes tablet use, so coarse-pointer/touch operation is first-class.

---

## 48. Content before decoration

Do not add meaningless doodles simply because doodles belong to the style.

Important marks should ideally communicate:

- personality
- movement
- direction
- narrative
- interaction
- memory
- emotion

Visual noise without purpose weakens the system.

---

## 49. Controlled imperfection

Human imperfection is **not random procedural noise**.

Imperfection should follow:

- gesture
- anatomy
- perspective
- hand movement
- material behavior
- emphasis

Random distortion that has no relationship to form looks like software pretending to be handmade.

---

## 50. Hero-shot test

Every major environment must pass a still-image test.

Pause the experience. Hide purely functional UI. Take a screenshot.

Ask:

> **Could this screenshot plausibly exist as a finished Uprise World illustration?**

If not, the environment has failed the art direction.

---

## 51. Character acceptance tests

Every protagonist implementation must pass:

- **Silhouette test** — recognizable without facial detail.
- **Likeness test** — recognizable when the face is visible.
- **Outfit test** — Kingdom Steppa identity is legible.
- **Medium test** — appears physically illustrated.
- **World test** — looks like the same artist created the character and environment.

---

## 52. Scene acceptance test

Every scene should meaningfully contain all four visual pillars:

1. **INK** — structural definition.
2. **WASH** — selective pigment.
3. **PAPER** — negative space.
4. **GESTURE** — evidence of human imperfection.

If one completely dominates, rebalance.

---

## 53. The Visual Proof Room

Do **not** build the entire world first.

Build a tiny controlled proof scene containing only:

- protagonist
- one street
- one building
- one tree
- one vehicle
- one interactive object
- one document artifact
- one discovery interaction
- one environmental annotation

This is the gate for world expansion.

---

## 54. Proof Room success criteria

Before expanding content, demonstrate:

1. character matches the approved style;
2. environment matches the character;
3. paper remains visually meaningful;
4. ink system works;
5. watercolor/marker system works;
6. distance abstraction works;
7. discovery drawing works;
8. annotation/UI language works;
9. movement feels appropriate;
10. tablet/mobile performance is acceptable.

If these fail, **do not expand the map**. Fix the renderer and asset pipeline.

---

## 55. Development phases

### Phase 0 — Audit

Inspect the current repository. Document:

- renderer
- existing Uprise World files
- dependencies
- world architecture
- asset pipeline
- current locomotion
- touch/mobile controls
- landmark/check-in logic
- fallback behavior
- performance characteristics
- deployment path

### Phase 1 — Visual Proof Room

Build the smallest possible test environment.

### Phase 2 — Canonical protagonist

Create the production player representation around the approved likeness and outfit.

### Phase 3 — Living Sketch material system

Create reusable paper, graphite, ink, watercolor/marker, charcoal, dry-brush, and annotation primitives.

### Phase 4 — Illustration LOD

Implement distance-driven illustrative completeness.

### Phase 5 — Discovery drawing

Implement progressive world completion.

### Phase 6 — Annotation/UI language

Replace generic game markers with coherent sketchbook interaction language.

### Phase 7 — First real district/landmark cluster

Only after Proof Room approval.

### Phase 8 — Content pipeline

Formalize how future characters, locations, documents, and props enter the style system.

### Phase 9 — Tablet/mobile optimization

Profile and optimize on coarse-pointer devices.

### Phase 10 — World expansion

Expand only after the visual and technical foundation is stable.

---

## 56. Code-change discipline

Do not perform large architectural rewrites merely because another architecture appears cleaner.

Before replacing existing systems:

1. inspect;
2. document;
3. identify the actual limitation;
4. preserve working behavior;
5. change the smallest necessary surface.

No vanity rewrites.

---

## 57. Dependency rule

Do not add dependencies casually.

Before adding a dependency, determine whether the current stack can solve the problem reasonably.

Every dependency adds:

- bundle weight
- security surface
- maintenance burden
- compatibility risk

Prefer lightweight internal systems when appropriate.

---

## 58. Source-of-truth hierarchy

When sources conflict, use this priority:

1. approved user-supplied assets;
2. this implementation Bible;
3. approved visual prototypes/screenshots;
4. documented design system;
5. code comments;
6. AI assumptions.

If implementation contradicts an approved reference, the implementation is wrong.

---

## 59. Do not redesign supplied artwork

If exact artwork is provided, use it.

Do not:

- redraw it unnecessarily
- reinterpret typography
- substitute icons
- alter proportions
- modernize it
- replace it with generated approximations

This especially applies to Kingdom Steppa artwork and the canonical character reference.

---

## 60. Intended player reaction

The desired sequence is:

> **“Wait… I'm walking inside a drawing.”**

Then:

> **“The drawing is reacting to me.”**

Then:

> **“The world is becoming more complete because I'm exploring it.”**

That sequence is the product.

---

## 61. Final Codex commandment

When multiple technically valid approaches exist, prefer the approach that strengthens:

- handmade quality
- humanity
- expressiveness
- cultural specificity
- responsiveness
- illustrative coherence
- discoverability
- performance

Never sacrifice usability for an artistic gimmick.

Never sacrifice the art direction merely because conventional game rendering is easier.

**The technical architecture exists to make the artwork interactive, not the other way around.**

---

# Existing Uprise World behavior to preserve until audited

The current implementation already contains useful technical skeleton work and must not be casually discarded.

Known working concepts include:

- Three.js/WebGL renderer
- spherical walkable planet
- spherical gravity / tangent movement
- third-person camera
- keyboard movement
- touch/coarse-pointer virtual joystick
- four data-driven landmarks
- proximity check-ins
- document-card callback behavior
- WebGL feature detection
- non-WebGL document fallback
- `data/uprise-world.json` driven landmark data

The redesign should treat this as **prototype locomotion and interaction infrastructure**. Visual production has not reached the Living Sketch standard.

---

# Initial Codex task

When this Bible is first introduced, do not immediately implement.

Use this task:

> Read `AGENTS.md` and this file completely. Audit the current Uprise World implementation against the Living Sketch requirements. Do not modify application code. Identify the current stack, renderer, asset pipeline, input system, landmark data flow, UI, fallback behavior, performance assumptions, and deployment configuration. Identify what should be preserved, what conflicts with the Bible, and what is missing. Then propose the smallest viable architecture for the Visual Proof Room. Explicitly list files to create, modify, preserve, or eventually deprecate. Do not begin implementation until the audit is complete.

---

# Reference assets

Canonical visual references belong under:

`docs/uprise-world/references/`

Expected reference categories:

- `character/` — approved protagonist portrait and likeness photos
- `wardrobe/` — approved Kingdom Steppa hoodie/jogger references
- `emblems/` — exact supplied logo/emblem artwork
- `style/` — approved Living Sketch rendering-technique examples. ⛔ **ART STYLE ONLY — NOT A CHARACTER REFERENCE.** The person drawn in these panels is not McCluster, not the protagonist, and not any NPC. Take ink/graphite/wash/paper technique from here; take face, hair, skin tone, beard, build, clothing, or identity from here **never**. Read `docs/uprise-world/references/style/README.md` first.

Do not infer canonical art from filenames alone. Read `docs/uprise-world/references/README.md` for asset roles and priority.
