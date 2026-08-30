/* ============================================================
   THE LABEL — the distribution machinery, not the decoration.

   Four moves a real label sells, seated right on the record:

   THE APP      the whole experience installs — Android, iPhone,
                Windows, Mac — straight from the page, no store
                gatekeeper. One button; each platform gets its
                own honest path.
   THE MASTERS  the album downloads into the vault (a service-
                worker cache no deploy can rotate away) and plays
                with zero signal. Airplane mode is a demo, not a
                failure state.
   THE SYNDICATE an embed players other sites paste in — their
                page, our record, our credit. Distribution.
   THE BEAM     the record jumps to other screens (Cast/AirPlay)
                when the platform offers a picker.

   Plus the lock screen grows up: artwork with declared sizes,
   live position state, ±10s — the car dashboard treats this
   catalog like a streaming service because it is one.
   ============================================================ */
(function () {
  "use strict";
  var rail = document.getElementById("labelRail");
  var deck = document.getElementById("deck");
  if (!rail || !deck) return;

  var VAULT = "mcc-vault-v1";
  var ALBUM = (new URLSearchParams(location.search).get("album") || "here").toLowerCase();
  var track = window.MCC_TRACK || function () {};

  /* ---------------- small furniture: toast + bottom sheet ---------------- */
  var toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "ltoast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove("on"); }, 3400);
  }

  var sheetEl = null;
  function sheet(html) {
    if (!sheetEl) {
      sheetEl = document.createElement("div");
      sheetEl.className = "lsheet";
      sheetEl.setAttribute("role", "dialog");
      sheetEl.setAttribute("aria-modal", "true");
      document.body.appendChild(sheetEl);
      sheetEl.addEventListener("click", function (e) {
        if (e.target.hasAttribute("data-lclose")) sheetEl.classList.remove("on");
      });
    }
    sheetEl.innerHTML = html +
      '<button class="lsheet__x" type="button" data-lclose aria-label="Close">Close</button>';
    requestAnimationFrame(function () { sheetEl.classList.add("on"); });
    return sheetEl;
  }

  function pill(label, cls) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "lrail__b" + (cls ? " " + cls : "");
    b.textContent = label;
    rail.appendChild(b);
    return b;
  }

  /* ================= THE APP ================= */
  var standalone = matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;
  var iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var bip = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    bip = e;
  });

  if (standalone) {
    var inApp = pill("You're in the app", "lrail__b--done");
    inApp.disabled = true;
  } else {
    var appBtn = pill("Get the app");
    appBtn.addEventListener("click", function () {
      track("app_install_open", { album: ALBUM });
      if (bip) {
        bip.prompt();
        bip.userChoice.then(function (c) {
          if (c && c.outcome === "accepted") { appBtn.textContent = "The app is yours"; appBtn.classList.add("lrail__b--done"); }
          bip = null;
        }).catch(function () {});
        return;
      }
      var dev = window.MCC_DEVICE || { kind: iOS ? "iphone" : "computer", phrase: iOS ? "your phone" : "your device" };
      var steps;
      if (dev.kind === "iphone" || dev.kind === "ipad") {
        steps = "<ol><li>Tap the <b>Share</b> button in Safari's toolbar</li>" +
          "<li>Scroll and tap <b>Add to Home Screen</b></li>" +
          "<li>Tap <b>Add</b> — the app lands next to the rest</li></ol>";
      } else if (dev.kind === "android") {
        steps = "<ol><li>Open the browser menu (<b>⋮</b> — or <b>≡</b> in Samsung Internet)</li>" +
          "<li>Tap <b>Add to Home screen</b> or <b>Install app</b></li>" +
          "<li>Confirm — the app lands on " + dev.phrase + "'s home screen</li></ol>";
      } else if (dev.kind === "tv") {
        steps = '<p class="lsheet__fine">On a TV, the easiest road is the phone in your pocket: ' +
          "open this same address there and install it in two taps.</p>";
      } else {
        steps = "<ol><li>Look for the <b>install icon</b> at the right end of the address bar</li>" +
          "<li>Click it and choose <b>Install</b></li>" +
          "<li>The app opens in its own window on " + dev.phrase + " from then on</li></ol>";
      }
      sheet(
        "<h3>Put HERE on " + dev.phrase + "</h3>" + steps +
        '<p class="lsheet__fine">Full screen, its own icon, opens instantly, works offline. ' +
        "No store, no gatekeeper, no cut taken.</p>"
      );
    });
  }
  window.addEventListener("appinstalled", function () {
    toast("The app is yours. Look for HERE on your home screen.");
    track("app_installed", { album: ALBUM });
  });

  /* ================= THE MASTERS ================= */
  var mastersBtn = pill("Keep the masters");
  mastersBtn.disabled = true;
  var canVault = "caches" in window;
  if (!canVault) mastersBtn.hidden = true;

  function abs(u) { return new URL(u, location.href).href.split("?")[0]; }

  function manifestOfRows() {
    var files = [], seen = {};
    function add(u) { if (u && !seen[u]) { seen[u] = 1; files.push(abs(u)); } }
    [].forEach.call(document.querySelectorAll("#tracks li"), function (li) {
      add(li.getAttribute("data-src"));
      add(li.getAttribute("data-art"));
      add(li.getAttribute("data-lyrics"));
      add(li.getAttribute("data-poster"));
    });
    var art = document.getElementById("albArt");
    if (art) add(art.getAttribute("src"));
    return files;
  }

  function vaultState() {
    var files = manifestOfRows();
    if (!files.length) return Promise.resolve(null);
    return caches.open(VAULT).then(function (c) {
      return Promise.all(files.map(function (u) { return c.match(u); }))
        .then(function (hits) {
          var kept = hits.filter(Boolean).length;
          return { files: files, kept: kept, total: files.length };
        });
    });
  }

  function paintMasters(st) {
    if (!st) return;
    if (st.kept >= st.total) {
      mastersBtn.textContent = "In your pocket";
      mastersBtn.classList.add("lrail__b--done");
      mastersBtn.disabled = true;
      mastersBtn.title = "This album is downloaded. It plays with no signal.";
    } else {
      mastersBtn.textContent = st.kept > 0
        ? "Finish the download (" + st.kept + "/" + st.total + ")"
        : "Keep the masters";
      mastersBtn.disabled = false;
    }
  }

  var keeping = false;
  mastersBtn.addEventListener("click", function () {
    if (keeping || !canVault) return;
    keeping = true;
    track("masters_keep", { album: ALBUM });
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }
    vaultState().then(function (st) {
      if (!st) { keeping = false; return; }
      var c;
      return caches.open(VAULT).then(function (cc) { c = cc; })
        .then(function () {
          var done = 0, misses = 0;
          var audio = st.files.length;
          function one(i) {
            if (i >= st.files.length) return Promise.resolve();
            var u = st.files[i];
            return c.match(u).then(function (hit) {
              if (hit) { done++; return; }
              return fetch(u).then(function (res) {
                if (!res.ok) throw new Error(res.status);
                return c.put(u, res);
              }).then(function () { done++; })
                .catch(function () { misses++; });
            }).then(function () {
              mastersBtn.textContent = "Securing " + done + "/" + audio;
              return one(i + 1);
            });
          }
          return one(0).then(function () {
            keeping = false;
            if (misses) {
              toast("The signal dropped mid-download — tap again to finish. What's kept stays kept.");
              return vaultState().then(paintMasters);
            }
            toast("The masters are yours. Airplane mode can't touch this album now.");
            return vaultState().then(paintMasters);
          });
        });
    }).catch(function () { keeping = false; });
  });

  /* rows arrive after the data loads; arm the button when they land */
  var tr = document.getElementById("tracks");
  function armMasters() { vaultState().then(paintMasters); }
  if (tr) {
    if (tr.children.length) armMasters();
    new MutationObserver(armMasters).observe(tr, { childList: true });
  }

  /* the honest offline note: only when the pocket copy exists */
  window.addEventListener("offline", function () {
    vaultState().then(function (st) {
      if (st && st.kept >= st.total) toast("No signal. The masters play on.");
    });
  });

  /* ================= THE SYNDICATE ================= */
  var embedBtn = pill("Syndicate");
  embedBtn.addEventListener("click", function () {
    var base = location.origin + location.pathname.replace(/[^/]*$/, "");
    var on = document.querySelector("#tracks li.on");
    var idx = on ? [].indexOf.call(tr.children, on) : 0;
    var src = base + "embed.html?album=" + encodeURIComponent(ALBUM) +
      (idx > 0 ? "&t=" + idx : "");
    var code = '<iframe src="' + src + '" width="100%" height="132" ' +
      'style="max-width:440px;border:0;border-radius:18px" ' +
      'loading="lazy" allow="autoplay" title="McCluster Sound"><\/iframe>';
    var s = sheet(
      "<h3>Put this record on any site</h3>" +
      '<p class="lsheet__fine">Paste this anywhere HTML lives — a blog, a press page, a partner\'s site. ' +
      "Their page, this record, full credit riding with it.</p>" +
      '<textarea class="lsheet__code" readonly spellcheck="false" rows="4"></textarea>' +
      '<button class="lrail__b" type="button" data-lcopy>Copy the embed</button>'
    );
    s.querySelector(".lsheet__code").value = code;
    s.querySelector("[data-lcopy]").addEventListener("click", function () {
      var ta = s.querySelector(".lsheet__code");
      ta.select();
      var put = navigator.clipboard
        ? navigator.clipboard.writeText(code)
        : Promise.reject();
      put.catch(function () { try { document.execCommand("copy"); } catch (e) {} })
        .then(function () {
          toast("Embed copied. Their site just became your distribution.");
          track("embed_copy", { album: ALBUM });
        });
    });
  });

  /* ================= THE SHARE (on the open record) ================= */
  var shareBtn = document.getElementById("nowShare");
  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      var on = document.querySelector("#tracks li.on");
      var title = (on && on.getAttribute("data-title")) ||
        document.getElementById("albName").textContent.trim();
      var pg = on && on.querySelector("a[data-tpg]");
      var url = pg ? pg.href : (location.origin + location.pathname +
        (ALBUM !== "here" ? "?album=" + ALBUM : ""));
      var payload = { title: title + " — Matthew McCluster", text: "Hear it on McCluster Sound.", url: url };
      track("track_share", { track: title });
      if (navigator.share) {
        navigator.share(payload).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          toast("Link secured — paste it anywhere.");
        }).catch(function () { toast(url); });
      } else { toast(url); }
    });
  }

  /* ================= THE BEAM ================= */
  var beamBtn = document.getElementById("nowBeam");
  if (beamBtn) {
    if (deck.remote && deck.remote.prompt) {
      beamBtn.hidden = false;
      beamBtn.addEventListener("click", function () {
        track("beam_open", { album: ALBUM });
        deck.remote.prompt().catch(function () { toast("No other screens in range."); });
      });
    } else if (window.WebKitPlaybackTargetAvailabilityEvent) {
      beamBtn.hidden = false;
      beamBtn.addEventListener("click", function () {
        track("beam_open", { album: ALBUM });
        try { deck.webkitShowPlaybackTargetPicker(); } catch (e) {}
      });
    }
  }

  /* ============ THE LOCK SCREEN GROWS UP ============ */
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("seekbackward", function (d) {
        deck.currentTime = Math.max(0, deck.currentTime - (d.seekOffset || 10));
      });
      navigator.mediaSession.setActionHandler("seekforward", function (d) {
        deck.currentTime = Math.min(deck.duration || 1e9, deck.currentTime + (d.seekOffset || 10));
      });
    } catch (e) {}

    /* artwork with declared sizes: dashboards and watches pick well */
    deck.addEventListener("play", function () {
      setTimeout(function () {
        var md = navigator.mediaSession.metadata;
        if (!md || !md.artwork || !md.artwork.length) return;
        var src = md.artwork[0].src;
        if (md.artwork[0].sizes) return; // already dressed
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: md.title, artist: md.artist, album: md.album,
            artwork: ["96x96", "192x192", "512x512"].map(function (s) {
              return { src: src, sizes: s, type: "image/jpeg" };
            }),
          });
        } catch (e) {}
      }, 60);
    });

    /* live position: the scrubber on the lock screen tells the truth */
    var lastPos = 0;
    deck.addEventListener("timeupdate", function () {
      if (!navigator.mediaSession.setPositionState) return;
      var now = Date.now();
      if (now - lastPos < 1000) return;
      lastPos = now;
      if (!isFinite(deck.duration) || !deck.duration) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: deck.duration,
          playbackRate: deck.playbackRate || 1,
          position: Math.min(deck.currentTime, deck.duration),
        });
      } catch (e) {}
    });
  }

  /* ============ THE MARQUEE: the tab itself plays the record ============ */
  var baseTitle = document.title;
  function nowTitle() {
    var on = document.querySelector("#tracks li.on");
    return on ? on.getAttribute("data-title") : null;
  }
  function paintTab() {
    var t = nowTitle();
    document.title = !deck.paused && t ? "\u25BA " + t + " — McCluster Sound" : baseTitle;
  }
  deck.addEventListener("play", paintTab);
  deck.addEventListener("pause", paintTab);
  deck.addEventListener("loadedmetadata", paintTab);

  /* ============ THE VALET: a tired phone is asked for less ============ */
  if (navigator.getBattery) {
    navigator.getBattery().then(function (b) {
      function judge() {
        var low = b.level <= 0.15 && !b.charging;
        document.documentElement.setAttribute("data-power", low ? "low" : "ok");
      }
      judge();
      b.addEventListener("levelchange", judge);
      b.addEventListener("chargingchange", judge);
    }).catch(function () {});
  }

  /* ============ THE NIGHTCAP: the record tucks the listener in ============ */
  var napAt = 0, napTick = 0, napBtn = null;
  var NAPS = [0, 15, 30, 60];
  function napPaint(mins) {
    if (!napBtn) return;
    napBtn.textContent = mins ? "Sleep in " + mins + " min" : "Sleep timer";
    napBtn.classList.toggle("on", !!mins);
  }
  function napSet(mins) {
    clearInterval(napTick);
    if (!mins) { napAt = 0; napPaint(0); return; }
    napAt = Date.now() + mins * 60000;
    napPaint(mins);
    napTick = setInterval(function () {
      var left = napAt - Date.now();
      if (left > 10000) {
        if (napBtn) napBtn.textContent = "Sleep in " + Math.ceil(left / 60000) + " min";
        return;
      }
      /* the last ten seconds dim the lamp (iOS keeps its own volume; pause still lands) */
      try { deck.volume = Math.max(0, left / 10000); } catch (e) {}
      if (left <= 0) {
        clearInterval(napTick);
        deck.pause();
        try { deck.volume = 1; } catch (e) {}
        napAt = 0; napPaint(0);
        toast("The record tucked you in. Goodnight.");
        track("nightcap_done", {});
      }
    }, 1000);
  }
  var doors = document.querySelector(".now__doors");
  if (doors) {
    napBtn = document.createElement("button");
    napBtn.type = "button";
    napBtn.id = "nowNap";
    napPaint(0);
    var napIdx = 0;
    napBtn.addEventListener("click", function () {
      napIdx = (napIdx + 1) % NAPS.length;
      napSet(NAPS[napIdx]);
      track("nightcap_set", { minutes: NAPS[napIdx] });
    });
    doors.appendChild(napBtn);
  }
  window.MCC_NIGHTCAP = { set: napSet };
})();
