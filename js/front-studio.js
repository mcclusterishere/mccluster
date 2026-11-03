/* AN ACCOUNT'S OWN FRONT PAGE EDITOR (front-studio.html).

   Owner, 2026-10-21: "make sure everybody else's page can replicate the same experience ... I have a whole account on
   Hitman Benji ... I never seen nothing like that, to be able to edit my profile ... all the accounts need to be able to
   recreate with their own media this exact same experience. The experience being my front page with a VR, with the
   scroll dependent video, all this."

   Any signed-in account builds its page here: the house page's experience (front.html runs the same engine) with its
   own words, films, 360 room, soundtrack and links. The preview is the real page in a frame, fed the draft by this
   editor (never by a URL). Save keeps a draft; Publish puts it at front.html?u=<handle> for everyone. The Worker checks
   everything again and keeps only the account's own media (workers/mccluster/src/member-fronts.js). */
(function (w, d) {
  "use strict";
  var API = "https://api.mccluster.org";
  var FILMS = [
    ["hero", "Opening film", "Plays as the page scrolls from the top: the first thing anyone sees."],
    ["scene1", "Scene film 1", "The first film after the opening, before the 360 room."],
    ["scene2", "Scene film 2", "The film after the 360 room."],
    ["night", "Closing film", "The last film. Your closing words and links arrive over its final frames."]
  ];
  var FEEL = { smooth: [1.2, 0.1, "Smooth"], standard: [0.85, 0.14, "Standard"], quick: [0.55, 0.22, "Quick"] };
  var DEVICES = { phone: [390, 844, "Phone"], desktop: [1280, 800, "Desktop"] };
  var S = { me: null, draft: null, dirty: false, saving: false, busy: {}, progress: {}, msg: "", bad: false, device: "phone", frame: null, seq: 0, reloadTimer: 0, state: "loading", error: "" };
  var $ = function (id) { return d.getElementById(id); };
  function e(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function sb() { return w.MCC_SUPA || {}; }
  function token() { return Promise.resolve(sb().token ? sb().token() : null); }
  function api(path, opts) {
    opts = opts || {};
    return token().then(function (t) {
      if (!t) throw Object.assign(new Error("signed out"), { status: 401 });
      return fetch(API + path, { method: opts.method || "GET", headers: Object.assign({ authorization: "Bearer " + t, accept: "application/json" }, opts.body ? { "content-type": "application/json" } : {}), body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store" });
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (b) {
        if (!r.ok) throw Object.assign(new Error((b && (b.error || b.message)) || ("HTTP " + r.status)), { status: r.status, body: b });
        return b;
      });
    });
  }
  /* the folder this account's uploads go to: the Worker names it (its auth uid) */
  function folder() { var p = S.me && S.me.media_prefix || ""; var i = p.indexOf("/front-media/"); return i >= 0 ? p.slice(i + "/front-media/".length) : ""; }
  /* after the account's page changes on the server: what neither its draft nor its published page uses leaves its
     folder (js/front-media.js sweep), so a replaced film never counts against its room. Uploads wait for it. */
  function sweep() {
    var M = w.MCC_FRONT_MEDIA, dir = folder();
    if (!M || !M.sweep || !dir || !S.me) return;
    var pages = [S.me.draft, S.me.published];
    S.sweeping = (S.sweeping || Promise.resolve()).then(function () { return M.sweep(dir, pages); }).catch(function () { return 0; });
  }
  function ensure(o, k) { o[k] = o[k] && typeof o[k] === "object" ? o[k] : {}; return o[k]; }
  /* the page the preview gets: the same scene rules the published page uses (js/front-member.js) */
  function page() { return { handle: S.me.handle, name: S.me.name, avatar: S.me.avatar, headline: "", config: clone(S.draft) }; }
  function linkProblem(h) {
    h = String(h || "").trim();
    if (!h) return "needs a link";
    if (/^https:\/\/[^\s"'<>]+$/i.test(h)) return "";
    return /^(?![a-z][a-z0-9+.-]*:)(?!\/\/)[a-z0-9_./?#=&%-]+$/i.test(h) ? "" : "must be a page on this site (like hire.html) or an https:// address";
  }

  /* ---------- the preview ---------- */
  function frameWin() { try { return S.frame && S.frame.contentWindow; } catch (_) { return null; } }
  function post(msg) { var f = frameWin(); if (f) try { f.postMessage(msg, location.origin); } catch (_) {} }
  function reloadPreview(now) {
    clearTimeout(S.reloadTimer);
    var go = function () { if (S.frame) S.frame.src = "front.html?u=" + encodeURIComponent(S.me.handle) + "&studio=" + (++S.seq); };
    if (now) go(); else S.reloadTimer = setTimeout(go, 800);
  }
  /* settings that the engine can take live go to the frame at once; words and media reload it */
  function livePreview() {
    var c = clone(S.draft), m = c.media || {};
    c.scenes = c.scenes || {};
    if (!m.scene1 && !m.scene2 && !m.cabin) c.scenes.vaunt = false;
    if (!m.night) c.scenes.night = false;
    c.scenes.world = false;
    post({ type: "mcc:front-preview", seq: ++S.seq, config: c });
  }
  function fit() {
    var box = $("fsDevice"), view = $("fsViewport"); if (!box || !view) return;
    var dv = DEVICES[S.device], k = Math.min(1, view.clientWidth / dv[0]);
    if (w.matchMedia("(min-width:1100px)").matches) k = Math.min(k, Math.max(0.3, (w.innerHeight - 220) / dv[1]));
    box.style.setProperty("--fs-w", dv[0] + "px"); box.style.setProperty("--fs-h", dv[1] + "px"); box.style.setProperty("--fs-k", k.toFixed(4));
  }

  /* ---------- the form ---------- */
  function field(name, label, value, max, hint) {
    return '<label class="fs-field"><span>' + e(label) + (hint ? ' <small>' + e(hint) + '</small>' : "") + '</span><input name="' + name + '" value="' + e(value || "") + '" maxlength="' + max + '"></label>';
  }
  function check(name, label, on, hint) { return '<label class="fs-check"><input type="checkbox" name="' + name + '"' + (on ? " checked" : "") + '><span><b>' + e(label) + '</b>' + (hint ? '<small>' + e(hint) + '</small>' : "") + '</span></label>'; }
  function linkRow(prefix, item, i, labelMax) {
    var bad = item && (item.label || item.href) ? (!String(item.label || "").trim() ? "needs a label" : linkProblem(item.href)) : "";
    return '<div class="fs-link' + (bad ? " is-bad" : "") + '">' + field(prefix + ".label", "Label", item && item.label, labelMax) +
      field(prefix + ".href", "Link (a page here, or https://…)", item && item.href, 300) + (bad ? '<p class="fs-bad" role="alert">This ' + e(bad) + '.</p>' : "") + '</div>';
  }
  /* a link row's own warning, kept up to date as it is typed (the same words linkRow draws) */
  function markRow(t) {
    var row = t.closest && t.closest(".fs-link"); if (!row) return;
    var get = function (k) { var el = row.querySelector('[name$=".' + k + '"]'); return el ? el.value : ""; };
    var label = get("label"), href = get("href");
    var why = label || href ? (!String(label).trim() ? "needs a label" : linkProblem(href)) : "";
    row.classList.toggle("is-bad", !!why);
    var p = row.querySelector(".fs-bad");
    if (!why) { if (p) p.parentNode.removeChild(p); return; }
    if (!p) { p = d.createElement("p"); p.className = "fs-bad"; p.setAttribute("role", "alert"); row.appendChild(p); }
    p.textContent = "This " + why + ".";
  }
  function mediaRow(key, label, hint, accept, value, what) {
    var busy = S.busy[key], p = S.progress[key], has = !!value;
    var status = busy ? '<p class="fs-progress" role="status">' + e(p || "Working…") + '</p>'
      : has ? '<p class="fs-has">' + e(what(value)) + '</p>' : '<p class="fs-none">None yet</p>';
    return '<div class="fs-media" data-media="' + key + '"><div class="fs-media__head"><b>' + e(label) + '</b><small>' + e(hint) + '</small></div>' + status +
      '<div class="fs-actions"><label class="fs-btn fs-btn--file' + (busy ? " is-disabled" : "") + '"><input type="file" accept="' + accept + '" data-upload="' + key + '"' + (busy ? " disabled" : "") + '>' + (has ? "Replace" : "Choose a file") + '</label>' +
      (has && !busy ? '<button type="button" class="fs-btn fs-btn--ghost" data-remove="' + key + '">Remove</button>' : "") + '</div></div>';
  }
  function form() {
    var c = S.draft, wd = c.words || {}, m = c.media || {}, v = c.vr || {}, sc = c.scroll || {}, n = c.night || {};
    var feel = "standard";
    Object.keys(FEEL).forEach(function (k) { if (sc.duration === FEEL[k][0] && sc.touchLerp === FEEL[k][1]) feel = k; });
    if (sc.duration !== undefined && feel === "standard" && !(sc.duration === 0.85 && sc.touchLerp === 0.14)) feel = "custom";
    var spots = Array.isArray(v.spots) ? v.spots : [], links = Array.isArray(c.links) ? c.links : [];
    var filmWhat = function (f) { return f.count + " frames, cut from your video"; };
    return '' +
      '<fieldset class="fs-group"><legend>Words</legend>' +
        field("words.eyebrow", "Above your name", wd.eyebrow, 60, "e.g. Producer · Atlanta") +
        '<div class="fs-pair">' + field("words.title1", "Big title, line 1", wd.title1, 14) + field("words.title2", "Line 2 (red)", wd.title2, 14) + '</div>' +
        field("words.sub", "Under the title", wd.sub, 60) +
        '<p class="fs-sub">Buttons under the title</p>' + linkRow("words.door1", wd.door1, 0, 40) + linkRow("words.door2", wd.door2, 1, 40) +
      '</fieldset>' +
      '<fieldset class="fs-group"><legend>Films</legend><p class="fs-help">Pick a short video for each film. Your browser cuts it into frames (up to 160) so it plays as people scroll, exactly like McCluster\'s front page. Nothing is sent anywhere to be processed.</p>' +
        FILMS.map(function (f) { return mediaRow(f[0], f[1], f[2], "video/*", m[f[0]], filmWhat); }).join("") +
        mediaRow("still", "Opening photo", "Shown behind your title when there is no opening film.", "image/jpeg,image/webp,image/png", m.still, function () { return "Your photo"; }) +
      '</fieldset>' +
      '<fieldset class="fs-group"><legend>360 room</legend><p class="fs-help">A 360 video or photo (twice as wide as it is tall, like 3840×1920). Visitors stop in it and look around, like the jet on McCluster\'s page.</p>' +
        mediaRow("cabin", "Your 360", "MP4 or WebM video up to 300 MB, or a JPEG/WebP/PNG photo.", "video/mp4,video/webm,image/jpeg,image/webp,image/png", m.cabin, function (x) { return x.kind === "video" ? "Your 360 video" : "Your 360 photo"; }) +
        check("vr.hold", "Hold the page in the room", v.hold !== false, "On: the page stops until Land or Back to the card. Off: scrolling carries on through it.") +
        '<div class="fs-pair">' + field("vr.yaw", "Opening view: turn (°)", v.yaw, 5) + field("vr.pitch", "Opening view: tilt (°)", v.pitch, 4) + '</div>' +
        '<div class="fs-actions"><button type="button" class="fs-btn fs-btn--ghost" data-act="view">Use the preview\'s view</button></div>' +
        field("words.gateKicker", "Room card: small line", wd.gateKicker, 40) + field("words.gateTitle", "Room card: title", wd.gateTitle, 40) + field("words.gateLede", "Room card: text", wd.gateLede, 180) +
        '<p class="fs-sub">Tags in the room</p>' +
        spots.map(function (s, i) { return '<div class="fs-tag">' + linkRow("vr.spots." + i, s, i, 60) + '<div class="fs-actions"><button type="button" class="fs-btn fs-btn--ghost" data-act="pin" data-i="' + i + '">Pin where the preview looks</button><button type="button" class="fs-btn fs-btn--ghost" data-act="untag" data-i="' + i + '">Remove</button></div></div>'; }).join("") +
        (spots.length < 5 ? '<div class="fs-actions"><button type="button" class="fs-btn" data-act="tag">Add a tag</button></div>' : "") +
      '</fieldset>' +
      '<fieldset class="fs-group"><legend>Soundtrack</legend>' +
        mediaRow("sound", "Your track", "Plays when a visitor turns the sound on. MP3, M4A, AAC or WAV up to 30 MB.", "audio/*", m.sound, function () { return "Your track"; }) +
      '</fieldset>' +
      '<fieldset class="fs-group"><legend>The close</legend>' +
        field("words.nightKicker", "Small line", wd.nightKicker, 60) +
        '<div class="fs-pair">' + field("words.nightTitle1", "Title, line 1", wd.nightTitle1, 12) + field("words.nightTitle2", "Line 2 (red)", wd.nightTitle2, 12) + '</div>' +
        '<p class="fs-sub">Your links</p>' +
        links.map(function (x, i) { return '<div class="fs-tag">' + linkRow("links." + i, x, i, 40) + '<div class="fs-actions"><button type="button" class="fs-btn fs-btn--ghost" data-act="unlink" data-i="' + i + '">Remove</button></div></div>'; }).join("") +
        (links.length < 4 ? '<div class="fs-actions"><button type="button" class="fs-btn" data-act="link">Add a link</button></div>' : "") +
      '</fieldset>' +
      '<fieldset class="fs-group"><legend>Feel</legend>' +
        '<label class="fs-field"><span>How the page scrolls</span><select name="feel">' + Object.keys(FEEL).map(function (k) { return '<option value="' + k + '"' + (feel === k ? " selected" : "") + '>' + e(FEEL[k][2]) + '</option>'; }).join("") + (feel === "custom" ? '<option value="custom" selected>Custom</option>' : "") + '</select></label>' +
        field("night.arrive", "Closing words arrive at (% of the closing film)", n.arrive === undefined ? "" : Math.round(n.arrive * 100), 2) +
      '</fieldset>';
  }
  function bad() {
    var c = S.draft, out = [], wd = c.words || {};
    var chk = function (x, name) { if (x && (x.label || x.href) && (!String(x.label || "").trim() || linkProblem(x.href))) out.push(name); };
    chk(wd.door1, "button 1"); chk(wd.door2, "button 2");
    (c.vr && c.vr.spots || []).forEach(function (s, i) { chk(s, "tag " + (i + 1)); });
    (c.links || []).forEach(function (x, i) { chk(x, "link " + (i + 1)); });
    return out;
  }
  function busy() { return Object.keys(S.busy).some(function (k) { return S.busy[k]; }); }
  function paint() {
    var root = $("fsRoot"); if (!root) return;
    if (S.state !== "ready") {
      var t = { loading: ["Opening your editor…", ""], signin: ["Sign in to build your front page", "Your front page is yours: sign in and it opens here."], handle: ["Choose your handle first", "Your front page lives at your handle (front.html?u=you). Finish your account, then come back."], off: ["Front pages are not switched on yet", S.error || "The editor will open here as soon as they are."], error: ["The editor could not open", S.error] }[S.state] || ["", ""];
      var act = S.state === "signin" ? '<a class="fs-btn" href="account.html?next=front-studio.html">Sign in</a>' : S.state === "handle" ? '<a class="fs-btn" href="account.html">Finish my account</a>' : "";
      root.innerHTML = '<section class="fs-gate"><h1>' + e(t[0]) + '</h1><p>' + e(t[1]) + '</p>' + act + '</section>';
      return;
    }
    var me = S.me, live = me.published ? "Live at front.html?u=" + me.handle + (me.published_at ? " since " + new Date(me.published_at).toLocaleString() : "") : "Not published yet";
    if (!root.querySelector("#fsForm")) {
      root.innerHTML =
        '<header class="fs-head"><div><p class="fs-k">Your front page</p><h1>' + e(me.name || me.handle) + '</h1><p class="fs-live" id="fsLive"></p></div>' +
        '<div class="fs-actions" id="fsTop"><button type="button" class="fs-btn fs-btn--primary" data-act="publish">Publish</button><button type="button" class="fs-btn" data-act="save">Save draft</button>' +
        '<a class="fs-btn fs-btn--ghost" id="fsOpen" target="_blank" rel="noopener">See it live ↗</a><button type="button" class="fs-btn fs-btn--ghost" data-act="unpublish" id="fsUnpublish">Take it down</button></div></header>' +
        '<div class="fs-status" id="fsStatus"></div>' +
        '<div class="fs-grid"><section class="fs-stage" aria-label="Your page, live"><div class="fs-bar">' +
          '<div class="fs-seg" role="group" aria-label="Preview size">' + Object.keys(DEVICES).map(function (k) { return '<button type="button" data-device="' + k + '" aria-pressed="' + (S.device === k) + '">' + DEVICES[k][2] + '</button>'; }).join("") + '</div>' +
          '<div class="fs-seg" role="group" aria-label="Go to a part of the page">' + [["top", "Top"], ["vaunt", "Films"], ["cabin", "360 room"], ["night", "Close"]].map(function (j) { return '<button type="button" data-go="' + j[0] + '">' + j[1] + '</button>'; }).join("") + '</div></div>' +
          '<div class="fs-viewport" id="fsViewport"><div class="fs-device" id="fsDevice"><iframe id="fsFrame" title="Your front page, as visitors get it"></iframe></div></div>' +
          '<p class="fs-help">This is your real page. Scroll it, open the 360 room, tap through.</p></section>' +
        '<form class="fs-form" id="fsForm"></form></div>';
      S.frame = $("fsFrame");
      bind(root);
      reloadPreview(true);
      fit();
    }
    $("fsLive").textContent = live;
    $("fsOpen").href = "front.html?u=" + encodeURIComponent(me.handle);
    $("fsOpen").hidden = !me.published;
    $("fsUnpublish").hidden = !me.published;
    var problems = bad();
    $("fsStatus").innerHTML = (S.dirty ? '<p class="fs-dirty">Unsaved changes: shown in the preview only.</p>' : "") +
      (problems.length ? '<p class="fs-bad" role="alert">Fix ' + e(problems.join(", ")) + ' before saving.</p>' : "") +
      (S.msg ? '<p class="' + (S.bad ? "fs-bad" : "fs-ok") + '" role="status">' + e(S.msg) + '</p>' : "");
    Array.prototype.forEach.call(root.querySelectorAll("#fsTop button"), function (b) { var a = b.getAttribute("data-act"); b.disabled = S.saving || busy() || ((a === "save" || a === "publish") && problems.length > 0); });
    Array.prototype.forEach.call(root.querySelectorAll("[data-device]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-device") === S.device)); });
  }
  /* the shell first (the first paint builds it), then the settings into it */
  function paintForm() { paint(); var f = $("fsForm"); if (f) f.innerHTML = form(); }

  /* ---------- changes ---------- */
  var LIVE = /^(vr\.|night\.|feel$)/;
  function set(name, value, checked) {
    var c = S.draft, p = name.split("."), n = Number(value);
    if (name === "feel") { if (FEEL[value]) { var sc = ensure(c, "scroll"); sc.duration = FEEL[value][0]; sc.touchLerp = FEEL[value][1]; } }
    else if (name === "vr.hold") ensure(c, "vr").hold = !!checked;
    else if (name === "vr.yaw" || name === "vr.pitch") { var vv = ensure(c, "vr"); if (String(value).trim() === "") delete vv[p[1]]; else if (isFinite(n)) vv[p[1]] = n; }
    else if (name === "night.arrive") { var nn = ensure(c, "night"); if (String(value).trim() === "") delete nn.arrive; else if (isFinite(n)) nn.arrive = n / 100; }
    else if (p[0] === "words" && p.length === 2) { var wd = ensure(c, "words"); if (String(value).trim()) wd[p[1]] = value; else delete wd[p[1]]; }
    else if (p[0] === "words" && p.length === 3) { var wo = ensure(c, "words"), door = wo[p[1]] = wo[p[1]] || {}; door[p[2]] = value; if (!door.label && !door.href) delete wo[p[1]]; }
    else if (p[0] === "vr" && p[1] === "spots") { var s = (ensure(c, "vr").spots || [])[Number(p[2])]; if (s) s[p[3]] = value; }
    else if (p[0] === "links") { var l = (c.links || [])[Number(p[1])]; if (l) l[p[2]] = value; }
    S.dirty = true; S.msg = "";
    if (LIVE.test(name)) livePreview(); else reloadPreview(false);
  }
  /* the room's viewer, only while the room is open on the preview's screen (it is loaded well before it is reached) */
  function viewer() { var f = frameWin(); try { return f && f.__MCC_VR && f.__MCC_VR.live ? f.__MCC_VR.viewer : null; } catch (_) { return null; } }
  function act(a, btn) {
    var c = S.draft, i = Number(btn && btn.getAttribute("data-i"));
    if (a === "tag") { var v = ensure(c, "vr"); v.spots = v.spots || []; v.spots.push({ yaw: 0, pitch: 0, label: "", href: "" }); S.dirty = true; paintForm(); return; }
    if (a === "untag") { c.vr.spots.splice(i, 1); S.dirty = true; paintForm(); livePreview(); return; }
    if (a === "link") { c.links = c.links || []; c.links.push({ label: "", href: "" }); S.dirty = true; paintForm(); return; }
    if (a === "unlink") { c.links.splice(i, 1); S.dirty = true; paintForm(); reloadPreview(false); return; }
    if (a === "view" || a === "pin") {
      var vw = viewer();
      if (!vw) { S.msg = "Open the 360 room in the preview first (the “360 room” button), look where you want, then press this again."; S.bad = true; paint(); return; }
      var deg = function (r) { var x = Math.round(r * 180 / Math.PI) % 360; return x > 180 ? x - 360 : x < -180 ? x + 360 : x; };
      if (a === "view") { var vr = ensure(c, "vr"); vr.yaw = deg(vw.state.yaw); vr.pitch = Math.max(-85, Math.min(85, deg(vw.state.pitch))); }
      else {
        var cv = null; try { cv = frameWin().document.getElementById("workVRCanvas"); } catch (_) {}
        var r = cv && cv.getBoundingClientRect(), pk = r && vw.pick ? vw.pick(r.left + r.width / 2, r.top + r.height / 2) : null, sp = c.vr && c.vr.spots && c.vr.spots[i];
        if (pk && sp) { sp.yaw = pk.yaw; sp.pitch = pk.pitch; }
      }
      S.dirty = true; S.msg = ""; S.bad = false; paintForm(); livePreview(); return;
    }
    if (a === "save" || a === "publish") return save(a === "publish");
    if (a === "unpublish") {
      S.saving = true; paint();
      api("/v1/fronts/me/published", { method: "DELETE" }).then(function () { S.me.published = null; S.me.published_at = null; S.msg = "Taken down. Your draft is kept."; S.bad = false; sweep(); })
        .catch(function (err) { S.msg = "Not taken down: " + err.message; S.bad = true; }).then(function () { S.saving = false; paint(); });
    }
  }
  function save(publish) {
    if (bad().length || busy()) return;
    S.saving = true; S.msg = publish ? "Publishing…" : "Saving…"; S.bad = false; paint();
    api("/v1/fronts/me", { method: "POST", body: { config: S.draft, publish: publish } }).then(function (b) {
      S.draft = clone(b.draft) || {}; S.me.draft = b.draft; S.dirty = false;
      if (publish) { S.me.published = b.published; S.me.published_at = b.published_at; }
      var dropped = (b.dropped || []).length ? " Not kept: " + b.dropped.join(", ") + "." : "";
      S.msg = (publish ? "Published. Everyone sees it at front.html?u=" + b.handle + "." : "Draft saved.") + dropped; S.bad = !!dropped;
      paintForm(); reloadPreview(true); sweep();
    }).catch(function (err) {
      S.msg = (publish ? "Not published: " : "Not saved: ") + (err.status === 403 && err.body && err.body.detail && err.body.detail.code === "removed" ? "McCluster took this page down." : err.message);
      S.bad = true;
    }).then(function () { S.saving = false; paint(); });
  }
  function upload(key, file, input) {
    var M = w.MCC_FRONT_MEDIA, dir = folder();
    if (!M || !dir || !file) return;
    S.busy[key] = true; S.progress[key] = "Starting…"; S.msg = ""; paintForm();
    var start = S.sweeping || Promise.resolve();
    var pct = function (x) { S.progress[key] = "Uploading " + Math.round(x * 100) + "%"; var el = d.querySelector('[data-media="' + key + '"] .fs-progress'); if (el) el.textContent = S.progress[key]; };
    var job = start.then(function () {
      return key === "cabin" ? M.cabin(file, dir, pct) : key === "still" ? M.still(file, dir, pct) : key === "sound" ? M.sound(file, dir, pct)
        : M.film(file, dir, function (p) { S.progress[key] = "Cutting frames " + p.cut + " of " + p.of + " · uploaded " + p.sent + " of " + p.total; var el = d.querySelector('[data-media="' + key + '"] .fs-progress'); if (el) el.textContent = S.progress[key]; });
    });
    job.then(function (res) {
      var m = ensure(S.draft, "media");
      m[key] = key === "hero" || key === "scene1" || key === "scene2" || key === "night" ? { base: res.base, count: res.count, ext: res.ext, sm: res.sm } : res;
      S.dirty = true; S.msg = "Added. Save or publish to keep it."; S.bad = false;
    }).catch(function (err) { S.msg = err.message || String(err); S.bad = true; })
      .then(function () { S.busy[key] = false; S.progress[key] = ""; if (input) input.value = ""; paintForm(); reloadPreview(true); });
  }
  function bind(root) {
    root.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("button");
      if (!b || b.disabled) return;
      if (b.hasAttribute("data-act")) { ev.preventDefault(); act(b.getAttribute("data-act"), b); }
      else if (b.hasAttribute("data-device")) { S.device = b.getAttribute("data-device"); fit(); paint(); }
      else if (b.hasAttribute("data-go")) post({ type: "mcc:front-goto", to: b.getAttribute("data-go") });
      else if (b.hasAttribute("data-remove")) { var m = ensure(S.draft, "media"); delete m[b.getAttribute("data-remove")]; S.dirty = true; paintForm(); reloadPreview(true); }
    });
    /* A field is never redrawn under the hand typing in it: leaving one for the next must not replace the next (that
       lost what was typed there, and the tap on a button after it). Text applies as it is typed; a link row says what
       is wrong with it in place; only adding or removing a row redraws the form. */
    root.addEventListener("change", function (ev) {
      var t = ev.target; if (!t || !t.isConnected) return;
      if (t.hasAttribute("data-upload")) { upload(t.getAttribute("data-upload"), t.files && t.files[0], t); return; }
      if (t.name && (t.type === "checkbox" || t.tagName === "SELECT")) { set(t.name, t.value, t.checked); paint(); }
    });
    root.addEventListener("input", function (ev) { var t = ev.target; if (t && t.name && t.isConnected && t.type !== "checkbox" && t.tagName !== "SELECT" && t.type !== "file") { set(t.name, t.value, t.checked); markRow(t); paint(); } });
    root.addEventListener("submit", function (ev) { ev.preventDefault(); });
    w.addEventListener("resize", fit);
  }
  /* the preview asks for the draft; only its own frame on this origin is answered */
  w.addEventListener("message", function (ev) {
    if (ev.origin !== location.origin || !S.frame || ev.source !== frameWin() || !ev.data) return;
    if (ev.data.type === "mcc:front-need-draft" && S.me) post({ type: "mcc:front-draft", page: page() });
  });
  w.addEventListener("beforeunload", function (ev) { if (S.dirty || busy()) { ev.preventDefault(); ev.returnValue = ""; } });

  function boot() {
    api("/v1/fronts/me").then(function (me) {
      S.me = me; S.draft = clone(me.draft || me.published) || {}; S.state = "ready";
      if (me.removed) { S.msg = "McCluster took your published page down. You can keep editing your draft."; S.bad = true; }
      paintForm();
    }).catch(function (err) {
      /* 503: the table is not there yet; 404: the Worker with these routes is not deployed yet. Either way, not on yet. */
      S.state = err.status === 401 ? "signin" : err.status === 409 ? "handle" : (err.status === 503 || err.status === 404) ? "off" : "error";
      S.error = S.state === "off" ? "" : err.status ? err.message : "Check the connection and try again.";
      paint();
    });
  }
  function whenReady() { if (w.MCC_SUPA && w.MCC_SUPA.token) boot(); else setTimeout(whenReady, 50); }
  paint();
  whenReady();
  w.__MCC_FRONT_STUDIO = S; // verification handle
})(window, document);
