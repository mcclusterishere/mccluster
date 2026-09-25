/* ANALYTICS CHARTS — the marks the board did not have yet.
 *
 * DRAWN AT THE WIDTH THEY ARE SHOWN AT. An SVG with a fixed 820-unit
 * viewBox squeezed into a 330px phone column renders its 11-unit labels at
 * about 4px, which is a chart nobody can read. Every chart here is drawn in
 * a viewBox equal to its container's real width in CSS pixels, so 11 is 11
 * on a phone and 11 on a desktop. A hidden section has no width, so the
 * page broadcasts `mcc:layout` when a section is shown or the viewport
 * changes and every panel redraws from the rows it already holds.
 *
 * COLOUR. The same two hues the traffic board uses, #e5383b and #3f93d2,
 * re-validated against this panel surface (#12161c) in dark mode: lightness
 * band, chroma floor, CVD (deutan ΔE 22.3, tritan 36.3), normal-vision
 * (ΔE 31.7) and contrast all pass. Single-measure charts use one hue; the
 * retention grid is one hue stepped by weight, because it is magnitude.
 */
(function (w, d) {
  "use strict";

  var A = "#e5383b", B = "#3f93d2";
  var FALLBACK = 340;   // a phone column, used only while a section is hidden

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n) {
    if (n == null || !isFinite(n)) return "—";
    n = Number(n);
    if (Math.abs(n) >= 1000000) return (Math.round(n / 100000) / 10) + "M";
    if (Math.abs(n) >= 10000) return (Math.round(n / 100) / 10) + "K";
    return n.toLocaleString();
  }

  function widthOf(host) {
    var wdt = host && host.clientWidth;
    return wdt && wdt > 120 ? Math.round(wdt) : FALLBACK;
  }

  function niceMax(max) {
    if (!max || max <= 4) return 4;
    var mag = Math.pow(10, Math.floor(Math.log10(max)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) {
      var top = steps[i] * mag;
      if (top >= max) return top;
    }
    return 10 * mag;
  }

  /* Vertical columns: one measure over ordered buckets (hours, days).
     Rounded 4px data-end, square at the baseline, 2px surface gap between
     neighbours, and a hit column wider than the mark for tap and hover. */
  function columns(rows, opts) {
    opts = opts || {};
    if (!rows.length) return "";
    var key = opts.key || "value";
    var color = opts.color || B;
    var W = Math.max(280, opts.width || FALLBACK);
    var H = opts.height || (W < 560 ? 190 : 220);
    var P = { t: 12, r: 8, b: 26, l: 38 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;
    var max = 0;
    rows.forEach(function (r) { max = Math.max(max, Number(r[key]) || 0); });
    var top = niceMax(max);
    var slot = iw / rows.length;
    var gap = Math.min(2, slot * 0.25);
    var bw = Math.max(1, slot - gap);
    var y = function (v) { return P.t + ih - ((Number(v) || 0) / top) * ih; };
    var out = [];
    for (var g = 0; g <= 4; g++) {
      var gv = (top / 4) * g, gy = y(gv);
      out.push('<line x1="' + P.l + '" y1="' + gy.toFixed(1) + '" x2="' + (W - P.r) + '" y2="' + gy.toFixed(1) +
        '" stroke="var(--bd-grid)" stroke-width="1"/>');
      if (g % 2 === 0) out.push('<text x="' + (P.l - 6) + '" y="' + (gy + 4).toFixed(1) +
        '" text-anchor="end" class="bd-axis">' + num(gv) + "</text>");
    }
    rows.forEach(function (r, i) {
      var v = Number(r[key]) || 0;
      var x = P.l + i * slot + gap / 2;
      var yTop = y(v), base = P.t + ih;
      var h = base - yTop;
      if (h > 0.5) {
        var rad = Math.min(4, bw / 2, h);
        out.push('<path fill="' + color + '" d="M' + x.toFixed(1) + " " + base.toFixed(1) +
          " V" + (yTop + rad).toFixed(1) + " Q" + x.toFixed(1) + " " + yTop.toFixed(1) + " " + (x + rad).toFixed(1) + " " + yTop.toFixed(1) +
          " H" + (x + bw - rad).toFixed(1) + " Q" + (x + bw).toFixed(1) + " " + yTop.toFixed(1) + " " + (x + bw).toFixed(1) + " " + (yTop + rad).toFixed(1) +
          " V" + base.toFixed(1) + ' Z"/>');
      }
    });
    /* Three x labels: first, middle, last. A label per bar is noise. */
    var labelFor = opts.labelFor || function (v) { return v; };
    var xKey = opts.xKey || "key";
    [0, Math.floor((rows.length - 1) / 2), rows.length - 1].forEach(function (i, n, all) {
      if (n > 0 && i === all[n - 1]) return;
      var cx = P.l + i * slot + slot / 2;
      var anchor = n === 0 ? "start" : (n === 2 ? "end" : "middle");
      if (n === 0) cx = P.l; else if (n === 2) cx = W - P.r;
      out.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="' + anchor + '" class="bd-axis">' +
        esc(labelFor(rows[i][xKey])) + "</text>");
    });
    rows.forEach(function (r, i) {
      out.push('<rect class="an-hit" data-i="' + i + '" x="' + (P.l + i * slot).toFixed(1) + '" y="' + P.t +
        '" width="' + slot.toFixed(1) + '" height="' + ih + '" fill="transparent" tabindex="-1"/>');
    });
    return '<svg class="an-svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H +
      '" role="img" aria-label="' + esc(opts.label || "") + '">' + out.join("") + "</svg>";
  }

  /* Cohort retention as a grid: rows are the week people first came,
     columns are weeks later, and the cell weight is the share still coming
     back. One hue, stepped, because it is one measure. Text sits in the
     text colour on every cell, never in the series colour. */
  function retention(rows) {
    if (!rows.length) return "";
    var byWeek = {}, maxLater = 0;
    rows.forEach(function (r) {
      var k = String(r.cohort_week).slice(0, 10);
      (byWeek[k] = byWeek[k] || {})[Number(r.weeks_later) || 0] = Number(r.devices) || 0;
      maxLater = Math.max(maxLater, Number(r.weeks_later) || 0);
    });
    var weeks = Object.keys(byWeek).sort();
    var head = '<tr><th scope="col">Started</th><th scope="col" class="n">People</th>';
    for (var c = 1; c <= Math.max(1, maxLater); c++) head += '<th scope="col" class="n">Wk ' + c + "</th>";
    head += "</tr>";
    var body = weeks.map(function (wk) {
      var base = byWeek[wk][0] || 0;
      var cells = "";
      for (var c = 1; c <= Math.max(1, maxLater); c++) {
        var v = byWeek[wk][c];
        if (v == null) { cells += '<td class="an-ret__na" title="Not reached yet">·</td>'; continue; }
        var pct = base ? (v / base) * 100 : 0;
        var weight = Math.min(1, 0.14 + pct / 40);
        cells += '<td class="n an-ret__cell" style="background:rgba(63,147,210,' + weight.toFixed(2) + ')" title="' +
          esc(num(v) + " of " + num(base) + " came back") + '">' + (Math.round(pct * 10) / 10) + "%</td>";
      }
      return '<tr><th scope="row">' + esc(wk.slice(5)) + '</th><td class="n">' + num(base) + "</td>" + cells + "</tr>";
    }).join("");
    return '<div class="an-ret"><table class="an-ret__t"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>";
  }

  /* One tooltip per chart host, placed on the far side of the finger or
     pointer so it never covers the bar being read. Tap works as well as
     hover: a phone has no hover. */
  function wireTips(host, rows, render) {
    if (!host) return;
    var svg = host.querySelector("svg");
    if (!svg) return;
    var tip = host.querySelector(".an-tip");
    if (!tip) {
      tip = d.createElement("div");
      tip.className = "an-tip";
      tip.hidden = true;
      host.appendChild(tip);
    }
    var hits = svg.querySelectorAll("[data-i]");
    var cross = svg.querySelector(".bd-cross");
    var on = null;
    var show = function (hit) {
      var i = Number(hit.getAttribute("data-i"));
      if (!rows[i]) return;
      if (on) on.classList.remove("is-on");
      on = hit; hit.classList.add("is-on");
      if (cross) {
        var cx = Number(hit.getAttribute("x")) + Number(hit.getAttribute("width")) / 2;
        cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
        cross.style.display = "";
      }
      tip.innerHTML = render(rows[i]);
      tip.hidden = false;
      tip.classList.toggle("an-tip--left", i > rows.length / 2);
    };
    Array.prototype.forEach.call(hits, function (hit) {
      hit.addEventListener("mouseenter", function () { show(hit); });
      hit.addEventListener("click", function () { show(hit); });
    });
    svg.addEventListener("mouseleave", function () {
      tip.hidden = true;
      if (cross) cross.style.display = "none";
      if (on) { on.classList.remove("is-on"); on = null; }
    });
  }

  /* Tell every panel that its width may have changed. Debounced so a
     rotating phone redraws once, not forty times. */
  var pending = null;
  function relayout() {
    clearTimeout(pending);
    pending = setTimeout(function () {
      try { d.dispatchEvent(new CustomEvent("mcc:layout")); } catch (e) { /* old browser */ }
    }, 120);
  }
  var lastW = w.innerWidth;
  w.addEventListener("resize", function () {
    if (Math.abs(w.innerWidth - lastW) < 8) return;   // mobile toolbars resize height only
    lastW = w.innerWidth;
    relayout();
  });

  w.MCCCharts = { A: A, B: B, columns: columns, retention: retention, wireTips: wireTips,
    widthOf: widthOf, relayout: relayout, num: num, esc: esc };
})(window, document);
