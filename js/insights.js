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

  /* Different questions need different marks. Rankings can stay bars, but
     retention is a dot plot, stage loss is a funnel, composition is a donut,
     relationships are flows, and reach-vs-repeat is a scatter plot. */
  function lollipop(rows, label) {
    if (!rows.length) return "";
    var W=620,H=Math.max(150,48*rows.length+28), left=150, right=575;
    var top=Math.max.apply(null,rows.map(function(r){return Number(r.value)||0;}))||1;
    var body=rows.map(function(r,i){
      var y=34+i*48, x=left+((Number(r.value)||0)/top)*(right-left);
      return '<g><text class="bd-axis" x="8" y="'+(y+4)+'">'+esc(r.key)+'</text>'+
        '<line class="ins-lollipop-line" x1="'+left+'" y1="'+y+'" x2="'+x+'" y2="'+y+'"/>'+
        '<circle class="ins-lollipop-dot" cx="'+x+'" cy="'+y+'" r="6"/>'+
        '<text class="bd-mark" x="'+Math.min(x+10,right-4)+'" y="'+(y+4)+'">'+esc(num(r.value))+'</text></g>';
    }).join("");
    return '<svg class="bd-svg ins-lollipop" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(label)+'">'+body+'</svg>';
  }

  function funnelView(rows) {
    if(!rows.length)return "";
    var top=Math.max(1,Number(rows[0].value)||0);
    return '<div class="ins-funnel" role="img" aria-label="People moving through the conversion funnel">'+
      rows.map(function(r,i){
        var pct=Math.max(18,((Number(r.value)||0)/top)*100);
        var alpha=Math.max(.22,.88-i*.07);
        return '<div class="ins-funnel__step" style="width:'+pct.toFixed(1)+'%;background:rgba(229,56,59,'+alpha.toFixed(2)+')">'+
          '<span>'+esc(r.key)+'</span><b>'+esc(r.display)+'</b>'+(r.note?'<small>'+esc(r.note)+'</small>':"")+'</div>';
      }).join("")+'</div>';
  }

  function donut(a,b,aLabel,bLabel) {
    a=Number(a)||0;b=Number(b)||0;var total=a+b;
    if(!total)return '<p class="ins__none">No composition to draw in this range.</p>';
    var pa=a/total, c=326.73, da=(c*pa).toFixed(2), db=(c*(1-pa)).toFixed(2);
    return '<div class="ins-donut-wrap"><svg class="ins-donut" viewBox="0 0 140 140" role="img" aria-label="'+
      esc(aLabel+" "+Math.round(pa*100)+" percent, "+bLabel+" "+Math.round((1-pa)*100)+" percent")+'">'+
      '<circle class="ins-donut__track" cx="70" cy="70" r="52"/>'+
      '<circle cx="70" cy="70" r="52" fill="none" stroke="'+HUE_A+'" stroke-width="18" stroke-dasharray="'+da+' '+(c-da)+'" transform="rotate(-90 70 70)"/>'+
      '<circle cx="70" cy="70" r="52" fill="none" stroke="'+HUE_B+'" stroke-width="18" stroke-dasharray="'+db+' '+(c-db)+'" stroke-dashoffset="'+(-Number(da)).toFixed(2)+'" transform="rotate(-90 70 70)"/>'+
      '<text class="ins-donut__big" x="70" y="68" text-anchor="middle">'+esc(num(total))+'</text>'+
      '<text class="ins-donut__small" x="70" y="85" text-anchor="middle">plays</text></svg>'+
      legend([{label:aLabel+" · "+num(a),color:HUE_A},{label:bLabel+" · "+num(b),color:HUE_B}])+'</div>';
  }

  function scatterTracks(rows) {
    var use=(rows||[]).filter(function(r){return Number(r.listeners)>0;}).slice(0,24);
    if(!use.length)return '<p class="ins__none">No listener relationships to plot.</p>';
    var W=660,H=360,l=54,r=22,t=22,b=48;
    var maxX=Math.max.apply(null,use.map(function(x){return Number(x.listeners)||0;}))||1;
    var maxY=Math.max.apply(null,use.map(function(x){return Number(x.repeat_listeners)||0;}))||1;
    var maxS=Math.max.apply(null,use.map(function(x){return Number(x.starts)||0;}))||1;
    var dots=use.map(function(x,i){
      var cx=l+(Number(x.listeners)||0)/maxX*(W-l-r);
      var cy=t+(1-(Number(x.repeat_listeners)||0)/maxY)*(H-t-b);
      var rad=4+Math.sqrt((Number(x.starts)||0)/maxS)*7;
      var label=i<6?'<text class="ins-scatter-label" x="'+(cx+rad+4)+'" y="'+(cy+4)+'">'+esc(String(x.track||"").slice(0,18))+'</text>':"";
      return '<g><circle class="ins-scatter-dot" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+rad.toFixed(1)+'"><title>'+
        esc((x.track||"track")+": "+num(x.listeners)+" listeners, "+num(x.repeat_listeners)+" repeat, "+num(x.starts)+" starts")+
        '</title></circle>'+label+'</g>';
    }).join("");
    return '<svg class="bd-svg ins-scatter" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Track reach versus repeat listeners">'+
      '<line class="ins-net-axis" x1="'+l+'" y1="'+(H-b)+'" x2="'+(W-r)+'" y2="'+(H-b)+'"/>'+
      '<line class="ins-net-axis" x1="'+l+'" y1="'+t+'" x2="'+l+'" y2="'+(H-b)+'"/>'+
      '<text class="bd-axis" x="'+((W+l-r)/2)+'" y="'+(H-12)+'" text-anchor="middle">listeners →</text>'+
      '<text class="bd-axis" x="14" y="'+((H+t-b)/2)+'" transform="rotate(-90 14 '+((H+t-b)/2)+')" text-anchor="middle">repeat listeners →</text>'+
      dots+'</svg>';
  }

  function pathFlow(rows) {
    var use=(rows||[]).slice(0,14), left=[], right=[];
    use.forEach(function(r){
      if(left.indexOf(r.from_page)<0)left.push(r.from_page);
      if(right.indexOf(r.to_page)<0)right.push(r.to_page);
    });
    var W=760,H=Math.max(300,Math.max(left.length,right.length)*42+70);
    function y(i,n){return 42+(H-84)*(n<=1?.5:i/(n-1));}
    function short(v){v=String(v||"");return v.length>34?v.slice(0,33)+"…":v;}
    var L={},R={};
    left.forEach(function(n,i){L[n]={x:24,y:y(i,left.length)};});
    right.forEach(function(n,i){R[n]={x:500,y:y(i,right.length)};});
    var links=use.map(function(row){
      var a=L[row.from_page],bb=R[row.to_page],w=Math.max(1.5,Math.min(12,1+(Number(row.moves)||0)*.8));
      return '<path class="rel-link" stroke-width="'+w+'" d="M 224 '+a.y+' C 350 '+a.y+', 375 '+bb.y+', 500 '+bb.y+'"/>';
    }).join("");
    function nodes(list,pos,cls){
      return list.map(function(n){var p=pos[n];return '<g><rect class="rel-node '+cls+'" x="'+p.x+'" y="'+(p.y-14)+'" width="200" height="28" rx="7"/>'+
        '<text class="rel-label" x="'+(p.x+9)+'" y="'+(p.y+4)+'">'+esc(short(n))+'</text></g>';}).join("");
    }
    return '<div class="rel-scroll"><svg class="rel-graph" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Page to next-page relationship flow">'+
      links+nodes(left,L,"")+nodes(right,R,"rel-node--track")+'</svg></div>';
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
    host.innerHTML = funnelView(funnelRows) +
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
      '<div class="ins-chart-block">' + lollipop(habitRows,
        "Daily, weekly and monthly active people") + "</div>";
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

  function paintContent(rows, events, err) {
    var host = el("insContent");
    if (err) { host.innerHTML = why(err); return; }
    DATA.content = rows || [];
    DATA.content_events = events || [];
    if (!rows || !rows.length) { host.innerHTML = why(null); return; }

    var total = function (key) {
      return rows.reduce(function (n, r) { return n + (Number(r[key]) || 0); }, 0);
    };
    var starts = total("starts"), listenerPairs = total("listeners"),
        repeats = total("repeat_listeners"), full = total("full_plays"),
        previews = total("preview_plays"), completes = total("completions"),
        shares = total("shares");

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

    host.innerHTML =
      '<div class="ins-stats">' +
        stat(num(starts),"track starts") +
        stat(num(listenerPairs),"listener-track relationships","deduped within each track") +
        stat(num(repeats),"repeat listener-track pairs") +
        stat(num(full),"full plays") +
        stat(num(completes),"completions") +
        stat(num(shares),"shares") +
      '</div>' +
      '<div class="an-grid" style="margin-top:1rem">' +
        '<section class="an-panel an-wide"><h3>Reach vs repeat</h3>' +
          '<p class="bd-sub">Each point is a track. Right means more listeners; higher means more repeat listeners; point size is total starts.</p>' +
          scatterTracks(tracks) +
          '<div class="ins-chart-detail">'+bars(tracks.slice(0,12).map(function(r){return {
            key:r.track,value:Number(r.starts)||0,display:num(r.starts),
            note:num(r.listeners)+" listeners · "+num(r.repeat_listeners)+" repeat"
          };}),{hue:HUE_A})+'</div>' +
        '</section>' +
        '<section class="an-panel"><h3>Albums / collections</h3>' +
          bars(albumRows.map(function (a) {
            return {key:a.key,value:a.starts,display:num(a.starts),
              note:num(a.full)+" full · "+num(a.completes)+" complete · "+num(a.shares)+" shares"};
          }),{hue:HUE_B}) +
        '</section>' +
        '<section class="an-panel"><h3>Full vs preview</h3>' +
          donut(full,previews,"full plays","preview plays") +
          '<div class="ins-chart-detail"><h3>Media event mix</h3>' +
            (eventRows.length ? bars(eventRows,{hue:HUE_A}) : why(null)) +
          '</div></section>' +
      '</div>' +
      '<div class="bd-scroll" style="margin-top:1rem"><table class="bd-table">' +
        '<caption>Track performance for '+esc(RANGE.label||"selected range")+'</caption>' +
        '<thead><tr><th>Track</th><th>Album</th><th class="n">Starts</th>' +
        '<th class="n">Listeners</th><th class="n">Repeat</th><th class="n">Starts/listener</th>' +
        '<th class="n">Full</th><th class="n">Preview</th><th class="n">Complete</th>' +
        '<th class="n">Shares</th><th>First</th><th>Last</th></tr></thead><tbody>' +
        tracks.map(function (r) {
          var first=r.first_heard?new Date(r.first_heard).toLocaleDateString():"—";
          var last=r.last_heard?new Date(r.last_heard).toLocaleDateString():"—";
          return '<tr><td><b>'+esc(r.track||"—")+'</b></td><td>'+esc(r.album||"—")+'</td>' +
            '<td class="n">'+num(r.starts)+'</td><td class="n">'+num(r.listeners)+'</td>' +
            '<td class="n">'+num(r.repeat_listeners)+'</td><td class="n">'+
            esc(r.plays_per_listener==null?"—":r.plays_per_listener)+'</td>' +
            '<td class="n">'+num(r.full_plays)+'</td><td class="n">'+num(r.preview_plays)+'</td>' +
            '<td class="n">'+num(r.completions)+'</td><td class="n">'+num(r.shares)+'</td>' +
            '<td>'+esc(first)+'</td><td>'+esc(last)+'</td></tr>';
        }).join("") +
        '</tbody></table></div>' +
      '<p class="bd-foot">Legacy album plays and the newer music-player events are normalized into one selected-window report. ' +
        'Preview/full/completion columns appear only where those newer events exist.</p>';
  }

  function paintPaths(rows, err) {
    var host = el("insPaths");
    if (err) { host.innerHTML = why(err); return; }
    DATA.paths = rows;
    if (!rows.length) { host.innerHTML = why(null); return; }
    /* Pairs, so a bar per pair reads better than a table of three columns. */
    var pathRows = rows.map(function (r) {
      return {
        key: r.from_page + "  →  " + r.to_page,
        value: Number(r.moves) || 0, display: num(r.moves),
        note: num(r.sessions) + " sessions"
      };
    });
    host.innerHTML = pathFlow(rows) +
      '<div class="ins-chart-detail">' + bars(pathRows, { hue: HUE_B }) + "</div>";
  }

  /* ---------- load ------------------------------------------------- */
  function dayOf(iso) {
    var d = new Date(iso);
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  }
  function rangeArgs() {
    return { p_since:RANGE.since, p_until:RANGE.until, p_site:SITE_ID };
  }
  var LOAD_SEQ = 0;
  function load() {
    if (!ALLOWED) return Promise.resolve();
    var mine = ++LOAD_SEQ;
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
      ["paths", null, ["analytics_paths",Object.assign({p_limit:20},args)], paintPaths]
    ];

    var stamp=el("insStamp");
    if(stamp) stamp.textContent="Reading "+(RANGE.label||"selected range")+"…";

    var core = Promise.allSettled(jobs.map(function (j) {
      return j[2] ? rpc(j[2][0],j[2][1]) : api(j[1]);
    })).then(function (out) {
      if (mine !== LOAD_SEQ) return 0;
      var failed=0;
      out.forEach(function (res,i) {
        if(res.status==="fulfilled") jobs[i][3](res.value||[],null);
        else {failed++;jobs[i][3]([],res.reason||new Error("failed"));}
      });
      return failed;
    });

    var content = Promise.allSettled([
      rpc("analytics_content",args),
      rpc("analytics_content_events",args)
    ]).then(function (out) {
      if (mine !== LOAD_SEQ) return 0;
      if(out[0].status==="rejected"){
        paintContent([],[],out[0].reason||new Error("failed")); return 1;
      }
      var eventRows=out[1].status==="fulfilled"?(out[1].value||[]):[];
      paintContent(out[0].value||[],eventRows,
        out[1].status==="rejected"?out[1].reason:null);
      return out[1].status==="rejected"?1:0;
    });

    return Promise.all([core,content]).then(function (counts) {
      if (mine !== LOAD_SEQ) return;
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
