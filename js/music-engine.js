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
  /* IN A VIEW (music slice M5, js/music-shell.js): this document is a music page shown over the one that plays.
     It makes no Audio, no mini player, no Now sheet and no Now Playing, and banks and restores nothing: its
     MCC_MUSIC is a facade over the retained document's engine, and a tap on its play buttons reaches that engine in
     the same call (a gesture in this frame counts for the parent's element in Chromium; WebKit's is a gesture in
     progress, so the call never waits). The resolver, the queue and every access rule are the retained engine's. */
  var VIEW = root.MCC_MUSIC_VIEW;
  if (VIEW && typeof VIEW.engine === "function") { viewMode(VIEW); return; }
  /* A GUEST ON THE ALBUM (music slice M5, stage 2): loaded into album.html by the shell when a view first opens
     over it, so a song chosen in a view has a player. It never offers the album's own banked record, and it banks
     only while it owns the sound (the album's deck owns it otherwise). */
  var GUEST = root.MCC_MUSIC_GUEST || null;
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
  /* DELIVERY (music slice M3): what the listener wants, where the current source came from and when it
     lapses, and a song in trouble on the way (see "DELIVERY" below) */
  /* The tries are timed from the moment the sound stopped, and every one starts inside ten seconds of it: WebKit's
     source keeps an audible page awake for 10 s after its sound stops (WebPageProxy audibleActivityClearDelay) and lets
     a hidden page start its sound again without a tap only within 10 s (MediaElementSession's grace period). What an
     iPhone does is Inferred until Matthew's device row runs. A try still waiting when the next is due gives way to it;
     the last has LAST_TRY_MS before "Connection lost". A song that has been heard and then goes silent for STALL_MS
     with no progress is treated as a dropped read; before the first sound, a read is given FIRST_READ_MS. */
  var RETRY_AT_MS = [500, 1500, 3000, 5500, 8500];
  var LAST_TRY_MS = 3000, LOADING_NOTE_MS = 1500, STALL_MS = 4000, FIRST_READ_MS = 12000;
  var PREFETCH_S = 20, REFRESH_EARLY_MS = 60000, LAPSE_MARGIN_MS = 10000, SHORT_END_S = 2;
  var wantPlay = false, grant = null, trouble = null, notice = null, noticeTimer = 0, prefetched = null;
  /* the page a song was chosen on, when that was a view over this document (music slice M5): its events are filed
     there, as on that page itself (js/analytics.js); a song chosen here, or the queue moving on from one, keeps it */
  var chosenOn = null;
  var refreshTimer = 0, loadingTimer = 0, stallTimer = 0, progressAt = 0, playingFrom = -1, soundHeard = false, lastGate = null;
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

  function pauseCurrent() {
    catalogueRequest++;
    accessRefresh++;
    /* the listener's Pause wins over anything pending: a retry never plays behind it (music slice M3) */
    wantPlay = false;
    quietWatch();
    if (trouble) {
      trouble.timer = cancel(trouble.timer);
      if (trouble.state === "reconnecting") { trouble.state = "lost"; say(lostLine(), { item: current }); }
      else if (trouble.state === "loading") trouble = null;
    }
    var opening = currentAccess === "loading";
    if (opening) { playbackRequest++; currentAccess = "idle"; }
    audio.pause();
    paint();
    troubleChanged();
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
    if (chosenOn) base.mcc_chosen_on = { path: chosenOn.path, handle: chosenOn.handle || "" };
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
            /* what happened to the music, in one short line (a dropped connection, a preview that ended) */
            '<small class="music-mini__note" id="musicMiniNote" hidden></small>' +
          '</span>' +
        '</button>' +
        '<span class="music-mini__time" id="musicMiniTime">0:00</span>' +
        /* the music's own mute, shown only while it is muted (decision D-7: the World's mute is the World's) */
        '<button type="button" class="music-mini__sound" id="musicMiniSound" aria-label="Unmute" hidden>' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>' +
        '</button>' +
        '<button type="button" class="music-mini__play" id="musicMiniPlay" aria-label="Play">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>' +
        '</button>' +
      '</div>' +
      /* the same line, spoken: a live region inside a button is not read out (a button's children are presentational;
         WebKit builds none for it), so the one the screen reader hears sits beside the row, out of sight */
      '<p id="musicMiniLive" role="status" aria-live="polite" style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;' +
        'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0"></p>';
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
          '<p class="music-now__note" id="musicNowNote" hidden></p>' +
          /* AirPlay where WebKit offers it, shown only while a device is in range (js/now-playing.js; decision D-8);
             the music's own unmute, shown only while it is muted (decision D-7) */
          '<div class="music-now__devices">' +
            '<button type="button" class="music-now__sound" id="musicNowSound" hidden>' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>' +
              '<span>Unmute</span>' +
            '</button>' +
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
      at = seekTo(at);
      trackEvent("music_seek", { position_seconds: Math.round(at) });
    }
    doc.getElementById("musicMiniPlay").addEventListener("click", function () {
      if (!current) { if (held) resumeHeld(); return; }
      toggle().catch(function () {});
    });
    doc.getElementById("musicMiniOpen").addEventListener("click", function () {
      if (!current && held) { resumeHeld().then(openNow); return; }
      openNow();
    });
    doc.getElementById("musicMiniSeek").addEventListener("click", function (e) { seekFrom(this, e); });
    doc.getElementById("musicNowSeek").addEventListener("click", function (e) { seekFrom(this, e); });
    doc.getElementById("musicNowClose").addEventListener("click", closeNow);
    doc.getElementById("musicMiniSound").addEventListener("click", function () { unmuteFrom(this, "musicMiniPlay"); });
    doc.getElementById("musicNowSound").addEventListener("click", function () { unmuteFrom(this, "musicNowPlay"); });
    doc.getElementById("musicNowPlay").addEventListener("click", function () {
      if (!current) return;
      toggle().catch(function () {});
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

  /* ONE RECORD AT A TIME (owner, 2026-11-23: "end of the album, and just leave"). Next, Previous, the lock screen and
     the end of a song move within the record that plays: a house album's own songs, or one creator release. After its
     last song the record stops there, paused at the end of that song; it never runs on into the next album or back to
     its first song, and Previous on the first song starts that song again. A held song on the way is passed by (one
     pop-up says why), or the record stops there when it was the last one. */
  function recordOf(item) {
    if (!item) return "";
    if (!item.creatorTrackId) return "a:" + String(item.albumSlug || "");
    /* a creator's song is registered again by each page that lists it (Listen's rail, then its artist page with its
       release): its record is what the latest registration says, for the song that plays and the queue alike */
    var t = CREATOR_TRACKS[String(item.creatorTrackId)] || item;
    return "c:" + String(t.artist || "") + "|" + String(t.albumName || "");
  }
  function recordList(item) {
    var rec = recordOf(item);
    return queue.filter(function (q) { return recordOf(q) === rec; });
  }
  function playAdjacent(delta) {
    if (!current || !queue.length) return Promise.resolve(null);
    return stepFrom(current, delta);
  }
  function stepFrom(item, delta) {
    var list = recordList(item);
    var at = list.findIndex(function (q) { return sameItem(q, item); });
    if (at < 0) at = 0;
    var i = at + delta;
    if (i < 0) { restartCurrent(); return Promise.resolve({ state: currentAccess }); }
    var next = list[i];
    if (!next) { endRecord(); return Promise.resolve({ state: "ended" }); }
    var opened = next.creatorTrackId ? openCreatorTrack(next.creatorTrackId, true, chosenOn) : openTrack(next.albumSlug, next.title, true, chosenOn, true);
    return opened.then(function (out) { return out && out.state === "held" ? stepFrom(next, delta) : out; });
  }
  /* where the song that plays ends for this listener: a locked preview's boundary, or the song's own length. The end
     of a record is the end of what this listener may hear, never a seek past a preview's boundary */
  function hearableEnd() {
    var d = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    return previewLimit ? (d ? Math.min(previewLimit, d) : previewLimit) : d;
  }
  /* the end of the record: paused at the end of its last song, the lock screen and the bar told it stopped */
  function endRecord() {
    if (!current) return;
    wantPlay = false;
    quietWatch();
    if (!audio.paused) audio.pause();
    /* skipped past it: to its end (a hair before it; a seek to the very end lands back on 0:00 in Chromium). A song
       that ended, or a preview stopped at its boundary, is at its end already; Play there starts it again
       (resumeCurrent) */
    try { var end = hearableEnd(); if (!audio.ended && end && end - (audio.currentTime || 0) > 0.25) audio.currentTime = Math.max(0, end - 0.05); } catch (e) {}
    paint();
    setMedia();
  }
  function restartCurrent() {
    if (!current) return;
    try { audio.currentTime = 0; } catch (e) {}
    paint();
    setMedia();
  }

  /* THE BAR'S MIDDLE BUTTON ON THE LISTEN PAGE (music slice M3 follow-up; verification V-3). js/tabbar.js draws the
     Music tab as a play triangle or a pause glyph from mcc:nowplaying, which album.html and js/main.js send, and where
     the tab's page is the one you stand on and gives it MCC_NP_PLAY and MCC_NP_PAUSE, a tap is that page's Play or
     Pause. listen.html is the tab's own page and the engine is its player, and it did neither: the tab kept its
     triangle while a song played, and a tap scrolled to the top. There the engine now says what plays in the album's
     words ({ title, href: "#np", playing }) when that changes (play, pause, the end, another song; a song being picked
     up again is Pause, as on the mini player), and gives the bar the mini player's Play and Pause once a song is
     chosen or held. The other pages that load it say nothing: there the tab opens the shelf, as before. */
  var ON_SHELF = /(?:^|\/)listen\.html$/.test(String(root.location && root.location.pathname || ""));
  var toldBar = null;
  function tellBar(item, playing) {
    if (!ON_SHELF || !item) return;
    if (typeof root.MCC_NP_PLAY !== "function") {
      root.MCC_NP_PLAY = function () { return current ? resumeCurrent() : held ? resumeHeld() : Promise.resolve(null); };
      root.MCC_NP_PAUSE = function () { if (current) pauseCurrent(); };
    }
    if (toldBar && toldBar.title === item.title && toldBar.playing === playing) return;
    toldBar = { title: item.title, playing: playing };
    try { root.dispatchEvent(new CustomEvent("mcc:nowplaying", { detail: { title: item.title, href: "#np", playing: playing } })); } catch (e) {}
  }

  function paint() {
    var p = ensureUI();
    if (!current) { if (held) { paintHeld(p); tellBar(held.item, false); } else p.hidden = true; return; }
    p.hidden = false;

    var art = current.art || "assets/img/m-mark.png";
    var artist = current.artist || "McCluster";
    var album = current.albumName || "";
    var accessLabel = currentAccess === "full" ? "Full track" :
      currentAccess === "preview" ? "Preview" : currentAccess === "loading" ? "Opening…" :
      currentAccess === "unavailable" ? "Unavailable" : currentAccess === "spent" ? "Play ended" : "";
    /* never "playing" over silence: what the delivery is doing comes first, then the music's own mute */
    var heard = currentAccess === "full" || currentAccess === "preview";
    var troubleText = troubleLabel();
    var muted = heard && !!audio.muted;
    if (heard && troubleText) accessLabel = troubleText;
    else if (muted) accessLabel = "Muted";
    var line = noticeLine();
    /* the one button: Pause while the music plays or is being picked up again (Pause stops the tries), else Play */
    var wanted = intendsPlay();
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
    access.className = "music-mini__access is-" + (heard && troubleText ? "trouble" : muted ? "muted" : (currentAccess || "idle"));
    var miniNote = doc.getElementById("musicMiniNote");
    if (miniNote) { miniNote.textContent = line; miniNote.hidden = !line; }
    var live = doc.getElementById("musicMiniLive");
    if (live && live.textContent !== line) live.textContent = line;   // spoken once per change, not on every tick
    var miniSound = doc.getElementById("musicMiniSound");
    if (miniSound) miniSound.hidden = !muted;
    doc.getElementById("musicMiniTime").textContent =
      fmt(audio.currentTime) + " / " + (duration ? fmt(duration) : "--:--");
    doc.getElementById("musicMiniFill").style.width = pct + "%";
    doc.getElementById("musicMiniPlay").innerHTML = !wanted
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>';
    doc.getElementById("musicMiniPlay").setAttribute("aria-label", wanted ? "Pause" : "Play");

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
      nAccess.className = "music-now__access is-" + (heard && troubleText ? "trouble" : muted ? "muted" : (currentAccess || "idle"));
      var nowNote = doc.getElementById("musicNowNote");
      if (nowNote) { nowNote.textContent = line; nowNote.hidden = !line; }
      var nowSound = doc.getElementById("musicNowSound");
      if (nowSound) nowSound.hidden = !muted;
      doc.getElementById("musicNowFill").style.width = pct + "%";
      doc.getElementById("musicNowT0").textContent = fmt(audio.currentTime);
      doc.getElementById("musicNowT1").textContent = duration ? "-" + fmt(Math.max(0, duration - audio.currentTime)) : "-:--";
      doc.getElementById("musicNowPlay").innerHTML = !wanted
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>';
      doc.getElementById("musicNowPlay").setAttribute("aria-label", wanted ? "Pause" : "Play");
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
      b.classList.toggle("is-playing", same && wanted);
      b.setAttribute("aria-pressed", same && wanted ? "true" : "false");
    });
    root.dispatchEvent(new CustomEvent("mcc:music-state", {detail:{title:current.title, access:currentAccess, playing:wanted}}));
    tellBar(current, wanted);
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
    wantPlay = true;
    /* an earned play paused past its time is over: say so (nothing dropped); the next tap claims a new play, never this one */
    if (grant && grant.kind === "gated" && lapsed(grant)) { playEnded("paused"); return Promise.resolve({ state: "spent" }); }
    /* a song that stopped on the way picks up where it stopped, at once, and the tries start again from this tap */
    if (trouble && (trouble.state === "lost" || trouble.state === "reconnecting")) {
      tryAgainNow();
      return Promise.resolve({ state: currentAccess });
    }
    /* a creator's signed URL that lapsed while paused is signed again first, through its own resolver */
    if (grant && grant.kind === "creator" && lapsed(grant)) {
      trouble = { state: "reconnecting", at: Math.max(0, audio.currentTime || 0), attempt: 0, timer: 0, since: now(), heard: true, seq: 0 };
      tryAgainNow();
      return Promise.resolve({ state: currentAccess });
    }
    /* Play on a song stopped at its end (the end of its record, or a preview's boundary) starts that song again */
    try { var end = hearableEnd(); if (end && end - (audio.currentTime || 0) < 0.1) audio.currentTime = 0; } catch (e) {}
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
              artist: a.artist || "McCluster",
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
            if (c.state === "full") return { state: "full", url: c.url, granted: true, expiresIn: Number(c.expires_in) || 0 };
            /* the answer was lost: the play may or may not have been spent. Say so; never claim again by
               itself (music slice M3) */
            if (c.uncertain) say("We could not confirm the play. If it went through, it may already be used. Tap the song to try again.", { item: t });
            return { state: "preview", url: t.src, reason: c.state };
          });
        }
        if (out.state === "preview" || out.state === "locked" || out.state === "earned") {
          lastGate = { item: t, out: out };
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
      /* the signed URL's lifetime comes with it (3600 s today), so it is signed again before it lapses */
      if (r.ok) return r.json().then(function (d) {
        return d && d.url ? { state: "full", url: d.url, expiresIn: Number(d.expires_in) || 0 } : { state: "unavailable", reason: "no-url" };
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
    /* each page that lists a song registers it in that page's order (Listen's rail newest first, the artist page in
       album order): the latest listing is the queue's order too, so Next follows the page that is shown */
    queue = queue.filter(function (q) { return !sameItem(q, item); });
    queue.push(item);
  }

  function openCreatorTrack(id, force, from) {
    var t = CREATOR_TRACKS[String(id)] || null;
    if (!t) return Promise.reject(new Error("Creator track not registered"));
    catalogueRequest++;
    var same = current && current.creatorTrackId === t.creatorTrackId;
    if (same && !force && currentAccess === "loading") return Promise.resolve({state:"loading"});
    if (same && !force && (currentAccess === "full" || currentAccess === "preview")) {
      if (audio.paused) return Promise.resolve(resumeCurrent()).then(function () { return { state: currentAccess }; });
      pauseCurrent();
      return Promise.resolve({ state: currentAccess });
    }
    var request = ++playbackRequest;
    audio.pause();
    held = null; resumeAt = null;
    resetDelivery();
    wantPlay = true;
    current = t;
    chosenOn = from || null;
    currentAccess = "loading";
    announceSelection();
    previewLimit = t.preview_seconds == null ? 30 : Number(t.preview_seconds);
    paint();
    /* signed ahead near the end of the last song (EXT-5): no wait on the network at the change */
    return (takePrefetched(t) || creatorSourceFor(t)).then(function (out) {
      if (request !== playbackRequest) return {state:"superseded"};
      if (out.state !== "full" && out.state !== "preview") {
        currentAccess = "unavailable";
        paint();
        throw new Error(out.reason || "Track unavailable");
      }
      currentAccess = out.state;
      previewLimit = out.state === "preview" ? (t.preview_seconds == null ? 30 : Number(t.preview_seconds)) : 0;
      dropListen();
      takeGrant(t, out, request);
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
        return current ? { title: current.title, artist: current.artist || "McCluster", album: current.albumName || "", art: current.art } : null;
      },
      play: function () { return resumeCurrent(); },
      pause: pauseCurrent,
      previous: function () { return playAdjacent(-1); },
      next: function () { return playAdjacent(1); },
      seek: function (t) { seekTo(t); },
      /* a song being picked up again is quiet while the listener still wants it: the lock screen offers Pause, which
         stops the tries; and the installed app's dock, which hides this mini player, says why it is quiet */
      playing: intendsPlay,
      status: function () { return statusLine(); },
      /* Muted lasts: the dock says it in the song line, in one row, never in the row the trouble words take for the
         seconds they last (the Release 1 dock fix) */
      note: function () { return (currentAccess === "full" || currentAccess === "preview") && audio.muted ? "Muted" : ""; }
    });
    return nowPlaying;
  }
  function setMedia() {
    var h = bindNowPlaying();
    if (h) h.update();
  }

  function openTrack(albumSlug, title, force, from, advance) {
    var request;
    var lookup = ++catalogueRequest;
    return loadLibrary().then(function (by) {
      /* The first catalogue read can outlive a newer creator selection or
         Pause. Once opened, playbackRequest owns the source so another tap
         on the same loading song does not cancel its only request. */
      if (lookup !== catalogueRequest) return {state:"superseded"};
      var t = by[key(albumSlug, title)];
      if (!t) throw new Error("Track not found");
      if (!t.hold) return begin(t);
      /* a held song: nothing changes here until its gate says it is the house owner's own play */
      return heldSong(t, from, advance).then(function (d) {
        if (!d.play) return { state: "held", signedIn: !!d.signedIn };
        if (lookup !== catalogueRequest) return { state: "superseded" };
        return begin(t);
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

    function begin(t) {
      var same = current && key(current.albumSlug, current.title) === key(t.albumSlug, t.title);
      /* a spent play is not resumed: opening it again asks for a new one */
      if (same && !force && currentAccess === "loading") return {state:"loading"};
      if (same && !force && (currentAccess === "full" || currentAccess === "preview")) {
        if (audio.paused) return Promise.resolve(resumeCurrent()).then(function () { return { state: currentAccess }; });
        pauseCurrent();
        return { state: currentAccess };
      }

      request = ++playbackRequest;
      audio.pause();
      var startAt = resumeAt && sameItem(resumeAt.item, t) ? resumeAt.at : 0;
      resumeAt = null; held = null;
      resetDelivery();
      wantPlay = true;
      current = t;
      chosenOn = from || null;
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
        takeGrant(t, out, request);
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
    }
  }

  /* THE CLOSING SONG IS HELD (owner, 2026-11-23: "We keep the song up, but it won't play... it'll tell you why it
     won't play when you try to click play"). A song marked "hold" in data/albums.json stays listed and plays for the
     house owner alone, through its own gate's answer, the play he already had (js/gated-audio.js holdDecision). For
     anyone else nothing is asked for it: no preview, no stream, no listen, nothing on the lock screen, and what was
     playing keeps playing. One pop-up says why: this page shows it, unless the tap came from a music view over it,
     which shows its own (music slice M5). */
  function heldSong(t, from, advance) {
    var no = { play: false, signedIn: false };
    return gateReady().then(function (g) {
      return g && g.holdDecision ? g.holdDecision(t.gated) : no;
    }).then(function (d) { return d || no; }, function () { return no; }).then(function (d) {
      if (!d.play && (advance || !from) && root.MCC_GATED && root.MCC_GATED.holdNotice) root.MCC_GATED.holdNotice({ signedIn: !!d.signedIn });
      return d;
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
      takeGrant(item, out, request);
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
  /* a ledger that arrives after the song started (the music shell loads it into an artist page the first time Listen
     opens over it, SPEC-M5 3.3; review JRN-2): the song playing then is counted from then. Listen loads the ledger
     before the engine, so there this never runs. */
  if (root.addEventListener) root.addEventListener("mcc:listens-ready", function () { if (!audio.paused) countStart(); });
  function granted() { return current && current.gated && currentAccess === "full"; }
  audio.addEventListener("play", function () { countStart(); paint(); syncNowFilm(false); });
  audio.addEventListener("seeking", function () {
    if (granted() && audio.currentTime < grantMax - 0.75) audio.currentTime = grantMax;
  });
  audio.addEventListener("pause", function () { paint(); syncNowFilm(false); });
  audio.addEventListener("loadedmetadata", function () { paint(); syncNowFilm(true); });
  audio.addEventListener("volumechange", function () { paint(); troubleChanged(); });
  audio.addEventListener("timeupdate", function () {
    if (granted()) grantMax = Math.max(grantMax, audio.currentTime);
    if (previewLimit && audio.currentTime >= previewLimit) {
      /* A LOCKED PREVIEW NEVER STOPS THE QUEUE (music slice M3; decision D-11's default). It ends at its
         declared boundary, never past it, and the queue moves on with one short line saying so. */
      var heardPreview = current;
      audio.pause();
      audio.currentTime = Math.max(0, previewLimit - .05);
      trackEvent("music_preview_complete", { preview_seconds: previewLimit });
      if (queue.length > 1 && wantPlay) { say(previewLine(heardPreview), { ms: 9000 }); playAdjacent(1); }
      else say(previewLine(heardPreview), { item: heardPreview });
      return;
    }
    if (!audio.paused && audio.currentTime > progressAt + .25) { progressAt = audio.currentTime; moving(); }
    if (!audio.paused && playingFrom >= 0 && audio.currentTime > playingFrom + .25) soundHeard = true;
    if (trouble && !trouble.state && audio.currentTime > trouble.at + 5) trouble = null;   // played on for a while: recovered
    maybePrefetch();
    paint();
    syncNowFilm(false);
  });
  audio.addEventListener("ended", function () {
    /* a song that "ends" well short of its own length was cut off on the way: not finished (music slice M3) */
    if (endedShort() && deliveryFailed("ended-short")) return;
    if (listen && listen.item === current && root.MCC_LISTENS) root.MCC_LISTENS.finish(listen.handle);
    listen = null;
    if (granted()) {
      currentAccess = "spent";
      if (root.MCC_GATED) root.MCC_GATED.forget();
    }
    trackEvent("music_complete", { listened_seconds: Math.round((Date.now() - startedAt) / 1000),
      creator_track_id: current && current.creatorTrackId ? current.creatorTrackId : undefined });
    var heardPreview = previewLimit ? current : null;
    paint();
    if (heardPreview) say(previewLine(heardPreview), { ms: 9000 });
    if (!heardPreview || wantPlay) playAdjacent(1);
  });
  audio.addEventListener("error", function () {
    /* one error for the whole drop, or for a song that would not load, with the first failed read's code, however
       many reads fail after it and however often Play picks it up: one per failed read put six in the count for one
       listener's one drop (music slice M3 follow-up; review RL-9). The drop is the one deliveryFailed keeps. */
    var told = !!(trouble && trouble.since && trouble.state !== "loading" && trouble.errorTold);
    if (!told) trackEvent("music_error", { code: audio.error ? audio.error.code : 0 });
    /* a song that stops on the way is picked up again where it stopped (DELIVERY, below) */
    if (deliveryFailed("error")) { if (trouble) trouble.errorTold = true; return; }
    if (grant && grant.request !== playbackRequest) return;   // an old source failing under a newer choice
    currentAccess = "unavailable";
    paint();
  });
  audio.addEventListener("waiting", function () {
    if (audio.paused || !current || !wantPlay || !grant) return;
    if (trouble && trouble.state === "reconnecting") return;   // a try in flight has its own deadline
    quietWatch();
    var at = audio.currentTime || 0, item = current, request = playbackRequest, since = now(), heard = heardNow();
    loadingTimer = later(function () {
      loadingTimer = 0;
      if (request !== playbackRequest || current !== item || audio.paused || trouble) return;
      trouble = { state: "loading", at: at, attempt: 0, timer: 0 };
      paint(); troubleChanged();
    }, LOADING_NOTE_MS);
    stallTimer = later(function () {
      stallTimer = 0;
      if (request !== playbackRequest || current !== item || audio.paused) return;
      /* the silence began at the wait: the tries are timed from there (before the first sound, from now) */
      if ((audio.currentTime || 0) <= at + .25) deliveryFailed("stalled", heard ? since : 0);
    }, heard ? STALL_MS : FIRST_READ_MS);
  });
  audio.addEventListener("playing", function () {
    quietWatch();
    playingFrom = audio.currentTime || 0;
    /* a slow read that came is nothing to keep; a song picked up again is watched for a few seconds more */
    if (trouble && trouble.state === "loading") { trouble = null; troubleChanged(); }
    else if (trouble && trouble.state) { trouble.state = ""; trouble.timer = cancel(trouble.timer); say(""); troubleChanged(); }
    paint();
  });

  /* ============================================================
     DELIVERY (music slice M3). Matthew, 2026-11-19: "The music never
     plays fully through." One failed read stopped a song with half a
     minute still buffered, and the listen page kept saying "Pause"
     while nothing played (music map 02, DEL-6 / T6b). Now a song that
     stops on the way:
       - says so, and is never shown playing over silence;
       - is asked for again at the second it stopped, through the
         resolver that opened it (a public file: the same file; a
         creator's release: its signed URL, signed again through
         music-access when it has lapsed; an earned play: the same
         one-play URL while its time holds), a few times with growing
         waits, then stops and says how to pick it up;
       - is never counted as finished, and a song that "ends" short of
         its own length is treated as cut off;
       - loses to the listener: Pause or another song cancels a retry,
         and while it is being picked up the one button is Pause (the
         lock screen too), so the tries can always be stopped;
       - follows a second the listener chooses on the way;
       - tells the truth: a song that never started is not called a
         dropped connection.
     The tries are timed from the moment the sound stopped and all start
     inside ten seconds of it (see RETRY_AT_MS above); a try whose read
     never answers gives way to the next on time, and a try the browser
     refuses to start (a hidden page may need a tap) stops the tries and
     says how to pick the song up.
     An earned play whose time ran out, or whose claim never answered,
     is never claimed again by this file: the listener is told, and a
     new play only ever starts from their tap. A creator's signed URL is
     signed again about a minute before it lapses (the server's own 3600 s
     and entitlement check decide), and near the end of a song the next
     creator release is signed ahead so the next song does not wait on
     the network; a gate's answer is asked ahead too, but a play is
     claimed only when it starts.
     ============================================================ */
  function now() { return Date.now(); }
  function later(fn, ms) { return root.setTimeout(fn, ms); }
  function cancel(timer) { if (timer) root.clearTimeout(timer); return 0; }
  function lapsed(g) { return !!(g && g.expiresAt && now() >= g.expiresAt - LAPSE_MARGIN_MS); }
  function quietWatch() { loadingTimer = cancel(loadingTimer); stallTimer = cancel(stallTimer); }
  function moving() {
    quietWatch();
    if (trouble && trouble.state === "loading") { trouble = null; paint(); troubleChanged(); }
  }
  /* has this song been heard: it moved on after it started playing, or it has metadata and a position past the start */
  function heardNow() { return soundHeard || (audio.readyState >= 1 && (audio.currentTime || 0) > 0); }
  /* what the listener asked for: playing, or a song in trouble being picked up again (the element is quiet then) */
  function intendsPlay() { return !audio.paused || !!(wantPlay && trouble && trouble.state === "reconnecting"); }
  /* the transport's one button (the mini player, the Now sheet): Pause while the music plays or is being picked up
     again, which stops the tries; else Play */
  function toggle() {
    if (!current) return Promise.resolve(null);
    if (intendsPlay()) { pauseCurrent(); return Promise.resolve({ state: currentAccess }); }
    return Promise.resolve(resumeCurrent());
  }
  /* the lock screen and the installed app's dock follow the trouble too (js/now-playing.js) */
  function troubleChanged() { var h = bindNowPlaying(); if (h) h.update(); }
  /* one short line under the title: for the song it names ({ item }) or for a few seconds ({ ms }) */
  function say(text, opts) {
    noticeTimer = cancel(noticeTimer);
    notice = text ? { text: String(text), item: opts && opts.item || null } : null;
    if (notice && opts && opts.ms) noticeTimer = later(function () { noticeTimer = 0; notice = null; paint(); }, opts.ms);
    if (current) paint();
  }
  function noticeLine() {
    if (!notice || (notice.item && notice.item !== current)) return "";
    return notice.text;
  }
  /* what the trouble is called: a song that was heard was cut off on the way; one that never started could not load
     (a missing or unreadable file, or no network at all: the page cannot tell which, so it names neither) */
  function troubleLabel() {
    var st = trouble && trouble.state;
    if (!st) return "";
    if (st === "loading") return "Loading…";
    if (st === "reconnecting") return trouble.heard ? "Reconnecting…" : "Loading…";
    return trouble.heard ? "Connection lost" : "Could not load";
  }
  /* the same, in a few words for a surface with no line of its own (the World's transport, the installed app's dock) */
  function statusLine() { var l = troubleLabel(); return l && trouble.state === "lost" ? l + " · tap play" : l; }
  function reconnectingLine() {
    if (trouble && !trouble.heard) return "This song would not load. Trying again…";
    var at = fmt(trouble ? trouble.at : audio.currentTime);
    return trouble && trouble.moved ? "Picking up at " + at + "…" : "The connection dropped at " + at + ". Picking up there…";
  }
  function lostLine() {
    if (trouble && !trouble.heard) return "This song could not load. Tap play to try again.";
    return "The connection dropped. Tap play to pick up at " + fmt(trouble ? trouble.at : audio.currentTime) + ".";
  }
  /* a second the listener chooses (the seek bars, the lock screen's scrubber) is where the song picks up: during the
     trouble the next try reads from there, or Play does once the tries gave up (the one earned pass never rewinds) */
  function seekTo(t) {
    t = Math.max(0, Number(t) || 0);
    if (previewLimit) t = Math.min(t, previewLimit);
    try { audio.currentTime = t; } catch (e) {}
    if (trouble && (trouble.state === "reconnecting" || trouble.state === "lost")) {
      if (granted() && t < grantMax - 0.75) t = grantMax;
      trouble.at = t; trouble.moved = true;
      say(trouble.state === "lost" ? lostLine() : reconnectingLine(), { item: current });
    }
    return t;
  }
  function previewLine(item) {
    var title = item && item.title ? item.title : "this song";
    var why = "";
    if (lastGate && lastGate.item === item && root.MCC_GATED && root.MCC_GATED.explain) {
      try { var e = root.MCC_GATED.explain(lastGate.out); why = e && e.text ? " " + e.text : ""; } catch (err) {}
    }
    return "That was the preview of " + title + "." + why;
  }
  function resetDelivery() {
    quietWatch();
    if (trouble) trouble.timer = cancel(trouble.timer);
    trouble = null; grant = null; progressAt = 0; playingFrom = -1; soundHeard = false;
    refreshTimer = cancel(refreshTimer);
    if (notice && notice.item) say("");
  }
  function takeGrant(item, out, request) {
    var life = Number(out && out.expiresIn) || 0;
    var kind = out.state === "full" && item.creatorTrackId ? "creator" : out.state === "full" && item.gated ? "gated" : "public";
    grant = { url: out.url, kind: kind, expiresAt: life > 0 ? now() + life * 1000 : 0, next: null, request: request, item: item };
    refreshTimer = cancel(refreshTimer);
    if (kind === "creator" && grant.expiresAt) scheduleRefresh(grant);
  }
  function scheduleRefresh(g) {
    var lapses = g.next && g.next.expiresAt ? g.next.expiresAt : g.expiresAt;
    refreshTimer = cancel(refreshTimer);
    refreshTimer = later(function () { refreshTimer = 0; refreshCreator(g); }, Math.max(0, lapses - REFRESH_EARLY_MS - now()));
  }
  function refreshCreator(g) {
    if (grant !== g || current !== g.item) return;
    var request = playbackRequest;
    creatorSourceFor(g.item).then(function (out) {
      if (grant !== g || request !== playbackRequest || current !== g.item) return;
      if (!out || out.state !== "full" || !out.url) return;   // the entitlement check said no: the next read decides
      var life = Number(out.expiresIn) || 0, fresh = { url: out.url, expiresAt: life > 0 ? now() + life * 1000 : 0 };
      if (audio.paused && !(trouble && trouble.state)) {
        /* a paused song takes the fresh URL now, silently, at the same second */
        var at = audio.currentTime || 0;
        g.url = fresh.url; g.expiresAt = fresh.expiresAt; g.next = null;
        audio.src = fresh.url;
        try { audio.currentTime = at; } catch (e) {}
      } else g.next = fresh;   // a playing one keeps it for its next read
      if (fresh.expiresAt) scheduleRefresh(g);
    }).catch(function () {});
  }
  function deliveryFailed(why, since) {
    if (!current || !grant || grant.request !== playbackRequest || grant.item !== current) return false;
    if (currentAccess !== "full" && currentAccess !== "preview") return false;
    quietWatch();
    var at = Math.max(0, audio.currentTime || 0), t = now();
    var fresh = !trouble || trouble.state === "loading" || !trouble.since;   // a new drop, not another failed try of this one
    if (fresh) trouble = { state: "", at: at, attempt: 0, timer: 0, since: since || t, heard: heardNow(), seq: 0 };
    else {
      trouble.at = Math.max(trouble.at, at);
      if (!trouble.state) trouble.since = since || t;          // it played again, then stopped: the ten seconds start again
    }
    trouble.timer = cancel(trouble.timer);
    if (!audio.paused) audio.pause();                          // the element is quiet (the label says why)
    /* one drop is one music_interrupted, sent when it begins (approved by Matthew, 2026-11-23: one event per drop,
       never one per failed read; docs/music/MUSIC-RELEASE-20261119.md, "Quick wins") */
    if (fresh) trackEvent("music_interrupted", { reason: why, at_s: Math.round(trouble.at), attempt: trouble.attempt, path: grant.kind });
    if (grant.kind === "gated" && lapsed(grant)) { playEnded("dropped"); return true; }
    if (!wantPlay) { trouble.state = "lost"; paint(); troubleChanged(); return true; }   // the listener paused: Play picks it up here
    scheduleTry();
    return true;
  }
  /* the next try, at its time from the moment the sound stopped; a time already past is not made up for (one try at
     once, never a burst); after the last, the song stops and says how to pick it up */
  function scheduleTry() {
    var elapsed = now() - trouble.since, k = trouble.attempt;
    while (k + 1 < RETRY_AT_MS.length && RETRY_AT_MS[k + 1] <= elapsed) k++;
    if (k >= RETRY_AT_MS.length) {
      trouble.state = "lost";
      say(lostLine(), { item: current });
      troubleChanged();
      return;
    }
    trouble.state = "reconnecting";
    trouble.attempt = k + 1;
    var item = current, request = playbackRequest;
    trouble.timer = later(function () { if (trouble) trouble.timer = 0; retry(item, request, k); }, Math.max(0, RETRY_AT_MS[k] - elapsed));
    say(reconnectingLine(), { item: current });
    troubleChanged();
  }
  /* Play (or the World's transport, or the lock screen) on a song in trouble: a try at once, the tries timed from this tap */
  function tryAgainNow() {
    trouble.timer = cancel(trouble.timer);
    trouble.state = "reconnecting";
    trouble.attempt = 1;
    trouble.since = now();
    say(reconnectingLine(), { item: current });
    troubleChanged();
    retry(current, playbackRequest, 0);
  }
  function retry(item, request, k) {
    if (!trouble || request !== playbackRequest || current !== item || !wantPlay) return;
    var seq = ++trouble.seq;
    /* a try whose read never answers gives way to the next one on time; the last is given LAST_TRY_MS */
    var due = k + 1 < RETRY_AT_MS.length ? RETRY_AT_MS[k + 1] : RETRY_AT_MS[RETRY_AT_MS.length - 1] + LAST_TRY_MS;
    trouble.timer = cancel(trouble.timer);
    trouble.timer = later(function () {
      if (!trouble || trouble.seq !== seq || request !== playbackRequest || current !== item) return;
      trouble.timer = 0;
      if (trouble.state === "reconnecting") deliveryFailed("stalled");
    }, Math.max(0, due - (now() - trouble.since)));
    Promise.resolve(sourceAgain(item)).then(function (got) {
      if (!trouble || trouble.seq !== seq || request !== playbackRequest || current !== item || !wantPlay) return;
      if (got && got.failed) { deliveryFailed("resolve"); return; }
      /* the entitlement check said no to this try, and the listener still asks for music: the preview, labelled. An
         answer that comes after Pause, or after a newer try, changes nothing (the guard above): Play asks again, and
         that answer decides (a Release 1 follow-up: the review of PR #825, CX-2) */
      if (got && got.refused) { accessEnded(item, got.refused); return; }
      if (!got || !got.url) return;                           // already said and settled (an ended play)
      audio.src = got.url;
      try { audio.currentTime = trouble.at; } catch (e) {}    // a ranged read from the second it stopped
      audioSession();
      var p = audio.play();
      if (p && p.catch) p.catch(function (err) {
        /* a hidden page may need a tap to start its sound again (WebKit refuses a play() then): stop trying and say
           how to pick it up. Any other refusal (a failed load) reports itself as an error event, and the deadline
           above covers one that does not. */
        if (!err || err.name !== "NotAllowedError") return;
        if (!trouble || trouble.seq !== seq || current !== item || trouble.state !== "reconnecting") return;
        trouble.timer = cancel(trouble.timer);
        trouble.state = "lost";
        say(lostLine(), { item: current });
        paint(); troubleChanged();
      });
      paint();
    });
  }
  /* the same resolver that opened the song, again */
  function sourceAgain(item) {
    var g = grant;
    if (!g) return null;
    if (g.kind === "gated") {
      if (lapsed(g)) { playEnded("dropped"); return null; }
      return { url: g.url };
    }
    if (g.kind !== "creator") return { url: g.url };
    if (g.next && !lapsed(g.next)) { g.url = g.next.url; g.expiresAt = g.next.expiresAt; g.next = null; return { url: g.url }; }
    var refused = audio.error && audio.error.code === 4;
    if (!lapsed(g) && !refused) return { url: g.url };
    var request = playbackRequest;
    return creatorSourceFor(item).then(function (out) {
      if (request !== playbackRequest || current !== item || grant !== g) return null;
      if (out && out.state === "full" && out.url) {
        var life = Number(out.expiresIn) || 0;
        g.url = out.url; g.expiresAt = life > 0 ? now() + life * 1000 : 0; g.next = null;
        if (g.expiresAt) scheduleRefresh(g);
        return { url: g.url };
      }
      /* A failed renewal may offer the public preview as a network fallback. It says nothing about
         entitlement: keep the full song, its position and the bounded recovery attempts. */
      if (out && out.reason === "network") return { failed: true };
      /* ONLY THE ENTITLEMENT CHECK'S OWN NO ENDS THE FULL SONG: music-access answering 402 ("purchase") or 401/403
         ("account"), or no session at all (signed out in another tab, the session cleared: creatorSourceFor() answers
         "account" without asking; review MSL-2). It is handed to the try (retry() above), which applies it only while
         the listener still asks for music, so a refusal that arrives after Pause starts no preview. Anything else is a
         failed try. */
      if (out && out.state === "preview" && out.url && (out.reason === "purchase" || out.reason === "account")) return { refused: out };
      return { failed: true };
    }, function () { return { failed: true }; });
  }
  /* the entitlement check now says preview: the preview, labelled as one (never the master) */
  function accessEnded(item, out) {
    trouble = null;
    currentAccess = "preview";
    previewLimit = item.preview_seconds == null ? 30 : Number(item.preview_seconds);
    takeGrant(item, out, playbackRequest);
    audio.src = out.url;
    try { audio.currentTime = 0; } catch (e) {}
    say("The full song is not open to this account any more. Playing its preview.", { item: item });
    audioSession();
    var p = audio.play();
    if (p && p.catch) p.catch(function () {});
    troubleChanged();
  }
  /* an earned play whose time ran out: over, said, never claimed again by itself. Run out while it was paused, nothing
     dropped, and the line does not say so */
  function playEnded(why) {
    if (trouble) trouble.timer = cancel(trouble.timer);
    trouble = null;
    currentAccess = "spent";
    grant = null;
    wantPlay = false;
    if (!audio.paused) audio.pause();
    if (root.MCC_GATED) root.MCC_GATED.forget();
    say(why === "paused" ? "This play's time ran out while it was paused. Playing it again starts a new play."
      : "The connection dropped and this play's time ran out. Playing it again starts a new play.", { item: current });
    troubleChanged();
  }
  function endedShort() {
    var d = audio.duration;
    if (previewLimit || !isFinite(d) || d <= 0) return false;
    return (audio.currentTime || 0) < d - SHORT_END_S;
  }
  /* the song after this one: a creator release is signed ahead near the end, a gate is asked ahead
     (a play is still claimed only when it starts) */
  function upNext() {
    if (!current) return null;
    var list = recordList(current);
    var at = list.findIndex(function (item) { return sameItem(item, current); });
    var next = at < 0 ? null : list[at + 1];
    return next && !next.hold && !sameItem(next, current) ? next : null;
  }
  function accountKey() {
    try { return root.MCC && root.MCC.account ? String(root.MCC.account() || "") : (sessionToken() ? "signed-in" : ""); }
    catch (e) { return ""; }
  }
  function maybePrefetch() {
    if (!current || audio.paused || !wantPlay) return;
    var end = previewLimit || audio.duration;
    if (!isFinite(end) || end <= 0 || end - (audio.currentTime || 0) > PREFETCH_S) return;
    var next = upNext();
    if (!next || (prefetched && prefetched.item === next)) return;
    if (next.creatorTrackId && sessionToken()) {
      var slot = { item: next, account: accountKey(), at: now(), out: null, promise: null };
      slot.promise = creatorSourceFor(next).then(function (out) { slot.out = out; return out; });
      slot.promise.catch(function () { if (prefetched === slot) prefetched = null; });
      prefetched = slot;
    } else if (next.gated && root.MCC_GATED && root.MCC_GATED.resolve) {
      prefetched = { item: next, promise: null };
      root.MCC_GATED.resolve(next.gated);
    }
  }
  function takePrefetched(t) {
    var slot = prefetched;
    if (!slot || !(slot.item === t || sameItem(slot.item, t))) return null;
    prefetched = null;
    var account = accountKey();
    if (!slot.promise || slot.account !== account) return null;
    /* only a full answer with its address is kept, and only while it has time left; anything else (a network blip that
       came back as the preview, a refusal) is asked again now, through the same entitlement check */
    return slot.promise.then(function (out) {
      var life = out && Number(out.expiresIn) || 0;
      if (!out || out.state !== "full" || !out.url || accountKey() !== account) return creatorSourceFor(t);
      if (life && now() >= slot.at + life * 1000 - LAPSE_MARGIN_MS) return creatorSourceFor(t);
      return out;
    }, function () { return creatorSourceFor(t); });
  }
  if (root.MCC && root.MCC.onAccountChange) root.MCC.onAccountChange(function () { prefetched = null; });
  function unmute() { audio.muted = false; paint(); troubleChanged(); }
  /* the Unmute button goes as the sound comes back: the keyboard stays in the player, on its Play/Pause */
  function unmuteFrom(button, next) {
    var had = doc.activeElement === button;
    unmute();
    if (had) { var to = doc.getElementById(next); if (to && to.focus) to.focus(); }
  }

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
    if (GUEST && GUEST.owns && !GUEST.owns()) return;
    if (!current || current.creatorTrackId || !current.src || !root.MCC_POCKET || !root.MCC_POCKET.save) return;
    var now = Date.now();
    if (!force && now - bankedAt < 2000) return;
    bankedAt = now;
    var film = current.music_video || current.video || "";
    try {
      root.MCC_POCKET.save({
        src: current.src, title: current.title, album: current.albumSlug,
        artist: current.artist || "McCluster", art: current.art || "",
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
  if (GUEST && GUEST.restore === false) { /* a guest holds nothing of the album's */ }
  else if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", restore);
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
    refreshAccess: upgradeCurrent,
    delivery: function () {
      return { state: trouble ? trouble.state || "recovering" : "", at: trouble ? trouble.at : null, path: grant ? grant.kind : null, note: noticeLine(),
        label: troubleLabel(), status: statusLine(), heard: trouble ? !!trouble.heard : null, playing: intendsPlay() };
    },
    playing: intendsPlay,
    toggle: toggle,
    unmute: unmute
  };

  function viewMode(V) {
    var from = V.page || null;
    function E() { try { return V.engine(); } catch (e) { return null; } }
    function call(name, args) {
      var e = E();
      return e && typeof e[name] === "function" ? e[name].apply(e, args) : Promise.resolve(null);
    }
    function ask(name) { return function () { var e = E(); return e && typeof e[name] === "function" ? e[name]() : null; }; }
    function register(t) {
      var e = E();
      if (e) { e.registerCreatorTrack(t); return; }
      if (V.whenEngine) V.whenEngine(function () { var r = E(); if (r) r.registerCreatorTrack(t); });
    }
    /* this view's play buttons show what the retained engine plays */
    function paintButtons() {
      var e = E(), cur = e && e.current ? e.current() : null, wanted = !!(e && e.playing && e.playing());
      doc.querySelectorAll("[data-music-play]").forEach(function (b) {
        var creatorId = b.getAttribute("data-creator-track");
        var same = !!cur && (creatorId ? String(cur.creatorTrackId || "") === String(creatorId)
          : key(b.getAttribute("data-album"), b.getAttribute("data-track")) === key(cur.albumSlug, cur.title));
        b.classList.toggle("is-playing", same && wanted);
        b.setAttribute("aria-pressed", same && wanted ? "true" : "false");
      });
    }
    root.MCC_MUSIC = Object.freeze({
      view: true,
      play: function (albumSlug, title, force) { return call("play", [albumSlug, title, force, from]); },
      playCreator: function (id, force) { return call("playCreator", [id, force, from]); },
      registerCreatorTrack: register,
      pause: function () { return call("pause", []); },
      resume: function () { return call("resume", []); },
      next: function () { return call("next", []); },
      previous: function () { return call("previous", []); },
      openNow: function () { return call("openNow", []); },
      closeNow: function () { return call("closeNow", []); },
      toggle: function () { return call("toggle", []); },
      unmute: function () { return call("unmute", []); },
      refreshAccess: function () { return call("refreshAccess", []); },
      current: ask("current"),
      access: ask("access"),
      delivery: ask("delivery"),
      playing: function () { var e = E(); return !!(e && e.playing && e.playing()); }
    });
    doc.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-music-play]") : null;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      var creatorId = b.getAttribute("data-creator-track");
      var p = creatorId ? root.MCC_MUSIC.playCreator(creatorId) : root.MCC_MUSIC.play(b.getAttribute("data-album"), b.getAttribute("data-track"));
      /* a held song tapped here: this view says why (the engine it reached shows nothing behind it) */
      if (p && p.then) p.then(function (out) {
        if (out && out.state === "held" && root.MCC_GATED && root.MCC_GATED.holdNotice) root.MCC_GATED.holdNotice({ signedIn: !!out.signedIn });
      }, function () {});
      if (doc.querySelectorAll) paintButtons();
    }, true);
    doc.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var b = e.target && e.target.closest ? e.target.closest('[data-music-play][role="button"]') : null;
      if (!b) return;
      e.preventDefault();
      b.click();
    });
    if (V.on) { V.on("mcc:music-state", paintButtons); V.on("mcc:music-selected", paintButtons); }
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", paintButtons);
    else root.setTimeout(paintButtons, 0);
  }
})(window);
