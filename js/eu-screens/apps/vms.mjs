/* Camera console (VMS): every security camera in the building as a rendered feed, driven by the sandbox. A camera
   whose power, link, VLAN or recorder path is broken shows NO SIGNAL; a PRIM3 mission that blinds a floor shows up
   here, and only in MISSION mode. Feeds are rendered schematic views of the camera's floor, not video. */

import { bootApp, replaceToApp } from "../app-shell.mjs";
import { createNet } from "../net.mjs";

let net = null, raf = 0;
const FLOORS = ["B1", "F1", "F2", "F3", "F4", "F5", "F6", "L7"];
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/* a schematic CCTV view: floor grid in perspective, a far wall, a few volumes; seeded per camera */
function drawFeed(cv, cam, feed, t) {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext("2d");
  if (feed.state === "no-signal") {
    const img = g.createImageData(W, H), d = img.data;
    let seed = (hash(cam) + Math.floor(t / 70)) >>> 0;
    for (let i = 0; i < d.length; i += 4) { seed = (seed * 1664525 + 1013904223) >>> 0; const v = (seed >>> 24) * 0.45; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, H * 0.38, W, H * 0.24);
    g.fillStyle = "#ff6161"; g.font = `800 ${Math.round(H * 0.11)}px ui-monospace, monospace`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("NO SIGNAL", W / 2, H / 2);
    return;
  }
  const h = hash(cam);
  const pan = Math.sin(t / 4000 + (h % 7)) * 0.06;
  g.fillStyle = "#0b1110"; g.fillRect(0, 0, W, H);
  const vx = W * (0.5 + pan + ((h % 21) - 10) / 100), vy = H * (0.36 + ((h >> 5) % 9) / 100);
  /* far wall */
  const wx = W * 0.22, wy = H * 0.18;
  g.fillStyle = "#16201d"; g.fillRect(vx - wx, vy - wy, wx * 2, wy * 1.6);
  /* floor grid */
  g.strokeStyle = "rgba(160,220,190,.22)"; g.lineWidth = Math.max(1, dpr * 0.8);
  for (let i = -8; i <= 8; i++) { g.beginPath(); g.moveTo(vx + i * wx / 4, vy + wy * 0.6); g.lineTo(W / 2 + i * W / 5 + (vx - W / 2) * 0.2, H); g.stroke(); }
  for (let k = 1; k < 9; k++) { const y = vy + wy * 0.6 + (H - vy) * Math.pow(k / 9, 1.8); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  /* walls */
  g.strokeStyle = "rgba(160,220,190,.32)";
  g.beginPath(); g.moveTo(vx - wx, vy - wy); g.lineTo(0, 0); g.moveTo(vx + wx, vy - wy); g.lineTo(W, 0); g.moveTo(vx - wx, vy + wy * 0.6); g.lineTo(0, H * 0.8); g.moveTo(vx + wx, vy + wy * 0.6); g.lineTo(W, H * 0.8); g.stroke();
  /* furniture volumes */
  for (let k = 0; k < 3; k++) {
    const s = (h >> (k * 4)) & 15, bx = W * (0.15 + s / 22), by = H * (0.62 + ((s * 7) % 10) / 50), bw = W * (0.1 + (s % 5) / 40), bh = H * 0.09;
    g.fillStyle = "rgba(120,170,150,.20)"; g.fillRect(bx, by, bw, bh);
    g.fillStyle = "rgba(120,170,150,.32)"; g.fillRect(bx, by - bh * 0.35, bw, bh * 0.35);
  }
  /* a person crossing now and then (anonymous figure, not a likeness) */
  const px = ((t / 30 + h) % (W * 1.6)) - W * 0.3;
  if ((h & 3) !== 0) { g.fillStyle = "rgba(220,255,235,.55)"; g.beginPath(); g.ellipse(px, H * 0.62, W * 0.012, H * 0.03, 0, 0, 7); g.fill(); g.fillRect(px - W * 0.014, H * 0.65, W * 0.028, H * 0.12); }
  /* scanlines + vignette */
  g.fillStyle = "rgba(0,0,0,.18)"; for (let y = 0; y < H; y += 3 * dpr) g.fillRect(0, y, W, dpr);
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.9); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.55)"); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  if (feed.state === "degraded") { g.fillStyle = "rgba(245,184,61,.10)"; g.fillRect(0, 0, W, H); }
}

function tile(c, esc, big = false) {
  const f = net.cameraFeed(c);
  const col = f.state === "live" ? "var(--ok)" : f.state === "no-signal" ? "var(--err)" : "var(--warn)";
  return `<button type="button" class="cam${big ? " big" : ""}" data-cam="${esc(c)}"><canvas aria-hidden="true"></canvas>
    <span class="lbl"><span>${esc(net.hostOf.get(c))}</span><span>${esc(net.levelOf(c))}</span></span>
    <span class="st" style="color:${col}">● ${f.state === "live" ? "REC" : f.state === "no-signal" ? "NO SIGNAL" : f.state === "not-recording" ? "REC OFF" : "DEGRADED"}</span></button>`;
}

function animate(view) {
  cancelAnimationFrame(raf);
  const tick = (t) => {
    for (const b of view.querySelectorAll("[data-cam]")) { const cv = b.querySelector("canvas"); if (cv && cv.isConnected) drawFeed(cv, b.dataset.cam, net.cameraFeed(b.dataset.cam), t); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function render(ctx) {
  const { view, esc } = ctx;
  const filter = ctx._filter || "ALL";
  const cams = net.cameras().filter((c) => filter === "ALL" || net.levelOf(c) === filter);
  if (ctx.tab === "wall") {
    const all = net.cameras().map((c) => net.cameraFeed(c));
    const lost = all.filter((f) => f.state === "no-signal").length;
    view.innerHTML = `
      ${ctx.mode === "MISSION" && lost ? `<p class="notice err">PRIM3 MISSION · ${lost} camera${lost === 1 ? "" : "s"} blind in the mission sandbox.</p>` : ""}
      <div class="chips" role="group" aria-label="Floor filter">${["ALL", ...FLOORS].map((f) => `<button type="button" class="chip" data-filter="${f}" aria-pressed="${f === filter}" style="${f === filter ? "background:var(--panel-3);color:#fff;border-color:var(--accent)" : ""}">${f}</button>`).join("")}</div>
      <div class="cams" style="margin-top:12px">${cams.map((c) => tile(c, esc)).join("")}</div>`;
    animate(view);
  } else if (ctx.tab === "recorder") {
    cancelAnimationFrame(raf);
    const nvr = net.deviceStatus("B1-SEC-NVR-01"), vms = net.up("LOGIC-SVC-VMS"), nas = net.deviceStatus("B1-SRV-NAS-01");
    const all = net.cameras().map((c) => net.cameraFeed(c));
    view.innerHTML = `<div class="grid two"><div class="card stat"><b style="color:${nvr.availability === "unavailable" ? "var(--err)" : "var(--ok)"}">${nvr.availability === "unavailable" ? "OFF" : "ON"}</b><span>recorder b1-nvr01</span></div><div class="card stat"><b>${all.filter((f) => f.state === "live" || f.state === "degraded").length}/${all.length}</b><span>recording</span></div></div>
      <div class="list" style="margin-top:12px">
        <div class="row"><span class="dot ${vms ? "" : "err"}"></span><div class="t"><b>vms.service</b><span>video management · ${vms ? "running" : "failed"}</span></div><span></span></div>
        <div class="row"><span class="dot ${nas.availability === "available" ? "" : "warn"}"></span><div class="t"><b>Archive storage</b><span>b1-nas01 · ${esc(nas.availability)}</span></div><span></span></div>
        <div class="row"><span class="dot"></span><div class="t"><b>CCTV VLAN 70</b><span>cameras isolated from staff and guest networks</span></div><span></span></div>
      </div>
      <div class="grid two" style="margin-top:14px"><button class="btn" data-term="b1-nvr01">Recorder shell</button><button class="btn" data-term="b1-core-sw01">Core switch</button></div>`;
  } else {
    cancelAnimationFrame(raf);
    const sel = ctx._cam || cams[0] || net.cameras()[0];
    const f = net.cameraFeed(sel), p = net.endpointPort.get(sel);
    const swHost = p ? net.hostOf.get(p.switchId) : null;
    view.innerHTML = `<div class="cams">${tile(sel, esc, true)}</div>
      <div class="list" style="margin-top:12px">
        <div class="row"><span class="dot ${f.state === "live" ? "" : f.state === "no-signal" ? "err" : "warn"}"></span><div class="t"><b class="mono">${esc(net.hostOf.get(sel))}</b><span>${esc(f.state)}${f.reason ? " · " + esc(f.reason) : ""}</span></div><span></span></div>
        <div class="row"><span></span><div class="t"><b>Network</b><span>${esc(f.device.ip)} · VLAN 70 · ${p ? esc(swHost + " " + p.port) : "—"}</span></div><span></span></div>
        <div class="row"><span></span><div class="t"><b>Power</b><span>PoE from ${esc(swHost || "the floor switch")}</span></div><span></span></div>
      </div>
      ${swHost ? `<button class="btn block" style="margin-top:14px" data-term="${esc(swHost)}">Open ${esc(swHost)} console</button>` : ""}
      <div class="chips" style="margin-top:14px">${net.cameras().map((c) => `<button type="button" class="chip" data-pickcam="${esc(c)}">${esc(net.hostOf.get(c))}</button>`).join("")}</div>`;
    animate(view);
  }
}

bootApp({
  id: "vms", title: "Cameras", defaultTab: "wall",
  tabs: [{ id: "wall", label: "Wall", icon: "grid" }, { id: "camera", label: "Camera", icon: "cam" }, { id: "recorder", label: "Recorder", icon: "devices" }],
  async render(ctx) {
    if (!ctx._ss) {
      ctx._ss = await ctx.session(); net = createNet(ctx._ss);
      ctx.view.addEventListener("click", (e) => {
        const fb = e.target.closest("[data-filter]"); if (fb) { ctx._filter = fb.dataset.filter; render(ctx); return; }
        const t = e.target.closest("[data-term]"); if (t) { replaceToApp(ctx, "screens/terminal.html", { host: t.dataset.term }); return; }
        const pc = e.target.closest("[data-pickcam]"); if (pc) { ctx._cam = pc.dataset.pickcam; render(ctx); return; }
        const c = e.target.closest("[data-cam]"); if (c && ctx.tab === "wall") { ctx._cam = c.dataset.cam; ctx.setTab("camera"); }
      });
      if (ctx.screen && ctx.screen.floor !== "B1" && ctx.screen.app.variant === "reception-security") ctx._filter = ctx.screen.floor;
    }
    render(ctx);
  },
});
