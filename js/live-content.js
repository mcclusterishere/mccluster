/* Site-entry privacy acknowledgement.
   Runs before the live-content fetch because this file is loaded in the head
   across the public property. This is notice acknowledgement, not a blanket
   override of browser/OS permissions or privacy signals. */
(function (w, d) {
  "use strict";
  var VERSION = "2026-09-26";
  var KEY = "mcc_privacy_ack";
  var page = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  function readAck() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (v && v.version === VERSION) return true;
    } catch (_) {}
    try {
      var s = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (s && s.version === VERSION) return true;
    } catch (_) {}
    return document.cookie.split(";").some(function (part) {
      return part.trim() === KEY + "=" + VERSION;
    });
  }

  function writeAck() {
    var value = { version: VERSION, accepted_at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch (_) {}
    try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch (_) {}
    try { document.cookie = KEY + "=" + VERSION + "; Max-Age=31536000; Path=/; SameSite=Lax; Secure"; } catch (_) {}
    w.MCC_PRIVACY_ACK = value;
  }

  w.MCC_PRIVACY = {
    version: VERSION,
    accepted: readAck,
    acknowledge: writeAck
  };

  /* The policy itself must remain readable before acknowledgement. */
  if (page === "privacy.html" || readAck()) return;

  /* PUBLIC DOCUMENT PAGES: THE NOTICE AS A BANNER, NOT A WALL.

     A page that carries <meta name="mcc-privacy-notice" content="banner">
     in its head (before this script) is a document meant to be read cold:
     the résumé a hiring manager opens from an application, the press kit,
     the engineering record, the music catalogue, the newsroom. On those
     the notice is a bar along the bottom of the screen instead of a
     full-screen dialog that hides the page.

     Nothing about what is recorded changes. js/analytics.js still records
     nothing, sets no device or session id and registers no service worker
     until the notice is acknowledged; this branch only decides whether the
     words on the page can be read first. Acknowledging here does not
     reload the page, so recording begins on the next page view.

     Why: Google's guidance on interstitials says a dialog covering the
     content "make[s] it hard for Google and other search engines to
     understand your content" and recommends a banner instead; browser
     agents acting for a person hit the same wall; and a recruiter who has
     to accept a policy before seeing a résumé often does not. Pages that
     are the house itself (accounts, the network, the desks) keep the gate.
     Opt a page in by adding the meta; there is no list to keep here. */
  var noticeMeta = d.querySelector('meta[name="mcc-privacy-notice"]');
  if (noticeMeta && noticeMeta.getAttribute("content") === "banner") {
    var bannerStyle = d.createElement("style");
    bannerStyle.id = "mccPrivacyNoticeStyle";
    bannerStyle.textContent =
      '#mccPrivacyNotice{position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483646;' +
      'padding:10px 12px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:#15110f;' +
      'color:#f5efe6;font:14px/1.4 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.45)}' +
      '#mccPrivacyNotice p{margin:0 0 8px;color:#d8cfc3}' +
      '#mccPrivacyNotice .mccpn__actions{display:flex;flex-wrap:wrap;gap:6px}' +
      '#mccPrivacyNotice a,#mccPrivacyNotice button{min-height:40px;border-radius:9px;padding:8px 12px;' +
      'font:inherit;font-weight:700;text-align:center;cursor:pointer}' +
      '#mccPrivacyNotice a{border:1px solid rgba(255,255,255,.25);color:#f5efe6;text-decoration:none}' +
      '#mccPrivacyNotice .mccpn__agree{border:0;background:#f5efe6;color:#0b0908}' +
      '#mccPrivacyNotice .mccpn__later{border:1px solid rgba(255,255,255,.25);background:transparent;color:#f5efe6}' +
      '@media (min-width:720px){#mccPrivacyNotice{left:auto;right:20px;bottom:20px;max-width:520px}}' +
      /* a fixed bar prints on every page: never on paper (the résumé PDF
         is printed from these pages by tools/build-resume.mjs) */
      '@media print{#mccPrivacyNotice{display:none!important}}';
    (d.head || d.documentElement).appendChild(bannerStyle);
    var mountBanner = function () {
      if (d.getElementById("mccPrivacyNotice")) return;
      var bar = d.createElement("div");
      bar.id = "mccPrivacyNotice";
      bar.setAttribute("role", "region");
      bar.setAttribute("aria-label", "Privacy notice");
      bar.innerHTML =
        /* Short on purpose: Google's guidance is a banner that takes "a small
           fraction of the screen". The full notice is one tap away. */
        '<p>Nothing from this visit is recorded until you agree to the Privacy Policy. ' +
        'It is notice, not blanket consent: location and device permissions keep their own controls.</p>' +
        '<div class="mccpn__actions">' +
        '<button type="button" class="mccpn__agree" id="mccPrivacyNoticeAgree">I agree &amp; continue</button>' +
        '<a href="/privacy.html">Privacy Policy</a>' +
        '<button type="button" class="mccpn__later" id="mccPrivacyNoticeLater">Not now</button>' +
        '</div>';
      d.body.appendChild(bar);
      d.getElementById("mccPrivacyNoticeAgree").addEventListener("click", function () {
        writeAck();
        bar.remove();
      });
      d.getElementById("mccPrivacyNoticeLater").addEventListener("click", function () {
        bar.hidden = true;
      });
    };
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", mountBanner, { once: true });
    else mountBanner();
    return;
  }

  d.documentElement.setAttribute("data-privacy-gate", "pending");
  var style = d.createElement("style");
  style.id = "mccPrivacyGateStyle";
  style.textContent =
    'html[data-privacy-gate="pending"] body{overflow:hidden!important}' +
    'html[data-privacy-gate="pending"] body>*:not(#mccPrivacyGate){visibility:hidden!important;pointer-events:none!important}' +
    '#mccPrivacyGate{visibility:visible!important;position:fixed;inset:0;z-index:2147483647;' +
    'display:grid;place-items:center;padding:20px;background:#0b0908;color:#f5efe6;font:16px/1.5 system-ui,sans-serif}' +
    '#mccPrivacyGate .mccpg__card{width:min(100%,560px);padding:24px;border:1px solid rgba(255,255,255,.18);' +
    'border-radius:18px;background:#15110f;box-shadow:0 24px 80px rgba(0,0,0,.5)}' +
    '#mccPrivacyGate h1{margin:0 0 12px;font-size:1.45rem;line-height:1.1}' +
    '#mccPrivacyGate p{margin:0 0 14px;color:#d8cfc3}' +
    '#mccPrivacyGate .mccpg__actions{display:grid;gap:10px;margin-top:18px}' +
    '#mccPrivacyGate a,#mccPrivacyGate button{min-height:48px;border-radius:12px;padding:12px 16px;font:inherit;font-weight:700;text-align:center}' +
    '#mccPrivacyGate a{border:1px solid rgba(255,255,255,.25);color:#f5efe6;text-decoration:none}' +
    '#mccPrivacyGate button{border:0;background:#f5efe6;color:#0b0908;cursor:pointer}' +
    '#mccPrivacyGate small{display:block;margin-top:12px;color:#a99d91}';
  (d.head || d.documentElement).appendChild(style);

  function mount() {
    if (d.getElementById("mccPrivacyGate")) return;
    var gate = d.createElement("div");
    gate.id = "mccPrivacyGate";
    gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true");
    gate.setAttribute("aria-labelledby", "mccPrivacyGateTitle");
    gate.innerHTML =
      '<div class="mccpg__card">' +
      '<h1 id="mccPrivacyGateTitle">Privacy before entry</h1>' +
      '<p>McCluster records account, device, network, location and activity data as described in the Privacy Policy. Review it before entering.</p>' +
      '<p><b>This acknowledgement is not blanket consent.</b> Precise location and other protected device permissions still use their own browser or operating-system controls, and privacy signals remain honored.</p>' +
      '<div class="mccpg__actions">' +
      '<a href="/privacy.html">Review the Privacy Policy</a>' +
      '<button type="button" id="mccPrivacyAgree">I agree &amp; continue</button>' +
      '</div>' +
      '<small>Privacy notice version 2026-09-26</small>' +
      '</div>';
    d.body.appendChild(gate);
    var btn = d.getElementById("mccPrivacyAgree");
    btn.addEventListener("click", function () {
      writeAck();
      location.reload();
    });
    btn.focus();
  }

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})(window, document);

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
  /* A root page is keyed by its file name, as it always was. A page in a
     folder keeps the folder (/action/ is "action/index.html"), so it can
     never pick up the home page's edits by sharing the name index.html. */
  var PAGE = (function (p) {
    p = p.toLowerCase();
    var cut = p.lastIndexOf("/");
    return p.slice(1, cut + 1) + (p.slice(cut + 1) || "index.html");
  })(location.pathname);

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
