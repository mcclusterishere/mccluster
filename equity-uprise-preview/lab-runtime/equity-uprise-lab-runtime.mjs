export const LAB_RUNTIME_VERSION = "1.0.0";

export const SESSION_STATES = Object.freeze({
  CREATED: "CREATED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  RESET: "RESET",
});

export class LabRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LabRuntimeError";
    this.code = code;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireValue(condition, code, message) {
  if (!condition) throw new LabRuntimeError(code, message);
}

function requireString(value, code, label) {
  requireValue(typeof value === "string" && value.trim().length > 0, code, `${label} must be a non-empty string`);
}

function requireArray(value, code, label) {
  requireValue(Array.isArray(value), code, `${label} must be an array`);
}

function criterionId(index) {
  return `CRIT-${String(index + 1).padStart(3, "0")}`;
}

function taskId(index) {
  return `TASK-${String(index + 1).padStart(3, "0")}`;
}

export function adaptCatalogLab(lab) {
  requireValue(lab && typeof lab === "object", "INVALID_LAB", "lab must be an object");
  requireString(lab.lab_id, "INVALID_LAB_ID", "lab_id");
  requireString(lab.title, "INVALID_LAB_TITLE", "title");
  requireString(lab.tier, "INVALID_LAB_TIER", "tier");
  requireValue(lab.mode === "SIMULATION", "NON_SIMULATION_LAB", `${lab.lab_id} must remain SIMULATION`);
  requireValue(lab.live_control_allowed === false, "LIVE_CONTROL_FORBIDDEN", `${lab.lab_id} cannot allow live control`);

  for (const key of ["skills", "fault_injection", "target_selectors", "student_tasks", "success_criteria"]) {
    requireArray(lab[key], "INVALID_LAB_SHAPE", `${lab.lab_id}.${key}`);
  }

  const faults = lab.fault_injection
    .filter((item) => typeof item === "string" && item.trim() && item !== "none")
    .map((fault_id) => ({ fault_id, active: false }));

  return {
    schema_version: "1.0.0",
    runtime_version: LAB_RUNTIME_VERSION,
    scenario_id: `EU-LAB::${lab.lab_id}::V1`,
    source_lab_id: lab.lab_id,
    tier: lab.tier,
    title: lab.title,
    skills: clone(lab.skills),
    mode: "SIMULATION",
    execution_target: "SANDBOX",
    live_control_allowed: false,
    target_selectors: clone(lab.target_selectors),
    fault_injection: faults,
    tasks: lab.student_tasks.map((description, index) => ({
      task_id: taskId(index),
      description,
    })),
    success_criteria: lab.success_criteria.map((description, index) => ({
      criterion_id: criterionId(index),
      description,
      required: true,
    })),
    reset_contract: lab.reset || "restore baseline",
    source_definition: clone(lab),
  };
}

export class LabRuntimeSession {
  constructor({ scenario, session_id, actor_id = "learner", execution_target = "SANDBOX", sandbox = null }) {
    requireValue(scenario && typeof scenario === "object", "INVALID_SCENARIO", "scenario is required");
    requireString(session_id, "INVALID_SESSION_ID", "session_id");
    requireString(actor_id, "INVALID_ACTOR_ID", "actor_id");
    requireValue(execution_target === "SANDBOX", "LIVE_CONTROL_FORBIDDEN", "Lab Runtime execution target must be SANDBOX");
    requireValue(scenario.mode === "SIMULATION", "NON_SIMULATION_SCENARIO", "scenario mode must be SIMULATION");
    requireValue(scenario.live_control_allowed === false, "LIVE_CONTROL_FORBIDDEN", "scenario cannot allow live control");

    this.scenario = clone(scenario);
    this.session_id = session_id;
    this.actor_id = actor_id;
    this.execution_target = "SANDBOX";
    this.sandbox = sandbox;
    if (this.sandbox) {
      requireValue(typeof this.sandbox.bindScenario === "function", "INVALID_SANDBOX", "sandbox.bindScenario() is required");
      requireValue(typeof this.sandbox.injectFault === "function", "INVALID_SANDBOX", "sandbox.injectFault() is required");
      requireValue(typeof this.sandbox.inspect === "function", "INVALID_SANDBOX", "sandbox.inspect() is required");
      requireValue(typeof this.sandbox.reset === "function", "INVALID_SANDBOX", "sandbox.reset() is required");
      requireValue(typeof this.sandbox.summary === "function", "INVALID_SANDBOX", "sandbox.summary() is required");
      this.sandbox.bindScenario(this.scenario);
    }
    this.phase = SESSION_STATES.CREATED;
    this.event_seq = 0;
    this.events = [];
    this.criteria = this.scenario.success_criteria.map((criterion) => ({
      ...clone(criterion),
      satisfied: false,
      evidence: [],
    }));
    this.faults = this.scenario.fault_injection.map((fault) => ({
      ...clone(fault),
      active: false,
    }));
  }

  #record(event_type, payload = {}) {
    const event = {
      event_seq: ++this.event_seq,
      event_type,
      phase: this.phase,
      actor_id: this.actor_id,
      ...clone(payload),
    };
    this.events.push(event);
    return clone(event);
  }

  #requireRunning() {
    requireValue(this.phase === SESSION_STATES.RUNNING, "SESSION_NOT_RUNNING", `session is ${this.phase}, expected RUNNING`);
  }

  start() {
    requireValue(
      this.phase === SESSION_STATES.CREATED || this.phase === SESSION_STATES.RESET,
      "INVALID_SESSION_TRANSITION",
      `cannot start from ${this.phase}`
    );
    this.phase = SESSION_STATES.RUNNING;
    this.#record("SESSION_STARTED", {
      scenario_id: this.scenario.scenario_id,
      source_lab_id: this.scenario.source_lab_id,
      execution_target: "SANDBOX",
      live_control_allowed: false,
    });
    for (const fault of this.faults) {
      fault.active = true;
      const binding = this.sandbox
        ? this.sandbox.injectFault(fault.fault_id, { target_selectors: this.scenario.target_selectors })
        : null;
      this.#record("FAULT_INJECTED", {
        fault_id: fault.fault_id,
        abstract_only: !this.sandbox,
        binding,
      });
    }
    return this.snapshot();
  }

  inspect(target, detail = "") {
    this.#requireRunning();
    requireString(target, "INVALID_TARGET", "target");
    const sandbox_observation = this.sandbox ? this.sandbox.inspect(target) : null;
    return this.#record("INSPECTION_RECORDED", {
      target,
      detail: String(detail || ""),
      sandbox_observation,
    });
  }

  perform(action, { target = null, detail = "", live_control_requested = false } = {}) {
    this.#requireRunning();
    requireString(action, "INVALID_ACTION", "action");
    requireValue(live_control_requested === false, "LIVE_CONTROL_FORBIDDEN", "live-control action requests are forbidden");
    return this.#record("SIMULATED_ACTION_RECORDED", {
      action,
      target,
      detail: String(detail || ""),
      execution_target: "SANDBOX",
    });
  }

  satisfyCriterion(criterion_id, evidence = {}) {
    this.#requireRunning();
    const criterion = this.criteria.find((item) => item.criterion_id === criterion_id);
    requireValue(Boolean(criterion), "UNKNOWN_CRITERION", `unknown criterion ${criterion_id}`);
    criterion.satisfied = true;
    criterion.evidence.push(clone(evidence));
    return this.#record("CRITERION_SATISFIED", {
      criterion_id,
      evidence: clone(evidence),
    });
  }

  evaluate() {
    const required = this.criteria.filter((criterion) => criterion.required !== false);
    const satisfied = required.filter((criterion) => criterion.satisfied);
    return {
      passed: required.length === satisfied.length,
      required_count: required.length,
      satisfied_count: satisfied.length,
      pending_criterion_ids: required.filter((criterion) => !criterion.satisfied).map((criterion) => criterion.criterion_id),
      phase: this.phase,
    };
  }

  complete() {
    this.#requireRunning();
    const evaluation = this.evaluate();
    requireValue(evaluation.passed, "CRITERIA_INCOMPLETE", "all required success criteria must be satisfied before completion");
    this.phase = SESSION_STATES.COMPLETED;
    this.#record("SESSION_COMPLETED", {
      passed: true,
      required_count: evaluation.required_count,
      satisfied_count: evaluation.satisfied_count,
    });
    return this.snapshot();
  }

  reset() {
    requireValue(
      [SESSION_STATES.CREATED, SESSION_STATES.RUNNING, SESSION_STATES.COMPLETED, SESSION_STATES.RESET].includes(this.phase),
      "INVALID_SESSION_TRANSITION",
      `cannot reset from ${this.phase}`
    );
    const sandbox_reset = this.sandbox ? this.sandbox.reset() : null;
    for (const fault of this.faults) fault.active = false;
    for (const criterion of this.criteria) {
      criterion.satisfied = false;
      criterion.evidence = [];
    }
    this.phase = SESSION_STATES.RESET;
    this.#record("SESSION_RESET", {
      reset_contract: this.scenario.reset_contract,
      baseline_restored: true,
      sandbox_reset,
    });
    return this.snapshot();
  }

  snapshot() {
    return {
      runtime_version: LAB_RUNTIME_VERSION,
      session_id: this.session_id,
      scenario_id: this.scenario.scenario_id,
      source_lab_id: this.scenario.source_lab_id,
      actor_id: this.actor_id,
      execution_target: this.execution_target,
      live_control_allowed: false,
      phase: this.phase,
      faults: clone(this.faults),
      criteria: clone(this.criteria),
      evaluation: this.evaluate(),
      sandbox_summary: this.sandbox ? this.sandbox.summary() : null,
      event_count: this.events.length,
    };
  }

  exportEvidence() {
    return {
      ...this.snapshot(),
      sandbox_state: this.sandbox && typeof this.sandbox.snapshot === "function"
        ? this.sandbox.snapshot({ changed_only: true })
        : null,
      events: clone(this.events),
    };
  }
}

export function createSessionFromCatalogLab(lab, {
  session_id = `SIM::${lab?.lab_id || "UNKNOWN"}::001`,
  actor_id = "learner",
  execution_target = "SANDBOX",
  sandbox = null,
} = {}) {
  return new LabRuntimeSession({
    scenario: adaptCatalogLab(lab),
    session_id,
    actor_id,
    execution_target,
    sandbox,
  });
}
