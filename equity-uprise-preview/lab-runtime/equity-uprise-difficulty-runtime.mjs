import { LabRuntimeError } from "./equity-uprise-lab-runtime.mjs";

export const DIFFICULTY_RUNTIME_VERSION = "1.0.0";

const clone = (value) => JSON.parse(JSON.stringify(value));
const requireValue = (condition, code, message) => {
  if (!condition) throw new LabRuntimeError(code, message);
};

function actionDefinitionList(assessed) {
  const actions = assessed?.exercise?.definition?.actions || [];
  return actions.map((action) => ({
    action_id: action.action_id || action.id,
    action_type: action.action_type || action.type || null,
    target: action.target_selector || action.target || null,
    requires: clone(action.requires_action_ids || action.requires || []),
    observation: clone(action.observation || null),
  }));
}

function initialFaultIds(assessed) {
  const exercise = assessed.exercise;
  if (Array.isArray(exercise.initialFaultIds)) return [...exercise.initialFaultIds].sort();
  if (typeof exercise.unresolvedFault === "string" && exercise.unresolvedFault) return [exercise.unresolvedFault];
  if (Array.isArray(exercise.definition?.fault_injection)) {
    return exercise.definition.fault_injection
      .map((item) => typeof item === "string" ? item : item?.fault_id)
      .filter(Boolean)
      .sort();
  }
  if (typeof exercise.definition?.fault_id === "string") return [exercise.definition.fault_id];
  return [];
}

function objectiveList(assessed) {
  const objectives = assessed?.exercise?.definition?.objectives;
  if (Array.isArray(objectives) && objectives.length) return clone(objectives);
  const actions = actionDefinitionList(assessed);
  return [{
    objective_id: "SCENARIO-COMPLETION",
    description: "Complete the canonical scenario successfully.",
    required_action_ids: actions.map((action) => action.action_id),
  }];
}

function summarizeObjectives(objectives, mode) {
  if (mode === "hidden") return null;
  if (mode === "count") return { objective_count: objectives.length };
  if (mode === "summary") {
    return objectives.map((objective) => ({
      objective_id: objective.objective_id,
      description: objective.description || null,
    }));
  }
  return clone(objectives);
}

function summarizeActions(actions, mode) {
  if (mode === "full") {
    return actions.map((action) => ({
      action_id: action.action_id,
      action_type: action.action_type,
      target: action.target,
      requires: clone(action.requires),
      observation: clone(action.observation),
    }));
  }
  if (mode === "targeted") {
    return actions.map((action) => ({
      action_id: action.action_id,
      action_type: action.action_type,
      target: action.target,
      prerequisite_count: action.requires.length,
    }));
  }
  if (mode === "typed") {
    return actions.map((action) => ({
      action_id: action.action_id,
      action_type: action.action_type,
    }));
  }
  return actions.map((action) => ({ action_id: action.action_id }));
}

function summarizeFaults(ids, mode) {
  if (mode === "hidden") return null;
  if (mode === "count") return { active_fault_count: ids.length };
  return { active_fault_ids: [...ids] };
}

function sanitizeResult(result, mode) {
  if (mode === "full") return clone(result);
  if (mode === "standard") {
    const copy = clone(result);
    delete copy.input;
    return copy;
  }

  const reduced = {
    action_id: result?.action_id || null,
    action_type: result?.action_type || null,
    status: result?.status || null,
    correct: result?.correct ?? (result?.status === "success"),
  };

  if (mode === "reduced") {
    if (Array.isArray(result?.unresolved_fault_ids)) {
      reduced.unresolved_fault_count = result.unresolved_fault_ids.length;
    } else if (Object.prototype.hasOwnProperty.call(result || {}, "unresolved_fault_id")) {
      reduced.unresolved_fault_count = result.unresolved_fault_id ? 1 : 0;
    }
  }
  return reduced;
}

function learnerArtifactCount(assessed) {
  return (assessed.producedEvidence || []).filter(
    (item) => item.evidence_class === "artifact" && item.system_generated !== true
  ).length;
}

export class DifficultyProgressionExercise {
  constructor({ assessed, policy, level }) {
    requireValue(assessed && typeof assessed === "object", "INVALID_DIFFICULTY_ASSESSMENT", "assessed exercise is required");
    for (const method of ["start","execute","requestHint","submitEvidence","complete","assessment"]) {
      requireValue(typeof assessed[method] === "function", "INVALID_DIFFICULTY_ASSESSMENT", "assessed." + method + "() is required");
    }
    requireValue(policy && Array.isArray(policy.order) && policy.profiles, "INVALID_DIFFICULTY_POLICY", "difficulty policy is required");
    requireValue(policy.order.includes(level), "UNKNOWN_DIFFICULTY_LEVEL", "unknown difficulty level " + level);

    this.assessed = assessed;
    this.policy = clone(policy);
    this.level = level;
    this.profile = clone(policy.profiles[level]);
    this.actions = actionDefinitionList(assessed);
    this.objectives = objectiveList(assessed);
    this.initialFaultIds = initialFaultIds(assessed);
    this.started = false;
    this.completed = false;
    this.hintsUsed = 0;
  }

  start() {
    requireValue(!this.started, "DIFFICULTY_ALREADY_STARTED", "difficulty exercise already started");
    this.assessed.start();
    this.started = true;
    return this.learnerView();
  }

  learnerView() {
    return {
      difficulty_runtime_version: DIFFICULTY_RUNTIME_VERSION,
      level: this.level,
      ordinal: this.profile.ordinal,
      intent: this.profile.intent,
      scenario_id: this.assessed.exercise.snapshot()?.scenario_id || null,
      title: this.assessed.exercise.snapshot()?.title || this.assessed.exercise.definition?.title || null,
      objective_view: summarizeObjectives(this.objectives, this.profile.objective_visibility),
      action_view: summarizeActions(this.actions, this.profile.action_visibility),
      available_action_ids: this.actions.map((action) => action.action_id),
      fault_view: summarizeFaults(this.initialFaultIds, this.profile.fault_visibility),
      hint_policy: {
        budget: this.profile.hint_budget,
        used: this.hintsUsed,
        remaining: Math.max(0, this.profile.hint_budget - this.hintsUsed),
        allowed_levels: clone(this.profile.allowed_hint_levels),
      },
      evidence_expectation: {
        minimum_learner_artifacts: this.profile.minimum_learner_artifacts,
        current_learner_artifacts: learnerArtifactCount(this.assessed),
      },
      complexity_expectation: {
        minimum_initial_faults: this.profile.minimum_initial_faults,
        actual_initial_faults: this.initialFaultIds.length,
        expert_cascade_required: this.profile.expert_cascade_required === true,
      },
      invariants: clone(this.policy.invariants),
    };
  }

  execute(actionId, input = {}) {
    requireValue(this.started && !this.completed, "DIFFICULTY_NOT_RUNNING", "difficulty exercise must be running");
    return sanitizeResult(this.assessed.execute(actionId, input), this.profile.result_visibility);
  }

  requestHint({ hint_id, level = "supported", reference = null }) {
    requireValue(this.started && !this.completed, "DIFFICULTY_NOT_RUNNING", "difficulty exercise must be running");
    requireValue(this.hintsUsed < this.profile.hint_budget, "DIFFICULTY_HINT_BUDGET_EXHAUSTED", "no hints remain at " + this.level);
    requireValue(this.profile.allowed_hint_levels.includes(level), "DIFFICULTY_HINT_LEVEL_FORBIDDEN", level + " hints are not allowed at " + this.level);
    const hint = this.assessed.requestHint({ hint_id, level, reference });
    this.hintsUsed += 1;
    return {
      ...clone(hint),
      difficulty_level: this.level,
      hints_remaining: Math.max(0, this.profile.hint_budget - this.hintsUsed),
    };
  }

  submitEvidence(evidence) {
    requireValue(this.started && !this.completed, "DIFFICULTY_NOT_RUNNING", "difficulty exercise must be running");
    return this.assessed.submitEvidence(evidence);
  }

  qualification() {
    const report = this.assessed.assessment();
    const artifactCount = learnerArtifactCount(this.assessed);
    const criticalSafetyCount = report.safety?.critical_violation_count || 0;
    const checks = {
      scenario_complexity_met: this.initialFaultIds.length >= this.profile.minimum_initial_faults,
      learner_artifact_requirement_met: artifactCount >= this.profile.minimum_learner_artifacts,
      hint_budget_met: this.hintsUsed <= this.profile.hint_budget,
      critical_safety_clear: criticalSafetyCount === 0,
      exercise_completed: report.phase === "COMPLETED",
    };
    return {
      level: this.level,
      ordinal: this.profile.ordinal,
      qualified: Object.values(checks).every(Boolean),
      checks,
      initial_fault_count: this.initialFaultIds.length,
      learner_artifact_count: artifactCount,
      hints_used: this.hintsUsed,
      performance_signal: report.performance_signal,
      automated_evidence_signal: report.automated_evidence_signal,
      maximum_automated_competency_state: "Demonstrated",
      verified_awarded: false,
    };
  }

  complete() {
    requireValue(this.started && !this.completed, "DIFFICULTY_NOT_RUNNING", "difficulty exercise must be running");
    const completed = this.assessed.complete();
    this.completed = true;
    return {
      completed_assessment: clone(completed.assessment),
      difficulty_qualification: this.qualification(),
      learner_view: this.learnerView(),
    };
  }

  snapshot() {
    return {
      difficulty_runtime_version: DIFFICULTY_RUNTIME_VERSION,
      level: this.level,
      started: this.started,
      completed: this.completed,
      initial_fault_ids: [...this.initialFaultIds],
      hints_used: this.hintsUsed,
      learner_view: this.learnerView(),
      qualification: this.qualification(),
    };
  }
}

export function createDifficultyProgressionExercise(options) {
  return new DifficultyProgressionExercise(options);
}
