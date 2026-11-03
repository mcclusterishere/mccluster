/* Terminal app: a self-built terminal emulator (scrollback, prompt, history, Tab completion, phone key row) over
   the sandboxed shell. Every console in the building opens here: workstations, the B1 NOC, MDF/IDF switch
   consoles (KVM), server BMCs, UPS cards and the BAS lab console. */

import { bootApp } from "../app-shell.mjs";
import { createShell } from "../shell.mjs";
import { loadComputerWorkbench } from "../sandbox-session.mjs";
import { MAN } from "../man.mjs";
import { getPref, setPref } from "../state.mjs";

let shell = null, termEl = null, scrollKey = null;
const scroll = [];
const QUICK = {
  ios: ["show interfaces status", "show logging", "show power inline", "show vlan brief", "show ip igmp snooping", "help", "exit"],
  bash: ["ticket", "alarms", "ip addr", "ping ns1", "camera list", "help"],
  bmc: ["ipmitool chassis status", "ipmitool sel list", "ipmitool sensor", "help"],
  ups: ["ups status", "ups selftest", "help"],
};

function line(text, cls = "", promptText = null) {
  const d = document.createElement("div");
  d.className = "ln" + (cls ? " " + cls : "");
  if (promptText != null) { const p = document.createElement("span"); p.className = "p"; p.textContent = promptText + " "; d.append(p, document.createTextNode(text)); }
  else d.textContent = text;
  return d;
}
function persist() { if (scrollKey) setPref(scrollKey, scroll.slice(-240)); }
function write(entries) {
  for (const e of entries) { scroll.push(e); termEl.append(e.p != null ? line(e.t, "cmd", e.p) : line(e.t, e.c)); }
  while (termEl.childElementCount > 600) termEl.firstElementChild.remove();
  termEl.scrollTop = termEl.scrollHeight;
  persist();
}

function consoleView(ctx) {
  const wrap = document.createElement("div");
  wrap.className = "term-wrap";
  wrap.innerHTML = `
    <div class="term" role="log" aria-live="polite" aria-label="Terminal output" data-term></div>
    <form class="term-input" data-form autocomplete="off"><label class="p" data-prompt for="termIn"></label>
      <input id="termIn" data-in type="text" inputmode="text" enterkeyhint="send" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Command"></form>
    <div class="keys" data-keys></div>`;
  return wrap;
}

function wire(ctx, wrap) {
  termEl = wrap.querySelector("[data-term]");
  const input = wrap.querySelector("[data-in]");
  const promptEl = wrap.querySelector("[data-prompt]");
  const keys = wrap.querySelector("[data-keys]");
  let hIdx = null;
  const hist = () => shell ? ctxHistory() : [];
  function ctxHistory() { return (ctx._ss && ctx._ss.session.history) || []; }

  function setPrompt() { promptEl.textContent = shell.prompt(); renderKeys(); }
  function renderKeys() {
    const t = shell.context.type;
    keys.innerHTML = ["Tab", "↑", "↓", "^C", "clear"].map((k) => `<button type="button" data-k="${k}">${k}</button>`).join("") + '<span class="sep"></span>' +
      (QUICK[t] || QUICK.bash).map((c) => `<button type="button" class="cmd" data-c="${c}">${c}</button>`).join("");
  }
  function run(cmd) {
    const before = shell.prompt();
    const r = shell.exec(cmd);
    if (r.clear) { termEl.innerHTML = ""; scroll.length = 0; persist(); }
    else write([{ t: cmd, p: before }, ...r.lines]);
    setPrompt();
    hIdx = null;
    if (r.exit) setTimeout(() => ctx.back(), 450);
  }
  wrap.querySelector("[data-form]").addEventListener("submit", (e) => { e.preventDefault(); const v = input.value; input.value = ""; run(v); });
  function complete() {
    const r = shell.complete(input.value);
    if (r.options && r.options.length > 1) write([{ t: input.value, p: shell.prompt() }, { t: r.options.join("   "), c: "dim" }]);
    input.value = r.line;
    input.focus();
  }
  function histStep(d) {
    const h = hist(); if (!h.length) return;
    hIdx = hIdx == null ? h.length : hIdx;
    hIdx = Math.max(0, Math.min(h.length, hIdx + d));
    input.value = hIdx === h.length ? "" : h[hIdx];
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); complete(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); histStep(-1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); histStep(1); }
    else if (e.key === "c" && e.ctrlKey) { e.preventDefault(); write([{ t: input.value + "^C", p: shell.prompt() }]); input.value = ""; }
    else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); termEl.innerHTML = ""; scroll.length = 0; persist(); }
  });
  keys.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.c) { run(b.dataset.c); return; }
    const k = b.dataset.k;
    if (k === "Tab") complete(); else if (k === "↑") histStep(-1); else if (k === "↓") histStep(1);
    else if (k === "^C") { write([{ t: input.value + "^C", p: shell.prompt() }]); input.value = ""; }
    else if (k === "clear") run("clear");
    input.focus({ preventScroll: true });
  });
  termEl.addEventListener("click", () => { if (!getSelection().toString()) input.focus({ preventScroll: true }); });
  setPrompt();
  return { run, input };
}

let consoleEl = null, api = null;

async function render(ctx) {
  const { view, esc } = ctx;
  if (!ctx._ss) {
    ctx._ss = await ctx.session();
    const machine = ctx._ss.hardware?.byId.get(ctx.screen?.network_asset_id);
    const consoleScreen = machine && !machine.server ? { ...ctx.screen, app: { ...ctx.screen.app, variant: "workstation" } } : ctx.screen;
    const baseShell = createShell({ ss: ctx._ss, screen: consoleScreen, clock: () => Date.now() });
    shell = ctx._ss.wrapEquipmentShell ? ctx._ss.wrapEquipmentShell(baseShell, consoleScreen) : baseShell;
    globalThis.__euShell = shell; /* for the e2e suite and the curious */
    scrollKey = "scroll:" + (ctx.screen ? ctx.screen.screen_id : "noc") + ":" + ctx.mode;
  }
  const ss = ctx._ss;
  const equipmentGeneration = ctx._equipmentGeneration = (ctx._equipmentGeneration || 0) + 1;
  if (ctx._equipmentDispose) { ctx._equipmentDispose(); ctx._equipmentDispose = null; }
  if (ctx.tab === "hardware") {
    const mod = await loadComputerWorkbench();
    if (ctx.tab !== "hardware" || ctx._equipmentGeneration !== equipmentGeneration) return;
    ctx._equipmentDispose = mod.mountWorkbench(ctx, ss);
    return;
  }
  view.innerHTML = "";
  view.onclick = null;
  if (ctx.tab === "console") {
    if (!consoleEl) {
      consoleEl = consoleView(ctx);
      view.append(consoleEl);
      api = wire(ctx, consoleEl);
      const saved = getPref(scrollKey, null);
      if (Array.isArray(saved) && saved.length) { write(saved); write([{ t: "— session resumed —", c: "dim" }]); }
      else write(shell.banner());
      const host = new URLSearchParams(location.search).get("host");
      if (host && /^[a-z0-9-]{2,40}$/.test(host)) api.run("ssh " + host);
    } else view.append(consoleEl);
    termEl.scrollTop = termEl.scrollHeight;
    if (matchMedia("(min-width: 720px)").matches) api.input.focus({ preventScroll: true });
    return;
  }
  if (ctx.tab === "ticket") {
    const tk = ctx.screen ? ss.ticket(ctx.screen.floor) : null;
    if (ctx.mode !== "TRAINING" || !tk) {
      view.innerHTML = `<h2 class="h">Ticket</h2><div class="card"><p style="margin:0 0 8px">${ctx.mode === "MISSION" ? "PRIM3 MISSION: the briefing is in the game. This console reflects the mission's sandbox outages." : "WORKPLACE is normal operations: there is no ticket, and nothing on the consoles can be changed."}</p><p class="muted" style="margin:0">Open a screen from the building in <b>Training</b> mode for a guided ticket from the canonical scenario pack.</p></div>`;
      return;
    }
    const t = tk.seed.ticket;
    const cls = tk.status === "resolved" ? "ok" : tk.status === "open" ? "warn" : "";
    view.innerHTML = `
      <h2 class="h">Training ticket</h2>
      <div class="card grid">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="pill ${cls}">${esc(tk.status)}</span><span class="mono muted" style="font-size:12px">${esc(tk.seed.source_lab_id)}</span></div>
        <div><b style="font-size:18px">${esc(t.title)}</b>${t.reporter ? `<div class="muted" style="font-size:13px">Reported by ${esc(t.reporter)}</div>` : ""}</div>
        <p style="margin:0">${esc(t.issue_report)}</p>
        ${(t.known || []).length ? `<ul style="margin:0;padding-left:18px;color:var(--muted)">${t.known.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}
        ${t.goal ? `<p style="margin:0"><b>Goal.</b> ${esc(t.goal)}</p>` : ""}
      </div>
      <h2 class="h" style="margin-top:18px">Method</h2>
      <div class="list">${[["Observe", "What is the symptom, and who is affected?"], ["Hypothesize", "Power → link → VLAN/IP → service → application."], ["Test", "ping · show interfaces status · ip addr · systemctl status"], ["Fix", "The smallest change that addresses the cause."], ["Verify", "The test that failed now passes."]].map(([a, b], i) => `<div class="row"><span class="mono" style="color:var(--accent);font-weight:800">${i + 1}</span><div class="t"><b>${a}</b><span>${b}</span></div><span></span></div>`).join("")}</div>
      <div class="grid two" style="margin-top:14px"><button class="btn" data-act="restart">Reopen ticket</button><button class="btn" data-act="reset">Reset sandbox</button></div>`;
    view.querySelector('[data-act="restart"]').onclick = async () => { await ctx.setTab("console"); api.run("lab start"); };
    view.querySelector('[data-act="reset"]').onclick = async () => { await ctx.setTab("console"); api.run("reset"); };
    return;
  }
  if (ctx.tab === "devices") {
    const net = shell.net;
    const lv = ctx.screen ? (ctx.screen.floor === "L7" ? "F6" : ctx.screen.floor) : "B1";
    const pick = (ids) => ids.filter(Boolean).map((id) => net.deviceStatus(id));
    const groups = [
      ["This floor", pick([`${lv}-NET-ACCESS-SW-01`, `${lv}-ICT-RACK-UPS-01`, ...net.ofType("wireless_ap").filter((x) => net.levelOf(x) === lv), ...net.ofType("camera").filter((x) => net.levelOf(x) === lv), ...net.ofType("workstation").filter((x) => net.levelOf(x) === lv)])],
      ["Core and servers (B1)", pick(["B1-NET-CORE-SW-01-I001", "B1-NET-CORE-SW-01-I002", "B1-NET-FW-01-I001", "B1-SRV-HYP-01-I001", "B1-SRV-HYP-01-I002", "B1-SRV-HYP-01-I003", "B1-SRV-NAS-01", "B1-SEC-NVR-01"])],
      ["Services", pick(["LOGIC-SVC-DNS", "LOGIC-SVC-DHCP", "LOGIC-SVC-NTP", "LOGIC-SVC-VMS", "LOGIC-SVC-AAA-RADIUS"])],
    ];
    const sshable = (id) => ["access_switch", "collapsed_core_switch", "firewall", "edge_router", "rack_ups", "virtualization_host", "nas_storage", "backup_appliance", "vms_nvr", "workstation"].includes(net.typeOf(id));
    view.innerHTML = groups.map(([g, rows]) => `<h2 class="h" style="margin-top:14px">${esc(g)}</h2><div class="list">${rows.filter((d) => d.host).map((d) => {
      const bad = d.availability === "unavailable" || !d.reachable, warn = d.availability === "degraded";
      return `<button class="row" type="button" data-run="${sshable(d.id) ? "ssh" : "ping"} ${esc(d.host)}"><span class="dot ${bad ? "err" : warn ? "warn" : ""}"></span><div class="t"><b class="mono">${esc(d.host)}</b><span>${esc(d.ip || "—")} · ${esc(bad ? d.reason || "unreachable" : warn ? "degraded" : "up")}</span></div><span class="pill">${sshable(d.id) ? "ssh" : "ping"}</span></button>`;
    }).join("")}</div>`).join("");
    view.onclick = async (e) => { const b = e.target.closest("[data-run]"); if (!b) return; const cmd = b.dataset.run; await ctx.setTab("console"); api.run(cmd); };
    return;
  }
  if (ctx.tab === "manual") {
    const sel = new URLSearchParams(location.search).get("man");
    const topics = Object.keys(MAN);
    view.innerHTML = `<h2 class="h">Manual</h2><p class="muted" style="margin:0 0 12px;font-size:13px">Each page teaches the idea first (A+, Network+, Security+ depth), then the command.</p><div class="list">${topics.map((k) => `<button class="row" type="button" data-man="${k}"><span class="mono" style="color:var(--accent);font-weight:800">$</span><div class="t"><b class="mono">${esc(k)}</b><span>${esc(MAN[k].summary)}</span></div><span class="muted">›</span></button>`).join("")}</div>`;
    view.onclick = async (e) => { const b = e.target.closest("[data-man]"); if (!b) return; await ctx.setTab("console"); api.run("man " + b.dataset.man); };
    void sel;
  }
}

bootApp({
  id: "terminal", title: "Terminal", defaultTab: "console", render,
  tabs: [{ id: "console", label: "Console", icon: "term" }, { id: "ticket", label: "Ticket", icon: "ticket" }, { id: "devices", label: "Devices", icon: "devices" }, { id: "manual", label: "Manual", icon: "book" }, { id: "hardware", label: "Hardware", icon: "devices" }],
});
