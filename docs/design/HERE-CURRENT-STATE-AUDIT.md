# HERE Current-State Audit Before Premium Reskin

## Purpose

This document records the VERIFIED state of the `mcclusterishere/Here` repository before any further premium-material work. It exists so Claude does not design from memory, from an old mockup, or from the wrong repository.

## Verified repository state

- Repository: `mcclusterishere/Here`
- Default branch inspected: `main`
- Main HEAD at audit time: `1925bed87ba339706ba3b912da936eeb73ba9709`
- The current root `index.html` describes HERE as **the world for the I AM HERE album**, not as the McCluster Portfolio site. Its structured-data comment explicitly says: "This site is the album's world, not the portfolio."
- The repository contains a broader ecosystem around that album/product world, including `album.html`, `account.html`, `admin.html`, app/native work, films, licensing, client/business tooling, Uprise World, Prayer Closet, and related routes.

Do not import assumptions from `McCluster-Portfolio`. That is a different repository.

## Current visible architecture that must be preserved

The current HERE web shell already has its own geometry and interaction language. The premium-material pass must skin these existing structures one-to-one instead of replacing them.

Verified examples in current source include:

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
- the existing app bar / mobile navigation
- album/player controls
- sound controls
- existing media/film/360 surfaces

The three-door `.wings` composition is especially important. It is not permission to replace the page with a dashboard, a grid of industrial cards, a command center, or a new navigation model.

## Current visual behavior already in the stylesheet

The current `css/style.css` already contains a dark/ruby visual system and multiple animation patterns, including:

- `markflash`
- `preHot`
- `loadQuake`
- `loadFlash`
- mindfulness/breathing animations such as `zenBreath`, `zenBoxDot`, `zenDot`, `zenSweep`, and `zenRing`
- a ruby scroll-progress bar
- dark fixed/sticky chrome and app-bar surfaces

The premium pass should generally preserve the PURPOSE and timing of those interactions while replacing cheap whole-object glow/brightness effects with layered material behavior.

Example: if the brand mark currently flashes brighter, do not invent a new loader. Preserve the progression but move the visible energy into a ruby/emissive sublayer and a narrow chrome/specular catch while the base mark remains stable.

## Navigation baseline

Recent production history describes the persistent app bar as:

- Music
- Equity Uprise
- HERE
- Prayer Closet
- Profile

Preserve the current destinations, labels, tap behavior, hold/wing behavior, and routing unless the owner separately requests a product/navigation change.

A material pass may redraw the visible icons one-to-one and reskin the existing bar, but must not add a center orb, token, new destination, new rail geometry, or different information architecture.

## Historical design context that matters

The repository already went through substantial design and product changes before this new material pass. Do not assume current `main` is identical to the earliest HERE design.

### July 22: metallic-glass identity existed before this pass

Commit `80d1c0f665893412d5c5cf6ef0ed5c341323acde` introduced a site-wide metallic/glass treatment and a light/dark theme system. Its own commit record says the interface used album artwork under smoked glass, hard light streaks, lit edges, and metallic controls. That is evidence that premium material language is consistent with HERE's established identity rather than a reason to redesign the product.

### Native identity correction

Commit `f59531688db5df09a29275749aad4f2b39f6a546` explicitly rejected a generic native-app pass because it had dropped HERE's identity. Claude then went back to an earlier production source (`067cc59d5be86cab269a8c29431ce7112dcf80d0`) and restored the actual material cues: floating glass, metal controls, ambient room wash, album art, and HERE-specific hierarchy. That history is directly relevant now: premiumization must preserve HERE's own composition and identity.

### August 11 sales/product integration changed a lot

Main merged PR #21 at commit `0a8deec8da3e38c2e6ee822c0405ac5ad9d49d9d`. GitHub reports that merge as 2,307 changed lines across the merge result, with 309 additions and 1,998 deletions. The surrounding commits also consolidated track pages, changed the hire/booking split, removed a floating "Deal with me" pill, fixed the Vaunt/Antisocial transition, and changed some routing/copy.

Therefore, when judging whether the new material pass accidentally redesigns HERE, compare against BOTH:

1. the current `main` geometry and behavior, because that is what is shipping now; and
2. the earlier established HERE identity/material language, because history shows that generic redesigns have already been rejected once.

Do not blindly restore old markup. Use history as design evidence, not as an automatic rollback instruction.

## IMPORTANT: Claude's latest local material implementation is not yet visible on GitHub main

Claude reported that it created:

- `css/here-industrial.css`
- `js/here-industrial.js`

and mounted the uploaded material packs through attributes.

At the time of this audit, `css/here-industrial.css` returns 404 on GitHub `main`, and there is no newer industrial-material commit on the default branch after `1925bed87ba339706ba3b912da936eeb73ba9709`.

Therefore:

- do NOT claim those files are verified in the repository yet;
- do NOT write follow-up instructions that assume their exact implementation details;
- first push/commit Claude's current work to a branch, then inspect that branch and compare it against `main` and the historical source points above.

Once pushed, audit the actual diff before giving Claude further design instructions.

## Production material pack that is actually intended now

The current production skin is SIX materials, not the earlier experimental 20-item component list:

1. `HERE Obsidian Surface v2`
2. `HERE Blackened Steel v2`
3. `HERE Ruby Glass v2`
4. `HERE Smoked Glass v1`
5. `HERE Precision Chrome v2`
6. `HERE Optical Film v1`

These six are materials/optics, not new page components.

### What they do

- Obsidian: replaces selected dead-flat dark substrate while remaining mostly black.
- Blackened Steel: skins existing structural shells, button housings, rails, borders, and control frames.
- Ruby Glass: replaces existing semantic flat-red active/progress/status treatment with internal/refractive energy.
- Smoked Glass: skins existing floating/sticky overlays over media.
- Precision Chrome: tiny edge/rim/specular detail only.
- Optical Film: adds subtle optical depth/reflection/refraction to existing photography/video/album/360 media without changing the media composition.

## Icons are a separate premiumization task

The production six do not themselves replace iconography.

Audit current visible icons first, then redraw weak/generic icons one-to-one as a coherent HERE SVG family. The same semantic control must remain in the same place with the same action and hit target.

Preferred SVG groups for layered response:

- `body`
- `edge`
- `ruby-channel`
- `highlight`

The ruby/highlight groups may animate independently. The whole icon should not pulse unless the current interaction specifically requires whole-icon geometry to move.

## Material-aware animation rule

The owner wants animation embedded inside texture/material layers.

Correct examples:

- Blackened Steel base stays fixed; a grazing reflection moves across brushing/roughness.
- Obsidian base stays fixed; only the ruby-vein mask receives energy when semantically active.
- Ruby Glass receives internal emissive/transmission animation; the surrounding button does not glow red.
- Chrome catches a brief specular line; the entire control does not turn silver.
- Optical Film changes reflection/refraction with viewing/light state; the actual photo/video is not recolored or distorted aggressively.
- A button face may recess 1-3px while its outer housing stays fixed.

Wrong examples:

- whole-card pulsing
- whole-button red glow
- generic scale bounce
- giant industrial wrapper around existing media
- new dashboard panels to showcase the materials
- changing section order or navigation because a material asset suggests a new component

## Required audit after Claude pushes the first material pass

Before approving or expanding the material system, compare the pushed branch to `main` and answer:

1. Did section order change?
2. Did `.wings` geometry or behavior change?
3. Did app-bar destinations or behavior change?
4. Did media crop/object-fit/aspect ratio change?
5. Did copy hierarchy or route destinations change?
6. Were new wrappers/components inserted that materially alter spacing or layout?
7. Are the new materials mounted onto existing selectors, or did they create a new UI architecture?
8. Are animation layers independently addressable, or is Claude still pulsing whole elements?
9. Are icons being replaced one-to-one, or are new controls being invented?
10. Does the screen remain immediately recognizable as HERE?

If 1-6 changed without explicit owner approval, treat that as redesign drift and revert those structural changes while keeping any useful material-layer work.

## Acceptance statement

**The current HERE UI supplies the geometry. The six production materials, premium SVG icons, and layered animation system supply the finish.**

Do not redesign HERE to demonstrate the materials. Use the materials to make HERE look like a far more expensive version of itself.
