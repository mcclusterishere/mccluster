# HERE Signature Mark v1

Semantic SVG master designed to bridge the HERE 2D UI and future physical 3D interface.

## Files
- `here-signature-mark.svg` — canonical layered master
- `here-signature-mark-ruby-mask.svg` — ruby-only animation mask
- `here-signature-mark-specular-mask.svg` — highlight-only mask
- `here-signature-mark.manifest.json` — material bindings and extrusion guidance

## Material bindings
- chassis -> HERE Blackened Steel
- ruby inlay -> HERE Ruby Core
- highlight/specular -> HERE Chrome Edge

The SVG contains named groups (`chassis`, `ruby-inlay`, `specular`, `engraving`) so
Claude can target channels independently. Do not flatten the SVG before implementation.

For 3D, extrude chassis and ruby inlay as separate meshes. The ruby should sit physically
inside/recessed into the steel rather than being a red decal.
