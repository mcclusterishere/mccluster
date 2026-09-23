import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LAB_RUNTIME_VERSION,
  LabRuntimeError,
  SESSION_STATES,
  adaptCatalogLab,
  createSessionFromCatalogLab,
} from "./equity-uprise-lab-runtime.mjs";

const catalogUrl = new URL("../electronics/generated/equity-uprise-it-lab-catalog-v1.json", import.meta.url);
const catalog = JSON.parse(readFileSync(catalogUrl, "utf8"));
const labs = catalog.labs;

assert.equal(LAB_RUNTIME_VERSION, "1.0.0");
assert.ok(Array.isArray(labs), "canonical Step 4A lab catalog must expose labs[]");
assert.equal(labs.length, 40, "Step 1 is pinned to the current 40-lab Step 4A catalog");
assert.equal(new Set(labs.map((lab) => lab.lab_id)).size, labs.length, "source lab IDs must be unique");

const adapted = labs.map(adaptCatalogLab);
assert.equal(adapted.length, 40);
for (const scenario of adapted) {
  assert.equal(scenario.mode, "SIMULATION");
  assert.equal(scenario.execution_target, "SANDBOX");
  assert.equal(scenario.live_control_allowed, false);
  assert.match(scenario.scenario_id, /^EU-LAB::IT-LAB-\d{3}::V1$/);
  assert.equal(new Set(scenario.success_criteria.map((item) => item.criterion_id)).size, scenario.success_criteria.length);
}

const noFaultLab = labs.find((lab) => lab.lab_id === "IT-LAB-001");
assert.ok(noFaultLab);
assert.equal(adaptCatalogLab(noFaultLab).fault_injection.length, 0, 'catalog sentinel "none" is not an injected fault');

const smokeLab = labs.find((lab) => lab.lab_id === "IT-LAB-003");
assert.ok(smokeLab, "IT-LAB-003 smoke lab must exist");
const session = createSessionFromCatalogLab(smokeLab, {
  session_id: "SIM::IT-LAB-003::VERIFY",
  actor_id: "ci-verifier",
});

assert.equal(session.phase, SESSION_STATES.CREATED);
session.start();
assert.equal(session.phase, SESSION_STATES.RUNNING);
assert.ok(session.faults.length >= 1);
assert.ok(session.faults.every((fault) => fault.active === true));

session.inspect("CAT6A-HORIZONTAL", "inspect simulated wiremap");
session.perform("run_wiremap_test", {
  target: "CAT6A-HORIZONTAL",
  detail: "simulation-only diagnostic",
});
assert.equal(session.evaluate().passed, false);

assert.throws(
  () => session.complete(),
  (error) => error instanceof LabRuntimeError && error.code === "CRITERIA_INCOMPLETE"
);

for (const criterion of session.criteria) {
  session.satisfyCriterion(criterion.criterion_id, {
    evidence_type: "verification_fixture",
    result: "satisfied",
  });
}

assert.equal(session.evaluate().passed, true);
session.complete();
assert.equal(session.phase, SESSION_STATES.COMPLETED);

const completedEvidence = session.exportEvidence();
assert.equal(completedEvidence.evaluation.passed, true);
assert.deepEqual(
  completedEvidence.events.map((event) => event.event_seq),
  completedEvidence.events.map((_, index) => index + 1),
  "evidence event sequence must be deterministic and monotonic"
);
assert.ok(completedEvidence.events.some((event) => event.event_type === "FAULT_INJECTED"));
assert.ok(completedEvidence.events.some((event) => event.event_type === "INSPECTION_RECORDED"));
assert.ok(completedEvidence.events.some((event) => event.event_type === "SIMULATED_ACTION_RECORDED"));
assert.ok(completedEvidence.events.some((event) => event.event_type === "CRITERION_SATISFIED"));
assert.ok(completedEvidence.events.some((event) => event.event_type === "SESSION_COMPLETED"));

session.reset();
assert.equal(session.phase, SESSION_STATES.RESET);
assert.ok(session.faults.every((fault) => fault.active === false));
assert.ok(session.criteria.every((criterion) => criterion.satisfied === false));
assert.equal(session.evaluate().passed, false);

session.start();
assert.equal(session.phase, SESSION_STATES.RUNNING);

assert.throws(
  () => session.perform("attempt_live_write", { live_control_requested: true }),
  (error) => error instanceof LabRuntimeError && error.code === "LIVE_CONTROL_FORBIDDEN"
);

assert.throws(
  () => createSessionFromCatalogLab(smokeLab, {
    session_id: "LIVE-BLOCK-VERIFY",
    execution_target: "LIVE",
  }),
  (error) => error instanceof LabRuntimeError && error.code === "LIVE_CONTROL_FORBIDDEN"
);

assert.throws(
  () => adaptCatalogLab({ ...smokeLab, live_control_allowed: true }),
  (error) => error instanceof LabRuntimeError && error.code === "LIVE_CONTROL_FORBIDDEN"
);

console.log(JSON.stringify({
  status: "PASS",
  step: "lab-runtime-step1-foundation",
  runtime_version: LAB_RUNTIME_VERSION,
  canonical_labs_adapted: adapted.length,
  smoke_lab: smokeLab.lab_id,
  lifecycle_proven: ["CREATED", "RUNNING", "COMPLETED", "RESET", "RUNNING"],
  deterministic_evidence_sequence: true,
  sandbox_enforced: true,
  live_control_allowed: false
}, null, 2));
