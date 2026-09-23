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


## Digital-to-Physical Asset Registry

Canonical Step 1 authority:
- `DIGITAL-PHYSICAL-ASSET-REGISTRY-SPEC.md`
- `production/asset-registry/asset-registry-schema-v1.json`
- `production/asset-registry/asset-registry-source-contract-v1.json`
- `production/asset-registry/verify_asset_registry_schema.py`

Purpose: preserve one canonical asset identity across the digital twin, future physical tags, training, telemetry, commissioning, maintenance and operations. Step 1 is schema/source authority only; physical identifiers and live protocol bindings are not invented.


### Step 2 populated registry
- `production/asset-registry/build_asset_registry_v1.py`
- `production/asset-registry/verify_asset_registry_step2.py`
- `production/asset-registry/generated/equity-uprise-asset-registry-v1.json`
- `production/asset-registry/generated/equity-uprise-asset-registry-step2-report.json`

Step 2 is the deterministic ingestion layer: every B1–L7 object, facade source, service family, riser allocation, capability record and building level is classified and reconciled without fabricating physical-world data.


### Step 3A B1 operational graph
- `production/asset-registry/build_asset_registry_step3a.py`
- `production/asset-registry/verify_asset_registry_step3a.py`
- `production/asset-registry/generated/equity-uprise-asset-registry-step3a-report.json`

Step 3A materializes B1 source→service→riser relationships and all declared service-family dependencies inside the same canonical registry. It is the first graph layer intended for causal lab queries and fault-propagation training.


### Step 3B floor branch / endpoint graph
- `production/asset-registry/build_asset_registry_step3b.py`
- `production/asset-registry/verify_asset_registry_step3b.py`
- `production/asset-registry/generated/equity-uprise-asset-registry-step3b-report.json`

Step 3B consumes the deterministic services branch topology after the services build and links verified canonical endpoints into the same registry while preserving semantic-only branches for lab traceability.


## Electronics / IT infrastructure

Canonical Step 4A authority/source:
- `ELECTRONICS-IT-INFRASTRUCTURE-SPEC.md`
- `production/electronics/electronics-population-policy-v1.json`
- `production/electronics/build_equity_uprise_electronics_v1.py`
- `production/electronics/verify_equity_uprise_electronics_v1.py`

Generated electronics artifacts:
- `production/electronics/generated/equity-uprise-electronics-manifest-v1.json`
- `production/electronics/generated/equity-uprise-electronics-connections-v1.json`
- `production/electronics/generated/equity-uprise-it-lab-catalog-v1.json`
- `production/electronics/generated/equity-uprise-electronics-step4a-report.json`
- `production/electronics/generated/equity-uprise-electronics-fabric-v1.glb`

The electronics layer extends, rather than replaces, the Digital-to-Physical Asset Registry and Step 3A/3B causal graph.


## Federal training authority

The canonical external training/evidence layer that binds federal programs to the building, competencies, Floor 1 scenarios and Step 4A labs is:
- `../equity-uprise-development/FEDERAL-TRAINING-CATALOG-SPEC.md`
- `../equity-uprise-development/FEDERAL-TRAINING-CATALOG.json`
- `../equity-uprise-development/FEDERAL-TRAINING-BINDINGS.json`
- `../equity-uprise-development/verify_federal_training_catalog.py`

These files are included in the building context gate as external authority. Credentials remain separate from competency mastery and all learner B1/OT activity remains sandboxed.

## Lab Runtime — Step 1 execution foundation

Canonical authority/runtime:
- `LAB-RUNTIME-SPEC.md`
- `production/lab-runtime/lab-runtime-schema-v1.json`
- `production/lab-runtime/equity-uprise-lab-runtime.mjs`
- `production/lab-runtime/verify_lab_runtime_v1.mjs`

Step 1 converts the existing 40 Step 4A lab definitions into deterministic sandbox sessions with lifecycle control, abstract fault activation, learner inspection/action events, success-criterion evidence, completion gating, reset and replayable evidence export. The runtime is browser-compatible and dependency-free so later viewer integration can consume the same engine.

LIVE execution is explicitly forbidden. Step 2 is the electronics/asset-state binding layer.

### Step 2 electronics / asset-state binding
- `production/lab-runtime/equity-uprise-electronics-sandbox.mjs`
- `production/lab-runtime/verify_electronics_sandbox_v1.mjs`

Step 2 binds the session engine to canonical Step 4A assets and typed connections. Fault injection now changes independent SANDBOX asset/link/service state with deterministic propagation and exact-ID evidence. Reset restores baseline; LIVE control remains forbidden.

### Step 3 CISA / IT-OT guided incident scenarios
- `production/lab-runtime/cisa-itot-scenario-pack-v1.json`
- `production/lab-runtime/equity-uprise-guided-scenarios.mjs`
- `production/lab-runtime/verify_cisa_itot_scenarios_v1.mjs`

Step 3 promotes IT-LAB-029, IT-LAB-038 and IT-LAB-039 into executable guided scenarios with objective gates, allowlisted simulated actions, decision validation, deterministic remediation, state-backed evidence and canonical criterion completion. CISA course bindings remain supporting evidence only; learner B1/OT work remains sandboxed.

### Step 4 building-operations exercises
- `production/lab-runtime/fema-building-ops-scenario-pack-v1.json`
- `production/lab-runtime/equity-uprise-building-ops-runtime.mjs`
- `production/lab-runtime/verify_fema_building_ops_scenarios_v1.mjs`

Step 4 executes the eight existing Floor 1 building-operations scenarios with canonical object state, prerequisite gates, deterministic decisions, simulation-only resolution and evidence capture. FEMA and other federal bindings remain instructional mappings only; LIVE building control remains disabled.

### Step 5 Floor 1 public-service labs
- `production/lab-runtime/public-service-scenario-pack-v1.json`
- `production/lab-runtime/equity-uprise-public-service-runtime.mjs`
- `production/lab-runtime/verify_public_service_scenarios_v1.mjs`

Step 5 turns the existing `privacy_error_intake` scenario into three executable synthetic-case labs spanning IRS VITA/TCE workflow discipline, OHRP participant-centered consent/privacy handling, and cross-program intake privacy containment. The runtime uses existing Floor 1 reception/intake objects and rejects real-PII fixtures.

### Step 6 assessment / evidence layer
- `production/lab-runtime/equity-uprise-assessment-runtime.mjs`
- `production/lab-runtime/assessment-policy-v1.json`
- `production/lab-runtime/verify_assessment_runtime_v1.mjs`

Step 6 provides one bounded Level 1 assessment layer for the executable lab families. It records action sequence, errors, blocked actions, hints, timing, safety violations, evidence metadata/hashes, AI-assistance declarations, and rubric-linked competency evidence. Automation is capped below human `Verified` authority and simulation cannot become `Applied` evidence merely through runtime completion.

### Step 7 difficulty progression
- `production/lab-runtime/difficulty-progression-policy-v1.json`
- `production/lab-runtime/equity-uprise-difficulty-runtime.mjs`
- `production/lab-runtime/verify_difficulty_progression_v1.mjs`

Step 7 adds Foundation → Technician → Admin → Advanced → Expert progression above the Step 6 assessment layer. Guidance, fault disclosure, hints, artifact expectations and scenario-complexity qualification become progressively stricter while canonical scenario logic and competency rubrics remain unchanged.



### Step 8 deep 3D viewer integration
- `production/lab-runtime/equity-uprise-viewer-lab-integration.mjs`
- `production/lab-runtime/verify_viewer_lab_integration_v1.mjs`
- canonical viewer: `equity-uprise-building-core-v2-3d.html`

Step 8 completes the original Lab Runtime sequence by adapting canonical runtime snapshots into digital-twin presentation state. The existing viewer remains the only building viewer: Lab mode overlays canonical electronics/object/path/area state, runtime-backed system status, difficulty-filtered learner tasks, bounded assessment feedback and anonymous synthetic people-state markers. Viewer interactions dispatch through the runtime and rerender from the resulting snapshot; they do not directly mutate the simulated building.

### Step 9 distributed whole-building practical labs
- `production/lab-runtime/distributed-building-scenario-pack-v1.json`
- `production/lab-runtime/equity-uprise-electronics-sandbox.mjs`
- `production/lab-runtime/equity-uprise-guided-scenarios.mjs`
- `production/lab-runtime/equity-uprise-viewer-lab-integration.mjs`
- `production/lab-runtime/verify_viewer_lab_integration_v1.mjs`

Step 9 adds floor-scoped asset/cable selectors, executable labs on B1 and every occupied level through the roof, and cross-floor incidents that traverse upper-floor access/backbone infrastructure toward B1. Technical labs carry viewer focus metadata so the canonical viewer opens the relevant floor or stack and enables Engineering/X-Ray before fault presentation.
