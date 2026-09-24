import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VIEWER_LAB_INTEGRATION_VERSION,
  VIEWER_LAB_EXECUTION_TARGET,
  createViewerLabController,
} from "./equity-uprise-viewer-lab-integration.mjs";
import { resolveElectronicsSpatialBinding, ELECTRONICS_TO_METERS, ELECTRONICS_SPATIAL_BINDING_VERSION } from "../electronics/equity-uprise-electronics-spatial-bindings-v1.mjs";

const load = (relativePath) => JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
const text = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
function fakeClock(start = 1000, step = 100) {
  let now = start;
  return () => { const out = now; now += step; return out; };
}

const deviceArchetypes = load("../electronics/device-archetypes-v1.json");
const deviceComponents = load("../electronics/generated/equity-uprise-device-components-v1.json");
const datasets = {
  distributedPack: load("./distributed-building-scenario-pack-v1.json"),
  cisaPack: load("./cisa-itot-scenario-pack-v1.json"),
  opsPack: load("./fema-building-ops-scenario-pack-v1.json"),
  publicServicePack: load("./public-service-scenario-pack-v1.json"),
  difficultyPolicy: load("./difficulty-progression-policy-v1.json"),
  learnerExperience: load("./learner-experience-v1.json"),
  rubrics: load("../../../equity-uprise-development/competency-rubrics.json"),
  federalBindings: load("../../../equity-uprise-development/FEDERAL-TRAINING-BINDINGS.json"),
  labCatalog: load("../electronics/generated/equity-uprise-it-lab-catalog-v1.json"),
  registry: load("../asset-registry/generated/equity-uprise-asset-registry-v1.json"),
  connections: load("../electronics/generated/equity-uprise-electronics-connections-v1.json"),
  manifest: load("../electronics/generated/equity-uprise-electronics-manifest-v1.json"),
  program: load("../floor-01/floor-01-digital-twin-program.json"),
  simulationObjects: load("../floor-01/floor-01-simulation-objects.json"),
  objectInventory: load("../floor-01/floor-01-object-inventory.json"),
};

assert.equal(VIEWER_LAB_INTEGRATION_VERSION, "1.1.0");
assert.equal(VIEWER_LAB_EXECUTION_TARGET, "SANDBOX");

const integrationText = text("./equity-uprise-viewer-lab-integration.mjs");
for (const required of [
  "./equity-uprise-guided-scenarios.mjs",
  "distributedPack",
  "DISTRIBUTED_TECHNICAL",
  "./equity-uprise-building-ops-runtime.mjs",
  "./equity-uprise-public-service-runtime.mjs",
  "./equity-uprise-assessment-runtime.mjs",
  "./equity-uprise-difficulty-runtime.mjs",
]) {
  assert.ok(integrationText.includes(required), "viewer integration must reference canonical runtime module " + required);
}
assert.ok(!integrationText.includes("live_control_allowed: true"));
assert.ok(integrationText.includes("execution_target: \"SANDBOX\""));

const registryIds = new Set((datasets.registry.assets || []).map((asset) => asset.asset_id));
const manifestIds = datasets.manifest.new_asset_ids || [];
const connectionIds = new Set((datasets.connections.connections || []).map((connection) => connection.connection_id));
assert.equal(new Set(manifestIds).size, manifestIds.length, "manifest asset IDs must remain unique");
assert.ok(manifestIds.every((id) => registryIds.has(id)), "every electronics manifest ID must resolve in canonical registry");
for (const connection of datasets.connections.connections || []) {
  assert.ok(registryIds.has(connection.from_asset_id), "connection source must resolve " + connection.connection_id);
  assert.ok(registryIds.has(connection.to_asset_id), "connection destination must resolve " + connection.connection_id);
}

assert.equal(datasets.manifest.status, "step4b-physical-installation-fabric");
assert.equal(datasets.connections.status, "step4b-physical-installation-connections");
for (const connection of datasets.connections.connections || []) {
  assert.ok((connection.route || []).length >= 2, "physical connection must expose routed geometry: " + connection.connection_id);
  assert.ok(connection.from_port && connection.to_port, "physical connection must expose both port IDs: " + connection.connection_id);
  assert.ok(connection.metadata?.pathway_class, "physical connection must expose pathway class: " + connection.connection_id);
  assert.equal(connection.metadata?.lab_traceable, true, "physical connection must be lab-traceable: " + connection.connection_id);
}

assert.equal(deviceArchetypes.status, "step4c-device-archetype-authority");
assert.equal(deviceComponents.status, "step4c-device-components");
const cameraRecords = (deviceComponents.devices || []).filter((record) => record.archetype === "camera");
assert.equal(cameraRecords.length, 18, "Step 4C must publish all 18 modeled security-camera assemblies");
for (const camera of cameraRecords) {
  const componentIds = new Set((camera.components || []).map((part) => part.component_id));
  for (const required of ["MOUNT_PLATE","BRACKET_ARM","HOUSING","LENS_BARREL","LENS_GLASS","IR_LED_RING","STATUS_LED","RJ45_POE_PORT","CABLE_ENTRY"]) {
    assert.ok(componentIds.has(required), camera.asset_id + " missing Step 4C camera component " + required);
  }
  assert.ok((camera.ports || []).some((port) =>
    port.id === "RJ45_POE_PORT" &&
    (port.services || []).includes("Ethernet/IP") &&
    (port.services || []).includes("PoE")
  ), camera.asset_id + " missing functional RJ45/PoE port");
  assert.deepEqual(camera.lab_behaviors, ["camera_link_down","poe_disabled"]);
}
assert.ok((deviceArchetypes.archetypes.camera.planned_behaviors || []).includes("lens_obstructed"),
  "lens obstruction must remain planned until runtime support exists");

function controller(lab, difficulty, start = 1000) {
  return createViewerLabController({
    lab,
    difficulty,
    datasets,
    actor_id: "step8-verifier",
    clock: fakeClock(start, 100),
  });
}

const expert = controller("IT-LAB-039", "EXPERT");
let expertView = expert.start();
assert.equal(expertView.execution_target, "SANDBOX");
assert.equal(expertView.live_control_allowed, false);
assert.equal(expertView.scenario.family, "CISA_ITOT");
assert.equal(expertView.learner.objective_view, null, "Expert objectives must remain hidden");
assert.equal(expertView.learner.fault_view, null, "Expert fault identity must remain hidden");
assert.equal(expertView.learner.hint_policy.budget, 0, "Expert hint budget must be zero");
assert.deepEqual(expertView.learner.hint_policy.allowed_levels, []);
assert.ok(expertView.learner.action_view.every((item) => Object.keys(item).length === 1 && item.action_id), "Expert action view must be ID-only");
assert.ok(expertView.visuals.assets.length > 0, "Expert incident must still create visible simulated equipment state");
assert.ok(expertView.visuals.assets.every((item) => registryIds.has(item.canonical_id)), "visual equipment must use canonical registry IDs");
assert.ok(expertView.visuals.connections.every((item) => connectionIds.has(item.connection_id)), "visual paths must use canonical connection IDs");
assert.equal(new Set(expertView.visuals.assets.map((item) => item.canonical_id)).size, expertView.visuals.assets.length, "adapter may not invent duplicate asset records");
assert.ok(expertView.systems.length > 0, "runtime-backed system state must be visible");
assert.throws(() => expert.requestHint("supported"), (error) => error.code === "DIFFICULTY_HINT_BUDGET_EXHAUSTED");

const forbiddenAwards = /\b(?:Verified|Applied|Mentor)\b/;
assert.equal(forbiddenAwards.test(JSON.stringify(expertView.assessment)), false, "viewer assessment summary must not render human competency awards");
assert.equal(expertView.assessment.maximum_automated_state, "Demonstrated");

const resetView = expert.reset();
assert.equal(resetView.scenario.phase, "CREATED");
assert.deepEqual(resetView.visuals.assets, []);
assert.deepEqual(resetView.visuals.connections, []);
assert.deepEqual(resetView.visuals.objects, []);
assert.deepEqual(resetView.visuals.areas, []);
assert.deepEqual(resetView.visuals.occupants, []);
assert.deepEqual(resetView.systems, []);

const foundationA = controller("IT-LAB-039", "FOUNDATION", 5000);
const foundationB = controller("IT-LAB-039", "FOUNDATION", 5000);
const foundationViewA = foundationA.start();
const foundationViewB = foundationB.start();
assert.deepEqual(foundationViewA.visuals, foundationViewB.visuals, "fault-to-visual mapping must be deterministic");
assert.deepEqual(foundationViewA.systems, foundationViewB.systems, "system-state mapping must be deterministic");
assert.ok(foundationViewA.learner.objective_view !== null, "Foundation objectives must be visible");
assert.deepEqual(foundationViewA.learner.fault_view.active_fault_ids, ["bas_alarm","core_link_degraded","normal_power_loss"]);
assert.equal(foundationViewA.learner.hint_policy.budget, 3);
assert.ok(foundationViewA.learner.action_view.every((item) =>
  Object.prototype.hasOwnProperty.call(item, "target") &&
  Object.prototype.hasOwnProperty.call(item, "requires") &&
  Object.prototype.hasOwnProperty.call(item, "observation")
), "Foundation action guidance must include target/prerequisite/observation detail");

const fullRun = controller("IT-LAB-039", "FOUNDATION", 9000);
fullRun.start();
const definition039 = datasets.cisaPack.scenarios.find((scenario) => scenario.source_lab_id === "IT-LAB-039");
for (const step of definition039.verification_path) {
  const out = fullRun.execute(step.action_id, step.input || {});
  assert.equal(out.result.status, "success", "Step 8 viewer must execute through canonical guided runtime");
}
let restored = fullRun.snapshot();
assert.deepEqual(restored.visuals.assets, [], "successful remediation must clear equipment fault visuals");
assert.deepEqual(restored.visuals.connections, [], "successful remediation must clear path fault visuals");
const completed = fullRun.complete().view;
assert.equal(completed.scenario.phase, "COMPLETED");
assert.ok(completed.assessment.actions.total >= definition039.verification_path.length);
assert.equal(completed.assessment.critical_safety_clear, true);
assert.match(completed.assessment.automated_evidence_signal, /evidence|insufficient|practicing/i);

const distributedScenarios = datasets.distributedPack.scenarios || [];
const wifiScenario = distributedScenarios.find((scenario) => scenario.source_lab_id === "IT-LAB-017");
assert.ok(wifiScenario, "distributed pack must include the Floor 2 Wi-Fi scenario");
assert.equal(wifiScenario.viewer_focus, "2");
assert.deepEqual(wifiScenario.floor_scope, ["F2"]);
assert.ok((wifiScenario.actions || []).some((action) => action.action_id === "f2-wifi-diagnose"));

const beginnerTicket = controller("IT-LAB-008", "FOUNDATION", 19500).start();
assert.equal(beginnerTicket.learner_experience.learner_first, true);
assert.equal(beginnerTicket.learner_experience.title, "The check-in computer has no internet");
assert.equal(beginnerTicket.learner_experience.diagnostic_stage, "OBSERVE");
assert.ok(beginnerTicket.learner_experience.available_actions.every((action) => !/IT-LAB|f1-workstation-link/i.test(action.label)),
  "Foundation action labels must be human-readable instead of raw action IDs");
const beginnerDiagnosis = beginnerTicket.learner_experience.available_actions.find((action) => action.action_id === "f1-workstation-link-diagnose");
assert.ok(beginnerDiagnosis);
assert.equal(beginnerDiagnosis.decision_choices.length, 3);
assert.ok(beginnerDiagnosis.decision_choices.every((choice) => choice.label && choice.input),
  "Foundation diagnosis must expose plain-language choices with runtime inputs");
assert.equal(beginnerTicket.learner_experience.engineering_default, false,
  "Foundation learner presentation must not force engineering X-Ray");

const wifiTicket = controller("IT-LAB-017", "FOUNDATION", 19600).start();
assert.equal(wifiTicket.learner_experience.title, "The Wi-Fi on Floor 2 stopped working");
assert.equal(wifiTicket.learner_experience.reinforcement.title, "Got WiFi?");
assert.match(wifiTicket.learner_experience.reinforcement.url, /album\.html\?album=prim3/);
assert.ok(wifiTicket.visuals.assets.some((asset) => asset.asset_type === "wireless_ap"),
  "Wi-Fi ticket must materialize a wireless access-point fault");
assert.equal(distributedScenarios.length, 11, "distributed practical-lab pack must expose 11 floor/cross-floor scenarios including a beginner Wi-Fi ticket");
assert.equal(new Set(distributedScenarios.map((scenario) => scenario.source_lab_id)).size, distributedScenarios.length,
  "distributed source labs must be unique in the viewer selector");
const representedFloors = new Set(distributedScenarios.flatMap((scenario) => scenario.floor_scope || []));
for (const levelId of ["B1","F1","F2","F3","F4","F5","F6","L7"]) {
  assert.ok(representedFloors.has(levelId), "distributed lab pack must cover " + levelId);
}
const rubricIds = new Set((datasets.rubrics.rubrics || []).map((rubric) => rubric.competency_id));
for (const scenario of distributedScenarios) {
  assert.equal(scenario.engineering_view, true);
  assert.ok((scenario.competency_ids || []).length > 0, "distributed lab must bind competency IDs: " + scenario.scenario_id);
  assert.ok((scenario.competency_ids || []).every((id) => rubricIds.has(id)), "distributed competency must resolve: " + scenario.scenario_id);
  assert.ok((scenario.target_selectors || []).every((selector) => selector.startsWith("level:") || selector === "vms_nvr"),
    "distributed lab selectors must remain floor-scoped or explicit dependency IDs: " + scenario.scenario_id);
  const run = controller(scenario.source_lab_id, "FOUNDATION", 20000);
  const view = run.start();
  assert.equal(view.scenario.family, "DISTRIBUTED_TECHNICAL");
  assert.equal(view.scenario.engineering_view, true);
  assert.equal(view.scenario.viewer_focus, scenario.viewer_focus);
  assert.deepEqual(view.scenario.floor_scope, scenario.floor_scope);
  assert.ok(view.visuals.assets.length > 0 || view.visuals.connections.length > 0,
    "distributed lab must materialize a visible fault: " + scenario.scenario_id);
  const allowedLevels = new Set(scenario.floor_scope);
  for (const asset of view.visuals.assets) {
    if (asset.level_id) assert.ok(allowedLevels.has(asset.level_id), "distributed lab leaked asset outside floor scope: " + asset.canonical_id);
  }
  for (const step of scenario.verification_path || []) {
    const out = run.execute(step.action_id, step.input || {});
    assert.equal(out.result.status, "success", "distributed verification path failed: " + scenario.scenario_id + " / " + step.action_id);
  }
  const done = run.complete().view;
  assert.equal(done.scenario.phase, "COMPLETED");
  assert.equal(done.assessment.critical_safety_clear, true);
}

const blocked = controller("blocked_stair_a", "FOUNDATION", 32000);
const blockedView = blocked.start();
const blockedAreaIds = new Set(blockedView.visuals.areas.map((item) => item.canonical_id));
assert.ok(blockedAreaIds.has("F1-DOOR-STAIR-A-DISCHARGE"));
assert.ok(blockedAreaIds.has("site-east-egress-walk"));
assert.ok(blockedAreaIds.has("site-north-egress-walk"));
const canonicalFloorIds = new Set([
  ...(datasets.simulationObjects.objects || []).map((item) => item.object_id),
  ...(datasets.objectInventory.objects || []).map((item) => item.id),
]);
assert.ok(blockedView.visuals.areas.every((item) => canonicalFloorIds.has(item.canonical_id)), "affected areas must reference canonical Floor 1/site IDs");

const serviceIncident = controller("service_area_incident", "FOUNDATION", 15000);
const serviceView = serviceIncident.start();
const serviceAreaIds = new Set(serviceView.visuals.areas.map((item) => item.canonical_id));
assert.ok(serviceAreaIds.has("site-service-apron-west"));
assert.ok(serviceAreaIds.has("site-responder-keep-clear"));

const publicService = controller("EU-PSC-VITA-INTAKE-V1", "FOUNDATION", 18000);
const publicView = publicService.start();
assert.equal(publicView.scenario.synthetic_case_only, true);
assert.equal(publicView.safety.public_service_real_pii_forbidden, true);
assert.ok(publicView.systems.some((item) => item.label === "Privacy" && item.state === "exposed"));
const publicSerialized = JSON.stringify(publicView);
assert.equal(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(publicSerialized), false, "public-service viewer state may not expose email-shaped PII");
assert.equal(/\b\d{3}-\d{2}-\d{4}\b/.test(publicSerialized), false, "public-service viewer state may not expose SSN-shaped PII");
assert.equal(/\b\d{3}[-.) ]\d{3}[- ]\d{4}\b/.test(publicSerialized), false, "public-service viewer state may not expose phone-shaped PII");
assert.ok(publicView.visuals.occupants.every((item) => item.synthetic_only === true && /Anonymous synthetic/.test(item.label)));

const viewer = text("../../../../../equity-uprise-building-core-v2-3d.html");
for (const required of [
  'data-f="stack"', 'data-f="facade"', 'id="services"', 'id="wire"', 'deviceClockSolar',
  "requestedFloor", "syncServicesVisibility", "LAB_MODULE_URL", "requestedLab=params.get('lab')",
  "labController.execute", "actionForCanonicalId", "labController.reset", "labVisualRootsReady", "await labVisualRootsReady",
]) {
  assert.ok(viewer.includes(required), "canonical viewer lost required feature/Step 8 hook: " + required);
}
assert.ok(viewer.includes("/equity-uprise-preview/equity-uprise-electronics-fabric-v1.glb"));
assert.equal(ELECTRONICS_TO_METERS, 0.3048, "electronics source units must convert feet to meters");
assert.equal(ELECTRONICS_SPATIAL_BINDING_VERSION, "1.1.0");
for (const [id,level] of [
  ["B1-NET-CORE-SW-01-I001",0],
  ["F1-NET-WAP-01",1],
  ["F4-USER-WS-01",4],
  ["F6-AV-CAM-01",6],
  ["F7-SEC-CAM-01",7],
  ["L7-BAS-CTRL-01",7],
  ["L7-NET-WAP-01",7],
]) {
  const binding=resolveElectronicsSpatialBinding(id);
  assert.ok(binding, "physical electronics asset must resolve spatially: "+id);
  assert.equal(binding.level, level);
  assert.ok(binding.anchor_id, "spatial binding must name a canonical anchor: "+id);
  assert.equal(binding.authority, "step4b_native_physical_installation_with_canonical_context");
  assert.equal(binding.placement_mode, "native_generator_coordinates");
  assert.equal(Object.prototype.hasOwnProperty.call(binding, "fallback_xy_ft"), false, "Step 4B may not expose fallback coordinates");
}
assert.equal(resolveElectronicsSpatialBinding("LOGIC-SVC-DNS"), null, "logical services must never become physical meshes");
const spatialBindings = manifestIds.map((id) => resolveElectronicsSpatialBinding(id)).filter(Boolean);
assert.ok(spatialBindings.length >= 400, "X-Ray must have broad physical electronics coverage");
const physicalAnchorIds = new Set();
for (const path of [
  "../basement-b1/basement-b1-object-inventory.json",
  "../floor-01/floor-01-object-inventory.json",
  "../floor-02/floor-02-object-inventory.json",
  "../floor-03/floor-03-object-inventory.json",
  "../floor-04/floor-04-object-inventory.json",
  "../floor-05/floor-05-object-inventory.json",
  "../floor-06/floor-06-object-inventory.json",
  "../floor-07/floor-07-object-inventory.json",
]) {
  for (const object of load(path).objects || []) physicalAnchorIds.add(object.id);
}
assert.ok(spatialBindings.every((binding) => physicalAnchorIds.has(binding.anchor_id)),
  "every X-Ray binding must resolve to a canonical inventory anchor");
for (const required of [
  "ELECTRONICS_SPATIAL_MODULE_URL",
  "electronics.scale.setScalar(FT)",
  "applyElectronicsSpatialBindings",
  "registerNativeElectronicsMesh",
  "placement_mode:'native_generator_coordinates'",
  "o.userData.spatialBound=true",
  "electronicsUnboundCount",
  "spatialConnectionOverlay",
  "routePointWorld",
  "physicalRoute=true",
  "ENGINEERING-XRAY-OVERLAY",
  "await buildingLoaded",
  "X-Ray: Loading",
  "setArchitectureGhost(true)",
  "SpriteMaterial",
  "depthTest:false",
  "rebuildEngineeringMarkers",
  "physical device coordinates resolved",
  "engineeringRequestId",
  "requestId!==engineeringRequestId",
  "engineeringOverlay.remove(o)",
  "syncElectronicsVisibility",
  "id=\"plant\"",
  "id=\"cabling\"",
  "Physical Plant: Off",
  "Cabling: Off",
  "routed cables",
  "plantLegend",
  "Cat6A data / PoE",
  "OS2 fiber",
  "208Y/120V feeder",
  "DEVICE-INTERACTION-OVERLAY",
  "ensureDeviceCatalog",
  "equity-uprise-device-components-v1.json",
  "deviceRecordById",
  "electronicsAssetIdFromName",
  "applyComponentVisualState",
  "STATUS_LED",
  "cameraCoverage",
  "VIDEO STREAM",
  "Show camera coverage",
  "findPhysicalDeviceFromHit",
  "if(deviceRecordById.has(x.canonical_id))styleCanonical(e,x.canonical_id,x.visual_state)",
]) {
  assert.ok(viewer.includes(required), "electronics physical-installation viewer guard missing: "+required);
}
assert.equal(viewer.includes("anchor?anchor.clone():floorWorld"), false, "unresolved electronics may not fall back to generic physical coordinates");
assert.equal(viewer.includes("electronicsBindingWorld"), false, "Step 4B viewer must not reposition generated devices back onto conceptual anchors");
assert.ok(viewer.includes("double-click inspectable"));
for (const required of [
  'id="roommode"', 'id="roomMotion"', 'id="roomRecenter"', 'id="roomBack"', 'id="roomInspect"',
  "F1-ROOM-ARRIVAL-CENTER", "DeviceOrientationEvent.requestPermission", "deviceorientation",
  "approachRoomObject", "tweenRoomCamera", "requestedRoom=params.get('room')==='1'",
]) {
  assert.ok(viewer.includes(required), "Room Mode contract missing: " + required);
}
assert.ok(viewer.includes("services.visible=servicesOn&&!roomMode"), "Room Mode must hide raw building-services overlay");
assert.ok(viewer.includes("electronics.visible=false"), "electronics layer must start hidden until an explicit plant/lab/engineering mode requests it");
for (const required of [
  'id="xray"', "setEngineeringMode", "setEngineeringElectronics", "engineeringMeshIsCable",
  "electronics.traverse(o=>{if(o.isMesh)o.visible=false})",
  "if(exp.learner_first&&!plantMode)await setPhysicalPlantMode(true);",
  "view.visuals.assets.forEach(x=>styleCanonical(f1",
  "Gyroscope live · left/right = yaw · up/down = pitch",
  "roomSensorMode='motion-primary'",
  "DIAGNOSTIC SANDBOX · TRAINING ONLY",
  "OBSERVE",
  "Instructor / technical details",
  "learnerAssetOverlay",
  "if(exp.learner_first&&engineeringMode)await setEngineeringMode(false)",
]) {
  assert.ok(viewer.includes(required), "Play/X-Ray spatial integration guard missing: " + required);
}
assert.ok(viewer.includes("if(roomMotionEvents>0||performance.now()-roomMotionEnabledAt<700)return"),
  "rotation-rate gyro must take priority over absolute orientation on iPad");
assert.equal(viewer.includes("if(roomSensorMode==='orientation')return"), false,
  "absolute orientation must not suppress motion-rate gyro events");
for (const required of [
  "DeviceMotionEvent.requestPermission()", "DeviceOrientationEvent.requestPermission()",
  "window.addEventListener('devicemotion',onRoomMotion,true)",
  "roomSensorMode='motion-primary'", "0 sensor events",
  "selectRoomAt", "projectedRoomTarget", "pointerup", "addEventListener('click'",
  "enhanceFloor1Interior", "buildRoomLightRig", "roomLightRig.visible=true",
]) {
  assert.ok(viewer.includes(required), "Room Mode iPad/realism guard missing: " + required);
}
assert.equal(viewer.includes("pointerdown',ev=>{if(!roomMode||roomMotionActive"), false,
  "Motion Mode must not disable the touch selection path");
assert.ok(viewer.includes("F1-RECEPTION-DESK-01") && viewer.includes("F1-DIRECTORY-01") && viewer.includes("F1-JOURNEY-WALL-01"),
  "Room Mode must target canonical Floor 1 scene objects");
assert.equal(viewer.includes("scene.traverse(o=>{if(roomMode"), false, "Room Mode may not brute-force the entire scene per interaction");
for (const performanceGuard of [
  "architectureGhosted",
  "if(on===architectureGhosted)return",
  "detailedPerimeterMeshes",
  "frameObjectCache",
  "stackFrameCache",
  "wireMaterials.forEach",
]) {
  assert.ok(viewer.includes(performanceGuard), "viewer interaction performance guard missing: " + performanceGuard);
}
assert.equal(viewer.includes("wire=!wire;scene.traverse"), false, "wireframe toggle must not traverse the full scene");
const rootWait = viewer.indexOf("await labVisualRootsReady");
const controllerCreate = viewer.indexOf("labController=labModule.createViewerLabController");
assert.ok(rootWait >= 0 && controllerCreate > rootWait, "deep-linked labs must wait for modeled visual roots before first render");
assert.ok(!viewer.includes("LIVE control enabled"));

const assessmentRuntime = text("./equity-uprise-assessment-runtime.mjs");
assert.equal(assessmentRuntime.includes("node:crypto"), false, "Step 6 assessment must remain browser-loadable for viewer integration");
assert.ok(assessmentRuntime.includes("TextEncoder"), "portable SHA-256 implementation must be present");

const deploy = text("../../../../../.github/workflows/deploy-pages.yml");
for (const required of [
  "equity-uprise-electronics-fabric-v1.glb",
  "equity-uprise-electronics-spatial-bindings-v1.mjs",
  "equity-uprise-viewer-lab-integration.mjs",
  "difficulty-progression-policy-v1.json",
  "learner-experience-v1.json",
  "competency-rubrics.json",
  "FEDERAL-TRAINING-BINDINGS.json",
  "distributed-building-scenario-pack-v1.json",
  "equity-uprise-device-components-v1.json",
  "device-archetypes-v1.json",
]) {
  assert.ok(deploy.includes(required), "deploy workflow must publish Step 8 dependency " + required);
}

const smoke = text("../../../../../scripts/smoke.mjs");
assert.ok(smoke.includes("building viewer: Step 8 controls"), "existing browser smoke suite must cover canonical viewer controls");
assert.ok(smoke.includes("building viewer: Room Mode controls"), "browser smoke suite must cover Room Mode controls");

console.log("EQUITY UPRISE LAB RUNTIME STEP 8 VIEWER INTEGRATION: PASS");
console.log(JSON.stringify({
  viewer_lab_integration_version: VIEWER_LAB_INTEGRATION_VERSION,
  expert_visual_assets: expertView.visuals.assets.length,
  expert_visual_connections: expertView.visuals.connections.length,
  blocked_area_ids: [...blockedAreaIds].sort(),
  public_service_systems: publicView.systems,
  sandbox_only: true,
}, null, 2));
