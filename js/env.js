/* ============================================================
   THE LIVING SLEEVE: every album cover is a tiny world.
   Not a looping GIF: real layers on real planes. The skyline
   sits deep, the artist stands near, the M signal breathes in
   the clouds, windows flicker, fog drifts. Tilt the phone or
   move a thumb and the camera moves with you; press the cover
   and the camera pushes in.

   MCC_ENV.mount(imgEl, slug) swaps a static cover for its
   environment when data/environments.json knows the album.
   Falls back gracefully: no entry, no motion preference, or a
   missing layer and the still cover stays exactly as it was.
   ============================================================ */
window.MCC_ENV = (function () {
  "use strict";

  var DATA = null, FETCHED = false;
  var REDUCE = false;
  try { REDUCE = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  function fetchData(cb) {
    if (FETCHED) { cb(DATA); return; }
    fetch("data/environments.json", { cache: "no-cache" })
      .then(function (r) { return r.json(); })
      .then(function (j) { FETCHED = true; DATA = j || null; cb(DATA); })
      .catch(function () { FETCHED = true; cb(null); });
  }

  /* seeded scatter: the same windows glow every visit */
  function scatter(n, seed) {
    var pts = [], s = seed || 7;
    for (var i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      var x = (s % 1000) / 1000;
      s = (s * 16807) % 2147483647;
      var y = (s % 1000) / 1000;
      s = (s * 16807) % 2147483647;
      pts.push({ x: x, y: y, ph: (s % 628) / 100 });
    }
    return pts;
  }

  function mount(imgEl, slug) {
    if (!imgEl || !slug || REDUCE) return;
    fetchData(function (data) {
      var env = data && data.environments && data.environments[slug];
      if (!env) return;
      build(imgEl, env);
    });
  }

  function build(imgEl, env) {
    var stage = document.createElement("div");
    stage.className = imgEl.className + " env";
    stage.setAttribute("aria-label", "Living album cover");
    stage.style.position = "relative";
    stage.style.overflow = "hidden";

    function layerImg(src, cls) {
      var im = document.createElement("img");
      im.src = src;
      im.alt = "";
      im.draggable = false;
      im.className = cls;
      im.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;will-change:transform;";
      return im;
    }
    var bg = layerImg(env.bg || imgEl.getAttribute("src"), "env__bg");
    var fx = document.createElement("canvas");
    fx.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    var fg = null;
    if (env.fg) {
      fg = layerImg(env.fg, "env__fg");
      fg.addEventListener("error", function () { if (fg.parentNode) fg.parentNode.removeChild(fg); fg = null; });
    }
    stage.appendChild(bg);
    stage.appendChild(fx);
    if (fg) stage.appendChild(fg);

    imgEl.parentNode.insertBefore(stage, imgEl);
    imgEl.style.display = "none"; /* the still stays in the DOM; other code reads its src */

    /* ---- the camera ---- */
    var tx = 0, ty = 0, cx = 0, cy = 0;   /* target / current tilt, -1..1 */
    var press = 0, cpress = 0;            /* push-in on touch */
    function setTargetFromPoint(x, y, rect) {
      tx = Math.max(-1, Math.min(1, ((x - rect.left) / rect.width) * 2 - 1));
      ty = Math.max(-1, Math.min(1, ((y - rect.top) / rect.height) * 2 - 1));
    }
    stage.addEventListener("pointermove", function (e) {
      setTargetFromPoint(e.clientX, e.clientY, stage.getBoundingClientRect());
    });
    stage.addEventListener("pointerleave", function () { tx = 0; ty = 0; });
    stage.addEventListener("pointerdown", function () { press = 1; askGyro(); });
    window.addEventListener("pointerup", function () { press = 0; });

    /* the phone itself is the camera: tilt drives the planes.
       iOS asks permission; the first touch on the cover asks once. */
    var gyroOn = false, gyroAsked = false;
    function onOrient(e) {
      if (e.gamma == null) return;
      gyroOn = true;
      tx = Math.max(-1, Math.min(1, e.gamma / 22));
      ty = Math.max(-1, Math.min(1, (e.beta - 45) / 28));
    }
    function askGyro() {
      if (gyroAsked) return;
      gyroAsked = true;
      try {
        if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) {
          DeviceOrientationEvent.requestPermission().then(function (r) {
            if (r === "granted") window.addEventListener("deviceorientation", onOrient);
          }).catch(function () {});
        }
      } catch (e) {}
    }
    try {
      if (window.DeviceOrientationEvent && !DeviceOrientationEvent.requestPermission) {
        window.addEventListener("deviceorientation", onOrient);
      }
    } catch (e) {}

    /* ---- the weather ---- */
    var ctx2 = fx.getContext("2d");
    var beacon = env.beacon || null;
    var lights = env.lights ? scatter(env.lights.count || 14, env.lights.seed || 7) : null;
    var lightBox = (env.lights && env.lights.box) || { x: 0.02, y: 0.55, w: 0.5, h: 0.38 };
    var fogOn = env.fog !== false;

    var running = false, raf = 0, t0 = performance.now();
    function frame(now) {
      if (!running) return;
      var t = (now - t0) / 1000;

      /* the planes ease toward the hand */
      cx += (tx - cx) * 0.07;
      cy += (ty - cy) * 0.07;
      cpress += (press - cpress) * 0.12;
      var deep = 1.08 + cpress * 0.03, near = 1.12 + cpress * 0.06;
      bg.style.transform = "scale(" + deep + ") translate(" + (-cx * 1.6) + "%," + (-cy * 1.2) + "%)";
      if (fg) fg.style.transform = "scale(" + near + ") translate(" + (cx * 2.4) + "%," + (cy * 1.8) + "%)";

      /* the canvas weather */
      var w = fx.width = stage.clientWidth * (window.devicePixelRatio > 1 ? 2 : 1);
      var h = fx.height = stage.clientHeight * (window.devicePixelRatio > 1 ? 2 : 1);
      ctx2.clearRect(0, 0, w, h);

      if (beacon) {
        /* the M signal breathes, and drifts with the deep plane */
        var bxp = (beacon.x + (-cx * 0.016)) * w, byp = (beacon.y + (-cy * 0.012)) * h;
        var breath = 0.16 + 0.1 * Math.sin(t * 0.7) + 0.03 * Math.sin(t * 5.3);
        var rad = (beacon.r || 0.2) * Math.min(w, h) * (1 + 0.08 * Math.sin(t * 0.5));
        var g = ctx2.createRadialGradient(bxp, byp, 0, bxp, byp, rad);
        g.addColorStop(0, "rgba(165,232,200," + Math.max(0, breath) + ")");
        g.addColorStop(1, "rgba(165,232,200,0)");
        ctx2.fillStyle = g;
        ctx2.fillRect(0, 0, w, h);
      }

      if (lights) {
        /* the city is awake: windows flicker on their own clocks */
        for (var i = 0; i < lights.length; i++) {
          var L = lights[i];
          var a = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * (0.6 + L.ph * 0.22) + L.ph * 6));
          ctx2.fillStyle = "rgba(255,214,140," + a.toFixed(3) + ")";
          var lx = (lightBox.x + L.x * lightBox.w + (-cx * 0.02)) * w;
          var ly = (lightBox.y + L.y * lightBox.h + (-cy * 0.014)) * h;
          ctx2.fillRect(lx, ly, Math.max(1.5, w * 0.004), Math.max(1.5, w * 0.004));
        }
      }

      if (fogOn) {
        /* fog rolls across the roofline, near plane speed */
        for (var f = 0; f < 3; f++) {
          var fxp = ((t * (0.012 + f * 0.007) + f * 0.37) % 1.3 - 0.15 + cx * 0.03) * w;
          var fyp = (0.78 + f * 0.07 + cy * 0.02) * h;
          var fr = w * (0.22 + f * 0.06);
          var fg2 = ctx2.createRadialGradient(fxp, fyp, 0, fxp, fyp, fr);
          fg2.addColorStop(0, "rgba(210,205,200,0.05)");
          fg2.addColorStop(1, "rgba(210,205,200,0)");
          ctx2.fillStyle = fg2;
          ctx2.fillRect(0, 0, w, h);
        }
      }

      raf = requestAnimationFrame(frame);
    }
    function start() { if (!running) { running = true; t0 = performance.now() - 8000; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; cancelAnimationFrame(raf); }

    /* the world sleeps offscreen and when the tab hides */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) start(); else stop(); });
      }, { threshold: 0.05 }).observe(stage);
    } else start();
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") stop();
      else if (stage.getBoundingClientRect().top < innerHeight) start();
    });

    start();
  }

  return { mount: mount };
})();
