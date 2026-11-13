/* SITE-ENTRY PRIVACY NOTICE: AGREE OR LEAVE.
   Only agreement unlocks the page or enables first-party analytics.
   The Privacy Policy itself stays readable before any answer; frames defer to
   their parent page. A legacy "seen" record never authorizes entry.
   Guest and member consent remain separate from browser/OS permissions, GPC,
   Do Not Track, and each feature's own permissions. */
(function (w, d) {
  "use strict";
  var VERSION = "2026-10-19";
  var KEY = "mcc_privacy_ack";    /* agreed: {version, accepted_at}; cookie mcc_privacy_ack=<VERSION> */
  var MAX_AGE = 34560000;         /* 400 days, the longest a browser keeps any cookie */
  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  var host = String(location.hostname || "").toLowerCase();
  var cookieDomain = host === "mccluster.org" || /\.mccluster\.org$/.test(host) ? "mccluster.org" : "";
  var synced = "";

  function stored(area, key) {
    try {
      var v = JSON.parse(w[area].getItem(key) || "null");
      return v && v.version === VERSION ? v : null;
    } catch (_) { return null; }
  }
  function store(area, key, value) {
    try { w[area].setItem(key, JSON.stringify(value)); } catch (_) {}
  }
  /* document.cookie throws in a sandboxed frame and wherever cookies are blocked */
  function cookieHas(name) {
    try {
      return String(d.cookie || "").split(";").some(function (part) { return part.trim() === name + "=" + VERSION; });
    } catch (_) { return false; }
  }
  function setCookie(name) {
    try {
      d.cookie = name + "=" + VERSION + (cookieDomain ? "; Domain=" + cookieDomain : "") +
        "; Path=/; Max-Age=" + MAX_AGE + "; SameSite=Lax; Secure";
    } catch (_) {}
  }
  /* the signed-in member's session and its claims, read the way js/backend.js reads them */
  /* mcc_sess_keep is the copy js/backend.js and js/mcc-auth.js restore when the main one was cleared by accident; this
     runs in the head before either, so it reads the same two shelves */
  function memberSession() {
    var keys = ["mccdb_session", "mcc_sess_keep"];
    for (var i = 0; i < keys.length; i++) {
      try {
        var s = JSON.parse(w.localStorage.getItem(keys[i]) || "null");
        if (s && s.access_token) return s;
      } catch (_) {}
    }
    return null;
  }
  function claims(token) {
    try { return JSON.parse(atob(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) || {}; } catch (_) { return {}; }
  }
  /* the member's own record of THIS version, the check workers/mccluster/src/world-cctv.js makes: its time, or "" */
  function memberAck() {
    var s = memberSession(), m = s ? claims(s.access_token).user_metadata : null;
    return m && m.privacy_policy_version === VERSION && m.privacy_acknowledged_at &&
      !isNaN(Date.parse(m.privacy_acknowledged_at)) ? String(m.privacy_acknowledged_at) : "";
  }

  /* AGREED, from any source. The first read on a page fills in the missing
     copies and writes the shared cookie again: that is how an answer kept on
     one host reaches the next, and the fresh expiry keeps it alive. */
  function readAck() {
    var local = stored("localStorage", KEY), sess = stored("sessionStorage", KEY);
    var cookie = cookieHas(KEY), member = local || sess || cookie ? "" : memberAck();
    if (!local && !sess && !cookie && !member) return false;
    if (synced !== "agreed") {
      synced = "agreed";
      var value = local || sess || { version: VERSION, accepted_at: member || new Date().toISOString() };
      if (!local) store("localStorage", KEY, value);
      if (!sess) store("sessionStorage", KEY, value);
      setCookie(KEY);
      w.MCC_PRIVACY_ACK = value;
    }
    return true;
  }
  function writeAck() {
    var value = { version: VERSION, accepted_at: new Date().toISOString() };
    store("localStorage", KEY, value);
    store("sessionStorage", KEY, value);
    setCookie(KEY);
    synced = "agreed";
    w.MCC_PRIVACY_ACK = value;
    return recordMember(value.accepted_at);
  }
  /* Agreeing while signed in writes the member's own auth record: the two
     fields, the call and the headers the join flow and the CCTV lock use
     (js/action.js, js/action-globe.js recordPrivacyAck). Fire and forget:
     this browser keeps the answer either way. */
  function recordMember(at) {
    var s = memberSession();
    if (!s || memberAck() || typeof fetch !== "function") return Promise.resolve(false);
    var fresh = w.MCC && typeof w.MCC.refreshIfNeeded === "function"
      ? Promise.resolve(w.MCC.refreshIfNeeded()).then(function (n) { return (n && n.access_token) || s.access_token; }, function () { return s.access_token; })
      : Promise.resolve(s.access_token);
    return fresh.then(function (token) {
      return fetch(SB + "/auth/v1/user", {
        method: "PUT", keepalive: true,
        headers: { apikey: SB_KEY, authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ data: { privacy_policy_version: VERSION, privacy_acknowledged_at: at } })
      });
    }).then(function (r) { return !!(r && r.ok); }, function () { return false; });
  }

  /* "Go back" must never manufacture an agreement, clear the wall, or write
     a dismiss/seen marker. A direct-entry tab has no prior page, so exit to a
     neutral blank document instead of opening the site content. */
  function returnToPrevious() {
    try {
      if (w.history && w.history.length > 1 && typeof w.history.back === "function") {
        w.history.back();
        return;
      }
    } catch (_) {}
    try {
      var previous = d.referrer ? new URL(d.referrer, location.href) : null;
      if (previous && (previous.protocol === "https:" || previous.protocol === "http:") &&
          previous.href !== location.href) {
        location.replace(previous.href);
        return;
      }
    } catch (_) {}
    location.replace("about:blank");
  }

  w.MCC_PRIVACY = {
    version: VERSION,
    accepted: readAck,
    seen: readAck, /* backwards-compatible alias: only agreement now counts */
    acknowledge: writeAck
  };

  /* The Privacy Policy remains readable before a choice and presents the
     same Agree / Go back options as the entry dialog. */
  if (page === "privacy.html") {
    var answer = function () {
      var box = d.getElementById("mccPrivacyAnswer");
      var status = d.getElementById("mccPrivacyAnswerStatus");
      var agree = d.getElementById("mccPrivacyAnswerAgree");
      var back = d.getElementById("mccPrivacyAnswerBack");
      if (!box || !status || !agree || !back) return;
      var show = function (justNow) {
        if (readAck()) {
          status.textContent = justNow
            ? "You agreed to notice version " + VERSION + ". McCluster's analytics start with your next page."
            : "You have agreed to notice version " + VERSION + " on this browser.";
          agree.hidden = true;
        } else {
          status.textContent = "You have not agreed to notice version " + VERSION +
            ". McCluster's analytics are off. Choose Agree & continue or Go back.";
          agree.hidden = false;
        }
      };
      show(false);
      box.hidden = false;
      back.addEventListener("click", returnToPrevious);
      agree.addEventListener("click", function () {
        writeAck();
        show(true);
        /* the button hides, so focus moves to the answer it produced */
        try { status.setAttribute("tabindex", "-1"); status.focus(); } catch (_) {}
      });
    };
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", answer, { once: true });
    else answer();
    return;
  }
  if (readAck()) return;
  var framed = true;
  try { framed = w.top !== w; } catch (_) {}
  if (framed) return;

  var shown = false;
  function present() {
    if (shown || readAck()) return;
    shown = true;
    wall();
  }

  /* Every unagreed top-level entry page gets the same two-option wall.
     Agree enters; Go back navigates out and does not persist any answer.
     Escape has the same effect as Go back. Privacy Policy stays readable. */
  function wall() {
    d.documentElement.setAttribute("data-privacy-gate", "pending");
    var style = d.createElement("style");
    style.id = "mccPrivacyGateStyle";
    /* Mobile first: one column at phone width; min-width only ever adds room.
       The overlay scrolls, and the card centres with auto margins, so a short
       landscape phone can still reach every answer. */
    style.textContent =
      'html[data-privacy-gate="pending"] body{overflow:hidden!important}' +
      'html[data-privacy-gate="pending"] body>*:not(#mccPrivacyGate){visibility:hidden!important;pointer-events:none!important}' +
      '#mccPrivacyGate{visibility:visible!important;position:fixed;inset:0;z-index:2147483647;box-sizing:border-box;' +
      'display:flex;overflow-y:auto;padding:16px;background:#0b0908;color:#f5efe6;font:16px/1.5 system-ui,sans-serif}' +
      '#mccPrivacyGate *{box-sizing:border-box}' +
      '#mccPrivacyGate .mccpg__card{margin:auto;width:min(100%,560px);min-width:0;padding:20px;border:1px solid rgba(255,255,255,.18);' +
      'border-radius:18px;background:#15110f;box-shadow:0 24px 80px rgba(0,0,0,.5);overflow-wrap:anywhere}' +
      '#mccPrivacyGate h1{margin:0 0 12px;font-size:1.45rem;line-height:1.1}' +
      '#mccPrivacyGate h1:focus{outline:none}' +
      '#mccPrivacyGate p{margin:0 0 14px;color:#d8cfc3}' +
      '#mccPrivacyGate .mccpg__actions{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin-top:18px}' +
      '#mccPrivacyGate a,#mccPrivacyGate button{display:flex;align-items:center;justify-content:center;min-height:48px;min-width:44px;' +
      'border-radius:12px;padding:12px 16px;font:inherit;font-size:max(16px,1rem);font-weight:700;text-align:center;cursor:pointer}' +
      '#mccPrivacyGate a{border:1px solid rgba(255,255,255,.25);color:#f5efe6;text-decoration:none}' +
      '#mccPrivacyGate .mccpg__agree{border:0;background:#f5efe6;color:#0b0908}' +
      '#mccPrivacyGate .mccpg__back{border:1px solid rgba(255,255,255,.25);background:transparent;color:#f5efe6}' +
      '#mccPrivacyGate a:focus-visible,#mccPrivacyGate button:focus-visible{outline:3px solid #f5efe6;outline-offset:3px}' +
      '#mccPrivacyGate small{display:block;margin-top:12px;color:#a99d91}' +
      '@media (min-width:560px){#mccPrivacyGate{padding:24px}#mccPrivacyGate .mccpg__card{padding:24px}' +
      '#mccPrivacyGate .mccpg__actions{grid-template-columns:repeat(2,minmax(0,1fr))}' +
      '#mccPrivacyGate .mccpg__review{grid-column:1/-1}}';
    (d.head || d.documentElement).appendChild(style);

    function mount() {
      if (d.getElementById("mccPrivacyGate")) return;
      var gate = d.createElement("div");
      gate.id = "mccPrivacyGate";
      gate.setAttribute("role", "dialog");
      gate.setAttribute("aria-modal", "true");
      gate.setAttribute("aria-labelledby", "mccPrivacyGateTitle");
      gate.setAttribute("aria-describedby", "mccPrivacyGateBody");
      gate.innerHTML =
        '<div class="mccpg__card">' +
        '<h1 id="mccPrivacyGateTitle" tabindex="-1">Privacy before entry</h1>' +
        '<div id="mccPrivacyGateBody">' +
        '<p>McCluster records account, device, network, location and activity data as described in the Privacy Policy. Optional live video, microphone audio and verification media are captured only in features that request them.</p>' +
        '<p><b>Choose one:</b> Agree &amp; continue to enter, or Go back to leave without accepting. No analytics are collected until you agree. Returning without agreeing will ask again.</p>' +
        '<p><b>This acknowledgement is not blanket consent.</b> Precise location and other protected device permissions still use their own browser or operating-system controls, and privacy signals remain honored.</p>' +
        '</div>' +
        '<div class="mccpg__actions">' +
        '<button type="button" class="mccpg__agree" id="mccPrivacyAgree">I agree &amp; continue</button>' +
        '<button type="button" class="mccpg__back" id="mccPrivacyBack">Go back</button>' +
        '<a class="mccpg__review" href="/privacy.html">Review the Privacy Policy</a>' +
        '</div>' +
        '<small>Privacy notice version ' + VERSION + '</small>' +
        '</div>';
      d.body.appendChild(gate);
      var btn = d.getElementById("mccPrivacyAgree");
      var back = d.getElementById("mccPrivacyBack");
      var open = true;
      btn.addEventListener("click", function () {
        if (!open) return;
        btn.disabled = true;
        back.disabled = true;
        /* the page reloads to start with the agreement in place; a member's
           record gets a moment to be written first, never more than that */
        var reloaded = false;
        var go = function () { if (!reloaded) { reloaded = true; location.reload(); } };
        writeAck().then(go, go);
        setTimeout(go, 1500);
      });
      function goBack() {
        if (!open || btn.disabled) return;
        open = false;
        back.disabled = true;
        returnToPrevious();
      }
      back.addEventListener("click", goBack);
      /* Escape is equivalent to Go back; Tab stays trapped until navigation. */
      gate.addEventListener("keydown", function (e) {
        if (e.key === "Escape" || e.key === "Esc") {
          if (e.preventDefault) e.preventDefault();
          goBack();
          return;
        }
        if (e.key !== "Tab" || !gate.querySelectorAll) return;
        var items = Array.prototype.filter.call(gate.querySelectorAll("a[href],button:not([disabled])"), function (n) { return !n.disabled; });
        if (!items.length) return;
        var first = items[0], last = items[items.length - 1], at = d.activeElement;
        if (e.shiftKey && (at === first || !gate.contains(at))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (at === last || !gate.contains(at))) { e.preventDefault(); first.focus(); }
      });
      /* Focus starts on the agree button, the way it always has; the dialog
         is labelled and described, so a screen reader hears the notice. */
      btn.focus();
    }

    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", mount, { once: true });
    else mount();
  }

  /* A sign-in carried from another McCluster host arrives as #mcc_handoff=
     and js/tabbar.js reloads the page signed in, where the member's own
     record may already answer. Wait for it, then look again. A page that
     already holds a session is not handed off, so it does not wait. */
  if (/(?:^#|&)mcc_handoff=[^&]/.test(location.hash || "") && !memberSession()) {
    var wait = setTimeout(present, 10000);
    w.addEventListener("mcc:handoff", function (e) {
      clearTimeout(wait);
      if (e && e.detail && e.detail.ok) wait = setTimeout(present, 4000);
      else present();
    }, { once: true });
    return;
  }
  present();
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
    /* the rows, for a page's own settings that are not an element (index.html's "@front", read by js/main.js) */
    w.MCC_CONTENT_ROWS = Array.isArray(rows) ? rows : [];
    w.dispatchEvent(new CustomEvent("mcc:content-applied"));
  }

  fetch(SB + "/rest/v1/site_content?select=slot,kind,value&page=eq." +
        encodeURIComponent(PAGE) + "&limit=500",
        { headers: { apikey: KEY }, cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(apply)
    .catch(function () { d.documentElement.setAttribute("data-content-loaded", "offline"); });
})(window, document);
