# UPRISE WORLD — VISUAL PROOF ROOM SPECIFICATION

Version 1.0

## Canonical wardrobe placement — non-negotiable

The player character must use the approved McCluster likeness and the approved Living Sketch visual language. Clothing graphics are not decorative suggestions; they are fixed canonical placements and must not be moved, substituted, redrawn, renamed, or approximated.

- **Front chest of hoodie:** approved **KINGDOM STEPPER** emblem.
- **Back of hoodie:** approved **HM + AMMO bullet + halo** composition. The bullet must sit vertically in the center between the H and M exactly as approved. No extra artifacts, symbols, text, or decorative substitutions may be added.
- **One sleeve:** approved **WARROOM sword** graphic, running vertically along the sleeve.
- **Opposite sleeve:** approved **SEEK FIRST** vertical text with the approved **drone icon above it**.
- **Front lower area of hoodie:** approved **33 target/circle mark**.
- **Front of pants/joggers:** approved **33 target/circle mark**.
- **Footwear:** neutral/white sneakers unless a later approved reference supersedes them.

The source graphics in `docs/uprise-world/references/` are the visual source of truth. Do not regenerate these marks from text descriptions when exact reference art exists.

## 1. Purpose

The Visual Proof Room is a deliberately tiny, isolated playable scene used to prove that Uprise World’s Living Sketch art direction works technically, visually, interactively, and performantly before production expands.

It is not a demo of the whole game. It is not a miniature Bridgeport. It is not a content showcase. It is a rendering laboratory.

The Proof Room must answer one question:

> Can Codex make a walkable browser-based 3D environment genuinely look like the approved Living Sketch artwork while remaining responsive on tablet hardware?

If the answer is no, the world does not expand.

## 2. Non-Negotiable Scope

The room contains exactly:

- one player character
- one short street/path
- one building
- one tree
- one parked vehicle
- one interactive document/object
- one environmental landmark/sign
- one discovery interaction
- one hand-drawn annotation sequence
- one example of illustration LOD
- one example of the world drawing itself into existence

No NPC system. No combat. No quests. No inventory. No procedural city. No giant map. No multiple districts. No production narrative content. No world expansion.

The small scope is intentional.

## 3. Scene Concept

The Proof Room should feel like a single sketchbook spread that became three-dimensional.

The player begins on an incomplete urban street. The environment initially contains large areas of white paper. Some distant forms exist only as graphite construction lines.

Ahead is one small building. Near the building:

- a tree
- a parked vehicle
- an electrical/utility element
- one piece of narrative evidence

The player walks toward the building.

As distance closes:

**graphite → ink → watercolor → detail**

The environment visibly becomes more complete.

When the player reaches the interactive object, a red editorial annotation appears. The interaction reveals a document/artifact. That completed object remains visually more finished afterward.

That single sequence proves the entire visual language.

## 4. Environment Layout

The room should be physically small.

Target walk time from spawn to main interaction: **10–20 seconds**.

Approximate conceptual footprint: **20 m × 30 m**.

Do not obsess over literal scale if stylization benefits from exaggeration.

Suggested layout:

```text
               FAINT BUILDING SILHOUETTES
                  GRAPHITE ONLY
                        ↑
              [ MAIN BUILDING ]
                 [ DOCUMENT ]
          TREE                     VEHICLE
-------------------------------------------------
                SHORT STREET
-------------------------------------------------
                    PLAYER
                    SPAWN
```

The player should understand where to move without a conventional waypoint. Composition itself should guide them.

## 5. Spawn View

The first frame is extremely important.

When the scene loads, the player sees:

- their character in foreground
- white-paper sky/background
- gray wash underneath/behind nearby forms
- one partially drawn building ahead
- tree silhouette
- vehicle silhouette
- faint red annotation hints
- visible blank paper between objects

The frame should immediately communicate:

> “This is not a normal 3D game.”

If the first screenshot looks like Three.js with outlines, the Proof Room has failed.

## 6. Player Character

The canonical player reference is:

`docs/uprise-world/references/character/mccluster-character-likeness-sheet-approved.png`

The character must preserve:

- recognizable facial structure
- twist silhouette
- mustache/goatee
- natural body proportions
- casual posture
- approved Living Sketch rendering language

Canonical clothing:

- washed-blue hoodie
- light-blue joggers
- neutral/white sneakers
- exact approved emblems in their fixed placements

The exact Kingdom Stepper artwork must use:

`docs/uprise-world/references/emblems/kingdom-stepper-approved.png`

Do not regenerate the logo.

## 7. Character Visual Treatment

The character must not look like a normal 3D model with an outline filter.

Required qualities:

- broken black contour lines
- unequal line thickness
- sketch overlaps
- watercolor/marker blue fills
- paper-colored gaps inside surfaces
- charcoal gray folds/shadows
- irregular pigment coverage
- subtle graphite construction traces
- selective facial detail

At gameplay distance, the face should remain recognizable without becoming photorealistic. The silhouette matters more than pore-level detail.

## 8. Character Idle Animation

Required idle behaviors:

- subtle weight shift
- shoulder relaxation
- occasional head turn
- light hoodie/sleeve adjustment
- one small glance downward

No exaggerated game idle. No heroic chest-out stance. The character should look like somebody naturally standing in place.

## 9. Character Movement

Movement should be smooth and responsive.

Visual stylization may affect:

- loose ink vibration
- slight hand-drawn trailing marks
- subtle watercolor wobble
- tiny ground gesture marks

Movement mechanics themselves should not feel sloppy. Animation stylization must never create input latency.

## 10. Camera

Use third-person camera.

Target:

- moderately close
- slightly low/neutral perspective
- player occupies meaningful screen space
- enough environment visible to read composition

Avoid excessive fisheye, heavy motion blur, aggressive camera bob, extreme depth-of-field, and cinematic lens effects.

The camera should feel like someone walking through an illustration.

## 11. The Street

The street is the primary ground test.

It should be built visually from:

- off-white paper
- broad gray watercolor wash
- charcoal strokes
- incomplete black perspective lines
- sparse cracks
- dry-brush marks

The road does not need to be fully filled. White paper should show through. Road edges can partially disappear.

## 12. The Building

The building is the primary environment-quality test.

It should be simple enough that the renderer—not architectural modeling—carries the style.

Suggested type: small storefront / civic office / neighborhood building.

Required visual components:

- recognizable silhouette
- doorway
- several windows
- sign
- roofline
- one distinctive structural feature

Avoid architectural over-detailing.

## 13. Building Illustration Stages

The building must support at least four visible states.

### State A — Ghost

At maximum distance:

- faint graphite
- incomplete silhouette
- almost no color
- significant transparency/paper

### State B — Ink

As the player approaches:

- contour strengthens
- windows become visible
- roofline resolves
- entrance gains shape

### State C — Wash

Closer:

- watercolor fills appear
- selective saturation emerges
- shadows become charcoal masses

### State D — Annotated

After interaction:

- detail resolves
- red editorial marks appear
- relevant annotation remains persistent

Transitions should take approximately **0.5–2.0 seconds**, depending on movement. Do not make the transition feel like a UI animation.

## 14. Tree

The tree tests organic forms.

Do not use realistic foliage.

Tree construction:

- loose trunk lines
- minimal branch geometry
- translucent green/blue wash clusters
- incomplete ink edges
- visible paper gaps

Leaves should read as brush masses rather than individual geometry.

## 15. Vehicle

The vehicle tests manufactured objects.

Use a simple parked sedan or van.

Required:

- recognizable silhouette
- wheels
- windshield
- selected structural lines
- minimal color wash
- incomplete shading

No glossy reflections. No realistic clearcoat. No photoreal wheel geometry.

The vehicle should look like it was sketched quickly but accurately enough to identify.

## 16. Utility/Street Prop

Include exactly one small environmental prop such as:

- streetlight
- utility pole
- bench
- mailbox
- fire hydrant

This tests reusable environment-kit language. Keep it visually simple.

## 17. Interactive Object

Include one interactive artifact near the building.

Preferred: a loose paper/document pinned, taped, or placed near the doorway.

At distance it should be nearly invisible.

As the player nears it:

- outline appears
- paper texture resolves
- a small red circle or arrow is drawn around it

Do not use a floating glowing icon.

## 18. Interaction Language

When the player enters interaction range, a rough red annotation appears.

Examples:

- hand-drawn circle
- arrow
- underline
- short handwritten note

Functional prompt may still be readable, e.g. **TAP TO READ**, but it should be visually integrated.

No RPG-style “Press E” floating badge unless necessary for accessibility.

## 19. Document Opening

The document should not open as a generic modal.

It should appear like a physical object added to the page.

Preferred treatment:

- document floats/slides into view
- slightly rotated
- taped/pinned appearance
- paper shadow
- handwritten annotation
- clear close control

Real document imagery can remain photographic/scanned. Do not convert it into fake watercolor.

## 20. Discovery Sequence

The interaction should prove persistent visual change.

Example:

1. Player approaches artifact.
2. Red circle draws itself.
3. Player opens document.
4. Document is read/closed.
5. Building gains one additional level of visual completion.
6. Red note remains beside it.
7. World remembers that discovery for the session.

Optional persistent storage can come later.

## 21. Signature “World Draws Itself” Test

This is the most important technical demonstration.

At least one environment object must visibly transition:

**graphite → ink → color wash → completed annotated state**

The transition must not rely purely on opacity fades.

Where feasible, use combinations of:

- line reveal
- texture reveal
- material-state blending
- progressive stroke appearance

The player should feel as if an illustrator is finishing the drawing.

## 22. Illustration LOD Test

Proof Room must visibly demonstrate artistic distance scaling.

### Far

- graphite dominant
- low saturation
- thin lines
- low detail

### Medium

- ink dominant
- some wash
- recognizable form

### Near

- strongest detail
- full approved watercolor/marker treatment
- selective annotations

Codex should capture screenshots from all three positions.

## 23. Paper Substrate

Background and incomplete areas must use a consistent sketchbook-paper treatment.

Target:

- warm white
- subtle fiber/noise
- no yellow vintage effect
- no grunge
- no fake ripped edges

Paper must remain visible through environmental rendering.

## 24. Charcoal Grounding

Objects must not feel like cutout stickers floating in white space.

Use gray grounding marks under:

- player
- tree
- vehicle
- building
- props

Marks should be irregular and may look like charcoal smudge, dry gray marker, graphite shading, or loose watercolor pool.

## 25. Red Annotation System

Use one red editorial accent. Do not saturate the scene with red.

Proof Room must demonstrate:

- one directional annotation
- one discovery circle
- one persistent note/mark

Red should appear hand-rendered.

## 26. Lighting

Lighting should be intentionally simple.

Use broad soft lighting.

Goals:

- preserve form
- prevent muddy colors
- maintain white paper
- keep readable silhouette

Do not rely on advanced PBR as the visual identity.

## 27. Materials Required

Proof Room should implement or prototype:

- PaperMaterial
- GraphiteMaterial
- InkMaterial
- WatercolorMaterial
- CharcoalMaterial
- AnnotationMaterial

Not every final production feature needs to be solved, but the room must prove these six material families are viable.

## 28. Asset Pipeline

Codex should prefer:

- simple authored geometry
- light GLB assets
- reusable low-complexity models
- texture atlases where useful
- compressed textures
- procedural assist only where visually controlled

Do not spend significant time modeling highly detailed objects. The renderer should create the richness.

## 29. Performance Target

Primary development target: **modern iPad/tablet browser**.

Desired:

- 60 FPS target
- 45+ FPS acceptable sustained range
- 30 FPS absolute floor during normal interaction

If a visual effect consistently pushes gameplay below 30 FPS, remove or simplify it.

Use adaptive:

- DPR
- shadow quality
- texture resolution
- line density
- annotation density

Desktop quality can scale upward.

## 30. Loading

Proof Room should load quickly.

Target first-interactive: **<5 seconds on good broadband** after cold load when feasible.

No gigantic model downloads. No giant texture bundles.

Do not optimize prematurely at the expense of proving the art system, but flag obviously excessive assets.

## 31. Touch Controls

Because tablet is a primary target, Proof Room must support:

- touch movement
- touch camera look
- tap interaction
- no hover dependency

Existing joystick behavior may be reused initially if functional.

Do not redesign controls before the visual proof is validated unless current controls materially prevent testing.

## 32. Desktop Controls

For development/testing:

- WASD/arrows
- mouse camera
- click interaction

Desktop testing exists to help iteration. Tablet remains the real target.

## 33. Reduced Motion

Provide a basic reduced-motion mode.

Disable or reduce:

- line jitter
- draw-in animation intensity
- camera easing
- gesture trails

The scene should still look correct statically.

## 34. Screenshot Acceptance Set

Codex must capture at minimum:

### Shot A — Spawn
Shows complete composition.

### Shot B — Far Building
Shows graphite state.

### Shot C — Medium Building
Shows ink transition.

### Shot D — Near Building
Shows watercolor/detail.

### Shot E — Interaction
Shows document + red annotation.

### Shot F — Completed Discovery
Shows persistent altered world state.

### Shot G — Character Close View
Shows likeness and clothing treatment.

No phase is complete without these screenshots.

## 35. Visual Acceptance Criteria

### Character

- Does the character resemble the approved likeness?
- Does the hair silhouette match?
- Does the hoodie read correctly?
- Are all canonical graphics in the correct fixed placements?
- Does the figure look illustrated rather than rendered?

### Environment

- Does the world look drawn?
- Is paper visible?
- Are edges incomplete?
- Is detail selective?
- Do objects share the character’s visual language?

### Rendering

- Is there obvious PBR gloss?
- Does anything look like a stock Three.js asset?
- Does the style collapse when the camera moves?
- Are outlines too clean or uniform?

### Interaction

- Does annotation feel hand-drawn?
- Does discovery visually change the world?
- Does the document feel physically embedded into the sketchbook?

## 36. Automatic Failure Conditions

Proof Room fails immediately if:

- player looks like a standard 3D avatar with shader outlines
- building looks like a normal game building with watercolor texture
- environment is fully filled with color
- white paper disappears
- outlines are perfectly uniform
- any logo/emblem is regenerated incorrectly
- HM/AMMO back mark contains extra artifacts or incorrect geometry
- WARROOM sword is missing or on the wrong sleeve
- SEEK FIRST + drone is missing or on the wrong sleeve
- either required 33 mark is missing
- Kingdom Stepper is missing from the front chest
- conventional glowing quest markers appear
- visual treatment exists only as fullscreen postprocessing
- tablet performance routinely falls below 30 FPS
- Codex expands the world before visual approval

## 37. Technical Acceptance Criteria

Proof Room must:

- compile cleanly
- introduce no critical console errors
- preserve existing WebGL fallback
- preserve existing routing/navigation
- avoid breaking current Uprise World
- work with touch
- support basic desktop navigation
- maintain acceptable memory use
- survive resize/orientation changes

## 38. Development Branch

All work should remain on the existing Uprise World branch until explicitly approved.

Recommended continuation:

`codex/uprise-world-living-sketch`

Do not merge into production before approval.

## 39. Codex Implementation Sequence

Codex should implement in this exact order:

1. **Audit current renderer** — no code changes.
2. **Create isolated Proof Room route** — no current game replacement.
3. **Paper + graphite** — prove substrate and distant rendering.
4. **Ink** — prove contour system.
5. **Watercolor/marker** — prove material treatment.
6. **Character** — introduce canonical protagonist.
7. **Illustration LOD** — distance transitions.
8. **Interaction annotation** — red sketch-language UI.
9. **Document interaction** — physical artifact presentation.
10. **Persistent discovery state** — session-level visual change.
11. **Performance pass** — tablet.
12. **Screenshot evaluation** — no map expansion.

## 40. Codex Stop Conditions

Codex MUST stop and request review when:

- the first complete Proof Room rendering is available
- the character first becomes visible
- the illustration LOD works
- the document interaction is complete

Do not autonomously continue into full world implementation. Human approval is a formal gate.

## 41. Quality Philosophy

Do not measure success by:

- number of shaders
- number of files
- sophistication of architecture
- polygon count
- visual-effects complexity

Measure success by:

> Does it look like the approved character illustration became an explorable space?

That is the only meaningful test.

## 42. Final Success Definition

The Proof Room succeeds when a person who has never seen the code can watch ten seconds of gameplay and immediately understand:

> “I’m walking inside a hand-drawn sketchbook.”

And when paused at almost any normal gameplay moment, the frame looks intentionally illustrated rather than technically rendered.

Once that happens, we have earned the right to build the real Uprise World.

---

## First Codex handoff prompt

Read `AGENTS.md`, the Implementation Bible, Visual Reference Manifest, and this Proof Room Specification. Audit the current Uprise World implementation. **Do not modify application code.** Return a proposed Proof Room architecture and exact file plan first.
