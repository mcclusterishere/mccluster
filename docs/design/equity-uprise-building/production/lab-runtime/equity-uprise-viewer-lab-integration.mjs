import { LabRuntimeError } from "./equity-uprise-lab-runtime.mjs";
import { createGuidedScenarioFromPack } from "./equity-uprise-guided-scenarios.mjs";
import { createBuildingOperationsExercise } from "./equity-uprise-building-ops-runtime.mjs";
import { createPublicServiceExercise } from "./equity-uprise-public-service-runtime.mjs";
import { createAssessedExercise } from "./equity-uprise-assessment-runtime.mjs";
import { createDifficultyProgressionExercise } from "./equity-uprise-difficulty-runtime.mjs";

export const VIEWER_LAB_INTEGRATION_VERSION = "1.0.0";
export const VIEWER_LAB_EXECUTION_TARGET = "SANDBOX";

const clone = (value) => JSON.parse(JSON.stringify(value));
const requireValue = (condition, code, message) => {
  if (!condition) throw new LabRuntimeError(code, message);
};
const uniq = (values) => [...new Set(values.filter(Boolean))].sort();

const SERVICE_LABELS = Object.freeze({
  "RUNTIME-OPS-ALARM": "Alarm",
  "RUNTIME-OPS-MUSTER": "Accountability",
  "RUNTIME-OPS-MEDICAL": "Medical Incident",
  "RUNTIME-OPS-QUEUE": "Queue",
  "RUNTIME-OPS-SERVICE-HAZARD": "Service Area",
  "RUNTIME-OPS-COMMS": "Incident Communications",
  "RUNTIME-PSC-PRIVACY": "Privacy",
  "RUNTIME-PSC-CASE": "Synthetic Case",
  "RUNTIME-PSC-SCOPE": "Scope Review",
  "RUNTIME-PSC-QUALITY": "Quality Review",
  "RUNTIME-PSC-CONSENT": "Consent",
  "RUNTIME-PSC-INCIDENT": "Privacy Incident",
  "ELEC-NORMAL": "Normal Power",
  "LOGIC-SVC-DIRECTORY-IDP": "Directory / Check-In",
});

function availabilityVisual(state) {
  if (!state) return "normal";
  if (state.availability === "unavailable") return "unavailable";
  if (state.security_state === "at_risk") return "at_risk";
  if (state.availability === "degraded") return "degraded";
  if ((state.condition_flags || []).some((flag) => /alarm|fault|failure|loss|down|blocked|exposed|hazard/i.test(flag))) return "faulted";
  if ((state.active_fault_ids || []).length) return "faulted";
  return "changed";
}

function classifyFamily(lab, datasets) {
  const guided = (datasets.cisaPack.scenarios || []).find((scenario) => scenario.source_lab_id === lab);
  if (guided) return { family: "CISA_ITOT", definition: guided, canonical_id: lab };

  const ops = (datasets.opsPack.scenarios || []).find(
    (scenario) => scenario.canonical_scenario_id === lab || scenario.scenario_id === lab
  );
  if (ops) return { family: "BUILDING_OPS", definition: ops, canonical_id: ops.canonical_scenario_id };

  const publicService = (datasets.publicServicePack.scenarios || []).find(
    (scenario) => scenario.scenario_id === lab
  );
  if (publicService) return { family: "PUBLIC_SERVICE", definition: publicService, canonical_id: publicService.scenario_id };

  throw new LabRuntimeError("VIEWER_LAB_NOT_FOUND", "viewer lab/scenario not found: " + lab);
}

function cisaCompetencyIds(bindings, labId) {
  return uniq((bindings.bindings || [])
    .filter((binding) => (binding.lab_ids || []).includes(labId))
    .flatMap((binding) => binding.competency_ids || []));
}

function floorStateGeometry(id, datasets) {
  const sim = (datasets.simulationObjects.objects || []).find((item) => item.object_id === id);
  if (sim) return clone(sim.geometry || sim.location || null);
  const obj = (datasets.objectInventory.objects || []).find((item) => item.id === id);
  if (obj) return clone(obj.placement || null);
  return null;
}

function floorVisuals(snapshot, datasets) {
  const states = snapshot?.sandbox?.states || [];
  const objects = [];
  const areas = [];
  const systems = [];

  for (const state of states) {
    const id = state.object_id;
    const visual = availabilityVisual(state);
    const record = {
      canonical_id: id,
      visual_state: visual,
      availability: state.availability || "available",
      state: state.state || null,
      condition_flags: clone(state.condition_flags || []),
    };

    if (SERVICE_LABELS[id]) {
      systems.push({
        system_id: id,
        label: SERVICE_LABELS[id],
        state: state.state || state.availability || visual,
        visual_state: visual,
      });
      continue;
    }

    const geometry = floorStateGeometry(id, datasets);
    const siteLike = /^site-/.test(id);
    if (siteLike || geometry) areas.push({ ...record, geometry });
    else objects.push(record);
  }

  return { objects, areas, systems };
}

function electronicsSystems(assetStates) {
  const byId = new Map();
  const push = (system_id, label, state) => {
    const visual = availabilityVisual(state);
    const rank = { normal: 0, changed: 1, at_risk: 2, degraded: 3, faulted: 4, unavailable: 5 };
    const prior = byId.get(system_id);
    if (!prior || (rank[visual] || 0) > (rank[prior.visual_state] || 0)) {
      byId.set(system_id, { system_id, label, state: visual, visual_state: visual });
    }
  };

  for (const state of assetStates) {
    const conditions = state.condition_flags || [];
    if (conditions.includes("normal_power_loss")) push("SYS-NORMAL-POWER", "Normal Power", state);
    if (conditions.includes("bas_alarm") || ["bas_controller", "environment_sensor"].includes(state.asset_type)) {
      push("SYS-BAS", "BAS", state);
    }
    if (conditions.includes("core_link_degraded") || ["core_switch", "access_switch"].includes(state.asset_type)) {
      push("SYS-CORE-NETWORK", "Core Network", state);
    }
    if (state.asset_type === "firewall" || state.security_state === "at_risk") {
      push("SYS-NETWORK-SECURITY", "Network Security", state);
    }
    if (state.asset_type === "camera") push("SYS-VIDEO", "Video Security", state);
    if (state.asset_type === "rack_ups" || state.asset_type === "pdu") push("SYS-POWER", "Power Distribution", state);
    if (state.asset_id === "LOGIC-SVC-DIRECTORY-IDP") push("SYS-DIRECTORY", "Directory / Check-In", state);
    if (state.asset_type === "logical_service") push("SYS-LOGICAL", "Logical Services", state);
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function assessmentSummary(report, qualification) {
  return {
    phase: report.phase,
    actions: {
      total: report.action_metrics.total,
      mistakes: report.action_metrics.incorrect_or_blocked + report.action_metrics.error,
      success: report.action_metrics.success,
    },
    hints_used: report.hints.count,
    timing: {
      elapsed_ms: report.timing.elapsed_ms,
      diagnosis_elapsed_ms: report.timing.diagnosis_elapsed_ms,
      restoration_elapsed_ms: report.timing.restoration_elapsed_ms,
    },
    evidence_produced: report.produced_evidence_count,
    critical_safety_clear: report.safety.critical_violation_count === 0,
    automated_evidence_signal: report.automated_evidence_signal,
    maximum_automated_state: "Demonstrated",
    difficulty_qualified: qualification.qualified,
    difficulty_checks: clone(qualification.checks),
  };
}

function occupantContext(classified, snapshot) {
  const active = snapshot?.sandbox?.states || [];
  const has = (id) => active.some((state) => state.object_id === id);
  if (classified.family === "BUILDING_OPS" && has("RUNTIME-OPS-QUEUE")) {
    return [{ marker_id: "SIM-OCCUPANCY-QUEUE", label: "Anonymous synthetic queue", anchor_id: "F1-RECEPTION-DESK-01", synthetic_only: true }];
  }
  if (classified.family === "BUILDING_OPS" && has("RUNTIME-OPS-MEDICAL")) {
    return [{ marker_id: "SIM-OCCUPANCY-MEDICAL", label: "Anonymous synthetic incident context", anchor_id: "F1-RECEPTION-SECURITY-01", synthetic_only: true }];
  }
  if (classified.family === "BUILDING_OPS" && has("RUNTIME-OPS-MUSTER")) {
    return [{ marker_id: "SIM-OCCUPANCY-ACCOUNTABILITY", label: "Anonymous synthetic accountability group", anchor_id: "F1-EGRESS-MAP-01", synthetic_only: true }];
  }
  if (classified.family === "PUBLIC_SERVICE") {
    return [{ marker_id: "SIM-OCCUPANCY-INTAKE", label: "Anonymous synthetic service interaction", anchor_id: "F1-INTAKE-TABLE-01", synthetic_only: true }];
  }
  return [];
}

export function adaptRuntimeSnapshotToViewer({ difficulty, exercise, datasets, classified }) {
  const learner = difficulty.learnerView();
  const runtime = exercise.snapshot();
  const report = difficulty.assessed.assessment();
  const qualification = difficulty.qualification();
  const electronics = runtime?.sandbox?.asset_states ? runtime.sandbox : null;

  const assetStates = electronics?.asset_states || [];
  const connectionStates = electronics?.connection_states || [];
  const floor = electronics ? { objects: [], areas: [], systems: [] } : floorVisuals(runtime, datasets);

  const view = {
    viewer_lab_integration_version: VIEWER_LAB_INTEGRATION_VERSION,
    mode: "SIMULATION",
    execution_target: "SANDBOX",
    live_control_allowed: false,
    design_intent_not_as_built: true,
    scenario: {
      family: classified.family,
      scenario_id: runtime.scenario_id || classified.definition.scenario_id || null,
      source_lab_id: runtime.source_lab_id || null,
      canonical_scenario_id: runtime.canonical_scenario_id || null,
      title: runtime.title || classified.definition.title || null,
      phase: runtime.phase || "CREATED",
      synthetic_case_only: classified.family === "PUBLIC_SERVICE",
    },
    learner: clone(learner),
    visuals: {
      assets: assetStates.map((state) => ({
        canonical_id: state.asset_id,
        asset_type: state.asset_type || null,
        level_id: state.level_id || null,
        availability: state.availability,
        visual_state: availabilityVisual(state),
        condition_count: (state.condition_flags || []).length,
      })),
      connections: connectionStates.map((state) => ({
        connection_id: state.connection_id,
        from_asset_id: state.from_asset_id,
        to_asset_id: state.to_asset_id,
        cable_type: state.cable_type,
        availability: state.availability,
        visual_state: availabilityVisual(state),
      })),
      objects: floor.objects,
      areas: floor.areas,
      occupants: occupantContext(classified, runtime),
    },
    systems: electronics ? electronicsSystems(assetStates) : floor.systems,
    assessment: assessmentSummary(report, qualification),
    safety: {
      training_simulation_only: true,
      no_live_building_control: true,
      public_service_real_pii_forbidden: classified.family === "PUBLIC_SERVICE",
    },
  };

  return clone(view);
}

export class ViewerLabController {
  constructor({
    lab,
    difficulty = "FOUNDATION",
    datasets,
    actor_id = "viewer-learner",
    ai_assistance = "none",
    clock = Date.now,
  }) {
    requireValue(datasets && typeof datasets === "object", "VIEWER_DATASETS_REQUIRED", "viewer lab datasets are required");
    requireValue(typeof lab === "string" && lab.trim(), "VIEWER_LAB_REQUIRED", "lab is required");
    this.lab = lab;
    this.level = String(difficulty || "FOUNDATION").toUpperCase();
    this.datasets = datasets;
    this.actorId = actor_id;
    this.aiAssistance = ai_assistance;
    this.clock = clock;
    this.sessionOrdinal = 0;
    this._build();
  }

  _build() {
    this.classified = classifyFamily(this.lab, this.datasets);
    const sessionId = "VIEWER::STEP8::" + this.lab + "::" + (++this.sessionOrdinal);
    let exercise;
    let competencyIds = [];

    if (this.classified.family === "CISA_ITOT") {
      exercise = createGuidedScenarioFromPack({
        pack: this.datasets.cisaPack,
        labCatalog: this.datasets.labCatalog,
        labId: this.lab,
        electronics: {
          registry: this.datasets.registry,
          connections: this.datasets.connections,
          manifest: this.datasets.manifest,
        },
        session_id: sessionId,
        actor_id: this.actorId,
        execution_target: "SANDBOX",
      });
      competencyIds = cisaCompetencyIds(this.datasets.federalBindings, this.lab);
      requireValue(competencyIds.length > 0, "VIEWER_CISA_COMPETENCY_BINDING_MISSING", "no canonical competency binding for " + this.lab);
    } else if (this.classified.family === "BUILDING_OPS") {
      exercise = createBuildingOperationsExercise({
        pack: this.datasets.opsPack,
        canonicalScenarioId: this.classified.definition.canonical_scenario_id,
        program: this.datasets.program,
        simulationObjects: this.datasets.simulationObjects,
        objectInventory: this.datasets.objectInventory,
        registry: this.datasets.registry,
        session_id: sessionId,
        actor_id: this.actorId,
        execution_target: "SANDBOX",
      });
    } else {
      exercise = createPublicServiceExercise({
        pack: this.datasets.publicServicePack,
        scenarioId: this.classified.definition.scenario_id,
        program: this.datasets.program,
        objectInventory: this.datasets.objectInventory,
        simulationObjects: this.datasets.simulationObjects,
        session_id: sessionId,
        actor_id: this.actorId,
        execution_target: "SANDBOX",
      });
    }

    this.exercise = exercise;
    this.assessed = createAssessedExercise({
      exercise,
      rubrics: this.datasets.rubrics,
      competency_ids: competencyIds,
      clock: this.clock,
      actor_id: this.actorId,
      ai_assistance: this.aiAssistance,
      assessment_id: "ASSESS::" + sessionId,
    });
    this.difficulty = createDifficultyProgressionExercise({
      assessed: this.assessed,
      policy: this.datasets.difficultyPolicy,
      level: this.level,
    });
    this.started = false;
    this.completed = false;
  }

  start() {
    requireValue(!this.started, "VIEWER_LAB_ALREADY_STARTED", "viewer lab already started");
    this.difficulty.start();
    this.started = true;
    return this.snapshot();
  }

  execute(actionId, input = {}) {
    const result = this.difficulty.execute(actionId, input);
    return { result: clone(result), view: this.snapshot() };
  }

  requestHint(level = "supported") {
    const hint = this.difficulty.requestHint({
      hint_id: "VIEWER-HINT::" + this.lab + "::" + String(this.difficulty.hintsUsed + 1).padStart(2, "0"),
      level,
      reference: "viewer-lab://step8/" + this.lab,
    });
    return { hint: clone(hint), view: this.snapshot() };
  }

  submitArtifact({ title, reference, content_sha256 = null }) {
    const evidence = this.difficulty.submitEvidence({
      evidence_id: "VIEWER-ARTIFACT::" + this.lab + "::" + String((this.assessed.producedEvidence || []).length + 1).padStart(2, "0"),
      evidence_class: "artifact",
      title,
      reference,
      version: "1",
      content_sha256,
      description: "Learner-produced artifact reference submitted from the Step 8 viewer.",
    });
    return { evidence: clone(evidence), view: this.snapshot() };
  }

  complete() {
    const result = this.difficulty.complete();
    this.completed = true;
    return { result: clone(result), view: this.snapshot() };
  }

  reset() {
    if (this.exercise?.sandbox && typeof this.exercise.sandbox.reset === "function") {
      this.exercise.sandbox.reset();
    }
    this._build();
    return this.snapshot();
  }

  actionForCanonicalId(canonicalId) {
    if (!canonicalId || !this.started || this.completed) return null;
    const actions = this.classified.definition.actions || [];
    for (const action of actions) {
      const actionId = action.action_id || action.id;
      const actionType = action.action_type || action.type;
      const target = action.target_selector || action.target;
      if (actionType !== "inspect" || !target) continue;
      if (target === canonicalId) return actionId;
      if (this.classified.family === "CISA_ITOT" && this.exercise?.sandbox?.resolveSelector) {
        const resolved = this.exercise.sandbox.resolveSelector(target);
        if ((resolved.asset_ids || []).includes(canonicalId) || (resolved.connection_ids || []).includes(canonicalId)) return actionId;
      }
    }
    return null;
  }

  canonicalIdsForPicking() {
    const ids = [
      ...(this.datasets.registry.assets || []).map((asset) => asset.asset_id),
      ...(this.datasets.connections.connections || []).map((connection) => connection.connection_id),
      ...(this.datasets.simulationObjects.objects || []).map((object) => object.object_id),
      ...(this.datasets.objectInventory.objects || []).map((object) => object.id),
    ];
    return uniq(ids).sort((a, b) => b.length - a.length || a.localeCompare(b));
  }

  snapshot() {
    return adaptRuntimeSnapshotToViewer({
      difficulty: this.difficulty,
      exercise: this.exercise,
      datasets: this.datasets,
      classified: this.classified,
    });
  }
}

export function createViewerLabController(options) {
  return new ViewerLabController(options);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Step 8 viewer dataset fetch failed " + response.status + " " + url);
  return response.json();
}

export async function loadViewerLabDatasets(root = "/equity-uprise-preview") {
  const r = root.replace(/\/$/, "");
  const [
    cisaPack, opsPack, publicServicePack, difficultyPolicy, rubrics, federalBindings,
    labCatalog, registry, connections, manifest, program, simulationObjects, objectInventory,
  ] = await Promise.all([
    fetchJson(r + "/lab-runtime/cisa-itot-scenario-pack-v1.json"),
    fetchJson(r + "/lab-runtime/fema-building-ops-scenario-pack-v1.json"),
    fetchJson(r + "/lab-runtime/public-service-scenario-pack-v1.json"),
    fetchJson(r + "/lab-runtime/difficulty-progression-policy-v1.json"),
    fetchJson(r + "/competency-rubrics.json"),
    fetchJson(r + "/federal-training-bindings.json"),
    fetchJson(r + "/equity-uprise-it-lab-catalog-v1.json"),
    fetchJson(r + "/equity-uprise-asset-registry-v1.json"),
    fetchJson(r + "/equity-uprise-electronics-connections-v1.json"),
    fetchJson(r + "/equity-uprise-electronics-manifest-v1.json"),
    fetchJson(r + "/floor-01-digital-twin-program.json"),
    fetchJson(r + "/floor-01-simulation-objects.json"),
    fetchJson(r + "/floor-01-object-inventory.json"),
  ]);
  return {
    cisaPack, opsPack, publicServicePack, difficultyPolicy, rubrics, federalBindings,
    labCatalog, registry, connections, manifest, program, simulationObjects, objectInventory,
  };
}
