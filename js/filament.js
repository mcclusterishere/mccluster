/* ============================================================
   THE FILAMENT — the seek bar is the record's own waveform.

   When a track loads, its audio is decoded and folded into ~170
   peaks; the sheet's seek line becomes that exact shape. The
   played side burns in the track's own pulse color, the unplayed
   side waits in cream, and the whole filament scrubs live under
   the finger. If the decode is refused (old Safari, data saver,
   a codec mood) the classic line stays — playback never pays.
   ============================================================ */
(function () {
  "use strict";
  var deck = document.getElementById("deck");
  var seek = document.getElementById("nowSeek");
  if (!deck || !seek) return;
  if (navigator.connection && navigator.connection.saveData) return; // their data, their call

  var cv = document.createElement("canvas");
  cv.setAttribute("aria-hidden", "true");
  var g = cv.getContext("2d");
  var BARS = 168;
  var peaks = null, want = "", cache = {}, actx = null;

  function pulse() {
    return (getComputedStyle(document.documentElement).getPropertyValue("--pulse") || "#e5383b").trim();
  }

  function fit() {
    var r = seek.getBoundingClientRect();
    if (r.width < 10) return;
    var d = Math.min(2, devicePixelRatio || 1);
    cv.width = r.width * d;
    cv.height = Math.max(20, (r.height - 8) * d);
    draw();
  }

  function draw() {
    if (!peaks) return;
    var W = cv.width, H = cv.height, mid = H / 2;
    g.clearRect(0, 0, W, H);
    var frac = deck.duration ? deck.currentTime / deck.duration : 0;
    var bw = W / BARS, hot = pulse();
    for (var i = 0; i < BARS; i++) {
      var h = Math.max(2, peaks[i] * H * 0.94);
      g.fillStyle = i / BARS <= frac ? hot : "rgba(244,239,230,.3)";
      g.fillRect(i * bw + bw * 0.18, mid - h / 2, bw * 0.64, h);
    }
  }

  function build(src) {
    if (!src) return;
    var key = src.split("?")[0];
    want = key;
    if (cache[key]) {
      peaks = cache[key];
      seek.classList.add("wave-on");
      if (!cv.parentNode) seek.appendChild(cv);
      fit();
      return;
    }
    fetch(key)
      .then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(function (buf) {
        if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
        return new Promise(function (res, rej) { actx.decodeAudioData(buf, res, rej); });
      })
      .then(function (ab) {
        var ch = ab.getChannelData(0), per = Math.floor(ch.length / BARS);
        var out = new Float32Array(BARS), max = 0;
        for (var i = 0; i < BARS; i++) {
          var m = 0, base = i * per;
          for (var j = 0; j < per; j += 64) {
            var v = Math.abs(ch[base + j]);
            if (v > m) m = v;
          }
          out[i] = m;
          if (m > max) max = m;
        }
        if (max > 0) for (var k = 0; k < BARS; k++) out[k] /= max;
        cache[key] = out;
        if (want === key) {
          peaks = out;
          seek.classList.add("wave-on");
          if (!cv.parentNode) seek.appendChild(cv);
          fit();
        }
      })
      .catch(function () {
        if (want === key) { peaks = null; seek.classList.remove("wave-on"); }
      });
  }

  /* the filament follows the finger live */
  var scrub = false;
  function toTime(e) {
    var r = seek.getBoundingClientRect();
    var f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    if (deck.duration) deck.currentTime = f * deck.duration;
  }
  seek.addEventListener("pointerdown", function (e) {
    scrub = true;
    try { seek.setPointerCapture(e.pointerId); } catch (err) {}
    toTime(e);
  });
  seek.addEventListener("pointermove", function (e) { if (scrub) toTime(e); });
  seek.addEventListener("pointerup", function () { scrub = false; });
  seek.addEventListener("pointercancel", function () { scrub = false; });

  deck.addEventListener("loadedmetadata", function () { build(deck.currentSrc || deck.src); });
  deck.addEventListener("timeupdate", draw);
  addEventListener("resize", fit);

  /* the sheet opens after the load sometimes; measure once it shows */
  var now = document.getElementById("now");
  if (now) {
    new MutationObserver(function () {
      if (now.getAttribute("data-on") === "1") setTimeout(fit, 90);
    }).observe(now, { attributes: true, attributeFilter: ["data-on"] });
  }
  if (deck.currentSrc || deck.src) build(deck.currentSrc || deck.src);
})();
