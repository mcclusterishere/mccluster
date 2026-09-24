/* THE BOARD — traffic, drawn.
 *
 * This page used to report four bare integers and three two-column count
 * tables. A number with no baseline and no shape is not analytics, it is a
 * readout: it cannot tell you whether 812 page views is a good week or the
 * start of a collapse. Everything here is therefore either a series over time
 * or a ranked list with its share drawn beside it.
 *
 * NO DATA SOURCE LIVES IN HERE. The board renders a traffic model and owns the
 * range bar; the page supplies the model through `fetch(days)`. That is what
 * lets one board serve both a client's site (scoped by site_id under RLS) and
 * this site's own first-party pixel (the rows with no site_id) without two
 * copies of the drawing code.
 *
 * ONE REQUEST, TWO PERIODS. Every tile shows a delta, and a delta needs a
 * previous period to compare against. Rather than asking twice, the board asks
 * for double the window and splits the day series down the middle: the second
 * half is now, the first half is what it is measured against.
 *
 * THE PALETTE IS NOT A TASTE DECISION. #e5383b (the house ruby) and #3f93d2
 * were checked with the dataviz validator against this card surface (#12161c)
 * in dark mode: lightness band, chroma floor, CVD separation (deutan ΔE 22.3,
 * tritan 36.3), normal-vision separation (ΔE 31.7) and contrast all pass.
 * Changing either colour means re-running that check, not eyeballing it.
 * Both series are direct-labelled and legended anyway, so identity never rests
 * on colour alone.
 */
(function (w, d) {
  "use strict";

  var SERIES = [
    { key: "page_views", label: "Page views", color: "#e5383b" },
    { key: "visitors", label: "Visitors", color: "#3f93d2" }
  ];
  var RANGES = [
    { id: "7d", label: "7 days", days: 7 },
    { id: "30d", label: "30 days", days: 30 },
    { id: "90d", label: "90 days", days: 90 }
  ];
  var ROW_CAP = 20000;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* Compact only above 10k. Below that the exact figure is the point, and
     "1.2K" throws away information somebody is trying to read. */
  function num(n) {
    if (n == null || !isFinite(n)) return "—";
    n = Number(n);
    if (Math.abs(n) >= 1000000) return (Math.round(n / 100000) / 10) + "M";
    if (Math.abs(n) >= 10000) return (Math.round(n / 100) / 10) + "K";
    return n.toLocaleString();
  }
  /* YYYY-MM-DD in the reader's own timezone. A day boundary drawn in UTC puts
     last night's evening traffic on tomorrow's column. */
  function localDay(value) {
    var t = new Date(value);
    if (isNaN(t)) return "";
    return t.getFullYear() + "-" +
      String(t.getMonth() + 1).padStart(2, "0") + "-" +
      String(t.getDate()).padStart(2, "0");
  }
  function dayLabel(iso) {
    var p = String(iso).split("-");
    return p.length === 3 ? p[1] + "/" + p[2] : iso;
  }

  /* ================= ROLLUP =================
     Raw event rows in, one traffic model out. The day axis is FILLED across the
     whole window rather than built from the days that happen to have rows: a
     Tuesday with no traffic is a zero, and drawing it as a missing point turns
     a quiet week into a straight line between two peaks. */
  function rollup(rows, opts) {
    rows = rows || [];
    opts = opts || {};
    var days = Number(opts.days) || 0;
    var since = opts.since ? new Date(opts.since) : null;

    /* The window asked for is DOUBLE what the board shows: the front half only
       exists to give the deltas a baseline. The day series therefore spans the
       whole thing, but every ranked list is cut to the back half, or the board
       reports a top country larger than its own page-view total — which is how
       you know a dashboard is adding up two different periods. */
    var mid = (since && days > 1)
      ? new Date(since.getTime() + Math.floor(days / 2) * 864e5)
      : null;

    var byDay = new Map();
    if (since && days) {
      for (var i = 0; i < days; i++) {
        var cur = new Date(since.getTime() + i * 864e5);
        byDay.set(localDay(cur), { day: localDay(cur), page_views: 0, devices: new Set(), sessions: new Set() });
      }
    }

    var pages = new Map(), refs = new Map(), countries = new Map(), nets = new Map();
    var visitors = new Set(), sessions = new Set(), rtts = [];
    var views = 0;

    var bump = function (map, key) { if (key) map.set(key, (map.get(key) || 0) + 1); };

    rows.forEach(function (r) {
      /* public.events carries is_bot precisely so a crawler is not counted as
         an audience. A traffic number that quietly includes them is worse than
         no number, because it reads as real. */
      if (r.is_bot === true) return;

      var shown = !mid || new Date(r.at) >= mid;
      var key = localDay(r.at);
      var bucket = byDay.get(key);
      /* A row outside the filled axis is still counted in the totals but has
         no column to sit in; that only happens at the window edges. */
      if (!bucket && !since) {
        bucket = { day: key, page_views: 0, devices: new Set(), sessions: new Set() };
        byDay.set(key, bucket);
      }
      if (r.device_id) { visitors.add(r.device_id); if (bucket) bucket.devices.add(r.device_id); }
      if (r.session_id) { sessions.add(r.session_id); if (bucket) bucket.sessions.add(r.session_id); }

      var rtt = Number(r.edge && r.edge["cf-client-tcp-rtt"]);
      if (shown && isFinite(rtt) && rtt >= 0) rtts.push(rtt);

      if (r.name !== "page_view") return;
      views += 1;
      if (bucket) bucket.page_views += 1;
      if (!shown) return;

      /* Ranked on page views, not on every event. Counting clicks here too
         would make the country list outrun the chart above it. */
      bump(pages, r.path || "/");
      bump(countries, r.country);
      bump(nets, (r.device && r.device.network && r.device.network.effective) || r.asn_org);

      /* A referrer from this site is navigation, not acquisition. Only somebody
         else's hostname answers "where did they come from". */
      var ref = String(r.referrer || "").trim();
      if (!ref) { bump(refs, "direct"); return; }
      try {
        var host = new URL(ref).hostname.replace(/^www\./, "");
        bump(refs, host && host !== location.hostname ? host : "direct");
      } catch (e) { /* an unparseable referrer is not a source */ }
    });

    var top = function (map, keyName, limit) {
      return Array.from(map.entries())
        .sort(function (a, b) { return b[1] - a[1]; })
        .slice(0, limit || 8)
        .map(function (e) { var o = { count: e[1] }; o[keyName] = e[0]; return o; });
    };

    return {
      by_day: Array.from(byDay.values())
        .sort(function (a, b) { return a.day.localeCompare(b.day); })
        .map(function (b) {
          return { day: b.day, page_views: b.page_views, visitors: b.devices.size, sessions: b.sessions.size };
        }),
      page_views: views,
      visitors: visitors.size,
      sessions: sessions.size,
      events: rows.length,
      avg_rtt_ms: rtts.length
        ? Math.round(rtts.reduce(function (a, b) { return a + b; }, 0) / rtts.length)
        : null,
      top_pages: top(pages, "path"),
      top_referrers: top(refs, "source"),
      top_countries: top(countries, "country"),
      top_networks: top(nets, "network"),
      bots_excluded: true,
      row_cap: ROW_CAP,
      truncated: rows.length >= ROW_CAP
    };
  }

  /* ================= MARKS =================
     Hand-drawn SVG rather than a charting library: two series over at most 180
     points needs no dependency. Marks follow the house spec — 2px strokes, a
     recessive grid, an emphasised endpoint, and labels only where they carry
     information. */
  function chart(days, opts) {
    opts = opts || {};
    var id = opts.id || "bdChart";
    var xKey = opts.xKey || "day";
    var series = opts.series || SERIES;
    var labelFor = opts.labelFor || dayLabel;
    if (!days.length) return "";
    /* The right margin is reserved for the endpoint labels, which are the
       thing that stops identity resting on colour. 86 fits the longest of
       them ("Page views") at 11px plus its 8px offset. */
    var W = 820, H = 250, P = { t: 16, r: 86, b: 28, l: 46 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;

    var max = 0;
    days.forEach(function (row) {
      series.forEach(function (s) { max = Math.max(max, Number(row[s.key]) || 0); });
    });
    /* A flat-zero window still needs a scale, or every point lands on the axis
       and all four grid labels read 0. */
    var niceMax = Math.max(4, Math.ceil((max || 1) / 4) * 4);

    var x = function (i) { return P.l + (days.length === 1 ? iw / 2 : (i / (days.length - 1)) * iw); };
    var y = function (v) { return P.t + ih - ((Number(v) || 0) / niceMax) * ih; };

    var svg = [];
    for (var g = 0; g <= 4; g++) {
      var gv = (niceMax / 4) * g, gy = y(gv);
      svg.push('<line x1="' + P.l + '" y1="' + gy + '" x2="' + (W - P.r) + '" y2="' + gy +
        '" stroke="var(--bd-grid)" stroke-width="1"/>');
      svg.push('<text x="' + (P.l - 8) + '" y="' + (gy + 4) + '" text-anchor="end" class="bd-axis">' +
        num(gv) + "</text>");
    }

    series.forEach(function (s) {
      var pts = days.map(function (row, i) { return [x(i), y(row[s.key])]; });
      var line = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
      var base = (P.t + ih).toFixed(1);
      svg.push('<path d="' + line + " L" + pts[pts.length - 1][0].toFixed(1) + " " + base +
        " L" + pts[0][0].toFixed(1) + " " + base + ' Z" fill="' + s.color + '" fill-opacity=".10"/>');
      svg.push('<path d="' + line + '" fill="none" stroke="' + s.color +
        '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
      var last = pts[pts.length - 1];
      svg.push('<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) +
        '" r="4" fill="' + s.color + '" stroke="var(--bd-card)" stroke-width="2"/>');
      /* Direct label at the endpoint: identity never rests on colour. The right
         padding above is reserved for exactly this. */
      svg.push('<text x="' + (last[0] + 8).toFixed(1) + '" y="' + (last[1] + 4).toFixed(1) +
        '" class="bd-mark" fill="' + s.color + '">' + esc(s.label) + "</text>");
    });

    /* First and last date only — a label per point is unreadable at 90 days. */
    svg.push('<text x="' + P.l + '" y="' + (H - 7) + '" class="bd-axis">' + esc(labelFor(days[0][xKey])) + "</text>");
    svg.push('<text x="' + (W - P.r) + '" y="' + (H - 7) + '" text-anchor="end" class="bd-axis">' +
      esc(labelFor(days[days.length - 1][xKey])) + "</text>");

    /* Hover layer: one full-height hit column per day, always wider than the
       mark it stands for. */
    svg.push('<line class="bd-cross" x1="0" y1="' + P.t + '" x2="0" y2="' + (P.t + ih) +
      '" stroke="var(--bd-faint)" stroke-width="1" style="display:none"/>');
    var band = iw / Math.max(1, days.length - 1 || 1);
    days.forEach(function (row, i) {
      svg.push('<rect class="bd-hit" x="' + Math.max(0, x(i) - band / 2).toFixed(1) + '" y="' + P.t +
        '" width="' + band.toFixed(1) + '" height="' + ih + '" fill="transparent" data-i="' + i + '"/>');
    });

    return '<svg id="' + id + '" viewBox="0 0 ' + W + " " + H + '" class="bd-svg" role="img" ' +
      'aria-label="' + esc(opts.label || "Page views and visitors per day") + '">' + svg.join("") + "</svg>";
  }

  function table(days) {
    return '<div class="bd-scroll"><table class="bd-table">' +
      "<caption>Page views and visitors per day</caption>" +
      "<thead><tr><th scope=\"col\">Day</th><th scope=\"col\" class=\"n\">Page views</th>" +
      "<th scope=\"col\" class=\"n\">Visitors</th><th scope=\"col\" class=\"n\">Sessions</th></tr></thead><tbody>" +
      days.slice().reverse().map(function (r) {
        return "<tr><td>" + esc(r.day) + '</td><td class="n">' + (r.page_views || 0) +
          '</td><td class="n">' + (r.visitors || 0) + '</td><td class="n">' + (r.sessions || 0) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function delta(now, before) {
    if (before == null || before === 0) return null;
    return Math.round(((now - before) / before) * 1000) / 10;
  }
  function tile(label, value, pct, why) {
    var foot;
    if (pct === null || pct === undefined) {
      foot = '<span class="bd-delta bd-delta--none">' + esc(why || "no earlier period") + "</span>";
    } else {
      var cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
      var mark = pct > 0 ? "▲" : pct < 0 ? "▼" : "▪";
      foot = '<span class="bd-delta bd-delta--' + cls + '">' + mark + " " +
        Math.abs(pct) + "% vs previous</span>";
    }
    return '<div class="bd-tile"><p class="bd-tile__l">' + esc(label) + "</p>" +
      '<p class="bd-tile__v">' + esc(value) + "</p>" + foot + "</div>";
  }

  function ranked(rows, keyName, emptyWhy) {
    if (!rows || !rows.length) return '<p class="bd-empty">' + esc(emptyWhy) + "</p>";
    var top = rows[0].count || 1;
    return '<ul class="bd-rank">' + rows.map(function (r) {
      var pct = Math.max(2, Math.round(((r.count || 0) / top) * 100));
      return '<li class="bd-rank__row"><span class="bd-rank__bar" style="width:' + pct + '%"></span>' +
        '<span class="bd-rank__k" title="' + esc(r[keyName] || "") + '">' + esc(r[keyName] || "—") + "</span>" +
        '<span class="bd-rank__v">' + num(r.count) + "</span></li>";
    }).join("") + "</ul>";
  }

  /* ================= MOUNT ================= */
  function mount(opts) {
    var rangeHost = opts.rangeHost, boardHost = opts.boardHost;
    if (!rangeHost || !boardHost) return null;

    var state = { range: RANGES[0], model: null, error: null, loading: false, showTable: false, note: "" };
    var seq = 0;

    function paint() {
      if (state.loading && !state.model) {
        boardHost.innerHTML = '<p class="bd-empty" role="status">Reading the collector…</p>';
        return;
      }
      if (state.error) {
        /* Unavailable is not zero, and a board that draws a flat line for a
           failed read is lying. */
        boardHost.innerHTML = '<div class="bd-gap"><b>This did not load.</b><span>' +
          esc(state.error) + "</span></div>";
        return;
      }

      var t = state.model;
      var all = (t && t.by_day) || [];
      if (!t || !all.length) {
        boardHost.innerHTML = '<div class="bd-gap"><b>Nothing to chart yet.</b><span>' +
          esc(state.note || ("The collector answered and has no events in the last " +
            state.range.label + ". That is a real zero, not a failed read.")) + "</span></div>";
        return;
      }

      /* Split the doubled window: the back half is now, the front half is the
         baseline every delta is measured against. */
      var half = Math.floor(all.length / 2);
      var prev = half ? all.slice(0, half) : [];
      var cur = half ? all.slice(half) : all;
      var sum = function (rows, k) {
        return rows.reduce(function (n, r) { return n + (Number(r[k]) || 0); }, 0);
      };

      var views = sum(cur, "page_views"), pViews = sum(prev, "page_views");
      var vis = sum(cur, "visitors"), pVis = sum(prev, "visitors");
      var sess = sum(cur, "sessions"), pSess = sum(prev, "sessions");
      var perVisit = vis ? Math.round((views / vis) * 10) / 10 : null;
      var pPerVisit = pVis ? Math.round((pViews / pVis) * 10) / 10 : null;

      var legend = SERIES.map(function (s) {
        return '<span class="bd-key"><i style="background:' + s.color + '"></i>' + esc(s.label) + "</span>";
      }).join("");

      boardHost.innerHTML =
        '<div class="bd-tiles">' +
          tile("Visitors", num(vis), delta(vis, pVis)) +
          tile("Page views", num(views), delta(views, pViews)) +
          tile("Sessions", num(sess), delta(sess, pSess)) +
          tile("Views per visitor", perVisit == null ? "—" : perVisit,
               perVisit == null ? null : delta(perVisit, pPerVisit)) +
        "</div>" +

        '<section class="bd-card bd-card--hero">' +
          '<header class="bd-card__h">' +
            "<div><h2>Traffic</h2><p class=\"bd-sub\">Per day for the last " + esc(state.range.label) +
              ", bots excluded" +
              (t.truncated ? " · capped at the first " + num(t.row_cap) + " events, so earlier days are short" : "") +
              (state.note ? " · " + esc(state.note) : "") + "</p></div>" +
            '<div class="bd-legend">' + legend +
              '<button class="bd-toggle" type="button" data-bd="table">' +
                (state.showTable ? "Show chart" : "Show table") + "</button></div>" +
          "</header>" +
          (state.showTable ? table(cur) : chart(cur, { id: "bdChart" })) +
          '<div class="bd-tip" hidden></div>' +
        "</section>" +

        '<div class="bd-grid">' +
          '<section class="bd-card"><h3>Top pages</h3>' +
            ranked(t.top_pages, "path", "No page views in this window.") + "</section>" +
          '<section class="bd-card"><h3>Where they came from</h3>' +
            ranked(t.top_referrers, "source", "No page views in this window.") + "</section>" +
          '<section class="bd-card"><h3>Countries</h3>' +
            ranked(t.top_countries, "country", "The edge attached no country to these events.") + "</section>" +
          '<section class="bd-card"><h3>Connection</h3>' +
            ranked(t.top_networks, "network", "No network reported.") +
            (t.avg_rtt_ms == null ? "" : '<p class="bd-foot">Average edge round trip ' +
              t.avg_rtt_ms + " ms</p>") + "</section>" +
        "</div>";

      if (!state.showTable) wireHover(cur);
    }

    function wireHover(days) {
      var svg = boardHost.querySelector(".bd-svg");
      var tip = boardHost.querySelector(".bd-tip");
      var cross = svg && svg.querySelector(".bd-cross");
      if (!svg || !tip) return;

      var hide = function () { tip.hidden = true; if (cross) cross.style.display = "none"; };
      svg.addEventListener("mouseleave", hide);
      svg.addEventListener("blur", hide, true);

      Array.prototype.forEach.call(svg.querySelectorAll(".bd-hit"), function (hit) {
        var show = function () {
          var row = days[Number(hit.getAttribute("data-i"))];
          if (!row) return;
          if (cross) {
            var cx = Number(hit.getAttribute("x")) + Number(hit.getAttribute("width")) / 2;
            cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
            cross.style.display = "";
          }
          /* Sit on the far side of the crosshair, so the tooltip never lands on
             the point being read or on the endpoint labels at the right edge. */
          tip.classList.toggle("bd-tip--left", Number(hit.getAttribute("data-i")) > days.length / 2);
          tip.hidden = false;
          tip.innerHTML = "<b>" + esc(row.day) + "</b>" + SERIES.map(function (s) {
            return '<span><i style="background:' + s.color + '"></i>' + esc(s.label) +
              "<em>" + (row[s.key] || 0) + "</em></span>";
          }).join("") + '<span><i class="bd-key--none"></i>Sessions<em>' + (row.sessions || 0) + "</em></span>";
        };
        hit.addEventListener("mouseenter", show);
        hit.addEventListener("focus", show);
      });
    }

    function load() {
      var mine = ++seq;
      state.loading = true; state.error = null;
      paint();
      /* Ask for double the window so the deltas have a real baseline. */
      Promise.resolve()
        .then(function () { return opts.fetch(state.range.days * 2, state.range); })
        .then(function (out) {
          if (mine !== seq) return;                 // a newer range won
          state.model = out && out.traffic ? out.traffic : out || null;
          state.note = (out && out.note) || "";
          state.loading = false;
          paint();
        })
        .catch(function (e) {
          if (mine !== seq) return;
          state.error = (e && e.message) || "Unknown error.";
          state.loading = false;
          paint();
        });
    }

    rangeHost.innerHTML = RANGES.map(function (r) {
      return '<button class="bd-range' + (r.id === state.range.id ? " is-on" : "") +
        '" type="button" data-range="' + r.id + '" aria-pressed="' +
        (r.id === state.range.id ? "true" : "false") + '">' + esc(r.label) + "</button>";
    }).join("");

    rangeHost.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-range]");
      if (!b) return;
      var found = RANGES.filter(function (r) { return r.id === b.getAttribute("data-range"); })[0];
      if (!found || found.id === state.range.id) return;
      state.range = found;
      Array.prototype.forEach.call(rangeHost.querySelectorAll("[data-range]"), function (x) {
        x.classList.toggle("is-on", x === b);
        x.setAttribute("aria-pressed", x === b ? "true" : "false");
      });
      load();
    });

    boardHost.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest('[data-bd="table"]');
      if (!b) return;
      state.showTable = !state.showTable;
      paint();
    });

    return {
      reload: load,
      days: function () { return state.range.days; }
    };
  }

  w.MCCBoard = {
    rollup: rollup, mount: mount, ranges: RANGES, series: SERIES,
    /* Shared so the Insights screen draws the same marks from the same
       validated hues. One chart implementation, two boards. */
    lineChart: chart, ranked: ranked, num: num, esc: esc, dayLabel: dayLabel
  };
})(window, document);
