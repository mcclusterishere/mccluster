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
  var DATA = {}, ALLOWED = false, SITE_ID = null;
  var RANGE = (function () {
    var now = new Date(), since = new Date();
    since.setHours(0,0,0,0); since.setDate(since.getDate() - 6);
    return { id:"7d", label:"7 days", mode:"fixed", days:7,
      since:since.toISOString(), until:now.toISOString(), query_since:since.toISOString() };
  })();

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

  function rpc(name, body) {
    return fetch(SB + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        apikey: KEY,
        authorization: "Bearer " + (S && S.access_token),
        "content-type": "application/json"
      },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var msg = t;
          try { msg = (JSON.parse(t) || {}).message || t; } catch (e) {}
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
    var funnelRows = steps.map(function (s, i) {
      var v = t[s[0]] || 0;
      var prev = i ? (t[steps[i - 1][0]] || 0) : null;
      var drop = (prev && prev > v) ? ("−" + Math.round(((prev - v) / prev) * 100) + "% from above") : "";
      return {
        key: s[1], value: v,
        display: num(v) + " · " + (Math.round((v / top) * 1000) / 10) + "%",
        note: drop
      };
    });
    host.innerHTML =
      (B.barChart ? B.barChart(funnelRows, {
        label: "People reaching each funnel stage", color: HUE_A, limit: 9
      }) : "") +
      '<div class="ins-chart-detail">' + bars(funnelRows, { hue: HUE_A }) + "</div>";
  }

  function paintSticky(rows, err) {
    var host = el("insSticky");
    if (err) { host.innerHTML = why(err); return; }
    DATA.stickiness = rows;
    var r = rows[0];
    if (!r) { host.innerHTML = why(null); return; }
    var habitRows = [
      { key:"Daily active", value:Number(r.dau)||0 },
      { key:"Weekly active", value:Number(r.wau)||0 },
      { key:"Monthly active", value:Number(r.mau)||0 }
    ];
    host.innerHTML =
      stat(num(r.dau), "today") + stat(num(r.wau), "this week") + stat(num(r.mau), "this month") +
      stat(r.dau_over_mau + "%", "come back daily") +
      (B.barChart ? '<div class="ins-chart-block">' + B.barChart(habitRows, {
        label:"Daily, weekly and monthly active people", color:HUE_B, limit:3
      }) + "</div>" : "");
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
    var acquisitionRows = rows.map(function (r) {
      return {
        key: String(r.source).replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 42),
        value: Number(r.people) || 0,
        display: num(r.people),
        note: r.engagement_rate + "% engaged · " + r.avg_seconds + "s"
      };
    });
    host.innerHTML =
      (B.barChart ? B.barChart(acquisitionRows, {
        label:"People by acquisition source", color:HUE_B, limit:10
      }) : "") +
      '<div class="ins-chart-detail">' + bars(acquisitionRows, { hue: HUE_B }) + "</div>";
  }

  function signupByTrack(rows) {
    var out = {};
    (rows||[]).forEach(function (r) {
      if (!r.track) return;
      var k = String(r.track);
      var x = out[k] || (out[k] = { accounts:0, confirmed:0, seconds:0, timed:0 });
      x.accounts++;
      if (r.confirmed_at) x.confirmed++;
      if (r.seconds_before_signup != null) { x.seconds += Number(r.seconds_before_signup)||0; x.timed++; }
    });
    return out;
  }

  function reachRepeatScatter(rows, signupMap) {
    if (!rows.length) return "";
    var pts=rows.slice(0,18).map(function(r){
      return {
        track:String(r.track||"—"),
        x:Number(r.listeners)||0,
        y:Number(r.plays_per_listener)||0,
        accounts:(signupMap[r.track]&&signupMap[r.track].accounts)||0
      };
    });
    var W=760,H=310,P={l:48,r:24,t:24,b:44};
    var maxX=Math.max.apply(null,pts.map(function(p){return p.x;}))||1;
    var maxY=Math.max.apply(null,pts.map(function(p){return p.y;}))||1;
    var sx=function(v){return P.l+(v/maxX)*(W-P.l-P.r);};
    var sy=function(v){return H-P.b-(v/maxY)*(H-P.t-P.b);};
    var svg=['<svg viewBox="0 0 '+W+' '+H+'" class="bd-svg ins-scatter" role="img" aria-label="Track reach versus repeat listening">'];
    [0,.25,.5,.75,1].forEach(function(q){
      var y=sy(maxY*q);
      svg.push('<line x1="'+P.l+'" y1="'+y.toFixed(1)+'" x2="'+(W-P.r)+'" y2="'+y.toFixed(1)+'" class="ins-net-grid"/>');
      svg.push('<text x="'+(P.l-7)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" class="bd-axis">'+(maxY*q).toFixed(1)+'×</text>');
    });
    svg.push('<line x1="'+P.l+'" y1="'+(H-P.b)+'" x2="'+(W-P.r)+'" y2="'+(H-P.b)+'" class="ins-net-axis"/>');
    pts.forEach(function(p,i){
      var x=sx(p.x),y=sy(p.y),r=5+Math.min(7,p.accounts*1.5);
      svg.push('<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+r.toFixed(1)+'" class="ins-scatter-dot"><title>'+
        esc(p.track)+': '+num(p.x)+' listeners · '+p.y.toFixed(2)+' starts/listener · '+num(p.accounts)+' attributed accounts</title></circle>');
      if(i<8) svg.push('<text x="'+(x+9).toFixed(1)+'" y="'+(y-8).toFixed(1)+'" class="ins-net-label">'+esc(p.track.slice(0,24))+'</text>');
    });
    svg.push('<text x="'+((P.l+W-P.r)/2)+'" y="'+(H-10)+'" text-anchor="middle" class="bd-axis">Unique listeners →</text>');
    svg.push('</svg>');
    return svg.join("");
  }

  function paintContent(rows, events, err, signups) {
    var host = el("insContent");
    if (err) { host.innerHTML = why(err); return; }
    DATA.content = rows || [];
    DATA.content_events = events || [];
    DATA.signup_attribution = signups || [];
    if (!rows || !rows.length) { host.innerHTML = why(null); paintJourney(); return; }

    var total = function (key) {
      return rows.reduce(function (n, r) { return n + (Number(r[key]) || 0); }, 0);
    };
    var starts = total("starts"), listenerPairs = total("listeners"),
        repeats = total("repeat_listeners"), full = total("full_plays"),
        completes = total("completions"), shares = total("shares");
    var attributed=(signups||[]).filter(function(r){return !!r.track;});
    var confirmed=(signups||[]).filter(function(r){return !!r.confirmed_at;});
    var bySignup=signupByTrack(signups||[]);

    var albums = {};
    rows.forEach(function (r) {
      var key = r.album || "Unassigned";
      var a = albums[key] || (albums[key] = { key:key, starts:0, full:0, completes:0, shares:0 });
      a.starts += Number(r.starts)||0; a.full += Number(r.full_plays)||0;
      a.completes += Number(r.completions)||0; a.shares += Number(r.shares)||0;
    });
    var albumRows = Object.keys(albums).map(function (k) { return albums[k]; })
      .sort(function (a,b) { return b.starts-a.starts; });

    var eventRows = (events||[]).map(function (r) {
      return {
        key: String(r.event_name||"").replace(/_/g," "),
        value: Number(r.events)||0,
        display: num(r.events),
        note: num(r.people)+" people · "+num(r.sessions)+" sessions"
      };
    });

    var tracks = rows.slice().sort(function (a,b) {
      return (Number(b.listeners)||0)-(Number(a.listeners)||0) ||
             (Number(b.starts)||0)-(Number(a.starts)||0);
    });

    var signupTracks=Object.keys(bySignup).map(function(track){
      var s=bySignup[track], match=tracks.find(function(r){return r.track===track;})||{};
      var listeners=Number(match.listeners)||0;
      return {track:track,accounts:s.accounts,confirmed:s.confirmed,
        avg_seconds:s.timed?Math.round(s.seconds/s.timed):null,
        conversion:listeners?Math.round((s.accounts/listeners)*1000)/10:null};
    }).sort(function(a,b){return b.accounts-a.accounts||b.confirmed-a.confirmed;});

    host.innerHTML =
      '<div class="ins-stats">' +
        stat(num(starts),"track starts") +
        stat(num(listenerPairs),"listener-track relationships","deduped within each track") +
        stat(num(repeats),"repeat listener-track pairs") +
        stat(num(full),"full plays") +
        stat(num(completes),"completions") +
        stat(num((signups||[]).length),"accounts created",num(attributed.length)+" music-attributed") +
        stat(num(confirmed.length),"email-confirmed accounts") +
      '</div>' +
      '<div class="an-grid" style="margin-top:1rem">' +
        '<section class="an-panel an-wide"><h3>Reach vs repeat listening</h3>'+
          '<p class="bd-sub">Each dot is a track. Right means more unique listeners; higher means more starts per listener. Larger dots mean more attributed account creations.</p>'+
          '<div class="ins-network-scroll">'+reachRepeatScatter(tracks,bySignup)+'</div>'+
        '</section>' +
        '<section class="an-panel"><h3>Albums / collections</h3>' +
          bars(albumRows.map(function (a) {
            return {key:a.key,value:a.starts,display:num(a.starts),
              note:num(a.full)+" full · "+num(a.completes)+" complete · "+num(a.shares)+" shares"};
          }),{hue:HUE_B}) +
        '</section>' +
        '<section class="an-panel"><h3>Media event mix</h3>' +
          (eventRows.length
            ? ((B.barChart ? B.barChart(eventRows, {
                label:"Media events in the selected range", color:HUE_A, limit:12
              }) : "") + bars(eventRows,{hue:HUE_A}))
            : why(null)) +
        '</section>' +
        '<section class="an-panel an-wide"><h3>Accounts attributed to music</h3>'+
          ((signups||[]).length
            ? '<p class="bd-sub">Last-touch attribution: same-session music wins; otherwise the last real music event on the same device within 24 hours. This measures influence, not proof that a song caused the signup.</p>'+
              '<div class="bd-scroll"><table class="bd-table"><thead><tr><th>Track</th><th class="n">Accounts</th><th class="n">Confirmed</th><th class="n">Listen → account</th><th>Avg. time to signup</th></tr></thead><tbody>'+
              (signupTracks.length?signupTracks.map(function(r){
                return '<tr><td><b>'+esc(r.track)+'</b></td><td class="n">'+num(r.accounts)+'</td><td class="n">'+num(r.confirmed)+
                  '</td><td class="n">'+esc(r.conversion==null?"—":r.conversion+"%")+'</td><td>'+
                  esc(r.avg_seconds==null?"—":(r.avg_seconds<60?r.avg_seconds+"s":Math.round(r.avg_seconds/60)+"m"))+'</td></tr>';
              }).join(""):'<tr><td colspan="5">No signup in this range has a verified pre-signup music touch yet.</td></tr>')+
              '</tbody></table></div>'+
              '<p class="bd-foot">'+num(attributed.length)+' of '+num((signups||[]).length)+' accounts in this range have a verified music touch. Attribution starts when the signup-context instrument ships; older accounts cannot be reconstructed reliably.</p>'
            : '<p class="bd-empty">No account creations in this range, or this is not the first-party property.</p>')+
        '</section>' +
      '</div>' +
      '<div class="bd-scroll" style="margin-top:1rem"><table class="bd-table">' +
        '<caption>Track performance for '+esc(RANGE.label||"selected range")+'</caption>' +
        '<thead><tr><th>Track</th><th>Album</th><th class="n">Starts</th>' +
        '<th class="n">Listeners</th><th class="n">Repeat</th><th class="n">Starts/listener</th>' +
        '<th class="n">Full</th><th class="n">Complete</th><th class="n">Shares</th><th class="n">Accounts</th><th>First</th><th>Last</th></tr></thead><tbody>' +
        tracks.map(function (r) {
          var first=r.first_heard?new Date(r.first_heard).toLocaleDateString():"—";
          var last=r.last_heard?new Date(r.last_heard).toLocaleDateString():"—";
          var s=bySignup[r.track]||{accounts:0};
          return '<tr><td><b>'+esc(r.track||"—")+'</b></td><td>'+esc(r.album||"—")+'</td>' +
            '<td class="n">'+num(r.starts)+'</td><td class="n">'+num(r.listeners)+'</td>' +
            '<td class="n">'+num(r.repeat_listeners)+'</td><td class="n">'+
            esc(r.plays_per_listener==null?"—":r.plays_per_listener)+'</td>' +
            '<td class="n">'+num(r.full_plays)+'</td><td class="n">'+num(r.completions)+'</td><td class="n">'+num(r.shares)+'</td>' +
            '<td class="n">'+num(s.accounts)+'</td><td>'+esc(first)+'</td><td>'+esc(last)+'</td></tr>';
        }).join("") +
        '</tbody></table></div>' +
      '<p class="bd-foot">Legacy album plays and newer player events are normalized into one selected-window report. Account attribution is based on a real matched pre-signup event, never on account metadata alone.</p>';
    paintJourney();
  }

  function journeyGraph(edgeRows, signupRows) {
    var edges=(edgeRows||[]).map(function(e){return Object.assign({},e);});
    var signup=signupByTrack(signupRows||[]);
    Object.keys(signup).forEach(function(track){
      edges.push({from_type:"track",from_key:track,to_type:"outcome",to_key:"Account created",
        people:signup[track].accounts,sessions:signup[track].accounts});
    });
    if(!edges.length)return "";

    var types=["source","page","track","outcome"], caps={source:6,page:8,track:10,outcome:2};
    var weights={};
    edges.forEach(function(e){
      [[e.from_type,e.from_key],[e.to_type,e.to_key]].forEach(function(n){
        var k=n[0]+"|"+n[1]; weights[k]=(weights[k]||0)+(Number(e.sessions)||Number(e.people)||0);
      });
    });
    var selected={};
    types.forEach(function(t){
      selected[t]=Object.keys(weights).filter(function(k){return k.indexOf(t+"|")===0;})
        .sort(function(a,b){return weights[b]-weights[a];}).slice(0,caps[t]||8)
        .map(function(k){return k.slice(t.length+1);});
    });
    edges=edges.filter(function(e){
      return selected[e.from_type]&&selected[e.from_type].indexOf(e.from_key)>=0 &&
        selected[e.to_type]&&selected[e.to_type].indexOf(e.to_key)>=0;
    });
    var maxRows=Math.max.apply(null,types.map(function(t){return selected[t].length||1;}));
    var W=940,H=Math.max(360,80+maxRows*54),xs={source:90,page:330,track:590,outcome:850};
    var pos={};
    types.forEach(function(t){
      var arr=selected[t], step=(H-80)/(arr.length+1);
      arr.forEach(function(label,i){pos[t+"|"+label]={x:xs[t],y:50+step*(i+1),type:t,label:label};});
    });
    var maxEdge=Math.max.apply(null,edges.map(function(e){return Number(e.sessions)||Number(e.people)||1;}))||1;
    var svg=['<svg viewBox="0 0 '+W+' '+H+'" class="ins-network" role="img" aria-label="Source, page, track and account relationship graph">'];
    [210,460,720].forEach(function(x){svg.push('<line x1="'+x+'" y1="28" x2="'+x+'" y2="'+(H-24)+'" class="ins-net-grid"/>');});
    types.forEach(function(t){
      svg.push('<text x="'+xs[t]+'" y="22" text-anchor="middle" class="ins-net-head">'+esc(t==="outcome"?"Outcome":t.charAt(0).toUpperCase()+t.slice(1))+'</text>');
    });
    edges.forEach(function(e){
      var a=pos[e.from_type+"|"+e.from_key],b=pos[e.to_type+"|"+e.to_key];
      if(!a||!b)return;
      var n=Number(e.sessions)||Number(e.people)||1,w=1.1+5*Math.sqrt(n/maxEdge);
      svg.push('<path d="M'+(a.x+72)+' '+a.y+' C '+(a.x+135)+' '+a.y+', '+(b.x-135)+' '+b.y+', '+(b.x-72)+' '+b.y+
        '" fill="none" class="ins-net-edge" stroke-width="'+w.toFixed(2)+'"><title>'+esc(e.from_key)+' → '+esc(e.to_key)+
        ': '+num(e.people)+' people · '+num(e.sessions)+' sessions</title></path>');
    });
    Object.keys(pos).forEach(function(k){
      var n=pos[k],label=n.label.length>26?n.label.slice(0,25)+"…":n.label;
      svg.push('<g class="ins-net-node"><rect x="'+(n.x-72)+'" y="'+(n.y-17)+'" width="144" height="34" rx="9"></rect>'+
        '<text x="'+n.x+'" y="'+(n.y+4)+'" text-anchor="middle">'+esc(label)+'</text><title>'+esc(n.label)+'</title></g>');
    });
    svg.push('</svg>');
    return '<div class="ins-network-scroll">'+svg.join("")+'</div>';
  }

  function paintJourney() {
    var host=el("insPaths"); if(!host)return;
    var rows=DATA.paths||[], signups=DATA.signup_attribution||[];
    if(!rows.length&&!signups.length){host.innerHTML=why(null);return;}
    var all=rows.slice();
    var sb=signupByTrack(signups);
    Object.keys(sb).forEach(function(track){
      all.push({from_type:"track",from_key:track,to_type:"outcome",to_key:"Account created",
        people:sb[track].accounts,sessions:sb[track].accounts});
    });
    host.innerHTML=journeyGraph(rows,signups)+
      '<div class="bd-scroll ins-chart-detail"><table class="bd-table"><thead><tr><th>From</th><th>Relationship</th><th>To</th><th class="n">People</th><th class="n">Sessions</th></tr></thead><tbody>'+
      all.slice(0,40).map(function(r){return '<tr><td>'+esc(r.from_key)+'</td><td>'+esc(r.from_type+' → '+r.to_type)+
        '</td><td>'+esc(r.to_key)+'</td><td class="n">'+num(r.people)+'</td><td class="n">'+num(r.sessions)+'</td></tr>';}).join("")+
      '</tbody></table></div>';
  }

  function paintPaths(rows, err) {
    var host = el("insPaths");
    if (err) { host.innerHTML = why(err); return; }
    DATA.paths = rows || [];
    paintJourney();
  }

  /* ---------- load ------------------------------------------------- */
  function dayOf(iso) {
    var d = new Date(iso);
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  }
  function rangeArgs() {
    return { p_since:RANGE.since, p_until:RANGE.until, p_site:SITE_ID };
  }
  function load() {
    if (!ALLOWED) return Promise.resolve();
    var from = dayOf(RANGE.since);
    var throughDate = new Date(new Date(RANGE.until).getTime() - 1);
    var through = dayOf(throughDate);
    var q = "&day=gte." + encodeURIComponent(from) + "&day=lte." + encodeURIComponent(through);
    var args = rangeArgs();
    var jobs = [
      ["engagement", "v_engagement_daily?select=*" + q + "&order=day.desc", null, paintEngagement],
      ["funnel", null, ["analytics_funnel",{p_since:RANGE.since,p_until:RANGE.until}], paintFunnel],
      ["stickiness", "v_stickiness?select=*&day=lte." + encodeURIComponent(through) + "&order=day.desc&limit=1", null, paintSticky],
      ["acquisition", null, ["analytics_acquisition",args], paintAcquisition],
      ["paths", null, ["analytics_relationship_edges",Object.assign({p_limit:40},args)], paintPaths]
    ];

    var stamp=el("insStamp");
    if(stamp) stamp.textContent="Reading "+(RANGE.label||"selected range")+"…";

    var core = Promise.allSettled(jobs.map(function (j) {
      return j[2] ? rpc(j[2][0],j[2][1]) : api(j[1]);
    })).then(function (out) {
      var failed=0;
      out.forEach(function (res,i) {
        if(res.status==="fulfilled") jobs[i][3](res.value||[],null);
        else {failed++;jobs[i][3]([],res.reason||new Error("failed"));}
      });
      return failed;
    });

    var signupRead = SITE_ID===null
      ? rpc("analytics_signup_attribution",{p_since:RANGE.since,p_until:RANGE.until,p_limit:500})
      : Promise.resolve([]);
    var content = Promise.allSettled([
      rpc("analytics_content",args),
      rpc("analytics_content_events",args),
      signupRead
    ]).then(function (out) {
      if(out[0].status==="rejected"){
        paintContent([],[],out[0].reason||new Error("failed"),[]); return 1;
      }
      var eventRows=out[1].status==="fulfilled"?(out[1].value||[]):[];
      var signupRows=out[2].status==="fulfilled"?(out[2].value||[]):[];
      paintContent(out[0].value||[],eventRows,
        out[1].status==="rejected"?out[1].reason:null,signupRows);
      return (out[1].status==="rejected"?1:0)+(out[2].status==="rejected"?1:0);
    });

    return Promise.all([core,content]).then(function (counts) {
      var failed=(counts[0]||0)+(counts[1]||0);
      if(stamp) stamp.textContent=failed
        ? failed+" analytics reads failed · "+(RANGE.label||"selected range")+" · "+new Date().toLocaleString()
        : "Read live · "+(RANGE.label||"selected range")+" · "+new Date().toLocaleString();
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
    ["insHero", "insFunnel", "insSticky", "insAcq", "insContent", "insPaths"].forEach(function (id) {
      var host = el(id);
      if (host) host.innerHTML = '<p class="ins__none ins__none--stop"><b>Desk only.</b> ' + esc(msg) + "</p>";
    });
    var t = el("insTrend"); if (t) t.innerHTML = "";
    var st = el("insStamp"); if (st) st.textContent = "";
  }

  if (el("insHero")) {
    d.addEventListener("mcc:range", function (e) {
      var next=e&&e.detail;
      if(!next||!next.since||!next.until) return;
      RANGE=next;
      load();
    });
    d.addEventListener("mcc:analytics-property", function (e) {
      var detail=e&&e.detail||{};
      SITE_ID=detail.site_id==null?null:detail.site_id;
      if(ALLOWED) load();
    });
    if(w.MCC_ANALYTICS_PROPERTY){
      SITE_ID=w.MCC_ANALYTICS_PROPERTY.site_id==null?null:w.MCC_ANALYTICS_PROPERTY.site_id;
    }

    openTheGate().then(function (allowed) {
      if (!allowed) {
        shut("These read the analytics views directly, so they open only for an " +
             "account the database recognises as the desk.");
        return;
      }
      ALLOWED=true;
      var gate = el("insGate"); if (gate) gate.hidden = true;
      var app = el("insApp"); if (app) app.hidden = false;
      load();
    });
  }
})(window, document);
