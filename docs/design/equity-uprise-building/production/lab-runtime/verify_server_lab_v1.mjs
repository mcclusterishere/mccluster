/* Server Lab verifier: hardware authority schema, catalog IT-LAB-041..051, memory population rules, RAID math,
   L2 rebuild validator, L1-L3 exercises, L4 fault -> symptom -> fix -> verify determinism on the Step 2 sandbox,
   safety boundary and Step 6 assessment integration. Run: node verify_server_lab_v1.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SESSION_STATES } from "./equity-uprise-lab-runtime.mjs";
import { SUPPORTED_FAULT_IDS } from "./equity-uprise-electronics-sandbox.mjs";
import { createAssessedExercise } from "./equity-uprise-assessment-runtime.mjs";
import {
  SERVER_LAB_RUNTIME_VERSION, SERVER_LAB_LEVELS, SERVER_LAB_HOST_ASSET_ID,
  expandServerModel, rackLayout, validateMemoryPopulation, raidCapacity, evaluateRaidChoice,
  RebuildState, referenceBuildSteps, applyBuildStep, identifyPrompts, ServerLabExercise,
  createServerTroubleshootScenario, serverSafetyCheck, symptomState, postLog, selLog, mdfElectronicsSubset, dimmSlotId,
} from "./equity-uprise-server-lab-runtime.mjs";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const hw = load("../electronics/server-lab-hardware-v1.json");
const pack = load("./server-lab-scenario-pack-v1.json");
const labCatalog = load("../electronics/generated/equity-uprise-it-lab-catalog-v1.json");
const rubrics = load("../../../equity-uprise-development/competency-rubrics.json");
const full = {
  registry: load("../asset-registry/generated/equity-uprise-asset-registry-v1.json"),
  connections: load("../electronics/generated/equity-uprise-electronics-connections-v1.json"),
  manifest: load("../electronics/generated/equity-uprise-electronics-manifest-v1.json"),
};
const electronics = mdfElectronicsSubset(full);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks += 1; };

/* ---------- authority boundary ---------- */
eq(SERVER_LAB_RUNTIME_VERSION, "1.0.0");
for (const doc of [hw, pack]) {
  eq(doc.mode, "SIMULATION"); eq(doc.execution_target, "SANDBOX"); eq(doc.live_control_allowed, false); eq(doc.credential_is_not_competency, true);
}
ok(hw.vendor_neutral === true, "hardware must be vendor-neutral");
const BRANDS = /\b(dell|poweredge|hpe?|proliant|lenovo|thinksystem|supermicro|cisco|juniper|intel|xeon|amd|epyc|broadcom|lsi|mellanox|nvidia|samsung|micron|seagate|western digital|apc|eaton|vertiv|ubiquiti|aruba|fortinet|palo alto|idrac|ilo\b|xclarity)\b/i;
ok(!BRANDS.test(JSON.stringify(hw)) && !BRANDS.test(JSON.stringify(pack)), "no vendor names or marks in the server lab authority");

/* ---------- rack: real dimensions, placement, registry anchors ---------- */
const r = hw.rack;
eq([r.units, r.u_mm, r.panel_width_mm, r.rail_opening_mm, r.hole_spacing_mm], [42, 44.45, 482.6, 450, 465.1]);
ok(Math.abs(r.usable_height_mm - 42 * 44.45) < 0.01, "42U usable height");
ok(r.external_mm.d >= 1000 && r.external_mm.d <= 1200, "rack depth 1000-1200 mm");
const regIds = new Set(full.registry.assets.map((a) => a.asset_id));
const used = new Array(43).fill(null);
for (const e of r.elevation) {
  for (let u = e.u_start; u < e.u_start + e.u_size; u += 1) { ok(u >= 1 && u <= 42 && used[u] === null, "U" + u + " double-booked by " + e.item_id); used[u] = e.item_id; }
  if (e.registry_asset_id) ok(regIds.has(e.registry_asset_id), e.item_id + " anchors a missing registry asset " + e.registry_asset_id);
  ok(hw.rack_item_types[e.kind], "unknown rack kind " + e.kind);
}
eq(used.slice(1).filter((x) => x === null).length, 0, "every U is accounted for (equipment or blanking)");
for (const z of r.zero_u) ok(regIds.has(z.registry_asset_id), "0U PDU anchors " + z.registry_asset_id);
ok(regIds.has(hw.placement.rack_asset_anchor), "rack anchor exists");
eq(hw.placement.anchor_ft, full.manifest.physical_routing.floor_support_points_ft.data_rack, "rack sits on the manifest MDF data-rack anchor");
eq(hw.placement.level_id, "B1");
const layout = rackLayout(hw);
ok(layout.items.find((i) => i.item_id === hw.lab_server.rack_item_id).registry_asset_id === SERVER_LAB_HOST_ASSET_ID);

/* ---------- component catalog ---------- */
for (const [type, def] of Object.entries(hw.component_types)) {
  ok(def.label && def.identify_hint && Array.isArray(def.rules) && def.rules.length > 0, type + " needs label, hint and rules");
  for (const f of def.failure_modes) {
    ok(f.id && f.label && f.fix && f.verify && f.symptoms, type + "/" + f.id + " incomplete");
    const s = f.symptoms;
    ok([s.front_panel, s.post, s.bmc_sel, s.os].every(Array.isArray), type + "/" + f.id + " symptom lists");
    ok(s.front_panel.length + s.post.length + s.bmc_sel.length + s.os.length + (s.component_led ? 1 : 0) > 0, f.id + " has no observable symptom");
  }
}
for (const t of ["chassis", "motherboard", "cpu", "heatsink", "dimm", "psu", "fan", "drive_sff", "raid_controller", "ocp_nic", "riser", "bmc", "tpm", "cmos_battery", "front_panel", "backplane"]) ok(hw.component_types[t], "catalog lacks " + t);
eq(hw.component_types.dimm.dims_mm.w, 133.35); eq(hw.component_types.ocp_nic.dims_mm.w, 76);

for (const modelId of Object.keys(hw.server_models)) {
  const m = hw.server_models[modelId];
  const inst = expandServerModel(hw, modelId);
  const ids = inst.map((i) => i.id);
  eq(new Set(ids).size, ids.length, modelId + " instance ids unique");
  const dimms = inst.filter((i) => i.type === "dimm");
  eq(dimms.length, m.sockets.length * m.memory.channels_per_cpu.length * m.memory.dimms_per_channel, modelId + " DIMM slot count");
  for (const i of inst) {
    if (["CHASSIS", "FRONT-PANEL"].includes(i.id) || /^CBL-/.test(i.id) || i.type === "nic_port" || i.id === "MGMT-PORT") continue;
    const [x, y, z, w, h, d] = i.box;
    ok(x >= 0 && x + w <= m.chassis_mm.w + 0.01 && y >= 0 && y + h <= m.chassis_mm.h + 0.01 && z >= 0 && z + d <= m.chassis_mm.d + 0.01, modelId + " " + i.id + " outside chassis");
  }
  // DIMM slots never overlap each other or the heatsinks
  const boxes = inst.filter((i) => i.type === "dimm" || i.type === "heatsink");
  for (let a = 0; a < boxes.length; a += 1) for (let b = a + 1; b < boxes.length; b += 1) {
    const A = boxes[a].box, B = boxes[b].box;
    const overlap = A[0] < B[0] + B[3] && B[0] < A[0] + A[3] && A[2] < B[2] + B[5] && B[2] < A[2] + A[5];
    ok(!overlap, modelId + " " + boxes[a].id + " overlaps " + boxes[b].id);
  }
}
ok(hw.server_models["SRV-2U-GEN"].chassis_mm.h === 86.8 && hw.server_models["SRV-1U-GEN"].chassis_mm.h === 43.2, "1U/2U heights");

/* ---------- memory population rules ---------- */
const m2 = hw.server_models["SRV-2U-GEN"];
const DIMM32 = hw.rebuild_kit.parts.find((p) => p.part_id === "PART-DIMM-32G");
const DIMM16 = hw.rebuild_kit.parts.find((p) => p.part_id === "PART-DIMM-16G");
const DDR4 = hw.rebuild_kit.parts.find((p) => p.part_id === "PART-DIMM-DDR4");
const pop = (list, part = DIMM32) => Object.fromEntries(list.map((s) => [s, part]));
const good = ["CPU1", "CPU2"].flatMap((c) => ["A", "E", "C", "G"].map((ch) => dimmSlotId(c, ch, 1)));
let v = validateMemoryPopulation(m2, pop(good));
ok(v.valid && v.total_gb === 256, "4 per CPU in A,E,C,G is valid: " + JSON.stringify(v.errors));
v = validateMemoryPopulation(m2, pop(["CPU1", "CPU2"].flatMap((c) => ["A", "B", "C", "D"].map((ch) => dimmSlotId(c, ch, 1)))));
ok(!v.valid && v.errors.some((e) => e.code === "CHANNEL_ORDER"), "A,B,C,D rejected (channel order)");
v = validateMemoryPopulation(m2, pop(["CPU1-DIMM-A2"]));
ok(v.errors.some((e) => e.code === "SLOT_ORDER"), "slot 2 before slot 1 rejected");
v = validateMemoryPopulation(m2, pop(good.filter((s) => s.startsWith("CPU1")).concat(["CPU1-DIMM-B1"])));
ok(v.errors.some((e) => e.code === "UNSUPPORTED_COUNT"), "5 DIMMs on one CPU rejected");
v = validateMemoryPopulation(m2, pop(good), { cpus: ["CPU1"] });
ok(v.errors.some((e) => e.code === "NO_CPU"), "CPU2 slots without CPU2 rejected");
v = validateMemoryPopulation(m2, { ...pop(good), "CPU2-DIMM-G1": DIMM16 });
ok(v.errors.some((e) => e.code === "MIXED_MODULES"), "mixed capacity rejected");
v = validateMemoryPopulation(m2, { ...pop(good.slice(0, 7)), "CPU2-DIMM-G1": DDR4 });
ok(v.errors.some((e) => e.code === "MODULE_TYPE"), "DDR4 key mismatch rejected");
v = validateMemoryPopulation(m2, pop(good.filter((s) => s.startsWith("CPU1")).concat(["CPU2-DIMM-A1", "CPU2-DIMM-E1"])));
ok(v.errors.some((e) => e.code === "NUMA_ASYMMETRIC"), "asymmetric NUMA rejected in strict mode");
v = validateMemoryPopulation(m2, pop(["CPU1", "CPU2"].flatMap((c) => ["A", "B", "C", "D", "E", "F", "G", "H"].flatMap((ch) => [dimmSlotId(c, ch, 1), dimmSlotId(c, ch, 2)]))));
ok(v.valid && v.total_gb === 1024, "fully populated 2DPC valid");

/* ---------- RAID math ---------- */
const cap = (l, n, c) => raidCapacity(l, n, c);
eq([cap("RAID0", 4, 1.92).usable_tb, cap("RAID1", 2, 1.92).usable_tb, cap("RAID5", 4, 1.92).usable_tb, cap("RAID6", 4, 1.92).usable_tb, cap("RAID10", 4, 1.92).usable_tb], [7.68, 1.92, 5.76, 3.84, 3.84]);
eq([cap("RAID0", 4, 1).fault_tolerance, cap("RAID5", 4, 1).fault_tolerance, cap("RAID6", 5, 1).fault_tolerance, cap("RAID10", 6, 1).fault_tolerance], [0, 1, 2, 1]);
eq([cap("RAID1", 4, 1).valid, cap("RAID5", 2, 1).valid, cap("RAID10", 5, 1).valid, cap("RAID6", 3, 1).valid], [false, false, false, false]);
eq(cap("RAID5", 8, 3.84).usable_tb, 26.88);
const req = hw.raid_requirement;
ok(evaluateRaidChoice(req, { level: "RAID5", usable_tb: 5.76 }).correct, "RAID 5 meets the requirement");
ok(!evaluateRaidChoice(req, { level: "RAID5", usable_tb: 7.68 }).correct, "wrong capacity rejected");
ok(!evaluateRaidChoice(req, { level: "RAID10", usable_tb: 3.84 }).correct, "RAID 10 too small");
ok(!evaluateRaidChoice(req, { level: "RAID0", usable_tb: 7.68 }).correct, "RAID 0 no tolerance");
eq(evaluateRaidChoice(req, { level: "RAID5", usable_tb: 5.76 }).options.filter((o) => o.valid && o.usable_tb >= req.min_usable_tb && o.fault_tolerance >= 1).map((o) => o.level), ["RAID5"], "exactly one level fits");

/* ---------- L2 rebuild validator ---------- */
{
  const b = new RebuildState(hw);
  ok(!b.install("PART-CPU-A", "CPU1", { orientation: "pin1-aligned" }).ok, "ESD gate");
  b.groundEsd();
  eq(b.install("PART-HS-2U", "HS-CPU1", { torque_order: [1, 2, 3, 4] }).code, "HEATSINK_BEFORE_CPU");
  eq(b.install("PART-CPU-A", "CPU1", { orientation: "rotated-90" }).code, "CPU_ORIENTATION");
  ok(b.install("PART-CPU-A", "CPU1", { orientation: "pin1-aligned" }).ok);
  eq(b.install("PART-HS-2U", "HS-CPU1", { torque_order: [1, 3, 2, 4] }).code, "TORQUE_ORDER");
  eq(b.install("PART-DIMM-32G", "CPU2-DIMM-A1").code, "NO_CPU");
  eq(b.install("PART-DIMM-32G", "CPU1-DIMM-B1").code, "CHANNEL_ORDER");
  eq(b.install("PART-DIMM-32G", "CPU1-DIMM-A2").code, "SLOT_ORDER");
  eq(b.install("PART-DIMM-DDR4", "CPU1-DIMM-A1").code, "MODULE_TYPE");
  ok(b.install("PART-DIMM-32G", "CPU1-DIMM-A1").ok);
  eq(b.install("PART-DIMM-16G", "CPU1-DIMM-E1").code, "MIXED_MODULES");
  eq(b.install("PART-SSD-NVME-3T8", "BAY-00").code, "BAY_INTERFACE");
  eq(b.install("PART-SSD-SAS-1T9", "BAY-05").code, "BAY_ORDER");
  eq(b.install("PART-RAID", "R1-S2").code, "NO_RISER");
  eq(b.install("PART-RISER1", "RISER2").code, "RISER_NEEDS_CPU");
  ok(b.install("PART-PSU-800", "PSU1").ok);
  eq(b.install("PART-PSU-1400", "PSU2").code, "PSU_MISMATCH");
  eq(b.connect("CBL-PWR-1", "PDU-A:PWR-OUT-07").code, "CABLED");
  eq(b.closeLid().code, "BUILD_INCOMPLETE");
}
{
  const b = new RebuildState(hw);
  const results = referenceBuildSteps(hw).map((s) => [s, applyBuildStep(b, s)]);
  for (const [s, res] of results) ok(res.ok !== false && (res.valid === undefined || res.valid), "reference step failed " + JSON.stringify(s) + " " + JSON.stringify(res));
  ok(b.state.lid_closed && b.missing().length === 0, "reference build complete");
  const b2 = new RebuildState(hw);
  for (const s of referenceBuildSteps(hw)) { if (s.op === "connect" && s.cable === "CBL-PWR-2") { eq(b2.connect("CBL-PWR-2", "PDU-A:PWR-OUT-07").code, "SINGLE_FEED"); } if (s.op === "connect" && s.cable === "CBL-DAC-2") eq(b2.connect("CBL-DAC-2", "CORE1:SFP+-IN-03").code, "PORT_TAKEN"); applyBuildStep(b2, s); }
  // canonical wiring: the rebuild cables agree with the Step 4B connection graph
  const conns = new Map(full.connections.connections.map((c) => [c.connection_id, c]));
  for (const c of hw.rebuild_kit.cables.filter((x) => x.canonical_connection_id)) {
    const k = conns.get(c.canonical_connection_id);
    ok(k && (k.from_asset_id === SERVER_LAB_HOST_ASSET_ID || k.to_asset_id === SERVER_LAB_HOST_ASSET_ID), c.cable_id + " canonical connection touches the lab host");
  }
}

/* ---------- catalog IT-LAB-041..051 ---------- */
const serverLabs = labCatalog.labs.filter((l) => Number(l.lab_id.slice(-3)) >= 41);
eq(serverLabs.map((l) => l.lab_id), ["IT-LAB-041", "IT-LAB-042", "IT-LAB-043", "IT-LAB-044", "IT-LAB-045", "IT-LAB-046", "IT-LAB-047", "IT-LAB-048", "IT-LAB-049", "IT-LAB-050", "IT-LAB-051"]);
for (const l of serverLabs) {
  eq(l.mode, "SIMULATION"); eq(l.live_control_allowed, false);
  for (const f of l.fault_injection) ok(f === "none" || SUPPORTED_FAULT_IDS.includes(f), "sandbox supports " + f);
}
eq(Object.values(SERVER_LAB_LEVELS).flatMap((x) => x.lab_ids), serverLabs.map((l) => l.lab_id));
eq(pack.scenarios.map((s) => s.source_lab_id), SERVER_LAB_LEVELS.L4.lab_ids);

/* ---------- L1-L3 exercises under the Step 6 assessment ---------- */
function clockFrom(start) { let t = start; return () => (t += 1000); }
{
  const prompts = identifyPrompts(hw);
  eq(prompts.length, 18); ok(prompts.every((p) => p.choices.length === 4 && p.choices.some((c) => c.id === p.answer)), "4 choices with the answer");
  eq(JSON.stringify(identifyPrompts(hw)), JSON.stringify(prompts), "prompts deterministic");
  const ex = new ServerLabExercise({ hardware: hw, labCatalog, electronics, labId: "IT-LAB-041" });
  const as = createAssessedExercise({ exercise: ex, rubrics, clock: clockFrom(1000) });
  as.start();
  eq(as.execute("identify", { prompt_id: prompts[0].prompt_id, answer: "WRONG" }).status, "incorrect");
  as.requestHint({ hint_id: "L1-HINT-1", level: "supported" });
  for (const p of prompts) eq(as.execute("identify", { prompt_id: p.prompt_id, answer: p.mode === "name" ? p.answer : p.target }).status, "success");
  const done = as.complete();
  eq(done.completed_snapshot.phase, SESSION_STATES.COMPLETED);
  eq(done.assessment.performance_signal, "completed_with_support");
  ok(done.assessment.competencies.every((c) => c.verified_awarded === false && c.maximum_automated_competency_state === "Demonstrated"));
  eq(done.assessment.live_control_allowed, false);
}
{
  const ex = new ServerLabExercise({ hardware: hw, labCatalog, electronics, labId: "IT-LAB-042" });
  const as = createAssessedExercise({ exercise: ex, rubrics, clock: clockFrom(5000) });
  as.start();
  eq(as.execute("install", { part_id: "PART-CPU-A", target_id: "CPU1", options: { orientation: "pin1-aligned" } }).status, "blocked");
  for (const s of referenceBuildSteps(hw)) {
    const map = { ground: ["ground_esd", {}], install: ["install", { part_id: s.part, target_id: s.target, options: s.options }], connect: ["connect", { cable_id: s.cable, to: s.to }], validate_memory: ["validate_memory", {}], close_lid: ["close_lid", {}] };
    const [a, i] = map[s.op];
    eq(as.execute(a, i).status, "success", "L2 step " + JSON.stringify(s));
  }
  const done = as.complete();
  eq(done.assessment.action_metrics.blocked, 1);
  eq(done.assessment.performance_signal, "completed_with_recovery");
}
{
  const ex = new ServerLabExercise({ hardware: hw, labCatalog, electronics, labId: "IT-LAB-043" });
  const as = createAssessedExercise({ exercise: ex, rubrics, clock: clockFrom(9000) });
  as.start();
  eq(as.execute("report_post", { memory_gb: 256, cpus: 2 }).status, "blocked");
  eq(as.execute("power_on", {}).status, "success");
  eq(as.execute("report_post", { memory_gb: 256, cpus: 2 }).status, "success");
  eq(as.execute("bmc_login", { path: "production_nic" }).status, "incorrect");
  eq(as.execute("bmc_login", { path: "dedicated_mgmt_port" }).status, "success");
  eq(as.execute("report_health", { health: "ok" }).status, "success");
  eq(as.execute("configure_raid", { level: "RAID10", usable_tb: 3.84 }).status, "incorrect");
  eq(as.execute("configure_raid", { level: "RAID5", usable_tb: 5.76 }).status, "success");
  eq(as.execute("verify_link", { links_up: 2, speed_gbps: 10 }).status, "success");
  eq(as.complete().completed_snapshot.phase, SESSION_STATES.COMPLETED);
}

/* ---------- L4: fault -> symptom -> fix -> verify, deterministic, on the canonical host ---------- */
function runL4(labId, sourceElectronics) {
  const def = pack.scenarios.find((s) => s.source_lab_id === labId);
  const runner = createServerTroubleshootScenario({ pack, labCatalog, labId, electronics: sourceElectronics });
  const as = createAssessedExercise({ exercise: runner, rubrics, clock: clockFrom(20000) });
  as.start();
  const started = runner.snapshot();
  const faults = labCatalog.labs.find((l) => l.lab_id === labId).fault_injection;
  eq(started.unresolved_fault_ids, [...faults].sort(), labId + " faults active");
  const host = started.sandbox.asset_states.find((a) => a.asset_id === SERVER_LAB_HOST_ASSET_ID);
  ok(host && host.availability === "degraded" && faults.every((f) => host.active_fault_ids.includes(f)), labId + " degrades the canonical host");
  const sym = symptomState({ pack, labId, unresolvedFaultIds: started.unresolved_fault_ids });
  eq(sym.leds.HEALTH, "amber", labId + " health LED amber");
  for (const f of faults) {
    const b = def.server_fault_bindings[f];
    ok(sym.leds[b.component_id] || sym.parts[b.component_id] || sym.leds["NIC-P1"] === "off", labId + " shows " + f + " on its component");
    // pack observations are the catalog's failure-mode symptoms
    const mode = Object.values(hw.component_types).flatMap((t) => t.failure_modes).find((m) => m.id === f);
    ok(mode && def.symptoms[f].bmc_sel.length === mode.symptoms.bmc_sel.length, labId + " symptoms rendered from catalog");
  }
  if (faults.includes("dimm_uncorrectable_error")) ok(postLog(hw, { faults, pack, labId }).some((l) => /224 GB/.test(l)), "POST shows reduced memory");
  ok(selLog({ faults, pack, labId }).length > 2, "SEL carries fault events");
  for (const step of def.verification_path) {
    const res = as.execute(step.action_id, step.input);
    eq(res.status, "success", labId + " " + step.action_id + " " + JSON.stringify(res));
  }
  const end = runner.snapshot();
  eq(end.unresolved_fault_ids, [], labId + " all faults resolved");
  ok(!end.sandbox.asset_states.some((a) => a.active_fault_ids.length), labId + " sandbox back to baseline");
  eq(symptomState({ pack, labId, unresolvedFaultIds: [] }).leds.HEALTH, "green");
  const done = as.complete();
  eq(done.completed_snapshot.phase, SESSION_STATES.COMPLETED);
  ok(done.assessment.restoration_elapsed_ms !== null || done.assessment.timing.restoration_elapsed_ms !== null, labId + " restoration timed");
  return { started, done };
}
for (const labId of SERVER_LAB_LEVELS.L4.lab_ids) {
  const a = runL4(labId, electronics);
  const b = runL4(labId, electronics);
  eq(a.started.sandbox, b.started.sandbox, labId + " deterministic fault state");
  eq(a.done.assessment.provenance.assessment_sha256, b.done.assessment.provenance.assessment_sha256, labId + " deterministic assessment");
  // the MDF subset changes exactly the same canonical ids as the full building fabric
  const fullRun = createServerTroubleshootScenario({ pack, labCatalog, labId, electronics: full });
  fullRun.start();
  eq(fullRun.snapshot().sandbox.asset_states, a.started.sandbox.asset_states, labId + " subset == full fabric (assets)");
  eq(fullRun.snapshot().sandbox.connection_states, a.started.sandbox.connection_states, labId + " subset == full fabric (connections)");
}
{ // NIC fault takes down the canonical DAC connection; CMOS drift reaches the hosted NTP service
  const nic = createServerTroubleshootScenario({ pack, labCatalog, labId: "IT-LAB-048", electronics }); nic.start();
  ok(nic.snapshot().sandbox.connection_states.some((c) => c.connection_id === "CABLE::STEP4A::00017" && c.availability === "unavailable"), "NIC port 1 DAC down");
  const cmos = createServerTroubleshootScenario({ pack, labCatalog, labId: "IT-LAB-049", electronics }); cmos.start();
  ok(cmos.snapshot().sandbox.asset_states.some((a) => a.asset_id === "LOGIC-SVC-NTP" && a.condition_flags.includes("host_clock_drift")), "CMOS drift reaches NTP");
}
{ // wrong part, out-of-order and unsafe actions
  const run = createServerTroubleshootScenario({ pack, labCatalog, labId: "IT-LAB-044", electronics });
  const as = createAssessedExercise({ exercise: run, rubrics, clock: clockFrom(1) });
  as.start();
  eq(as.execute("044-replace", { component_id: "CPU1-DIMM-C1" }).status, "blocked", "replace before diagnose/power-off blocked");
  const v1 = serverSafetyCheck({ pack, labId: "IT-LAB-044", actionId: "044-replace", input: { component_id: "CPU1-DIMM-C1" }, snapshot: run.snapshot(), powered: true, hardware: hw });
  eq(v1.code, "HOT_REMOVAL_OF_NON_HOT_SWAP_PART");
  as.recordSafetyViolation(v1);
  as.execute("044-read-sel", {});
  eq(as.execute("044-diagnose", { findings: ["fan_failed"] }).status, "incorrect");
  as.execute("044-diagnose", { findings: ["dimm_uncorrectable_error"] });
  as.execute("044-power-off", {});
  eq(as.execute("044-replace", { component_id: "CPU1-DIMM-A1" }).status, "incorrect", "wrong DIMM does not fix it");
  eq(run.snapshot().unresolved_fault_ids, ["dimm_uncorrectable_error"]);
  ok(serverSafetyCheck({ pack, labId: "IT-LAB-044", actionId: "044-replace", input: { component_id: "CPU1-DIMM-C1" }, snapshot: run.snapshot(), powered: false, hardware: hw }) === null, "powered-off DIMM swap is safe");
  const raid = createServerTroubleshootScenario({ pack, labCatalog, labId: "IT-LAB-045", electronics }); raid.start();
  eq(serverSafetyCheck({ pack, labId: "IT-LAB-045", actionId: "045-replace", input: { component_id: "BAY-01" }, snapshot: raid.snapshot(), powered: true, hardware: hw }).critical, true, "pulling a healthy member is critical");
  eq(serverSafetyCheck({ pack, labId: "IT-LAB-045", actionId: "045-replace", input: { component_id: "BAY-02" }, snapshot: raid.snapshot(), powered: true, hardware: hw }), null);
  const psu = createServerTroubleshootScenario({ pack, labCatalog, labId: "IT-LAB-046", electronics }); psu.start();
  eq(serverSafetyCheck({ pack, labId: "IT-LAB-046", actionId: "046-replace", input: { component_id: "PSU1" }, snapshot: psu.snapshot(), powered: true, hardware: hw }).code, "LAST_PSU_REMOVED");
  const multi = createServerTroubleshootScenario({ pack, labCatalog, labId: "IT-LAB-051", electronics }); multi.start();
  multi.execute("051-read-sel", {}); multi.execute("051-diagnose", { findings: ["psu_failed", "raid_member_failed"] });
  eq(multi.execute("051-replace-drive", { component_id: "BAY-02" }).status, "blocked", "expert: power redundancy before rebuild");
  const fw = createServerTroubleshootScenario({ pack, labCatalog, labId: "IT-LAB-050", electronics }); fw.start();
  fw.execute("050-read-inventory", {}); fw.execute("050-diagnose", { findings: ["firmware_mismatch"] }); fw.execute("050-drain", {});
  eq(fw.execute("050-apply-baseline", { order: ["BIOS", "BMC", "RAID", "NIC"] }).status, "incorrect", "firmware order enforced");
}

console.log(JSON.stringify({ server_lab_verify: "PASS", checks, labs: serverLabs.length, l4_scenarios: pack.scenarios.length, subset_assets: electronics.registry.assets.length }));
