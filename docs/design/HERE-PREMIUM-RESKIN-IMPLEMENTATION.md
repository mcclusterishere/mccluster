# HERE Premium Reskin Implementation

## Read this before touching the visual design

This document is the visual execution contract for the current HERE site in this repository.

**This is a reskin and asset-quality pass. It is NOT permission to redesign the site.**

The current HERE UI, section order, responsive behavior, copy hierarchy, album/media structure, interactions, routes, controls, scroll choreography, and general composition are the source of truth. The owner likes the existing design and does not want it replaced by a new dashboard, sci-fi control room, generic app template, or a collection of newly invented industrial modules.

The job is to make the UI that is already here look much more premium.

The intended result is:

> Same HERE screen. Same composition. Better surfaces. Better icons. Better physical depth. Better light. Better button response. Better material-aware animation.

Not:

> A new screen inspired by HERE.

---

# 1. Current UI is the geometry source of truth

Before implementation, inspect the existing code itself, including at minimum:

- `index.html`
- `css/style.css`
- current album/media pages
- current navigation and player code
- current 360/VR controls where present
- current PWA/mobile behavior

The existing site already contains real visual structures that must be SKINNED rather than replaced. Examples visible in the current source include:

- `.preloader`
- `.preloader__mark`
- `.scroll-progress`
- `.site-head`
- `.brand` / `.brand__mark`
- `.case`
- `.case__inner`
- `.case__seal`
- `.case__cta`
- `.wings`
- `.wings__row`
- `.wings__tab`
- `.wings__vid`
- `.wings__scrim`
- the existing app bar / navigation surfaces defined in `css/style.css`
- existing song/media/album controls

Do not replace these structures with newly invented cards, consoles, vaults, tokens, holographic panels, or other experimental component metaphors.

If the existing component already has the right size, position and function, keep that geometry and replace only its visual skin and internal visual assets.

---

# 2. Production material pack

Use the six production materials supplied by the owner.

## Material 1: HERE Obsidian Surface v2

Use for existing dark substrates that currently read as plain CSS black/brown.

Good targets:
- page substrate behind content
- selected existing section backing surfaces
- dark wells inside existing controls
- existing UI regions currently using `--ink` / `--ink-2` where texture will not compete with imagery

Do not cover video or photography with visible marble.

Animation rule:
- base stone stays stable
- light may move across normal/roughness information
- ruby may animate only through the provided ruby-vein mask
- never pulse the whole stone

## Material 2: HERE Blackened Steel v2

Use for structural UI that already exists:
- button housings
- nav shells
- existing rails
- borders
- control frames
- app bar chassis
- selected separators

The metal should look nearly black at rest. Its metallic nature is revealed by grazing reflections.

Do not turn the page into a gray metal dashboard.

## Material 3: HERE Ruby Glass v2

This replaces the current flat red styling where red already has meaning.

Current examples include:
- `--ruby`
- `--ruby-hot`
- `.scroll-progress span`
- active navigation
- progress states
- selected/playing states
- existing CTA accents
- existing sound/status accents

Ruby should feel embedded, refractive and internally lit.

Do not add full red panels or global neon glow.

## Material 4: HERE Smoked Glass v1

Use only where the current design already has floating/sticky UI over visual content.

Good targets:
- current sticky navigation backplates
- floating controls
- player overlays
- sheets/modals already present
- compact HUD-like overlays that already exist

This is NOT an instruction to introduce glass cards across the site.

## Material 5: HERE Precision Chrome v2

Use in tiny quantities:
- 1px-ish high-value edge catches
- rims
- control bevels
- icon hardware
- tiny separators
- brief specular passes

Chrome is not a surface theme. If an entire component reads silver, it is too much.

## Material 6: HERE Optical Film v1

Use to enhance existing media without changing it.

Good targets:
- existing hero video/canvas
- project photography
- album artwork
- existing video panels
- 360/VR media

The media remains the source of truth. Do not change crop, aspect ratio, object-fit, content order or color grade just to display the optical effect.

---

# 3. The actual design objective: premium asset replacement

The current site may keep its layout while replacing weak visual assets.

That means this reskin is allowed and encouraged to replace:
- generic SVG icons
- inconsistent icons
- cheap-looking play/pause symbols
- generic arrows/chevrons
- generic sound icons
- low-quality control marks
- flat progress graphics
- flat borders
- low-quality status dots

The semantic purpose and position must remain the same.

Example:

Current bottom navigation icon occupies a specific tab and goes to a specific destination.

Correct reskin:
- same tab
- same destination
- same label
- same hit target
- new custom HERE SVG icon
- icon has layered body/edge/ruby/highlight groups
- selected state activates the ruby sublayer

Incorrect redesign:
- replace the bottom navigation with a new rail
- change destinations
- add a center token/orb
- add new labels
- move the control elsewhere

---

# 4. Custom HERE icon family

Audit every visible user-facing icon in the existing interface before replacement.

The finished site should not look like several different icon libraries were mixed together.

Create a custom HERE SVG family with consistent:
- stroke weight
- corner radius language
- optical size
- negative space
- line endings
- proportions

Preferred SVG group naming when the icon can support layered animation:

```text
body
edge
ruby-channel
highlight
```

Examples to redraw one-to-one where currently present:
- Home
- play
- pause
- previous / next
- sound / mute
- heart / like
- menu
- chevron / down / back
- 360 / motion
- close
- account/profile
- search if present
- share if present
- any current tab/navigation pictograms

Do not invent new controls solely to show the icon set.

---

# 5. Layered texture animation architecture

This is non-negotiable.

The owner specifically wants animation to happen INSIDE material layers so a control looks physically advanced.

Do not treat a button, icon or surface as one flat animated PNG.

## Example: existing button

Keep the current button's:
- location
- dimensions
- copy
- action
- hierarchy

Then skin that SAME button with independently addressable layers.

### Layer A — housing
Material: Blackened Steel v2

Behavior:
- remains structurally fixed
- brushing/roughness reacts to virtual light
- does not pulse

### Layer B — face/inset
Material: Obsidian v2 or Smoked Glass depending the current context

Behavior:
- moves inward approximately 1–3px on press
- returns with restrained inertia
- no toy scale bounce

### Layer C — ruby channel
Material: Ruby Glass v2

Behavior:
- dim/off at rest
- may wake on hover, active or pressed state
- internal energy may move through the supplied active/emissive mask
- the rest of the button does not glow red

### Layer D — chrome edge
Material: Precision Chrome v2

Behavior:
- narrow edge reflection
- responds to light angle
- compressed/diminished on the pressed side
- never continuously bright

### Layer E — icon
Material structure: custom SVG

Behavior:
- icon body remains stable
- `ruby-channel` may activate independently
- `highlight` may receive a quick specular pass

### Layer F — optical response
Use only where helpful.

Behavior:
- tiny reflection or light catch
- event-driven, not constant

---

# 6. How to use supplied texture maps correctly

If the texture pack contains a semantic map for the physical effect, animate that map instead of animating the whole element.

## Obsidian

Use:
- normal
- roughness
- scroll-light mask
- ruby-vein mask

Animation:
- virtual light moves across stone
- optional ruby energy moves only in ruby-vein mask

Wrong:
- whole marble panel brightens/dims

## Blackened Steel

Use:
- normal
- roughness
- brushing/anisotropy
- grazing-light mask
- ruby reflection mask when semantically active

Animation:
- environment/grazing highlight moves over brushing

Wrong:
- steel fades from black to gray on hover

## Ruby Glass

Use:
- transmission
- thickness
- facet/fresnel
- active mask
- emissive mask
- caustic/flare masks

Animation:
- illumination happens inside the ruby region
- small optical response follows viewing/light angle

Wrong:
- red box-shadow around the entire control

## Smoked Glass

Use:
- transmission
- reflection
- Fresnel
- readability mask

Animation:
- subtle reflection and optical density response
- ensure text remains legible over bright moving media

Wrong:
- all UI becomes generic frosted glass

## Precision Chrome

Use:
- grazing-light mask
- edge-glint mask
- roughness/normal

Animation:
- one narrow reflected glint moves across a rim/edge

Wrong:
- permanent silver gradient

## Optical Film

Use:
- reflection
- flare
- edge refraction
- optional very small dispersion

Animation:
- optical layer responds to light/viewpoint
- source media itself remains stable

Wrong:
- red tint, blur or distortion that harms the actual media

---

# 7. Specific mapping to the CURRENT HERE UI

## `.preloader`

Keep its layout and loading sequence.

Current source already has strong behavior including hot/blazing states.

Upgrade instead of replacing:
- dark substrate -> Obsidian
- mark edge -> tiny Chrome response
- red energy -> Ruby Glass internal treatment
- replace broad `drop-shadow` pulsing with material/sub-mask illumination where practical

Do not replace with a new 3D loader in this pass.

## `.preloader__mark` / `.brand__mark`

Keep the existing brand mark and placement.

The current CSS uses whole-mark brightness/drop-shadow animation (`markflash`). Replace that visual logic with layered treatment:
- stable mark body
- separate ruby/highlight layer if asset supports it
- controlled chrome/specular catch

Do NOT make the whole mark repeatedly flash brighter.

## `.scroll-progress`

Keep exact position and progress logic.

Replace the flat red gradient visually with a narrow Ruby Glass energy channel.

The progress calculation itself must not change.

## `.site-head`

Keep exact navigation structure and placement.

Suggested skin:
- Smoked Glass optical backplate where useful
- Blackened Steel structural edge/chassis only if the current dimensions remain unchanged
- Precision Chrome micro edge

No new navigation architecture.

## `.case`

Keep current full-media composition.

The background image/video remains dominant.

Use materials only on:
- `.case__seal`
- `.case__cta`
- existing text/backing areas if needed
- tiny edge/separator moments

Do not put the entire case into a giant industrial card.

## `.case__cta`

This is a good candidate for the layered button architecture.

Same CTA. Same size. Same placement.

Upgrade:
- Steel housing
- dark inset
- Ruby active channel
- Chrome edge
- custom arrow/glyph if currently generic

## `.wings`

Keep the existing three-door full-screen composition.

This is structurally important and must not be replaced with cards or tiles.

## `.wings__tab`

Keep:
- three-column behavior
- existing video/image content
- existing labels
- existing links
- responsive behavior

Upgrade only:
- current flat background -> restrained material substrate
- current border -> Steel/Chrome edge treatment
- current hover box-shadow -> material-aware ruby/reflection response
- current icon/image assets -> premium equivalents only if the semantic identity stays the same
- video -> Optical Film only where subtle

Do not turn each wing into a newly designed industrial module.

## App bar / mobile navigation

Keep current geometry, destinations, labels and behavior.

Upgrade:
- Blackened Steel chassis
- Smoked Glass optical layer if useful
- custom HERE SVG glyphs
- active glyph/tab gets Ruby Glass sublayer
- Precision Chrome only for tiny hardware edges

## Album/player/media controls

Keep playback behavior and control placement.

Upgrade:
- play/pause/skip/etc. icons to custom HERE SVG family
- Blackened Steel housings
- Ruby Glass progress and selected state
- Precision Chrome control rim
- Optical Film over album artwork

No new player layout.

## 360/VR controls

Keep the existing interaction model and input behavior.

Upgrade only the controls/icons/material surfaces.

Do not create a new portal, dashboard or navigation flow.

---

# 8. Existing animation audit: replace flat effects, not choreography

The current stylesheet already contains animation patterns such as:
- `markflash`
- `preHot`
- `loadQuake`
- `loadFlash`
- `zenBreath`
- `zenBoxDot`
- `zenDot`
- `zenSweep`
- `zenRing`

Do not blindly delete the interaction/story logic.

Classify each current effect:

### Keep choreography, improve rendering
Example: loading mark becomes more intense as loading progresses.

Keep the concept, but replace whole-object brightness/drop-shadow with independent ruby/specular material channels.

### Keep as-is
Mindfulness/breathing animations whose meaning depends on geometric expansion may remain geometric if they are already intentional and readable.

### Material-enhance
Hover/active/progress/control effects should prefer material-layer response over generic glow or whole-object brightness.

The reskin should not alter section timing or make the site harder to use.

---

# 9. CSS/DOM implementation pattern

Prefer a layered DOM/SVG composition over flattening everything into images.

Illustrative structure:

```html
<button class="existing-button here-material-control">
  <span class="hm-housing" aria-hidden="true"></span>
  <span class="hm-face" aria-hidden="true"></span>
  <span class="hm-ruby" aria-hidden="true"></span>
  <span class="hm-chrome" aria-hidden="true"></span>
  <svg class="hm-icon" ...>...</svg>
  <span class="hm-label">Existing label</span>
</button>
```

The existing button remains the semantic control. The visual layers are decorative.

CSS custom properties should carry shared lighting state, for example:

```css
--here-light-x
--here-light-y
--here-light-angle
--here-ruby-energy
--here-press-depth
```

One shared light-state controller is better than dozens of independent animation loops.

---

# 10. Performance rules

The premium look must remain usable on phone/tablet.

Baseline implementation:
- semantic HTML
- SVG
- CSS masks
- CSS backgrounds
- CSS custom properties

Use JavaScript only to feed meaningful shared state such as:
- pointer position
- scroll progress
- active state
- device orientation when permission is granted and it adds value

Use:
- `IntersectionObserver` to disable expensive off-screen effects
- throttled/requestAnimationFrame updates
- `prefers-reduced-motion`

Do not put the whole HERE site into WebGL.

Where the existing application already uses canvas/360/VR, material enhancement may use that existing rendering context when appropriate.

---

# 11. Stop conditions

Stop and request review before proceeding if implementation requires any of the following:

- changing section order
- replacing the current navigation architecture
- changing the `.wings` three-door composition
- changing player control placement
- changing route destinations
- introducing new primary UI metaphors
- putting media inside newly invented frames that alter the composition
- rewriting major page structure solely to support materials

Those are redesign decisions and are not authorized by this reskin brief.

---

# 12. Required implementation workflow

1. Capture/reference the current UI first.
2. Inventory current visible surfaces and icons.
3. Inventory current animation effects.
4. Map each CURRENT component to material layers.
5. Redraw generic icons one-to-one as a coherent HERE SVG family.
6. Apply the six materials to CURRENT geometry.
7. Convert flat hover/active effects to material-mask animation.
8. Test mobile and desktop.
9. Compare before/after at identical viewport sizes.
10. Reject any result that is not immediately recognizable as the same HERE design.

## Final acceptance statement

**Do not redesign HERE. Manufacture the design that is already there.**

The existing UI supplies the shape. The new assets supply the material, optics, icon quality and physical motion.
