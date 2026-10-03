import {
  LabRuntimeError,
  SESSION_STATES,
} from "./equity-uprise-lab-runtime.mjs";
import {
  createElectronicsBoundSessionFromCatalogLab,
} from "./equity-uprise-electronics-sandbox.mjs";

export const GUIDED_SCENARIO_RUNTIME_VERSION = "1.0.0";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireValue(condition, code, message) {
  if (!condition) throw new LabRuntimeError(code, message);
}

function stableNormalize(value) {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableNormalize(value[key])])
    );
  }
  return value;
}

function stableEqual(a, b) {
  return JSON.stringify(stableNormalize(a)) === JSON.stringify(stableNormalize(b));
}

function unique(values) {
  return [...new Set(values)];
}

export class GuidedScenarioRunner {
  constructor({
    definition,
    sourceLab,
    electronics,
    session_id,
    actor_id = "learner",
    execution_target = "SANDBOX",
  }) {
    requireValue(definition && typeof definition === "object", "INVALID_GUIDED_SCENARIO", "definition is required");
    requireValue(sourceLab && typeof sourceLab === "object", "INVALID_SOURCE_LAB", "sourceLab is required");
    requireValue(definition.source_lab_id === sourceLab.lab_id, "GUIDED_SCENARIO_SOURCE_MISMATCH", "definition/source lab mismatch");
    requireValue(definition.mode === "SIMULATION", "NON_SIMULATION_SCENARIO", "guided scenario must remain SIMULATION");
    requireValue(definition.execution_target === "SANDBOX", "LIVE_CONTROL_FORBIDDEN", "guided scenario target must be SANDBOX");
    requireValue(definition.live_control_allowed === false, "LIVE_CONTROL_FORBIDDEN", "guided scenario cannot allow live control");
    requireValue(Array.isArray(definition.objectives) && definition.objectives.length > 0, "INVALID_GUIDED_OBJECTIVES", "objectives[] is required");
    requireValue(Array.isArray(definition.actions) && definition.actions.length > 0, "INVALID_GUIDED_ACTIONS", "actions[] is required");

    const objectiveIds = definition.objectives.map((objective) => objective.objective_id);
    const actionIds = definition.actions.map((action) => action.action_id);
    requireValue(new Set(objectiveIds).size === objectiveIds.length, "DUPLICATE_OBJECTIVE_ID", "objective IDs must be unique");
    requireValue(new Set(actionIds).size === actionIds.length, "DUPLICATE_ACTION_ID", "action IDs must be unique");

    this.definition = clone(definition);
    this.sourceLab = clone(sourceLab);
    if (Array.isArray(this.definition.target_selectors) && this.definition.target_selectors.length > 0) {
      this.sourceLab.target_selectors = clone(this.definition.target_selectors);
    }
    this.actionById = new Map(this.definition.actions.map((action) => [action.action_id, action]));
    this.successfulActionIds = new Set();
    this.actionHistory = [];
    this.actionSeq = 0;
    this.objectives = this.definition.objectives.map((objective) => ({
      ...clone(objective),
      complete: false,
    }));
    this.initialFaultIds = (sourceLab.fault_injection || []).filter((faultId) => faultId !== "none").sort();
    this.unresolvedFaultIds = new Set(this.initialFaultIds);

    const bound = createElectronicsBoundSessionFromCatalogLab(
      this.sourceLab,
      electronics,
      {
        session_id: session_id || "GUIDED::" + definition.scenario_id,
        actor_id,
        execution_target,
      }
    );
    this.scenario = bound.scenario;
    this.sandbox = bound.sandbox;
    this.session = bound.session;
  }

  start() {
    requireValue(this.session.phase === SESSION_STATES.CREATED, "INVALID_GUIDED_TRANSITION", "guided scenario can only start from CREATED");
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
      objective.complete = (objective.required_action_ids || []).every((actionId) =>
        this.successfulActionIds.has(actionId)
      );
    }
  }

  _recomposeSandbox() {
    this.sandbox.reset();
    this.sandbox.bindScenario(this.scenario);
    for (const faultId of [...this.unresolvedFaultIds].sort()) {
      this.sandbox.injectFault(faultId, {
        target_selectors: this.scenario.target_selectors,
      });
    }
    for (const fault of this.session.faults) {
      fault.active = this.unresolvedFaultIds.has(fault.fault_id);
    }
  }

  _actionPrerequisites(action) {
    return (action.requires_action_ids || []).filter((actionId) => !this.successfulActionIds.has(actionId));
  }

  execute(actionId, input = {}) {
    requireValue(this.session.phase === SESSION_STATES.RUNNING, "SESSION_NOT_RUNNING", "guided scenario must be RUNNING");
    const action = this.actionById.get(actionId);
    requireValue(Boolean(action), "UNKNOWN_GUIDED_ACTION", "unknown guided action " + actionId);
    requireValue(action.live_control_allowed !== true, "LIVE_CONTROL_FORBIDDEN", "guided action cannot request live control");

    const missing = this._actionPrerequisites(action);
    if (missing.length > 0) {
      this.session.perform(action.action_id, {
        target: action.target_selector || null,
        detail: "guided scenario blocked: missing prerequisites " + missing.join(","),
      });
      return this._record(action, "blocked", {
        missing_action_ids: missing,
        correct: false,
      });
    }

    let runtimeEvent = null;
    if (action.action_type === "inspect") {
      runtimeEvent = this.session.inspect(
        action.target_selector,
        "guided scenario inspection: " + action.action_id
      );
    }

    let correct = true;
    if (Object.prototype.hasOwnProperty.call(action, "expected_input")) {
      correct = stableEqual(input, action.expected_input);
    }

    if (action.action_type === "validate") {
      const requiredAbsent = action.requires_faults_absent || [];
      correct = correct && requiredAbsent.every((faultId) => !this.unresolvedFaultIds.has(faultId));
    }

    if (!runtimeEvent && action.action_type !== "inspect") {
      runtimeEvent = this.session.perform(action.action_id, {
        target: action.target_selector || null,
        detail: "guided scenario action outcome=" + (correct ? "success" : "incorrect"),
      });
    }

    if (!correct) {
      return this._record(action, "incorrect", {
        correct: false,
        observation: clone(action.observation || null),
        input: clone(input),
      });
    }

    for (const faultId of action.resolve_fault_ids || []) {
      requireValue(this.initialFaultIds.includes(faultId), "GUIDED_FAULT_SCOPE_ERROR", "action tried to resolve a fault outside the source lab");
      this.unresolvedFaultIds.delete(faultId);
    }

    if ((action.resolve_fault_ids || []).length > 0) {
      this._recomposeSandbox();
    }

    this.successfulActionIds.add(action.action_id);
    this._syncObjectives();

    return this._record(action, "success", {
      correct: true,
      target_selector: action.target_selector || null,
      observation: clone(action.observation || null),
      runtime_event_seq: runtimeEvent ? runtimeEvent.event_seq : null,
      unresolved_fault_ids: [...this.unresolvedFaultIds].sort(),
    });
  }

  canComplete() {
    this._syncObjectives();
    return (
      this.objectives.every((objective) => objective.complete) &&
      this.unresolvedFaultIds.size === 0
    );
  }

  complete() {
    requireValue(this.session.phase === SESSION_STATES.RUNNING, "SESSION_NOT_RUNNING", "guided scenario must be RUNNING");
    this._syncObjectives();
    const incomplete = this.objectives.filter((objective) => !objective.complete).map((objective) => objective.objective_id);
    requireValue(incomplete.length === 0, "GUIDED_OBJECTIVES_INCOMPLETE", "incomplete guided objectives: " + incomplete.join(", "));
    requireValue(this.unresolvedFaultIds.size === 0, "GUIDED_FAULTS_UNRESOLVED", "all scenario faults must be resolved before completion");

    for (const criterion of this.session.criteria) {
      if (!criterion.satisfied) {
        this.session.satisfyCriterion(criterion.criterion_id, {
          evidence_type: "guided_scenario_completion",
          scenario_id: this.definition.scenario_id,
          completed_objective_ids: this.objectives.map((objective) => objective.objective_id),
          successful_action_ids: [...this.successfulActionIds].sort(),
          federal_training_ids: clone(this.definition.federal_training_ids || []),
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
      guided_runtime_version: GUIDED_SCENARIO_RUNTIME_VERSION,
      scenario_id: this.definition.scenario_id,
      source_lab_id: this.sourceLab.lab_id,
      title: this.definition.title,
      mode: "SIMULATION",
      execution_target: "SANDBOX",
      live_control_allowed: false,
      federal_training_ids: clone(this.definition.federal_training_ids || []),
      credential_is_not_competency: true,
      competency_ids: clone(this.definition.competency_ids || []),
      viewer_focus: this.definition.viewer_focus || null,
      floor_scope: clone(this.definition.floor_scope || []),
      engineering_view: this.definition.engineering_view === true,
      phase: this.session.phase,
      objectives: clone(this.objectives),
      successful_action_ids: [...this.successfulActionIds].sort(),
      unresolved_fault_ids: [...this.unresolvedFaultIds].sort(),
      action_history: clone(this.actionHistory),
      can_complete: this.canComplete(),
      sandbox: this.sandbox.snapshot({ changed_only: true }),
    };
  }

  exportEvidence() {
    return {
      ...this.snapshot(),
      runtime_evidence: this.session.exportEvidence(),
    };
  }
}

export function scenarioDefinitionByLabId(pack, labId) {
  requireValue(pack && Array.isArray(pack.scenarios), "INVALID_SCENARIO_PACK", "scenario pack must expose scenarios[]");
  const definition = pack.scenarios.find((scenario) => scenario.source_lab_id === labId);
  requireValue(Boolean(definition), "GUIDED_SCENARIO_NOT_FOUND", "no guided scenario for " + labId);
  return clone(definition);
}

export function createGuidedScenarioFromPack({
  pack,
  labCatalog,
  labId,
  electronics,
  session_id,
  actor_id = "learner",
  execution_target = "SANDBOX",
}) {
  const definition = scenarioDefinitionByLabId(pack, labId);
  const sourceLab = (labCatalog.labs || []).find((lab) => lab.lab_id === labId);
  requireValue(Boolean(sourceLab), "SOURCE_LAB_NOT_FOUND", "source lab not found: " + labId);
  return new GuidedScenarioRunner({
    definition,
    sourceLab,
    electronics,
    session_id,
    actor_id,
    execution_target,
  });
}
