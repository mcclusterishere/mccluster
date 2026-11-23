/* Music -> World keeps the actual playing document alive. A timestamp copied
   to another origin cannot preserve an Audio element or its user activation.
   The real World host stays in its own frame/session; this document owns the
   existing music transport and shared navigation. No audio URL, session token,
   location or account record crosses the frame message bridge. */
(function (root) {
  "use strict";
  if (root.MCC_WORLD_AUDIO) return;
  var doc = root.document;
  var script = doc.currentScript && doc.currentScript.src;
  var ROOT = script ? script.replace(/js\/world-audio-continuity\.js.*$/, "") : new URL("./", location.href).href;
  var HOUSE = "https://matthew.mccluster.org";
  var WORLD_ORIGINS = ["https://mccluster.org", "https://www.mccluster.org", "https://humanuprise.com", "https://www.humanuprise.com"];
  var TRUSTED = [HOUSE].concat(WORLD_ORIGINS);
  var CHANNEL = "mcc-world-audio-v1";
  var PREF = "mcc_world_audio_preference";
  var IS_WORLD = /\/mnet\.html$/.test(location.pathname) || WORLD_ORIGINS.indexOf(location.origin) !== -1 && /^\/(?:index\.html)?$/.test(location.pathname);
  var IS_GLOBE_FRAME = /\/action-globe\.html$/.test(location.pathname) && root.parent !== root;
  var theme = null, controls = null, shell = null, frame = null, status = null;
  var open = false, attached = false, parentOrigin = "", frameOrigin = "", channelId = "";
  var addressSuggestionsOpen = false;
  var worldHref = "", frameReady = false, readyTimer = null, quietTimer = null, loadGeneration = 0, openedAt = 0, frameAlive = false;
  var baseTitle = doc.title, baseHref = location.href, frameClearance = 0;
  var hiddenNodes = new Map(), observedAudio = new WeakSet();
  /* ONE PLAYER FOR THE WHOLE SITE (owner, 2026-11-23: "whenever the music starts, it continues. It's not restarted by
     some other music"). The document that is playing music never unloads for a move inside the site: Music, an album,
     an artist page or the World stays put, and the page asked for opens in its frame. Music started on a page inside
     that frame becomes the one song (the frame says so; the host's own song pauses), and that frame is kept, hidden,
     while the listener moves on, so its song keeps playing too. Sign-in, account and checkout pages still open at the
     top level: their sessions and payment returns belong to the address bar. */
  var TOP_ONLY = /^\/(?:login|account|forgot-password|reset-password|verify|identity-verify|pay|purchase|receipt|oauth|auth)(?:[.\/]|$)/i;
  var surfaceKind = "world", frameOwner = null, keeper = null, remoteOwner = null;
  var ownsMusic = false, ownedMedia = null, lastGesture = 0;
  var lastAnnouncement = {}, preference = readPreference();
  /* THE CORNER STACK (owner, 2026-10-19): on the World screen the play/pause
     sits with the fullscreen control (#mnWorldPlay), the song title scrolls in
     the top bar (#mnNowPlaying) and timed lyrics, when a track has them in
     data/lyrics/<slug>.json, take the headline's place line by line. The
     standalone World owns its Audio element, so its button plays directly.
     Inside the Music shell the parent keeps the transport (a frame message
     cannot carry Safari's media activation); the child only displays state. */
  var headlineBase = null, lyricCache = {}, lyricLine = "", lyricSlug = "", lyricAt = 0, remoteState = null, remoteDocked = false;
  function docked() { return doc.documentElement.classList.contains("mcc-app-dock-active"); }
  function receiveDocked(value) {
    remoteDocked = value === true;
    doc.documentElement.classList.toggle("mcc-app-dock-remote", remoteDocked);
  }

  /* Before every play(): the World's song is music to the device as well. The
     one helper every player asks (js/now-playing.js, loaded just before this
     file by js/tabbar.js) sets the playback audio session where the browser has
     one, the kind iOS keeps going with the screen locked. */
  function audioSession() { if (root.MCC_NOW_PLAYING) root.MCC_NOW_PLAYING.claim(); }
  function readPreference() {
    try { var p = JSON.parse(localStorage.getItem(PREF) || "null"); return p && typeof p === "object" ? p : {}; } catch (_) { return {}; }
  }
  function savePreference() { try { localStorage.setItem(PREF, JSON.stringify(preference)); } catch (_) {} }
  function suspendTransportForSuggestions(active) {
    if (!controls) return;
    // The address selector is inside the cross-origin World frame. Its option
    // cannot rise above this parent's z-index-2201 audio transport. Hide the
    // controls temporarily, NOT the playing audio, so the input is usable.
    var quiet = active === true && (open || IS_WORLD);
    controls.classList.toggle('world-audio--suggest-open', quiet);
    controls.inert = quiet;
    controls.setAttribute('aria-hidden', String(quiet));
  }
  function event(name, detail) { root.dispatchEvent(new CustomEvent(name, {detail: detail || {}})); }
  function urlOf(href) { try { return new URL(href, location.href); } catch (_) { return null; } }
  function cleanHref(href) {
    var u = urlOf(href); if (!u) return "";
    // Handoff is consumed by tabbar.js only. Never copy it into history or a message.
    u.hash = u.hash.replace(/(?:^#|&)mcc_handoff=[^&]*/, "");
    u.searchParams.delete("mcc_audio");
    return u.href;
  }
  function worldURL(href) {
    var u = urlOf(href); if (!u || !/^https:$/.test(u.protocol)) return null;
    if (WORLD_ORIGINS.indexOf(u.origin) !== -1 && /^\/(?:mnet\.html|index\.html)?$/.test(u.pathname)) {
      // Both World routers canonicalize www before serving the document.
      u.hostname = u.hostname.replace(/^www\./, ""); return u;
    }
    if (u.origin === HOUSE && /\/action-globe\.html$/.test(u.pathname) &&
        ['explore','halo','games','embedded'].some(function(key){return u.searchParams.has(key);})) return null;
    if (u.origin === HOUSE && /\/(?:mnet|action-globe)\.html$/.test(u.pathname)) {
      var w = new URL("https://mccluster.org/"); w.search = u.search; w.hash = u.hash;
      w.searchParams.delete("embedded"); w.searchParams.delete("explore");
      return w;
    }
    return null;
  }
  function samePath(path) { return String(path || "/").replace(/\/index\.html$/, "/"); }
  /* a page of the site that may open inside the listening document */
  function surfaceURL(href) {
    var u = urlOf(href);
    if (!u || u.protocol !== "https:" || TRUSTED.indexOf(u.origin) === -1) return null;
    if (TOP_ONLY.test(u.pathname) || !/(?:\/|\.html)$/.test(u.pathname)) return null;
    return u;
  }
  /* the listening document's own page: going there closes the frame instead */
  function isHome(href) {
    var u = urlOf(href); if (!u) return false;
    if (IS_WORLD && root.parent === root) return !!worldURL(u.href);
    var base = urlOf(baseHref);
    return !!base && u.origin === base.origin && samePath(u.pathname) === samePath(base.pathname) && (!u.search || u.search === base.search);
  }
  function playing(p) { return !!(p && p.audio && !p.audio.paused && !p.audio.ended); }
  /* is this document the one playing music right now (its own song, or a song a kept frame is playing for it)? */
  function listening() { return !!(remoteOwner && remoteOwner.playing) || playing(selected() || theme); }
  function musicURL(href) {
    var u = urlOf(href);
    return u && u.origin === HOUSE && u.pathname === "/listen.html" && !u.search && !u.hash;
  }
  function musicSurface() {
    var deck = doc.getElementById("deck");
    return !!root.MCC_MUSIC || !!(deck && /^(AUDIO|VIDEO)$/.test(deck.tagName));
  }
  function selected() {
    var engine = root.MCC_MUSIC;
    if (engine && engine.current && engine.current()) {
      var track = engine.current();
      return {audio:engine.audio, title:track.title, access:engine.access(),
        play:function () { return engine.resume(); }, pause:function () { engine.pause(); }};
    }
    var deck = doc.getElementById("deck");
    if (deck && (deck.currentSrc || deck.getAttribute("src"))) {
      return {audio:deck, title:lastAnnouncement.title || doc.getElementById("tpTitle")?.textContent || "Your music",
        play:function () { audioSession(); return root.MCC_NP_PLAY ? root.MCC_NP_PLAY() : deck.play(); }, pause:function () { deck.pause(); }};
    }
    return null;
  }
  function remotePlayer() {
    var r = remoteOwner; if (!r) return null;
    return {remote:true, audio:{paused:!r.playing, ended:false, muted:!!r.muted, error:null}, title:r.title || "Your music", access:"full",
      pause:function () { tellOwner(r, "pause"); }};
  }
  function player() { return remotePlayer() || selected() || theme; }
  function tellOwner(r, action) {
    if (!r || !r.el || !r.el.contentWindow || !r.origin) return;
    r.el.contentWindow.postMessage({channel:CHANNEL, id:r.id, type:"control", action:action}, r.origin);
  }
  /* any song the host itself starts silences the frame's song: there is only ever one */
  function hostTookOver() {
    if (!remoteOwner) return;
    tellOwner(remoteOwner, "pause"); remoteOwner.playing = false; remoteOwner = null;
  }
  function clusterButton() { return doc.getElementById("mnWorldPlay"); }
  function slugOf(audio) {
    var src = audio && (audio.currentSrc || audio.src) || "", m = /\/([^\/?#]+)\.[a-z0-9]+(?:[?#]|$)/i.exec(src);
    return m ? m[1].toLowerCase() : "";
  }
  /* WHICH WORDS BELONG TO A FILE is data/albums.json's to say (its track.lyrics), not a
     guess from the file name: Money or the Power's audio is money-or-the-power.mp3 and its
     words are data/lyrics/money-or-the-power.dk.json. The shelf is read once, for the
     rotation below, and lyrics wait for it: a track the shelf lists with no lyrics file has
     no words (guessing its slug's file asked for a file that does not exist, a 404 on every
     play of Heal the 3rd World); only a file the shelf does not list at all is still tried
     at its slug's own path under data/lyrics/. */
  var lyricsBySlug = null;
  function lyricsPath(slug) {
    var named = lyricsBySlug && Object.prototype.hasOwnProperty.call(lyricsBySlug, slug) ? lyricsBySlug[slug] : null;
    if (named === "") return null; // the shelf lists the track and names no words for it
    return named ? ROOT + named : ROOT + "data/lyrics/" + encodeURIComponent(slug) + ".json";
  }
  /* THE SHAPE OF A LYRICS FILE is album.html's rule (paintLyrics): the files the shelf names keep
     their lines as timed.line[] with begin/content (most committed files, the .dk.json ones among
     them); a file written as lines[] with t/text is read too. Either way the World gets a sorted
     list of {t, text}, or null when the file has no timed line to show. */
  function lyricLines(d) {
    var raw = d && d.timed && Array.isArray(d.timed.line) && d.timed.line.length ? d.timed.line
      : d && Array.isArray(d.lines) ? d.lines : [];
    var lines = [];
    raw.forEach(function (l) {
      if (!l || typeof l !== "object") return;
      var t = Number.isFinite(l.begin) ? l.begin : l.t, text = typeof l.content === "string" ? l.content : typeof l.text === "string" ? l.text : l.line;
      if (Number.isFinite(t) && typeof text === "string") lines.push({t:t, text:text});
    });
    lines.sort(function (a, b) { return a.t - b.t; });
    return lines.length ? lines : null;
  }
  function loadLyrics(slug) {
    if (!slug) return Promise.resolve(null);
    if (!lyricsBySlug) return loadRotation().then(function () { return lyricsBySlug ? loadLyrics(slug) : null; });
    var path = lyricsPath(slug); if (!path) return Promise.resolve(null);
    if (!lyricCache[slug]) lyricCache[slug] = fetch(path, {credentials:"omit"})
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(lyricLines)
      .catch(function () { return null; });
    return lyricCache[slug];
  }
  function lineAt(lines, t) {
    var lo = 0, hi = lines.length - 1, hit = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (lines[mid].t <= t) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
    return hit < 0 ? "" : lines[hit].text;
  }
  function lyricTick(audio) {
    var p = player(); if (!p || p.audio !== audio) return;
    var slug = slugOf(audio); if (!slug) return;
    lyricSlug = slug;
    loadLyrics(slug).then(function (lines) {
      if (lyricSlug !== slug) return;
      var next = lines && !audio.paused && !audio.ended ? lineAt(lines, audio.currentTime) : "";
      if (next === lyricLine) return;
      lyricLine = next; paintCluster(clusterState()); sendState();
    });
  }
  function clusterState() {
    var p = player();
    if (!p) return {present:false, playing:false, loading:false, title:"", line:""};
    var playing = !p.audio.paused && !p.audio.ended;
    return {present:true, playing:playing, loading:p.access === "loading", title:String(p.title || "Your music").slice(0, 120), line:playing ? String(lyricLine || "").slice(0, 240) : ""};
  }
  function paintCluster(st) {
    var b = clusterButton(), box = doc.getElementById("mnNowPlaying"), h = doc.querySelector(".wt-headline");
    if (b) {
      // Attached to the Music shell the parent's transport is the one that can
      // start sound, so this button stays out of the way there.
      b.hidden = attached || !st.present; b.disabled = !!st.loading;
      b.setAttribute("aria-pressed", String(!!st.playing));
      b.setAttribute("aria-label", st.playing ? "Pause music" : "Play music");
      if (b.firstElementChild) b.firstElementChild.textContent = st.playing ? "Ⅱ" : "▶";
    }
    if (box) {
      var text = doc.getElementById("mnNowPlayingText"), echo = box.querySelector(".mn__now-track--echo");
      box.hidden = !st.present || !st.title;
      if (text && text.textContent !== st.title) { text.textContent = st.title; if (echo) echo.textContent = st.title; }
      box.classList.toggle("is-playing", !!st.playing);
    }
    if (h) {
      if (headlineBase === null) headlineBase = h.textContent;
      var want = st.line || headlineBase;
      if (h.textContent !== want) h.textContent = want;
      h.classList.toggle("is-lyric", !!st.line);
    }
  }
  function sendState() { if (!attached && open && frame && frameReady) send(Object.assign({type:"state", docked:docked()}, clusterState())); }
  function bindCluster() {
    var b = clusterButton(); if (!b || b.dataset.mccBound) return;
    b.dataset.mccBound = "1";
    b.addEventListener("click", function () { if (!attached) toggle(); });
  }
  function loadStyle() {
    if (doc.getElementById("mccWorldAudioStyle")) return;
    var link = doc.createElement("link"); link.id = "mccWorldAudioStyle"; link.rel = "stylesheet";
    link.href = ROOT + "css/world-audio-continuity.css?v=__STAMP__"; link.onload = layout; doc.head.appendChild(link);
  }
  function watch(audio) {
    if (!audio || observedAudio.has(audio)) return;
    observedAudio.add(audio);
    audio.addEventListener("timeupdate", function () {
      var now = Date.now(); if (now - lyricAt < 250) return; lyricAt = now; lyricTick(audio);
    });
    ["play", "pause", "ended", "volumechange", "loadedmetadata", "error"].forEach(function (name) {
      audio.addEventListener(name, function () {
        if (name === "play" || name === "pause" || name === "ended") lyricTick(audio);
        if (name === "play" && theme && audio !== theme.audio && !theme.audio.paused) { pauseBy = "other_music"; theme.audio.pause(); }
        if (name === "play" && !attached) hostTookOver();
        if (name === "play" && typeof preference.muted === "boolean" && audio.muted !== preference.muted) audio.muted = preference.muted;
        if (name === "volumechange") { preference.muted = audio.muted; savePreference(); }
        paint();
      });
    });
  }
  /* THE WORLD'S SONG IS A RANDOM ONE (owner, 2026-10-20: "randomize and select songs … see which songs get paused,
     which songs the volume gets lowered on … it needs to be all songs mixed up"). The first tap on the World plays a
     song drawn at random from every public song in data/albums.json, Heal the 3rd World among them, and another random
     one follows when it ends. What the listener does once it starts is recorded as anonymous events, and only after
     the privacy acknowledgement (js/analytics.js defines MCC_TRACK then): start, pause, resume, mute, unmute, a volume
     change, the end, the tab going to the background and leaving the page, each with the song and the seconds. A
     phone's own volume buttons are invisible to a web page, so a lowered volume is seen only when it is lowered here. */
  var FALLBACK_SONG = {title:"Heal the 3rd World", src:"assets/audio/heal-the-3rd-world.m4a", slug:"heal-the-3rd-world", album:"heal-the-3",
    albumName:"Heal the 3", artist:"Matthew McCluster", art:"assets/img/heal-the-3-cover.jpg"};
  var rotation = null, rotationLoad = null, song = null, songOrd = 0, songStarted = 0, songBegun = false, pauseBy = "", soundWas = null;
  function loadRotation() {
    if (rotationLoad) return rotationLoad;
    rotationLoad = fetch(ROOT + "data/albums.json", {credentials:"omit"}).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var list = [], words = {};
      (d && Array.isArray(d.albums) ? d.albums : []).forEach(function (a) {
        (a && Array.isArray(a.tracks) ? a.tracks : []).forEach(function (t) {
          var src = t && typeof t.src === "string" ? t.src : "";
          // every track on the shelf, gated or not, that names a lyrics file (or names none with "") is taken at its word: same-origin data/ paths only
          var fileSlug = src.replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "").toLowerCase();
          // a track on the shelf with no lyrics key has no words: no file is guessed for it
          if (t && fileSlug) words[fileSlug] = typeof t.lyrics === "string" && /^data\/lyrics\/[a-z0-9._-]+\.json$/i.test(t.lyrics) ? t.lyrics : "";
          // public catalog files only: never a gated master, a preview or anything off the house's audio folder
          if (!t || t.gated || /preview/i.test(src) || !/^assets\/audio\/[a-z0-9._-]+\.(?:mp3|m4a)$/i.test(src)) return;
          // what the lock screen names: the song, its record's billed artist and album, and the record's cover (a same-origin file only)
          list.push({title:String(t.title || "").slice(0, 120), src:src, slug:src.replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "").toLowerCase(), album:String(a.slug || "").slice(0, 60),
            albumName:String(a.name || "").slice(0, 120), artist:String(a.artist || "Matthew McCluster").slice(0, 120),
            art:typeof a.art === "string" && /^assets\/img\/[a-z0-9._-]+$/i.test(a.art) ? a.art : ""});
        });
      });
      rotation = list.length ? list : [FALLBACK_SONG];
      // a lyric file guessed before the shelf arrived is forgotten, so the shelf's answer is the one used
      lyricsBySlug = words; lyricCache = {};
      return rotation;
    }).catch(function () { rotation = [FALLBACK_SONG]; lyricsBySlug = lyricsBySlug || {}; return rotation; });
    return rotationLoad;
  }
  function pickSong() {
    var list = rotation && rotation.length ? rotation : [FALLBACK_SONG], next = list[0];
    for (var i = 0; i < 8 && list.length > 1; i++) { next = list[Math.floor(Math.random() * list.length)]; if (!song || next.src !== song.src) break; }
    // never the same song twice in a row: when the draw keeps landing on it, the next one along the shelf
    if (song && next.src === song.src && list.length > 1) next = list[(list.indexOf(next) + 1) % list.length];
    return next;
  }
  // The theme is made when the page opens, before the catalog arrives, so its first song is the fallback. Once the
  // catalog is in, an unplayed song is drawn again from all of them (Heal the 3rd World one choice among the rest).
  function rollUnplayed() {
    if (!theme || songBegun || !theme.audio.paused || !rotation || rotation.length < 2) return;
    var next = rotation[Math.floor(Math.random() * rotation.length)];
    /* the draw can land on the song already loaded: it is the catalog's pick all the same, and says so, without reloading */
    if (next.src === song.src) { song = Object.assign({}, song, {pick:"random", pool:rotation.length}); return; }
    song = Object.assign({}, next, {pick:"random", pool:rotation.length}); theme.title = song.title; theme.audio.src = ROOT + song.src; paint();
  }
  function songEvent(name, extra) {
    if (!song || typeof root.MCC_TRACK !== "function") return;
    var a = theme && theme.audio;
    try {
      root.MCC_TRACK(name, Object.assign({page:"world", song:song.slug, album:song.album, ord:songOrd, pick:song.pick, pool:song.pool, at_s:a ? Math.round(a.currentTime || 0) : 0,
        after_s:songStarted ? Math.round((Date.now() - songStarted) / 1000) : 0}, extra || {}));
    } catch (_) {}
  }
  // how the song was chosen is kept with it, so every event about one listen says the same thing
  function loadSong(next) {
    song = Object.assign({}, next, {pick:rotation ? "random" : "fallback", pool:rotation ? rotation.length : 1}); songOrd++; songBegun = false; songStarted = 0;
    theme.title = song.title; theme.audio.src = ROOT + song.src;
  }
  function reactions(audio) {
    audio.addEventListener("play", function () {
      if (!songBegun) { songBegun = true; songStarted = Date.now(); songEvent("song_start", {trigger:songOrd === 1 ? "first_tap" : "next"}); }
      else songEvent("song_resume");
    });
    audio.addEventListener("pause", function () {
      if (audio.ended) return;
      songEvent("song_pause", {by:pauseBy || "player"}); pauseBy = "";
    });
    audio.addEventListener("ended", function () {
      songEvent("song_end");
      remember();
      loadSong(pickSong());
      try { audioSession(); var p = audio.play(); if (p && p.catch) p.catch(paint); } catch (_) {}
      paint();
    });
    audio.addEventListener("volumechange", function () {
      var was = soundWas || {muted:false, volume:1}; soundWas = {muted:audio.muted, volume:audio.volume};
      if (audio.muted !== was.muted) songEvent(audio.muted ? "song_mute" : "song_unmute");
      else if (Math.abs(audio.volume - was.volume) >= 0.05) songEvent("song_volume", {from:Math.round(was.volume * 100), to:Math.round(audio.volume * 100)});
    });
    doc.addEventListener("visibilitychange", function () {
      if (doc.visibilityState === "hidden" && songBegun && !audio.paused) songEvent("song_hidden");
    });
    root.addEventListener("pagehide", function () { if (songBegun) songEvent("song_leave", {playing:!audio.paused && !audio.ended}); });
  }
  /* THE WORLD'S SONG ON THE LOCK SCREEN (music slice M2). It wrote nothing there: no title, no artist, no cover,
     and WebKit then offers play, pause and 15-second skips with no track buttons, so the lock screen and AirPods could
     not change the song (music map 03, EXT-3). The one owner (js/now-playing.js) names the song, its record's artist and
     album and the record's cover at its true size, and previous and next move within the rotation: next draws another
     song, as the end of one does; previous goes back to the song before (or to the top of this one, a few seconds in).
     A lock-screen pause is the listener's pause, remembered like the corner button's. */
  var played = [];
  function remember() { if (song && songBegun) { played.push(song); if (played.length > 30) played.shift(); } }
  function startTheme() {
    if (!theme) return;
    var audio = theme.audio;
    preference.paused = false; savePreference();
    try { audioSession(); var p = audio.play(); if (p && p.catch) p.catch(paint); } catch (_) {}
    paint();
  }
  function nextSong() {
    if (!theme) return;
    songEvent("song_skip", {to:"next"});
    remember();
    loadSong(pickSong());
    startTheme();
  }
  function previousSong() {
    if (!theme) return;
    var audio = theme.audio;
    if (audio.currentTime > 4 || !played.length) { try { audio.currentTime = 0; } catch (_) {} return; }
    songEvent("song_skip", {to:"previous"});
    loadSong(played.pop());
    startTheme();
  }
  function ensureTheme() {
    if (theme) return theme;
    var audio = new Audio(); audio.preload = "metadata"; audio.loop = false;
    audio.setAttribute("playsinline", "");
    audio.muted = preference.muted === true; soundWas = {muted:audio.muted, volume:audio.volume};
    theme = {audio:audio, title:"", access:"full",
      play:function () { audioSession(); return audio.play(); }, pause:function () { audio.pause(); }};
    // the source is set synchronously; rollUnplayed redraws it from the whole catalog once that arrives
    loadSong(pickSong());
    watch(audio); reactions(audio);
    if (root.MCC_NOW_PLAYING && root.MCC_NOW_PLAYING.bind) root.MCC_NOW_PLAYING.bind(audio, {
      surface: "world",
      track: function () { return song ? {title:song.title, artist:song.artist || "Matthew McCluster", album:song.albumName || "", art:song.art || ""} : null; },
      play: function () { if (audio.paused || audio.ended) startTheme(); },
      pause: function () { pauseBy = "lock_screen"; preference.paused = true; savePreference(); audio.pause(); paint(); },
      previous: previousSong,
      next: nextSong
    });
    return theme;
  }
  function playTheme() {
    if (selected() || preference.paused || preference.muted || attached || remoteOwner && remoteOwner.playing) return;
    var p = ensureTheme();
    if (!p.audio.paused) return;
    // Synchronous with the owning document's click/touch. postMessage does not
    // transfer Safari's media activation and is never used to start this sound.
    try { audioSession(); var promise = p.play(); if (promise && promise.catch) promise.catch(paint); } catch (_) {}
    ensureControls(); paint();
  }
  function touch() {
    if (IS_WORLD && !attached && root.parent === root) playTheme();
  }
  function pause() {
    var p = player(); if (!p) return;
    if (p.remote) { p.pause(); paint(); return; }
    if (p === theme) { preference.paused = true; savePreference(); pauseBy = "button"; }
    p.pause(); paint();
  }
  function toggle() {
    var p = player() || ensureTheme();
    // a kept frame's song: the frame plays it, the host only asks (its own audio session is claimed there)
    if (p.remote) { tellOwner(remoteOwner, playing(p) ? "pause" : "play"); return; }
    if (!p.audio.paused && !p.audio.ended) { pause(); return; }
    preference.paused = false; savePreference();
    try { audioSession(); var promise = p.play(); if (promise && promise.catch) promise.catch(paint); } catch (_) {}
    paint();
  }
  function mute() {
    var p = player() || ensureTheme();
    if (p.remote) { tellOwner(remoteOwner, p.audio.muted ? "unmute" : "mute"); return; }
    p.audio.muted = !p.audio.muted; preference.muted = p.audio.muted; savePreference(); paint();
  }
  function ensureControls() {
    if (controls) return;
    loadStyle();
    controls = doc.createElement("aside"); controls.id = "mccWorldAudioControls";
    controls.className = "world-audio"; controls.setAttribute("aria-label", "Music controls");
    controls.innerHTML = '<button class="world-audio__title" type="button" aria-label="Return to Music"><span id="mccWorldAudioTitle"></span><small id="mccWorldAudioState"></small></button>' +
      '<button class="world-audio__play" type="button" aria-label="Play music"><span aria-hidden="true">▶</span></button>' +
      '<button class="world-audio__mute" type="button" aria-label="Mute music" aria-pressed="false">Mute</button>';
    doc.body.appendChild(controls);
    if (root.ResizeObserver) {
      var resize = new ResizeObserver(layout); resize.observe(controls);
      var dock = doc.querySelector(".appbar"); if (dock) resize.observe(dock);
    }
    controls.querySelector(".world-audio__title").addEventListener("click", function () {
      if (open) closeWorld(true);
      else if (root.MCC_BAR) root.MCC_BAR.navigation.go(HOUSE + "/listen.html");
    });
    controls.querySelector(".world-audio__play").addEventListener("click", toggle);
    controls.querySelector(".world-audio__mute").addEventListener("click", mute);
  }
  function paint() {
    var p = player();
    if (controls) {
      controls.hidden = attached || !p || !(open || IS_WORLD || p === theme || p.remote) || (IS_WORLD && !attached && !open && !!clusterButton());
      if (p) {
        doc.getElementById("mccWorldAudioTitle").textContent = p.title || "Your music";
        var error = !!p.audio.error, playing = !p.audio.paused && !p.audio.ended;
        doc.getElementById("mccWorldAudioState").textContent = p.access === "loading" ? "Opening music…" : error || p.access === "unavailable" ? "Unable to play · try again" : p.audio.muted ? "Muted" : playing ? (p.access === "preview" ? "Preview playing" : "Playing") : "Paused";
        var b = controls.querySelector(".world-audio__play");
        b.disabled = p.access === "loading";
        b.setAttribute("aria-label", playing ? "Pause music" : "Play music"); b.firstElementChild.textContent = playing ? "Ⅱ" : "▶";
        var m = controls.querySelector(".world-audio__mute");
        m.setAttribute("aria-label", p.audio.muted ? "Unmute music" : "Mute music");
        m.setAttribute("aria-pressed", String(p.audio.muted)); m.textContent = p.audio.muted ? "Unmute" : "Mute";
      }
    }
    if (attached) { if (remoteState) paintCluster(remoteState); } else { paintCluster(clusterState()); sendState(); }
    if (open) markSurface();
    layout();
  }
  /* the bar marks the page that is open in the frame */
  function markSurface() {
    var target = urlOf(worldHref), world = surfaceKind === "world";
    doc.querySelectorAll(".appbar [data-appnav]").forEach(function (tab) {
      var href = urlOf(tab.getAttribute("href") || "");
      var here = world ? tab.dataset.appnav === "world" :
        !!(target && href && href.origin === target.origin && samePath(href.pathname) === samePath(target.pathname));
      tab.classList.toggle("is-here", here);
      if (here) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
    });
  }
  function homeLabel() { return IS_WORLD && root.parent === root ? "World" : "Music"; }
  function send(data) {
    if (!frame || !frame.contentWindow || !frameOrigin) return;
    frame.contentWindow.postMessage(Object.assign({channel:CHANNEL, id:channelId}, data), frameOrigin);
  }
  function placeTransport(top, right) {
    if (attached && channelId && parentOrigin) {
      root.parent.postMessage({channel:CHANNEL, type:"controls-position", id:channelId, top:top, right:right}, parentOrigin);
    } else if (controls && top === null) { controls.style.removeProperty("top"); controls.style.removeProperty("right"); }
    else if (controls) { controls.style.top = top + "px"; controls.style.right = right + "px"; }
  }
  function alignWorldTransport() {
    if (docked() || remoteDocked) { placeTransport(null, null); return; }
    if (!IS_WORLD || (!attached && root.parent !== root)) return;
    /* The compact offset belongs to the World screen only. Off that screen
       (Missions, Tour, profile) the bar keeps its bottom geometry; an inline
       top left behind would stretch it into a full-height overlay. */
    var onWorld = doc.documentElement.classList.contains("mn-world-on");
    var expand = onWorld ? doc.querySelector(".mn__world-expand") : null;
    var rect = expand ? expand.getBoundingClientRect() : null;
    if (!rect || rect.width < 20 || rect.top < 55 || rect.top > root.innerHeight - 65) { placeTransport(null, null); return; }
    /* Sit directly above the fullscreen control, sharing its right edge. In
       landscape the globe is the left column and that edge is left of the
       feed, so the transport never lands on the directions or active turn. */
    placeTransport(Math.max(67, Math.round(rect.top - 60)), Math.max(12, Math.round(root.innerWidth - rect.right)));
  }
  function layout() {
    alignWorldTransport();
    if (attached) return;
    var dock = doc.querySelector(".appbar"), rect = dock && dock.getBoundingClientRect();
    var navClear = rect && rect.height ? Math.max(0, root.innerHeight - rect.top) : 88;
    if (controls) controls.style.setProperty("--world-audio-nav-clear", navClear + "px");
    /* The World player is no longer a bottom bar: only the app navigation
       requires vertical clearance. Keep the old calculation in Music. */
    var extra = IS_WORLD || open ? 0 : controls && !controls.hidden ? controls.getBoundingClientRect().height + 16 : 0;
    var reserve = Math.min(280, Math.ceil(navClear + extra));
    if (open && frameClearance !== reserve) { frameClearance = reserve; send({type:"layout", clearance:reserve}); }
    if (IS_WORLD && root.parent === root && controls && !controls.hidden) {
      doc.documentElement.style.setProperty("--mcc-world-audio-clear", reserve + "px");
      doc.documentElement.style.setProperty("--mn-bar-clear", reserve + "px");
      event("mcc:world-audio-layout", {clearance:reserve});
    }
  }
  function frameLayout(clearance) {
    if (!Number.isFinite(clearance) || clearance < 50 || clearance > 280) return;
    if (frameClearance === clearance) return;
    frameClearance = clearance;
    doc.documentElement.style.setProperty("--mcc-world-audio-clear", clearance + "px");
    doc.documentElement.style.setProperty("--mn-bar-clear", clearance + "px");
    root.dispatchEvent(new Event("resize")); event("mcc:world-audio-layout", {clearance:clearance});
  }
  function frameVisibility(visible) {
    if (typeof visible !== "boolean") return;
    // Persist the validated state for modules that initialize after attachment.
    doc.body.dataset.worldAudioVisible = String(visible);
    // hidden, the page stops its videos and any other sound, but the song it is playing for the listener keeps playing
    if (!visible) doc.querySelectorAll("audio,video").forEach(function (media) { if (!(ownsMusic && media === ownedMedia && !media.paused)) media.pause(); });
    event("mcc:world-audio-visibility", {visible:visible});
  }
  function concealMusic() {
    Array.prototype.forEach.call(doc.body.children, function (node) {
      if (/^(SCRIPT|LINK|STYLE)$/.test(node.tagName) || node === shell || node === controls || node.classList.contains("appbar") || node.id === "mccDestinations") return;
      if (!hiddenNodes.has(node)) hiddenNodes.set(node, node.inert);
      node.inert = true;
    });
  }
  function makeFrame() {
    var f = doc.createElement("iframe"); f.id = "mccWorldAudioFrame"; f.title = "Equity Uprise World";
    f.allow = "geolocation; autoplay; fullscreen; camera; microphone";
    f.allowFullscreen = true; f.referrerPolicy = "strict-origin-when-cross-origin";
    f.addEventListener("load", function () {
      if (f !== frame) return;
      // a new document in the frame: whatever song its old document played is gone with it
      if (remoteOwner && remoteOwner === frameOwner) remoteOwner = null;
      frameOwner = null;
      send({type:"attach", clearance:frameClearance || 152, visible:open, docked:docked()});
      // a page of the house names itself; a cross-origin page keeps the generic name
      if (surfaceKind !== "world") { try { var t = f.contentDocument && f.contentDocument.title; if (t && open) doc.title = t; } catch (_) {} }
    });
    return f;
  }
  /* The frame on screen is playing the song and the listener moves on: keep it, hidden, so its song keeps playing, and
     give the next page a fresh frame. Only one frame is ever kept; a newer song in another frame replaces it. */
  function keepCurrentFrame() {
    if (!frame || !frameOwner || !frameOwner.playing) return false;
    if (keeper && keeper.el !== frame) dropKeeper();
    keeper = {el:frame, origin:frameOrigin, id:channelId, href:worldHref, kind:surfaceKind,
      title:frameOwner.title, playing:frameOwner.playing, muted:frameOwner.muted};
    remoteOwner = keeper;
    frame.id = "mccWorldAudioKeeper"; frame.hidden = true; frame.removeAttribute("tabindex");
    frame.contentWindow && frame.contentWindow.postMessage({channel:CHANNEL, id:channelId, type:"visibility", visible:false}, frameOrigin);
    frame = makeFrame(); shell.insertBefore(frame, status);
    frameOwner = null; frameReady = false; frameAlive = false; worldHref = ""; frameOrigin = ""; channelId = "";
    return true;
  }
  function frameRecord() {
    frameOwner = frameOwner || {};
    frameOwner.el = frame; frameOwner.origin = frameOrigin; frameOwner.id = channelId;
    return frameOwner;
  }
  /* a page in a frame says it is playing (or stopped) the song: it becomes the one song, and every other one pauses */
  function ownerState(rec, d) {
    rec.title = typeof d.title === "string" ? d.title.slice(0, 120) : rec.title || "";
    rec.muted = d.muted === true; rec.playing = d.playing === true;
    if (rec.playing) {
      if (remoteOwner && remoteOwner !== rec) { tellOwner(remoteOwner, "pause"); if (keeper === remoteOwner) dropKeeper(); }
      remoteOwner = rec;
      var own = selected();
      if (playing(own)) own.pause();
      if (theme && !theme.audio.paused) { pauseBy = "other_music"; theme.audio.pause(); }
    }
    paint();
  }
  function dropKeeper() {
    if (!keeper) return;
    if (remoteOwner === keeper) remoteOwner = null;
    try { keeper.el.remove(); } catch (_) {}
    keeper = null;
  }
  /* back to the kept page: its frame comes forward again, song and all */
  function restoreKeeper() {
    var kept = keeper; keeper = null;
    if (frame && frame !== kept.el) frame.remove();
    frame = kept.el; frame.id = "mccWorldAudioFrame"; frame.hidden = false;
    worldHref = kept.href; frameOrigin = kept.origin; channelId = kept.id; surfaceKind = kept.kind;
    frameOwner = kept;
    frameReady = true; frameAlive = true; status.hidden = true;
    send({type:"attach", clearance:frameClearance || 152, visible:true, docked:docked()});
  }
  function createShell() {
    if (shell) return;
    loadStyle(); shell = doc.createElement("section"); shell.id = "mccWorldAudioShell";
    shell.setAttribute("aria-label", "World"); shell.hidden = true;
    frame = makeFrame();
    status = doc.createElement("div"); status.className = "world-audio-status";
    status.innerHTML = '<p role="status">Opening World…</p><button type="button">Back to ' + homeLabel() + '</button><a>Open World directly</a>';
    status.querySelector("button").onclick = function () { closeWorld(true); };
    status.querySelector("a").onclick = function (e) {
      e.preventDefault();
      var h = root.MCC_BAR?.navigation.handoff;
      (h ? h(worldHref) : Promise.resolve(worldHref)).catch(function () { return worldHref; }).then(function (url) { location.assign(url); });
    };
    shell.append(frame, status); doc.body.appendChild(shell);
    new MutationObserver(function () { if (open) concealMusic(); }).observe(doc.body, {childList:true});
  }
  /* THE WORLD OPENS IN ITS OWN COLOUR (owner, 2026-10-20: "other screens flash up instead of just a smooth transition").
     The frame used to show "Opening World… / Back to Music / Open World directly" on every open, on night-dark even into
     a white day World, and then a blank World. Now the frame stands in the World's colour for this moment (js/daylight.js,
     loaded for the arithmetic by js/tabbar.js) and says nothing for its first 1.5 seconds; the words come only if the
     World is genuinely slow (once its bridge has said hello it is painting, and gets a little longer), and the child says
     it is ready only once the World is painted (attachToParent, below). */
  var QUIET_MS = 1500, ALIVE_MS = 6000;
  function speakIfSlow(wait) {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(function () {
      if (frameReady || !open) return;
      if (frameAlive && Date.now() - openedAt < ALIVE_MS) { speakIfSlow(250); return; }
      status.classList.remove("is-quiet");
    }, wait);
  }
  function worldPhase() {
    try { return root.MCC_DAYLIGHT_CORE ? root.MCC_DAYLIGHT_CORE.estimate(new Date()) : ""; } catch (_) { return ""; }
  }
  function openWorld(href, options) {
    options = options || {};
    var worldTarget = worldURL(href), url = worldTarget || (options.surface ? surfaceURL(href) : null);
    if (!url) return false;
    var clean = cleanHref(url.href), kind = worldTarget ? "world" : "page";
    if (options.gesture !== false && kind === "world") playTheme();
    if (root.MCC_MUSIC) root.MCC_MUSIC.closeNow();
    createShell(); ensureControls();
    // a page that is playing the song stands aside, still playing, for the next one; going back to it brings it forward
    if (keeper && keeper.href === clean) restoreKeeper();
    else if (frame && worldHref && worldHref !== clean) keepCurrentFrame();
    surfaceKind = kind;
    frame.title = kind === "world" ? "Equity Uprise World" : "McCluster";
    status.querySelector("a").textContent = kind === "world" ? "Open World directly" : "Open this page directly";
    var wasOpen = open; open = true; shell.hidden = false;
    doc.body.dataset.worldAudioOpen = "true"; doc.documentElement.classList.add("world-audio-open");
    concealMusic(); doc.title = kind === "world" ? "World · Equity Uprise" : "McCluster";
    if (!options.history) {
      var address = new URL(baseHref); address.searchParams.set(kind === "world" ? "world" : "surface", "1");
      address.searchParams.delete(kind === "world" ? "surface" : "world");
      var entry = Object.assign({}, history.state, {mccWorldAudio:{href:clean}});
      // one entry above the listening page, however many pages are opened in turn: Back always returns to it
      if (wasOpen) history.replaceState(entry, "", address.href); else history.pushState(entry, "", address.href);
    }
    paint();
    // the bar restores its own mark once a tap is handled (js/tabbar.js revert()): mark the open page after it
    root.setTimeout(function () { if (open) markSurface(); }, 0);
    if (worldHref !== clean || !frame.getAttribute("src")) {
      worldHref = clean; frameOrigin = url.origin; frameReady = false;
      channelId = root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : String(Date.now()) + Math.random();
      status.hidden = false; status.querySelector("p").textContent = kind === "world" ? "Opening World…" : "Opening…";
      status.querySelector("a").href = clean;
      shell.classList.toggle("is-day", worldPhase() === "day");
      status.classList.add("is-quiet"); openedAt = Date.now(); frameAlive = false;
      speakIfSlow(QUIET_MS);
      var generation = ++loadGeneration;
      var target = new URL(clean); target.searchParams.set("mcc_audio", "1");
      var handoff = root.MCC_BAR && root.MCC_BAR.navigation.handoff;
      (handoff ? handoff(target.href) : Promise.resolve(target.href)).catch(function () { return target.href; }).then(function (carried) {
        if (generation !== loadGeneration) return;
        frame.src = carried;
      });
      clearTimeout(readyTimer);
      readyTimer = setTimeout(function () {
        if (!frameReady && open) status.querySelector("p").textContent = (surfaceKind === "world" ? "World is" : "This page is") + " taking longer to open. Your music is still available.";
      }, 12000);
    } else { send({type:"attach", clearance:frameClearance || 152, visible:open, docked:docked()}); send({type:"visibility", visible:open}); }
    frame.focus({preventScroll:true});
    return true;
  }
  function closeWorld(back) {
    if (!open) return;
    send({type:"visibility", visible:false});
    open = false; shell.hidden = true;
    addressSuggestionsOpen = false;
    suspendTransportForSuggestions(false);
    delete doc.body.dataset.worldAudioOpen; doc.documentElement.classList.remove("world-audio-open");
    hiddenNodes.forEach(function (wasInert, node) { node.inert = wasInert; }); hiddenNodes.clear();
    doc.title = baseTitle;
    // Clear the compact World offset before restoring Music. Leaving this
    // inline top together with the Music bottom makes a full-height overlay.
    if (controls) { controls.style.removeProperty("top"); controls.style.removeProperty("right"); }
    var homeTab = IS_WORLD && root.parent === root ? "world" : "music";
    doc.querySelectorAll(".appbar [data-appnav]").forEach(function (tab) {
      var here = tab.dataset.appnav === homeTab;
      tab.classList.toggle("is-here", here); tab.removeAttribute("aria-current");
    });
    paint();
    doc.querySelector('.appbar [data-appnav="' + homeTab + '"]')?.focus({preventScroll:true});
    if (back && history.state && history.state.mccWorldAudio) history.back();
  }
  /* "ready" means the World is on screen: one of its screens is up (mnet.html ships the World visible) and has been
     painted. Painted already (the document's first contentful paint is behind it): at once. Otherwise after the next
     frame is drawn with it; a frame the parent has hidden paints nothing, so a timer answers for it. */
  function whenPainted(done) {
    var sent = false, finish = function () { if (!sent) { sent = true; done(); } };
    var shown = function () {
      if (!IS_WORLD) return true;
      return ["mnApp", "mnSignedOut", "mnProfileGate"].some(function (id) { var el = doc.getElementById(id); return el && !el.hidden; });
    };
    var painted = false;
    try { painted = !!(root.performance && performance.getEntriesByName && performance.getEntriesByName("first-contentful-paint").length); } catch (_) {}
    if (painted && shown()) { finish(); return; }
    var tries = 0;
    (function wait() {
      if (!shown() && ++tries < 90) { root.requestAnimationFrame(wait); return; }
      root.requestAnimationFrame(function () { root.requestAnimationFrame(finish); });
    })();
    setTimeout(finish, 2500);
  }
  /* THE PAGE IN THE FRAME (child side). A song the listener starts here becomes the one song: the host is told, and its
     own song pauses. A page that starts sound by itself, with no tap, while the host is playing, is stopped instead,
     so arriving somewhere never switches the song. Video still pauses the host's music, as before. */
  function gestured() {
    try { if (root.navigator.userActivation) return root.navigator.userActivation.isActive; } catch (_) {}
    return Date.now() - lastGesture < 5000;
  }
  function childTitle() {
    var engine = root.MCC_MUSIC, track = engine && engine.current && engine.current();
    return String(track && track.title || lastAnnouncement.title || doc.getElementById("tpTitle")?.textContent || doc.title || "Your music").slice(0, 120);
  }
  function announceOwner() {
    if (!attached || !ownedMedia) return;
    root.parent.postMessage({channel:CHANNEL, type:"owner", id:channelId, playing:!ownedMedia.paused && !ownedMedia.ended,
      muted:!!ownedMedia.muted, title:childTitle()}, parentOrigin);
  }
  var childWatched = new WeakSet();
  function childWatch() {
    [root.MCC_MUSIC && root.MCC_MUSIC.audio, doc.getElementById("deck")].forEach(function (media) {
      if (!media || childWatched.has(media)) return;
      childWatched.add(media);
      media.addEventListener("play", function () { if (attached) childPlay(media); });
      ["pause", "ended", "volumechange"].forEach(function (name) { media.addEventListener(name, function () { if (media === ownedMedia) announceOwner(); }); });
    });
  }
  function childPlay(media) {
    if (!media || media.muted || media.volume === 0) return;
    if (!gestured() && remoteState && remoteState.playing) { try { media.pause(); } catch (_) {} return; }
    if (media.tagName === "AUDIO") {
      if (ownedMedia === media && ownsMusic) { announceOwner(); return; }
      ownsMusic = true; ownedMedia = media;
      if (!childWatched.has(media)) {
        childWatched.add(media);
        ["pause", "ended", "volumechange"].forEach(function (name) { media.addEventListener(name, function () { if (media === ownedMedia) announceOwner(); }); });
      }
      announceOwner(); return;
    }
    root.parent.postMessage({channel:CHANNEL, type:"pause", id:channelId}, parentOrigin);
  }
  function childControl(action) {
    var media = ownedMedia; if (!media) return;
    var engine = root.MCC_MUSIC && root.MCC_MUSIC.audio === media ? root.MCC_MUSIC : null;
    if (action === "pause") { if (engine) engine.pause(); else media.pause(); }
    else if (action === "play") { audioSession(); try { var p = engine ? engine.resume() : media.play(); if (p && p.catch) p.catch(function () {}); } catch (_) {} }
    else if (action === "mute" || action === "unmute") media.muted = action === "mute";
  }
  function attachToParent(e) {
    if (root.parent === root || e.source !== root.parent || TRUSTED.indexOf(e.origin) === -1 || TRUSTED.indexOf(location.origin) === -1) return;
    var data = e.data;
    if (typeof data.id !== "string" || !data.id || data.id.length > 100) return;
    attached = true; parentOrigin = e.origin; channelId = data.id;
    receiveDocked(data.docked);
    if (theme) theme.audio.pause();
    loadStyle(); doc.body.dataset.worldAudioChild = "ready";
    var dock = doc.querySelector(".appbar"); if (dock) { dock.hidden = true; dock.inert = true; }
    frameLayout(data.clearance);
    frameVisibility(data.visible);
    whenPainted(function () {
      if (channelId !== data.id) return;
      root.parent.postMessage({channel:CHANNEL, type:"ready", id:channelId}, parentOrigin);
    });
    if (addressSuggestionsOpen) root.parent.postMessage(
      {channel:CHANNEL,type:"address-suggestions",id:channelId,active:true},parentOrigin);
    paint(); bindCluster(); childWatch();
    alignWorldTransport();
  }
  /* narrow: the early capture-phase link check, which keeps its original reach (World and Music) so a page's own link
     handlers still run first for every other link; the bar and ordinary links that no page handler took are broad */
  function navigate(href, narrow) {
    if (attached) {
      if (narrow) {
        if (!musicURL(href)) return false;
        root.parent.postMessage({channel:CHANNEL, type:"music", id:channelId}, parentOrigin); return true;
      }
      // inside the listening document every move to another page of the site is the host's to make, so no song unloads
      var target = surfaceURL(href);
      if (!target || target.origin === location.origin && samePath(target.pathname) === samePath(location.pathname)) return false;
      root.parent.postMessage({channel:CHANNEL, type:"open", id:channelId, href:cleanHref(target.href)}, parentOrigin); return true;
    }
    if (root.parent !== root) return false;
    if (open && (musicURL(href) || !narrow && isHome(href))) { closeWorld(true); return true; }
    var world = worldURL(href);
    if (world && musicSurface()) return openWorld(world.href);
    if (narrow) return false;
    var page = surfaceURL(href);
    if (page && !isHome(href) && (open || listening())) return openWorld(page.href, {surface:true});
    return false;
  }
  /* js/tabbar.js asks here before it sends the document anywhere (its own links that carry the sign-in across hosts
     included). The page in the frame hands every page of the site to the host, which opens it and keeps the song; only
     a page that must be the top document (sign-in, account, checkout) leaves, with its exact destination. A listening
     top document keeps playing the same way. */
  function leaveFrame(href) {
    var u = urlOf(href); if (!u) return false;
    if (attached) {
      if (TRUSTED.indexOf(u.origin) === -1) return false;
      if (surfaceURL(u.href) && navigate(u.href)) return true;
      if (u.origin === location.origin) return false;
      root.top.location.href = u.href;
      return true;
    }
    return root.parent === root && navigate(u.href);
  }

  // The Cesium document is same-origin with its World host. Call synchronously
  // so iOS still sees the first globe touch, then let the globe handle that tap.
  if (IS_GLOBE_FRAME) {
    doc.addEventListener("pointerdown", function (e) {
      if (!e.isTrusted) return;
      try { if (root.parent.location.origin === location.origin) root.parent.MCC_WORLD_AUDIO?.touch(); } catch (_) {}
    }, {capture:true, passive:true});
    return;
  }
  root.MCC_WORLD_AUDIO = {navigate:navigate, leaveFrame:leaveFrame, touch:touch, active:function () {return open;},
    song:function () { return song ? {slug:song.slug, title:song.title, ord:songOrd, pick:song.pick, pool:rotation ? rotation.length : 0} : null; }};
  if (musicSurface()) {
    // the frame's own styles are in place before the World is ever opened, so the frame never draws unstyled first
    loadStyle();
    ensureTheme(); loadRotation().then(rollUnplayed); // metadata only; no automatic playback on Music.
    watch(root.MCC_MUSIC && root.MCC_MUSIC.audio); watch(doc.getElementById("deck"));
  }
  if (IS_WORLD && root.parent === root) { ensureTheme(); loadRotation().then(rollUnplayed); ensureControls(); bindCluster(); paint(); }
  root.addEventListener("mcc:nowplaying", function (e) { lastAnnouncement = e.detail || {}; paint(); });
  root.addEventListener("mcc:music-selected", function () { if (theme) theme.audio.pause(); watch(root.MCC_MUSIC?.audio); paint(); });
  root.addEventListener("mcc:music-state", paint);
  root.addEventListener("mcc:appbar-admin", paint);
  root.addEventListener("mcc:installed-dock", paint);
  root.addEventListener('mcc:travel-autocomplete', function(e) {
    addressSuggestionsOpen = e.detail?.active === true;
    if (attached && channelId && parentOrigin) {
      // The parent validates exact frame source, origin and session nonce.
      root.parent.postMessage({channel:CHANNEL,type:'address-suggestions',
        id:channelId,active:addressSuggestionsOpen},parentOrigin);
    } else if (IS_WORLD) {
      suspendTransportForSuggestions(addressSuggestionsOpen);
    }
  });
  root.addEventListener("resize", layout);
  root.addEventListener("mcc:world-mode", layout);
  if (IS_WORLD && typeof MutationObserver === "function") {
    /* mnet.js toggles html.mn-world-on when the World screen opens or closes
       without an event; re-run layout so the transport leaves with it. */
    var layoutQueued = false;
    new MutationObserver(function () {
      if (layoutQueued) return; layoutQueued = true;
      requestAnimationFrame(function () { layoutQueued = false; layout(); });
    }).observe(doc.documentElement, {attributes:true, attributeFilter:["class"]});
  }
  root.addEventListener("popstate", function () {
    var state = history.state && history.state.mccWorldAudio;
    if (state && (musicSurface() || IS_WORLD && root.parent === root)) openWorld(state.href, {history:true, gesture:false, surface:true});
    else closeWorld(false);
  });
  root.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object" || d.channel !== CHANNEL) return;
    if (d.type === "attach") { attachToParent(e); return; }
    if (attached) {
      if (e.source !== root.parent || e.origin !== parentOrigin || d.id !== channelId) return;
      if (d.type === "layout") frameLayout(d.clearance);
      if (d.type === "visibility") frameVisibility(d.visible);
      if (d.type === "control") childControl(d.action);
      if (d.type === "state") {
        receiveDocked(d.docked);
        remoteState = {present:d.present === true, playing:d.playing === true, loading:d.loading === true,
          title:typeof d.title === "string" ? d.title.slice(0, 120) : "", line:typeof d.line === "string" ? d.line.slice(0, 240) : ""};
        paintCluster(remoteState);
      }
      return;
    }
    if (keeper && keeper.el.contentWindow && e.source === keeper.el.contentWindow) {
      if (e.origin === keeper.origin && d.id === keeper.id && d.type === "owner") ownerState(keeper, d);
      return;
    }
    if (!frame || e.source !== frame.contentWindow || e.origin !== frameOrigin) return;
    if (d.type === "hello") { frameAlive = true; send({type:"attach", clearance:frameClearance || 152, visible:open, docked:docked()}); return; }
    /* the World's own head says it is alive, then that it has painted (mnet.html; no data, only the word): the frame keeps
       quiet while it is alive, and shows the World the moment it is painted, before the bridge has even loaded there */
    if (d.type === "alive") { frameAlive = true; return; }
    if (d.type === "painted") { frameAlive = true; if (!frameReady) { status.hidden = true; clearTimeout(quietTimer); } return; }
    if (d.id !== channelId) return;
    if (d.type === "ready") { frameReady = true; status.hidden = true; clearTimeout(readyTimer); clearTimeout(quietTimer); status.classList.remove("is-quiet"); send({type:"visibility", visible:open}); sendState(); }
    else if (d.type === "controls-position" && controls && open && !docked()) {
      if (d.top === null) { controls.style.removeProperty("top"); controls.style.removeProperty("right"); }
      else if (Number.isFinite(d.top) && d.top >= 65 && d.top <= root.innerHeight - 65) {
        // Translate frame-local coordinates once: the installed frame can
        // begin below the status area and end before a landscape notch.
        var frameRect = frame.getBoundingClientRect();
        var top = Math.round(d.top + frameRect.top);
        if (top > root.innerHeight - 65) return;
        controls.style.top = top + "px";
        if (Number.isFinite(d.right) && d.right >= 0 && d.right <= root.innerWidth - 52) {
          var right = Math.round(d.right + root.innerWidth - frameRect.right);
          if (right >= 0 && right <= root.innerWidth - 52) controls.style.right = right + "px";
        }
      }
    }
    else if (d.type === "music") closeWorld(true);
    else if (d.type === "owner") ownerState(frameRecord(), d);
    else if (d.type === "open" && typeof d.href === "string" && d.href.length <= 2048) {
      // the page in the frame asked to go somewhere: the host goes there and keeps the song; a page that must be the top
      // document (sign-in, account, checkout) never comes through here, the frame opens those at the top itself
      if (!navigate(d.href) && surfaceURL(d.href)) openWorld(d.href, {surface:true, gesture:false});
    }
    else if (d.type === "pause") pause();
    else if (d.type === 'address-suggestions' && typeof d.active === 'boolean') {
      addressSuggestionsOpen = d.active;
      suspendTransportForSuggestions(d.active);
    }
  });
  doc.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download") || a.closest(".world-audio-status,#mccAuthChip,#mccProfileMenu,#mccDestinations")) return;
    if (navigate(a.href, true)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // after the page's own handlers: a link none of them took, while music plays here (or this is the page in the frame)
  doc.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download") || a.closest(".world-audio-status,#mccAuthChip,#mccProfileMenu,#mccDestinations")) return;
    if (navigate(a.href)) e.preventDefault();
  });
  /* A TAP THAT LEAVES THE WORLD DOES NOT START ITS SONG (owner, 2026-10-20: no flashes). A bar tab (Music, the M) or the
     account chip goes to another page; starting the World's song on that tap played half a second of it on the way out. */
  var LEAVING = ".appbar,.mcc-auth-chip";
  doc.addEventListener("pointerdown", function (e) {
    if (!e.isTrusted || e.target.closest?.("#mccWorldAudioControls,#mnWorldPlay,video,audio," + LEAVING)) return;
    touch();
  }, {capture:true, passive:true});
  doc.addEventListener("keydown", function (e) { if (e.isTrusted && (e.key === "Enter" || e.key === " ") && !e.target.closest?.("#mccWorldAudioControls,#mnWorldPlay," + LEAVING)) touch(); }, true);
  doc.addEventListener("play", function (e) { if (attached) childPlay(e.target); }, true);
  doc.addEventListener("pointerdown", function (e) { if (e.isTrusted) lastGesture = Date.now(); }, {capture:true, passive:true});
  doc.addEventListener("keydown", function (e) { if (e.isTrusted) lastGesture = Date.now(); }, true);
  root.addEventListener("mcc:music-selected", function () { if (attached) childWatch(); });
  if (root.parent !== root && TRUSTED.indexOf(location.origin) !== -1) {
    var referrer = urlOf(doc.referrer);
    if (referrer && TRUSTED.indexOf(referrer.origin) !== -1) root.parent.postMessage({channel:CHANNEL, type:"hello"}, referrer.origin);
  }
  // Refreshing the World view keeps the destination. Browser refresh naturally
  // ends the old document/audio; the new document waits for its next gesture.
  var reopened = new URLSearchParams(location.search);
  if ((musicSurface() || IS_WORLD && root.parent === root) && (reopened.get("world") === "1" || reopened.get("surface") === "1")) {
    var initial = new URL(location.href); initial.searchParams.delete("world"); initial.searchParams.delete("surface"); baseHref = initial.href;
    var saved = history.state && history.state.mccWorldAudio;
    if (saved && saved.href) openWorld(saved.href, {history:true, gesture:false, surface:true});
    else if (reopened.get("world") === "1" && musicSurface()) openWorld("https://mccluster.org/?view=feed", {history:true, gesture:false});
    else history.replaceState(history.state, "", baseHref);
  }
})(window);
