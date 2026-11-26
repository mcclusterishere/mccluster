/* One shared bar while music is present, in the browser and installed app.
   Keep existing role-filtered navigation and the current Now Playing owner. */
(function (root) {
  "use strict";
  if (root.parent !== root) return;
  var doc = root.document, html = doc.documentElement;
  var source = doc.currentScript && doc.currentScript.src;
  var ROOT = source ? source.replace(/js\/installed-app-dock\.js.*$/, "") : "";
  var dock = doc.querySelector(".appbar"), tabs = null, left = null, right = null, status = null;
  var lyricSlot, lyricPath = "", lyricLoad = null, lyricWords = [], lyricFrame = 0;
  var styleReady = false, connected = false, active = false, lastSurface = "", expanded = false;
  var oldId = dock && dock.id, oldLabel = dock && dock.getAttribute("aria-label");
  if (!dock) return;
  function installed() { return html.classList.contains("mcc-installed-app"); }
  function api() { return root.MCC_NOW_PLAYING; }
  function snapshot() {
    var p = api(), s = p && typeof p.snapshot === "function" ? p.snapshot() : null;
    if (s) return s;
    var e = root.MCC_MUSIC, h = e && typeof e.resumeOffer === "function" ? e.resumeOffer() : null;
    return h ? { surface:"listen", title:h.title, artist:h.artist, note:"Pick up at " + h.position,
      playing:false, canPlay:true, canPause:false, canPrevious:false, canNext:false, held:true } : null;
  }
  function icon(path) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>'; }
  var PLAY = icon("M8 5l11 7-11 7z"), PAUSE = icon("M6 5h4v14H6zM14 5h4v14h-4z");
  function button(name, label, drawing) {
    var b = doc.createElement("button"); b.type = "button";
    b.dataset.appPlayer = name; b.setAttribute("aria-label", label); b.innerHTML = drawing;
    return b;
  }
  function closeDetails() {
    expanded = false; html.classList.remove("mcc-app-player-expanded");
    var info = dock.querySelector("[data-app-player='open']");
    if (info) info.setAttribute("aria-expanded", "false");
  }
  function openPlayer() {
    var s = snapshot(); if (!s) return;
    /* Returning from retained World reveals the real listening document and
       its full player. Seeking, queue, volume and AirPlay stay there. */
    if (root.MCC_WORLD_AUDIO && root.MCC_WORLD_AUDIO.active()) {
      root.MCC_WORLD_AUDIO.navigate(root.MCC_BAR.navigation.house + "listen.html");
    }
    var target = s.surface === "listen" ? doc.getElementById("musicMiniOpen")
      : s.surface === "album" ? doc.querySelector(".deckbar__meta") : null;
    if (target) { target.click(); return; }
    if (s.surface === "pocket" && doc.querySelector(".pocket")) {
      /* The pocket's film, AirPlay and Stop stay available on demand. Closing
         these details never stops or recreates its actual audio element. */
      expanded = !expanded; html.classList.toggle("mcc-app-player-expanded", expanded);
      dock.querySelector("[data-app-player='open']").setAttribute("aria-expanded", String(expanded));
      if (expanded) doc.querySelector(".pocket__play")?.focus({preventScroll:true});
      return;
    }
    if (root.MCC_BAR) root.MCC_BAR.navigation.go(root.MCC_BAR.navigation.house + "listen.html");
  }
  function clearLyrics() {
    if (lyricLoad) lyricLoad.abort();
    lyricLoad = null; lyricPath = ""; lyricWords = [];
    if (lyricFrame) root.cancelAnimationFrame(lyricFrame);
    lyricFrame = 0;
    dock.classList.remove("has-word-lyrics");
    if (lyricSlot) lyricSlot.textContent = "";
  }
  function paintWord() {
    if (lyricFrame) root.cancelAnimationFrame(lyricFrame);
    lyricFrame = 0;
    if (!lyricSlot || !lyricWords.length || doc.hidden) return;
    var p = api(), clock = p && p.lyricPosition && p.lyricPosition();
    var lo = 0, hi = lyricWords.length - 1, match = null;
    if (clock) while (lo <= hi) {
      var mid = (lo + hi) >> 1, w = lyricWords[mid];
      if (w.begin <= clock.time) { match = w; lo = mid + 1; } else hi = mid - 1;
    }
    var word = match && clock.time < match.end ? match.content : "";
    if (lyricSlot.textContent !== word) lyricSlot.textContent = word;
    if (clock && clock.advancing) lyricFrame = root.requestAnimationFrame(paintWord);
  }
  function updateLyrics(s) {
    var path = s && s.lyricPath || "";
    if (path === lyricPath) { paintWord(); return; }
    clearLyrics();
    /* The owner supplies a canonical static lyric file, not a guessed URL or
       a preview's lyrics. Never estimate word timing from plain/line text. */
    if (!/^data\/lyrics\/[a-z0-9._-]+\.json$/i.test(path)) return;
    lyricPath = path;
    var load = lyricLoad = new AbortController();
    fetch(ROOT + path, { signal:load.signal }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (data) {
      if (lyricLoad !== load || !lyricSlot) return;
      var lines = data && data.timed && data.timed.line;
      var timing = data && data.machine && data.machine.word_timing;
      // Imported LRC can contain plausible-looking arrays that were evenly
      // divided or interpolated. Do not present those as audio-synced.
      if (!Array.isArray(lines) || timing === "even") return;
      lyricWords = lines.filter(function (line) {
        if (!line || line.mismatch || !Array.isArray(line.words)) return false;
        return data.source !== "imported" || (timing === "audio" && line.confidence === 1);
      })
        .flatMap(function (line) { return line.words; }).filter(function (w) {
          return w && Number.isFinite(w.begin) && Number.isFinite(w.end) && w.begin >= 0 && w.end > w.begin &&
            typeof w.content === "string" && /^\S+$/.test(w.content.trim());
        }).map(function (w) { return {begin:w.begin,end:w.end,content:w.content.trim()}; })
        .sort(function (a,b) { return a.begin - b.begin; });
      dock.classList.toggle("has-word-lyrics", !!lyricWords.length);
      paintWord();
    }).catch(function () {});
  }
  function hasTransport(p, s) {
    // A browser World has its own map-side transport and clearance contract.
    // Keep the shipping layout there, even under the retained music document.
    if (!installed() && (html.hasAttribute("data-world-mode") || html.classList.contains("world-audio-open"))) return false;
    return !!(s && s.title && s.canPlay && (s.held || (s.canPause && p && typeof p.command === "function")));
  }
  function mount() {
    if (tabs || !styleReady) return;
    tabs = doc.createElement("div"); tabs.className = "appbar__tabs"; tabs.id = "mccInstalledDockTabs";
    while (dock.firstChild) tabs.appendChild(dock.firstChild);
    left = doc.createElement("div"); left.className = "appbar__music-left"; left.hidden = true;
    right = doc.createElement("div"); right.className = "appbar__music-right"; right.hidden = true;
    left.appendChild(button("previous", "Previous track", icon("M5 5h2v14H5zM19 5L8 12l11 7z")));
    var info = doc.createElement("button"); info.type = "button"; info.className = "appbar__music-info";
    info.dataset.appPlayer = "open";
    info.innerHTML = '<span data-app-player="title"></span><span data-app-player="artist"></span>';
    left.appendChild(info);
    right.appendChild(button("play", "Play music", PLAY));
    right.appendChild(button("next", "Next track", icon("M17 5h2v14h-2zM5 5l11 7-11 7z")));
    lyricSlot = doc.createElement("span"); lyricSlot.className = "appbar__lyric-word";
    lyricSlot.setAttribute("aria-hidden", "true"); right.appendChild(lyricSlot);
    /* why the music is quiet, on a line of its own (the open button's label says it too) */
    status = doc.createElement("span"); status.className = "appbar__music-status"; status.dataset.appPlayer = "status";
    status.setAttribute("aria-hidden", "true"); status.hidden = true;
    dock.append(left, tabs, right, status); dock.id = "mccInstalledDock";
    html.classList.add("mcc-app-dock-ready");
    dock.addEventListener("click", onClick);
    paint();
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("button[data-app-player]");
    if (!b || !dock.contains(b) || b.disabled) return;
    var name = b.dataset.appPlayer;
    if (name === "open") { openPlayer(); return; }
    var p = api(), s = snapshot(); if (!s) return;
    if (s.held) { if (name === "play") root.MCC_MUSIC.resumeHeld(); return; }
    p.command(name === "play" ? s.playing ? "pause" : "play" : name);
  }
  function setActive(next) {
    html.classList.toggle("mcc-app-dock-active", next);
    if (active === next) return;
    active = next;
    root.dispatchEvent(new CustomEvent("mcc:installed-dock", {detail:{active:active}}));
  }
  function paint() {
    var p = api(), s = snapshot();
    var usable = hasTransport(p, s);
    if (!tabs) { if (installed() || usable) mount(); return; }
    if (!usable && !installed()) { unmount(); return; }
    if (!usable || s.surface !== lastSurface) closeDetails();
    lastSurface = s && s.surface || "";
    left.hidden = right.hidden = !usable;
    if (usable) {
      html.setAttribute("data-app-player-surface", s.surface);
      dock.setAttribute("aria-label", "Sections and music controls");
      var title = dock.querySelector("[data-app-player='title']"), artist = dock.querySelector("[data-app-player='artist']");
      /* the dock hides the player's own bar, so it says why the music is quiet in its place ("Reconnecting…",
         "Connection lost · tap play", "Loading…", "Could not load · tap play"; music slice M3, review RL-6). In the
         second line, under the title, those words were cut by its width ("Reconnectin…" at 390 px, a few letters at
         320): they take a line of their own across the dock, above its controls, which keep their place, for the
         seconds the trouble lasts (music slice M3 follow-up). "Muted" lasts, so it is the second line, in place of
         the artist, and the dock stays one row (the Release 1 dock fix). The words are the player's, never the dock's. */
      var line = s.status || s.note || s.artist;
      title.textContent = s.title; artist.textContent = s.note || s.artist || "";
      status.textContent = s.status || ""; status.hidden = !s.status;
      dock.classList.toggle("has-status", !!s.status);
      var info = dock.querySelector("[data-app-player='open']"), full = s.title + (line ? " — " + line : "");
      info.title = full; info.setAttribute("aria-label", "Open player: " + full);
      var play = dock.querySelector("[data-app-player='play']");
      play.setAttribute("aria-label", s.playing ? "Pause music" : "Play music");
      play.innerHTML = s.playing ? PAUSE : PLAY;
      dock.querySelector("[data-app-player='previous']").disabled = !s.canPrevious;
      dock.querySelector("[data-app-player='next']").disabled = !s.canNext;
    } else {
      html.removeAttribute("data-app-player-surface");
      dock.setAttribute("aria-label", oldLabel || "Sections");
      status.hidden = true; dock.classList.remove("has-status");
    }
    setActive(usable);
    updateLyrics(usable ? s : null);
  }
  function connect() {
    var p = api();
    if (connected || !p || typeof p.subscribe !== "function") return;
    connected = true; p.subscribe(paint);
  }
  function unmount() {
    html.classList.remove("mcc-app-dock-ready");
    setActive(false); closeDetails(); clearLyrics();
    html.removeAttribute("data-app-player-surface");
    if (!tabs) return;
    left.remove(); right.remove(); status.remove(); dock.classList.remove("has-status");
    while (tabs.firstChild) dock.insertBefore(tabs.firstChild, tabs);
    tabs.remove(); tabs = left = right = status = lyricSlot = null;
    dock.id = oldId || "mccAppbar"; dock.setAttribute("aria-label", oldLabel || "Sections");
    dock.removeEventListener("click", onClick);
  }
  var mode = installed();
  new MutationObserver(function () {
    var next = installed(); if (next === mode) return;
    mode = next; paint();
  }).observe(html, {attributes:true, attributeFilter:["class"]});
  root.addEventListener("mcc:world-audio-open", paint);
  root.addEventListener("mcc:nowplaying", paint);
  root.addEventListener("mcc:lyric-clock", paintWord);
  doc.addEventListener("visibilitychange", paintWord);
  doc.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !expanded) return;
    closeDetails(); dock.querySelector("[data-app-player='open']")?.focus({preventScroll:true});
  });
  doc.addEventListener("pointerdown", function (e) {
    if (expanded && !e.target.closest?.(".pocket,[data-app-player='open']")) closeDetails();
  }, {passive:true});
  var style = doc.createElement("link"); style.rel = "stylesheet";
  style.href = ROOT + "css/installed-app-dock.css?v=__STAMP__";
  style.onload = function () { styleReady = true; connect(); paint(); };
  doc.head.appendChild(style);
  connect();
  var pending = doc.querySelector("script[data-mcc-now-playing]");
  if (pending) pending.addEventListener("load", function () { connect(); paint(); }, {once:true});
})(window);
