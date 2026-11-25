/* Media studio console (Floor 4): transport, live meters, channel faders, scenes and the LISTEN / WATCH / ARCHIVE
   surfaces. The signal path is the sandbox's: the F4 switch and uplink, the AV-over-IP endpoints, the AV control
   service, QoS on the floor, and the B1 archive storage. Meters are synthetic levels; takes are session-only. */

import { bootApp } from "../app-shell.mjs";
import { createNet } from "../net.mjs";

let net = null, raf = 0;

function health(ctx) {
  const lv = "F4";
  const sw = `${lv}-NET-ACCESS-SW-01`;
  const qosOff = ctx._ss.entries().some((e) => e.fault_id === "qos_removed" && e.level === lv);
  const igmpOff = ctx._ss.entries().some((e) => e.fault_id === "igmp_snooping_off" && e.level === lv);
  const avCams = net.ofType("av_camera").filter((x) => net.levelOf(x) === lv);
  const mics = net.ofType("av_microphone").filter((x) => net.levelOf(x) === lv);
  const items = [
    ["Floor network", net.up(sw) && net.uplinkUp(sw) ? "ok" : net.up(sw) ? "warn" : "err", net.up(sw) ? (net.uplinkUp(sw) ? "f4-idf-sw01 · uplinks ok" : "uplink to core lost") : "switch down"],
    ["AV control service", net.up("LOGIC-SVC-AV-CONTROL") ? "ok" : "err", "av-control on b1-hyp03"],
    ["QoS for media", qosOff ? "warn" : "ok", qosOff ? "policy removed: audio/video not prioritized" : "DSCP trusted on AV ports"],
    ["Multicast containment", igmpOff ? "warn" : "ok", igmpOff ? "IGMP snooping off: streams flood the floor" : "IGMP snooping on"],
    ["Recording archive", net.deviceStatus("B1-SRV-NAS-01").availability === "available" ? "ok" : "warn", "b1-nas01 · " + net.deviceStatus("B1-SRV-NAS-01").availability],
    ["Studio cameras", avCams.every((c) => net.up(c)) ? "ok" : "err", `${avCams.filter((c) => net.up(c)).length}/${avCams.length} online`],
    ["Microphones", mics.every((m) => net.up(m)) ? "ok" : "err", `${mics.filter((m) => net.up(m)).length}/${mics.length} online`],
  ];
  return { items, qosOff, igmpOff, mics, avCams, sev: items.some((i) => i[1] === "err") ? "err" : items.some((i) => i[1] === "warn") ? "warn" : "ok" };
}

function st(ctx) { const s = ctx._ss.session; if (!s.studio) s.studio = { rec: false, started: 0, takes: [], scene: "Interview", faders: [70, 64, 58, 72] }; return s.studio; }

function meters(view, h) {
  cancelAnimationFrame(raf);
  const bars = [...view.querySelectorAll("[data-meter]")];
  let seed = 7;
  const tick = (t) => {
    bars.forEach((b, i) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const mic = h.mics[i];
      const live = mic ? net.up(mic) : true;
      const fader = Number(view.querySelector(`[data-fader="${i}"]`)?.value || 60) / 100;
      let lvl = live ? (0.35 + 0.35 * Math.abs(Math.sin(t / (380 + i * 90))) + ((seed >>> 24) / 255) * 0.25) * fader : 0;
      if (h.qosOff && live && (seed & 7) === 0) lvl *= 0.15; /* dropouts when media is not prioritized */
      b.style.height = Math.min(100, lvl * 100) + "%";
    });
    const clock = view.querySelector("[data-clock]");
    if (clock && clock.dataset.on === "1") { const s = Math.floor((Date.now() - Number(clock.dataset.t)) / 1000); clock.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function render(ctx) {
  const { view, esc } = ctx;
  const h = health(ctx), s = st(ctx);
  if (ctx.tab === "console") {
    view.innerHTML = `
      ${h.sev !== "ok" ? `<p class="notice ${h.sev === "err" ? "err" : ""}">${esc(h.items.filter((i) => i[1] !== "ok").map((i) => i[0] + ": " + i[2]).join(" · "))}</p>` : ""}
      <div class="card" style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:center">
        <button class="rec" type="button" data-rec aria-pressed="${s.rec}" aria-label="${s.rec ? "Stop recording" : "Record"}"></button>
        <div><div class="mono" style="font-size:34px;font-weight:800;letter-spacing:.04em" data-clock data-on="${s.rec ? 1 : 0}" data-t="${s.started}">00:00</div>
          <div class="muted" style="font-size:13px">${s.rec ? "Recording · " + esc(s.scene) : "Ready · " + esc(s.scene)}</div>
          <div class="pill ${h.sev}" style="margin-top:6px">${h.sev === "ok" ? "signal path ok" : h.sev === "warn" ? "degraded path" : "path down"}</div></div>
      </div>
      <h2 class="h" style="margin-top:16px">Inputs</h2>
      <div class="card" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px">${[0, 1, 2, 3].map((i) => `<div class="strip"><div class="meter" style="width:22px"><i data-meter style="height:0"></i></div><input type="range" min="0" max="100" value="${s.faders[i]}" data-fader="${i}" aria-label="Mic ${i + 1} level"><span class="mono">${esc(h.mics[i] ? net.hostOf.get(h.mics[i]) : "line " + (i + 1))}</span></div>`).join("")}</div>
      <h2 class="h" style="margin-top:16px">Scene</h2>
      <div class="seg">${["Interview", "Podcast", "Listening", "Release"].map((x) => `<button type="button" data-scene="${x}" aria-pressed="${x === s.scene}">${x}</button>`).join("")}</div>
      <h2 class="h" style="margin-top:16px">Takes · ${s.takes.length}</h2>
      ${s.takes.length ? `<div class="list">${s.takes.slice().reverse().map((t) => `<div class="row"><span class="dot ${t.clean ? "" : "warn"}"></span><div class="t"><b>${esc(t.scene)} · ${esc(t.len)}</b><span>${t.clean ? "clean" : "flagged: " + esc(t.note)}</span></div><span class="mono muted" style="font-size:11px">${esc(t.at)}</span></div>`).join("")}</div>` : '<div class="card empty">No takes yet. Press record.</div>'}`;
    meters(view, h);
  } else if (ctx.tab === "sources") {
    cancelAnimationFrame(raf);
    const f4 = ctx.registry.screens.filter((x) => x.floor === "F4" && x.kind !== "studio_console");
    view.innerHTML = `<h2 class="h">Floor 4 surfaces</h2><div class="list">${f4.map((x) => { const dec = x.network_asset_id; const ok = dec ? net.up(dec) : true; return `<div class="row"><span class="dot ${ok ? "" : "err"}"></span><div class="t"><b>${esc(x.label)}</b><span>${esc(x.room.label)}${dec ? " · decoder " + (ok ? "ok" : "no signal") : ""}</span></div><span class="pill">${esc(x.app.variant)}</span></div>`; }).join("")}</div>`;
  } else {
    cancelAnimationFrame(raf);
    view.innerHTML = `<h2 class="h">Signal path</h2><div class="list">${h.items.map(([n, sev, d]) => `<div class="row"><span class="dot ${sev === "ok" ? "" : sev}"></span><div class="t"><b>${esc(n)}</b><span>${esc(d)}</span></div><span class="pill ${sev}">${sev}</span></div>`).join("")}</div>
      <p class="muted" style="font-size:12px;margin-top:12px">Broadcast media is real-time traffic: it needs QoS priority and contained multicast. Fix path faults at the F4 IDF console (configure terminal · mls qos · ip igmp snooping).</p>`;
  }
}

bootApp({
  id: "studio", title: "Studio", defaultTab: "console",
  tabs: [{ id: "console", label: "Console", icon: "wave" }, { id: "sources", label: "Sources", icon: "grid" }, { id: "health", label: "Health", icon: "pulse" }],
  async render(ctx) {
    if (!ctx._ss) {
      ctx._ss = await ctx.session(); net = createNet(ctx._ss);
      ctx.view.addEventListener("click", (e) => {
        const s = st(ctx);
        if (e.target.closest("[data-rec]")) {
          if (!s.rec) { s.rec = true; s.started = Date.now(); }
          else { const h = health(ctx); const secs = Math.max(1, Math.round((Date.now() - s.started) / 1000)); s.takes.push({ scene: s.scene, len: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, clean: h.sev === "ok", note: h.items.filter((i) => i[1] !== "ok").map((i) => i[0]).join(", "), at: new Date().toTimeString().slice(0, 5) }); s.rec = false; }
          ctx._ss.persist(); render(ctx); return;
        }
        const sc = e.target.closest("[data-scene]"); if (sc) { s.scene = sc.dataset.scene; ctx._ss.persist(); render(ctx); }
      });
      ctx.view.addEventListener("change", (e) => { const f = e.target.closest("[data-fader]"); if (f) { st(ctx).faders[Number(f.dataset.fader)] = Number(f.value); ctx._ss.persist(); } });
    }
    render(ctx);
  },
});
