/* Server Lab page (equity-uprise-server-lab-3d.html), loaded by js/owner-only.mjs only after the server confirms the house owner.
   The simulation authority is the building's Lab Runtime, published with the site under equity-uprise-preview/
   (deploy-pages.yml): equity-uprise-server-lab-runtime.mjs + server-lab-scenario-pack-v1.json + the hardware authority,
   on the Step 2 electronics sandbox and the Step 6 assessment. This file is presentation and input only. */
import { createStage, addRackRow, buildRack, setLed, THREE, MM } from "./scene.mjs";

const ROOT = new URL("../../", import.meta.url);
const PREVIEW = new URL("equity-uprise-preview/", ROOT);
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const getJson = async (path) => { const r = await fetch(new URL(path, PREVIEW)); if (!r.ok) throw new Error(path + " " + r.status); return r.json(); };

const RT = await import(new URL("lab-runtime/equity-uprise-server-lab-runtime.mjs", PREVIEW).href);
const AS = await import(new URL("lab-runtime/equity-uprise-assessment-runtime.mjs", PREVIEW).href);
const [hardware, pack, labCatalog] = await Promise.all([
  getJson("electronics/server-lab-hardware-v1.json"),
  getJson("lab-runtime/server-lab-scenario-pack-v1.json"),
  getJson("equity-uprise-it-lab-catalog-v1.json"),
]);
let electronicsPromise = null;
let rubricsPromise = null;
function electronics() {
  electronicsPromise ||= Promise.all([getJson("equity-uprise-asset-registry-v1.json"), getJson("equity-uprise-electronics-connections-v1.json"), getJson("equity-uprise-electronics-manifest-v1.json")])
    .then(([registry, connections, manifest]) => RT.mdfElectronicsSubset({ registry, connections, manifest }));
  return electronicsPromise;
}
const rubrics = () => (rubricsPromise ||= getJson("competency-rubrics.json"));

/* ------------------------------------------------------------------ scene */
const stageEl = $("#slStage");
/* ?fx=lite drops shadows and the reflection environment: for software renderers (CI browsers) and weak devices */
const S = createStage(stageEl, { lite: new URLSearchParams(location.search).get("fx") === "lite" });
const layout = RT.rackLayout(hardware);
const labModelId = hardware.lab_server.server_model;
const labModel = hardware.server_models[labModelId];
const instances = RT.expandServerModel(hardware, labModelId);
const instById = new Map(instances.map((i) => [i.id, i]));
const built = buildRack(hardware, layout, {
  serverInstances: instances, labServerModel: labModel,
  oneUModel: hardware.server_models["SRV-1U-GEN"], oneUInstances: RT.expandServerModel(hardware, "SRV-1U-GEN"),
});
addRackRow(S.scene, hardware, layout, built);
const server = built.labServer;
const serverHome = server.position.clone();
const SLIDE = 0.62;

const typeLabel = (t) => (hardware.component_types[t] || {}).label || t;
const FAILURE_LABEL = Object.fromEntries(Object.values(hardware.component_types).flatMap((t) => t.failure_modes.map((m) => [m.id, m.label])));

const ui = {
  level: "EXPLORE", serverOut: false, lidOpen: false, exploded: false, powered: true,
  exercise: null, assessed: null, labId: null, startedAt: 0, selectedPart: null, pendingTarget: null,
  log: [], feedback: null, picked: null, findings: new Set(), fwOrder: [], replaceId: "", done: null, promptFeedback: null,
};

/* the server's visible parts follow a build state: the live L2 build, or the reference build everywhere else */
const reference = new RT.RebuildState(hardware);
for (const step of RT.referenceBuildSteps(hardware)) RT.applyBuildStep(reference, step);
function buildState() { return ui.level === "L2" && ui.exercise ? ui.exercise.build.state : reference.state; }
const ALWAYS = new Set(["MOTHERBOARD", "BACKPLANE", "BMC", "MGMT-PORT", "TPM", "CMOS-BATTERY", "M2-BOOT", "FRONT-PANEL"]);
function partVisible(id, st) {
  const inst = instById.get(id);
  if (!inst) return false;
  if (ALWAYS.has(id) || inst.type === "fan") return true;
  switch (inst.type) {
    case "cpu": return !!st.cpus[id];
    case "heatsink": return !!st.heatsinks[id];
    case "dimm": return !!st.dimms[id];
    case "drive_sff": return !!st.drives[id];
    case "riser": return !!st.risers[id];
    case "pcie_slot": return !!st.risers[inst.riser];
    case "raid_controller": return !!st.pcie[inst.installed_in];
    case "ocp_nic": case "nic_port": return !!st.ocp;
    case "psu": return !!st.psus[id];
    case "dac_cable": return !!st.cables[id];
    case "power_cord": return !!st.cables[id];
    default: return true;
  }
}
const ghosts = new Map();
function ghostFor(id) {
  if (ghosts.has(id)) return ghosts.get(id);
  const inst = instById.get(id);
  const b = inst.box;
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(b[3], 4) * MM, Math.max(b[4], 4) * MM, Math.max(b[5], 4) * MM), new THREE.MeshStandardMaterial({ color: 0x2fd0b5, transparent: true, opacity: 0.3, emissive: 0x2fd0b5, emissiveIntensity: 0.7, depthWrite: false }));
  m.position.set((b[0] + b[3] / 2) * MM, (b[1] + b[4] / 2) * MM, -(b[2] + b[5] / 2) * MM);
  m.userData.pick = { kind: "component", id };
  m.renderOrder = 5;
  server.add(m); ghosts.set(id, m);
  return m;
}
function targetsForPart(part) {
  if (!part) return [];
  const map = { cpu: "cpu", heatsink: "heatsink", dimm: "dimm", drive_sff: "drive_sff", riser: "riser", raid_controller: "pcie_slot", ocp_nic: "ocp_nic", psu: "psu" };
  const want = map[part.type];
  const st = buildState();
  const free = (i) => {
    switch (i.type) {
      case "cpu": return !st.cpus[i.id];
      case "heatsink": return !st.heatsinks[i.id];
      case "dimm": return !st.dimms[i.id];
      case "drive_sff": return !st.drives[i.id];
      case "riser": return !st.risers[i.id];
      case "pcie_slot": return !!st.risers[i.riser] && !st.pcie[i.id];
      case "ocp_nic": return !st.ocp;
      case "psu": return !st.psus[i.id];
      default: return false;
    }
  };
  return instances.filter((i) => i.type === want && free(i)).map((i) => i.id);
}
function refreshServer() {
  const st = buildState();
  for (const [id, g] of server.userData.parts) g.visible = partVisible(id, st);
  const lidClosed = ui.level === "L2" ? st.lid_closed : !ui.lidOpen;
  server.userData.lid.visible = lidClosed;
  const part = ui.level === "L2" && ui.selectedPart ? hardware.rebuild_kit.parts.find((p) => p.part_id === ui.selectedPart) : null;
  const want = new Set(targetsForPart(part));
  for (const id of want) ghostFor(id);
  for (const [id, m] of ghosts) m.visible = want.has(id) && !lidClosed;
  applyLeds();
  applyExplode();
}

function applyLeds() {
  const L = server.userData.leds;
  let state;
  if (ui.level === "L4" && ui.exercise) state = RT.symptomState({ pack, labId: ui.labId, unresolvedFaultIds: ui.exercise.snapshot().unresolved_fault_ids, powered: ui.powered });
  else {
    const on = ui.level === "L2" ? false : ui.level === "L3" ? !!(ui.exercise && ui.exercise.bringup && ui.exercise.bringup.powered) : true;
    state = RT.symptomState({ pack, labId: null, unresolvedFaultIds: [], powered: on });
    ui.powered = ui.level === "L4" ? ui.powered : on;
  }
  ui.leds = state;
  setLed(L.get("FRONT-PANEL:led-power"), state.leds.POWER);
  setLed(L.get("FRONT-PANEL:led-health"), state.leds.HEALTH);
  setLed(L.get("FRONT-PANEL:led-uid"), ui.level === "L4" && ui.exercise ? "blue" : "off");
  for (const id of ["PSU1", "PSU2"]) setLed(L.get(id + ":led"), state.leds[id] || "off");
  for (let b = 0; b < 12; b += 1) {
    const id = "BAY-" + String(b).padStart(2, "0");
    const c = state.leds[id];
    setLed(L.get(id + ":led"), c === "green" ? "green" : "off");
    setLed(L.get(id + ":led2"), c === "amber" ? "amber" : "off");
  }
  for (const id of ["NIC-P1", "NIC-P2"]) setLed(L.get(id + ":led"), state.leds[id] || "off");
  for (const inst of instances) {
    if (inst.type === "fan") setLed(L.get(inst.id + ":led"), state.leds[inst.id] || "off");
    if (inst.type === "dimm") setLed(L.get(inst.id + ":led"), state.leds[inst.id] || "off");
  }
}

const EXPLODE = { motherboard: [0, 0, 0], cpu: [0, 0.03, 0], heatsink: [0, 0.1, 0], dimm: [0, 0.055, 0], drive_sff: [0, 0, 0.1], fan: [0, 0.07, 0], psu: [0, 0, -0.12], riser: [0, 0.08, -0.04], pcie_slot: [0, 0.08, -0.04], raid_controller: [0, 0.12, -0.04], ocp_nic: [0, -0.0, -0.12], nic_port: [0, 0, -0.12], dac_cable: [0, 0, -0.2], power_cord: [0, 0, -0.2], bmc: [0, 0.04, 0], tpm: [0, 0.06, 0], cmos_battery: [0, 0.05, 0], m2_boot_module: [0, 0.05, 0], backplane: [0, 0.02, 0.05], front_panel: [0, 0, 0.05] };
let explodeT = 0;
function applyExplode() { /* target set; animation in loop */ }

/* ------------------------------------------------------------------ camera + animation */
let tween = null;
function flyTo(pos, target, ms = 700) {
  tween = { from: S.camera.position.clone(), fromT: S.controls.target.clone(), to: new THREE.Vector3(...pos), toT: new THREE.Vector3(...target), t0: performance.now(), ms };
}
function serverWorld(y = 0.05, z = -0.35) {
  // where the server will be once its slide finishes (the rack row sits at the world origin)
  return new THREE.Vector3(serverHome.x + labModel.chassis_mm.w * MM / 2, serverHome.y + y, serverHome.z + (ui.serverOut ? SLIDE : 0) + z);
}
function view(name) {
  const c = serverWorld(0.04, -0.38);
  const phone = stageEl.clientWidth < 1000;
  const k = phone ? 1.0 / Math.max(0.42, Math.min(1, stageEl.clientWidth / stageEl.clientHeight)) * 0.62 : 1;
  const far = Math.max(1, k);
  if (name === "rack") flyTo([0.7 * far, 1.25, 2.5 * far], [0, 1.05, 0]);
  else if (name === "server") flyTo(phone ? [c.x + 0.1, c.y + 0.95 * far, c.z + 0.72 * far] : [c.x + 0.14, c.y + 0.74, c.z + 0.6], [c.x, c.y, c.z - 0.04]);
  else if (name === "front") flyTo([c.x + 0.32, c.y + 0.22, c.z + 0.38 + (phone ? 1.25 : 0.85) * far], [c.x, c.y, c.z + 0.38]);
  else if (name === "rear") flyTo([0.22, c.y + 0.16, -1.72], [0, c.y, -0.8]);
}
function slide(out) { ui.serverOut = out; }
const clock = new THREE.Clock();
let exploded = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const goal = serverHome.z + (ui.serverOut ? SLIDE : 0);
  server.position.z += (goal - server.position.z) * Math.min(1, dt * 6);
  const ex = ui.exploded ? 1 : 0;
  exploded += (ex - exploded) * Math.min(1, dt * 5);
  for (const [, g] of server.userData.parts) {
    const off = EXPLODE[g.userData.inst.type] || [0, 0, 0];
    g.position.set(g.userData.base.x + off[0] * exploded, g.userData.base.y + off[1] * exploded, g.userData.base.z + off[2] * exploded);
    const rotor = g.getObjectByName("rotor");
    if (rotor) { const stopped = ui.leds && ui.leds.parts[g.userData.inst.id] === "stopped"; if (ui.powered && !stopped) rotor.rotation.z += dt * 40; }
  }
  if (tween) {
    const k = Math.min(1, (performance.now() - tween.t0) / tween.ms), e = k * k * (3 - 2 * k);
    S.camera.position.lerpVectors(tween.from, tween.to, e); S.controls.target.lerpVectors(tween.fromT, tween.toT, e);
    if (k >= 1) tween = null;
  }
  for (const [, m] of server.userData.leds) if (m.userData.blink) m.material.emissiveIntensity = (Math.sin(performance.now() / 300) > 0) ? 1.8 : 0.2;
  pulse();
  S.controls.update();
  const t0 = performance.now();
  S.renderer.render(S.scene, S.camera);
  // a slow device (or a software renderer) gets breathing room between frames so taps and the page stay responsive
  const cost = performance.now() - t0;
  if (cost > 40) setTimeout(() => requestAnimationFrame(frame), Math.min(1200, cost * 1.5));
  else requestAnimationFrame(frame);
}
let highlighted = null;
function highlight(id) {
  if (highlighted) for (const m of highlighted) { m.material = m.userData.origMat; }
  highlighted = null;
  if (!id) return;
  const g = server.userData.parts.get(id) || built.items.get(id);
  if (!g) return;
  highlighted = [];
  g.traverse((o) => { if (o.isMesh && !o.userData.isLed) { o.userData.origMat = o.material; o.material = o.material.clone(); o.material.emissive = new THREE.Color(0x2fd0b5); o.material.emissiveIntensity = 0.35; highlighted.push(o); } });
}
function pulse() { if (highlighted) { const v = 0.25 + 0.2 * Math.sin(performance.now() / 220); for (const m of highlighted) m.material.emissiveIntensity = v; } }

/* keep the subject in the part of the screen the panel leaves free: above the phone's bottom sheet, left of the
   desktop side panel */
function fitView() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  S.renderer.setSize(w, h);
  S.camera.aspect = w / h;
  if (w >= 1000) S.camera.setViewOffset(w, h, 217, 0, w, h);
  else if (!sheet.classList.contains("is-collapsed")) S.camera.setViewOffset(w, h, 0, Math.round(h * 0.2), w, h);
  else S.camera.clearViewOffset();
  S.camera.updateProjectionMatrix();
}
window.addEventListener("resize", fitView);

/* ------------------------------------------------------------------ picking */
const ray = new THREE.Raycaster();
function pickAt(cx, cy) {
  const r = S.renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(v, S.camera);
  const hits = ray.intersectObjects(S.scene.children, true);
  for (const h of hits) {
    let o = h.object, visible = true;
    for (let p = o; p; p = p.parent) if (p.visible === false) { visible = false; break; }
    if (!visible) continue;
    const pick = o.userData.pick;
    if (pick) return { ...pick, point: h.point };
  }
  return null;
}
let down = null;
S.renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
S.renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { down = null; return; }
  down = null;
  tip.hidden = true;
  onPick(pickAt(e.clientX, e.clientY));
});
const tip = $("#slTip");
let hoverAt = 0;
S.renderer.domElement.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || performance.now() - hoverAt < 60) return;
  hoverAt = performance.now();
  const p = pickAt(e.clientX, e.clientY);
  const label = p && pickLabel(p);
  if (!label || ui.level === "L1") { tip.hidden = true; return; }
  tip.hidden = false; tip.textContent = label; tip.style.left = e.clientX + 14 + "px"; tip.style.top = e.clientY + 12 + "px";
});
function pickLabel(p) {
  if (p.kind === "component") return (instById.get(p.id) || {}).label;
  if (p.kind === "rack") { const g = built.items.get(p.id); return g && g.userData.item.label; }
  if (p.kind === "server-lid") return "Server lid (tap to open)";
  return null;
}
/* walking: a tap on the floor walks there; WASD / arrow keys walk on a keyboard */
function walkTo(point) {
  const off = S.camera.position.clone().sub(S.controls.target);
  const t = new THREE.Vector3(Math.max(-3.5, Math.min(3.5, point.x)), 1.1, Math.max(-0.9, Math.min(3.8, point.z)));
  flyTo(t.clone().add(off.setLength(Math.min(off.length(), 1.8))).toArray(), t.toArray(), 900);
}
window.addEventListener("keydown", (e) => {
  if (/INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || "")) return;
  const k = e.key.toLowerCase();
  const map = { w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
  if (!map[k]) return;
  const f = S.controls.target.clone().sub(S.camera.position); f.y = 0; f.normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x);
  const step = f.multiplyScalar(map[k][1] * 0.25).add(r.multiplyScalar(map[k][0] * 0.25));
  S.camera.position.add(step); S.controls.target.add(step);
  e.preventDefault();
});

function onPick(p) {
  if (!p) return;
  if (p.kind === "floor") { walkTo(p.point); return; }
  if (p.kind === "server-lid") {
    if (!ui.serverOut) { slide(true); view("server"); }
    else { ui.lidOpen = true; refreshServer(); view("server"); }
    if (ui.level === "EXPLORE") showInfo({ kind: "rack", id: hardware.lab_server.rack_item_id });
    return;
  }
  if (p.kind === "rack" && p.id === hardware.lab_server.rack_item_id && ui.level !== "L1") {
    if (!ui.serverOut) { slide(true); view("server"); }
  }
  ui.picked = p;
  if (ui.level === "L1") return l1Pick(p);
  if (ui.level === "L2") return l2Pick(p);
  if (ui.level === "L4") return l4Pick(p);
  highlight(p.id);
  showInfo(p);
}

/* ------------------------------------------------------------------ panel helpers */
const body = $("#slBody");
const sheet = $("#slSheet");
$("#slGrip").addEventListener("click", () => { const c = sheet.classList.toggle("is-collapsed"); $("#slGrip").setAttribute("aria-expanded", String(!c)); fitView(); });
fitView();
function fb() { return ui.feedback ? `<div class="sl-feedback" data-kind="${esc(ui.feedback.kind)}" role="status">${esc(ui.feedback.text)}</div>` : ""; }
function objectivesHtml(snap) { return `<ul class="sl-list sl-objectives">${snap.objectives.map((o) => `<li class="${o.complete ? "done" : ""}">${esc(o.description)}</li>`).join("")}</ul>`; }
const BOUNDARY = `<p class="sl-boundary">Sandbox clone of ${esc(RT.SERVER_LAB_HOST_ASSET_ID)} in MDF rack 01, B1. SIMULATION only; no live control. Results are practice evidence, not a certification.</p>`;
let timerId = null;
function startTimer(targetMs) {
  const t = $("#slTimer"); t.hidden = false; ui.startedAt = performance.now();
  clearInterval(timerId);
  timerId = setInterval(() => {
    const s = Math.floor((performance.now() - ui.startedAt) / 1000);
    t.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") + (targetMs ? " / " + Math.round(targetMs / 60000) + ":00" : "");
  }, 500);
}
function stopTimer() { clearInterval(timerId); }

function showInfo(p) {
  if (ui.level !== "EXPLORE") return;
  let html = "";
  if (p.kind === "component") {
    const inst = instById.get(p.id); const def = hardware.component_types[inst.type] || hardware.component_types[{ nic_port: "ocp_nic", pcie_slot: "riser" }[inst.type]] || {};
    const dims = def.dims_mm || (def.dims_mm_by_form_factor || {})[labModel.form_factor];
    html = `<h2>${esc(inst.label)}</h2><p class="sl-muted">${esc(def.identify_hint || "")}</p>
      <dl class="sl-kv"><dt>Part</dt><dd>${esc(def.label || inst.type)}</dd>${dims ? `<dt>Size</dt><dd>${esc(Object.values(dims).join(" × "))} mm</dd>` : ""}${def.connector ? `<dt>Connector</dt><dd>${esc(def.connector)}</dd>` : ""}${def.interface ? `<dt>Interface</dt><dd>${esc(def.interface)}</dd>` : ""}${def.rating ? `<dt>Rating</dt><dd>${esc(def.rating)}</dd>` : ""}<dt>Hot-swap</dt><dd>${def.hot_swap ? "Yes" : "No: power off first"}</dd></dl>
      ${def.rules ? `<h3>Rules</h3><ul class="sl-list">${def.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      ${(def.failure_modes || []).length ? `<h3>How it fails</h3><ul class="sl-list">${def.failure_modes.map((f) => `<li><strong>${esc(f.label)}</strong>: ${esc([...f.symptoms.front_panel, ...f.symptoms.bmc_sel].slice(0, 3).join(" · ").replace(/\{(\w+)\}/g, (_, k) => (k === "slot" ? "the affected slot" : "…")))}</li>`).join("")}</ul>` : ""}`;
  } else if (p.kind === "rack") {
    const g = built.items.get(p.id); const it = g.userData.item; const t = hardware.rack_item_types[it.kind] || {};
    html = `<h2>${esc(t.label || it.kind)}</h2><p class="sl-muted">${esc(t.identify_hint || "")}</p><dl class="sl-kv">${it.u_start ? `<dt>Position</dt><dd>U${it.u_start}${it.u_size > 1 ? "–U" + (it.u_start + it.u_size - 1) : ""} (${it.u_size}U = ${(it.u_size * 44.45).toFixed(2)} mm)</dd>` : `<dt>Position</dt><dd>0U, ${esc(it.side)} (feed ${esc(it.feed)})</dd>`}${it.registry_asset_id ? `<dt>Asset</dt><dd>${esc(it.registry_asset_id)}</dd>` : ""}${it.note ? `<dt>Note</dt><dd>${esc(it.note)}</dd>` : ""}</dl>
      ${it.lab_server ? `<div class="sl-row"><button class="sl-btn sl-btn--primary" data-act="open-server">Slide out and open the lid</button></div>` : ""}`;
  }
  body.innerHTML = html + `<div class="sl-row"><button class="sl-btn" data-act="explore-home">Back</button></div>`;
}

/* ------------------------------------------------------------------ levels */
async function startLevel(level, labId) {
  ui.level = level; ui.feedback = null; ui.done = null; ui.selectedPart = null; ui.findings = new Set(); ui.fwOrder = []; ui.log = []; ui.replaceId = ""; ui.powered = true; ui.exploded = false;
  document.querySelectorAll("#slLevels button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.level === level)));
  highlight(null); stopTimer(); $("#slTimer").hidden = true;
  ui.exercise = null; ui.assessed = null; ui.labId = null;
  history.replaceState(null, "", "?level=" + level + (labId ? "&lab=" + labId : "") + (new URLSearchParams(location.search).get("fx") === "lite" ? "&fx=lite" : ""));
  if (level === "EXPLORE") { ui.lidOpen = false; slide(false); refreshServer(); view("rack"); return renderExplore(); }
  if (level === "L4" && !labId) { refreshServer(); slide(false); view("rack"); return renderL4Picker(); }
  body.innerHTML = `<p class="sl-muted">Loading the MDF sandbox (B1 electronics fabric)…</p>`;
  const [el, rb] = await Promise.all([electronics(), rubrics()]);
  labId = labId || RT.SERVER_LAB_LEVELS[level].lab_ids[0];
  ui.labId = labId;
  ui.exercise = level === "L4"
    ? RT.createServerTroubleshootScenario({ pack, labCatalog, labId, electronics: el })
    : new RT.ServerLabExercise({ hardware, labCatalog, electronics: el, labId });
  ui.assessed = AS.createAssessedExercise({ exercise: ui.exercise, rubrics: rb, actor_id: "learner", assessment_id: "ASSESS::" + labId + "::" + Date.now() });
  ui.assessed.start();
  const snap = ui.exercise.snapshot();
  startTimer(snap.time_target_ms || null);
  if (level === "L1") { ui.lidOpen = false; slide(false); view("rack"); }
  if (level === "L2") { ui.lidOpen = true; slide(true); view("server"); }
  if (level === "L3") { ui.lidOpen = false; slide(false); view("front"); }
  if (level === "L4") { ui.lidOpen = false; slide(false); view("front"); }
  refreshServer();
  render();
}
function exec(actionId, input = {}) {
  try {
    const r = ui.assessed.execute(actionId, input);
    return r;
  } catch (e) {
    ui.feedback = { kind: "bad", text: e.message };
    return { status: "error" };
  }
}
function render() {
  if (ui.done) return renderDone();
  if (ui.level === "L1") return renderL1();
  if (ui.level === "L2") return renderL2();
  if (ui.level === "L3") return renderL3();
  if (ui.level === "L4") return renderL4();
  return renderExplore();
}
function renderExplore() {
  body.innerHTML = `<h2>MDF rack 01 · B1</h2>
    <p class="sl-muted">A 42U, 19-inch rack (482.6 mm panels, 44.45 mm per U, 1200 mm deep) on the building's MDF data-rack anchor. Tap anything to learn what it is. Tap the floor to walk; drag to look around.</p>
    <div class="sl-row"><button class="sl-btn sl-btn--primary" data-act="open-server">Open the lab server (U18–U19)</button></div>
    <h3>Levels</h3>
    <div class="sl-grid">
      <button class="sl-btn" data-level-go="L1">L1 Identify<small>Name rack gear and server parts against the clock.</small></button>
      <button class="sl-btn" data-level-go="L2">L2 Rebuild<small>Rebuild a stripped 2U server by the rules.</small></button>
      <button class="sl-btn" data-level-go="L3">L3 Bring-up<small>POST, out-of-band management, RAID, links.</small></button>
      <button class="sl-btn" data-level-go="L4">L4 Troubleshoot<small>Injected hardware faults: find, fix, verify.</small></button>
    </div>${BOUNDARY}`;
}
function finish() {
  try { const r = ui.assessed.complete(); ui.done = r.assessment; stopTimer(); highlight(null); ui.replaceId = ""; }
  catch (e) { ui.feedback = { kind: "warn", text: e.message }; }
  render();
}
function renderDone() {
  const a = ui.done;
  const secs = Math.round((a.timing.elapsed_ms || 0) / 1000);
  body.innerHTML = `<h2>${esc(a.title || "Lab")} complete</h2>
    <dl class="sl-kv"><dt>Time</dt><dd>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}</dd>
    <dt>Actions</dt><dd>${a.action_metrics.total} (${a.action_metrics.success} right, ${a.action_metrics.incorrect} wrong, ${a.action_metrics.blocked} blocked)</dd>
    <dt>Hints</dt><dd>${a.hints.count}</dd><dt>Safety</dt><dd>${a.safety.violation_count ? a.safety.violation_count + " issue(s)" + (a.safety.critical_violation_count ? ", " + a.safety.critical_violation_count + " critical" : "") : "No issues"}</dd>
    <dt>Result</dt><dd>${esc(a.performance_signal.replace(/_/g, " "))}</dd><dt>Evidence</dt><dd>${esc(a.automated_evidence_signal.replace(/_/g, " "))} · ceiling: Demonstrated</dd>
    <dt>Record</dt><dd>${esc(a.provenance.assessment_sha256.slice(0, 16))}…</dd></dl>
    <p class="sl-muted">Automated scoring never awards Verified, Applied or Mentor; a qualified reviewer does. Exam objectives practised here are not a certification.</p>
    <div class="sl-row"><button class="sl-btn sl-btn--primary" data-act="next-level">Next</button><button class="sl-btn" data-act="restart">Run it again</button></div>`;
}

/* L1 */
function currentPrompt() { const snap = ui.exercise.snapshot(); return ui.exercise.prompts.find((p) => !snap.prompts_answered.includes(p.prompt_id)); }
function renderL1() {
  const snap = ui.exercise.snapshot();
  const p = currentPrompt();
  const n = snap.prompts_answered.length, total = ui.exercise.prompts.length;
  if (!p) { body.innerHTML = `<h2>All identified</h2>${objectivesHtml(snap)}<div class="sl-row"><button class="sl-btn sl-btn--primary" data-act="finish">Finish L1</button></div>`; return; }
  if (p.scope === "server" && (!ui.serverOut || !ui.lidOpen)) { slide(true); ui.lidOpen = true; refreshServer(); view("server"); }
  if (p.scope === "rack" && ui.serverOut) { slide(false); ui.lidOpen = false; refreshServer(); view("rack"); }
  if (p.mode === "name") highlight(p.target); else highlight(null);
  body.innerHTML = `<h2>L1 · Identify</h2><div class="sl-progress"><i style="width:${(100 * n) / total}%"></i></div>
    <p class="sl-muted">${n} of ${total} · ${p.scope === "rack" ? "rack equipment" : "inside the server"}</p>
    ${p.mode === "name" ? `<p><strong>What is the highlighted ${p.scope === "rack" ? "unit" : "part"}?</strong></p><div class="sl-grid">${p.choices.map((c) => `<button class="sl-btn" data-answer="${esc(c.id)}">${esc(c.label)}</button>`).join("")}</div>`
      : `<p><strong>Find and tap: ${esc(p.label)}</strong></p><p class="sl-muted">Tap it in the 3D view.</p>`}
    ${ui.promptFeedback ? `<div class="sl-feedback" data-kind="${ui.promptFeedback.kind}">${esc(ui.promptFeedback.text)}</div>` : ""}
    <div class="sl-row"><button class="sl-btn" data-act="hint">Hint</button></div>${BOUNDARY}`;
}
function l1Answer(answer) {
  const p = currentPrompt(); if (!p) return;
  const r = exec("identify", { prompt_id: p.prompt_id, answer });
  ui.promptFeedback = r.status === "success" ? { kind: "ok", text: r.feedback } : { kind: "bad", text: r.feedback || "Try again." };
  renderL1();
}
function l1Pick(p) { const pr = currentPrompt(); if (pr && pr.mode === "find" && (p.kind === "component" || p.kind === "rack")) l1Answer(p.id); }

/* L2 */
const CABLE_TO_LABEL = { "PDU-A:PWR-OUT-07": "PDU A (left), outlet 7", "PDU-B:PWR-OUT-07": "PDU B (right), outlet 7", "CORE1:SFP+-IN-03": "Core switch 1, SFP+ 3", "CORE2:SFP+-IN-03": "Core switch 2, SFP+ 3", "MGMT-SW:VLAN-MGMT": "Management switch (VLAN-MGMT)" };
function renderL2() {
  const snap = ui.exercise.snapshot(); const st = snap.build.state; const used = snap.build.used;
  const kit = hardware.rebuild_kit;
  const part = kit.parts.find((p) => p.part_id === ui.selectedPart);
  const targets = targetsForPart(part);
  const targetOptions = targets.map((id) => `<option value="${esc(id)}"${ui.pendingTarget === id ? " selected" : ""}>${esc(instById.get(id).label)}</option>`).join("");
  const extra = part && part.type === "cpu" ? `<p class="sl-muted">Line up the CPU:</p><div class="sl-row">${kit.cpu_orientations.map((o) => `<button class="sl-btn" data-install-opt='${esc(JSON.stringify({ orientation: o }))}'>${esc({ "pin1-aligned": "Triangle to the socket's corner marker", "rotated-90": "Turned 90°", "rotated-180": "Turned 180°" }[o])}</button>`).join("")}</div>`
    : part && part.type === "heatsink" ? `<p class="sl-muted">Tighten the four fasteners in this order:</p><div class="sl-row">${[[1, 2, 3, 4], [1, 3, 2, 4], [4, 3, 2, 1]].map((o) => `<button class="sl-btn" data-install-opt='${esc(JSON.stringify({ torque_order: o }))}'>${o.join(" → ")}</button>`).join("")}</div>`
    : part ? `<div class="sl-row"><button class="sl-btn sl-btn--primary" data-install-opt="{}">Install</button></div>` : "";
  body.innerHTML = `<h2>L2 · Rebuild the server</h2>
    <p class="sl-muted">Target: 2 CPUs, 256 GB (8 × 32 GB), 4 × 1.92 TB SAS SSD in bays 0–3, RAID controller in riser 1, OCP NIC, two PSUs on A/B feeds, both bond members on different core switches, management port on the management network.</p>
    ${objectivesHtml(snap)}
    <div class="sl-row"><button class="sl-btn${st.esd ? " is-selected" : ""}" data-act="esd">${st.esd ? "ESD strap on ✓" : "Clip on the ESD strap"}</button></div>
    <h3>Parts</h3><div class="sl-grid">${kit.parts.map((p) => { const left = p.qty - (used[p.part_id] || 0); return `<button class="sl-btn${ui.selectedPart === p.part_id ? " is-selected" : ""}" data-part="${esc(p.part_id)}" ${left <= 0 ? "disabled" : ""}>${esc(p.label)}<small>${left} left</small></button>`; }).join("")}</div>
    ${part ? `<h3>Place: ${esc(part.label)}</h3><p class="sl-muted">Tap a glowing slot in 3D, or pick one:</p><label class="sl-field"><span>Slot</span><select id="slTarget"><option value="">Choose a slot…</option>${targetOptions}</select></label>${extra}` : ""}
    ${fb()}
    <h3>Cables</h3>${kit.cables.map((c) => `<div class="sl-field"><span>${esc(c.label)}${st.cables[c.cable_id] ? " ✓" : ""}</span><div class="sl-row">${(c.to_options || ["BACKPLANE:A"]).map((to) => `<button class="sl-btn${st.cables[c.cable_id] === to ? " is-selected" : ""}" data-cable="${esc(c.cable_id)}" data-to="${esc(to)}" ${st.cables[c.cable_id] ? "disabled" : ""}>${esc(CABLE_TO_LABEL[to] || "Backplane connector A")}</button>`).join("")}</div></div>`).join("")}
    <div class="sl-row"><button class="sl-btn" data-act="check-memory">Check memory population</button><button class="sl-btn sl-btn--primary" data-act="close-lid">Close the lid</button>${snap.can_complete ? `<button class="sl-btn sl-btn--primary" data-act="finish">Finish L2</button>` : ""}</div>${BOUNDARY}`;
}
function l2Install(options) {
  const target = ui.pendingTarget || ($("#slTarget") && $("#slTarget").value);
  if (!ui.selectedPart) return;
  if (!target) { ui.feedback = { kind: "warn", text: "Choose a slot first (tap a glowing slot)." }; return renderL2(); }
  const r = exec("install", { part_id: ui.selectedPart, target_id: target, options });
  if (r.safety) ui.assessed.recordSafetyViolation({ ...r.safety, description: r.feedback, related_action_id: "install" });
  ui.feedback = { kind: r.status === "success" ? "ok" : "bad", text: r.feedback };
  if (r.status === "success") { ui.pendingTarget = null; const left = ui.exercise.snapshot().build.used[ui.selectedPart]; const part = hardware.rebuild_kit.parts.find((p) => p.part_id === ui.selectedPart); if (left >= part.qty) ui.selectedPart = null; }
  refreshServer(); renderL2();
}
function l2Pick(p) {
  if (p.kind !== "component" || !ui.selectedPart) { if (p.kind === "component") { ui.feedback = { kind: "warn", text: (instById.get(p.id) || {}).label + ": pick a part from the tray first." }; renderL2(); } return; }
  ui.pendingTarget = p.id;
  const part = hardware.rebuild_kit.parts.find((x) => x.part_id === ui.selectedPart);
  if (["cpu", "heatsink"].includes(part.type)) { ui.feedback = { kind: "warn", text: (instById.get(p.id) || {}).label + " selected. Choose how to fit it." }; return renderL2(); }
  l2Install({});
}

/* L3 */
function renderL3() {
  const snap = ui.exercise.snapshot(); const b = snap.bringup; const steps = new Set(b.steps);
  const req = hardware.raid_requirement;
  body.innerHTML = `<h2>L3 · Bring-up</h2>${objectivesHtml(snap)}
    <h3>1 · Power and POST</h3>
    ${b.powered ? `<pre class="sl-term">${b.post.map(esc).join("\n")}</pre>` : `<div class="sl-row"><button class="sl-btn sl-btn--primary" data-l3="power_on">Press the power button</button></div>`}
    ${b.powered && !steps.has("report_post") ? `<p>How many CPUs, and how much memory, did POST report?</p><div class="sl-row"><button class="sl-btn${ui.l3cpus === 1 ? " is-selected" : ""}" data-l3cpus="1">1 CPU</button><button class="sl-btn${ui.l3cpus === 2 ? " is-selected" : ""}" data-l3cpus="2">2 CPUs</button></div><label class="sl-field"><span>Memory (GB)</span><input id="slMem" inputmode="numeric" autocomplete="off"></label><div class="sl-row"><button class="sl-btn sl-btn--primary" data-l3="report_post">Submit</button></div>` : ""}
    ${steps.has("report_post") ? `<h3>2 · Out-of-band management</h3>${steps.has("bmc_login") ? `<pre class="sl-term">${b.sel.map(esc).join("\n")}</pre>` : `<p>How do you reach the management controller?</p><div class="sl-grid"><button class="sl-btn" data-l3="bmc_login" data-path="dedicated_mgmt_port">Dedicated management port, management network</button><button class="sl-btn" data-l3="bmc_login" data-path="production_nic">Through the production NIC bond</button></div>`}
      ${steps.has("bmc_login") && !steps.has("report_health") ? `<p>Is the server healthy?</p><div class="sl-row"><button class="sl-btn" data-l3="report_health" data-health="ok">Healthy</button><button class="sl-btn" data-l3="report_health" data-health="fault">Fault logged</button></div>` : ""}` : ""}
    ${steps.has("report_health") ? `<h3>3 · RAID</h3><p>${esc(req.requirement)} Drives: ${req.drives.count} × ${req.drives.capacity_tb} TB in bays 0–3.</p>
      ${steps.has("configure_raid") ? `<div class="sl-feedback" data-kind="ok">Virtual disk 0: ${esc(b.raid.level)}, ${b.raid.usable_tb} TB usable, optimal.</div>` : `<div class="sl-row">${["RAID0", "RAID1", "RAID5", "RAID6", "RAID10"].map((l) => `<button class="sl-btn${ui.l3level === l ? " is-selected" : ""}" data-l3level="${l}">${l.replace("RAID", "RAID ")}</button>`).join("")}</div><label class="sl-field"><span>Usable capacity (TB)</span><input id="slTb" inputmode="decimal" autocomplete="off"></label><div class="sl-row"><button class="sl-btn sl-btn--primary" data-l3="configure_raid">Create the virtual disk</button></div>`}` : ""}
    ${steps.has("configure_raid") ? `<h3>4 · Verify the links</h3><p class="sl-muted">Look at the NIC LEDs at the rear (Rear button) and the switch side.</p>${steps.has("verify_link") ? `<div class="sl-feedback" data-kind="ok">Both bond members up at 10 Gb/s.</div>` : `<label class="sl-field"><span>Links up</span><select id="slLinks"><option value="">Choose…</option><option>0</option><option>1</option><option>2</option></select></label><label class="sl-field"><span>Speed (Gb/s)</span><select id="slSpeed"><option value="">Choose…</option><option>1</option><option>10</option><option>25</option></select></label><div class="sl-row"><button class="sl-btn sl-btn--primary" data-l3="verify_link">Confirm</button></div>`}` : ""}
    ${fb()}${snap.can_complete ? `<div class="sl-row"><button class="sl-btn sl-btn--primary" data-act="finish">Finish L3</button></div>` : ""}${BOUNDARY}`;
}
function l3(action, el) {
  const input = {};
  if (action === "report_post") { input.cpus = ui.l3cpus; input.memory_gb = Number(($("#slMem") || {}).value); }
  if (action === "bmc_login") input.path = el.dataset.path;
  if (action === "report_health") input.health = el.dataset.health;
  if (action === "configure_raid") { input.level = ui.l3level; input.usable_tb = Number(String(($("#slTb") || {}).value).replace(",", ".")); }
  if (action === "verify_link") { input.links_up = Number($("#slLinks").value); input.speed_gbps = Number($("#slSpeed").value); }
  const r = exec(action, input);
  ui.feedback = { kind: r.status === "success" ? "ok" : r.status === "blocked" ? "warn" : "bad", text: r.feedback };
  if (action === "power_on") { refreshServer(); }
  if (action === "configure_raid" && r.status === "success") view("rear");
  renderL3();
}

/* L4 */
function renderL4Picker() {
  body.innerHTML = `<h2>L4 · Troubleshoot</h2><p class="sl-muted">A fault is injected into the sandbox clone of the virtualization host. Work it like a real call: evidence, diagnosis, safe fix, verification.</p>
    <div class="sl-grid">${pack.scenarios.map((s) => `<button class="sl-btn" data-scenario="${esc(s.source_lab_id)}">${esc(s.title)}<small>${esc(labCatalog.labs.find((l) => l.lab_id === s.source_lab_id).tier.toLowerCase())}</small></button>`).join("")}</div>${BOUNDARY}`;
}
const REPLACEABLE = () => instances.filter((i) => ["dimm", "drive_sff", "psu", "fan", "dac_cable", "cmos_battery", "ocp_nic", "raid_controller", "cpu"].includes(i.type) && partVisible(i.id, reference.state));
function renderL4() {
  const def = pack.scenarios.find((s) => s.source_lab_id === ui.labId);
  const snap = ui.exercise.snapshot();
  const done = new Set(snap.successful_action_ids);
  const byGroup = (g) => def.actions.filter((a) => a.ui && a.ui.group === g);
  const fixPerform = byGroup("fix").filter((a) => a.action_type === "perform");
  const fw = byGroup("fix").find((a) => a.fix_kind === "firmware_order");
  const comp = byGroup("fix").some((a) => a.expected_input && a.expected_input.component_id);
  body.innerHTML = `<h2>${esc(def.title)}</h2><div class="sl-ticket">${esc(def.learner_ticket)}</div><p class="sl-muted">${esc(def.learner_brief)}</p>
    ${objectivesHtml(snap)}
    <h3>Evidence</h3><div class="sl-grid">${byGroup("inspect").map((a) => `<button class="sl-btn${done.has(a.action_id) ? " is-selected" : ""}" data-l4="${esc(a.action_id)}">${esc(a.ui.label)}</button>`).join("")}</div>
    ${ui.log.length ? `<pre class="sl-term">${ui.log.map((l) => `<span class="${l.bad ? "bad" : ""}">${esc(l.text)}</span>`).join("\n")}</pre>` : ""}
    <h3>Diagnosis</h3><p class="sl-muted">Choose every fault you can prove.</p><div class="sl-grid">${pack.finding_choices.map((f) => `<button class="sl-btn${ui.findings.has(f) ? " is-selected" : ""}" aria-pressed="${ui.findings.has(f)}" data-finding="${esc(f)}">${esc(FAILURE_LABEL[f] || f)}</button>`).join("")}</div>
    <div class="sl-row"><button class="sl-btn sl-btn--primary" data-act="diagnose">Submit diagnosis</button></div>
    ${byGroup("power").length ? `<h3>Service window</h3><div class="sl-grid">${byGroup("power").map((a) => `<button class="sl-btn${done.has(a.action_id) ? " is-selected" : ""}" data-l4="${esc(a.action_id)}">${esc(a.ui.label)}</button>`).join("")}</div>` : ""}
    <h3>Fix</h3>
    ${comp ? `<p class="sl-muted">Tap the part in 3D (Slide out / Lid / Rear help), or pick it:</p><label class="sl-field"><span>Part</span><select id="slReplace"><option value="">Choose a part…</option>${REPLACEABLE().map((i) => `<option value="${esc(i.id)}"${ui.replaceId === i.id ? " selected" : ""}>${esc(i.label)}</option>`).join("")}</select></label><div class="sl-row"><button class="sl-btn sl-btn--primary" data-act="replace">Replace / reseat it</button></div>` : ""}
    ${fw ? `<p class="sl-muted">Tap the updates in the order you will apply them: ${ui.fwOrder.map(esc).join(" → ") || "(none yet)"}</p><div class="sl-row">${pack.firmware_components.map((c) => `<button class="sl-btn" data-fw="${esc(c)}" ${ui.fwOrder.includes(c) ? "disabled" : ""}>${esc({ BMC: "Management controller", BIOS: "BIOS", RAID: "RAID controller", NIC: "NIC" }[c])}</button>`).join("")}<button class="sl-btn" data-act="fw-clear">Clear</button></div><div class="sl-row"><button class="sl-btn sl-btn--primary" data-l4="${esc(fw.action_id)}" data-fwapply="1">${esc(fw.ui.label)}</button></div>` : ""}
    ${fixPerform.map((a) => `<div class="sl-row"><button class="sl-btn${done.has(a.action_id) ? " is-selected" : ""}" data-l4="${esc(a.action_id)}">${esc(a.ui.label)}</button></div>`).join("")}
    <h3>Verify</h3><div class="sl-row">${byGroup("verify").map((a) => `<button class="sl-btn" data-l4="${esc(a.action_id)}">${esc(a.ui.label)}</button>`).join("")}${snap.can_complete ? `<button class="sl-btn sl-btn--primary" data-act="finish">Close the ticket</button>` : ""}</div>
    ${fb()}${BOUNDARY}`;
}
function l4Run(actionId, input = {}) {
  const def = pack.scenarios.find((s) => s.source_lab_id === ui.labId);
  const action = def.actions.find((a) => a.action_id === actionId);
  const v = RT.serverSafetyCheck({ pack, labId: ui.labId, actionId, input, snapshot: ui.exercise.snapshot(), powered: ui.powered, hardware });
  if (v) ui.assessed.recordSafetyViolation(v);
  const r = exec(actionId, input);
  if (action.action_type === "inspect" && r.status === "success") {
    const o = action.observation || {};
    ui.log.push({ text: "▸ " + action.ui.label });
    for (const line of String(o.simulated_signal || "").split(" · ")) ui.log.push({ text: line, bad: /amber|fail|fault|error|lost|degraded|down|low|mismatch|throttl|critical|0 RPM|no signal/i.test(line) });
  }
  if (actionId.endsWith("-power-off") && r.status === "success") ui.powered = false;
  if (actionId.endsWith("-power-on") && r.status === "success") ui.powered = true;
  const o = (r.observation || {});
  const text = v ? v.description + (r.status === "success" ? "" : " " + (r.status === "blocked" ? "Blocked: something has to happen first." : "That did not fix it."))
    : r.status === "success" ? (o.simulated_change || o.validation || o.accepted_finding || o.simulated_signal ? (o.simulated_change || o.validation || ("Diagnosis accepted: " + o.accepted_finding) || "Done.") : "Done.")
    : r.status === "blocked" ? "Not yet: gather the evidence or prepare the service window first."
    : "That is not it. Check the evidence again.";
  ui.feedback = { kind: v ? (v.critical ? "bad" : "warn") : r.status === "success" ? "ok" : r.status === "blocked" ? "warn" : "bad", text: action.action_type === "inspect" && r.status === "success" && !v ? "Evidence added to the log." : text };
  refreshServer(); renderL4();
}
function l4Pick(p) {
  if (p.kind !== "component") return;
  const inst = instById.get(p.id);
  if (REPLACEABLE().some((i) => i.id === p.id)) { ui.replaceId = p.id; highlight(p.id); ui.feedback = { kind: "warn", text: inst.label + " selected. Replace it from the panel if the evidence points here." }; renderL4(); }
}
function l4Replace() {
  const id = ui.replaceId || ($("#slReplace") && $("#slReplace").value);
  if (!id) { ui.feedback = { kind: "warn", text: "Choose the part first." }; return renderL4(); }
  const def = pack.scenarios.find((s) => s.source_lab_id === ui.labId);
  const type = instById.get(id).type;
  const mitigations = def.actions.filter((a) => a.action_type === "mitigate" && a.expected_input && a.expected_input.component_id);
  const action = mitigations.find((a) => a.component_type === type) || mitigations[0];
  l4Run(action.action_id, { component_id: id });
}

/* ------------------------------------------------------------------ events */
document.addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.level) { startLevel(t.dataset.level); return; }
  if (t.dataset.levelGo) { startLevel(t.dataset.levelGo); return; }
  if (t.dataset.tool) {
    const k = t.dataset.tool;
    if (k === "walk") view(ui.serverOut ? "server" : "rack");
    if (k === "slide") { slide(!ui.serverOut); view(ui.serverOut ? "server" : "rack"); }
    if (k === "lid") { if (!ui.serverOut) slide(true); ui.lidOpen = !ui.lidOpen; refreshServer(); view("server"); }
    if (k === "explode") { ui.exploded = !ui.exploded; if (ui.exploded) { slide(true); ui.lidOpen = true; refreshServer(); view("server"); } t.setAttribute("aria-pressed", String(ui.exploded)); }
    if (k === "rear") view("rear");
    return;
  }
  if (t.dataset.answer) return l1Answer(t.dataset.answer);
  if (t.dataset.part) { ui.selectedPart = ui.selectedPart === t.dataset.part ? null : t.dataset.part; ui.pendingTarget = null; ui.feedback = null; refreshServer(); return renderL2(); }
  if (t.dataset.installOpt !== undefined) return l2Install(JSON.parse(t.dataset.installOpt || "{}"));
  if (t.dataset.cable) { const r = exec("connect", { cable_id: t.dataset.cable, to: t.dataset.to }); ui.feedback = { kind: r.status === "success" ? "ok" : "bad", text: r.feedback }; refreshServer(); return renderL2(); }
  if (t.dataset.l3cpus) { ui.l3cpus = Number(t.dataset.l3cpus); const m = $("#slMem") && $("#slMem").value; renderL3(); if (m) $("#slMem").value = m; return; }
  if (t.dataset.l3level) { ui.l3level = t.dataset.l3level; const tb = $("#slTb") && $("#slTb").value; renderL3(); if (tb) $("#slTb").value = tb; return; }
  if (t.dataset.l3) return l3(t.dataset.l3, t);
  if (t.dataset.scenario) return startLevel("L4", t.dataset.scenario);
  if (t.dataset.finding) { const f = t.dataset.finding; if (ui.findings.has(f)) ui.findings.delete(f); else ui.findings.add(f); return renderL4(); }
  if (t.dataset.fw) { ui.fwOrder.push(t.dataset.fw); return renderL4(); }
  if (t.dataset.l4) return l4Run(t.dataset.l4, t.dataset.fwapply ? { order: [...ui.fwOrder] } : {});
  switch (t.dataset.act) {
    case "open-server": slide(true); ui.lidOpen = true; refreshServer(); view("server"); if (ui.level === "EXPLORE") showInfo({ kind: "rack", id: hardware.lab_server.rack_item_id }); return;
    case "explore-home": highlight(null); return renderExplore();
    case "hint": { const p = currentPrompt(); if (!p) return; ui.assessed.requestHint({ hint_id: "HINT::" + p.prompt_id, level: "supported", reference: p.prompt_id }); ui.promptFeedback = { kind: "warn", text: "Hint: " + p.hint }; if (p.mode === "find") highlight(p.target); return renderL1(); }
    case "esd": { const r = exec("ground_esd", {}); ui.feedback = { kind: "ok", text: r.feedback }; return renderL2(); }
    case "check-memory": { const r = exec("validate_memory", {}); ui.feedback = { kind: r.status === "success" ? "ok" : "bad", text: r.feedback }; return renderL2(); }
    case "close-lid": { const r = exec("close_lid", {}); ui.feedback = { kind: r.status === "success" ? "ok" : "bad", text: r.feedback }; refreshServer(); return renderL2(); }
    case "finish": return finish();
    case "diagnose": { const def = pack.scenarios.find((s) => s.source_lab_id === ui.labId); return l4Run(def.actions.find((a) => a.ui && a.ui.group === "diagnose").action_id, { findings: [...ui.findings].sort() }); }
    case "replace": return l4Replace();
    case "fw-clear": ui.fwOrder = []; return renderL4();
    case "restart": return startLevel(ui.level, ui.level === "L4" ? ui.labId : undefined);
    case "next-level": { const order = ["L1", "L2", "L3", "L4"]; const i = order.indexOf(ui.level); return startLevel(order[Math.min(order.length - 1, i + 1)]); }
    default: return;
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "slTarget") { ui.pendingTarget = e.target.value || null; }
  if (e.target.id === "slReplace") { ui.replaceId = e.target.value; if (ui.replaceId) highlight(ui.replaceId); }
});

/* test and automation hooks: read-only views of state plus the screen point of a part, so a browser test taps the
   real 3D object instead of calling the runtime directly */
window.__serverLab = {
  ready: true,
  ui,
  screenOf(id) {
    const g = server.userData.parts.get(id) || ghosts.get(id) || built.items.get(id);
    if (!g) return null;
    const bb = new THREE.Box3().setFromObject(g); const c = bb.getCenter(new THREE.Vector3());
    if (built.items.get(id) && !server.userData.parts.get(id)) c.z = bb.max.z;
    c.project(S.camera);
    const r = S.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height };
  },
  /* look straight at one object (rack unit or part) */
  focus(id) {
    const g = server.userData.parts.get(id) || ghosts.get(id) || built.items.get(id);
    if (!g) return false;
    const c = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
    const far = stageEl.clientWidth < 1000 ? 1.4 : 1;
    const behind = c.z < -0.7;
    flyTo([c.x + 0.25, c.y + 0.3 * far, c.z + (behind ? -0.9 : 0.9) * far], [c.x, c.y, c.z], 300);
    return true;
  },
  /* a screen point where a tap really lands on this object (first visible sample of its bounding box) */
  pointFor(id) {
    const g = server.userData.parts.get(id) || ghosts.get(id) || built.items.get(id);
    if (!g) return null;
    const bb = new THREE.Box3().setFromObject(g);
    const r = S.renderer.domElement.getBoundingClientRect();
    const fr = [0.5, 0.25, 0.75, 0.1, 0.9];
    for (const fy of [1, 0.5, 0.9]) for (const fx of fr) for (const fz of fr) {
      const v = new THREE.Vector3(bb.min.x + (bb.max.x - bb.min.x) * fx, bb.min.y + (bb.max.y - bb.min.y) * fy, bb.min.z + (bb.max.z - bb.min.z) * fz).project(S.camera);
      const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const el = document.elementFromPoint(x, y);
      if (!el || el.tagName !== "CANVAS") continue;
      const p = pickAt(x, y);
      if (p && p.id === id) return { x, y };
    }
    return null;
  },
  settle() {
    if (tween) { S.camera.position.copy(tween.to); S.controls.target.copy(tween.toT); tween = null; }
    server.position.z = serverHome.z + (ui.serverOut ? SLIDE : 0);
    exploded = ui.exploded ? 1 : 0;
    for (const [, g] of server.userData.parts) { const off = EXPLODE[g.userData.inst.type] || [0, 0, 0]; g.position.set(g.userData.base.x + off[0] * exploded, g.userData.base.y + off[1] * exploded, g.userData.base.z + off[2] * exploded); }
    S.controls.update(); S.scene.updateMatrixWorld(true);
    return new Promise((res) => setTimeout(res, 300));
  },
  snapshot: () => (ui.exercise ? ui.exercise.snapshot() : null),
  assessment: () => (ui.assessed ? ui.assessed.assessment() : null),
  done: () => ui.done,
  view,
  bench(opts = {}) { if (opts.env === false) S.scene.environment = null; if (opts.shadow === false) S.renderer.shadowMap.enabled = false; if (opts.dpr) S.renderer.setPixelRatio(opts.dpr); const gl = S.renderer.getContext(); const t = performance.now(); for (let i = 0; i < 3; i += 1) { S.renderer.render(S.scene, S.camera); gl.finish(); } return (performance.now() - t) / 3; },
  info: () => ({ ...S.renderer.info.render, geometries: S.renderer.info.memory.geometries }),
};

refreshServer();
requestAnimationFrame(frame);
const q = new URLSearchParams(location.search);
const startAt = q.get("level");
if (startAt && ["L1", "L2", "L3", "L4"].includes(startAt)) startLevel(startAt, q.get("lab") || undefined); else startLevel("EXPLORE");
document.documentElement.dataset.serverLab = "ready";
