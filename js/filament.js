/* ============================================================
   THE FILAMENT — the seek bar is the record's own waveform.

   The sheet's seek line is the record's own shape: 168 peaks
   measured once from the very file the deck plays
   (scripts/music-peaks.mjs → data/peaks/<file>.json, read through
   js/peaks.js). The played side burns in the track's own pulse
   color, the unplayed side waits in cream, and the whole filament
   scrubs live under the finger.

   IT NEVER TOUCHES THE SONG. This used to download every track a
   second time and decode all of it in a second AudioContext to find
   those peaks: about 50 MB of samples for a median song, on every
   track change, in the background too, and a second request against
   an earned play's one-play token (music map 00 G-8, 01 PB-11). The
   shape is read from a small file now, once per song, and only while
   the page is seen; a hidden page draws nothing. A record nobody
   measured (the gated closer's private master, a creator's cut)
   draws a quiet, even line. If the file cannot be read the classic
   line stays — playback never pays.
   ============================================================ */
(function () {
  "use strict";
  var deck = document.getElementById("deck");
  var seek = document.getElementById("nowSeek");
  var PEAKS = window.MCC_PEAKS;
  if (!deck || !seek || !PEAKS) return;

  var cv = document.createElement("canvas");
  cv.setAttribute("aria-hidden", "true");
  var g = cv.getContext("2d");
  var BARS = 168;
  var peaks = null, want = "";

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
    if (!peaks || document.hidden) return;
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

  function show(bars) {
    peaks = bars;
    seek.classList.add("wave-on");
    if (!cv.parentNode) seek.appendChild(cv);
    fit();
  }
  function flat() {
    var out = [];
    for (var i = 0; i < BARS; i++) out.push(PEAKS.flat);
    return out;
  }
  /* the shape of whatever the deck is playing, once per song, while seen */
  function build(src) {
    if (!src || document.hidden) return;
    if (src === want && peaks) return;
    want = src;
    if (!PEAKS.keyOf(src)) { show(flat()); return; }
    PEAKS.load(src).then(function (p) {
      if (want !== src) return;
      if (p && p.bars && p.bars.length === BARS) show(p.bars);
      else { peaks = null; seek.classList.remove("wave-on"); }
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
  /* back in view: the song may have changed while the page was hidden */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) { build(deck.currentSrc || deck.src); draw(); }
  });

  /* the sheet opens after the load sometimes; measure once it shows */
  var now = document.getElementById("now");
  if (now) {
    new MutationObserver(function () {
      if (now.getAttribute("data-on") === "1") setTimeout(fit, 90);
    }).observe(now, { attributes: true, attributeFilter: ["data-on"] });
  }
  if (deck.currentSrc || deck.src) build(deck.currentSrc || deck.src);
})();
