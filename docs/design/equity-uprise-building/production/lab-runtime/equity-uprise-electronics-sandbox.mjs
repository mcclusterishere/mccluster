import {
  LabRuntimeError,
  adaptCatalogLab,
  createSessionFromCatalogLab,
} from "./equity-uprise-lab-runtime.mjs";

export const ELECTRONICS_SANDBOX_VERSION = "1.0.0";

const REQUIRED_FAULT_IDS = Object.freeze([
  "access_switch_failed",
  "acl_deny_error",
  "ap_link_down",
  "bas_alarm",
  "bas_controller_offline",
  "camera_link_down",
  "connector_loss",
  "core_link_degraded",
  "core_uplink_a_down",
  "deleted_config",
  "dhcp_service_down",
  "dns_service_down",
  "documentation_mismatch",
  "fiber_bend",
  "firewall_primary_down",
  "host_down",
  "idf_ups_failure",
  "igmp_snooping_off",
  "layer2_loop",
  "marginal_termination",
  "mstp_open",
  "multi_device_alert",
  "nas_degraded",
  "normal_power_loss",
  "ntp_service_down",
  "open_pair",
  "overpermissive_rule",
  "poe_disabled",
  "polarity_reversal",
  "port_shutdown",
  "qos_removed",
  "radius_cert_expired",
  "radius_policy_error",
  "reader_bus_fault",
  "reversed_pair",
  "rf_attenuation",
  "split_pair",
  "unauthorized_endpoint",
  "uplink_a_cut",
  "uplink_down",
  "voice_vlan_wrong",
  "vpn_auth_failure",
  "wrong_patch",
  "wrong_vlan",
]);

export const SUPPORTED_FAULT_IDS = Object.freeze([...REQUIRED_FAULT_IDS]);

const CONNECTION_FAULTS = Object.freeze({
  open_pair: { availability: "unavailable", condition: "open_pair" },
  reversed_pair: { availability: "degraded", condition: "reversed_pair" },
  split_pair: { availability: "degraded", condition: "split_pair" },
  marginal_termination: { availability: "degraded", condition: "marginal_termination" },
  polarity_reversal: { availability: "unavailable", condition: "polarity_reversal" },
  fiber_bend: { availability: "degraded", condition: "fiber_bend" },
  connector_loss: { availability: "degraded", condition: "connector_loss" },
});

const DIRECT_ASSET_FAULTS = Object.freeze({
  poe_disabled: { availability: "unavailable", condition: "poe_disabled" },
  port_shutdown: { availability: "unavailable", condition: "port_shutdown" },
  wrong_vlan: { availability: "degraded", condition: "wrong_vlan" },
  voice_vlan_wrong: { availability: "degraded", condition: "voice_vlan_wrong" },
  ap_link_down: { availability: "unavailable", condition: "ap_link_down" },
  rf_attenuation: { availability: "degraded", condition: "rf_attenuation" },
  host_down: { availability: "unavailable", condition: "host_down" },
  nas_degraded: { availability: "degraded", condition: "nas_degraded" },
  camera_link_down: { availability: "unavailable", condition: "camera_link_down" },
  bas_controller_offline: { availability: "unavailable", condition: "bas_controller_offline" },
  access_switch_failed: { availability: "unavailable", condition: "access_switch_failed" },
});

const SERVICE_FAULTS = Object.freeze({
  dhcp_service_down: { availability: "unavailable", condition: "service_down" },
  dns_service_down: { availability: "unavailable", condition: "service_down" },
  ntp_service_down: { availability: "unavailable", condition: "service_down" },
  radius_policy_error: { availability: "degraded", condition: "radius_policy_error" },
  vpn_auth_failure: { availability: "degraded", condition: "vpn_auth_failure" },
  radius_cert_expired: { availability: "unavailable", condition: "certificate_expired" },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniqSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function requireValue(condition, code, message) {
  if (!condition) throw new LabRuntimeError(code, message);
}

function baselineAvailability(asset) {
  const normal = asset && asset.state_model ? asset.state_model.normal_state : null;
  if (normal === "available" || normal === "degraded" || normal === "unavailable") return normal;
  return "available";
}

function worseAvailability(current, requested) {
  const rank = { available: 0, degraded: 1, unavailable: 2 };
  return (rank[requested] || 0) > (rank[current] || 0) ? requested : current;
}

function stateCounts(records) {
  const counts = { available: 0, degraded: 0, unavailable: 0 };
  for (const state of records) {
    if (Object.prototype.hasOwnProperty.call(counts, state.availability)) counts[state.availability] += 1;
  }
  return counts;
}

export class ElectronicsSandbox {
  constructor({ registry, connections, manifest }) {
    requireValue(registry && Array.isArray(registry.assets), "INVALID_ELECTRONICS_REGISTRY", "registry.assets[] is required");
    requireValue(connections && Array.isArray(connections.connections), "INVALID_ELECTRONICS_CONNECTIONS", "connections.connections[] is required");
    requireValue(manifest && Array.isArray(manifest.new_asset_ids), "INVALID_ELECTRONICS_MANIFEST", "manifest.new_asset_ids[] is required");

    this.registry = clone(registry);
    this.connectionsSource = clone(connections);
    this.manifest = clone(manifest);

    const unsafeAssets = this.registry.assets.filter((asset) => asset.security && asset.security.live_control_allowed === true);
    requireValue(unsafeAssets.length === 0, "LIVE_CONTROL_FORBIDDEN", "electronics sandbox refuses registries with LIVE control enabled");

    this.assetsById = new Map(this.registry.assets.map((asset) => [asset.asset_id, asset]));
    this.assetIdsByType = new Map();
    for (const asset of this.registry.assets) {
      const type = asset.classification && asset.classification.asset_type;
      if (!type) continue;
      if (!this.assetIdsByType.has(type)) this.assetIdsByType.set(type, []);
      this.assetIdsByType.get(type).push(asset.asset_id);
    }
    for (const ids of this.assetIdsByType.values()) ids.sort();

    this.connectionsById = new Map(this.connectionsSource.connections.map((connection) => [connection.connection_id, connection]));
    this.connectionIdsByCableType = new Map();
    this.outgoingConnectionIds = new Map();
    this.incomingConnectionIds = new Map();
    for (const connection of this.connectionsSource.connections) {
      if (!this.connectionIdsByCableType.has(connection.cable_type)) this.connectionIdsByCableType.set(connection.cable_type, []);
      this.connectionIdsByCableType.get(connection.cable_type).push(connection.connection_id);

      if (!this.outgoingConnectionIds.has(connection.from_asset_id)) this.outgoingConnectionIds.set(connection.from_asset_id, []);
      this.outgoingConnectionIds.get(connection.from_asset_id).push(connection.connection_id);

      if (!this.incomingConnectionIds.has(connection.to_asset_id)) this.incomingConnectionIds.set(connection.to_asset_id, []);
      this.incomingConnectionIds.get(connection.to_asset_id).push(connection.connection_id);
    }
    for (const ids of this.connectionIdsByCableType.values()) ids.sort();
    for (const ids of this.outgoingConnectionIds.values()) ids.sort();
    for (const ids of this.incomingConnectionIds.values()) ids.sort();

    this.containedAssets = new Map();
    this.reverseDependents = new Map();
    for (const relationship of this.registry.relationships || []) {
      if (relationship.type === "contains") {
        if (!this.containedAssets.has(relationship.from_asset_id)) this.containedAssets.set(relationship.from_asset_id, []);
        this.containedAssets.get(relationship.from_asset_id).push(relationship.to_asset_id);
      }
      if (relationship.type === "depends_on") {
        if (!this.reverseDependents.has(relationship.to_asset_id)) this.reverseDependents.set(relationship.to_asset_id, []);
        this.reverseDependents.get(relationship.to_asset_id).push(relationship.from_asset_id);
      }
    }
    for (const ids of this.containedAssets.values()) ids.sort();
    for (const ids of this.reverseDependents.values()) ids.sort();

    this.manifestAssetIds = uniqSorted(this.manifest.new_asset_ids.filter((id) => this.assetsById.has(id)));
    this._initializeState();
  }

  _initializeState() {
    this.assetStates = new Map();
    for (const asset of this.registry.assets) {
      const baseline = baselineAvailability(asset);
      this.assetStates.set(asset.asset_id, {
        asset_id: asset.asset_id,
        asset_type: asset.classification && asset.classification.asset_type ? asset.classification.asset_type : null,
        level_id: asset.location && asset.location.level_id ? asset.location.level_id : null,
        baseline_availability: baseline,
        availability: baseline,
        condition_flags: [],
        active_fault_ids: [],
        security_state: "normal",
        audit_state: "aligned",
      });
    }

    this.connectionStates = new Map();
    for (const connection of this.connectionsSource.connections) {
      this.connectionStates.set(connection.connection_id, {
        connection_id: connection.connection_id,
        from_asset_id: connection.from_asset_id,
        to_asset_id: connection.to_asset_id,
        cable_type: connection.cable_type,
        layer: connection.layer || null,
        baseline_availability: "available",
        availability: "available",
        condition_flags: [],
        active_fault_ids: [],
      });
    }

    this.scopeState = {
      condition_flags: [],
      active_fault_ids: [],
      audit_state: "aligned",
    };
    this.activeFaultIds = [];
    this.boundScenario = null;
  }

  resolveSelector(selector) {
    requireValue(typeof selector === "string" && selector.length > 0, "INVALID_TARGET_SELECTOR", "selector must be a non-empty string");

    if (selector === "cable_type_catalog") {
      const cableTypes = Object.keys(this.manifest.cable_type_catalog || {}).sort();
      return {
        selector,
        kind: "catalog",
        resolved: cableTypes.length > 0,
        asset_ids: [],
        connection_ids: [],
        catalog_ids: cableTypes,
      };
    }

    if (selector === "whole_building") {
      return {
        selector,
        kind: "scope",
        resolved: this.manifestAssetIds.length > 0,
        asset_ids: [...this.manifestAssetIds],
        connection_ids: [...this.connectionsById.keys()].sort(),
        catalog_ids: [],
      };
    }

    const levelType = /^level:(B1|F[1-6]|L7):type:(.+)$/.exec(selector);
    if (levelType) {
      const [, levelId, assetType] = levelType;
      const ids = (this.assetIdsByType.get(assetType) || []).filter((id) => {
        const asset = this.assetsById.get(id);
        return asset && asset.location && asset.location.level_id === levelId;
      }).sort();
      return {
        selector,
        kind: "level_asset_type",
        resolved: ids.length > 0,
        asset_ids: ids,
        connection_ids: [],
        catalog_ids: [],
        level_id: levelId,
      };
    }

    const levelCable = /^level:(B1|F[1-6]|L7):cable:(.+)$/.exec(selector);
    if (levelCable) {
      const [, levelId, cableType] = levelCable;
      const onLevel = (assetId) => {
        const asset = this.assetsById.get(assetId);
        return asset && asset.location && asset.location.level_id === levelId;
      };
      const ids = (this.connectionIdsByCableType.get(cableType) || []).filter((id) => {
        const connection = this.connectionsById.get(id);
        return connection && (onLevel(connection.from_asset_id) || onLevel(connection.to_asset_id));
      }).sort();
      return {
        selector,
        kind: "level_cable_type",
        resolved: ids.length > 0,
        asset_ids: [],
        connection_ids: ids,
        catalog_ids: [],
        level_id: levelId,
      };
    }

    if (this.assetsById.has(selector)) {
      return {
        selector,
        kind: "asset_id",
        resolved: true,
        asset_ids: [selector],
        connection_ids: [],
        catalog_ids: [],
      };
    }

    if (this.assetIdsByType.has(selector)) {
      const ids = [...this.assetIdsByType.get(selector)].sort();
      return {
        selector,
        kind: "asset_type",
        resolved: ids.length > 0,
        asset_ids: ids,
        connection_ids: [],
        catalog_ids: [],
      };
    }

    if (this.connectionIdsByCableType.has(selector)) {
      const ids = [...this.connectionIdsByCableType.get(selector)].sort();
      return {
        selector,
        kind: "cable_type",
        resolved: ids.length > 0,
        asset_ids: [],
        connection_ids: ids,
        catalog_ids: [],
      };
    }

    return {
      selector,
      kind: "unresolved",
      resolved: false,
      asset_ids: [],
      connection_ids: [],
      catalog_ids: [],
    };
  }

  bindScenario(scenario) {
    requireValue(scenario && Array.isArray(scenario.target_selectors), "INVALID_SCENARIO_BINDING", "scenario.target_selectors[] is required");
    const selectors = scenario.target_selectors.map((selector) => this.resolveSelector(selector));
    const unresolved = selectors.filter((entry) => !entry.resolved).map((entry) => entry.selector);
    requireValue(unresolved.length === 0, "UNRESOLVED_TARGET_SELECTOR", "unresolved target selectors: " + unresolved.join(", "));

    this.boundScenario = {
      scenario_id: scenario.scenario_id,
      source_lab_id: scenario.source_lab_id,
      target_selectors: selectors.map((entry) => ({
        selector: entry.selector,
        kind: entry.kind,
        asset_count: entry.asset_ids.length,
        connection_count: entry.connection_ids.length,
        catalog_count: entry.catalog_ids.length,
      })),
    };
    return clone(this.boundScenario);
  }

  _setAsset(assetId, faultId, { availability = null, condition = null, securityState = null, auditState = null } = {}) {
    const state = this.assetStates.get(assetId);
    if (!state) return false;
    if (availability) state.availability = worseAvailability(state.availability, availability);
    if (condition && !state.condition_flags.includes(condition)) state.condition_flags.push(condition);
    if (faultId && !state.active_fault_ids.includes(faultId)) state.active_fault_ids.push(faultId);
    if (securityState) state.security_state = securityState;
    if (auditState) state.audit_state = auditState;
    state.condition_flags.sort();
    state.active_fault_ids.sort();
    return true;
  }

  _setConnection(connectionId, faultId, { availability = null, condition = null } = {}) {
    const state = this.connectionStates.get(connectionId);
    if (!state) return false;
    if (availability) state.availability = worseAvailability(state.availability, availability);
    if (condition && !state.condition_flags.includes(condition)) state.condition_flags.push(condition);
    if (faultId && !state.active_fault_ids.includes(faultId)) state.active_fault_ids.push(faultId);
    state.condition_flags.sort();
    state.active_fault_ids.sort();
    return true;
  }

  _setScope(faultId, condition, { auditState = null } = {}) {
    if (condition && !this.scopeState.condition_flags.includes(condition)) this.scopeState.condition_flags.push(condition);
    if (faultId && !this.scopeState.active_fault_ids.includes(faultId)) this.scopeState.active_fault_ids.push(faultId);
    if (auditState) this.scopeState.audit_state = auditState;
    this.scopeState.condition_flags.sort();
    this.scopeState.active_fault_ids.sort();
  }

  _firstAssetForEachSelector(targetSelectors) {
    const selected = [];
    for (const selector of targetSelectors) {
      const resolved = this.resolveSelector(selector);
      if (resolved.asset_ids.length) selected.push(resolved.asset_ids[0]);
    }
    return uniqSorted(selected);
  }

  _firstConnectionForEachSelector(targetSelectors, predicate = null) {
    const selected = [];
    for (const selector of targetSelectors) {
      const resolved = this.resolveSelector(selector);
      const ids = predicate
        ? resolved.connection_ids.filter((id) => predicate(this.connectionsById.get(id)))
        : resolved.connection_ids;
      if (ids.length) selected.push(ids[0]);
    }
    return uniqSorted(selected);
  }

  _recordChangedAsset(set, assetId, faultId, patch) {
    if (this._setAsset(assetId, faultId, patch)) set.add(assetId);
  }

  _recordChangedConnection(set, connectionId, faultId, patch) {
    if (this._setConnection(connectionId, faultId, patch)) set.add(connectionId);
  }

  _impactConnectionEndpoints(connectionId, faultId, availability, condition, changedAssets, changedConnections) {
    const connection = this.connectionsById.get(connectionId);
    if (!connection) return;
    this._recordChangedConnection(changedConnections, connectionId, faultId, { availability, condition });
    if (connection.to_asset_id && this.assetStates.has(connection.to_asset_id)) {
      this._recordChangedAsset(changedAssets, connection.to_asset_id, faultId, {
        availability: availability === "unavailable" ? "unavailable" : "degraded",
        condition: "link_" + condition,
      });
    }
  }

  _impactHostedServices(hostId, faultId, changedAssets) {
    for (const serviceId of this.containedAssets.get(hostId) || []) {
      this._recordChangedAsset(changedAssets, serviceId, faultId, {
        availability: "unavailable",
        condition: "host_dependency_lost",
      });
      this._degradeReverseDependents(serviceId, faultId, changedAssets, 2);
    }
  }

  _degradeReverseDependents(dependencyId, faultId, changedAssets, maxDepth = 1) {
    const seen = new Set([dependencyId]);
    let frontier = [dependencyId];
    for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
      const next = [];
      for (const current of frontier) {
        for (const dependent of this.reverseDependents.get(current) || []) {
          if (seen.has(dependent)) continue;
          seen.add(dependent);
          next.push(dependent);
          this._recordChangedAsset(changedAssets, dependent, faultId, {
            availability: "degraded",
            condition: "dependency_degraded",
          });
        }
      }
      frontier = next;
    }
  }

  _impactEndpointsBehindAccessSwitch(switchId, faultId, changedAssets, changedConnections) {
    const outgoing = this.outgoingConnectionIds.get(switchId) || [];
    const patchPanels = [];
    for (const connectionId of outgoing) {
      const connection = this.connectionsById.get(connectionId);
      if (!connection) continue;
      const target = this.assetsById.get(connection.to_asset_id);
      const targetType = target && target.classification ? target.classification.asset_type : null;
      if (connection.cable_type === "CAT6A-PATCH" && targetType === "patch_panel") {
        patchPanels.push(connection.to_asset_id);
        this._recordChangedConnection(changedConnections, connectionId, faultId, {
          availability: "unavailable",
          condition: "upstream_switch_unavailable",
        });
        this._recordChangedAsset(changedAssets, connection.to_asset_id, faultId, {
          availability: "unavailable",
          condition: "upstream_switch_unavailable",
        });
      }
    }

    for (const panelId of uniqSorted(patchPanels)) {
      for (const connectionId of this.outgoingConnectionIds.get(panelId) || []) {
        const connection = this.connectionsById.get(connectionId);
        if (!connection || connection.cable_type !== "CAT6A-HORIZONTAL") continue;
        this._recordChangedConnection(changedConnections, connectionId, faultId, {
          availability: "unavailable",
          condition: "upstream_switch_unavailable",
        });
        this._recordChangedAsset(changedAssets, connection.to_asset_id, faultId, {
          availability: "unavailable",
          condition: "upstream_switch_unavailable",
        });
      }
    }
  }

  _impactBasSensors(controllerId, faultId, changedAssets, changedConnections) {
    for (const connectionId of this.outgoingConnectionIds.get(controllerId) || []) {
      const connection = this.connectionsById.get(connectionId);
      if (!connection || connection.cable_type !== "BACNET-MSTP-STP") continue;
      this._recordChangedConnection(changedConnections, connectionId, faultId, {
        availability: "unavailable",
        condition: "controller_offline",
      });
      this._recordChangedAsset(changedAssets, connection.to_asset_id, faultId, {
        availability: "unavailable",
        condition: "controller_offline",
      });
    }
  }

  _impactAccessReaderBus(controllerId, faultId, changedAssets, changedConnections) {
    for (const connectionId of this.outgoingConnectionIds.get(controllerId) || []) {
      const connection = this.connectionsById.get(connectionId);
      if (!connection || connection.cable_type !== "OSDP-RS485-STP") continue;
      this._recordChangedConnection(changedConnections, connectionId, faultId, {
        availability: "unavailable",
        condition: "reader_bus_fault",
      });
      this._recordChangedAsset(changedAssets, connection.to_asset_id, faultId, {
        availability: "unavailable",
        condition: "reader_bus_fault",
      });
    }
  }

  _impactUpsDomain(upsId, faultId, changedAssets, changedConnections) {
    const levelId = this.assetStates.get(upsId) ? this.assetStates.get(upsId).level_id : null;
    this._recordChangedAsset(changedAssets, upsId, faultId, {
      availability: "unavailable",
      condition: "ups_failure",
    });

    for (const connectionId of this.outgoingConnectionIds.get(upsId) || []) {
      const connection = this.connectionsById.get(connectionId);
      if (!connection || connection.layer !== "power") continue;
      this._recordChangedConnection(changedConnections, connectionId, faultId, {
        availability: "unavailable",
        condition: "ups_failure",
      });
      this._recordChangedAsset(changedAssets, connection.to_asset_id, faultId, {
        availability: "unavailable",
        condition: "ups_failure",
      });
    }

    if (levelId) {
      const switches = (this.assetIdsByType.get("access_switch") || []).filter((id) => {
        const state = this.assetStates.get(id);
        return state && state.level_id === levelId;
      });
      for (const switchId of switches) {
        this._recordChangedAsset(changedAssets, switchId, faultId, {
          availability: "unavailable",
          condition: "idf_power_loss",
        });
        this._impactEndpointsBehindAccessSwitch(switchId, faultId, changedAssets, changedConnections);
      }
    }
  }

  _impactNormalPower(faultId, changedAssets, changedConnections) {
    if (this.assetStates.has("ELEC-NORMAL")) {
      this._recordChangedAsset(changedAssets, "ELEC-NORMAL", faultId, {
        availability: "unavailable",
        condition: "normal_power_loss",
      });
    }

    const normalFeedIds = this.connectionsSource.connections
      .filter((connection) => connection.from_asset_id === "ELEC-NORMAL" && connection.layer === "power")
      .map((connection) => connection.connection_id)
      .sort();

    for (const connectionId of normalFeedIds) {
      const connection = this.connectionsById.get(connectionId);
      this._recordChangedConnection(changedConnections, connectionId, faultId, {
        availability: "unavailable",
        condition: "normal_power_loss",
      });
      if (connection && this.assetStates.has(connection.to_asset_id)) {
        this._recordChangedAsset(changedAssets, connection.to_asset_id, faultId, {
          availability: "unavailable",
          condition: "normal_power_loss",
        });
      }
    }

    if (normalFeedIds.length === 0) {
      const representative = this.manifestAssetIds
        .filter((id) => {
          const asset = this.assetsById.get(id);
          const families = asset && asset.systems ? asset.systems.system_families || [] : [];
          return families.includes("ELEC-NORMAL");
        })
        .slice(0, 12);
      for (const id of representative) {
        this._recordChangedAsset(changedAssets, id, faultId, {
          availability: "unavailable",
          condition: "normal_power_loss",
        });
      }
    }
  }

  _impactCoreLink(faultId, changedAssets, changedConnections) {
    const candidates = this.connectionsSource.connections
      .filter((connection) =>
        ["OS2-SM-DUPLEX", "10G-DAC"].includes(connection.cable_type) &&
        (String(connection.from_asset_id).includes("CORE") || String(connection.to_asset_id).includes("CORE"))
      )
      .sort((a, b) => a.connection_id.localeCompare(b.connection_id));
    const connection = candidates[0];
    if (!connection) return;
    this._recordChangedConnection(changedConnections, connection.connection_id, faultId, {
      availability: "degraded",
      condition: "core_link_degraded",
    });
    for (const id of [connection.from_asset_id, connection.to_asset_id]) {
      this._recordChangedAsset(changedAssets, id, faultId, {
        availability: "degraded",
        condition: "core_link_degraded",
      });
    }
  }

  _impactBasAlarm(faultId, changedAssets) {
    const sensorId = (this.assetIdsByType.get("environment_sensor") || [])[0];
    const controllerId = (this.assetIdsByType.get("bas_controller") || [])[0];
    if (sensorId) this._recordChangedAsset(changedAssets, sensorId, faultId, { condition: "bas_alarm" });
    if (controllerId) this._recordChangedAsset(changedAssets, controllerId, faultId, { condition: "bas_alarm" });
  }

  _impactDocumentationMismatch(faultId, changedAssets) {
    this._setScope(faultId, "documentation_mismatch", { auditState: "mismatch" });
    const representativeId = this.manifestAssetIds[0];
    if (representativeId) {
      this._recordChangedAsset(changedAssets, representativeId, faultId, {
        condition: "documentation_mismatch",
        auditState: "mismatch",
      });
    }
  }

  injectFault(faultId, { target_selectors = null } = {}) {
    requireValue(SUPPORTED_FAULT_IDS.includes(faultId), "UNSUPPORTED_FAULT", "unsupported electronics fault: " + faultId);
    const selectors = target_selectors || (this.boundScenario ? this.boundScenario.target_selectors.map((entry) => entry.selector) : []);
    requireValue(Array.isArray(selectors) && selectors.length > 0, "FAULT_TARGETS_REQUIRED", "fault injection requires target selectors");

    const resolved = selectors.map((selector) => this.resolveSelector(selector));
    const unresolved = resolved.filter((entry) => !entry.resolved).map((entry) => entry.selector);
    requireValue(unresolved.length === 0, "UNRESOLVED_TARGET_SELECTOR", "unresolved target selectors: " + unresolved.join(", "));

    const changedAssets = new Set();
    const changedConnections = new Set();
    const selectedAssets = this._firstAssetForEachSelector(selectors);
    const selectedConnections = this._firstConnectionForEachSelector(selectors);

    if (CONNECTION_FAULTS[faultId]) {
      const profile = CONNECTION_FAULTS[faultId];
      for (const connectionId of selectedConnections) {
        this._impactConnectionEndpoints(
          connectionId,
          faultId,
          profile.availability,
          profile.condition,
          changedAssets,
          changedConnections
        );
      }
    } else if (DIRECT_ASSET_FAULTS[faultId]) {
      const profile = DIRECT_ASSET_FAULTS[faultId];
      for (const assetId of selectedAssets) {
        this._recordChangedAsset(changedAssets, assetId, faultId, profile);
      }

      if (faultId === "poe_disabled" || faultId === "ap_link_down" || faultId === "camera_link_down") {
        for (const assetId of selectedAssets) {
          const incoming = (this.incomingConnectionIds.get(assetId) || [])
            .map((id) => this.connectionsById.get(id))
            .filter((connection) => connection && connection.cable_type === "CAT6A-HORIZONTAL")
            .sort((a, b) => a.connection_id.localeCompare(b.connection_id));
          if (incoming[0]) {
            this._recordChangedConnection(changedConnections, incoming[0].connection_id, faultId, {
              availability: "unavailable",
              condition: faultId,
            });
          }
        }
      }

      if (faultId === "host_down") {
        for (const assetId of selectedAssets) this._impactHostedServices(assetId, faultId, changedAssets);
      }

      if (faultId === "bas_controller_offline") {
        for (const assetId of selectedAssets) this._impactBasSensors(assetId, faultId, changedAssets, changedConnections);
      }

      if (faultId === "access_switch_failed") {
        for (const assetId of selectedAssets) this._impactEndpointsBehindAccessSwitch(assetId, faultId, changedAssets, changedConnections);
      }
    } else if (SERVICE_FAULTS[faultId]) {
      const profile = SERVICE_FAULTS[faultId];
      for (const assetId of selectedAssets) {
        this._recordChangedAsset(changedAssets, assetId, faultId, profile);
        if (profile.availability === "unavailable") this._degradeReverseDependents(assetId, faultId, changedAssets, 2);
      }
    } else {
      switch (faultId) {
        case "wrong_patch": {
          for (const assetId of selectedAssets) {
            this._recordChangedAsset(changedAssets, assetId, faultId, {
              availability: "degraded",
              condition: "wrong_patch",
            });
          }
          const patch = this.connectionsSource.connections
            .filter((connection) => connection.cable_type === "CAT6A-PATCH")
            .sort((a, b) => a.connection_id.localeCompare(b.connection_id))[0];
          if (patch) this._recordChangedConnection(changedConnections, patch.connection_id, faultId, {
            availability: "degraded",
            condition: "wrong_patch",
          });
          break;
        }

        case "uplink_down":
        case "core_uplink_a_down": {
          const switches = selectedAssets.filter((id) => {
            const state = this.assetStates.get(id);
            return state && state.asset_type === "access_switch";
          });
          for (const switchId of switches) {
            const uplinks = (this.outgoingConnectionIds.get(switchId) || [])
              .map((id) => this.connectionsById.get(id))
              .filter((connection) =>
                connection &&
                ["OS2-SM-DUPLEX", "10G-DAC"].includes(connection.cable_type) &&
                String(connection.to_asset_id).includes("CORE")
              )
              .sort((a, b) => String(a.from_port || "").localeCompare(String(b.from_port || "")) || a.connection_id.localeCompare(b.connection_id));
            if (uplinks[0]) {
              this._recordChangedConnection(changedConnections, uplinks[0].connection_id, faultId, {
                availability: "unavailable",
                condition: faultId,
              });
              this._recordChangedAsset(changedAssets, switchId, faultId, {
                availability: uplinks.length > 1 ? "degraded" : "unavailable",
                condition: faultId,
              });
            }
          }
          break;
        }

        case "layer2_loop": {
          for (const assetId of selectedAssets) {
            this._recordChangedAsset(changedAssets, assetId, faultId, {
              availability: "degraded",
              condition: "layer2_loop",
            });
          }
          break;
        }

        case "acl_deny_error": {
          for (const assetId of selectedAssets) {
            this._recordChangedAsset(changedAssets, assetId, faultId, {
              availability: "degraded",
              condition: "acl_deny_error",
            });
          }
          break;
        }

        case "deleted_config": {
          for (const assetId of selectedAssets) {
            this._recordChangedAsset(changedAssets, assetId, faultId, {
              availability: "degraded",
              condition: "deleted_config",
            });
          }
          break;
        }

        case "reader_bus_fault": {
          const controllers = selectedAssets.filter((id) => {
            const state = this.assetStates.get(id);
            return state && state.asset_type === "access_controller";
          });
          const readers = selectedAssets.filter((id) => {
            const state = this.assetStates.get(id);
            return state && state.asset_type === "access_reader";
          });
          for (const controllerId of controllers) {
            this._recordChangedAsset(changedAssets, controllerId, faultId, {
              availability: "degraded",
              condition: "reader_bus_fault",
            });
            this._impactAccessReaderBus(controllerId, faultId, changedAssets, changedConnections);
          }
          for (const readerId of readers) {
            this._recordChangedAsset(changedAssets, readerId, faultId, {
              availability: "unavailable",
              condition: "reader_bus_fault",
            });
          }
          break;
        }

        case "mstp_open": {
          const sensors = selectedAssets.filter((id) => {
            const state = this.assetStates.get(id);
            return state && state.asset_type === "environment_sensor";
          });
          for (const sensorId of sensors) {
            this._recordChangedAsset(changedAssets, sensorId, faultId, {
              availability: "unavailable",
              condition: "mstp_open",
            });
            const incoming = (this.incomingConnectionIds.get(sensorId) || [])
              .map((id) => this.connectionsById.get(id))
              .filter((connection) => connection && connection.cable_type === "BACNET-MSTP-STP")
              .sort((a, b) => a.connection_id.localeCompare(b.connection_id));
            if (incoming[0]) this._recordChangedConnection(changedConnections, incoming[0].connection_id, faultId, {
              availability: "unavailable",
              condition: "mstp_open",
            });
          }
          break;
        }

        case "overpermissive_rule": {
          for (const assetId of selectedAssets) {
            const state = this.assetStates.get(assetId);
            if (!state) continue;
            this._recordChangedAsset(changedAssets, assetId, faultId, {
              condition: "overpermissive_rule",
              securityState: "at_risk",
            });
          }
          break;
        }

        case "igmp_snooping_off":
        case "qos_removed": {
          for (const assetId of selectedAssets) {
            this._recordChangedAsset(changedAssets, assetId, faultId, {
              availability: "degraded",
              condition: faultId,
            });
          }
          break;
        }

        case "idf_ups_failure": {
          const upsIds = selectedAssets.filter((id) => {
            const state = this.assetStates.get(id);
            return state && state.asset_type === "rack_ups";
          });
          for (const upsId of upsIds) this._impactUpsDomain(upsId, faultId, changedAssets, changedConnections);
          break;
        }

        case "uplink_a_cut": {
          const candidates = resolved
            .flatMap((entry) => entry.connection_ids)
            .map((id) => this.connectionsById.get(id))
            .filter((connection) => connection && connection.cable_type === "OS2-SM-DUPLEX")
            .sort((a, b) => {
              const ap = a.from_port === "UPLINK-1" ? 0 : 1;
              const bp = b.from_port === "UPLINK-1" ? 0 : 1;
              return ap - bp || a.connection_id.localeCompare(b.connection_id);
            });
          const connection = candidates[0];
          if (connection) {
            this._recordChangedConnection(changedConnections, connection.connection_id, faultId, {
              availability: "unavailable",
              condition: "fiber_cut",
            });
            this._recordChangedAsset(changedAssets, connection.from_asset_id, faultId, {
              availability: "degraded",
              condition: "redundant_uplink_active",
            });
          }
          break;
        }

        case "firewall_primary_down": {
          const firewalls = (this.assetIdsByType.get("firewall") || []).sort();
          const primary = firewalls[0];
          if (primary) {
            this._recordChangedAsset(changedAssets, primary, faultId, {
              availability: "unavailable",
              condition: "ha_primary_down",
            });
          }
          if (firewalls[1]) {
            this._recordChangedAsset(changedAssets, firewalls[1], faultId, {
              condition: "ha_peer_active",
            });
          }
          if (this.assetStates.has("LOGIC-SVC-VPN-REMOTE-ACCESS")) {
            this._recordChangedAsset(changedAssets, "LOGIC-SVC-VPN-REMOTE-ACCESS", faultId, {
              availability: "degraded",
              condition: "ha_failover",
            });
          }
          break;
        }

        case "unauthorized_endpoint": {
          for (const assetId of selectedAssets) {
            this._recordChangedAsset(changedAssets, assetId, faultId, {
              condition: "unauthorized_endpoint",
              securityState: "at_risk",
            });
          }
          break;
        }

        case "multi_device_alert": {
          for (const assetId of selectedAssets) {
            this._recordChangedAsset(changedAssets, assetId, faultId, { condition: "multi_device_alert" });
          }
          const representatives = this.manifestAssetIds
            .filter((id) => {
              const state = this.assetStates.get(id);
              return state && ["access_switch", "firewall", "bas_controller", "camera"].includes(state.asset_type);
            })
            .slice(0, 4);
          for (const id of representatives) this._recordChangedAsset(changedAssets, id, faultId, { condition: "alerting" });
          break;
        }

        case "normal_power_loss":
          this._impactNormalPower(faultId, changedAssets, changedConnections);
          break;

        case "core_link_degraded":
          this._impactCoreLink(faultId, changedAssets, changedConnections);
          break;

        case "bas_alarm":
          this._impactBasAlarm(faultId, changedAssets);
          break;

        case "documentation_mismatch":
          this._impactDocumentationMismatch(faultId, changedAssets);
          break;

        default:
          throw new LabRuntimeError("UNSUPPORTED_FAULT", "unsupported electronics fault: " + faultId);
      }
    }

    requireValue(
      changedAssets.size > 0 || changedConnections.size > 0 || this.scopeState.active_fault_ids.includes(faultId),
      "FAULT_NO_EFFECT",
      "fault produced no sandbox state change: " + faultId
    );

    if (!this.activeFaultIds.includes(faultId)) this.activeFaultIds.push(faultId);
    this.activeFaultIds.sort();

    return {
      fault_id: faultId,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      target_selectors: [...selectors],
      changed_asset_ids: [...changedAssets].sort(),
      changed_connection_ids: [...changedConnections].sort(),
      scope_changed: this.scopeState.active_fault_ids.includes(faultId),
      state_summary: this.summary(),
    };
  }

  inspect(target) {
    const resolved = this.resolveSelector(target);
    if (!resolved.resolved) {
      if (this.connectionStates.has(target)) {
        return { target, kind: "connection_id", connection: clone(this.connectionStates.get(target)) };
      }
      return { target, kind: "unresolved", resolved: false };
    }

    const assetStates = resolved.asset_ids
      .slice(0, 25)
      .map((id) => clone(this.assetStates.get(id)))
      .filter(Boolean);
    const connectionStates = resolved.connection_ids
      .slice(0, 25)
      .map((id) => clone(this.connectionStates.get(id)))
      .filter(Boolean);

    return {
      target,
      kind: resolved.kind,
      resolved: true,
      asset_count: resolved.asset_ids.length,
      connection_count: resolved.connection_ids.length,
      catalog_count: resolved.catalog_ids.length,
      asset_states: assetStates,
      connection_states: connectionStates,
      catalog_ids: resolved.catalog_ids.slice(0, 25),
      truncated:
        resolved.asset_ids.length > assetStates.length ||
        resolved.connection_ids.length > connectionStates.length ||
        resolved.catalog_ids.length > 25,
    };
  }

  summary() {
    const assets = [...this.assetStates.values()];
    const connections = [...this.connectionStates.values()];
    return {
      sandbox_version: ELECTRONICS_SANDBOX_VERSION,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      assets_total: assets.length,
      connections_total: connections.length,
      asset_availability: stateCounts(assets),
      connection_availability: stateCounts(connections),
      faulted_asset_count: assets.filter((state) => state.active_fault_ids.length > 0).length,
      faulted_connection_count: connections.filter((state) => state.active_fault_ids.length > 0).length,
      active_fault_ids: [...this.activeFaultIds],
      scope_state: clone(this.scopeState),
    };
  }

  snapshot({ changed_only = true } = {}) {
    const assets = [...this.assetStates.values()]
      .filter((state) => !changed_only || state.active_fault_ids.length > 0 || state.condition_flags.length > 0 || state.audit_state !== "aligned" || state.security_state !== "normal")
      .sort((a, b) => a.asset_id.localeCompare(b.asset_id))
      .map(clone);
    const connections = [...this.connectionStates.values()]
      .filter((state) => !changed_only || state.active_fault_ids.length > 0 || state.condition_flags.length > 0)
      .sort((a, b) => a.connection_id.localeCompare(b.connection_id))
      .map(clone);

    return {
      sandbox_version: ELECTRONICS_SANDBOX_VERSION,
      execution_target: "SANDBOX",
      live_control_allowed: false,
      scenario_binding: clone(this.boundScenario),
      summary: this.summary(),
      asset_states: assets,
      connection_states: connections,
      scope_state: clone(this.scopeState),
    };
  }

  reset() {
    const before = this.summary();
    const scenarioBinding = clone(this.boundScenario);
    this._initializeState();
    this.boundScenario = scenarioBinding;
    return {
      reset: true,
      baseline_restored: true,
      prior_active_fault_ids: before.active_fault_ids,
      scenario_binding_preserved: Boolean(this.boundScenario),
      state_summary: this.summary(),
    };
  }
}

export function createElectronicsBoundSessionFromCatalogLab(
  lab,
  { registry, connections, manifest },
  {
    session_id = "SIM::" + (lab && lab.lab_id ? lab.lab_id : "UNKNOWN") + "::001",
    actor_id = "learner",
    execution_target = "SANDBOX",
  } = {}
) {
  const scenario = adaptCatalogLab(lab);
  const sandbox = new ElectronicsSandbox({ registry, connections, manifest });
  sandbox.bindScenario(scenario);
  const session = createSessionFromCatalogLab(lab, {
    session_id,
    actor_id,
    execution_target,
    sandbox,
  });
  return { scenario, sandbox, session };
}
