# S477 Smart Church — project data room

This directory is the human-readable index for the S477 Smart Church / 477 Broad Street digital-twin project.

## Start here

- `../../smart-church.html` — public responsive digital-twin experience.
- `../../data/s477-public.json` — public room/system model used by the website.
- `../../data/s477/dashboard.json` — visual dashboard facts, budget series and evidence status.
- `../../data/s477/sources.json` — authoritative and supporting source registry.
- `../../data/s477/site-baseline.json` — site facts with confidence/provenance labels.
- `../../data/s477/lidar/source-manifest.json` — official 2023 Connecticut LiDAR dataset manifest.
- `records/2026-09-02-city-records-request.md` — copy of the City records request sent for plans and property records.

## Data policy

Every factual value should carry one of four states:

1. **verified** — supported by an authoritative public record or accepted project inventory.
2. **reference-design** — a current engineering basis of design, not a claim that hardware is already installed.
3. **provisional** — useful working information that must be field-verified.
4. **open** — intentionally unknown until a survey, record response or licensed-trade review resolves it.

The public website may publish system quantities, equipment models, performance requirements, architecture, budget categories and room-level design intent. It must not publish credentials, exact security-device coordinates, camera blind spots, private addressing, switch-port mappings, alarm zones, rack coordinates, access-control response procedures or other operationally sensitive security details.

## Heavy spatial assets

Do not commit statewide LiDAR, large LAZ/LAS files, raw 360 video or high-resolution Marble/GLB captures directly to ordinary Git history. Keep provenance and lightweight derived assets in this repo. Store heavy site-specific binaries in managed object storage or Git LFS and reference them from the source registry.

The authoritative 2023 Connecticut statewide LiDAR is available through NOAA dataset `10296`, including streamable EPT, customized download, tiled LAZ and a 3D browser. A site crop for 477 Broad Street should be generated only after the City parcel/building footprint is resolved to an authoritative bounding geometry.

## Intake sequence

City records → parcel/building geometry → field measurements → X5 room captures → Marble/3D geometry → room IDs → system overlays → commissioning evidence.

The website is intentionally built so the UI does not need to be rewritten when better geometry arrives. Room and system records stay stable while their spatial representation improves.