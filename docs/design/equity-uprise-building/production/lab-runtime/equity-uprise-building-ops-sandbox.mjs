import { LabRuntimeError } from "./equity-uprise-lab-runtime.mjs";

export const BUILDING_OPS_SANDBOX_VERSION = "1.0.0";
export const BUILDING_OPS_SUPPORTED_FAULTS = Object.freeze([
  "alarm_active",
  "stair_a_blocked",
  "passenger_elevator_unavailable",
  "normal_power_degraded",
  "medical_incident_active",
  "arrival_queue_elevated",
  "directory_checkin_unavailable",
  "service_area_hazard",
]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const requireValue = (condition, code, message) => {
  if (!condition) throw new LabRuntimeError(code, message);
};
const addSorted = (list, value) => {
  if (!list.includes(value)) list.push(value);
  list.sort();
};

export class BuildingOperationsSandbox {
  constructor({ program, simulationObjects, objectInventory, registry }) {
    requireValue(program && Array.isArray(program.scenarios), "INVALID_BUILDING_OPS_PROGRAM", "program.scenarios[] is required");
    requireValue(simulationObjects && Array.isArray(simulationObjects.objects), "INVALID_BUILDING_OPS_OBJECTS", "simulationObjects.objects[] is required");
    requireValue(objectInventory && Array.isArray(objectInventory.objects), "INVALID_BUILDING_OPS_INVENTORY", "objectInventory.objects[] is required");
    requireValue(registry && Array.isArray(registry.assets), "INVALID_BUILDING_OPS_REGISTRY", "registry.assets[] is required");

    this.program = clone(program);
    this.baseObjects = new Map();

    for (const object of simulationObjects.objects) {
      this.baseObjects.set(object.object_id, {
        object_id: object.object_id,
        source: "floor_01_simulation_object",
        system: object.system || null,
        type: object.type || null,
        label: object.label || object.object_id,
        baseline_state: object.normal_state || "available",
      });
    }

    for (const object of objectInventory.objects) {
      if (!this.baseObjects.has(object.id)) {
        this.baseObjects.set(object.id, {
          object_id: object.id,
          source: "floor_01_object_inventory",
          system: object.category || null,
          type: object.category || null,
          label: object.label || object.id,
          baseline_state: "available",
        });
      }
    }

    for (const assetId of ["ELEC-NORMAL", "LOGIC-SVC-DIRECTORY-IDP"]) {
      const asset = registry.assets.find((entry) => entry.asset_id === assetId);
      requireValue(Boolean(asset), "BUILDING_OPS_CANONICAL_ASSET_MISSING", "required canonical asset missing: " + assetId);
      this.baseObjects.set(assetId, {
        object_id: assetId,
        source: "asset_registry",
        system: asset.classification?.asset_type || "canonical_asset",
        type: asset.classification?.asset_type || "canonical_asset",
        label: asset.label || assetId,
        baseline_state: "available",
      });
    }

    this.semanticBaseline = {
      "RUNTIME-OPS-ALARM": { state: "normal" },
      "RUNTIME-OPS-MUSTER": { state: "inactive", accounted: false },
      "RUNTIME-OPS-MEDICAL": { state: "inactive", responder_handoff: false },
      "RUNTIME-OPS-QUEUE": { state: "normal", capacity: "normal" },
      "RUNTIME-OPS-SERVICE-HAZARD": { state: "clear", boundary: "normal" },
      "RUNTIME-OPS-COMMUNICATION": { state: "normal", fallback_active: false },
    };

    this._initializeState();
  }

  _initializeState() {
    this.objectStates = new Map();
    for (const base of this.baseObjects.values()) {
      this.objectStates.set(base.object_id, {
        ...clone(base),
        state: base.baseline_state,
        availability: "available",
        condition_flags: [],
        active_fault_ids: [],
      });
    }
    this.semanticStates = new Map(
      Object.entries(this.semanticBaseline).map(([id, state]) => [
        id,
        { object_id: id, source: "runtime_semantic_state", ...clone(state), condition_flags: [], active_fault_ids: [] },
      ])
    );
    this.activeFaultIds = [];
    this.boundScenario = null;
  }

  resolveSelector(selector) {
    if (selector === "whole_floor_01") {
      return {
        selector,
        kind: "scope",
        resolved: true,
        object_ids: [...this.objectStates.keys()].sort(),
        semantic_ids: [...this.semanticStates.keys()].sort(),
      };
    }
    if (this.objectStates.has(selector)) {
      return { selector, kind: "object_id", resolved: true, object_ids: [selector], semantic_ids: [] };
    }
    if (this.semanticStates.has(selector)) {
      return { selector, kind: "semantic_state", resolved: true, object_ids: [], semantic_ids: [selector] };
    }
    return { selector, kind: "unresolved", resolved: false, object_ids: [], semantic_ids: [] };
  }

  bindScenario(scenario) {
    requireValue(scenario && Array.isArray(scenario.target_selectors), "INVALID_BUILDING_OPS_SCENARIO", "target_selectors[] is required");
    const resolved = scenario.target_selectors.map((selector) => this.resolveSelector(selector));
    const unresolved = resolved.filter((entry) => !entry.resolved).map((entry) => entry.selector);
    requireValue(unresolved.length === 0, "UNRESOLVED_TARGET_SELECTOR", "unresolved building-ops selectors: " + unresolved.join(", "));
    this.boundScenario = {
      scenario_id: scenario.scenario_id,
      source_scenario_id: scenario.source_scenario_id || null,
      selectors: resolved.map((entry) => ({
        selector: entry.selector,
        kind: entry.kind,
        object_count: entry.object_ids.length,
        semantic_count: entry.semantic_ids.length,
      })),
    };
    return clone(this.boundScenario);
  }

  _setObject(id, faultId, patch = {}) {
    const state = this.objectStates.get(id);
    if (!state) return false;
    if (patch.state !== undefined) state.state = patch.state;
    if (patch.availability !== undefined) state.availability = patch.availability;
    if (patch.condition) addSorted(state.condition_flags, patch.condition);
    addSorted(state.active_fault_ids, faultId);
    return true;
  }

  _setSemantic(id, faultId, patch = {}) {
    const state = this.semanticStates.get(id);
    if (!state) return false;
    for (const [key, value] of Object.entries(patch)) {
      if (key !== "condition") state[key] = clone(value);
    }
    if (patch.condition) addSorted(state.condition_flags, patch.condition);
    addSorted(state.active_fault_ids, faultId);
    return true;
  }

  injectFault(faultId) {
    requireValue(BUILDING_OPS_SUPPORTED_FAULTS.includes(faultId), "UNSUPPORTED_BUILDING_OPS_FAULT", "unsupported building-ops fault: " + faultId);
    const changed = new Set();
    const object = (id, patch) => { if (this._setObject(id, faultId, patch)) changed.add(id); };
    const semantic = (id, patch) => { if (this._setSemantic(id, faultId, patch)) changed.add(id); };

    switch (faultId) {
      case "alarm_active":
        semantic("RUNTIME-OPS-ALARM", { state: "active", condition: "exercise_alarm" });
        semantic("RUNTIME-OPS-MUSTER", { state: "required", accounted: false, condition: "accountability_required" });
        object("F1-EGRESS-MAP-01", { condition: "egress_guidance_active" });
        object("F1-EGRESS-MAP-02", { condition: "egress_guidance_active" });
        object("F1-BARRIER-STAIR-A-DOWN", { state: "evacuation_barrier_active", condition: "evacuation_mode" });
        object("F1-BARRIER-STAIR-B-DOWN", { state: "evacuation_barrier_active", condition: "evacuation_mode" });
        break;
      case "stair_a_blocked":
        object("F1-DOOR-STAIR-A-DISCHARGE", { state: "blocked", availability: "unavailable", condition: "alternate_route_required" });
        object("site-east-egress-walk", { state: "blocked", availability: "unavailable", condition: "route_unavailable" });
        object("site-north-egress-walk", { condition: "alternate_route_candidate" });
        break;
      case "passenger_elevator_unavailable":
        object("F1-PASS-ELEV-DOOR-01", { state: "unavailable", availability: "unavailable", condition: "elevator_outage" });
        object("F1-PASS-ELEV-CALL-01", { state: "unavailable", availability: "unavailable", condition: "elevator_outage" });
        object("F1-TWOWAY-01", { condition: "accessibility_communication_available" });
        break;
      case "normal_power_degraded":
        object("ELEC-NORMAL", { state: "degraded", availability: "degraded", condition: "normal_power_degraded" });
        object("F1-DIRECTORY-01", { state: "offline", availability: "unavailable", condition: "normal_power_dependency" });
        object("F1-RECEPTION-MONITOR-01", { state: "degraded", availability: "degraded", condition: "continuity_mode" });
        object("F1-TWOWAY-01", { condition: "emergency_communication_preserved" });
        break;
      case "medical_incident_active":
        semantic("RUNTIME-OPS-MEDICAL", { state: "active", responder_handoff: false, condition: "emergency_services_required" });
        object("F1-AED-01", { condition: "available_for_trained_responder" });
        object("F1-FIRST-AID-01", { condition: "available_for_trained_responder" });
        object("site-responder-keep-clear", { condition: "responder_access_required" });
        object("F1-RECEPTION-SECURITY-01", { condition: "incident_communication_active" });
        break;
      case "arrival_queue_elevated":
        semantic("RUNTIME-OPS-QUEUE", { state: "surge", capacity: "constrained", condition: "arrival_queue_elevated" });
        object("F1-RECEPTION-DESK-01", { availability: "degraded", condition: "surge_mode" });
        object("F1-RECEPTION-ACCESS-01", { condition: "accessible_service_position_preserved" });
        break;
      case "directory_checkin_unavailable":
        semantic("RUNTIME-OPS-COMMUNICATION", { state: "degraded", fallback_active: false, condition: "checkin_fallback_required" });
        object("F1-DIRECTORY-01", { state: "offline", availability: "unavailable", condition: "directory_checkin_outage" });
        object("LOGIC-SVC-DIRECTORY-IDP", { state: "unavailable", availability: "unavailable", condition: "directory_checkin_outage" });
        object("F1-RECEPTION-SECURITY-01", { availability: "degraded", condition: "manual_checkin_required" });
        break;
      case "service_area_hazard":
        semantic("RUNTIME-OPS-SERVICE-HAZARD", { state: "active", boundary: "restricted", condition: "service_area_hazard" });
        object("site-service-apron-west", { state: "restricted", availability: "unavailable", condition: "hazard_boundary" });
        object("F1-DOOR-SERVICE-WEST", { state: "restricted", availability: "unavailable", condition: "hazard_boundary" });
        object("site-responder-keep-clear", { condition: "responder_access_required" });
        break;
    }

    addSorted(this.activeFaultIds, faultId);
    return {
      fault_id: faultId,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      changed_ids: [...changed].sort(),
      state_summary: this.summary(),
    };
  }

  inspect(selector) {
    const resolved = this.resolveSelector(selector);
    if (!resolved.resolved) return { target: selector, resolved: false, kind: "unresolved" };
    return {
      target: selector,
      resolved: true,
      kind: resolved.kind,
      object_states: resolved.object_ids.slice(0, 40).map((id) => clone(this.objectStates.get(id))),
      semantic_states: resolved.semantic_ids.slice(0, 20).map((id) => clone(this.semanticStates.get(id))),
      object_count: resolved.object_ids.length,
      semantic_count: resolved.semantic_ids.length,
      truncated: resolved.object_ids.length > 40 || resolved.semantic_ids.length > 20,
    };
  }

  summary() {
    return {
      sandbox_version: BUILDING_OPS_SANDBOX_VERSION,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      active_fault_ids: [...this.activeFaultIds].sort(),
      changed_object_count: [...this.objectStates.values()].filter((state) => state.active_fault_ids.length > 0).length,
      changed_semantic_count: [...this.semanticStates.values()].filter((state) => state.active_fault_ids.length > 0).length,
    };
  }

  snapshot({ changed_only = true } = {}) {
    return {
      sandbox_version: BUILDING_OPS_SANDBOX_VERSION,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      scenario_binding: clone(this.boundScenario),
      summary: this.summary(),
      object_states: [...this.objectStates.values()]
        .filter((state) => !changed_only || state.active_fault_ids.length > 0 || state.condition_flags.length > 0)
        .sort((a, b) => a.object_id.localeCompare(b.object_id))
        .map(clone),
      semantic_states: [...this.semanticStates.values()]
        .filter((state) => !changed_only || state.active_fault_ids.length > 0 || state.condition_flags.length > 0)
        .sort((a, b) => a.object_id.localeCompare(b.object_id))
        .map(clone),
    };
  }

  reset() {
    const prior = [...this.activeFaultIds];
    this._initializeState();
    return { reset: true, baseline_restored: true, prior_active_fault_ids: prior, state_summary: this.summary() };
  }
}
