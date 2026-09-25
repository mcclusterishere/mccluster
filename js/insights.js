/* ============================================================
   INSIGHTS — the reporting surface over the analytics views.

   WHY THIS SCREEN WAS EMPTY. It had two different authorities deciding
   whether you saw anything, and they did not have to agree:

     the gate   email === "matthew@mccluster.org"   (a string in this file)
     the data   eu_is_admin()                       (RLS on public.events,
                                                     inherited by every view
                                                     through security_invoker)

   When the gate opened and RLS did not, the page rendered in full —
   headings, explanatory copy, CSV buttons — and every panel came back
   with zero rows. No error, no charts, nothing. It even signed off with
   "Read live from the analytics views", which was true and useless.

   And the six reads ran under one Promise.all, so a single failing view
   took down all six panels. v_funnel_daily selects from auth.users,
   which an `authenticated` role cannot read at all, so that failure was
   not hypothetical.

   Both are fixed here. There is ONE authority — the database — asked
   directly, and every panel loads and fails on its own. A panel that
   cannot be read says so; it never reports zero for data it was refused.

   COLOUR. #e5383b and #3f93d2, the same pair the traffic board uses,
   checked with the dataviz validator against this panel surface
   (#121011): lightness band, chroma floor, CVD separation (deutan
   ΔE 22.3, tritan 36.3), normal-vision separation (ΔE 31.7) and contrast
   all pass. The funnel is drawn in ONE hue at varying weight, because
   its steps are magnitudes of a single measure — colouring them by rank
   would say they are four different things.
   ============================================================ */
(function (w, d) {
  "use strict";

  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

  var HUE_A = "#e5383b";      // sessions / magnitude
  var HUE_B = "#3f93d2";      // engaged

  var B = w.MCCBoard || {};
  var el = function (id) { return d.getElementById(id); };
  var esc = B.esc || function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var num = function (n) {
    return (n == null || isNaN(n)) ? "—" : Number(n).toLocaleString();
  };

  function session() {
    try { return JSON.parse(localStorage.getItem("mccdb_session") || "null"); }
    catch (e) { return null; }
  }

  var S = session();
  var DATA = {}, DAYS = 7;
  /* The last answer per panel, so a layout change redraws at the new
     width without asking the database again. */
  var LAST = {};

  function api(path) {
    return fetch(SB + "/rest/v1/" + path, {
      headers: { apikey: KEY, authorization: "Bearer " + (S && S.access_token) }
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var msg = t;
          try { msg = (JSON.parse(t) || {}).message || t; } catch (e) { /* plain text */ }
          throw Object.assign(new Error(msg || ("HTTP " + r.status)), { status: r.status });
        });
      }
      return r.json();
    });
  }

  /* A read function with the window as arguments. The funnel view cannot
     take a date, so it counted all of history on every read and timed out;
     analytics_funnel filters first. */
  function rpc(name, args) {
    return fetch(SB + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: { apikey: KEY, authorization: "Bearer " + (S && S.access_token), "content-type": "application/json" },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var msg = t;
          try { msg = (JSON.parse(t) || {}).message || t; } catch (e) { /* plain text */ }
          throw Object.assign(new Error(msg || ("HTTP " + r.status)), { status: r.status });
        });
      }
      return r.json();
    });
  }

  /* ---------- the gate ----------
     Asked of the database, not of a string in this file. eu_is_admin() is
     the same predicate the RLS policy on public.events uses, so the page
     can no longer open onto data the database will not hand over — nor
     stay shut on data it would. */
  function openTheGate() {
    if (!S || !S.access_token) return Promise.resolve(false);
    return fetch(SB + "/rest/v1/rpc/eu_is_admin", {
      method: "POST",
      headers: { apikey: KEY, authorization: "Bearer " + S.access_token, "content-type": "application/json" },
      body: "{}"
    }).then(function (r) { return r.ok ? r.json() : false; })
      .then(function (v) { return v === true; })
      .catch(function () { return false; });
  }

  /* ---------- CSV. Still here; just no longer the only output. -------- */
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

  /* ---------- how a panel reports having nothing ----------
     Three different situations that all used to render as "0". They are
     not the same thing and a board that conflates them is not reporting,
     it is guessing. */
  function why(err) {
    if (!err) return '<p class="ins__none">Nothing in this range yet. That is a real zero — the view answered and had no rows.</p>';
    var m = String(err.message || "");
    if (err.status === 401 || err.status === 403 || /permission denied|not authorized/i.test(m)) {
      return '<p class="ins__none ins__none--stop"><b>Not readable by this account.</b> ' +
        'The database refused the read, so this panel is blank rather than zero. ' + esc(m) + "</p>";
    }
    if (err.status === 404 || /does not exist|could not find/i.test(m)) {
      return '<p class="ins__none ins__none--stop"><b>That view is missing.</b> ' +
        'The panel is waiting on a migration, not on traffic. ' + esc(m) + "</p>";
    }
    if (/statement timeout|canceling statement/i.test(m) || err.status === 500 && /timeout/i.test(m)) {
      return '<p class="ins__none ins__none--stop"><b>The database gave up on this read.</b> ' +
        'It took longer than the 8 seconds a signed-in read is allowed, so it was cancelled. ' +
        'This is a slow view, not an empty one.</p>';
    }
    return '<p class="ins__none ins__none--stop"><b>This did not load.</b> ' + esc(m) + "</p>";
  }

  function stat(v, label, sub) {
    return '<div class="ins-stat"><b>' + esc(v) + "</b><span>" + esc(label) + "</span>" +
      (sub ? "<em>" + esc(sub) + "</em>" : "") + "</div>";
  }

  /* A horizontal magnitude bar: one hue, weight carrying the value. Used
     wherever the question is "how big", which is most of this screen. */
  function bars(rows, opts) {
    if (!rows.length) return "";
    var top = Math.max.apply(null, rows.map(function (r) { return Number(r.value) || 0; })) || 1;
    return '<ul class="insr">' + rows.map(function (r) {
      var pct = Math.max(1.5, ((Number(r.value) || 0) / top) * 100);
      return '<li class="insr__row">' +
        '<span class="insr__bar" style="width:' + pct.toFixed(1) + "%;background:" + (opts && opts.hue || HUE_A) + '"></span>' +
        '<span class="insr__k" title="' + esc(r.key) + '">' + esc(r.key) + "</span>" +
        /* Always emitted, even empty: the qualifier is its own grid column,
           and a row that omits it collapses that column to zero width, which
           knocks every value in the list out of alignment with its neighbours. */
        '<span class="insr__n">' + esc(r.note || "") + "</span>" +
        '<span class="insr__v">' + esc(r.display == null ? num(r.value) : r.display) + "</span></li>";
    }).join("") + "</ul>";
  }

  function legend(items) {
    return '<p class="ins-legend">' + items.map(function (s) {
      return '<span><i style="background:' + s.color + '"></i>' + esc(s.label) + "</span>";
    }).join("") + "</p>";
  }

  /* ---------- panels ---------------------------------------------- */
  function paintEngagement(rows, err) {
    if (err) { el("insHero").innerHTML = why(err); el("insTrend").innerHTML = ""; return; }
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

    el("insHero").innerHTML = rows.length
      ? stat(num(t.people), "people") + stat(num(t.sessions), "sessions") +
        stat(rate + "%", "engaged", t.sessions ? num(t.engaged) + " sessions" : "") +
        stat(secs + "s", "avg time on site")
      : why(null);

    if (!rows.length || !B.lineChart) { el("insTrend").innerHTML = ""; return; }
    /* The view hands these back newest first; a time axis runs the other way. */
    line("insTrend", rows.slice().reverse(), [
      { key: "sessions", label: "Sessions", color: HUE_A },
      { key: "engaged_sessions", label: "Engaged", color: HUE_B }
    ], "Sessions and engaged sessions per day");
    paintQuality(rows);
  }

  /* ---------- drawing ----------------------------------------------
     Every chart is drawn at the width its host is shown at (see
     js/analytics-charts.js), with a tooltip that works on tap. */
  var C = w.MCCCharts || {};
  function tipRow(color, label, value) {
    return '<span><i style="background:' + color + '"></i>' + esc(label) + "<em>" + esc(value) + "</em></span>";
  }
  function line(id, rows, series, label) {
    var host = el(id);
    if (!host || !B.lineChart) return;
    host.innerHTML = legend(series) + '<div class="an-chart">' + B.lineChart(rows, {
      id: id + "Svg", xKey: "day", series: series, label: label,
      width: C.widthOf ? C.widthOf(host) : 340,
      labelFor: function (v) { return String(v).slice(5); }
    }) + "</div>";
    if (C.wireTips) C.wireTips(host.querySelector(".an-chart"), rows, function (r) {
      return "<b>" + esc(r.day) + "</b>" + series.map(function (sr) {
        return tipRow(sr.color, sr.label, num(r[sr.key]));
      }).join("");
    });
  }
  function cols(id, rows, opts, tip) {
    var host = el(id);
    if (!host || !C.columns) return;
    opts.width = C.widthOf(host);
    host.innerHTML = '<div class="an-chart">' + C.columns(rows, opts) + "</div>";
    C.wireTips(host.querySelector(".an-chart"), rows, tip);
  }

  /* Friction per day, from the same engagement rows: when the site
     frustrated people, and when it broke. */
  function paintQuality(rows) {
    var host = el("insQuality");
    if (!host) return;
    if (!rows || !rows.length) { host.innerHTML = why(null); return; }
    line("insQuality", rows.slice().reverse(), [
      { key: "rage_clicks", label: "Rage clicks", color: HUE_A },
      { key: "errors", label: "Errors", color: HUE_B }
    ], "Rage clicks and errors per day");
  }

  function paintFunnel(rows, err) {
    var host = el("insFunnel");
    if (err) { host.innerHTML = why(err); return; }
    DATA.funnel = rows;
    if (!rows.length) { host.innerHTML = why(null); return; }

    var steps = [
      ["arrived", "Arrived"], ["heard_something", "Heard something"],
      ["engaged", "Did something"], ["searched", "Searched"],
      ["asked_for_something", "Asked for something"],
      ["made_an_account", "Made an account"], ["confirmed_the_email", "Confirmed the email"],
      ["reached_checkout", "Reached checkout"], ["paid", "Paid"]
    ];
    var t = rows.reduce(function (a, r) {
      steps.forEach(function (s) { a[s[0]] = (a[s[0]] || 0) + (Number(r[s[0]]) || 0); });
      return a;
    }, {});
    var top = t.arrived || 1;
    /* One hue throughout. These are nine magnitudes of one measure, not
       nine categories, so rank must not be painted as identity. */
    host.innerHTML = bars(steps.map(function (s, i) {
      var v = t[s[0]] || 0;
      var prev = i ? (t[steps[i - 1][0]] || 0) : null;
      var drop = (prev && prev > v) ? ("−" + Math.round(((prev - v) / prev) * 100) + "% from above") : "";
      return {
        key: s[1], value: v,
        display: num(v) + " · " + (Math.round((v / top) * 1000) / 10) + "%",
        note: drop
      };
    }), { hue: HUE_A });
  }

  function paintSticky(rows, err) {
    var host = el("insSticky");
    if (err) { host.innerHTML = why(err); return; }
    DATA.stickiness = rows;
    var r = rows[0];
    if (!r) { host.innerHTML = why(null); return; }
    host.innerHTML =
      stat(num(r.dau), "today") + stat(num(r.wau), "this week") + stat(num(r.mau), "this month") +
      stat(r.dau_over_mau + "%", "come back daily");
    /* The honesty that makes the number usable: with four days of
       history "this month" is not a month, and 5% reads like churn when
       it is really youth. The view carries the window so this can say so. */
    var trend = el("insStickyTrend");
    if (trend) {
      if (rows.length > 1) line("insStickyTrend", rows.slice().reverse(), [
        { key: "dau", label: "Daily", color: HUE_A },
        { key: "mau", label: "Monthly", color: HUE_B }
      ], "Daily and monthly active people");
      else trend.innerHTML = "";
    }
    if (r.window_is_full === false) {
      var n = el("insStickyNote");
      n.hidden = false;
      n.textContent = "Only " + r.days_observed + " days of history so far, so “this month” " +
        "is really “these " + r.days_observed + " days” and the daily-return figure is not " +
        "comparable to a mature one yet. It becomes meaningful at 30 days.";
    }
  }

  function paintAcquisition(rows, err) {
    var host = el("insAcq");
    if (err) { host.innerHTML = why(err); return; }
    DATA.acquisition = rows;
    if (!rows.length) { host.innerHTML = why(null); return; }
    host.innerHTML = bars(rows.map(function (r) {
      return {
        key: String(r.source).replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 42),
        value: Number(r.people) || 0,
        display: num(r.people),
        note: r.engagement_rate + "% engaged · " + r.avg_seconds + "s"
      };
    }), { hue: HUE_B });
  }

  function paintContent(rows, err) {
    var host = el("insContent");
    if (err) { host.innerHTML = why(err); return; }
    DATA.content = rows;
    if (!rows.length) { host.innerHTML = why(null); return; }
    host.innerHTML = bars(rows.map(function (r) {
      return {
        key: r.track, value: Number(r.listeners) || 0, display: num(r.listeners),
        note: num(r.plays) + " plays · " + r.plays_per_listener + " each · " +
              num(r.repeat_listeners) + " came back"
      };
    }), { hue: HUE_A });
  }

  function paintPaths(rows, err) {
    var host = el("insPaths");
    if (err) { host.innerHTML = why(err); return; }
    DATA.paths = rows;
    if (!rows.length) { host.innerHTML = why(null); return; }
    /* Pairs, so a bar per pair reads better than a table of three columns. */
    host.innerHTML = bars(rows.map(function (r) {
      return {
        key: r.from_page + "  →  " + r.to_page,
        value: Number(r.moves) || 0, display: num(r.moves),
        note: num(r.sessions) + " sessions"
      };
    }), { hue: HUE_B });
  }

  function paintCohort(rows, err) {
    var host = el("insCohort");
    if (!host) return;
    if (err) { host.innerHTML = why(err); return; }
    DATA.retention = rows;
    host.innerHTML = rows.length ? (C.retention ? C.retention(rows) : "") : why(null);
  }

  function paintVisitors(rows, err) {
    var stats = el("insVisitors"), host = el("insPlatforms");
    if (!stats || !host) return;
    if (err) { stats.innerHTML = why(err); host.innerHTML = ""; return; }
    var people = rows.filter(function (r) { return !r.is_bot; });
    DATA.visitors = people;
    if (!people.length) { stats.innerHTML = why(null); host.innerHTML = ""; return; }
    var back = people.filter(function (r) { return (Number(r.sessions) || 0) > 1; }).length;
    var acct = people.filter(function (r) { return r.has_account; }).length;
    stats.innerHTML = stat(num(people.length), "visitors") +
      stat(Math.round((back / people.length) * 100) + "%", "came back", num(back) + " people") +
      stat(num(acct), "have an account");
    var by = {};
    people.forEach(function (r) { var k = r.platform || "Unknown"; by[k] = (by[k] || 0) + 1; });
    host.innerHTML = bars(Object.keys(by).map(function (k) {
      return { key: k, value: by[k], display: num(by[k]),
        note: Math.round((by[k] / people.length) * 100) + "%" };
    }).sort(function (x, y) { return y.value - x.value; }).slice(0, 8), { hue: HUE_B });
  }

  function paintLive(rows, err) {
    var host = el("insLive");
    if (!host) return;
    if (err) { host.innerHTML = why(err); return; }
    DATA.live = rows;
    var ago = function (t) {
      var sec = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 1000));
      return sec < 60 ? sec + "s ago" : Math.round(sec / 60) + "m ago";
    };
    host.innerHTML = '<div class="an-now"><b>' + num(rows.length) + "</b><span>" +
      (rows.length === 1 ? "person on the site right now" : "people on the site right now") + "</span></div>" +
      (rows.length ? '<ul class="an-live">' + rows.map(function (r) {
        var where = [r.city, r.country].filter(Boolean).join(", ") || "Location not reported";
        return '<li><b>' + esc(r.on_page || "—") + "</b><span>" + esc(where) + " · " + num(r.events) +
          " events · " + esc(ago(r.last_seen)) + "</span></li>";
      }).join("") + "</ul>" : '<p class="ins__none">Nobody right now. That is a live read, not a failure.</p>');
  }

  /* Sessions per hour for the last 48 hours, bucketed in the reader's own
     timezone, bots excluded. The YouTube Studio realtime pattern. */
  function paintHourly(rows, err) {
    var host = el("insHourly");
    if (!host) return;
    if (err) { host.innerHTML = why(err); return; }
    var now = new Date(); now.setMinutes(0, 0, 0);
    var start = now.getTime() - 47 * 36e5;
    var buckets = [];
    for (var i = 0; i < 48; i++) {
      var t = new Date(start + i * 36e5);
      buckets.push({ key: t.toISOString(), hour: t, value: 0 });
    }
    rows.forEach(function (r) {
      if (r.is_bot) return;
      var idx = Math.floor((new Date(r.started).getTime() - start) / 36e5);
      if (idx >= 0 && idx < 48) buckets[idx].value += 1;
    });
    DATA.hourly = buckets.map(function (b) { return { hour: b.key, sessions: b.value }; });
    var total = buckets.reduce(function (a, b) { return a + b.value; }, 0);
    var label = function (iso) {
      var t = new Date(iso);
      return t.getTime() >= now.getTime() ? "Now" : t.toLocaleString([], { weekday: "short", hour: "numeric" });
    };
    el("insHourlyTotal").innerHTML = stat(num(total), "sessions in 48 hours") +
      stat(num(buckets.slice(-24).reduce(function (a, b) { return a + b.value; }, 0)), "in the last 24");
    cols("insHourly", buckets, { key: "value", xKey: "key", color: HUE_B, labelFor: label,
      label: "Sessions per hour, last 48 hours" }, function (b) {
      return "<b>" + esc(b.hour.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })) + "</b>" +
        tipRow(HUE_B, "Sessions", num(b.value));
    });
  }

  function paintPageHealth(rows, err) {
    var busy = el("insPages"), slow = el("insSlow");
    if (!busy || !slow) return;
    if (err) { busy.innerHTML = why(err); slow.innerHTML = ""; return; }
    DATA.pages = rows;
    if (!rows.length) { busy.innerHTML = why(null); slow.innerHTML = ""; return; }
    busy.innerHTML = bars(rows.slice(0, 12).map(function (r) {
      return { key: r.path, value: Number(r.page_views) || 0, display: num(r.page_views),
        note: Math.round(Number(r.avg_seconds) || 0) + "s avg · " + num(r.rage_clicks) + " rage · " + num(r.errors) + " errors" };
    }), { hue: HUE_B });
    /* Slowest by 75th-percentile largest paint, among pages with enough
       views for the percentile to mean something. */
    var measured = rows.filter(function (r) { return r.lcp_p75_ms != null && (Number(r.page_views) || 0) >= 20; })
      .sort(function (a, b) { return b.lcp_p75_ms - a.lcp_p75_ms; }).slice(0, 8);
    slow.innerHTML = measured.length ? bars(measured.map(function (r) {
      return { key: r.path, value: Number(r.lcp_p75_ms) || 0, display: num(r.lcp_p75_ms) + " ms",
        note: "server " + num(r.ttfb_p75_ms) + " ms" };
    }), { hue: HUE_A }) : '<p class="ins__none">No page has 20 measured views yet.</p>';
  }

  function paintFriction(rows, err) {
    var host = el("insFriction");
    if (!host) return;
    if (err) { host.innerHTML = why(err); return; }
    DATA.friction = rows;
    if (!rows.length) { host.innerHTML = why(null); return; }
    host.innerHTML = bars(rows.map(function (r) {
      return { key: (r.label ? "“" + r.label + "” " : "") + (r.element || "") + " · " + r.path,
        value: Number(r.hits) || 0, display: num(r.hits),
        note: String(r.kind || "").replace(/_/g, " ") + " · " + num(r.sessions) + " sessions" };
    }), { hue: HUE_A });
  }

  function paintSignals(rows, err) {
    var host = el("insSignals");
    if (!host) return;
    if (err) { host.innerHTML = why(err); return; }
    DATA.signals = rows;
    if (!rows.length) { host.innerHTML = why(null); return; }
    host.innerHTML = bars(rows.map(function (r) {
      return { key: r.track_key, value: Number(r.momentum_score) || 0,
        display: num(r.momentum_score),
        note: "keep " + num(r.keep_score) + (r.deep_cut ? " · deep cut" : "") };
    }), { hue: HUE_B });
  }

  function paintUnmapped(rows, err) {
    var host = el("insUnmapped");
    if (!host) return;
    if (err) { host.innerHTML = why(err); return; }
    DATA.unmapped = rows;
    if (!rows.length) { host.innerHTML = '<p class="ins__none">Every event name has a stage. Nothing to map.</p>'; return; }
    host.innerHTML = bars(rows.map(function (r) {
      return { key: r.name, value: Number(r.hits) || 0, display: num(r.hits) };
    }), { hue: HUE_B });
  }

  /* ---------- load ------------------------------------------------- */
  function load() {
    var since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
    var q = "&day=gte." + since;
    var jobs = [
      ["engagement", "v_engagement_daily?select=*" + q + "&order=day.desc", paintEngagement],
      ["funnel", function () {
        return rpc("analytics_funnel", { p_since: new Date(since + "T00:00:00").toISOString() });
      }, paintFunnel],
      ["stickiness", "v_stickiness?select=*&order=day.desc&limit=30", paintSticky],
      ["retention", "v_cohort_retention?select=*&order=cohort_week.asc,weeks_later.asc&limit=400", paintCohort],
      ["visitors", "v_visitors?select=platform,sessions,has_account,is_bot&limit=10000", paintVisitors],
      ["live", "v_live?select=session_id,last_seen,on_page,city,country,events&order=last_seen.desc&limit=25", paintLive],
      ["hourly", "v_sessions?select=started,is_bot&started=gte." + new Date(Date.now() - 48 * 36e5).toISOString() + "&limit=10000", paintHourly],
      ["pages", "v_page_health?select=path,page_views,avg_seconds,rage_clicks,dead_clicks,errors,lcp_p75_ms,ttfb_p75_ms&order=page_views.desc.nullslast&limit=60", paintPageHealth],
      ["friction", "v_friction?select=path,element,label,kind,hits,sessions&order=hits.desc&limit=15", paintFriction],
      ["signals", "v_track_signals?select=track_key,keep_score,momentum_score,momentum_rank,deep_cut&order=momentum_rank.asc&limit=15", paintSignals],
      ["unmapped", "v_event_taxonomy_unmapped?select=name,hits,last_seen&order=hits.desc&limit=15", paintUnmapped],
      ["acquisition", "v_acquisition_quality?select=*&order=sessions.desc&limit=12", paintAcquisition],
      ["content", "v_content_performance?select=*&order=listeners.desc&limit=15", paintContent],
      ["paths", "v_paths?select=*&order=moves.desc&limit=12", paintPaths]
    ];

    el("insStamp").textContent = "Reading the analytics views…";

    /* allSettled, not all. One view the caller cannot read is one blank
       panel that says why — not six blank panels that say nothing. */
    return Promise.allSettled(jobs.map(function (j) { return typeof j[1] === "function" ? j[1]() : api(j[1]); }))
      .then(function (out) {
        var failed = 0;
        out.forEach(function (res, i) {
          var rows = res.status === "fulfilled" ? (res.value || []) : [];
          var err = res.status === "fulfilled" ? null : (res.reason || new Error("failed"));
          if (err) failed++;
          LAST[jobs[i][0]] = [jobs[i][2], rows, err];
          jobs[i][2](rows, err);
        });
        var stamp = el("insStamp");
        if (stamp) stamp.textContent = failed
          ? failed + " of " + jobs.length + " panels could not be read · " + new Date().toLocaleString()
          : "Read live from the analytics views · " + new Date().toLocaleString();
      });
  }

  /* ---------- boot ----------------------------------------------------
     THESE PANELS LIVE ON THE ANALYTICS PAGE NOW.

     Insights and Analytics were two screens reading the same events and
     asking the reader to hold both in their head. There is one board: the
     traffic half reads public.events directly, these panels read the views
     over it, and they share ONE range control rather than growing a second
     one that can disagree with the first. The board owns the buttons and
     broadcasts; this listens. */
  function shut(msg) {
    ["insHero", "insFunnel", "insSticky", "insAcq", "insContent", "insPaths", "insCohort", "insVisitors",
     "insLive", "insHourly", "insPages", "insFriction", "insSignals", "insUnmapped", "insQuality"].forEach(function (id) {
      var host = el(id);
      if (host) host.innerHTML = '<p class="ins__none ins__none--stop"><b>Desk only.</b> ' + esc(msg) + "</p>";
    });
    var t = el("insTrend"); if (t) t.innerHTML = "";
    var st = el("insStamp"); if (st) st.textContent = "";
  }

  if (el("insHero")) {
    d.addEventListener("mcc:layout", function () {
      Object.keys(LAST).forEach(function (k) { LAST[k][0](LAST[k][1], LAST[k][2]); });
    });
    d.addEventListener("mcc:range", function (e) {
      var n = e && e.detail && Number(e.detail.days);
      /* All time arrives as 0. These panels read the identity-era views,
         which begin on 19 Sep 2026, so all time is simply everything. */
      if (e && e.detail && e.detail.id === "all") n = 3650;
      if (!n || n === DAYS) return;
      DAYS = n;
      load();
    });

    openTheGate().then(function (allowed) {
      if (!allowed) {
        shut("These read the analytics views directly, so they open only for an " +
             "account the database recognises as the desk.");
        return;
      }
      var gate = el("insGate"); if (gate) gate.hidden = true;
      var app = el("insApp"); if (app) app.hidden = false;
      load();
    });
  }
})(window, document);
