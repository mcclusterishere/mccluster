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
  var audio = new Audio();
  audio.preload = "metadata";
  audio.setAttribute("playsinline", "");
  var previewLimit = 0;
  var startedAt = 0;
  var CREATOR_TRACKS = {};
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

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
        '<img id="musicMiniArt" class="music-mini__art" alt="">' +
        '<div class="music-mini__meta">' +
          '<b id="musicMiniTitle">Nothing playing</b>' +
          '<span><span id="musicMiniAlbum"></span><em id="musicMiniAccess"></em></span>' +
        '</div>' +
        '<span class="music-mini__time" id="musicMiniTime">0:00</span>' +
        '<button type="button" class="music-mini__play" id="musicMiniPlay" aria-label="Play">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>' +
        '</button>' +
      '</div>';
    doc.body.appendChild(p);

    doc.getElementById("musicMiniPlay").addEventListener("click", function () {
      if (!current) return;
      if (audio.paused) audio.play().catch(function () {});
      else audio.pause();
    });
    doc.getElementById("musicMiniSeek").addEventListener("click", function (e) {
      if (!audio.duration || !isFinite(audio.duration)) return;
      var r = this.getBoundingClientRect();
      var at = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
      if (previewLimit) at = Math.min(at, previewLimit);
      audio.currentTime = at;
      trackEvent("music_seek", { position_seconds: Math.round(at) });
    });
    return p;
  }

  function paint() {
    var p = ensureUI();
    if (!current) { p.hidden = true; return; }
    p.hidden = false;
    doc.getElementById("musicMiniArt").src = current.art || "assets/img/m-mark.png";
    doc.getElementById("musicMiniTitle").textContent = current.title;
    doc.getElementById("musicMiniAlbum").textContent = current.albumName || "";
    var access = doc.getElementById("musicMiniAccess");
    access.textContent = currentAccess === "full" ? "Full track" :
      currentAccess === "preview" ? "Preview" : currentAccess === "loading" ? "Opening…" : "";
    access.className = "music-mini__access is-" + (currentAccess || "idle");
    doc.getElementById("musicMiniTime").textContent =
      fmt(audio.currentTime) + " / " + (audio.duration && isFinite(audio.duration) ? fmt(audio.duration) : "--:--");
    var pct = audio.duration && isFinite(audio.duration) ? Math.min(100, audio.currentTime / audio.duration * 100) : 0;
    doc.getElementById("musicMiniFill").style.width = pct + "%";
    doc.getElementById("musicMiniPlay").innerHTML = audio.paused
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>';
    doc.getElementById("musicMiniPlay").setAttribute("aria-label", audio.paused ? "Play" : "Pause");

    doc.querySelectorAll("[data-music-play]").forEach(function (b) {
      var same = current && key(b.getAttribute("data-album"), b.getAttribute("data-track")) ===
        key(current.albumSlug, current.title);
      b.classList.toggle("is-playing", same && !audio.paused);
      b.setAttribute("aria-pressed", same && !audio.paused ? "true" : "false");
    });
  }

  function loadLibrary() {
    if (library) return Promise.resolve(library);
    if (loading) return loading;
    loading = fetch("data/albums.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("catalogue " + r.status); return r.json(); })
      .then(function (data) {
        var by = {};
        (data.albums || []).forEach(function (a) {
          (a.tracks || []).forEach(function (t) {
            by[key(a.slug, t.title)] = Object.assign({}, t, {
              albumSlug: a.slug,
              albumName: a.name,
              artist: a.artist || a.by || "Matthew McCluster",
              art: a.art
            });
          });
        });
        library = by;
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

  function sourceFor(t) {
    if (t.creatorTrackId) return creatorSourceFor(t);
    if (!t.gated) return Promise.resolve({ state: "full", url: t.src });
    return gateReady().then(function (g) {
      if (!g) return { state: "preview", url: t.src, reason: "auth-loading" };
      return g.resolve(t.gated).then(function (out) {
        if (out.state === "full") return { state: "full", url: out.url };
        if (out.state === "preview") return { state: "preview", url: t.src, reason: out.reason };
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
    return fetch(SB_URL + "/functions/v1/music-access", {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        authorization: "Bearer " + token,
        "content-type": "application/json"
      },
      body: JSON.stringify({ action: "stream", track_id: t.creatorTrackId })
    }).then(function (r) {
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
      title: t.title || "Untitled"
    });
  }

  function openCreatorTrack(id, force) {
    var t = CREATOR_TRACKS[String(id)] || null;
    if (!t) return Promise.reject(new Error("Creator track not registered"));
    var same = current && current.creatorTrackId === t.creatorTrackId;
    if (same && !force) {
      if (audio.paused) return audio.play().then(function () { return { state: currentAccess }; });
      audio.pause();
      return Promise.resolve({ state: currentAccess });
    }
    current = t;
    currentAccess = "loading";
    previewLimit = t.preview_seconds == null ? 30 : Number(t.preview_seconds);
    paint();
    return creatorSourceFor(t).then(function (out) {
      if (out.state !== "full" && out.state !== "preview") {
        currentAccess = "unavailable";
        paint();
        throw new Error(out.reason || "Track unavailable");
      }
      currentAccess = out.state;
      previewLimit = out.state === "preview" ? (t.preview_seconds == null ? 30 : Number(t.preview_seconds)) : 0;
      audio.src = out.url;
      audio.currentTime = 0;
      startedAt = Date.now();
      setMedia(t);
      paint();
      trackEvent("music_play", { source: "creator_discovery", creator_track_id: t.creatorTrackId, access_state: out.state });
      trackEvent(out.state === "full" ? "music_full_play" : "music_preview_play",
        { source: "creator_discovery", creator_track_id: t.creatorTrackId });
      return audio.play().then(function () { return out; }).catch(function () { return out; });
    });
  }

  function setMedia(t) {
    if (!("mediaSession" in navigator) || !root.MediaMetadata) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist || "Matthew McCluster",
        album: t.albumName || "",
        artwork: t.art ? [{ src: t.art }] : []
      });
      navigator.mediaSession.setActionHandler("play", function () { audio.play(); });
      navigator.mediaSession.setActionHandler("pause", function () { audio.pause(); });
      navigator.mediaSession.setActionHandler("seekto", function (d) {
        if (typeof d.seekTime === "number") audio.currentTime = previewLimit ? Math.min(d.seekTime, previewLimit) : d.seekTime;
      });
    } catch (e) {}
  }

  function openTrack(albumSlug, title, force) {
    return loadLibrary().then(function (by) {
      var t = by[key(albumSlug, title)];
      if (!t) throw new Error("Track not found");

      var same = current && key(current.albumSlug, current.title) === key(t.albumSlug, t.title);
      if (same && !force) {
        if (audio.paused) return audio.play().then(function () { return { state: currentAccess }; });
        audio.pause();
        return { state: currentAccess };
      }

      current = t;
      currentAccess = "loading";
      previewLimit = 0;
      paint();

      return sourceFor(t).then(function (out) {
        if (out.state !== "full" && out.state !== "preview") {
          currentAccess = "unavailable";
          paint();
          throw new Error(out.reason || "Track unavailable");
        }
        currentAccess = out.state;
        previewLimit = out.state === "preview" && t.gated ? Number(t.gated.preview_seconds || 0) : 0;
        audio.src = out.url;
        audio.currentTime = 0;
        startedAt = Date.now();
        setMedia(t);
        paint();
        trackEvent("music_play", { source: "discovery", access_state: out.state });
        trackEvent(out.state === "full" ? "music_full_play" : "music_preview_play", { source: "discovery" });
        return audio.play().then(function () { return out; }).catch(function () { return out; });
      });
    }).catch(function (err) {
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
    var wasPlaying = !audio.paused;
    var at = audio.currentTime || 0;
    sourceFor(current).then(function (out) {
      if (!out || (out.state !== "full" && out.state !== "preview")) return;
      if (out.state === currentAccess) return;
      currentAccess = out.state;
      previewLimit = out.state === "preview" ? Number(current.gated.preview_seconds || 0) : 0;
      audio.src = out.url;
      audio.addEventListener("loadedmetadata", function once() {
        audio.removeEventListener("loadedmetadata", once);
        try { audio.currentTime = Math.min(at, Math.max(0, audio.duration - .25)); } catch (e) {}
        if (wasPlaying) audio.play().catch(function () {});
      });
      trackEvent("music_access_changed", { access_state: out.state });
      paint();
    });
  }

  audio.addEventListener("play", paint);
  audio.addEventListener("pause", paint);
  audio.addEventListener("loadedmetadata", paint);
  audio.addEventListener("timeupdate", function () {
    if (previewLimit && audio.currentTime >= previewLimit) {
      audio.pause();
      audio.currentTime = Math.max(0, previewLimit - .05);
      trackEvent("music_preview_complete", { preview_seconds: previewLimit });
    }
    paint();
  });
  audio.addEventListener("ended", function () {
    trackEvent("music_complete", { listened_seconds: Math.round((Date.now() - startedAt) / 1000) });
    paint();
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
    pause: function () { audio.pause(); },
    audio: audio,
    current: function () { return current; },
    access: function () { return currentAccess; },
    refreshAccess: upgradeCurrent
  };
})(window);
