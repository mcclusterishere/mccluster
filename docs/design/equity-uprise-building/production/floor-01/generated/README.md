# Floor 01 Generated Deterministic Assets

This folder describes build outputs produced by `../build_equity_uprise_floor_01.py`.

## GLB binary

The canonical generated binary is:

`equity-uprise-floor-01-deterministic-v1.glb`

**The GLB binary is not currently committed to Git.** It is reproducibly generated from the committed Floor 1 production JSON + generator and is published by GitHub Actions as a downloadable workflow artifact.

Workflow:

`.github/workflows/equity-uprise-floor-01-3d.yml`

This avoids treating an opaque binary as the source of truth. The source of truth remains the written spec, plan basis, DXF/SVG, production JSON, and generator.

## Independent verification

`../verify_floor_01_scene.py` loads the generated GLB and checks canonical geometry.

Corrected deterministic v1 validation:

- **21 / 21 checks passed**
- exact 72' × 72' plan footprint within floating-point tolerance
- Stair B entirely inside **X0–12 / Y54–72**
- Stair A entirely inside **X60–72 / Y54–72**
- elevator aligned to **X54–62 / Y34–44**
- reception desk aligned to **X30–42 / Y44–47**
- directory aligned to **X49–51 / Y24–29**
- canonical camera centered at approximately **(36,28,5.333)**
- south public entrance jambs at **X29 / X43**
- validated GLB SHA-256: `06c8c45491866f504fb35857a1959db5cb8cf6d54b8e16cbe35d60e6ed5da78f`

See:

`equity-uprise-floor-01-deterministic-v1-report.json`

## Important

An earlier validation pass exposed a 4.5-inch stair-wall protrusion caused by centering wall thickness on Y=54. The verifier caught it, the generator was corrected, and the rebuilt GLB now keeps both stair enclosures fully inside their locked rear/north envelopes.

That is the purpose of deterministic verification: errors must fail visibly instead of being hidden by renders.

## Authority

Generated assets are downstream of:

written Floor 1 spec → schematic basis → canonical DXF/SVG → production JSON package → generator → GLB.

They are **not construction/BIM authority**.
