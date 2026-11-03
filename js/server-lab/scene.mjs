/* Server Lab 3D scene: B1 MDF room, rack row, MDF rack 01 built from the hardware authority, and the lab server built
   from expandServerModel(). Geometry is data-driven: every interactive mesh carries userData.pick = { kind, id }.
   Unbranded generic hardware only; no marks, no logos (CLAUDE.md rule 10). */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const MM = 0.001;
const RACK_BASE = 0.06;          // plinth / levelling feet
const RAIL_FRONT_Z = 0.0;        // front rail plane
const COLORS = {
  floor: 0x5a6064, wall: 0x2a3034, ceiling: 0x1c2125, rack: 0x1d2124, rail: 0x6c757b, bezel: 0x2d3338, steel: 0x8a939a,
  chassis: 0x9aa2a8, pcb: 0x1f5a43, pcbDark: 0x173d30, dimmSpreader: 0xa9b2b8, heatsink: 0xc3c9cd, black: 0x15181a,
  carrier: 0x2e3337, psu: 0x3b4146, cable: 0x0f1113, copper: 0xb87333, slotBlack: 0x101214, gold: 0xc9a14a, yellowTray: 0xc8a42c,
};
const LED = { green: 0x31d158, amber: 0xffa31a, blue: 0x3da5ff, off: 0x1a1d1f, "amber-standby": 0xffa31a };

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.55, metalness: opts.metalness ?? 0.2, ...opts });
}
const M = {
  floor: mat(COLORS.floor, { roughness: 0.9, metalness: 0 }),
  wall: mat(COLORS.wall, { roughness: 0.95, metalness: 0 }),
  ceiling: mat(COLORS.ceiling, { roughness: 1, metalness: 0 }),
  rack: mat(COLORS.rack, { roughness: 0.6, metalness: 0.4 }),
  rail: mat(COLORS.rail, { roughness: 0.4, metalness: 0.8 }),
  bezel: mat(COLORS.bezel, { roughness: 0.5, metalness: 0.3 }),
  steel: mat(COLORS.steel, { roughness: 0.35, metalness: 0.85 }),
  chassis: mat(COLORS.chassis, { roughness: 0.4, metalness: 0.7 }),
  pcb: mat(COLORS.pcb, { roughness: 0.7, metalness: 0.1 }),
  pcbDark: mat(COLORS.pcbDark, { roughness: 0.7, metalness: 0.1 }),
  spreader: mat(COLORS.dimmSpreader, { roughness: 0.3, metalness: 0.9 }),
  heatsink: mat(COLORS.heatsink, { roughness: 0.3, metalness: 0.9 }),
  black: mat(COLORS.black, { roughness: 0.7, metalness: 0.2 }),
  carrier: mat(COLORS.carrier, { roughness: 0.5, metalness: 0.4 }),
  psu: mat(COLORS.psu, { roughness: 0.5, metalness: 0.5 }),
  cable: mat(COLORS.cable, { roughness: 0.8, metalness: 0 }),
  copper: mat(COLORS.copper, { roughness: 0.35, metalness: 0.9 }),
  slot: mat(COLORS.slotBlack, { roughness: 0.7 }),
  gold: mat(COLORS.gold, { roughness: 0.3, metalness: 1 }),
  tray: mat(COLORS.yellowTray, { roughness: 0.6, metalness: 0.5 }),
  port: mat(0x070809, { roughness: 0.9 }),
  white: mat(0xe8ebec, { roughness: 0.6 }),
  ghost: new THREE.MeshStandardMaterial({ color: 0x2fd0b5, transparent: true, opacity: 0.28, emissive: 0x2fd0b5, emissiveIntensity: 0.6, depthWrite: false }),
};

function box(w, h, d, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.0004), Math.max(h, 0.0004), Math.max(d, 0.0004)), material);
  m.castShadow = false; m.receiveShadow = false;
  return m;
}
/* chassis-frame mm box [x,y,z,w,h,d] (z front→rear) → mesh in a server group whose origin is front-left-bottom */
function placeMm(mesh, b) {
  mesh.position.set((b[0] + b[3] / 2) * MM, (b[1] + b[4] / 2) * MM, -(b[2] + b[5] / 2) * MM);
  return mesh;
}
function led(color, size = 0.0035) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, 0.0015), new THREE.MeshStandardMaterial({ color: LED[color] ?? LED.off, emissive: LED[color] ?? 0, emissiveIntensity: color === "off" ? 0 : 1.8 }));
  m.userData.isLed = true;
  return m;
}
export function setLed(mesh, color) {
  if (!mesh) return;
  const c = LED[color] ?? LED.off;
  mesh.material.color.setHex(c);
  mesh.material.emissive.setHex(color === "off" ? 0 : c);
  mesh.material.emissiveIntensity = color === "off" ? 0 : 1.8;
  mesh.userData.blink = color === "amber-standby";
}

/* ------------------------------------------------------------------ server */

function buildComponent(inst, form) {
  const g = new THREE.Group();
  const [, , , w, h, d] = inst.box;
  const W = w * MM, H = h * MM, D = d * MM;
  const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); g.add(m); return m; };
  switch (inst.type) {
    case "motherboard": add(box(W, H, D, M.pcb)); break;
    case "backplane": add(box(W, H, D, M.pcbDark)); for (let i = 0; i < 12; i += 1) add(box(0.012, 0.006, 0.004, M.slot), -W / 2 + 0.02 + i * (W - 0.04) / 11, -H / 2 + 0.02, D / 2); break;
    case "cpu": {
      add(box(W + 0.012, 0.004, D + 0.012, M.black), 0, -H / 2 + 0.002, 0); // socket frame
      add(box(W, H * 0.6, D, M.steel), 0, 0.001, 0);                        // integrated heat spreader
      const tri = box(0.006, 0.0008, 0.006, M.gold); add(tri, -W / 2 + 0.006, H / 2 - 0.001, D / 2 - 0.006);
      break;
    }
    case "heatsink": {
      add(box(W, 0.006, D, M.copper), 0, -H / 2 + 0.003, 0);
      const fins = Math.round(W / 0.0022);
      const finGeo = new THREE.BoxGeometry(0.0004, H - 0.008, D);
      const im = new THREE.InstancedMesh(finGeo, M.heatsink, fins);
      const o = new THREE.Object3D();
      for (let i = 0; i < fins; i += 1) { o.position.set(-W / 2 + (i + 0.5) * (W / fins), 0.004, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }
      g.add(im);
      for (const [sx, sz] of [[-1, -1], [1, 1], [1, -1], [-1, 1]]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, H + 0.002, 10), M.steel), sx * (W / 2 - 0.004), 0.001, sz * (D / 2 - 0.004));
      break;
    }
    case "dimm": {
      // the slot itself is drawn by the board; this is the module
      add(box(0.0012, H, D, M.pcb));
      add(box(0.0012, H * 0.82, D * 0.94, M.spreader), -0.0016, 0.001, 0);
      add(box(0.0012, H * 0.82, D * 0.94, M.spreader), 0.0016, 0.001, 0);
      const l = led("off", 0.0025); l.name = "led"; add(l, 0.0032, -H / 2 + 0.004, D / 2 + 0.003);
      break;
    }
    case "drive_sff": {
      add(box(W * 0.9, H * 0.92, D * 0.84, M.steel), 0, 0, -D * 0.08);
      add(box(W, H, 0.014, M.carrier), 0, 0, D / 2 - 0.007);
      add(box(W * 0.6, H * 0.6, 0.002, M.black), 0, -H * 0.06, D / 2 + 0.0005);
      const act = led("off", 0.0028); act.name = "led"; add(act, 0, H / 2 - 0.006, D / 2 + 0.0015);
      const fault = led("off", 0.0028); fault.name = "led2"; add(fault, 0, H / 2 - 0.011, D / 2 + 0.0015);
      break;
    }
    case "fan": {
      add(box(W, H, D, M.black)).material = M.black;
      const rotor = new THREE.Group(); rotor.name = "rotor";
      rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(W * 0.16, W * 0.16, D * 0.7, 16).rotateX(Math.PI / 2), M.black));
      for (let i = 0; i < 7; i += 1) {
        const blade = box(W * 0.36, 0.0015, D * 0.5, mat(0x2a2e31)); blade.position.x = W * 0.24;
        const arm = new THREE.Group(); arm.rotation.z = (i / 7) * Math.PI * 2; blade.rotation.x = 0.5; arm.add(blade); rotor.add(arm);
      }
      rotor.position.z = D / 2 + 0.0008; g.add(rotor);
      const l = led("off", 0.003); l.name = "led"; add(l, W / 2 - 0.005, H / 2 - 0.005, D / 2 + 0.002);
      break;
    }
    case "psu": {
      add(box(W, H, D, M.psu));
      add(box(W * 0.7, H * 0.55, 0.002, M.black), -W * 0.1, 0, -D / 2 - 0.001); // grille (rear face is -z… rear of chassis)
      add(box(0.014, 0.012, 0.006, M.black), W * 0.32, 0, -D / 2 - 0.003);     // C14 inlet
      const handle = box(0.004, H * 0.7, 0.02, M.black); add(handle, -W / 2 + 0.006, 0, -D / 2 - 0.01);
      const l = led("off", 0.004); l.name = "led"; add(l, W * 0.32, H / 2 - 0.006, -D / 2 - 0.002);
      break;
    }
    case "riser": add(box(0.0015, H, D, M.steel), -W / 2, 0, 0); add(box(W, 0.0015, D, M.steel), 0, -H / 2, 0); break;
    case "pcie_slot": add(box(W * 0.85, 0.008, 0.012, M.slot), 0, 0, D / 2 - 0.02); break;
    case "raid_controller": {
      add(box(W, 0.0016, D, M.pcb));
      add(box(0.03, 0.012, 0.03, M.heatsink), 0, 0.007, 0.02);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 14).rotateZ(Math.PI / 2), M.black), 0, 0.007, -0.04);
      add(box(0.022, 0.006, 0.012, M.black), -W / 2 + 0.015, 0.004, D / 2 - 0.01);
      add(box(0.022, 0.006, 0.012, M.black), -W / 2 + 0.042, 0.004, D / 2 - 0.01);
      break;
    }
    case "ocp_nic": add(box(W, 0.0016, D, M.pcb)); add(box(W, H, 0.002, M.steel), 0, 0, -D / 2); break;
    case "nic_port": { add(box(W, H, D, M.steel)); add(box(W * 0.7, H * 0.55, 0.002, M.port), 0, 0, -D / 2 - 0.0005); const l = led("off", 0.0025); l.name = "led"; add(l, W / 2 - 0.002, H / 2 + 0.002, -D / 2 - 0.001); break; }
    case "dac_cable": case "power_cord": {
      add(box(W, H, 0.03, inst.type === "dac_cable" ? M.steel : M.black), 0, 0, D / 2 - 0.015);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, D, 10).rotateX(Math.PI / 2), M.cable); add(c, 0, 0, -0.01);
      break;
    }
    case "bmc": add(box(W, H, D, inst.id === "MGMT-PORT" ? M.steel : M.black)); if (inst.id === "MGMT-PORT") add(box(W * 0.7, H * 0.6, 0.002, M.port), 0, 0, -D / 2 - 0.0005); break;
    case "tpm": add(box(W, 0.0012, D, M.pcb)); add(box(W * 0.4, 0.002, D * 0.5, M.black), 0, 0.0015, 0); break;
    case "cmos_battery": add(new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, H, 24), M.steel)); add(box(W + 0.004, 0.0012, W * 0.5, M.black), 0, -H / 2, 0); break;
    case "m2_boot_module": add(box(W, 0.0016, D, M.pcbDark)); add(box(W * 0.25, 0.0025, D * 0.8, M.black), -W * 0.2, 0.002, 0); add(box(W * 0.25, 0.0025, D * 0.8, M.black), W * 0.2, 0.002, 0); break;
    case "front_panel": {
      add(box(W, H, D, M.bezel));
      const p = led("off", 0.004); p.name = "led-power"; add(p, 0, H * 0.25, D / 2 + 0.001);
      const hl = led("off", 0.004); hl.name = "led-health"; add(hl, 0, H * 0.05, D / 2 + 0.001);
      const uid = led("off", 0.004); uid.name = "led-uid"; add(uid, 0, -H * 0.15, D / 2 + 0.001);
      break;
    }
    default: add(box(W, H, D, M.black));
  }
  return g;
}

export function buildServer(model, instances, { interactive = false, rackItemId = null } = {}) {
  const W = model.chassis_mm.w, H = model.chassis_mm.h, D = model.chassis_mm.d;
  const root = new THREE.Group();
  root.userData = { model, instances, parts: new Map(), leds: new Map(), lid: null, slots: new Map(), rackItemId };
  const shell = new THREE.Group(); root.add(shell);
  const T = 1.0;
  shell.add(placeMm(box(W * MM, T * MM, D * MM, M.chassis), [0, 0, 0, W, T, D]));
  shell.add(placeMm(box(T * MM, H * MM, D * MM, M.chassis), [0, 0, 0, T, H, D]));
  shell.add(placeMm(box(T * MM, H * MM, D * MM, M.chassis), [W - T, 0, 0, T, H, D]));
  // front bezel strip between the bays and the right ear, rear wall pieces
  shell.add(placeMm(box((W - 260) * MM, H * MM, 6 * MM, M.bezel), [255, 0, -6, W - 260, H, 6]));
  const lid = placeMm(box(W * MM, T * MM, (D - 4) * MM, M.chassis), [0, H - T, 2, W, T, D - 4]);
  lid.userData.pick = interactive ? { kind: "server-lid", id: "LID" } : (rackItemId ? { kind: "rack", id: rackItemId } : null);
  root.add(lid); root.userData.lid = lid;
  // drive cage face: blanking fillers recessed in every bay (a carrier covers its filler), the strip above the bays,
  // and the panel between the left ear and bay 0
  const bays = model.drive_bays;
  for (let b = 0; b < bays.count; b += 1) {
    const x = bays.start_x_mm + b * bays.pitch_mm;
    const filler = placeMm(box((bays.pitch_mm - 1.5) * MM, Math.min(76, H - 8) * MM, 2 * MM, M.bezel), [x, 4, 9, bays.pitch_mm - 1.5, Math.min(76, H - 8), 2]);
    shell.add(filler);
    for (let k = 0; k < 6; k += 1) shell.add(placeMm(box((bays.pitch_mm - 7) * MM, 2.2 * MM, 0.6 * MM, M.black), [x + 3, 10 + k * (Math.min(76, H - 8) - 14) / 5, 8.4, bays.pitch_mm - 7, 2.2, 0.6]));
  }
  const cageTop = Math.min(76, H - 8) + 4;
  shell.add(placeMm(box((bays.start_x_mm + bays.count * bays.pitch_mm) * MM, (H - cageTop) * MM, 3 * MM, M.bezel), [0, cageTop, 0, bays.start_x_mm + bays.count * bays.pitch_mm, H - cageTop, 3]));
  shell.add(placeMm(box(bays.start_x_mm * MM, cageTop * MM, 3 * MM, M.bezel), [0, 0, 0, bays.start_x_mm, cageTop, 3]));
  // rear panel: solid steel wherever no rear-loading module (PSU, riser bracket, OCP adapter) sits
  const rearFree = (x0, x1, y0 = 0, y1 = H) => { if (x1 - x0 > 0.5 && y1 - y0 > 0.5) shell.add(placeMm(box((x1 - x0) * MM, (y1 - y0) * MM, 1 * MM, M.chassis), [x0, y0, D - 1, x1 - x0, y1 - y0, 1])); };
  const blocks = [];
  for (const r of model.risers) blocks.push([r.x_mm, r.x_mm + 110, 0, H]);
  blocks.push([model.ocp_slot.x_mm, model.ocp_slot.x_mm + 76, 0, 14]);
  for (const p of model.psus) blocks.push([p.x_mm, p.x_mm + 73.5, p.y_mm, p.y_mm + 39]);
  const xs = [...new Set([0, W, ...blocks.flatMap((b) => [b[0], b[1]])])].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i += 1) {
    const x0 = xs[i], x1 = xs[i + 1], mid = (x0 + x1) / 2;
    const cover = blocks.filter((b) => b[0] <= mid && mid <= b[1]).sort((a, b) => a[2] - b[2]);
    let y = 0;
    for (const b of cover) { rearFree(x0, x1, y, b[2]); y = Math.max(y, b[3]); }
    rearFree(x0, x1, y, H);
  }
  // riser brackets: PCIe slot covers with vent slits
  for (const r of model.risers) {
    const plate = placeMm(box(110 * MM, (H - 2) * MM, 1 * MM, M.steel), [r.x_mm, 1, D - 0.6, 110, H - 2, 1]);
    shell.add(plate);
    for (let k = 0; k < Math.floor((H - 10) / 20); k += 1) shell.add(placeMm(box(90 * MM, 6 * MM, 1 * MM, M.black), [r.x_mm + 10, 6 + k * 20, D, 90, 6, 1]));
  }
  // rack ears
  for (const x of [W]) shell.add(placeMm(box(24.3 * MM, H * MM, 4 * MM, M.bezel), [x, 0, -4, 24.3, H, 4]));

  const OUTSIDE = new Set(["drive_sff", "front_panel", "psu", "nic_port", "dac_cable", "power_cord"]);
  for (const inst of instances) {
    if (inst.id === "CHASSIS") continue;
    if (!interactive && !OUTSIDE.has(inst.type)) continue;
    if (!interactive && inst.type === "drive_sff" && inst.bay > 3) continue;
    const g = buildComponent(inst, model.form_factor);
    g.position.set((inst.box[0] + inst.box[3] / 2) * MM, (inst.box[1] + inst.box[4] / 2) * MM, -(inst.box[2] + inst.box[5] / 2) * MM);
    g.userData.base = g.position.clone();
    g.userData.inst = inst;
    g.traverse((o) => { if (o.isMesh) o.userData.pick = interactive ? { kind: "component", id: inst.id } : (rackItemId ? { kind: "rack", id: rackItemId } : null); });
    root.add(g);
    root.userData.parts.set(inst.id, g);
    g.traverse((o) => { if (o.userData.isLed && o.name) root.userData.leds.set(inst.id + ":" + o.name, o); });
    // the LGA socket and its load frame stay on the board when the CPU is out
    if (inst.type === "cpu" && interactive) {
      const [x, y, z, w, h, d] = inst.box;
      const frame = box((w + 14) * MM, 3 * MM, (d + 14) * MM, M.black);
      frame.position.set((x + w / 2) * MM, (y - 1.5) * MM, -(z + d / 2) * MM);
      const contacts = box(w * MM, 0.6 * MM, d * MM, M.gold);
      contacts.position.set(frame.position.x, (y - 0.1) * MM, frame.position.z);
      frame.userData.pick = contacts.userData.pick = { kind: "component", id: inst.id };
      root.add(frame, contacts);
    }
    // empty DIMM slot connectors stay on the board
    if (inst.type === "dimm") {
      const slot = box(0.006, 0.0075, inst.box[5] * MM + 0.008, M.slot);
      slot.position.set((inst.box[0] + 3) * MM, (inst.box[1] + 3.75) * MM, -(inst.box[2] + inst.box[5] / 2) * MM);
      const latchMat = inst.latch === "white" ? M.white : M.black;
      for (const s of [-1, 1]) { const l = box(0.006, 0.01, 0.004, latchMat); l.position.set(slot.position.x, slot.position.y + 0.002, slot.position.z + s * (inst.box[5] * MM / 2 + 0.004)); root.add(l); }
      slot.userData.pick = interactive ? { kind: "component", id: inst.id } : null;
      root.add(slot);
    }
  }
  return root;
}

/* ------------------------------------------------------------------ rack */

function portRow(parent, count, rowW, y, z, cell = 0.011) {
  const geo = new THREE.BoxGeometry(cell * 0.78, cell * 0.62, 0.002);
  const im = new THREE.InstancedMesh(geo, M.port, count);
  const o = new THREE.Object3D();
  for (let i = 0; i < count; i += 1) { o.position.set(-rowW / 2 + (i + 0.5) * (rowW / count), y, z); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }
  parent.add(im);
  return im;
}

function buildRackItem(item, hardware, u_mm) {
  const g = new THREE.Group();
  const h = item.u_size * u_mm * MM - 0.0008;
  const w = 0.434, d = item.kind.includes("panel") || item.kind === "cable_manager" || item.kind === "blank" ? 0.12 : 0.6;
  const body = box(w, h, d, item.kind === "blank" ? M.bezel : M.chassis);
  body.position.set(0, h / 2, -d / 2);
  g.add(body);
  const face = box(0.4826, h, 0.004, M.bezel);
  face.position.set(0, h / 2, 0.002);
  g.add(face);
  const fz = 0.0045;
  switch (item.kind) {
    case "patch_panel": portRow(g, 24, 0.3, h * 0.68, fz); portRow(g, 24, 0.3, h * 0.32, fz); break;
    case "fiber_panel": portRow(g, 12, 0.26, h / 2, fz, 0.016); break;
    case "core_switch": portRow(g, 24, 0.26, h * 0.68, fz, 0.0095); portRow(g, 24, 0.26, h * 0.32, fz, 0.0095); portRow(g, 4, 0.06, h / 2, fz).position.x = 0.17; break;
    case "firewall": case "edge_router": case "carrier_cpe": portRow(g, 8, 0.11, h / 2, fz).position.x = 0.06; break;
    case "cable_manager": for (let i = 0; i < 12; i += 1) { const f = box(0.008, h * 0.8, 0.05, M.black); f.position.set(-0.2 + i * 0.036, h / 2, 0.03); g.add(f); } break;
    case "rack_ups": case "ups_battery": { const p = box(0.08, h * 0.5, 0.002, M.black); p.position.set(0.12, h / 2, fz); g.add(p); for (let i = 0; i < 6; i += 1) { const v = box(0.02, h * 0.7, 0.002, M.black); v.position.set(-0.18 + i * 0.03, h / 2, fz); g.add(v); } break; }
    case "nvr": case "backup_appliance": case "nas": for (let i = 0; i < 4; i += 1) for (let j = 0; j < 2; j += 1) { const c = box(0.095, h / 2 - 0.006, 0.003, M.carrier); c.position.set(-0.16 + i * 0.1, h * (0.27 + 0.48 * j), fz); g.add(c); } break;
    default: break;
  }
  if (["core_switch", "firewall", "edge_router", "carrier_cpe", "rack_ups", "nvr", "backup_appliance", "nas", "ups_battery"].includes(item.kind)) {
    const l = led("green", 0.004); l.position.set(-0.2, h * 0.6, fz); g.add(l);
  }
  g.traverse((o) => { if (o.isMesh || o.isInstancedMesh) o.userData.pick = { kind: "rack", id: item.item_id }; });
  return g;
}

export function buildRack(hardware, layout, { serverInstances, labServerModel, oneUModel, oneUInstances }) {
  const rack = new THREE.Group();
  const ext = layout.rack.external_mm;
  const RW = ext.w * MM, RD = ext.d * MM, RH = ext.h * MM;
  const frontOff = 0.12; // door-to-rail clearance
  // frame: four posts, top, sides
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const post = box(0.04, RH, 0.04, M.rack); post.castShadow = true;
    post.position.set(x * (RW / 2 - 0.02), RH / 2, z > 0 ? frontOff - 0.02 : frontOff - RD + 0.02);
    rack.add(post);
  }
  const top = box(RW, 0.04, RD, M.rack); top.position.set(0, RH - 0.02, frontOff - RD / 2); rack.add(top);
  const plinth = box(RW, RACK_BASE, RD, M.black); plinth.position.set(0, RACK_BASE / 2, frontOff - RD / 2); rack.add(plinth);
  for (const s of [-1, 1]) { const side = box(0.01, RH - 0.08, RD - 0.08, M.rack); side.position.set(s * (RW / 2 - 0.005), RH / 2, frontOff - RD / 2); rack.add(side); }
  // EIA-310 rails with square holes every 1U
  const railH = layout.rack.units * layout.rack.u_mm * MM;
  for (const x of [-0.2326, 0.2326]) for (const z of [RAIL_FRONT_Z, RAIL_FRONT_Z - hardware.rack.rail_depth_mm * MM]) {
    const rail = box(0.016, railH, 0.002, M.rail); rail.position.set(x, RACK_BASE + railH / 2, z); rack.add(rail);
  }
  const holes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0095, 0.0095, 0.001), M.black, layout.rack.units * 3 * 2);
  const o = new THREE.Object3D(); let k = 0;
  for (let u = 0; u < layout.rack.units; u += 1) for (const off of [6.35, 22.225, 38.1]) for (const x of [-0.2326, 0.2326]) { o.position.set(x, RACK_BASE + (u * layout.rack.u_mm + off) * MM, RAIL_FRONT_Z + 0.0012); o.updateMatrix(); holes.setMatrixAt(k++, o.matrix); }
  rack.add(holes);

  const items = new Map();
  let labServer = null;
  for (const item of layout.items) {
    let g;
    if (item.kind === "server_2u" || item.kind === "server_1u") {
      const is1U = item.kind === "server_1u";
      const lab = !!item.lab_server;
      g = buildServer(is1U ? oneUModel : labServerModel, is1U ? oneUInstances : serverInstances, { interactive: lab, rackItemId: item.item_id });
      g.position.set(-labServerModel.chassis_mm.w * MM / 2, RACK_BASE + item.bottom_mm * MM + 0.0005, RAIL_FRONT_Z);
      if (lab) labServer = g;
      // the rack-level pick for every server shell
      g.traverse((m) => { if ((m.isMesh || m.isInstancedMesh) && !m.userData.pick) m.userData.pick = { kind: "rack", id: item.item_id }; });
      if (!lab) g.traverse((m) => { if (m.isMesh || m.isInstancedMesh) m.userData.pick = { kind: "rack", id: item.item_id }; });
    } else {
      g = buildRackItem(item, hardware, layout.rack.u_mm);
      g.position.set(0, RACK_BASE + item.bottom_mm * MM, RAIL_FRONT_Z);
    }
    g.userData.item = item;
    rack.add(g);
    items.set(item.item_id, g);
  }
  // 0U PDUs on the rear
  for (const z of layout.zero_u) {
    const side = z.side.includes("left") ? -1 : 1;
    const inner = z.side.includes("inner");
    const pdu = box(0.055, 1.75, 0.05, M.black);
    pdu.position.set(side * (inner ? 0.24 : 0.265), RACK_BASE + 0.95, frontOff - RD + (inner ? 0.14 : 0.08));
    const outlets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.022, 0.004), M.port, 12);
    for (let i = 0; i < 12; i += 1) { o.position.set(0, -0.75 + i * 0.13, 0.027); o.updateMatrix(); outlets.setMatrixAt(i, o.matrix); }
    pdu.add(outlets);
    pdu.userData.pick = { kind: "rack", id: z.item_id };
    outlets.userData.pick = { kind: "rack", id: z.item_id };
    const g = new THREE.Group(); g.add(pdu); g.userData.item = { ...z, label: hardware.rack_item_types.pdu.label };
    rack.add(g);
    items.set(z.item_id, g);
  }
  return { rack, items, labServer };
}

function neighbourRack(hardware) {
  const g = new THREE.Group();
  const RW = 0.6, RD = 1.2, RH = 2.0;
  const shell = box(RW, RH, RD, M.rack); shell.castShadow = true; shell.position.set(0, RH / 2, 0.12 - RD / 2); g.add(shell);
  const door = box(RW - 0.02, RH - 0.1, 0.01, mat(0x15191c, { roughness: 0.7, metalness: 0.5 })); door.position.set(0, RH / 2, 0.125); g.add(door);
  const perf = new THREE.InstancedMesh(new THREE.BoxGeometry(0.006, 0.006, 0.002), M.black, 30 * 60);
  const o = new THREE.Object3D(); let k = 0;
  for (let i = 0; i < 30; i += 1) for (let j = 0; j < 60; j += 1) { o.position.set(-0.24 + i * 0.0165, 0.1 + j * 0.03, 0.131); o.updateMatrix(); perf.setMatrixAt(k++, o.matrix); }
  g.add(perf);
  const l = led("green", 0.006); l.position.set(0.22, 1.9, 0.132); g.add(l);
  return g;
}

/* ------------------------------------------------------------------ room + renderer */

export function createStage(container, { lite = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = !lite;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1114);
  const pmrem = new THREE.PMREMGenerator(renderer);
  if (!lite) { scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55; }
  else scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 60);
  camera.position.set(1.2, 1.6, 3.2);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.15; controls.maxDistance = 9;
  controls.maxPolarAngle = Math.PI * 0.53;
  scene.add(new THREE.HemisphereLight(0xdfe8ef, 0x3a3430, 1.1));
  const fill = new THREE.DirectionalLight(0xffffff, 1.2); fill.position.set(0.4, 2.0, 4); scene.add(fill);
  const rearFill = new THREE.DirectionalLight(0xdfe8ff, 0.8); rearFill.position.set(0.5, 2.0, -3); scene.add(rearFill);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2.5, 4.2, 3.5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -1; key.shadow.bias = -0.0004;
  scene.add(key);
  // B1 MDF room: sealed concrete, block walls, exposed soffit, overhead ladder tray, linear lights
  const room = new THREE.Group();
  const floor = box(9, 0.02, 8, M.floor); floor.receiveShadow = true; floor.position.set(0, -0.01, 0.5); floor.userData.pick = { kind: "floor" }; room.add(floor);
  const aisle = box(3.2, 0.002, 1.2, mat(0x6b7276, { roughness: 0.85 })); aisle.position.set(0.3, 0.001, 0.75); aisle.userData.pick = { kind: "floor" }; room.add(aisle);
  for (const [w, d, x, z] of [[9, 0.2, 0, -1.9], [0.2, 8, -4.5, 0.5], [0.2, 8, 4.5, 0.5]]) { const wall = box(w, 3.6, d, M.wall); wall.position.set(x, 1.8, z); room.add(wall); }
  const ceil = box(9, 0.1, 8, M.ceiling); ceil.position.set(0, 3.65, 0.5); room.add(ceil);
  const trayRail = (x) => { const r = box(0.03, 0.08, 6, M.tray); r.position.set(x, 2.55, -0.5); room.add(r); };
  trayRail(-0.25); trayRail(0.25);
  for (let i = 0; i < 20; i += 1) { const rung = box(0.5, 0.02, 0.02, M.tray); rung.position.set(0, 2.52, -3.2 + i * 0.3); room.add(rung); }
  for (let i = 0; i < 9; i += 1) { const bundle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6, 8).rotateX(Math.PI / 2), mat([0x1f6fd1, 0x2a2e31, 0xdad7c8][i % 3], { roughness: 0.8 })); bundle.position.set(-0.2 + i * 0.05, 2.57, -0.5); room.add(bundle); }
  for (const x of [-2, 0, 2]) {
    const fix = box(1.2, 0.04, 0.12, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f7ff, emissiveIntensity: 1.2 }));
    fix.position.set(x, 3.55, 1.0); room.add(fix);
  }
  // wall signage zone: plain text-free stripe (no marks)
  const stripe = box(9, 0.08, 0.01, mat(0x2fd0b5, { roughness: 0.6 })); stripe.position.set(0, 1.2, -1.79); room.add(stripe);
  scene.add(room);
  return { renderer, scene, camera, controls, room, THREE };
}

export function addRackRow(scene, hardware, layout, built) {
  const row = new THREE.Group();
  row.add(built.rack);
  for (const x of [-1.2, -0.6, 0.6, 1.2]) { const n = neighbourRack(hardware); n.position.x = x; row.add(n); }
  scene.add(row);
  return row;
}

export { THREE, MM, RACK_BASE };
