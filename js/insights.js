/* ============================================================
   INSIGHTS — the reporting surface over the analytics views.

   Every panel here answers a question the platform could not answer
   yesterday, and every one of them reads a view rather than computing
   anything in the browser: the numbers have to be the same whether you
   look at them here, export them, or query them directly.

   COLOUR. The four series hues are the validated dark steps from the
   dataviz palette, checked with its own validator against this panel
   surface (#121011) rather than chosen by eye: lightness band, chroma
   floor, CVD separation, normal-vision floor and contrast all pass.
   Worst adjacent pair is ΔE 8.4, just over the floor, so every series
   is ALSO direct-labelled — colour never carries identity alone.
   ============================================================ */
(function (w, d) {
  "use strict";

  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var OWNER = "matthew@mccluster.org";

  var SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"];
  var INK = "#f4efe6", FAINT = "rgba(244,239,230,.38)", GRID = "rgba(255,255,255,.10)";

  var el = function (id) { return d.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var num = function (n) { return (n == null || isNaN(n)) ? "—" : Number(n).toLocaleString(); };

  function session() {
    try { return JSON.parse(localStorage.getItem("mccdb_session") || "null"); }
    catch (e) { return null; }
  }
  function email(s) {
    if (s && s.user && s.user.email) return s.user.email;
    try {
      var b = s && s.access_token && s.access_token.split(".")[1];
      if (!b) return "";
      var p = b.replace(/-/g, "+").replace(/_/g, "/");
      while (p.length % 4) p += "=";
      return (JSON.parse(atob(p)) || {}).email || "";
    } catch (e) { return ""; }
  }

  var S = session();
  if (String(email(S)).toLowerCase() !== OWNER) return;   // gate stays shut
  el("insGate").hidden = true;
  el("insApp").hidden = false;

  function api(path) {
    return fetch(SB + "/rest/v1/" + path, {
      headers: { apikey: KEY, authorization: "Bearer " + S.access_token }
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ("HTTP " + r.status)); });
      return r.json();
    });
  }

  var DATA = {}, DAYS = 7;

  /* ---------- CSV. Every panel exports, none of them differently. ---- */
  function csv(rows) {
    if (!rows || !rows.length) return "";
    var cols = Object.keys(rows[0]);
    var cell = function (v) {
      v = v == null ? "" : String(v);
      /* A leading =, + or - makes Excel treat the value as a formula.
         Prefixing an apostrophe is the standard defusal. */
      if (/^[=+\-@]/.test(v)) v = "'" + v;
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    return cols.join(",") + "\n" + rows.map(function (r) {
      return cols.map(function (c) { return cell(r[c]); }).join(",");
    }).join("\n");
  }

  function download(name, rows) {
    var blob = new Blob([csv(rows)], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = d.createElement("a");
    a.href = url; a.download = "mccluster-" + name + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    d.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  d.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-csv]");
    if (!b) return;
    var rows = DATA[b.getAttribute("data-csv")];
    if (rows && rows.length) download(b.getAttribute("data-csv"), rows);
  });

  /* ---------- a line chart, drawn rather than imported ------------- */
  function lineChart(rows, xKey, series) {
    if (!rows.length) return '<p class="panel__why">Nothing in this range yet.</p>';
    var W = 760, H = 220, P = { t: 14, r: 14, b: 26, l: 40 };
    var pts = rows.slice().reverse();
    var maxY = 0;
    pts.forEach(function (r) { series.forEach(function (s) { maxY = Math.max(maxY, Number(r[s.key]) || 0); }); });
    maxY = maxY || 1;
    var x = function (i) { return P.l + (i * (W - P.l - P.r)) / Math.max(1, pts.length - 1); };
    var y = function (v) { return P.t + (H - P.t - P.b) * (1 - (Number(v) || 0) / maxY); };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Trend over time">';
    /* Four gridlines and four labels: every label names a value the
       chart actually reaches. */
    for (var g = 0; g <= 3; g++) {
      var v = (maxY / 3) * g, yy = y(v);
      svg += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + yy + '" y2="' + yy +
             '" stroke="' + GRID + '" stroke-width="1"/>' +
             '<text x="' + (P.l - 7) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="11" fill="' + FAINT + '">' +
             Math.round(v).toLocaleString() + "</text>";
    }
    series.forEach(function (s, si) {
      var dpath = pts.map(function (r, i) { return (i ? "L" : "M") + x(i) + " " + y(r[s.key]); }).join(" ");
      svg += '<path d="' + dpath + '" fill="none" stroke="' + SERIES[si] + '" stroke-width="2" ' +
             'stroke-linejoin="round" stroke-linecap="round"/>';
      pts.forEach(function (r, i) {
        svg += '<circle cx="' + x(i) + '" cy="' + y(r[s.key]) + '" r="3.5" fill="' + SERIES[si] +
               '" stroke="#121011" stroke-width="2"><title>' + esc(r[xKey]) + " · " + esc(s.label) +
               ": " + num(r[s.key]) + "</title></circle>";
      });
      /* Direct label at the last point: identity never rests on colour. */
      var last = pts[pts.length - 1];
      svg += '<text x="' + (x(pts.length - 1) + 6) + '" y="' + (y(last[s.key]) + 4) +
             '" font-size="11" font-weight="700" fill="' + SERIES[si] + '">' + esc(s.label) + "</text>";
    });
    [0, pts.length - 1].forEach(function (i) {
      if (pts[i]) svg += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' +
        (i ? "end" : "start") + '" font-size="11" fill="' + FAINT + '">' + esc(pts[i][xKey]) + "</text>";
    });
    return svg + "</svg>";
  }

  function legend(series) {
    return '<p class="legend">' + series.map(function (s, i) {
      return '<span><i style="background:' + SERIES[i] + '"></i>' + esc(s.label) + "</span>";
    }).join("") + "</p>";
  }

  /* ---------- panels ---------------------------------------------- */
  function paintEngagement(rows) {
    DATA.engagement = rows;
    var t = rows.reduce(function (a, r) {
      a.sessions += Number(r.sessions) || 0;
      a.people += Number(r.people) || 0;
      a.engaged += Number(r.engaged_sessions) || 0;
      return a;
    }, { sessions: 0, people: 0, engaged: 0 });
    var rate = t.sessions ? Math.round((t.engaged / t.sessions) * 1000) / 10 : 0;
    var secs = rows.length ? Math.round(rows.reduce(function (a, r) {
      return a + (Number(r.avg_seconds) || 0); }, 0) / rows.length) : 0;

    el("insHero").innerHTML =
      stat(num(t.people), "people") +
      stat(num(t.sessions), "sessions") +
      stat(rate + "%", "engaged", t.sessions ? num(t.engaged) + " sessions" : "") +
      stat(secs + "s", "avg time on site");

    var series = [{ key: "sessions", label: "sessions" }, { key: "engaged_sessions", label: "engaged" }];
    el("insTrend").innerHTML = legend(series) + lineChart(rows, "day", series);
  }
  function stat(v, label, sub) {
    return '<div class="stat"><b>' + esc(v) + "</b><span>" + esc(label) + "</span>" +
      (sub ? "<em>" + esc(sub) + "</em>" : "") + "</div>";
  }

  function paintFunnel(rows) {
    DATA.funnel = rows;
    var t = rows.reduce(function (a, r) {
      ["arrived", "heard_something", "engaged", "asked_for_something", "made_an_account", "confirmed_the_email"]
        .forEach(function (k) { a[k] = (a[k] || 0) + (Number(r[k]) || 0); });
      return a;
    }, {});
    var steps = [
      ["arrived", "Arrived"], ["heard_something", "Heard something"],
      ["engaged", "Did something"], ["asked_for_something", "Asked for something"],
      ["made_an_account", "Made an account"], ["confirmed_the_email", "Confirmed the email"]
    ];
    var top = t.arrived || 1;
    el("insFunnel").innerHTML = '<table class="tbl"><tr><th>Step</th><th>People</th>' +
      '<th>Of arrivals</th><th></th></tr>' + steps.map(function (s, i) {
        var v = t[s[0]] || 0, pct = Math.round((v / top) * 1000) / 10;
        return "<tr><td>" + esc(s[1]) + '</td><td class="n">' + num(v) + '</td><td class="n">' +
          pct + '%</td><td style="width:38%"><div class="bar"><i style="width:' +
          Math.max(1, pct) + "%;background:" + SERIES[i % 4] + '"></i></div></td></tr>';
      }).join("") + "</table>";
  }

  function paintSticky(rows) {
    DATA.stickiness = rows;
    var r = rows[0];
    if (!r) { el("insSticky").innerHTML = '<p class="panel__why">No data yet.</p>'; return; }
    el("insSticky").innerHTML =
      stat(num(r.dau), "today") + stat(num(r.wau), "this week") + stat(num(r.mau), "this month") +
      stat(r.dau_over_mau + "%", "come back daily");
    /* The honesty that makes the number usable: with four days of
       history "this month" is not a month, and 5% reads like churn when
       it is really youth. The view carries the window so this can say so. */
    if (r.window_is_full === false) {
      var n = el("insStickyNote");
      n.hidden = false;
      n.textContent = "Only " + r.days_observed + " days of history so far, so “this month” " +
        "is really “these " + r.days_observed + " days” and the daily-return figure is not " +
        "comparable to a mature one yet. It becomes meaningful at 30 days.";
    }
  }

  function paintTable(id, key, rows, cols) {
    DATA[key] = rows;
    var host = el(id);
    if (!rows.length) { host.innerHTML = '<p class="panel__why">Nothing here yet.</p>'; return; }
    host.innerHTML = "<tr>" + cols.map(function (c) {
      return "<th" + (c.n ? ' class="n"' : "") + ">" + esc(c.label) + "</th>"; }).join("") + "</tr>" +
      rows.map(function (r) {
        return "<tr>" + cols.map(function (c) {
          return "<td" + (c.n ? ' class="n"' : "") + ">" + esc(c.get ? c.get(r) : r[c.key]) + "</td>";
        }).join("") + "</tr>";
      }).join("");
  }

  /* ---------- load ------------------------------------------------- */
  function load() {
    var since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
    var q = "&day=gte." + since;
    Promise.all([
      api("v_engagement_daily?select=*" + q + "&order=day.desc"),
      api("v_funnel_daily?select=*" + q + "&order=day.desc"),
      api("v_stickiness?select=*&order=day.desc&limit=1"),
      api("v_acquisition_quality?select=*&order=sessions.desc&limit=12"),
      api("v_content_performance?select=*&order=listeners.desc&limit=20"),
      api("v_paths?select=*&order=moves.desc&limit=15")
    ]).then(function (r) {
      paintEngagement(r[0]);
      paintFunnel(r[1]);
      paintSticky(r[2]);
      paintTable("insAcq", "acquisition", r[3], [
        { label: "Source", get: function (x) { return String(x.source).replace(/^https?:\/\//, "").slice(0, 38); } },
        { label: "People", key: "people", n: true },
        { label: "Engaged", n: true, get: function (x) { return x.engagement_rate + "%"; } },
        { label: "Avg", n: true, get: function (x) { return x.avg_seconds + "s"; } }
      ]);
      paintTable("insContent", "content", r[4], [
        { label: "Track", key: "track" },
        { label: "Listeners", key: "listeners", n: true },
        { label: "Plays", key: "plays", n: true },
        { label: "Per listener", key: "plays_per_listener", n: true },
        { label: "Came back", key: "repeat_listeners", n: true }
      ]);
      paintTable("insPaths", "paths", r[5], [
        { label: "From", key: "from_page" },
        { label: "To", key: "to_page" },
        { label: "Moves", key: "moves", n: true }
      ]);
      el("insStamp").textContent = "Read live from the analytics views · " + new Date().toLocaleString();
    }).catch(function (e) {
      el("insStamp").textContent = "Could not load: " + e.message;
    });
  }

  el("insRange").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-days]");
    if (!b) return;
    DAYS = Number(b.getAttribute("data-days"));
    Array.prototype.forEach.call(this.querySelectorAll("button"), function (x) {
      x.classList.toggle("is-on", x === b);
    });
    load();
  });

  load();
})(window, document);
