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
    var series = [
      { key: "sessions", label: "Sessions", color: HUE_A },
      { key: "engaged_sessions", label: "Engaged", color: HUE_B }
    ];
    el("insTrend").innerHTML = legend(series) +
      B.lineChart(rows.slice().reverse(), {
        id: "insTrendSvg", xKey: "day", series: series,
        label: "Sessions and engaged sessions per day",
        labelFor: function (v) { return String(v).slice(5); }
      });
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

  /* ---------- load ------------------------------------------------- */
  function load() {
    var since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
    var q = "&day=gte." + since;
    var jobs = [
      ["engagement", "v_engagement_daily?select=*" + q + "&order=day.desc", paintEngagement],
      ["funnel", "v_funnel_daily?select=*" + q + "&order=day.desc", paintFunnel],
      ["stickiness", "v_stickiness?select=*&order=day.desc&limit=1", paintSticky],
      ["acquisition", "v_acquisition_quality?select=*&order=sessions.desc&limit=12", paintAcquisition],
      ["content", "v_content_performance?select=*&order=listeners.desc&limit=15", paintContent],
      ["paths", "v_paths?select=*&order=moves.desc&limit=12", paintPaths]
    ];

    el("insStamp").textContent = "Reading the analytics views…";

    /* allSettled, not all. One view the caller cannot read is one blank
       panel that says why — not six blank panels that say nothing. */
    return Promise.allSettled(jobs.map(function (j) { return api(j[1]); }))
      .then(function (out) {
        var failed = 0;
        out.forEach(function (res, i) {
          if (res.status === "fulfilled") jobs[i][2](res.value || [], null);
          else { failed++; jobs[i][2]([], res.reason || new Error("failed")); }
        });
        el("insStamp").textContent = failed
          ? failed + " of " + jobs.length + " panels could not be read · " + new Date().toLocaleString()
          : "Read live from the analytics views · " + new Date().toLocaleString();
      });
  }

  /* ---------- boot -------------------------------------------------- */
  openTheGate().then(function (allowed) {
    if (!allowed) return;                      // the gate card stays as written
    el("insGate").hidden = true;
    el("insApp").hidden = false;

    el("insRange").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-days]");
      if (!b) return;
      DAYS = Number(b.getAttribute("data-days"));
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (x) {
        x.classList.toggle("ins-on", x === b);
        x.setAttribute("aria-pressed", x === b ? "true" : "false");
      });
      load();
    });

    load();
  });
})(window, document);
