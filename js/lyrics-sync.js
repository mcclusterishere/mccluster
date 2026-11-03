/* ============================================================
   LYRICS SYNC — the one timed-lyrics renderer every player uses.

   Reads any lyrics file the shelf names (data/lyrics/*.json):
     timed.line[] {begin, end?, content, words?[{begin,end,content}]}
       (seconds; what DistroKid exports and what the lyric machine makes)
     lines[] {t, text}  (the older shape)
     plain              (words with no times: they roll with the song)
   and paints them into a scroll box that follows the audio:
     - the line being sung is lit (.is-live) and kept in view,
     - where word times exist, the words light as they are sung,
     - tap a line to jump the song to it,
     - nothing changes size while it plays (colour/opacity only), so the
       page never shifts under a thumb.

   window.MCC_LYRICS = { normalize, indexAt, mount }
     mount(box, json, { seek(t), renderLine(p, text) → true if it made links,
                        onLive(i, p) }) → { update(t, duration), lines, nodes, timed }
   ============================================================ */
(function (root) {
  "use strict";
  var STYLE_ID = "mcc-lyrics-sync-css";
  function css() {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      ".lyr-line{cursor:pointer;-webkit-tap-highlight-color:transparent}" +
      ".lyr-line.is-live .lyr-w{opacity:.5;transition:opacity .12s linear}" +
      ".lyr-line.is-live .lyr-w.is-sung{opacity:1}" +
      ".lyr-line:focus-visible{outline:2px solid currentColor;outline-offset:4px;border-radius:4px}" +
      "@media (prefers-reduced-motion: reduce){.lyr-line.is-live .lyr-w{transition:none}}";
    (document.head || document.documentElement).appendChild(s);
  }

  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }

  /** any lyrics JSON -> {timed:boolean, lines:[{t,end,text,words}]} or null */
  function normalize(d) {
    if (!d || typeof d !== "object") return null;
    var raw = d.timed && Array.isArray(d.timed.line) && d.timed.line.length ? d.timed.line
      : Array.isArray(d.lines) && d.lines.length ? d.lines : null;
    var lines = [];
    if (raw) {
      raw.forEach(function (l) {
        if (!l || typeof l !== "object") return;
        var t = num(l.begin) != null ? l.begin : num(l.t);
        var text = typeof l.content === "string" ? l.content : typeof l.text === "string" ? l.text : typeof l.line === "string" ? l.line : null;
        if (t == null || text == null) return;
        var words = Array.isArray(l.words) ? l.words.filter(function (w) {
          return w && num(w.begin) != null && typeof w.content === "string" && w.content;
        }).map(function (w) { return { t: w.begin, end: num(w.end) != null ? w.end : w.begin, text: w.content }; }) : null;
        lines.push({ t: t, end: num(l.end), text: text, words: words && words.length ? words : null, mismatch: !!l.mismatch });
      });
      lines.sort(function (a, b) { return a.t - b.t; });
      for (var i = 0; i < lines.length; i++) if (lines[i].end == null) lines[i].end = i + 1 < lines.length ? lines[i + 1].t : lines[i].t + 4;
      if (lines.length) return { timed: true, lines: lines };
    }
    if (typeof d.plain === "string" && d.plain.trim()) {
      return { timed: false, lines: d.plain.split("\n").map(function (x) { return { t: null, end: null, text: x, words: null }; }) };
    }
    return null;
  }

  /** index of the last line that has begun at time t (binary search), -1 before the first */
  function indexAt(lines, t) {
    var lo = 0, hi = lines.length - 1, hit = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (lines[mid].t <= t) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
    return hit;
  }

  function mount(box, json, opts) {
    opts = opts || {};
    css();
    var model = normalize(json);
    box.textContent = "";
    var nodes = [];
    if (!model) return { update: function () {}, lines: [], nodes: nodes, timed: false, empty: true };
    model.lines.forEach(function (l, i) {
      var p = document.createElement("p");
      var linked = opts.renderLine ? opts.renderLine(p, l.text) : false;
      if (!opts.renderLine) p.textContent = l.text;
      /* word spans only where the line is plain text: a service link stays one link */
      if (model.timed && l.words && !linked && !p.querySelector("a")) {
        p.textContent = "";
        l.words.forEach(function (w, k) {
          if (k) p.appendChild(document.createTextNode(" "));
          var s = document.createElement("span");
          s.className = "lyr-w";
          s.textContent = w.text;
          p.appendChild(s);
        });
        l._spans = Array.prototype.slice.call(p.querySelectorAll(".lyr-w"));
      }
      if (model.timed) {
        p.className = (p.className ? p.className + " " : "") + "lyr-line";
        p.setAttribute("data-t", String(l.t));
        p.tabIndex = 0;
        p.setAttribute("role", "button");
        p.setAttribute("aria-label", "Play from: " + l.text);
        var go = function (e) {
          if (e.target && e.target.closest && e.target.closest("a")) return; /* a service link keeps its own job */
          if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
          if (e.type === "keydown") e.preventDefault();
          if (opts.seek) opts.seek(l.t);
        };
        p.addEventListener("click", go);
        p.addEventListener("keydown", go);
      }
      box.appendChild(p);
      nodes.push(p);
    });
    box.scrollTop = 0;
    var live = -2, sungTo = -1;
    var reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    function bring(p) {
      var top = p.offsetTop - box.clientHeight * 0.32;
      if (box.scrollTo) box.scrollTo({ top: top, behavior: reduce ? "auto" : "smooth" }); else box.scrollTop = top;
    }
    function update(t, duration) {
      var i;
      if (model.timed) i = indexAt(model.lines, t);
      else if (duration > 0) i = Math.min(model.lines.length - 1, Math.floor((t / duration) * model.lines.length));
      else i = -1;
      if (i !== live) {
        if (live >= 0 && nodes[live]) {
          nodes[live].classList.remove("is-live");
          (model.lines[live]._spans || []).forEach(function (s) { s.classList.remove("is-sung"); });
        }
        live = i; sungTo = -1;
        if (i >= 0 && nodes[i]) { nodes[i].classList.add("is-live"); bring(nodes[i]); if (opts.onLive) opts.onLive(i, nodes[i]); }
      }
      var L = i >= 0 ? model.lines[i] : null;
      if (L && L._spans) {
        var k = -1;
        for (var w = 0; w < L.words.length; w++) if (L.words[w].t <= t) k = w;
        if (k !== sungTo) {
          L._spans.forEach(function (s, q) { s.classList.toggle("is-sung", q <= k); });
          sungTo = k;
        }
      }
      return i;
    }
    return { update: update, lines: model.lines, nodes: nodes, timed: model.timed, empty: false, live: function () { return live; } };
  }

  /* players tick on timeupdate (~4/s); words need finer steps, so while the
     audio plays a frame loop drives update() too */
  function follow(audio, ctl) {
    var raf = 0;
    function tick() { ctl.update(audio.currentTime, audio.duration); raf = audio.paused ? 0 : requestAnimationFrame(tick); }
    function start() { if (!raf) raf = requestAnimationFrame(tick); }
    audio.addEventListener("play", start);
    audio.addEventListener("seeked", function () { ctl.update(audio.currentTime, audio.duration); });
    audio.addEventListener("timeupdate", function () { if (!raf) ctl.update(audio.currentTime, audio.duration); });
    if (!audio.paused) start();
    return function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; };
  }

  root.MCC_LYRICS = { normalize: normalize, indexAt: indexAt, mount: mount, follow: follow };
})(typeof window !== "undefined" ? window : globalThis);
