# Plan — HITMAN Site 0 Facility: L1 + B Floor Plan Rendering Set (HM-branded)

## Objective
Produce an advanced architectural rendering set for the HITMAN facility (Site 0):
empty shell with walls, interior partitions, fixed equipment; easements/circulation for
4 traveler types (person, car, small plane, tank); entrances/exits; elevation changes;
Level 1 + Level B interconnection; multiple views incl. roof-cut cutaway.
Branding: HM bullet-halo mark (uploaded refs) everywhere. NO XCOM branding anywhere.

## Inputs
- /mnt/agents/temp/C522FA20-...png (dark chrome/red HM logo — primary brand ref)
- /mnt/agents/temp/6C3EBD66-...png (light HM logo — alt brand ref)

## Deliverables (image_generation plugin, 2K where wide)
1. L1 floor plan — top-down architectural, with circulation easements overlaid
2. B floor plan — top-down, aligned cores with L1, ramps/egress shown
3. Vertical section cutaway — roof cut off, L1+B stacked, elevation datum, ramps, scale figures
4. Axonometric 3D cutaway ("ant-farm" view style only, HM-branded) — interiors mapped,
   color-coded circulation per traveler type

## Style law (all four)
- Dark gunmetal/charcoal technical rendering, red neon accent lines (matches HM mark)
- HM bullet logo in title block / entry wall / watermark — every sheet
- Labels, legend, north arrow, scale bar, level datum markers (B / L1)
- Explicitly exclude: XCOM logos, XCOM text, XCOM UI chrome

## Validation
- Visual check each output: branding correct, no XCOM marks, 4 traveler types legible,
  L1/B vertical connections consistent across views
- Save to /mnt/agents/output/
