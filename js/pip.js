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
  var ownsPlayer = !!window.MCC_MUSIC || /(^|\/)(album|index)\.html$/.test(location.pathname) ||
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
     wins only when it is genuinely newer, which is when another device played
     since this one did (resume across devices, decision D-8, a default pending
     Matthew; it was asked only when this device had nothing at all, so a phone
     with yesterday's record never heard what the laptop played today). */
  /* WHO ASKS. Pages that load js/backend.js reach the row through MCC_SUPA, as before. The listen page and
     the artist page do not load it; there the shared sign-in (js/mcc-auth.js) makes the call, with a fresh
     token and one more try after a refusal (MCC.authFetch, music slice M4), so a member's listen page can
     read and write the same row (resume across devices, decision D-8). */
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  function asker() {
    var S = window.MCC_SUPA, M = window.MCC;
    if (S && S.url && S.key && S.token) {
      return { url: S.url, key: S.key, uid: function () { return S.uid && S.uid(); },
        call: function (url, opts) {
          return S.token().then(function (tok) {
            if (!tok) return null;
            opts.headers.Authorization = "Bearer " + tok;
            return fetch(url, opts);
          });
        } };
    }
    if (M && typeof M.authFetch === "function" && typeof M.account === "function") {
      return { url: SB_URL, key: SB_KEY, uid: function () {
          var a = M.account();
          return a && /^[0-9a-f-]{36}$/i.test(a) ? a : null;
        },
        call: function (url, opts) { return M.authFetch(url, opts); } };
    }
    return null;
  }
  function signedIn() {
    var a = asker();
    return !!(a && a.uid());
  }

  /* NOT PROVISIONED IS AN ANSWER, NOT A RETRY. When the listener_state table
     is not there (PostgREST answers 404 / PGRST205), every signed-in page
     was sending a read and a write per song that could only fail. One 404
     parks the sync on this device for a day; once the table exists the next
     day's first call finds it and the mirror resumes on its own. */
  var PARK = "mcc_pocket_remote_parked";
  function parked() {
    try { return Number(localStorage.getItem(PARK) || 0) > Date.now(); } catch (e) { return false; }
  }
  function park() {
    try { localStorage.setItem(PARK, String(Date.now() + 24 * 3600 * 1000)); } catch (e) {}
  }

  function remote(method, body, keepalive) {
    if (!signedIn() || parked()) return Promise.resolve(null);
    var a = asker(), uid = a.uid();
    var headers = { apikey: a.key };
    var url = a.url + "/rest/v1/listener_state";
    var opts = { method: method, headers: headers, cache: "no-store" };
    /* The last write of a listen happens as the page is being torn down,
       and an ordinary fetch is cancelled the moment that starts. keepalive
       hands the request to the browser to finish without us. */
    if (keepalive) opts.keepalive = true;
    if (method === "GET") {
      url += "?profile_id=eq." + encodeURIComponent(uid) + "&select=state,updated_at&limit=1";
    } else {
      headers["Content-Type"] = "application/json";
      headers.Prefer = "resolution=merge-duplicates,return=minimal";
      opts.body = JSON.stringify({ profile_id: uid, state: body });
    }
    return Promise.resolve().then(function () { return a.call(url, opts); }).then(function (r) {
      if (!r) return null;
      if (r.status === 404) { park(); return null; }
      if (!r.ok) return null;
      return r.status === 204 ? null : r.json().catch(function () { return null; });
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
  /* THE LAST WRITE IS THE ONE THAT MATTERS, AND IT USED TO BE THE ONE DROPPED.
     Ten seconds is the right spacing for a position being written while a
     record plays. It is the wrong rule for the write that happens as somebody
     walks away: that one carries the second they actually left on, and the
     throttle was silently eating it whenever they left within ten seconds of
     the last tick. `force` is every teardown path; the throttle keeps the
     steady state cheap. */
  function pushRemote(s, force) {
    if (!s || !signedIn()) return;
    var now = Date.now();
    if (!force && now - lastPush < 10000) return;   /* a position, not a telemetry stream */
    lastPush = now;
    remote("POST", s, force);
  }

  /* ---------- the album side: keep the position current ---------- */
  window.MCC_POCKET = {
    /* called by the album as it plays; force on the way out of the page */
    save: function (s, force) { write(s); pushRemote(s, force); },
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

  /* BEFORE ANY SOUND, THE DEVICE IS TOLD THIS IS MUSIC. js/now-playing.js
     holds the one rule (the playback audio session iOS keeps going with the
     screen locked) for every player. The music pages carry it already; the
     pocket rides about fifty others, so it fetches the helper itself and only
     mounts once it has run (or failed, or two and a half seconds passed: a
     hung request never strands the record). */
  function audioSession() { if (window.MCC_NOW_PLAYING) window.MCC_NOW_PLAYING.claim(); }
  function withNowPlaying(go) {
    if (window.MCC_NOW_PLAYING) { go(); return; }
    var done = false, once = function () { if (!done) { done = true; go(); } };
    var tag = document.querySelector("script[data-mcc-now-playing]");
    if (!tag) {
      tag = document.createElement("script");
      tag.src = abs("js/now-playing.js?v=__STAMP__");
      tag.setAttribute("data-mcc-now-playing", "");
      document.head.appendChild(tag);
    }
    tag.addEventListener("load", once);
    tag.addEventListener("error", once);
    setTimeout(once, 2500);
  }

  var st = read();

  /* A signed-in listener's other devices may have played since this one did:
     the shared row is asked (for a second and a half at most, so a slow
     network never strands the record), and it wins only when it is newer.
     Anonymous visitors, which is most of them, go straight on with what this
     device holds, or fall out here when it holds nothing. */
  if (!st && !signedIn()) return;
  var asked = signedIn()
    ? Promise.race([pullRemote(), new Promise(function (done) { setTimeout(function () { done(null); }, 1500); })])
    : Promise.resolve(null);
  asked.then(function (far) {
    if (far) {
      /* Arriving from another device is not a reason to start making noise:
         autoplay would be refused here anyway, and a record the listener
         started on their phone should not ambush their laptop. Hold it. */
      far.playing = false;
      write(far);
      withNowPlaying(function () { begin(far); });
      return;
    }
    if (st) withNowPlaying(function () { begin(st); });
  });

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
      /* AirPlay where WebKit offers it, shown while a device is in range (js/now-playing.js; decision D-8) */
      + '<button class="pocket__air" type="button" aria-label="Play on another device" hidden>'
      + '<svg class="pocket__airic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12h-7"/><path d="M3 10a10 10 0 0 1 8 8"/><path d="M3 14a6 6 0 0 1 4.5 4.5"/><path d="M3 18h.5"/></svg>'
      + "</button>"
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
    var musicVideo = st.music_video || st.video || "";
    if (musicVideo) { film.src = abs(musicVideo); film.load(); }

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
  }

  /* ---------- the lock screen ---------- */

  /* WHAT MAKES IT A PLAYER RATHER THAN A PAGE THAT MAKES NOISE.

     Without this the record is an anonymous sound: the lock screen shows
     nothing, the headphone button does nothing, and pausing means finding the
     tab again. The device's Now Playing gets the title, the record and the
     artwork, and its controls come back to this widget, so it behaves like
     every other thing that plays music on the device.

     One owner writes the lock screen for every player (js/now-playing.js):
     the pocket says which record it holds and what play, pause, previous,
     next and stop mean here. It had no previous, and it showed the film's
     poster unsized; the cover now is the album's own, at its true size and
     type (music slice M2). */
  var np = null, albumInfo = null;
  function nowPlaying() {
    if (np || !audio || !window.MCC_NOW_PLAYING || !window.MCC_NOW_PLAYING.bind) return np;
    np = window.MCC_NOW_PLAYING.bind(audio, {
      surface: "pocket",
      track: function () {
        var a = albumInfo || {};
        return { title: st.title || "The record", artist: st.artist || a.artist || "Matthew McCluster",
          album: a.name || albumName(st.album), art: st.art || a.art || "" };
      },
      play: function () { if (audio && audio.paused) toggle(); },
      pause: function () { if (audio && !audio.paused) toggle(); },
      previous: function () { if (audio) back(); },
      next: function () { if (audio) advance(); },
      /* the OS stop control means the same thing the X means */
      stop: shut
    });
    return np;
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
    /* the song the album was playing goes on here: keep counting it */
    ledger(function (L) { if (!pocketListen) pocketListen = L.adopt(L.keyOf(st.src), pocketPlaying); });

    nowPlaying();
    if (window.MCC_NOW_PLAYING && window.MCC_NOW_PLAYING.airplay) window.MCC_NOW_PLAYING.airplay(box.querySelector(".pocket__air"), audio);

    /* A record that was paused when they left stays paused. Mounting it held
       gives them the transport back without starting sound they stopped. */
    if (!shouldResume) {
      playIc.setAttribute("d", ICON.play);
      box.classList.add("is-held");
      sub(wasPlaying ? "Tap to pick it back up" : albumName(st.album));
      return;
    }

    audioSession();
    var pr = audio.play();
    if (pr && pr.then) {
      pr.then(function () {
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
    stash(!audio.paused);
  }

  /* the position is written back continuously, so the album resumes here
     and so does the next page they open */
  var lastStash = 0;
  function stash(playing, force) {
    if (stopped) return;
    var now = Date.now();
    if (!force && now - lastStash < 900) return;
    lastStash = now;
    st.t = audio ? audio.currentTime : st.t;
    st.playing = !!playing;
    st.at = now;
    write(st);
    pushRemote(st, force);
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
        albumInfo = alb ? { name: alb.name || "", art: alb.art || "", artist: alb.artist || "" } : null;
        if (np) np.update();
        return queue;
      })
      .catch(function () { queue = []; return queue; });
  }

  /* THE LISTEN LEDGER rides along. A song the pocket rolls into starts from
     the top, so a signed-in listener's full listens here count toward an
     earned record exactly as they do on the album (js/listen-ledger.js;
     the API times them). The ledger script is only fetched for somebody
     signed in, and the gated record never counts toward itself. */
  var pocketListen = null;
  function pocketPlaying() { return !!audio && !audio.paused; }
  function signedInHere() {
    try {
      var s = JSON.parse(localStorage.getItem("mccdb_session") || "null");
      return !!(s && s.access_token);
    } catch (e) { return false; }
  }
  function ledger(cb) {
    if (window.MCC_LISTENS) { cb(window.MCC_LISTENS); return; }
    if (!signedInHere()) return;
    var tag = document.createElement("script");
    tag.src = abs("js/listen-ledger.js");
    tag.onload = function () { if (window.MCC_LISTENS) cb(window.MCC_LISTENS); };
    document.head.appendChild(tag);
  }

  function advance() { roll(1); }
  /* back: the top of this song once it is a few seconds in, as the album's
     own previous does; otherwise the song before it on the record */
  function back() {
    if (audio && audio.currentTime > 4) { try { audio.currentTime = 0; } catch (e) {} return; }
    roll(-1);
  }
  function roll(step) {
    /* ended or skipped: the API decides whether the song was heard through */
    if (pocketListen && window.MCC_LISTENS) window.MCC_LISTENS.finish(pocketListen);
    pocketListen = null;
    var go = function (list) {
      var i = -1;
      for (var k = 0; k < list.length; k++) if (list[k].src === st.src) { i = k; break; }
      var next = list.length ? list[(i + step + list.length) % list.length] : null;
      /* no album, or an album of one: hold rather than loop a single track
         forever, which is a different promise than "keep the record going";
         the lock screen is handed back, the queue having ended */
      if (!next || next.src === st.src) { stash(false); box.classList.add("is-held"); if (np) np.clear(); return; }

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
      if (np) np.update();   /* the lock screen is showing the last song otherwise */

      audio.src = abs(st.src);
      audio.currentTime = 0;
      audioSession();
      var pr = audio.play();
      if (pr && pr.then) {
        pr.then(function () {
          var fp = film.play(); if (fp && fp.catch) fp.catch(function () {});
        }).catch(markBlocked);
      }
      lastStash = 0;
      stash(true);
      if (!next.gated) ledger(function (L) { pocketListen = L.start(L.keyOf(next), pocketPlaying); });
      if (window.MCC_TRACK) window.MCC_TRACK("pocket_advance", { song: st.title, step: step });
    };
    if (queue) go(queue); else loadAlbum().then(go);
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
      audioSession();
      var pr = audio.play();
      if (pr && pr.then) {
        pr.then(function () {
          blocked = false;
          box.classList.remove("is-held");
          playIc.setAttribute("d", ICON.pause);
          sub(albumName(st.album));
          var fp = film.play(); if (fp && fp.catch) fp.catch(function () {});
        }).catch(markBlocked);
      }
    } else {
      audio.pause();
      film.pause();
      playIc.setAttribute("d", ICON.play);
      stash(false);
    }
  }

  function shut() {
    stopped = true;
    if (audio) { audio.pause(); audio.src = ""; audio = null; }
    /* Hand the lock screen back. Leaving stale metadata there implies a
       player that no longer exists. */
    if (np) np.clear();
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
    /* ============================================================
       LEAVING IS NOT ONE EVENT, AND pagehide IS THE ONE THAT FIRES LEAST.

       This used to bank the second on `pagehide` alone. That covers a
       navigation inside the browser and almost nothing else. Switch to
       another app — which on a phone is most of how people leave — and
       the page is merely HIDDEN: `pagehide` never fires, and if the
       system later reclaims the tab to free memory, as iOS and the
       Instagram and Facebook in-app browsers do aggressively, the
       position dies with it. The record came back at the top, which is
       exactly the complaint.

       `visibilitychange` to hidden is the one signal every mobile
       browser actually delivers, and it is delivered while the page is
       still alive enough to write. It is the primary save now;
       `pagehide` stays for the in-browser navigation it does cover.
       Both force, because the second somebody walked on is worth more
       than the throttle that was dropping it.
       ============================================================ */
    function bank() {
      if (stopped || !audio) return;
      lastStash = 0;
      stash(!audio.paused, true);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") bank();
    });
    window.addEventListener("pagehide", bank);

    /* COMING BACK IS NOT ALWAYS A LOAD.

       Back button and app-switch return can restore this page from the
       back/forward cache, where no script re-runs: `mount()` already
       happened, `st` is whatever it was, and meanwhile the album page or
       another tab may have moved the record on. Re-reading on a restored
       show is what keeps the tile honest about where the music is. */
    window.addEventListener("pageshow", function (e) {
      if (!e || !e.persisted || stopped || !audio) return;
      var fresh = read();
      if (!fresh || !fresh.src || (fresh.at || 0) <= (st.at || 0)) return;
      /* ONLY THE SECOND IS CORRECTED HERE, AND ONLY FOR THE SAME RECORD.
         A restored tile still has the title, film and lyric of whatever it
         mounted with. If the listener moved to a different track on another
         page, adopting that state without rebuilding the tile would seek
         this audio to a position belonging to a song the tile is not
         showing. A different record is left alone: the tile is still
         holding a real one, and the next navigation rebuilds it properly. */
      if (fresh.src !== st.src) return;
      st = fresh;
      if (Math.abs((audio.currentTime || 0) - (st.t || 0)) > 2) {
        try { audio.currentTime = st.t || 0; } catch (err) {}
      }
    });
    if (window.MCC_TRACK) window.MCC_TRACK("pocket_open", { song: st.title });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  }   /* begin() */
})();
