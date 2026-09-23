import {
  LabRuntimeError,
  LabRuntimeSession,
  SESSION_STATES,
} from "./equity-uprise-lab-runtime.mjs";
import {
  BuildingOperationsSandbox,
} from "./equity-uprise-building-ops-sandbox.mjs";

export const BUILDING_OPS_RUNTIME_VERSION = "1.0.0";

const clone = (value) => JSON.parse(JSON.stringify(value));
const requireValue = (condition, code, message) => {
  if (!condition) throw new LabRuntimeError(code, message);
};

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

function equal(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function runtimeScenario(definition, sourceScenario) {
  return {
    schema_version: "1.0.0",
    runtime_version: BUILDING_OPS_RUNTIME_VERSION,
    scenario_id: definition.scenario_id,
    source_lab_id: null,
    source_scenario_id: definition.canonical_scenario_id,
    tier: definition.tier || "OPERATIONS",
    title: definition.title,
    skills: clone(definition.competency_ids || []),
    mode: "SIMULATION",
    execution_target: "SANDBOX",
    live_control_allowed: false,
    target_selectors: clone(definition.target_selectors),
    fault_injection: definition.fault_injection.map((fault_id) => ({ fault_id, active: false })),
    tasks: definition.actions.map((action, index) => ({
      task_id: "OPS-TASK-" + String(index + 1).padStart(3, "0"),
      description: action.label || action.action_id,
    })),
    success_criteria: (sourceScenario.evidence || []).map((description, index) => ({
      criterion_id: "OPS-CRIT-" + String(index + 1).padStart(3, "0"),
      description,
      required: true,
    })),
    reset_contract: "restore Floor 1 building-operations simulation baseline",
    source_definition: clone(sourceScenario),
  };
}

export class BuildingOperationsExerciseRunner {
  constructor({
    definition,
    sourceScenario,
    sources,
    session_id,
    actor_id = "learner",
    execution_target = "SANDBOX",
  }) {
    requireValue(definition && typeof definition === "object", "INVALID_BUILDING_OPS_DEFINITION", "definition is required");
    requireValue(sourceScenario && typeof sourceScenario === "object", "INVALID_BUILDING_OPS_SOURCE", "source scenario is required");
    requireValue(definition.canonical_scenario_id === sourceScenario.id, "BUILDING_OPS_SOURCE_MISMATCH", "scenario/source mismatch");
    requireValue(definition.mode === "SIMULATION", "NON_SIMULATION_SCENARIO", "building-ops scenario must remain SIMULATION");
    requireValue(definition.execution_target === "SANDBOX", "LIVE_CONTROL_FORBIDDEN", "building-ops target must be SANDBOX");
    requireValue(definition.live_control_allowed === false, "LIVE_CONTROL_FORBIDDEN", "building-ops scenario cannot allow live control");

    this.definition = clone(definition);
    this.sourceScenario = clone(sourceScenario);
    this.sandbox = new BuildingOperationsSandbox(sources);
    this.scenario = runtimeScenario(this.definition, this.sourceScenario);
    this.session = new LabRuntimeSession({
      scenario: this.scenario,
      session_id: session_id || "BUILDING-OPS::" + definition.canonical_scenario_id,
      actor_id,
      execution_target,
      sandbox: this.sandbox,
    });

    this.actionById = new Map(this.definition.actions.map((action) => [action.action_id, action]));
    this.successfulActionIds = new Set();
    this.actionHistory = [];
    this.actionSeq = 0;
    this.initialFaultIds = [...this.definition.fault_injection].sort();
    this.unresolvedFaultIds = new Set(this.initialFaultIds);
    this.objectives = this.definition.objectives.map((objective) => ({ ...clone(objective), complete: false }));
  }

  start() {
    requireValue(this.session.phase === SESSION_STATES.CREATED, "INVALID_BUILDING_OPS_TRANSITION", "exercise can only start from CREATED");
    this.session.start();
    return this.snapshot();
  }

  _record(action, status, details = {}) {
    const record = {
      action_seq: ++this.actionSeq,
      action_id: action.action_id,
      action_type: action.action_type,
      status,
      ...clone(details),
    };
    this.actionHistory.push(record);
    return record;
  }

  _syncObjectives() {
    for (const objective of this.objectives) {
      objective.complete = (objective.required_action_ids || []).every((id) => this.successfulActionIds.has(id));
    }
  }

  _recompose() {
    this.sandbox.reset();
    this.sandbox.bindScenario(this.scenario);
    for (const faultId of [...this.unresolvedFaultIds].sort()) {
      this.sandbox.injectFault(faultId);
    }
    for (const fault of this.session.faults) {
      fault.active = this.unresolvedFaultIds.has(fault.fault_id);
    }
  }

  execute(actionId, input = {}) {
    requireValue(this.session.phase === SESSION_STATES.RUNNING, "SESSION_NOT_RUNNING", "building-ops exercise must be RUNNING");
    const action = this.actionById.get(actionId);
    requireValue(Boolean(action), "UNKNOWN_BUILDING_OPS_ACTION", "unknown building-ops action " + actionId);
    requireValue(action.live_control_allowed !== true, "LIVE_CONTROL_FORBIDDEN", "building-ops action cannot request live control");

    const missing = (action.requires_action_ids || []).filter((id) => !this.successfulActionIds.has(id));
    if (missing.length) {
      this.session.perform(action.action_id, {
        target: action.target_selector || null,
        detail: "building-ops action blocked: missing prerequisites " + missing.join(","),
      });
      return this._record(action, "blocked", { correct: false, missing_action_ids: missing });
    }

    let runtimeEvent;
    if (action.action_type === "inspect") {
      runtimeEvent = this.session.inspect(action.target_selector, "building-ops inspection: " + action.action_id);
    } else {
      runtimeEvent = this.session.perform(action.action_id, {
        target: action.target_selector || null,
        detail: "building-ops action",
      });
    }

    let correct = true;
    if (Object.prototype.hasOwnProperty.call(action, "expected_input")) {
      correct = equal(input, action.expected_input);
    }
    if (action.action_type === "validate") {
      correct = correct && (action.requires_faults_absent || []).every((faultId) => !this.unresolvedFaultIds.has(faultId));
    }

    if (!correct) {
      return this._record(action, "incorrect", {
        correct: false,
        input: clone(input),
        observation: clone(action.observation || null),
        runtime_event_seq: runtimeEvent?.event_seq || null,
      });
    }

    for (const faultId of action.resolve_fault_ids || []) {
      requireValue(this.initialFaultIds.includes(faultId), "BUILDING_OPS_FAULT_SCOPE_ERROR", "action tried to resolve out-of-scope fault " + faultId);
      this.unresolvedFaultIds.delete(faultId);
    }
    if ((action.resolve_fault_ids || []).length) this._recompose();

    this.successfulActionIds.add(action.action_id);
    this._syncObjectives();
    return this._record(action, "success", {
      correct: true,
      observation: clone(action.observation || null),
      runtime_event_seq: runtimeEvent?.event_seq || null,
      unresolved_fault_ids: [...this.unresolvedFaultIds].sort(),
    });
  }

  canComplete() {
    this._syncObjectives();
    return this.objectives.every((objective) => objective.complete) && this.unresolvedFaultIds.size === 0;
  }

  complete() {
    requireValue(this.session.phase === SESSION_STATES.RUNNING, "SESSION_NOT_RUNNING", "building-ops exercise must be RUNNING");
    requireValue(this.canComplete(), "BUILDING_OPS_INCOMPLETE", "building-ops objectives/faults are incomplete");

    for (const criterion of this.session.criteria) {
      if (!criterion.satisfied) {
        this.session.satisfyCriterion(criterion.criterion_id, {
          evidence_type: "building_operations_exercise",
          canonical_scenario_id: this.definition.canonical_scenario_id,
          successful_action_ids: [...this.successfulActionIds].sort(),
          federal_training_ids: clone(this.definition.federal_training_ids || []),
          competency_ids: clone(this.definition.competency_ids || []),
          credential_is_not_competency: true,
        });
      }
    }
    this.session.complete();
    return this.snapshot();
  }

  snapshot() {
    this._syncObjectives();
    return {
      building_ops_runtime_version: BUILDING_OPS_RUNTIME_VERSION,
      scenario_id: this.definition.scenario_id,
      canonical_scenario_id: this.definition.canonical_scenario_id,
      title: this.definition.title,
      phase: this.session.phase,
      mode: "SIMULATION",
      execution_target: "SANDBOX",
      live_control_allowed: false,
      federal_training_ids: clone(this.definition.federal_training_ids || []),
      competency_ids: clone(this.definition.competency_ids || []),
      credential_is_not_competency: true,
      objectives: clone(this.objectives),
      successful_action_ids: [...this.successfulActionIds].sort(),
      unresolved_fault_ids: [...this.unresolvedFaultIds].sort(),
      action_history: clone(this.actionHistory),
      can_complete: this.canComplete(),
      sandbox: this.sandbox.snapshot({ changed_only: true }),
    };
  }

  exportEvidence() {
    return { ...this.snapshot(), runtime_evidence: this.session.exportEvidence() };
  }
}

export function createBuildingOperationsExercise({
  pack,
  canonicalScenarioId,
  program,
  simulationObjects,
  objectInventory,
  registry,
  session_id,
  actor_id = "learner",
  execution_target = "SANDBOX",
}) {
  const definition = (pack.scenarios || []).find((entry) => entry.canonical_scenario_id === canonicalScenarioId);
  requireValue(Boolean(definition), "BUILDING_OPS_SCENARIO_NOT_FOUND", "scenario not found: " + canonicalScenarioId);
  const sourceScenario = (program.scenarios || []).find((entry) => entry.id === canonicalScenarioId);
  requireValue(Boolean(sourceScenario), "BUILDING_OPS_SOURCE_NOT_FOUND", "program scenario not found: " + canonicalScenarioId);

  return new BuildingOperationsExerciseRunner({
    definition,
    sourceScenario,
    sources: { program, simulationObjects, objectInventory, registry },
    session_id,
    actor_id,
    execution_target,
  });
}
