/* ============================================================
   LIVE CONTENT — applies the owner's edits to the page.

   Runs for EVERY visitor, which is the point: the overrides are the
   page. It loads early, fetches the rows for this URL, and swaps the
   text in before anything has a chance to be read.

   THE HTML IN GIT IS NEVER REWRITTEN. That is deliberate and it is what
   makes every edit reversible: deleting the row restores the shipped
   copy exactly, with no diff to unpick and no deploy to wait for.

   FAILURE IS SILENT AND SAFE. If Supabase is slow, blocked, offline, or
   the visitor is on a plane, nothing here throws and nothing is hidden:
   the page simply shows the copy that shipped with it. A CMS that blanks
   the site when its database is unreachable is worse than no CMS.
   ============================================================ */
(function (w, d) {
  "use strict";

  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var PAGE = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  /* PRIVACY ENTRY GATE.
     This is an acknowledgement of the published notice, not a browser-
     permission bypass. In particular it cannot grant geolocation: the
     browser/OS remains the authority for precise location. The gate runs
     before this file's own CMS request, and analytics.js also reads the
     same state before creating a device/session identifier. */
  var PRIVACY_VERSION = "2026-09-26";
  var PRIVACY_KEY = "mcc_privacy_ack";
  function privacyAccepted() {
    try { return localStorage.getItem(PRIVACY_KEY) === PRIVACY_VERSION; }
    catch (e) { return false; }
  }
  function acceptPrivacy() {
    try { localStorage.setItem(PRIVACY_KEY, PRIVACY_VERSION); }
    catch (e) {
      try { sessionStorage.setItem(PRIVACY_KEY, PRIVACY_VERSION); } catch (_) {}
    }
    location.reload();
  }
  var privacyOk = privacyAccepted();
  if (!privacyOk) {
    try { privacyOk = sessionStorage.getItem(PRIVACY_KEY) === PRIVACY_VERSION; } catch (_) {}
  }
  w.MCC_PRIVACY = {
    version: PRIVACY_VERSION,
    acknowledged: privacyOk,
    accept: acceptPrivacy
  };

  function mountPrivacyGate() {
    if (PAGE === "privacy.html" || privacyOk || d.getElementById("mccPrivacyGate")) return;
    var style = d.createElement("style");
    style.textContent =
      "#mccPrivacyGate{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:#080b0f;color:#f4f5f7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}" +
      "#mccPrivacyGate *{box-sizing:border-box}" +
      "#mccPrivacyGate .pg{width:min(100%,520px);padding:24px;border:1px solid #303846;border-radius:18px;background:#12161c}" +
      "#mccPrivacyGate h1{margin:0 0 10px;font-size:clamp(24px,7vw,38px);line-height:1}" +
      "#mccPrivacyGate p{margin:0 0 14px;color:#b6bec9;line-height:1.55;font-size:15px}" +
      "#mccPrivacyGate a{color:#fff;text-decoration:underline}" +
      "#mccPrivacyGate button{width:100%;min-height:48px;margin-top:8px;border:0;border-radius:11px;background:#fff;color:#080b0f;font:800 max(16px,1rem)/1 system-ui;cursor:pointer}";
    (d.head || d.documentElement).appendChild(style);
    var gate = d.createElement("div");
    gate.id = "mccPrivacyGate";
    gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true");
    gate.setAttribute("aria-labelledby", "mccPrivacyTitle");
    gate.innerHTML =
      '<div class="pg"><h1 id="mccPrivacyTitle">Before you enter.</h1>' +
      '<p>McCluster uses first-party analytics to record activity on its own services, including IP address, approximate network-derived location, browser/device/network details, and what is used or played.</p>' +
      '<p>Precise device location is separate: this acknowledgement cannot grant it. Your browser or operating system still controls that permission.</p>' +
      '<p><a href="privacy.html">Read the Privacy Notice</a> before continuing.</p>' +
      '<button type="button" id="mccPrivacyAccept">I agree and continue</button></div>';
    d.body.appendChild(gate);
    d.documentElement.style.overflow = "hidden";
    var b = d.getElementById("mccPrivacyAccept");
    if (b) b.addEventListener("click", acceptPrivacy);
  }

  if (PAGE !== "privacy.html" && !privacyOk) {
    d.documentElement.setAttribute("data-privacy-pending", "1");
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", mountPrivacyGate, { once: true });
    else mountPrivacyGate();
    return;
  }

  /* A stable name for an element that has no data-edit of its own.
     Structural only -- tag, id, class and sibling index -- so it keeps
     working when the TEXT changes, which is the thing being edited. It
     still breaks if the element is moved, which is why rows keyed this
     way are stored `fragile` and the editor says so. */
  function pathOf(node) {
    if (node.getAttribute && node.getAttribute("data-edit")) {
      return node.getAttribute("data-edit");
    }
    var parts = [];
    for (var el = node; el && el.nodeType === 1 && el !== d.body; el = el.parentElement) {
      if (el.id) { parts.unshift("#" + el.id); break; }
      var tag = el.tagName.toLowerCase();
      var cls = (el.className && typeof el.className === "string")
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      var i = 1, sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) i++;
      parts.unshift(tag + cls + ":" + i);
    }
    return parts.join(">");
  }
  w.MCC_SLOT_PATH = pathOf;

  function findSlot(slot) {
    var tagged = d.querySelector('[data-edit="' + (w.CSS && CSS.escape ? CSS.escape(slot) : slot) + '"]');
    if (tagged) return tagged;
    /* Generated paths are ours, not CSS -- walk them rather than
       handing an invalid selector to querySelector. */
    if (slot.indexOf(">") < 0 && slot.charAt(0) !== "#") return null;
    var parts = slot.split(">"), node = d.body;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.charAt(0) === "#") { node = d.getElementById(p.slice(1)); if (!node) return null; continue; }
      var m = /^([a-z0-9-]+)((?:\.[^.:]+)*):(\d+)$/i.exec(p);
      if (!m) return null;
      var want = m[1].toUpperCase(), n = Number(m[3]), seen = 0, found = null;
      var kids = node.children || [];
      for (var k = 0; k < kids.length; k++) {
        if (kids[k].tagName === want && ++seen === n) { found = kids[k]; break; }
      }
      if (!found) return null;
      node = found;
    }
    return node;
  }
  w.MCC_FIND_SLOT = findSlot;

  function apply(rows) {
    (rows || []).forEach(function (r) {
      var node = findSlot(r.slot);
      if (!node) return;                       // markup moved on: leave the original
      try {
        if (r.kind === "hidden") { node.hidden = (r.value === "1" || r.value === "true"); }
        else if (r.kind === "html") { node.innerHTML = r.value; }
        else if (r.kind === "order") {
          var order = String(r.value).split(",").map(Number);
          var kids = Array.prototype.slice.call(node.children);
          order.forEach(function (idx) { if (kids[idx]) node.appendChild(kids[idx]); });
        } else { node.textContent = r.value; }
        node.setAttribute("data-edited", "1");
      } catch (e) { /* one bad row must not stop the rest */ }
    });
    d.documentElement.setAttribute("data-content-loaded", "1");
    w.dispatchEvent(new CustomEvent("mcc:content-applied"));
  }

  fetch(SB + "/rest/v1/site_content?select=slot,kind,value&page=eq." +
        encodeURIComponent(PAGE) + "&limit=500",
        { headers: { apikey: KEY }, cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(apply)
    .catch(function () { d.documentElement.setAttribute("data-content-loaded", "offline"); });
})(window, document);
