/* Equity Uprise Server Lab runtime (owner, 2026-11-03: "walk around and click on a server rack and look at the inner
   components ... identify them, rebuild the server, troubleshoot it like it's a real server, like levels").

   One dependency-free ES module for Node verifiers and the browser page (equity-uprise-server-lab-3d.html). It never owns
   simulation truth of its own:
   - hardware facts come from production/electronics/server-lab-hardware-v1.json;
   - every level is bound to its canonical IT-LAB-041..051 catalog record through the Step 1/2 runtime
     (createElectronicsBoundSessionFromCatalogLab), so faults change the canonical B1-SRV-HYP-01-I001 sandbox state;
   - Level 4 runs the Step 3 GuidedScenarioRunner over server-lab-scenario-pack-v1.json;
   - every level is an "exercise" the Step 6 AssessedExercise can wrap (start/execute/complete/snapshot/exportEvidence).

   SIMULATION only. execution_target SANDBOX. live_control_allowed false. Nothing here can reach a real device. */

import { LabRuntimeError, SESSION_STATES } from "./equity-uprise-lab-runtime.mjs";
import { createElectronicsBoundSessionFromCatalogLab } from "./equity-uprise-electronics-sandbox.mjs";
import { GuidedScenarioRunner, scenarioDefinitionByLabId } from "./equity-uprise-guided-scenarios.mjs";

export const SERVER_LAB_RUNTIME_VERSION = "1.0.0";
export const SERVER_LAB_HOST_ASSET_ID = "B1-SRV-HYP-01-I001";
export const SERVER_LAB_LEVELS = Object.freeze({
  L1: { level: "L1", lab_ids: ["IT-LAB-041"], title: "Identify", tier: "FOUNDATION" },
  L2: { level: "L2", lab_ids: ["IT-LAB-042"], title: "Rebuild", tier: "TECHNICIAN" },
  L3: { level: "L3", lab_ids: ["IT-LAB-043"], title: "Bring-up", tier: "ADMIN" },
  L4: {
    level: "L4",
    lab_ids: ["IT-LAB-044", "IT-LAB-045", "IT-LAB-046", "IT-LAB-047", "IT-LAB-048", "IT-LAB-049", "IT-LAB-050", "IT-LAB-051"],
    title: "Troubleshoot",
    tier: "ADVANCED",
  },
});

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function requireValue(condition, code, message) {
  if (!condition) throw new LabRuntimeError(code, message);
}
const round2 = (n) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ hardware expansion */

export function serverModel(hardware, modelId) {
  const model = hardware && hardware.server_models && hardware.server_models[modelId];
  requireValue(Boolean(model), "UNKNOWN_SERVER_MODEL", "unknown server model " + modelId);
  return model;
}

export function dimmSlotId(cpu, channel, slot) {
  return cpu + "-DIMM-" + channel + slot;
}

/* Every physical component of one server as data: id, type, the chassis-frame box it occupies (mm, min corner +
   size; x left→right from the front, y up, z front→rear) and its slot facts. The 3D page draws exactly this list
   and the validators reason over exactly this list. */
export function expandServerModel(hardware, modelId) {
  const m = serverModel(hardware, modelId);
  const ct = hardware.component_types;
  const ff = m.form_factor;
  const W = m.chassis_mm.w, H = m.chassis_mm.h, D = m.chassis_mm.d;
  const out = [];
  const add = (o) => { out.push(o); return o; };

  add({ id: "CHASSIS", type: "chassis", label: "Chassis (" + ff + ")", box: [0, 0, 0, W, H, D], slot_kind: null });
  add({ id: "MOTHERBOARD", type: "motherboard", label: "System board", box: [6, 2, 240, W - 12, 1.6, D - 250] });
  add({ id: "BACKPLANE", type: "backplane", label: "Drive backplane", box: [10, 3, m.backplane.z_mm, W - 20, Math.min(70, H - 8), 6] });
  add({ id: "FRONT-PANEL", type: "front_panel", label: "Front control panel", box: [-m.front_ear_mm, 0, -4, m.front_ear_mm, H, 4] });

  const cpuDims = ct.cpu.dims_mm;
  const hsDims = ct.heatsink.dims_mm_by_form_factor[ff];
  for (const s of m.sockets) {
    const [cx, , cz] = s.center_mm;
    add({ id: s.id, type: "cpu", label: s.id + " (processor socket " + s.id.slice(-1) + ")", cpu: s.id, slot_kind: "cpu_socket",
      box: [cx - cpuDims.w / 2, 3.6, cz - cpuDims.d / 2, cpuDims.w, cpuDims.h, cpuDims.d] });
    add({ id: "HS-" + s.id, type: "heatsink", label: "Heatsink over " + s.id, cpu: s.id, slot_kind: "heatsink_mount",
      box: [cx - hsDims.w / 2, 10.6, cz - hsDims.d / 2, hsDims.w, Math.min(hsDims.h, H - 14), hsDims.d] });
  }

  const mem = m.memory;
  const dimm = ct.dimm.dims_mm;
  const dimmH = Math.min(dimm.h, H - 8);
  for (const s of m.sockets) {
    const [cx, , cz] = s.center_mm;
    const sides = [
      { channels: mem.layout.channels_left, dir: -1 },
      { channels: mem.layout.channels_right, dir: 1 },
    ];
    for (const side of sides) {
      // channels nearest the CPU first; within a channel slot 2 is nearer the CPU, slot 1 (filled first) farther away
      side.channels.slice().reverse().forEach((ch, chIndex) => {
        for (let slot = mem.dimms_per_channel; slot >= 1; slot -= 1) {
          const k = chIndex * mem.dimms_per_channel + (mem.dimms_per_channel - slot);
          const x = cx + side.dir * (mem.layout.side_gap_mm + k * mem.layout.pitch_mm) - (side.dir < 0 ? 6 : 0);
          add({
            id: dimmSlotId(s.id, ch, slot), type: "dimm", label: s.id + " DIMM " + ch + slot, cpu: s.id, channel: ch, slot_in_channel: slot,
            slot_kind: "dimm_slot", latch: slot === 1 ? "white" : "black",
            box: [x, 3.6, cz - dimm.w / 2, 6, dimmH, dimm.w],
          });
        }
      });
    }
  }

  const bays = m.drive_bays;
  const drv = ct.drive_sff.dims_mm;
  const bayH = Math.min(76, H - 8);
  for (let b = 0; b < bays.count; b += 1) {
    const universal = bays.universal_bays.includes(b);
    add({ id: "BAY-" + String(b).padStart(2, "0"), type: "drive_sff", label: "Drive bay " + b + (universal ? " (universal: SAS/SATA/NVMe)" : " (SAS/SATA)"),
      bay: b, slot_kind: "drive_bay", universal, box: [bays.start_x_mm + b * bays.pitch_mm, 4, bays.z_mm, drv.h + 2, bayH, 176] });
  }

  const fanDims = ct.fan.dims_mm_by_form_factor[ff];
  for (let f = 1; f <= m.fans.count; f += 1) {
    add({ id: "FAN-" + f, type: "fan", label: "Fan " + f, fan: f, slot_kind: "fan_bay",
      box: [m.fans.start_x_mm + (f - 1) * m.fans.pitch_mm, 3, m.fans.z_mm, fanDims.w, Math.min(fanDims.h, H - 6), fanDims.d] });
  }

  const psu = ct.psu.dims_mm;
  for (const p of m.psus) {
    add({ id: p.id, type: "psu", label: p.id + " (feed " + p.feed + ")", feed: p.feed, slot_kind: "psu_bay", box: [p.x_mm, p.y_mm, D - psu.d, psu.w, psu.h, psu.d] });
  }

  for (const r of m.risers) {
    const rd = ct.riser.dims_mm;
    add({ id: r.id, type: "riser", label: r.id.replace("RISER", "Riser ") + " (" + r.cpu + " lanes)", cpu: r.cpu, slot_kind: "riser_mount",
      box: [r.x_mm, 6, r.z_mm, rd.w, Math.min(rd.h, H - 10), D - r.z_mm - 2] });
    r.slots.forEach((slot, i) => {
      add({ id: slot.id, type: "pcie_slot", label: r.id.replace("RISER", "Riser ") + " slot " + (i + 1) + " (x" + slot.lanes + ")", riser: r.id, lanes: slot.lanes,
        profile: slot.profile, slot_kind: "pcie_slot", box: [r.x_mm + 4, 10 + i * 30, r.z_mm + 10, rd.w - 8, 4, D - r.z_mm - 14] });
    });
  }
  const raid = ct.raid_controller.dims_mm;
  const r1 = m.risers[0];
  const raidSlot = r1.slots[r1.slots.length - 1];
  add({ id: "RAID-CTRL", type: "raid_controller", label: "RAID controller (" + raidSlot.id + ")", slot_kind: null, installed_in: raidSlot.id,
    box: [r1.x_mm + 6, 10 + (r1.slots.length - 1) * 30 + 6, D - raid.d - 4, Math.min(raid.w, 100), 16, raid.d] });

  const ocp = ct.ocp_nic.dims_mm;
  add({ id: "OCP-NIC", type: "ocp_nic", label: "OCP 3.0 network adapter", slot_kind: "ocp_slot", box: [m.ocp_slot.x_mm, 3, D - ocp.d, ocp.w, ocp.h, ocp.d] });
  add({ id: "NIC-P1", type: "nic_port", label: "NIC port 1 (to core switch 1)", parent: "OCP-NIC", box: [m.ocp_slot.x_mm + 8, 4, D - 2, 16, 9, 6] });
  add({ id: "NIC-P2", type: "nic_port", label: "NIC port 2 (to core switch 2)", parent: "OCP-NIC", box: [m.ocp_slot.x_mm + 40, 4, D - 2, 16, 9, 6] });
  add({ id: "CBL-DAC-1", type: "dac_cable", label: "DAC cable on NIC port 1", parent: "NIC-P1", box: [m.ocp_slot.x_mm + 9, 4.5, D + 4, 14, 8, 60] });
  add({ id: "CBL-DAC-2", type: "dac_cable", label: "DAC cable on NIC port 2", parent: "NIC-P2", box: [m.ocp_slot.x_mm + 41, 4.5, D + 4, 14, 8, 60] });

  add({ id: "BMC", type: "bmc", label: "Management controller (BMC)", box: [m.bmc.chip_mm[0], 3.6, m.bmc.chip_mm[2], 20, 2, 20] });
  add({ id: "MGMT-PORT", type: "bmc", label: "Dedicated management port (out-of-band)", parent: "BMC", box: [m.bmc.port.x_mm, m.bmc.port.y_mm - 12, D - 16, 16, 13, 16] });
  add({ id: "TPM", type: "tpm", label: "TPM 2.0 module", box: [m.tpm_header_mm[0], 3.6, m.tpm_header_mm[2], 25, 6, 14] });
  add({ id: "CMOS-BATTERY", type: "cmos_battery", label: "CMOS battery (CR2032)", box: [m.cmos_battery_mm[0], 3.6, m.cmos_battery_mm[2], 20, 3.2, 20] });
  if (m.m2_boot_module_mm) {
    const mb = ct.m2_boot_module.dims_mm;
    add({ id: "M2-BOOT", type: "m2_boot_module", label: "M.2 boot module (2 × 480 GB, RAID 1)", box: [m.m2_boot_module_mm[0] - 30, 3.6, m.m2_boot_module_mm[2] - 40, mb.w * 0.5, 8, mb.d * 0.6] });
  }
  for (const p of m.psus) {
    add({ id: "CBL-PWR-" + p.id.slice(-1), type: "power_cord", label: "Power cord on " + p.id, parent: p.id, box: [p.x_mm + 50, p.y_mm + 10, D + 2, 14, 14, 70] });
  }
  return out;
}

export function rackLayout(hardware) {
  const r = hardware.rack;
  const items = r.elevation.map((e) => ({
    ...clone(e),
    label: (hardware.rack_item_types[e.kind] || {}).label || e.kind,
    bottom_mm: (e.u_start - 1) * r.u_mm,
    height_mm: e.u_size * r.u_mm,
  }));
  return { rack: { id: r.id, units: r.units, u_mm: r.u_mm, panel_width_mm: r.panel_width_mm, external_mm: clone(r.external_mm) }, items, zero_u: clone(r.zero_u) };
}

/* ------------------------------------------------------------------ memory population */

export function validateMemoryPopulation(model, population, { cpus = ["CPU1", "CPU2"], strict = true } = {}) {
  const mem = model.memory;
  const errors = [];
  const warnings = [];
  const entries = Object.entries(population || {}).filter(([, part]) => part);
  const byCpu = {};
  for (const [slotId, part] of entries) {
    const m = /^(CPU\d)-DIMM-([A-H])(\d)$/.exec(slotId);
    if (!m) { errors.push({ code: "UNKNOWN_SLOT", slot: slotId, message: slotId + " is not a DIMM slot on this board." }); continue; }
    const [, cpu, ch, slot] = m;
    if (Number(slot) > mem.dimms_per_channel) { errors.push({ code: "UNKNOWN_SLOT", slot: slotId, message: "This board has " + mem.dimms_per_channel + " slot(s) per channel." }); continue; }
    if (part.module !== mem.supported_module.type) {
      errors.push({ code: "MODULE_TYPE", slot: slotId, message: part.module + " does not fit: the key notch does not line up with a " + mem.supported_module.type + " slot." });
      continue;
    }
    if (!cpus.includes(cpu)) errors.push({ code: "NO_CPU", slot: slotId, message: cpu + " is not installed, so its memory channels have no controller." });
    (byCpu[cpu] = byCpu[cpu] || []).push({ slotId, ch, slot: Number(slot), part });
  }
  const capacities = new Set(entries.map(([, p]) => p.capacity_gb));
  if (capacities.size > 1) errors.push({ code: "MIXED_MODULES", message: "Every DIMM must be the same capacity, rank and speed in this configuration." });

  const layouts = {};
  for (const [cpu, list] of Object.entries(byCpu)) {
    const chans = {};
    for (const d of list) (chans[d.ch] = chans[d.ch] || new Set()).add(d.slot);
    for (const [ch, slots] of Object.entries(chans)) {
      if (slots.has(2) && !slots.has(1)) errors.push({ code: "SLOT_ORDER", slot: cpu + "-DIMM-" + ch + "2", message: "Channel " + ch + ": fill slot 1 (white latch) before slot 2." });
    }
    const count = list.length;
    if (!mem.supported_counts_per_cpu.includes(count)) {
      errors.push({ code: "UNSUPPORTED_COUNT", cpu, message: cpu + " has " + count + " DIMMs; supported counts are " + mem.supported_counts_per_cpu.join(", ") + "." });
    }
    const channelsUsed = Object.keys(chans).length;
    const expected = mem.fill_order.slice(0, Math.min(channelsUsed, mem.fill_order.length)).sort();
    if (JSON.stringify(Object.keys(chans).sort()) !== JSON.stringify(expected)) {
      errors.push({ code: "CHANNEL_ORDER", cpu, message: cpu + ": with " + channelsUsed + " channel(s) in use they must be " + mem.fill_order.slice(0, channelsUsed).join(", ") + " (population order " + mem.fill_order.join(", ") + ")." });
    }
    const second = list.filter((d) => d.slot === 2).length;
    if (second > 0 && channelsUsed !== mem.channels_per_cpu.length) {
      errors.push({ code: "SECOND_SLOT_EARLY", cpu, message: cpu + ": use slot 2 only after every channel has a DIMM in slot 1." });
    }
    layouts[cpu] = list.map((d) => d.ch + d.slot).sort().join(",");
  }
  if (cpus.length > 1 && byCpu.CPU1 && cpus.every((c) => byCpu[c])) {
    if (layouts.CPU1 !== layouts.CPU2) {
      (strict ? errors : warnings).push({ code: "NUMA_ASYMMETRIC", message: "CPU1 and CPU2 should carry the same memory layout so both NUMA nodes are balanced." });
    }
  } else if (cpus.length > 1 && entries.length > 0 && cpus.some((c) => !byCpu[c])) {
    (strict ? errors : warnings).push({ code: "NUMA_ASYMMETRIC", message: "Both CPUs need memory: a CPU with no local DIMMs reaches all memory across the socket link." });
  }
  if (!byCpu.CPU1 && entries.length > 0) errors.push({ code: "CPU1_EMPTY", message: "CPU1 must have memory for the system to POST." });

  const totalGb = errors.some((e) => e.code === "MODULE_TYPE") ? 0 : entries.reduce((sum, [, p]) => sum + (p.capacity_gb || 0), 0);
  return { valid: errors.length === 0, errors, warnings, total_gb: totalGb, dimm_count: entries.length, layouts };
}

/* ------------------------------------------------------------------ RAID math */

export const RAID_LEVELS = Object.freeze({
  RAID0: { min: 2, usable: (n, c) => n * c, tolerance: () => 0, valid: (n) => n >= 2 },
  RAID1: { min: 2, usable: (n, c) => c, tolerance: (n) => n - 1, valid: (n) => n === 2 },
  RAID5: { min: 3, usable: (n, c) => (n - 1) * c, tolerance: () => 1, valid: (n) => n >= 3 },
  RAID6: { min: 4, usable: (n, c) => (n - 2) * c, tolerance: () => 2, valid: (n) => n >= 4 },
  RAID10: { min: 4, usable: (n, c) => (n / 2) * c, tolerance: () => 1, valid: (n) => n >= 4 && n % 2 === 0 },
});

export function raidCapacity(level, drives, capacityTb) {
  const def = RAID_LEVELS[level];
  requireValue(Boolean(def), "UNKNOWN_RAID_LEVEL", "unknown RAID level " + level);
  if (!def.valid(drives)) return { level, drives, valid: false, usable_tb: 0, fault_tolerance: 0, reason: level + " needs " + (level === "RAID1" ? "exactly 2" : level === "RAID10" ? "an even number of at least 4" : "at least " + def.min) + " drives." };
  return { level, drives, valid: true, usable_tb: round2(def.usable(drives, capacityTb)), fault_tolerance: def.tolerance(drives), raw_tb: round2(drives * capacityTb) };
}

export function evaluateRaidChoice(requirement, { level, usable_tb }) {
  const cap = raidCapacity(level, requirement.drives.count, requirement.drives.capacity_tb);
  const meets = cap.valid && cap.usable_tb >= requirement.min_usable_tb && cap.fault_tolerance >= requirement.min_fault_tolerance;
  const mathOk = typeof usable_tb === "number" && Number.isFinite(usable_tb) && Math.abs(usable_tb - cap.usable_tb) <= requirement.answer_tolerance_tb;
  const options = Object.keys(RAID_LEVELS).map((l) => raidCapacity(l, requirement.drives.count, requirement.drives.capacity_tb));
  let reason;
  if (!cap.valid) reason = cap.reason;
  else if (cap.fault_tolerance < requirement.min_fault_tolerance) reason = level + " survives " + cap.fault_tolerance + " drive failure(s); the requirement is " + requirement.min_fault_tolerance + ".";
  else if (cap.usable_tb < requirement.min_usable_tb) reason = level + " gives " + cap.usable_tb + " TB usable; the datastore needs " + requirement.min_usable_tb + " TB.";
  else if (!mathOk) reason = "The level fits, but recheck the usable capacity for " + requirement.drives.count + " × " + requirement.drives.capacity_tb + " TB in " + level + ".";
  else reason = level + ": " + cap.usable_tb + " TB usable, survives " + cap.fault_tolerance + " drive failure.";
  return { correct: meets && mathOk, meets_requirement: meets, math_correct: mathOk, capacity: cap, reason, options };
}

/* ------------------------------------------------------------------ L2 rebuild validator */

const REQUIRED_DATA_BAYS = (hw) => hw.rebuild_kit.target.data_drives.bays.map((b) => "BAY-" + String(b).padStart(2, "0"));

export class RebuildState {
  constructor(hardware) {
    this.hardware = hardware;
    this.kit = hardware.rebuild_kit;
    this.model = serverModel(hardware, this.kit.server_model);
    this.instances = expandServerModel(hardware, this.kit.server_model);
    this.byId = new Map(this.instances.map((i) => [i.id, i]));
    this.partsById = new Map(this.kit.parts.map((p) => [p.part_id, p]));
    this.used = {};
    this.state = {
      esd: false, lid_closed: false,
      cpus: {}, heatsinks: {}, dimms: {}, drives: {}, risers: {}, pcie: {}, ocp: null, psus: {}, cables: {},
      memory_validated: false,
    };
  }

  _remaining(partId) {
    const p = this.partsById.get(partId);
    return p ? p.qty - (this.used[partId] || 0) : 0;
  }

  _ok(code, message, extra = {}) { return { ok: true, code, message, ...extra }; }
  _no(code, message, extra = {}) { return { ok: false, code, message, ...extra }; }

  groundEsd() {
    this.state.esd = true;
    return this._ok("ESD_GROUNDED", "Wrist strap clipped to unpainted chassis metal. You can handle parts now.");
  }

  install(partId, targetId, options = {}) {
    const s = this.state;
    if (s.lid_closed) return this._no("LID_CLOSED", "Open the lid first.");
    if (!s.esd) return this._no("ESD_REQUIRED", "Ground yourself before you touch a component: static can kill a DIMM or CPU without a visible mark.", { safety: { code: "ESD_NOT_GROUNDED", severity: "major", critical: false } });
    const part = this.partsById.get(partId);
    if (!part) return this._no("UNKNOWN_PART", "That part is not in the kit.");
    if (this._remaining(partId) <= 0) return this._no("NO_PART_LEFT", "No " + part.label + " left in the kit.");
    const target = this.byId.get(targetId);
    if (!target) return this._no("UNKNOWN_TARGET", "Choose a slot on the server.");
    const take = (map, key, extra = {}) => { map[key] = { part_id: partId, ...extra }; this.used[partId] = (this.used[partId] || 0) + 1; };

    switch (part.type) {
      case "cpu": {
        if (target.type !== "cpu") return this._no("WRONG_SLOT", "A CPU only goes into a processor socket.");
        if (s.cpus[targetId]) return this._no("OCCUPIED", targetId + " already has a CPU.");
        if (options.orientation !== "pin1-aligned") return this._no("CPU_ORIENTATION", "The triangle on the CPU must line up with the socket's corner marker. Forcing it would bend the socket contacts.", { safety: { code: "CPU_FORCED_MISALIGNED", severity: "major", critical: false } });
        take(s.cpus, targetId);
        return this._ok("CPU_SEATED", targetId + " seated: it dropped in flat with no pressure.");
      }
      case "heatsink": {
        if (target.type !== "heatsink") return this._no("WRONG_SLOT", "The heatsink mounts over a CPU socket.");
        if (!s.cpus[target.cpu]) return this._no("HEATSINK_BEFORE_CPU", "Seat the CPU in " + target.cpu + " before the heatsink.");
        if (s.heatsinks[targetId]) return this._no("OCCUPIED", "That heatsink is already installed.");
        const order = options.torque_order || [];
        if (JSON.stringify(order) !== JSON.stringify(this.kit.heatsink_torque_order)) return this._no("TORQUE_ORDER", "Tighten in the order printed on the label (" + this.kit.heatsink_torque_order.join(" → ") + "); any other order tilts the heatsink and leaves an air gap.");
        take(s.heatsinks, targetId);
        return this._ok("HEATSINK_TORQUED", "Heatsink torqued 1 → 2 → 3 → 4 with even pressure.");
      }
      case "dimm": {
        if (target.type !== "dimm") return this._no("WRONG_SLOT", "Memory only goes into a DIMM slot.");
        if (s.dimms[targetId]) return this._no("OCCUPIED", targetId + " already has a module.");
        if (part.module !== this.model.memory.supported_module.type) return this._no("MODULE_TYPE", part.label + " will not seat: its key notch is in a different place from a " + this.model.memory.supported_module.type + " slot.");
        if (!s.cpus[target.cpu]) return this._no("NO_CPU", target.cpu + " is empty, so " + targetId + " has no memory controller behind it.");
        const others = Object.values(s.dimms).map((d) => this.partsById.get(d.part_id));
        if (others.some((o) => o.capacity_gb !== part.capacity_gb || o.module !== part.module)) return this._no("MIXED_MODULES", "This build uses identical modules only; " + part.label + " does not match what is installed.");
        if (target.slot_in_channel === 2 && !s.dimms[dimmSlotId(target.cpu, target.channel, 1)]) return this._no("SLOT_ORDER", "Fill " + dimmSlotId(target.cpu, target.channel, 1) + " (white latch) before its black-latch slot 2.");
        const nextChannel = this.model.memory.fill_order.find((ch) => !s.dimms[dimmSlotId(target.cpu, ch, 1)]);
        if (target.slot_in_channel === 1 && target.channel !== nextChannel) return this._no("CHANNEL_ORDER", "On " + target.cpu + " fill channels in the order " + this.model.memory.fill_order.join(", ") + ". Next is channel " + nextChannel + ".");
        take(s.dimms, targetId);
        s.memory_validated = false;
        return this._ok("DIMM_SEATED", targetId + " seated; both latches clicked shut.");
      }
      case "drive_sff": {
        if (target.type !== "drive_sff") return this._no("WRONG_SLOT", "Drives go into the front bays.");
        if (s.drives[targetId]) return this._no("OCCUPIED", targetId + " is occupied.");
        if (part.interface === "NVMe" && !target.universal) return this._no("BAY_INTERFACE", target.label + " is wired for SAS/SATA only; NVMe needs a universal bay (8–11).");
        if (part.part_id !== this.kit.target.data_drives.part_id) return this._no("NOT_IN_ARRAY", part.label + " is not part of this server's data array.");
        const required = REQUIRED_DATA_BAYS(this.hardware);
        if (!required.includes(targetId)) return this._no("BAY_ORDER", "Build the array in contiguous bays starting at bay 0.");
        take(s.drives, targetId);
        return this._ok("DRIVE_SEATED", targetId + ": carrier latched; activity LED blinks once.");
      }
      case "riser": {
        if (target.type !== "riser") return this._no("WRONG_SLOT", "That is not a riser position.");
        if (s.risers[targetId]) return this._no("OCCUPIED", targetId + " is installed.");
        if (target.cpu && !s.cpus[target.cpu]) return this._no("RISER_NEEDS_CPU", targetId + " carries " + target.cpu + "'s PCIe lanes; install " + target.cpu + " first.");
        if (targetId !== "RISER1") return this._no("WRONG_SLOT", "This riser is riser 1's part.");
        take(s.risers, targetId);
        return this._ok("RISER_SEATED", "Riser 1 seated in its board connector.");
      }
      case "raid_controller": {
        if (target.type !== "pcie_slot") return this._no("WRONG_SLOT", "A PCIe card goes into a riser slot.");
        if (!s.risers[target.riser]) return this._no("NO_RISER", "Install " + target.riser + " before its cards.");
        if (s.pcie[targetId]) return this._no("OCCUPIED", targetId + " is occupied.");
        if (target.lanes < 8) return this._no("LANES", "The controller needs an x8 or wider slot.");
        if (targetId !== this.kit.target.raid_controller_slot) return this._no("SLOT_PLAN", "The build plan reserves " + targetId + " for a future full-height card; use the low-profile x8 slot " + this.kit.target.raid_controller_slot + ".");
        take(s.pcie, targetId);
        return this._ok("CARD_SEATED", "RAID controller seated in " + targetId + " and the bracket screw fitted.");
      }
      case "ocp_nic": {
        if (target.type !== "ocp_nic") return this._no("WRONG_SLOT", "The OCP 3.0 adapter slides into its own rear bay, not a riser.");
        if (s.ocp) return this._no("OCCUPIED", "The OCP bay is occupied.");
        take(s, "ocp");
        return this._ok("OCP_SEATED", "OCP adapter slid in until the latch clicked.");
      }
      case "psu": {
        if (target.type !== "psu") return this._no("WRONG_SLOT", "A PSU goes into a rear PSU bay.");
        if (s.psus[targetId]) return this._no("OCCUPIED", targetId + " is occupied.");
        const others = Object.values(s.psus).map((p) => this.partsById.get(p.part_id));
        if (others.some((o) => o.watts !== part.watts)) return this._no("PSU_MISMATCH", "Mixed PSU models break 1+1 redundancy: both bays need the same unit.");
        if (part.part_id !== "PART-PSU-800") return this._no("PSU_MISMATCH", "The build specifies a matched pair of 800 W units.");
        take(s.psus, targetId);
        return this._ok("PSU_SEATED", targetId + " seated; its LED will light once a cord is connected.");
      }
      default:
        return this._no("UNKNOWN_PART", "That part has no place in this build.");
    }
  }

  connect(cableId, to) {
    const s = this.state;
    if (!s.esd) return this._no("ESD_REQUIRED", "Ground yourself first.");
    const cable = this.kit.cables.find((c) => c.cable_id === cableId);
    if (!cable) return this._no("UNKNOWN_CABLE", "Unknown cable.");
    if (s.cables[cableId]) return this._no("OCCUPIED", cable.label + " is already connected.");
    if (cable.cable_id === "CBL-RAID-BP-A") {
      if (!s.pcie[this.kit.target.raid_controller_slot]) return this._no("NO_CONTROLLER", "Install the RAID controller first.");
      s.cables[cableId] = "BACKPLANE:A";
      return this._ok("CABLED", "Controller port 0 cabled to backplane connector A (bays 0–7).");
    }
    if (cable.type === "power_cord") {
      const psu = cable.from;
      if (!s.psus[psu]) return this._no("NO_PSU", "Install " + psu + " first.");
      if (!cable.to_options.includes(to)) return this._no("UNKNOWN_TARGET", "Choose a PDU outlet.");
      const otherId = cableId === "CBL-PWR-1" ? "CBL-PWR-2" : "CBL-PWR-1";
      const otherFeed = s.cables[otherId] ? s.cables[otherId].split(":")[0] : null;
      if (otherFeed && otherFeed === to.split(":")[0]) return this._no("SINGLE_FEED", "Both PSUs on the same PDU means one feed failure takes the server down. Use the other feed.");
      if (to !== cable.expected_to) return this._no("FEED_CONVENTION", "Rack convention: PSU1 to the A-feed PDU (left), PSU2 to the B-feed PDU (right), so the labels match the feeds.");
      s.cables[cableId] = to;
      return this._ok("CABLED", psu + " cord to " + to + ".");
    }
    if (cable.type === "dac_cable") {
      if (!s.ocp) return this._no("NO_NIC", "Install the OCP adapter first.");
      if (!cable.to_options.includes(to)) return this._no("UNKNOWN_TARGET", "Choose a core switch port.");
      const otherId = cableId === "CBL-DAC-1" ? "CBL-DAC-2" : "CBL-DAC-1";
      if (s.cables[otherId] && s.cables[otherId] === to) return this._no("PORT_TAKEN", to + " already has the other NIC port.");
      if (s.cables[otherId] && s.cables[otherId].split(":")[0] === to.split(":")[0]) return this._no("SINGLE_SWITCH", "Both bond members on one switch: a switch failure would cut the host off. Use the other core switch.");
      if (to !== cable.expected_to) return this._no("PORT_PLAN", "The building's connection plan puts NIC port 1 on core switch 1 and port 2 on core switch 2 (SFP+-IN-03 on each).");
      s.cables[cableId] = to;
      return this._ok("CABLED", cable.from + " DAC to " + to + ".");
    }
    if (cable.type === "mgmt_patch") {
      if (to !== cable.expected_to) return this._no("MGMT_NETWORK", "The management port goes to the out-of-band management network, never to a production switch port.");
      s.cables[cableId] = to;
      return this._ok("CABLED", "Management port patched to the management network (VLAN-MGMT).");
    }
    return this._no("UNKNOWN_CABLE", "Unknown cable.");
  }

  memoryPopulation() {
    const pop = {};
    for (const [slot, d] of Object.entries(this.state.dimms)) pop[slot] = this.partsById.get(d.part_id);
    return pop;
  }

  validateMemory() {
    const cpus = Object.keys(this.state.cpus);
    const v = validateMemoryPopulation(this.model, this.memoryPopulation(), { cpus, strict: true });
    const target = this.kit.target;
    const meetsTarget = v.valid && v.total_gb === target.memory_gb && cpus.length === target.cpus;
    if (meetsTarget) this.state.memory_validated = true;
    return { ...v, meets_target: meetsTarget, target_gb: target.memory_gb };
  }

  missing() {
    const s = this.state, t = this.kit.target, miss = [];
    if (Object.keys(s.cpus).length < t.cpus) miss.push("CPUs");
    if (Object.keys(s.heatsinks).length < t.cpus) miss.push("heatsinks");
    if (Object.keys(s.dimms).length < t.cpus * t.dimms_per_cpu) miss.push("memory");
    if (!s.memory_validated) miss.push("memory check");
    if (Object.keys(s.drives).length < t.data_drives.count) miss.push("drives");
    if (!s.risers.RISER1) miss.push("riser 1");
    if (!s.pcie[t.raid_controller_slot]) miss.push("RAID controller");
    if (!s.ocp) miss.push("OCP adapter");
    if (Object.keys(s.psus).length < t.psus) miss.push("PSUs");
    for (const c of this.kit.cables) if (c.required && !s.cables[c.cable_id]) miss.push(c.label);
    return miss;
  }

  closeLid() {
    const miss = this.missing();
    if (miss.length) return this._no("BUILD_INCOMPLETE", "Not finished: " + miss.join(", ") + ".", { missing: miss });
    this.state.lid_closed = true;
    return this._ok("LID_CLOSED", "Lid closed and latched; the air shroud is in place.");
  }

  snapshot() {
    return { state: clone(this.state), used: clone(this.used), missing: this.missing() };
  }
}

/* The finished L2 build, used as the L3 starting point and by the verifier. */
export function referenceBuildSteps(hardware) {
  const kit = hardware.rebuild_kit;
  const model = serverModel(hardware, kit.server_model);
  const steps = [{ op: "ground" }];
  for (const s of model.sockets) {
    steps.push({ op: "install", part: "PART-CPU-A", target: s.id, options: { orientation: "pin1-aligned" } });
    steps.push({ op: "install", part: "PART-HS-2U", target: "HS-" + s.id, options: { torque_order: kit.heatsink_torque_order } });
  }
  for (const s of model.sockets) for (const ch of model.memory.fill_order.slice(0, kit.target.dimms_per_cpu)) steps.push({ op: "install", part: "PART-DIMM-32G", target: dimmSlotId(s.id, ch, 1) });
  steps.push({ op: "validate_memory" });
  for (const b of kit.target.data_drives.bays) steps.push({ op: "install", part: kit.target.data_drives.part_id, target: "BAY-" + String(b).padStart(2, "0") });
  steps.push({ op: "install", part: "PART-RISER1", target: "RISER1" });
  steps.push({ op: "install", part: "PART-RAID", target: kit.target.raid_controller_slot });
  steps.push({ op: "install", part: "PART-OCP-NIC", target: "OCP-NIC" });
  steps.push({ op: "install", part: "PART-PSU-800", target: "PSU1" });
  steps.push({ op: "install", part: "PART-PSU-800", target: "PSU2" });
  for (const c of kit.cables) steps.push({ op: "connect", cable: c.cable_id, to: c.expected_to || null });
  steps.push({ op: "close_lid" });
  return steps;
}

/* ------------------------------------------------------------------ POST / BMC synthesis */

export function postLog(hardware, { memory_gb = 256, cpus = 2, faults = [], pack = null, labId = null } = {}) {
  const lines = [
    "System firmware 2.4.0 · management controller 7.20",
    "CPU1: 32 cores detected · CPU2: " + (cpus > 1 ? "32 cores detected" : "not installed"),
    "Memory training … complete",
  ];
  let mem = memory_gb;
  const scenario = pack && labId ? (pack.scenarios || []).find((s) => s.source_lab_id === labId) : null;
  for (const f of faults) {
    const sym = scenario && scenario.symptoms ? scenario.symptoms[f] : null;
    if (f === "dimm_uncorrectable_error" && scenario) mem = scenario.server_fault_bindings[f].reduced_gb;
    if (sym) lines.push(...sym.post.map((l) => "! " + l));
  }
  lines.push("Memory: " + mem + " GB DDR5-4800 ECC" + (mem < memory_gb ? " (" + (memory_gb - mem) + " GB disabled)" : ""));
  lines.push("PCIe: RAID controller (riser 1 slot 2, Gen4 x8) · OCP 3.0 adapter (Gen4 x8) · M.2 boot module");
  lines.push("Storage: 4 physical disks on controller port 0 · boot volume RAID 1 (480 GB)");
  lines.push("Management controller: dedicated port, link up 1 Gb/s");
  lines.push(faults.length ? "POST complete with warnings" : "POST complete · booting");
  return lines;
}

export function selLog({ faults = [], pack = null, labId = null } = {}) {
  const scenario = pack && labId ? (pack.scenarios || []).find((s) => s.source_lab_id === labId) : null;
  const lines = ["Info: System boot · power on", "Info: Power supply redundancy: fully redundant"];
  for (const f of faults) {
    const sym = scenario && scenario.symptoms ? scenario.symptoms[f] : null;
    if (sym) lines.push(...sym.bmc_sel.map((l) => "Critical: " + l));
  }
  return lines;
}

/* What the 3D model shows for the current fault state: LED colours and part states by instance id. Deterministic. */
export function symptomState({ pack, labId, unresolvedFaultIds = [], powered = true }) {
  const scenario = (pack.scenarios || []).find((s) => s.source_lab_id === labId) || null;
  const leds = { HEALTH: powered ? "green" : "off", POWER: powered ? "green" : "amber-standby" };
  const parts = {};
  if (powered) {
    leds.PSU1 = "green"; leds.PSU2 = "green"; leds["NIC-P1"] = "green"; leds["NIC-P2"] = "green";
    for (let i = 0; i < 4; i += 1) leds["BAY-0" + i] = "green";
  }
  for (const f of [...unresolvedFaultIds].sort()) {
    const b = scenario && scenario.server_fault_bindings ? scenario.server_fault_bindings[f] : null;
    if (!b) continue;
    if (powered) leds.HEALTH = "amber";
    switch (f) {
      case "dimm_uncorrectable_error": leds[b.component_id] = "amber"; parts[b.component_id] = "faulted"; break;
      case "raid_member_failed": leds[b.component_id] = "amber"; parts[b.component_id] = "faulted"; break;
      case "psu_failed": leds[b.component_id] = "amber"; parts[b.component_id] = "faulted"; break;
      case "fan_failed": leds[b.component_id] = "amber"; parts[b.component_id] = "stopped"; break;
      case "server_nic_link_down": leds["NIC-P1"] = "off"; parts[b.component_id] = "suspect"; break;
      case "cmos_battery_depleted": parts[b.component_id] = "depleted"; break;
      case "firmware_mismatch": parts[b.component_id] = "out_of_baseline"; break;
      default: break;
    }
  }
  return { lab_id: labId, unresolved_fault_ids: [...unresolvedFaultIds].sort(), leds, parts };
}

/* ------------------------------------------------------------------ L1 prompts */

export function identifyPrompts(hardware) {
  const T = hardware.component_types;
  const R = hardware.rack_item_types;
  const rackPrompts = [
    ["RACK01-U41-PATCH", "patch_panel"], ["RACK01-U39-CORE1", "core_switch"], ["RACK01-U35-FW1", "firewall"],
    ["RACK01-U18-HYP1", "server_2u"], ["RACK01-U01-UPS", "rack_ups"], ["RACK01-0U-PDU-A", "pdu"],
  ].map(([target, kind], i) => ({ prompt_id: "L1-R" + (i + 1), scope: "rack", mode: i % 2 ? "name" : "find", target, answer: kind, label: R[kind].label, hint: R[kind].identify_hint }));
  const serverPrompts = [
    ["CPU1", "cpu"], ["HS-CPU2", "heatsink"], ["CPU1-DIMM-A1", "dimm"], ["PSU1", "psu"], ["FAN-2", "fan"], ["BAY-00", "drive_sff"],
    ["RAID-CTRL", "raid_controller"], ["OCP-NIC", "ocp_nic"], ["MGMT-PORT", "bmc"], ["TPM", "tpm"], ["CMOS-BATTERY", "cmos_battery"], ["BACKPLANE", "backplane"],
  ].map(([target, type], i) => ({ prompt_id: "L1-S" + (i + 1), scope: "server", mode: i % 2 ? "find" : "name", target, answer: type, label: T[type].label, hint: T[type].identify_hint }));
  const prompts = [...rackPrompts, ...serverPrompts];
  // name choices: the answer plus three deterministic distractors from the same scope
  for (const p of prompts) {
    const pool = (p.scope === "rack" ? Object.keys(R) : Object.keys(T).filter((k) => !["power_cord", "dac_cable", "chassis", "front_panel"].includes(k))).filter((k) => k !== p.answer);
    const seed = [...p.prompt_id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const picks = [];
    for (let i = 0; picks.length < 3; i += 1) { const k = pool[(seed + i * 3) % pool.length]; if (i > pool.length * 3) break; if (!picks.includes(k)) picks.push(k); }
    const choices = [p.answer, ...picks];
    const rot = seed % choices.length;
    p.choices = [...choices.slice(rot), ...choices.slice(0, rot)].map((k) => ({ id: k, label: (p.scope === "rack" ? R : T)[k].label }));
  }
  return prompts;
}

/* ------------------------------------------------------------------ L1-L3 exercises */

const LEVEL_COMPETENCIES = { "IT-LAB-041": ["CORE-05", "OPS-01"], "IT-LAB-042": ["CORE-05", "CORE-08", "OPS-04"], "IT-LAB-043": ["CORE-05", "OPS-01", "OPS-04"] };
const LEVEL_TIME_TARGET_MS = { "IT-LAB-041": 18 * 20000, "IT-LAB-042": 20 * 60000, "IT-LAB-043": 10 * 60000 };

export class ServerLabExercise {
  constructor({ hardware, labCatalog, electronics, labId, pack = null, session_id = null, actor_id = "learner" }) {
    requireValue(["IT-LAB-041", "IT-LAB-042", "IT-LAB-043"].includes(labId), "UNKNOWN_SERVER_LAB", "ServerLabExercise runs L1-L3 (IT-LAB-041..043)");
    requireValue(hardware && hardware.live_control_allowed === false && hardware.execution_target === "SANDBOX", "LIVE_CONTROL_FORBIDDEN", "server hardware authority must be SANDBOX-only");
    const lab = (labCatalog.labs || []).find((l) => l.lab_id === labId);
    requireValue(Boolean(lab), "SOURCE_LAB_NOT_FOUND", "catalog lab not found: " + labId);
    this.hardware = hardware;
    this.pack = pack;
    this.labId = labId;
    this.sourceLab = clone(lab);
    const bound = createElectronicsBoundSessionFromCatalogLab(lab, electronics, { session_id: session_id || "SERVER-LAB::" + labId, actor_id });
    this.scenario = bound.scenario;
    this.sandbox = bound.sandbox;
    this.session = bound.session;
    this.history = [];
    this.seq = 0;
    this.objectives = [];
    if (labId === "IT-LAB-041") {
      this.prompts = identifyPrompts(hardware);
      this.answered = new Set();
      // "find" accepts any instance of the asked-for kind (any DIMM is a DIMM, either firewall is a firewall)
      this.kindById = new Map(expandServerModel(hardware, hardware.lab_server.server_model).map((i) => [i.id, i.type]));
      for (const e of hardware.rack.elevation) this.kindById.set(e.item_id, e.kind);
      for (const z of hardware.rack.zero_u) this.kindById.set(z.item_id, z.kind);
      this.objectives = [
        { objective_id: "OBJ-041-RACK", description: "Identify the rack equipment.", complete: false },
        { objective_id: "OBJ-041-SERVER", description: "Identify the server's components.", complete: false },
      ];
    } else if (labId === "IT-LAB-042") {
      this.build = new RebuildState(hardware);
      this.objectives = [
        { objective_id: "OBJ-042-COMPUTE", description: "CPUs and heatsinks seated correctly.", complete: false },
        { objective_id: "OBJ-042-MEMORY", description: "Memory populated by the rules and checked.", complete: false },
        { objective_id: "OBJ-042-STORAGE-IO", description: "Drives, riser, RAID controller and OCP adapter installed and cabled.", complete: false },
        { objective_id: "OBJ-042-POWER-NET", description: "Redundant power and network cabled to the plan; lid closed.", complete: false },
      ];
    } else {
      this.build = new RebuildState(hardware);
      for (const step of referenceBuildSteps(hardware)) applyBuildStep(this.build, step);
      this.bringup = { powered: false, post: null, sel: null, raid: null, links: null, steps: new Set() };
      this.objectives = [
        { objective_id: "OBJ-043-POST", description: "Power on and read POST.", complete: false },
        { objective_id: "OBJ-043-OOB", description: "Reach the management controller out-of-band and read the event log.", complete: false },
        { objective_id: "OBJ-043-RAID", description: "Configure the data array to the requirement.", complete: false },
        { objective_id: "OBJ-043-LINK", description: "Verify both network links.", complete: false },
      ];
    }
  }

  start() {
    requireValue(this.session.phase === SESSION_STATES.CREATED, "INVALID_TRANSITION", "exercise can only start from CREATED");
    this.session.start();
    return this.snapshot();
  }

  _record(actionId, actionType, status, details = {}) {
    const rec = { action_seq: ++this.seq, action_id: actionId, action_type: actionType, status, correct: status === "success", ...clone(details) };
    this.history.push(rec);
    this.session.perform(actionId, { target: SERVER_LAB_HOST_ASSET_ID, detail: "server lab " + actionType + " outcome=" + status + (details.code ? " code=" + details.code : "") });
    return rec;
  }

  execute(actionId, input = {}) {
    requireValue(this.session.phase === SESSION_STATES.RUNNING, "SESSION_NOT_RUNNING", "exercise must be RUNNING");
    if (this.labId === "IT-LAB-041") return this._executeIdentify(actionId, input);
    if (this.labId === "IT-LAB-042") return this._executeRebuild(actionId, input);
    return this._executeBringup(actionId, input);
  }

  _executeIdentify(actionId, input) {
    requireValue(actionId === "identify", "UNKNOWN_SERVER_ACTION", "L1 action is identify");
    const p = this.prompts.find((x) => x.prompt_id === input.prompt_id);
    requireValue(Boolean(p), "UNKNOWN_PROMPT", "unknown prompt " + input.prompt_id);
    if (this.answered.has(p.prompt_id)) return this._record("identify", "decision", "blocked", { prompt_id: p.prompt_id, code: "ALREADY_ANSWERED" });
    const ok = p.mode === "name" ? input.answer === p.answer : this.kindById.get(String(input.answer)) === p.answer;
    if (!ok) return this._record("identify", "decision", "incorrect", { prompt_id: p.prompt_id, feedback: p.mode === "find" ? "Not that one. " + p.hint : "Not quite. " + p.hint });
    this.answered.add(p.prompt_id);
    this._syncObjectives();
    return this._record("identify", "decision", "success", { prompt_id: p.prompt_id, feedback: p.label + ". " + p.hint });
  }

  _executeRebuild(actionId, input) {
    const b = this.build;
    let r;
    let type = "perform";
    switch (actionId) {
      case "ground_esd": r = b.groundEsd(); break;
      case "install": r = b.install(input.part_id, input.target_id, input.options || {}); break;
      case "connect": r = b.connect(input.cable_id, input.to); break;
      case "validate_memory": {
        type = "decision";
        const v = b.validateMemory();
        r = v.meets_target ? { ok: true, code: "MEMORY_OK", message: "Population valid: " + v.total_gb + " GB, balanced across " + Object.keys(v.layouts).length + " CPU(s)." }
          : { ok: false, code: v.errors[0] ? v.errors[0].code : "MEMORY_TARGET", message: v.errors[0] ? v.errors[0].message : "Valid, but the build needs " + v.target_gb + " GB (you have " + v.total_gb + " GB)." };
        break;
      }
      case "close_lid": r = b.closeLid(); break;
      default: requireValue(false, "UNKNOWN_SERVER_ACTION", "unknown rebuild action " + actionId);
    }
    const status = r.ok ? "success" : (r.code === "ESD_REQUIRED" || r.code === "LID_CLOSED" ? "blocked" : "incorrect");
    this._syncObjectives();
    return this._record(actionId, type, status, { code: r.code, feedback: r.message, safety: r.safety || null, input: clone(input) });
  }

  _executeBringup(actionId, input) {
    const u = this.bringup;
    const need = (step, code, msg) => { if (!u.steps.has(step)) return { blocked: true, code, msg }; return null; };
    let res;
    switch (actionId) {
      case "power_on": {
        u.powered = true; u.post = postLog(this.hardware, {}); u.steps.add("power_on");
        res = { status: "success", code: "POWERED", feedback: "Both PSUs green; fans spin up, then settle. POST is running.", post: u.post };
        break;
      }
      case "report_post": {
        const b = need("power_on", "NOT_POWERED", "Power the server on first.");
        if (b) { res = { status: "blocked", code: b.code, feedback: b.msg }; break; }
        const ok = Number(input.memory_gb) === this.hardware.rebuild_kit.target.memory_gb && Number(input.cpus) === this.hardware.rebuild_kit.target.cpus;
        if (ok) u.steps.add("report_post");
        res = { status: ok ? "success" : "incorrect", code: ok ? "POST_READ" : "POST_MISREAD", feedback: ok ? "Correct: 2 CPUs, 256 GB, no warnings." : "Read the POST capture again: count CPUs and the memory line." };
        break;
      }
      case "bmc_login": {
        const b = need("report_post", "POST_FIRST", "Read POST first.");
        if (b) { res = { status: "blocked", code: b.code, feedback: b.msg }; break; }
        if (input.path !== "dedicated_mgmt_port") { res = { status: "incorrect", code: "OOB_PATH", feedback: "Out-of-band means the dedicated management port on the management network, not the production NIC." }; break; }
        u.sel = selLog({}); u.steps.add("bmc_login");
        res = { status: "success", code: "BMC_REACHED", feedback: "Management controller reached on VLAN-MGMT.", sel: u.sel };
        break;
      }
      case "report_health": {
        const b = need("bmc_login", "BMC_FIRST", "Open the management controller first.");
        if (b) { res = { status: "blocked", code: b.code, feedback: b.msg }; break; }
        const ok = input.health === "ok";
        if (ok) u.steps.add("report_health");
        res = { status: ok ? "success" : "incorrect", code: ok ? "HEALTH_OK" : "HEALTH_MISREAD", feedback: ok ? "Right: informational events only, PSUs fully redundant." : "Every event in the log is informational. Look again." };
        break;
      }
      case "configure_raid": {
        const b = need("report_health", "HEALTH_FIRST", "Check health before you build the array.");
        if (b) { res = { status: "blocked", code: b.code, feedback: b.msg }; break; }
        const e = evaluateRaidChoice(this.hardware.raid_requirement, { level: input.level, usable_tb: Number(input.usable_tb) });
        if (e.correct) { u.raid = e.capacity; u.steps.add("configure_raid"); }
        res = { status: e.correct ? "success" : "incorrect", code: e.correct ? "RAID_OK" : "RAID_REJECTED", feedback: e.reason, raid: e.capacity };
        break;
      }
      case "verify_link": {
        const b = need("configure_raid", "RAID_FIRST", "Build the data array first.");
        if (b) { res = { status: "blocked", code: b.code, feedback: b.msg }; break; }
        const ok = Number(input.links_up) === 2 && Number(input.speed_gbps) === 10;
        if (ok) u.steps.add("verify_link");
        res = { status: ok ? "success" : "incorrect", code: ok ? "LINKS_OK" : "LINKS_MISREAD", feedback: ok ? "Both bond members up at 10 Gb/s to core switches 1 and 2." : "Check both port LEDs and the switch side again." };
        break;
      }
      default: requireValue(false, "UNKNOWN_SERVER_ACTION", "unknown bring-up action " + actionId);
    }
    this._syncObjectives();
    const { status, ...rest } = res;
    return this._record(actionId, actionId.startsWith("report") || actionId === "configure_raid" ? "decision" : "perform", status, rest);
  }

  _syncObjectives() {
    if (this.labId === "IT-LAB-041") {
      const done = (scope) => this.prompts.filter((p) => p.scope === scope).every((p) => this.answered.has(p.prompt_id));
      this.objectives[0].complete = done("rack");
      this.objectives[1].complete = done("server");
    } else if (this.labId === "IT-LAB-042") {
      const s = this.build.state, t = this.hardware.rebuild_kit.target;
      this.objectives[0].complete = Object.keys(s.cpus).length === t.cpus && Object.keys(s.heatsinks).length === t.cpus;
      this.objectives[1].complete = s.memory_validated;
      this.objectives[2].complete = Object.keys(s.drives).length === t.data_drives.count && !!s.risers.RISER1 && !!s.pcie[t.raid_controller_slot] && !!s.ocp && !!s.cables["CBL-RAID-BP-A"];
      this.objectives[3].complete = s.lid_closed;
    } else {
      const st = this.bringup.steps;
      this.objectives[0].complete = st.has("report_post");
      this.objectives[1].complete = st.has("report_health");
      this.objectives[2].complete = st.has("configure_raid");
      this.objectives[3].complete = st.has("verify_link");
    }
  }

  canComplete() { this._syncObjectives(); return this.objectives.every((o) => o.complete); }

  complete() {
    requireValue(this.session.phase === SESSION_STATES.RUNNING, "SESSION_NOT_RUNNING", "exercise must be RUNNING");
    const incomplete = this.objectives.filter((o) => !o.complete).map((o) => o.objective_id);
    requireValue(incomplete.length === 0, "SERVER_LAB_OBJECTIVES_INCOMPLETE", "incomplete objectives: " + incomplete.join(", "));
    for (const c of this.session.criteria) {
      if (!c.satisfied) this.session.satisfyCriterion(c.criterion_id, {
        evidence_type: "server_lab_completion", lab_id: this.labId,
        completed_objective_ids: this.objectives.map((o) => o.objective_id),
        successful_actions: this.history.filter((h) => h.status === "success").length,
        credential_is_not_competency: true,
      });
    }
    this.session.complete();
    return this.snapshot();
  }

  snapshot() {
    this._syncObjectives();
    return {
      server_lab_runtime_version: SERVER_LAB_RUNTIME_VERSION,
      scenario_id: "EU-SERVER-LAB-" + this.labId.slice(-3) + "-V1",
      source_lab_id: this.labId,
      title: this.sourceLab.title,
      mode: "SIMULATION",
      execution_target: "SANDBOX",
      live_control_allowed: false,
      credential_is_not_competency: true,
      competency_ids: LEVEL_COMPETENCIES[this.labId],
      time_target_ms: LEVEL_TIME_TARGET_MS[this.labId],
      phase: this.session.phase,
      objectives: clone(this.objectives),
      unresolved_fault_ids: [],
      action_history: clone(this.history),
      can_complete: this.canComplete(),
      build: this.build ? this.build.snapshot() : null,
      bringup: this.bringup ? { powered: this.bringup.powered, post: clone(this.bringup.post), sel: clone(this.bringup.sel), raid: clone(this.bringup.raid), steps: [...this.bringup.steps].sort() } : null,
      prompts_answered: this.answered ? [...this.answered].sort() : null,
      sandbox: this.sandbox.snapshot({ changed_only: true }),
    };
  }

  exportEvidence() {
    return { ...this.snapshot(), runtime_evidence: this.session.exportEvidence() };
  }
}

export function applyBuildStep(build, step) {
  switch (step.op) {
    case "ground": return build.groundEsd();
    case "install": return build.install(step.part, step.target, step.options || {});
    case "connect": return build.connect(step.cable, step.to);
    case "validate_memory": return build.validateMemory();
    case "close_lid": return build.closeLid();
    default: throw new LabRuntimeError("UNKNOWN_BUILD_STEP", "unknown build step " + step.op);
  }
}

/* ------------------------------------------------------------------ L4 troubleshoot */

export function createServerTroubleshootScenario({ pack, labCatalog, labId, electronics, session_id, actor_id = "learner" }) {
  requireValue(SERVER_LAB_LEVELS.L4.lab_ids.includes(labId), "UNKNOWN_SERVER_LAB", "L4 labs are IT-LAB-044..051");
  const definition = scenarioDefinitionByLabId(pack, labId);
  const sourceLab = (labCatalog.labs || []).find((l) => l.lab_id === labId);
  requireValue(Boolean(sourceLab), "SOURCE_LAB_NOT_FOUND", "catalog lab not found: " + labId);
  const runner = new GuidedScenarioRunner({ definition, sourceLab, electronics, session_id: session_id || "SERVER-LAB::" + labId, actor_id });
  runner.serverPowered = true;
  return runner;
}

/* Safety boundary for L4 actions, judged before dispatch. Returns a violation record for the Step 6
   assessment (recordSafetyViolation) or null. It never changes the runtime state itself. */
export function serverSafetyCheck({ pack, labId, actionId, input = {}, snapshot, powered = true, hardware }) {
  const definition = (pack.scenarios || []).find((s) => s.source_lab_id === labId);
  if (!definition) return null;
  const action = definition.actions.find((a) => a.action_id === actionId);
  if (!action || action.action_type !== "mitigate" || !input.component_id) return null;
  const component = String(input.component_id);
  const unresolved = new Set((snapshot && snapshot.unresolved_fault_ids) || []);
  const rules = Object.fromEntries((pack.safety_rules || []).map((r) => [r.code, r]));
  const instanceType = (() => {
    if (/^CPU\d-DIMM-/.test(component)) return "dimm";
    if (/^CPU\d$/.test(component)) return "cpu";
    if (component === "CMOS-BATTERY") return "cmos_battery";
    if (component === "OCP-NIC") return "ocp_nic";
    if (/^BAY-/.test(component)) return "drive_sff";
    if (/^PSU\d$/.test(component)) return "psu";
    return null;
  })();
  const hotSwap = instanceType && hardware && hardware.component_types[instanceType] ? hardware.component_types[instanceType].hot_swap === true : true;
  const make = (code, description) => ({ ...rules[code], code, description, related_action_id: actionId });
  if (powered && instanceType && !hotSwap) return make("HOT_REMOVAL_OF_NON_HOT_SWAP_PART", component + " is not hot-swappable; removing it from a running server can damage the board and crash the host.");
  const raid = definition.server_fault_bindings.raid_member_failed;
  if (raid && unresolved.has("raid_member_failed") && instanceType === "drive_sff" && component !== raid.component_id && raid.array_members.includes(component)) {
    return make("HEALTHY_MEMBER_REMOVED_FROM_DEGRADED_ARRAY", "Pulling healthy " + component + " from a degraded RAID 5 array loses the virtual disk.");
  }
  const psu = definition.server_fault_bindings.psu_failed;
  if (psu && unresolved.has("psu_failed") && instanceType === "psu" && component !== psu.component_id && powered) {
    return make("LAST_PSU_REMOVED", "Pulling the only healthy PSU powers the host off hard.");
  }
  return null;
}

/* ------------------------------------------------------------------ electronics subset for the page */

/* The browser does not need all of B1→L7 to run a server lab. This keeps the B1 telecom/ICT assets, the logical
   services and VLANs, and every connection/relationship among them. Faults injected on the subset change exactly the
   same canonical IDs as on the full fabric (verify_server_lab_v1.mjs proves it). */
export function mdfElectronicsSubset({ registry, connections, manifest }) {
  const keep = (a) => {
    const loc = a.location || {};
    const t = (a.classification && a.classification.asset_type) || "";
    if (/^LOGIC-/.test(a.asset_id)) return true;
    if (loc.level_id !== "B1") return false;
    return /^B1-(SRV|NET|ICT|WAN|SEC-NVR|ELEC-UPS|TELECOM)/.test(a.asset_id) || ["pdu", "rack_ups", "patch_panel", "fiber_panel"].includes(t);
  };
  const assets = registry.assets.filter(keep);
  const ids = new Set(assets.map((a) => a.asset_id));
  return {
    registry: { ...registry, assets, relationships: (registry.relationships || []).filter((r) => ids.has(r.from_asset_id) && ids.has(r.to_asset_id)) },
    connections: { ...connections, connections: connections.connections.filter((c) => ids.has(c.from_asset_id) && ids.has(c.to_asset_id)) },
    manifest: { ...manifest, new_asset_ids: manifest.new_asset_ids.filter((id) => ids.has(id)) },
  };
}
