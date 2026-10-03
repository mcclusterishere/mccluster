import {
  LabRuntimeError,
  LabRuntimeSession,
  SESSION_STATES,
} from "./equity-uprise-lab-runtime.mjs";

export const PUBLIC_SERVICE_RUNTIME_VERSION = "1.0.0";

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

function addSorted(list, value) {
  if (!list.includes(value)) list.push(value);
  list.sort();
}

class PublicServiceState {
  constructor({ definition, pack, objectInventory, simulationObjects }) {
    this.definition = clone(definition);
    this.pack = clone(pack);
    this.states = new Map();

    for (const object of simulationObjects.objects || []) {
      this.states.set(object.object_id, {
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
      if (!this.states.has(object.id)) {
        this.states.set(object.id, {
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
      this.states.set(id, {
        object_id: id,
        source: "runtime_semantic_state",
        label: id,
        baseline_state: baseline.state || "normal",
        state: baseline.state || "normal",
        availability: "available",
        condition_flags: [],
        active_fault_ids: [],
        synthetic_only: true,
      });
    }

    this.baseline = new Map([...this.states.entries()].map(([id, state]) => [id, clone(state)]));
    this._restore();
  }

  _restore() {
    this.states = new Map([...this.baseline.entries()].map(([id, state]) => [id, clone(state)]));
    this.activeFaultIds = [];
    this.binding = null;
  }

  resolveSelector(selector) {
    if (selector === "floor_01_public_service_scope") {
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
    requireValue(unresolved.length === 0, "UNRESOLVED_PUBLIC_SERVICE_SELECTOR", "unresolved Step 5 selectors: " + unresolved.join(", "));
    this.binding = {
      scenario_id: scenario.scenario_id,
      source_scenario_id: scenario.source_scenario_id,
      selectors: resolved.map((entry) => ({ selector: entry.selector, kind: entry.kind, count: entry.ids.length })),
    };
    return clone(this.binding);
  }

  injectFault(faultId) {
    const fault = (this.definition.faults || []).find((entry) => entry.fault_id === faultId);
    requireValue(Boolean(fault), "UNSUPPORTED_PUBLIC_SERVICE_FAULT", "fault does not belong to scenario: " + faultId);

    const changed = [];
    for (const effect of fault.effects || []) {
      const state = this.states.get(effect.target);
      requireValue(Boolean(state), "PUBLIC_SERVICE_EFFECT_TARGET_MISSING", "effect target missing: " + effect.target);
      if (effect.state !== undefined) state.state = effect.state;
      if (effect.availability !== undefined) state.availability = effect.availability;
      if (effect.condition && !state.condition_flags.includes(effect.condition)) state.condition_flags.push(effect.condition);
      if (!state.active_fault_ids.includes(faultId)) state.active_fault_ids.push(faultId);
      state.condition_flags.sort();
      state.active_fault_ids.sort();
      changed.push(effect.target);
    }

    addSorted(this.activeFaultIds, faultId);
    return {
      fault_id: faultId,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      synthetic_case_only: true,
      changed_ids: [...new Set(changed)].sort(),
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
      synthetic_case_only: true,
    };
  }

  summary() {
    const changed = [...this.states.values()].filter((state) =>
      state.active_fault_ids.length > 0 ||
      state.condition_flags.length > 0 ||
      state.state !== state.baseline_state ||
      state.availability !== "available"
    );
    return {
      public_service_runtime_version: PUBLIC_SERVICE_RUNTIME_VERSION,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      synthetic_case_only: true,
      active_fault_ids: [...this.activeFaultIds],
      changed_state_count: changed.length,
    };
  }

  snapshot({ changed_only = true } = {}) {
    const states = [...this.states.values()]
      .filter((state) => !changed_only ||
        state.active_fault_ids.length > 0 ||
        state.condition_flags.length > 0 ||
        state.state !== state.baseline_state ||
        state.availability !== "available")
      .sort((a, b) => a.object_id.localeCompare(b.object_id))
      .map(clone);

    return {
      public_service_runtime_version: PUBLIC_SERVICE_RUNTIME_VERSION,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      synthetic_case_only: true,
      binding: clone(this.binding),
      summary: this.summary(),
      states,
    };
  }

  reset() {
    const prior = [...this.activeFaultIds];
    this._restore();
    return {
      reset: true,
      baseline_restored: true,
      prior_active_fault_ids: prior,
      state_summary: this.summary(),
    };
  }
}

function runtimeScenario(definition, sourceScenario) {
  const targets = [...new Set([
    ...(definition.faults || []).flatMap((fault) => (fault.effects || []).map((effect) => effect.target)),
    ...(definition.actions || []).map((action) => action.target),
  ].filter(Boolean))].sort();

  return {
    schema_version: "1.0.0",
    runtime_version: PUBLIC_SERVICE_RUNTIME_VERSION,
    scenario_id: definition.scenario_id,
    source_lab_id: null,
    source_scenario_id: definition.canonical_scenario_id,
    tier: "PUBLIC_SERVICE",
    title: definition.title,
    skills: clone(definition.competency_ids || []),
    mode: "SIMULATION",
    execution_target: "SANDBOX",
    live_control_allowed: false,
    target_selectors: targets,
    fault_injection: (definition.faults || []).map((fault) => ({ fault_id: fault.fault_id, active: false })),
    tasks: (definition.actions || []).map((action, index) => ({
      task_id: "PSC-TASK-" + String(index + 1).padStart(3, "0"),
      description: action.id,
    })),
    success_criteria: (sourceScenario.evidence || []).map((description, index) => ({
      criterion_id: "PSC-CRIT-" + String(index + 1).padStart(3, "0"),
      description,
      required: true,
    })),
    reset_contract: "restore Floor 1 public-service simulation baseline and discard synthetic case state",
    source_definition: clone(sourceScenario),
  };
}

export class PublicServiceExercise {
  constructor({
    definition,
    sourceScenario,
    pack,
    sources,
    session_id,
    actor_id = "learner",
    execution_target = "SANDBOX",
  }) {
    requireValue(definition.canonical_scenario_id === sourceScenario.id, "PUBLIC_SERVICE_SOURCE_MISMATCH", "definition/source scenario mismatch");
    requireValue(pack.mode === "SIMULATION", "NON_SIMULATION_SCENARIO", "Step 5 pack must remain SIMULATION");
    requireValue(pack.execution_target === "SANDBOX", "LIVE_CONTROL_FORBIDDEN", "Step 5 pack target must remain SANDBOX");
    requireValue(pack.live_control_allowed === false, "LIVE_CONTROL_FORBIDDEN", "Step 5 pack cannot allow live control");
    requireValue(definition.synthetic_case && definition.synthetic_case.synthetic_only === true, "REAL_PII_FORBIDDEN", "Step 5 requires synthetic cases");

    this.definition = clone(definition);
    this.sourceScenario = clone(sourceScenario);
    this.caseState = clone(definition.synthetic_case);
    this.sandbox = new PublicServiceState({ definition, pack, ...sources });
    this.scenario = runtimeScenario(definition, sourceScenario);
    this.session = new LabRuntimeSession({
      scenario: this.scenario,
      session_id: session_id || "STEP5::" + definition.scenario_id,
      actor_id,
      execution_target,
      sandbox: this.sandbox,
    });
    this.actionById = new Map(definition.actions.map((action) => [action.id, action]));
    this.successfulActionIds = new Set();
    this.history = [];
    this.seq = 0;
    this.initialFaultIds = (definition.faults || []).map((fault) => fault.fault_id).sort();
    this.unresolvedFaultIds = new Set(this.initialFaultIds);
  }

  start() {
    requireValue(this.session.phase === SESSION_STATES.CREATED, "INVALID_PUBLIC_SERVICE_TRANSITION", "exercise can only start from CREATED");
    this.session.start();
    return this.snapshot();
  }

  _record(action, status, details = {}) {
    const record = {
      action_seq: ++this.seq,
      action_id: action.id,
      action_type: action.type,
      status,
      ...clone(details),
    };
    this.history.push(record);
    return record;
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
    requireValue(this.session.phase === SESSION_STATES.RUNNING, "SESSION_NOT_RUNNING", "Step 5 exercise must be RUNNING");
    const action = this.actionById.get(actionId);
    requireValue(Boolean(action), "UNKNOWN_PUBLIC_SERVICE_ACTION", "unknown Step 5 action " + actionId);
    requireValue(action.live_control_allowed !== true, "LIVE_CONTROL_FORBIDDEN", "Step 5 action cannot request live control");

    const missing = (action.requires || []).filter((id) => !this.successfulActionIds.has(id));
    if (missing.length) {
      return this._record(action, "blocked", { correct: false, missing_action_ids: missing });
    }

    let event;
    if (action.type === "inspect") {
      event = this.session.inspect(action.target, "Step 5 public-service inspection");
    } else {
      event = this.session.perform(action.id, { target: action.target, detail: "Step 5 simulation-only action" });
    }

    let correct = true;
    if (Object.prototype.hasOwnProperty.call(action, "expected")) {
      correct = equal(input, action.expected);
    }
    if (action.type === "validate") {
      correct = correct && (action.requires_faults_absent || []).every((faultId) => !this.unresolvedFaultIds.has(faultId));
    }

    if (!correct) {
      return this._record(action, "incorrect", {
        correct: false,
        input: clone(input),
        runtime_event_seq: event?.event_seq || null,
      });
    }

    if (action.progress_updates) {
      Object.assign(this.caseState, clone(action.progress_updates));
    }

    for (const faultId of action.resolve_fault_ids || []) {
      requireValue(this.initialFaultIds.includes(faultId), "PUBLIC_SERVICE_FAULT_SCOPE_ERROR", "action tried to resolve out-of-scope fault " + faultId);
      this.unresolvedFaultIds.delete(faultId);
    }
    if ((action.resolve_fault_ids || []).length) this._recompose();

    this.successfulActionIds.add(action.id);
    return this._record(action, "success", {
      correct: true,
      runtime_event_seq: event?.event_seq || null,
      unresolved_fault_ids: [...this.unresolvedFaultIds].sort(),
      case_progress: clone(this.caseState),
    });
  }

  canComplete() {
    return this.definition.actions.every((action) => this.successfulActionIds.has(action.id)) &&
      this.unresolvedFaultIds.size === 0;
  }

  complete() {
    requireValue(this.canComplete(), "PUBLIC_SERVICE_INCOMPLETE", "Step 5 exercise is incomplete");

    for (const criterion of this.session.criteria) {
      if (!criterion.satisfied) {
        this.session.satisfyCriterion(criterion.criterion_id, {
          evidence_type: "public_service_synthetic_case",
          canonical_scenario_id: this.definition.canonical_scenario_id,
          scenario_id: this.definition.scenario_id,
          synthetic_case_id: this.caseState.case_id,
          synthetic_only: true,
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
      public_service_runtime_version: PUBLIC_SERVICE_RUNTIME_VERSION,
      scenario_id: this.definition.scenario_id,
      canonical_scenario_id: this.definition.canonical_scenario_id,
      title: this.definition.title,
      phase: this.session.phase,
      mode: "SIMULATION",
      execution_target: "SANDBOX",
      live_control_allowed: false,
      synthetic_case_only: true,
      credential_is_not_competency: true,
      federal_training_ids: clone(this.definition.federal_training_ids || []),
      competency_ids: clone(this.definition.competency_ids || []),
      successful_action_ids: [...this.successfulActionIds].sort(),
      unresolved_fault_ids: [...this.unresolvedFaultIds].sort(),
      can_complete: this.canComplete(),
      case_state: clone(this.caseState),
      action_history: clone(this.history),
      sandbox: this.sandbox.snapshot({ changed_only: true }),
    };
  }

  exportEvidence() {
    return { ...this.snapshot(), runtime_evidence: this.session.exportEvidence() };
  }
}

export function createPublicServiceExercise({
  pack,
  scenarioId,
  program,
  objectInventory,
  simulationObjects,
  session_id,
  actor_id = "learner",
  execution_target = "SANDBOX",
}) {
  const definition = pack.scenarios.find((scenario) => scenario.scenario_id === scenarioId);
  requireValue(Boolean(definition), "PUBLIC_SERVICE_SCENARIO_NOT_FOUND", "Step 5 scenario not found: " + scenarioId);
  const sourceScenario = program.scenarios.find((scenario) => scenario.id === definition.canonical_scenario_id);
  requireValue(Boolean(sourceScenario), "PUBLIC_SERVICE_SOURCE_NOT_FOUND", "canonical Floor 1 scenario not found: " + definition.canonical_scenario_id);

  return new PublicServiceExercise({
    definition,
    sourceScenario,
    pack,
    sources: { objectInventory, simulationObjects },
    session_id,
    actor_id,
    execution_target,
  });
}
