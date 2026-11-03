/* Equity Uprise screens — the integration hook for the 3D building (the canonical viewer, the PRIM3 game, the
   demo). Raycast hit -> screen id -> open its full-page app, and come back to the exact pose.

   The host passes its own THREE (no second three.js is imported here), its scene/camera/controls, and how to read
   the current floor and mode. Minimal use:

     import { createScreenHooks, loadRegistry, consumeReturn } from "/js/eu-screens/enter.mjs";
     const registry = await loadRegistry();
     const hooks = createScreenHooks({ THREE, camera, controls, registry, getMode: () => mode, src: "viewer" });
     hooks.bindFloor("F2", floorRoot);          // after a floor GLB loads: tags its "<ID>::screen" meshes
     hooks.addProxies("F2", scene);             // tappable panels for screens with no mesh of their own
     canvas.addEventListener("pointerup", (e) => { const s = hooks.pickAt(e, canvas); if (s) hooks.open(s); });
     const back = consumeReturn(); if (back) hooks.restore(back);   // on load and on pageshow

   The PRIM3 game can skip THREE entirely: openScreenById(registry, id, { pose, floor, mode, src: "game" }).

   Leaving: the building's own history entry is rewritten to carry #eu-return=<token> before navigating, so the
   browser's back button, a reload, or the app's "Back to the building" all land on the same pose. */

import { buildEnterUrl, buildReturnUrl, parseReturnHash, validateReturnPoint, normalizeMode, approachPose, encodeReturn, ftToWorld, RETURN_HASH_KEY } from "./contract.mjs";
import { markEntry, takePendingReturn, getPref } from "./state.mjs";

const STAMP = "__STAMP__";
export async function loadRegistry(url = new URL("../../screens/data/screen-registry-v1.json", import.meta.url).href) {
  const r = await fetch(url + (STAMP.startsWith("__") ? "" : "?v=" + STAMP), { cache: "no-cache" });
  if (!r.ok) throw new Error("screen registry " + r.status);
  return r.json();
}

export function screenById(registry, id) { return (registry.screens || []).find((s) => s.screen_id === id) || null; }

/* "<ASSET-ID>::screen" (or "<ASSET-ID>" / "<ASSET-ID>::part") mesh name -> screen */
export function screenForName(registry, name) {
  if (!name) return null;
  const base = String(name).split("::")[0];
  return (registry.screens || []).find((s) => s.mesh_node_prefix === base || s.asset_id === base) || null;
}

/* the URL root the site is served from (works on matthew.mccluster.org and under a sub-path preview) */
function siteRoot() {
  const u = new URL("../../", import.meta.url);
  return u.pathname;
}

function currentHref(loc = globalThis.location) {
  const u = new URL(loc.href);
  u.hash = "";
  return u.pathname + u.search;
}

/* open a screen's app; pose is { pos:[x,y,z], target:[x,y,z] } in three.js world metres */
export function openScreenById(registry, screenId, { pose = null, floor = null, room = null, mode, src = "viewer", href = null, navigate = true, loc = globalThis.location, hist = globalThis.history } = {}) {
  const screen = screenById(registry, screenId);
  if (!screen) throw new Error("unknown screen " + screenId);
  const m = normalizeMode(mode || getPref("mode", "WORKPLACE"));
  const rp = validateReturnPoint({
    href: href || (loc ? currentHref(loc) : "/screens/building.html"),
    floor: floor || screen.floor, room: room || screen.room.zone_id, mode: m,
    pose: pose || approachPose(screen), screen: screen.screen_id, src,
  });
  const token = encodeReturn(rp);
  const url = buildEnterUrl({ appPage: screen.app.page, screenId: screen.screen_id, mode: m, returnPoint: rp, base: siteRoot() });
  if (navigate && loc) {
    /* make the building's own history entry restorable before leaving it */
    try { if (hist && hist.replaceState) hist.replaceState(hist.state, "", rp.href + "#" + RETURN_HASH_KEY + "=" + token); } catch (e) { /* non-fatal */ }
    markEntry(token);
    loc.assign(url);
  }
  return { url, returnPoint: rp, token };
}

/* the return point the building should restore now, if any; strips the hash so a reload does not repeat it */
export function consumeReturn({ loc = globalThis.location, hist = globalThis.history } = {}) {
  const pending = takePendingReturn();
  const fromHash = loc ? parseReturnHash(loc.hash) : null;
  if (fromHash && hist && hist.replaceState) {
    try { hist.replaceState(hist.state, "", loc.pathname + loc.search); } catch (e) { /* keep */ }
  }
  return validateReturnPoint(pending) || fromHash || null;
}

export function createScreenHooks({ THREE, camera, controls = null, registry, getMode = () => "WORKPLACE", getFloor = () => null, src = "viewer", onOpen = null }) {
  if (!THREE) throw new Error("createScreenHooks needs the host's THREE");
  const bound = new Map();   /* screen id -> [meshes] */
  const proxies = new Map(); /* screen id -> proxy mesh */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function tag(obj, screen) { obj.userData.euScreenId = screen.screen_id; }

  function bindFloor(level, root) {
    const screens = (registry.screens || []).filter((s) => s.floor === level);
    const byPrefix = new Map(screens.map((s) => [s.mesh_node_prefix, s]));
    const prefixes = [...byPrefix.keys()].sort((a, b) => b.length - a.length);
    root.traverse((o) => {
      if (!o.isMesh) return;
      /* GLTFLoader keeps the authored name in userData.name and strips ":" from o.name; accept both */
      const raw = (o.userData && o.userData.name) || o.name || "";
      let base, part;
      if (raw.includes("::")) [base, part] = raw.split("::");
      else { base = prefixes.find((p) => raw === p || raw.startsWith(p)); part = base && raw.length > base.length ? raw.slice(base.length) : undefined; }
      const s = base && byPrefix.get(base);
      if (!s) return;
      if (part && !/^(screen|surface|bezel|body|case|cap|face-a|face-b|top|frame)$/.test(part)) return;
      tag(o, s);
      if (!bound.has(s.screen_id)) bound.set(s.screen_id, []);
      bound.get(s.screen_id).push(o);
    });
    return [...bound.keys()].filter((id) => screens.some((s) => s.screen_id === id));
  }

  /* glowing panels for screens without their own mesh (monitors, rack consoles, B1 MDF units) */
  function addProxies(level, parent, { all = false, material = null } = {}) {
    const made = [];
    for (const s of (registry.screens || []).filter((x) => x.floor === level)) {
      if (!all && bound.has(s.screen_id)) continue;
      if (proxies.has(s.screen_id)) { made.push(proxies.get(s.screen_id)); continue; }
      const w = Math.min(Math.max(s.position.width_ft || (s.kind === "workstation_monitor" ? 1.9 : s.kind.includes("wall") || s.kind === "command_display" || s.kind === "noc_wall" ? 6 : 1.6), 0.8), 9) * 0.3048;
      const h = (s.kind === "workstation_monitor" ? 1.1 : s.kind === "kiosk" || s.kind === "checkin_terminal" || s.kind === "portal_terminal" ? 1.5 : s.kind === "rack_console" || s.kind === "bmc_console" ? 0.55 : 2.6) * 0.3048;
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = material ? material.clone() : new THREE.MeshBasicMaterial({ color: 0x5fe3c0, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      const [x, y, z] = ftToWorld([s.position.x, s.position.y, s.position.z_abs]);
      m.position.set(x, y, z);
      const n = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] }[s.position.facing] || [0, -1];
      m.lookAt(x + n[0], y, z - n[1]);
      /* nudge off the wall so the panel never z-fights the surface it marks */
      m.position.x += n[0] * 0.03; m.position.z -= n[1] * 0.03;
      m.name = "EU-SCREEN-PROXY::" + s.screen_id;
      m.renderOrder = 5;
      tag(m, s);
      parent.add(m);
      proxies.set(s.screen_id, m);
      made.push(m);
    }
    return made;
  }

  function screenForObject(obj) {
    for (let o = obj; o; o = o.parent) if (o.userData && o.userData.euScreenId) return screenById(registry, o.userData.euScreenId);
    return null;
  }

  function targets() { return [...[...bound.values()].flat(), ...proxies.values()].filter((o) => o.visible !== false); }

  function pickNdc(x, y) {
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(targets(), false);
    return hits.length ? screenForObject(hits[0].object) : null;
  }
  function pickAt(evt, el) {
    const r = el.getBoundingClientRect();
    return pickNdc(((evt.clientX - r.left) / r.width) * 2 - 1, -((evt.clientY - r.top) / r.height) * 2 + 1);
  }

  function currentPose() {
    const t = controls && controls.target ? controls.target : new THREE.Vector3().copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()));
    return { pos: [camera.position.x, camera.position.y, camera.position.z], target: [t.x, t.y, t.z] };
  }

  function open(screen, extra = {}) {
    const s = typeof screen === "string" ? screenById(registry, screen) : screen;
    if (!s) return null;
    if (onOpen) onOpen(s);
    return openScreenById(registry, s.screen_id, { pose: currentPose(), floor: getFloor() || s.floor, room: s.room.zone_id, mode: getMode(), src, ...extra });
  }

  function restore(rp) {
    if (!rp || !rp.pose) return false;
    camera.position.set(...rp.pose.pos);
    if (controls && controls.target) { controls.target.set(...rp.pose.target); if (controls.update) controls.update(); }
    else camera.lookAt(...rp.pose.target);
    return true;
  }

  return { bindFloor, addProxies, screenForObject, pickNdc, pickAt, open, restore, currentPose, bound, proxies, targets };
}

export { approachPose, ftToWorld };
