/* SITE-ENTRY PRIVACY NOTICE: ONCE PER POLICY VERSION, ACROSS THE WHOLE HOUSE.
   Runs before the live-content fetch because this file is loaded in the head
   across the public property. This is notice acknowledgement, not a blanket
   override of browser/OS permissions or privacy signals.

   Owner, 2026-10-20: "when a person first enters the site, no matter where
   they enter from, they see the privacy policy, and then they never see it
   again." The policy is one site-wide document, so seeing it is one
   site-wide event:

   - SEEN IS NOT AGREED. A document page's banner counts as seen the moment
     it is shown (answered or ignored), and so does any answer to the wall,
     which covers the page and still needs "I agree" to enter. Once THIS
     version is seen, neither the banner nor the wall shows again for it, on
     any page or any McCluster host. Agreement stays the separate, stronger
     record: js/analytics.js records nothing until it exists, and a feature
     that needs it (the World's automatic location, the CCTV lock) asks at
     its own point of use through MCC_PRIVACY.accepted(). Nothing reopens
     this notice for a version already seen.
   - ONE RECORD FOR EVERY McCLUSTER HOST. Browser storage belongs to one
     origin, so an answer given on matthew.mccluster.org was invisible on
     mccluster.org (the bar's Globe, and the World that Music opens in a
     frame) and the notice came back. The cookie is written for
     Domain=mccluster.org, which every *.mccluster.org host reads; anywhere
     else (a preview, localhost) it stays host-only. localStorage and
     sessionStorage keep copies, and whichever source answers fills in the
     others.
   - A MEMBER'S OWN ACCOUNT RECORD COUNTS. The join flow (js/action.js,
     account.html) and the CCTV lock (js/action-globe.js) write
     user_metadata.privacy_policy_version on the member's auth record; a
     signed-in member whose record carries this version has agreed, on any
     host or device. Agreeing here while signed in writes the same record.
   - NEVER INSIDE A FRAME. The page that holds the frame owns the notice.
   - NOT DURING THE SIGN-IN HANDOFF. A cross-host arrival (#mcc_handoff=,
     js/tabbar.js) reloads the page signed in; the notice waits for that and
     then looks again.
   A new policy VERSION is a new notice: everyone sees it once more. */
(function (w, d) {
  "use strict";
  var VERSION = "2026-10-19";
  var KEY = "mcc_privacy_ack";    /* agreed: {version, accepted_at}; cookie mcc_privacy_ack=<VERSION> */
  var SEEN = "mcc_privacy_seen";  /* banner shown, or "Not now": {version, seen_at}; cookie mcc_privacy_seen=<VERSION> */
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
  /* SEEN: agreed, or the banner was shown. This alone decides whether the notice shows. */
  function readSeen() {
    if (readAck()) return true;
    var local = stored("localStorage", SEEN), sess = stored("sessionStorage", SEEN), cookie = cookieHas(SEEN);
    if (!local && !sess && !cookie) return false;
    if (!synced) {
      synced = "seen";
      var value = local || sess || { version: VERSION, seen_at: new Date().toISOString() };
      if (!local) store("localStorage", SEEN, value);
      if (!sess) store("sessionStorage", SEEN, value);
      setCookie(SEEN);
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
  /* the banner shown, or "Not now": seen, not agreed, and never a downgrade of an agreement */
  function writeSeen() {
    if (readAck()) return;
    var value = { version: VERSION, seen_at: new Date().toISOString() };
    store("localStorage", SEEN, value);
    store("sessionStorage", SEEN, value);
    setCookie(SEEN);
    synced = "seen";
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

  w.MCC_PRIVACY = {
    version: VERSION,
    accepted: readAck,   /* agreed: analytics, and features that ask at their point of use */
    seen: readSeen,      /* answered at all: whether the notice may show */
    acknowledge: writeAck,
    dismiss: writeSeen
  };

  /* The policy itself must remain readable before acknowledgement. */
  if (page === "privacy.html" || readSeen()) return;
  var framed = true;
  try { framed = w.top !== w; } catch (_) {}
  if (framed) return;

  var shown = false;
  function present() {
    if (shown || readSeen()) return;
    shown = true;
    var noticeMeta = d.querySelector('meta[name="mcc-privacy-notice"]');
    if (noticeMeta && noticeMeta.getAttribute("content") === "banner") banner();
    else wall();
  }

  /* PUBLIC DOCUMENT PAGES: THE NOTICE AS A BANNER, NOT A WALL.

     A page that carries <meta name="mcc-privacy-notice" content="banner">
     in its head (before this script) is a document meant to be read cold:
     the résumé a hiring manager opens from an application, the press kit,
     the engineering record, the music catalogue, the newsroom. On those
     the notice is a bar along the bottom of the screen instead of a
     full-screen dialog that hides the page.

     Nothing about what is recorded changes. js/analytics.js still records
     nothing, sets no device or session id and registers no service worker
     until the notice is agreed to; this branch only decides whether the
     words on the page can be read first. Agreeing here does not reload the
     page, so recording begins on the next page view. The bar counts as
     seen as soon as it is shown (owner, 2026-10-20: "they see the privacy
     policy, and then they never see it again"): whether it is agreed to,
     dismissed with "Not now" or simply left, it does not come back, and
     nothing is recorded until someone agrees.

     Why: Google's guidance on interstitials says a dialog covering the
     content "make[s] it hard for Google and other search engines to
     understand your content" and recommends a banner instead; browser
     agents acting for a person hit the same wall; and a recruiter who has
     to accept a policy before seeing a résumé often does not. Pages that
     are the house itself (accounts, the network, the desks) keep the gate.
     Opt a page in by adding the meta; there is no list to keep here. */
  function banner() {
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
      writeSeen();
      d.getElementById("mccPrivacyNoticeAgree").addEventListener("click", function () {
        writeAck();
        bar.remove();
      });
      d.getElementById("mccPrivacyNoticeLater").addEventListener("click", function () {
        writeSeen();
        bar.remove();
      });
    };
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", mountBanner, { once: true });
    else mountBanner();
  }

  function wall() {
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
        '<p>McCluster records account, device, network, location and activity data as described in the Privacy Policy. Optional live video, microphone audio and verification media are captured only in features that request them. Review the updated notice before entering.</p>' +
        '<p><b>This acknowledgement is not blanket consent.</b> Precise location and other protected device permissions still use their own browser or operating-system controls, and privacy signals remain honored.</p>' +
        '<div class="mccpg__actions">' +
        '<a href="/privacy.html">Review the Privacy Policy</a>' +
        '<button type="button" id="mccPrivacyAgree">I agree &amp; continue</button>' +
        '</div>' +
        '<small>Privacy notice version ' + VERSION + '</small>' +
        '</div>';
      d.body.appendChild(gate);
      var btn = d.getElementById("mccPrivacyAgree");
      btn.addEventListener("click", function () {
        btn.disabled = true;
        /* the page reloads to start with the agreement in place; a member's
           record gets a moment to be written first, never more than that */
        var reloaded = false;
        var go = function () { if (!reloaded) { reloaded = true; location.reload(); } };
        writeAck().then(go, go);
        setTimeout(go, 1500);
      });
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
