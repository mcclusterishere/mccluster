import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LabRuntimeError,
  SESSION_STATES,
} from "./equity-uprise-lab-runtime.mjs";
import {
  GUIDED_SCENARIO_RUNTIME_VERSION,
  createGuidedScenarioFromPack,
} from "./equity-uprise-guided-scenarios.mjs";

function load(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

const pack = load("./cisa-itot-scenario-pack-v1.json");
const labCatalog = load("../electronics/generated/equity-uprise-it-lab-catalog-v1.json");
const registry = load("../asset-registry/generated/equity-uprise-asset-registry-v1.json");
const connections = load("../electronics/generated/equity-uprise-electronics-connections-v1.json");
const manifest = load("../electronics/generated/equity-uprise-electronics-manifest-v1.json");
const federalBindings = load("../../../equity-uprise-development/FEDERAL-TRAINING-BINDINGS.json");

const electronics = { registry, connections, manifest };
const scenarioIds = pack.scenarios.map((scenario) => scenario.scenario_id);
const labIds = pack.scenarios.map((scenario) => scenario.source_lab_id);

assert.equal(GUIDED_SCENARIO_RUNTIME_VERSION, "1.0.0");
assert.equal(pack.mode, "SIMULATION");
assert.equal(pack.execution_target, "SANDBOX");
assert.equal(pack.live_control_allowed, false);
assert.equal(pack.credential_is_not_competency, true);
assert.deepEqual(labIds, ["IT-LAB-029", "IT-LAB-038", "IT-LAB-039"]);
assert.equal(new Set(scenarioIds).size, scenarioIds.length);

const bindings = federalBindings.bindings || [];
for (const definition of pack.scenarios) {
  assert.equal(definition.mode, "SIMULATION");
  assert.equal(definition.execution_target, "SANDBOX");
  assert.equal(definition.live_control_allowed, false);
  assert.ok(definition.objectives.length >= 3);
  assert.ok(definition.actions.length >= 5);

  for (const federalId of definition.federal_training_ids) {
    const binding = bindings.find((entry) => entry.catalog_id === federalId);
    assert.ok(binding, definition.scenario_id + " references unknown federal binding " + federalId);
    assert.ok(binding.lab_ids.includes(definition.source_lab_id), federalId + " does not bind " + definition.source_lab_id);
    assert.equal(binding.live_control_allowed, false);
  }

  const forbiddenKeys = ["command", "script", "credential", "endpoint_url", "shell"];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!forbiddenKeys.includes(key), definition.scenario_id + " contains forbidden executable field " + key);
      visit(child);
    }
  };
  visit(definition);
}

function runVerificationPath(labId) {
  const definition = pack.scenarios.find((scenario) => scenario.source_lab_id === labId);
  const runner = createGuidedScenarioFromPack({
    pack,
    labCatalog,
    labId,
    electronics,
    session_id: "STEP3::" + labId + "::VERIFY",
    actor_id: "ci-verifier",
  });

  runner.start();
  assert.equal(runner.session.phase, SESSION_STATES.RUNNING);
  assert.deepEqual([...runner.unresolvedFaultIds].sort(), runner.initialFaultIds);

  for (const step of definition.verification_path) {
    const result = runner.execute(step.action_id, step.input || {});
    assert.equal(result.status, "success", labId + " verification action failed: " + step.action_id);
  }

  assert.equal(runner.canComplete(), true, labId + " must be completable after verification path");
  const complete = runner.complete();
  assert.equal(complete.phase, SESSION_STATES.COMPLETED);
  assert.deepEqual(complete.unresolved_fault_ids, []);
  assert.ok(complete.objectives.every((objective) => objective.complete));
  assert.equal(complete.sandbox.summary.active_fault_ids.length, 0);

  const evidence = runner.exportEvidence();
  assert.equal(evidence.runtime_evidence.evaluation.passed, true);
  assert.equal(evidence.runtime_evidence.live_control_allowed, false);
  assert.equal(evidence.credential_is_not_competency, true);
  assert.ok(evidence.action_history.every((entry) => entry.status === "success"));

  return evidence;
}

for (const labId of labIds) runVerificationPath(labId);

{
  const runner = createGuidedScenarioFromPack({
    pack, labCatalog, labId: "IT-LAB-029", electronics,
    session_id: "STEP3::029::NEGATIVE", actor_id: "ci-verifier",
  });
  runner.start();
  const blocked = runner.execute("029-submit-risk", { finding: "overpermissive_rule" });
  assert.equal(blocked.status, "blocked");
  runner.execute("029-inspect-ot-vlan", {});
  runner.execute("029-inspect-firewall", {});
  const wrong = runner.execute("029-submit-risk", { finding: "hardware_failure" });
  assert.equal(wrong.status, "incorrect");
  assert.equal(runner.snapshot().objectives.find((o) => o.objective_id === "OBJ-029-DIAGNOSE").complete, false);
}

{
  const runner = createGuidedScenarioFromPack({
    pack, labCatalog, labId: "IT-LAB-038", electronics,
    session_id: "STEP3::038::NEGATIVE", actor_id: "ci-verifier",
  });
  runner.start();
  runner.execute("038-inspect-siem", {});
  runner.execute("038-inspect-network", {});
  runner.execute("038-inspect-bas", {});
  runner.execute("038-inspect-camera", {});
  const wrong = runner.execute("038-submit-timeline", { timeline: ["camera", "bas", "network"] });
  assert.equal(wrong.status, "incorrect");
  assert.ok(runner.unresolvedFaultIds.has("multi_device_alert"));
}

{
  const runner = createGuidedScenarioFromPack({
    pack, labCatalog, labId: "IT-LAB-039", electronics,
    session_id: "STEP3::039::ORDER", actor_id: "ci-verifier",
  });
  runner.start();
  const blocked = runner.execute("039-restore-core", {});
  assert.equal(blocked.status, "blocked");
  assert.ok(runner.unresolvedFaultIds.has("normal_power_loss"));
  assert.ok(runner.unresolvedFaultIds.has("core_link_degraded"));
  assert.ok(runner.unresolvedFaultIds.has("bas_alarm"));
}

function deterministicRun(labId) {
  return JSON.stringify(runVerificationPath(labId));
}

for (const labId of labIds) {
  assert.equal(
    deterministicRun(labId),
    deterministicRun(labId),
    labId + " guided evidence must replay deterministically"
  );
}

assert.throws(
  () => createGuidedScenarioFromPack({
    pack,
    labCatalog,
    labId: "IT-LAB-029",
    electronics,
    session_id: "STEP3::LIVE::BLOCK",
    actor_id: "ci-verifier",
    execution_target: "LIVE",
  }),
  (error) => error instanceof LabRuntimeError && error.code === "LIVE_CONTROL_FORBIDDEN"
);

console.log(JSON.stringify({
  status: "PASS",
  step: "lab-runtime-step3-cisa-itot-guided-scenarios",
  guided_runtime_version: GUIDED_SCENARIO_RUNTIME_VERSION,
  scenarios_verified: scenarioIds,
  source_labs: labIds,
  federal_training_bindings_verified: [...new Set(pack.scenarios.flatMap((scenario) => scenario.federal_training_ids))].sort(),
  deterministic_replay: true,
  prerequisite_gates: true,
  incorrect_decisions_do_not_advance: true,
  mitigation_recomposes_sandbox_state: true,
  completion_auto_records_canonical_criterion_evidence: true,
  sandbox_only: true,
  live_control_allowed: false,
  credential_is_not_competency: true
}, null, 2));
