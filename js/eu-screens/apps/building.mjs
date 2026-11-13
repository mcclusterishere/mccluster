/* Building demo: the canonical generated GLBs (Core V2 chassis + the selected floor's detailed model, as the
   canonical viewer loads them), native electronics assemblies, and an explicit directory for unresolved targets. Tap a screen to frame
   it, then open it; its app's "Back to the building" returns here to the same floor, pose and mode.
   A viewer page, not geometry authority: existing authored assets retain their native transforms; no substitute geometry is generated. */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { whenOwner } from "../gate.mjs";
import { createScreenHooks, loadRegistry, consumeReturn, approachPose } from "../enter.mjs";
import { MODE_LABELS, normalizeMode, FLOORS } from "../contract.mjs";
import { openScreenSession } from "../sandbox-session.mjs";
import { WORKSTATION_FILE, prepareWorkstationRoot, fetchWorkstationCatalog, syncWorkstationVisibility } from "../workstation-layer.mjs";
import { monitorVisualState } from "../monitor-visual-state.mjs";
import { getPref, setPref, setMissionFaults, loadSession, resetSession } from "../state.mjs";

const FT = 0.3048;
const ELEV = { B1: -13.5, F1: 0, F2: 13.5, F3: 27, F4: 40.5, F5: 54, F6: 67.5, L7: 81 };
const GLB = { B1: "equity-uprise-basement-b1-core-v2.glb", F1: "equity-uprise-floor-01-core-v2.glb", F2: "equity-uprise-floor-02-core-v2.glb", F3: "equity-uprise-floor-03-core-v2.glb", F4: "equity-uprise-floor-04-core-v2.glb", F5: "equity-uprise-floor-05-core-v2.glb", F6: "equity-uprise-floor-06-core-v2.glb", L7: "equity-uprise-floor-07-core-v2.glb" };
const STAMP = "fc1986ec0f4c";
const DATA = "/equity-uprise-preview/";
const q = (p) => DATA + p + (STAMP.startsWith("__") ? "" : "?v=" + STAMP);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

await whenOwner();
const registry = await loadRegistry();
const root = document.getElementById("app");
root.innerHTML = `
  <div class="stage" data-stage></div>
  <div class="hud top">
    <div class="glass status-line"><span style="min-width:0"><b data-floor-title style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Equity Uprise</b><span data-count></span></span><span class="mode-chip" data-mode-chip></span></div>
    <div class="seg glass" role="group" aria-label="Mode" data-modes>${["WORKPLACE", "TRAINING", "MISSION"].map((m) => `<button type="button" data-setmode="${m}">${MODE_LABELS[m]}</button>`).join("")}</div>
  </div>
  <div class="hud bottom">
    <div class="glass actions" data-actions>
      <button class="btn" type="button" data-list>Screens on this floor</button>
      <button class="btn" type="button" data-mission hidden>Blind this floor</button>
      <button class="btn" type="button" data-overview>Overview</button>
    </div>
    <div class="glass floors" role="group" aria-label="Floor">${FLOORS.map((f) => `<button type="button" data-fl="${f}">${f}</button>`).join("")}</div>
  </div>
  <div class="tip" data-tip hidden></div>
  <aside class="sheet" data-sheet aria-live="polite"><div class="grab"></div><div data-sheet-body></div></aside>
  <div class="boot" data-boot><div class="box"><b>LOADING THE BUILDING</b><div data-boot-log>Core V2 chassis</div><div class="bar"><i></i></div></div></div>`;
const $ = (s) => root.querySelector(s);

/* ---- three */
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(1.75, devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;
$("[data-stage]").append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d10);
scene.fog = new THREE.Fog(0x0a0d10, 120, 320);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a1410, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dd, 1.6); sun.position.set(30, 60, 20); scene.add(sun);
const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.09; controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 1.2; controls.maxDistance = 140;
const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
renderer.clippingPlanes = [cut];
const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ color: 0x11161a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(36 * FT, -0.02, -36 * FT); scene.add(ground);

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); renderer.domElement.style.width = w + "px"; renderer.domElement.style.height = h + "px"; camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

/* ---- state */
let mode = normalizeMode(getPref("mode", "WORKPLACE"));
let floor = getPref("floor", "F1");
let selected = null;
const loader = new GLTFLoader();
const loaded = new Map();
const loadingFloors = new Map();
let core = null;
let corePromise = null;
let electronics = null;
let electronicsPromise = null;
let electronicsError = false;
const proxyRoot = new THREE.Group(); scene.add(proxyRoot);
const hooks = createScreenHooks({ THREE, camera, controls, registry, getMode: () => mode, getFloor: () => floor, src: "demo" });
const glowMat = new THREE.MeshBasicMaterial({ color: 0x5fe3c0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });

function loadGlb(url) { return new Promise((res, rej) => loader.load(url, res, undefined, rej)); }
async function ensureCore() {
  if (core) return core;
  if (corePromise) return corePromise;
  corePromise = (async () => {
  try { const g = await loadGlb(q("equity-uprise-building-core-v2.glb")); core = g.scene; core.rotation.x = -Math.PI / 2; scene.add(core); } catch (e) { core = new THREE.Group(); }
  return core;
  })();
  try { return await corePromise; } finally { corePromise = null; }
}
async function ensureFloor(lv) {
  if (loaded.has(lv)) return loaded.get(lv);
  if (loadingFloors.has(lv)) return loadingFloors.get(lv);
  const pending = (async () => {
  $("[data-boot-log]").textContent = (lv === "B1" ? "B1" : "Floor " + lv.slice(1)) + " detailed model";
  let r = null;
  try {
    const g = await loadGlb(q(GLB[lv]));
    r = g.scene; r.rotation.x = -Math.PI / 2; r.position.y = ELEV[lv] * FT; r.visible = false; r.updateMatrixWorld(true); scene.add(r);
    r.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    hooks.bindFloor(lv, r);
    /* the bound screen meshes glow so you can see what is tappable */
    for (const [id, meshes] of hooks.bound) for (const m of meshes) {
      if (m.userData.euGlow || m.userData.euPhysicalAssembly) continue;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material).clone();
      const nm = (m.userData && m.userData.name) || m.name;
      if (/::(screen|surface)$/.test(nm) || !/::/.test(nm)) { mat.emissive = new THREE.Color(0x3fd6ae); mat.emissiveIntensity = 0.55; }
      m.material = mat; m.userData.euGlow = true;
    }
  } catch (e) { r = null; }
  loaded.set(lv, r);
  return r;
  })();
  loadingFloors.set(lv, pending);
  try { return await pending; } finally { loadingFloors.delete(lv); }
}

/* Canonical electronics geometry is authored in absolute building feet (unlike
   the metre/local-floor detail GLBs). Preserve its modeled mounts and positions.
   Never use registry discovery hints to synthesize or relocate a monitor. */
async function ensureMonitorAssemblies() {
  if (electronics) return electronics;
  if (electronicsPromise) return electronicsPromise;
  electronicsPromise = (async () => {
  try {
    const [g, catalog] = await Promise.all([loadGlb(q(WORKSTATION_FILE)), fetchWorkstationCatalog()]);
    const r = prepareWorkstationRoot(g.scene, catalog);
    scene.add(r); r.updateMatrixWorld(true);
    for (const lv of FLOORS) hooks.bindFloor(lv, r);
    electronics = r; electronicsError = false;
  } catch (e) { electronicsError = true; }
  return electronics;
  })();
  try { return await electronicsPromise; } finally { electronicsPromise = null; }
}

function showMonitorAssemblies(lv) {
  syncWorkstationVisibility(electronics, { floorVisible: floor => floor === lv && !!loaded.get(lv)?.visible });
}

/* The face is the exact native base mesh, not the bezel, mount or host case.
   Color/emission conveys simulated stage; text remains in the device label. */
let visualRequest = 0;
const monitorStates = new Map();
function paintMonitorStates(fleet = null) {
  for (const screen of registry.screens.filter(s => s.asset_type === "monitor")) {
    const state = monitorVisualState(fleet, screen); monitorStates.set(screen.screen_id, state);
    for (const mesh of hooks.bound.get(screen.screen_id) || []) {
      if (!mesh.userData.euPhysicalAssembly || (mesh.userData.name || mesh.name) !== screen.asset_id) continue;
      if (!mesh.userData.euMonitorMaterial) {
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => m.clone()) : mesh.material.clone();
        mesh.userData.euMonitorMaterial = true;
      }
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        mat.color?.setHex(state.color); mat.emissive?.setHex(state.color);
        if ('emissiveIntensity' in mat) mat.emissiveIntensity = state.emission;
      }
      mesh.userData.euMonitorState = state.state;
    }
  }
  const statusLabel = root.querySelector("[data-monitor-state]");
  if (selected && statusLabel) statusLabel.textContent = "Sandbox: " + (monitorStates.get(selected.screen_id)?.label || "State unavailable");
  dirty = true;
}
async function refreshMonitorStates() {
  const request = ++visualRequest, requestedMode = mode;
  paintMonitorStates();
  try {
    const ss = await openScreenSession(requestedMode);
    if (request !== visualRequest || requestedMode !== mode) return;
    paintMonitorStates(ss.hardware);
  } catch { /* Retain explicitly unknown/dark faces, never a fabricated healthy desktop. */ }
}

/* frame the whole 72 ft plate from the south-east at about 50 degrees, wide enough for a portrait phone */
function overviewPose(lv) {
  const y = (ELEV[lv] + 3) * FT;
  const half = 15;                                   /* metres: half the plate plus a margin */
  const vt = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.min(110, Math.max(half / vt, half / (vt * camera.aspect)) * 1.05);
  const el = THREE.MathUtils.degToRad(52), az = THREE.MathUtils.degToRad(35);
  const c = [36 * FT, y, -36 * FT];
  return { pos: [c[0] + dist * Math.cos(el) * Math.sin(az), c[1] + dist * Math.sin(el), c[2] + dist * Math.cos(el) * Math.cos(az)], target: c };
}
let tween = null;
function flyTo(pose, ms = 700) {
  const from = { p: camera.position.clone(), t: controls.target.clone() };
  const to = { p: new THREE.Vector3(...pose.pos), t: new THREE.Vector3(...pose.target) };
  const t0 = performance.now();
  tween = (now) => { const k = Math.min(1, (now - t0) / ms), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; camera.position.lerpVectors(from.p, to.p, e); controls.target.lerpVectors(from.t, to.t, e); if (k >= 1) tween = null; };
}

let floorRequest = 0;
async function setFloor(lv, { pose = null, instant = false } = {}) {
  const request = ++floorRequest;
  floor = FLOORS.includes(lv) ? lv : "F1";
  setPref("floor", floor);
  const boot = $("[data-boot]"); boot.hidden = false;
  await ensureCore();
  if (request !== floorRequest) return;
  const idx = FLOORS.indexOf(floor);
  const det = await ensureFloor(floor);
  if (request !== floorRequest) return;
  for (const [l, r] of loaded) if (r) r.visible = l === floor;
  /* cutaway: clip everything above this floor's ceiling; hide the chassis' own copy of the floor when its detailed model is in */
  cut.constant = (ELEV[floor] + (floor === "L7" ? 30 : 9.5)) * FT;
  core.traverse((o) => { if (!o.isMesh) return; const m = /^L(\d)_/.exec(o.name || ""); o.visible = !(m && Number(m[1]) === idx && det); });
  await ensureMonitorAssemblies();
  if (request !== floorRequest) return;
  showMonitorAssemblies(floor);
  refreshMonitorStates();
  const fl = registry.floors[floor];
  $("[data-floor-title]").textContent = `${floor} · ${fl.title}`;
  $("[data-count]").textContent = `${hooks.targets().map(o => o.userData.euScreenId).filter((id, i, ids) => ids.indexOf(id) === i).length} modeled targets · ${fl.screen_count} directory entries${electronicsError ? " · monitor model unavailable" : ""}`;
  for (const b of root.querySelectorAll("[data-fl]")) b.setAttribute("aria-pressed", String(b.dataset.fl === floor));
  boot.hidden = true;
  dirty = true;
  const p = pose || overviewPose(floor);
  if (instant) { camera.position.set(...p.pos); controls.target.set(...p.target); controls.update(); } else flyTo(p);
  closeSheet();
}

function setMode(m) {
  mode = normalizeMode(m); setPref("mode", mode);
  document.documentElement.dataset.mode = mode;
  $("[data-mode-chip]").textContent = MODE_LABELS[mode];
  for (const b of root.querySelectorAll("[data-setmode]")) b.setAttribute("aria-pressed", String(b.dataset.setmode === mode));
  const mb = $("[data-mission]");
  mb.hidden = mode !== "MISSION";
  const blinded = loadSession("MISSION").faults.length > 0;
  mb.textContent = blinded ? "Clear mission" : "Blind this floor";
  $("[data-overview]").hidden = mode === "MISSION";
  refreshMonitorStates();
}

/* ---- sheet */
function closeSheet() { $("[data-sheet]").dataset.open = "false"; selected = null; }
function openSheet(html) { $("[data-sheet-body]").innerHTML = html; $("[data-sheet]").dataset.open = "true"; }
function isModeled(screen) {
  return (hooks.bound.get(screen.screen_id) || []).some(o => hooks.screenForObject(o));
}
function select(screen) {
  selected = screen;
  dirty = true;
  if (isModeled(screen)) flyTo(approachPose(screen), 650);
  const app = registry.apps[screen.app.id];
  const ok = app.modes.includes(mode);
  const record=(electronics?.userData.euWorkstationMeshes||[]).find(mesh=>mesh.userData.assetId===(screen.network_asset_id||screen.asset_id))?.userData.euDeviceRecord;
  const model=record?.manufacturer_model;
  const modelNote=model ? `<span class="muted" style="font-size:12px">${esc(model.display_name||model.model_id)} · exterior proposal. Sponsor unconfirmed; not vendor-approved or a live host. ${esc(record.port_scope||'Training connections only.')}</span>` : '';
  openSheet(`<div style="display:grid;gap:10px">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="pill">${esc(app.title)}</span><span class="mono muted" style="font-size:11px">${esc(screen.floor)} · ${esc(screen.room.label)}</span></div>
    <b style="font-size:18px">${esc(screen.title || screen.label)}</b>
    <span class="muted" style="font-size:13px">${esc(screen.host ? screen.host + " · " : "")}${esc(screen.kind.replace(/_/g, " "))} · ${isModeled(screen) ? "modeled device" : "directory only; physical model unavailable"}${screen.asset_type === "monitor" ? " · <span data-monitor-state>Sandbox: " + esc(monitorStates.get(screen.screen_id)?.label || "State unavailable") + "</span>" : ""}${ok ? "" : ` · opens in Workplace (not part of ${esc(MODE_LABELS[mode])})`}</span>
    ${modelNote}
    <button class="btn primary block" type="button" data-open="${esc(screen.screen_id)}" style="min-height:54px">Open device interface</button></div>`);
}
function listSheet() {
  const rooms = new Map();
  for (const s of registry.screens.filter((x) => x.floor === floor)) { if (!rooms.has(s.room.label)) rooms.set(s.room.label, []); rooms.get(s.room.label).push(s); }
  openSheet(`<h2 class="h">${esc(floor)} · screens</h2>${[...rooms].map(([r, list]) => `<h3 class="h" style="margin-top:12px;font-size:11px">${esc(r)}</h3><div class="list">${list.map((s) => `<button class="row" type="button" data-pick="${esc(s.screen_id)}"><span class="dot"></span><div class="t"><b>${esc(s.title || s.label)}</b><span>${esc(registry.apps[s.app.id].title)}${s.host ? " · " + esc(s.host) : ""} · ${isModeled(s) ? "modeled" : "directory only"}</span></div><span class="muted">›</span></button>`).join("")}</div>`).join("")}`);
}

root.addEventListener("click", (e) => {
  const fl = e.target.closest("[data-fl]"); if (fl) { setFloor(fl.dataset.fl); return; }
  const m = e.target.closest("[data-setmode]"); if (m) { setMode(m.dataset.setmode); if (selected) select(selected); return; }
  if (e.target.closest("[data-list]")) { listSheet(); return; }
  if (e.target.closest("[data-overview]")) { closeSheet(); flyTo(overviewPose(floor)); return; }
  if (e.target.closest("[data-mission]")) {
    const blinded = loadSession("MISSION").faults.length > 0;
    if (blinded) resetSession("MISSION"); else { const p = registry.mission_presets[floor]; if (p) setMissionFaults(p.faults, { presetId: p.preset_id }); }
    setMode("MISSION");
    return;
  }
  const pk = e.target.closest("[data-pick]"); if (pk) { select(registry.screens.find((s) => s.screen_id === pk.dataset.pick)); return; }
  const op = e.target.closest("[data-open]"); if (op) { hooks.open(op.dataset.open); }
});

/* tap vs drag on the canvas */
let down = null;
const cv = renderer.domElement;
cv.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
cv.addEventListener("pointerup", (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 8) return;
  const s = hooks.pickAt(e, cv);
  if (!s) { closeSheet(); return; }
  /* first tap frames the screen and shows what it is; tapping it again while that card is up opens it */
  if (selected && selected.screen_id === s.screen_id && $("[data-sheet]").dataset.open === "true") hooks.open(s); else select(s);
});
const tip = $("[data-tip]");
cv.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  const s = hooks.pickAt(e, cv);
  tip.hidden = !s; if (s) { tip.textContent = (s.title || s.label) + (s.asset_type === "monitor" ? " · " + (monitorStates.get(s.screen_id)?.label || "State unavailable") : ""); tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px"; }
  cv.style.cursor = s ? "pointer" : "grab";
});

/* ---- go */
/* render on demand: a frame when the camera moves, a tween runs or the selection pulses; nothing while idle */
let dirty = true;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
controls.addEventListener("change", () => { dirty = true; });
addEventListener("resize", () => { dirty = true; });
let lastPulse = 0;
function loop(t) {
  if (tween) { tween(t); dirty = true; }
  controls.update();
  if (!calm && t - lastPulse > 120) {
    lastPulse = t;
    const k = 0.6 + 0.3 * Math.sin(t / 420);
    glowMat.opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t / 380));
    for (const meshes of hooks.bound.values()) for (const m of meshes) if (!m.userData.euPhysicalAssembly && m.material && m.material.emissive) m.material.emissiveIntensity = (selected && m.userData.euScreenId === selected.screen_id) ? 1.4 : k;
    dirty = true;
  }
  if (dirty) { renderer.render(scene, camera); dirty = false; }
  requestAnimationFrame(loop);
}
setMode(mode);
const back = consumeReturn();
if (back) { if (back.mode) setMode(back.mode); await setFloor(back.floor || floor, { pose: back.pose, instant: true }); }
else await setFloor(new URLSearchParams(location.hash.slice(1)).get("floor") || floor, { instant: true });
document.documentElement.dataset.buildingReady = "1";
globalThis.__euBuilding = { hooks, registry, camera, controls, get floor() { return floor; }, get mode() { return mode; }, select, setFloor };
requestAnimationFrame(loop);

/* bfcache: coming back with the browser's back button keeps this page alive; re-read the pose and mode */
addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  const rp = consumeReturn();
  if (rp) { if (rp.mode) setMode(rp.mode); setFloor(rp.floor || floor, { pose: rp.pose, instant: true }); }
  else setMode(getPref("mode", mode));
});

// Same-tab navigation restores sessionStorage; focus also refreshes a cached building.
addEventListener("focus", () => refreshMonitorStates());
