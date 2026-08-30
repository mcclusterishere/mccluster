# HERE Blackened Steel v2

Production structural material for the current McCluster / HERE app reskin.

This is not a new component library. It is the skin for existing structural UI:
navigation shells, button housings, player frames, borders, controls and rails.

## v2 improvements

- darker and more restrained than v1
- directional brushed-metal microstructure
- dedicated grazing-light mask for scroll/pointer lighting
- anisotropy helper map for realistic brushed reflections
- sparse scratch channel
- selective Ruby Core reflection mask
- selector map tied to the existing HERE app
- CSS fallback and realtime shader contract

## Core behavior

At rest the steel should read almost black.

Its metallic nature is revealed by grazing light, scrolling, pointer movement, device
orientation (where appropriate), and environment reflections. Do not brighten the whole
object or make the interface silver.

## Reskin boundary

Keep existing component geometry and interactions intact. Apply this material to the
structure that already exists.

2048×2048 seamless/tileable.