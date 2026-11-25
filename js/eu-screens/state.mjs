/* Equity Uprise screens — per-tab session state, kept apart by mode.

   One sessionStorage record per mode (eu-screens:v1:session:<MODE>). Modes never share a record, so a mission
   outage can never show up in WORKPLACE, and resetting one mode leaves the others alone. WORKPLACE is normal
   operations: its record never holds faults, whatever a caller tries to save.

   Storage can be missing or throw (private windows, blocked site data): every access is wrapped, and the apps
   run on an in-memory copy when it is. Nothing here is durable or shared: the sandbox is a training clone. */

import { MODES, normalizeMode } from "./contract.mjs";

const PREFIX = "eu-screens:v1:";
const memory = new Map();

function store() {
  try { const s = globalThis.sessionStorage; if (s) { const k = PREFIX + "probe"; s.setItem(k, "1"); s.removeItem(k); return s; } } catch (e) { /* fall through */ }
  return null;
}
function getRaw(key) {
  const s = store();
  try { if (s) return s.getItem(PREFIX + key); } catch (e) { /* memory */ }
  return memory.has(key) ? memory.get(key) : null;
}
function setRaw(key, value) {
  memory.set(key, value);
  const s = store();
  try { if (s) s.setItem(PREFIX + key, value); } catch (e) { /* memory only */ }
}
function delRaw(key) {
  memory.delete(key);
  const s = store();
  try { if (s) s.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
}

export function blankSession(mode) {
  return { v: 1, mode: normalizeMode(mode), faults: [], seq: 0, seeded: null, history: [], evidence: [], resolved: [], kiosk: null, studio: null };
}

function sanitize(mode, s) {
  const out = { ...blankSession(mode), ...(s && typeof s === "object" ? s : {}) };
  out.mode = normalizeMode(mode);
  if (out.mode === "WORKPLACE") { out.faults = []; out.seeded = null; delete out.hardware; }
  if (!Array.isArray(out.faults)) out.faults = [];
  out.faults = out.faults.filter((f) => f && typeof f.fault_id === "string" && Array.isArray(f.target_selectors)).slice(0, 64);
  if (!Array.isArray(out.history)) out.history = [];
  out.history = out.history.filter((h) => typeof h === "string").slice(-200);
  if (!Array.isArray(out.evidence)) out.evidence = [];
  out.evidence = out.evidence.slice(-100);
  if (!Array.isArray(out.resolved)) out.resolved = [];
  return out;
}

export function loadSession(mode) {
  const m = normalizeMode(mode);
  try { return sanitize(m, JSON.parse(getRaw("session:" + m) || "null")); } catch (e) { return blankSession(m); }
}

export function saveSession(mode, session) {
  const m = normalizeMode(mode);
  const clean = sanitize(m, session);
  setRaw("session:" + m, JSON.stringify(clean));
  return clean;
}

export function resetSession(mode) { delRaw("session:" + normalizeMode(mode)); return blankSession(mode); }
export function resetAllSessions() { for (const m of MODES) delRaw("session:" + m); }

/* the PRIM3 game (or the demo) hands the mission's sandbox outages in here; only MISSION ever reads them */
export function setMissionFaults(faults, { presetId = null } = {}) {
  const s = loadSession("MISSION");
  s.faults = (faults || []).map((f, i) => ({
    id: "M" + (i + 1), fault_id: String(f.fault_id), target_selectors: [...(f.target_selectors || [])], source: "mission", preset: presetId,
  }));
  s.seq = s.faults.length;
  return saveSession("MISSION", s);
}

/* history.back() bookkeeping: the building marks the entry it left from, the app checks it before going back */
export function markEntry(token) { setRaw("entry", JSON.stringify({ token: String(token || ""), at: 1 })); }
export function readEntry() { try { return JSON.parse(getRaw("entry") || "null"); } catch (e) { return null; } }
export function clearEntry() { delRaw("entry"); }

/* the pose the building should restore after a back navigation (bfcache may already have it; this covers reloads) */
export function setPendingReturn(rp) { setRaw("pending-return", JSON.stringify(rp)); }
export function takePendingReturn() {
  let v = null;
  try { v = JSON.parse(getRaw("pending-return") || "null"); } catch (e) { v = null; }
  delRaw("pending-return");
  return v;
}

/* small per-viewer preference (last mode chosen in the demo); never authority */
export function getPref(key, fallback) { try { const v = getRaw("pref:" + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
export function setPref(key, value) { setRaw("pref:" + key, JSON.stringify(value)); }
