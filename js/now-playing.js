/* ============================================================
   NOW PLAYING — what every player tells the device.

   Matthew, 2026-11-19: "when I'm playing music and I leave the
   browser, it stops playing music ... Apple continues to play music.
   ... I can control the music from like my music engine when I swipe
   down my now playing and I need this to be the same for this site."
   This is the one place the site speaks to the device about music,
   shared by every player: the album deck and its shelf previews
   (album.html), the listen engine (js/music-engine.js), the pocket
   (js/pip.js), the World soundtrack (js/world-audio-continuity.js),
   the gateway score (js/gateway.js), the docket's release
   (docket-516.html), the music video feed (music-videos.html) and the
   embed (embed.html).

   THE AUDIO SESSION (slice M1). Safari (iOS and iPadOS 16.4 and later)
   lets a page say what kind of sound it makes:
   navigator.audioSession.type. "playback" is music: iOS keeps a
   playback session going when the screen locks or another app comes
   forward, and it ignores the silent switch, as Apple Music does.
   Chrome and Firefox have no such API, so claim() does nothing there.
   A session already set to "play-and-record" (a call or a recording on
   the page) is left alone. Every player calls claim() right before it
   calls play().

   THE LOCK SCREEN (slice M2). The page's Media Session is what iOS and
   iPadOS show on the lock screen and in Control Center, what AirPods
   double and triple presses reach, and what Android puts in its media
   notification. It belonged to nine players, each writing its own
   handlers: the World soundtrack wrote none (so WebKit offered play,
   pause and 15-second skips and no track buttons), the album added
   15-second skips beside previous and next, the pocket had no
   previous, the engine never sent its position. Now one owner writes
   it, from the player that is playing (music map 00, C2; 03, EXT-3):
     bind(media, spec) once per player element. The spec says what is
       playing (track(): title, artist, album, art) and what play,
       pause, previous and next mean for that surface (seek and stop
       when they mean more than the element's own). The element that
       plays owns the lock screen; previous and next on every surface,
       never a 15-second skip (decision D-4, a default pending
       Matthew).
     playbackState follows the element, or what the listener asked for
       when the player says so (spec.playing(): a song being picked up
       again after a dropped read is quiet, and the lock screen offers
       Pause, which stops the tries; music slice M3); setPositionState is sent on
       play, pause, seek, rate change and a new length, and at most
       once a second while it plays, with an unknown or endless length
       left unsaid and the position clamped to the song.
     handle.clear() when the player stops or its queue ends, so no
       title stands on the lock screen for a player that has stopped.
   Artwork is the supplied cover, whole, declared with the size and the
   type read from the file (the registry below, written and checked by
   scripts/music-artwork.mjs); a file this site cannot read (a creator's
   own artwork) goes as it is, with nothing claimed about it. What iOS
   draws from all this is Inferred until Matthew's own devices run the
   checklist (docs/music/MUSIC-RELEASE-20261119.md).

   AIRPLAY (decision D-8, a default pending Matthew). airplay(button,
   media) offers WebKit's AirPlay picker where WebKit has one, shown
   only while WebKit says a device is in range; elsewhere the button
   stays hidden. Nothing here plays one device's music on another's
   lock screen: no web API does that.

   THE IN-APP NOTE (decision D-6, slice M1). Most listeners of the last
   sixty days opened the album inside Instagram's own browser (music
   map 00, G-1). There the app, not this page, decides whether music
   keeps playing when the screen locks. On a music page inside such a
   browser one small line says where it does, until it is put away for
   the session; nothing redirects anyone.

   Every player loads this first: the music pages carry it before their
   players, js/tabbar.js loads it before the World soundtrack on every
   page with the bar, the pocket waits for it, the game hub imports it
   first, and the embed carries it.
   ============================================================ */
(function (root) {
  "use strict";
  if (root.MCC_NOW_PLAYING) return;
  var doc = root.document;
  /* the site's root, read off this script's own address, so a cover is the same file from any page */
  var ROOT = (function () {
    var s = doc && doc.currentScript && doc.currentScript.src;
    return s ? String(s).split(/[?#]/)[0].replace(/js\/now-playing\.js$/, "") : "";
  })();

  function audioSession() {
    var nav = root.navigator, s = nav && nav.audioSession;
    return s && typeof s === "object" ? s : null;
  }
  /* before every play(): this is music */
  function claim() {
    var s = audioSession();
    if (!s) return false;
    try {
      if (s.type === "playback") return true;
      if (s.type === "play-and-record") return false;
      s.type = "playback";
      return s.type === "playback";
    } catch (e) { return false; }
  }

  /* ---------- the covers: true size and type, read from the files ---------- */
  /* ARTWORK BEGIN: written by scripts/music-artwork.mjs from the files themselves; --check fails on a stale entry */
  var ARTWORK = {
    "assets/img/audio-engineer-cover.png": { sizes: "1254x1254", type: "image/png" },
    "assets/img/cia-mind-control-cover.jpg": { sizes: "544x246", type: "image/jpeg" },
    "assets/img/equity-uprise-logo.webp": { sizes: "160x160", type: "image/webp" },
    "assets/img/heal-the-3-cover.jpg": { sizes: "1024x1024", type: "image/jpeg" },
    "assets/img/here-cover.jpg": { sizes: "1024x682", type: "image/jpeg" },
    "assets/img/in-hot-pursuit-cover.jpg": { sizes: "1254x1254", type: "image/jpeg" },
    "assets/img/m-mark.png": { sizes: "256x256", type: "image/png" },
    "assets/img/prim3-logo.png": { sizes: "256x256", type: "image/png" },
    "assets/img/tinderfessions-cover.jpg": { sizes: "1400x1400", type: "image/jpeg" },
    "assets/img/vaunt-logo.webp": { sizes: "200x200", type: "image/webp" },
    "assets/img/wing-whip-poster.jpg": { sizes: "1280x890", type: "image/jpeg" }
  };
  /* ARTWORK END */
  function artKey(src) {
    var s = String(src || "").split(/[?#]/)[0];
    if (ROOT && s.indexOf(ROOT) === 0) s = s.slice(ROOT.length);
    else if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.indexOf("//") === 0) return null;   /* another host: not ours to describe */
    s = s.replace(/^\.?\//, "");
    return Object.prototype.hasOwnProperty.call(ARTWORK, s) ? s : null;
  }
  /* one entry: the whole supplied file. Its size and type only when this site has read them from it. */
  function artwork(src) {
    if (!src) return [];
    var key = artKey(src);
    if (!key) return [{ src: String(src) }];
    return [{ src: ROOT + key, sizes: ARTWORK[key].sizes, type: ARTWORK[key].type }];
  }

  /* ---------- the lock screen: one owner ---------- */
  var ACTIONS = ["play", "pause", "previoustrack", "nexttrack", "seekto", "stop"];
  var NEVER = ["seekbackward", "seekforward"];   /* decision D-4: no 15-second skips, anywhere */
  var EVERY = 1000;                               /* the position, at most once a second while playing */
  var bindings = [], owner = null, handled = false, said = "";
  var subscribers = [], published = "", publication = 0;

  /* The installed app's dock reads this same owner. It never takes ownership,
     exposes an audio URL, or makes a second media element. Paused music keeps
     its controls; only the owning player can clear them. */
  function snapshot() {
    if (!owner) return null;
    var d = describe(owner);
    if (!d) return null;
    var s = owner.spec;
    var status = "", note = "";
    try { status = typeof s.status === "function" ? String(s.status() || "") : ""; } catch (e) {}
    try { note = typeof s.note === "function" ? String(s.note() || "") : ""; } catch (e) {}
    /* status: why the player is quiet for a while, in a few words ("Reconnecting…", "Connection lost · tap play"), for
       a surface that shows no player of its own (the installed app's dock hides the mini player); note: a word that
       lasts ("Muted"), which that surface says in place of the artist (the Release 1 dock fix) */
    return Object.freeze({ surface: s.surface || "player", title: d.title, artist: d.artist, album: d.album,
      playing: playing(owner), status: status, note: note,
      canPlay: typeof s.play === "function", canPause: typeof s.pause === "function",
      canPrevious: typeof s.previous === "function", canNext: typeof s.next === "function" });
  }
  function publish() {
    var value = snapshot(), signature = JSON.stringify(value);
    if (signature === published) return;
    published = signature;
    var generation = ++publication, list = subscribers.slice();
    for (var i = 0; i < list.length; i++) {
      /* A listener may start another player. Its newer state wins, including
         for listeners the older publication had not reached yet. */
      if (generation !== publication) return;
      if (subscribers.indexOf(list[i]) !== -1) { try { list[i](value); } catch (e) {} }
    }
  }
  function subscribe(fn) {
    if (typeof fn !== "function") return function () {};
    subscribers.push(fn);
    try { fn(snapshot()); } catch (e) {}
    return function () { subscribers = subscribers.filter(function (item) { return item !== fn; }); };
  }
  function command(action) {
    var key = ["play", "pause", "previous", "next"].indexOf(action) === -1 ? null : action;
    var b = owner;
    if (!key || !b || typeof b.spec[key] !== "function") return false;
    /* Stay in the trusted click's call stack: iOS playback activation cannot
       be transferred by an asynchronous UI message. The player owns policy. */
    attempt(b.spec[key]);
    return true;
  }

  function mediaSession() {
    var nav = root.navigator;
    return nav && nav.mediaSession ? nav.mediaSession : null;
  }
  function finite(n) { return typeof n === "number" && isFinite(n); }
  function attempt(fn) { try { var r = fn(); if (r && typeof r.catch === "function") r.catch(function () {}); } catch (e) {} }

  var dispatch = {
    play: function () { if (owner) attempt(owner.spec.play); },
    pause: function () { if (owner) attempt(owner.spec.pause); },
    previoustrack: function () { if (owner) attempt(owner.spec.previous); },
    nexttrack: function () { if (owner) attempt(owner.spec.next); },
    seekto: function (d) {
      var b = owner;
      if (!b || !d || !finite(d.seekTime)) return;
      var m = b.media, t = Math.max(0, d.seekTime);
      if (finite(m.duration) && m.duration > 0) t = Math.min(t, m.duration);
      if (typeof b.spec.seek === "function") attempt(function () { return b.spec.seek(t); });
      else {
        try {
          if (d.fastSeek && typeof m.fastSeek === "function") m.fastSeek(t);
          else m.currentTime = t;
        } catch (e) {}
      }
      position(b, true);
    },
    stop: function () {
      var b = owner;
      if (!b) return;
      if (typeof b.spec.stop === "function") attempt(b.spec.stop);
      else { try { b.media.pause(); } catch (e) {} }
      clear(b);
    }
  };
  function handlers(on) {
    var ms = mediaSession();
    if (!ms || typeof ms.setActionHandler !== "function") return;
    ACTIONS.forEach(function (a) { try { ms.setActionHandler(a, on ? dispatch[a] : null); } catch (e) {} });
    NEVER.forEach(function (a) { try { ms.setActionHandler(a, null); } catch (e) {} });
    handled = on;
  }
  function describe(b) {
    var t = null;
    try { t = b.spec.track ? b.spec.track() : null; } catch (e) {}
    if (!t || !t.title) return null;   /* nothing honest to say yet */
    return { title: String(t.title), artist: String(t.artist || ""), album: String(t.album || ""), artwork: artwork(t.art) };
  }
  function metadata(b) {
    if (owner !== b) return;
    var ms = mediaSession();
    if (!ms) return;
    var d = describe(b);
    if (!d) return;
    var sig = JSON.stringify(d);
    if (sig === said && ms.metadata) return;   /* the same song again: no new artwork fetch */
    said = sig;
    try { ms.metadata = typeof root.MediaMetadata === "function" ? new root.MediaMetadata(d) : d; }
    catch (e) {
      /* an artwork a browser refuses must not take the title with it */
      try { d.artwork = []; ms.metadata = new root.MediaMetadata(d); } catch (e2) {}
    }
  }
  /* what the listener asked for: the element, unless the player knows better (a song being picked up again after a
     dropped read: its element is quiet while the listener still wants it, and Pause must stop the tries) */
  function playing(b) {
    if (typeof b.spec.playing === "function") { try { return !!b.spec.playing(); } catch (e) {} }
    return !b.media.paused && !b.media.ended;
  }
  function state(b) {
    if (owner !== b) return;
    var ms = mediaSession();
    if (!ms) return;
    try { ms.playbackState = playing(b) ? "playing" : "paused"; } catch (e) {}
  }
  function position(b, now) {
    var ms = mediaSession();
    if (!ms || owner !== b || typeof ms.setPositionState !== "function") return;
    var at = Date.now();
    if (!now && at - b.at < EVERY) return;
    var m = b.media, d = m.duration, p = m.currentTime, r = m.playbackRate;
    if (!finite(d) || d <= 0) return;   /* an unknown or endless length: nothing rather than something false */
    if (!finite(p) || p < 0) p = 0;
    if (p > d) p = d;
    if (!finite(r) || r === 0) r = 1;
    b.at = at;
    try { ms.setPositionState({ duration: d, playbackRate: r, position: p }); } catch (e) {}
  }
  function own(b) {
    if (owner !== b) { owner = b; said = ""; }
    if (!handled) handlers(true);
    metadata(b); state(b); position(b, true); publish();
  }
  /* the lock screen handed back: no title standing for a player that stopped */
  function clear(b) {
    if (b && owner !== b) return;
    owner = null; said = "";
    var ms = mediaSession();
    if (ms) {
      try { ms.metadata = null; } catch (e) {}
      try { ms.playbackState = "none"; } catch (e) {}
      try { if (typeof ms.setPositionState === "function") ms.setPositionState(); } catch (e) {}
      handlers(false);
    }
    publish();
  }
  function bind(media, spec) {
    if (!media || !spec || typeof media.addEventListener !== "function") return null;
    for (var i = 0; i < bindings.length; i++) {
      if (bindings[i].media === media) {
        bindings[i].spec = spec;
        if (owner === bindings[i]) { metadata(bindings[i]); state(bindings[i]); publish(); }
        return bindings[i].handle;
      }
    }
    var b = { media: media, spec: spec, at: 0 };
    var on = function (type, fn) { media.addEventListener(type, fn); };
    on("play", function () { own(b); });
    on("playing", function () { if (owner === b) { state(b); position(b, true); publish(); } });
    on("pause", function () { if (owner === b) { state(b); position(b, true); publish(); } });
    on("ended", function () { if (owner === b) { state(b); position(b, true); publish(); } });
    on("seeked", function () { position(b, true); });
    on("ratechange", function () { position(b, true); });
    on("durationchange", function () { metadata(b); position(b, true); if (owner === b) publish(); });
    on("loadedmetadata", function () { metadata(b); position(b, true); if (owner === b) publish(); });
    on("timeupdate", function () { position(b, false); });
    b.handle = {
      /* a new song loaded, or the same one renamed: say so if this player has the lock screen */
      update: function () { if (owner === b) { metadata(b); state(b); position(b, true); publish(); } },
      clear: function () { clear(b); },
      owns: function () { return owner === b; },
      media: media
    };
    bindings.push(b);
    if (!media.paused && !media.ended) own(b);   /* bound while it already plays */
    return b.handle;
  }

  /* ---------- AirPlay, where WebKit offers it ---------- */
  function airplay(button, media) {
    if (!button) return false;
    if (!media || typeof media.webkitShowPlaybackTargetPicker !== "function" || !root.WebKitPlaybackTargetAvailabilityEvent) {
      button.hidden = true;
      return false;
    }
    button.hidden = true;   /* until WebKit says a device is in range */
    media.addEventListener("webkitplaybacktargetavailabilitychanged", function (e) {
      button.hidden = !e || e.availability !== "available";
    });
    button.addEventListener("click", function () {
      try { media.webkitShowPlaybackTargetPicker(); } catch (e) {}
      if (root.MCC_TRACK) { try { root.MCC_TRACK("music_airplay_open", {}); } catch (e) {} }
    });
    return true;
  }

  /* ---------- the in-app note (slice M1) ---------- */
  /* the in-app browsers whose host app decides about background audio,
     by the name each puts in its user agent */
  var HOSTS = [
    ["Instagram", /\bInstagram\b/],
    ["Messenger", /MessengerForiOS|Orca-Android|\bMessenger\b/],
    ["Facebook", /FBAN\/|FBAV\/|FB_IAB|FBIOS|FB4A/],
    ["TikTok", /musical_ly|\bTikTok\b|trill_\d|BytedanceWebview/],
    ["Snapchat", /\bSnapchat\b/],
    ["LinkedIn", /LinkedInApp/],
    ["Line", /\bLine\/\d/],
    ["X", /\bTwitter/]
  ];
  function inApp(ua) {
    var s = String(ua == null ? (root.navigator && root.navigator.userAgent) || "" : ua);
    for (var i = 0; i < HOSTS.length; i++) if (HOSTS[i][1].test(s)) return HOSTS[i][0];
    return null;
  }

  var KEY = "mcc_inapp_note", TEXT = "To keep the music playing with your screen locked, open this page in Safari or Chrome.";
  function dismissed() { try { return root.sessionStorage.getItem(KEY) === "dismissed"; } catch (e) { return false; } }
  function remember() { try { root.sessionStorage.setItem(KEY, "dismissed"); } catch (e) {} }
  function track(action, host) { try { if (root.MCC_TRACK) root.MCC_TRACK("music_inapp_note", { action: action, host_app: host }); } catch (e) {} }
  function style() {
    if (doc.getElementById("mccNowPlayingStyle")) return;
    var css = doc.createElement("style");
    css.id = "mccNowPlayingStyle";
    /* phone first: one line that wraps, a 44 px target to put it away, no width of its own */
    css.textContent =
      ".np-hint{position:relative;z-index:2;display:flex;align-items:flex-start;gap:.5rem;box-sizing:border-box;max-width:100%;" +
        "margin:.5rem 0 .75rem;padding:.55rem .25rem .55rem .85rem;border-radius:14px;border:1px solid rgba(244,239,230,.16);" +
        "background:rgba(18,15,13,.86);color:#f4efe6;font:500 .82rem/1.45 var(--ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif)}" +
      ".np-hint p{flex:1 1 auto;min-width:0;margin:0;padding-top:.12rem}" +
      ".np-hint button{flex:0 0 auto;width:44px;height:44px;margin:-.5rem 0;border:0;border-radius:12px;background:transparent;" +
        "color:inherit;font-family:inherit;font-size:1.35rem;font-weight:400;line-height:1;cursor:pointer;opacity:.72}" +
      ".np-hint button:focus-visible{outline:2px solid currentColor;outline-offset:-4px;opacity:1}" +
      ".np-hint--light{background:rgba(255,252,247,.94);color:#17110c;border-color:rgba(23,17,12,.16)}" +
      "@media (min-width:700px){.np-hint{max-width:40rem}}";
    doc.head.appendChild(css);
  }
  /* the note wears the coat of the room it sits in, not the clock's: most
     music rooms stay dark by day and by night, and a light card in a dark
     room would shout. A page whose own surface is light gets the light coat. */
  function lightRoom() {
    try {
      var m = String(root.getComputedStyle(doc.body).backgroundColor || "").match(/[\d.]+/g);
      if (!m || m.length < 3 || (m.length > 3 && +m[3] === 0)) return false;
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 > 0.6;
    } catch (e) { return false; }
  }
  /* music pages only: a listening room or an artist's page, never a frame.
     Not the lyric video feed: it plays video, and no browser promises to
     keep a video playing with the screen locked, so the line would not be
     true there. */
  function musicPage() {
    var b = doc.body;
    if (!b || root.top !== root || b.classList.contains("music-room--music-videos")) return false;
    return b.classList.contains("music-room") || b.classList.contains("artist-page");
  }
  function mount() {
    var host = inApp();
    if (!host || !musicPage() || dismissed() || doc.querySelector(".np-hint")) return;
    style();
    var note = doc.createElement("aside");
    note.className = lightRoom() ? "np-hint np-hint--light" : "np-hint";
    note.setAttribute("role", "note");
    note.setAttribute("aria-label", "Listening tip");
    var p = doc.createElement("p");
    p.textContent = TEXT;
    var x = doc.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", "Dismiss this tip");
    x.textContent = "×";
    x.addEventListener("click", function () {
      remember();
      if (note.parentNode) note.parentNode.removeChild(note);
      track("dismiss", host);
    });
    note.appendChild(p);
    note.appendChild(x);
    /* under the page's own music bar, in the flow of the page: nothing is covered */
    var bar = doc.querySelector(".music-contextbar");
    if (bar && bar.parentNode) bar.parentNode.insertBefore(note, bar.nextSibling);
    else (doc.querySelector("main") || doc.body).insertBefore(note, (doc.querySelector("main") || doc.body).firstChild);
    track("view", host);
  }

  root.MCC_NOW_PLAYING = {
    claim: claim,
    supported: function () { return !!audioSession(); },
    inApp: inApp,
    bind: bind,
    artwork: artwork,
    airplay: airplay,
    snapshot: snapshot,
    subscribe: subscribe,
    command: command,
    owner: function () { return owner ? owner.spec.surface || "player" : null; }
  };
  if (doc && doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", mount);
  else if (doc && doc.body) mount();
})(window);
