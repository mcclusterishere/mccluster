# S477 Smart Church — project data room

This directory is the human-readable index for the S477 Smart Church / 477 Broad Street digital-twin project.

## Start here

- `../../smart-church.html` — public responsive Smart Church / digital-twin experience.
- `../../s477-lidar.html` — interactive browser LiDAR viewer with touch/mouse orbit, zoom and filtering.
- `../../data/s477-public.json` — public room/system model used by the website.
- `../../data/s477/dashboard.json` — visual dashboard facts, budget series and evidence status.
- `../../data/s477/sources.json` — authoritative and supporting source registry.
- `../../data/s477/site-baseline.json` — site facts with confidence/provenance labels.
- `../../data/s477/lidar/source-manifest.json` — official 2023 Connecticut LiDAR source manifest.
- `STAKEHOLDER-BRIEF.md` — fast orientation for faculty, engineers, vendors and sponsors.
- `MOBBIN-DESIGN-NOTES.md` — responsive product-design references and implementation rules.
- `records/` — copies of Building, Assessor, Zoning and GIS records requests.

## Data policy

Every factual value should carry one of four states:

1. **verified** — supported by an authoritative public record, measured dataset or accepted project inventory.
2. **reference-design** — a current engineering basis of design, not a claim that hardware is already installed.
3. **provisional** — useful working information that must be field-verified or replaced by authoritative geometry.
4. **open** — intentionally unknown until a survey, record response or licensed-trade review resolves it.

The public website may publish system quantities, equipment models, performance requirements, architecture, budget categories, non-sensitive geometry and room-level design intent. It must not publish credentials, exact security-device coordinates, camera blind spots, private addressing, switch-port mappings, alarm zones, rack coordinates, access-control response procedures or other operationally sensitive security details.

## LiDAR: generated, not theoretical

The repository now contains an actual crop of NOAA's 2023 Connecticut classified LiDAR dataset 10296 around S477.

Generated files live in `../../data/s477/lidar/generated/`:

- `s477-preliminary-site.copc.laz` — full cropped COPC point cloud: **1,892,482 points**, about **10.16 MB**.
- `s477-site-points.bin` — **120,000-point** browser derivative: **1.92 MB**.
- `s477-site-web.json` — web-viewer metadata, origin, bounds and source references.
- `s477-preliminary-site-summary.json` — PDAL summary with CRS, dimensions and source point count.
- `source-tiles.json` — exact NOAA BLOCK2 COPC files selected through NOAA's official tile-index GeoPackage.
- `SHA256SUMS.txt` — integrity hashes.

Current extent is a **260 m × 265 m preliminary buffered AOI** around 477 Broad Street in NAD83(2011) / UTM zone 18N with NAVD88 heights. This is real measured LiDAR geometry. It is not yet being called a parcel-accurate boundary. When Bridgeport GIS returns the authoritative parcel/building geometry, the same pipeline will re-clip the source to that geometry.

LiDAR is inherently a point cloud, not a textured photogrammetry mesh. The finished S477 twin is designed to combine this exterior/elevation truth with City plans and X5/Marble interior capture, while keeping stable room and system IDs.

## Heavy spatial assets

Do not commit statewide LiDAR, raw 360 video or other massive source datasets to ordinary Git history. The statewide NOAA source is referenced by provenance. Site-specific optimized derivatives can live in this repo when reasonably sized; larger future COPC, GLB, panorama and media assets should move to managed object storage or Git LFS with stable references here.

## Records acquisition

Requests have been sent to Bridgeport Building, Tax Assessor, Zoning and GIS. They seek the property jacket, floor/permit drawings, field card/building sketch, historical site/zoning plans, parcel geometry and relevant dimensional/spatial records.

## Intake sequence

Real LiDAR buffer → City records + parcel/building geometry → field measurements → X5 room captures → Marble/3D geometry → room IDs → system overlays → commissioning evidence.

The UI does not need to be rewritten when better geometry arrives. Room and system records stay stable while their spatial representation improves.
