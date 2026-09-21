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
