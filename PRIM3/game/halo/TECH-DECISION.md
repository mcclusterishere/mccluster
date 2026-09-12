# PRIM3 Halo Globe Technology Decision

Decision status: proposed for implementation spike, not yet locked as irreversible dependency.

## Primary candidate: CesiumJS

Use CesiumJS as the first implementation candidate for the planet-scale mission selector. The game requires a true 3D Earth, precise coordinates, continent-to-continent camera flights, terrain/3D extensibility, and future 3D facility/world overlays. CesiumJS is open source and built specifically around a high-precision WGS84 globe and 3D geospatial visualization.

## Secondary tactical/map candidate: MapLibre GL JS

Use MapLibre GL JS where a stylized 2D/2.5D briefing/tactical map is more appropriate. Its web renderer supports globe projection, vector-tile styling, and camera control while remaining open source.

## Not primary today: deck.gl GlobeView

deck.gl remains useful for data layers, but its GlobeView is explicitly documented as experimental and has limitations around high zoom precision, terrain, and several layer classes. Do not anchor the canonical mission globe on an experimental surface when more mature globe options exist.

## Abstraction

All game code consumes a Halo renderer interface rather than Cesium-specific objects directly. Minimum interface:

- setWorldView
- flyToRegion
- addMissionMarker / updateMissionMarker / removeMissionMarker
- setLayerVisibility
- renderDeploymentArc
- focusMission
- setSelection
- destroy

This lets us benchmark or replace the underlying renderer later without rewriting campaign/canon state.
