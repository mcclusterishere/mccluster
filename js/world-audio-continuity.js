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
  var worldHref = "", frameReady = false, readyTimer = null, loadGeneration = 0;
  var baseTitle = doc.title, baseHref = location.href, frameClearance = 0;
  var hiddenNodes = new Map(), observedAudio = new WeakSet();
  var lastAnnouncement = {}, preference = readPreference();
  /* THE CORNER STACK (owner, 2026-10-19): on the World screen the play/pause
     sits with the fullscreen control (#mnWorldPlay), the song title scrolls in
     the top bar (#mnNowPlaying) and timed lyrics, when a track has them in
     data/lyrics/<slug>.json, take the headline's place line by line. The
     standalone World owns its Audio element, so its button plays directly.
     Inside the Music shell the parent keeps the transport (a frame message
     cannot carry Safari's media activation); the child only displays state. */
  var headlineBase = null, lyricCache = {}, lyricLine = "", lyricSlug = "", lyricAt = 0, remoteState = null;

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
    if (u.origin === HOUSE && /\/(?:mnet|action-globe)\.html$/.test(u.pathname)) {
      var w = new URL("https://mccluster.org/"); w.search = u.search; w.hash = u.hash;
      w.searchParams.delete("embedded"); w.searchParams.delete("explore");
      return w;
    }
    return null;
  }
  function musicURL(href) {
    var u = urlOf(href);
    return u && u.origin === HOUSE && u.pathname === "/listen.html" && !u.search && !u.hash;
  }
  function musicSurface() { return !!root.MCC_MUSIC || !!doc.getElementById("deck"); }
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
        play:function () { return root.MCC_NP_PLAY ? root.MCC_NP_PLAY() : deck.play(); }, pause:function () { deck.pause(); }};
    }
    return null;
  }
  function player() { return selected() || theme; }
  function clusterButton() { return doc.getElementById("mnWorldPlay"); }
  function slugOf(audio) {
    var src = audio && (audio.currentSrc || audio.src) || "", m = /\/([^\/?#]+)\.[a-z0-9]+(?:[?#]|$)/i.exec(src);
    return m ? m[1].toLowerCase() : "";
  }
  function loadLyrics(slug) {
    if (!slug) return Promise.resolve(null);
    if (!lyricCache[slug]) lyricCache[slug] = fetch(ROOT + "data/lyrics/" + encodeURIComponent(slug) + ".json", {credentials:"omit"})
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var lines = d && Array.isArray(d.lines) ? d.lines.filter(function (l) { return l && typeof l.text === "string" && Number.isFinite(l.t); }) : [];
        lines.sort(function (a, b) { return a.t - b.t; });
        return lines.length ? lines : null;
      })
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
      // The headline is the page's only <h1>. A lyric is shown in an
      // aria-hidden span while the heading keeps its own words for
      // assistive tech (visually hidden), so the outline never becomes a song.
      if (headlineBase === null) headlineBase = h.textContent;
      var lyric = h.querySelector(".wt-headline__lyric");
      if (st.line) {
        if (!lyric) {
          var base = doc.createElement("span");
          base.className = "wt-headline__base"; base.textContent = headlineBase;
          base.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap";
          lyric = doc.createElement("span");
          lyric.className = "wt-headline__lyric"; lyric.setAttribute("aria-hidden", "true");
          h.textContent = ""; h.appendChild(base); h.appendChild(lyric);
        }
        if (lyric.textContent !== st.line) lyric.textContent = st.line;
      } else if (lyric || h.textContent !== headlineBase) h.textContent = headlineBase;
      h.classList.toggle("is-lyric", !!st.line);
    }
  }
  function sendState() { if (!attached && open && frame && frameReady) send(Object.assign({type:"state"}, clusterState())); }
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
        if (name === "play" && theme && audio !== theme.audio) theme.audio.pause();
        if (name === "play" && typeof preference.muted === "boolean" && audio.muted !== preference.muted) audio.muted = preference.muted;
        if (name === "volumechange") { preference.muted = audio.muted; savePreference(); }
        paint();
      });
    });
  }
  function ensureTheme() {
    if (theme) return theme;
    var audio = new Audio(); audio.preload = "metadata"; audio.loop = true;
    audio.setAttribute("playsinline", "");
    // This is the existing public catalog source (data/albums.json, heal-the-3),
    // prepared before any play gesture. It is not a gated master or signed URL.
    audio.src = ROOT + "assets/audio/heal-the-3rd-world.m4a";
    audio.muted = preference.muted === true;
    theme = {audio:audio, title:"Heal the 3rd World", access:"full",
      play:function () { return audio.play(); }, pause:function () { audio.pause(); }};
    watch(audio);
    return theme;
  }
  function playTheme() {
    if (selected() || preference.paused || preference.muted || attached) return;
    var p = ensureTheme();
    if (!p.audio.paused) return;
    // Synchronous with the owning document's click/touch. postMessage does not
    // transfer Safari's media activation and is never used to start this sound.
    try { var promise = p.play(); if (promise && promise.catch) promise.catch(paint); } catch (_) {}
    ensureControls(); paint();
  }
  function touch() {
    if (IS_WORLD && !attached && root.parent === root) playTheme();
  }
  function pause() {
    var p = player(); if (!p) return;
    if (p === theme) { preference.paused = true; savePreference(); }
    p.pause(); paint();
  }
  function toggle() {
    var p = player() || ensureTheme();
    if (!p.audio.paused && !p.audio.ended) { pause(); return; }
    preference.paused = false; savePreference();
    try { var promise = p.play(); if (promise && promise.catch) promise.catch(paint); } catch (_) {}
    paint();
  }
  function mute() {
    var p = player() || ensureTheme();
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
      controls.hidden = attached || !p || !(open || IS_WORLD || p === theme) || (IS_WORLD && !attached && !!clusterButton());
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
    if (open) markWorld();
    layout();
  }
  function markWorld() {
    doc.querySelectorAll(".appbar [data-appnav]").forEach(function (tab) {
      var isWorld = tab.dataset.appnav === "world";
      tab.classList.toggle("is-here", isWorld);
      if (isWorld) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
    });
  }
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
    if (!visible) doc.querySelectorAll("audio,video").forEach(function (media) { media.pause(); });
    event("mcc:world-audio-visibility", {visible:visible});
  }
  function concealMusic() {
    Array.prototype.forEach.call(doc.body.children, function (node) {
      if (/^(SCRIPT|LINK|STYLE)$/.test(node.tagName) || node === shell || node === controls || node.classList.contains("appbar") || node.id === "mccDestinations") return;
      if (!hiddenNodes.has(node)) hiddenNodes.set(node, node.inert);
      node.inert = true;
    });
  }
  function createShell() {
    if (shell) return;
    loadStyle(); shell = doc.createElement("section"); shell.id = "mccWorldAudioShell";
    shell.setAttribute("aria-label", "World"); shell.hidden = true;
    frame = doc.createElement("iframe"); frame.id = "mccWorldAudioFrame"; frame.title = "Equity Uprise World";
    frame.allow = "geolocation; autoplay; fullscreen; camera; microphone";
    frame.allowFullscreen = true; frame.referrerPolicy = "strict-origin-when-cross-origin";
    status = doc.createElement("div"); status.className = "world-audio-status";
    status.innerHTML = '<p role="status">Opening World…</p><button type="button">Back to Music</button><a>Open World directly</a>';
    status.querySelector("button").onclick = function () { closeWorld(true); };
    status.querySelector("a").onclick = function (e) {
      e.preventDefault();
      var h = root.MCC_BAR?.navigation.handoff;
      (h ? h(worldHref) : Promise.resolve(worldHref)).catch(function () { return worldHref; }).then(function (url) { location.assign(url); });
    };
    shell.append(frame, status); doc.body.appendChild(shell);
    frame.addEventListener("load", function () {
      send({type:"attach", clearance:frameClearance || 152, visible:open});
    });
    new MutationObserver(function () { if (open) concealMusic(); }).observe(doc.body, {childList:true});
  }
  function openWorld(href, options) {
    options = options || {};
    var url = worldURL(href); if (!url) return false;
    var clean = cleanHref(url.href);
    if (options.gesture !== false) playTheme();
    if (root.MCC_MUSIC) root.MCC_MUSIC.closeNow();
    createShell(); ensureControls();
    var wasOpen = open; open = true; shell.hidden = false;
    doc.body.dataset.worldAudioOpen = "true"; doc.documentElement.classList.add("world-audio-open");
    concealMusic(); doc.title = "World · Equity Uprise";
    if (!wasOpen && !options.history) {
      var address = new URL(baseHref); address.searchParams.set("world", "1");
      history.pushState(Object.assign({}, history.state, {mccWorldAudio:{href:clean}}), "", address.href);
    }
    paint();
    if (worldHref !== clean || !frame.getAttribute("src")) {
      worldHref = clean; frameOrigin = url.origin; frameReady = false;
      channelId = root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : String(Date.now()) + Math.random();
      status.hidden = false; status.querySelector("p").textContent = "Opening World…";
      status.querySelector("a").href = clean;
      var generation = ++loadGeneration;
      var target = new URL(clean); target.searchParams.set("mcc_audio", "1");
      var handoff = root.MCC_BAR && root.MCC_BAR.navigation.handoff;
      (handoff ? handoff(target.href) : Promise.resolve(target.href)).catch(function () { return target.href; }).then(function (carried) {
        if (generation !== loadGeneration) return;
        frame.src = carried;
      });
      clearTimeout(readyTimer);
      readyTimer = setTimeout(function () {
        if (!frameReady && open) status.querySelector("p").textContent = "World is taking longer to open. Your music is still available.";
      }, 12000);
    } else { send({type:"attach", clearance:frameClearance, visible:open}); send({type:"visibility", visible:open}); }
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
    doc.querySelectorAll(".appbar [data-appnav]").forEach(function (tab) {
      var here = tab.dataset.appnav === "music";
      tab.classList.toggle("is-here", here); tab.removeAttribute("aria-current");
    });
    paint();
    doc.querySelector('.appbar [data-appnav="music"]')?.focus({preventScroll:true});
    if (back && history.state && history.state.mccWorldAudio) history.back();
  }
  function attachToParent(e) {
    if (root.parent === root || e.source !== root.parent || TRUSTED.indexOf(e.origin) === -1 || TRUSTED.indexOf(location.origin) === -1) return;
    var data = e.data;
    if (typeof data.id !== "string" || !data.id || data.id.length > 100) return;
    attached = true; parentOrigin = e.origin; channelId = data.id;
    if (theme) theme.audio.pause();
    loadStyle(); doc.body.dataset.worldAudioChild = "ready";
    var dock = doc.querySelector(".appbar"); if (dock) { dock.hidden = true; dock.inert = true; }
    frameLayout(data.clearance);
    frameVisibility(data.visible);
    root.parent.postMessage({channel:CHANNEL, type:"ready", id:channelId}, parentOrigin);
    if (addressSuggestionsOpen) root.parent.postMessage(
      {channel:CHANNEL,type:"address-suggestions",id:channelId,active:true},parentOrigin);
    paint(); bindCluster();
    alignWorldTransport();
  }
  function navigate(href) {
    if (attached) {
      if (!musicURL(href)) return false;
      root.parent.postMessage({channel:CHANNEL, type:"music", id:channelId}, parentOrigin); return true;
    }
    if (open && musicURL(href)) { closeWorld(true); return true; }
    var world = worldURL(href);
    if (world && musicSurface() && root.parent === root) return openWorld(world.href);
    return false;
  }
  function leaveFrame(href) {
    var u = urlOf(href);
    if (!attached || !u || u.origin === location.origin || TRUSTED.indexOf(u.origin) === -1) return false;
    // Other album/creator/Control links retain their exact destination and the
    // child's existing sign-in handoff. They leave the listening document; they
    // must not create a second music page inside the retained World frame.
    root.top.location.href = u.href;
    return true;
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
  root.MCC_WORLD_AUDIO = {navigate:navigate, leaveFrame:leaveFrame, touch:touch, active:function () {return open;}};
  if (musicSurface()) {
    ensureTheme(); // metadata only; no automatic playback on Music.
    watch(root.MCC_MUSIC && root.MCC_MUSIC.audio); watch(doc.getElementById("deck"));
  }
  if (IS_WORLD && root.parent === root) { ensureTheme(); ensureControls(); bindCluster(); paint(); }
  root.addEventListener("mcc:nowplaying", function (e) { lastAnnouncement = e.detail || {}; paint(); });
  root.addEventListener("mcc:music-selected", function () { if (theme) theme.audio.pause(); watch(root.MCC_MUSIC?.audio); paint(); });
  root.addEventListener("mcc:music-state", paint);
  root.addEventListener("mcc:appbar-admin", paint);
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
    if (state && musicSurface()) openWorld(state.href, {history:true, gesture:false});
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
      if (d.type === "state") {
        remoteState = {present:d.present === true, playing:d.playing === true, loading:d.loading === true,
          title:typeof d.title === "string" ? d.title.slice(0, 120) : "", line:typeof d.line === "string" ? d.line.slice(0, 240) : ""};
        paintCluster(remoteState);
      }
      return;
    }
    if (!frame || e.source !== frame.contentWindow || e.origin !== frameOrigin) return;
    if (d.type === "hello") { send({type:"attach", clearance:frameClearance || 152, visible:open}); return; }
    if (d.id !== channelId) return;
    if (d.type === "ready") { frameReady = true; status.hidden = true; clearTimeout(readyTimer); send({type:"visibility", visible:open}); sendState(); }
    else if (d.type === "controls-position" && controls && open) {
      if (d.top === null) { controls.style.removeProperty("top"); controls.style.removeProperty("right"); }
      else if (Number.isFinite(d.top) && d.top >= 65 && d.top <= root.innerHeight - 65) {
        controls.style.top = Math.round(d.top) + "px";
        if (Number.isFinite(d.right) && d.right >= 0 && d.right <= root.innerWidth - 52) controls.style.right = Math.round(d.right) + "px";
      }
    }
    else if (d.type === "music") closeWorld(true);
    else if (d.type === "pause") pause();
    else if (d.type === 'address-suggestions' && typeof d.active === 'boolean') {
      addressSuggestionsOpen = d.active;
      suspendTransportForSuggestions(d.active);
    }
  });
  doc.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download") || a.closest(".world-audio-status")) return;
    if (navigate(a.href)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // Typing is not a request for music: Enter/Space in a field (the Travel
  // destination, a search box, a composer) and pointing into one never start
  // the theme.
  function editableTarget(t) {
    var el = t && t.nodeType === 1 ? t : t && t.parentElement;
    if (!el || !el.closest) return false;
    if (el.isContentEditable || el.closest("textarea,select,[contenteditable]:not([contenteditable='false'])")) return true;
    var input = el.closest("input");
    return !!input && !/^(button|submit|reset|image|checkbox|radio)$/i.test(input.type || "");
  }
  doc.addEventListener("pointerdown", function (e) {
    if (!e.isTrusted || editableTarget(e.target) || e.target.closest?.("#mccWorldAudioControls,#mnWorldPlay,video,audio")) return;
    touch();
  }, {capture:true, passive:true});
  doc.addEventListener("keydown", function (e) { if (e.isTrusted && (e.key === "Enter" || e.key === " ") && !editableTarget(e.target) && !e.target.closest?.("#mccWorldAudioControls,#mnWorldPlay")) touch(); }, true);
  doc.addEventListener("play", function (e) {
    if (!attached || e.target.muted || e.target.volume === 0) return;
    root.parent.postMessage({channel:CHANNEL, type:"pause", id:channelId}, parentOrigin);
  }, true);
  if (root.parent !== root && TRUSTED.indexOf(location.origin) !== -1) {
    var referrer = urlOf(doc.referrer);
    if (referrer && TRUSTED.indexOf(referrer.origin) !== -1) root.parent.postMessage({channel:CHANNEL, type:"hello"}, referrer.origin);
  }
  // Refreshing the World view keeps the destination. Browser refresh naturally
  // ends the old document/audio; the new document waits for its next gesture.
  if (musicSurface() && new URLSearchParams(location.search).get("world") === "1") {
    var initial = new URL(location.href); initial.searchParams.delete("world"); baseHref = initial.href;
    var saved = history.state && history.state.mccWorldAudio;
    openWorld(saved && saved.href || "https://mccluster.org/?view=feed", {history:true, gesture:false});
  }
})(window);
