# Equity Uprise Lab Runtime — Step 1 Foundation

## Purpose

The Lab Runtime turns canonical Equity Uprise training definitions into deterministic, sandbox-only runtime sessions.

Step 1 establishes the execution contract only. It does **not** yet mutate the electronics/IT asset graph, the 3D building, B1 operational systems, or any live equipment. Step 2 will connect runtime fault state to the canonical Step 4A electronics fabric.

## Canonical inputs

The runtime adapts, but does not replace:

- `production/electronics/generated/equity-uprise-it-lab-catalog-v1.json`
- `production/electronics/generated/equity-uprise-electronics-manifest-v1.json`
- `production/electronics/generated/equity-uprise-electronics-connections-v1.json`
- the Digital-to-Physical Asset Registry and Step 3A/3B causal graph;
- `../equity-uprise-development/FEDERAL-TRAINING-BINDINGS.json`.

Federal course completion remains external evidence. It is never equivalent to Equity Uprise competency mastery.

## Runtime contract

Every catalog lab is adapted into an executable-scenario envelope with stable runtime identifiers while preserving the source lab ID, tier, title, skills, target selectors, student tasks, fault declarations, success criteria and reset language.

The Step 1 session state machine is:

`CREATED -> RUNNING -> COMPLETED`

A session may be moved to `RESET` from any active/completed state and started again from the same canonical scenario definition.

The runtime exposes these learner/instructor operations:

1. `start()` — activates the sandbox session and its abstract fault declarations.
2. `inspect(target, detail)` — records an observation without changing system state.
3. `perform(action, ...)` — records a simulated learner action.
4. `satisfyCriterion(criterionId, evidence)` — records evidence against a canonical success criterion.
5. `evaluate()` — returns deterministic pass/fail state without mutating the session.
6. `complete()` — completes only when every required success criterion has evidence.
7. `reset()` — deactivates injected faults and clears criterion satisfaction while preserving the audit ledger.

## Evidence contract

Every runtime event is append-only and receives a deterministic monotonic `event_seq`. Step 1 deliberately does not use wall-clock time so CI, replay and later grading remain reproducible.

Events include:

- session start;
- abstract fault injection;
- inspection;
- simulated action;
- criterion satisfaction;
- session completion;
- reset.

The evidence bundle exports the scenario identity, session identity, current phase, criterion status, abstract fault state, ordered event ledger and current evaluation result.

Step 6 will add richer scoring, timing, hints, penalties and competency evidence. Step 1 only creates the durable event spine those systems will consume.

## Safety / authority boundary

Non-negotiable:

- runtime execution target is `SANDBOX` only;
- source labs must remain `mode: "SIMULATION"`;
- source labs must remain `live_control_allowed: false`;
- any request for `LIVE` execution is rejected before a session starts;
- any per-action live-control request is rejected;
- no runtime operation writes to a building controller, BAS, fire-alarm system, access-control panel, network switch, hypervisor, camera, power system or B1 operational service;
- B1 / OT learner work remains a sandboxed clone only;
- this runtime is training software, not construction, commissioning or operational-control authority.

## Step 1 completion boundary

Step 1 is complete when:

- all 40 Step 4A labs adapt successfully into the runtime envelope;
- the state machine starts, records learner evidence, evaluates, completes and resets deterministically;
- incomplete scenarios cannot complete;
- LIVE execution is rejected;
- CI runs the runtime verifier on every Core V2 validation.

## Next

**Step 2:** bind runtime target selectors and fault declarations to the Step 4A electronics manifest/connections and Digital-to-Physical Asset Registry so simulated devices, links and services can change state and propagate consequences inside the sandbox.

## Step 2 — Electronics / Asset-State Binding

Step 2 binds the Step 1 runtime contract to the canonical Step 4A electronics fabric **in memory only**.

Canonical implementation:
- `production/lab-runtime/equity-uprise-electronics-sandbox.mjs`
- `production/lab-runtime/verify_electronics_sandbox_v1.mjs`

The sandbox consumes the existing canonical artifacts rather than creating a parallel model:
- Digital-to-Physical Asset Registry;
- Step 4A electronics manifest;
- Step 4A typed physical connections;
- Step 4A 40-lab catalog.

### Target resolution

All current lab selectors resolve through one deterministic resolver:
- exact canonical asset IDs, including logical service/VLAN IDs;
- canonical `classification.asset_type` values;
- canonical cable types;
- `cable_type_catalog` as a read-only catalog scope;
- `whole_building` as the Step 4A electronics scope.

Unknown selectors fail closed with `UNRESOLVED_TARGET_SELECTOR`. The runtime never invents a replacement asset, cable, port, room or live protocol address.

### Simulated state

Each sandbox session keeps independent state for canonical assets and typed connections.

Asset state includes:
- baseline/current availability;
- condition flags;
- active fault IDs;
- security posture;
- documentation/audit alignment.

Connection state includes:
- canonical connection ID and endpoints;
- cable type/layer;
- baseline/current availability;
- condition flags;
- active fault IDs.

The source registry and generated electronics artifacts are never mutated by a learner session.

### Fault propagation

Current Step 4A fault tokens now change canonical simulated state rather than remaining abstract labels.

Representative propagation includes:
- copper/fiber faults → typed connection + affected endpoint state;
- AP/camera PoE/link loss → endpoint + serving horizontal link;
- access-switch failure → switch → patch panel → horizontal endpoint chain;
- BAS-controller failure → BACnet MS/TP links → environment sensors;
- reader-bus failure → access controller → OSDP links → readers;
- IDF UPS failure → UPS/power path → same-level access switching/endpoints;
- virtualization-host failure → contained logical services + dependent-service degradation;
- service/certificate/auth failures → logical service state + reverse dependency effects;
- firewall HA failure → one deterministic primary failure + peer-active/failover state;
- backbone fiber cut → one deterministic uplink failure while redundant switching remains degraded rather than falsely offline;
- whole-building incident → separate normal-power, core-link and BAS alarm effects;
- commissioning mismatch → audit/documentation state without inventing an operational outage.

### Runtime integration

A `LabRuntimeSession` may receive an optional sandbox. When present:
- `start()` injects every declared fault into canonical simulated asset/link/service state;
- `FAULT_INJECTED` evidence records the exact changed canonical IDs;
- `inspect()` captures a bounded canonical sandbox observation;
- `snapshot()` includes a sandbox summary;
- `exportEvidence()` includes changed sandbox state;
- `reset()` restores baseline while preserving the attached scenario binding.

Without a sandbox, the Step 1 abstract mode remains valid for non-electronics scenarios.

### Safety boundary

Step 2 remains **SANDBOX-only**:
- no external network/device writes;
- no protocol commands;
- no live BAS/fire/access/network/power control;
- registries containing any `live_control_allowed: true` asset are rejected;
- `execution_target: LIVE` remains rejected by the Step 1 runtime;
- B1/OT learner work remains a sandboxed clone.

Step 2 models training consequences from current design-intent topology. It does not claim as-built commissioning truth, RF performance, circuit sizing, breaker coordination, fire-alarm design, exact rack/port assignment or physical path diversity.

## Next

**Step 3:** promote the first CISA-aligned IT/OT labs into richer executable incident scenarios with explicit learner actions/remediation, diagnostic observations and scenario-specific success evidence.

## Step 3 — CISA / IT-OT Guided Incident Scenarios

Step 3 promotes three existing Step 4A labs from generic definitions into task-specific executable incident exercises:

- `IT-LAB-029` — IT/OT Firewall Segmentation;
- `IT-LAB-038` — SIEM Correlation;
- `IT-LAB-039` — Cross-System Building Incident.

Canonical Step 3 source:
- `production/lab-runtime/cisa-itot-scenario-pack-v1.json`
- `production/lab-runtime/equity-uprise-guided-scenarios.mjs`
- `production/lab-runtime/verify_cisa_itot_scenarios_v1.mjs`

The scenario pack references only existing Step 4A lab IDs and existing federal-training bindings. It does not convert external course completion into Equity Uprise competency mastery.

### Guided execution contract

A guided scenario adds:
- explicit learner objectives;
- an allowlisted simulated action catalog;
- prerequisite gates between actions;
- bounded scenario observations;
- deterministic decision validation;
- simulation-only mitigation actions;
- fault-specific remediation through Step 2 state recomposition;
- final validation gates;
- automatic evidence attachment to the source lab's canonical success criterion.

Incorrect decisions are recorded but do not advance objectives. Out-of-order restoration actions are recorded as blocked and do not mutate sandbox state.

### First three scenarios

**IT-LAB-029 — IT/OT Firewall Segmentation**
- inspect BAS-OT and firewall simulated state;
- identify an overpermissive policy condition;
- apply a simulation-only least-privilege correction;
- validate that the modeled BAS-OT posture returns to baseline.

**IT-LAB-038 — SIEM Cross-Domain Correlation**
- collect SIEM, network, BAS and camera evidence;
- reconstruct the deterministic simulated event sequence;
- classify the event as one correlated multi-device incident;
- close and validate the simulated alert condition.

**IT-LAB-039 — Cross-System Building Incident Response**
- inspect the whole-building, core-network and BAS domains;
- separate the training scenario's primary power fault from secondary effects;
- restore simulated power, then core connectivity, then BAS state;
- validate that all three declared faults are cleared.

### Safety / assessment boundary

- execution remains `SANDBOX` only;
- the action catalog contains no shell/device/protocol commands or credentials;
- mitigation changes only in-memory simulation state;
- LIVE execution remains rejected;
- CISA bindings remain supporting training/evidence, not competency equivalence;
- secure proctoring, scoring, timing, penalties and learner-facing hint policy remain later-step work.

**Next:** Step 4 adds FEMA building-operations exercises on the same runtime.

## Step 4 — Building-Operations Exercises

Step 4 promotes the eight already-canonical Floor 1 operations scenarios into executable exercises on the same Lab Runtime:

- `basic_evacuation`
- `blocked_stair_a`
- `passenger_elevator_outage`
- `power_interruption`
- `medical_incident_lobby`
- `public_service_surge`
- `network_checkin_outage`
- `service_area_incident`

Canonical Step 4 files:
- `production/lab-runtime/fema-building-ops-scenario-pack-v1.json`
- `production/lab-runtime/equity-uprise-building-ops-runtime.mjs`
- `production/lab-runtime/verify_fema_building_ops_scenarios_v1.mjs`

The runtime uses existing Floor 1 simulation/object inventory IDs and the canonical asset registry. Temporary incident, queue, accountability and communication states remain runtime-only semantic state and never become duplicate physical assets.

Exercises include prerequisite gates, state-backed inspection, deterministic correct/incorrect decisions, simulation-only resolution, canonical evidence capture, federal-training binding verification and deterministic replay.

The medical scenario is limited to recognition, emergency escalation, responder access, equipment location for trained responders, and handoff. It does not teach diagnosis or treatment.

All Step 4 exercises remain SANDBOX-only. LIVE building control is rejected.

**Next:** Step 5 adds Floor 1 public-service intake exercises, including IRS VITA/OHRP-aligned privacy, intake, scope, consent and escalation workflows.

## Step 5 — Floor 1 Public-Service Intake Labs

Step 5 promotes the existing canonical `privacy_error_intake` scenario into three executable Floor 1 public-service variants:

- `EU-PSC-VITA-INTAKE-V1` — VITA/TCE intake, privacy, scope and quality-review workflow;
- `EU-PSC-OHRP-CONSENT-V1` — participant-centered consent and privacy recovery;
- `EU-PSC-PRIVACY-RECOVERY-V1` — cross-program intake privacy containment.

Canonical Step 5 files:
- `production/lab-runtime/public-service-scenario-pack-v1.json`
- `production/lab-runtime/equity-uprise-public-service-runtime.mjs`
- `production/lab-runtime/verify_public_service_scenarios_v1.mjs`

The runtime binds to existing Floor 1 public-service objects such as the reception workstation, reception/security interface, private intake table, secure intake credenza and private intake display. Temporary case, privacy, consent, scope, quality-review and incident states are runtime-only semantic state, not new physical building authority.

### Synthetic-data boundary

Step 5 is intentionally synthetic-only:
- no real taxpayer PII;
- no real research-participant PII;
- no real visitor/client records;
- no SSNs, TINs, EINs, DOBs, email addresses, phone numbers or street addresses in scenario fixtures;
- any scenario whose `synthetic_only` flag is false is rejected.

### VITA/TCE workflow

The VITA/TCE variant uses existing IRS VITA bindings for Volunteer Standards of Conduct, Intake/Interview and Quality Review, Basic, and Advanced paths. The Equity Uprise lab exercises workflow discipline rather than tax-law determination:
- identify and contain a synthetic privacy exposure;
- move work to the private intake setting;
- inspect the synthetic packet state;
- escalate a scope exception to the certified site coordinator;
- require independent quality review before completion;
- validate that all simulated faults are cleared.

It does not authorize real taxpayer service or replace current-year IRS certification/site supervision.

### OHRP workflow

The OHRP variant uses existing Human Research Protection Foundational Training and Participant-Centered Informed Consent bindings:
- identify and contain a synthetic privacy exposure;
- pause the interaction;
- preserve voluntary participant choice;
- use authorized protocol materials;
- escalate protocol deviation/uncertainty to an authorized research lead;
- validate recovery.

It does not create IRB authority, approve a protocol, or authorize real human-subjects research.

### Cross-program privacy recovery

The generic privacy variant proves the common Floor 1 intake control pattern:
- remove a synthetic sensitive view from public context;
- secure synthetic materials;
- use minimum-required synthetic check-in information;
- route the interaction to private intake;
- document the simulated incident;
- validate containment.

All Step 5 evidence remains separate from federal credential completion. External course completion may support learning but never equals Equity Uprise competency mastery.

**Next:** Step 6 adds the richer assessment/evidence layer: action sequencing, incorrect-action history, hints, timing, safety violations, produced evidence and competency-level evaluation.

## Step 6 — Assessment, Evidence, Timing, and Competency Signals

Step 6 adds a common assessment wrapper across the executable Step 3, Step 4, and Step 5 runtimes.

Canonical Step 6 files:
- `production/lab-runtime/equity-uprise-assessment-runtime.mjs`
- `production/lab-runtime/assessment-policy-v1.json`
- `production/lab-runtime/verify_assessment_runtime_v1.mjs`

The assessment wrapper records:
- ordered learner actions;
- correct, incorrect, blocked, and runtime-error outcomes;
- per-action start/end/duration timing;
- time to first successful diagnostic/decision action;
- time to restoration of all declared scenario faults;
- hint requests and resulting assistance level;
- safety violations, including critical violations that block a positive automated evidence signal;
- learner-produced evidence metadata and SHA-256 provenance;
- a deterministic runtime-performance evidence record;
- AI-assistance declaration;
- competency IDs, rubric IDs, rubric versions, and critical-criterion names.

### Competency-assessment boundary

Step 6 implements a **Level 1 automated verifier**, not a human competency reviewer.

The machine may:
- validate that an exercise completed;
- verify deterministic evidence/provenance;
- summarize assistance, errors, timing and safety events;
- produce `practicing_evidence` or `demonstrated_evidence_candidate` signals.

The machine may **not**:
- assign criterion scores on behalf of a qualified reviewer;
- award `Verified`;
- award `Applied` from simulation;
- award `Mentor`;
- average away a critical safety, privacy, ethics, consent, security or authority violation.

The automated competency-state ceiling is `Demonstrated`, and even that is emitted as an evidence candidate rather than a final human award.

### Evidence rules

Automated exercise submission may record training, artifact, and performance evidence metadata. Simulation evidence cannot be labeled `Applied`. The automated verifier cannot fabricate `Reviewer` evidence.

A completed runtime automatically receives a hashed performance-evidence record referencing the full runtime ledger. Artifact submissions may additionally carry an explicit content SHA-256.

### Assistance / AI

Hint use maps to the canonical assistance model:
- no hints → `independent`;
- supported hint → `supported`;
- directed hint → `directed`.

Declared `substantial_generation` or `automated_workflow` AI assistance triggers an Evidence Defense recommendation; it does not automatically invalidate the evidence.

**Next:** Step 7 introduces difficulty-level behavior and policy across Foundation, Technician, Admin, Advanced, and Expert labs.

