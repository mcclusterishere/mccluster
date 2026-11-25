/* Equity Uprise screens — the enter/return contract. Pure functions, no DOM, no storage: the viewer, the PRIM3 game,
   the screen apps and the tests all speak through these.

   Entering a screen:   screens/<app>.html?screen=<screen_id>&mode=<MODE>&return=<return token>
   Coming back:         <return.href>#eu-return=<return token>      (or plain history.back(), see enter.mjs)

   A return token is base64url(JSON) of a return point:
     { v: 1, href: "/screens/building.html", floor: "F2", room: "zone_02", mode: "TRAINING",
       pose: { pos: [x, y, z], target: [x, y, z] },    three.js world metres (registry frame.three_js_world)
       screen: "SCR-F2-DISPLAY-PERSPECTIVES", src: "demo" | "viewer" | "game" }
   href is same-origin only: a path that starts with one "/" and carries no scheme, host, backslash or control
   character. Anything else is refused, so a crafted link cannot bounce a visitor off-site. */

export const CONTRACT_VERSION = 1;
export const MODES = Object.freeze(["WORKPLACE", "TRAINING", "MISSION"]);
export const MODE_LABELS = Object.freeze({ WORKPLACE: "Workplace", TRAINING: "Training", MISSION: "PRIM3 Mission" });
export const FLOORS = Object.freeze(["B1", "F1", "F2", "F3", "F4", "F5", "F6", "L7"]);
export const RETURN_HASH_KEY = "eu-return";
const SOURCES = new Set(["demo", "viewer", "game"]);
const MAX_TOKEN = 2048;

function b64urlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(token) {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((token.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function normalizeMode(mode) {
  const m = String(mode || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (m === "PRIMMISSION" || m === "PRIM3MISSION" || m === "MISSION") return "MISSION";
  return MODES.includes(m) ? m : "WORKPLACE";
}

/* same-origin path or null */
export function safeHref(href) {
  if (typeof href !== "string" || href.length === 0 || href.length > 512) return null;
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(href)) return null;
  if (/^\/[^/?#]*:/.test(href)) return null;
  return href;
}

const finite3 = (a) => Array.isArray(a) && a.length === 3 && a.every((v) => typeof v === "number" && Number.isFinite(v));
const round3 = (a) => a.map((v) => Math.round(v * 1000) / 1000);

/* returns a clean return point or null; never throws */
export function validateReturnPoint(rp) {
  if (!rp || typeof rp !== "object") return null;
  const href = safeHref(rp.href);
  if (!href) return null;
  const out = { v: CONTRACT_VERSION, href };
  out.floor = FLOORS.includes(rp.floor) ? rp.floor : null;
  out.room = typeof rp.room === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(rp.room) ? rp.room : null;
  out.mode = normalizeMode(rp.mode);
  out.pose = rp.pose && finite3(rp.pose.pos) && finite3(rp.pose.target) ? { pos: round3(rp.pose.pos), target: round3(rp.pose.target) } : null;
  out.screen = typeof rp.screen === "string" && /^SCR-[A-Z0-9:_-]{1,96}$/.test(rp.screen) ? rp.screen : null;
  out.src = SOURCES.has(rp.src) ? rp.src : "viewer";
  return out;
}

export function encodeReturn(rp) {
  const clean = validateReturnPoint(rp);
  if (!clean) throw new Error("invalid return point");
  return b64urlEncode(JSON.stringify(clean));
}

export function decodeReturn(token) {
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try { return validateReturnPoint(JSON.parse(b64urlDecode(token))); } catch (e) { return null; }
}

/* the URL that opens a screen's app; appPage is the registry's app.page ("screens/terminal.html") */
export function buildEnterUrl({ appPage, screenId, mode, returnPoint, base = "/" }) {
  if (typeof appPage !== "string" || !/^screens\/[a-z-]+\.html$/.test(appPage)) throw new Error("invalid app page");
  if (typeof screenId !== "string" || !/^SCR-[A-Z0-9:_-]{1,96}$/.test(screenId)) throw new Error("invalid screen id");
  const root = base.endsWith("/") ? base : base + "/";
  const qs = new URLSearchParams();
  qs.set("screen", screenId);
  qs.set("mode", normalizeMode(mode || (returnPoint && returnPoint.mode)));
  if (returnPoint) qs.set("return", encodeReturn({ ...returnPoint, screen: returnPoint.screen || screenId }));
  return root + appPage + "?" + qs.toString();
}

/* what an app page reads from its own URL */
export function parseEnterUrl(search) {
  const qs = new URLSearchParams(search || "");
  const screen = qs.get("screen");
  return {
    screenId: screen && /^SCR-[A-Z0-9:_-]{1,96}$/.test(screen) ? screen : null,
    mode: normalizeMode(qs.get("mode")),
    returnToken: qs.get("return") || null,
    returnPoint: decodeReturn(qs.get("return") || ""),
  };
}

/* the URL "Back to the building" navigates to when history.back() is not the right move */
export function buildReturnUrl(rp) {
  const clean = validateReturnPoint(rp);
  if (!clean) return null;
  const [path] = clean.href.split("#");
  return path + "#" + RETURN_HASH_KEY + "=" + encodeReturn(clean);
}

/* read a return point back out of a location hash ("#eu-return=..."); returns null when there is none */
export function parseReturnHash(hash) {
  const h = String(hash || "").replace(/^#/, "");
  for (const part of h.split("&")) {
    const [k, v] = part.split("=");
    if (k === RETURN_HASH_KEY && v) return decodeReturn(v);
  }
  return null;
}

/* authority frame (feet) <-> three.js world (metres), per the registry's frame block */
export const FT = 0.3048;
export function ftToWorld([x, y, zAbs]) { return [x * FT, zAbs * FT, -y * FT]; }
export function worldToFt([wx, wy, wz]) { return [wx / FT, -wz / FT, wy / FT]; }

/* a screen's standing pose in front of it, in world metres: what the viewer/game frames on return */
export function approachPose(screen) {
  const e = screen.approach.eye_ft, l = screen.approach.look_ft, el = screen.position.elevation_ft;
  return { pos: round3(ftToWorld([e[0], e[1], el + e[2]])), target: round3(ftToWorld([l[0], l[1], el + l[2]])) };
}
