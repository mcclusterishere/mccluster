import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LabRuntimeError, SESSION_STATES } from "./equity-uprise-lab-runtime.mjs";
import {
  PUBLIC_SERVICE_RUNTIME_VERSION,
  createPublicServiceExercise,
} from "./equity-uprise-public-service-runtime.mjs";

function load(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

const pack = load("./public-service-scenario-pack-v1.json");
const program = load("../floor-01/floor-01-digital-twin-program.json");
const objectInventory = load("../floor-01/floor-01-object-inventory.json");
const simulationObjects = load("../floor-01/floor-01-simulation-objects.json");
const federalBindings = load("../../../equity-uprise-development/FEDERAL-TRAINING-BINDINGS.json");
const federalCatalog = load("../../../equity-uprise-development/FEDERAL-TRAINING-CATALOG.json");

const sources = { program, objectInventory, simulationObjects };
const expectedScenarioIds = [
  "EU-PSC-VITA-INTAKE-V1",
  "EU-PSC-OHRP-CONSENT-V1",
  "EU-PSC-PRIVACY-RECOVERY-V1",
];

assert.equal(PUBLIC_SERVICE_RUNTIME_VERSION, "1.0.0");
assert.equal(pack.mode, "SIMULATION");
assert.equal(pack.execution_target, "SANDBOX");
assert.equal(pack.live_control_allowed, false);
assert.equal(pack.synthetic_case_only, true);
assert.equal(pack.credential_is_not_competency, true);
assert.deepEqual(pack.scenarios.map((scenario) => scenario.scenario_id), expectedScenarioIds);

const sourceScenario = program.scenarios.find((scenario) => scenario.id === "privacy_error_intake");
assert.ok(sourceScenario, "canonical privacy_error_intake scenario is required");
assert.deepEqual(sourceScenario.competencies, ["SHR-02", "CORE-07"]);

const catalogIds = new Set((federalCatalog.records || federalCatalog.courses || []).map(
  (record) => record.catalog_id || record.training_id || record.course_id || record.id
));

const forbiddenKeys = new Set([
  "ssn",
  "social_security_number",
  "taxpayer_identification_number",
  "tin",
  "ein",
  "dob",
  "date_of_birth",
  "email",
  "phone",
  "street_address",
  "person_name",
  "full_name",
]);

function inspectSafety(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => inspectSafety(child, path + "[" + index + "]"));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbiddenKeys.has(key.toLowerCase()), false, "Step 5 contains forbidden PII key at " + path + "." + key);
    inspectSafety(child, path + "." + key);
  }
}

inspectSafety(pack);

const serialized = JSON.stringify(pack);
assert.equal(/\b\d{3}-\d{2}-\d{4}\b/.test(serialized), false, "Step 5 must not contain SSN-shaped values");
assert.equal(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(serialized), false, "Step 5 must not contain email addresses");
assert.equal(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/.test(serialized), false, "Step 5 must not contain phone-shaped values");

for (const definition of pack.scenarios) {
  assert.equal(definition.canonical_scenario_id, "privacy_error_intake");
  assert.equal(definition.mode, "SIMULATION");
  assert.equal(definition.execution_target, "SANDBOX");
  assert.equal(definition.live_control_allowed, false);
  assert.equal(definition.synthetic_case.synthetic_only, true);
  assert.equal(definition.synthetic_case.contains_real_pii, false);
  assert.deepEqual(definition.competency_ids, sourceScenario.competencies);

  for (const trainingId of definition.federal_training_ids) {
    assert.ok(catalogIds.has(trainingId), "unknown federal training catalog ID " + trainingId);
    const binding = federalBindings.bindings.find((entry) => entry.catalog_id === trainingId);
    assert.ok(binding, "missing federal training binding " + trainingId);
    assert.ok(binding.scenario_ids.includes("privacy_error_intake"), trainingId + " does not bind privacy_error_intake");
    assert.equal(binding.live_control_allowed, false);
  }

  for (const action of definition.actions) {
    assert.ok(["inspect", "decision", "validate"].includes(action.type), "unsupported Step 5 action type " + action.type);
    assert.ok(action.target, "Step 5 action target is required");
  }
}

const inputMap = {
  "EU-PSC-VITA-INTAKE-V1": {
    "vita-contain-exposure": { response: "move_synthetic_materials_to_private_intake_and_secure_temporary_documents" },
    "vita-route-private": { location: "f1-intake-room" },
    "vita-scope-decision": { response: "escalate_to_certified_site_coordinator" },
    "vita-quality-handoff": { response: "require_independent_quality_review_before_completion" },
  },
  "EU-PSC-OHRP-CONSENT-V1": {
    "ohrp-contain-exposure": { response: "secure_synthetic_materials_and_move_interaction_to_private_intake" },
    "ohrp-participant-centered-response": { response: "pause_interaction_explain_voluntary_choice_and_use_authorized_protocol_materials" },
    "ohrp-protocol-escalation": { response: "refer_protocol_deviation_or_uncertainty_to_authorized_research_lead" },
  },
  "EU-PSC-PRIVACY-RECOVERY-V1": {
    "privacy-stop-public-view": { response: "remove_synthetic_sensitive_view_from_public_context" },
    "privacy-secure-materials": { response: "secure_synthetic_materials" },
    "privacy-minimum-checkin": { response: "use_minimum_required_synthetic_checkin_information" },
    "privacy-route-private": { location: "f1-intake-room" },
    "privacy-document-incident": { documented: true },
  },
};

function runScenario(scenarioId) {
  const definition = pack.scenarios.find((scenario) => scenario.scenario_id === scenarioId);
  const runner = createPublicServiceExercise({
    pack,
    scenarioId,
    ...sources,
    session_id: "STEP5::" + scenarioId + "::VERIFY",
    actor_id: "ci-verifier",
  });

  runner.start();
  assert.equal(runner.session.phase, SESSION_STATES.RUNNING);
  assert.deepEqual([...runner.unresolvedFaultIds].sort(), runner.initialFaultIds);
  assert.equal(runner.snapshot().case_state.synthetic_only, true);
  assert.equal(runner.snapshot().case_state.contains_real_pii, false);
  assert.ok(runner.sandbox.summary().changed_state_count > 0);

  for (const action of definition.actions) {
    const result = runner.execute(action.id, inputMap[scenarioId]?.[action.id] || {});
    assert.equal(result.status, "success", scenarioId + " failed action " + action.id);
  }

  assert.equal(runner.canComplete(), true);
  const completed = runner.complete();
  assert.equal(completed.phase, SESSION_STATES.COMPLETED);
  assert.deepEqual(completed.unresolved_fault_ids, []);
  assert.equal(completed.sandbox.summary.active_fault_ids.length, 0);
  assert.equal(completed.case_state.synthetic_only, true);
  assert.equal(completed.case_state.contains_real_pii, false);

  const evidence = runner.exportEvidence();
  assert.equal(evidence.runtime_evidence.evaluation.passed, true);
  assert.equal(evidence.runtime_evidence.live_control_allowed, false);
  assert.equal(evidence.synthetic_case_only, true);
  assert.equal(evidence.credential_is_not_competency, true);
  assert.equal(
    evidence.action_history.filter((entry) => entry.status === "success").length,
    definition.actions.length
  );
  return evidence;
}

for (const scenarioId of expectedScenarioIds) runScenario(scenarioId);

// VITA workflow: privacy must be contained before private intake/scope/quality steps can advance.
{
  const runner = createPublicServiceExercise({
    pack,
    scenarioId: "EU-PSC-VITA-INTAKE-V1",
    ...sources,
    session_id: "STEP5::VITA::NEGATIVE",
    actor_id: "ci-verifier",
  });
  runner.start();

  const early = runner.execute("vita-scope-decision", { response: "escalate_to_certified_site_coordinator" });
  assert.equal(early.status, "blocked");

  runner.execute("vita-detect-exposure", {});
  const wrong = runner.execute("vita-contain-exposure", { response: "continue_at_public_desk" });
  assert.equal(wrong.status, "incorrect");
  assert.ok(runner.unresolvedFaultIds.has("privacy_exposure_active"));
  assert.equal(runner.snapshot().case_state.privacy_contained, false);
}

// OHRP workflow: consent uncertainty cannot be closed before privacy containment and participant-centered response.
{
  const runner = createPublicServiceExercise({
    pack,
    scenarioId: "EU-PSC-OHRP-CONSENT-V1",
    ...sources,
    session_id: "STEP5::OHRP::NEGATIVE",
    actor_id: "ci-verifier",
  });
  runner.start();

  const early = runner.execute("ohrp-protocol-escalation", {
    response: "refer_protocol_deviation_or_uncertainty_to_authorized_research_lead",
  });
  assert.equal(early.status, "blocked");
  assert.ok(runner.unresolvedFaultIds.has("consent_process_incomplete"));
}

// Cross-program privacy lab must force minimum-information handling before incident closure.
{
  const runner = createPublicServiceExercise({
    pack,
    scenarioId: "EU-PSC-PRIVACY-RECOVERY-V1",
    ...sources,
    session_id: "STEP5::PRIVACY::ORDER",
    actor_id: "ci-verifier",
  });
  runner.start();
  const early = runner.execute("privacy-document-incident", { documented: true });
  assert.equal(early.status, "blocked");
  assert.ok(runner.unresolvedFaultIds.has("privacy_exposure_active"));
}

function deterministic(scenarioId) {
  return JSON.stringify(runScenario(scenarioId));
}

for (const scenarioId of expectedScenarioIds) {
  assert.equal(deterministic(scenarioId), deterministic(scenarioId), scenarioId + " must replay deterministically");
}

assert.throws(
  () => createPublicServiceExercise({
    pack,
    scenarioId: "EU-PSC-VITA-INTAKE-V1",
    ...sources,
    session_id: "STEP5::LIVE::BLOCK",
    actor_id: "ci-verifier",
    execution_target: "LIVE",
  }),
  (error) => error instanceof LabRuntimeError && error.code === "LIVE_CONTROL_FORBIDDEN"
);

{
  const unsafePack = JSON.parse(JSON.stringify(pack));
  unsafePack.scenarios[0].synthetic_case.synthetic_only = false;
  assert.throws(
    () => createPublicServiceExercise({
      pack: unsafePack,
      scenarioId: "EU-PSC-VITA-INTAKE-V1",
      ...sources,
      session_id: "STEP5::REAL-PII::BLOCK",
      actor_id: "ci-verifier",
    }),
    (error) => error instanceof LabRuntimeError && error.code === "REAL_PII_FORBIDDEN"
  );
}

console.log(JSON.stringify({
  status: "PASS",
  step: "lab-runtime-step5-floor1-public-service",
  public_service_runtime_version: PUBLIC_SERVICE_RUNTIME_VERSION,
  scenarios_verified: expectedScenarioIds,
  scenario_count: expectedScenarioIds.length,
  canonical_source_scenario: "privacy_error_intake",
  federal_training_bindings_verified: true,
  vita_workflow_verified: true,
  ohrp_workflow_verified: true,
  cross_program_privacy_recovery_verified: true,
  real_pii_rejected: true,
  synthetic_case_only: true,
  prerequisite_gates: true,
  incorrect_decisions_do_not_advance: true,
  deterministic_replay: true,
  automatic_evidence_capture: true,
  sandbox_only: true,
  live_control_allowed: false,
  credential_is_not_competency: true
}, null, 2));
