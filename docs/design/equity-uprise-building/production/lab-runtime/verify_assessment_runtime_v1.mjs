import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ASSESSMENT_RUNTIME_VERSION,
  createAssessedExercise,
} from "./equity-uprise-assessment-runtime.mjs";
import {
  createGuidedScenarioFromPack,
} from "./equity-uprise-guided-scenarios.mjs";
import {
  createBuildingOperationsExercise,
} from "./equity-uprise-building-ops-runtime.mjs";
import {
  createPublicServiceExercise,
} from "./equity-uprise-public-service-runtime.mjs";

function load(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function fakeClock(start = 1000, step = 100) {
  let now = start;
  return () => {
    const value = now;
    now += step;
    return value;
  };
}

const policy = load("./assessment-policy-v1.json");
const rubrics = load("../../../equity-uprise-development/competency-rubrics.json");

const cisaPack = load("./cisa-itot-scenario-pack-v1.json");
const labCatalog = load("../electronics/generated/equity-uprise-it-lab-catalog-v1.json");
const registry = load("../asset-registry/generated/equity-uprise-asset-registry-v1.json");
const connections = load("../electronics/generated/equity-uprise-electronics-connections-v1.json");
const manifest = load("../electronics/generated/equity-uprise-electronics-manifest-v1.json");

const opsPack = load("./fema-building-ops-scenario-pack-v1.json");
const program = load("../floor-01/floor-01-digital-twin-program.json");
const simulationObjects = load("../floor-01/floor-01-simulation-objects.json");
const objectInventory = load("../floor-01/floor-01-object-inventory.json");

const publicServicePack = load("./public-service-scenario-pack-v1.json");

assert.equal(ASSESSMENT_RUNTIME_VERSION, "1.0.0");
assert.equal(policy.status, "canonical-step6-assessment-policy-v1");
assert.equal(policy.state_boundaries.maximum_automated_competency_state, "Demonstrated");
assert.equal(policy.state_boundaries.level_1_automated_verifier_can_award_verified, false);
assert.equal(policy.state_boundaries.simulation_can_award_applied, false);
assert.equal(policy.state_boundaries.simulation_can_award_mentor, false);
assert.equal(rubrics.rubric_count, 42);

function createCisa029() {
  return createGuidedScenarioFromPack({
    pack: cisaPack,
    labCatalog,
    labId: "IT-LAB-029",
    electronics: { registry, connections, manifest },
    session_id: "STEP6::CISA029",
    actor_id: "ci-verifier",
  });
}

function runCisaClean() {
  const assessed = createAssessedExercise({
    exercise: createCisa029(),
    rubrics,
    competency_ids: ["CORE-05", "CORE-08", "OPS-01", "OPS-04"],
    clock: fakeClock(),
    actor_id: "ci-verifier",
    assessment_id: "ASSESS::STEP6::CISA029",
    ai_assistance: "none",
  });

  assessed.start();
  assessed.submitEvidence({
    evidence_id: "ART::STEP6::CISA029::001",
    evidence_class: "artifact",
    title: "IT/OT segmentation decision record",
    reference: "artifact://step6/cisa029/decision-record",
    version: "1",
    content_sha256: "a".repeat(64),
  });

  const definition = cisaPack.scenarios.find((scenario) => scenario.source_lab_id === "IT-LAB-029");
  for (const step of definition.verification_path) {
    const result = assessed.execute(step.action_id, step.input || {});
    assert.equal(result.status, "success");
  }

  const completed = assessed.complete();
  const report = completed.assessment;

  assert.equal(report.performance_signal, "clean_independent_run");
  assert.equal(report.automated_evidence_signal, "demonstrated_evidence_candidate");
  assert.equal(report.assistance_level, "independent");
  assert.equal(report.action_metrics.total, definition.verification_path.length);
  assert.equal(report.action_metrics.success, definition.verification_path.length);
  assert.equal(report.action_metrics.incorrect_or_blocked, 0);
  assert.equal(report.hints.count, 0);
  assert.equal(report.safety.violation_count, 0);
  assert.ok(report.timing.elapsed_ms > 0);
  assert.ok(report.timing.diagnosis_elapsed_ms > 0);
  assert.ok(report.timing.restoration_elapsed_ms >= report.timing.diagnosis_elapsed_ms);
  assert.equal(report.produced_evidence_count, 2);
  assert.equal(report.produced_evidence.some((item) => item.evidence_class === "performance"), true);
  assert.equal(report.produced_evidence.some((item) => item.evidence_class === "artifact"), true);
  assert.match(report.provenance.assessment_sha256, /^[a-f0-9]{64}$/);
  assert.match(report.provenance.runtime_evidence_sha256, /^[a-f0-9]{64}$/);

  for (const competency of report.competencies) {
    assert.equal(competency.maximum_automated_competency_state, "Demonstrated");
    assert.equal(competency.verified_awarded, false);
    assert.equal(competency.applied_awarded, false);
    assert.equal(competency.mentor_awarded, false);
    assert.equal(competency.criterion_scores, null);
    assert.equal(competency.criterion_scoring_requires_qualified_review, true);
    assert.equal(competency.authorized_reviewer_required_for_verified, true);
  }

  return report;
}

const cisaReportA = runCisaClean();
const cisaReportB = runCisaClean();
assert.deepEqual(cisaReportA, cisaReportB, "Step 6 clean assessment must replay deterministically");

{
  const exercise = createBuildingOperationsExercise({
    pack: opsPack,
    canonicalScenarioId: "power_interruption",
    program,
    simulationObjects,
    objectInventory,
    registry,
    session_id: "STEP6::POWER",
    actor_id: "ci-verifier",
  });
  const assessed = createAssessedExercise({
    exercise,
    rubrics,
    clock: fakeClock(5000, 125),
    actor_id: "ci-verifier",
    assessment_id: "ASSESS::STEP6::POWER",
  });

  assessed.start();

  const blocked = assessed.execute("power-plan", {
    response: "preserve_life_safety_comms_and_manual_fallback",
  });
  assert.equal(blocked.status, "blocked");

  assert.equal(assessed.execute("power-inspect", {}).status, "success");
  assert.equal(assessed.execute("power-interface", {}).status, "success");

  const wrong = assessed.execute("power-plan", { response: "ignore_outage" });
  assert.equal(wrong.status, "incorrect");

  assessed.requestHint({
    hint_id: "HINT-POWER-CONTINUITY-01",
    level: "supported",
    reference: "hint://step6/power/continuity-boundary",
  });

  assert.equal(
    assessed.execute("power-plan", {
      response: "preserve_life_safety_comms_and_manual_fallback",
    }).status,
    "success"
  );
  assert.equal(assessed.execute("power-restore", {}).status, "success");
  assert.equal(assessed.execute("power-validate", {}).status, "success");

  assert.throws(
    () => assessed.submitEvidence({
      evidence_id: "BAD-APPLIED",
      evidence_class: "applied",
      title: "Not authentic",
      reference: "artifact://bad/applied",
    }),
    (error) => error.code === "APPLIED_REQUIRES_AUTHENTIC_CONTEXT"
  );

  assert.throws(
    () => assessed.submitEvidence({
      evidence_id: "BAD-REVIEWER",
      evidence_class: "reviewer",
      title: "No human reviewer",
      reference: "artifact://bad/reviewer",
    }),
    (error) => error.code === "REVIEWER_EVIDENCE_REQUIRES_HUMAN_REVIEWER"
  );

  const report = assessed.complete().assessment;
  assert.equal(report.performance_signal, "completed_with_support");
  assert.equal(report.automated_evidence_signal, "practicing_evidence");
  assert.equal(report.assistance_level, "supported");
  assert.equal(report.action_metrics.blocked, 1);
  assert.equal(report.action_metrics.incorrect, 1);
  assert.equal(report.hints.count, 1);
  assert.ok(report.timing.diagnosis_elapsed_ms > 0);
  assert.ok(report.timing.restoration_elapsed_ms > 0);
  assert.deepEqual(
    report.competencies.map((item) => item.competency_id),
    ["CORE-05", "CORE-08", "OPS-01", "OPS-04"]
  );
}

{
  const exercise = createPublicServiceExercise({
    pack: publicServicePack,
    scenarioId: "EU-PSC-VITA-INTAKE-V1",
    program,
    objectInventory,
    simulationObjects,
    session_id: "STEP6::VITA",
    actor_id: "ci-verifier",
  });
  const assessed = createAssessedExercise({
    exercise,
    rubrics,
    clock: fakeClock(9000, 75),
    actor_id: "ci-verifier",
    assessment_id: "ASSESS::STEP6::VITA",
    ai_assistance: "substantial_generation",
  });

  assessed.start();
  assessed.recordSafetyViolation({
    code: "PRIVACY_BOUNDARY_BYPASS",
    severity: "critical",
    critical: true,
    description: "Synthetic exercise record: learner attempted to bypass the required privacy containment step.",
    related_action_id: "vita-contain-exposure",
  });

  const inputs = {
    "vita-contain-exposure": { response: "move_synthetic_materials_to_private_intake_and_secure_temporary_documents" },
    "vita-route-private": { location: "f1-intake-room" },
    "vita-scope-decision": { response: "escalate_to_certified_site_coordinator" },
    "vita-quality-handoff": { response: "require_independent_quality_review_before_completion" },
  };
  const definition = publicServicePack.scenarios.find((scenario) => scenario.scenario_id === "EU-PSC-VITA-INTAKE-V1");

  for (const action of definition.actions) {
    assert.equal(assessed.execute(action.id, inputs[action.id] || {}).status, "success");
  }

  const report = assessed.complete().assessment;
  assert.equal(report.performance_signal, "critical_safety_issue");
  assert.equal(report.automated_evidence_signal, "insufficient");
  assert.equal(report.safety.critical_violation_count, 1);
  assert.equal(report.evidence_defense.recommended, true);
  assert.deepEqual(
    report.competencies.map((item) => item.competency_id),
    ["CORE-07", "SHR-02"]
  );
  assert.equal(report.reviewer_gate.automated_verified_award_forbidden, true);
}

{
  const exercise = createCisa029();
  assert.throws(
    () => createAssessedExercise({
      exercise,
      rubrics,
      competency_ids: ["NOT-A-COMPETENCY"],
      clock: fakeClock(),
    }),
    (error) => error.code === "UNKNOWN_ASSESSMENT_COMPETENCY"
  );
}

console.log(JSON.stringify({
  status: "PASS",
  step: "lab-runtime-step6-assessment-evidence",
  assessment_runtime_version: ASSESSMENT_RUNTIME_VERSION,
  rubric_count_verified: rubrics.rubric_count,
  executable_runtime_families_verified: [
    "step3_cisa_itot",
    "step4_building_operations",
    "step5_public_service"
  ],
  action_sequence_capture: true,
  incorrect_action_capture: true,
  blocked_action_capture: true,
  hint_capture: true,
  timing_capture: true,
  diagnosis_timing: true,
  restoration_timing: true,
  safety_violation_capture: true,
  critical_safety_gate: true,
  produced_evidence_capture: true,
  evidence_hashing: true,
  competency_evidence_mapping: true,
  deterministic_replay: true,
  automated_verified_award_forbidden: true,
  simulation_applied_award_forbidden: true,
  reviewer_evidence_requires_human_reviewer: true,
  evidence_defense_recommendation_for_material_ai: true,
  live_control_allowed: false
}, null, 2));
