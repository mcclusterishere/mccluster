/* Equity Uprise screens — the integration hook for the 3D building (the canonical viewer, the PRIM3 game, the
   demo). Raycast hit -> screen id -> open its full-page app, and come back to the exact pose.

   The host passes its own THREE (no second three.js is imported here), its scene/camera/controls, and how to read
   the current floor and mode. Minimal use:

     import { createScreenHooks, loadRegistry, consumeReturn } from "/js/eu-screens/enter.mjs";
     const registry = await loadRegistry();
     const hooks = createScreenHooks({ THREE, camera, controls, registry, getMode: () => mode, src: "viewer" });
     hooks.bindFloor("F2", floorRoot);          // after a floor GLB loads: tags its "<ID>::screen" meshes
     hooks.addProxies("F2", scene);             // compatibility no-op: never invent physical screens
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
  const exact = (registry.screens || []).filter(s => s.asset_id === base);
  if (exact.length === 1) return exact[0];
  const matches = (registry.screens || []).filter(s => s.mesh_node_prefix === base);
  return matches.length === 1 ? matches[0] : null;
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
    const byPrefix = new Map(screens.map(s => [s.mesh_node_prefix, screenForName({ screens }, s.mesh_node_prefix)]).filter(([,s]) => s));
    const prefixes = [...new Set([...byPrefix.keys(), ...screens.map(s => s.asset_id)])].sort((a, b) => b.length - a.length);
    root.traverse((o) => {
      if (!o.isMesh) return;
      /* GLTFLoader keeps the authored name in userData.name and strips ":" from o.name; accept both */
      const raw = (o.userData && o.userData.name) || o.name || "";
      let base, part;
      if (raw.includes("::")) {
        const tokens = raw.split("::"); base = tokens[0];
        /* Canonical componentized devices use ID::PART::BEZEL. Nested
           power outlets are independent equipment, never display hit targets. */
        part = tokens[1] === "PART" && tokens.length === 3 ? tokens[2].toLowerCase() : tokens.slice(1).join("::");
      }
      else { base = prefixes.find((p) => raw === p || raw.startsWith(p)); part = base && raw.length > base.length ? raw.slice(base.length) : undefined; }
      const s = base && screenForName({ screens }, base);
      if (!s) return;
      if (part && !/^(screen|surface|bezel|body|case|cap|face-a|face-b|top|frame)$/.test(part)) return;
      tag(o, s);
      if (!bound.has(s.screen_id)) bound.set(s.screen_id, []);
      if (!bound.get(s.screen_id).includes(o)) bound.get(s.screen_id).push(o);
    });
    return [...bound.keys()].filter((id) => screens.some((s) => s.screen_id === id));
  }

  /* Registry positions are discovery hints, not physical mount authority. Never invent
     glowing panels for headless equipment or unresolved monitor placements. Equipment
     remains accessible through the labelled directory and its existing inspector. */
  function addProxies() { return []; }

  function screenForObject(obj) {
    let selected = null;
    for (let o = obj; o; o = o.parent) {
      if (o.visible === false) return null;
      if (!selected && o.userData?.euScreenId) selected = screenById(registry, o.userData.euScreenId);
    }
    return selected;
  }

  function targets() { return [...[...bound.values()].flat(), ...proxies.values()].filter(o => screenForObject(o)); }

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
