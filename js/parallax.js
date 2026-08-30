/* ============================================================
   Mouse parallax: the "it's watching you" layer.
   As a slide's film reaches its final frame, the scene starts
   tracking the cursor: the canvas leans toward the pointer with
   a perspective tilt while the lyrics counter-drift at a
   shallower depth, and a soft light follows the mouse.
   Scroll decides HOW MUCH a slide reacts (its strength ramps in
   near the end of the slide); the pointer decides WHERE it leans.
   Desktop pointers only; sits out for reduced-motion visitors.
   ============================================================ */

window.MCC_PARALLAX = (function () {
  "use strict";

  var enabled =
    window.matchMedia("(pointer: fine)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    !!window.gsap;

  var items = [];
  var tx = 0, ty = 0;   // pointer target, normalized -1..1 from screen center
  var cx = 0, cy = 0;   // lerped position the transforms actually follow

  // ramp: a slide only comes alive over the last stretch of its scroll band
  function ramp(q) { return Math.max(0, Math.min(1, (q - 0.7) / 0.25)); }

  function attach(el, opts) {
    if (!enabled || !el) return null;
    var it = {
      el: el,
      depth: opts.depth || 14, // px the layer travels toward the cursor
      tilt: opts.tilt || 0,    // deg of perspective lean
      push: opts.push || 0,    // overscale that hides the revealed edges
      strength: 0,
      wasOn: false,
    };
    items.push(it);
    return it;
  }

  function set(it, s) { if (it) it.strength = s; }

  if (enabled) {
    window.addEventListener("pointermove", function (e) {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    var root = document.documentElement.style;

    gsap.ticker.add(function () {
      cx += (tx - cx) * 0.07;
      cy += (ty - cy) * 0.07;
      var live = 0;
      items.forEach(function (it) {
        var s = it.strength;
        if (s > live) live = s;
        if (s < 0.001) {
          // one last write settles the layer back to neutral
          if (it.wasOn) {
            it.wasOn = false;
            var off = { x: 0, y: 0, rotationX: 0, rotationY: 0 };
            if (it.push) off.scale = 1;
            gsap.set(it.el, off);
          }
          return;
        }
        it.wasOn = true;
        var v = {
          x: cx * it.depth * s,
          y: cy * it.depth * 0.7 * s,
          rotationY: cx * it.tilt * s,
          rotationX: -cy * it.tilt * 0.75 * s,
          transformPerspective: 900,
        };
        if (it.push) v.scale = 1 + it.push * s;
        gsap.set(it.el, v);
      });
      // the cursor light only glows while some slide is tracking
      root.setProperty("--spot-x", ((cx + 1) * 50).toFixed(2) + "%");
      root.setProperty("--spot-y", ((cy + 1) * 50).toFixed(2) + "%");
      root.setProperty("--spot-o", (live * 0.55).toFixed(3));
    });
  }

  return { enabled: enabled, attach: attach, set: set, ramp: ramp };
})();
