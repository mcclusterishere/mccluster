/* Control Analytics > Forensics.
   Sessions you can open and visitors you can follow, instead of a wall of
   raw rows. The list comes from /v1/analytics/sessions (or /visitors),
   aggregated in Postgres; opening one fetches that session's events and the
   visitor's other sessions. Owner-only: the Worker gates every route on the
   house owner, because these rows carry IPs, places and signed-in people. */
(function () {
  "use strict";
  window.CR = window.CR || {};

  var PAGE = 40;
  var F = {
    request: null, host: null, rangeKey: null, range: null,
    mode: "sessions", filter: "all", sort: "recent", q: "",
    list: null, items: [], listError: null, loadingList: false, loadingMore: false, seq: 0,
    stack: [], detail: null, detailError: null, loadingDetail: false, dseq: 0,
    showSystem: false, raw: {}, timer: null,
    insight: { flows: null, errors: null }, insightError: { flows: null, errors: null }, insightLoading: { flows: false, errors: false },
    iseq: 0, iseqOf: { flows: 0, errors: 0 }, showInjected: false
  };
  var MODES = [["sessions", "Sessions"], ["visitors", "Visitors"], ["flows", "Flows"], ["errors", "Errors"]];
  function isInsight(m) { return m === "flows" || m === "errors"; }

  var SESSION_FILTERS = [["all", "All"], ["identified", "Signed in"], ["music", "Played music"], ["signup", "Signed up"],
    ["converted", "Converted"], ["friction", "Hit friction"], ["returning", "Returning"], ["engaged", "Engaged 1m+"], ["bots", "Bots"]];
  var VISITOR_FILTERS = [["all", "All"], ["identified", "Signed in"], ["returning", "Came back"], ["music", "Played music"],
    ["signup", "Signed up"], ["friction", "Hit friction"], ["engaged", "Engaged 2m+"], ["bots", "Bots"]];
  var SESSION_SORTS = [["recent", "Newest"], ["engaged", "Most time on screen"], ["events", "Most activity"], ["friction", "Most friction"], ["oldest", "Oldest"]];
  var VISITOR_SORTS = [["recent", "Last seen"], ["sessions", "Most sessions"], ["engaged", "Most time on screen"], ["first_seen", "First seen"]];

  /* ---------- formatting ---------- */
  function e(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function n(v) { v = Number(v); return Number.isFinite(v) ? v.toLocaleString() : "—"; }
  function trim(s, max) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > max ? s.slice(0, max - 1) + "…" : s; }
  function dur(sec) {
    sec = Math.round(Number(sec));
    if (!Number.isFinite(sec) || sec < 0) return "—";
    if (sec < 60) return sec + "s";
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + "m" + (s ? " " + s + "s" : "");
    var h = Math.floor(m / 60); m = m % 60;
    return h + "h" + (m ? " " + m + "m" : "");
  }
  function ms(a, b) { return new Date(b).getTime() - new Date(a).getTime(); }
  function clock(t) { var d = new Date(t); return isNaN(d) ? "—" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function when(t) {
    var d = new Date(t); if (isNaN(d)) return "—";
    var now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    var same = function (a, b) { return a.toDateString() === b.toDateString(); };
    var day = same(d, now) ? "Today" : same(d, y) ? "Yesterday" : d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
    return day + " " + clock(d);
  }
  function flag(cc) {
    cc = String(cc || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return "";
    return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65);
  }
  function page(p) {
    p = String(p || "").replace(/^\/+/, "").replace(/\?.*$/, "");
    if (!p || p === "index.html") return "home";
    return p.replace(/\.html$/, "");
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return trim(u, 40); } }
  function sourceLabel(s) { s = String(s || ""); return /^https?:\/\//i.test(s) ? host(s) : s; }
  function shortId(id) { id = String(id || ""); return id.slice(-6) || "?"; }

  /* What a user agent says in words: the app it ran inside (Instagram,
     TikTok...) matters more than the engine, so it is checked first. */
  function uaInfo(ua) {
    ua = String(ua || "");
    var app = /Instagram/i.test(ua) ? "Instagram app" : /FBAN|FBAV|FB_IAB/i.test(ua) ? "Facebook app"
      : /musical_ly|TikTok|BytedanceWebview/i.test(ua) ? "TikTok app" : /Snapchat/i.test(ua) ? "Snapchat app"
      : /LinkedInApp/i.test(ua) ? "LinkedIn app" : /Twitter|X-Client/i.test(ua) ? "X app" : "";
    var browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /OPR\/|Opera/.test(ua) ? "Opera"
      : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
    var os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
      : /Windows NT/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
    var bot = /bot|crawl|spider|slurp|headless|preview|facebookexternalhit/i.test(ua);
    return { os: os, app: app, browser: browser, bot: bot, label: [os, app || browser].filter(Boolean).join(" · ") };
  }
  function deviceLine(x) {
    var u = uaInfo(x.user_agent), d = x.device || {};
    var os = u.os || d.platform || "";
    return [os, u.app || u.browser, d.mobile === true && !/iPhone|Android|iPad/.test(os) ? "mobile" : ""].filter(Boolean).join(" · ") || "Unknown device";
  }
  function place(x) { return [x.city, x.region, x.country].filter(Boolean).join(", "); }
  function who(x) {
    var name = x.display_name || (x.profile && x.profile.display_name);
    var email = x.email || (x.profile && x.profile.email);
    var handle = x.handle || (x.profile && x.profile.handle);
    if (name || email || handle) return { known: true, name: name || handle || email, sub: [handle ? "@" + handle : "", email && email !== name ? email : ""].filter(Boolean).join(" · ") };
    return { known: false, name: "Visitor " + shortId(x.device_id || (x.devices && x.devices[0]) || x.visitor_key), sub: "" };
  }
  function initials(w) {
    if (!w.known) return "";
    var parts = String(w.name).replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }
  function avatar(x) {
    var w = who(x), f = flag(x.country);
    return '<span class="crf-ava' + (w.known ? " crf-ava--known" : "") + '" aria-hidden="true">' + e(w.known ? initials(w) : (f || "?")) + "</span>";
  }

  /* ---------- events, in words ---------- */
  var CATS = {
    nav: ["page_view", "page_leave", "section_view", "exit_intent"],
    music: ["album_play", "music_play", "music_full_play", "music_complete", "music_preview_play", "music_preview_complete", "song_start",
      "song_stop", "track_share", "rotation_add", "rotation_drop", "now_sheet_open", "shelf_preview", "masters_keep", "float_pause", "bar_transport", "music_seek", "listen_chip", "listen_search"],
    convert: ["account_created", "profile_created", "profile_signin", "form_submit", "checkout_view", "checkout_go", "offer_buy_click",
      "site_request", "mission_join", "action_act", "comment_post", "lockroom_sent", "create_posted"],
    friction: ["rage_click", "dead_click", "js_error", "js_rejection", "play_failed", "signup_blocked"],
    arrive: ["acquired", "ad_visit"],
    system: ["bar_boot", "device_power", "network_change", "location_permission", "precise_location", "volume_call", "volume_call_end",
      "volume_call_take", "sound_beacon", "sound_beacon_tap", "sound_gentle", "sound_toggle", "dwell", "sites_layout", "work_scene", "vr_gyro_on"]
  };
  var CAT_OF = {};
  Object.keys(CATS).forEach(function (c) { CATS[c].forEach(function (nm) { CAT_OF[nm] = c; }); });
  function category(nm) { return CAT_OF[nm] || (/(_view|_open)$/.test(nm) ? "nav" : "action"); }
  function q(s) { return "“" + trim(s, 60) + "”"; }
  function human(nm) { nm = String(nm || "event").replace(/_/g, " "); return nm.charAt(0).toUpperCase() + nm.slice(1); }
  function pct(v) { v = Number(v); return Number.isFinite(v) ? Math.round(v) + "%" : ""; }

  /* account.html names why it refused a sign-up; these are its reasons. */
  var SIGNUP_FIELDS = { first: "first name", last: "last name", email: "email", pass: "password", addr1: "street address", city: "city",
    region: "state or region", postal: "postal code", country: "country" };
  var SIGNUP_REASONS = { name_check: "the name did not look like a legal name", privacy_unchecked: "privacy policy not agreed",
    password_short: "password under 8 characters", password_mismatch: "passwords did not match" };
  function signupReason(r) {
    r = String(r || "unknown");
    if (SIGNUP_REASONS[r]) return SIGNUP_REASONS[r];
    var m = /^missing_(\w+)$/.exec(r); if (m) return "missing " + (SIGNUP_FIELDS[m[1]] || m[1]);
    m = /^server_(.+)$/.exec(r); if (m) return "the server refused it (" + m[1].replace(/_/g, " ") + ")";
    return r.replace(/_/g, " ");
  }
  function describe(x) {
    var p = x.props && typeof x.props === "object" ? x.props : {}, nm = x.name || "event", cat = category(nm), t, d = "";
    switch (nm) {
      case "page_view": t = "Opened " + (p.title ? q(p.title) : page(x.path)); if (p.visitor && p.visitor.returning) d = "returning · visit " + n(p.visitor.visits); break;
      case "page_leave": t = "Left " + page(x.path) + (p.visible_s != null ? " after " + dur(p.visible_s) + " on screen" : "");
        d = [p.depth != null ? "read " + pct(p.depth) : "", p.exit_intent ? "exit intent" : "", p.hidden_s ? dur(p.hidden_s) + " in background" : ""].filter(Boolean).join(" · "); break;
      case "scroll_depth": t = "Scrolled to " + pct(p.pct); break;
      case "click": case "cta_click": t = "Tapped " + q(p.text || p.label || p.el || "something"); d = p.href ? "→ " + trim(p.href, 60) : trim(p.el || "", 60); break;
      case "dead_click": t = "Tapped " + q(p.text || p.el || "something") + " and nothing happened"; d = trim(p.el || "", 60); break;
      case "rage_click": t = "Rage-tapped " + q(p.text || p.el || "something"); d = trim(p.el || "", 60); break;
      case "js_error": case "js_rejection":
        t = (p.origin === "injected" ? "In-app browser error (not this site): " : p.origin === "opaque" ? "Cross-origin script error: " : "Page error: ") + trim(p.msg || p.message || "unknown", 110);
        d = [p.src ? trim(p.src, 70) + (p.line ? ":" + p.line : "") : "", p.iab ? "inside " + p.iab : ""].filter(Boolean).join(" · "); break;
      case "play_failed": t = "Could not start " + q(p.track || "the track"); d = [p.error, p.gated ? "gated" + (p.gate ? " · " + p.gate : "") : ""].filter(Boolean).join(" · "); break;
      case "signup_blocked": t = "Sign-up refused: " + signupReason(p.reason); break;
      case "gated_preview_end": t = "Preview of " + q(p.track || "the song") + " ended"; d = p.gate ? "gate: " + p.gate : ""; break;
      case "desk_signal": t = "Signal: " + String(p.kind || "").replace(/_/g, " ") + (p.detail ? " · " + trim(p.detail, 60) : ""); break;
      case "album_play": case "music_play": case "song_start": case "music_full_play": case "music_preview_play":
        t = (nm === "music_preview_play" ? "Previewed " : "Played ") + q(p.track || p.song || "a track"); d = [p.album, p.source].filter(Boolean).join(" · "); break;
      case "music_complete": case "music_preview_complete": t = "Finished " + q(p.track || p.song || "the track"); break;
      case "song_stop": t = "Stopped " + q(p.song || p.track || "the track"); break;
      case "acquired": case "ad_visit": t = "Arrived from " + (sourceLabel(p.src || p.source) || "an unknown source");
        d = [p.med || p.medium, p.cmp || p.campaign, p.acq].filter(Boolean).join(" · "); break;
      case "account_created": t = "Created an account" + (p.track ? " after hearing " + q(p.track) : "");
        d = [p.source, p.medium, p.campaign, p.seconds_since_track != null ? dur(p.seconds_since_track) + " after the song" : ""].filter(Boolean).join(" · "); break;
      case "form_start": t = "Started typing in " + (p.field || p.form || "a form"); break;
      case "form_submit": t = "Submitted a form" + (p.fields ? " (" + p.fields + " field" + (p.fields === 1 ? "" : "s") + ")" : ""); break;
      case "section_view": t = "Saw the " + (p.section || "a") + " section"; break;
      case "exit_intent": t = "Reached for the exit" + (p.s != null ? " after " + dur(p.s) : ""); break;
      case "dwell": t = "Still on " + page(p.page || x.path) + " · " + dur(p.s); d = p.depth != null ? "read " + pct(p.depth) : ""; break;
      case "whisper": t = "Saw " + q(p.text || ""); break;
      case "location_permission": t = "Location permission: " + (p.state || "unknown"); break;
      case "device_power": t = "Battery " + (p.level != null ? Math.round(Number(p.level) * 100) + "%" : "?") + (p.charging ? ", charging" : ""); break;
      case "network_change": t = "Network " + ((p.network && p.network.effective) || "changed") + (p.reason ? " (" + p.reason + ")" : ""); break;
      case "checkout_view": t = "Opened checkout" + (p.offer ? " for " + p.offer : ""); break;
      case "here_view": t = "Opened the album" + (p.album ? " " + q(p.album) : ""); break;
      case "listen_view": t = "Opened Listen" + (p.tracks ? " (" + p.tracks + " tracks, " + (p.heard || 0) + " heard)" : ""); break;
      case "now_sheet_open": t = "Opened Now Playing" + (p.track ? " on " + q(p.track) : ""); break;
      default: t = human(nm) + (p.page ? " · " + page(p.page) : "");
    }
    return { cat: cat, text: t, detail: d };
  }

  /* One visit to one page: everything from the first event on a path until
     the path changes or the page is opened again. An arrival event recorded
     just before its page_view stays in the same visit. */
  function pageVisits(events) {
    var groups = [], cur = null;
    (events || []).forEach(function (x, i) {
      var path = x.path || "(no page)";
      if (!cur || path !== cur.path || (x.name === "page_view" && cur.viewed)) {
        cur = { path: path, title: null, start: x.at, end: x.at, visible: null, depth: null, viewed: false, events: [] };
        groups.push(cur);
      }
      var p = x.props || {};
      if (x.name === "page_view") { cur.viewed = true; if (p.title) cur.title = p.title; }
      if (x.name === "page_leave") { if (p.visible_s != null) cur.visible = Number(p.visible_s); if (p.depth != null) cur.depth = Number(p.depth); }
      if (x.name === "scroll_depth" && p.pct != null) cur.depth = Math.max(cur.depth || 0, Number(p.pct) || 0);
      cur.end = x.at; cur.events.push({ ev: x, i: i });
    });
    return groups;
  }
  function visitTime(g) { return g.visible != null ? g.visible : Math.max(0, ms(g.start, g.end) / 1000); }

  /* ---------- data ---------- */
  function qs(obj) { return Object.keys(obj).filter(function (k) { return obj[k] !== null && obj[k] !== undefined && obj[k] !== ""; }).map(function (k) { return k + "=" + encodeURIComponent(obj[k]); }).join("&"); }
  function listPath(offset) {
    return "/v1/analytics/" + (F.mode === "visitors" ? "visitors" : "sessions") + "?" + qs({
      since: F.range && F.range.since, until: F.range && F.range.until, limit: PAGE, offset: offset,
      filter: F.filter, sort: F.sort, q: F.q.trim()
    });
  }
  function loadList(more) {
    if (!F.request) return;
    var seq = ++F.seq, offset = more ? F.items.length : 0;
    if (more) F.loadingMore = true; else { F.loadingList = true; F.listError = null; }
    paint();
    F.request(listPath(offset)).then(function (out) {
      if (seq !== F.seq) return;
      var rows = (F.mode === "visitors" ? out.visitors : out.sessions) || [];
      F.list = out; F.items = more ? F.items.concat(rows) : rows;
    }, function (err) {
      if (seq !== F.seq) return;
      F.listError = err;
    }).then(function () {
      if (seq !== F.seq) return;
      F.loadingList = false; F.loadingMore = false; paint();
    });
  }
  function loadInsight(kind) {
    if (!F.request) return;
    /* One request per kind at a time; an answer for a range that has since
       been replaced is dropped rather than painted over the new one. */
    var seq = ++F.iseq, key = F.rangeKey;
    F.iseqOf[kind] = seq;
    F.insightLoading[kind] = true; F.insightError[kind] = null; paint();
    var path = "/v1/analytics/" + kind + "?" + qs({ since: F.range && F.range.since, until: F.range && F.range.until });
    var mine = function () { return F.iseqOf[kind] === seq && F.rangeKey === key; };
    F.request(path).then(function (out) { if (mine()) F.insight[kind] = out; },
      function (err) { if (mine()) F.insightError[kind] = err; })
      .then(function () { if (mine()) { F.insightLoading[kind] = false; paint(); } });
  }
  function top() { return F.stack[F.stack.length - 1] || null; }
  function open(entry, replace) {
    if (replace) F.stack = [];
    F.stack.push(entry); F.raw = {}; loadDetail(); scrollToTop();
  }
  function back() { F.stack.pop(); F.raw = {}; if (top()) loadDetail(); else { F.detail = null; paint(); } }
  function loadDetail() {
    var t = top(); if (!t || !F.request) return;
    var seq = ++F.dseq; F.loadingDetail = true; F.detailError = null; F.detail = null; paint();
    var path = t.type === "session" ? "/v1/analytics/sessions/" + encodeURIComponent(t.id) : "/v1/analytics/visitors/" + encodeURIComponent(t.key);
    F.request(path).then(function (out) { if (seq === F.dseq) F.detail = out; }, function (err) { if (seq === F.dseq) F.detailError = err; })
      .then(function () { if (seq === F.dseq) { F.loadingDetail = false; paint(); } });
  }
  function scrollToTop() { try { if (F.host && F.host.scrollIntoView) F.host.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (_) {} }

  /* ---------- list ---------- */
  function badge(text, kind, title) { return '<span class="crf-badge' + (kind ? " crf-badge--" + kind : "") + '"' + (title ? ' title="' + e(title) + '"' : "") + ">" + e(text) + "</span>"; }
  function sessionBadges(s) {
    var b = [];
    if (s.is_bot) b.push(badge("Bot", "muted"));
    if (s.signed_up) b.push(badge("Signed up", "win"));
    if (s.checkout) b.push(badge("Checkout", "win"));
    if (s.submitted) b.push(badge("Sent a form", "win"));
    if (s.plays) b.push(badge("▶ " + n(s.plays), "music", s.plays + " plays"));
    if (s.friction) b.push(badge("⚠ " + n(s.friction), "bad", [s.rage_clicks ? s.rage_clicks + " rage" : "", s.dead_clicks ? s.dead_clicks + " dead" : "", s.errors ? s.errors + " errors" : ""].filter(Boolean).join(", ")));
    if (s.visit_number > 1) b.push(badge("Visit " + n(s.visit_number), "info"));
    else if (s.device_sessions > 1) b.push(badge("Returning", "info"));
    if (s.source && s.source !== "direct") b.push(badge(sourceLabel(s.source), "src"));
    return b.join("");
  }
  function strip(pages) {
    var seq = [];
    (pages || []).forEach(function (p) { var k = page(p); if (seq[seq.length - 1] !== k) seq.push(k); });
    if (!seq.length) return '<span class="crf-strip crf-strip--empty">no page views</span>';
    var shown = seq.slice(0, 4), more = seq.length - shown.length;
    return '<span class="crf-strip">' + shown.map(function (p) { return "<i>" + e(p) + "</i>"; }).join('<b aria-hidden="true">→</b>') + (more > 0 ? "<em>+" + more + "</em>" : "") + "</span>";
  }
  function sessionCard(s, current) {
    var w = who(s);
    return '<button type="button" class="crf-item' + (current ? " is-current" : "") + '" data-crf-session="' + e(s.session_id) + '">' + avatar(s) +
      '<span class="crf-item__main"><span class="crf-item__top"><b>' + e(w.known ? w.name : (place(s) || w.name)) + "</b><time>" + e(when(s.started_at)) + "</time></span>" +
      '<span class="crf-item__sub">' + e([w.known ? place(s) : w.name, deviceLine(s), s.network].filter(Boolean).join(" · ")) + "</span>" +
      strip(s.pages) + '<span class="crf-badges">' + sessionBadges(s) + "</span></span>" +
      '<span class="crf-item__dur"><b>' + e(dur(s.duration_s)) + "</b><small>" + n(s.events) + " events</small></span></button>";
  }
  function visitorCard(v) {
    var w = who(v), b = [];
    if (v.is_bot) b.push(badge("Bot", "muted"));
    if (v.signed_up) b.push(badge("Signed up", "win"));
    if (v.plays) b.push(badge("▶ " + n(v.plays), "music"));
    if (v.friction) b.push(badge("⚠ " + n(v.friction), "bad"));
    if (v.sessions > 1) b.push(badge(n(v.sessions) + " sessions", "info"));
    if (v.first_source && v.first_source !== "direct") b.push(badge(sourceLabel(v.first_source), "src"));
    return '<button type="button" class="crf-item" data-crf-visitor="' + e(v.visitor_key) + '">' + avatar(v) +
      '<span class="crf-item__main"><span class="crf-item__top"><b>' + e(w.known ? w.name : (place(v) || w.name)) + "</b><time>" + e(when(v.last_seen)) + "</time></span>" +
      '<span class="crf-item__sub">' + e([w.known ? place(v) : w.name, deviceLine(v), v.network].filter(Boolean).join(" · ")) + "</span>" +
      '<span class="crf-item__sub">First seen ' + e(when(v.first_seen)) + (v.first_page ? " on " + e(page(v.first_page)) : "") + " · active " + n(v.active_days) + (v.active_days === 1 ? " day" : " days") + "</span>" +
      '<span class="crf-badges">' + b.join("") + "</span></span>" +
      '<span class="crf-item__dur"><b>' + e(dur(v.engaged_s)) + "</b><small>on screen</small></span></button>";
  }
  function summary() {
    var c = (F.list && F.list.counts) || {}, label = F.range && F.range.label ? " in " + F.range.label.toLowerCase() : "";
    if (!F.list) return "";
    if (F.mode === "visitors") {
      return '<p class="crf-lead"><b>' + n(c.all) + " visitors" + e(label) + ".</b> " + n(c.identified) + " signed in, " + n(c.returning) + " came back more than once, " +
        n(c.signup) + " signed up, " + n(c.friction) + " hit friction." + (c.bots ? " " + n(c.bots) + " bots set aside." : "") + "</p>";
    }
    var un = Number(F.list.unsessioned_events);
    return '<p class="crf-lead"><b>' + n(c.all) + " sessions from " + n(c.visitors) + " devices" + e(label) + ".</b> " + n(c.identified) + " signed in, " +
      n(c.music) + " played music, " + n(c.signup) + " signed up, " + n(c.friction) + " hit friction." +
      (un ? ' <span class="crf-lead__note">' + n(un) + " more events came from visitors who declined identifiers; they are counted, never stitched together.</span>" : "") + "</p>";
  }
  function toolbar() {
    var filters = F.mode === "visitors" ? VISITOR_FILTERS : SESSION_FILTERS, sorts = F.mode === "visitors" ? VISITOR_SORTS : SESSION_SORTS, c = (F.list && F.list.counts) || {};
    var seg = '<div class="crf-seg crf-seg--four" role="tablist" aria-label="View">' + MODES.map(function (m) {
        return '<button type="button" role="tab" aria-selected="' + (F.mode === m[0]) + '" class="crf-seg__b' + (F.mode === m[0] ? " is-on" : "") + '" data-crf-mode="' + m[0] + '">' + m[1] + "</button>";
      }).join("") + "</div>";
    if (isInsight(F.mode)) return '<div class="crf-bar">' + seg + "</div>";
    return '<div class="crf-bar">' + seg +
      '<label class="crf-search"><span class="crf-sr">Search</span><input type="search" data-crf-q value="' + e(F.q) + '" placeholder="' +
      (F.mode === "visitors" ? "Email, city, IP, network, device…" : "Page, song, email, city, IP, source…") + '" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>' +
      '<label class="crf-sort"><span class="crf-sr">Sort</span><select data-crf-sort>' + sorts.map(function (s) { return '<option value="' + s[0] + '"' + (F.sort === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + "</select></label>" +
      '<div class="crf-chips">' + filters.map(function (f) {
        var count = c[f[0]];
        return '<button type="button" class="crf-chip' + (F.filter === f[0] ? " is-on" : "") + '" data-crf-filter="' + f[0] + '">' + e(f[1]) + (count != null ? " <b>" + n(count) + "</b>" : "") + "</button>";
      }).join("") + "</div></div>";
  }
  function listPane() {
    if (F.mode === "flows") return '<section class="crf-list" aria-label="Flows">' + toolbar() + flowsPane() + "</section>";
    if (F.mode === "errors") return '<section class="crf-list" aria-label="Errors">' + toolbar() + errorsPane() + "</section>";
    var body;
    if (F.loadingList && !F.items.length) body = skeleton();
    else if (F.listError) body = '<div class="crf-empty crf-empty--bad"><b>Could not load ' + e(F.mode) + ".</b><span>" + e(F.listError.message || F.listError) + '</span><button type="button" class="crf-btn" data-crf-retry>Try again</button></div>';
    else if (!F.items.length) body = '<div class="crf-empty"><b>Nothing matches.</b><span>' + (F.q || F.filter !== "all" ? "Clear the search or pick another filter." : "No first-party traffic in this range.") + "</span></div>";
    else {
      var cur = top(), total = Number(F.list && F.list.total) || F.items.length;
      body = '<div class="crf-items">' + F.items.map(function (x) {
        return F.mode === "visitors" ? visitorCard(x) : sessionCard(x, cur && cur.type === "session" && cur.id === x.session_id);
      }).join("") + "</div>" +
        '<p class="crf-count">Showing ' + n(F.items.length) + " of " + n(total) + "</p>" +
        (F.items.length < total ? '<button type="button" class="crf-btn crf-more" data-crf-more' + (F.loadingMore ? " disabled" : "") + ">" + (F.loadingMore ? "Loading…" : "Show " + Math.min(PAGE, total - F.items.length) + " more") + "</button>" : "");
    }
    return '<section class="crf-list" aria-label="' + e(F.mode) + '">' + toolbar() + summary() + body + "</section>";
  }
  function skeleton() { var s = ""; for (var i = 0; i < 6; i++) s += '<div class="crf-item crf-item--ghost"><span class="crf-ava"></span><span class="crf-item__main"><i></i><i></i><i></i></span></div>'; return '<div class="crf-items" aria-busy="true">' + s + "</div>"; }

  /* ---------- flows: how people move, across every session ---------- */
  function sampleButtons(ids) {
    return (ids || []).length ? '<span class="crf-samples">' + ids.map(function (id, i) {
      return '<button type="button" class="crf-sample" data-crf-session="' + e(id) + '" title="Open this session">Journey ' + (i + 1) + "</button>";
    }).join("") + "</span>" : "";
  }
  function meter(pct, kind) {
    pct = Math.max(0, Math.min(100, Number(pct) || 0));
    return '<span class="crf-meter' + (kind ? " crf-meter--" + kind : "") + '" aria-hidden="true"><i style="--pct:' + pct + '%"></i></span>';
  }
  function insightState(kind) {
    if (F.insightLoading[kind] && !F.insight[kind]) return skeleton();
    if (F.insightError[kind]) return '<div class="crf-empty crf-empty--bad"><b>Could not load ' + kind + ".</b><span>" + e(F.insightError[kind].message || F.insightError[kind]) + '</span><button type="button" class="crf-btn" data-crf-insight-retry>Try again</button></div>';
    return null;
  }
  function rangeNote(out) {
    var notes = [];
    if (out.range && out.range.clamped) notes.push("Flows and errors cover the latest 31 days of the selected range.");
    if (out.truncated) notes.push("Read the first " + n(out.rows_read) + " rows; narrow the range for the rest.");
    return notes.length ? '<p class="crf-lead__note">' + e(notes.join(" ")) + "</p>" : "";
  }
  function flowsPane() {
    var busy = insightState("flows"); if (busy) return busy;
    var out = F.insight.flows; if (!out) return "";
    var f = out.flows || {}, pps = f.pages_per_session || {}, total = Number(f.sessions) || 0;
    if (!total) return '<div class="crf-empty"><b>No page views in this range.</b><span>Pick a wider range.</span></div>';
    var lead = '<p class="crf-lead"><b>' + n(total) + " sessions moved through the site.</b> " + n(f.bounced) + " (" + n(f.bounce_rate) + "%) left after one page.</p>" + rangeNote(out);
    var depth = '<section class="crf-sec"><h3>Pages per session</h3><ul class="crf-bars">' + ["1", "2", "3", "4", "5+"].map(function (k) {
      var v = Number(pps[k]) || 0;
      return '<li><span class="crf-bars__k">' + k + (k === "1" ? " page" : " pages") + "</span>" + meter(v / total * 100) + "<b>" + n(v) + "</b></li>";
    }).join("") + "</ul></section>";
    var entries = '<section class="crf-sec"><h3>Where they land</h3><ul class="crf-rows">' + (f.entries || []).map(function (p) {
      return '<li class="crf-row"><span class="crf-row__main"><b>' + e(page(p.path)) + "</b><small>" + n(p.sessions) + " sessions · " +
        n(p.bounce_rate) + "% left right away · " + n(p.played_pct) + "% played music · " + n(p.signup_pct) + "% signed up</small></span>" + meter(100 - p.bounce_rate, "win") + "</li>";
    }).join("") + "</ul></section>";
    var next = '<section class="crf-sec"><h3>Where they go next</h3><div class="crf-cards">' + (f.pages || []).slice(0, 8).map(function (p) {
      return '<section class="crf-card"><h3>' + e(page(p.path)) + " <small>" + n(p.sessions) + " sessions" + (p.median_visible_s != null ? " · " + dur(p.median_visible_s) + " typical" : "") +
        (p.avg_depth != null ? " · read " + pct(p.avg_depth) : "") + "</small></h3><ul class=\"crf-bars\">" + (p.next || []).map(function (x) {
          return '<li><span class="crf-bars__k">' + (x.path === "(left)" ? "left the site" : e(page(x.path))) + "</span>" + meter(x.pct, x.path === "(left)" ? "bad" : "") + "<b>" + n(x.pct) + "%</b></li>";
        }).join("") + "</ul></section>";
    }).join("") + "</div></section>";
    var paths = '<section class="crf-sec"><h3>Most common paths</h3><ol class="crf-rows">' + (f.paths || []).map(function (p) {
      return '<li class="crf-row crf-row--count"><span class="crf-row__main"><span class="crf-strip">' + p.path.split(" → ").map(function (x) { return "<i>" + e(x === "…" ? "…" : page(x)) + "</i>"; }).join('<b aria-hidden="true">→</b>') +
        "</span></span><b title=\"sessions\">" + n(p.sessions) + "</b></li>";
    }).join("") + "</ol></section>";
    var steps = '<section class="crf-sec"><h3>Busiest steps</h3><ul class="crf-rows">' + (f.transitions || []).slice(0, 12).map(function (x) {
      return '<li class="crf-row"><span class="crf-row__main"><b>' + e(page(x.from)) + " → " + e(page(x.to)) + "</b><small>" + n(x.sessions) + " sessions</small>" + sampleButtons(x.sample_sessions) + "</span></li>";
    }).join("") + "</ul></section>";
    var exits = '<section class="crf-sec"><h3>Where they leave</h3><ul class="crf-rows">' + (f.exits || []).map(function (p) {
      return '<li class="crf-row"><span class="crf-row__main"><b>' + e(page(p.path)) + "</b><small>" + n(p.sessions) + " sessions ended here · " + n(p.exit_rate) + "% of its visitors</small></span>" + meter(p.exit_rate, "bad") + "</li>";
    }).join("") + "</ul></section>";
    return lead + depth + entries + next + paths + steps + exits;
  }

  /* ---------- errors: every error and friction point, grouped ---------- */
  var ORIGIN_WORDS = { site: ["This site", "bad"], third_party: ["Third-party script", "info"], opaque: ["Cross-origin (no detail)", "muted"], injected: ["Injected by an in-app browser or extension", "muted"] };
  var KIND_WORDS = { js_error: "Error", js_rejection: "Unhandled promise", dead_click: "Tap that did nothing", rage_click: "Rage taps",
    play_failed: "Play could not start", signup_blocked: "Sign-up refused", gated_preview_end: "Gated preview ended", checkout_retired_link: "Retired payment link" };
  function groupMeta(g) {
    return '<small class="crf-row__meta">' + n(g.count) + (g.count === 1 ? " time" : " times") + " · " + n(g.sessions) + (g.sessions === 1 ? " session" : " sessions") +
      " · " + n(g.devices) + (g.devices === 1 ? " device" : " devices") + " · first " + e(when(g.first_at)) + " · last " + e(when(g.last_at)) + "</small>" +
      '<small class="crf-row__meta">' + (g.pages || []).map(function (p) { return e(page(p.path)) + " ×" + n(p.count); }).join(", ") +
      ((g.browsers || []).length ? " · " + g.browsers.map(function (b) { return e(b.browser) + " ×" + n(b.count); }).join(", ") : "") + "</small>";
  }
  function errorRow(g) {
    var o = ORIGIN_WORDS[g.origin] || ["Unknown", "muted"];
    return '<li class="crf-err crf-err--' + e(g.origin || "unknown") + '"><div class="crf-badges">' + badge(KIND_WORDS[g.kind] || g.kind, g.origin === "site" ? "bad" : "muted") + badge(o[0], o[1]) + "</div>" +
      "<b>" + e(trim(g.message, 200)) + "</b>" + (g.source ? '<code class="crf-err__src">' + e(trim(g.source, 120)) + (g.line ? ":" + e(g.line) : "") + "</code>" : "") +
      groupMeta(g) + (g.stack ? '<details class="crf-ua"><summary>Stack</summary><code>' + e(g.stack) + "</code></details>" : "") + sampleButtons(g.sample_sessions) + "</li>";
  }
  function frictionRow(g) {
    return '<li class="crf-err"><div class="crf-badges">' + badge(KIND_WORDS[g.kind] || g.kind, "bad") + "</div><b>" +
      e(g.kind === "dead_click" || g.kind === "rage_click" ? (g.text ? q(g.text) + " · " : "") + g.target : g.kind === "signup_blocked" ? signupReason(g.detail) : g.detail) + "</b>" + groupMeta(g) + sampleButtons(g.sample_sessions) + "</li>";
  }
  function errorsPane() {
    var busy = insightState("errors"); if (busy) return busy;
    var out = F.insight.errors; if (!out) return "";
    var tt = out.totals || {}, errs = out.errors || [];
    var own = errs.filter(function (g) { return g.origin !== "injected"; }), injected = errs.filter(function (g) { return g.origin === "injected"; });
    var lead = '<p class="crf-lead"><b>' + n(tt.sessions_affected) + " sessions hit an error or friction.</b> " + n(tt.errors) + " page errors (" + n(tt.site_errors) + " from this site’s code, " +
      n(tt.injected_errors) + " injected by in-app browsers or extensions), " + n(tt.friction) + " dead or rage taps, " + n(tt.journey) + " blocked steps.</p>" + rangeNote(out);
    var siteSec = '<section class="crf-sec"><h3>Errors</h3>' + (own.length ? '<ul class="crf-errs">' + own.map(errorRow).join("") + "</ul>" : '<p class="crf-muted">No errors from this site’s own code in this range.</p>') +
      (injected.length ? '<button type="button" class="crf-btn crf-btn--ghost" data-crf-injected>' + (F.showInjected ? "Hide" : "Show") + " " + n(injected.length) + " injected error" + (injected.length === 1 ? "" : "s") + " (not this site’s code)</button>" +
        (F.showInjected ? '<ul class="crf-errs">' + injected.map(errorRow).join("") + "</ul>" : "") : "") + "</section>";
    var fr = '<section class="crf-sec"><h3>Taps that went nowhere</h3>' + ((out.friction || []).length ? '<ul class="crf-errs">' + out.friction.map(frictionRow).join("") + "</ul>" : '<p class="crf-muted">None in this range.</p>') + "</section>";
    var jr = '<section class="crf-sec"><h3>Blocked steps</h3>' + ((out.journey || []).length ? '<ul class="crf-errs">' + out.journey.map(frictionRow).join("") + "</ul>" : '<p class="crf-muted">None in this range.</p>') + "</section>";
    return lead + siteSec + jr + fr;
  }

  /* ---------- session detail ---------- */
  function facts(rows) {
    rows = rows.filter(function (r) { return r[1] != null && r[1] !== ""; });
    return rows.length ? '<dl class="crf-facts">' + rows.map(function (r) { return "<div><dt>" + e(r[0]) + "</dt><dd>" + (r[2] ? r[1] : e(r[1])) + "</dd></div>"; }).join("") + "</dl>" : '<p class="crf-muted">Not recorded.</p>';
  }
  function kpi(label, value, sub) { return '<div class="crf-kpi"><small>' + e(label) + "</small><b>" + e(value) + "</b>" + (sub ? "<span>" + e(sub) + "</span>" : "") + "</div>"; }
  function arrival(events, s) {
    var a = null;
    (events || []).some(function (x) { if (x.name === "acquired" || x.name === "ad_visit" || x.name === "account_created") { a = x.props || {}; return x.name !== "account_created"; } return false; });
    a = a || {};
    return {
      source: sourceLabel(a.src || a.source || s.source) || "direct",
      medium: a.med || a.medium || "",
      campaign: a.cmp || a.campaign || "",
      referrer: s.referrer || (events.find(function (x) { return x.referrer; }) || {}).referrer || ""
    };
  }
  function journeyPath(groups) {
    if (!groups.length) return "";
    return '<ol class="crf-path">' + groups.map(function (g, i) {
      return '<li><a href="#crf-visit-' + i + '" data-crf-jump="' + i + '"><b>' + e(page(g.path)) + "</b><span>" + e(dur(visitTime(g))) + "</span></a></li>";
    }).join("") + "</ol>";
  }
  function stepRow(item, start, idx) {
    var x = item.ev, d = describe(x), open = !!F.raw[item.i];
    var off = Math.max(0, Math.round(ms(start, x.at) / 1000));
    return '<li class="crf-step crf-step--' + d.cat + '">' +
      '<button type="button" class="crf-step__b" data-crf-raw="' + item.i + '" aria-expanded="' + open + '">' +
      '<span class="crf-step__t">+' + e(dur(off)) + '</span><span class="crf-step__dot" aria-hidden="true"></span>' +
      '<span class="crf-step__txt"><b>' + e(d.text) + "</b>" + (d.detail ? "<small>" + e(d.detail) + "</small>" : "") + "</span></button>" +
      (open ? '<pre class="crf-raw">' + e(JSON.stringify({ name: x.name, at: x.at, path: x.path, props: x.props, referrer: x.referrer || undefined }, null, 2)) + "</pre>" : "") + "</li>";
  }
  function timeline(events) {
    var groups = pageVisits(events), hidden = 0, out = [];
    groups.forEach(function (g, gi) {
      var shown = g.events.filter(function (it) { var sys = category(it.ev.name) === "system"; if (sys && !F.showSystem) hidden++; return F.showSystem || !sys; });
      if (gi) {
        var gap = ms(groups[gi - 1].end, g.start) / 1000;
        if (gap >= 5) out.push('<div class="crf-gap">' + e(dur(gap)) + " later</div>");
      }
      out.push('<section class="crf-visit" id="crf-visit-' + gi + '"><header class="crf-visit__h"><span class="crf-visit__n">' + (gi + 1) + "</span>" +
        '<span class="crf-visit__name"><b>' + e(page(g.path)) + "</b>" + (g.title ? "<small>" + e(trim(g.title, 90)) + "</small>" : "") + "</span>" +
        '<span class="crf-visit__meta"><time>' + e(clock(g.start)) + "</time><span>" + e(dur(visitTime(g))) + (g.depth != null ? " · read " + pct(g.depth) : "") + "</span></span></header>" +
        (g.depth != null ? '<span class="crf-depth" aria-hidden="true"><i style="--pct:' + Math.max(2, Math.min(100, g.depth)) + '%"></i></span>' : "") +
        (shown.length ? '<ol class="crf-steps">' + shown.map(function (it, k) { return stepRow(it, g.start, k); }).join("") + "</ol>" : '<p class="crf-muted">Only background events on this page.</p>') +
        "</section>");
    });
    var toggle = '<button type="button" class="crf-btn crf-btn--ghost" data-crf-system>' + (F.showSystem ? "Hide device &amp; background events" : "Show " + n(hidden) + " device &amp; background events") + "</button>";
    return (hidden || F.showSystem ? toggle : "") + out.join("");
  }
  function historyList(v, currentId) {
    var list = (v && v.sessions) || [];
    if (!list.length) return '<p class="crf-muted">No other sessions on this device in the last 180 days.</p>';
    var oldest = list[list.length - 1];
    return '<div class="crf-items crf-items--compact">' + list.map(function (s) { return sessionCard(s, s.session_id === currentId); }).join("") + "</div>" +
      (Number(v.total) > list.length ? '<p class="crf-count">Showing the latest ' + n(list.length) + " of " + n(v.total) + "</p>" :
        '<p class="crf-origin">Their journey begins ' + e(when(oldest.started_at)) + " on " + e(page(oldest.entry_path)) + ".</p>");
  }
  /* Every moment the session went wrong, with what the visitor had just
     tapped and what they did next: the two questions a raw error row never
     answers. Injected in-app-browser errors are listed but say so. */
  var TROUBLE = CATS.friction.concat(["gated_preview_end", "checkout_retired_link"]);
  var TAPS = ["click", "cta_click", "dead_click", "rage_click"];
  var PLAYS = ["album_play", "music_play", "song_start", "music_full_play", "music_preview_play"];
  function isTrouble(nm) { return TROUBLE.indexOf(nm) !== -1; }
  function troubleMoments(groups, start) {
    var out = [];
    groups.forEach(function (g, gi) {
      g.events.forEach(function (it, k) {
        var x = it.ev; if (!isTrouble(x.name)) return;
        var before = null, after = null;
        for (var b = k - 1; b >= 0; b--) {
          var pb = g.events[b].ev;
          if (ms(pb.at, x.at) > 30000) break;
          if (TAPS.indexOf(pb.name) !== -1 || PLAYS.indexOf(pb.name) !== -1) { before = pb; break; }
        }
        for (var a = k + 1; a < g.events.length; a++) {
          var pa = g.events[a].ev;
          if (category(pa.name) !== "system" && !isTrouble(pa.name)) { after = pa; break; }
        }
        if (!after && groups[gi + 1]) after = { name: "page_view", at: groups[gi + 1].start, path: groups[gi + 1].path, props: {} };
        out.push({ ev: x, gi: gi, before: before, after: after, off: Math.max(0, Math.round(ms(start, x.at) / 1000)) });
      });
    });
    return out;
  }
  function troubleSection(groups, start) {
    var list = troubleMoments(groups, start);
    if (!list.length) return '<section class="crf-sec"><h3>Where it went wrong</h3><p class="crf-muted">No errors, dead taps or blocked steps in this session.</p></section>';
    return '<section class="crf-sec"><h3>Where it went wrong <small>' + n(list.length) + "</small></h3><ol class=\"crf-errs\">" + list.map(function (m) {
      var x = m.ev, d = describe(x), p = x.props || {}, own = !(x.name === "js_error" || x.name === "js_rejection") || !p.origin || p.origin === "site";
      var lines = [];
      if (m.before) lines.push("Just before: " + describe(m.before).text.charAt(0).toLowerCase() + describe(m.before).text.slice(1) + " (" + dur(Math.max(0, ms(m.before.at, x.at) / 1000)) + " earlier)");
      lines.push(m.after ? "Then: " + (m.after.name === "page_view" && m.after.path !== x.path ? "went to " + page(m.after.path) : describe(m.after).text.charAt(0).toLowerCase() + describe(m.after).text.slice(1)) +
        " (" + dur(Math.max(0, ms(x.at, m.after.at) / 1000)) + " later)" : "Then: nothing more was recorded in this session");
      return '<li class="crf-err' + (own ? "" : " crf-err--injected") + '"><div class="crf-badges">' + badge(KIND_WORDS[x.name] || human(x.name), own ? "bad" : "muted") +
        badge("Page " + (m.gi + 1) + " · " + page(groups[m.gi].path), "info") + badge("+" + dur(m.off), "muted") + "</div><b>" + e(d.text) + "</b>" +
        (d.detail ? '<small class="crf-row__meta">' + e(d.detail) + "</small>" : "") +
        lines.map(function (l) { return '<small class="crf-row__meta">' + e(l) + "</small>"; }).join("") +
        '<a class="crf-jumpl" href="#crf-visit-' + m.gi + '" data-crf-jump="' + m.gi + '">See it in the journey ↓</a></li>';
    }).join("") + "</ol></section>";
  }
  /* The session one page at a time: how long each held them, how far they
     read, and what they did there. */
  function pagesSection(groups) {
    if (!groups.length) return "";
    var total = groups.reduce(function (t, g) { return t + visitTime(g); }, 0) || 1;
    return '<section class="crf-sec"><h3>Page by page</h3><ol class="crf-rows crf-pages">' + groups.map(function (g, gi) {
      var c = { taps: 0, plays: 0, trouble: 0, won: 0 };
      g.events.forEach(function (it) {
        var nm = it.ev.name;
        if (TAPS.indexOf(nm) !== -1) c.taps++;
        if (PLAYS.indexOf(nm) !== -1) c.plays++;
        if (isTrouble(nm)) c.trouble++;
        if (category(nm) === "convert") c.won++;
      });
      var t = visitTime(g), meta = [dur(t) + " on screen", g.depth != null ? "read " + pct(g.depth) : "", n(c.taps) + (c.taps === 1 ? " tap" : " taps"),
        c.plays ? n(c.plays) + (c.plays === 1 ? " play" : " plays") : "", c.won ? n(c.won) + " converted" : "", c.trouble ? n(c.trouble) + " went wrong" : ""].filter(Boolean).join(" · ");
      return '<li class="crf-row' + (c.trouble ? " crf-row--bad" : "") + '"><a class="crf-row__main" href="#crf-visit-' + gi + '" data-crf-jump="' + gi + '"><b>' + (gi + 1) + ". " + e(page(g.path)) + "</b><small>" + e(meta) + "</small></a>" +
        meter(t / total * 100, c.trouble ? "bad" : "") + "</li>";
    }).join("") + "</ol></section>";
  }
  function sessionDetail(d) {
    var s = d.session || {}, ev = d.events || [], v = d.visitor || {}, w = who(Object.assign({}, s, { profile: v.profile })), arr = arrival(ev, s), dev = s.device || {}, u = uaInfo(s.user_agent);
    var groups = pageVisits(ev), maxDepth = s.max_depth != null ? s.max_depth : groups.reduce(function (m, g) { return Math.max(m, g.depth || 0); }, 0);
    var head = '<header class="crf-dh">' + avatar(Object.assign({}, s, { display_name: w.known ? w.name : null })) +
      '<div class="crf-dh__t"><h2>' + e(w.known ? w.name : "Anonymous visitor") + "</h2><p>" + e([when(s.started_at), dur(s.duration_s), place(s)].filter(Boolean).join(" · ")) + "</p>" +
      '<span class="crf-badges">' + sessionBadges(s) + "</span></div>" +
      (v.key ? '<button type="button" class="crf-btn" data-crf-visitor="' + e(v.key) + '">Visitor profile</button>' : "") + "</header>";
    var kpis = '<div class="crf-kpis">' + kpi("Session", dur(s.duration_s), clock(s.started_at) + " – " + clock(s.ended_at)) + kpi("On screen", dur(s.engaged_s)) +
      kpi("Pages", n(s.page_views)) + kpi("Taps", n(s.clicks)) + kpi("Plays", n(s.plays)) + kpi("Deepest read", maxDepth ? pct(maxDepth) : "—") +
      kpi("Friction", n(s.friction), [s.rage_clicks ? s.rage_clicks + " rage" : "", s.dead_clicks ? s.dead_clicks + " dead" : "", s.errors ? s.errors + " errors" : ""].filter(Boolean).join(" · ")) + "</div>";
    var cards = '<div class="crf-cards">' +
      card("Who", facts([["Person", w.known ? w.name : "Not signed in"], ["Account", w.sub], ["Visit", s.visit_number ? "#" + n(s.visit_number) + (s.days_known ? " · known " + n(s.days_known) + " days" : "") : (s.device_sessions > 1 ? "Returning in this range" : "First seen in this range")],
        ["Device id", s.device_id ? "<code>" + e(s.device_id) + "</code>" : "", true], ["Session id", "<code>" + e(s.session_id) + "</code>", true]])) +
      card("Arrived", facts([["Source", arr.source], ["Medium", arr.medium], ["Campaign", arr.campaign], ["Referrer", arr.referrer ? host(arr.referrer) : "none"], ["Landed on", page(s.entry_path)], ["Left from", page(s.exit_path)]])) +
      card("Where", facts([["Place", place(s) + (s.postal ? " " + s.postal : "")], ["Time zone", s.timezone], ["IP", s.ip ? "<code>" + e(s.ip) + "</code>" : "", true],
        ["Network", s.network ? s.network + (s.asn ? " · AS" + s.asn : "") : ""],
        ["Map", s.latitude != null && s.longitude != null ? '<a href="https://www.openstreetmap.org/?mlat=' + encodeURIComponent(s.latitude) + "&mlon=" + encodeURIComponent(s.longitude) + '#map=11/' + encodeURIComponent(s.latitude) + "/" + encodeURIComponent(s.longitude) + '" target="_blank" rel="noopener noreferrer">Approximate location ↗</a>' : "", true]])) +
      card("Device", facts([["Device", [u.os || dev.platform, dev.mobile === true ? "mobile" : dev.mobile === false ? "desktop" : ""].filter(Boolean).join(" · ")], ["App / browser", u.app || u.browser],
        ["Screen", dev.screen ? dev.screen + (dev.dpr ? " @" + dev.dpr + "x" : "") : ""], ["Viewport", dev.viewport], ["Language", dev.language], ["Connection", dev.network && (dev.network.effective || dev.network.type)],
        ["User agent", s.user_agent ? '<details class="crf-ua"><summary>Show</summary><code>' + e(s.user_agent) + "</code></details>" : "", true]])) + "</div>";
    var wrong = troubleSection(groups, s.started_at || (ev[0] && ev[0].at)), pagesSec = pagesSection(groups);
    var journey = '<section class="crf-sec"><h3>Journey</h3><p class="crf-muted">' + n(groups.length) + (groups.length === 1 ? " page visit" : " page visits") + ", " + n(ev.length) + " events. Tap any step to see exactly what was recorded." + (d.truncated ? " Showing the first " + n(ev.length) + " events." : "") + "</p>" +
      journeyPath(groups) + '<div class="crf-timeline">' + timeline(ev) + "</div></section>";
    var tracks = (s.tracks || []).length ? '<section class="crf-sec"><h3>Music heard</h3><div class="crf-badges">' + s.tracks.map(function (t) { return badge("▶ " + t, "music"); }).join("") + "</div></section>" : "";
    var hist = v.key ? '<section class="crf-sec"><h3>' + (w.known ? e(w.name) + "’s sessions" : "This visitor’s sessions") + "</h3>" + historyList(v, s.session_id) + "</section>" : "";
    return head + kpis + wrong + cards + pagesSec + journey + tracks + hist;
  }
  function card(title, body) { return '<section class="crf-card"><h3>' + e(title) + "</h3>" + body + "</section>"; }

  /* ---------- visitor profile ---------- */
  function activity(sessions, days) {
    var counts = {}, end = new Date(); end.setHours(0, 0, 0, 0);
    (sessions || []).forEach(function (s) { var d = new Date(s.started_at); d.setHours(0, 0, 0, 0); var k = d.toDateString(); counts[k] = (counts[k] || 0) + 1; });
    var start = new Date(end); start.setDate(end.getDate() - (days - 1)); start.setDate(start.getDate() - start.getDay());
    var cells = [], max = 1;
    Object.keys(counts).forEach(function (k) { max = Math.max(max, counts[k]); });
    for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      var c = counts[d.toDateString()] || 0, lvl = c ? Math.min(4, Math.ceil(c / max * 4)) : 0;
      cells.push('<i class="crf-heat__c crf-heat__c--' + lvl + '" title="' + e(d.toLocaleDateString() + ": " + c + (c === 1 ? " session" : " sessions")) + '"></i>');
    }
    return '<div class="crf-heat" style="--weeks:' + Math.ceil(cells.length / 7) + '" role="img" aria-label="Sessions per day over the last ' + days + ' days">' + cells.join("") + "</div>";
  }
  function visitorDetail(d) {
    var v = d.visitor || {}, list = v.sessions || [], latest = list[0] || {}, oldest = list[list.length - 1] || {};
    var w = who(Object.assign({}, latest, { profile: v.profile, devices: v.devices, visitor_key: v.key }));
    var engaged = 0, plays = 0, friction = 0, days = {};
    list.forEach(function (s) { engaged += Number(s.engaged_s) || 0; plays += Number(s.plays) || 0; friction += Number(s.friction) || 0; days[new Date(s.started_at).toDateString()] = 1; });
    var signed = list.some(function (s) { return s.signed_up; });
    var head = '<header class="crf-dh">' + avatar(Object.assign({}, latest, { display_name: w.known ? w.name : null })) +
      '<div class="crf-dh__t"><h2>' + e(w.known ? w.name : "Anonymous visitor") + "</h2><p>" + e([w.sub, place(latest), deviceLine(latest)].filter(Boolean).join(" · ")) + "</p>" +
      '<span class="crf-badges">' + (signed ? badge("Signed up", "win") : "") + (v.uid ? badge("Signed-in account", "info") : badge("Anonymous device", "muted")) + (v.devices && v.devices.length > 1 ? badge(n(v.devices.length) + " devices", "info") : "") + "</span></div></header>";
    var kpis = '<div class="crf-kpis">' + kpi("Sessions", n(v.total || list.length), "last " + (v.history_days || 180) + " days") + kpi("Active days", n(Object.keys(days).length)) +
      kpi("On screen", dur(engaged)) + kpi("Plays", n(plays)) + kpi("Friction", n(friction)) + kpi("First seen", oldest.started_at ? when(oldest.started_at) : "—") + kpi("Last seen", latest.ended_at ? when(latest.ended_at) : "—") + "</div>";
    var heat = '<section class="crf-sec"><h3>Activity</h3>' + activity(list, v.history_days || 180) + "</section>";
    var profile = v.profile ? '<section class="crf-sec">' + card("Account", facts([["Name", v.profile.display_name], ["Handle", v.profile.handle ? "@" + v.profile.handle : ""], ["Email", v.profile.email], ["Account since", v.profile.created_at ? when(v.profile.created_at) : ""], ["User id", "<code>" + e(v.uid) + "</code>", true]])) + "</section>" : "";
    var sessions = '<section class="crf-sec"><h3>Every session</h3>' + historyList(v, null) + "</section>";
    return head + kpis + profile + heat + sessions;
  }

  function detailPane() {
    var t = top(); if (!t) return "";
    var label = F.stack.length > 1 ? (F.stack[F.stack.length - 2].type === "visitor" ? "Back to visitor" : "Back to session") : (isInsight(F.mode) ? "Back to " : "All ") + F.mode;
    var body;
    if (F.loadingDetail) body = '<div class="crf-empty" aria-busy="true"><b>Opening ' + (t.type === "session" ? "session" : "visitor") + "…</b></div>";
    else if (F.detailError) body = '<div class="crf-empty crf-empty--bad"><b>Could not open it.</b><span>' + e(F.detailError.message || F.detailError) + "</span></div>";
    else if (F.detail) body = t.type === "session" ? sessionDetail(F.detail) : visitorDetail(F.detail);
    else body = "";
    return '<section class="crf-detail" aria-label="' + (t.type === "session" ? "Session" : "Visitor") + '"><div class="crf-detail__bar"><button type="button" class="crf-back" data-crf-back>← ' + e(label) + "</button>" +
      '<button type="button" class="crf-x" data-crf-close aria-label="Close">×</button></div>' + body + "</section>";
  }

  /* ---------- paint ---------- */
  function paint() {
    if (!F.host) return;
    var active = document.activeElement, focusQ = active && active.hasAttribute && active.hasAttribute("data-crf-q"), sel = focusQ ? [active.selectionStart, active.selectionEnd] : null;
    F.host.innerHTML = '<div class="crf' + (top() ? " crf--open" : "") + '">' + listPane() + detailPane() + "</div>";
    bind();
    if (focusQ) { var i = F.host.querySelector("[data-crf-q]"); if (i) { i.focus(); try { i.setSelectionRange(sel[0], sel[1]); } catch (_) {} } }
  }
  function bind() {
    var h = F.host;
    h.querySelectorAll("[data-crf-mode]").forEach(function (b) { b.onclick = function () {
      var m = b.getAttribute("data-crf-mode"); if (m === F.mode) return;
      F.mode = m; F.stack = []; F.detail = null;
      if (isInsight(m)) { if (!F.insight[m] && !F.insightLoading[m]) loadInsight(m); else paint(); return; }
      F.filter = "all"; F.sort = "recent"; F.items = []; F.list = null; loadList(false);
    }; });
    h.querySelectorAll("[data-crf-insight-retry]").forEach(function (b) { b.onclick = function () { loadInsight(F.mode); }; });
    h.querySelectorAll("[data-crf-injected]").forEach(function (b) { b.onclick = function () { F.showInjected = !F.showInjected; paint(); }; });
    h.querySelectorAll("[data-crf-filter]").forEach(function (b) { b.onclick = function () { F.filter = b.getAttribute("data-crf-filter"); loadList(false); }; });
    var sort = h.querySelector("[data-crf-sort]"); if (sort) sort.onchange = function () { F.sort = sort.value; loadList(false); };
    var input = h.querySelector("[data-crf-q]");
    if (input) {
      input.oninput = function () { F.q = input.value; clearTimeout(F.timer); F.timer = setTimeout(function () { loadList(false); }, 380); };
      input.onkeydown = function (ev) { if (ev.key === "Enter") { ev.preventDefault(); clearTimeout(F.timer); loadList(false); } };
    }
    h.querySelectorAll("[data-crf-retry]").forEach(function (b) { b.onclick = function () { loadList(false); }; });
    h.querySelectorAll("[data-crf-more]").forEach(function (b) { b.onclick = function () { loadList(true); }; });
    h.querySelectorAll("[data-crf-session]").forEach(function (b) { b.onclick = function () {
      var id = b.getAttribute("data-crf-session"), inDetail = !!(b.closest && b.closest(".crf-detail"));
      open({ type: "session", id: id }, !inDetail);
    }; });
    h.querySelectorAll("[data-crf-visitor]").forEach(function (b) { b.onclick = function () {
      var key = b.getAttribute("data-crf-visitor"), inDetail = !!(b.closest && b.closest(".crf-detail"));
      open({ type: "visitor", key: key }, !inDetail);
    }; });
    h.querySelectorAll("[data-crf-back]").forEach(function (b) { b.onclick = back; });
    h.querySelectorAll("[data-crf-close]").forEach(function (b) { b.onclick = function () { F.stack = []; F.detail = null; paint(); }; });
    h.querySelectorAll("[data-crf-system]").forEach(function (b) { b.onclick = function () { F.showSystem = !F.showSystem; paint(); }; });
    h.querySelectorAll("[data-crf-raw]").forEach(function (b) { b.onclick = function () { var i = b.getAttribute("data-crf-raw"); F.raw[i] = !F.raw[i]; paint(); }; });
    h.querySelectorAll("[data-crf-jump]").forEach(function (a) { a.onclick = function (ev) {
      ev.preventDefault(); var el = h.querySelector("#crf-visit-" + a.getAttribute("data-crf-jump"));
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "start", behavior: "smooth" });
    }; });
  }

  window.CR.forensics = {
    init: function (opts) { F.request = opts && opts.request || F.request; },
    /* Called by Control Analytics each time it paints the Forensics tab. The
       tab's markup is rebuilt on every analytics repaint, so this module keeps
       its own state and only refetches when the selected range changes. */
    mount: function (hostEl, ctx) {
      F.host = hostEl; ctx = ctx || {};
      if (ctx.request) F.request = ctx.request;
      var key = ctx.range ? ctx.range.since + "|" + ctx.range.until : "";
      if (key !== F.rangeKey) {
        F.rangeKey = key; F.range = ctx.range || null; F.items = []; F.list = null; F.stack = []; F.detail = null;
        F.insight = { flows: null, errors: null }; F.insightError = { flows: null, errors: null }; F.insightLoading = { flows: false, errors: false };
        if (isInsight(F.mode)) loadInsight(F.mode); else loadList(false);
      }
      else paint();
    },
    state: F,
    describe: describe,
    pageVisits: pageVisits,
    uaInfo: uaInfo,
    render: function () { return '<div class="crf' + (top() ? " crf--open" : "") + '">' + listPane() + detailPane() + "</div>"; }
  };
})();
