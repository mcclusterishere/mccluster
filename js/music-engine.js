/* ============================================================
   MCC MUSIC ENGINE — one transport for discovery surfaces.

   A discovery card is not a door to a player. It is a play control.
   This engine owns one Audio element for the page, resolves account-gated
   masters through MCC_GATED, and keeps a compact transport above the global
   app bar. Album rooms may still open for artwork/lyrics/credits, but
   listening never requires navigation.
   ============================================================ */
(function (root) {
  "use strict";

  var doc = root.document;
  var library = null;
  var loading = null;
  var current = null;
  var currentAccess = "";
  var queue = [];
  var audio = new Audio();
  audio.preload = "metadata";
  audio.setAttribute("playsinline", "");
  /* before every play(): tell the device this is music (the playback audio
     session iOS keeps going with the screen locked; js/now-playing.js decides,
     and does nothing in a browser without the API) */
  function audioSession() { if (root.MCC_NOW_PLAYING) root.MCC_NOW_PLAYING.claim(); }
  var previewLimit = 0;
  var startedAt = 0;
  var playbackRequest = 0;
  var accessRefresh = 0;
  var catalogueRequest = 0;
  var CREATOR_TRACKS = {};
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

  function pauseCurrent() {
    catalogueRequest++;
    accessRefresh++;
    var opening = currentAccess === "loading";
    if (opening) { playbackRequest++; currentAccess = "idle"; }
    audio.pause();
    if (opening) paint();
  }

  function esc(x) {
    var d = doc.createElement("i");
    d.textContent = x == null ? "" : String(x);
    return d.innerHTML;
  }
  function key(a, t) {
    return String(a || "").toLowerCase().trim() + "|" + String(t || "").toLowerCase().trim();
  }
  function fmt(sec) {
    sec = Number(sec || 0);
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }
  function trackEvent(name, extra) {
    if (!root.MCC_TRACK) return;
    var base = current ? {
      track: current.title,
      album: current.albumName,
      album_slug: current.albumSlug,
      access_state: currentAccess
    } : {};
    try { root.MCC_TRACK(name, Object.assign(base, extra || {})); } catch (e) {}
  }

  function ensureUI() {
    var existing = doc.getElementById("musicMini");
    if (existing) return existing;

    var p = doc.createElement("aside");
    p.id = "musicMini";
    p.className = "music-mini";
    p.hidden = true;
    p.setAttribute("aria-label", "Now playing");
    p.innerHTML =
      '<div class="music-mini__seek" id="musicMiniSeek"><i><b id="musicMiniFill"></b></i></div>' +
      '<div class="music-mini__row">' +
        '<button type="button" class="music-mini__open" id="musicMiniOpen" aria-label="Open Now Playing">' +
          '<img id="musicMiniArt" class="music-mini__art" alt="">' +
          '<span class="music-mini__meta">' +
            '<b id="musicMiniTitle">Nothing playing</b>' +
            '<span><span id="musicMiniAlbum"></span><em id="musicMiniAccess"></em></span>' +
          '</span>' +
        '</button>' +
        '<span class="music-mini__time" id="musicMiniTime">0:00</span>' +
        '<button type="button" class="music-mini__play" id="musicMiniPlay" aria-label="Play">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>' +
        '</button>' +
      '</div>';
    doc.body.appendChild(p);

    var now = doc.createElement("section");
    now.id = "musicNow";
    now.className = "music-now";
    now.setAttribute("aria-hidden", "true");
    now.setAttribute("aria-label", "Now playing");
    now.innerHTML =
      '<div class="music-now__ambient"><img id="musicNowBackdrop" alt=""></div>' +
      '<div class="music-now__sheet">' +
        '<header class="music-now__head">' +
          '<button type="button" class="music-now__close" id="musicNowClose" aria-label="Close Now Playing">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7"/></svg>' +
          '</button>' +
          '<span>Now Playing</span>' +
          '<a class="music-now__detail" id="musicNowDetail" href="listen.html">Details</a>' +
        '</header>' +
        '<div class="music-now__stage">' +
          '<div class="music-now__artwrap" id="musicNowArtwrap">' +
            '<video id="musicNowFilm" class="music-now__film" muted loop playsinline preload="metadata" aria-hidden="true"></video>' +
            '<img id="musicNowArt" class="music-now__art" alt="">' +
          '</div>' +
          '<div class="music-now__meta">' +
            '<div><h2 id="musicNowTitle">Nothing playing</h2><p id="musicNowArtist"></p></div>' +
            '<em id="musicNowAccess" class="music-now__access"></em>' +
          '</div>' +
          '<button type="button" class="music-now__seek" id="musicNowSeek" aria-label="Seek">' +
            '<i><b id="musicNowFill"></b></i>' +
          '</button>' +
          '<div class="music-now__times"><span id="musicNowT0">0:00</span><span id="musicNowT1">-:--</span></div>' +
          '<div class="music-now__controls">' +
            '<button type="button" id="musicNowPrev" aria-label="Previous track"><svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM19 5v14l-10-7z"/></svg></button>' +
            '<button type="button" class="music-now__play" id="musicNowPlay" aria-label="Play"><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg></button>' +
            '<button type="button" id="musicNowNext" aria-label="Next track"><svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM5 5v14l10-7z"/></svg></button>' +
          '</div>' +
          '<div class="music-now__context">' +
            '<span id="musicNowAlbum"></span>' +
            '<span id="musicNowMode"></span>' +
          '</div>' +
          /* AirPlay where WebKit offers it, shown only while a device is in range (js/now-playing.js; decision D-8) */
          '<div class="music-now__devices">' +
            '<button type="button" class="music-now__airplay" id="musicNowAirplay" aria-label="Play on another device" hidden>' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12h-7"/><path d="M3 10a10 10 0 0 1 8 8"/><path d="M3 14a6 6 0 0 1 4.5 4.5"/><path d="M3 18h.5"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    doc.body.appendChild(now);

    function seekFrom(el, e) {
      if (!audio.duration || !isFinite(audio.duration)) return;
      var r = el.getBoundingClientRect();
      var at = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
      if (previewLimit) at = Math.min(at, previewLimit);
      audio.currentTime = at;
      trackEvent("music_seek", { position_seconds: Math.round(at) });
    }
    doc.getElementById("musicMiniPlay").addEventListener("click", function () {
      if (!current) { if (held) resumeHeld(); return; }
      if (audio.paused) resumeCurrent().catch(function () {});
      else pauseCurrent();
    });
    doc.getElementById("musicMiniOpen").addEventListener("click", function () {
      if (!current && held) { resumeHeld().then(openNow); return; }
      openNow();
    });
    doc.getElementById("musicMiniSeek").addEventListener("click", function (e) { seekFrom(this, e); });
    doc.getElementById("musicNowSeek").addEventListener("click", function (e) { seekFrom(this, e); });
    doc.getElementById("musicNowClose").addEventListener("click", closeNow);
    doc.getElementById("musicNowPlay").addEventListener("click", function () {
      if (!current) return;
      if (audio.paused) resumeCurrent().catch(function () {});
      else pauseCurrent();
    });
    if (root.MCC_NOW_PLAYING && root.MCC_NOW_PLAYING.airplay) root.MCC_NOW_PLAYING.airplay(doc.getElementById("musicNowAirplay"), audio);
    doc.getElementById("musicNowPrev").addEventListener("click", function () { playAdjacent(-1); });
    doc.getElementById("musicNowNext").addEventListener("click", function () { playAdjacent(1); });
    doc.getElementById("musicNowFilm").addEventListener("loadedmetadata", function () { syncNowFilm(true); });
    now.addEventListener("click", function (e) {
      if (e.target === now) closeNow();
    });
    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && now.classList.contains("is-open")) closeNow();
    });
    return p;
  }

  function openNow() {
    if (!current) return;
    var now = doc.getElementById("musicNow");
    if (!now) { ensureUI(); now = doc.getElementById("musicNow"); }
    now.classList.add("is-open");
    now.setAttribute("aria-hidden", "false");
    doc.body.classList.add("music-now-open");
    trackEvent("music_now_open", {});
    paint();
    syncNowFilm(true);
  }

  function closeNow() {
    var now = doc.getElementById("musicNow");
    if (!now) return;
    now.classList.remove("is-open");
    now.setAttribute("aria-hidden", "true");
    doc.body.classList.remove("music-now-open");
    syncNowFilm(false);
  }

  var prefersReducedMotion = !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function syncNowFilm(hard) {
    var film = doc.getElementById("musicNowFilm");
    var wrap = doc.getElementById("musicNowArtwrap");
    var now = doc.getElementById("musicNow");
    if (!film || !wrap || !now) return;
    var active = wrap.classList.contains("has-video") && now.classList.contains("is-open") && !prefersReducedMotion;
    if (!active) {
      try { film.pause(); } catch (e) {}
      return;
    }
    if (film.duration && isFinite(film.duration) && film.duration > 0) {
      var want = audio.currentTime % film.duration;
      var drift = Math.abs((film.currentTime || 0) - want);
      if (hard || drift > 0.55) {
        try { film.currentTime = want; } catch (e2) {}
      }
    }
    if (audio.paused) {
      if (!film.paused) {
        try { film.pause(); } catch (e3) {}
      }
    } else if (film.paused) {
      var p = film.play();
      if (p && p.catch) p.catch(function () {});
    }
  }

  function paintNowVisual(art) {
    var film = doc.getElementById("musicNowFilm");
    var wrap = doc.getElementById("musicNowArtwrap");
    if (!film || !wrap || !current) return;
    var video = current.music_video || current.music_video_url || current.video || current.video_url || "";
    var poster = current.poster || current.poster_url || art || "";
    if (poster) film.poster = poster;

    var hasVideo = !!video && !prefersReducedMotion;
    wrap.classList.toggle("has-video", hasVideo);

    if (!hasVideo) {
      try { film.pause(); } catch (e) {}
      if (film.getAttribute("src")) {
        film.removeAttribute("src");
        try { film.load(); } catch (e2) {}
      }
      return;
    }

    var changed = film.getAttribute("src") !== video;
    if (changed) {
      film.src = video;
      film.muted = true;
      film.loop = true;
      film.playsInline = true;
      film.load();
    }
    syncNowFilm(changed);
  }

  function sameItem(a, b) {
    if (!a || !b) return false;
    if (a.creatorTrackId || b.creatorTrackId) return String(a.creatorTrackId || "") === String(b.creatorTrackId || "");
    return key(a.albumSlug, a.title) === key(b.albumSlug, b.title);
  }

  function playAdjacent(delta) {
    if (!current || !queue.length) return Promise.resolve(null);
    var at = queue.findIndex(function (item) { return sameItem(item, current); });
    if (at < 0) at = 0;
    var next = queue[(at + delta + queue.length) % queue.length];
    if (!next) return Promise.resolve(null);
    if (next.creatorTrackId) return openCreatorTrack(next.creatorTrackId, true);
    return openTrack(next.albumSlug, next.title, true);
  }

  function paint() {
    var p = ensureUI();
    if (!current) { if (held) paintHeld(p); else p.hidden = true; return; }
    p.hidden = false;

    var art = current.art || "assets/img/m-mark.png";
    var artist = current.artist || "Matthew McCluster";
    var album = current.albumName || "";
    var accessLabel = currentAccess === "full" ? "Full track" :
      currentAccess === "preview" ? "Preview" : currentAccess === "loading" ? "Opening…" :
      currentAccess === "unavailable" ? "Unavailable" : "";
    var duration = audio.duration && isFinite(audio.duration) ? audio.duration : 0;
    var pct = duration ? Math.min(100, audio.currentTime / duration * 100) : 0;

    doc.getElementById("musicMiniArt").src = art;
    doc.getElementById("musicMiniTitle").textContent = current.title;
    doc.getElementById("musicMiniAlbum").textContent = artist || album;
    // Mission portfolio entry: shared Action globe, scoped to the playing song.
    // Never fabricate a completed-action count; the globe must resolve approved evidence.
    var impactLink = doc.getElementById("musicMiniImpact");
    if (!impactLink) {
      impactLink = doc.createElement("a");
      impactLink.id = "musicMiniImpact";
      impactLink.textContent = "See this song's impact ↗";
      impactLink.style.cssText = "display:inline-block;color:#ef5362;font-size:12px;margin-top:4px";
      var titleNode = doc.getElementById("musicMiniTitle");
      titleNode.parentNode.appendChild(impactLink);
    }
    impactLink.href = "action-globe.html?song=" + encodeURIComponent(current.title || "");

    var access = doc.getElementById("musicMiniAccess");
    access.textContent = accessLabel;
    access.className = "music-mini__access is-" + (currentAccess || "idle");
    doc.getElementById("musicMiniTime").textContent =
      fmt(audio.currentTime) + " / " + (duration ? fmt(duration) : "--:--");
    doc.getElementById("musicMiniFill").style.width = pct + "%";
    doc.getElementById("musicMiniPlay").innerHTML = audio.paused
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>';
    doc.getElementById("musicMiniPlay").setAttribute("aria-label", audio.paused ? "Play" : "Pause");

    var now = doc.getElementById("musicNow");
    if (now) {
      doc.getElementById("musicNowBackdrop").src = art;
      doc.getElementById("musicNowArt").src = art;
      paintNowVisual(art);
      doc.getElementById("musicNowTitle").textContent = current.title;
      doc.getElementById("musicNowArtist").textContent = artist;
      doc.getElementById("musicNowAlbum").textContent = album || (current.creatorTrackId ? "Community release" : "");
      doc.getElementById("musicNowMode").textContent =
        currentAccess === "preview" ? "Preview access" :
        currentAccess === "full" ? "Full playback" : accessLabel;
      var nAccess = doc.getElementById("musicNowAccess");
      nAccess.textContent = accessLabel;
      nAccess.className = "music-now__access is-" + (currentAccess || "idle");
      doc.getElementById("musicNowFill").style.width = pct + "%";
      doc.getElementById("musicNowT0").textContent = fmt(audio.currentTime);
      doc.getElementById("musicNowT1").textContent = duration ? "-" + fmt(Math.max(0, duration - audio.currentTime)) : "-:--";
      doc.getElementById("musicNowPlay").innerHTML = audio.paused
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>';
      doc.getElementById("musicNowPlay").setAttribute("aria-label", audio.paused ? "Play" : "Pause");
      var detail = doc.getElementById("musicNowDetail");
      if (current.creatorTrackId && current.handle) {
        detail.href = "music-creator.html?handle=" + encodeURIComponent(current.handle);
        detail.textContent = "Creator";
      } else if (current.albumSlug) {
        detail.href = "album.html?album=" + encodeURIComponent(current.albumSlug) + "&t=" + encodeURIComponent(current.title);
        detail.textContent = "Album";
      } else {
        detail.href = "listen.html";
        detail.textContent = "Music";
      }
    }

    doc.querySelectorAll("[data-music-play]").forEach(function (b) {
      var creatorId = b.getAttribute("data-creator-track");
      var same = creatorId
        ? current && String(current.creatorTrackId || "") === String(creatorId)
        : current && key(b.getAttribute("data-album"), b.getAttribute("data-track")) === key(current.albumSlug, current.title);
      b.classList.toggle("is-playing", same && !audio.paused);
      b.setAttribute("aria-pressed", same && !audio.paused ? "true" : "false");
    });
    root.dispatchEvent(new CustomEvent("mcc:music-state", {detail:{title:current.title, access:currentAccess, playing:!audio.paused}}));
  }

  function announceSelection() {
    root.dispatchEvent(new CustomEvent("mcc:music-selected", { detail: { title: current && current.title } }));
  }

  function resumeCurrent() {
    if (!current) return Promise.resolve(null);
    // While an access request is pending the element can still contain the
    // previous source. Repeated Play must not start that stale cached source.
    if (currentAccess === "loading") return Promise.resolve({state:"loading"});
    if (currentAccess !== "full" && currentAccess !== "preview") {
      return current.creatorTrackId ? openCreatorTrack(current.creatorTrackId, true) : openTrack(current.albumSlug, current.title, true);
    }
    audioSession();
    return audio.play();
  }

  function loadLibrary() {
    if (library) return Promise.resolve(library);
    if (loading) return loading;
    loading = fetch("data/albums.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("catalogue " + r.status); return r.json(); })
      .then(function (data) {
        var by = {};
        var ordered = [];
        (data.albums || []).forEach(function (a) {
          (a.tracks || []).forEach(function (t) {
            var item = Object.assign({}, t, {
              albumSlug: a.slug,
              albumName: a.name,
              /* the album's billed artist; `by` is its tagline ("Have no fear."), never a name */
              artist: a.artist || "Matthew McCluster",
              art: a.art
            });
            by[key(a.slug, t.title)] = item;
            ordered.push(item);
          });
        });
        library = by;
        queue = ordered.concat(queue.filter(function (item) { return item.creatorTrackId; }));
        return by;
      });
    return loading;
  }

  function gateReady() {
    if (root.MCC_GATED) return Promise.resolve(root.MCC_GATED);
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        root.removeEventListener("mcc:gated-ready", finish);
        resolve(root.MCC_GATED || null);
      }
      root.addEventListener("mcc:gated-ready", finish);
      root.setTimeout(finish, 1800);
    });
  }

  /* A gated record is earned (js/gated-audio.js): locked or signed-out
     listeners get the preview, and an earned play is only spent when the
     listener actually opens the track. `peek` repaints without spending. */
  function sourceFor(t, peek, stillCurrent) {
    if (t.creatorTrackId) return creatorSourceFor(t);
    if (!t.gated) return Promise.resolve({ state: "full", url: t.src });
    return gateReady().then(function (g) {
      if (stillCurrent && !stillCurrent()) return { state: "superseded" };
      if (!g) return { state: "preview", url: t.src, reason: "auth-loading" };
      return g.resolve(t.gated).then(function (out) {
        /* Resolving eligibility is not permission to spend a play after the
           listener has already chosen something else. */
        if (stillCurrent && !stillCurrent()) return { state: "superseded" };
        if (out.state === "earned" && !peek) {
          return g.claim(t.gated).then(function (c) {
            return c.state === "full"
              ? { state: "full", url: c.url, granted: true }
              : { state: "preview", url: t.src, reason: c.state };
          });
        }
        if (out.state === "preview" || out.state === "locked" || out.state === "earned") {
          return { state: "preview", url: t.src, reason: out.state };
        }
        return out;
      });
    });
  }


  function sessionToken() {
    try {
      var ss = root.MCC && root.MCC.session && root.MCC.session();
      return ss && ss.access_token ? ss.access_token : "";
    } catch (e) { return ""; }
  }

  function publicObject(bucket, path) {
    if (!bucket || !path) return "";
    return SB_URL + "/storage/v1/object/public/" + encodeURIComponent(bucket) + "/" +
      String(path).split("/").map(encodeURIComponent).join("/");
  }

  function creatorSourceFor(t) {
    var preview = t.previewUrl || publicObject(t.preview_bucket, t.preview_path) || t.audio_url || "";
    var token = sessionToken();
    if (!token) {
      if (t.access_mode === "public" && preview) {
        return Promise.resolve({ state: "full", url: preview });
      }
      return Promise.resolve(preview
        ? { state: "preview", url: preview, reason: "account" }
        : { state: "unavailable", reason: "preview-missing" });
    }
    /* the shared auth's token for this call, renewed first and asked again once after a 401 (js/mcc-auth.js
       authFetch): the stored one, an hour old, turned a member's full track into a preview (music slice M4) */
    var init = {
      method: "POST",
      headers: { apikey: SB_KEY, "content-type": "application/json" },
      body: JSON.stringify({ action: "stream", track_id: t.creatorTrackId })
    };
    var call = root.MCC && root.MCC.authFetch
      ? root.MCC.authFetch(SB_URL + "/functions/v1/music-access", init)
      : fetch(SB_URL + "/functions/v1/music-access", Object.assign(init, { headers: { apikey: SB_KEY, authorization: "Bearer " + token, "content-type": "application/json" } }));
    return call.then(function (r) {
      if (r.ok) return r.json().then(function (d) {
        return d && d.url ? { state: "full", url: d.url } : { state: "unavailable", reason: "no-url" };
      });
      if (r.status === 402) return preview
        ? { state: "preview", url: preview, reason: "purchase" }
        : { state: "unavailable", reason: "purchase" };
      if (r.status === 401 || r.status === 403) return preview
        ? { state: "preview", url: preview, reason: "account" }
        : { state: "unavailable", reason: "account" };
      return { state: "unavailable", reason: "http-" + r.status };
    }).catch(function () {
      return preview ? { state: "preview", url: preview, reason: "network" } : { state: "unavailable", reason: "network" };
    });
  }

  function registerCreatorTrack(t) {
    if (!t || !t.id) return;
    CREATOR_TRACKS[String(t.id)] = Object.assign({}, t, {
      creatorTrackId: String(t.id),
      albumSlug: "creator:" + String(t.id),
      albumName: t.release_name || "Community",
      artist: t.artist || t.artist_name || "Independent creator",
      art: t.poster_url || t.avatar_url || "assets/img/m-mark.png",
      poster: t.poster_url || t.avatar_url || "assets/img/m-mark.png",
      music_video: t.music_video_url || t.video_url || t.music_video || t.video || "",
      title: t.title || "Untitled"
    });
    var item = CREATOR_TRACKS[String(t.id)];
    if (!queue.some(function (q) { return sameItem(q, item); })) queue.push(item);
  }

  function openCreatorTrack(id, force) {
    var t = CREATOR_TRACKS[String(id)] || null;
    if (!t) return Promise.reject(new Error("Creator track not registered"));
    catalogueRequest++;
    var same = current && current.creatorTrackId === t.creatorTrackId;
    if (same && !force && currentAccess === "loading") return Promise.resolve({state:"loading"});
    if (same && !force && (currentAccess === "full" || currentAccess === "preview")) {
      if (audio.paused) { audioSession(); return audio.play().then(function () { return { state: currentAccess }; }); }
      pauseCurrent();
      return Promise.resolve({ state: currentAccess });
    }
    var request = ++playbackRequest;
    audio.pause();
    held = null; resumeAt = null;
    current = t;
    currentAccess = "loading";
    announceSelection();
    previewLimit = t.preview_seconds == null ? 30 : Number(t.preview_seconds);
    paint();
    return creatorSourceFor(t).then(function (out) {
      if (request !== playbackRequest) return {state:"superseded"};
      if (out.state !== "full" && out.state !== "preview") {
        currentAccess = "unavailable";
        paint();
        throw new Error(out.reason || "Track unavailable");
      }
      currentAccess = out.state;
      previewLimit = out.state === "preview" ? (t.preview_seconds == null ? 30 : Number(t.preview_seconds)) : 0;
      dropListen();
      audio.src = out.url;
      audio.currentTime = 0;
      startedAt = Date.now();
      setMedia(t);
      paint();
      trackEvent("music_play", { source: "creator_discovery", creator_track_id: t.creatorTrackId, access_state: out.state });
      trackEvent(out.state === "full" ? "music_full_play" : "music_preview_play",
        { source: "creator_discovery", creator_track_id: t.creatorTrackId });
      audioSession();
      return audio.play().then(function () { return out; }).catch(function () { return out; });
    }).catch(function (err) {
      if (request === playbackRequest) { currentAccess = "unavailable"; paint(); }
      throw err;
    });
  }

  /* THE LOCK SCREEN. One owner speaks to the device's Now Playing for every player
     (js/now-playing.js): this engine says what is playing and what play, pause,
     previous, next and seek mean here; the owner writes the title, the artist, the
     cover at its true size and type, playbackState and the position. Previous and
     next on the lock screen move this queue (decision D-4: no 15-second skips). */
  var nowPlaying = null;
  function bindNowPlaying() {
    if (nowPlaying || !root.MCC_NOW_PLAYING || !root.MCC_NOW_PLAYING.bind) return nowPlaying;
    nowPlaying = root.MCC_NOW_PLAYING.bind(audio, {
      surface: "listen",
      track: function () {
        return current ? { title: current.title, artist: current.artist || "Matthew McCluster", album: current.albumName || "", art: current.art } : null;
      },
      play: function () { return resumeCurrent(); },
      pause: pauseCurrent,
      previous: function () { return playAdjacent(-1); },
      next: function () { return playAdjacent(1); },
      seek: function (t) { audio.currentTime = previewLimit ? Math.min(t, previewLimit) : t; }
    });
    return nowPlaying;
  }
  function setMedia() {
    var h = bindNowPlaying();
    if (h) h.update();
  }

  function openTrack(albumSlug, title, force) {
    var request;
    var lookup = ++catalogueRequest;
    return loadLibrary().then(function (by) {
      /* The first catalogue read can outlive a newer creator selection or
         Pause. Once opened, playbackRequest owns the source so another tap
         on the same loading song does not cancel its only request. */
      if (lookup !== catalogueRequest) return {state:"superseded"};
      var t = by[key(albumSlug, title)];
      if (!t) throw new Error("Track not found");

      var same = current && key(current.albumSlug, current.title) === key(t.albumSlug, t.title);
      /* a spent play is not resumed: opening it again asks for a new one */
      if (same && !force && currentAccess === "loading") return {state:"loading"};
      if (same && !force && (currentAccess === "full" || currentAccess === "preview")) {
        if (audio.paused) { audioSession(); return audio.play().then(function () { return { state: currentAccess }; }); }
        pauseCurrent();
        return { state: currentAccess };
      }

      request = ++playbackRequest;
      audio.pause();
      var startAt = resumeAt && sameItem(resumeAt.item, t) ? resumeAt.at : 0;
      resumeAt = null; held = null;
      current = t;
      currentAccess = "loading";
      announceSelection();
      previewLimit = 0;
      paint();

      return sourceFor(t, false, function () { return request === playbackRequest && current === t; }).then(function (out) {
        if (request !== playbackRequest) return {state:"superseded"};
        if (out.state !== "full" && out.state !== "preview") {
          currentAccess = "unavailable";
          paint();
          throw new Error(out.reason || "Track unavailable");
        }
        currentAccess = out.state;
        previewLimit = out.state === "preview" && t.gated ? Number(t.gated.preview_seconds || 0) : 0;
        dropListen();
        grantMax = 0;
        audio.src = out.url;
        /* a record picked up from where it was left starts at that second (before metadata, this is
           the element's start position); anything else from the top */
        audio.currentTime = out.state === "full" && startAt > 0 ? startAt : 0;
        startedAt = Date.now();
        setMedia(t);
        paint();
        trackEvent("music_play", { source: "discovery", access_state: out.state });
        trackEvent(out.state === "full" ? "music_full_play" : "music_preview_play", { source: "discovery" });
        audioSession();
        return audio.play().then(function () { return out; }).catch(function () { return out; });
      });
    }).catch(function (err) {
      if (request === undefined ? lookup !== catalogueRequest : request !== playbackRequest) throw err;
      var p = ensureUI();
      p.hidden = false;
      currentAccess = "unavailable";
      paint();
      var a = doc.getElementById("musicMiniAccess");
      if (a) a.textContent = "Unavailable";
      throw err;
    });
  }

  function upgradeCurrent() {
    if (!current || !current.gated) return;
    /* the one earned play keeps playing whatever changes around it */
    if (currentAccess === "full" || currentAccess === "spent" || currentAccess === "loading") return;
    var item = current, access = currentAccess;
    var request = playbackRequest, refresh = ++accessRefresh;
    function stillCurrent() {
      return request === playbackRequest && refresh === accessRefresh && current === item;
    }
    return sourceFor(item, true, stillCurrent).then(function (out) {
      /* Access can answer after the next song, or after Pause. Neither this
         reply nor its later metadata event may take the transport back. */
      if (!stillCurrent() || currentAccess !== access) return;
      if (!out || (out.state !== "full" && out.state !== "preview")) return;
      if (out.state === currentAccess) return;
      var wasPlaying = !audio.paused, at = audio.currentTime || 0;
      currentAccess = out.state;
      previewLimit = out.state === "preview" ? Number(item.gated.preview_seconds || 0) : 0;
      audio.addEventListener("loadedmetadata", function once() {
        audio.removeEventListener("loadedmetadata", once);
        if (!stillCurrent()) return;
        try { audio.currentTime = Math.min(at, Math.max(0, audio.duration - .25)); } catch (e) {}
        if (wasPlaying) { audioSession(); audio.play().catch(function () {}); }
      });
      audio.src = out.url;
      trackEvent("music_access_changed", { access_state: out.state });
      paint();
    }).catch(function () { /* a failed refresh leaves the current source alone */ });
  }

  /* THE LISTEN LEDGER. A song heard from the top is timed by the API;
     the gated record never counts toward itself. */
  var listen = null, grantMax = 0;
  function enginePlaying() { return !audio.paused; }
  function countStart() {
    if (!current || current.gated || current.creatorTrackId || !root.MCC_LISTENS) return;
    if (listen && listen.item === current) return;
    var key = root.MCC_LISTENS.keyOf(current);
    var h = audio.currentTime > 3
      ? root.MCC_LISTENS.adopt(key, enginePlaying)
      : root.MCC_LISTENS.start(key, enginePlaying);
    listen = h ? { item: current, handle: h } : null;
  }
  function dropListen() {
    if (listen && root.MCC_LISTENS) root.MCC_LISTENS.release(listen.handle);
    listen = null;
  }
  function granted() { return current && current.gated && currentAccess === "full"; }
  audio.addEventListener("play", function () { countStart(); paint(); syncNowFilm(false); });
  audio.addEventListener("seeking", function () {
    if (granted() && audio.currentTime < grantMax - 0.75) audio.currentTime = grantMax;
  });
  audio.addEventListener("pause", function () { paint(); syncNowFilm(false); });
  audio.addEventListener("loadedmetadata", function () { paint(); syncNowFilm(true); });
  /* Playback quality telemetry: media-clock deltas rather than Date.now() alone.
     Session-scoped pseudonymous ID; never store face or camera data. Events
     are best effort, and the server must deduplicate and validate them. */
  var quality = null;
  function qualityId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(36).slice(2);
  }
  function qualityStart() {
    if (!current) return;
    if (quality && quality.item === current && !quality.closed) return;
    quality = { id: qualityId(), item: current, last: audio.currentTime || 0,
      listened: 0, buckets: {}, lastSent: 0, closed: false, seeks: 0 };
    qualityEvent("music_listen_start", {position_seconds:quality.last});
  }
  function qualityEvent(name, extra) {
    if (!quality || !current) return;
    trackEvent(name, Object.assign({
      playback_id:quality.id, position_seconds:Math.round((audio.currentTime||0)*10)/10,
      duration_seconds:isFinite(audio.duration)?Math.round(audio.duration*10)/10:null,
      listened_seconds:Math.round(quality.listened*10)/10,
      preview:!!previewLimit, creator_track_id:current.creatorTrackId||undefined
    },extra||{}));
  }
  function qualityTick() {
    if (!quality || quality.closed || audio.paused || audio.seeking ||
        doc.visibilityState === "hidden" || !current) return;
    var now=audio.currentTime||0, delta=now-quality.last;
    /* Discard seeks, jumps and large background gaps. */
    if (delta>0 && delta<=2.5) {
      quality.listened+=delta;
      var first=Math.floor(quality.last/5), last=Math.floor(now/5);
      for(var b=first;b<=last;b++) quality.buckets[b]=1;
    }
    quality.last=now;
    if (quality.listened-quality.lastSent>=10) {
      quality.lastSent=quality.listened;
      qualityEvent("music_listen_checkpoint", {covered_buckets:Object.keys(quality.buckets).map(Number)});
    }
  }
  function qualityFinish(reason) {
    if (!quality || quality.closed) return;
    qualityTick();
    quality.closed=true;
    qualityEvent("music_listen_end", {reason:reason,seek_count:quality.seeks,
      covered_buckets:Object.keys(quality.buckets).map(Number)});
  }
  audio.addEventListener("play", function(){qualityStart();if(quality)quality.last=audio.currentTime||0;});
  audio.addEventListener("timeupdate", qualityTick);
  audio.addEventListener("pause", function(){qualityFinish("pause");});
  audio.addEventListener("playing", function(){qualityStart();if(quality)quality.last=audio.currentTime||0;});
  audio.addEventListener("seeking", function(){if(quality){quality.seeks++;quality.last=audio.currentTime||0;}});
  audio.addEventListener("seeked", function(){if(quality)quality.last=audio.currentTime||0;});
  audio.addEventListener("ended", function(){qualityFinish("complete");});
  audio.addEventListener("waiting", function(){qualityFinish("buffering");});
  doc.addEventListener("visibilitychange",function(){if(quality)quality.last=audio.currentTime||0;});
  root.addEventListener("pagehide",function(){qualityFinish("pagehide");});
  /* Present the membership invitation over the actual player when a public
     preview expires. This is a conversion surface, not an auth entitlement. */
  var previewInvitationShown = false;
  function showPreviewInvitation() {
    if (previewInvitationShown || !current) return;
    previewInvitationShown = true;
    var now = doc.getElementById("musicNow");
    if (!now) return;
    var stage = now.querySelector(".music-now__stage") || now;
    var overlay = doc.createElement("div");
    overlay.id = "mnetPreviewInvitation";
    overlay.setAttribute("role", "status");
    overlay.style.cssText = "position:absolute;inset:0;z-index:30;background:rgba(0,0,0,.93);display:flex;flex-direction:column;justify-content:center;align-items:center;gap:16px;padding:24px;text-align:center;color:#fff;";
    var heading = doc.createElement("strong");
    heading.textContent = "Preview finished";
    heading.style.cssText = "font-size:clamp(22px,5vw,32px)";
    var message = doc.createElement("p");
    message.textContent = "Want to hear the whole song? Membership is by application.";
    var link = doc.createElement("a");
    var params = new URLSearchParams({source:"music_preview",track:current.title || "",album:current.albumSlug || ""});
    link.href = (root.MCC_ROOT || "/") + "apply.html?" + params.toString();
    link.textContent = "Apply for Access";
    link.style.cssText = "display:inline-block;padding:14px 24px;border-radius:30px;background:#fff;color:#111;font-weight:700;text-decoration:none";
    link.addEventListener("click", function () { trackEvent("application_start", {source:"music_preview"}); });
    overlay.appendChild(heading);overlay.appendChild(message);overlay.appendChild(link);
    stage.style.position = "relative";
    stage.appendChild(overlay);
    trackEvent("music_preview_cta_view", {source:"music_preview"});
  }
  function clearPreviewInvitation() {
    previewInvitationShown = false;
    var overlay = doc.getElementById("mnetPreviewInvitation");
    if (overlay) overlay.remove();
  }
  audio.addEventListener("play", clearPreviewInvitation);
  audio.addEventListener("timeupdate", function () {
    if (granted()) grantMax = Math.max(grantMax, audio.currentTime);
    if (previewLimit && audio.currentTime >= previewLimit) {
      audio.pause();
      audio.currentTime = Math.max(0, previewLimit - .05);
      trackEvent("music_preview_complete", { preview_seconds: previewLimit });
      showPreviewInvitation();
    }
    paint();
    syncNowFilm(false);
  });
  audio.addEventListener("ended", function () {
    if (listen && listen.item === current && root.MCC_LISTENS) root.MCC_LISTENS.finish(listen.handle);
    listen = null;
    if (granted()) {
      currentAccess = "spent";
      if (root.MCC_GATED) root.MCC_GATED.forget();
    }
    trackEvent("music_complete", { listened_seconds: Math.round((Date.now() - startedAt) / 1000),
      creator_track_id: current && current.creatorTrackId ? current.creatorTrackId : undefined });
    paint();
    if (!previewLimit && queue.length > 1) playAdjacent(1);
  });
  audio.addEventListener("error", function () {
    currentAccess = "unavailable";
    trackEvent("music_error", {});
    paint();
  });

  doc.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-music-play]") : null;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    var creatorId = b.getAttribute("data-creator-track");
    if (creatorId) openCreatorTrack(creatorId).catch(function () {});
    else openTrack(b.getAttribute("data-album"), b.getAttribute("data-track")).catch(function () {});
  }, true);
  doc.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var b = e.target && e.target.closest ? e.target.closest('[data-music-play][role="button"]') : null;
    if (!b) return;
    e.preventDefault();
    b.click();
  });

  /* RESUME WHERE YOU LEFT OFF, ON ANY DEVICE (decision D-8, a default pending Matthew). The record this
     engine plays is banked where the album and the pocket bank theirs (js/pip.js: this device, and for a
     member the one listener_state row every device reads), and a visit with nothing chosen yet holds the
     newest of the two in the mini player, paused at its second: one tap picks it up there. Nothing plays
     by itself, and a held record is not a selection (the World's song still starts from the Globe). A
     creator's release is not banked: its address is signed for one listener and expires. */
  var held = null, resumeAt = null, bankedAt = 0;
  function bank(force) {
    if (!current || current.creatorTrackId || !current.src || !root.MCC_POCKET || !root.MCC_POCKET.save) return;
    var now = Date.now();
    if (!force && now - bankedAt < 2000) return;
    bankedAt = now;
    var film = current.music_video || current.video || "";
    try {
      root.MCC_POCKET.save({
        src: current.src, title: current.title, album: current.albumSlug,
        artist: current.artist || "Matthew McCluster", art: current.art || "",
        music_video: film, video: film, poster: current.poster || "", lyrics: current.lyrics || "",
        t: audio.currentTime || 0, playing: !audio.paused, at: now
      }, !!force);
    } catch (e) {}
  }
  function bankedItem(st) {
    if (!library || !st || !st.title) return null;
    var t = library[key(st.album, st.title)];
    if (t) return t;
    for (var k in library) if (Object.prototype.hasOwnProperty.call(library, k) && library[k].src === st.src) return library[k];
    return null;
  }
  function paintHeld(p) {
    var t = held.item;
    p.hidden = false;
    doc.getElementById("musicMiniArt").src = t.art || "assets/img/m-mark.png";
    doc.getElementById("musicMiniTitle").textContent = t.title;
    doc.getElementById("musicMiniAlbum").textContent = "Pick up at " + fmt(held.at);
    var access = doc.getElementById("musicMiniAccess");
    access.textContent = "";
    access.className = "music-mini__access is-idle";
    doc.getElementById("musicMiniTime").textContent = fmt(held.at) + " / " + (t.seconds ? fmt(t.seconds) : "--:--");
    doc.getElementById("musicMiniFill").style.width = (t.seconds ? Math.min(100, held.at / t.seconds * 100) : 0) + "%";
    doc.getElementById("musicMiniPlay").innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>';
    doc.getElementById("musicMiniPlay").setAttribute("aria-label", "Play " + t.title + " from " + fmt(held.at));
  }
  function resumeHeld() {
    var h = held;
    if (!h) return Promise.resolve(null);
    resumeAt = { item: h.item, at: h.at };
    return openTrack(h.item.albumSlug, h.item.title, true).catch(function () { return null; });
  }
  function restore() {
    if (current || held || !root.MCC_POCKET || !root.MCC_POCKET.read) return;
    var near = null;
    try { near = root.MCC_POCKET.read(); } catch (e) {}
    /* the shared row answers only when it is newer than this device's own (js/pip.js pullRemote); the
       catalogue is read only when there is a record to hold, so a first visit reads nothing more than before */
    var far = root.MCC_POCKET.pull ? root.MCC_POCKET.pull() : null;
    Promise.resolve(far).catch(function () { return null; }).then(function (f) {
      var st = f || near;
      if (!st || !st.title || current || held) return null;
      return loadLibrary().then(function () {
        var t = bankedItem(st);
        if (!t || current || held) return;
        var at = Math.max(0, Number(st.t) || 0);
        held = { item: t, at: t.seconds ? Math.min(at, Math.max(0, t.seconds - 1)) : at };
        paint();
      });
    }).catch(function () {});
  }
  audio.addEventListener("play", function () { bank(true); });
  audio.addEventListener("pause", function () { bank(true); });
  audio.addEventListener("timeupdate", function () { if (!audio.paused) bank(false); });
  doc.addEventListener("visibilitychange", function () { if (doc.visibilityState === "hidden") bank(true); });
  root.addEventListener("pagehide", function () { bank(true); });
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", restore);
  else root.setTimeout(restore, 0);
  bindNowPlaying();

  function hookGate() {
    if (!root.MCC_GATED) return false;
    root.MCC_GATED.onChange(upgradeCurrent);
    return true;
  }
  if (!hookGate()) root.addEventListener("mcc:gated-ready", hookGate, { once: true });

  root.MCC_MUSIC = {
    play: openTrack,
    playCreator: openCreatorTrack,
    registerCreatorTrack: registerCreatorTrack,
    pause: pauseCurrent,
    resume: resumeCurrent,
    next: function () { return playAdjacent(1); },
    previous: function () { return playAdjacent(-1); },
    openNow: openNow,
    closeNow: closeNow,
    audio: audio,
    current: function () { return current; },
    access: function () { return currentAccess; },
    refreshAccess: upgradeCurrent
  };
})(window);
