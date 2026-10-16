/* THE PROFILE EDIT GATE, member side (inside the desk, and on the World's
   profile form). docs/control-plane/MEMBER-DESK-AND-PROFILE-EDIT-GATE.md

   Owner, 2026-10-15: "Editing your profile after onboarding should require a
   video recording literally asking to edit, then identity verification
   through Persona." Some details lock once they are set (the list is data:
   profile_protected_fields). To change one, the member asks from the desk:
   they type the new value and why, read and accept the consent, record a
   LIVE video (camera only, no uploads; the server's fresh code on screen)
   saying their name, the code, what they want changed and why, send it,
   then complete the government-ID check (Persona, through the Worker; it
   ships switched off). The owner reviews it in the control room's Identity
   tab. Only an approval changes the value, on the server, once, with an
   audit row.

   The capture is the identity levels' own (js/identity-capture-core.js:
   live stream check, recorder type, limits, capture metadata) and the
   upload/finish path is theirs too (signed upload into the private bucket,
   identity_finish_submission). The lock on the form below is a courtesy:
   the database refuses the write anyway (profile_field_locked). */
(function () {
  "use strict";
  var D = window.MCC_DESK_CORE, CAP = window.MCC_IDENTITY_CAPTURE;
  if (!D || window.HU_EDIT_GATE) return;
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var API = window.MCC_API_BASE || "https://api.mccluster.org";
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function note(t, bad) { return '<p class="hu-desk__note' + (bad ? " is-bad" : "") + '" role="' + (bad ? "alert" : "status") + '">' + esc(t) + "</p>"; }
  function token() {
    try { if (window.MCC && MCC.refreshIfNeeded) return MCC.refreshIfNeeded().then(function (s) { return s && s.access_token || null; }).catch(function () { return null; }); } catch (e) { /* fall through */ }
    return Promise.resolve(null);
  }
  function call(path, body, method, headers) {
    return token().then(function (t) {
      return fetch(SB_URL + path, { method: method || (body === undefined ? "GET" : "POST"),
        headers: Object.assign({ apikey: SB_KEY, authorization: "Bearer " + (t || SB_KEY), "content-type": "application/json" }, headers || {}),
        body: body === undefined ? undefined : JSON.stringify(body) });
    }).then(function (r) { return r.text().then(function (txt) {
      var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
      if (!r.ok) { var err = new Error((j && (j.message || j.error || j.hint)) || ("Request failed (" + r.status + ")")); err.status = r.status; err.code = j && j.code; throw err; }
      return j;
    }); });
  }
  function rpc(name, args) { return call("/rest/v1/rpc/" + name, args || {}); }
  function missing(err) { return err && (err.status === 404 || /PGRST20[12]|does not exist|Could not find/i.test(String(err.message || "") + String(err.code || ""))); }

  var G = { host: null, status: null, err: null, msg: "", busy: false, agreed: false, name: "", reason: "", values: {},
    stream: null, track: null, start: null, recorder: null, chunks: [], blob: null, blobUrl: null, startedAt: 0, durationMs: 0, recording: false, timer: null, persona: null };

  function load() {
    return rpc("profile_edit_status").then(function (s) { G.status = s; G.err = null; })
      .catch(function (err) { G.status = missing(err) ? { closed: true } : null; G.err = missing(err) ? null : (err.message || String(err)); })
      .then(function () { paint(); lockForm(); return G.status; });
  }

  /* ---------- the World's profile form: locked inputs say so ---------- */
  function lockForm() {
    var s = G.status;
    if (!s || s.closed) return;
    D.lockedFields(s).forEach(function (f) {
      var id = D.FORM_FIELDS[f.key], input = id && document.getElementById(id);
      if (!input) return;
      input.readOnly = true;
      input.setAttribute("aria-readonly", "true");
      input.setAttribute("data-hu-locked", f.key);
      var field = input.closest(".mn__field") || input.parentNode;
      if (field) field.classList.add("is-locked");
      if (field && !field.parentNode.querySelector('[data-hu-locked-hint="' + f.key + '"]')) {
        var hint = document.createElement("button");
        hint.type = "button";
        hint.className = "hu-lock-hint";
        hint.setAttribute("data-hu-locked-hint", f.key);
        hint.setAttribute("data-hu-desk-open", "profile");
        hint.textContent = "Locked. Ask to change it";
        field.parentNode.insertBefore(hint, field.nextSibling);
      }
    });
  }

  /* ---------- camera ---------- */
  function stopCamera() { if (G.stream) G.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* stopped */ } }); G.stream = null; G.track = null; }
  function clearRecording() { if (G.blobUrl) { try { URL.revokeObjectURL(G.blobUrl); } catch (e) { /* ignore */ } } G.blob = null; G.blobUrl = null; G.durationMs = 0; G.chunks = []; }
  function readForm() {
    if (!G.host) return;
    var g = function (sel) { return G.host.querySelector(sel); };
    if (g("#heAgree")) G.agreed = g("#heAgree").checked;
    if (g("#heName")) G.name = g("#heName").value;
    if (g("#heReason")) G.reason = g("#heReason").value;
    Array.prototype.forEach.call(G.host.querySelectorAll("[data-he-field]"), function (i) { G.values[i.getAttribute("data-he-field")] = i.value; });
  }
  function labelsFor(changes) {
    var by = {}; D.lockedFields(G.status).forEach(function (f) { by[f.key] = f.label; });
    return Object.keys(changes || {}).map(function (k) { return String(by[k] || k).toLowerCase(); });
  }

  function startCamera() {
    readForm();
    var c = G.status && G.status.consent;
    var check = D.validateChanges(G.values, G.status);
    if (!c) { G.msg = "Requests open once the owner approves the consent text."; paint(); return; }
    if (!check.ok) { G.msg = check.error; paint(); return; }
    if (String(G.reason).trim().length < 3) { G.msg = "Say why you want the change."; paint(); return; }
    if (!CAP || !CAP.firstLast(G.name)) { G.msg = "Type your first and last name."; paint(); return; }
    if (!G.agreed) { G.msg = "Read the consent and tick the box to agree before recording."; paint(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof window.MediaRecorder !== "function") {
      G.msg = "This browser cannot record from the camera. Use a current Chrome, Safari, Firefox or Edge."; paint(); return;
    }
    G.busy = true; G.msg = ""; paint();
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true })
      .then(function (stream) {
        G.stream = stream;
        G.track = CAP.assertLiveStream(stream);
        return rpc("profile_edit_start", { p_consent_version: c.version, p_stated_name: G.name.trim(), p_changes: check.changes, p_reason: G.reason.trim() });
      })
      .then(function (start) { G.start = start; })
      .catch(function (err) {
        stopCamera();
        G.msg = /Permission|NotAllowed|denied/i.test(String(err && (err.name || err.message))) ? "Camera and microphone access are needed. Allow them and try again." : (err.message || String(err));
      })
      .then(function () { G.busy = false; paint(); });
  }

  function record() {
    try { G.track = CAP.assertLiveStream(G.stream); } catch (e) { G.msg = e.message; stopCamera(); paint(); return; }
    if (G.start && Date.parse(G.start.challenge_expires_at) < Date.now()) { G.msg = "Your code expired. Turn the camera on again for a new one."; stopCamera(); G.start = null; paint(); return; }
    var mime = CAP.pickMimeType(function (t) { return window.MediaRecorder.isTypeSupported ? window.MediaRecorder.isTypeSupported(t) : false; });
    var rec;
    try { rec = new window.MediaRecorder(G.stream, mime ? { mimeType: mime, videoBitsPerSecond: 1500000 } : { videoBitsPerSecond: 1500000 }); }
    catch (e) { G.msg = "Recording could not start: " + (e.message || e); paint(); return; }
    clearRecording();
    G.recorder = rec; G.recording = true; G.startedAt = Date.now();
    rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) G.chunks.push(ev.data); };
    rec.onstop = function () {
      G.recording = false; clearInterval(G.timer);
      G.durationMs = Date.now() - G.startedAt;
      G.blob = new Blob(G.chunks, { type: CAP.baseMime(rec.mimeType || mime || (G.chunks[0] && G.chunks[0].type) || "video/webm") });
      G.blobUrl = URL.createObjectURL(G.blob);
      paint();
    };
    rec.start(1000);
    paint();
    var max = CAP.LEVELS.profile_edit.maxSeconds;
    G.timer = setInterval(function () {
      var s = Math.floor((Date.now() - G.startedAt) / 1000), t = G.host && G.host.querySelector("#heTimer");
      if (t) t.textContent = "● REC " + s + "s / " + max + "s";
      if (s >= max && G.recorder && G.recorder.state === "recording") G.recorder.stop();
    }, 250);
  }

  function upload() {
    var st = G.start;
    var check = CAP.validateRecording({ level: "profile_edit", source: "getUserMedia", size: G.blob && G.blob.size, mime: G.blob && G.blob.type, durationMs: G.durationMs, challengeExpiresAt: st && st.challenge_expires_at });
    if (!check.ok) { G.msg = check.error; paint(); return; }
    G.busy = true; G.msg = "Sending your video…"; paint();
    call("/storage/v1/object/upload/sign/" + encodeURI(st.bucket + "/" + st.object_path), {})
      .then(function (signed) {
        var rel = signed && signed.url;
        if (!rel || rel.indexOf("token=") < 0) throw new Error("The upload could not be prepared.");
        return fetch(SB_URL + "/storage/v1" + rel, { method: "PUT", headers: { "content-type": G.blob.type, "x-upsert": "false" }, body: G.blob })
          .then(function (r) { if (!r.ok) throw new Error("The upload failed (" + r.status + "). Record again."); });
      })
      .then(function () { return rpc("identity_finish_submission", { p_submission_id: st.submission_id, p_duration_ms: G.durationMs,
        p_captured_at: new Date(G.startedAt).toISOString(), p_capture_meta: CAP.captureMeta(G.track, G.recorder && G.recorder.mimeType, "user") }); })
      .then(function () { G.msg = "Sent. Next: the ID check."; stopCamera(); clearRecording(); G.start = null; G.values = {}; G.reason = ""; return load(); })
      .catch(function (err) { G.msg = err.message || String(err); })
      .then(function () { G.busy = false; paint(); });
  }

  function persona() {
    var l = G.status && G.status.latest;
    if (!l || !l.submission_id) return;
    G.busy = true; paint();
    token().then(function (t) {
      return fetch(API + "/v1/identity/persona/inquiry", { method: "POST", headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: JSON.stringify({ submission_id: l.submission_id }) });
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
      .then(function (x) {
        if (x.r.status === 503 && x.j && x.j.detail && x.j.detail.code === "PERSONA_DISABLED") { G.persona = { text: "The ID check is not switched on yet. Your request waits with the owner until it is." }; return; }
        if (!x.r.ok) { G.persona = { text: (x.j && x.j.error) || "The ID check could not start.", bad: true }; return; }
        if (x.j.one_time_link) { location.assign(x.j.one_time_link); return; }
        G.persona = { text: "Your ID check is linked (" + (x.j.status || "started") + ")." };
      })
      .catch(function (err) { G.persona = { text: err.message || String(err), bad: true }; })
      .then(function () { G.busy = false; return load(); });
  }

  /* ---------- painting ---------- */
  function lockedList(s) {
    var f = D.lockedFields(s);
    if (!f.length) return "<p>Nothing is locked yet. Details lock once you fill them in.</p>";
    return '<ul class="hu-desk__list">' + f.map(function (x) { return "<li><b>" + esc(x.label) + "</b> " + esc(x.value || "") + (x.requestable === false ? " <small>changes through its own setup</small>" : "") + "</li>"; }).join("") + "</ul>";
  }
  function stateBlock(state, l) {
    var why = l && l.decision_note ? " " + l.decision_note : "";
    switch (state) {
      case "waiting_persona": return note("Your video is in. Next: the government-ID check.") + '<p class="hu-desk__meta">Persona, an outside company, checks your ID. Your ID images stay with Persona; we get only the result.</p>' +
        (G.persona ? note(G.persona.text, G.persona.bad) : "") + '<button type="button" class="hu-desk__btn hu-desk__btn--primary" data-he="persona"' + (G.busy ? " disabled" : "") + ">" + (l && l.persona_inquiry ? "Continue the ID check" : "Start the ID check") + "</button>";
      case "in_review": return note("Your request is with the owner. The aim is a decision within 24 hours.");
      case "applied": return note("Your last change was approved and made.");
      case "rejected": return note("Your last request was not approved." + why, true);
      case "retake": return note("The owner asked you to record again." + why, true);
      case "withdrawn": return note("Your last request was withdrawn.");
      case "expired": return note("Your last code expired before a video was sent.");
      default: return "";
    }
  }
  function formBlock() {
    var s = G.status, c = s.consent;
    var fields = D.lockedFields(s).filter(function (f) { return f.requestable !== false; });
    if (!fields.length) return "";
    var paras = CAP ? CAP.consentParagraphs(c.body, c.retention_days).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("") : "";
    return '<div class="hu-desk__form"><h4>Ask to change</h4>' + fields.map(function (f) {
        return '<label>' + esc("New " + f.label.toLowerCase()) + '<input data-he-field="' + esc(f.key) + '" maxlength="' + esc(f.max_length || 160) + '" placeholder="' + esc(f.value || "") + '" value="' + esc(G.values[f.key] || "") + '" autocomplete="off"></label>';
      }).join("") +
      '<label>Why<textarea id="heReason" rows="2" maxlength="600">' + esc(G.reason) + "</textarea></label>" +
      '<details class="hu-desk__consent"><summary>' + esc(c.title) + "</summary>" + paras + '<p class="hu-desk__meta">Consent version ' + esc(c.version) + "</p></details>" +
      '<label class="hu-desk__check"><input type="checkbox" id="heAgree"' + (G.agreed ? " checked" : "") + "> I have read this and I agree.</label>" +
      '<label>Your first and last name<input id="heName" autocomplete="name" maxlength="120" value="' + esc(G.name) + '"></label></div>';
  }
  function cameraBlock() {
    var st = G.start;
    var stage = '<div class="hu-desk__stage"><video id="hePreview" class="hu-desk__video" autoplay muted playsinline' + (G.stream && !G.blob ? "" : " hidden") + "></video>" +
      (G.blob ? '<video id="hePlayback" class="hu-desk__video" controls playsinline src="' + esc(G.blobUrl) + '"></video>' : "") +
      (st && !G.blob ? '<div class="hu-desk__challenge" aria-live="polite"><span class="hu-desk__meta">Say this on camera</span>' +
        D.editScript(G.name, st.challenge_phrase, labelsFor(st.changes), G.reason).map(function (l, i) { return '<b class="hu-desk__line' + (i === 1 ? " hu-desk__code" : "") + '">' + esc(l) + "</b>"; }).join("") +
        (G.recording ? '<span class="hu-desk__rec" id="heTimer">● REC 0s</span>' : "") + "</div>" : "") + "</div>";
    var b;
    if (!G.stream && !G.blob) b = '<button type="button" class="hu-desk__btn hu-desk__btn--primary" data-he="camera"' + (G.busy ? " disabled" : "") + ">Turn on camera and get my code</button>";
    else if (G.blob) b = '<button type="button" class="hu-desk__btn hu-desk__btn--primary" data-he="send"' + (G.busy ? " disabled" : "") + ">Send to the owner</button><button type=\"button\" class=\"hu-desk__btn\" data-he=\"again\"" + (G.busy ? " disabled" : "") + ">Record again</button>";
    else if (G.recording) b = '<button type="button" class="hu-desk__btn hu-desk__btn--primary" data-he="stop">Stop</button>';
    else b = '<button type="button" class="hu-desk__btn hu-desk__btn--primary" data-he="record">Record</button>';
    return '<p class="hu-desk__meta">Live camera only: no uploads. Up to ' + esc(CAP ? CAP.LEVELS.profile_edit.maxSeconds : 120) + " seconds. Your code works for ten minutes.</p>" + stage + '<div class="hu-desk__row">' + b + "</div>";
  }
  function paint() {
    var h = G.host;
    if (!h || !h.isConnected) return;
    var s = G.status, html = "<h3>Locked details</h3>";
    if (G.err) html += note("Could not load your locked details: " + G.err, true);
    else if (!s) html += note("Loading…");
    else {
      var state = D.gateState(s);
      if (state === "closed") html += note("Locked details are not switched on yet.");
      else if (state === "signed_out") html += note("Sign in first.");
      else {
        html += '<p class="hu-desk__meta">These lock once set. A change takes a short live video and an ID check, and the owner approves it.</p>' + lockedList(s);
        html += (G.msg ? note(G.msg) : "") + stateBlock(state, s.latest);
        if (state === "consent_pending") html += note("Change requests open once the owner approves the consent text.");
        else if (D.canStart(state) && D.lockedFields(s).some(function (f) { return f.requestable !== false; })) html += formBlock() + cameraBlock();
      }
    }
    h.innerHTML = html;
    var pv = h.querySelector("#hePreview");
    if (pv && G.stream && pv.srcObject !== G.stream) { pv.srcObject = G.stream; var p = pv.play && pv.play(); if (p && p.catch) p.catch(function () {}); }
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-he]");
    if (!b || !G.host || !G.host.contains(b)) return;
    var a = b.getAttribute("data-he");
    if (a === "camera") startCamera();
    else if (a === "record") record();
    else if (a === "stop") { if (G.recorder && G.recorder.state === "recording") G.recorder.stop(); }
    else if (a === "again") { clearRecording(); paint(); }
    else if (a === "send") upload();
    else if (a === "persona") persona();
  }
  function mount(host) {
    if (!host) return;
    if (G.host && G.host !== host) G.host.removeEventListener("click", onClick);
    G.host = host;
    host.addEventListener("click", onClick);
    host.addEventListener("input", readForm);
    host.addEventListener("change", readForm);
    paint();
    load();
  }
  window.addEventListener("pagehide", stopCamera);
  window.addEventListener("mcc:auth-changed", function () { stopCamera(); clearRecording(); G.status = null; G.start = null; });
  window.HU_EDIT_GATE = { mount: mount, stop: function () { if (G.recorder && G.recorder.state === "recording") { try { G.recorder.stop(); } catch (e) { /* stopped */ } } stopCamera(); }, lockForm: function () { return (G.status ? Promise.resolve(G.status) : load()).then(lockForm); }, load: load, state: G };
})();
