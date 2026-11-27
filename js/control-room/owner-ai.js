/* Owner AI presentation helpers. No network, credentials, storage, or second
   conversation model. The Control Room owns state and its authenticated calls. */
(function () {
  "use strict";
  function esc(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function safeLink(value) {
    var v = String(value || "").trim();
    return /^(https?:\/\/|mailto:)/i.test(v) && !/[\u0000-\u0020\u007f]/.test(v) ? v : null;
  }
  function inline(value) {
    var tokens = [];
    var source = String(value || "").replace(/\u0000/g, "");
    function keep(html) { tokens.push(html); return "\u0000" + (tokens.length - 1) + "\u0000"; }
    function restore(text) { return text.replace(/\u0000(\d+)\u0000/g, function (_, index) { return tokens[Number(index)] || ""; }); }
    source = source.replace(/`([^`\n]+)`/g, function (_, code) { return keep("<code>" + esc(code) + "</code>"); });
    source = source.replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, function (_, label, url) {
      var href = safeLink(url);
      return keep(href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + restore(esc(label)) + '</a>' : restore(esc(label + " (" + url + ")")));
    });
    source = esc(source).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(?:^|\s)\*([^*\n]+)\*/g, " <em>$1</em>");
    return restore(source);
  }
  function tableCells(line) {
    var source = line.trim().replace(/^\|/, "").replace(/\|$/, ""), cells = [], cell = "", code = false;
    for (var i = 0; i < source.length; i += 1) {
      if (source[i] === "\\" && source[i + 1] === "|") { cell += "|"; i += 1; }
      else if (source[i] === "`") { code = !code; cell += source[i]; }
      else if (source[i] === "|" && !code) { cells.push(cell.trim()); cell = ""; }
      else cell += source[i];
    }
    cells.push(cell.trim()); return cells;
  }
  /* Deliberately bounded Markdown subset: raw HTML is always literal; code
     fences never pass through inline formatting; URLs have an allowlist. */
  function markdown(value) {
    var lines = String(value || "").replace(/\r\n?/g, "\n").split("\n"), html = [], paragraph = [], list = [], ordered = false, code = null, language = "", table = null, skipSeparator = false;
    function flushParagraph() { if (paragraph.length) { html.push("<p>" + paragraph.map(inline).join("<br>") + "</p>"); paragraph = []; } }
    function flushList() { if (list.length) { var tag = ordered ? "ol" : "ul"; html.push("<" + tag + ">" + list.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + "</" + tag + ">"); list = []; } }
    function flushCode() {
      html.push('<div class="cr-ai-code"><div class="cr-ai-code__head"><span>' + esc(language || "Code") + '</span><button type="button" class="cr-ai-textbtn" data-action="ai-copy-code">Copy code</button></div><pre><code>' + esc(code.join("\n")) + '</code></pre></div>'); code = null; language = "";
    }
    function flushTable() {
      if (!table) return;
      html.push('<div class="cr-ai-table"><table><thead><tr>' + table.head.map(function (cell) { return '<th scope="col">' + inline(cell) + '</th>'; }).join('') + '</tr></thead><tbody>' + table.rows.map(function (row) { return '<tr>' + row.map(function (cell) { return '<td>' + inline(cell) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>'); table = null;
    }
    lines.forEach(function (line, index) {
      if (skipSeparator) { skipSeparator = false; return; }
      if (table) {
        var row = tableCells(line);
        if (line.indexOf('|') >= 0 && row.length === table.head.length) { table.rows.push(row); return; }
        flushTable();
      }
      if (/^\s*```/.test(line)) {
        if (code !== null) { flushCode(); return; }
        flushParagraph(); flushList(); code = []; language = line.trim().slice(3).trim().slice(0, 32); return;
      }
      if (code !== null) { code.push(line); return; }
      if (line.indexOf('|') >= 0 && index + 1 < lines.length) {
        var head = tableCells(line), separator = tableCells(lines[index + 1]);
        if (head.length >= 2 && head.length <= 12 && separator.length === head.length && separator.every(function (cell) { return /^:?-{3,}:?$/.test(cell); })) {
          flushParagraph(); flushList(); table = { head: head, rows: [] }; skipSeparator = true; return;
        }
      }
      if (!line.trim()) { flushParagraph(); flushList(); return; }
      var heading = /^(#{1,4})\s+(.+)$/.exec(line), item = /^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(line);
      if (heading) { flushParagraph(); flushList(); var level = heading[1].length + 2; html.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">"); return; }
      if (item) { flushParagraph(); var isOrdered = !item[1]; if (list.length && ordered !== isOrdered) flushList(); ordered = isOrdered; list.push(item[2]); return; }
      flushList();
      if (/^>\s?/.test(line)) { flushParagraph(); html.push("<blockquote>" + inline(line.replace(/^>\s?/, "")) + "</blockquote>"); return; }
      paragraph.push(line);
    });
    flushParagraph(); flushList(); flushTable(); if (code !== null) flushCode();
    return html.join("");
  }
  var STATES = {
    pending: ["Pending", "Finish setup on the target Mac. Sign in there, open Devices, and choose Finish setup."],
    connected: ["Connected", "Ollama must be running locally with qwen3:8b installed. Then run Test device."],
    model_ready: ["Model ready", "Run Test device to verify a real job on this worker."],
    test_passed: ["Test passed", "Ready for jobs. Keep this Mac awake and connected to the internet."],
    offline: ["Offline", "Wake the Mac and check Wi-Fi, then restart its McCluster worker. It reconnects with its own key."],
    paused: ["Paused", "Resume to accept new jobs. Work already leased follows the existing lease rules."],
    revoked: ["Revoked", "This device cannot receive new work. Install and enroll again with a new credential to restore access."]
  };
  function deviceState(device) { return STATES[device && device.state] ? device.state : "offline"; }
  function deviceName(device) { return String(device && (device.display_name || device.name || device.node_id || device.id) || "Unnamed device"); }
  function deviceId(device) { return String(device && (device.node_id || device.id) || ""); }
  function shellQuote(value) { return "'" + String(value || "").replace(/'/g, "'\\''") + "'"; }
  function cleanupCommand(device) {
    var id = device && device.cleanup && device.cleanup.reservation_id;
    return id ? "node core/src/compute/pair-adapter.mjs cleanup --config ./mccluster-pair-probe.json --reservation-id " + shellQuote(id) : "";
  }
  function stateLabel(device) { return STATES[deviceState(device)][0]; }
  function recovery(device) { return String(device && device.recovery || STATES[deviceState(device)][1]); }
  function route(selection, implementation, target) {
    var value = String(selection || "auto"), result = { mode: "auto", implementation: implementation || "qwen3.8b.local" };
    if (value.indexOf("node:") === 0) { result.mode = "node"; result.node_id = value.slice(5); if (target) result.target = target; }
    else if (value.indexOf("pair:") === 0) { result.mode = "pair"; result.pair_id = value.slice(5); result.implementation = "qwen3.5.27b.pair"; }
    else if (value !== "auto") result.mode = "unavailable";
    return result;
  }
  function nodeLabel(node) {
    if (!node || typeof node !== "object") return "Device not yet reported";
    return node.node_name || node.display_name || node.node_id || (node.route === "local" ? "OVH" : "Device not yet reported");
  }
  var TARGET_LABELS = { ovh: "OVH CPU", prime: "Prime GPU", connected: "Connected inference" };
  function targetRole(device) {
    var target = device && device.target;
    return Object.prototype.hasOwnProperty.call(TARGET_LABELS, target) ? target : "";
  }
  function targetReady(device, now) {
    var age = (now == null ? Date.now() : now) - Date.parse(device && device.last_seen_at);
    return Boolean(targetRole(device) && device.target_ready === true && device.eligible === true &&
      Number.isFinite(age) && age >= 0 && age < 180000);
  }
  function familyStatus(devices, inventoryKnown, now) {
    return Object.keys(TARGET_LABELS).map(function (key) {
      var members = devices.filter(function (device) { return targetRole(device) === key; });
      var status = "Not confirmed";
      if (inventoryKnown) {
        if (members.some(function (device) { return targetReady(device, now); })) status = "Ready";
        else if (members.length && members.every(function (device) { return device.state === "offline"; })) status = "Offline";
        else if (key === "prime" && !members.length) status = "Needs pairing";
        else status = "Unavailable";
      }
      return { key: key, label: TARGET_LABELS[key], status: status };
    });
  }
  function requestedTarget(requested) {
    if (!requested || typeof requested !== "object") return "Not recorded";
    if (requested.mode === "node") return TARGET_LABELS[targetRole(requested)] || requested.node_id || "Not recorded";
    if (requested.mode === "pair") return "Deep Reasoning (two-Mac pair)";
    return requested.mode === "auto" ? "Auto" : "Not recorded";
  }
  function receipt(message) {
    message = message || {};
    var meta = message.metadata || {}, node = meta.node || {}, fallback = meta.fallback_reason || node.fallback_reason;
    var parts = [nodeLabel(node)];
    if (node.model || message.model) parts.push(node.model || message.model);
    if (node.hardware_mode) parts.push(node.hardware_mode);
    var rate = Number(node.generation_tokens_per_second);
    if (Number.isFinite(rate) && rate > 0) parts.push(rate.toFixed(1) + " tok/s");
    return { label: parts.join(" · "), fallback: fallback ? String(fallback) : "", node_id: node.node_id || null, turn_id: meta.agent_job_id || null,
      requested: meta.requested_route || null, served: nodeLabel(node), model: node.model || message.model || null,
      task_id: message.compute_task_id || null, node_ids: Array.isArray(node.node_ids) ? node.node_ids : [],
      backend: node.route === "fabric" ? "McCluster compute" : node.route === "local" ? "Core local" : node.route === "pair" ? "Two-Mac shared runtime" : null };
  }
  window.CR = window.CR || {};
  window.CR.ownerAi = { esc: esc, safeLink: safeLink, markdown: markdown, route: route, deviceState: deviceState, deviceName: deviceName, deviceId: deviceId, stateLabel: stateLabel, recovery: recovery, nodeLabel: nodeLabel, receipt: receipt, cleanupCommand: cleanupCommand, targetRole: targetRole, targetReady: targetReady, familyStatus: familyStatus, requestedTarget: requestedTarget };
})();
