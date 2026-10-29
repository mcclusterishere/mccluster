/* ============================================================
   McCluster scroll engine
   Lenis smooth scroll + GSAP ScrollTrigger.
   Every cinematic sequence on the page is scroll-scrubbed:
   hero orbit, designer desk (pillars), songwriter studio (work).
   ============================================================ */

(function () {
  "use strict";

  /* FAIL-OPEN: if GSAP/Lenis never arrive or this file throws, the curtain
     still lifts. CSS also hides #preloader after ~2.2s; this is the JS twin. */
  var preloaderEl = document.getElementById("preloader");
  function liftGate() {
    if (!preloaderEl) return;
    if (preloaderEl.classList.contains("is-done")) return;
    if (preloaderEl.style.display === "none") return;
    preloaderEl.classList.add("is-done");
    preloaderEl.setAttribute("aria-hidden", "true");
    document.querySelectorAll(".hero__line .ch, .hero .reveal-line > span").forEach(function (el) {
      el.style.opacity = "1";
      el.style.transform = "none";
    });
  }
  setTimeout(liftGate, 2400);

  if (typeof gsap === "undefined") return;
  try {
    gsap.registerPlugin(ScrollTrigger);
  } catch (e) {
    liftGate();
    return;
  }

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- THE OWNER'S FRONT PAGE SETTINGS ----------------
     Owner, 2026-10-21: "I should be able to control my site's front page ... with the scroll dependent and the VR and all
     that stuff from my admin panel." Control → Create → Front page saves ONE row, site_content (page index.html, slot
     @front, a JSON value), which js/live-content.js reads for every visitor, and its preview posts a draft of the same
     shape to this page when it is framed by the Control Room on this origin. index.html is never rewritten.
     Every value is checked and bounded here; anything missing or wrong keeps what the page has always done, so no row
     (or a bad one) is the shipped page exactly. Settings that arrive after the page started apply where they still can:
     the scroll feel and the night room at once, the cabin's opening view and tags the next time it mounts. */
  var FRONT_DEFAULT = {
    scenes: { doors: true, vaunt: true, night: true, world: true },
    scroll: { duration: 0.85, touchLerp: 0.14 },
    vr: { enabled: true, hold: true, band: [0.40, 0.50], yaw: -140, pitch: -32, spots: [
      // pinned on the flight console between the pilots, measured off the equirect frame
      { yaw: -77, pitch: -13, label: "The cockpit · fly with Vaunt", href: "https://vauntapi.flyvaunt.com/referral/nuao1K", blank: true },
      { yaw: 131, pitch: -29, label: "Get to the bag", href: "hire.html", urgent: true },
      { yaw: -140, pitch: -40, label: "McCluster · the résumé", href: "matthew-mccluster.html" },
    ] },
    night: { arrive: 0.74 },
    /* owner, 2026-10-29: index.html opens INSIDE the Vaunt cabin, plays Antisocial, and can be tucked away from the
       public (visible:false: a holding screen for visitors, noindex, the house owner still sees the page) */
    start: "cabin", song: "antisocial", visible: true,
  };
  /* the one song a page may play: one of the <audio id="track-…"> elements index.html carries */
  var FRONT_SONGS = ["antisocial", "whodidtheshoot", "vaunt", "runway", "here", "environmental-injustice"];
  function frontNum(v, lo, hi, d) { var n = typeof v === "number" ? v : NaN; return isFinite(n) && n >= lo && n <= hi ? n : d; }
  function frontBool(v, d) { return typeof v === "boolean" ? v : d; }
  /* a tag's link stays on this site, or is an https link the owner typed; never a script */
  function frontHref(v) {
    var h = typeof v === "string" ? v.trim() : "";
    if (!h || h.length > 300) return null;
    if (/^https:\/\/[^\s"'<>]+$/i.test(h)) return h;
    return /^(?![a-z][a-z0-9+.-]*:)(?!\/\/)[a-z0-9_./?#=&%-]+$/i.test(h) ? h : null;
  }
  /* AN ACCOUNT'S MEDIA (owner, 2026-10-21: "all the accounts need to be able to recreate with their own media this exact
     same experience"): only files in an account's own folder of the public front-media bucket (packages/front-config
     checks the folder is the account's before anything is stored). A film is its frames, cut in the account's browser:
     base + 0001.webp … (and sm/ for phones). */
  var FRONT_MEDIA_RE = /^https:\/\/zmnhbrjyhxzhkxmhkexs\.supabase\.co\/storage\/v1\/object\/public\/front-media\/[0-9a-f-]{36}\/[A-Za-z0-9._\/-]+$/;
  function frontMediaUrl(v) { return typeof v === "string" && v.length <= 400 && v.indexOf("..") < 0 && FRONT_MEDIA_RE.test(v) ? v : null; }
  function frontFilm(x) {
    if (!x || typeof x !== "object") return null;
    var base = frontMediaUrl(x.base), n = x.count;
    return base && /\/$/.test(base) && n === (n | 0) && n >= 8 && n <= 240 && (x.ext === "webp" || x.ext === "jpg") ? { base: base, count: n, ext: x.ext, sm: x.sm === true } : null;
  }
  function frontMedia(m) {
    m = m && typeof m === "object" ? m : {};
    var c = m.cabin && typeof m.cabin === "object" ? m.cabin : null, cs = c && frontMediaUrl(c.src);
    return {
      hero: frontFilm(m.hero), scene1: frontFilm(m.scene1), scene2: frontFilm(m.scene2), night: frontFilm(m.night),
      cabin: cs && (c.kind === "video" || c.kind === "image") ? { src: cs, kind: c.kind, poster: frontMediaUrl(c.poster) } : null,
      sound: m.sound && frontMediaUrl(m.sound.src) ? { src: m.sound.src } : null,
      still: m.still && frontMediaUrl(m.still.src) ? { src: m.still.src } : null,
    };
  }
  /* member: an account's page (front.html). Its 360 room has its own tags or none, never the house's (Codex #595). */
  function frontConfig(raw, member) {
    var r = raw && typeof raw === "object" ? raw : {}, D = FRONT_DEFAULT;
    var sc = r.scenes || {}, sr = r.scroll || {}, v = r.vr || {}, n = r.night || {};
    var band = Array.isArray(v.band) && v.band.length === 2 ? [frontNum(v.band[0], 0.15, 0.85, NaN), frontNum(v.band[1], 0.15, 0.85, NaN)] : null;
    if (!band || !(band[1] - band[0] >= 0.04)) band = D.vr.band.slice();
    var spots = Array.isArray(v.spots) ? v.spots.slice(0, 5).map(function (x) {
      var label = x && typeof x.label === "string" ? x.label.trim().slice(0, 60) : "", href = frontHref(x && x.href);
      if (!label || !href) return null;
      return { yaw: frontNum(x.yaw, -180, 180, 0), pitch: frontNum(x.pitch, -85, 85, 0), label: label, href: href, blank: /^https:/i.test(href), urgent: x.urgent === true };
    }).filter(Boolean) : null;
    return {
      scenes: { doors: frontBool(sc.doors, true), vaunt: frontBool(sc.vaunt, true), night: frontBool(sc.night, true), world: frontBool(sc.world, true) },
      scroll: { duration: frontNum(sr.duration, 0.3, 1.8, D.scroll.duration), touchLerp: frontNum(sr.touchLerp, 0.05, 0.4, D.scroll.touchLerp) },
      vr: { enabled: frontBool(v.enabled, true), hold: frontBool(v.hold, true), band: band, yaw: frontNum(v.yaw, -180, 180, D.vr.yaw), pitch: frontNum(v.pitch, -85, 85, D.vr.pitch), spots: member ? (spots || []) : spots && spots.length ? spots : D.vr.spots },
      night: { arrive: frontNum(n.arrive, 0.5, 0.86, D.night.arrive) },
      start: r.start === "plane" || r.start === "cabin" ? r.start : D.start,
      song: FRONT_SONGS.indexOf(r.song) >= 0 ? r.song : D.song,
      visible: frontBool(r.visible, D.visible),
      media: frontMedia(r.media),
    };
  }
  /* AN ACCOUNT'S OWN FRONT PAGE (front.html?u=<handle>): js/front-member.js reads the account's published page (or, in
     its editor's preview, the draft) before this file runs and hands it over here, with the page's words already in
     place. The same engine then runs the account's media. The house page (index.html) has no such hand-over. */
  var MEMBER = window.MCC_FRONT_SOURCE && typeof window.MCC_FRONT_SOURCE === "object" ? window.MCC_FRONT_SOURCE : null;
  var FRONT = frontConfig(MEMBER ? MEMBER.config : null, !!MEMBER);
  /* THE HOUSE PAGE OPENS IN THE CABIN (owner, 2026-10-29). index.html carries #cabin, the 360 room as its first scene,
     playing at once, muted, with no Allow / Cancel; an account's page (front.html) keeps its cabin inside the films,
     behind its gate, exactly as before. */
  var CABIN_FIRST = !MEMBER && !!document.getElementById("cabin");
  // Repository-managed project assets are separate from member-upload validation.
  var PROJECT = MEMBER && !MEMBER.studio && window.MCC_FRONT_PROJECTS && window.MCC_FRONT_PROJECTS.get(MEMBER.project);
  if (PROJECT) FRONT.media = PROJECT.config.media;
  window.MCC_FRONT_DEFAULT = frontConfig(null);   // what the page does with no row: the Control Room's starting point
  var frontHooks = [];
  function frontRow() {
    var rows = window.MCC_CONTENT_ROWS;
    if (!Array.isArray(rows)) return null;
    for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].slot === "@front") { try { return JSON.parse(rows[i].value); } catch (e) { return null; } }
    return null;
  }
  function setFront(raw, source) {
    FRONT = frontConfig(raw, !!MEMBER);
    if (PROJECT) FRONT.media = PROJECT.config.media;
    window.MCC_FRONT = { config: FRONT, source: source || "shipped" };
    document.documentElement.setAttribute("data-front", source || "shipped");
    frontHooks.forEach(function (fn) { try { fn(FRONT); } catch (e) {} });
  }
  window.MCC_FRONT = { config: FRONT, source: MEMBER ? "member" : "shipped" };
  /* the editors' preview: a draft from the frame's parent on this origin (the house's Control Room, or an account's own
     editor, front-studio.html), never from anywhere else */
  var framedByControl = false;
  try { framedByControl = window.parent !== window && window.parent.location.origin === location.origin && /(?:control|front-studio)\.html$/.test(window.parent.location.pathname); } catch (e) {}

  /* ---------------- Lenis smooth scroll ----------------
     Tuned for CONTROL: the page must feel held, not driven. A shorter
     glide (0.85s), and on touch devices the scroll runs through Lenis
     too (syncTouch): one pipeline for finger and film, which also
     kills the pinned-section jitter iOS gets on native momentum. A
     firmer syncTouchLerp keeps the page pinned to the finger, and a
     calmer inertia stops the coast sooner after a flick. */
  var lenis;
  if (typeof Lenis === "function") {
    lenis = new Lenis({
      duration: FRONT.scroll.duration,
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      smoothWheel: !prefersReduced,
      syncTouch: !prefersReduced,
      syncTouchLerp: FRONT.scroll.touchLerp,
      touchInertiaMultiplier: 22,
    });
    lenis.on("scroll", typeof ScrollTrigger !== "undefined" ? ScrollTrigger.update : function () {});
    gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);
    /* Lenis reads its options as it goes: a new scroll feel takes effect at once */
    frontHooks.push(function (f) { lenis.options.duration = f.scroll.duration; lenis.options.syncTouchLerp = f.scroll.touchLerp; });
  } else {
    lenis = {
      on: function () {},
      scrollTo: function (t) {
        if (typeof t === "number") window.scrollTo(0, t);
        else {
          var el = typeof t === "string" ? document.querySelector(t) : t;
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth" });
        }
      },
      stop: function () {},
      start: function () {},
    };
  }

  try {

  /* ---------------- letter splitting ---------------- */
  function splitLines(rootSel) {
    var chars = [];
    document.querySelectorAll(rootSel + " .hero__line").forEach(function (line) {
      var word = line.getAttribute("data-word") || "";
      line.textContent = "";
      word.split("").forEach(function (c) {
        var s = document.createElement("span");
        s.className = "ch";
        s.textContent = c;
        line.appendChild(s);
        chars.push(s);
      });
    });
    return chars;
  }
  var heroChars = splitLines("#heroTitle");
  var finaleChars = splitLines("#finaleTitle");

  /* Do NOT hide the titles. Empty opacity-0 letters on a dark canvas is
     the blackout. The orbit still scrubs them later. */

  /* ---------------- scroll-scrubbed frame sequences ---------------- */
  function pad4(n) { return String(n).padStart(4, "0"); }

  function createSequence(canvasId, fallbackId, isHero) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    var seq = {
      canvas: canvas,
      ctx: canvas.getContext("2d"),
      fallbackId: fallbackId,
      isHero: !!isHero,
      frames: [],
      count: 0,
      current: 0,   // lerped position
      target: 0,    // scroll-driven target
      lastDrawn: -1,
      loadedMax: -1, // highest contiguous loaded frame index
      ready: false,
      onScreen: true, // visibility gate: offscreen films don't draw
    };
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        seq.onScreen = es[0].isIntersecting;
      }, { rootMargin: "20% 0px" }).observe(canvas);
    }
    seq.drawImg = function (img) {
      if (!img || !img.complete || !img.naturalWidth) return false;
      var cw = canvas.width, ch = canvas.height;
      var s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      var w = img.naturalWidth * s, h = img.naturalHeight * s;
      seq.ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      return true;
    };
    seq.size = function () {
      // phones don't need a 2× backing store for a full-bleed film, so cap the
      // device-pixel-ratio to 1 on small screens so the canvas costs a quarter
      // of the GPU memory and each drawImage is far cheaper (smoother scrub).
      // the hero earns retina; the background films run at 1.5×, half the
      // pixels pushed per drawImage, and nobody can tell behind a scrim
      var maxDpr = window.matchMedia("(max-width: 768px)").matches ? 1 : (seq.isHero ? 2 : 1.5);
      var dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      seq.lastDrawn = -1; // force redraw
      // a resize clears the canvas, so keep the poster up until the film runs
      if (!seq.ready && seq.poster) seq.drawImg(seq.poster);
    };
    seq.draw = function (i) {
      // on the half-density mobile diet some frames are deliberately absent,
      // so step down to the nearest one that exists so the film never blinks
      var j = i;
      while (j > 0 && !seq.frames[j]) j--;
      if (seq.drawImg(seq.frames[j])) seq.lastDrawn = i;
    };
    seq.fallback = function () {
      var fb = document.getElementById(fallbackId);
      if (fb) {
        fb.classList.add("is-active");
        fb.play().catch(function () {});
      }
      canvas.style.display = "none";
    };
    window.addEventListener("resize", seq.size);
    seq.size();
    return seq;
  }

  var sequences = {
    hero: createSequence("orbitCanvas", "heroFallback", true),
    pillarsbg: createSequence("pillarsCanvas", "pillarsVideo"),
    keynote: createSequence("loadoutCanvas", null),
    vauntlive: createSequence("cmdCanvas5", null),
    vaunt: createSequence("cmdCanvas4", null),
  };

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /* ---------------- mouse parallax hookups ----------------
     Each slide hands its local progress to the parallax layer;
     near a film's final frame the scene starts following the cursor. */
  var PAR = window.MCC_PARALLAX || {
    attach: function () { return null; },
    set: function () {},
    ramp: function () { return 0; },
  };
  function parCanvas(seqKey, opts) {
    var s = sequences[seqKey];
    return s ? PAR.attach(s.canvas, opts || { depth: 15, tilt: 2.4, push: 0.06 }) : null;
  }

  // butter loop: every tick, lerp each sequence toward its scroll target.
  // The film must feel HELD by the scroll, not chasing it. Touch tracks
  // tighter than mouse because a finger expects 1:1.
  var FILM_LERP = ("ontouchstart" in window || navigator.maxTouchPoints > 0) ? 0.42 : 0.3;
  gsap.ticker.add(function () {
    Object.keys(sequences).forEach(function (k) {
      var s = sequences[k];
      if (!s || !s.ready || !s.onScreen) return;
      s.current += (s.target - s.current) * FILM_LERP;
      var i = Math.round(s.current);
      i = Math.max(0, Math.min(s.count - 1, i));
      // never scrub past what's decoded: hold the nearest loaded frame
      i = Math.min(i, s.loadedMax);
      if (i >= 0 && i !== s.lastDrawn) s.draw(i);
    });
  });

  // THE MOBILE DIET: small screens stream every 2nd frame. The scrub's lerp
  // smooths a 10fps step exactly like a 20fps one, the draw() fallback holds
  // the nearest loaded frame, and the phone downloads half the film.
  var FRAME_STEP = window.matchMedia("(max-width: 768px)").matches ? 2 : 1;

  /* THE PHONE'S OWN PRINT: the canvas is capped at 1x device pixels on small
     screens (see seq.size), so a 1536px frame was being decoded to paint a
     ~390px box. assets/frames/sm holds the same films at 768px — the same
     scrub, 55% fewer bytes. */
  var FRAME_DIR = window.matchMedia("(max-width: 768px)").matches ? "sm/" : "";

  /* THE BACKGROUND DIET: the hero is the one film the eye actually studies,
     so it keeps every frame on a desktop. The films behind the scrims are
     read through blur and a dark grade — they stream every 2nd frame there
     too, and the scrub's lerp smooths the step exactly as it does on a
     phone. Half the bytes for a difference nobody can point at. */
  function stepFor(name) {
    if (FRAME_STEP > 1) return FRAME_STEP;      /* phones already on the diet */
    return name === "hero" ? 1 : 2;
  }

  /* which of an account's films plays in which of the page's canvases */
  var FILM_KEYS = { hero: "hero", vauntlive: "scene1", vaunt: "scene2", nightscroll: "night" };
  /* only on an account's page: the house page's films are its own, whatever a settings row carries */
  function memberFilm(name) { var k = FILM_KEYS[name]; return (MEMBER && k && FRONT.media && FRONT.media[k]) || null; }
  function frameUrl(name, i) {
    var f = memberFilm(name);
    if (f) return f.base + (f.sm && FRAME_DIR ? "sm/" : "") + (f.prefix || "") + pad4(i) + "." + f.ext;
    return "assets/frames/" + FRAME_DIR + name + "_" + pad4(i) + ".webp";
  }
  /* an account's page has no manifest file: its films are its settings */
  function memberManifest() {
    var m = {};
    Object.keys(FILM_KEYS).forEach(function (name) { var f = memberFilm(name); if (f) m[name] = { count: f.count }; });
    return m;
  }

  function loadSequence(seq, name, count, onProgress) {
    seq.count = count;
    var FRAME_STEP = stepFor(name);              /* shadows the global, per film */
    return new Promise(function (resolve) {
      var loaded = 0;
      var flags = new Array(count);
      var wanted = 0;
      for (var w = 1; w <= count; w++) if ((w - 1) % FRAME_STEP === 0 || w === count) wanted++;
      for (var i = 1; i <= count; i++) {
        (function (i) {
          // skipped frames count as arrived instantly, so the gate math holds
          if ((i - 1) % FRAME_STEP !== 0 && i !== count) {
            flags[i - 1] = true;
            while (seq.loadedMax + 1 < count && flags[seq.loadedMax + 1]) seq.loadedMax++;
            return;
          }
          var img = new Image();
          /* the scroll sequences ship as webp: same frames, roughly half the
             bytes, and every engine since 2020 decodes them */
          img.src = frameUrl(name, i);
          img.onload = img.onerror = function () {
            loaded++;
            flags[i - 1] = true;
            while (seq.loadedMax + 1 < count && flags[seq.loadedMax + 1]) seq.loadedMax++;
            if (!seq.ready && seq.loadedMax >= 0) {
              seq.ready = true;
              seq.draw(0);
            }
            if (onProgress) onProgress(loaded / wanted);
            if (loaded === wanted) resolve();
          };
          seq.frames[i - 1] = img;
        })(i);
      }
    });
  }

  /* ---------------- preloader (gates on the hero sequence) ---------------- */
  var preloader = document.getElementById("preloader");
  var enterAsked = false;

  /* RETURNING VISITORS SKIP THE WAIT. The preloader exists so the hero
     sequence's lead batch is in before the door opens on a first visit.
     Making someone who has already been here count to 100 again is a
     toll, not an experience: hide the gate instantly, open the site as
     soon as the manifest answers, and let the films stream behind the
     posters like they already do. The flag is set the first time the
     site actually opens, not on arrival, so an abandoned first load
     still gets the full intro next time. */
  var returningVisitor = false;
  try {
    returningVisitor = !!window.localStorage && localStorage.getItem("mcc-been-here") === "1";
  } catch (e) { returningVisitor = false; }
  if (preloader && returningVisitor) {
    preloader.style.display = "none";
    preloader.setAttribute("aria-hidden", "true");
  }

  if (preloader) {
    preloader.addEventListener("click", function () {
      enterAsked = true;
      if (window.__MCC_ENTER) window.__MCC_ENTER();
    });
    setTimeout(function () { preloader.classList.add("is-skippable"); }, 1200);
    /* the watchdog: a wedged connection must never hold the door.
       After 8s the site opens with whatever has arrived. Posters and
       fallbacks cover the canvases, the content never waits. */
    setTimeout(function () {
      if (window.__MCC_ENTER) window.__MCC_ENTER();
      else finishPreloader();
    }, 2400);
  }
  var preCount = document.getElementById("preCount");
  var shown = { v: 0 };

  var preMarkL = document.querySelector(".preloader__piece--l");
  var preMarkR = document.querySelector(".preloader__piece--r");

  function setCount(v) {
    if (!preCount) return;
    preCount.textContent = String(Math.round(v)).padStart(3, "0");
    if (!preloader) return;
    // two-stage escalation: ignite at 50%, second hit near the end
    preloader.classList.toggle("is-hot", v >= 50);
    preloader.classList.toggle("is-blazing", v >= 85);
    // the mark pulls itself together as the load progresses
    var r = 1 - v / 100; // remaining distance
    if (preMarkL) {
      preMarkL.style.transform =
        "translate(" + (-64 * r) + "px," + (-44 * r) + "px) rotate(" + (-24 * r) + "deg)";
      preMarkL.style.opacity = 0.25 + 0.75 * (1 - r);
      preMarkL.style.filter = "blur(" + 5 * r + "px)";
      preMarkR.style.transform =
        "translate(" + (64 * r) + "px," + (44 * r) + "px) rotate(" + (24 * r) + "deg)";
      preMarkR.style.opacity = 0.25 + 0.75 * (1 - r);
      preMarkR.style.filter = "blur(" + 5 * r + "px)";
    }
  }
  setCount(0);

  window.__MCC_ENTER = null; // the tap-to-enter hook, armed by the manifest loader
  function finishPreloader() {
    if (returningVisitor) {
      /* no count, no curtain: the gate is already hidden, just reveal */
      introReveal();
      return;
    }
    function done() {
      if (preloader) preloader.classList.add("is-done");
      introReveal();
    }
    if (typeof gsap === "undefined") { done(); return; }
    gsap.to(shown, {
      v: 100, duration: 0.5, ease: "power2.out",
      onUpdate: function () { setCount(shown.v); },
      onComplete: done,
    });
  }

  function introReveal() {
    if (!heroChars.length) return;   // index.html has no hero now: it opens in the cabin
    var tl = gsap.timeline();
    tl.to(heroChars, {
      yPercent: 0, opacity: 1, rotate: 0,
      duration: 1.1, ease: "power4.out", stagger: 0.045,
    });
    tl.to(".hero .reveal-line > span", {
      yPercent: 0, opacity: 1, duration: 0.9, ease: "power3.out", stagger: 0.12,
    }, "-=0.7");
  }

  (MEMBER ? Promise.resolve(memberManifest()) : fetch("assets/frames/manifest.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error("no manifest"); return r.json(); }))
    .then(function (m) {
      // Open on a LEAD BATCH, not the whole orbit. The hero section is 520vh
      // tall, so the viewer physically cannot scrub past the first frames
      // instantly. By the time they scroll down, the rest of the orbit has
      // streamed in behind them. loadSequence keeps loading all frames; the
      // ticker's loadedMax clamp holds the newest decoded frame until each one
      // arrives, so the scrub never shows black. This drops the blocking load
      // from all 161 frames (4.28 MB of webp) to 48 (1.35 MB) without a half-loaded feel.
      var full = m.hero && sequences.hero ? m.hero.count : 0;   // no orbit on the page (index.html opens in the cabin): open at once
      var heroGate = Math.min(48, full);
      var opened = false;
      window.__MCC_ENTER = function () {
        if (!opened) { opened = true; openSite(); }
      };
      if (enterAsked) window.__MCC_ENTER(); // a tap that landed early is honored now
      /* an account's page with no hero film opens on its still at once */
      if (!full) { if (sequences.hero) sequences.hero.fallback(); opened = true; openSite(); }
      else loadSequence(sequences.hero, "hero", full, function () {
        var ready = sequences.hero.loadedMax + 1; // contiguous frames from 0
        var gp = Math.min(1, ready / heroGate);
        var pct = gp * 100;
        if (pct > shown.v) { shown.v = pct * 0.99; setCount(shown.v); }
        if (!opened && ready >= heroGate) { opened = true; openSite(); }
      });
      function openSite() {
        try { if (window.localStorage) localStorage.setItem("mcc-been-here", "1"); } catch (e) {}
        finishPreloader();
        // Every film shows its opening frame from the moment the site
        // opens. A canvas must never sit black while the visitor scrolls
        // faster than the connection streams.
        function loadPoster(key, name) {
          var s = sequences[key];
          if (!s || !m[name]) return;
          var img = new Image();
          img.src = memberFilm(name) ? frameUrl(name, 1) : "assets/frames/" + name + "_0001.jpg";
          img.onload = function () {
            if (s.ready) return;
            var cw = s.canvas.width, ch = s.canvas.height;
            var sc = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
            s.ctx.drawImage(img, (cw - img.naturalWidth * sc) / 2, (ch - img.naturalHeight * sc) / 2,
              img.naturalWidth * sc, img.naturalHeight * sc);
          };
        }
        // Each section's full film loads once the scroll gets within a few
        // screens of it, so opening the page never downloads the whole site.
        function loadGroup(specs) {
          specs.forEach(function (spec) {
            var key = spec[0], name = spec[1];
            if (m[name]) loadSequence(sequences[key], name, m[name].count);
            else sequences[key].fallback();
          });
        }
        function loadNear(sel, specs) {
          specs = specs.filter(function (spec) { return sequences[spec[0]]; });
          if (!document.querySelector(sel) || !specs.length) return;
          specs.forEach(function (spec) { loadPoster(spec[0], spec[1]); });
          ScrollTrigger.create({
            // the diet: films load when the section is under two screens away,
            // not five. Posters cover the gap
            trigger: sel, start: "top 175%", once: true,
            onEnter: function () { loadGroup(specs); },
          });
        }
        if (document.getElementById("loadout"))
          loadNear("#loadout", [["keynote", m.studio360 ? "studio360" : "keynote"]]);
        loadNear("#pillars", [
          ["pillarsbg", "nightscroll"],
        ]);
        loadNear("#work", [
          ["vauntlive", "vauntlive"], ["vaunt", "vaunt"],
        ]);
        ScrollTrigger.refresh();
      }
    })
    .catch(function () {
      // no frames committed, so fall back to raw videos everywhere
      Object.keys(sequences).forEach(function (k) { if (sequences[k]) sequences[k].fallback(); });
      finishPreloader();
    });

  /* ---------------- hero scrub ---------------- */
  var hudDeg = document.getElementById("hudDeg");
  var heroOffer = document.getElementById("heroOffer");
  var parHero = parCanvas("hero");

  /* only a page that still has the orbit (an account's front.html): index.html opens in the cabin now */
  if (sequences.hero && document.getElementById("hero")) {
  ScrollTrigger.create({
    trigger: "#hero",
    start: "top top",
    end: "bottom bottom",
    scrub: true,
    onUpdate: function (st) {
      var p = st.progress;
      sequences.hero.target = p * (sequences.hero.count - 1 || 0);
      // the orbit is a full 360. Once the camera comes all the way around,
      // the degree readout locks on 360° and flashes, and the offer pops up.
      var done = p >= 0.94;
      hudDeg.textContent = (done ? "360" : String(Math.round(p * 360)).padStart(3, "0")) + "°";
      hudDeg.classList.toggle("is-360", done);
      if (heroOffer) heroOffer.classList.toggle("is-shown", done);
      PAR.set(parHero, st.isActive ? PAR.ramp(p) : 0);
    },
    onToggle: function (st) { if (!st.isActive) PAR.set(parHero, 0); },
  });

  // kinetic type: letters track apart and drift out as the orbit runs
  gsap.timeline({
    scrollTrigger: { trigger: "#hero", start: "top top", end: "55% bottom", scrub: 0.6 },
  })
    .to(heroChars, {
      letterSpacing: "0.35em",
      yPercent: -40,
      opacity: 0,
      stagger: { each: 0.02, from: "center" },
      ease: "power1.in",
    })
    .to(".hero__sub, .hero__eyebrow", { opacity: 0, yPercent: -60 }, 0)
    .to(".hud__scroll", { opacity: 0 }, 0);
  }

  /* ---------------- the loadout: 360 studio pan, three corners ----------------
     (lives on its own page when absent from this one, so guard and move on) */
  (function () {
    if (!document.getElementById("loadout")) return;
    var loPanels = gsap.utils.toArray("#loadout .command__panel");
    var loCount = document.getElementById("loCount");
    var current = 0;
    var parLoCanvas = parCanvas("keynote");
    var parLoPanels = PAR.attach(document.querySelector("#loadout .command__panels"), { depth: -7 });

    function applyLoadout(p) {
      var active = Math.min(2, Math.floor(p * 3));
      // one continuous film across the whole section: the pan never resets
      sequences.keynote.target = p * (sequences.keynote.count - 1 || 0);
      loPanels.forEach(function (el, i) { el.classList.toggle("is-active", i === active); });
      loCount.textContent = "0" + (active + 1) + " / 03";
      current = active;
      // the pan comes alive at the end of each corner's band
      var s = PAR.ramp(clamp01(p * 3 - active));
      PAR.set(parLoCanvas, s);
      PAR.set(parLoPanels, s);
    }
    applyLoadout(0);

    // the M-network snaps: stop scrolling and the pan swings all the way to the
    // nearest corner: photo, then recording, then broadcast. Scoped to this
    // section only, and eased through Lenis so it doesn't fight the smooth scroll.
    var LO_SNAP = [1 / 6, 0.5, 5 / 6]; // the centre of each corner's band
    var snapTimer = null, snapping = false;
    function scheduleSnap(st) {
      if (snapping) return;
      clearTimeout(snapTimer);
      snapTimer = setTimeout(function () {
        if (!st.isActive || snapping) return;
        var p = st.progress;
        var target = LO_SNAP.reduce(function (a, c) { return Math.abs(c - p) < Math.abs(a - p) ? c : a; });
        if (Math.abs(target - p) < 0.012) return; // already parked on a corner
        var y = st.start + target * (st.end - st.start);
        snapping = true;
        lenis.scrollTo(y, { duration: 0.55, easing: function (t) { return 1 - Math.pow(1 - t, 3); } });
        setTimeout(function () { snapping = false; }, 650);
      }, 150);
    }

    ScrollTrigger.create({
      trigger: "#loadout",
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      onUpdate: function (st) {
        applyLoadout(st.progress);
        if (st.isActive) scheduleSnap(st);
        else { PAR.set(parLoCanvas, 0); PAR.set(parLoPanels, 0); }
      },
      onToggle: function (st) {
        if (!st.isActive) { clearTimeout(snapTimer); snapping = false; PAR.set(parLoCanvas, 0); PAR.set(parLoPanels, 0); }
      },
    });
    gsap.from("#loadout .command__head", {
      x: -70, opacity: 0, duration: 1, ease: "power3.out",
      scrollTrigger: { trigger: "#loadout", start: "top 60%" },
    });
    window.__MCC_GEAR = function () { return current; };
  })();

  /* ---------------- scroll progress bar ---------------- */
  gsap.to("#scrollProgressBar", {
    scaleX: 1,
    ease: "none",
    scrollTrigger: { trigger: document.body, start: "top top", end: "max", scrub: 0.3 },
  });

  /* ---------------- Antisocial explainer: one scroll-locked film (night
     descent into the house) behind the pinned copy ---------------- */
  var pillarsBg = sequences.pillarsbg;
  if (pillarsBg) {
    pillarsBg.canvas.style.opacity = 1;
    var parPillars = parCanvas("pillarsbg");
    var parPanelsPB = PAR.attach(document.querySelector("#pillars .command__panels"), { depth: -7 });
    var pillarsStage = document.querySelector("#pillars .command__sticky");
    /* THE HANDOVER, and how much of the night scroll it was eating.

       The section is pulled up a screen (see .services in css/style.css) so
       it begins while the Vaunt fly-through is still pinned, and the stage
       dissolves in over the first slice — the two films are one transition,
       and a hard join was cutting it in half.

       But the film was ALSO being scrubbed from frame zero across that same
       slice, behind an opacity still climbing out of nothing. By the time
       the night scroll was actually on screen it was a third of the way in:
       the opening beat — the descent out of the aircraft, which is the whole
       reason this shot follows the jet — had already played to nobody. The
       cut read as a non-sequitur because its first sentence was missing.

       So the film now HOLDS on its opening frame for the length of the
       dissolve and only starts moving once it owns the screen. You watch it
       come out of the plane. The scrub is remapped onto what is left, and
       the section is lengthened to match so the descent plays at the same
       pace it always did rather than being sped up to fit. */
    var PB_HANDOVER = 0.19;   // the dissolve: film held, opacity climbing
    /* THE ARRIVAL. The descent runs to PB_ARRIVE, and the last stretch is
       dwell: the film holds on the lit window while the room fades up and
       the viewer actually reads it. Without that tail the close would land
       on the final frame and be scrolled past in the same gesture.

       The pin is lengthened by the dwell rather than the scrub being
       squeezed into the old length, so the descent still plays at the pace
       it always did. */
    var PB_ARRIVE = FRONT.night.arrive;   // 0.74 as shipped; the owner's front page settings can move it
    frontHooks.push(function (f) { PB_ARRIVE = f.night.arrive; });
    var PB_RAMP = 0.13;       // fully up well before the pin ends; rest is dwell
    var nightRoom = document.getElementById("nightRoom");
    var nightRoomLive = false;
    ScrollTrigger.create({
      trigger: "#pillars",
      start: "top top",
      end: "+=232%",   // 172% as before, plus the dwell the room needs
      scrub: true,
      pin: "#pillars .command__sticky",
      pinSpacing: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: function (st) {
        var q = clamp01((st.progress - PB_HANDOVER) / (PB_ARRIVE - PB_HANDOVER));
        pillarsBg.target = q * (pillarsBg.count - 1 || 0);
        if (nightRoom) {
          /* The ramp SATURATES BEFORE THE END OF THE PIN, deliberately.

             Tying it to (1 - PB_ARRIVE) meant the room only reached full
             opacity, and only became clickable, at progress exactly 1.0 --
             and a scrub driven by smooth scrolling, a trackpad's rubber band
             or a short viewport routinely tops out a little under that.
             Measured in a real browser it settled at 0.867, which left the
             chat sitting at 49% and permanently inert: visible, inviting,
             and impossible to type in. A close that cannot be reached is
             worse than no close.

             So it is fully up at PB_ARRIVE + PB_RAMP, with the rest of the
             pin as dwell, and it becomes interactive as soon as it is
             legible rather than when it is perfect. Once armed it stays
             armed for the rest of the descent -- interactivity that
             flickers with scroll jitter eats taps. */
          var arrival = clamp01((st.progress - PB_ARRIVE) / PB_RAMP);
          nightRoom.style.opacity = arrival;
          nightRoom.style.transform = "translateY(" + ((1 - arrival) * 26).toFixed(2) + "px)";
          if (arrival > 0.35) nightRoomLive = true;
          else if (st.progress < PB_ARRIVE) nightRoomLive = false;
          nightRoom.style.pointerEvents = nightRoomLive ? "auto" : "none";
        }
        var ps = st.isActive ? PAR.ramp(st.progress) : 0;
        PAR.set(parPillars, ps);
        PAR.set(parPanelsPB, ps);
        pillarsStage.style.opacity = clamp01(st.progress / PB_HANDOVER);
      },
      onToggle: function (st) {
        if (!st.isActive) { PAR.set(parPillars, 0); PAR.set(parPanelsPB, 0); }
      },
    });
  }

  // the fact/observation bullets hold their slide-in until the frame is actually on screen
  var antiDuo = document.querySelector(".antiabout__duo");
  if (antiDuo && "IntersectionObserver" in window) {
    var duoIO = new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) { antiDuo.classList.add("is-in"); duoIO.disconnect(); }
    }, { threshold: 0.35 });
    duoIO.observe(antiDuo);
  } else if (antiDuo) {
    antiDuo.classList.add("is-in");
  }

  /* ---------------- IN COMMAND mini scroll: three scenes, ~equal scroll bands,
     each scrubbed within its band and crossfaded at the boundaries ---------------- */
  // Scenes may share one sequence across consecutive bands (f0..f1 are the
  // fraction of the film each band scrubs) so a two-part project plays as
  // one continuous film with no repeated footage.
  var cmdScenes = [
    { seq: "vauntlive", f0: 0, f1: 1, speed: 1 },    // runway performance up to the sky...
    { seq: "vaunt", f0: 0, f1: 1, speed: 1.75 },     // ...into the cabin fly-through
  ];
  cmdScenes = cmdScenes.filter(function (scene) { return sequences[scene.seq]; });
  /* the plane alone (index.html, after the cabin): one film over a shorter section, finished before the night dissolves in */
  if (CABIN_FIRST && cmdScenes.length === 1) cmdScenes[0] = { seq: cmdScenes[0].seq, f0: 0, f1: 1, speed: 1.25 };
  // Two scroll films with the 360 cabin between them.
  var cmdProjects = [1, 1];
  var cmdProjectCount = 1;
  // the full record carries both flight legs: the runway liftoff and the
  // fly-through landing; the acoustic plays only inside the 360 look-around
  var cmdSceneTracks = ["runway", "runway"];
  var cmdPanels = gsap.utils.toArray("#work .command__panel");
  var cmdCount = document.getElementById("cmdCount");
  var CMD_FADE = 0.03; // narrower bands with six scenes need tighter crossfades
  var lastCmdActive = 0;
  var commandInView = false;    // maintained by the audio block's #work zone

  /* WHAT THE COMMAND SCROLL SHOULD BE PLAYING, RIGHT NOW.

     Three places asked this question and two of them answered it wrong. The
     360 cabin sets "vaunt" when it takes the screen, but the band sits at
     0.40-0.50 of the section and the scene flips from 0 to 1 at 0.50 — so
     crossing that line while still inside the cabin fired
     commandAudioHook(cmdSceneTracks[1]) and put the runway record back on
     over the acoustic. The zone's own onToggle did the same on re-entry.

     One answer, asked from all three sites: while you are in the cabin, the
     cabin's record plays. workVR is declared further down and this runs
     during the first applyCommand(0), so the guard is load-order, not
     defensiveness. */
  function cmdTrackNow() {
    return (typeof workVR !== "undefined" && workVR && workVR.live)
      ? "vaunt" : cmdSceneTracks[lastCmdActive];
  }
  var commandAudioHook = null;  // assigned by the audio block

  // each canvas is visible across the contiguous scene bands of its sequence
  var cmdCanvasBands = {};
  var parCmdCanvases = {};
  cmdScenes.forEach(function (sc, i) {
    var id = sequences[sc.seq].canvas.id;
    if (!cmdCanvasBands[id]) cmdCanvasBands[id] = { from: i, to: i + 1 };
    else cmdCanvasBands[id].to = i + 1;
    if (!parCmdCanvases[sc.seq]) parCmdCanvases[sc.seq] = parCanvas(sc.seq);
  });
  var parCmdPanels = PAR.attach(document.querySelector("#work .command__panels"), { depth: -7 });

  function cmdCanvasOpacity(p, band) {
    var n = cmdScenes.length;
    var a = band.from / n, b = band.to / n;
    var oIn = band.from === 0 ? 1 : clamp01((p - (a - CMD_FADE)) / (2 * CMD_FADE));
    var oOut = band.to === n ? 1 : clamp01(((b + CMD_FADE) - p) / (2 * CMD_FADE));
    return Math.min(oIn, oOut);
  }

  function applyCommand(p) {
    if (!cmdScenes.length) return;
    var n = cmdScenes.length;
    var active = Math.min(n - 1, Math.floor(p * n));
    cmdScenes.forEach(function (sc, i) {
      // a later band only takes over the sequence once the scroll reaches it
      if (i > 0 && p < i / n && cmdScenes[i - 1].seq === sc.seq) return;
      var s = sequences[sc.seq];
      var q = clamp01((p * n - i) * sc.speed);
      s.target = (sc.f0 + q * (sc.f1 - sc.f0)) * (s.count - 1 || 0);
    });
    Object.keys(cmdCanvasBands).forEach(function (id) {
      document.getElementById(id).style.opacity = cmdCanvasOpacity(p, cmdCanvasBands[id]);
    });
    // near the end of the active band the scene starts tracking the cursor
    var actSc = cmdScenes[active];
    var actS = PAR.ramp(clamp01((p * n - active) * actSc.speed));
    Object.keys(parCmdCanvases).forEach(function (k) {
      PAR.set(parCmdCanvases[k], k === actSc.seq ? actS : 0);
    });
    PAR.set(parCmdPanels, actS);
    cmdPanels.forEach(function (el, i) { el.classList.toggle("is-active", i === active); });
    if (cmdCount) cmdCount.textContent = "0" + cmdProjects[active] + " / 0" + cmdProjectCount;
    if (active !== lastCmdActive) {
      lastCmdActive = active;
      if (window.MCC_TRACK) window.MCC_TRACK("work_scene", { scene: active, project: cmdProjects[active], page: "home" });
      if (commandInView && commandAudioHook) commandAudioHook(cmdTrackNow());
      // the discreet buy gate follows whichever track the scene plays
      var pay = window.PAYMENTS && window.PAYMENTS[cmdSceneTracks[active]];
      var gate = document.getElementById("gateCmd");
      if (pay && gate) {
        gate.href = pay.page;
        document.getElementById("gateCmdLabel").textContent =
          'Now playing: "' + pay.title + '" · listen';
      }
    }
  }
  applyCommand(0);

  /* ---- the 360 band: between the runway performance and the fly-through,
         the real inside-the-jet film takes over. ---- */
  /* THE CABIN IS A ROOM, NOT A CORRIDOR.

     The band used to let a scroll carry straight through it, which meant
     the one gesture a phone uses to look around — a thumb dragged up the
     glass — was also the gesture that left. You could not study the cabin
     without flying out of it, so nobody did.

     The cabin now holds the page for as long as you are in it. The two
     doors are the two doors on screen: Back to the card, and Land. Escape
     lands it too, because a room with no key that is not a pixel is a
     trap, not a room. (releaseAndGoTop below is a third door, wired to a
     masthead brand mark that this page does not currently render — it
     costs nothing and it works the moment one does.) With the page frozen,
     a drag is unambiguously a look, and the briefing has a reader.

     Lenis owns this page's scrolling (wheel AND touch, via syncTouch), so
     stopping it is most of the job; the native listeners are the belt to
     its braces on engines that still bubble a gesture through, and the
     scroll pin catches the one input neither covers — a hand on the
     desktop scrollbar. */
  var holdGuard = function (e) { e.preventDefault(); };
  var SCROLL_KEYS = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
    PageUp: 1, PageDown: 1, Home: 1, End: 1, " ": 1, Spacebar: 1,
  };
  var holdKeyGuard = function (e) {
    // the cabin's own controls keep the keyboard; only scrolling is off
    var tag = (e.target && e.target.tagName) || "";
    if (e.key === "Tab" || e.key === "Enter") return;
    if (e.key === " " && /^(BUTTON|A|INPUT|TEXTAREA)$/.test(tag)) return;
    if (SCROLL_KEYS[e.key]) e.preventDefault();
  };
  var holdY = 0;
  var holdPin = function () {
    // the scrollbar and the browser's own anchoring do not go through Lenis
    if (Math.abs(window.scrollY - holdY) > 1) window.scrollTo(0, holdY);
  };
  var holdResync = function () {
    /* a rotate, a toolbar collapse or a ScrollTrigger refresh moves the page
       out from under the pin. Re-anchor to wherever the browser has just put
       us; the alternative is snapping the visitor back to a y that no longer
       means anything. */
    setTimeout(function () { if (holding) holdY = window.scrollY; }, 150);
  };
  var holding = false;
  function holdEverything(on) {
    on = !!on;
    if (on === holding) return;
    holding = on;
    try { on ? lenis.stop() : lenis.start(); } catch (e) {}
    if (on) {
      holdY = window.scrollY;
      window.addEventListener("wheel", holdGuard, { passive: false });
      window.addEventListener("touchmove", holdGuard, { passive: false });
      window.addEventListener("keydown", holdKeyGuard, { passive: false });
      window.addEventListener("scroll", holdPin, { passive: true });
      window.addEventListener("resize", holdResync);
      window.addEventListener("orientationchange", holdResync);
    } else {
      window.removeEventListener("wheel", holdGuard, { passive: false });
      window.removeEventListener("touchmove", holdGuard, { passive: false });
      window.removeEventListener("keydown", holdKeyGuard, { passive: false });
      window.removeEventListener("scroll", holdPin, { passive: true });
      window.removeEventListener("resize", holdResync);
      window.removeEventListener("orientationchange", holdResync);
    }
  }
  function lockPageScroll(on) { holdEverything(on); }
  var workVR = {
    el: document.getElementById("workVR"),
    viewer: null, live: false, landing: false, held: false, lastP: null,
    band: FRONT.vr.band.slice(),
  };
  /* js/vr360.js writes a tag's label as HTML, so a label the owner typed is escaped on its way in */
  function vrSpots(list) {
    var esc = function (t) { return String(t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
    return list.map(function (x) { return { yaw: x.yaw, pitch: x.pitch, label: esc(x.label), href: x.href, blank: x.blank, urgent: x.urgent }; });
  }
  frontHooks.push(function (f) {
    workVR.band = f.vr.band.slice();
    if (!cabinOn()) leaveCabinQuietly();
    /* the hold turned off while someone is inside: the cabin stays on screen, the page is handed back (Codex #591) */
    else if (!f.vr.hold && holding) lockPageScroll(false);
    /* a mounted cabin takes new tags at once (its layer is cleared first: setSpots adds, it does not replace) */
    if (workVR.viewer && workVR.viewer.setSpots) {
      var layer = document.querySelector("#workVR .vr360-spots");
      if (layer) layer.innerHTML = "";
      workVR.viewer.setSpots(vrSpots(f.vr.spots));
    }
  });
  /* the cabin turned off (or its section) while someone is inside: hand the page back, nothing else */
  function leaveCabinQuietly() {
    if (!workVR.live && !workVR.held) return;
    workVR.held = false; workVR.live = false;
    if (workVR.el) workVR.el.classList.remove("is-live");
    if (workVR.viewer) workVR.viewer.pause();
    lockPageScroll(false);
  }
  /* the cabin plays when it is on, its scene is on, and (on an account's page) the account has a 360 to put in it.
     On index.html the cabin is the opening scene: it plays unless the owner opened the page on the plane instead. */
  function cabinOn() {
    if (CABIN_FIRST) return FRONT.vr.enabled && FRONT.start !== "plane";
    return FRONT.vr.enabled && FRONT.scenes.vaunt && (!MEMBER || !!FRONT.media.cabin);
  }
  function workVRSet(p) {
    if (CABIN_FIRST) return;   // the opening cabin is its own scene (openingCabin below), not a band of the films
    if (!workVR.el || !window.VR360) return;
    /* the owner turned the cabin off: the band is just more of the runway */
    if (!cabinOn()) { workVR.lastP = p; return; }
    /* WHO DECIDES THE CABIN IS OVER.

       Not the scroll: the scroll is frozen the moment you arrive. The old
       version asked the scroll position on every frame and let a hair of
       overshoot end the band, which is exactly the behaviour that made the
       cabin something you fell through instead of somewhere you stood.

       So arrival latches `held`, and only a door clears it — Back to the
       card, Land, the brand mark, Escape. Everything routes through
       leaveCabin(), so there is one place the latch can be dropped and no
       way to forget it. (The old failure mode was the opposite of a latch
       with no key: `live` was its own reason to stay true, so nothing could
       ever clear it. A named latch that exactly one function clears is the
       fix for both.)

       THE FLING. The band is a tenth of the section — a hard flick can step
       clean over it between two frames, and then the cabin, the briefing and
       the whole 360 film never happen at all. A step that jumps the entire
       room on the way down counts as walking into it. */
    var inBand = p >= workVR.band[0] && p <= workVR.band[1];
    var prevP = workVR.lastP;
    var vaulted = prevP !== null && prevP < workVR.band[0] && p > workVR.band[1];
    workVR.lastP = p;
    /* A visitor who pressed Cancel does not get grabbed again. The band
       stops being a latch for them and goes back to being a band: it holds
       while they are inside it and lets go the moment they are not, so
       "scroll on to continue" is literally true. */
    /* the owner can also let the band go without holding the page (Control → Front page: "Hold the page in the cabin") */
    if (workVR.declined || !FRONT.vr.hold) workVR.held = inBand;
    else if (!workVR.landing && (inBand || vaulted)) workVR.held = true;
    var on = workVR.held && !workVR.landing;
    // mount well before the band so the poster is up and the film is
    // buffered by the time the look-around takes the screen
    if (!workVR.viewer && p >= 0.12) {
      /* the house's jet, or (on an account's page only) the account's own 360, a film or a still */
      var room = MEMBER ? FRONT.media.cabin : null;
      workVR.viewer = VR360.mount(document.getElementById("workVRCanvas"), {
        src: room ? room.src : "assets/video/vaunt-360.mp4",
        video: room ? room.kind === "video" : true, autoplay: false,
        poster: room ? (room.poster || undefined) : "assets/img/vaunt-360-poster.jpg",
        // open facing McCluster in his seat (measured off the equirect frame), unless the owner set another view
        yaw: FRONT.vr.yaw, pitch: FRONT.vr.pitch, touchAction: "none",
        // three tags, not five. The camera and the six-string were scenery
        // pointing at pages the other doors already reach; what is pinned
        // now is the flight, the work, and the man (FRONT_DEFAULT.vr.spots; the owner can relabel or repoint them).
        spots: vrSpots(FRONT.vr.spots),
      });
      window.__MCC_VR = workVR; // debug/verification handle
      /* the film is blurred from its very first frame, poster included */
      workVR.el.classList.add("is-gated");
      document.getElementById("workVRCanvas").addEventListener("pointerdown", function () {
        /* THE GATE IS NOT A PANE YOU CAN DISMISS. Touching the cabin used to
           open it, which meant the card was never really withholding
           anything. Now nothing here happens until Allow has been pressed. */
        if (!workVR.allowed) return;
        armCabinMotion();
        showNPBeacon(); // dragging in silence: the beacon points at the sound
      });
      var allowBtn = document.getElementById("vrGateAllow");
      var denyBtn = document.getElementById("vrGateDeny");
      if (allowBtn) allowBtn.addEventListener("click", allowCabin);
      if (denyBtn) denyBtn.addEventListener("click", declineCabin);
      if (window.MCC_TRACK) window.MCC_TRACK("vr_inline_view", { page: "home" });
    }
    if (on !== workVR.live) {
      workVR.live = on;
      workVR.el.classList.toggle("is-live", on);
      if (workVR.viewer) { (on && !workVR.declined) ? workVR.viewer.play() : workVR.viewer.pause(); }
      /* Cancel hands the scroll back for good; re-entering the band must not
         quietly take it again. */
      lockPageScroll(on && !workVR.declined && FRONT.vr.hold);
      if (on) openGate();
      // inside the 360 the acoustic takes the cabin; either side of it,
      // the full record flies
      /* the guard was `commandInView &&`, which is set by the #work zone's
         onToggle. Entering the cabin without that flag having landed yet
         meant the switch was skipped entirely and the runway played on
         through the 360. The cabin knows what it wants; it should not need
         a second opinion. */
      if (commandAudioHook) commandAudioHook(cmdTrackNow());
    }
  }

  /* THE CABIN'S OWN MOTION. Tilt is no longer a card to hunt for and press;
     it is armed on the way in. Everywhere but iOS that happens on entry with
     nothing asked of the visitor. iOS will only honor requestPermission()
     from inside a user gesture, so there it rides the first tap — which is
     the "Look around" button or the first drag, both of which happen within
     a second or two of the count clearing. The row on the card is only
     promised to hands that could ever have it, and is withdrawn if the
     phone says no. */
  function phoneCanTilt() {
    return !!window.DeviceOrientationEvent &&
      !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
  }
  function armCabinMotion() {
    if (!workVR.viewer || workVR.motionAsked || !phoneCanTilt()) return;
    workVR.motionAsked = true;
    workVR.viewer.enableGyro().then(function (on) {
      workVR.motion = !!on;
      if (!on) return;
      if (window.MCC_TRACK) window.MCC_TRACK("vr_gyro_on", { page: "home", auto: 1 });
      // the sound curtain used to hang off the Motion tap. It cannot hang off
      // this: arming is automatic, so the curtain would throw itself over the
      // cabin the instant you scrolled in — and land on top of the sign. The
      // quieter beacon on the first real touch carries the soundtrack instead.
      if (workVR.allowed) flashCabinSign();
    });
  }

  /* the seatbelt sign going off, thrown across the whole screen. The tags
     and the rail stand down while it speaks — an announcement competing
     with five other lit things is just noise. */
  function flashCabinSign() {
    var sign = document.getElementById("workVRSign");
    if (!sign || sign.dataset.shown) return;
    sign.dataset.shown = "1";
    sign.classList.add("is-flash");
    if (workVR.el) workVR.el.classList.add("is-announcing");
    setTimeout(function () {
      sign.classList.remove("is-flash");
      if (workVR.el) workVR.el.classList.remove("is-announcing");
    }, 4200);
  }

  /* THE GATE, which replaced the three-second briefing.

     The old card counted down and then stood aside, and a tap anywhere —
     or simply waiting — opened the cabin. Nothing was ever actually
     withheld; the countdown was a delay dressed as a decision.

     This withholds. The film is blurred in the canvas, not behind a pane,
     so clicking away, waiting, or dragging the blurred picture all leave it
     exactly as blurred as it was. The only thing that clears it is Allow.

     Cancel is a real second answer, not a way of saying nothing: it hands
     the scroll straight back, tells the visitor a reload is how to change
     their mind, and never asks again for the rest of the visit. */
  function openGate() {
    var card = document.getElementById("workVRCompass");
    if (!card) { workVR.allowed = true; return; }
    if (workVR.allowed || workVR.declined) return;
    if (workVR.el) workVR.el.classList.add("is-gated");
    card.classList.add("is-on");
    card.classList.remove("is-gone", "is-declined");
    var allow = document.getElementById("vrGateAllow");
    if (allow) { try { allow.focus({ preventScroll: true }); } catch (e) {} }
    if (!workVR.gateSeen) {
      workVR.gateSeen = true;
      if (window.MCC_TRACK) window.MCC_TRACK("vr_gate", { page: "home" });
    }
  }

  function allowCabin() {
    if (workVR.allowed) return;
    workVR.allowed = true;
    workVR.declined = false;
    var card = document.getElementById("workVRCompass");
    if (card) { card.classList.remove("is-declined"); card.classList.add("is-gone"); }
    if (workVR.el) workVR.el.classList.remove("is-gated");
    if (workVR.viewer) workVR.viewer.play();
    /* the press is the gesture iOS wants before it will hand over the gyro */
    armCabinMotion();
    showNPBeacon();
    flashCabinSign();
    if (window.MCC_TRACK) window.MCC_TRACK("vr_gate_allow", { page: "home" });
  }

  function declineCabin() {
    if (workVR.allowed || workVR.declined) return;
    workVR.declined = true;
    var card = document.getElementById("workVRCompass");
    if (card) {
      card.classList.add("is-declined");
      var after = document.getElementById("vrGateAfter");
      if (after) after.hidden = false;
    }
    if (workVR.viewer) workVR.viewer.pause();
    lockPageScroll(false);   /* the scroll is theirs again, immediately */
    if (window.MCC_TRACK) window.MCC_TRACK("vr_gate_deny", { page: "home" });
  }

  var workSlow = document.getElementById("workSlowHint");
  var workFly = document.getElementById("workFlyPill");
  var workRunway = document.getElementById("workRunway");
  var workST = cmdScenes.length ? ScrollTrigger.create({
    trigger: "#work",
    start: "top top",
    end: "bottom bottom",
    scrub: true,
    onUpdate: function (st) {
      applyCommand(st.progress);
      workVRSet(st.progress);
      // the last card opens on the ask for a slow hand (right where Land sets
      // you down), but NEVER inside the cabin: a flung scroll or a toolbar
      // resize can push progress past the band while the 360 still holds the
      // lock, and the scroll-slow homie would float into the jet with you
      // brief by design: the slow-hand ask flashes past touchdown, then clears
      var pastBand = st.progress > 0.503 && st.progress < 0.64 && !workVR.live;
      if (workSlow) workSlow.classList.toggle("is-shown", pastBand);
      if (workFly) workFly.classList.toggle("is-shown", pastBand);
      // THE TAKEOFF: on approach to the cabin, the runway rails light up.
      // Scroll slow, the VR band is coming. They cut out once the band takes over.
      if (workRunway) workRunway.classList.toggle("is-shown",
        st.progress > 0.14 && st.progress < workVR.band[0] - 0.005 && !workVR.live);
      if (!st.isActive) {
        Object.keys(parCmdCanvases).forEach(function (k) { PAR.set(parCmdCanvases[k], 0); });
        PAR.set(parCmdPanels, 0);
      }
    },
    onToggle: function (st) {
      if (!st.isActive) {
        Object.keys(parCmdCanvases).forEach(function (k) { PAR.set(parCmdCanvases[k], 0); });
        PAR.set(parCmdPanels, 0);
        // safety net, but not while the band holds the lock: a flung scroll
        // deactivates the trigger for one frame before the snap-back lands
        if (!workVR.live) lockPageScroll(false);
      }
    },
  }) : null;

  /* THE DOORS. The cabin holds the page, so leaving is never something the
     scroll does by accident — it is something a door does on purpose. All of
     them come through here: the latch is dropped, the film is paused, the
     scroll is handed back, and only then does the page glide anywhere. One
     function, so a new door cannot be added that forgets the latch. */
  function leaveCabin(y, duration, tag) {
    workVR.landing = true;
    workVR.live = false;
    workVR.held = false;
    if (workVR.el) workVR.el.classList.remove("is-live");
    if (workVR.viewer) workVR.viewer.pause();
    lockPageScroll(false);
    var done = function () { workVR.landing = false; };
    lenis.scrollTo(y, { duration: duration, onComplete: done });
    // if the glide is cut short — a hand on the wheel mid-flight — re-arm anyway
    setTimeout(done, duration * 1000 + 600);
    if (tag && window.MCC_TRACK) window.MCC_TRACK(tag, { page: "home" });
  }
  function workProgressY(q) { return workST.start + (workST.end - workST.start) * q; }

  // one true exit that always works: the brand mark (and the Back-to-top
  // button inside the band) releases any lock and flies home
  function releaseAndGoTop() { leaveCabin(0, 1.2); }
  var brandHome = document.querySelector(".site-head .brand");
  if (brandHome) brandHome.addEventListener("click", function (e) {
    e.preventDefault();
    releaseAndGoTop();
    if (window.MCC_TRACK) window.MCC_TRACK("brand_home", { page: "home" });
  });
  // Back to the card: not all the way home. The button sets you down on the
  // collab card that boarded you, right at the top of the section
  var workTop = document.getElementById("workVRTop");
  if (workTop) workTop.addEventListener("click", function () {
    leaveCabin(workProgressY(0.02), 1.0, "vr_back_to_card");
  });

  /* Land: the way out. Touches down at the start of the fly-through film,
     the jet in open air, then hands the scroll back; no auto-ride to the end
     of the section.

     It sets you down 3% clear of the band rather than the old half a
     percent. Half a percent was a few pixels: the cabin now re-latches the
     moment you are inside it, so landing on its doormat meant the smallest
     scroll back up put you straight back in the jet. And if a fling carried
     you past the room before the latch caught, Land never glides backwards
     into the film you already scrolled through — it just opens the door. */
  var workSkip = document.getElementById("workVRSkip");
  if (workSkip) workSkip.addEventListener("click", function () {
    var q = Math.max(workVR.band[1] + 0.03, workST.progress);
    leaveCabin(workProgressY(q), 0.9, "vr_skip");
  });

  /* THE KEY TO THE ROOM. The cabin holds the scroll, so the two on-screen
     doors are the way out — but a sealed room needs a key that is not a
     pixel. While the gate is up, Escape is Cancel: the keyboard answer to a
     dialog, and it hands the scroll back the same way the button does. Once
     the cabin is allowed, Escape lands the jet, the same as pressing Land. */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" && e.key !== "Esc") return;
    if (!workVR.live) return;
    if (!workVR.allowed) {
      if (workVR.declined) return;
      e.preventDefault();
      declineCabin();
      return;
    }
    if (!workSkip) return;
    e.preventDefault();
    workSkip.click();
  });

  /* ---- THE OPENING CABIN (index.html; owner, 2026-10-29) ----
     "The page now opens INSIDE the Vaunt 360 cabin ... It plays immediately on load, muted, with NO Allow/Cancel gate.
     Scrolling (or Escape / a clear continue affordance) moves on."
     So on this page the cabin is not a band that holds the scroll: it is the first screen. The film is muted (js/vr360.js
     never unmutes it), it plays while the room is on screen and pauses when it is not, a drag looks around (sideways on a
     phone: an upward swipe is the scroll that moves on, which is why the canvas is pan-y and Lenis leaves the room's
     touches to the browser), the wheel scrolls rather than zooms, and Continue or Escape go to whatever comes next.
     With reduced motion the room waits on its poster until "Look around the cabin" is pressed. The tags, the opening
     view and the on/off are the owner's front page settings (vr.*, start), applied at once. */
  var cabinSec = CABIN_FIRST ? document.getElementById("cabin") : null;
  var cabinInView = true, cabinAsked = false, frontTuckedNow = document.documentElement.hasAttribute("data-front-tucked");
  var cabinView = { yaw: FRONT.vr.yaw, pitch: FRONT.vr.pitch };
  function cabinPlay() {
    if (!cabinSec || !workVR.el) return;
    var on = !!workVR.viewer && cabinInView && cabinOn() && !frontTuckedNow;
    workVR.live = on;
    workVR.playing = on;
    workVR.el.classList.toggle("is-live", !!workVR.viewer && cabinOn());
    if (workVR.viewer) { if (on) workVR.viewer.play(); else workVR.viewer.pause(); }
  }
  function cabinMount() {
    if (!cabinSec || workVR.viewer || !window.VR360 || !cabinOn() || frontTuckedNow) return;
    if (prefersReduced && !cabinAsked) return;
    var canvas = document.getElementById("workVRCanvas");
    workVR.viewer = VR360.mount(canvas, {
      src: "assets/video/vaunt-360.mp4", video: true, autoplay: false, poster: "assets/img/vaunt-360-poster.jpg",
      yaw: FRONT.vr.yaw, pitch: FRONT.vr.pitch, touchAction: "pan-y", wheel: false,
      spots: vrSpots(FRONT.vr.spots),
    });
    if (!workVR.viewer) return;          // no WebGL: the poster stays, and Continue still works
    cabinView = { yaw: FRONT.vr.yaw, pitch: FRONT.vr.pitch };
    workVR.allowed = true;               // no gate on the house page: nothing here is withheld
    window.__MCC_VR = workVR;            // debug/verification handle (and the Control Room's "Use the preview's view")
    cabinSec.classList.add("is-mounted");
    canvas.addEventListener("pointerdown", function () { armCabinMotion(); });
    if (window.MCC_TRACK) window.MCC_TRACK("vr_inline_view", { page: "home", opening: 1 });
    cabinPlay();
  }
  function applyCabin(f) {
    if (!cabinSec) return;
    var off = !cabinOn();
    if (off !== cabinSec.hasAttribute("data-front-off")) {
      if (off) cabinSec.setAttribute("data-front-off", ""); else cabinSec.removeAttribute("data-front-off");
      try { ScrollTrigger.refresh(); } catch (e) {}
    }
    if (!off && workVR.viewer && (f.vr.yaw !== cabinView.yaw || f.vr.pitch !== cabinView.pitch)) {
      /* a new opening view, typed in the Control Room: the preview turns to it at once */
      cabinView = { yaw: f.vr.yaw, pitch: f.vr.pitch };
      workVR.viewer.state.yaw = f.vr.yaw * Math.PI / 180;
      workVR.viewer.state.pitch = f.vr.pitch * Math.PI / 180;
    }
    if (!off) cabinMount();
    cabinPlay();
  }
  function cabinContinue(how) {
    if (!cabinSec) return;
    var y = cabinSec.offsetTop + cabinSec.offsetHeight;
    if (prefersReduced) lenis.scrollTo(y, { immediate: true, force: true });
    else lenis.scrollTo(y, { duration: 1.2, force: true });
    if (window.MCC_TRACK) window.MCC_TRACK("cabin_continue", { page: "home", how: how || "button" });
  }
  if (cabinSec) {
    var cabinGo = document.getElementById("cabinContinue"), cabinLook = document.getElementById("cabinLook");
    if (cabinGo) cabinGo.addEventListener("click", function () { cabinContinue("button"); });
    if (cabinLook) {
      cabinLook.hidden = !prefersReduced;
      cabinLook.addEventListener("click", function () { cabinAsked = true; cabinLook.hidden = true; cabinMount(); });
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { cabinInView = es[0].isIntersecting; cabinPlay(); }, { threshold: 0.12 }).observe(cabinSec);
    }
    /* Escape moves on while the room still owns the screen (never from inside a field, never past the privacy notice) */
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      var t = e.target, tag = (t && t.tagName) || "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable)) return;
      if (document.documentElement.getAttribute("data-privacy-gate") === "pending") return;
      if (cabinSec.hasAttribute("data-front-off") || frontTuckedNow) return;
      if (cabinSec.getBoundingClientRect().bottom <= window.innerHeight * 0.5) return;
      e.preventDefault();
      cabinContinue("escape");
    });
    frontHooks.push(applyCabin);
  }

  /* ---- the sound beacon: someone is dragging the 360 with the sound off.
         An orange beacon rises from the Now Playing tab: rings, an arrow,
         and TURN ON SOUND! One tap lights the music. Shows once. ---- */
  var npBeacon = null, npBeaconShown = false;
  function killNPBeacon() {
    if (npBeacon && npBeacon.parentNode) npBeacon.parentNode.removeChild(npBeacon);
    npBeacon = null;
    var npTab = document.getElementById("appbarNP");
    if (npTab) npTab.classList.remove("is-beacon");
  }
  function showNPBeacon() {
    var tgl = document.getElementById("soundToggle");
    if (npBeaconShown || !tgl || tgl.classList.contains("is-on")) return;
    npBeaconShown = true;
    npBeacon = document.createElement("div");
    npBeacon.className = "npbeak";
    npBeacon.setAttribute("role", "button");
    npBeacon.setAttribute("aria-label", "Turn on sound");
    npBeacon.innerHTML =
      '<span class="npbeak__ring"></span><span class="npbeak__ring"></span><span class="npbeak__ring"></span>' +
      '<span class="npbeak__words">Turn on sound!</span>' +
      '<svg class="npbeak__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v13"/><path d="M6 12l6 6 6-6"/></svg>';
    npBeacon.addEventListener("click", function () {
      if (window.MCC_NP_PLAY) window.MCC_NP_PLAY();
      killNPBeacon();
      if (window.MCC_TRACK) window.MCC_TRACK("sound_beacon_tap", { page: "home" });
    });
    document.body.appendChild(npBeacon);
    var npTab = document.getElementById("appbarNP");
    if (npTab) npTab.classList.add("is-beacon"); // the level icon glows with the beacon
    if (window.MCC_TRACK) window.MCC_TRACK("sound_beacon", { page: "home" });
    setTimeout(killNPBeacon, 12000);
  }
  // the moment sound comes on from anywhere, the beacon's job is done
  window.addEventListener("mcc:nowplaying", function (e) {
    if (e.detail && e.detail.playing) killNPBeacon();
  });

  /* ---- the sound ask: Motion tapped while the site is silent. One huge
         prompt, one arrow up to the SOUND pill, one tap anywhere to fix it. ---- */
  var soundAsk = document.getElementById("soundAsk");
  var soundAskNo = document.getElementById("soundAskNo");
  var soundAskDeclined = false; // "keep it silent" is respected for the visit
  function askForSound() {
    var tgl = document.getElementById("soundToggle");
    if (!soundAsk || !tgl || soundAskDeclined || tgl.classList.contains("is-on")) return;
    soundAsk.hidden = false;
    tgl.classList.add("is-asked");
    if (window.MCC_TRACK) window.MCC_TRACK("sound_prompt", { from: "vr-motion", page: "home" });
  }
  function closeSoundAsk() {
    if (!soundAsk) return;
    soundAsk.hidden = true;
    var tgl = document.getElementById("soundToggle");
    if (tgl) tgl.classList.remove("is-asked");
  }
  if (soundAsk) {
    soundAsk.addEventListener("click", function (e) {
      if (e.target === soundAskNo) return;
      closeSoundAsk();
      var tgl = document.getElementById("soundToggle");
      if (tgl && !tgl.classList.contains("is-on")) tgl.click();
    });
    if (soundAskNo) soundAskNo.addEventListener("click", function (e) {
      e.stopPropagation();
      soundAskDeclined = true;
      closeSoundAsk();
      if (window.MCC_TRACK) window.MCC_TRACK("sound_prompt_dismiss", { page: "home" });
    });
    var soundTgl = document.getElementById("soundToggle");
    if (soundTgl) soundTgl.addEventListener("click", closeSoundAsk);
  }

  gsap.from(".command__head", {
    y: 70, opacity: 0, duration: 1, ease: "power3.out",
    scrollTrigger: { trigger: "#work", start: "top 60%" },
  });

  /* ---------------- finale ---------------- */
  /* The close used to be its own section (#book) with its own two triggers.
     It is inside the night descent now, so both are gone -- and deliberately
     NOT replaced with triggers pointed at #pillars, because #pillars is
     pinned: a "top 70%" start there fires before the pin even begins, which
     would play the reveal at the top of the descent instead of the bottom.

     The reveal is driven from the descent's own scrub instead. See the
     .nightroom handling in the pillars ScrollTrigger below.

     The letters are left VISIBLE here. The old code set them to opacity 0 and
     relied on a trigger to bring them back; with that trigger's element gone
     the set would have stuck and LOCK IN would never have appeared. Nothing
     in this file may hide them without also owning the code that shows them. */
  if (finaleChars.length) gsap.set(finaleChars, { yPercent: 0, opacity: 1, rotate: 0 });

  // magnetic buttons
  if (!prefersReduced) {
    document.querySelectorAll(".magnetic").forEach(function (btn) {
      btn.addEventListener("mousemove", function (e) {
        var r = btn.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = "translate(" + dx * 0.25 + "px," + dy * 0.35 + "px)";
      });
      btn.addEventListener("mouseleave", function () {
        btn.style.transform = "";
      });
    });
  }

  /* ---------------- fallback videos: play only when visible ---------------- */
  document.querySelectorAll("video").forEach(function (v) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!v.classList.contains("is-active")) return;
        if (en.isIntersecting) v.play().catch(function () {});
        else v.pause();
      });
    }, { threshold: 0.05 }).observe(v);
  });

  /* ---------------- Here album: ONE track, whole site ----------------
     Off by default (browser autoplay policy); the header toggle is the
     user gesture that unlocks audio. Crossfades as sections change. */
  (function () {
    var toggle = document.getElementById("soundToggle");
    var floatPause = document.getElementById("floatPause");
    /* The one record the house plays. Every zone and every hook resolves
       to this; nothing on the page may switch it. */
    /* index.html's one song is Antisocial (owner, 2026-10-29), or whichever of its tracks the owner names in Control →
       Front page (FRONT.song). An account's page keeps its own sound in the whodidtheshoot slot (js/front-member.js). */
    var HOUSE_TRACK = MEMBER ? "whodidtheshoot" : FRONT.song;
    var tracks = {
      "whodidtheshoot": document.getElementById("track-whodidtheshoot"),
      "antisocial": document.getElementById("track-antisocial"),
      "vaunt": document.getElementById("track-vaunt"),
      "runway": document.getElementById("track-runway"),
      "environmental-injustice": document.getElementById("track-environmental-injustice"),
      "here": document.getElementById("track-here"),
    };
    /* ONE RECORD FOR THE WHOLE HOUSE.

       This used to score each section separately — Antisocial under the
       pillars, Environmental Injustice under the uprise band, the command
       scroll choosing per scene. Six crossfades on one page. The owner
       called it annoying on 2026-08-18 and he is right: a soundtrack that
       changes every time you scroll past a heading stops being a
       soundtrack and becomes an interruption you cannot predict.

       So the house plays ONE record and nothing else, start to finish:
       Who Did The Shoot until 2026-10-29, Antisocial since (HOUSE_TRACK).

       The zones stay in the list rather than being deleted, because the
       #work ScrollTrigger below is also what maintains `commandInView`,
       which the command-scroll scene reads. Removing the zone would take
       that with it. They all name the same track now, so a scroll can no
       longer change the record. */
    var zones = [
      { sel: "#cabin", track: HOUSE_TRACK },
      { sel: "#hero", track: HOUSE_TRACK },
      { sel: "#pillars", track: HOUSE_TRACK },
      { sel: "#work", track: HOUSE_TRACK },
      { sel: "#book", track: HOUSE_TRACK },
    ];
    var soundOn = false;
    var currentTrack = HOUSE_TRACK; // and stays there — see HOUSE_TRACK above
    var avail = {};

    /* WHAT THE ROOM CAN PLAY.

       This used to ask assets-manifest.json for an `audio` map. That file
       is the fetch-list for externally hosted video, images and cutouts —
       it has never carried an `audio` key, so the lookup returned
       undefined, the map was always empty, and the Sound pill stayed
       hidden on every visit. Six scored sections, unreachable.

       The page itself is the honest inventory: a track is available when
       its <audio> element is here with a source. A manifest that ever does
       ship an `audio` map still wins, so it keeps its power to switch a
       track off remotely — it just no longer decides everything by
       being absent. */
    function seatTracks(fromManifest) {
      Object.keys(tracks).forEach(function (k) {
        var a = tracks[k];
        if (!a || !a.currentSrc && !a.getAttribute("src") && !a.querySelector("source")) return;
        if (fromManifest && Object.keys(fromManifest).length && !fromManifest[k]) return;
        avail[k] = true;
      });
      if (Object.keys(avail).length) toggle.hidden = false;
    }
    seatTracks(null);
    fetch("assets-manifest.json", { cache: "no-cache" })
      .then(function (r) { return r.json(); })
      .then(function (m) { if (m && m.audio) { avail = {}; seatTracks(m.audio); } })
      .catch(function () {});

    function track(n, p) { if (window.MCC_TRACK) window.MCC_TRACK(n, p); }

    /* THE GENTLE ONSET.

       Sound normally arrives in 1.2s at 0.85, which is right for a visitor
       who reached up and pressed the Sound pill — they asked for it, they
       know what is coming. It is wrong for someone who has just been told
       where their volume keys are: their hand is ON the rocker, and the
       whole point of putting it there is that the first sound they hear
       should be quiet enough to ride up, or kill, without panic.

       So the volume call opens the record from near-silence over four and a
       half seconds. `onset` is read by both fade-up sites and consumed in
       the same tick that set it — setSound does all of its fading
       synchronously, so no later fade can inherit it by accident.

       Worth being straight about the limit: no browser on any platform
       reports a hardware volume press, so the tap is still what starts the
       record. What this buys is the ordering — hand already on the keys,
       then a sound that rises into the room instead of landing in it. */
    var onset = null;
    function rise(a) {
      if (onset) a.volume = onset.from;
      gsap.to(a, {
        volume: onset ? onset.to : 0.85,
        duration: onset ? onset.dur : 1.2,
        ease: "power1.out", overwrite: "auto",
      });
    }
    window.MCC_SOUND_GENTLE = function () {
      if (soundOn) return 0;
      onset = { from: 0.015, to: 0.85, dur: 4.5 };
      var d = onset.dur;
      setSound(true);
      onset = null;
      track("sound_gentle", { page: "home", song: currentTrack });
      return d;
    };

    // iOS only lets play() succeed on elements that have already played
    // inside a user gesture; a mass unlock can drop one, so remember which
    // elements actually made it and keep retrying the rest on later taps
    var unlocked = {};

    function fadeTo(name) {
      /* THE CHOKEPOINT. Every route into the audio goes through here —
         the scroll zones, commandAudioHook, setSound, the Now Playing tab.
         Pinning the name here rather than at each call site means a caller
         added later cannot reintroduce section-switching by accident.
         The rest of this function still runs: it silences every other
         element hard, which is what stops a stray track bleeding in. */
      name = HOUSE_TRACK;
      // a track the loaded manifest says is missing falls back to the OS
      // layer, but never before the manifest answers, or the opener loses
      // its own name to the fallback in the boot race
      if (Object.keys(avail).length && !avail[name]) name = "here";
      var previous = currentTrack;
      if (soundOn && name !== currentTrack) {
        var prev = tracks[currentTrack];
        if (prev && !prev.paused) track("song_stop", { song: currentTrack, page: "home", at_seconds: Math.round(prev.currentTime) });
        if (avail[name]) track("song_start", { song: name, page: "home" });
      }
      currentTrack = name;
      announceNP();
      if (!soundOn) return;
      Object.keys(tracks).forEach(function (k) {
        var a = tracks[k];
        if (!a) return;
        if (k === name && avail[k]) {
          // the target: unmute, play, fade up
          a.muted = false;
          var pr = a.play();
          if (pr && pr.then) pr.then(function () { unlocked[k] = true; }).catch(function () {});
          rise(a);
        } else if (k === previous && k !== name) {
          // only the track we're leaving gets a smooth crossfade out
          gsap.to(a, {
            volume: 0, duration: 0.9, ease: "power1.out", overwrite: "auto",
            onComplete: function () { a.pause(); a.muted = true; },
          });
        } else {
          // every other track is silenced HARD and immediately: no tween to
          // outrun, no lingering playback. This is what stops a distant track
          // (e.g. Dealer Plates) bleeding into the current section on a fast scroll.
          gsap.killTweensOf(a);
          a.pause();
          a.muted = true;
          a.volume = 0;
        }
      });
    }

    commandAudioHook = fadeTo;
    /* the owner names another of the page's songs: it is still one song, and it replaces the old one at once */
    if (!MEMBER) frontHooks.push(function (f) {
      if (!f.song || f.song === HOUSE_TRACK || !tracks[f.song]) return;
      HOUSE_TRACK = f.song;
      fadeTo(HOUSE_TRACK);
    });

    // the Now Playing tab mirrors the section's track; a tap starts the sound
    function announceNP() {
      var pay = window.PAYMENTS && window.PAYMENTS[currentTrack] || {};
      window.dispatchEvent(new CustomEvent("mcc:nowplaying", {
        detail: {
          title: pay.title || "The soundtrack",
          href: pay.page || "#np",
          playing: soundOn,
        },
      }));
    }
    window.MCC_NP_PLAY = function () { setSound(true); };
    window.MCC_NP_PAUSE = function () { setSound(false); };
    announceNP(); // the tab knows the opener before the first note

    zones.forEach(function (z) {
      if (!document.querySelector(z.sel)) return;
      ScrollTrigger.create({
        trigger: z.sel,
        start: "top 55%",
        end: "bottom 55%",
        onToggle: function (st) {
          if (z.sel === "#work") commandInView = st.isActive;
          if (st.isActive) fadeTo(typeof z.track === "function" ? z.track() : z.track);
        },
      });
    });

    function setSound(on) {
      if (on === soundOn) return;
      /* the tucked-away holding screen plays nothing, whoever asks (the volume call's tap included) */
      if (on && !MEMBER && document.documentElement.hasAttribute("data-front-tucked")) return;
      soundOn = on;
      announceNP();
      toggle.classList.toggle("is-on", soundOn);
      toggle.setAttribute("aria-pressed", String(soundOn));
      // the floating pause only shows while music is actually playing
      if (floatPause) floatPause.hidden = !soundOn;
      track("sound_toggle", { on: soundOn, page: "home" });
      if (soundOn) track("song_start", { song: currentTrack, page: "home" });
      else {
        var cur = tracks[currentTrack];
        if (cur && !cur.paused) track("song_stop", { song: currentTrack, page: "home", at_seconds: Math.round(cur.currentTime) });
      }
      if (soundOn) {
        unlockAll();
        fadeTo(currentTrack);
      } else {
        Object.keys(tracks).forEach(function (k) {
          var a = tracks[k];
          if (a) gsap.to(a, { volume: 0, duration: 0.5, overwrite: "auto", onComplete: function () { a.pause(); } });
        });
      }
    }

    // unlock every not-yet-unlocked element inside a user gesture: play it
    // muted-by-volume, mark it on success, pause everything but the current
    // track. Safe to call repeatedly, since unlocked elements are skipped.
    function unlockAll() {
      Object.keys(tracks).forEach(function (k) {
        var a = tracks[k];
        if (!a || !avail[k] || unlocked[k]) return;
        // a late unlock of the track the visitor is already on comes in
        // audibly right away, so never gate the fade on the play() promise,
        // which only settles once media data actually arrives
        var isCurrent = k === currentTrack && soundOn;
        // non-current unlock elements are both muted AND volume-0 so the burst
        // that primes them for iOS can never be heard; the target unmutes below
        if (!isCurrent) { a.muted = true; a.volume = 0; }
        else a.muted = false;
        var pr = a.play();
        if (isCurrent) rise(a);
        if (pr && pr.then) {
          pr.then(function () {
            unlocked[k] = true;
            if (k !== currentTrack) a.pause();
          }).catch(function () {});
        }
      });
    }

    // Sound is strictly opt-in: nothing plays until the visitor hits the
    // toggle. While sound is on, later gestures keep retrying any element
    // the unlock burst dropped (iOS can reject one of several simultaneous
    // play() calls) and restart the current track if its crossfade play()
    // was refused off-gesture. This keeps every track, Dealer Plates
    // included, crossfading reliably on iPad.
    toggle.addEventListener("click", function () {
      toggle.classList.add("was-used"); // the come-tap-me beacon retires
      setSound(!soundOn);
    });
    // the floating pause stops the music wherever the visitor is on the page
    if (floatPause) {
      floatPause.addEventListener("click", function () {
        track("float_pause", { page: "home" });
        setSound(false);
      });
      // flash + spin the button on every scroll, so it stays impossible to miss
      var spinTimer = null;
      function spinOnScroll() {
        if (floatPause.hidden) return;
        floatPause.classList.add("float-pause--spin");
        clearTimeout(spinTimer);
        spinTimer = setTimeout(function () { floatPause.classList.remove("float-pause--spin"); }, 400);
      }
      lenis.on("scroll", spinOnScroll);
      window.addEventListener("scroll", spinOnScroll, { passive: true });
    }

    /* ---------- THE SOUND LEAVES THIS PAGE WITH THEM ----------

       The front page had its own six-track scene engine and the album had
       the pocket, and the two never spoke. So music started here, played
       while you scrolled, and died the instant you clicked anything: the
       one place on the site where sound was guaranteed to stop was the
       moment a visitor did something.

       An <audio> buffer cannot survive a navigation on a multi-page site.
       The POSITION can. The album has banked {src, title, second, playing}
       for a long time and js/pip.js rebuilds from it on the next page; all
       the front page has to do is bank the same shape. It does that now on
       the way out, so the record picks up mid-bar on whatever they opened,
       with a stop button and an X sitting on it. */
    var SCENE_TITLE = {
      "whodidtheshoot": "Who Did The Shoot",
      "antisocial": "Antisocial",
      "vaunt": "Vaunt (acoustic)",
      "runway": "Runway Walk",
      "environmental-injustice": "Environmental Injustice",
      "here": "Here",
    };
    function bankToPocket(force) {
      if (!window.MCC_POCKET) return;
      var a = tracks[currentTrack];
      /* nothing playing is not a state worth carrying: banking it would
         mount a held tile on the next page for a record nobody started */
      if (!soundOn || !a || !a.currentSrc) { window.MCC_POCKET.clear(); return; }
      window.MCC_POCKET.save({
        src: a.currentSrc.replace(location.origin + "/", ""),
        title: SCENE_TITLE[currentTrack] || "The soundtrack",
        album: "here",
        t: a.currentTime || 0,
        playing: !a.paused,
        at: Date.now(),
      }, force);
    }
    /* and it comes back with them. Arriving here from any other page, the
       banked position names a file and a second; if that file is one of the
       six scenes, the engine opens on it rather than resetting to the first
       track. Autoplay policy is the honest limit: a browser that has not
       decided the visitor is engaged with this origin will refuse play(),
       and when it does the toggle simply stays off instead of the page
       pretending. */
    (function resumeFromPocket() {
      var st = window.MCC_POCKET && window.MCC_POCKET.read();
      if (!st || !st.playing || !st.src) return;
      var key = null;
      Object.keys(tracks).forEach(function (k) {
        var a = tracks[k], src = a && a.querySelector("source");
        if (src && st.src.indexOf(src.getAttribute("src")) > -1) key = k;
      });
      if (!key) return;
      currentTrack = key;
      var a = tracks[key];
      var drift = st.at ? Math.min(30, Math.max(0, (Date.now() - st.at) / 1000)) : 0;
      var seekTo = (st.t || 0) + drift;
      a.addEventListener("loadedmetadata", function () {
        try { a.currentTime = Math.min(seekTo, Math.max(0, a.duration - 0.5)); } catch (e) {}
      }, { once: true });
      var pr = a.play();
      if (pr && pr.then) pr.then(function () { setSound(true); }).catch(function () {});
    })();

    /* Both paths force past the ten-second remote throttle: the write that
       happens as somebody walks away carries the second they left on, and
       throttling that one is how the position got lost. */
    window.addEventListener("pagehide", function () { bankToPocket(true); });
    /* pagehide does not fire on every bfcache-less path on every browser,
       and a tab hidden mid-song is the same intent as leaving */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") bankToPocket(true);
    });

    /* THE FIRST GESTURE TURNS THE SONG ON (index.html; owner, 2026-10-29). Browsers will not start sound before the
       visitor does something, so the first tap, click or key anywhere starts the house song. Only the first: once the
       visitor has answered with the Sound pill (or the pause), that answer stands for the rest of the visit. Never from
       the privacy notice, never on the holding screen, never inside the Control Room's preview. Only a gesture the browser
       counts as activation is used, and a refused play() leaves the pill off rather than claiming sound. */
    var autoStarted = false;
    function soundAnswered() { return autoStarted || toggle.classList.contains("was-used"); }
    function firstGesture(e) {
      if (soundAnswered()) return stopFirstGesture();
      var root = document.documentElement;
      if (root.getAttribute("data-privacy-gate") === "pending" || root.hasAttribute("data-front-tucked")) return;
      var t = e.target;
      if (t && t.closest && (t.closest("#soundToggle, #floatPause, #soundAsk") || t.closest('[id^="mccPrivacy"]'))) return;
      if (e.type === "keydown" && (e.key === "Escape" || e.key === "Tab" || e.key === "Shift" || e.metaKey || e.ctrlKey || e.altKey)) return;
      if (navigator.userActivation && !navigator.userActivation.isActive) return;
      autoStarted = true;
      stopFirstGesture();
      if (soundOn) return;
      setSound(true);
      track("sound_first_gesture", { page: "home", song: HOUSE_TRACK, via: e.type });
      var a = tracks[currentTrack], pr = a && avail[currentTrack] ? a.play() : null;
      if (pr && pr.catch) pr.catch(function (err) {
        /* the browser said no after all: the pill goes back off, and the next gesture tries again */
        if (err && err.name === "NotAllowedError" && soundOn && !toggle.classList.contains("was-used")) { autoStarted = false; setSound(false); armFirstGesture(); }
      });
    }
    var FIRST_EVENTS = ["pointerup", "keydown", "touchend", "click"];
    function armFirstGesture() { FIRST_EVENTS.forEach(function (ev) { window.addEventListener(ev, firstGesture, { capture: true, passive: true }); }); }
    function stopFirstGesture() { FIRST_EVENTS.forEach(function (ev) { window.removeEventListener(ev, firstGesture, { capture: true, passive: true }); }); }
    if (CABIN_FIRST && !framedByControl) armFirstGesture();

    ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
      window.addEventListener(ev, function (e) {
        if (!soundOn) return;
        if (e.target && e.target.closest && e.target.closest("#soundToggle")) return;
        var cur = tracks[currentTrack];
        var wasPaused = cur && avail[currentTrack] && cur.paused;
        unlockAll();
        if (wasPaused && unlocked[currentTrack]) fadeTo(currentTrack);
      }, { passive: true });
    });
  })();

  /* ---------------- interaction analytics ---------------- */
  (function () {
    function track(n, p) { if (window.MCC_TRACK) window.MCC_TRACK(n, p); }
    // each section counts once per visit as the visitor reaches it
    ["#cabin", "#hero", "#loadout", "#pillars", "#work", "#book"].forEach(function (sel) {
      if (!document.querySelector(sel)) return;
      ScrollTrigger.create({
        trigger: sel, start: "top 60%", once: true,
        onEnter: function () { track("section_view", { section: sel.slice(1), page: "home" }); },
      });
    });
    /* CTAs, song gates, and nav clicks.

       This was a querySelectorAll at load, which counted only the doors
       that were already in the markup — and two of the five selectors
       (.finale__actions .btn, .site-foot a) now match nothing at all,
       while the door the room hands you after a brief is written later
       and was never counted. One delegated listener counts whatever is
       on the page when the tap lands. */
    document.addEventListener("click", function (e) {
      if (!e.target.closest) return;
      var el = e.target.closest(".head-cta, .song-gate, a[data-cta]");
      if (!el) return;
      track("cta_click", {
        label: (el.textContent || "").trim().slice(0, 60),
        href: el.getAttribute("href") || "",
        page: "home",
      });
    });
  })();

  /* ---------------- brand mark: 3D spin with the scroll ---------------- */
  /* Its only target on this page is the little M at the head of the footer,
     so it went quiet for exactly as long as the footer was gone — and warned
     "target .brand__mark not found" on every load while it was. The guard is
     cheap and the page is one edit away from losing the mark again. */
  if (document.querySelector(".brand__mark")) {
    gsap.set(".brand__mark", { transformPerspective: 480 });
    gsap.to(".brand__mark", {
      rotationY: 1080,
      ease: "none",
      scrollTrigger: { start: 0, end: "max", scrub: 0.6 },
    });
  }

  /* ---------------- debug handle (used by the verification harness) ---------------- */
  window.__MCC = {
    ready: function (k) { return sequences[k || "hero"].ready; },
    frameCount: function (k) { return sequences[k || "hero"].count; },
    lastDrawn: function (k) { return sequences[k || "hero"].lastDrawn; },
    target: function (k) { return sequences[k || "hero"].target; },
    loadedMax: function (k) { return sequences[k || "hero"].loadedMax; },
  };

  /* The Square gates stood here, wiring Book a call, Subscribe and the
     stat-block booking button to window.PAYMENTS. All three lived inside
     .finale__actions, which the room replaced, and this file only ever
     loads on the home page — so the whole block had nothing left to find.
     js/payments.js still carries the entries; hire.html and the pay page
     are where they are spent now. */

  /* ---------------- anchor links through Lenis ---------------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href");
      if (id.length > 1 && document.querySelector(id)) {
        e.preventDefault();
        lenis.scrollTo(id, { offset: 0, duration: 1.6 });
      }
    });
  });

  /* ---------------- the owner's front page settings, applied ----------------
     The scenes the owner turned off are taken out of the page (one attribute, data-front-off, that only this code sets
     or clears, so the World's own hidden rule is never undone) and the pins are measured again. Turning the Vaunt scene
     off turns its cabin off with it, so the page can never be held by a band that is not there. */
  var FRONT_SCENES = { doors: ".hero__doors", vaunt: "#work.command", night: "#pillars", world: "#guestWorld" };
  (function () {
    var st = document.createElement("style");
    st.textContent = "[data-front-off]{display:none!important}";
    document.head.appendChild(st);
  })();
  function applyScenes(f) {
    var moved = false;
    Object.keys(FRONT_SCENES).forEach(function (k) {
      var el = document.querySelector(FRONT_SCENES[k]);
      if (!el) return;
      var off = f.scenes[k] === false && !el.hasAttribute("data-profile-world");
      if (off === el.hasAttribute("data-front-off")) return;
      if (off) el.setAttribute("data-front-off", ""); else el.removeAttribute("data-front-off");
      moved = true;
    });
    if (moved) { try { ScrollTrigger.refresh(); } catch (e) {} }
  }
  frontHooks.push(applyScenes);

  /* ---------------- TUCKED AWAY (owner, 2026-10-29) ----------------
     visible:false in the "@front" row hides the front page from the public: visitors get the holding screen (#frontHolding;
     the bar, the World and the footer stay), the page asks search engines not to index it, and the house owner, signed
     in, still gets the real page with a note saying visitors do not. Who the owner is stays the server's answer: the bar
     asks GET /v1/status (js/tabbar.js) and says so with mcc:appbar-admin / body[data-appbar-admin]; the Control Room's
     preview is the owner's too, unless he asks it to show the page as a visitor.
     This is a static site on GitHub Pages: index.html and everything it loads can still be fetched by anyone who asks
     for them. It hides the page; it does not make it secret. */
  var frontOwner = false, previewAs = "owner";
  function ownerSees() {
    if (framedByControl) return previewAs !== "visitor";
    return frontOwner || !!(document.body && document.body.hasAttribute("data-appbar-admin"));
  }
  function applyVisibility(f) {
    if (MEMBER || !document.getElementById("frontHolding")) return;
    var root = document.documentElement, was = root.hasAttribute("data-front-tucked");
    /* until the live row has been read, a page this browser last saw tucked stays tucked (no flash of the page);
       the owner is shown it as soon as the server says he is the owner */
    var known = Array.isArray(window.MCC_CONTENT_ROWS) || (window.MCC_FRONT && window.MCC_FRONT.source === "preview");
    var hidden = known ? f.visible === false : was || root.hasAttribute("data-front-tucked-owner");
    var visitor = hidden && !ownerSees();
    root.toggleAttribute("data-front-tucked", visitor);
    root.toggleAttribute("data-front-tucked-owner", hidden && !visitor);
    var robots = document.querySelector('meta[name="robots"][data-front-robots]');
    if (hidden && !robots) {
      robots = document.createElement("meta");
      robots.name = "robots"; robots.content = "noindex"; robots.setAttribute("data-front-robots", "");
      document.head.appendChild(robots);
    } else if (!hidden && robots) robots.parentNode.removeChild(robots);
    if (known && !framedByControl) { try { localStorage.setItem("mcc_front_tucked", f.visible === false ? "1" : "0"); } catch (e) {} }
    frontTuckedNow = visitor;
    if (visitor && window.MCC_NP_PAUSE) window.MCC_NP_PAUSE();   // the holding screen plays nothing
    applyCabin(FRONT);
    if (visitor !== was) { try { ScrollTrigger.refresh(); } catch (e) {} }
  }
  frontHooks.push(applyVisibility);
  window.addEventListener("mcc:appbar-admin", function (e) {
    frontOwner = !!(e && e.detail && e.detail.admin === true);
    applyVisibility(FRONT);
  });

  /* the saved settings: read now if live-content already has them, and again whenever it applies */
  var saved = MEMBER ? null : frontRow();
  if (saved) setFront(saved, "saved");
  else if (MEMBER) applyScenes(FRONT);
  else { applyScenes(FRONT); applyVisibility(FRONT); }
  window.addEventListener("mcc:content-applied", function () {
    if (MEMBER) return;   // an account's page is its own settings, never the house's site_content rows
    if (window.MCC_FRONT && window.MCC_FRONT.source === "preview") return;   // a draft on screen outranks what is saved
    var row = frontRow();
    setFront(row, row ? "saved" : "shipped");
  });
  /* THE CONTROL ROOM'S PREVIEW. Only a parent on this origin that is the Control Room may send a draft or move the page;
     a draft lives in this frame only and is never saved from here. */
  if (framedByControl) {
    window.addEventListener("message", function (e) {
      if (e.origin !== location.origin || e.source !== window.parent || !e.data || typeof e.data !== "object") return;
      if (e.data.type === "mcc:front-preview") {
        setFront(e.data.config, "preview");
        /* the page answers with what it applied, checked and bounded, so the Control Room saves exactly that */
        try { window.parent.postMessage({ type: "mcc:front-applied", seq: e.data.seq, commit: !!e.data.commit, config: FRONT }, location.origin); } catch (err) {}
      }
      else if (e.data.type === "mcc:front-goto") frontGoto(String(e.data.to || ""));
      /* "See it as a visitor": the preview shows the holding screen a visitor gets while the page is tucked away */
      else if (e.data.type === "mcc:front-view-as") { previewAs = e.data.as === "visitor" ? "visitor" : "owner"; applyVisibility(FRONT); }
    });
    try { window.parent.postMessage({ type: "mcc:front-ready" }, location.origin); } catch (e) {}
  }
  /* where the preview's scene buttons go: the top, a scene's start, or the middle of the cabin's band */
  function frontGoto(to) {
    var y = 0, el = null;
    if (to === "cabin" && cabinSec) { el = cabinSec; if (el.hasAttribute("data-front-off")) return; y = el.getBoundingClientRect().top + window.scrollY; }
    /* LOCK IN: near the end of the night descent, where the room is fully up (the pin's own start and end) */
    /* the plane mid-flight: part-way through the fly-through's pin */
    else if (to === "plane") { el = document.getElementById("work"); if (!el || el.hasAttribute("data-front-off")) return; y = el.getBoundingClientRect().top + window.scrollY + (el.offsetHeight - window.innerHeight) * 0.45; }
    else if (to === "lockin") { var pst = ScrollTrigger.getAll().filter(function (t) { return t.trigger === document.getElementById("pillars") && t.pin; })[0]; if (!pst) return; y = pst.start + (pst.end - pst.start) * 0.93; }
    else if (to === "cabin" && workST) y = workST.start + (workST.end - workST.start) * (workVR.band[0] + workVR.band[1]) / 2;
    else if (to !== "top") { el = to === "vaunt" ? document.getElementById("work") : document.querySelector(FRONT_SCENES[to === "world" ? "world" : to === "night" ? "night" : "vaunt"]); if (!el || el.hasAttribute("data-front-off") || !el.offsetHeight) return; y = el.getBoundingClientRect().top + window.scrollY; }
    if (holding) leaveCabinQuietly();
    lenis.scrollTo(y, { immediate: true, force: true });
    try { ScrollTrigger.update(); } catch (e) {}
  }
  window.__MCC_FRONT_GOTO = frontGoto; // verification handles
  window.__MCC_FRONT_HOLDING = function () { return holding; };
  } catch (err) {
    /* The whole scroll engine sits inside that try. That is the right call —
       one bad selector must not leave the page under a black gate — but a
       catch that only lifts the gate makes a broken engine LOOK like a
       working static page, which is how the last blackout hid for a week.
       So it fails loudly: the page still opens, and the reason is on the
       console and on window.__MCC_ERR for anyone standing at the keyboard. */
    try {
      window.__MCC_ERR = { message: String(err && err.message || err), stack: err && err.stack || null };
      if (window.console && console.error) console.error("[mcc] scroll engine stopped:", err);
    } catch (e) {}
    liftGate();
  }
})();
