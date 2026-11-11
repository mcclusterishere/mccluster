/* VERIFY IT'S YOU (identity-verify.html): the member's side of the identity
   verification levels. docs/control-plane/IDENTITY-VERIFICATION-LEVELS.md

   V1 Live introduction, V2 Full Hitman's Halo access. Read the consent, type
   your name, turn on the camera, get a fresh code from the server, record a
   live video saying your name, the code and the promise, play it back, send
   it. The video goes straight from this browser into a PRIVATE storage
   bucket, at the one path the server issued, through a signed upload; only
   the owner (and admins the owner names) can play it back. No file picker
   exists here, and none may be added: a verification video is live or it is
   nothing. Rules: js/identity-capture-core.js. */
(function () {
  "use strict";
  var host = document.getElementById("idv");
  if (!host) return;
  var SUPA = window.MCC_SUPA, C = window.MCC_IDENTITY_CAPTURE;
  var API = window.MCC_API_BASE || "https://api.mccluster.org";
  if (!SUPA || !C) { host.innerHTML = '<p class="idv-note idv-note--bad">This page did not load completely. Refresh to try again.</p>'; return; }

  var params = new URLSearchParams(location.search);
  var S = {
    status: null, error: null, level: params.get("level") === "v2" ? "v2_halo_full" : "v1_live_intro",
    regions: [], stream: null, track: null, start: null, recorder: null, chunks: [], blob: null, blobUrl: null,
    startedAt: 0, durationMs: 0, recording: false, timer: null, busy: false, msg: "", sent: null, persona: null,
    name: "", access: "", agreed: false, location: false, region: ""
  };

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function note(t, bad) { return '<p class="idv-note' + (bad ? " idv-note--bad" : "") + '" role="' + (bad ? "alert" : "status") + '">' + esc(t) + "</p>"; }

  function call(path, body, method) {
    return SUPA.token().catch(function () { return null; }).then(function (t) {
      return fetch(SUPA.url + path, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: { apikey: SUPA.key, authorization: "Bearer " + (t || SUPA.key), "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    }).then(function (r) {
      return r.text().then(function (txt) {
        var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
        if (!r.ok) { var err = new Error((j && (j.message || j.error || j.hint)) || ("Request failed (" + r.status + ")")); err.status = r.status; throw err; }
        return j;
      });
    });
  }
  function rpc(name, args) { return call("/rest/v1/rpc/" + name, args || {}); }
  function missing(err) { return err && (err.status === 404 || /PGRST20[12]|does not exist|Could not find/i.test(err.message || "")); }
  function levelState() { return ((S.status && S.status.levels) || []).filter(function (l) { return l.level === S.level; })[0] || null; }

  function load() {
    return rpc("identity_verification_status").then(function (s) { S.status = s; S.error = null; })
      .catch(function (err) { S.status = null; S.error = missing(err) ? "closed" : (err.message || String(err)); })
      .then(function () {
        if (S.level === "v1_live_intro" && !S.regions.length) {
          return call("/rest/v1/action_globe_regions?select=region_key,region_label&order=region_label.asc").then(function (r) { S.regions = r || []; }).catch(function () { S.regions = []; });
        }
      }).then(render);
  }

  function stopCamera() {
    if (S.stream) S.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* already stopped */ } });
    S.stream = null; S.track = null;
  }
  function clearRecording() {
    if (S.blobUrl) { try { URL.revokeObjectURL(S.blobUrl); } catch (e) { /* ignore */ } }
    S.blob = null; S.blobUrl = null; S.durationMs = 0; S.chunks = [];
  }

  function levelTabs() {
    return '<div class="idv-tabs" role="tablist">' + [["v1_live_intro", "1 · Live introduction"], ["v2_halo_full", "2 · Full Halo access"]].map(function (t) {
      return '<button type="button" role="tab" class="idv-tab' + (S.level === t[0] ? " is-on" : "") + '" aria-selected="' + (S.level === t[0]) + '" data-level="' + t[0] + '">' + esc(t[1]) + "</button>";
    }).join("") + "</div>";
  }

  function statusBlock(ls) {
    if (!ls) return "";
    if (ls.verified) return note(S.level === "v1_live_intro" ? "Your live introduction is approved." : "Your full Hitman's Halo access is approved.");
    var l = ls.latest;
    if (!l) return "";
    if (l.status === "submitted") return note("Your video is with the owner for review. The aim is to decide within 24 hours." +
      (S.level === "v2_halo_full" ? (l.persona_inquiry ? " ID check: " + (l.persona_status || "started") + "." : " Next: complete the government-ID check below.") : ""));
    if (l.status === "retake_requested") return note("The owner asked you to record again: " + (l.decision_note || ""), true);
    if (l.status === "rejected") return note("Your last video was not approved: " + (l.decision_note || ""), true);
    if (l.status === "withdrawn") return note("Your last request was withdrawn and its video is scheduled for deletion.");
    return "";
  }

  function personaBlock(ls) {
    if (S.level !== "v2_halo_full" || !ls || !ls.latest || ls.latest.status !== "submitted" || ls.latest.persona_status === "approved") return "";
    return '<section class="idv-card"><h2>Government-ID check</h2><p>Persona, an outside identity-verification company, checks your ID. Your ID images stay with Persona; we receive only the result.</p>' +
      (S.persona ? note(S.persona.text, S.persona.bad) : "") +
      '<button type="button" class="idv-btn idv-btn--primary" data-act="persona"' + (S.busy ? " disabled" : "") + ">" + (ls.latest.persona_inquiry ? "Continue the ID check" : "Start the ID check") + "</button></section>";
  }

  function formBlock(ls) {
    var c = ls && ls.consent;
    if (!c) return note("This verification is not open yet. The owner is still approving its consent text.");
    var paras = C.consentParagraphs(c.body, c.retention_days).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");
    var regionOpts = '<option value="">Prefer not to pick</option>' + S.regions.map(function (r) {
      return '<option value="' + esc(r.region_key) + '"' + (S.region === r.region_key ? " selected" : "") + ">" + esc(r.region_label || r.region_key) + "</option>";
    }).join("");
    return '<section class="idv-card"><h2>' + esc(c.title) + '</h2><div class="idv-consent" tabindex="0" aria-label="Consent text">' + paras + "</div>" +
      '<p class="idv-small">Consent version ' + esc(c.version) + "</p>" +
      '<label class="idv-check"><input type="checkbox" id="idvAgree"' + (S.agreed ? " checked" : "") + "> I have read this and I agree.</label>" +
      '<label>Your first and last name<input id="idvName" autocomplete="name" value="' + esc(S.name) + '" maxlength="120"></label>' +
      (S.level === "v1_live_intro"
        ? '<label class="idv-check"><input type="checkbox" id="idvLoc"' + (S.location ? " checked" : "") + "> Share my broad region (a state or country, never my exact location).</label>" +
          '<label>Region<select id="idvRegion">' + regionOpts + "</select></label>"
        : '<label>What do you want access to, and why? (short; you will also say it on camera)<textarea id="idvAccess" rows="3" maxlength="600">' + esc(S.access) + "</textarea></label>") +
      "</section>";
  }

  function cameraBlock() {
    var st = S.start;
    var stage = '<div class="idv-stage">' +
      '<video id="idvPreview" class="idv-video" autoplay muted playsinline' + (S.stream && !S.blob ? "" : " hidden") + "></video>" +
      (S.blob ? '<video id="idvPlayback" class="idv-video" controls playsinline src="' + esc(S.blobUrl) + '"></video>' : "") +
      (st && !S.blob ? '<div class="idv-challenge" aria-live="polite"><span class="idv-small">Say this on camera</span>' +
        C.scriptLines(S.level, S.name, st.challenge_phrase, S.access).map(function (l, i) { return '<b class="idv-line' + (i === 1 ? " idv-code" : "") + '">' + esc(l) + "</b>"; }).join("") +
        (S.recording ? '<span class="idv-rec" id="idvTimer">● REC 0s</span>' : "") + "</div>" : "") +
      "</div>";
    var buttons;
    if (!S.stream && !S.blob) buttons = '<button type="button" class="idv-btn idv-btn--primary" data-act="camera"' + (S.busy ? " disabled" : "") + ">Turn on camera and get my code</button>";
    else if (S.blob) buttons = '<button type="button" class="idv-btn idv-btn--primary" data-act="send"' + (S.busy ? " disabled" : "") + ">Send to the owner</button>" +
      '<button type="button" class="idv-btn" data-act="again"' + (S.busy ? " disabled" : "") + ">Record again</button>";
    else if (S.recording) buttons = '<button type="button" class="idv-btn idv-btn--primary" data-act="stop">Stop</button>';
    else buttons = '<button type="button" class="idv-btn idv-btn--primary" data-act="record">Record</button>';
    return '<section class="idv-card"><h2>Record</h2><p class="idv-small">Live camera only: no uploads, no photos. Up to ' + C.LEVELS[S.level].maxSeconds + " seconds. Your code works for ten minutes.</p>" +
      stage + '<div class="idv-actions">' + buttons + "</div></section>";
  }

  function render() {
    var signedIn = !!(SUPA.uid && SUPA.uid());
    var html = '<h1>Verify it’s you</h1><p class="idv-lede">A short live video, reviewed by a person. Never public, never used to train AI.</p>' + levelTabs();
    if (!signedIn) {
      html += note("Sign in first.") + '<p><a class="idv-btn idv-btn--primary" href="account.html?next=' + encodeURIComponent("identity-verify.html" + location.search) + '">Sign in</a></p>';
      host.innerHTML = html; bind(); return;
    }
    if (S.error === "closed") { host.innerHTML = html + note("Identity verification is not switched on yet."); bind(); return; }
    if (S.error) { host.innerHTML = html + note("Could not load your verification status: " + S.error, true); bind(); return; }
    if (!S.status) { host.innerHTML = html + note("Loading…"); bind(); return; }
    var ls = levelState();
    var v1 = ((S.status.levels || []).filter(function (l) { return l.level === "v1_live_intro"; })[0]) || {};
    html += S.msg ? note(S.msg) : "";
    html += statusBlock(ls);
    if (S.level === "v2_halo_full" && !v1.verified) {
      html += note("Full access opens after your live introduction is approved.");
    } else if (ls && !ls.verified && !(ls.latest && ls.latest.status === "submitted")) {
      html += formBlock(ls) + (ls.consent ? cameraBlock() : "");
    }
    html += personaBlock(ls);
    html += '<section class="idv-card idv-card--quiet"><h2>Your videos</h2><p>Only the owner and admins the owner names can see them. You can ask for them to be deleted at any time; anything still waiting for review is withdrawn.</p>' +
      '<button type="button" class="idv-btn" data-act="delete"' + (S.busy ? " disabled" : "") + ">Delete my videos</button></section>";
    host.innerHTML = html;
    bind();
    var pv = document.getElementById("idvPreview");
    if (pv && S.stream && pv.srcObject !== S.stream) { pv.srcObject = S.stream; var p = pv.play && pv.play(); if (p && p.catch) p.catch(function () {}); }
  }

  function readForm() {
    var g = function (id) { return document.getElementById(id); };
    if (g("idvAgree")) S.agreed = g("idvAgree").checked;
    if (g("idvName")) S.name = g("idvName").value;
    if (g("idvLoc")) S.location = g("idvLoc").checked;
    if (g("idvRegion")) S.region = g("idvRegion").value;
    if (g("idvAccess")) S.access = g("idvAccess").value;
  }

  function startCamera() {
    readForm();
    var ls = levelState(), c = ls && ls.consent;
    var check = C.validateStart({ level: S.level, consentVersion: c && c.version, consentAccepted: S.agreed, name: S.name, locationConsent: S.location, accessRequest: S.access });
    if (!check.ok) { S.msg = check.error; render(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof window.MediaRecorder !== "function") {
      S.msg = "This browser cannot record from the camera. Open this page in a current version of Chrome, Safari, Firefox or Edge."; render(); return;
    }
    S.busy = true; S.msg = ""; render();
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true })
      .then(function (stream) {
        S.stream = stream;
        S.track = C.assertLiveStream(stream);
        return rpc("identity_start_submission", { p_level: S.level, p_consent_version: c.version, p_stated_name: S.name.trim(),
          p_access_request: S.level === "v2_halo_full" ? S.access.trim() : null, p_location_consent: S.level === "v1_live_intro" ? S.location : false,
          p_region_key: S.level === "v1_live_intro" && S.region ? S.region : null });
      })
      .then(function (start) { S.start = start; })
      .catch(function (err) {
        stopCamera();
        S.msg = /Permission|NotAllowed|denied/i.test(String(err && (err.name || err.message))) ? "Camera and microphone access are needed. Allow them in your browser and try again." : (err.message || String(err));
      })
      .then(function () { S.busy = false; render(); });
  }

  function record() {
    try { S.track = C.assertLiveStream(S.stream); } catch (e) { S.msg = e.message; stopCamera(); render(); return; }
    if (S.start && Date.parse(S.start.challenge_expires_at) < Date.now()) { S.msg = "Your code expired. Turn the camera on again for a new one."; stopCamera(); S.start = null; render(); return; }
    var mime = C.pickMimeType(function (t) { return window.MediaRecorder.isTypeSupported ? window.MediaRecorder.isTypeSupported(t) : false; });
    var rec;
    try { rec = new window.MediaRecorder(S.stream, mime ? { mimeType: mime, videoBitsPerSecond: 1500000 } : { videoBitsPerSecond: 1500000 }); }
    catch (e) { S.msg = "Recording could not start: " + (e.message || e); render(); return; }
    clearRecording();
    S.recorder = rec; S.recording = true; S.startedAt = Date.now();
    rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) S.chunks.push(ev.data); };
    rec.onstop = function () {
      S.recording = false; clearInterval(S.timer);
      S.durationMs = Date.now() - S.startedAt;
      var type = C.baseMime(rec.mimeType || mime || (S.chunks[0] && S.chunks[0].type) || "video/webm");
      S.blob = new Blob(S.chunks, { type: type });
      S.blobUrl = URL.createObjectURL(S.blob);
      render();
    };
    rec.start(1000);
    render();
    var max = C.LEVELS[S.level].maxSeconds;
    S.timer = setInterval(function () {
      var s = Math.floor((Date.now() - S.startedAt) / 1000), t = document.getElementById("idvTimer");
      if (t) t.textContent = "● REC " + s + "s / " + max + "s";
      if (s >= max && S.recorder && S.recorder.state === "recording") S.recorder.stop();
    }, 250);
  }

  function upload() {
    var st = S.start;
    var check = C.validateRecording({ level: S.level, source: "getUserMedia", size: S.blob && S.blob.size, mime: S.blob && S.blob.type,
      durationMs: S.durationMs, challengeExpiresAt: st && st.challenge_expires_at });
    if (!check.ok) { S.msg = check.error; render(); return; }
    var path = encodeURI(st.bucket + "/" + st.object_path);
    S.busy = true; S.msg = "Sending your video…"; render();
    // 1. a signed upload URL for exactly the issued path (the bucket's policy refuses any other)
    call("/storage/v1/object/upload/sign/" + path, {})
      .then(function (signed) {
        var rel = signed && signed.url;
        if (!rel || rel.indexOf("token=") < 0) throw new Error("The upload could not be prepared.");
        // 2. the bytes go straight to the private bucket; never replaced (no upsert)
        return fetch(SUPA.url + "/storage/v1" + rel, { method: "PUT", headers: { "content-type": S.blob.type, "x-upsert": "false" }, body: S.blob })
          .then(function (r) { if (!r.ok) throw new Error("The upload failed (" + r.status + "). Record again."); });
      })
      // 3. the server checks the object and sends it for review
      .then(function () { return rpc("identity_finish_submission", { p_submission_id: st.submission_id, p_duration_ms: S.durationMs,
        p_captured_at: new Date(S.startedAt).toISOString(), p_capture_meta: C.captureMeta(S.track, S.recorder && S.recorder.mimeType, "user") }); })
      .then(function () {
        S.msg = "Sent. The owner aims to review it within 24 hours; you will get a notification.";
        stopCamera(); clearRecording(); S.start = null;
        return load();
      })
      .catch(function (err) { S.msg = err.message || String(err); })
      .then(function () { S.busy = false; render(); });
  }

  function persona() {
    var ls = levelState(), id = ls && ls.latest && ls.latest.id;
    if (!id) return;
    S.busy = true; render();
    SUPA.token().then(function (t) {
      return fetch(API + "/v1/identity/persona/inquiry", { method: "POST", headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: JSON.stringify({ submission_id: id }) });
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
      .then(function (x) {
        if (x.r.status === 503 && x.j && x.j.detail && x.j.detail.code === "PERSONA_DISABLED") { S.persona = { text: "The ID check is not switched on yet. The owner will let you know when it is." }; return; }
        if (!x.r.ok) { S.persona = { text: (x.j && x.j.error) || "The ID check could not start.", bad: true }; return; }
        if (x.j.one_time_link) { location.assign(x.j.one_time_link); return; }
        S.persona = { text: "Your ID check is linked (" + (x.j.status || "started") + "). Use the link Persona sent you, or ask the owner for a new one." };
      })
      .catch(function (err) { S.persona = { text: err.message || String(err), bad: true }; })
      .then(function () { S.busy = false; return load(); });
  }

  function del() {
    if (!confirm("Delete your verification videos? Anything still waiting for review is withdrawn. Decisions already made stay on record.")) return;
    S.busy = true; render();
    rpc("identity_request_deletion", { p_note: "requested on the verification page" })
      .then(function (r) { S.msg = (r && r.videos_marked_for_deletion) ? "Your videos are marked for deletion." : "You have no stored videos."; stopCamera(); clearRecording(); S.start = null; })
      .catch(function (err) { S.msg = err.message || String(err); })
      .then(function () { S.busy = false; return load(); });
  }

  function bind() {
    host.querySelectorAll("[data-level]").forEach(function (b) { b.onclick = function () {
      if (S.recording) return;
      readForm(); stopCamera(); clearRecording(); S.start = null; S.msg = ""; S.persona = null;
      S.level = b.getAttribute("data-level");
      history.replaceState(null, "", location.pathname + (S.level === "v2_halo_full" ? "?level=v2" : ""));
      load();
    }; });
    host.querySelectorAll("[data-act]").forEach(function (b) { b.onclick = function () {
      var a = b.getAttribute("data-act");
      if (a === "camera") startCamera();
      else if (a === "record") record();
      else if (a === "stop") { if (S.recorder && S.recorder.state === "recording") S.recorder.stop(); }
      else if (a === "again") { clearRecording(); render(); }
      else if (a === "send") upload();
      else if (a === "persona") persona();
      else if (a === "delete") del();
    }; });
    ["idvAgree", "idvName", "idvLoc", "idvRegion", "idvAccess"].forEach(function (id) { var el = document.getElementById(id); if (el) el.onchange = readForm; });
  }

  window.addEventListener("pagehide", stopCamera);
  render();
  load();
})();
