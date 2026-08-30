# HERE Obsidian Surface v2

Production skin material for the current McCluster / HERE app.

This is not a redesign component. It is a surface material intended to replace flat black
where the existing interface already has black structure.

## What changed from v1

- darker, more restrained stone
- less obvious "white marble" veining
- dedicated `scroll-light-mask` for cinematic light travel
- dedicated `clearcoat-mask` for polished response
- sparser `ruby-vein-mask` so ruby does not take over
- selector mapping for the current repo
- DOM/CSS skin starter
- shader contract for higher-fidelity WebGL/WebGPU treatment

## Core behavior

The stone does not pulse.

Light moves across the surface because the virtual lighting/viewing relationship changes.
Ruby appears only inside the dedicated ruby vein channel when a current interaction already
has a red/active-state reason to exist.

## Reskin rule

If applying this material requires changing section order, card geometry, navigation,
content structure, or media hierarchy, stop. That is no longer a reskin.

2048×2048 seamless/tileable.