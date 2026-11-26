/* The installed app keeps one compact bar. Its middle remains the existing
   navigation; the sides control the current Now Playing owner, never a new
   audio element. Browser windows retain their existing chrome. */
(function (root) {
  "use strict";
  if (root.parent !== root) return;
  var doc = root.document, html = doc.documentElement;
  var source = doc.currentScript && doc.currentScript.src;
  var ROOT = source ? source.replace(/js\/installed-app-dock\.js.*$/, "") : "";
  var dock = doc.querySelector(".appbar"), tabs = null, left = null, right = null, status = null;
  var styleReady = false, connected = false, active = false, lastSurface = "", expanded = false;
  var oldId = dock && dock.id, oldLabel = dock && dock.getAttribute("aria-label");
  if (!dock) return;
  function installed() { return html.classList.contains("mcc-installed-app"); }
  function api() { return root.MCC_NOW_PLAYING; }
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
    var s = api() && api().snapshot(); if (!s) return;
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
  function mount() {
    if (tabs || !styleReady || !installed()) return;
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
    var p = api(), s = p && p.snapshot(); if (!s) return;
    p.command(name === "play" ? s.playing ? "pause" : "play" : name);
  }
  function setActive(next) {
    html.classList.toggle("mcc-app-dock-active", next);
    if (active === next) return;
    active = next;
    root.dispatchEvent(new CustomEvent("mcc:installed-dock", {detail:{active:active}}));
  }
  function paint() {
    if (!tabs) { mount(); return; }
    var p = api(), s = p && typeof p.snapshot === "function" ? p.snapshot() : null;
    var usable = !!(installed() && s && s.title && s.canPlay && s.canPause && typeof p.command === "function");
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
  }
  function connect() {
    var p = api();
    if (connected || !p || typeof p.subscribe !== "function") return;
    connected = true; p.subscribe(paint);
  }
  function refreshMode() {
    if (installed()) { mount(); paint(); return; }
    setActive(false); closeDetails(); html.classList.remove("mcc-app-dock-ready");
    html.removeAttribute("data-app-player-surface");
    if (!tabs) return;
    left.remove(); right.remove(); status.remove(); dock.classList.remove("has-status");
    while (tabs.firstChild) dock.insertBefore(tabs.firstChild, tabs);
    tabs.remove(); tabs = left = right = status = null;
    dock.id = oldId || "mccAppbar"; dock.setAttribute("aria-label", oldLabel || "Sections");
    dock.removeEventListener("click", onClick);
  }
  var mode = installed();
  new MutationObserver(function () {
    var next = installed(); if (next === mode) return;
    mode = next; refreshMode();
  }).observe(html, {attributes:true, attributeFilter:["class"]});
  doc.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !expanded) return;
    closeDetails(); dock.querySelector("[data-app-player='open']")?.focus({preventScroll:true});
  });
  doc.addEventListener("pointerdown", function (e) {
    if (expanded && !e.target.closest?.(".pocket,[data-app-player='open']")) closeDetails();
  }, {passive:true});
  var style = doc.createElement("link"); style.rel = "stylesheet";
  style.href = ROOT + "css/installed-app-dock.css?v=c1f3e54aa594";
  style.onload = function () { styleReady = true; mount(); connect(); paint(); };
  doc.head.appendChild(style);
  connect();
  var pending = doc.querySelector("script[data-mcc-now-playing]");
  if (pending) pending.addEventListener("load", function () { connect(); paint(); }, {once:true});
})(window);
