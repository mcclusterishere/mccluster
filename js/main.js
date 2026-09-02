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
      duration: 0.85,
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      smoothWheel: !prefersReduced,
      syncTouch: !prefersReduced,
      syncTouchLerp: 0.14,
      touchInertiaMultiplier: 22,
    });
    lenis.on("scroll", typeof ScrollTrigger !== "undefined" ? ScrollTrigger.update : function () {});
    gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);
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

  // start hidden until the preloader hands off
  gsap.set(heroChars, { yPercent: 120, opacity: 0, rotate: 6 });
  gsap.set(".hero .reveal-line > span", { yPercent: 110, opacity: 0 });

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
          img.src = "assets/frames/" + FRAME_DIR + name + "_" + pad4(i) + ".webp";
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
    preCount.textContent = String(Math.round(v)).padStart(3, "0");
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
    var tl = gsap.timeline();
    tl.to(heroChars, {
      yPercent: 0, opacity: 1, rotate: 0,
      duration: 1.1, ease: "power4.out", stagger: 0.045,
    });
    tl.to(".hero .reveal-line > span", {
      yPercent: 0, opacity: 1, duration: 0.9, ease: "power3.out", stagger: 0.12,
    }, "-=0.7");
  }

  fetch("assets/frames/manifest.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error("no manifest"); return r.json(); })
    .then(function (m) {
      // Open on a LEAD BATCH, not the whole orbit. The hero section is 520vh
      // tall, so the viewer physically cannot scrub past the first frames
      // instantly. By the time they scroll down, the rest of the orbit has
      // streamed in behind them. loadSequence keeps loading all frames; the
      // ticker's loadedMax clamp holds the newest decoded frame until each one
      // arrives, so the scrub never shows black. This drops the blocking load
      // from ~161 frames (~7.4 MB) to ~48 (~1.4 MB) without a half-loaded feel.
      var full = m.hero.count;
      var heroGate = Math.min(48, full);
      var opened = false;
      window.__MCC_ENTER = function () {
        if (!opened) { opened = true; openSite(); }
      };
      if (enterAsked) window.__MCC_ENTER(); // a tap that landed early is honored now
      loadSequence(sequences.hero, "hero", full, function () {
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
          img.src = "assets/frames/" + name + "_0001.jpg";
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
    ScrollTrigger.create({
      trigger: "#pillars",
      start: "top top",
      end: "+=140%",
      scrub: true,
      pin: "#pillars .command__sticky",
      pinSpacing: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: function (st) {
        pillarsBg.target = st.progress * (pillarsBg.count - 1 || 0);
        var ps = st.isActive ? PAR.ramp(st.progress) : 0;
        PAR.set(parPillars, ps);
        PAR.set(parPanelsPB, ps);
        /* THE HANDOVER. The section is pulled up a screen (see .services in
           css/style.css) so it begins while the Vaunt fly-through is still
           pinned. Fading the stage in across the first slice dissolves the
           night scroll over the jet instead of sliding it up with a hard
           edge — the two films are one transition, and the join was cutting
           it in half. */
        pillarsStage.style.opacity = clamp01(st.progress / 0.32);
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
  // two scenes, ONE project: Vaunt (the brand collab)
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
         the real inside-the-jet film takes over. Drag in any direction to
         look around; scroll passes through freely. Land just glides you
         to the far side if you'd rather jump. ---- */
  /* The scroll seizure is retired: the 360 band plays while you're in
     it and lets you pass whenever you like. Browsing is never compliance. */
  /* THE HOLD. lockPageScroll was an empty stub, so nothing was ever
     actually frozen. Lenis owns this page's scrolling (wheel AND touch,
     via syncTouch), so stopping it is most of the job; the native
     listeners are the belt to its braces on engines that still bubble a
     gesture through. */
  var holdGuard = function (e) { e.preventDefault(); };
  function holdEverything(on) {
    try { on ? lenis.stop() : lenis.start(); } catch (e) {}
    if (on) {
      window.addEventListener("wheel", holdGuard, { passive: false });
      window.addEventListener("touchmove", holdGuard, { passive: false });
    } else {
      window.removeEventListener("wheel", holdGuard, { passive: false });
      window.removeEventListener("touchmove", holdGuard, { passive: false });
    }
  }
  function lockPageScroll() {}
  var workVR = {
    el: document.getElementById("workVR"),
    viewer: null, live: false, landing: false, band: [0.40, 0.50],
  };
  function workVRSet(p) {
    if (!workVR.el || !window.VR360) return;
    /* THE CABIN GIVES THE SCREEN BACK.

       This read `inBand || workVR.live`, which made the state its own reason
       to persist: the moment you scrolled into the band, `live` went true,
       and from then on `on` was true no matter where the page was, because
       `live` was true. Nothing in the scroll could ever clear it.

       So the 360 cabin painted itself over the fly-through for the whole
       rest of the section, and stayed over the page all the way back up to
       the masthead. Two of the three Vaunt scenes — the runway film going
       in and the fly-through coming out — were unreachable by scrolling.
       The only exits were the two buttons inside the cabin, which is why
       the section only worked if you pressed them.

       Leaving the band now ends the band. The margin keeps what the old
       comment was actually after — a scroll that overshoots the edge by a
       hair should not blink the cabin out — without making it permanent. */
    var EXIT = 0.05;
    var inBand = p >= workVR.band[0] && p <= workVR.band[1];
    var stillNear = workVR.live &&
      p >= workVR.band[0] - EXIT && p <= workVR.band[1] + EXIT;
    var on = !workVR.landing && (inBand || stillNear);
    // mount well before the band so the poster is up and the film is
    // buffered by the time the look-around takes the screen
    if (!workVR.viewer && p >= 0.12) {
      workVR.viewer = VR360.mount(document.getElementById("workVRCanvas"), {
        src: "assets/video/vaunt-360.mp4", video: true, autoplay: false,
        poster: "assets/img/vaunt-360-poster.jpg",
        // open facing McCluster in his seat (measured off the equirect frame)
        yaw: -140, pitch: -32, touchAction: "none",
        // three tags, not five. The camera and the six-string were scenery
        // pointing at pages the other doors already reach; what is pinned
        // now is the flight, the work, and the man.
        spots: [
          // pinned on the flight console between the pilots, measured off
          // the equirect frame
          { yaw: -77, pitch: -13, label: "The cockpit · fly with Vaunt", href: "https://vauntapi.flyvaunt.com/referral/nuao1K", blank: true },
          { yaw: 131, pitch: -29, label: "Get to the bag", href: "hire.html", urgent: true },
          { yaw: -140, pitch: -40, label: "McCluster · the résumé", href: "matthew-mccluster.html" },
        ],
      });
      window.__MCC_VR = workVR; // debug/verification handle
      var compass = document.getElementById("workVRCompass");
      document.getElementById("workVRCanvas").addEventListener("pointerdown", function () {
        armCabinMotion();  /* a tap is a gesture, which is what iOS wants */
        if (!workVR.briefReady) return;   /* the hold owns the cabin until zero */
        compass.classList.add("is-gone");
        showNPBeacon(); // dragging in silence: the beacon points at the sound
      });
      var goBtn = document.getElementById("vrBriefGo");
      if (goBtn) goBtn.addEventListener("click", function () {
        armCabinMotion();
        compass.classList.add("is-gone");
        showNPBeacon();
      });
      if (window.MCC_TRACK) window.MCC_TRACK("vr_inline_view", { page: "home" });
    }
    if (on !== workVR.live) {
      workVR.live = on;
      workVR.el.classList.toggle("is-live", on);
      if (workVR.viewer) { on ? workVR.viewer.play() : workVR.viewer.pause(); }
      lockPageScroll(on);
      if (on) runBriefing();
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
      var row = document.getElementById("vrBriefTilt");
      if (!on) { if (row) row.hidden = true; return; }
      if (window.MCC_TRACK) window.MCC_TRACK("vr_gyro_on", { page: "home", auto: 1 });
      // the sound curtain used to hang off the Motion tap. It cannot hang off
      // this: arming is automatic, so the curtain would throw itself over the
      // cabin the instant you scrolled in — and land on top of the sign. The
      // quieter beacon on the first real touch carries the soundtrack instead.
      if (workVR.briefReady) flashCabinSign();
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

  /* THE THREE SECONDS. Everything holds — scroll, drag, the side buttons —
     while the count runs, because rules are only worth writing if they get
     read. At zero the pane stops swallowing the cabin, the flight is the
     visitor's, and the cabin says so. Runs once per visit. */
  function runBriefing() {
    if (workVR.briefed) return;
    workVR.briefed = true;
    var card = document.getElementById("workVRCompass");
    var num = document.getElementById("vrBriefNum");
    if (!card || !num) { workVR.briefReady = true; return; }
    var row = document.getElementById("vrBriefTilt");
    if (row && phoneCanTilt()) row.hidden = false;
    card.classList.add("is-on");
    card.classList.remove("is-ready", "is-gone");
    holdEverything(true);
    // arm on entry where no gesture is required; iOS waits for the first tap
    if (workVR.viewer && !workVR.viewer.enableGyro.needsGesture) armCabinMotion();
    if (window.MCC_TRACK) window.MCC_TRACK("vr_brief", { page: "home" });
    var n = 3;
    num.textContent = n;
    var iv = setInterval(function () {
      n -= 1;
      if (n > 0) {
        num.textContent = n;
        num.style.animation = "none"; void num.offsetWidth; num.style.animation = "";
        return;
      }
      clearInterval(iv);
      holdEverything(false);
      workVR.briefReady = true;
      // when the phone handed over its motion, the announcement IS the
      // release and it says more than the button would — so the card steps
      // aside for it. Without motion the card stays, button and all.
      if (workVR.motion) { card.classList.add("is-gone"); flashCabinSign(); }
      else card.classList.add("is-ready");
    }, 1000);
  }

  var workSlow = document.getElementById("workSlowHint");
  var workFly = document.getElementById("workFlyPill");
  var workRunway = document.getElementById("workRunway");
  var workST = ScrollTrigger.create({
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
  });

  // one true exit that always works: the brand mark (and the Back-to-top
  // button inside the band) releases any lock and flies home
  function releaseAndGoTop() {
    workVR.landing = true;
    workVR.live = false;
    if (workVR.el) workVR.el.classList.remove("is-live");
    if (workVR.viewer) workVR.viewer.pause();
    lockPageScroll(false);
    lenis.scrollTo(0, { duration: 1.2 });
    setTimeout(function () { workVR.landing = false; }, 1600);
  }
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
    workVR.landing = true;
    workVR.live = false;
    if (workVR.el) workVR.el.classList.remove("is-live");
    if (workVR.viewer) workVR.viewer.pause();
    lockPageScroll(false);
    var y = workST.start + (workST.end - workST.start) * 0.02;
    lenis.scrollTo(y, { duration: 1.0, onComplete: function () { workVR.landing = false; } });
    setTimeout(function () { workVR.landing = false; }, 1600); // if the glide is cut short
    if (window.MCC_TRACK) window.MCC_TRACK("vr_back_to_card", { page: "home" });
  });

  // Land: the only way out while scroll is locked. Touches down right at the
  // start of the fly-through film, the jet in open air, then hands the
  // scroll back to the user; no auto-ride to the end of the section.
  var workSkip = document.getElementById("workVRSkip");
  if (workSkip) workSkip.addEventListener("click", function () {
    workVR.landing = true;
    workVR.live = false;
    if (workVR.el) workVR.el.classList.remove("is-live");
    if (workVR.viewer) workVR.viewer.pause();
    lockPageScroll(false);
    var y = workST.start + (workST.end - workST.start) * (workVR.band[1] + 0.005);
    lenis.scrollTo(y, {
      duration: 0.9,
      onComplete: function () { workVR.landing = false; },
    });
    // if the glide is interrupted before onComplete, re-arm the band anyway
    setTimeout(function () { workVR.landing = false; }, 1400);
    if (window.MCC_TRACK) window.MCC_TRACK("vr_skip", { page: "home" });
  });

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
  gsap.set(finaleChars, { yPercent: 120, opacity: 0, rotate: 8 });
  gsap.to(finaleChars, {
    yPercent: 0, opacity: 1, rotate: 0,
    duration: 1, ease: "power4.out", stagger: 0.05,
    scrollTrigger: { trigger: "#book", start: "top 70%" },
  });
  gsap.from(".finale__actions .btn", {
    y: 40, opacity: 0, duration: 0.8, ease: "power3.out", stagger: 0.12,
    scrollTrigger: { trigger: ".finale__actions", start: "top 92%" },
  });

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
    var HOUSE_TRACK = "whodidtheshoot";
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

       So the house plays WHO DID THE SHOOT and nothing else, start to
       finish, on every page.

       The zones stay in the list rather than being deleted, because the
       #work ScrollTrigger below is also what maintains `commandInView`,
       which the command-scroll scene reads. Removing the zone would take
       that with it. They all name the same track now, so a scroll can no
       longer change the record. */
    var zones = [
      { sel: "#hero", track: HOUSE_TRACK },
      { sel: "#pillars", track: HOUSE_TRACK },
      { sel: "#uprise", track: HOUSE_TRACK },
      { sel: "#wings", track: HOUSE_TRACK },
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
    function bankToPocket() {
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
      });
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

    window.addEventListener("pagehide", bankToPocket);
    /* pagehide does not fire on every bfcache-less path on every browser,
       and a tab hidden mid-song is the same intent as leaving */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") bankToPocket();
    });

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
    ["#hero", "#loadout", "#pillars", "#work", "#book"].forEach(function (sel) {
      if (!document.querySelector(sel)) return;
      ScrollTrigger.create({
        trigger: sel, start: "top 60%", once: true,
        onEnter: function () { track("section_view", { section: sel.slice(1), page: "home" }); },
      });
    });
    // CTAs, song gates, and nav clicks
    document.querySelectorAll(".head-cta, .finale__actions .btn, .song-gate, .site-foot a, a[data-cta]").forEach(function (el) {
      el.addEventListener("click", function () {
        track("cta_click", {
          label: (el.textContent || "").trim().slice(0, 60),
          href: el.getAttribute("href") || "",
          page: "home",
        });
      });
    });
  })();

  /* ---------------- brand mark: 3D spin with the scroll, flashing ---------------- */
  gsap.set(".brand__mark", { transformPerspective: 480 });
  gsap.to(".brand__mark", {
    rotationY: 1080,
    ease: "none",
    scrollTrigger: { start: 0, end: "max", scrub: 0.6 },
  });

  /* ---------------- debug handle (used by the verification harness) ---------------- */
  window.__MCC = {
    ready: function (k) { return sequences[k || "hero"].ready; },
    frameCount: function (k) { return sequences[k || "hero"].count; },
    lastDrawn: function (k) { return sequences[k || "hero"].lastDrawn; },
    target: function (k) { return sequences[k || "hero"].target; },
    loadedMax: function (k) { return sequences[k || "hero"].loadedMax; },
  };

  /* ---------------- Square gates: subscribe + paid inquiry call ---------------- */
  (function () {
    function wire(id, entry, pendingText) {
      var btn = document.getElementById(id);
      if (!btn) return;
      if (entry && entry.link) {
        btn.href = entry.link;
        btn.target = "_blank";
        btn.rel = "noopener";
        btn.addEventListener("click", function () {
          if (window.MCC_TRACK) window.MCC_TRACK("cta_click", { label: id === "subscribeBtn" ? "subscribe-home" : "book-call-home", page: "home" });
        });
      } else if (id === "bookCallBtn") {
        // no calendar yet: a working booking email beats a dead button
        btn.href = "mailto:matthew@mccluster.org?subject=" +
          encodeURIComponent("Book a Paid Call · McCluster") +
          "&body=" + encodeURIComponent("I'd like to book a paid discovery call. Here's what I'm looking to do:\n\n");
        btn.addEventListener("click", function () {
          if (window.MCC_TRACK) window.MCC_TRACK("cta_click", { label: "book-call-home", page: "home" });
        });
      } else {
        btn.classList.add("is-pending");
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          btn.textContent = pendingText;
        });
      }
    }
    var pay = window.PAYMENTS || {};
    wire("subscribeBtn", pay.subscribe, "Subscriptions open soon");
    wire("bookCallBtn", pay.bookcall, "Booking opens soon");
    wire("bookCallStat", pay.bookcall, "Booking opens soon");
  })();

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
  } catch (err) {
    liftGate();
  }
})();
