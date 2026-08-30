# HERE Material System 2.0 — Production Skin

Six materials, installed as delivered, with their READMEs, selector
maps, shader contracts and CSS fallbacks kept beside the files.

    blackened-steel/    structural chassis
    precision-chrome/   rims, hairlines, edge catches
    obsidian-surface/   flat black replaced with stone
    ruby-glass/         semantic active state
    smoked-glass/       floating UI over media
    optical-film/       a coating on artwork that already exists

## What this is, and what it replaced

The first delivery was a component library: a signature mark and five
SVG chassis (control button, module tile, nav rail, credential plate,
ruby power line), plus v1 materials. All of it is gone, on the owner's
call, because these packs are a different proposition and say so:

> This is not a new component library. It is the skin for existing
> structural UI.
>
> Keep existing component geometry and interactions intact. Apply this
> material to the structure that already exists.

Removed with it: `js/here-industrial.js`, `css/here-industrial.css`,
`lab-industrial.html`, `js/signature.js`, `css/signature.css`, and the
signature mark that was signing the front page footer.

## The implementation

`css/here-material.css` and `js/here-material.js`, on every page that
carries the app bar.

**Nothing in the stylesheet sets a layout property.** No width, height,
padding, margin, position offset, display, flex or grid on any existing
component. Every rule is a surface. Verified by measuring the app bar,
a tab, the sound toggle, a button and the finale band with the skin
loaded and with it blocked: identical to the hundredth of a pixel.

`js/here-material.js` does one thing. Every shader contract says *"the
reflection moves; the metal surface does not pulse"*, so the script
drives a single custom property, `--here-light-angle`, from scroll
position and pointer, committed once per animation frame on `:root`.
Nothing animates a base colour. Reduced motion leaves the angle at its
CSS default, so the material still reads at a fixed grazing angle
instead of disappearing.

## Judgement calls worth knowing about

**The selector maps were written against a different repository.**
`"source": "McCluster-Portfolio current interface"`. Roughly half the
selectors have no element here: `.sp__head`, `.sp__bill`, `.sp__pills`,
`.sp__rtile`, `.spc__art`, `.spc__prog`, `.now__ctl`, `.now__pp`,
`.now__ic`, `.now__like`, `.now__scrub`, `.mini__like`,
`.wantsite__btn`, `.wantsite__spark`, `.wantsite__pulse`, and
`.site-head`, `.mini` and `.head-cta`, which appear only in stylesheets
here and never as elements. Those are skipped rather than guessed at.

What is mapped **and** real: `.appbar`, `.appbar__tab`, `.btn`,
`.sound-toggle`, `.sound-toggle__dot`, `.float-pause`,
`.scroll-progress`, `.hero__line--accent`, `.now__head`, `.services`,
`.finale`.

**`.float-pause` is mapped for Blackened Steel and does not take it.**
In this repo that control is `background: var(--ruby)` — it is the ruby
pause button and its colour is its meaning. Putting a structural
material on a semantic accent is the one thing every pack warns
against, so it keeps its ruby and takes the chrome rim only.

**The coat.** Every material here is dark; the system assumes an ink
interface. On the bone coat a blackened-steel button is a black slab on
paper, so the skin is scoped to the dark coat and daylight keeps the
flat treatment it already had.

## Weight

The packs are shader masters at 2048 square and total 35MB. The CSS
path alone references 8.7MB of PNG, which is not a skin, it is a
download. Every `url()` in `css/here-material.css` points at a 1024
WebP generated beside its master: **8.7MB becomes 0.34MB**. The masters
are untouched and are what the realtime shader path will read when the
3D work happens.

| map | PNG | WebP |
| --- | --- | --- |
| steel brush mask | 2.9 MB | 173 KB |
| steel base colour | 906 KB | 4 KB |
| chrome edge glint | 715 KB | 33 KB |
| ruby emissive | 585 KB | 33 KB |
| obsidian base | 739 KB | 11 KB |

Regenerate with the snippet in the commit that added them if a pack is
ever updated.

## Not yet wired

The full PBR sets — normal, roughness, metallic, AO, height,
anisotropy, transmission, thickness, clearcoat, dispersion — are for
the realtime path described in each `SHADER_CONTRACT.txt`. The Equity
Uprise world (`js/uprise-*.js`) is the only three.js surface in the
repo and is where that work belongs.
