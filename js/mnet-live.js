/* LIVE ON THE ACTION NETWORK.
   Live is the network's front door: governed Home and Mission rooms, five
   fixed categories, first-class music and measured outcomes.

   Hosting is a capability, not a profile role. The Worker resolves an active
   cohort/client-project/staff grant before it creates a Cloudflare Stream
   input. Stage vocabulary stays intentionally tiny: host, cohost, guest.
   This first slice still transports one host video over Stream WHIP/WHEP;
   multi-seat transport is modeled but not falsely presented as active.

   Discovery uses aggregate retention/action outcomes. Viewer identities stay
   private, support/credits do not enter ranking, and the UI shows useful raw
   counts instead of a gameable rank number. */
(function (w, d) {
  "use strict";

  var M = null;
  var live = {
    list: [], timer: 0, can: false, enabled: true, started: false,
    kind: "", category: "", options: null, loading: false
  };
  var watch = {
    pc: null, session: null, sessionUrl: null,
    chatTimer: 0, presenceTimer: 0, seen: {}
  };
  var studio = {
    stream: null, pc: null, whipSession: null, session: null,
    beat: 0, facing: "user", options: null
  };

  function $(id) { return d.getElementById(id); }
  function say(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "mn__status" + (kind ? " mn__status--" + kind : "");
  }
  function track(name, data) {
    try { if (w.MCC_TRACK) w.MCC_TRACK(name, data || {}); } catch (_) {}
  }
  function esc(v) { return M ? M.esc(v) : String(v == null ? "" : v); }
  function since(t) {
    var ms = Date.now() - new Date(t || 0).getTime();
    if (!Number.isFinite(ms)) return "";
    var m = Math.max(0, Math.round(ms / 60000));
    return m < 1 ? "just started" : m < 60 ? "live for " + m + " min" : "live for " + Math.floor(m / 60) + " h " + (m % 60) + " min";
  }
  function personName(actor) {
    actor = actor || {};
    return actor.display_name || actor.mccluster_id || "Member";
  }

  /* ---------- WebRTC signalling ---------- */
  function negotiate(pc, url) {
    return pc.createOffer().then(function (offer) {
      return pc.setLocalDescription(offer).then(function () {
        return fetch(url, { method: "POST", headers: { "content-type": "application/sdp" }, body: offer.sdp });
      });
    }).then(function (res) {
      if (!res.ok) throw new Error(res.status === 409 || res.status === 404 ? "not-live" : "Connection refused (" + res.status + ")");
      var loc = res.headers.get("location");
      return res.text().then(function (sdp) {
        return pc.setRemoteDescription({ type: "answer", sdp: sdp }).then(function () {
          return loc ? new URL(loc, url).toString() : null;
        });
      });
    });
  }
  function hangUp(pc, sessionUrl) {
    if (sessionUrl) fetch(sessionUrl, { method: "DELETE" }).catch(function () {});
    if (pc) try { pc.close(); } catch (_) {}
  }

  /* ---------- directory ---------- */
  function directoryPath() {
    var q = new URLSearchParams();
    if (live.kind) q.set("kind", live.kind);
    if (live.category) q.set("category", live.category);
    return "/v1/mnet/live/directory" + (q.toString() ? "?" + q.toString() : "");
  }
  function loadLive() {
    if (!M || live.loading) return Promise.resolve();
    live.loading = true;
    say($("mnLiveDirectoryStatus"), "Loading live rooms…");
    return M.api(directoryPath()).then(function (out) {
      live.list = (out && out.sessions) || [];
      paintDirectory();
      say($("mnLiveDirectoryStatus"), "");
    }).catch(function (e) {
      live.list = [];
      paintDirectory();
      say($("mnLiveDirectoryStatus"), e.message || "Live rooms could not load.", "error");
    }).then(function () { live.loading = false; });
  }
  function metricLine(s) {
    var m = s.metrics || {};
    if (s.room_kind === "mission") {
      return Number(m.joined || 0).toLocaleString() + " joined · " + Number(m.verified || 0).toLocaleString() + " verified";
    }
    return Number(m.unique_viewers || 0).toLocaleString() + " viewers · " + Number(m.engaged_viewers || 0).toLocaleString() + " stayed 60s+";
  }
  function liveCard(s) {
    var room = s.room || {}, mission = s.mission, music = s.music, actor = s.host || {};
    return '<button class="mn__livecard" type="button" data-live="' + esc(s.id) + '">' +
      '<div class="mn__livecard-top"><span class="mn__livecard-dot" aria-hidden="true"></span>' +
        '<span class="mn__livebadge">' + esc(s.room_kind === "mission" ? "Mission room" : "Home room") + '</span>' +
        '<span class="mn__livebadge is-soft">' + esc(s.category_key || "live") + '</span></div>' +
      '<b>' + esc(room.title || s.title) + '</b>' +
      (room.title && room.title !== s.title ? '<strong>' + esc(s.title) + '</strong>' : '') +
      '<span class="mn__livecard-host">' + esc(personName(actor)) + ' · ' + esc(since(s.started_at)) + '</span>' +
      (music ? '<span class="mn__livecard-object"><em>Now playing</em>' + esc(music.artist_name + " — " + music.track_title) + '</span>' : '') +
      (mission ? '<span class="mn__livecard-object"><em>Mission</em>' + esc(mission.title) + '</span>' : '') +
      '<span class="mn__livecard-metrics">' + esc(metricLine(s)) + '</span>' +
    '</button>';
  }
  function paintDirectory() {
    var host = $("mnLive"), trackEl = $("mnLiveTrack");
    if (!host || !trackEl) return;
    host.hidden = false;
    $("mnGoLive").hidden = !live.can;
    trackEl.innerHTML = live.list.length
      ? live.list.map(liveCard).join("")
      : '<div class="mn__live-empty"><b>Nobody is live in this lane right now.</b><span>' +
          (live.can ? "You have live access. Open a governed room when there is real work to show." : "Try another room type or category.") +
        '</span></div>';
  }
  function setFilter(button, key) {
    var group = button.parentNode;
    Array.prototype.forEach.call(group.querySelectorAll("button"), function (x) {
      x.classList.toggle("is-on", x === button);
      x.setAttribute("aria-pressed", x === button ? "true" : "false");
    });
    live[key] = button.getAttribute(key === "kind" ? "data-live-kind" : "data-live-category") || "";
    loadLive();
  }

  /* ---------- watching ---------- */
  function viewerHeartbeat() {
    var s = watch.session;
    if (!s) return;
    M.api("/v1/mnet/live/" + encodeURIComponent(s.id) + "/watch", { method: "POST", body: {} }).catch(function () {});
  }
  function paintWatchContext(s) {
    var host = $("mnLiveContext");
    if (!host) return;
    var out = [];
    if (s.mission) {
      out.push('<section class="mn__live-object mn__live-object--mission"><span>Live mission</span><b>' + esc(s.mission.title) + '</b>' +
        (s.mission.description ? '<p>' + esc(s.mission.description) + '</p>' : '') +
        '<button class="mn__primary" type="button" id="mnLiveTakeMission">Take this mission</button></section>');
    }
    if (s.music) {
      out.push('<a class="mn__live-object mn__live-object--music" href="' + esc(s.music.canonical_url) + '">' +
        '<span>Now playing</span><b>' + esc(s.music.track_title) + '</b><p>' + esc(s.music.artist_name + (s.music.album_title ? " · " + s.music.album_title : "")) + '</p>' +
        '<em>Open song →</em></a>');
    }
    if (s.room) {
      out.push('<p class="mn__live-roomline">' + esc((s.room_kind === "mission" ? "Mission room" : "Home room") + " · " + (s.category_key || "live") + " · up to " + Number(s.seat_limit || 1) + " stage seats") + '</p>');
    }
    host.innerHTML = out.join("");
    var take = $("mnLiveTakeMission");
    if (take) take.onclick = function () {
      if (M.openMissionFromLive) M.openMissionFromLive(s.id, s.mission.id);
      closeWatch();
      if ($("mnLiveWatch").open) $("mnLiveWatch").close();
    };
  }
  function openWatch(id) {
    var s = live.list.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    closeWatch();
    watch.session = s;
    watch.seen = {};
    $("mnLiveWatchTitle").textContent = s.title;
    $("mnLiveHost").textContent = personName(s.host) + (s.host && s.host.mccluster_id ? " · @" + s.host.mccluster_id : "");
    $("mnLiveChat").innerHTML = "";
    paintWatchContext(s);
    $("mnLiveNote").hidden = false;
    $("mnLiveNote").textContent = "Connecting…";
    say($("mnLiveWatchStatus"), "");
    $("mnLiveChatForm").hidden = !s.post_id;
    if (!$("mnLiveWatch").open) $("mnLiveWatch").showModal();
    track("live_watch", { session: s.id, room_kind: s.room_kind, category: s.category_key, mission: s.action_mission_id || null, song: s.music_object_id || null });
    M.sbRpc("eu_is_admin").then(function (yes) { $("mnLiveKill").hidden = yes !== true; }).catch(function () { $("mnLiveKill").hidden = true; });

    viewerHeartbeat();
    watch.presenceTimer = setInterval(viewerHeartbeat, 30000);

    var pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" }), media = new MediaStream();
    watch.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = function (e) {
      media.addTrack(e.track);
      $("mnLiveVideo").srcObject = media;
      $("mnLiveNote").hidden = true;
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        $("mnLiveNote").hidden = false;
        $("mnLiveNote").textContent = "The broadcast ended or the connection dropped.";
      }
    };
    negotiate(pc, s.whep_url).then(function (loc) {
      watch.sessionUrl = loc;
    }).catch(function (e) {
      $("mnLiveNote").hidden = false;
      $("mnLiveNote").textContent = e.message === "not-live" ? "This broadcast hasn't started yet, or it just ended." : "Could not connect to the broadcast.";
    });
    if (s.post_id) {
      loadChat();
      watch.chatTimer = setInterval(loadChat, 4000);
    }
  }
  function closeWatch() {
    clearInterval(watch.chatTimer); watch.chatTimer = 0;
    clearInterval(watch.presenceTimer); watch.presenceTimer = 0;
    hangUp(watch.pc, watch.sessionUrl);
    watch.pc = null; watch.sessionUrl = null; watch.session = null;
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
        li.innerHTML = '<b>' + esc(actor.display_name || actor.mccluster_id || "Someone") + '</b> ' + esc(post.body || "");
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
      .then(function () {
        say($("mnLiveWatchStatus"), "Broadcast ended.", "ok");
        closeWatch(); loadLive();
      }).catch(function (e) { say($("mnLiveWatchStatus"), e.message || "Could not end it.", "error"); });
  }

  /* ---------- governed studio ---------- */
  function option(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (selected ? " selected" : "") + '>' + esc(label) + '</option>';
  }
  function selectedRoom() {
    var id = $("mnStudioRoom").value;
    return ((studio.options && studio.options.rooms) || []).filter(function (r) { return r.id === id; })[0] || null;
  }
  function paintStudioOptions() {
    var o = studio.options || {}, e = o.eligibility || {}, rooms = o.rooms || [];
    studio.options = o;
    live.can = !!e.can_host; live.enabled = !!e.enabled;
    $("mnGoLive").hidden = !live.can;

    $("mnStudioAccess").innerHTML = e.can_host
      ? '<b>Live access active.</b> ' + esc(e.basis === "owner" ? "Owner desk" : "Program host") + ' · ' + esc((e.allowed_categories || []).join(" · ")) + ' · up to ' + esc(e.max_stage_seats || 1) + ' modeled stage seats.'
      : '<b>No live host grant.</b> Cohort, client-project or staff access must be granted by the desk.';

    var roomSelect = $("mnStudioRoom");
    roomSelect.innerHTML = '<option value="">New room…</option>' + rooms.map(function (r) {
      return option(r.id, (r.room_kind === "mission" ? "Mission" : "Home") + " · " + r.title, false);
    }).join("");

    var allowed = new Set(e.allowed_categories || []);
    $("mnStudioCategory").innerHTML = (o.categories || []).filter(function (x) { return allowed.has(x.key); }).map(function (x) {
      return option(x.key, x.label, false);
    }).join("");

    $("mnStudioMission").innerHTML = '<option value="">Choose an open mission…</option>' + (o.missions || []).map(function (m) {
      return option(m.id, m.title, false);
    }).join("");

    $("mnStudioMusic").innerHTML = '<option value="">No song attached</option>' + (o.music || []).map(function (m) {
      return option(m.id, m.artist_name + " — " + m.track_title + " · " + m.album_title, false);
    }).join("");
    syncStudioForm();
  }
  function syncStudioForm() {
    var room = selectedRoom(), existing = !!room, kind = existing ? room.room_kind : $("mnStudioKind").value;
    $("mnStudioNewRoom").hidden = existing;
    $("mnStudioMissionLabel").hidden = existing || kind !== "mission";
    $("mnStudioMission").hidden = existing || kind !== "mission";
    if (room) {
      var context = (room.room_kind === "mission" ? "Mission room" : "Home room") + " · " + room.category_key;
      $("mnStudioStageNote").textContent = context + " · " + Number(room.seat_limit || 1) + " modeled stage seats. Current video transport is host-only; cohost/guest transport is not switched on yet.";
    } else {
      $("mnStudioStageNote").textContent = "Stage roles are host, cohost and guest. Multi-seat video is not switched on yet; this broadcast is host video only.";
    }
  }
  function loadStudioOptions() {
    return M.api("/v1/mnet/live/options").then(function (out) {
      studio.options = out;
      paintStudioOptions();
      return out;
    });
  }
  function openStudio() {
    if (!live.enabled) { w.alert("Live video is not switched on yet."); return; }
    if (!live.can) { w.alert("The desk has not granted this account live host access."); return; }
    say($("mnStudioStatus"), "Loading your rooms…");
    $("mnStudioGo").hidden = false; $("mnStudioEnd").hidden = true; $("mnStudioTopic").disabled = false;
    if (!$("mnStudio").open) $("mnStudio").showModal();
    Promise.all([loadStudioOptions(), preview()]).then(function () {
      say($("mnStudioStatus"), "");
    }).catch(function (e) {
      say($("mnStudioStatus"), e.message || "Could not open the live studio.", "error");
    });
  }
  function preview() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $("mnStudioNote").textContent = "This browser can't use the camera. Try Safari or Chrome on your phone.";
      return Promise.resolve();
    }
    stopTracks();
    return navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: studio.facing, width: { ideal: 1280 }, height: { ideal: 720 } } }).then(function (stream) {
      studio.stream = stream;
      $("mnStudioVideo").srcObject = stream;
      $("mnStudioNote").hidden = true;
      if (studio.pc) {
        var v = stream.getVideoTracks()[0], a = stream.getAudioTracks()[0];
        studio.pc.getSenders().forEach(function (sn) {
          if (sn.track && sn.track.kind === "video" && v) sn.replaceTrack(v);
          if (sn.track && sn.track.kind === "audio" && a) sn.replaceTrack(a);
        });
      }
    }).catch(function () {
      $("mnStudioNote").hidden = false;
      $("mnStudioNote").textContent = "Camera or microphone was blocked. Allow both in your browser settings, then reopen this.";
    });
  }
  function stopTracks() {
    if (studio.stream) studio.stream.getTracks().forEach(function (t) { t.stop(); });
    studio.stream = null;
  }
  function startPayload() {
    var title = $("mnStudioTopic").value.trim(), room = selectedRoom();
    var body = { title: title };
    if (room) {
      body.room_id = room.id;
      return body;
    }
    body.room_title = $("mnStudioRoomTitle").value.trim() || title;
    body.room_kind = $("mnStudioKind").value;
    body.category_key = $("mnStudioCategory").value;
    if (body.room_kind === "mission") body.action_mission_id = $("mnStudioMission").value;
    if ($("mnStudioMusic").value) body.music_object_id = $("mnStudioMusic").value;
    return body;
  }
  function goLive(ev) {
    ev.preventDefault();
    var title = $("mnStudioTopic").value.trim();
    if (!title) { $("mnStudioTopic").focus(); return; }
    if (!studio.stream) { say($("mnStudioStatus"), "Allow your camera first.", "error"); return; }
    var payload = startPayload();
    if (!payload.room_id && !payload.category_key) { say($("mnStudioStatus"), "Choose a live category.", "error"); return; }
    if (!payload.room_id && payload.room_kind === "mission" && !payload.action_mission_id) { say($("mnStudioStatus"), "Choose the mission this room is doing.", "error"); return; }
    var go = $("mnStudioGo"); go.disabled = true; say($("mnStudioStatus"), "Starting…");
    M.api("/v1/mnet/live", { method: "POST", body: payload }).then(function (r) {
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
      track("live_start", { room_kind: studio.session.room_kind, category: studio.session.category_key, mission: studio.session.action_mission_id || null, song: studio.session.music_object_id || null });
      studio.beat = setInterval(function () {
        M.api("/v1/mnet/live/" + encodeURIComponent(studio.session.id) + "/heartbeat", { method: "POST", body: {} }).catch(function () {});
      }, 30000);
      loadLive();
      if (M.refreshFeed) M.refreshFeed();
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
      .then(function () {
        if (!quiet) say($("mnStudioStatus"), "Broadcast ended.", "ok");
        track("live_end", { session: s.id });
        loadLive();
      }).catch(function () {});
  }
  function closeStudio() {
    if (studio.session && !w.confirm("End your broadcast?")) return;
    endBroadcast(true).then(function () {
      stopTracks();
      $("mnStudioVideo").srcObject = null;
      $("mnStudio").close();
    });
  }

  function wire() {
    $("mnLiveTrack").addEventListener("click", function (e) {
      var b = e.target.closest("[data-live]");
      if (b) openWatch(b.getAttribute("data-live"));
    });
    $("mnLiveFilters").addEventListener("click", function (e) {
      var k = e.target.closest("[data-live-kind]"), cat = e.target.closest("[data-live-category]");
      if (k) setFilter(k, "kind");
      if (cat) setFilter(cat, "category");
    });
    $("mnLiveWatchClose").onclick = function () { closeWatch(); $("mnLiveWatch").close(); };
    $("mnLiveWatch").addEventListener("close", closeWatch);
    $("mnLiveChatForm").addEventListener("submit", sendChat);
    $("mnLiveReport").onclick = reportLive;
    $("mnLiveKill").onclick = killLive;
    $("mnGoLive").onclick = openStudio;
    $("mnStudioForm").addEventListener("submit", goLive);
    $("mnStudioRoom").onchange = syncStudioForm;
    $("mnStudioKind").onchange = syncStudioForm;
    $("mnStudioEnd").onclick = function () { endBroadcast(false); };
    $("mnStudioFlip").onclick = function () { studio.facing = studio.facing === "user" ? "environment" : "user"; preview(); };
    $("mnStudioClose").onclick = closeStudio;
    $("mnStudio").addEventListener("cancel", function (e) { e.preventDefault(); closeStudio(); });
    w.addEventListener("pagehide", function () { if (studio.session) endBroadcast(true); });
  }

  function loadEligibility() {
    return M.api("/v1/mnet/live/eligibility").then(function (r) {
      live.can = !!(r && r.can_host);
      live.enabled = !!(r && r.enabled);
      $("mnGoLive").hidden = !live.can;
      return r;
    }).catch(function () {
      live.can = false;
      $("mnGoLive").hidden = true;
      return null;
    });
  }

  w.MCC_LIVE = {
    start: function () {
      M = w.MCC_MNET;
      if (!M || !$("mnLive") || live.started) return;
      live.started = true;
      if (!w.RTCPeerConnection) {
        say($("mnLiveDirectoryStatus"), "This browser cannot play low-latency live video.", "error");
        return;
      }
      wire();
      loadEligibility();
      loadLive();
      live.timer = setInterval(function () { if (!d.hidden) loadLive(); }, 30000);
    },
    refresh: loadLive,
    open: openWatch
  };
})(window, document);
