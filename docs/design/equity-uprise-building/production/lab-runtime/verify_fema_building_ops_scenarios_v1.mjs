import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LabRuntimeError, SESSION_STATES } from "./equity-uprise-lab-runtime.mjs";
import {
  BUILDING_OPS_RUNTIME_VERSION,
  createBuildingOperationsExercise,
} from "./equity-uprise-building-ops-runtime.mjs";

function load(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

const pack = load("./fema-building-ops-scenario-pack-v1.json");
const program = load("../floor-01/floor-01-digital-twin-program.json");
const simulationObjects = load("../floor-01/floor-01-simulation-objects.json");
const objectInventory = load("../floor-01/floor-01-object-inventory.json");
const registry = load("../asset-registry/generated/equity-uprise-asset-registry-v1.json");
const federalBindings = load("../../../equity-uprise-development/FEDERAL-TRAINING-BINDINGS.json");

const sources = { program, simulationObjects, objectInventory, registry };
const expectedScenarioIds = [
  "basic_evacuation",
  "blocked_stair_a",
  "passenger_elevator_outage",
  "power_interruption",
  "medical_incident_lobby",
  "public_service_surge",
  "network_checkin_outage",
  "service_area_incident",
];

assert.equal(BUILDING_OPS_RUNTIME_VERSION, "1.0.0");
assert.equal(pack.mode, "SIMULATION");
assert.equal(pack.execution_target, "SANDBOX");
assert.equal(pack.live_control_allowed, false);
assert.equal(pack.credential_is_not_competency, true);
assert.deepEqual(
  pack.scenarios.map((scenario) => scenario.canonical_scenario_id),
  expectedScenarioIds
);

for (const definition of pack.scenarios) {
  const canonical = program.scenarios.find((scenario) => scenario.id === definition.canonical_scenario_id);
  assert.ok(canonical, "missing Floor 1 scenario " + definition.canonical_scenario_id);
  assert.deepEqual(definition.competency_ids, canonical.competencies);

  for (const federalId of definition.federal_training_ids) {
    const binding = federalBindings.bindings.find((entry) => entry.catalog_id === federalId);
    assert.ok(binding, "unknown federal training binding " + federalId);
    assert.ok(
      binding.scenario_ids.includes(definition.canonical_scenario_id),
      federalId + " does not bind " + definition.canonical_scenario_id
    );
    assert.equal(binding.live_control_allowed, false);
  }

  for (const action of definition.actions) {
    assert.ok(["inspect", "decision", "resolve", "validate"].includes(action.type));
    assert.ok(action.target);
  }
}

const inputMap = {
  basic_evacuation: {
    "evac-route": { route: "site-east-egress-walk" },
    "evac-assembly": { assembly: "site-primary-assembly" },
    "evac-account": { accounted: true },
  },
  blocked_stair_a: {
    "stair-route": { route: "site-north-egress-walk" },
    "stair-assembly": { assembly: "site-alternate-assembly" },
  },
  passenger_elevator_outage: {
    "elev-plan": { response: "accessibility_assistance_and_authorized_alternate_route" },
  },
  power_interruption: {
    "power-plan": { response: "preserve_life_safety_comms_and_manual_fallback" },
  },
  medical_incident_lobby: {
    "med-escalate": { response: "activate_emergency_services_and_incident_lead" },
    "med-clear": { keep_clear: true },
  },
  public_service_surge: {
    "surge-plan": { response: "overflow_queue_preserve_accessible_position" },
    "surge-comms": { status: "capacity_constrained_wait_extended" },
  },
  network_checkin_outage: {
    "checkin-fallback": { response: "manual_checkin_minimum_required_information" },
    "checkin-doc": { documented: true },
  },
  service_area_incident: {
    "service-restrict": { access: "restricted" },
    "service-report": { response: "report_and_do_not_enter" },
    "service-clear": { keep_clear: true },
  },
};

function run(canonicalScenarioId) {
  const definition = pack.scenarios.find((scenario) => scenario.canonical_scenario_id === canonicalScenarioId);
  const runner = createBuildingOperationsExercise({
    pack,
    canonicalScenarioId,
    ...sources,
    session_id: "STEP4::" + canonicalScenarioId + "::VERIFY",
    actor_id: "ci-verifier",
  });

  runner.start();
  assert.equal(runner.session.phase, SESSION_STATES.RUNNING);
  assert.equal(runner.unresolvedFault, definition.fault_id);
  assert.ok(runner.sandbox.summary().changed_state_count > 0);

  for (const action of definition.actions) {
    const result = runner.execute(action.id, inputMap[canonicalScenarioId]?.[action.id] || {});
    assert.equal(result.status, "success", canonicalScenarioId + " failed action " + action.id);
  }

  assert.equal(runner.canComplete(), true);
  const completed = runner.complete();
  assert.equal(completed.phase, SESSION_STATES.COMPLETED);
  assert.equal(completed.unresolved_fault_id, null);
  assert.equal(completed.sandbox.summary.active_fault_ids.length, 0);

  const evidence = runner.exportEvidence();
  assert.equal(evidence.runtime_evidence.evaluation.passed, true);
  assert.equal(evidence.runtime_evidence.live_control_allowed, false);
  assert.equal(evidence.credential_is_not_competency, true);
  assert.equal(evidence.action_history.filter((entry) => entry.status === "success").length, definition.actions.length);
  return evidence;
}

for (const id of expectedScenarioIds) run(id);

// Stair A must force the modeled alternate route, not permit the blocked route.
{
  const runner = createBuildingOperationsExercise({
    pack, canonicalScenarioId: "blocked_stair_a", ...sources,
    session_id: "STEP4::BLOCKED::NEGATIVE", actor_id: "ci-verifier",
  });
  runner.start();
  const blocked = runner.execute("stair-route", { route: "site-north-egress-walk" });
  assert.equal(blocked.status, "blocked");
  runner.execute("stair-inspect-a", {});
  runner.execute("stair-inspect-b", {});
  const wrong = runner.execute("stair-route", { route: "site-east-egress-walk" });
  assert.equal(wrong.status, "incorrect");
  assert.equal(runner.unresolvedFault, "stair_a_blocked");

  const obs = runner.session.inspect("F1-DOOR-STAIR-A-DISCHARGE", "negative-test");
  assert.equal(obs.sandbox_observation.states[0].state, "blocked");
  assert.equal(obs.sandbox_observation.states[0].availability, "unavailable");
}

// Power exercise must preserve a modeled emergency communication concept while normal power is degraded.
{
  const runner = createBuildingOperationsExercise({
    pack, canonicalScenarioId: "power_interruption", ...sources,
    session_id: "STEP4::POWER::STATE", actor_id: "ci-verifier",
  });
  runner.start();
  const power = runner.session.inspect("ELEC-NORMAL", "verify degraded normal power");
  assert.equal(power.sandbox_observation.states[0].availability, "degraded");
  const comms = runner.session.inspect("F1-TWOWAY-01", "verify emergency comms");
  assert.ok(comms.sandbox_observation.states[0].condition_flags.includes("emergency_communication_preserved"));
}

// Medical exercise is escalation / access / handoff only, not treatment instruction.
{
  const serialized = JSON.stringify(
    pack.scenarios.find((scenario) => scenario.canonical_scenario_id === "medical_incident_lobby")
  ).toLowerCase();
  for (const forbidden of ["dosage", "administer medication", "perform surgery", "diagnose condition"]) {
    assert.equal(serialized.includes(forbidden), false, "medical exercise contains treatment instruction: " + forbidden);
  }

  const runner = createBuildingOperationsExercise({
    pack, canonicalScenarioId: "medical_incident_lobby", ...sources,
    session_id: "STEP4::MEDICAL::ORDER", actor_id: "ci-verifier",
  });
  runner.start();
  const early = runner.execute("med-handoff", {});
  assert.equal(early.status, "blocked");
  assert.equal(runner.unresolvedFault, "medical_incident_active");
}

// Service-area exercise must keep the learner outside the modeled hazard boundary.
{
  const runner = createBuildingOperationsExercise({
    pack, canonicalScenarioId: "service_area_incident", ...sources,
    session_id: "STEP4::SERVICE::BOUNDARY", actor_id: "ci-verifier",
  });
  runner.start();
  const serviceDoor = runner.session.inspect("F1-DOOR-SERVICE-WEST", "verify restricted boundary");
  assert.equal(serviceDoor.sandbox_observation.states[0].availability, "unavailable");
  assert.equal(serviceDoor.sandbox_observation.states[0].state, "restricted");
}

function deterministic(id) {
  return JSON.stringify(run(id));
}
for (const id of expectedScenarioIds) {
  assert.equal(deterministic(id), deterministic(id), id + " must replay deterministically");
}

assert.throws(
  () => createBuildingOperationsExercise({
    pack,
    canonicalScenarioId: "basic_evacuation",
    ...sources,
    session_id: "STEP4::LIVE::BLOCK",
    actor_id: "ci-verifier",
    execution_target: "LIVE",
  }),
  (error) => error instanceof LabRuntimeError && error.code === "LIVE_CONTROL_FORBIDDEN"
);

console.log(JSON.stringify({
  status: "PASS",
  step: "lab-runtime-step4-building-operations",
  building_ops_runtime_version: BUILDING_OPS_RUNTIME_VERSION,
  scenarios_verified: expectedScenarioIds,
  scenario_count: expectedScenarioIds.length,
  federal_training_bindings_verified: true,
  canonical_floor1_scenarios_preserved: true,
  canonical_object_state_used: true,
  prerequisite_gates: true,
  incorrect_decisions_do_not_advance: true,
  deterministic_replay: true,
  automatic_evidence_capture: true,
  medical_scope: "emergency escalation/access/handoff only",
  sandbox_only: true,
  live_control_allowed: false,
  credential_is_not_competency: true
}, null, 2));
