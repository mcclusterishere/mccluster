/* Equity Uprise screens — the chrome every screen app shares: owner gate, enter-URL parsing, mode, the persistent
   "Back to the building" control, the bottom navigation, the boot overlay and the lazily mounted sandbox. */

import { whenOwner } from "./gate.mjs";
import { parseEnterUrl, buildReturnUrl, MODE_LABELS } from "./contract.mjs";
import { readEntry, clearEntry, setPendingReturn } from "./state.mjs";
import { loadScreenRegistry, openScreenSession } from "./sandbox-session.mjs";

export const ICONS = {
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 9l3 3-3 3M12 15h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  ticket: '<path d="M4 7a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  devices: '<rect x="3" y="4" width="18" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="18" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/><circle cx="7" cy="17" r="1.2" fill="currentColor"/>',
  book: '<path d="M5 4h9a4 4 0 014 4v12H9a4 4 0 01-4-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 8h5M9 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="4" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="4" y="13" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="13" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  cam: '<rect x="3" y="7" width="13" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 11l5-3v8l-5-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="4" cy="6" r="1.3" fill="currentColor"/><circle cx="4" cy="12" r="1.3" fill="currentColor"/><circle cx="4" cy="18" r="1.3" fill="currentColor"/>',
  user: '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  map: '<path d="M9 4l-5 2v14l5-2 6 2 5-2V4l-5 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 4v14M15 6v14" stroke="currentColor" stroke-width="2"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  search: '<circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  plane: '<path d="M12 3v7l8 4v2l-8-2v4l3 2v1l-3-1-3 1v-1l3-2v-4l-8 2v-2l8-4V3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M3 14l9 5 9-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function siteRoot() { return new URL("../../", import.meta.url).pathname; }

/* go back to the building: the real history entry when we came from it, otherwise its URL with the pose */
export function backToBuilding(enter, { hist = globalThis.history, loc = globalThis.location } = {}) {
  const rp = enter.returnPoint;
  const entry = readEntry();
  const fallback = rp ? buildReturnUrl(rp) : siteRoot() + "screens/building.html";
  if (rp && entry && entry.token === enter.returnToken && hist.length > 1) {
    setPendingReturn(rp);
    clearEntry();
    hist.back();
    setTimeout(() => loc.assign(fallback), 900);
    return "history";
  }
  loc.assign(fallback);
  return "url";
}

/* app: { id, title, tabs:[{id,label,icon}], defaultTab, needsSandbox, render(ctx) } */
export async function bootApp(app) {
  await whenOwner();
  const enter = parseEnterUrl(globalThis.location.search);
  const registry = await loadScreenRegistry().catch(() => null);
  const screen = registry && enter.screenId ? registry.screens.find((s) => s.screen_id === enter.screenId) || null : null;
  const appModes = registry && registry.apps[app.id] ? registry.apps[app.id].modes : ["WORKPLACE"];
  const mode = appModes.includes(enter.mode) ? enter.mode : "WORKPLACE";
  const modeNote = enter.mode !== mode ? `This screen is not part of ${MODE_LABELS[enter.mode]} mode, so it shows normal operations.` : null;
  document.documentElement.dataset.mode = mode;

  const root = document.getElementById("app");
  const sub = screen ? `${screen.floor} · ${screen.room.label} · ${screen.asset_id}${screen.host ? " → " + screen.host : " · device binding unverified"}` : "Equity Uprise · building systems";
  root.className = "app";
  root.innerHTML = `
    <header class="topbar">
      <button class="back" type="button" data-back aria-label="Back to the building">${icon("back")}<span>Building</span></button>
      <div class="titles"><b>${esc(screen ? screen.title || screen.label : app.title)}</b><span>${esc(sub)}</span></div>
      <span class="mode-chip" title="Mode">${esc(MODE_LABELS[mode])}</span>
    </header>
    <main class="main" id="main">${modeNote ? `<p class="notice">${esc(modeNote)}</p>` : ""}<div data-view></div></main>
    ${app.tabs && app.tabs.length > 1 ? `<nav class="bottomnav" aria-label="${esc(app.title)}">${app.tabs.map((t) => `<button type="button" data-tab="${t.id}">${icon(t.icon)}<span>${esc(t.label)}</span></button>`).join("")}</nav>` : ""}
    <div class="boot" data-boot hidden><div class="box"><b>MOUNTING SANDBOX CLONE</b><div data-boot-log>digital twin · asset registry · connection graph</div><div class="bar"><i></i></div></div></div>`;
  if (screen?.network_asset_id && registry.screens.some(s => s.network_asset_id === screen.network_asset_id && (s.asset_type === "monitor" || s.kind === "bmc_console"))) {
    const equipment = document.createElement("a");
    const target = new URL(siteRoot() + "screens/terminal.html", globalThis.location.href);
    for (const key of ["screen", "mode", "return"]) { const value = new URLSearchParams(globalThis.location.search).get(key); if (value) target.searchParams.set(key, value); }
    target.searchParams.set("tab", "hardware");
    equipment.href = target.href; equipment.className = "btn"; equipment.textContent = "Inspect computer · " + (screen.host || screen.network_asset_id);
    equipment.addEventListener("click", e => { e.preventDefault(); globalThis.location.replace(target.href); });
    root.querySelector(".main").prepend(equipment);
  }
  if (screen?.asset_id && screen.asset_type !== "monitor" && screen.kind !== "bmc_console") {
    const equipment = document.createElement("a");
    const target = new URL(siteRoot() + "screens/terminal.html", globalThis.location.href);
    for (const key of ["screen", "mode", "return"]) { const value = new URLSearchParams(globalThis.location.search).get(key); if (value) target.searchParams.set(key, value); }
    target.searchParams.set("tab", "object"); target.searchParams.set("object", screen.asset_id);
    equipment.href = target.href; equipment.className = "btn"; equipment.textContent = "Inspect object · " + screen.asset_id;
    equipment.addEventListener("click", e => { e.preventDefault(); globalThis.location.replace(target.href); });
    root.querySelector(".main").prepend(equipment);
  }
  root.querySelector("[data-back]").addEventListener("click", () => backToBuilding(enter));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && e.altKey) backToBuilding(enter); });

  let sessionPromise = null;
  const boot = root.querySelector("[data-boot]");
  const session = () => {
    if (!sessionPromise) {
      boot.hidden = false;
      sessionPromise = openScreenSession(mode).then((ss) => {
        if (mode === "TRAINING" && screen) ss.seedTraining(screen.floor);
        boot.hidden = true;
        return ss;
      }).catch((e) => {
        boot.querySelector("[data-boot-log]").textContent = "The sandbox could not load: " + (e.message || e);
        sessionPromise = null;
        throw e;
      });
    }
    return sessionPromise;
  };

  const view = root.querySelector("[data-view]");
  const ctx = { app, enter, registry, screen, mode, root, view, session, esc, icon, back: () => backToBuilding(enter), tab: null, setTab: null };

  /* bottom navigation swaps views in place (replaceState, no extra history), so Back still means the building */
  const tabs = app.tabs || [];
  async function setTab(id, { push = false } = {}) {
    const t = tabs.find((x) => x.id === id) || tabs[0];
    ctx.tab = t ? t.id : null;
    for (const b of root.querySelectorAll("[data-tab]")) b.setAttribute("aria-current", b.dataset.tab === ctx.tab ? "page" : "false");
    const u = new URL(globalThis.location.href);
    if (ctx.tab && ctx.tab !== (app.defaultTab || tabs[0].id)) u.searchParams.set("tab", ctx.tab); else u.searchParams.delete("tab");
    globalThis.history.replaceState(globalThis.history.state, "", u.pathname + u.search + u.hash);
    try {
      if (app.id !== "terminal" && screen?.asset_type === "monitor") {
        const ss = await session();
        if (ss.hardware?.byId.has(screen.network_asset_id)) {
          const machine = ss.hardware.monitorStatus(screen.network_asset_id, screen.asset_id);
          if (!machine.desktop_ready || !machine.display) {
            view.innerHTML = `<p class="notice">Computer unavailable: ${esc(machine.reason || machine.stage)}. Use Inspect computer to check the physical equipment and complete its boot.</p>`;
            return;
          }
        } else {
          view.innerHTML = `<p class="notice">Monitor host binding is unresolved. Inspect equipment before opening this display.</p>`;
          return;
        }
      }
      await app.render(ctx);
    } catch (e) { console.error(e); view.innerHTML = `<p class="notice err">${esc(e.message || e)}</p>`; }
  }
  ctx.setTab = setTab;
  for (const b of root.querySelectorAll("[data-tab]")) b.addEventListener("click", () => setTab(b.dataset.tab));
  const initial = new URLSearchParams(globalThis.location.search).get("tab");
  await setTab(tabs.some((t) => t.id === initial) ? initial : app.defaultTab || (tabs[0] && tabs[0].id));
  document.documentElement.dataset.appReady = "1";
  return ctx;
}

/* link to another screen app WITHOUT adding history (keeps Back = building) */
export function replaceToApp(ctx, page, params = {}) {
  const u = new URL(siteRoot() + page, globalThis.location.href);
  const cur = new URLSearchParams(globalThis.location.search);
  for (const k of ["screen", "mode", "return"]) if (cur.get(k)) u.searchParams.set(k, cur.get(k));
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  globalThis.location.replace(u.href);
}
