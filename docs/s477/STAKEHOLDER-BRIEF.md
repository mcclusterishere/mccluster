# S477 Smart Church — stakeholder repo guide

## What this project is

S477 is a site-specific technology modernization and digital-twin project for Shiloh Baptist Church at 477 Broad Street in Bridgeport, Connecticut. The building is being treated as a small institutional technology campus: physical security, commercial access control, monitored intrusion, structured networking, local AI/learning compute, storage, endpoint services, power resilience and future AV are engineered as one system-of-systems.

The public-facing Smart Church experience is designed to explain the same project at two depths. **Simple mode** communicates purpose, scale and outcomes. **Engineer mode** exposes the reference stack, dependencies, quantities, open survey conditions and engineering rationale.

## Current engineering position

The project is **Engineering Development / Pre-Design-Freeze**. The current Engineering Pack V2 baseline capital plan is approximately **$138.7K including 10% design/procurement contingency**, with a separate $30K concept allowance for long-duration resilience that is not part of the baseline until electrical/solar conditions are surveyed.

Reference quantities include 30 planned installed cameras plus 3 cold spares, 4 controlled exterior openings, 6 Wi-Fi 7 APs as a starting design, 12 teaching endpoints, 2 modern high-memory AI nodes, a 10GbE aggregation layer, separate video and project-data storage, and dual UPS domains.

These quantities are a basis of design, not a claim that all equipment is already installed.

## What is verified now

- 477 Broad Street project address
- 6,226 sq ft public-record building baseline
- 1955 public-record year-built baseline
- 15.1 kW existing rooftop solar asset
- 10 Dell PowerEdge R620 servers in project inventory, pending per-node inventory/condition verification

## What is deliberately still open

The project does not freeze procurement or final geometry until the building is measured and records are reconciled. Open gates include authoritative floor plans, room dimensions, door schedule/egress review, exact room inventory, cable paths, ISP demarcation, rack inventory, R620 configurations, electrical service and spare circuits, solar/inverter behavior, fire/life-safety interfaces, thermal conditions and Wi-Fi RF validation.

## Spatial / digital-twin path

The project has connected the official 2023 Connecticut statewide LiDAR source through NOAA dataset 10296. The authoritative City of Bridgeport parcel geometry service has also been identified. A City records request for the full property jacket, plans and dimensional records was sent September 2, 2026.

The sequence is: authoritative records and parcel geometry → site LiDAR crop → field measurement → X5 360 room capture → Marble/3D geometry → stable room IDs → system overlays → commissioning evidence.

## Where to inspect the repo

- `smart-church.html` — interactive Smart Church product surface
- `data/s477-public.json` — room/system public twin data
- `data/s477/dashboard.json` — budget and visual evidence data
- `data/s477/site-baseline.json` — provenance-aware site facts
- `data/s477/sources.json` — source registry
- `data/s477/lidar/source-manifest.json` — official LiDAR provenance and endpoints
- `docs/s477/records/2026-09-02-city-records-request.md` — public-record acquisition log
- `docs/s477/MOBBIN-DESIGN-NOTES.md` — responsive UX research and implementation rules

## Public vs restricted engineering data

The public/shareable repository can show architecture, models, quantities, budgets, standards, room-level design intent and source provenance. Operationally sensitive data such as exact camera aiming/blind spots, alarm zones, private network addressing, switch-port mappings, credentials, rack coordinates, access-control response procedures and sensitive cable routes should remain in a restricted engineering layer.

## What we want from technical reviewers and partners

Review the architecture, challenge assumptions, flag compatibility or code/interface risks, help resolve field-survey gates, and identify where equipment, engineering support, training, licensing, infrastructure or funding can retire a documented project requirement without breaking the rest of the system.