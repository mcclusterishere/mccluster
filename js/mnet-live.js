/* LIVE ON THE ACTION NETWORK.

   Watching: anyone signed in sees "Live now" above the feed. Opening a
   broadcast plays it over WebRTC (WHEP) from Cloudflare Stream with under a
   second of delay, and the chat beside it is the replies thread of the
   broadcast's feed post, so it uses the same posting, blocking and reporting
   as everything else on the network.

   Broadcasting: the owner desk and accepted fellows get a Go live button. The
   studio previews the camera, asks the Worker for a fresh live input, pushes
   the camera to it over WebRTC (WHIP), puts the broadcast on air (which posts
   "Live now" to the feed) and sends a heartbeat every 30 seconds. A broadcast
   with no heartbeat for two minutes drops out of everyone's list on its own.
   The publish URL lives only in this tab's memory.

   Phone first: video is 16:9 at full width, controls are 44px, inputs 16px,
   and the camera is the front one until flipped. */
(function (w, d) {
  "use strict";

  var M = null, live = { list: [], timer: 0, can: null, enabled: true },
      watch = { pc: null, session: null, chatTimer: 0, seen: {} },
      studio = { stream: null, pc: null, whipSession: null, session: null, beat: 0, facing: "user" };

  function $(id) { return d.getElementById(id); }
  function say(el, text, kind) { if (!el) return; el.textContent = text || ""; el.className = "mn__status" + (kind ? " mn__status--" + kind : ""); }
  function track(name, data) { try { if (w.MCC_TRACK) w.MCC_TRACK(name, data || {}); } catch (e) { /* analytics never breaks live */ } }

  /* ---------- WebRTC signalling, the same single POST for both directions ---------- */
  function negotiate(pc, url) {
    return pc.createOffer().then(function (offer) {
      return pc.setLocalDescription(offer).then(function () {
        return fetch(url, { method: "POST", headers: { "content-type": "application/sdp" }, body: offer.sdp });
      });
    }).then(function (res) {
      if (!res.ok) throw new Error(res.status === 409 || res.status === 404 ? "not-live" : "Connection refused (" + res.status + ")");
      var loc = res.headers.get("location");
      return res.text().then(function (sdp) {
        return pc.setRemoteDescription({ type: "answer", sdp: sdp }).then(function () { return loc ? new URL(loc, url).toString() : null; });
      });
    });
  }
  function hangUp(pc, sessionUrl) {
    if (sessionUrl) fetch(sessionUrl, { method: "DELETE" }).catch(function () {});
    if (pc) try { pc.close(); } catch (e) { /* already closed */ }
  }

  /* ---------- the Live now strip ---------- */
  function loadLive() {
    return M.sbRest("network_live_sessions?select=id,host_m_uid,title,whep_url,post_id,started_at&order=started_at.desc&limit=12")
      .then(function (rows) { live.list = rows || []; paintStrip(); })
      .catch(function () { live.list = []; paintStrip(); });
  }
  function paintStrip() {
    var host = $("mnLive"), trackEl = $("mnLiveTrack");
    if (!host || !trackEl) return;
    var any = live.list.length > 0, can = live.can === true;
    host.hidden = !any && !can;
    $("mnGoLive").hidden = !can;
    trackEl.innerHTML = any ? live.list.map(function (s) {
      return '<button class="mn__livecard" type="button" data-live="' + M.esc(s.id) + '"><span class="mn__livecard-dot" aria-hidden="true"></span><b>' + M.esc(s.title) + '</b><span>' + M.esc(since(s.started_at)) + '</span></button>';
    }).join("") : '<p class="mn__live-empty">Nobody is live right now.' + (can ? " You can be first." : "") + '</p>';
  }
  function since(t) {
    var m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));
    return m < 1 ? "just started" : m < 60 ? "live for " + m + " min" : "live for " + Math.floor(m / 60) + " h " + (m % 60) + " min";
  }

  /* ---------- watching ---------- */
  function openWatch(id) {
    var s = live.list.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    closeWatch();
    watch.session = s; watch.seen = {};
    $("mnLiveWatchTitle").textContent = s.title;
    $("mnLiveHost").textContent = "";
    $("mnLiveChat").innerHTML = "";
    $("mnLiveNote").hidden = false; $("mnLiveNote").textContent = "Connecting…";
    say($("mnLiveWatchStatus"), "");
    $("mnLiveChatForm").hidden = !s.post_id;
    if (!$("mnLiveWatch").open) $("mnLiveWatch").showModal();
    track("live_watch", { session: s.id });
    M.api("/v1/mnet/people/" + encodeURIComponent(s.host_m_uid)).then(function (p) {
      var prof = (p && p.profile) || {}, ident = (p && p.identity) || {};
      $("mnLiveHost").textContent = (prof.display_name || "Someone") + (ident.mccluster_id ? " · @" + ident.mccluster_id : "");
    }).catch(function () {});
    M.sbRpc("eu_is_admin").then(function (yes) { $("mnLiveKill").hidden = yes !== true; }).catch(function () {});
    var pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" }), media = new MediaStream();
    watch.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = function (e) { media.addTrack(e.track); $("mnLiveVideo").srcObject = media; $("mnLiveNote").hidden = true; };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") { $("mnLiveNote").hidden = false; $("mnLiveNote").textContent = "The broadcast has ended or the connection dropped."; }
    };
    negotiate(pc, s.whep_url).then(function (loc) { watch.sessionUrl = loc; }).catch(function (e) {
      $("mnLiveNote").hidden = false;
      $("mnLiveNote").textContent = e.message === "not-live" ? "This broadcast hasn't started yet, or it just ended." : "Could not connect to the broadcast.";
    });
    if (s.post_id) { loadChat(); watch.chatTimer = setInterval(loadChat, 4000); }
  }
  function closeWatch() {
    clearInterval(watch.chatTimer); watch.chatTimer = 0;
    hangUp(watch.pc, watch.sessionUrl); watch.pc = null; watch.sessionUrl = null;
    var v = $("mnLiveVideo"); if (v) v.srcObject = null;
  }
  function loadChat() {
    var s = watch.session; if (!s || !s.post_id) return;
    M.api("/v1/mnet/posts/" + encodeURIComponent(s.post_id) + "/replies").then(function (data) {
      var list = $("mnLiveChat"), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      (data.replies || []).forEach(function (r) {
        var post = r.post || r, actor = r.actor || {};
        if (!post.id || watch.seen[post.id]) return;
        watch.seen[post.id] = true;
        var li = d.createElement("li");
        li.innerHTML = '<b>' + M.esc(actor.display_name || actor.mccluster_id || "Someone") + '</b> ' + M.esc(post.body || "");
        list.appendChild(li);
      });
      if (atBottom) list.scrollTop = list.scrollHeight;
    }).catch(function () {});
  }
  function sendChat(ev) {
    ev.preventDefault();
    var s = watch.session, input = $("mnLiveChatBody"), body = input.value.trim();
    if (!s || !s.post_id || !body) return;
    var b = ev.target.querySelector("button"); b.disabled = true;
    M.api("/v1/mnet/posts?app_key=" + encodeURIComponent(M.app), { method: "POST", body: { body: body, reply_to_id: s.post_id } })
      .then(function () { input.value = ""; loadChat(); })
      .catch(function (e) { say($("mnLiveWatchStatus"), e.message || "Could not send.", "error"); })
      .then(function () { b.disabled = false; });
  }
  function reportLive() {
    var s = watch.session; if (!s || !s.post_id) return;
    M.api("/v1/mnet/reports", { method: "POST", body: { target_type: "post", target_id: s.post_id, reason: "other", details: "Live broadcast: " + s.title } })
      .then(function () { say($("mnLiveWatchStatus"), "Reported. The desk will look at it.", "ok"); })
      .catch(function (e) { say($("mnLiveWatchStatus"), e.message || "Could not report.", "error"); });
  }
  function killLive() {
    var s = watch.session; if (!s) return;
    if (!w.confirm("End this broadcast for everyone?")) return;
    M.api("/v1/mnet/live/" + encodeURIComponent(s.id) + "/end", { method: "POST", body: {} })
      .then(function () { say($("mnLiveWatchStatus"), "Broadcast ended.", "ok"); closeWatch(); loadLive(); })
      .catch(function (e) { say($("mnLiveWatchStatus"), e.message || "Could not end it.", "error"); });
  }

  /* ---------- broadcasting ---------- */
  function openStudio() {
    if (!live.enabled) { w.alert("Live video is being switched on. Try again soon."); return; }
    say($("mnStudioStatus"), "");
    $("mnStudioGo").hidden = false; $("mnStudioEnd").hidden = true; $("mnStudioTopic").disabled = false;
    if (!$("mnStudio").open) $("mnStudio").showModal();
    preview();
  }
  function preview() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("mnStudioNote").textContent = "This browser can't use the camera. Try Safari or Chrome on your phone."; return; }
    stopTracks();
    navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: studio.facing, width: { ideal: 1280 }, height: { ideal: 720 } } }).then(function (stream) {
      studio.stream = stream;
      $("mnStudioVideo").srcObject = stream; $("mnStudioNote").hidden = true;
      if (studio.pc) {
        /* already live: swap the camera without dropping the broadcast */
        var v = stream.getVideoTracks()[0];
        studio.pc.getSenders().forEach(function (sn) { if (sn.track && sn.track.kind === "video" && v) sn.replaceTrack(v); if (sn.track && sn.track.kind === "audio") sn.replaceTrack(stream.getAudioTracks()[0]); });
      }
    }).catch(function () { $("mnStudioNote").hidden = false; $("mnStudioNote").textContent = "Camera or microphone was blocked. Allow both in your browser settings, then reopen this."; });
  }
  function stopTracks() { if (studio.stream) studio.stream.getTracks().forEach(function (t) { t.stop(); }); studio.stream = null; }
  function goLive(ev) {
    ev.preventDefault();
    var title = $("mnStudioTopic").value.trim();
    if (!title) { $("mnStudioTopic").focus(); return; }
    if (!studio.stream) { say($("mnStudioStatus"), "Allow your camera first.", "error"); return; }
    var go = $("mnStudioGo"); go.disabled = true; say($("mnStudioStatus"), "Starting…");
    M.api("/v1/mnet/live", { method: "POST", body: { title: title } }).then(function (r) {
      studio.session = r.session;
      var pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
      studio.pc = pc;
      studio.stream.getTracks().forEach(function (t) { pc.addTransceiver(t, { direction: "sendonly" }); });
      pc.onconnectionstatechange = function () {
        if (pc.connectionState === "failed") say($("mnStudioStatus"), "The connection dropped. End and go live again.", "error");
      };
      return negotiate(pc, r.whip_url);
    }).then(function (loc) {
      studio.whipSession = loc;
      return M.api("/v1/mnet/live/" + encodeURIComponent(studio.session.id) + "/on-air", { method: "POST", body: {} });
    }).then(function () {
      go.hidden = true; $("mnStudioEnd").hidden = false; $("mnStudioTopic").disabled = true;
      say($("mnStudioStatus"), "You're live.", "ok");
      track("live_start", {});
      studio.beat = setInterval(function () {
        M.api("/v1/mnet/live/" + encodeURIComponent(studio.session.id) + "/heartbeat", { method: "POST", body: {} }).catch(function () {});
      }, 30000);
      loadLive(); if (M.refreshFeed) M.refreshFeed();
    }).catch(function (e) {
      say($("mnStudioStatus"), e.message === "not-live" ? "Cloudflare would not take the broadcast. Try again in a moment." : (e.message || "Could not go live."), "error");
      endBroadcast(true);
    }).then(function () { go.disabled = false; });
  }
  function endBroadcast(quiet) {
    clearInterval(studio.beat); studio.beat = 0;
    hangUp(studio.pc, studio.whipSession); studio.pc = null; studio.whipSession = null;
    var s = studio.session; studio.session = null;
    $("mnStudioGo").hidden = false; $("mnStudioEnd").hidden = true; $("mnStudioTopic").disabled = false;
    if (!s) return Promise.resolve();
    return M.api("/v1/mnet/live/" + encodeURIComponent(s.id) + "/end", { method: "POST", body: {} })
      .then(function () { if (!quiet) say($("mnStudioStatus"), "Broadcast ended.", "ok"); track("live_end", {}); loadLive(); })
      .catch(function () {});
  }
  function closeStudio() {
    if (studio.session && !w.confirm("End your broadcast?")) return;
    endBroadcast(true).then(function () { stopTracks(); $("mnStudioVideo").srcObject = null; $("mnStudio").close(); });
  }

  function wire() {
    $("mnLiveTrack").addEventListener("click", function (e) { var b = e.target.closest("[data-live]"); if (b) openWatch(b.getAttribute("data-live")); });
    $("mnLiveWatchClose").onclick = function () { closeWatch(); $("mnLiveWatch").close(); };
    $("mnLiveWatch").addEventListener("close", closeWatch);
    $("mnLiveChatForm").addEventListener("submit", sendChat);
    $("mnLiveReport").onclick = reportLive;
    $("mnLiveKill").onclick = killLive;
    $("mnGoLive").onclick = openStudio;
    $("mnStudioForm").addEventListener("submit", goLive);
    $("mnStudioEnd").onclick = function () { endBroadcast(false); };
    $("mnStudioFlip").onclick = function () { studio.facing = studio.facing === "user" ? "environment" : "user"; preview(); };
    $("mnStudioClose").onclick = closeStudio;
    $("mnStudio").addEventListener("cancel", function (e) { e.preventDefault(); closeStudio(); });
    w.addEventListener("pagehide", function () { if (studio.session) endBroadcast(true); });
  }

  w.MCC_LIVE = {
    start: function () {
      M = w.MCC_MNET;
      if (!M || !$("mnLive") || live.started) return;
      live.started = true;
      if (!w.RTCPeerConnection) return; /* no WebRTC, no live: the strip stays hidden */
      wire();
      M.api("/v1/mnet/live/eligibility").then(function (r) { live.can = !!(r && r.can_host); live.enabled = !!(r && r.enabled); paintStrip(); }).catch(function () {});
      loadLive();
      live.timer = setInterval(function () { if (!d.hidden) loadLive(); }, 30000);
    },
    open: openWatch
  };
})(window, document);
