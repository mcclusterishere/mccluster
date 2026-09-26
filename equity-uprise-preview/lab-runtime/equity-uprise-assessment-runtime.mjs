import { LabRuntimeError, SESSION_STATES } from "./equity-uprise-lab-runtime.mjs";

export const ASSESSMENT_RUNTIME_VERSION = "1.0.0";

const EVIDENCE_CLASSES = Object.freeze([
  "training",
  "artifact",
  "performance",
  "applied",
  "reviewer",
]);

const AI_ASSISTANCE_VALUES = Object.freeze([
  "none",
  "assistive",
  "collaborative",
  "substantial_generation",
  "automated_workflow",
]);

const ASSISTANCE_LEVELS = Object.freeze([
  "independent",
  "supported",
  "directed",
  "leading",
]);

const CRITICAL_RUNTIME_CODES = new Set([
  "LIVE_CONTROL_FORBIDDEN",
  "REAL_PII_FORBIDDEN",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireValue(condition, code, message) {
  if (!condition) throw new LabRuntimeError(code, message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

const SHA256_K = Object.freeze([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);

function rotr(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256(value) {
  const input = new TextEncoder().encode(stableJson(value));
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 1 + 8) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(input);
  data[input.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a;
  let h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10)) >>> 0;
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }

    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = (rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;
    h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0;
  }

  return [h0,h1,h2,h3,h4,h5,h6,h7].map((part)=>part.toString(16).padStart(8,"0")).join("");
}

function unresolvedFaultIds(snapshot) {
  if (Array.isArray(snapshot?.unresolved_fault_ids)) return [...snapshot.unresolved_fault_ids].sort();
  if (typeof snapshot?.unresolved_fault_id === "string" && snapshot.unresolved_fault_id) {
    return [snapshot.unresolved_fault_id];
  }
  return [];
}

function scenarioIdentity(snapshot, exercise) {
  return {
    scenario_id: snapshot?.scenario_id || exercise?.scenario?.scenario_id || null,
    source_lab_id:
      snapshot?.source_lab_id ||
      exercise?.scenario?.source_lab_id ||
      exercise?.sourceLab?.lab_id ||
      null,
    source_scenario_id:
      snapshot?.canonical_scenario_id ||
      snapshot?.source_scenario_id ||
      exercise?.scenario?.source_scenario_id ||
      null,
    title: snapshot?.title || exercise?.definition?.title || exercise?.scenario?.title || null,
  };
}

function deriveCompetencyIds(exercise, explicitIds = []) {
  const snapshot = typeof exercise.snapshot === "function" ? exercise.snapshot() : {};
  const values = [
    ...explicitIds,
    ...(Array.isArray(snapshot?.competency_ids) ? snapshot.competency_ids : []),
    ...(Array.isArray(exercise?.definition?.competency_ids) ? exercise.definition.competency_ids : []),
  ];
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))].sort();
}

function deriveAssistanceLevel(hints) {
  if (hints.some((hint) => hint.level === "directed")) return "directed";
  if (hints.some((hint) => hint.level === "supported")) return "supported";
  return "independent";
}

function actionCounts(actions) {
  const counts = { success: 0, incorrect: 0, blocked: 0, error: 0 };
  for (const action of actions) {
    if (Object.prototype.hasOwnProperty.call(counts, action.status)) counts[action.status] += 1;
  }
  return counts;
}

function performanceSignal({ completed, counts, hints, criticalSafetyCount }) {
  if (criticalSafetyCount > 0) return "critical_safety_issue";
  if (!completed) return "incomplete";
  if (hints.length > 0) return "completed_with_support";
  if (counts.incorrect > 0 || counts.blocked > 0 || counts.error > 0) return "completed_with_recovery";
  return "clean_independent_run";
}

function automatedEvidenceSignal({ completed, criticalSafetyCount, assistanceLevel }) {
  if (!completed || criticalSafetyCount > 0) return "insufficient";
  if (assistanceLevel === "directed" || assistanceLevel === "supported") return "practicing_evidence";
  return "demonstrated_evidence_candidate";
}

function rubricMap(rubrics) {
  requireValue(rubrics && Array.isArray(rubrics.rubrics), "INVALID_RUBRIC_CATALOG", "rubrics.rubrics[] is required");
  return new Map(rubrics.rubrics.map((rubric) => [rubric.competency_id, rubric]));
}

function defaultClock() {
  return Date.now();
}

export class AssessedExercise {
  constructor({
    exercise,
    rubrics,
    competency_ids = [],
    clock = defaultClock,
    actor_id = "learner",
    ai_assistance = "none",
    assessment_id = null,
  }) {
    requireValue(exercise && typeof exercise === "object", "INVALID_ASSESSMENT_EXERCISE", "exercise is required");
    for (const method of ["start", "execute", "complete", "snapshot", "exportEvidence"]) {
      requireValue(typeof exercise[method] === "function", "INVALID_ASSESSMENT_EXERCISE", "exercise." + method + "() is required");
    }
    requireValue(typeof clock === "function", "INVALID_ASSESSMENT_CLOCK", "clock must be a function");
    requireValue(AI_ASSISTANCE_VALUES.includes(ai_assistance), "INVALID_AI_ASSISTANCE", "unsupported AI assistance declaration");

    this.exercise = exercise;
    this.rubrics = clone(rubrics);
    this.rubricByCompetency = rubricMap(rubrics);
    this.competencyIds = deriveCompetencyIds(exercise, competency_ids);
    requireValue(this.competencyIds.length > 0, "ASSESSMENT_COMPETENCY_REQUIRED", "at least one competency ID is required");
    for (const competencyId of this.competencyIds) {
      requireValue(this.rubricByCompetency.has(competencyId), "UNKNOWN_ASSESSMENT_COMPETENCY", "unknown competency rubric: " + competencyId);
    }

    this.clock = clock;
    this.actorId = actor_id;
    this.aiAssistance = ai_assistance;
    this.assessmentId = assessment_id || "ASSESS::" + (exercise.snapshot()?.scenario_id || "SCENARIO");
    this.actionSequence = [];
    this.hints = [];
    this.safetyViolations = [];
    this.producedEvidence = [];
    this.startedAtMs = null;
    this.completedAtMs = null;
    this.diagnosisElapsedMs = null;
    this.restorationElapsedMs = null;
    this.actionSeq = 0;
    this.hintSeq = 0;
    this.violationSeq = 0;
    this.evidenceSeq = 0;
  }

  _now() {
    const value = this.clock();
    requireValue(Number.isFinite(value), "INVALID_ASSESSMENT_CLOCK", "clock must return a finite millisecond value");
    return Number(value);
  }

  start() {
    requireValue(this.startedAtMs === null, "ASSESSMENT_ALREADY_STARTED", "assessment has already started");
    const started = this._now();
    const snapshot = this.exercise.start();
    requireValue(snapshot?.phase === SESSION_STATES.RUNNING, "ASSESSMENT_EXERCISE_NOT_RUNNING", "exercise failed to enter RUNNING");
    this.startedAtMs = started;
    return this.snapshot();
  }

  execute(actionId, input = {}) {
    requireValue(this.startedAtMs !== null, "ASSESSMENT_NOT_STARTED", "assessment must be started");
    requireValue(this.completedAtMs === null, "ASSESSMENT_ALREADY_COMPLETED", "assessment is already complete");

    const started = this._now();
    let result;
    try {
      result = this.exercise.execute(actionId, input);
    } catch (error) {
      const ended = this._now();
      const code = error instanceof LabRuntimeError ? error.code : "UNHANDLED_RUNTIME_ERROR";
      const record = {
        action_seq: ++this.actionSeq,
        action_id: actionId,
        action_type: null,
        status: "error",
        runtime_error_code: code,
        started_at_ms: started,
        ended_at_ms: ended,
        duration_ms: Math.max(0, ended - started),
      };
      this.actionSequence.push(record);
      if (CRITICAL_RUNTIME_CODES.has(code)) {
        this.recordSafetyViolation({
          code,
          severity: "critical",
          critical: true,
          description: "Runtime safety boundary rejected the attempted action.",
          related_action_id: actionId,
        });
      }
      throw error;
    }

    const ended = this._now();
    const snapshot = this.exercise.snapshot();
    const record = {
      action_seq: ++this.actionSeq,
      action_id: result?.action_id || actionId,
      action_type: result?.action_type || null,
      status: result?.status || "success",
      correct: result?.correct ?? (result?.status === "success"),
      started_at_ms: started,
      ended_at_ms: ended,
      duration_ms: Math.max(0, ended - started),
      unresolved_fault_ids: unresolvedFaultIds(snapshot),
    };
    this.actionSequence.push(record);

    if (
      this.diagnosisElapsedMs === null &&
      record.status === "success" &&
      record.action_type === "decision"
    ) {
      this.diagnosisElapsedMs = Math.max(0, ended - this.startedAtMs);
    }

    if (
      this.restorationElapsedMs === null &&
      record.status === "success" &&
      record.unresolved_fault_ids.length === 0
    ) {
      this.restorationElapsedMs = Math.max(0, ended - this.startedAtMs);
    }

    return clone(result);
  }

  requestHint({
    hint_id,
    level = "supported",
    reference = null,
  }) {
    requireValue(this.startedAtMs !== null, "ASSESSMENT_NOT_STARTED", "assessment must be started");
    requireValue(this.completedAtMs === null, "ASSESSMENT_ALREADY_COMPLETED", "assessment is already complete");
    requireValue(typeof hint_id === "string" && hint_id.trim(), "INVALID_HINT_ID", "hint_id is required");
    requireValue(["supported", "directed"].includes(level), "INVALID_HINT_LEVEL", "hint level must be supported or directed");

    const hint = {
      hint_seq: ++this.hintSeq,
      hint_id,
      level,
      reference,
      requested_at_ms: this._now(),
    };
    this.hints.push(hint);
    return clone(hint);
  }

  recordSafetyViolation({
    code,
    severity = "critical",
    critical = true,
    description,
    related_action_id = null,
  }) {
    requireValue(typeof code === "string" && code.trim(), "INVALID_SAFETY_VIOLATION", "safety violation code is required");
    requireValue(typeof description === "string" && description.trim(), "INVALID_SAFETY_VIOLATION", "safety violation description is required");
    requireValue(["warning", "major", "critical"].includes(severity), "INVALID_SAFETY_SEVERITY", "unsupported safety severity");

    const violation = {
      violation_seq: ++this.violationSeq,
      code,
      severity,
      critical: critical === true,
      description,
      related_action_id,
      recorded_at_ms: this._now(),
    };
    this.safetyViolations.push(violation);
    return clone(violation);
  }

  submitEvidence({
    evidence_id,
    evidence_class,
    title,
    reference,
    version = "1",
    content_sha256 = null,
    description = null,
  }) {
    requireValue(typeof evidence_id === "string" && evidence_id.trim(), "INVALID_EVIDENCE_ID", "evidence_id is required");
    requireValue(EVIDENCE_CLASSES.includes(evidence_class), "INVALID_EVIDENCE_CLASS", "unsupported evidence class");
    requireValue(typeof title === "string" && title.trim(), "INVALID_EVIDENCE_TITLE", "evidence title is required");
    requireValue(typeof reference === "string" && reference.trim(), "INVALID_EVIDENCE_REFERENCE", "evidence reference is required");
    requireValue(evidence_class !== "applied", "APPLIED_REQUIRES_AUTHENTIC_CONTEXT", "simulation evidence cannot be recorded as Applied evidence");
    requireValue(evidence_class !== "reviewer", "REVIEWER_EVIDENCE_REQUIRES_HUMAN_REVIEWER", "automated assessment cannot create reviewer evidence");
    if (content_sha256 !== null) {
      requireValue(/^[a-f0-9]{64}$/i.test(content_sha256), "INVALID_EVIDENCE_HASH", "content_sha256 must be a SHA-256 hex digest");
    }

    const item = {
      evidence_seq: ++this.evidenceSeq,
      evidence_id,
      evidence_class,
      title,
      description,
      reference,
      version,
      content_sha256,
      submitted_at_ms: this._now(),
      context: "simulation",
      actor_id: this.actorId,
    };
    this.producedEvidence.push(item);
    return clone(item);
  }

  complete() {
    requireValue(this.startedAtMs !== null, "ASSESSMENT_NOT_STARTED", "assessment must be started");
    requireValue(this.completedAtMs === null, "ASSESSMENT_ALREADY_COMPLETED", "assessment is already complete");

    const completedSnapshot = this.exercise.complete();
    const completedAt = this._now();
    this.completedAtMs = completedAt;

    const runtimeEvidence = this.exercise.exportEvidence();
    const runtimeEvidenceHash = sha256(runtimeEvidence);
    this.producedEvidence.push({
      evidence_seq: ++this.evidenceSeq,
      evidence_id: this.assessmentId + "::PERFORMANCE",
      evidence_class: "performance",
      title: "Deterministic lab performance record",
      description: "Runtime event ledger, action sequence, sandbox state, and completion evidence.",
      reference: "runtime-evidence://" + this.assessmentId,
      version: ASSESSMENT_RUNTIME_VERSION,
      content_sha256: runtimeEvidenceHash,
      submitted_at_ms: completedAt,
      context: "simulation",
      actor_id: this.actorId,
      system_generated: true,
    });

    return {
      completed_snapshot: clone(completedSnapshot),
      assessment: this.assessment(),
    };
  }

  assessment() {
    const exerciseSnapshot = this.exercise.snapshot();
    const completed = exerciseSnapshot?.phase === SESSION_STATES.COMPLETED || this.completedAtMs !== null;
    const counts = actionCounts(this.actionSequence);
    const criticalSafety = this.safetyViolations.filter((violation) => violation.critical);
    const assistanceLevel = deriveAssistanceLevel(this.hints);
    const signal = performanceSignal({
      completed,
      counts,
      hints: this.hints,
      criticalSafetyCount: criticalSafety.length,
    });
    const evidenceSignal = automatedEvidenceSignal({
      completed,
      criticalSafetyCount: criticalSafety.length,
      assistanceLevel,
    });

    const competencies = this.competencyIds.map((competencyId) => {
      const rubric = this.rubricByCompetency.get(competencyId);
      return {
        competency_id: competencyId,
        rubric_id: rubric.rubric_id,
        rubric_version: rubric.version,
        rubric_name: rubric.name,
        critical_criteria: rubric.criteria.filter((criterion) => criterion.critical).map((criterion) => criterion.name),
        criterion_scores: null,
        criterion_scoring_requires_qualified_review: true,
        evidence_context: "simulation",
        assistance_level: assistanceLevel,
        automated_evidence_signal: evidenceSignal,
        maximum_automated_competency_state: "Demonstrated",
        verified_awarded: false,
        applied_awarded: false,
        mentor_awarded: false,
        authorized_reviewer_required_for_verified: true,
      };
    });

    const payload = {
      assessment_runtime_version: ASSESSMENT_RUNTIME_VERSION,
      assessment_id: this.assessmentId,
      actor_id: this.actorId,
      ...scenarioIdentity(exerciseSnapshot, this.exercise),
      phase: exerciseSnapshot?.phase || null,
      context: "simulation",
      execution_target: "SANDBOX",
      live_control_allowed: false,
      ai_assistance: this.aiAssistance,
      assistance_level: assistanceLevel,
      action_metrics: {
        total: this.actionSequence.length,
        ...counts,
        incorrect_or_blocked: counts.incorrect + counts.blocked,
      },
      hints: {
        count: this.hints.length,
        records: clone(this.hints),
      },
      timing: {
        started_at_ms: this.startedAtMs,
        completed_at_ms: this.completedAtMs,
        elapsed_ms:
          this.startedAtMs !== null && this.completedAtMs !== null
            ? Math.max(0, this.completedAtMs - this.startedAtMs)
            : null,
        diagnosis_elapsed_ms: this.diagnosisElapsedMs,
        restoration_elapsed_ms: this.restorationElapsedMs,
      },
      safety: {
        violation_count: this.safetyViolations.length,
        critical_violation_count: criticalSafety.length,
        records: clone(this.safetyViolations),
        critical_violation_blocks_positive_automated_signal: true,
      },
      produced_evidence: clone(this.producedEvidence),
      produced_evidence_count: this.producedEvidence.length,
      performance_signal: signal,
      automated_evidence_signal: evidenceSignal,
      competencies,
      reviewer_gate: {
        level_1_automated_verifier_only: true,
        automated_verified_award_forbidden: true,
        verified_requires_authorized_human_reviewer: true,
        applied_requires_authentic_context: true,
        mentor_requires_applied_and_mentoring_evidence: true,
      },
      evidence_defense: {
        recommended:
          this.aiAssistance === "substantial_generation" ||
          this.aiAssistance === "automated_workflow",
        reason:
          this.aiAssistance === "substantial_generation" ||
          this.aiAssistance === "automated_workflow"
            ? "Material AI generation was declared; human understanding should be directly demonstrated."
            : null,
      },
    };

    return {
      ...payload,
      provenance: {
        assessment_sha256: sha256(payload),
        runtime_evidence_sha256:
          completed && typeof this.exercise.exportEvidence === "function"
            ? sha256(this.exercise.exportEvidence())
            : null,
        rubric_catalog_schema_version: this.rubrics.schema_version,
        rubric_catalog_status: this.rubrics.status,
      },
    };
  }

  snapshot() {
    return {
      assessment_id: this.assessmentId,
      started_at_ms: this.startedAtMs,
      completed_at_ms: this.completedAtMs,
      action_sequence: clone(this.actionSequence),
      hints: clone(this.hints),
      safety_violations: clone(this.safetyViolations),
      produced_evidence: clone(this.producedEvidence),
      current_assessment: this.assessment(),
    };
  }
}

export function createAssessedExercise(options) {
  return new AssessedExercise(options);
}

export const ASSESSMENT_ALLOWED_EVIDENCE_CLASSES = EVIDENCE_CLASSES;
export const ASSESSMENT_AI_ASSISTANCE_VALUES = AI_ASSISTANCE_VALUES;
export const ASSESSMENT_ASSISTANCE_LEVELS = ASSISTANCE_LEVELS;
