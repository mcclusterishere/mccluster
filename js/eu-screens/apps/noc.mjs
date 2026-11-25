/* Operations app: the B1 NOC walls (digital-twin dashboard, incident/route status, underground occupancy, route
   console) and the F6 command screens. Every number is read from the sandbox graph through net.mjs. */

import { bootApp, replaceToApp } from "../app-shell.mjs";
import { createNet, SERVICE_UNITS } from "../net.mjs";

const FLOORS = ["L7", "F6", "F5", "F4", "F3", "F2", "F1", "B1"];
let net = null;

function floorHealth(lv) {
  const swId = `${lv === "L7" ? "F6" : lv}-NET-ACCESS-SW-01`;
  const sw = net.deviceStatus(swId);
  const ups = net.assets.has(`${lv}-ICT-RACK-UPS-01`) ? net.deviceStatus(`${lv}-ICT-RACK-UPS-01`) : null;
  const of = (t) => net.ofType(t).filter((x) => net.levelOf(x) === lv).map((x) => net.deviceStatus(x));
  const aps = of("wireless_ap"), ws = of("workstation"), phones = of("ip_phone");
  const cams = net.cameras().filter((x) => net.levelOf(x) === lv).map((c) => net.cameraFeed(c));
  const okd = (d) => d.availability !== "unavailable" && d.reachable;
  const uplink = lv === "B1" ? true : net.uplinkUp(swId);
  const parts = [sw, ups, ...aps, ...ws, ...phones].filter(Boolean);
  const down = parts.filter((d) => !okd(d)).length + cams.filter((c) => c.state === "no-signal").length;
  const degraded = parts.filter((d) => d.availability === "degraded").length + (uplink ? 0 : 1) + cams.filter((c) => c.state !== "live" && c.state !== "no-signal").length;
  return { lv, sw, swId, ups, aps, ws, phones, cams, uplink, down, degraded, sev: down ? "err" : degraded ? "warn" : "ok", okd };
}

function render(ctx) {
  const { view, esc, registry, screen } = ctx;
  const variant = screen ? screen.app.variant : "digital-twin";
  const s = ctx._ss.summary();
  const floors = FLOORS.map(floorHealth);
  const cams = net.cameras().map((c) => net.cameraFeed(c));
  const live = cams.filter((c) => c.state === "live").length;
  const svcs = Object.entries(SERVICE_UNITS).map(([u, id]) => ({ u, id, up: net.up(id), host: net.hostOf.get(id) }));
  const incidents = floors.filter((f) => f.sev !== "ok");
  const termLink = (host, label = "Console") => `<button class="btn" type="button" data-term="${esc(host)}" style="min-height:40px;padding:0 12px">${esc(label)}</button>`;

  if (ctx.tab === "overview") {
    const occ = variant === "occupancy" || variant === "command";
    view.innerHTML = `
      <div class="grid two wide-4">
        <div class="card stat"><b style="color:var(--ok)">${s.asset_availability.available}</b><span>devices available</span></div>
        <div class="card stat"><b style="color:${s.asset_availability.degraded ? "var(--warn)" : "var(--text)"}">${s.asset_availability.degraded}</b><span>degraded</span></div>
        <div class="card stat"><b style="color:${s.asset_availability.unavailable ? "var(--err)" : "var(--text)"}">${s.asset_availability.unavailable}</b><span>unavailable</span></div>
        <div class="card stat"><b style="color:${live === cams.length ? "var(--ok)" : "var(--err)"}">${live}/${cams.length}</b><span>cameras live</span></div>
      </div>
      <h2 class="h" style="margin-top:18px">${incidents.length ? "Active incidents" : "Building"}</h2>
      ${incidents.length ? `<div class="list">${incidents.map((f) => `<button class="row" type="button" data-floor="${f.lv}"><span class="dot ${f.sev}"></span><div class="t"><b>${f.lv} · ${esc(registry.floors[f.lv].title)}</b><span>${f.down} down · ${f.degraded} degraded${f.uplink ? "" : " · uplink lost"}</span></div><span class="pill ${f.sev}">${f.sev === "err" ? "crit" : "warn"}</span></button>`).join("")}</div>`
        : `<div class="card" style="display:flex;gap:12px;align-items:center"><span class="dot"></span><div><b>All floors nominal</b><div class="muted" style="font-size:13px">Every monitored switch, UPS, access point and camera is up in the ${esc(ctx.mode.toLowerCase())} sandbox.</div></div></div>`}
      <h2 class="h" style="margin-top:18px">Stack</h2>
      <div class="card" style="padding:10px">${floors.map((f) => `<button type="button" data-floor="${f.lv}" style="display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;min-height:46px;border:0;border-bottom:1px solid var(--line);background:none;text-align:left;padding:4px 4px"><b class="mono" style="color:${f.sev === "ok" ? "var(--text)" : f.sev === "warn" ? "var(--warn)" : "var(--err)"}">${f.lv}</b><span style="display:flex;gap:5px;flex-wrap:wrap">${[f.sw, f.ups, ...f.aps].filter(Boolean).map((d) => `<span class="dot ${f.okd(d) ? (d.availability === "degraded" ? "warn" : "") : "err"}" title="${esc(d.host)}"></span>`).join("")}${f.cams.map((c) => `<span class="dot ${c.state === "live" ? "" : c.state === "no-signal" ? "err" : "warn"}" style="border-radius:2px" title="${esc(c.device.host)}"></span>`).join("")}</span><span class="muted mono" style="font-size:11px">${occ ? registry.floors[f.lv].people.length + " staff" : f.uplink ? "uplink ok" : "UPLINK"}</span></button>`).join("")}</div>
      <div class="grid two" style="margin-top:14px">${termLink("b1-core-sw01", "Core console")}${termLink("b1-hyp01", "Services host")}</div>`;
  } else if (ctx.tab === "floors") {
    const sel = ctx._floor || (screen ? screen.floor : "B1");
    const f = floorHealth(sel);
    view.innerHTML = `
      <div class="seg" role="group" aria-label="Floor">${FLOORS.slice().reverse().map((lv) => `<button type="button" data-pick="${lv}" aria-pressed="${lv === sel}">${lv}</button>`).join("")}</div>
      <h2 class="h" style="margin-top:16px">${sel} · ${esc(registry.floors[sel].title)}</h2>
      <div class="list">
        ${[f.sw, f.ups].filter(Boolean).map((d) => `<div class="row"><span class="dot ${f.okd(d) ? (d.availability === "degraded" ? "warn" : "") : "err"}"></span><div class="t"><b class="mono">${esc(d.host)}</b><span>${esc(d.ip)} · ${esc(f.okd(d) ? d.availability : d.reason || "unreachable")}</span></div>${termLink(d.host)}</div>`).join("")}
        <div class="row"><span class="dot ${f.uplink ? "" : "err"}"></span><div class="t"><b>Backbone uplinks</b><span>${sel === "B1" ? "MDF core (local)" : f.uplink ? "Te1/1/1 · Te1/1/2 to b1-core" : "no working uplink to the core"}</span></div><span></span></div>
        ${f.aps.map((d) => `<div class="row"><span class="dot ${f.okd(d) ? "" : "err"}"></span><div class="t"><b class="mono">${esc(d.host)}</b><span>Wi-Fi access point · ${esc(f.okd(d) ? "serving clients" : d.reason || "down")}</span></div><span></span></div>`).join("")}
        ${f.cams.map((c) => `<div class="row"><span class="dot ${c.state === "live" ? "" : c.state === "no-signal" ? "err" : "warn"}"></span><div class="t"><b class="mono">${esc(c.device.host)}</b><span>camera · ${esc(c.state)}${c.reason ? " · " + esc(c.reason) : ""}</span></div><span></span></div>`).join("")}
      </div>
      <h2 class="h" style="margin-top:16px">People on ${sel}</h2>
      <div class="list">${registry.floors[sel].people.map((p) => `<div class="row"><span class="dot" style="background:var(--info);color:var(--info)"></span><div class="t"><b>${esc(p.name)}</b><span>${esc(p.station)}</span></div><span class="muted" style="font-size:11px">${esc(p.role)}</span></div>`).join("") || '<div class="row"><span></span><div class="t"><span>No recurring staff on this level.</span></div><span></span></div>'}</div>`;
  } else if (ctx.tab === "alarms") {
    const rows = [];
    for (const f of floors) {
      for (const d of [f.sw, f.ups, ...f.aps, ...f.ws, ...f.phones].filter(Boolean)) if (!f.okd(d) || d.availability === "degraded") rows.push({ sev: f.okd(d) ? "warn" : "err", host: d.host, what: f.okd(d) ? "degraded" : "unreachable (ICMP / SNMP timeout)", lv: f.lv });
      for (const c of f.cams) if (c.state !== "live") rows.push({ sev: c.state === "no-signal" ? "err" : "warn", host: c.device.host, what: c.state === "no-signal" ? "video loss" : "not recording", lv: f.lv });
      if (!f.uplink) rows.push({ sev: "warn", host: f.sw.host, what: "uplink to core down", lv: f.lv });
    }
    for (const sv of svcs) if (!sv.up) rows.push({ sev: "err", host: sv.host, what: sv.u + " service check failed", lv: "B1" });
    view.innerHTML = `<h2 class="h">Alarms · ${rows.length}</h2>${rows.length ? `<div class="list">${rows.map((r) => `<div class="row"><span class="dot ${r.sev}"></span><div class="t"><b class="mono">${esc(r.host)}</b><span>${r.lv} · ${esc(r.what)}</span></div><span class="pill ${r.sev}">${r.sev === "err" ? "crit" : "warn"}</span></div>`).join("")}</div>` : '<div class="card empty">No alarms. Symptoms appear here; causes are found at the consoles.</div>'}
      <p class="muted" style="font-size:12px;margin-top:12px">Monitoring shows symptoms. Diagnose at a console: the switch for its floor, the UPS card, the services host.</p>`;
  } else {
    view.innerHTML = `<h2 class="h">Services (B1 virtualization hosts)</h2><div class="list">${svcs.map((sv) => `<div class="row"><span class="dot ${sv.up ? "" : "err"}"></span><div class="t"><b class="mono">${esc(sv.u)}</b><span>${esc(net.ipOf.get(sv.id))} · ${esc(net.assets.get(sv.id).label)}</span></div><span class="pill ${sv.up ? "ok" : "err"}">${sv.up ? "running" : "failed"}</span></div>`).join("")}</div>
      <h2 class="h" style="margin-top:16px">Hosts</h2><div class="list">${["B1-SRV-HYP-01-I001", "B1-SRV-HYP-01-I002", "B1-SRV-HYP-01-I003", "B1-SRV-NAS-01", "B1-SRV-BACKUP-01", "B1-SEC-NVR-01"].map((id) => { const d = net.deviceStatus(id); const ok = d.availability === "available" && d.reachable; return `<div class="row"><span class="dot ${ok ? "" : d.availability === "degraded" ? "warn" : "err"}"></span><div class="t"><b class="mono">${esc(d.host)}</b><span>${esc(net.assets.get(id).label)} · ${esc(d.availability)}</span></div>${termLink(d.host)}</div>`; }).join("")}</div>`;
  }
}

bootApp({
  id: "noc", title: "Operations", defaultTab: "overview",
  tabs: [{ id: "overview", label: "Overview", icon: "pulse" }, { id: "floors", label: "Floors", icon: "layers" }, { id: "alarms", label: "Alarms", icon: "shield" }, { id: "services", label: "Services", icon: "devices" }],
  async render(ctx) {
    if (!ctx._ss) {
      ctx._ss = await ctx.session(); net = createNet(ctx._ss);
      ctx.view.addEventListener("click", (e) => {
        const t = e.target.closest("[data-term]"); if (t) { replaceToApp(ctx, "screens/terminal.html", { host: t.dataset.term }); return; }
        const p = e.target.closest("[data-pick]"); if (p) { ctx._floor = p.dataset.pick; render(ctx); return; }
        const f = e.target.closest("[data-floor]"); if (f) { ctx._floor = f.dataset.floor; ctx.setTab("floors"); }
      });
    }
    render(ctx);
  },
});
