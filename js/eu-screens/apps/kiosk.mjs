/* Kiosk app: Floor 1 reception check-in, the member check-in terminals on F2/F3, the building directory and the
   Development Passport kiosks. Visitors and hosts come from the workplace occupancy authority; the check-in
   system's health comes from the sandbox (the reception computer, its floor switch, DHCP and the directory/IdP).
   Synthetic only: nothing typed here leaves this tab, and the page asks for a made-up name. */

import { bootApp } from "../app-shell.mjs";
import { createNet } from "../net.mjs";
import { loadSession } from "../state.mjs";

const ORDER = ["F1", "F2", "F3", "F4", "F5", "F6", "L7", "B1"];
let net = null;

function systemOk(ctx) {
  const lv = ctx.screen ? ctx.screen.floor : "F1";
  const checks = [
    ["Floor network", net.up(`${lv}-NET-ACCESS-SW-01`) && net.uplinkUp(`${lv}-NET-ACCESS-SW-01`)],
    ["Directory / sign-in service", net.up("LOGIC-SVC-DIRECTORY-IDP")],
    ["Address service (DHCP)", net.up("LOGIC-SVC-DHCP")],
  ];
  if (lv === "F1") checks.push(["Reception computer f1-ws01", net.hostNet("F1-USER-WS-01").ok && !net.hostNet("F1-USER-WS-01").guest && !net.hostNet("F1-USER-WS-01").apipa]);
  return { ok: checks.every(([, v]) => v), checks };
}

function stateOf(ctx) { const s = ctx._ss.session; if (!s.kiosk) s.kiosk = { step: 0, floor: "F1", host: null, name: "", purpose: null, badges: [] }; return s.kiosk; }
function save(ctx) { ctx._ss.persist(); }

function render(ctx) {
  const { view, esc, registry } = ctx;
  const k = stateOf(ctx);
  const sys = systemOk(ctx);
  if (ctx.tab === "checkin") {
    if (!sys.ok) {
      view.innerHTML = `<div class="card" style="text-align:center;padding:26px 16px"><div class="pill err" style="margin-bottom:12px">offline</div><h2 style="margin:0 0 6px;font-size:22px">Check-in is offline</h2><p class="muted" style="margin:0 0 16px">Please see the front desk. Staff will sign you in on the paper visitor log.</p>
        <div class="list" style="text-align:left">${sys.checks.map(([n, v]) => `<div class="row"><span class="dot ${v ? "" : "err"}"></span><div class="t"><b>${esc(n)}</b><span>${v ? "ok" : "not responding"}</span></div><span></span></div>`).join("")}</div>
        ${ctx.mode === "TRAINING" ? '<p class="muted" style="font-size:12px;margin:14px 0 0">Training: this is the symptom. Find the cause at a console (the F1 IDF rack, or the NOC in B1).</p>' : ""}</div>`;
      return;
    }
    const steps = ["Who are you visiting?", "Your name", "What brings you in?", "You're checked in"];
    let body = "";
    if (k.step === 0) {
      const fl = registry.floors[k.floor];
      body = `<div class="seg" role="group" aria-label="Floor">${ORDER.map((f) => `<button type="button" data-fl="${f}" aria-pressed="${f === k.floor}">${f}</button>`).join("")}</div>
        <p class="muted" style="margin:12px 0 8px;font-size:13px">${esc(fl.title)}</p>
        <div class="list">${fl.people.map((p, i) => `<button class="row" type="button" data-host="${i}"><span class="dot" style="background:var(--info);color:var(--info)"></span><div class="t"><b>${esc(p.name)}</b><span>${esc(p.station)}</span></div><span class="muted">›</span></button>`).join("") || '<div class="empty">No recurring staff on this level.</div>'}</div>`;
    } else if (k.step === 1) {
      body = `<form data-name class="grid"><div class="field"><label for="vname">First name (use a made-up name: this is a sandbox)</label><input id="vname" name="vname" maxlength="24" autocomplete="off" value="${esc(k.name)}" required></div><button class="btn primary block" type="submit">Continue</button></form>`;
    } else if (k.step === 2) {
      body = `<div class="grid two">${["Meeting", "Interview", "Cohort session", "Delivery", "Tour", "Support"].map((p) => `<button class="btn" type="button" data-purpose="${p}" style="min-height:64px">${p}</button>`).join("")}</div>`;
    } else {
      const b = k.badges[k.badges.length - 1];
      body = `<div class="card" style="text-align:center;padding:22px;border-color:color-mix(in srgb,var(--ok) 40%,transparent)">
          <div class="mono muted" style="font-size:11px;letter-spacing:.16em">VISITOR</div>
          <div style="font-size:30px;font-weight:800;margin:6px 0">${esc(b.name)}</div>
          <div class="muted">visiting <b style="color:var(--text)">${esc(b.host)}</b></div>
          <div class="mono" style="margin-top:14px;font-size:22px;letter-spacing:.12em;color:var(--accent)">${esc(b.code)}</div>
          <div class="muted mono" style="font-size:11px;margin-top:4px">${esc(b.floor)} · ${esc(b.purpose)} · ${esc(b.time)}</div></div>
        <div class="card" style="margin-top:12px"><b>Directions</b><p class="muted" style="margin:6px 0 0">${b.floor === "F1" ? "Your host is on this floor. Wait in the Orientation Lounge; they have been notified." : b.floor === "B1" ? "Take Stair A or the passenger elevator down to B1. B1 staff will meet you at the landing." : `Take the passenger elevator to ${b.floor}. Your host has been notified.`}</p></div>
        <button class="btn block" style="margin-top:12px" data-again>Check in someone else</button>`;
    }
    view.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:12px">${steps.map((_, i) => `<span style="flex:1;height:4px;border-radius:4px;background:${i <= k.step ? "var(--accent)" : "var(--panel-3)"}"></span>`).join("")}</div>
      <h2 style="margin:0 0 12px;font-size:22px">${steps[k.step]}</h2>${body}
      ${k.step > 0 && k.step < 3 ? '<button class="btn block" style="margin-top:12px" data-prev>Back</button>' : ""}`;
    const form = view.querySelector("[data-name]");
    if (form) form.addEventListener("submit", (e) => { e.preventDefault(); const v = form.vname.value.trim().replace(/[^\p{L} .'-]/gu, "").slice(0, 24); if (!v) return; k.name = v; k.step = 2; save(ctx); render(ctx); });
    return;
  }
  if (ctx.tab === "directory") {
    view.innerHTML = `<h2 class="h">Building directory</h2><div class="list">${["L7", "F6", "F5", "F4", "F3", "F2", "F1", "B1"].map((f) => { const fl = registry.floors[f]; return `<button class="row" type="button" data-dir="${f}"><b class="mono" style="color:var(--accent);width:28px">${f}</b><div class="t"><b>${esc(fl.title)}</b><span>${fl.people.length} staff · ${fl.screen_count} screens</span></div><span class="muted">›</span></button>`; }).join("")}</div>
      ${ctx._dir ? `<h2 class="h" style="margin-top:16px">${ctx._dir} · ${esc(registry.floors[ctx._dir].title)}</h2><div class="list">${[...new Map(registry.screens.filter((s) => s.floor === ctx._dir).map((s) => [s.room.label, s])).values()].map((s) => `<div class="row"><span></span><div class="t"><b>${esc(s.room.label)}</b><span>${registry.screens.filter((x) => x.floor === ctx._dir && x.room.label === s.room.label).length} screen(s)</span></div><span></span></div>`).join("")}</div>` : ""}
      <p class="muted" style="font-size:12px;margin-top:12px">Floor 1 is the building's only public entrance. B1 is a staffed technical floor and open to staff wayfinding.</p>`;
    return;
  }
  /* passport: the floors whose training tickets this session has resolved */
  const resolved = new Set((loadSession("TRAINING").resolved || []).map((r) => r.split("@")[1]));
  const allSessions = ["B1", "F1", "F2", "F3", "F4", "F5", "F6", "L7"];
  view.innerHTML = `<h2 class="h">Development Passport</h2>
    <div class="card"><p style="margin:0 0 4px"><b>Stamps</b> are earned by resolving a floor's training ticket at its consoles, in Training mode.</p><p class="muted" style="margin:0;font-size:12px">A stamp is demonstrated practice in the sandbox, not a verified credential. Human review stays the gate for anything more.</p></div>
    <div class="grid two wide-4" style="margin-top:12px">${allSessions.map((f) => { const seed = registry.training_seeds[f]; const got = resolved.has(f); return `<div class="card" style="text-align:center;${got ? "border-color:color-mix(in srgb,var(--ok) 50%,transparent)" : ""}"><div class="mono" style="font-size:24px;font-weight:800;color:${got ? "var(--ok)" : "var(--dim)"}">${f}</div><div style="font-size:12px;margin-top:4px">${esc(seed ? seed.ticket.title : "—")}</div><div class="pill ${got ? "ok" : ""}" style="margin-top:8px">${got ? "stamped" : "open"}</div></div>`; }).join("")}</div>`;
}

bootApp({
  id: "kiosk", title: "Check-in",
  defaultTab: "checkin",
  tabs: [{ id: "checkin", label: "Check in", icon: "user" }, { id: "directory", label: "Directory", icon: "map" }, { id: "passport", label: "Passport", icon: "ticket" }],
  async render(ctx) {
    if (!ctx._ss) {
      ctx._ss = await ctx.session(); net = createNet(ctx._ss);
      const v = ctx.screen ? ctx.screen.app.variant : "checkin";
      if (!new URLSearchParams(location.search).get("tab") && (v === "directory" || v === "passport") && ctx.tab === "checkin") { ctx.setTab(v); return; }
      const k = stateOf(ctx); if (ctx.screen && k.step === 0) k.floor = ctx.screen.floor === "F1" ? "F1" : ctx.screen.floor;
      ctx.view.addEventListener("click", (e) => {
        const k = stateOf(ctx);
        const fl = e.target.closest("[data-fl]"); if (fl) { k.floor = fl.dataset.fl; save(ctx); render(ctx); return; }
        const h = e.target.closest("[data-host]"); if (h) { k.host = ctx.registry.floors[k.floor].people[Number(h.dataset.host)].name; k.step = 1; save(ctx); render(ctx); setTimeout(() => { const i = ctx.view.querySelector("#vname"); if (i) i.focus(); }, 30); return; }
        const p = e.target.closest("[data-purpose]"); if (p) { k.purpose = p.dataset.purpose; k.step = 3; const n = k.badges.length + 1; k.badges.push({ name: k.name, host: k.host, floor: k.floor, purpose: k.purpose, code: "V-" + String(1000 + ((n * 7919) % 9000)), time: new Date().toTimeString().slice(0, 5) }); save(ctx); render(ctx); return; }
        if (e.target.closest("[data-prev]")) { k.step = Math.max(0, k.step - 1); save(ctx); render(ctx); return; }
        if (e.target.closest("[data-again]")) { Object.assign(k, { step: 0, host: null, name: "", purpose: null }); save(ctx); render(ctx); return; }
        const d = e.target.closest("[data-dir]"); if (d) { ctx._dir = d.dataset.dir; render(ctx); }
      });
    }
    render(ctx);
  },
});
