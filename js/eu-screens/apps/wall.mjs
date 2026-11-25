/* Wall display app: the program surfaces (F1 Journey Wall and lounge, F2 forum wall, F3 network wall and
   interview displays, F6 strategy/briefing/salon). A surface shows its program and the floor's live status; if
   its AV-over-IP decoder has no path in the sandbox, it shows NO SIGNAL like the real panel would. */

import { bootApp } from "../app-shell.mjs";
import { createNet } from "../net.mjs";

let net = null, timer = 0;
const PROMPTS = {
  listening: ["What would make this floor more useful to you?", "Name one thing you learned this week.", "Who should we hear from next?", "What problem near you deserves a policy?"],
  intake: ["Private display. In the sandbox it shows no personal data, ever."],
};

function render(ctx) {
  const { view, esc, screen, registry } = ctx;
  clearInterval(timer);
  if (!screen) { view.innerHTML = '<div class="card empty">Open a wall display from the building.</div>'; return; }
  const dec = screen.network_asset_id;
  const signal = !dec || (net.hostNet(dec).ok && !net.hostNet(dec).isolated);
  const fl = registry.floors[screen.floor];
  if (ctx.tab === "display") {
    if (!signal) {
      view.innerHTML = `<div class="card" style="aspect-ratio:16/10;display:grid;place-items:center;background:#000;border-color:#222"><div style="text-align:center"><div class="mono" style="font-size:28px;font-weight:800;color:var(--err)">NO SIGNAL</div><div class="muted mono" style="font-size:12px;margin-top:6px">${esc(net.hostOf.get(dec) || dec)} · ${esc(net.hostNet(dec).reason || "no path")}</div></div></div>`;
      return;
    }
    const v = screen.app.variant;
    const sameFloor = registry.screens.filter((s) => s.floor === screen.floor);
    view.innerHTML = `<div class="card" style="aspect-ratio:16/10;display:grid;align-content:space-between;padding:18px;background:radial-gradient(120% 120% at 0% 0%,#1a222b,#07090b 70%)">
        <div style="display:flex;justify-content:space-between;gap:8px"><span class="mono muted" style="font-size:11px;letter-spacing:.16em">${esc(screen.floor)} · ${esc(screen.room.label.toUpperCase())}</span><span class="mono muted" style="font-size:11px" data-clock></span></div>
        <div><div style="font-size:clamp(22px,6vw,44px);font-weight:800;line-height:1.05;letter-spacing:-.01em">${esc(screen.label.replace(/ Surface$/, ""))}</div><div class="muted" style="margin-top:8px">${esc(fl.title)}</div></div>
        <div data-rot class="muted" style="font-size:14px;min-height:2.8em">${esc((PROMPTS[v] || [])[0] || "")}</div>
      </div>
      <h2 class="h" style="margin-top:16px">On this floor now</h2>
      <div class="list">${fl.people.slice(0, 6).map((p) => `<div class="row"><span class="dot" style="background:var(--info);color:var(--info)"></span><div class="t"><b>${esc(p.name)}</b><span>${esc(p.station)}</span></div><span></span></div>`).join("") || '<div class="row"><span></span><div class="t"><span>No recurring staff here.</span></div><span></span></div>'}</div>
      <p class="muted" style="font-size:12px;margin-top:12px">${sameFloor.length} screens on ${esc(screen.floor)}. Every one opens from the building.</p>`;
    const tick = () => { const c = view.querySelector("[data-clock]"); if (c) c.textContent = new Date().toTimeString().slice(0, 5); };
    let i = 0; tick();
    timer = setInterval(() => { tick(); const r = view.querySelector("[data-rot]"); const list = PROMPTS[v] || []; if (r && list.length > 1) { i = (i + 1) % list.length; r.textContent = list[i]; } }, 4000);
    return;
  }
  view.innerHTML = `<h2 class="h">About this screen</h2><div class="list">${[
    ["Screen", screen.screen_id], ["Asset", screen.asset_id], ["Room", screen.room.label], ["Position (ft)", `x ${screen.position.x} · y ${screen.position.y} · ${screen.position.z_aff} AFF`],
    ["Placement source", screen.position.source], ["Decoder", dec ? (net.hostOf.get(dec) || dec) + (signal ? " · signal" : " · no signal") : "—"], ["Modes", screen.modes.join(" · ")], ["Control", "SANDBOX · live control disabled"],
  ].map(([k, v]) => `<div class="row"><span></span><div class="t"><b>${esc(k)}</b><span class="mono">${esc(v)}</span></div><span></span></div>`).join("")}</div>`;
}

bootApp({
  id: "wall", title: "Wall", defaultTab: "display",
  tabs: [{ id: "display", label: "Display", icon: "grid" }, { id: "about", label: "About", icon: "list" }],
  async render(ctx) { if (!ctx._ss) { ctx._ss = await ctx.session(); net = createNet(ctx._ss); } render(ctx); },
});
