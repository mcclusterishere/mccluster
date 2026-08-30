/* ============================================================
   THE DRIFT — the site knows how the phone is held.

   Elements marked data-drift lean with the device: tilt the
   phone and the room's furniture slides on its own depth
   (--drift, in px at full tilt). On desks the pointer plays the
   part of gravity. One pair of globals (--gx/--gy, smoothed)
   drives every drifting element, so the whole page agrees on
   which way is down.

   iOS asks permission for motion, and only inside a user
   gesture — MCC_MOTION.arm() is that gesture's errand, shared
   with the tuner's tilt mode so one grant lights everything.

   THE SHAKE rides along on the album: three hard flicks of the
   phone and the record shuffles. A music app that isn't
   listening to the hand holding it isn't finished.
   ============================================================ */
(function () {
  "use strict";
  var CALM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root = document.documentElement;

  /* ---------------- the drift ---------------- */
  var gx = 0, gy = 0, tx = 0, ty = 0, raf = 0, live = false;
  function loop() {
    gx += (tx - gx) * 0.08;
    gy += (ty - gy) * 0.08;
    root.style.setProperty("--gx", gx.toFixed(4));
    root.style.setProperty("--gy", gy.toFixed(4));
    if (Math.abs(tx - gx) > 0.001 || Math.abs(ty - gy) > 0.001) raf = requestAnimationFrame(loop);
    else live = false;
  }
  function wakeDrift() { if (!live) { live = true; raf = requestAnimationFrame(loop); } }
  function onGyro(e) {
    if (e.gamma == null) return;
    tx = Math.max(-1, Math.min(1, e.gamma / 28));
    ty = Math.max(-1, Math.min(1, ((e.beta == null ? 45 : e.beta) - 45) / 32));
    wakeDrift();
  }
  function onPointer(e) {
    tx = (e.clientX / innerWidth) * 2 - 1;
    ty = (e.clientY / innerHeight) * 2 - 1;
    wakeDrift();
  }

  var armed = false;
  function armGyro() {
    if (armed) return;
    armed = true;
    window.addEventListener("deviceorientation", onGyro);
  }

  if (!CALM) {
    if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
      window.addEventListener("pointermove", onPointer);
    }
    /* platforms that don't gate motion get it immediately */
    if (window.DeviceOrientationEvent &&
        typeof DeviceOrientationEvent.requestPermission !== "function") {
      armGyro();
    }
  }

  /* ---------------- the shake (album page only) ---------------- */
  var deck = document.getElementById("deck");
  var motionOn = false;
  function onMotion(e) {
    var a = e.accelerationIncludingGravity;
    if (!a) return;
    var m = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
    var now = Date.now();
    if (m > 34 && now - onMotion.last > 180) {
      onMotion.last = now;
      onMotion.hits = now - onMotion.hitT < 900 ? onMotion.hits + 1 : 1;
      onMotion.hitT = now;
      if (onMotion.hits >= 3) {
        onMotion.hits = 0;
        var rows = document.querySelectorAll("#tracks li");
        if (rows.length) {
          rows[Math.floor(Math.random() * rows.length)].click();
          if (window.MCC_TRACK) window.MCC_TRACK("shake_shuffle", {});
        }
      }
    }
  }
  onMotion.last = 0; onMotion.hits = 0; onMotion.hitT = 0;
  function armShake() {
    if (motionOn || !deck || CALM) return;
    motionOn = true;
    window.addEventListener("devicemotion", onMotion);
  }
  if (deck && !CALM && window.DeviceMotionEvent &&
      typeof DeviceMotionEvent.requestPermission !== "function") {
    armShake();
  }

  /* ---------------- the shared grant ---------------- */
  window.MCC_MOTION = {
    armed: function () { return armed; },
    /* call from a user gesture; resolves true when motion flows */
    arm: function () {
      if (CALM) return Promise.resolve(false);
      /* BOTH prompts must be fired inside the gesture that called us. iOS
         rejects a permission request made from a .then() — chaining motion
         behind orientation is exactly how the shake silently died. */
      var needO = window.DeviceOrientationEvent &&
        typeof DeviceOrientationEvent.requestPermission === "function";
      var needM = window.DeviceMotionEvent &&
        typeof DeviceMotionEvent.requestPermission === "function";

      /* orientation goes first: if the platform only honours one request per
         gesture, it must be the one the tuner is waiting on */
      var or = needO
        ? DeviceOrientationEvent.requestPermission().catch(function () { return "denied"; })
        : Promise.resolve("granted");
      var mo = needM
        ? DeviceMotionEvent.requestPermission().catch(function () { return "denied"; })
        : Promise.resolve("granted");

      mo.then(function (r) { if (r === "granted") armShake(); });
      return or.then(function (r) {
        if (r !== "granted") return false;
        armGyro();
        return true;
      });
    },
  };
})();
