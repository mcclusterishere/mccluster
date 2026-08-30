# HERE Industrial Material Interface Architecture

## Current implementation boundary: RESKIN THE EXISTING HERE UI

Before making any visual change to the HERE portfolio / business-platform shell, read:

- `docs/design/HERE-PREMIUM-RESKIN-IMPLEMENTATION.md`

That document is now the detailed execution contract for the current material pass.

**Do not redesign the current HERE site.** The existing UI geometry, section order, responsive composition, routes, copy hierarchy, media placement, player behavior, scroll choreography, three-door `.wings` composition, and current navigation are the source of truth.

The industrial/material direction exists to improve the design that is already there, not replace it.

The correct goal is:

**same HERE design + custom premium icons + real material layers + material-aware animation.**

The incorrect goal is a new dashboard, control room, token system, vault UI, holographic interface, or newly invented collection of industrial cards.

## Scope

This document applies to the HERE portfolio / business-platform experience. It does **not** override the separate Uprise World renderer rules in `docs/uprise-world/` and must not be used as an excuse to alter Uprise World architecture, gameplay, or its sanctioned art direction.

## Production material system

The current production skin consists of six supplied material packs:

1. `HERE_OBSIDIAN_SURFACE_v2`
2. `HERE_BLACKENED_STEEL_v2`
3. `HERE_RUBY_GLASS_v2`
4. `HERE_SMOKED_GLASS_v1`
5. `HERE_PRECISION_CHROME_v2`
6. `HERE_OPTICAL_FILM_v1`

Use them on existing UI surfaces one-to-one according to `HERE-PREMIUM-RESKIN-IMPLEMENTATION.md`.

The previous experimental objects/components are not automatically authorized for this pass merely because they exist.

## Premium asset replacement

A reskin may replace generic-looking UI assets and icons while preserving their semantic role and position.

Examples:
- redraw the existing Home icon as a custom HERE SVG but keep the same tab and route
- redraw play/pause/sound/chevrons as a coherent HERE icon family but keep the same controls
- replace a flat red progress line with a Ruby Glass energy channel but keep the same progress behavior
- replace a generic border with Blackened Steel / Precision Chrome material response but keep the same component dimensions

Do not confuse preserving the UI with preserving weak stock-looking graphics.

## Hybrid asset architecture

Do not force every visual asset into one format.

### SVG

Use SVG for:
- logos and wordmarks
- interface symbols
- custom HERE glyphs
- vector masks
- engraving paths
- seams/rims/highlight paths that need independent animation

Group paths semantically where useful:
- `body`
- `edge`
- `ruby-channel`
- `highlight`

This lets only the intended visual sublayer animate.

### Raster/PBR maps

Use supplied PNG maps for material properties and semantic masks.

Texture-aware animation should target physical channels rather than the whole component.

Examples:
- Obsidian ruby veins illuminate; stone base remains stable
- Steel grazing reflection travels; steel base does not pulse
- Ruby emissive/active mask wakes; surrounding control remains dark
- Chrome edge catches a moving reflection; whole control does not turn silver
- Optical Film reflection moves; source photography/video is not recolored

### glTF / GLB

GLB/glTF is for contained physical objects where real 3D materially improves the experience. It is not required for ordinary buttons or navigation and must not trigger a structural redesign.

### Gaussian splats

Reserve splats for captured environments/scenes. Never use splats for ordinary UI controls.

### WebGL / WebGPU

Keep the primary product DOM-first. Use existing canvas/360/VR contexts where they already make sense and use isolated 3D only when it adds real value.

Do not move the whole interface into one canvas.

## Layered material control architecture

A premium control should be treated as multiple independently addressable visual layers while the original semantic HTML control remains intact.

Example stack:

1. fixed Blackened Steel housing
2. Obsidian or Smoked Glass face/inset
3. Ruby Glass active channel
4. Precision Chrome edge
5. custom SVG icon
6. optional optical/specular response

On press:
- face moves inward slightly
- ruby wakes inside its channel
- chrome reflection changes at the pressed edge
- housing remains fixed

Do not use generic whole-button scale-bounce as the primary physical effect.

## Motion language

Good:
- moving grazing reflection across metal
- internal ruby illumination
- light moving through a semantic texture mask
- shallow physical press/recess
- tiny specular travel across chrome
- optical reflection over existing media

Avoid:
- whole-card pulsing
- constant floating
- indiscriminate red glow
- fake permanent chrome gradients
- every element moving at once

The existing animation choreography should be preserved unless explicitly approved otherwise. Upgrade how an effect is rendered before changing when or where it happens.

## Current UI mapping rule

The current source already contains components such as `.preloader`, `.preloader__mark`, `.scroll-progress`, `.site-head`, `.case`, `.case__cta`, `.wings`, `.wings__tab`, app navigation, album/player controls and media surfaces.

Skin those components directly.

In particular:
- do not replace `.wings` with new cards
- do not redesign player control placement
- do not replace navigation with a new metaphor
- do not box media into newly invented industrial containers
- do not restructure the home page to showcase materials

## Performance and fallback rules

Industrial realism is not permission to wreck performance.

- lazy-load expensive visual resources
- pause expensive effects offscreen
- use one shared light/pointer state where practical
- honor `prefers-reduced-motion`
- maintain touch targets and keyboard accessibility
- preserve media playback and scroll performance
- disable subtle dispersion/refraction before reducing media quality
- keep phone/tablet first-class

## Required execution order

1. Inspect and capture the current UI.
2. Read `HERE-PREMIUM-RESKIN-IMPLEMENTATION.md`.
3. Inventory existing visible icons and controls.
4. Inventory existing animation effects.
5. Map the six production materials onto the existing geometry.
6. Redraw generic icons one-to-one into the HERE SVG family.
7. Apply layered material skins to existing controls.
8. Replace flat glow/brightness effects with mask-aware physical responses where appropriate.
9. Compare before/after at identical mobile and desktop viewports.
10. Roll back any change that makes the result look like a different product.

## Separation from Uprise World

Uprise World has its own sanctioned renderer and roadmap. This HERE material reskin does not authorize any crossover changes to Uprise World unless the owner explicitly approves them.

Never use this document to bypass Uprise World's Phase 0 gate, acceptance criteria, or current cel-shaded rendering decision.

## Final rule

**Do not redesign HERE. Manufacture the design that is already there.**
