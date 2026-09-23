import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  LabRuntimeError,
  SESSION_STATES,
  adaptCatalogLab,
} from "./equity-uprise-lab-runtime.mjs";

import {
  ELECTRONICS_SANDBOX_VERSION,
  SUPPORTED_FAULT_IDS,
  ElectronicsSandbox,
  createElectronicsBoundSessionFromCatalogLab,
} from "./equity-uprise-electronics-sandbox.mjs";

function load(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

const catalog = load("../electronics/generated/equity-uprise-it-lab-catalog-v1.json");
const registry = load("../asset-registry/generated/equity-uprise-asset-registry-v1.json");
const connections = load("../electronics/generated/equity-uprise-electronics-connections-v1.json");
const manifest = load("../electronics/generated/equity-uprise-electronics-manifest-v1.json");

const labs = catalog.labs;
assert.equal(ELECTRONICS_SANDBOX_VERSION, "1.0.0");
assert.ok(Array.isArray(labs));
assert.equal(labs.length, 40);

const sourceFaultIds = [...new Set(
  labs.flatMap((lab) => lab.fault_injection || []).filter((faultId) => faultId !== "none")
)].sort();

assert.deepEqual(
  [...SUPPORTED_FAULT_IDS].sort(),
  sourceFaultIds,
  "Step 2 must explicitly support every current Step 4A fault token"
);

const selectorProbe = new ElectronicsSandbox({ registry, connections, manifest });
const sourceSelectors = [...new Set(labs.flatMap((lab) => lab.target_selectors || []))].sort();
const selectorCoverage = sourceSelectors.map((selector) => selectorProbe.resolveSelector(selector));

assert.equal(sourceSelectors.length, 33);
assert.deepEqual(
  selectorCoverage.filter((entry) => !entry.resolved).map((entry) => entry.selector),
  [],
  "every current Step 4A target selector must resolve against canonical electronics authority"
);

assert.ok(selectorCoverage.find((entry) => entry.selector === "CAT6A-HORIZONTAL")?.connection_ids.length > 0);
assert.ok(selectorCoverage.find((entry) => entry.selector === "OS2-SM-DUPLEX")?.connection_ids.length > 0);
assert.ok(selectorCoverage.find((entry) => entry.selector === "LOGIC-SVC-DHCP")?.asset_ids.length === 1);
assert.ok(selectorCoverage.find((entry) => entry.selector === "firewall")?.asset_ids.length >= 2);
assert.ok(selectorCoverage.find((entry) => entry.selector === "whole_building")?.asset_ids.length === manifest.new_asset_ids.length);

let boundLabs = 0;
let injectedFaults = 0;

for (const lab of labs) {
  const { scenario, sandbox, session } = createElectronicsBoundSessionFromCatalogLab(
    lab,
    { registry, connections, manifest },
    {
      session_id: "STEP2::" + lab.lab_id + "::VERIFY",
      actor_id: "ci-verifier",
    }
  );

  const binding = sandbox.bindScenario(scenario);
  assert.equal(binding.source_lab_id, lab.lab_id);
  assert.equal(binding.target_selectors.length, lab.target_selectors.length);
  assert.ok(binding.target_selectors.every((entry) => entry.asset_count + entry.connection_count + entry.catalog_count > 0));
  boundLabs += 1;

  const baseline = sandbox.summary();
  assert.deepEqual(baseline.active_fault_ids, []);
  assert.equal(baseline.faulted_asset_count, 0);
  assert.equal(baseline.faulted_connection_count, 0);
  assert.equal(baseline.live_control_allowed, false);
  assert.equal(baseline.execution_target, "SANDBOX");

  session.start();
  assert.equal(session.phase, SESSION_STATES.RUNNING);

  const expectedFaults = (lab.fault_injection || []).filter((faultId) => faultId !== "none");
  const faultEvents = session.events.filter((event) => event.event_type === "FAULT_INJECTED");
  assert.equal(faultEvents.length, expectedFaults.length);

  for (const event of faultEvents) {
    assert.equal(event.abstract_only, false);
    assert.ok(event.binding);
    assert.equal(event.binding.execution_target, "SANDBOX");
    assert.equal(event.binding.live_control_allowed, false);
    assert.ok(
      event.binding.changed_asset_ids.length > 0 ||
      event.binding.changed_connection_ids.length > 0 ||
      event.binding.scope_changed,
      lab.lab_id + " / " + event.fault_id + " produced no bound state effect"
    );
    injectedFaults += 1;
  }

  const evidence = session.exportEvidence();
  assert.ok(evidence.sandbox_state);
  assert.equal(evidence.sandbox_state.execution_target, "SANDBOX");
  assert.equal(evidence.sandbox_state.live_control_allowed, false);
  assert.equal(evidence.sandbox_state.scenario_binding.source_lab_id, lab.lab_id);

  const activeSummary = sandbox.summary();
  assert.deepEqual(activeSummary.active_fault_ids, [...expectedFaults].sort());

  session.reset();
  assert.equal(session.phase, SESSION_STATES.RESET);

  const resetSummary = sandbox.summary();
  assert.deepEqual(resetSummary.active_fault_ids, []);
  assert.equal(resetSummary.faulted_asset_count, 0);
  assert.equal(resetSummary.faulted_connection_count, 0);
  assert.equal(sandbox.snapshot().scenario_binding.source_lab_id, lab.lab_id);

  session.start();
  assert.equal(session.phase, SESSION_STATES.RUNNING);
}

function deterministicSnapshot(labId) {
  const lab = labs.find((entry) => entry.lab_id === labId);
  assert.ok(lab, labId + " must exist");
  const { sandbox, session } = createElectronicsBoundSessionFromCatalogLab(
    lab,
    { registry, connections, manifest },
    { session_id: "DETERMINISM::" + labId, actor_id: "ci-verifier" }
  );
  session.start();
  return JSON.stringify(sandbox.snapshot());
}

for (const labId of ["IT-LAB-017", "IT-LAB-027", "IT-LAB-029", "IT-LAB-034", "IT-LAB-039"]) {
  assert.equal(
    deterministicSnapshot(labId),
    deterministicSnapshot(labId),
    labId + " must produce a deterministic electronics-state snapshot"
  );
}

{
  const lab = labs.find((entry) => entry.lab_id === "IT-LAB-017");
  const { session } = createElectronicsBoundSessionFromCatalogLab(
    lab,
    { registry, connections, manifest },
    { session_id: "INSPECT::IT-LAB-017", actor_id: "ci-verifier" }
  );
  session.start();
  const event = session.inspect("wireless_ap", "verify state-backed inspection");
  assert.ok(event.sandbox_observation);
  assert.equal(event.sandbox_observation.resolved, true);
  assert.ok(event.sandbox_observation.asset_states.some(
    (state) => state.asset_type === "wireless_ap" && state.availability === "unavailable"
  ));
}

// Representative physical/logical propagation checks.

{
  const lab = labs.find((entry) => entry.lab_id === "IT-LAB-017");
  const { sandbox, session } = createElectronicsBoundSessionFromCatalogLab(lab, { registry, connections, manifest });
  session.start();

  const snapshot = sandbox.snapshot();
  const wap = snapshot.asset_states.find((state) => state.asset_type === "wireless_ap");
  assert.ok(wap);
  assert.equal(wap.availability, "unavailable");
  assert.ok(snapshot.connection_states.some(
    (state) => state.cable_type === "CAT6A-HORIZONTAL" && state.availability === "unavailable"
  ));
}

{
  const lab = labs.find((entry) => entry.lab_id === "IT-LAB-027");
  const { sandbox, session } = createElectronicsBoundSessionFromCatalogLab(lab, { registry, connections, manifest });
  session.start();

  const snapshot = sandbox.snapshot();
  assert.ok(snapshot.asset_states.some(
    (state) => state.asset_type === "bas_controller" && state.availability === "unavailable"
  ));
  assert.ok(snapshot.asset_states.some(
    (state) => state.asset_type === "environment_sensor" && state.availability === "unavailable"
  ));
  assert.ok(snapshot.connection_states.some(
    (state) => state.cable_type === "BACNET-MSTP-STP" && state.availability === "unavailable"
  ));
}

{
  const lab = labs.find((entry) => entry.lab_id === "IT-LAB-026");
  const { sandbox, session } = createElectronicsBoundSessionFromCatalogLab(lab, { registry, connections, manifest });
  session.start();

  const snapshot = sandbox.snapshot();
  assert.ok(snapshot.asset_states.some(
    (state) => state.asset_type === "access_controller" && state.availability === "degraded"
  ));
  assert.ok(snapshot.asset_states.some(
    (state) => state.asset_type === "access_reader" && state.availability === "unavailable"
  ));
  assert.ok(snapshot.connection_states.some(
    (state) => state.cable_type === "OSDP-RS485-STP" && state.availability === "unavailable"
  ));
}

{
  const lab = labs.find((entry) => entry.lab_id === "IT-LAB-033");
  const { sandbox, session } = createElectronicsBoundSessionFromCatalogLab(lab, { registry, connections, manifest });
  session.start();

  const snapshot = sandbox.snapshot();
  assert.ok(snapshot.connection_states.some(
    (state) => state.cable_type === "OS2-SM-DUPLEX" && state.availability === "unavailable"
  ));
  assert.ok(snapshot.asset_states.some(
    (state) => state.asset_type === "access_switch" && state.availability === "degraded"
  ));
}

{
  const lab = labs.find((entry) => entry.lab_id === "IT-LAB-034");
  const { sandbox, session } = createElectronicsBoundSessionFromCatalogLab(lab, { registry, connections, manifest });
  session.start();

  const snapshot = sandbox.snapshot();
  assert.ok(snapshot.asset_states.some(
    (state) => state.asset_type === "access_switch" && state.availability === "unavailable"
  ));
  assert.ok(snapshot.asset_states.some(
    (state) => ["wireless_ap", "workstation", "ip_phone", "camera"].includes(state.asset_type) &&
      state.availability === "unavailable"
  ));
}

{
  const lab = labs.find((entry) => entry.lab_id === "IT-LAB-035");
  const { sandbox, session } = createElectronicsBoundSessionFromCatalogLab(lab, { registry, connections, manifest });
  session.start();

  const snapshot = sandbox.snapshot({ changed_only: false });
  const firewalls = snapshot.asset_states.filter((state) => state.asset_type === "firewall");
  assert.ok(firewalls.length >= 2);
  assert.equal(firewalls.filter((state) => state.availability === "unavailable").length, 1);
  assert.ok(firewalls.some((state) => state.condition_flags.includes("ha_peer_active")));
}

{
  const lab = labs.find((entry) => entry.lab_id === "IT-LAB-039");
  const { sandbox, session } = createElectronicsBoundSessionFromCatalogLab(lab, { registry, connections, manifest });
  session.start();

  const summary = sandbox.summary();
  assert.deepEqual(
    summary.active_fault_ids,
    ["bas_alarm", "core_link_degraded", "normal_power_loss"]
  );
  const snapshot = sandbox.snapshot();
  assert.ok(snapshot.asset_states.some((state) => state.condition_flags.includes("normal_power_loss")));
  assert.ok(snapshot.asset_states.some((state) => state.condition_flags.includes("core_link_degraded")));
  assert.ok(snapshot.asset_states.some((state) => state.condition_flags.includes("bas_alarm")));
  assert.ok(
    summary.asset_availability.unavailable < summary.assets_total,
    "cross-system incident must not incorrectly take the entire modeled building offline"
  );
}

{
  const lab = labs.find((entry) => entry.lab_id === "IT-LAB-040");
  const { sandbox, session } = createElectronicsBoundSessionFromCatalogLab(lab, { registry, connections, manifest });
  session.start();

  const snapshot = sandbox.snapshot();
  assert.equal(snapshot.scope_state.audit_state, "mismatch");
  assert.ok(snapshot.scope_state.condition_flags.includes("documentation_mismatch"));
}

{
  const lab = labs.find((entry) => entry.lab_id === "IT-LAB-029");
  const { sandbox, session } = createElectronicsBoundSessionFromCatalogLab(lab, { registry, connections, manifest });
  session.start();
  const snapshot = sandbox.snapshot();
  assert.ok(snapshot.asset_states.some((state) => state.security_state === "at_risk"));
}

assert.throws(
  () => new ElectronicsSandbox({
    registry: {
      ...registry,
      assets: registry.assets.map((asset, index) =>
        index === 0
          ? { ...asset, security: { ...(asset.security || {}), live_control_allowed: true } }
          : asset
      ),
    },
    connections,
    manifest,
  }),
  (error) => error instanceof LabRuntimeError && error.code === "LIVE_CONTROL_FORBIDDEN"
);

{
  const lab = labs.find((entry) => entry.lab_id === "IT-LAB-017");
  assert.throws(
    () => createElectronicsBoundSessionFromCatalogLab(
      lab,
      { registry, connections, manifest },
      { execution_target: "LIVE" }
    ),
    (error) => error instanceof LabRuntimeError && error.code === "LIVE_CONTROL_FORBIDDEN"
  );
}

console.log(JSON.stringify({
  status: "PASS",
  step: "lab-runtime-step2-electronics-binding",
  sandbox_version: ELECTRONICS_SANDBOX_VERSION,
  canonical_labs_bound: boundLabs,
  unique_target_selectors_resolved: sourceSelectors.length,
  supported_fault_ids: SUPPORTED_FAULT_IDS.length,
  injected_fault_instances_verified: injectedFaults,
  registry_assets: registry.assets.length,
  electronics_connections: connections.connections.length,
  manifest_assets: manifest.new_asset_ids.length,
  representative_propagation_checks: [
    "wifi_ap_link",
    "bas_controller_to_mstp_sensors",
    "access_controller_to_osdp_readers",
    "fiber_uplink_failover",
    "access_switch_to_floor_endpoints",
    "firewall_ha",
    "cross_system_power_core_bas",
    "commissioning_documentation_mismatch",
    "it_ot_security_posture"
  ],
  live_control_allowed: false,
  execution_target: "SANDBOX",
  deterministic_replay: true,
  state_backed_inspection: true
}, null, 2));
