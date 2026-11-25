/* LIVE MISSION CAPTURE (live-mission.html?assignment=<uuid>[&bounty=<uuid>][&mission=<title>]).

   The doer goes live on camera for the whole mission and taps "Mission
   complete" at the end (owner, 2026-10-15). This page:
     - asks for the camera and microphone only (getUserMedia; never the screen);
     - asks the Worker to open the run (POST /v1/live/sessions); the WHIP URL
       it gets back lives in memory only;
     - publishes over WHIP (js/whip-client.js) and reconnects on a drop, while
       the resume window (the mission's own policy) allows;
     - records the same tracks with MediaRecorder and uploads a chunk every
       few seconds (Stream cannot record WebRTC inputs), so the recording
       survives a crash;
     - heartbeats while connected; the server's continuity verdict is shown;
     - "Mission complete" -> the proof is filed PENDING; an admin reviews it;
     - afterwards, the 12 publishing opt-ins, every one off by default.
   Design: docs/control-plane/LIVE-MISSIONS.md. */
(function (w, d) {
  "use strict";
  var API = "https://api.mccluster.org";
  var CONSENT_VERSION = "live-mission-v1";
  var PUBLISH_TEXT = "Publishing choices for my live mission recording (live-publish-v1): each use only as I chose here; revocable; McCluster Corp stops new uses within 72 hours of a revocation.";
  var q = new URLSearchParams(w.location.search);
  var assignment = q.get("assignment") || "";
  var bounty = q.get("bounty") || "";
  var S = { stream: null, run: null, whip: null, rec: null, seq: 0, queue: [], uploading: false, beat: 0, tick: 0, started: 0, policy: null, ending: false, reconnecting: false };

  function $(id) { return d.getElementById(id); }
  function say(text, kind) { var el = $("lmStatus"); el.textContent = text || ""; el.className = "lm__status" + (kind ? " is-" + kind : ""); }
  function track(name, data) { try { if (w.MCC_TRACK) w.MCC_TRACK(name, data || {}); } catch (_) {} }
  function clock(sec) { sec = Math.max(0, Math.floor(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  function token() { return w.MCC_SUPA && w.MCC_SUPA.token ? w.MCC_SUPA.token() : Promise.resolve(null); }
  function api(path, opts) {
    opts = opts || {};
    return token().then(function (t) {
      if (!t) throw Object.assign(new Error("Sign in first."), { status: 401 });
      var h = { authorization: "Bearer " + t };
      if (opts.json !== undefined) h["content-type"] = "application/json";
      if (opts.type) h["content-type"] = opts.type;
      return fetch(API + path, { method: opts.method || "GET", headers: h, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw Object.assign(new Error(j.error || ("Request failed (" + res.status + ")")), { status: res.status });
        return j;
      });
    });
  }
  function sha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    });
  }

  /* ---------- setup ---------- */
  function ready() {
    var ok = $("lmAdult").checked && $("lmMinors").checked && $("lmRules").checked && !!S.stream;
    $("lmGo").disabled = !ok;
  }
  function allowCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say("This browser can't use the camera.", "err"); return; }
    say("Asking for your camera…");
    navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(function (stream) {
        S.stream = stream;
        $("lmVideo").srcObject = stream;
        $("lmCamera").hidden = true;
        say("Camera ready.", "ok");
        ready();
      }).catch(function () { say("Camera blocked. Allow it in your browser to go live.", "err"); });
  }

  /* ---------- recording: chunks upload while live ---------- */
  function pickType() {
    var types = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    for (var i = 0; i < types.length; i++) if (w.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) return types[i];
    return "";
  }
  function startRecorder(chunkSeconds) {
    if (!w.MediaRecorder) { say("Live, but this browser can't keep a recording. The desk will see the live record only.", "warn"); return; }
    var type = pickType();
    try { S.rec = new MediaRecorder(S.stream, type ? { mimeType: type, videoBitsPerSecond: 1500000 } : undefined); }
    catch (_) { S.rec = new MediaRecorder(S.stream); }
    S.rec.ondataavailable = function (e) { if (e.data && e.data.size) { S.queue.push({ seq: S.seq++, blob: e.data }); pump(); } };
    S.rec.start(Math.max(2, chunkSeconds || 5) * 1000);
  }
  function pump() {
    if (S.uploading || !S.queue.length || !S.run) return Promise.resolve();
    S.uploading = true;
    var c = S.queue[0];
    var type = (c.blob.type || "video/webm").split(";")[0];
    return api("/v1/live/sessions/" + S.run.session_id + "/chunks/" + c.seq, { method: "PUT", type: type === "video/mp4" ? "video/mp4" : "video/webm", body: c.blob })
      .then(function () { S.queue.shift(); }, function () { /* keep it; the next pump retries */ })
      .then(function () { S.uploading = false; if (S.queue.length) return new Promise(function (r) { setTimeout(r, 300); }).then(pump); });
  }
  function flushRecorder() {
    return new Promise(function (resolve) {
      if (!S.rec || S.rec.state === "inactive") return resolve();
      S.rec.addEventListener("stop", function () { resolve(); }, { once: true });
      try { S.rec.stop(); } catch (_) { resolve(); }
    }).then(function drain(n) {
      n = n || 0;
      if (!S.queue.length || n > 40) return;
      return pump().then(function () { return new Promise(function (r) { setTimeout(r, 250); }); }).then(function () { return drain(n + 1); });
    });
  }

  /* ---------- live ---------- */
  function publish() {
    return w.MCC_WHIP.publish(S.stream, S.run.whip_url, { onState: onState }).then(function (h) { S.whip = h; });
  }
  function onState(state) {
    if (S.ending) return;
    if (state === "connected") { $("lmBadge").classList.add("is-on"); say("You're live. Stay on until the mission is done.", "ok"); return; }
    if (state === "failed" || state === "disconnected") {
      $("lmBadge").classList.remove("is-on");
      say("Signal dropped. Reconnecting…", "warn");
      reconnect(0);
    }
  }
  function reconnect(n) {
    if (S.reconnecting || S.ending || !S.run) return;
    S.reconnecting = true;
    var old = S.whip; S.whip = null;
    (old ? old.close() : Promise.resolve()).then(function () {
      return new Promise(function (r) { setTimeout(r, Math.min(8000, 1000 * Math.pow(2, n))); });
    }).then(publish).then(function () { S.reconnecting = false; }, function () {
      S.reconnecting = false;
      var windowSec = ((S.policy && S.policy.resume_window_minutes) || 10) * 60;
      if ((Date.now() - S.lastUp) / 1000 < windowSec) reconnect(n + 1);
      else say("The run broke: the signal was gone too long. Start again when you can.", "err");
    });
  }
  function heartbeat() {
    if (!S.run) return;
    var up = !!(S.whip && S.whip.connected());
    if (up) S.lastUp = Date.now();
    api("/v1/live/sessions/" + S.run.session_id + "/heartbeat", { method: "POST", json: { connected: up } }).then(function (r) {
      var c = r && r.continuity;
      if (!c) return;
      $("lmGaps").textContent = String(c.gaps || 0);
      $("lmState").textContent = c.state === "continuous" ? "solid" : c.state === "resumed" ? "resumed" : c.state === "broken" ? "broken" : "…";
      if (c.state === "broken") say("This run broke (" + (c.reason || "signal") + "). End it and start again.", "err");
    }).catch(function (e) { if (e.status === 410) say("This run has ended.", "err"); });
  }
  function goLive() {
    $("lmGo").disabled = true;
    say("Starting…");
    api("/v1/live/sessions", { method: "POST", json: {
      assignment_id: assignment, bounty_id: bounty || null, consent_version: CONSENT_VERSION,
      attest: { adult: $("lmAdult").checked, minors_rule: $("lmMinors").checked, recording_rules: $("lmRules").checked },
      third_party_mode: $("lmThird").value, globe_visibility: $("lmGlobe").value
    } }).then(function (run) {
      S.run = run; S.policy = run.policy || {}; S.started = Date.now(); S.lastUp = Date.now();
      return publish().then(function () {
        $("lmSetup").hidden = true; $("lmLive").hidden = false; $("lmClock").hidden = false;
        startRecorder(run.chunk_seconds);
        S.beat = setInterval(heartbeat, Math.max(5, run.heartbeat_seconds || 15) * 1000);
        heartbeat();
        S.tick = setInterval(function () {
          var sec = (Date.now() - S.started) / 1000;
          $("lmClock").textContent = clock(sec); $("lmUp").textContent = clock(sec);
          $("lmDone").disabled = sec < ((S.policy && S.policy.min_duration_seconds) || 300);
        }, 1000);
        track("live_mission_start", { bounty: Boolean(bounty) });
      });
    }).catch(function (e) {
      $("lmGo").disabled = false;
      say(e.message || "Could not go live.", "err");
    });
  }
  function stopAll() {
    S.ending = true;
    clearInterval(S.beat); clearInterval(S.tick);
    $("lmBadge").classList.remove("is-on");
    return flushRecorder().then(function () { return S.whip ? S.whip.close() : null; }).then(function () {
      if (S.stream) S.stream.getTracks().forEach(function (t) { t.stop(); });
    });
  }
  function complete() {
    $("lmDone").disabled = true;
    say("Finishing… keep this page open.");
    stopAll().then(function () {
      return api("/v1/live/sessions/" + S.run.session_id + "/complete", { method: "POST", json: {} });
    }).then(function (r) {
      $("lmLive").hidden = true;
      if (r.status === "broken") { say("The run broke before the end, so it can't count. Start again when you can.", "err"); return; }
      $("lmAfter").hidden = false;
      say("Sent for review.", "ok");
      track("live_mission_complete", {});
    }).catch(function (e) { $("lmDone").disabled = false; say(e.message || "Could not finish.", "err"); });
  }
  function endRun() {
    stopAll().then(function () { return api("/v1/live/sessions/" + S.run.session_id + "/end", { method: "POST", json: {} }); })
      .then(function () { $("lmLive").hidden = true; say("Ended. Nothing was sent for review."); }, function (e) { say(e.message, "err"); });
  }
  function markThird(mode) {
    api("/v1/live/sessions/" + S.run.session_id + "/third-party", { method: "POST", json: { mode: mode } })
      .then(function () { say(mode === "consented_on_camera" ? "Noted: they agreed on camera." : "Noted: keep them off camera.", "ok"); }, function (e) { say(e.message, "err"); });
  }
  function savePublishing(ev) {
    ev.preventDefault();
    var f = ev.target, choices = {};
    ["edit_clip", "repost_own_channels", "clipper_share", "paid_ads", "tag_handles", "attribution"].forEach(function (k) { choices[k] = f.elements[k].checked; });
    ["face", "voice", "name_display", "location_display", "term"].forEach(function (k) { choices[k] = f.elements[k].value; });
    sha256(PUBLISH_TEXT).then(function (h) {
      return api("/v1/live/sessions/" + S.run.session_id + "/publishing", { method: "POST", json: { version: "live-publish-v1", text_sha256: h, choices: choices } });
    }).then(function () { say("Choices saved. You can change or revoke them later.", "ok"); }, function (e) { say(e.message, "err"); });
  }

  function init() {
    if (!/^[0-9a-f-]{36}$/i.test(assignment)) { say("Open this from a mission you joined.", "err"); $("lmCamera").disabled = true; return; }
    if (q.get("mission")) $("lmMission").textContent = q.get("mission").slice(0, 160);
    if (!w.MCC_SUPA || !w.MCC_SUPA.uid || !w.MCC_SUPA.uid()) {
      say("Sign in to go live.", "warn");
      $("lmCamera").textContent = "Sign in";
      $("lmCamera").addEventListener("click", function () { w.location.href = "account.html?next=" + encodeURIComponent(w.location.pathname.replace(/^\//, "") + w.location.search); });
      return;
    }
    $("lmCamera").addEventListener("click", allowCamera);
    ["lmAdult", "lmMinors", "lmRules"].forEach(function (id) { $(id).addEventListener("change", ready); });
    $("lmGo").addEventListener("click", goLive);
    $("lmDone").addEventListener("click", complete);
    $("lmEnd").addEventListener("click", endRun);
    Array.prototype.forEach.call(d.querySelectorAll("[data-third]"), function (b) { b.addEventListener("click", function () { markThird(b.getAttribute("data-third")); }); });
    $("lmPublish").addEventListener("submit", savePublishing);
  }
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", init); else init();
})(window, document);
