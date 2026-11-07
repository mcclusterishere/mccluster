/* Roof portal departure board (Level 7, and the F6 roof-transition terminal). The board is data: it renders
   whatever screens/data/roof-destination-registry-v1.json lists (FLOOR-07-ECOSYSTEM-ROUTING-CONTRACT.md §4),
   which is itself derived from data/seo/domain-architecture.json. No destination is written into this file.
   Leaving goes only to an https URL whose host is one of the registry's own destinations (contract §9). */

import { bootApp } from "../app-shell.mjs";

const STAMP = "578e683088fd";
let reg = null;

async function loadDestinations() {
  const url = new URL("../../../screens/data/roof-destination-registry-v1.json", import.meta.url).href + (STAMP.startsWith("__") ? "" : "?v=" + STAMP);
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error("destination registry " + r.status);
  return r.json();
}

/* contract §9: https only, and the host must be a registered destination's own host */
export function allowedDeparture(registry, dest) {
  try {
    const u = new URL(dest.url);
    if (u.protocol !== "https:") return null;
    const hosts = new Set(registry.destinations.map((d) => new URL(d.url).host));
    return hosts.has(u.host) && dest.enabled ? u.href : null;
  } catch (e) { return null; }
}

function status(d) { return d.enabled ? { t: "BOARDING", c: "ok" } : { t: "UNAVAILABLE", c: "err" }; }

function render(ctx) {
  const { view, esc, screen } = ctx;
  const variant = screen ? screen.app.variant : "board";
  const list = reg.destinations.filter((d) => variant !== "restricted" || !d.enabled);
  const now = new Date();
  if (ctx.tab === "board") {
    view.innerHTML = `
      ${variant === "portal" ? '<p class="notice">Uprise World portal node: optional and not configured. Uprise World is a separate project; this node stays dark until the owner connects it.</p>' : ""}
      ${variant === "restricted" ? '<p class="notice">Restricted / unavailable destinations. These are listed so you know they exist; they cannot be boarded.</p>' : ""}
      ${ctx.mode === "MISSION" ? '<p class="notice err">PRIM3 MISSION in progress. The roof is the extraction point; departures stay open to the mission team.</p>' : ""}
      <div class="board">
        <div class="board-head"><span>DEPARTURES · LEVEL 7</span><span data-clock>${now.toTimeString().slice(0, 5)}</span></div>
        ${list.map((d, i) => { const s = status(d); return `<button class="flap flip" type="button" data-dest="${esc(d.id)}" style="animation-delay:${i * 90}ms"><span class="code">${esc(d.code)}</span><span class="dest"><b>${esc(d.display_name)}</b><span>${esc(d.metadata.entity_type || "")} · pad ${i + 1} · ${esc(d.departure_asset)}</span></span><span class="stt ${s.c}">${s.t}</span></button>`; }).join("") || '<div class="empty" style="color:#9a987f">No destinations in this list.</div>'}
      </div>
      <p class="muted" style="font-size:12px;margin-top:12px">Destinations come from the ecosystem routing registry, not from this screen. Tap one to see it, then board.</p>
      <div data-detail></div>`;
  } else if (ctx.tab === "arrivals") {
    view.innerHTML = `<h2 class="h">Arrivals</h2><div class="card grid"><p style="margin:0">Arriving from another site in the ecosystem lands you here on Level 7. With no arrival details, the roof opens in its normal idle state.</p>
      <button class="btn primary block" data-home>Return to the building</button></div>
      <h2 class="h" style="margin-top:16px">Return routes</h2><div class="list">${reg.destinations.map((d) => `<div class="row"><span class="dot ${d.enabled ? "" : "err"}"></span><div class="t"><b>${esc(d.display_name)}</b><span class="mono">returns to ${esc(d.return_route)}</span></div><span></span></div>`).join("")}</div>`;
  } else {
    view.innerHTML = `<h2 class="h">Portal status</h2><div class="list">
      <div class="row"><span class="dot"></span><div class="t"><b>Travel mode</b><span>${esc(reg.travel_metaphor)} (digital narrative, not an aviation operation)</span></div><span></span></div>
      <div class="row"><span class="dot"></span><div class="t"><b>Registry</b><span class="mono">${esc(reg.registry_id)} · ${reg.destinations.length} destinations</span></div><span></span></div>
      <div class="row"><span class="dot"></span><div class="t"><b>URL rule</b><span>${esc(reg.allowed_url_rule)}</span></div><span></span></div></div>
      <p class="muted" style="font-size:12px;margin-top:12px">${esc(reg.authority)}</p>`;
  }
}

function detail(ctx, id) {
  const d = reg.destinations.find((x) => x.id === id);
  const box = ctx.view.querySelector("[data-detail]");
  if (!d || !box) return;
  const href = allowedDeparture(reg, d);
  box.innerHTML = `<div class="card grid" style="margin-top:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b class="mono" style="font-size:20px;color:#f8d34a">${ctx.esc(d.code)}</b><span class="pill ${d.enabled ? "ok" : "err"}">${d.enabled ? "boarding" : "unavailable"}</span></div>
    <div><b>${ctx.esc(d.display_name)}</b><div class="muted" style="font-size:13px">${ctx.esc(d.metadata.answers || "")}</div></div>
    ${d.state_reason ? `<p class="muted" style="margin:0;font-size:12px">${ctx.esc(d.state_reason)}</p>` : ""}
    <button class="btn primary block" data-board="${ctx.esc(d.id)}" ${href ? "" : "disabled"}>${href ? "Board · lift off" : "Not available"}</button></div>`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function liftOff(ctx, id) {
  const d = reg.destinations.find((x) => x.id === id);
  const href = d && allowedDeparture(reg, d);
  if (!href) return;
  const o = document.createElement("div");
  o.className = "boot";
  o.innerHTML = `<div class="box" style="text-align:center"><b style="font-size:15px">LIFT-OFF · ${ctx.esc(d.code)}</b><div data-count style="font:800 54px/1.2 var(--mono);color:#f8d34a;margin-top:8px">3</div><div class="muted">${ctx.esc(d.display_name)}</div><div class="bar"><i></i></div></div>`;
  document.body.append(o);
  let n = 3;
  const t = setInterval(() => { n--; o.querySelector("[data-count]").textContent = String(Math.max(n, 0)); if (n <= 0) { clearInterval(t); location.assign(href); } }, 650);
}

bootApp({
  id: "departures", title: "Departures", defaultTab: "board",
  tabs: [{ id: "board", label: "Departures", icon: "plane" }, { id: "arrivals", label: "Arrivals", icon: "map" }, { id: "status", label: "Status", icon: "list" }],
  async render(ctx) {
    if (!reg) {
      reg = await loadDestinations();
      ctx.view.addEventListener("click", (e) => {
        const b = e.target.closest("[data-board]"); if (b) { liftOff(ctx, b.dataset.board); return; }
        const d = e.target.closest("[data-dest]"); if (d) { detail(ctx, d.dataset.dest); return; }
        if (e.target.closest("[data-home]")) ctx.back();
      });
      if (ctx.screen && ctx.screen.app.variant === "return" && !new URLSearchParams(location.search).get("tab")) { ctx.setTab("arrivals"); return; }
    }
    render(ctx);
  },
});
