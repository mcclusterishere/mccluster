/* device.html: the owner opts this device into the node network with one tap (js/device-node.js;
   core/src/compute/device-grant.mjs). Phone first. */
(function () {
  "use strict";
  var COMPUTE = (window.MCC_COMPUTE_URL || "https://compute.mccluster.org").replace(/\/$/, "");
  var REPO = "https://github.com/mcclusterishere/mccluster";
  var $ = function (id) { return document.getElementById(id); };
  var D = window.MCC_DEVICE_NODE, node = null, measured = null;
  function say(t) { $("dnMsg").textContent = t || ""; }
  function gb(bytes) { return bytes ? (Math.round(bytes / 1073741824 * 10) / 10) + " GB" + (bytes >= 8 * 1073741824 ? " or more" : "") : "not shown by this browser"; }
  function os() {
    var p = String((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "") + " " + navigator.userAgent;
    if (/iPhone|iPad|Android/i.test(p)) return "phone";
    if (/Mac/i.test(p)) return "mac";
    if (/Win/i.test(p)) return "windows";
    if (/Linux|CrOS/i.test(p)) return "linux";
    return "other";
  }
  function facts(m) {
    var rows = [
      ["Kind", m.mobile || os() === "phone" ? "Phone or tablet" : "Computer"],
      ["Processor threads", m.cpu_count || "not shown"],
      ["Memory", gb(m.memory_bytes)],
      ["Graphics (WebGPU)", m.gpu ? (m.gpu.vendor + " " + m.gpu.model).trim() : "not available in this browser"]
    ];
    $("dnFacts").innerHTML = rows.map(function (r) { return "<div><dt>" + r[0] + "</dt><dd>" + String(r[1]).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }) + "</dd></div>"; }).join("");
  }
  function state(s) {
    var el = $("dnState");
    if (s.live) {
      el.dataset.tone = "ok";
      el.textContent = "Live in the network. " + (s.capabilities && s.capabilities.length
        ? "Taking work: " + s.capabilities.map(function (c) { return c.capability; }).join(", ") + "."
        : "It is counted and measured; work for browsers is added as it is built, and this device takes it automatically.");
    } else {
      el.dataset.tone = "bad";
      el.textContent = "Not reaching the network: " + (s.error || "unknown") + ". It tries again on its own.";
    }
  }
  function grant(kind) {
    return window.MCC_SUPA.token().then(function (t) {
      if (!t) throw Object.assign(new Error("Sign in first"), { status: 401 });
      return fetch(COMPUTE + "/v1/compute/device-grants", { method: "POST", headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: JSON.stringify({ kind: kind }) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw Object.assign(new Error(j.error || ("Compute " + r.status)), { status: r.status });
        return j;
      });
    });
  }
  function joined(on) { $("dnOptIn").hidden = on; $("dnLeave").hidden = !on; }

  function boot() {
    if (!D || !window.MCC_SUPA) { say("This page did not load fully. Reload it."); return; }
    D.measure().then(function (m) { measured = m; facts(m); });
    window.MCC_SUPA.token().then(function (t) {
      if (!t) { $("dnGate").hidden = false; return; }
      $("dnBrowser").hidden = false;
      $("dnFull").hidden = os() === "phone" || os() === "other";
      node = new D.DeviceNode({ computeUrl: COMPUTE, onState: state });
      return node.status().then(function (st) {
        if (!st.supported) { $("dnOptIn").disabled = true; $("dnState").textContent = "This browser cannot hold a node key. Update it, or use another browser."; return; }
        if (st.enrolled) { joined(true); return node.start(); }
      });
    }).catch(function (err) { say(err.message || "Could not start"); });

    $("dnOptIn").onclick = function () {
      var b = $("dnOptIn"); b.disabled = true; say("Opting in…");
      grant("browser").then(function (g) {
        var name = (measured && (measured.mobile || os() === "phone") ? "phone" : os()) + " browser";
        return node.optIn(g.grant, g.org_id, name);
      }).then(function () { joined(true); say(""); }, function (err) {
        say(err.status === 403 ? "Only the owner can add devices." : (err.message || "Could not opt in"));
      }).then(function () { b.disabled = false; });
    };
    $("dnLeave").onclick = function () {
      node.leave().then(function () { joined(false); $("dnState").textContent = "Left. This page no longer gives power."; delete $("dnState").dataset.tone; });
    };
    $("dnInstall").onclick = function () {
      var b = $("dnInstall"); b.disabled = true; say("Getting a one-time pass…");
      grant("installer").then(function (g) {
        var kind = os(), cmd, note;
        if (kind === "mac") {
          cmd = "git clone --depth 1 " + REPO + " ~/.mccluster-core 2>/dev/null || git -C ~/.mccluster-core pull --ff-only\n" +
            "bash ~/.mccluster-core/core/macos/mccluster-mac-node.sh install --lyrics --org " + g.org_id + " --grant " + g.grant;
          note = "Paste into Terminal. It needs Homebrew's node and ollama first (brew install node ollama python@3.11 ffmpeg). The pass works once and expires at " + new Date(g.expires_at).toLocaleTimeString() + ".";
        } else {
          cmd = "MCCLUSTER_ORG_ID=" + g.org_id + "\nMCCLUSTER_NODE_ENROLL_GRANT=" + g.grant;
          note = "Put these two lines in the node's node.env (docs/control-plane/" + (kind === "windows" ? "WINDOWS-NODE.md" : "MCCLUSTER-CORE.md") + "), then start the node. The pass works once and expires at " + new Date(g.expires_at).toLocaleTimeString() + ".";
        }
        $("dnCmd").textContent = cmd; $("dnCmdNote").textContent = note; $("dnCmdBox").hidden = false; say("");
      }, function (err) { say(err.status === 403 ? "Only the owner can add devices." : (err.message || "Could not get a pass")); })
        .then(function () { b.disabled = false; });
    };
    $("dnCopy").onclick = function () {
      var t = $("dnCmd").textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { say("Copied."); }, function () { say("Select the command and copy it."); });
    };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
