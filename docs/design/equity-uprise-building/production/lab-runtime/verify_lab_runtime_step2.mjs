import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LabRuntimeError, SESSION_STATES } from "./equity-uprise-lab-runtime.mjs";
import {
  ELECTRONICS_SANDBOX_VERSION,
  SUPPORTED_FAULT_IDS,
  ElectronicsSandbox,
  createElectronicsBoundSessionFromCatalogLab,
} from "./equity-uprise-electronics-sandbox.mjs";

const catalog = JSON.parse(readFileSync(new URL("../electronics/generated/equity-uprise-it-lab-catalog-v1.json", import.meta.url), "utf8"));
const registry = JSON.parse(readFileSync(new URL("../asset-registry/generated/equity-uprise-asset-registry-v1.json", import.meta.url), "utf8"));
const connections = JSON.parse(readFileSync(new URL("../electronics/generated/equity-uprise-electronics-connections-v1.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../electronics/generated/equity-uprise-electronics-manifest-v1.json", import.meta.url), "utf8"));

const labs = catalog.labs;
assert.equal(ELECTRONICS_SANDBOX_VERSION, "1.0.0");
assert.equal(labs.length, 40, "Step 2 must bind all 40 canonical Step 4A labs");
assert.ok(registry.assets.length >= 1400, "expected current populated Step 4A registry");
assert.ok(connections.connections.length >= 800, "expected current Step 4A typed connections");
assert.equal(manifest.new_asset_ids.length, 473, "expected current Step 4A electronics asset set");

const unsafeAssets = registry.assets.filter((asset) => asset.security && asset.security.live_control_allowed === true);
assert.equal(unsafeAssets.length, 0, "no registry asset may expose LIVE control");

const sandbox = new ElectronicsSandbox({ registry, connections, manifest });
const selectorAudit = new Map();
for (const lab of labs) {
  for (const selector of lab.target_selectors) {
    if (!selectorAudit.has(selector)) selectorAudit.set(selector, sandbox.resolveSelector(selector));
  }
}

const unresolvedSelectors = [...selectorAudit.values()].filter((entry) => !entry.resolved);
assert.deepEqual(unresolvedSelectors, [], "every canonical Step 4A target selector must resolve");

const catalogFaultIds = [...new Set(labs.flatMap((lab) => lab.fault_injection).filter((faultId) => faultId !== "none"))].sort();
assert.deepEqual(catalogFaultIds, [...SUPPORTED_FAULT_IDS].sort(), "fault engine must support complete canonical fault vocabulary");

const labRuns = [];
for (const lab of labs) {
  const bound = createElectronicsBoundSessionFromCatalogLab(
    lab,
    { registry, connections, manifest },
    { session_id: "STEP2::" + lab.lab_id + "::VERIFY", actor_id: "ci-verifier" }
  );
  const session = bound.session;
  const labSandbox = bound.sandbox;

  assert.equal(session.phase, SESSION_STATES.CREATED);
  session.start();
  assert.equal(session.phase, SESSION_STATES.RUNNING);

  const summary = labSandbox.summary();
  assert.equal(summary.execution_target, "SANDBOX");
  assert.equal(summary.live_control_allowed, false);

  const expectedFaults = lab.fault_injection.filter((faultId) => faultId !== "none").sort();
  assert.deepEqual(summary.active_fault_ids, expectedFaults, lab.lab_id + " active fault set mismatch");

  if (expectedFaults.length > 0) {
    assert.ok(
      summary.faulted_asset_count > 0 ||
      summary.faulted_connection_count > 0 ||
      summary.scope_state.active_fault_ids.length > 0,
      lab.lab_id + " faults must change sandbox state"
    );
  }

  const evidence = session.exportEvidence();
  assert.ok(evidence.sandbox_state, lab.lab_id + " must export electronics sandbox state");
  assert.equal(evidence.sandbox_state.execution_target, "SANDBOX");
  assert.equal(evidence.sandbox_state.live_control_allowed, false);

  const injected = evidence.events.filter((event) => event.event_type === "FAULT_INJECTED");
  assert.equal(injected.length, expectedFaults.length);
  for (const event of injected) {
    assert.equal(event.abstract_only, false, lab.lab_id + " bound faults cannot remain abstract");
    assert.ok(event.binding, lab.lab_id + " fault event must include binding evidence");
    assert.equal(event.binding.execution_target, "SANDBOX");
    assert.equal(event.binding.live_control_allowed, false);
    assert.ok(
      event.binding.changed_asset_ids.length > 0 ||
      event.binding.changed_connection_ids.length > 0 ||
      event.binding.scope_changed === true,
      lab.lab_id + "/" + event.fault_id + " must identify concrete changed sandbox state"
    );
  }

  const firstSelector = lab.target_selectors[0];
  const inspection = session.inspect(firstSelector, "Step 2 verifier inspection");
  assert.ok(inspection.sandbox_observation, lab.lab_id + " inspection must read sandbox state");
  assert.equal(inspection.sandbox_observation.resolved, true);

  session.reset();
  const resetSummary = labSandbox.summary();
  assert.deepEqual(resetSummary.active_fault_ids, [], lab.lab_id + " reset must clear active faults");
  assert.equal(resetSummary.faulted_asset_count, 0, lab.lab_id + " reset must restore asset baseline");
  assert.equal(resetSummary.faulted_connection_count, 0, lab.lab_id + " reset must restore connection baseline");

  labRuns.push({
    lab_id: lab.lab_id,
    selectors: lab.target_selectors.length,
    faults: expectedFaults.length,
    faulted_assets: summary.faulted_asset_count,
    faulted_connections: summary.faulted_connection_count,
  });
}

function runSnapshot(labId) {
  const lab = labs.find((item) => item.lab_id === labId);
  assert.ok(lab, labId + " must exist");
  const bound = createElectronicsBoundSessionFromCatalogLab(
    lab,
    { registry, connections, manifest },
    { session_id: "DETERMINISM::" + labId, actor_id: "ci-verifier" }
  );
  bound.session.start();
  return JSON.stringify(bound.sandbox.snapshot({ changed_only: true }));
}

for (const labId of ["IT-LAB-017", "IT-LAB-027", "IT-LAB-029", "IT-LAB-034", "IT-LAB-039"]) {
  assert.equal(runSnapshot(labId), runSnapshot(labId), labId + " sandbox snapshot must be deterministic");
}

{
  const lab = labs.find((item) => item.lab_id === "IT-LAB-017");
  const bound = createElectronicsBoundSessionFromCatalogLab(
    lab, { registry, connections, manifest }, { session_id: "PROP::WAP", actor_id: "ci-verifier" }
  );
  bound.session.start();
  const snapshot = bound.sandbox.snapshot({ changed_only: true });
  assert.ok(snapshot.asset_states.some((state) => state.asset_type === "wireless_ap" && state.availability === "unavailable"));
  assert.ok(snapshot.connection_states.some((state) => state.cable_type === "CAT6A-HORIZONTAL" && state.availability === "unavailable"));
}

{
  const lab = labs.find((item) => item.lab_id === "IT-LAB-027");
  const bound = createElectronicsBoundSessionFromCatalogLab(
    lab, { registry, connections, manifest }, { session_id: "PROP::BAS", actor_id: "ci-verifier" }
  );
  bound.session.start();
  const snapshot = bound.sandbox.snapshot({ changed_only: true });
  assert.ok(snapshot.asset_states.some((state) => state.asset_type === "bas_controller" && state.availability === "unavailable"));
  assert.ok(snapshot.asset_states.some((state) => state.asset_type === "environment_sensor" && state.availability === "unavailable"));
  assert.ok(snapshot.connection_states.some((state) => state.cable_type === "BACNET-MSTP-STP" && state.availability === "unavailable"));
}

{
  const lab = labs.find((item) => item.lab_id === "IT-LAB-029");
  const bound = createElectronicsBoundSessionFromCatalogLab(
    lab, { registry, connections, manifest }, { session_id: "PROP::ITOT", actor_id: "ci-verifier" }
  );
  bound.session.start();
  const snapshot = bound.sandbox.snapshot({ changed_only: true });
  assert.ok(snapshot.asset_states.some((state) => state.asset_id === "LOGIC-VLAN-BAS-OT" && state.security_state === "at_risk"));
  assert.ok(snapshot.asset_states.some((state) => state.asset_type === "firewall" && state.security_state === "at_risk"));
}

{
  const lab = labs.find((item) => item.lab_id === "IT-LAB-034");
  const bound = createElectronicsBoundSessionFromCatalogLab(
    lab, { registry, connections, manifest }, { session_id: "PROP::SWITCH", actor_id: "ci-verifier" }
  );
  bound.session.start();
  const snapshot = bound.sandbox.snapshot({ changed_only: true });
  assert.ok(snapshot.asset_states.some((state) => state.asset_type === "access_switch" && state.availability === "unavailable"));
  assert.ok(snapshot.asset_states.some((state) =>
    ["wireless_ap", "workstation", "ip_phone", "camera", "intercom"].includes(state.asset_type) &&
    state.availability === "unavailable"
  ));
  assert.ok(snapshot.connection_states.some((state) => state.cable_type === "CAT6A-HORIZONTAL" && state.availability === "unavailable"));
}

{
  const lab = labs.find((item) => item.lab_id === "IT-LAB-039");
  const bound = createElectronicsBoundSessionFromCatalogLab(
    lab, { registry, connections, manifest }, { session_id: "PROP::CROSS", actor_id: "ci-verifier" }
  );
  bound.session.start();
  const summary = bound.sandbox.summary();
  assert.deepEqual(summary.active_fault_ids, ["bas_alarm", "core_link_degraded", "normal_power_loss"]);
  assert.ok(summary.faulted_asset_count >= 3);
  assert.ok(summary.faulted_connection_count >= 1);
}

assert.throws(
  () => {
    const lab = labs.find((item) => item.lab_id === "IT-LAB-017");
    createElectronicsBoundSessionFromCatalogLab(
      lab,
      { registry, connections, manifest },
      { session_id: "LIVE::BLOCK", actor_id: "ci-verifier", execution_target: "LIVE" }
    );
  },
  (error) => error instanceof LabRuntimeError && error.code === "LIVE_CONTROL_FORBIDDEN"
);

assert.throws(
  () => sandbox.injectFault("not_a_canonical_fault", { target_selectors: ["wireless_ap"] }),
  (error) => error instanceof LabRuntimeError && error.code === "UNSUPPORTED_FAULT"
);

console.log(JSON.stringify({
  status: "PASS",
  step: "lab-runtime-step2-electronics-state-binding",
  sandbox_version: ELECTRONICS_SANDBOX_VERSION,
  canonical_labs_bound: labs.length,
  unique_selectors_resolved: selectorAudit.size,
  canonical_faults_supported: catalogFaultIds.length,
  electronics_assets_in_scope: manifest.new_asset_ids.length,
  typed_connections_in_scope: connections.connections.length,
  propagation_proofs: [
    "wifi_ap_to_cat6a_link",
    "bas_controller_to_mstp_sensor",
    "it_ot_security_state",
    "access_switch_to_horizontal_endpoints",
    "cross_system_incident"
  ],
  deterministic_replay: true,
  reset_restores_baseline: true,
  sandbox_enforced: true,
  live_control_allowed: false,
  lab_runs: labRuns
}, null, 2));
