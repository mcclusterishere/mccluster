# Renderer Research Snapshot — 2026-09-12

## CesiumJS

Primary implementation candidate. Current official material describes CesiumJS as an open-source JavaScript library for high-precision WGS84 3D globes/maps with 3D Tiles interoperability and desktop/mobile web support. Current release line observed during research: 1.145 (2026-09-01).

## MapLibre GL JS

Strong secondary map/tactical view candidate. Current official docs show browser vector-tile rendering and released globe projection support. Use where stylized map presentation or vector styling is preferable to full globe/terrain behavior.

## deck.gl GlobeView

Useful data-layer ecosystem, but current official docs still label GlobeView experimental and document limitations including high-zoom precision and terrain/layer support. Do not use as primary canonical globe without a later benchmark overturning this decision.

## Decision

Spike CesiumJS behind `HaloRenderer`, benchmark mobile/iPad performance and desired Hitman's Halo aesthetic, and retain MapLibre as an alternate/tactical renderer. No campaign/canon code may depend directly on either implementation.
