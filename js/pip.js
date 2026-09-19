/* ============================================================
   THE POCKET — the record follows you off the album page.

   Leave a YouTube video and it shrinks into the corner and keeps
   going. This is that for the catalogue: the film, the lyric
   line, the title and the transport, minimised to a tile that
   rides every other page. Tap it and you land back on the album
   exactly where you left — same track, same second, sheet open.

   HOW IT SURVIVES A PAGE LOAD. This is a real multi-page site,
   so navigating destroys the <audio> element; nothing can carry
   a playing buffer across that. What carries instead is the
   POSITION. The album writes {track, second, playing, stamp} as
   it plays; every other page reads it, rebuilds the same track,
   and seeks to second + however long the navigation took. The
   gap is the length of a page load, and the widget picks the
   record up mid-bar rather than restarting it.

   WHERE IT IS HONEST. Autoplay policy does not transfer across a
   navigation: a browser that has not decided you are engaged
   with this origin will refuse play() on the new page, and no
   amount of wanting changes that. So the tile mounts either way,
   holding the film, the lyric and the timestamp — and if the
   resume was refused it says "Tap to pick it back up" instead of
   sitting there silently pretending to play.
   ============================================================ */
(function () {
  "use strict";

  var KEY = "mcc-pocket";

  /* IT OUTLIVES THE TAB, NOT THE STOP BUTTON.

     This used to bank the position in sessionStorage, which is scoped to one
     tab and thrown away the moment that tab closes. Open a link in a new tab
     and the record was gone; close the browser and it was gone. localStorage
     is the same API with the lifetime the promise actually needs.

     What it does NOT buy is playback after the tab closes. Nothing does — a
     closed tab has no document, no <audio> and no script, and a service
     worker cannot play sound. What survives is the POSITION, so the next
     page, the next tab, or tomorrow morning picks the record up where it was
     rather than at the top.

     Read falls back to the old session key once, so a listener mid-record
     when this shipped does not get reset by the upgrade. */
  var LEGACY_KEY = KEY;

  /* Auto-resume is for continuing a listen, not for ambushing someone who
     opened the site again the next day. Past this gap the tile still mounts
     holding the record — it just waits to be told. */
  var RESUME_WINDOW_MS = 4 * 60 * 60 * 1000;

  /* EVERY PATH IN HERE IS RESOLVED, NOT RELATIVE.

     The pocket used to ride twenty-eight root-level pages, so "album.html"
     and "data/albums.json" happened to be correct. It rides every page
     that takes the bar now, including the walls and the closet, which sit
     a directory down: there a relative href points at closet/album.html
     and the album fetch 404s. Same trick js/tabbar.js uses. */
  var ROOT = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/js\/pip\.js.*$/, "") : "";
  })();
  var HOME = ROOT + "album.html";
  var abs = function (u) {
    return !u || /^([a-z]+:)?\/\//i.test(u) || u.charAt(0) === "/" ? u : ROOT + u;
  };

  /* TWO PAGES OWN A REAL PLAYER, AND THE POCKET DEFERS TO BOTH.

     The album always did. The front page does too: it has a six-track
     scene engine wired to the scroll and its own sound toggle, so a
     pocket tile there would be a second record playing over the first.
     Both of those pages read the same banked position and resume it
     themselves; everywhere else, this widget is the player. */
  var ownsPlayer = /(^|\/)(album|index)\.html$/.test(location.pathname) ||
    /\/$/.test(location.pathname);

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) raw = sessionStorage.getItem(LEGACY_KEY);   /* one-time carry-over */
      var s = JSON.parse(raw || "null");
      return s && s.src ? s : null;
    } catch (e) { return null; }
  }
  function write(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }
  /* Stop means stopped. Both stores are cleared, so nothing resurrects the
     record on the next page, the next tab, or the next visit. */
  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    try { sessionStorage.removeItem(LEGACY_KEY); } catch (e) {}
  }

  /* ---------- the other device ----------

     localStorage follows a listener across pages, tabs and restarts, but it
     stops at the edge of the machine. For someone signed in, the position is
     mirrored to one row so the phone can pick up where the laptop was.

     Deliberately best-effort and silent. Most traffic here is anonymous, the
     sync is a convenience rather than the mechanism, and a listener whose
     network drops mid-song should not be told about a failed write of a
     number. Local state stays authoritative for the session; the remote row
     only ever wins on first mount, and only when it is genuinely newer. */
  function signedIn() {
    return Boolean(window.MCC_SUPA && window.MCC_SUPA.url && window.MCC_SUPA.key && window.MCC_SUPA.token);
  }

  function remote(method, body) {
    if (!signedIn()) return Promise.resolve(null);
    return window.MCC_SUPA.token().then(function (tok) {
      if (!tok) return null;
      var uid = window.MCC_SUPA.uid && window.MCC_SUPA.uid();
      if (!uid) return null;
      var headers = { apikey: window.MCC_SUPA.key, Authorization: "Bearer " + tok };
      var url = window.MCC_SUPA.url + "/rest/v1/listener_state";
      var opts = { method: method, headers: headers, cache: "no-store" };
      if (method === "GET") {
        url += "?profile_id=eq." + encodeURIComponent(uid) + "&select=state,updated_at&limit=1";
      } else {
        headers["Content-Type"] = "application/json";
        headers.Prefer = "resolution=merge-duplicates,return=minimal";
        opts.body = JSON.stringify({ profile_id: uid, state: body });
      }
      return fetch(url, opts).then(function (r) {
        if (!r.ok) return null;
        return r.status === 204 ? null : r.json().catch(function () { return null; });
      });
    }).catch(function () { return null; });
  }

  function pullRemote() {
    return remote("GET", null).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : null;
      var far = row && row.state;
      if (!far || !far.src) return null;
      var near = read();
      /* The newer listen wins. A stale row must never drag a listener
         backwards into a song they already moved on from. */
      if (near && (near.at || 0) >= (far.at || 0)) return null;
      return far;
    }).catch(function () { return null; });
  }

  var lastPush = 0;
  function pushRemote(s) {
    if (!s || !signedIn()) return;
    var now = Date.now();
    if (now - lastPush < 10000) return;   /* a position, not a telemetry stream */
    lastPush = now;
    remote("POST", s);
  }

  /* ---------- the album side: keep the position current ---------- */
  window.MCC_POCKET = {
    /* called by the album as it plays */
    save: function (s) { write(s); pushRemote(s); },
    read: read,
    /* Local only. The front page calls this whenever its sound toggle is off,
       which is not the same statement as "this listener has stopped the
       record everywhere" — clearing the shared row from here would let a
       muted laptop erase the position a phone is still playing. Only an
       explicit stop clears the other device; see shut(). */
    clear: clear,
    clearEverywhere: function () { clear(); if (signedIn()) remote("POST", {}); },
    pull: pullRemote,
    key: KEY,
  };
  if (ownsPlayer) return;   // those pages have a better player than this one

  var st = read();

  /* A device that has never played anything has nothing local to go on. If
     the listener is signed in, the record they left on another device is
     worth asking for — that is the whole point of the shared row. Anonymous
     visitors, which is most of them, fall out here immediately. */
  if (!st) {
    if (!signedIn()) return;
    pullRemote().then(function (far) {
      if (!far) return;
      /* Arriving from another device is not a reason to start making noise:
         autoplay would be refused here anyway, and a record the listener
         started on their phone should not ambush their laptop. Hold it. */
      far.playing = false;
      write(far);
      begin(far);
    });
    return;
  }
  begin(st);

  function begin(state) {
  st = state;

  /* PAUSED IS NOT STOPPED, AND USED TO BE TREATED AS BOTH.

     The tile only mounted when the banked state said `playing`. So pausing
     the record and then following a link lost the player outright: no tile,
     no transport, and the only way back to the song was to go and find the
     album again. Pausing is an instruction to hold the record, not to put it
     away — the X does that. The tile mounts for any banked record now and
     simply starts in the held state when it was paused. */
  var wasPlaying = !!st.playing;

  /* how long the navigation actually took — the record kept moving in the
     listener's head, so meet it where it would be */
  var elapsedMs = st.at ? Math.max(0, Date.now() - st.at) : 0;
  var drift = elapsedMs / 1000;
  var startAt = (st.t || 0) + (wasPlaying ? Math.min(drift, 30) : 0);   // a long gap is a new session, not a seek

  /* Resume only continues a listen that was actually in progress. */
  var shouldResume = wasPlaying && elapsedMs < RESUME_WINDOW_MS;

  var box, audio, film, lyrEl, playIc, blocked = false;
  /* Set by shut(). Without it, the pagehide handler below re-banks the
     position on the way out of the page and the record the listener just
     stopped reappears on the next one — stop that only lasts until you click
     a link is not stop. */
  var stopped = false;

  var ICON = {
    play: "M8 5l11 7-11 7z",
    pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  };

  function svg(d, cls) {
    return '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  function build() {
    box = document.createElement("div");
    box.className = "pocket";
    box.setAttribute("aria-label", "Now playing, minimised");
    box.innerHTML =
      '<a class="pocket__tile" href="' + HOME + '" aria-label="Back to the album">'
      + '<video class="pocket__film" muted loop playsinline preload="none"></video>'
      + '<span class="pocket__scrim" aria-hidden="true"></span>'
      + '<span class="pocket__lyr"></span>'
      + "</a>"
      + '<div class="pocket__body">'
      + '<a class="pocket__title" href="' + HOME + '"></a>'
      + '<span class="pocket__sub"></span>'
      + "</div>"
      + '<button class="pocket__play" type="button" aria-label="Play or pause">' + svg(ICON.pause) + "</button>"
      + '<button class="pocket__x" type="button" aria-label="Close the player">'
      + svg("M6 6l12 12M18 6L6 18", "pocket__xic") + "</button>"
      + '<i class="pocket__bar"><b></b></i>';
    document.body.appendChild(box);

    film = box.querySelector(".pocket__film");
    lyrEl = box.querySelector(".pocket__lyr");
    playIc = box.querySelector(".pocket__play svg path");
    box.querySelector(".pocket__title").textContent = st.title || "The record";
    box.querySelector(".pocket__sub").textContent = albumName(st.album);

    if (st.poster) film.poster = abs(st.poster);
    if (st.video) { film.src = abs(st.video); film.load(); }

    /* the masthead pill lives in this exact corner at this exact height, so
       the page is told the pocket is here and the pill steps up above it */
    document.documentElement.classList.add("pocket-on");
    requestAnimationFrame(function () { box.classList.add("is-in"); });
  }

  /* the row carries the album SLUG, which is a URL word, not a record title */
  function albumName(slug) {
    if (!slug) return "I AM HERE";
    if (slug === "here") return "I AM HERE";
    return slug.replace(/-/g, " ").toUpperCase();
  }
  function sub(text) { box.querySelector(".pocket__sub").textContent = text; }

  function markBlocked() {
    blocked = true;
    box.classList.add("is-held");
    playIc.setAttribute("d", ICON.play);
    sub("Tap to pick it back up");
    setPlaybackState("paused");
  }

  /* ---------- the lock screen ---------- */

  /* WHAT MAKES IT A PLAYER RATHER THAN A PAGE THAT MAKES NOISE.

     Without this the record is an anonymous sound: the lock screen shows
     nothing, the headphone button does nothing, and pausing means finding the
     tab again. MediaSession hands the OS the title, the record and the
     artwork, and wires the hardware controls back to this widget — so it
     behaves like every other thing that plays music on the device, including
     while the phone is locked and the browser is in the background.

     The album page already did this; the pocket did not, so control was lost
     the moment the listener left that one page. */
  function media() {
    return ("mediaSession" in navigator) ? navigator.mediaSession : null;
  }

  function setPlaybackState(state) {
    var m = media();
    if (!m) return;
    try { m.playbackState = state; } catch (e) {}
  }

  function setMetadata() {
    var m = media();
    if (!m || typeof window.MediaMetadata !== "function") return;
    var art = [];
    if (st.poster) {
      var poster = abs(st.poster);
      /* One entry, unsized: the OS picks it up and scales it. Claiming sizes
         we have not verified would just be wrong metadata. */
      art.push({ src: poster });
    }
    try {
      m.metadata = new window.MediaMetadata({
        title: st.title || "The record",
        artist: st.artist || "Matthew McCluster",
        album: albumName(st.album),
        artwork: art,
      });
    } catch (e) {}
  }

  function wireMediaControls() {
    var m = media();
    if (!m || !m.setActionHandler) return;
    var on = function (name, fn) {
      try { m.setActionHandler(name, fn); } catch (e) {}   /* unsupported action */
    };
    on("play", function () { if (audio && audio.paused) toggle(); });
    on("pause", function () { if (audio && !audio.paused) toggle(); });
    on("nexttrack", function () { if (audio) advance(); });
    /* The OS stop control means the same thing the X means. */
    on("stop", shut);
    on("seekto", function (d) {
      if (!audio || !d || typeof d.seekTime !== "number") return;
      try { audio.currentTime = d.seekTime; } catch (e) {}
    });
  }

  /* The scrubber on the lock screen needs a duration to draw. */
  function setPositionState() {
    var m = media();
    if (!m || !m.setPositionState || !audio || !audio.duration) return;
    if (!Number.isFinite(audio.duration)) return;
    try {
      m.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime, audio.duration),
      });
    } catch (e) {}
  }

  function start() {
    /* a real node in the widget, not a detached `new Audio()`. It costs
       nothing and it means the element is inspectable, stylable and part of
       the document the browser reasons about for media policy. */
    audio = document.createElement("audio");
    audio.className = "pocket__audio";
    audio.setAttribute("src", abs(st.src));
    audio.preload = "auto";
    box.appendChild(audio);
    /* No `currentTime = 0` here: a fresh element is already at zero, and
       assigning before metadata exists only queues a redundant seek.

       Worth knowing if resume ever looks broken: seeking needs the audio host
       to answer HTTP range requests. Served without Accept-Ranges the media is
       not seekable, the seek below is accepted and then quietly ignored, and
       every resume starts the record from the top. */
    audio.addEventListener("loadedmetadata", function () {
      try { audio.currentTime = Math.min(startAt, Math.max(0, audio.duration - 0.5)); } catch (e) {}
    });
    audio.addEventListener("timeupdate", tick);
    /* IT ENDS WHEN THEY END IT.

       This used to stop dead on the last bar and put the tile in the held
       state: one song, then silence, and the only way back was to go find
       the album again. The record has five more tracks after that one, so
       the pocket rolls into the next of them and keeps rolling, wrapping at
       the end of the album. The stop button and the X are still right
       there, which is the point: the listener ends it, the file does not
       end it for them. */
    audio.addEventListener("ended", advance);
    audio.addEventListener("durationchange", setPositionState);

    setMetadata();
    wireMediaControls();

    /* A record that was paused when they left stays paused. Mounting it held
       gives them the transport back without starting sound they stopped. */
    if (!shouldResume) {
      playIc.setAttribute("d", ICON.play);
      box.classList.add("is-held");
      sub(wasPlaying ? "Tap to pick it back up" : albumName(st.album));
      setPlaybackState("paused");
      return;
    }

    var pr = audio.play();
    if (pr && pr.then) {
      pr.then(function () {
        setPlaybackState("playing");
        setPositionState();
        var fp = film.play();
        if (fp && fp.catch) fp.catch(function () {});
      }).catch(markBlocked);
    }
  }

  function tick() {
    if (!audio || !audio.duration) return;
    var b = box.querySelector(".pocket__bar b");
    if (b) b.style.width = ((audio.currentTime / audio.duration) * 100).toFixed(2) + "%";
    if (lyric.lines.length) lyric.at(audio.currentTime);
    setPositionState();   /* keeps the lock-screen scrubber honest */
    stash(!audio.paused);
  }

  /* the position is written back continuously, so the album resumes here
     and so does the next page they open */
  var lastStash = 0;
  function stash(playing) {
    if (stopped) return;
    var now = Date.now();
    if (now - lastStash < 900) return;
    lastStash = now;
    st.t = audio ? audio.currentTime : st.t;
    st.playing = !!playing;
    st.at = now;
    write(st);
    pushRemote(st);
  }

  /* ---------- the lyric line, same source the album uses ---------- */
  var lyric = {
    lines: [],
    idx: -1,
    at: function (t) {
      var i = -1;
      for (var k = 0; k < this.lines.length; k++) {
        if (this.lines[k].t <= t) i = k; else break;
      }
      if (i === this.idx) return;
      this.idx = i;
      lyrEl.textContent = i > -1 ? this.lines[i].s : "";
      lyrEl.classList.remove("is-beat");
      void lyrEl.offsetWidth;
      lyrEl.classList.add("is-beat");
    },
  };

  /* ---------- rolling on: the rest of the record ---------- */
  var queue = null;      /* the album's tracks, once fetched */

  function loadAlbum() {
    return fetch(abs("data/albums.json"), { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var list = (d && d.albums) || [];
        /* match on the slug the album banked; fall back to the record that
           actually contains this file, so a renamed slug still rolls */
        var alb = list.filter(function (a) { return a.slug === st.album; })[0] ||
          list.filter(function (a) {
            return (a.tracks || []).some(function (t) { return t.src === st.src; });
          })[0];
        queue = alb ? (alb.tracks || []) : [];
        return queue;
      })
      .catch(function () { queue = []; return queue; });
  }

  function advance() {
    var roll = function (list) {
      var i = -1;
      for (var k = 0; k < list.length; k++) if (list[k].src === st.src) { i = k; break; }
      var next = list.length ? list[(i + 1) % list.length] : null;
      /* no album, or an album of one: hold rather than loop a single track
         forever, which is a different promise than "keep the record going" */
      if (!next || next.src === st.src) { stash(false); box.classList.add("is-held"); return; }

      st.src = next.src;
      st.video = next.video || "";
      st.poster = next.poster || "";
      st.lyrics = next.lyrics || "";
      st.title = next.title || "";
      st.t = 0;
      startAt = 0;
      lyric.lines = []; lyric.idx = -1; lyrEl.textContent = "";

      box.querySelector(".pocket__title").textContent = st.title || "The record";
      sub(albumName(st.album));
      if (st.poster) film.poster = abs(st.poster);
      if (st.video) { film.src = abs(st.video); film.load(); }
      loadLyrics();
      setMetadata();   /* the lock screen is showing the last song otherwise */

      audio.src = abs(st.src);
      audio.currentTime = 0;
      var pr = audio.play();
      if (pr && pr.then) {
        pr.then(function () {
          var fp = film.play(); if (fp && fp.catch) fp.catch(function () {});
        }).catch(markBlocked);
      }
      lastStash = 0;
      stash(true);
      if (window.MCC_TRACK) window.MCC_TRACK("pocket_advance", { song: st.title });
    };
    if (queue) roll(queue); else loadAlbum().then(roll);
  }

  function loadLyrics() {
    if (!st.lyrics || st.lyrics === "@inline") return;
    fetch(abs(st.lyrics), { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (txt) {
        /* [mm:ss.xx] lines only; an unsynced sheet has nothing to ride */
        txt.split("\n").forEach(function (ln) {
          var m = ln.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
          if (!m) return;
          var s = (m[3] || "").trim();
          if (s) lyric.lines.push({ t: +m[1] * 60 + parseFloat(m[2]), s: s });
        });
        lyric.lines.sort(function (a, b) { return a.t - b.t; });
      })
      .catch(function () {});
  }

  function toggle() {
    if (!audio) return;
    if (audio.paused) {
      var pr = audio.play();
      if (pr && pr.then) {
        pr.then(function () {
          blocked = false;
          box.classList.remove("is-held");
          playIc.setAttribute("d", ICON.pause);
          sub(albumName(st.album));
          setPlaybackState("playing");
          setPositionState();
          var fp = film.play(); if (fp && fp.catch) fp.catch(function () {});
        }).catch(markBlocked);
      }
    } else {
      audio.pause();
      film.pause();
      playIc.setAttribute("d", ICON.play);
      setPlaybackState("paused");
      stash(false);
    }
  }

  function shut() {
    stopped = true;
    if (audio) { audio.pause(); audio.src = ""; audio = null; }
    /* Hand the lock screen back. Leaving stale metadata there implies a
       player that no longer exists. */
    var m = media();
    if (m) {
      setPlaybackState("none");
      try { m.metadata = null; } catch (e) {}
      ["play", "pause", "nexttrack", "stop", "seekto"].forEach(function (name) {
        try { m.setActionHandler(name, null); } catch (e) {}
      });
    }
    /* The stop button is the one control that means it everywhere. */
    window.MCC_POCKET.clearEverywhere();
    document.documentElement.classList.remove("pocket-on");
    box.classList.remove("is-in");
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 300);
    if (window.MCC_TRACK) window.MCC_TRACK("pocket_close", { song: st.title });
  }

  function go() {
    if (window.MCC_TRACK) window.MCC_TRACK("pocket_return", { song: st.title });
  }

  function mount() {
    build();
    loadLyrics();
    /* warmed now, not at the last bar: fetching the record after the song
       has already ended is a gap of silence the listener hears */
    loadAlbum();
    start();
    box.querySelector(".pocket__play").addEventListener("click", toggle);
    box.querySelector(".pocket__x").addEventListener("click", shut);
    [].forEach.call(box.querySelectorAll('a[href="' + HOME + '"]'), function (a) {
      a.addEventListener("click", go);
    });
    /* leaving this page: bank the exact second so the next one continues it */
    window.addEventListener("pagehide", function () {
      if (stopped || !audio) return;
      lastStash = 0;
      stash(!audio.paused);
    });
    if (window.MCC_TRACK) window.MCC_TRACK("pocket_open", { song: st.title });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  }   /* begin() */
})();
