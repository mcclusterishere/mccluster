# Equity Uprise Building — Master Context Index

> This is the human-readable map. The exhaustive file list is `BUILDING-FILE-INDEX.json`.

## 0. Mandatory context

- `AGENTS.md` — local agent contract.
- `README.md` — front door/read order.
- `PROJECT-STATE.md` — current completion/maturity/next-work ledger.
- `HISTORICAL-REFERENCE-BUILDS.md` — V1 + assembled-building references.
- `BUILD-PIPELINE.md` — canonical build progression.
- `BUILDING-FILE-INDEX.json` — exhaustive tracked-file index.
- `production/audit_building_context.py` — index/context validator.

## 1. Authority hierarchy

- `REFERENCE-AUTHORITY.md`
- `BUILDING-CORE-V2-SPEC.md`
- `production/building-core-v2.json`
- `production/core-v2-floor-programs.json`
- `production/equity-uprise-capability-map-v2.json`
- external repo capability audit: `../EQUITY-UPRISE-REPO-AUDIT.md`
- external building inventory: `../EQUITY-UPRISE-BUILDING-INVENTORY.md`

These two external documents remain where they are because current capability provenance and validators reference them. They are indexed here so they are not missed.

## 2. Current building stack

- B1: `BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md`
- Floor 1: `FLOOR-01-ARRIVAL-ORIENTATION-INTAKE-360-SPEC.md`
- Floor 2: `FLOOR-02-PUBLIC-FORUM-360-SPEC.md`
- Floor 3: `FLOOR-03-FELLOWSHIP-NETWORK-360-SPEC.md`
- Floor 4: `FLOOR-04-MEDIA-CULTURE-360-SPEC.md`
- Floor 5: `FLOOR-05-POLICY-PROOF-360-SPEC.md`
- Floor 6: `FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md`
- Level 7: `FLOOR-07-ROOF-MOBILITY-PORTAL-360-SPEC.md`
  - reconciliation: `FLOOR-07-PROGRAM-RECONCILIATION.md`
  - preservation map: `FLOOR-07-V1-V2-PRESERVATION-MAP.md`
  - ecosystem routing: `FLOOR-07-ECOSYSTEM-ROUTING-CONTRACT.md`
  - inventory/builder: `production/floor-07/floor-07-object-inventory.json`, `production/floor-07/build_equity_uprise_floor_07_v2.py`

Each floor has a companion schematic basis and a production package under `production/floor-XX/`.

## 3. Floor 1 current merge work

Read together:
- `FLOOR-01-V1-V2-MERGE-MAP.md`
- `FLOOR-01-DIGITAL-TWIN-PROGRAM.md`
- `FLOOR-01-SITE-EGRESS-SIMULATION.md`
- `production/floor-01/`
- `references/floor-01/`
- `references/floor-01-site/`
- V1 references under `references/archive/core-v1/floor-01/`

## 4. B1 / underground

- `BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md`
- `UNDERGROUND-TUNNEL-NETWORK-SPEC.md`
- `production/basement-b1-program.json`
- `production/basement-b1/`
- `production/underground-tunnel-network.json`
- `references/basement-b1/`

## 5. Whole-building assembly

Current source:
- `production/build_equity_uprise_building_v2.py`
- `production/generated/equity-uprise-building-core-v2.glb`
- `production/generated/equity-uprise-building-core-v2-report.json`
- root public viewer: `../../../equity-uprise-building-core-v2-3d.html`

Historical whole-building reference is documented in `HISTORICAL-REFERENCE-BUILDS.md`.

## 6. Plans / active references

- `references/core-v2-plan-generation-manifest.json`
- `references/equity-uprise-core-v2-plan-contact-sheet.png`
- `references/floor-01/` through `references/floor-07/`
- `references/floor-01-site/`
- `references/basement-b1/`

Historical references stay under `references/archive/`.

## 7. Validation / generation

Primary validators/generators live under `production/`:
- repo-source coverage
- authority hygiene
- program coverage
- plan generation + semantics
- combined building generation + verification
- Floor 1 / B1 simulation boundary
- building context/index audit
- B1→Level 7 vertical-circulation walkability audit (`production/audit_vertical_circulation_walkability.py`)
- detailed Level 7 inventory / visual-completeness build gate

CI entrypoint:
- `.github/workflows/equity-uprise-core-v2-ci.yml`

Public deploy pipeline:
- `.github/workflows/deploy-pages.yml`

## 8. Public viewers

Tracked from repo root because Pages serves them there:
- `equity-uprise-building-core-v2-3d.html`
- `equity-uprise-floor-01-3d.html`
- `equity-uprise-floor-02-3d.html`
- `equity-uprise-floor-03-3d.html`
- `equity-uprise-floor-04-3d.html`
- `equity-uprise-floor-05-3d.html`
- `equity-uprise-floor-06-3d.html`
- `equity-uprise-floor-07-3d.html`

## 9. Exhaustive inventory

Do not rely on this markdown page for every path. `BUILDING-FILE-INDEX.json` is generated from tracked files and is the exhaustive source for navigation coverage. Run the context audit before work.


## Detailed B1 current-pass implementation

B1 now follows the same hardened floor workflow:
- `BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md`
- `BASEMENT-B1-PROGRAM-RECONCILIATION.md`
- `BASEMENT-B1-V1-V2-PRESERVATION-MAP.md`
- `BASEMENT-B1-SCHEMATIC-PLAN-BASIS.md`
- `production/basement-b1/basement-b1-object-inventory.json`
- `production/basement-b1/build_equity_uprise_basement_b1_v2.py`
- generated detailed B1 GLB/report under `production/generated/`
- standalone review viewer: `equity-uprise-basement-b1-3d.html`

The combined Core V2 chassis remains vertical-continuity authority; the detailed B1 asset is the visual/interior implementation at -13.5 ft.


## Whole-building facade + systems authority

The next building-wide realism pass is now governed by:
- `BUILDING-SYSTEMS-AND-FACADE-CORE-RULES.md`
- `EXTERIOR-FACADE-UPGRADE-SPEC.md`
- `INTERIOR-ENVELOPE-AND-GEOMETRY-UPGRADE-SPEC.md`
- `BUILDING-SERVICES-NERVOUS-SYSTEM-SPEC.md`
- `VERTICAL-DISTRIBUTION-AND-RISER-SPEC.md`
- `FACADE-BRANDING-AND-SIGNAGE-SPEC.md`
- `production/building-services-core-v2.json`
- `production/facade-system-core-v2.json`
- `production/vertical-risers-core-v2.json`
- `production/interior-envelope-audit.json`

This snapshot defines authority only. No facade, riser or interior geometry is considered implemented by the presence of these files.


## Detailed exterior facade implementation

Current-pass facade implementation is coordinated by:
- `EXTERIOR-FACADE-UPGRADE-SPEC.md`
- `FACADE-BRANDING-AND-SIGNAGE-SPEC.md`
- `production/facade-system-core-v2.json`
- `production/facade/facade-module-inventory.json`
- `production/facade/build_equity_uprise_facade_v2.py`
- generated facade GLB/report under `production/generated/`
- combined review viewer: `equity-uprise-building-core-v2-3d.html` with `?view=facade`

The facade uses the existing 18 ft structural grid with a 6 ft secondary module and is a separate coordinated shell layer so approved floor interiors/core geometry are not destructively rebuilt.


## Facade architectural finish pass

The existing facade implementation is now classified as **Facade V1 structural shell complete** and is preserved at:
- branch: `checkpoint/equity-uprise-facade-v1-structural-shell`
- starting SHA: `2fe78f264237c905cd002365de747b3da071ea5b`

Architectural-finish authority:
- `FACADE-ARCHITECTURAL-FINISH-PASS-SPEC.md`

The finish pass governs window assembly depth, corners, base/plinth, completed entrance/doors/canopy, architectural signage, crown/service-screen integration, material realism, exterior lighting and building-to-ground contact.

Finish inventory is now locked at `production/facade/facade-finish-inventory.json`, with 68 stable finish records spanning windows, frames, corners, base, entry, canopy, branding, crown, service facade, lighting and site contact.

No finish geometry is implemented by this inventory commit. The next deterministic step is builder implementation beginning with window assembly depth + base/corner finish.


## Building services / nervous system implementation

Active implementation sequence:
- `BUILDING-SERVICES-IMPLEMENTATION-PLAN.md`
- `production/building-services-core-v2.json`
- `production/vertical-risers-core-v2.json`
- `production/services/floor-services-addenda.json`

Services Steps 1–3 are complete through the B1 source-to-riser layer: the digital-twin sub-riser allocation and B1→L7 requirements are locked; the real vertical services GLB/viewer layer exists; and authorized B1 plant/source equipment now connects through representative B1 distribution geometry to all nine risers. Next is Services Step 4: Floors 1–3 representative branches/endpoints.
