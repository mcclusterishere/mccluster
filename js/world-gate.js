/* THE DOOR: the World's sign-in, presentation only (owner, 2026-11-18: "the sign-in page just looks like shit. It needs to be
   fancier, look sexier, and have more shit to it ... This is royalty shit over here"). docs/design/WORLD-SIGN-IN-DOOR.md.

   js/mnet.js keeps every auth call and every flow: this script never signs anyone in, up or out, and never sends a password
   anywhere. It defines window.MCC_GATE and touches nothing until js/mnet.js calls it:
   - shown(which): showGate's last word. "signedout" with the door closed opens it: everything outside the door goes inert
     except the privacy notice (and its first-visit wall), the door is measured against the header, the globe frame and the
     privacy banner, the phone's Back gets one history entry that closes it, and the sheet rises (only after a gesture: a
     door opened by the address is whole in its first frame).
   - opened(ctx): openSignIn's word, with the reason key, the World's own open-missions read and the World's mission opener.
     It starts the pulse: three public reads, each card hidden until its read answers and for good if it fails, and the
     globe's own credit line.
   - leave(): showGate closing the door, for the Back pill, Escape, a tap on the scrim, the phone's Back, a mission handed to
     the World, or a sign-in that worked. Inert comes off at once, the sheet falls for 220 ms, and the history entry goes.
   Nothing here is invented: no count without a read, no zero, no placeholder, values written as text only. */
(function (root) {
  "use strict";
  var doc = root.document;
  var API = "https://api.mccluster.org";
  var NEWS_HEAT = API + "/v1/world/news-heat";
  var RECORD = API + "/v1/action-archive/docket-516r-2025";
  var RECORD_STATIC = "data/action/docket-516r-archive.json";
  var GDELT = "https://www.gdeltproject.org/";
  /* the World's globe credit as js/action-globe.js writes it, for when the frame cannot be read */
  var CREDIT = "NASA imagery · Natural Earth · © OpenStreetMap";
  var KEEP_MS = 5 * 60 * 1000, READ_MS = 6000, LEAVE_MS = 220, ENTER_MS = 1600;
  /* never made inert: the privacy notice (banner mode) and its first-visit wall stay reachable */
  var SPARE = { mccPrivacyNotice: 1, mccPrivacyGate: 1 };
  var NOT_UI = /^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT)$/i;
  var SVGNS = "http://www.w3.org/2000/svg";
  var ICONS = {
    mission: ["M6 21V4", "M6 4.5h11l-2.2 4 2.2 4H6"],
    news: ["M3 12h18", "M12 3c-3 3-3 15 0 18", "M12 3c3 3 3 15 0 18", "circle:12,12,9"],
    record: ["circle:12,12,9", "m8 12.4 2.8 2.8 5.4-5.6"]
  };

  var gate = {
    open: false, leaving: false, pending: "", opener: null, inert: [], hideTimer: 0, enterTimer: 0,
    ctx: null, cache: {}, seq: 0, wired: false, matched: false, expectPop: false, warmed: false,
    bannerRO: null, bodyMO: null, bannerSeen: null, frameWired: false
  };

  function $(id) { return doc.getElementById(id); }
  function door() { return $("mnSignedOut"); }
  function each(list, fn) { Array.prototype.forEach.call(list || [], fn); }
  function reduced() { try { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function rendered(n) { try { return !!(n && n.isConnected && n.getClientRects && n.getClientRects().length); } catch (e) { return false; } }
  function shownBack() { var b = $("mnSignedOutBack"); return b && !b.hidden && rendered(b) ? b : null; }
  function https(v) {
    if (typeof v !== "string" || !v.trim()) return "";
    try { var u = new URL(v.trim(), root.location.href); return u.protocol === "https:" && !u.username && !u.password ? u.href : ""; } catch (e) { return ""; }
  }

  /* ---------------- the words of the pulse (pure: scripts/test/world-gate.test.mjs holds them) ---------------- */
  function fmt(n) { try { return Number(n).toLocaleString("en-US"); } catch (e) { return String(n); } }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function domainLabel(d) {
    var p = root.MCC_MISSION_POSTS;
    if (p && typeof p.domainLabel === "function") return p.domainLabel(d);
    var s = String(d || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }
  /* the open missions, newest first: 'Open now' while there is one, the count from two, 500+ at the read's own limit; the
     newest mission's title, its field and its points. A guest who came from a mission Join reads that mission instead. */
  function missionCard(list, reason, wanted) {
    var all = (Array.isArray(list) ? list : []).filter(function (m) { return m && typeof m.id === "string" && typeof m.title === "string" && m.title.trim(); });
    var n = all.length;
    if (!n) return null;
    var mine = null;
    if (reason === "mission" && wanted) all.forEach(function (m) { if (!mine && m.id === wanted) mine = m; });
    var m = mine || all[0], bits = [], d = domainLabel(m.domain);
    var points = m.points !== undefined ? m.points : m.base_points;
    if (d) bits.push(d);
    if (points !== null && points !== undefined && isFinite(points)) bits.push(fmt(points) + (Number(points) === 1 ? " point" : " points"));
    return {
      id: m.id, button: !mine,
      kicker: mine ? "Your mission" : n >= 500 ? "Open now · 500+ missions" : n >= 2 ? "Open now · " + fmt(n) + " missions" : "Open now",
      value: m.title.trim(), source: bits.join(" · ")
    };
  }
  /* the countries with at least one story in the last 24 hours (GDELT); never the story total, which the API caps */
  function newsCard(heat) {
    if (!heat || typeof heat !== "object" || heat.unavailable === true) return null;
    var c = heat.countries && typeof heat.countries === "object" ? heat.countries : null;
    var n = c ? Object.keys(c).filter(function (k) { return Number(c[k]) > 0; }).length : 0;
    if (!n) return null;
    var a = heat.attribution && typeof heat.attribution === "object" ? heat.attribution : {};
    return { kicker: "Last 24 hours", value: "News from " + fmt(n) + " " + plural(n, "country", "countries"), source: "The GDELT Project", href: https(a.url) || GDELT };
  }
  function eventDate(iso, tz) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return "";
    var o = { month: "short", day: "numeric", year: "numeric" };
    try { o.timeZone = tz || "UTC"; return new Date(t).toLocaleDateString("en-US", o); }
    catch (e) { try { o.timeZone = "UTC"; return new Date(t).toLocaleDateString("en-US", o); } catch (_) { return ""; } }
  }
  /* a completed mission series, counts only: no name, no photograph, no link */
  function recordCard(a) {
    var p = a && a.project, ev = a && a.event && typeof a.event === "object" ? a.event : {};
    if (!p || p.status !== "completed" || !Array.isArray(a.participants) || !a.participants.length) return null;
    var title = typeof p.title === "string" ? p.title.trim() : "";
    if (!title) return null;
    var people = a.participants.length, works = Array.isArray(a.works) ? a.works.length : 0, bits = [];
    bits.push(fmt(people) + " " + plural(people, "participant", "participants"));
    if (works) bits.push(fmt(works) + " " + plural(works, "song", "songs"));
    var place = [ev.city, ev.region].filter(function (s) { return typeof s === "string" && s.trim(); }).map(function (s) { return s.trim(); }).join(", ");
    if (place) bits.push(place);
    var when = eventDate(ev.starts_at, ev.timezone);
    if (when) bits.push(when);
    var mission = typeof p.mission_title === "string" ? p.mission_title.trim() : "";
    return { kicker: "On the record", value: title + (mission ? " · " + mission : ""), source: bits.join(" · ") };
  }

  /* ---------------- reads: public, bounded, kept five minutes, never thrown ---------------- */
  function bounded(promise) {
    var timer = 0;
    var deadline = new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("timeout")); }, READ_MS); });
    return Promise.race([Promise.resolve(promise), deadline]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }
  function getJSON(url) {
    var ctl = typeof root.AbortController === "function" ? new root.AbortController() : null, timer = 0;
    var deadline = new Promise(function (_, reject) { timer = setTimeout(function () { if (ctl) try { ctl.abort(); } catch (e) {} reject(new Error("timeout")); }, READ_MS); });
    var read = Promise.resolve().then(function () {
      return root.fetch(url, ctl ? { headers: { accept: "application/json" }, signal: ctl.signal } : { headers: { accept: "application/json" } });
    }).then(function (r) {
      if (!r || !r.ok) throw new Error("status " + (r ? r.status : 0));
      return r.json();
    });
    return Promise.race([read, deadline]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }
  function cached(key, make) {
    var c = gate.cache[key], now = Date.now();
    if (c && now - c.at < KEEP_MS) return c.promise;
    var p;
    try { p = Promise.resolve(make()).then(function (v) { return v; }, function () { return null; }); } catch (e) { p = Promise.resolve(null); }
    gate.cache[key] = { at: now, promise: p };
    return p;
  }
  function missionFromAddress() {
    try { var id = new URL(root.location.href).searchParams.get("mission"); return /^[0-9a-f-]{36}$/i.test(id || "") ? id : ""; } catch (e) { return ""; }
  }

  /* ---------------- the pulse on the stage ---------------- */
  function icon(kind) {
    var svg = doc.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "wg-card__ico");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    (ICONS[kind] || []).forEach(function (d) {
      var n;
      if (d.indexOf("circle:") === 0) {
        var c = d.slice(7).split(",");
        n = doc.createElementNS(SVGNS, "circle"); n.setAttribute("cx", c[0]); n.setAttribute("cy", c[1]); n.setAttribute("r", c[2]);
      } else { n = doc.createElementNS(SVGNS, "path"); n.setAttribute("d", d); }
      svg.appendChild(n);
    });
    return svg;
  }
  function span(cls, text) { var s = doc.createElement("span"); s.className = cls; if (text) s.textContent = text; return s; }
  function paintCard(id, card, kind) {
    var li = $(id);
    if (!li) return;
    while (li.firstChild) li.removeChild(li.firstChild);
    if (!card) { li.hidden = true; settle(); return; }
    var inner;
    if (kind === "mission" && card.button) {
      inner = doc.createElement("button");
      inner.type = "button"; inner.className = "wg-card__go"; inner.setAttribute("data-mission", card.id);
      inner.appendChild(span("wg-sr", "Open the mission: "));
    } else inner = span("wg-card__in");
    inner.appendChild(icon(kind));
    inner.appendChild(span("wg-card__v", card.value));
    inner.appendChild(span("wg-card__k", card.kicker));
    if (card.source) {
      var s = span("wg-card__s");
      if (card.href) {
        s.appendChild(span("wg-card__pre", "Source: "));
        var a = doc.createElement("a");
        a.href = card.href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = card.source;
        s.appendChild(a);
      } else s.textContent = card.source;
      inner.appendChild(s);
    }
    li.appendChild(inner);
    li.hidden = false;
    settle();
  }
  /* the dateline is the visitor's own day, shown once any card is */
  function settle() {
    var any = ["wgPulseMission", "wgPulseNews", "wgPulseRecord"].some(function (id) { var n = $(id); return n && !n.hidden; });
    var line = $("wgDateline"), t = $("wgDate");
    if (t && any) {
      var d = new Date();
      try { t.textContent = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }); } catch (e) { t.textContent = d.toDateString(); }
      t.setAttribute("datetime", d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2));
    }
    if (line) line.hidden = !any;
    more();
  }
  function pulse() {
    var ctx = gate.ctx || {}, seq = ++gate.seq, wanted = missionFromAddress();
    cached("missions", function () { return typeof ctx.missions === "function" ? bounded(ctx.missions()) : null; })
      .then(function (list) { if (seq === gate.seq) paintCard("wgPulseMission", missionCard(list, ctx.reason, wanted), "mission"); });
    cached("news", function () { return getJSON(NEWS_HEAT); })
      .then(function (heat) { if (seq === gate.seq) paintCard("wgPulseNews", newsCard(heat), "news"); });
    cached("record", function () { return getJSON(RECORD).catch(function () { return getJSON(RECORD_STATIC); }); })
      .then(function (a) { if (seq === gate.seq) paintCard("wgPulseRecord", recordCard(a), "record"); });
  }

  /* the Earth's own credit line, copied as text and links from the globe frame (same origin, read only) */
  function copyCredit(from, to) {
    each(from.childNodes, function (n) {
      if (n.nodeType === 3) { to.appendChild(doc.createTextNode(n.nodeValue)); return; }
      if (n.nodeType !== 1) return;
      var tag = String(n.tagName || "").toUpperCase();
      if (tag === "A") {
        var text = String(n.textContent || "").replace(/\s+/g, " ").trim(), href = https(n.getAttribute("href"));
        if (!text) return;
        if (!href) { to.appendChild(doc.createTextNode(text)); return; }
        var a = doc.createElement("a");
        a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = text;
        to.appendChild(a);
        return;
      }
      if (/^(SCRIPT|STYLE|IMG|SVG|IFRAME|VIDEO|AUDIO|CANVAS|BUTTON|INPUT|SELECT|TEXTAREA|OBJECT)$/.test(tag)) return;
      copyCredit(n, to);
    });
  }
  function paintCredit() {
    var host = $("wgCredit");
    if (!host) return;
    var src = null;
    try { var f = $("mnWorldFrame"), d = f && f.contentDocument; src = d ? d.querySelector(".osm-credit.is-editorial") : null; } catch (e) { src = null; }
    while (host.firstChild) host.removeChild(host.firstChild);
    if (src && /\S/.test(src.textContent || "")) copyCredit(src, host);
    if (!/\S/.test(host.textContent || "")) host.textContent = CREDIT;
  }

  /* ---------------- the World under the door ---------------- */
  function take(n) {
    if (!n || n.nodeType !== 1 || NOT_UI.test(n.tagName || "") || SPARE[n.id] || n.hasAttribute("inert")) return;
    n.setAttribute("inert", "");
    gate.inert.push(n);
  }
  function inertWorld() {
    var el = door(), main = el && el.parentNode;
    if (main && main.children) each(main.children, function (c) { if (c !== el) take(c); });
    if (doc.body) each(doc.body.children, function (c) { if (c !== main) take(c); });
  }
  function freeWorld() { gate.inert.splice(0).forEach(function (n) { n.removeAttribute("inert"); }); }

  function safeBottom() {
    var el = door(), b = $("mccPrivacyNotice"), v = 0;
    if (!el) return;
    if (b && rendered(b)) {
      var r = b.getBoundingClientRect(), vh = root.innerHeight || 0;
      if (r.height > 0) v = Math.ceil(r.height + Math.max(0, vh - r.bottom) + 8);
    }
    el.style.setProperty("--wg-safe-bottom", v + "px");
    if (b && b !== gate.bannerSeen && typeof root.ResizeObserver === "function") {
      if (gate.bannerRO) gate.bannerRO.disconnect();
      gate.bannerSeen = b;
      gate.bannerRO = new root.ResizeObserver(function () { safeBottom(); more(); });
      gate.bannerRO.observe(b);
    }
  }
  function measure() {
    var el = door();
    if (!el) return;
    var top = doc.querySelector(".mn__top"), h = top && top.getBoundingClientRect ? top.getBoundingClientRect().height : 0;
    el.style.setProperty("--wg-head", (h > 0 ? Math.round(h) : 72) + "px");
    var f = $("mnWorldFrame"), r = f && rendered(f) ? f.getBoundingClientRect() : null;
    if (r && r.width > 0 && r.height > 0) {
      el.style.setProperty("--wg-veil-top", Math.max(0, Math.round(r.bottom - 64)) + "px");
      el.style.setProperty("--wg-veil-left", Math.max(0, Math.ceil(r.right)) + "px");
    }
    viewport();
    safeBottom();
  }
  function viewport() {
    var vv = root.visualViewport, el = door();
    if (!vv || !el) return;
    el.style.setProperty("--wg-vvh", Math.round(vv.height) + "px");
    el.style.setProperty("--wg-vvtop", Math.round(vv.offsetTop) + "px");
  }
  /* more below: set while the sheet can still scroll down */
  function more() {
    var sh = $("wgSheet");
    if (!sh) return;
    var left = (sh.scrollHeight || 0) - (sh.scrollTop || 0) - (sh.clientHeight || 0);
    if (left > 2) sh.setAttribute("data-more", ""); else sh.removeAttribute("data-more");
  }

  /* ---------------- the doors, the fields and the action ---------------- */
  function setReveal(btn, show) {
    var input = $(btn.getAttribute("data-reveal"));
    if (!input) return;
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", show ? "true" : "false");
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    btn.textContent = show ? "Hide" : "Show";
  }
  function hideAll() { var el = door(); if (el) each(el.querySelectorAll("[data-reveal]"), function (b) { setReveal(b, false); }); }
  function rules() {
    var p = $("mnPassword"), p2 = $("mnPassword2"), hint = $("mnPasswordHint"), match = $("wgMatch");
    if (hint && p) hint.setAttribute("data-met", String(p.value || "").length >= 8 ? "true" : "false");
    if (p && p2 && match) {
      var met = String(p2.value || "").length > 0 && p2.value === p.value, field = p2.closest ? p2.closest(".wg-field") : null;
      if (field) field.setAttribute("data-match", met ? "true" : "false");
      if (met && !gate.matched) match.textContent = "Both passwords match.";
      if (!met) match.textContent = "";
      gate.matched = met;
    }
  }
  function busy() {
    var b = $("mnAuthGo");
    if (!b) return;
    if (b.disabled && /…$/.test(String(b.textContent || "").trim())) b.setAttribute("aria-busy", "true");
    else b.removeAttribute("aria-busy");
  }
  /* the mode js/mnet.js set (setAuthMode): the dialog's name, the doors' roving tab stop, the panel's label */
  function syncMode() {
    var el = door();
    if (!el) return;
    var create = el.getAttribute("data-auth-mode") === "create";
    el.setAttribute("aria-label", create ? "Create an account" : "Sign in");
    var on = $(create ? "mnCreateTab" : "mnSignInTab"), off = $(create ? "mnSignInTab" : "mnCreateTab"), panel = $("mnAuthPanel");
    if (on) on.setAttribute("tabindex", "0");
    if (off) off.setAttribute("tabindex", "-1");
    if (panel && on) panel.setAttribute("aria-labelledby", on.id);
    hideAll();
    rules();
    more();
  }
  /* a focused field scrolls into view inside the sheet, never by moving the page */
  function reveal(target) {
    var sh = $("wgSheet");
    if (!sh || !target || !sh.contains(target) || !target.getBoundingClientRect) return;
    var box = (target.closest && target.closest(".wg-field, .mn__check")) || target;
    var s = sh.getBoundingClientRect(), r = box.getBoundingClientRect(), pad = 16;
    if (r.bottom > s.bottom - pad) sh.scrollTop += r.bottom - s.bottom + pad;
    else if (r.top < s.top + pad) sh.scrollTop -= s.top + pad - r.top;
  }

  /* ---------------- history: the phone's Back closes the door ---------------- */
  function pushDoor() {
    var h = root.history, st = h && h.state;
    if (!h || (st && st.mccDoor)) return;
    try { h.pushState(Object.assign({}, st || {}, { mccDoor: 1 }), "", root.location.href); } catch (e) {}
  }
  function dropDoor(kind) {
    var h = root.history, st = h && h.state;
    if (!h || !st || !st.mccDoor) return;
    try {
      if (kind === "ui") { gate.expectPop = true; h.back(); }
      else if (kind === "handoff" || kind === "success") {
        var rest = Object.assign({}, st);
        delete rest.mccDoor;
        h.replaceState(Object.keys(rest).length ? rest : null, "", root.location.href);
      }
    } catch (e) {}
  }

  /* ---------------- open and close ---------------- */
  function finishHide() {
    var el = door();
    gate.hideTimer = 0; gate.leaving = false;
    if (!el) return;
    el.hidden = true;
    el.classList.remove("is-leaving");
    el.style.removeProperty("pointer-events");
  }
  function open() {
    var el = door();
    if (!el) return;
    wire();
    if (gate.leaving) {
      clearTimeout(gate.hideTimer); gate.hideTimer = 0; gate.leaving = false;
      el.classList.remove("is-leaving");
      el.style.removeProperty("pointer-events");
    }
    if (gate.open) { syncMode(); return; }
    var a = doc.activeElement;
    gate.opener = a && a !== doc.body && !el.contains(a) ? a : gate.opener && gate.opener.isConnected ? gate.opener : null;
    gate.open = true;
    gate.pending = "";
    inertWorld();
    measure();
    syncMode();
    busy();
    pushDoor();
    var sh = $("wgSheet");
    if (sh) sh.scrollTop = 0;
    el.classList.remove("is-entering");
    var act = root.navigator && root.navigator.userActivation;
    if (act && act.isActive && !reduced()) {
      void el.offsetWidth;
      el.classList.add("is-entering");
      clearTimeout(gate.enterTimer);
      gate.enterTimer = setTimeout(function () { el.classList.remove("is-entering"); }, ENTER_MS);
    }
    observe(true);
    if (root.requestAnimationFrame) root.requestAnimationFrame(function () { more(); });
    else more();
  }
  function leave() {
    var el = door();
    if (!el) return;
    if (!gate.open) { if (!gate.leaving) el.hidden = true; return; }
    if (gate.leaving) return;
    var kind = gate.pending || "success";
    gate.pending = "";
    gate.open = false;
    gate.leaving = true;
    freeWorld();
    observe(false);
    clearTimeout(gate.enterTimer);
    el.classList.remove("is-entering");
    el.classList.add("is-leaving");
    el.style.pointerEvents = "none";
    hideAll();
    dropDoor(kind);
    if (reduced() || doc.visibilityState === "hidden") finishHide();
    else gate.hideTimer = setTimeout(finishHide, LEAVE_MS);
    if ((kind === "ui" || kind === "popstate") && rendered(gate.opener)) {
      try { gate.opener.focus({ preventScroll: true }); } catch (e) {}
    }
    gate.opener = null;
  }
  function close(kind) {
    var back = shownBack();
    if (!gate.open || gate.leaving || !back) return false;
    gate.pending = kind;
    back.click();
    return true;
  }

  /* observers that only run while the door is open: the privacy banner coming and going, the World's late arrivals */
  function observe(on) {
    if (gate.bodyMO) { gate.bodyMO.disconnect(); gate.bodyMO = null; }
    if (!on) {
      if (gate.bannerRO) { gate.bannerRO.disconnect(); gate.bannerRO = null; gate.bannerSeen = null; }
      return;
    }
    if (typeof root.MutationObserver !== "function" || !doc.body) return;
    gate.bodyMO = new root.MutationObserver(function (list) {
      if (!gate.open) return;
      list.forEach(function (m) { each(m.addedNodes, function (n) { if (n.parentNode === doc.body) take(n); }); });
      safeBottom();
      more();
    });
    gate.bodyMO.observe(doc.body, { childList: true });
  }

  /* ---------------- wiring, once, on js/mnet.js's first word ---------------- */
  function wire() {
    if (gate.wired) return;
    var el = door();
    if (!el) return;
    gate.wired = true;
    /* the way out: a click on Back that nothing else named is the visitor's own (Escape and the scrim click it too) */
    doc.addEventListener("click", function (e) {
      var back = $("mnSignedOutBack");
      if (back && e.target && (e.target === back || back.contains(e.target)) && gate.open && !gate.pending) gate.pending = "ui";
    }, true);
    /* Show / Hide, back to hidden whenever the form is sent */
    el.addEventListener("click", function (e) {
      var t = e.target, b = t && t.closest ? t.closest("[data-reveal]") : null;
      if (b && el.contains(b)) { setReveal(b, b.getAttribute("aria-pressed") !== "true"); return; }
      if (t && t.closest && t.closest("#mnAuthGo")) hideAll();
    }, true);
    el.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest(".wg-scrim")) { close("ui"); return; }
      if (t.closest(".mn__auth-tab")) { syncMode(); return; }
      var go = t.closest(".wg-card__go");
      if (go && gate.open && gate.ctx && typeof gate.ctx.openMission === "function") {
        var id = go.getAttribute("data-mission");
        if (id) { gate.pending = "handoff"; gate.ctx.openMission(id); }
      }
    });
    /* the doors by keyboard: arrows, Home and End move between Sign in and Create account */
    var tabs = el.querySelector(".mn__auth-tabs");
    if (tabs) tabs.addEventListener("keydown", function (e) {
      var k = e.key, signIn = $("mnSignInTab"), create = $("mnCreateTab");
      if (!signIn || !create || ["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(k) < 0) return;
      var target = k === "Home" ? signIn : k === "End" ? create : (doc.activeElement === create ? signIn : create);
      e.preventDefault();
      target.click();
      target.focus();
    });
    ["mnPassword", "mnPassword2"].forEach(function (id) { var n = $(id); if (n) n.addEventListener("input", rules); });
    /* Escape: a filled field lets go first; then the door closes. Not while composing, and not for the privacy notice's own */
    doc.addEventListener("keydown", function (e) {
      if (!gate.open || gate.leaving || (e.key !== "Escape" && e.key !== "Esc")) return;
      if (e.isComposing || e.keyCode === 229) return;
      var t = e.target;
      if (t && t.closest && t.closest("#mccPrivacyNotice, #mccPrivacyGate")) return;
      var a = doc.activeElement;
      if (a && el.contains(a) && a.tagName === "INPUT" && !/^(checkbox|radio|button|submit)$/i.test(a.type || "") && a.value) { a.blur(); return; }
      close("ui");
    });
    root.addEventListener("popstate", function (e) {
      if (gate.expectPop) {
        gate.expectPop = false;
        if (gate.open) pushDoor();
        return;
      }
      if (!gate.open || gate.leaving) return;
      var st = e && "state" in e ? e.state : root.history.state;
      if (st && st.mccDoor) return;
      if (!close("popstate")) pushDoor();
    });
    var sh = $("wgSheet");
    if (sh) sh.addEventListener("scroll", more, { passive: true });
    el.addEventListener("focusin", function (e) { reveal(e.target); });
    var pending = 0;
    root.addEventListener("resize", function () {
      if (!gate.open || pending) return;
      pending = (root.requestAnimationFrame || setTimeout)(function () { pending = 0; if (gate.open) { measure(); more(); } });
    });
    if (root.visualViewport) {
      var vv = function () { if (gate.open) { viewport(); more(); } };
      root.visualViewport.addEventListener("resize", vv);
      root.visualViewport.addEventListener("scroll", vv);
    }
    if (typeof root.MutationObserver === "function") {
      new root.MutationObserver(function () { syncMode(); }).observe(el, { attributes: true, attributeFilter: ["data-auth-mode"] });
      var go = $("mnAuthGo");
      if (go) new root.MutationObserver(busy).observe(go, { attributes: true, attributeFilter: ["disabled"], childList: true, characterData: true, subtree: true });
      var status = $("mnAuthStatus");
      if (status) new root.MutationObserver(function () { more(); }).observe(status, { childList: true, characterData: true, subtree: true });
    }
    var frame = $("mnWorldFrame");
    if (frame && !gate.frameWired) {
      gate.frameWired = true;
      frame.addEventListener("load", function () { if (gate.open) paintCredit(); });
    }
  }

  /* the headline's faces, fetched once at idle after the World's first paint, so the first open never swaps faces */
  function warm() {
    if (gate.warmed) return;
    gate.warmed = true;
    if (!doc.documentElement.classList.contains("mn-guest") || !doc.fonts || typeof doc.fonts.load !== "function") return;
    var go = function () {
      try {
        doc.fonts.load('500 32px "Playfair Display"').catch(function () {});
        doc.fonts.load('italic 500 32px "Playfair Display"').catch(function () {});
      } catch (e) {}
    };
    var idle = function () { if (root.requestIdleCallback) root.requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 2500); };
    if (doc.readyState === "complete") idle();
    else root.addEventListener("load", idle, { once: true });
  }

  root.MCC_GATE = {
    shown: function (which) {
      if (which === "signedout") open();
      else warm();
    },
    opened: function (ctx) {
      gate.ctx = ctx && typeof ctx === "object" ? ctx : {};
      if (!gate.open) open();
      paintCredit();
      pulse();
      rules();
      busy();
    },
    leave: leave,
    isOpen: function () { return gate.open; },
    format: { missionCard: missionCard, newsCard: newsCard, recordCard: recordCard, eventDate: eventDate, credit: CREDIT }
  };
})(typeof window !== "undefined" ? window : this);
