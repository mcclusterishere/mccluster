# Halo object rendering — 24 October 2026

Owner priority: verify visual/interaction parity before expanding data families.
Reference: bilawalsidhu/gods-eye-view at 9d3548c27c2cd4bf80ea39cbb3f0634ab1c5a06b,
particularly src/layers/flights/rendering.js, modelSpec.js and policy.js, and
src/layers/satellites/rendering.js, tracking.js and policy.js.

The reference uses distance-dependent representations, not full-resolution
models for every item at every zoom. Its satellites also use point primitives
for the distant fleet. Halo must make each object identifiable, selectable and
inspectable without burying the scene or exhausting the device.

## This change

- Aircraft: heading-aligned silhouettes at distance, nearby 3D geometry and a
  close inspection camera. The available canonical feed lacks verified aircraft
  classes, so the 747 asset is explicitly representative, never an airframe ID.
- Satellites: recognizable solar-panel symbols, nearby schematic 3D objects,
  per-frame propagation of the inspected object, orbit preview and follow.
  Shape and attitude remain illustrative; position is SGP4 calculated.
- Orbit preview: propagate one orbit in a fixed epoch frame, then rotate the
  baked primitive with GMST instead of rebuilding its geometry every second.
- Aircraft and satellite display counts are separate. Controls state shown and
  loaded counts. Selection remains inside the budget. No slider invents records
  beyond the current provider response (currently up to 5,000 flights/240 sats).
- Nearby model budgets: 24 aircraft and 12 satellites. Visibility/horizon and
  distance admission every 500 ms; no per-frame fleet reconstruction.
- Follow/Orbit actions retain the inspected object and its orbit when the card
  closes. Reduced-motion disables automatic orbit. Manual inspection remains.
- Role loss destroys model entities, credits and frame listeners through Halo's
  existing unmount path. No public feed or new authentication surface.

## Evidence required before calling this a visual improvement

1. Inspect actual rendered aircraft and satellite screenshots at 390, 820 and
   1280 pixels. Entity counts alone do not prove a model decoded or looks good.
2. Verify selection, Follow, Orbit, Home, density, model toggle and role loss.
3. Verify narrow-screen panel access and no document horizontal overflow.
4. Record frame timing/device/browser and model count. No claim to outperform
   God's Eye View without running both against comparable data and hardware.

## Still outside this increment

Verified aircraft-class models, cockpit view, observed historical trails,
constellation filtering/expanded satellite catalogs, all other data-family
renderers, and full visual parity. Air-quality expansion remains in draft #614.
This document is a release acceptance record, not a set of fake live layers.
