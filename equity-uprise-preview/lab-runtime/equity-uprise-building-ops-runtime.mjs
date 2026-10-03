import { LabRuntimeError, LabRuntimeSession, SESSION_STATES } from "./equity-uprise-lab-runtime.mjs";

export const BUILDING_OPS_RUNTIME_VERSION = "1.0.0";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireValue(condition, code, message) {
  if (!condition) throw new LabRuntimeError(code, message);
}

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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

class BuildingOpsState {
  constructor({ definition, pack, simulationObjects, objectInventory, registry }) {
    this.definition = clone(definition);
    this.pack = clone(pack);
    this.base = new Map();

    for (const object of simulationObjects.objects || []) {
      this.base.set(object.object_id, {
        object_id: object.object_id,
        source: "floor_01_simulation_object",
        label: object.label || object.object_id,
        baseline_state: object.normal_state || "available",
        state: object.normal_state || "available",
        availability: "available",
        condition_flags: [],
        active_fault_ids: [],
      });
    }

    for (const object of objectInventory.objects || []) {
      if (!this.base.has(object.id)) {
        this.base.set(object.id, {
          object_id: object.id,
          source: "floor_01_object_inventory",
          label: object.label || object.id,
          baseline_state: "available",
          state: "available",
          availability: "available",
          condition_flags: [],
          active_fault_ids: [],
        });
      }
    }

    for (const [id, baseline] of Object.entries(pack.semantic_baselines || {})) {
      this.base.set(id, {
        object_id: id,
        source: "runtime_semantic_state",
        label: id,
        baseline_state: baseline.state || "normal",
        state: baseline.state || "normal",
        availability: "available",
        condition_flags: [],
        active_fault_ids: [],
      });
    }

    for (const assetId of ["ELEC-NORMAL", "LOGIC-SVC-DIRECTORY-IDP"]) {
      const asset = (registry.assets || []).find((entry) => entry.asset_id === assetId);
      requireValue(Boolean(asset), "BUILDING_OPS_ASSET_MISSING", "required canonical asset missing: " + assetId);
      this.base.set(assetId, {
        object_id: assetId,
        source: "asset_registry",
        label: asset.label || assetId,
        baseline_state: "available",
        state: "available",
        availability: "available",
        condition_flags: [],
        active_fault_ids: [],
      });
    }

    this._restore();
  }

  _restore() {
    this.states = new Map([...this.base.entries()].map(([id, state]) => [id, clone(state)]));
    this.activeFaultIds = [];
    this.binding = null;
  }

  resolveSelector(selector) {
    if (selector === "whole_floor_01") {
      return { selector, kind: "scope", resolved: true, ids: [...this.states.keys()].sort() };
    }
    if (this.states.has(selector)) {
      return { selector, kind: "object_id", resolved: true, ids: [selector] };
    }
    return { selector, kind: "unresolved", resolved: false, ids: [] };
  }

  bindScenario(scenario) {
    const resolved = (scenario.target_selectors || []).map((selector) => this.resolveSelector(selector));
    const unresolved = resolved.filter((entry) => !entry.resolved).map((entry) => entry.selector);
    requireValue(unresolved.length === 0, "UNRESOLVED_TARGET_SELECTOR", "unresolved Step 4 selectors: " + unresolved.join(", "));
    this.binding = {
      scenario_id: scenario.scenario_id,
      source_scenario_id: scenario.source_scenario_id,
      selectors: resolved.map((entry) => ({ selector: entry.selector, kind: entry.kind, count: entry.ids.length })),
    };
    return clone(this.binding);
  }

  injectFault(faultId) {
    requireValue(faultId === this.definition.fault_id, "UNSUPPORTED_BUILDING_OPS_FAULT", "fault does not belong to scenario: " + faultId);
    const changed = [];
    for (const effect of this.definition.effects || []) {
      const state = this.states.get(effect.target);
      requireValue(Boolean(state), "BUILDING_OPS_EFFECT_TARGET_MISSING", "effect target missing: " + effect.target);
      if (effect.state !== undefined) state.state = effect.state;
      if (effect.availability !== undefined) state.availability = effect.availability;
      if (effect.condition && !state.condition_flags.includes(effect.condition)) state.condition_flags.push(effect.condition);
      if (!state.active_fault_ids.includes(faultId)) state.active_fault_ids.push(faultId);
      state.condition_flags.sort();
      state.active_fault_ids.sort();
      changed.push(effect.target);
    }
    if (!this.activeFaultIds.includes(faultId)) this.activeFaultIds.push(faultId);
    this.activeFaultIds.sort();
    return {
      fault_id: faultId,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      changed_ids: unique(changed).sort(),
      state_summary: this.summary(),
    };
  }

  inspect(selector) {
    const resolved = this.resolveSelector(selector);
    if (!resolved.resolved) return { target: selector, resolved: false, kind: "unresolved" };
    return {
      target: selector,
      resolved: true,
      kind: resolved.kind,
      states: resolved.ids.slice(0, 40).map((id) => clone(this.states.get(id))),
      count: resolved.ids.length,
      truncated: resolved.ids.length > 40,
    };
  }

  summary() {
    const changed = [...this.states.values()].filter((state) =>
      state.active_fault_ids.length > 0 || state.condition_flags.length > 0 ||
      state.state !== state.baseline_state || state.availability !== "available"
    );
    return {
      building_ops_runtime_version: BUILDING_OPS_RUNTIME_VERSION,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      active_fault_ids: [...this.activeFaultIds],
      changed_state_count: changed.length,
    };
  }

  snapshot({ changed_only = true } = {}) {
    const states = [...this.states.values()]
      .filter((state) => !changed_only ||
        state.active_fault_ids.length > 0 || state.condition_flags.length > 0 ||
        state.state !== state.baseline_state || state.availability !== "available")
      .sort((a, b) => a.object_id.localeCompare(b.object_id))
      .map(clone);
    return {
      building_ops_runtime_version: BUILDING_OPS_RUNTIME_VERSION,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      binding: clone(this.binding),
      summary: this.summary(),
      states,
    };
  }

  reset() {
    const prior = [...this.activeFaultIds];
    this._restore();
    return { reset: true, baseline_restored: true, prior_active_fault_ids: prior, state_summary: this.summary() };
  }
}

function toRuntimeScenario(definition, sourceScenario) {
  const targets = unique([
    ...(definition.effects || []).map((effect) => effect.target),
    ...(definition.actions || []).map((action) => action.target),
  ]);
  return {
    schema_version: "1.0.0",
    runtime_version: BUILDING_OPS_RUNTIME_VERSION,
    scenario_id: definition.scenario_id,
    source_lab_id: null,
    source_scenario_id: definition.canonical_scenario_id,
    tier: "OPERATIONS",
    title: definition.title,
    skills: clone(definition.competency_ids || []),
    mode: "SIMULATION",
    execution_target: "SANDBOX",
    live_control_allowed: false,
    target_selectors: targets,
    fault_injection: [{ fault_id: definition.fault_id, active: false }],
    tasks: (definition.actions || []).map((action, index) => ({
      task_id: "OPS-TASK-" + String(index + 1).padStart(3, "0"),
      description: action.id,
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

export class BuildingOperationsExercise {
  constructor({ definition, sourceScenario, pack, sources, session_id, actor_id = "learner", execution_target = "SANDBOX" }) {
    requireValue(definition.canonical_scenario_id === sourceScenario.id, "BUILDING_OPS_SOURCE_MISMATCH", "definition/source scenario mismatch");
    requireValue(pack.mode === "SIMULATION" && pack.execution_target === "SANDBOX" && pack.live_control_allowed === false,
      "LIVE_CONTROL_FORBIDDEN", "Step 4 pack must remain simulation-only");

    this.definition = clone(definition);
    this.sourceScenario = clone(sourceScenario);
    this.sandbox = new BuildingOpsState({ definition, pack, ...sources });
    this.scenario = toRuntimeScenario(definition, sourceScenario);
    this.session = new LabRuntimeSession({
      scenario: this.scenario,
      session_id: session_id || "STEP4::" + definition.canonical_scenario_id,
      actor_id,
      execution_target,
      sandbox: this.sandbox,
    });
    this.actionById = new Map(definition.actions.map((action) => [action.id, action]));
    this.successfulActionIds = new Set();
    this.history = [];
    this.seq = 0;
    this.unresolvedFault = definition.fault_id;
  }

  start() {
    this.session.start();
    return this.snapshot();
  }

  execute(actionId, input = {}) {
    requireValue(this.session.phase === SESSION_STATES.RUNNING, "SESSION_NOT_RUNNING", "Step 4 exercise must be RUNNING");
    const action = this.actionById.get(actionId);
    requireValue(Boolean(action), "UNKNOWN_BUILDING_OPS_ACTION", "unknown Step 4 action " + actionId);

    const missing = (action.requires || []).filter((id) => !this.successfulActionIds.has(id));
    if (missing.length) return this._record(action, "blocked", { missing_action_ids: missing, correct: false });

    let event;
    if (action.type === "inspect") {
      event = this.session.inspect(action.target, "Step 4 building-operations inspection");
    } else {
      event = this.session.perform(action.id, { target: action.target, detail: "Step 4 simulation-only action" });
    }

    let correct = true;
    if (Object.prototype.hasOwnProperty.call(action, "expected")) correct = equal(input, action.expected);
    if (action.type === "validate") correct = correct && this.unresolvedFault === null;

    if (!correct) return this._record(action, "incorrect", { correct: false, input: clone(input), runtime_event_seq: event?.event_seq || null });

    if (action.type === "resolve") {
      this.unresolvedFault = null;
      this.sandbox.reset();
      this.sandbox.bindScenario(this.scenario);
      for (const fault of this.session.faults) fault.active = false;
    }

    this.successfulActionIds.add(action.id);
    return this._record(action, "success", {
      correct: true,
      runtime_event_seq: event?.event_seq || null,
      unresolved_fault_id: this.unresolvedFault,
    });
  }

  _record(action, status, detail) {
    const record = { action_seq: ++this.seq, action_id: action.id, action_type: action.type, status, ...clone(detail) };
    this.history.push(record);
    return record;
  }

  canComplete() {
    return this.definition.actions.every((action) => this.successfulActionIds.has(action.id)) && this.unresolvedFault === null;
  }

  complete() {
    requireValue(this.canComplete(), "BUILDING_OPS_INCOMPLETE", "Step 4 exercise is incomplete");
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
    return {
      building_ops_runtime_version: BUILDING_OPS_RUNTIME_VERSION,
      scenario_id: this.definition.scenario_id,
      canonical_scenario_id: this.definition.canonical_scenario_id,
      title: this.definition.title,
      phase: this.session.phase,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      credential_is_not_competency: true,
      federal_training_ids: clone(this.definition.federal_training_ids || []),
      competency_ids: clone(this.definition.competency_ids || []),
      successful_action_ids: [...this.successfulActionIds].sort(),
      unresolved_fault_id: this.unresolvedFault,
      can_complete: this.canComplete(),
      action_history: clone(this.history),
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
  const definition = pack.scenarios.find((scenario) => scenario.canonical_scenario_id === canonicalScenarioId);
  requireValue(Boolean(definition), "BUILDING_OPS_SCENARIO_NOT_FOUND", "Step 4 scenario not found: " + canonicalScenarioId);
  const sourceScenario = program.scenarios.find((scenario) => scenario.id === canonicalScenarioId);
  requireValue(Boolean(sourceScenario), "BUILDING_OPS_SOURCE_NOT_FOUND", "canonical Floor 1 scenario not found: " + canonicalScenarioId);
  return new BuildingOperationsExercise({
    definition,
    sourceScenario,
    pack,
    sources: { simulationObjects, objectInventory, registry },
    session_id,
    actor_id,
    execution_target,
  });
}
