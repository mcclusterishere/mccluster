import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LabRuntimeError } from "./equity-uprise-lab-runtime.mjs";
import { createAssessedExercise } from "./equity-uprise-assessment-runtime.mjs";
import {
  DIFFICULTY_RUNTIME_VERSION,
  createDifficultyProgressionExercise,
} from "./equity-uprise-difficulty-runtime.mjs";
import { createGuidedScenarioFromPack } from "./equity-uprise-guided-scenarios.mjs";
import { createBuildingOperationsExercise } from "./equity-uprise-building-ops-runtime.mjs";
import { createPublicServiceExercise } from "./equity-uprise-public-service-runtime.mjs";

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

const policy = load("./difficulty-progression-policy-v1.json");
const rubrics = load("../../../equity-uprise-development/competency-rubrics.json");
const cisaPack = load("./cisa-itot-scenario-pack-v1.json");
const labCatalog = load("../electronics/generated/equity-uprise-it-lab-catalog-v1.json");
const registry = load("../asset-registry/generated/equity-uprise-asset-registry-v1.json");
const connections = load("../electronics/generated/equity-uprise-electronics-connections-v1.json");
const manifest = load("../electronics/generated/equity-uprise-electronics-manifest-v1.json");
const opsPack = load("./fema-building-ops-scenario-pack-v1.json");
const publicServicePack = load("./public-service-scenario-pack-v1.json");
const program = load("../floor-01/floor-01-digital-twin-program.json");
const simulationObjects = load("../floor-01/floor-01-simulation-objects.json");
const objectInventory = load("../floor-01/floor-01-object-inventory.json");

assert.equal(DIFFICULTY_RUNTIME_VERSION, "1.0.0");
assert.equal(policy.status, "canonical-step7-difficulty-progression-v1");
assert.deepEqual(policy.order, ["FOUNDATION","TECHNICIAN","ADMIN","ADVANCED","EXPERT"]);
assert.equal(policy.invariants.live_control_allowed, false);
assert.equal(policy.invariants.difficulty_does_not_award_verified, true);

function cisaExercise(labId, assessmentId, competencyIds) {
  const exercise = createGuidedScenarioFromPack({
    pack: cisaPack,
    labCatalog,
    labId,
    electronics: { registry, connections, manifest },
    session_id: assessmentId + "::SESSION",
    actor_id: "ci-verifier",
  });
  return createAssessedExercise({
    exercise,
    rubrics,
    competency_ids: competencyIds,
    clock: fakeClock(),
    actor_id: "ci-verifier",
    assessment_id: assessmentId,
  });
}

function opsExercise(canonicalScenarioId, assessmentId) {
  const exercise = createBuildingOperationsExercise({
    pack: opsPack,
    canonicalScenarioId,
    program,
    simulationObjects,
    objectInventory,
    registry,
    session_id: assessmentId + "::SESSION",
    actor_id: "ci-verifier",
  });
  return createAssessedExercise({
    exercise,
    rubrics,
    clock: fakeClock(5000, 125),
    actor_id: "ci-verifier",
    assessment_id: assessmentId,
  });
}

function publicServiceExercise(scenarioId, assessmentId) {
  const exercise = createPublicServiceExercise({
    pack: publicServicePack,
    scenarioId,
    program,
    objectInventory,
    simulationObjects,
    session_id: assessmentId + "::SESSION",
    actor_id: "ci-verifier",
  });
  return createAssessedExercise({
    exercise,
    rubrics,
    clock: fakeClock(9000, 75),
    actor_id: "ci-verifier",
    assessment_id: assessmentId,
  });
}

function runCisa(diff, labId) {
  const definition = cisaPack.scenarios.find((scenario) => scenario.source_lab_id === labId);
  for (const step of definition.verification_path) {
    assert.equal(diff.execute(step.action_id, step.input || {}).status, "success");
  }
}

function runOps(diff, canonicalScenarioId) {
  const definition = opsPack.scenarios.find((scenario) => scenario.canonical_scenario_id === canonicalScenarioId);
  for (const action of definition.actions) {
    assert.equal(diff.execute(action.id, action.expected || {}).status, "success");
  }
}

function runPublic(diff, scenarioId) {
  const definition = publicServicePack.scenarios.find((scenario) => scenario.scenario_id === scenarioId);
  for (const action of definition.actions) {
    assert.equal(diff.execute(action.id, action.expected || {}).status, "success");
  }
}

function addArtifact(diff, id) {
  diff.submitEvidence({
    evidence_id: id,
    evidence_class: "artifact",
    title: "Difficulty progression learner artifact " + id,
    reference: "artifact://step7/" + id.toLowerCase(),
    version: "1",
    content_sha256: "b".repeat(64),
  });
}

// FOUNDATION: full guidance, names visible, directed hint permitted.
{
  const diff = createDifficultyProgressionExercise({
    assessed: opsExercise("basic_evacuation", "ASSESS::STEP7::FOUNDATION"),
    policy,
    level: "FOUNDATION",
  });
  const view = diff.start();
  assert.equal(Array.isArray(view.objective_view), true);
  assert.ok(view.action_view.every((action) => Object.prototype.hasOwnProperty.call(action, "target")));
  assert.ok(view.action_view.every((action) => Object.prototype.hasOwnProperty.call(action, "requires")));
  assert.ok(Array.isArray(view.fault_view.active_fault_ids));
  const hint = diff.requestHint({ hint_id: "FOUNDATION-DIRECTED-01", level: "directed", reference: "hint://step7/foundation" });
  assert.equal(hint.hints_remaining, 2);
  runOps(diff, "basic_evacuation");
  const result = diff.complete();
  assert.equal(result.difficulty_qualification.qualified, true);
  assert.equal(result.difficulty_qualification.level, "FOUNDATION");
  assert.equal(result.completed_assessment.maximum_automated_competency_state, undefined);
  assert.ok(result.completed_assessment.competencies.every((item) => item.verified_awarded === false));
}

// TECHNICIAN: fault count only and no directed hints.
{
  const diff = createDifficultyProgressionExercise({
    assessed: cisaExercise("IT-LAB-029", "ASSESS::STEP7::TECHNICIAN", ["CORE-05"]),
    policy,
    level: "TECHNICIAN",
  });
  const view = diff.start();
  assert.equal(view.fault_view.active_fault_count, 1);
  assert.ok(view.action_view.every((action) => Object.prototype.hasOwnProperty.call(action, "target")));
  assert.ok(view.action_view.every((action) => !Object.prototype.hasOwnProperty.call(action, "observation")));
  assert.throws(
    () => diff.requestHint({ hint_id: "BAD-DIRECTED", level: "directed" }),
    (error) => error instanceof LabRuntimeError && error.code === "DIFFICULTY_HINT_LEVEL_FORBIDDEN"
  );
  diff.requestHint({ hint_id: "TECH-SUPPORTED-01", level: "supported", reference: "hint://step7/technician" });
  runCisa(diff, "IT-LAB-029");
  assert.equal(diff.complete().difficulty_qualification.qualified, true);
}

// ADMIN: no target guidance, one learner artifact required.
{
  const diff = createDifficultyProgressionExercise({
    assessed: opsExercise("power_interruption", "ASSESS::STEP7::ADMIN"),
    policy,
    level: "ADMIN",
  });
  const view = diff.start();
  assert.deepEqual(view.objective_view, { objective_count: 1 });
  assert.ok(view.action_view.every((action) => !Object.prototype.hasOwnProperty.call(action, "target")));
  assert.equal(view.evidence_expectation.minimum_learner_artifacts, 1);
  addArtifact(diff, "ADMIN-ARTIFACT-001");
  runOps(diff, "power_interruption");
  const result = diff.complete();
  assert.equal(result.difficulty_qualification.qualified, true);
  assert.equal(result.difficulty_qualification.learner_artifact_count, 1);
}

// ADVANCED: fault identity hidden, action IDs only, one artifact required.
{
  const diff = createDifficultyProgressionExercise({
    assessed: publicServiceExercise("EU-PSC-VITA-INTAKE-V1", "ASSESS::STEP7::ADVANCED"),
    policy,
    level: "ADVANCED",
  });
  const view = diff.start();
  assert.equal(view.fault_view, null);
  assert.ok(view.action_view.every((action) => Object.keys(action).length === 1 && action.action_id));
  assert.equal(view.hint_policy.budget, 1);
  addArtifact(diff, "ADVANCED-ARTIFACT-001");
  runPublic(diff, "EU-PSC-VITA-INTAKE-V1");
  const result = diff.complete();
  assert.equal(result.difficulty_qualification.qualified, true);
  assert.equal(result.difficulty_qualification.maximum_automated_competency_state, "Demonstrated");
  assert.equal(result.difficulty_qualification.verified_awarded, false);
}

// EXPERT: multi-fault scenario, no hints, two learner artifacts, minimal result disclosure.
{
  const diff = createDifficultyProgressionExercise({
    assessed: cisaExercise(
      "IT-LAB-039",
      "ASSESS::STEP7::EXPERT",
      ["CORE-05","CORE-08","OPS-01","OPS-04"]
    ),
    policy,
    level: "EXPERT",
  });
  const view = diff.start();
  assert.equal(view.objective_view, null);
  assert.equal(view.fault_view, null);
  assert.equal(view.complexity_expectation.minimum_initial_faults, 2);
  assert.equal(view.complexity_expectation.actual_initial_faults, 3);
  assert.equal(view.hint_policy.budget, 0);
  assert.throws(
    () => diff.requestHint({ hint_id: "EXPERT-NO-HINT" }),
    (error) => error instanceof LabRuntimeError && error.code === "DIFFICULTY_HINT_BUDGET_EXHAUSTED"
  );
  addArtifact(diff, "EXPERT-ARTIFACT-001");
  addArtifact(diff, "EXPERT-ARTIFACT-002");
  const definition = cisaPack.scenarios.find((scenario) => scenario.source_lab_id === "IT-LAB-039");
  for (const step of definition.verification_path) {
    const result = diff.execute(step.action_id, step.input || {});
    assert.deepEqual(Object.keys(result).sort(), ["action_id","action_type","correct","status"].sort());
    assert.equal(result.status, "success");
  }
  const result = diff.complete();
  assert.equal(result.difficulty_qualification.qualified, true);
  assert.equal(result.difficulty_qualification.initial_fault_count, 3);
  assert.equal(result.difficulty_qualification.learner_artifact_count, 2);
}

// An easy one-fault scenario cannot qualify as EXPERT even if completed perfectly with two artifacts.
{
  const diff = createDifficultyProgressionExercise({
    assessed: cisaExercise("IT-LAB-029", "ASSESS::STEP7::EXPERT-REJECT", ["CORE-05"]),
    policy,
    level: "EXPERT",
  });
  diff.start();
  addArtifact(diff, "EXPERT-REJECT-001");
  addArtifact(diff, "EXPERT-REJECT-002");
  runCisa(diff, "IT-LAB-029");
  const result = diff.complete();
  assert.equal(result.difficulty_qualification.qualified, false);
  assert.equal(result.difficulty_qualification.checks.scenario_complexity_met, false);
  assert.equal(result.difficulty_qualification.initial_fault_count, 1);
}

// Views must monotonically disclose less scenario guidance.
{
  const views = [];
  for (const level of policy.order) {
    const assessed = cisaExercise("IT-LAB-029", "ASSESS::STEP7::VIEW::" + level, ["CORE-05"]);
    const diff = createDifficultyProgressionExercise({ assessed, policy, level });
    views.push([level, diff.start()]);
  }
  const byLevel = Object.fromEntries(views);
  assert.ok(byLevel.FOUNDATION.action_view[0].target);
  assert.ok(byLevel.TECHNICIAN.action_view[0].target);
  assert.equal(byLevel.ADMIN.action_view[0].target, undefined);
  assert.deepEqual(Object.keys(byLevel.ADVANCED.action_view[0]), ["action_id"]);
  assert.deepEqual(Object.keys(byLevel.EXPERT.action_view[0]), ["action_id"]);
  assert.ok(byLevel.FOUNDATION.fault_view.active_fault_ids);
  assert.equal(byLevel.TECHNICIAN.fault_view.active_fault_count, 1);
  assert.equal(byLevel.ADMIN.fault_view.active_fault_count, 1);
  assert.equal(byLevel.ADVANCED.fault_view, null);
  assert.equal(byLevel.EXPERT.fault_view, null);
}

// Deterministic presentation contract.
{
  const buildView = () => {
    const diff = createDifficultyProgressionExercise({
      assessed: cisaExercise("IT-LAB-029", "ASSESS::STEP7::DETERMINISM", ["CORE-05"]),
      policy,
      level: "ADMIN",
    });
    return diff.start();
  };
  assert.deepEqual(buildView(), buildView());
}

console.log(JSON.stringify({
  status: "PASS",
  step: "lab-runtime-step7-difficulty-progression",
  difficulty_runtime_version: DIFFICULTY_RUNTIME_VERSION,
  levels_verified: policy.order,
  progressive_disclosure_verified: true,
  hint_budgets_verified: true,
  learner_artifact_expectations_verified: true,
  expert_multifault_gate_verified: true,
  step3_cisa_itot_verified: true,
  step4_building_operations_verified: true,
  step5_public_service_verified: true,
  step6_assessment_preserved: true,
  deterministic_presentation: true,
  canonical_scenario_logic_unchanged: true,
  automated_verified_award_forbidden: true,
  sandbox_only: true,
  live_control_allowed: false
}, null, 2));
