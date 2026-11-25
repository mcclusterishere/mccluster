/* Policy lab evidence browser (Floor 5): the evidence this session produced at the building's consoles (every
   sandbox fix, with the command, the target, the fault it cleared and the transcript tail), sealed with a SHA-256
   over its canonical JSON; the floors' case files from the canonical scenario pack; and an export.
   Automation ceiling: Demonstrated. Nothing here awards Verified / Applied / Mentor (lab runtime Step 6). */

import { bootApp } from "../app-shell.mjs";
import { loadSession } from "../state.mjs";

const canon = (v) => JSON.stringify(v, Object.keys(v).sort());
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function records() {
  /* training evidence lives in the TRAINING session; this browser reads it from any mode, never writes it */
  return (loadSession("TRAINING").evidence || []).map((r, i) => ({ ...r, n: i + 1 }));
}

async function render(ctx) {
  const { view, esc, registry } = ctx;
  const all = records();
  if (ctx.tab === "evidence") {
    const q = (ctx._q || "").toLowerCase();
    const list = all.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q)).reverse();
    view.innerHTML = `
      <div class="field"><label for="q">Search evidence</label><input id="q" type="search" placeholder="fault, host, floor, command" value="${esc(ctx._q || "")}" autocomplete="off"></div>
      <h2 class="h" style="margin-top:14px">${all.length} record${all.length === 1 ? "" : "s"} · this session</h2>
      ${list.length ? `<div class="list">${list.map((r) => `<button class="row" type="button" data-rec="${r.n}"><span class="dot"></span><div class="t"><b>${esc(r.fault_ids.join(", "))}</b><span class="mono">${esc(r.floor)} · ${esc(r.command)} · ${esc(r.target)}</span></div><span class="mono muted" style="font-size:11px">${esc(r.at.slice(11, 16))}</span></button>`).join("")}</div>`
        : `<div class="card empty">No evidence yet.<br><span style="font-size:13px">Open a console in Training mode, resolve a ticket, and the fix lands here with its transcript and hash.</span></div>`}
      ${ctx._sel ? '<div data-detail style="margin-top:14px"></div>' : ""}`;
    const input = view.querySelector("#q");
    input.addEventListener("input", () => { ctx._q = input.value; const pos = input.selectionStart; render(ctx).then(() => { const i = view.querySelector("#q"); i.focus(); i.setSelectionRange(pos, pos); }); });
    if (ctx._sel) {
      const r = all.find((x) => x.n === ctx._sel);
      if (r) {
        const { n, ...body } = r;
        const digest = await sha256(canon(body));
        view.querySelector("[data-detail]").innerHTML = `<div class="card grid">
          <div style="display:flex;justify-content:space-between;gap:8px"><b>Record ${n}</b><span class="pill ok">demonstrated</span></div>
          <div class="mono" style="font-size:12px;word-break:break-all;color:var(--muted)">sha256 ${digest}</div>
          <div class="grid two" style="font-size:13px"><div><span class="muted">Floor</span><br>${esc(r.floor)}</div><div><span class="muted">Mode</span><br>${esc(r.mode)}</div><div><span class="muted">Target</span><br class="mono">${esc(r.target)}</div><div><span class="muted">Execution</span><br>SANDBOX · live off</div></div>
          <div><span class="muted" style="font-size:12px">Transcript tail</span><pre class="mono" style="margin:6px 0 0;padding:10px;border-radius:10px;background:var(--bg-2);border:1px solid var(--line);font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto">${esc((r.transcript || []).join("\n"))}</pre></div>
          <p class="muted" style="margin:0;font-size:12px">Machine evidence tops out at Demonstrated. A reviewer, not this page, decides anything above it.</p></div>`;
      }
    }
    return;
  }
  if (ctx.tab === "cases") {
    const tr = loadSession("TRAINING");
    view.innerHTML = `<h2 class="h">Case files · one per floor</h2><div class="list">${Object.entries(registry.training_seeds).map(([f, s]) => {
      const st = tr.seeded && tr.seeded[f] ? (tr.resolved || []).some((x) => x.endsWith("@" + f)) ? "resolved" : tr.seeded[f] === "cleared" ? "closed" : "open" : "not started";
      return `<div class="row"><b class="mono" style="color:var(--accent);width:28px">${f}</b><div class="t"><b>${esc(s.ticket.title)}</b><span>${esc(s.source_lab_id)} · ${esc(s.scenario_id)}</span></div><span class="pill ${st === "resolved" ? "ok" : st === "open" ? "warn" : ""}">${esc(st)}</span></div>`;
    }).join("")}</div>
      <p class="muted" style="font-size:12px;margin-top:12px">Case files come from the canonical distributed scenario pack. Open any floor's screen in Training mode to work its case.</p>`;
    return;
  }
  view.innerHTML = `<h2 class="h">Export</h2><div class="card grid"><p style="margin:0">Download this session's evidence as JSON (canonical order, with per-record SHA-256).</p><button class="btn primary block" data-export ${all.length ? "" : "disabled"}>Download evidence.json</button>
    <p class="muted" style="margin:0;font-size:12px">The file stays on your device. Durable learning evidence belongs to the platform's learning-evidence service, not this page.</p></div>
    <h2 class="h" style="margin-top:16px">Floor 5 surfaces</h2><div class="list">${registry.screens.filter((s) => s.floor === "F5" && s.kind !== "evidence_terminal").map((s) => `<div class="row"><span></span><div class="t"><b>${esc(s.label)}</b><span>${esc(s.room.label)}</span></div><span class="pill">${esc(s.app.variant)}</span></div>`).join("")}</div>`;
}

bootApp({
  id: "evidence", title: "Evidence", defaultTab: "evidence",
  tabs: [{ id: "evidence", label: "Evidence", icon: "search" }, { id: "cases", label: "Cases", icon: "list" }, { id: "export", label: "Export", icon: "book" }],
  async render(ctx) {
    if (!ctx._wired) {
      ctx._wired = true;
      ctx.view.addEventListener("click", async (e) => {
        const r = e.target.closest("[data-rec]"); if (r) { ctx._sel = Number(r.dataset.rec); await render(ctx); ctx.view.querySelector("[data-detail]")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
        if (e.target.closest("[data-export]")) {
          const out = [];
          for (const rec of records()) { const { n, ...body } = rec; out.push({ ...body, sha256: await sha256(canon(body)) }); }
          const blob = new Blob([JSON.stringify({ schema: "eu-screens-evidence/v1", execution_target: "SANDBOX", automation_ceiling: "Demonstrated", records: out }, null, 2)], { type: "application/json" });
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "equity-uprise-sandbox-evidence.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        }
      });
    }
    await render(ctx);
  },
});
