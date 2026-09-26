(function (w, d) {
  "use strict";

  var $ = function (id) { return d.getElementById(id); };
  var HUE_A = "#e5383b", HUE_B = "#3f93d2";
  var state = { property:null, range:null, overview:null, identity:null, forensics:[], seq:0, ownerShown:false };
  var B = w.MCCBoard || {};

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function num(v) {
    if (v == null || !isFinite(Number(v))) return "—";
    return Number(v).toLocaleString();
  }
  function money(cents) {
    return "$" + (Number(cents || 0) / 100).toLocaleString(undefined, {
      minimumFractionDigits:2, maximumFractionDigits:2
    });
  }
  function token() {
    return w.MCC_SUPA && MCC_SUPA.token ? MCC_SUPA.token() : Promise.resolve(null);
  }
  function api(path) {
    return token().then(function (t) {
      if (!t) throw new Error("signed out");
      return fetch("https://api.mccluster.org" + path, {
        headers:{Authorization:"Bearer " + t,"Content-Type":"application/json"}
      });
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.ok === false) throw Object.assign(new Error(j.error || j.reason || ("HTTP " + r.status)), {status:r.status});
        return j;
      });
    });
  }
  function stat(value, label, note) {
    return '<div class="ins-stat"><b>'+esc(value)+'</b><span>'+esc(label)+'</span>'+
      (note?'<em>'+esc(note)+'</em>':"")+'</div>';
  }
  function legend(items) {
    return '<p class="ins-legend">'+items.map(function(x){
      return '<span><i style="background:'+x.color+'"></i>'+esc(x.label)+'</span>';
    }).join("")+'</p>';
  }
  function donut(a,b,aLabel,bLabel,centerLabel) {
    a=Number(a)||0;b=Number(b)||0;var total=a+b;
    if(!total)return '<p class="ins__none">No composition in this range.</p>';
    var circ=326.73, first=circ*(a/total), second=circ-first;
    return '<div class="ins-donut-wrap"><svg class="ins-donut" viewBox="0 0 140 140" role="img" aria-label="'+
      esc(aLabel+" "+Math.round(a/total*100)+" percent, "+bLabel+" "+Math.round(b/total*100)+" percent")+'">'+
      '<circle class="ins-donut__track" cx="70" cy="70" r="52"/>'+
      '<circle cx="70" cy="70" r="52" fill="none" stroke="'+HUE_A+'" stroke-width="18" stroke-dasharray="'+first.toFixed(2)+' '+second.toFixed(2)+'" transform="rotate(-90 70 70)"/>'+
      '<circle cx="70" cy="70" r="52" fill="none" stroke="'+HUE_B+'" stroke-width="18" stroke-dasharray="'+second.toFixed(2)+' '+first.toFixed(2)+'" stroke-dashoffset="'+(-first).toFixed(2)+'" transform="rotate(-90 70 70)"/>'+
      '<text class="ins-donut__big" x="70" y="68" text-anchor="middle">'+esc(centerLabel || num(total))+'</text>'+
      '<text class="ins-donut__small" x="70" y="85" text-anchor="middle">total</text></svg>'+
      legend([{label:aLabel+" · "+num(a),color:HUE_A},{label:bLabel+" · "+num(b),color:HUE_B}])+'</div>';
  }
  function lollipop(rows,label) {
    if(!rows.length)return "";
    var W=620,H=Math.max(160,46*rows.length+30),left=170,right=575;
    var max=Math.max.apply(null,rows.map(function(x){return Number(x.value)||0;}))||1;
    return '<svg class="bd-svg ins-lollipop" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(label)+'">'+
      rows.map(function(x,i){
        var y=34+i*46, xx=left+(Number(x.value)||0)/max*(right-left);
        return '<g><text class="bd-axis" x="8" y="'+(y+4)+'">'+esc(x.key)+'</text>'+
          '<line class="ins-lollipop-line" x1="'+left+'" y1="'+y+'" x2="'+xx+'" y2="'+y+'"/>'+
          '<circle class="ins-lollipop-dot" cx="'+xx+'" cy="'+y+'" r="6"/>'+
          '<text class="bd-mark" x="'+Math.min(xx+10,right)+'" y="'+(y+4)+'">'+esc(num(x.value))+'</text></g>';
      }).join("")+'</svg>';
  }
  function segmented(rows) {
    var total=rows.reduce(function(n,x){return n+(Number(x.value)||0);},0);
    if(!total)return '<p class="ins__none">No activity mix in this range.</p>';
    return '<div class="an-segmented" role="img" aria-label="Platform event composition">'+
      rows.map(function(x,i){
        var pct=(Number(x.value)||0)/total*100;
        return '<span class="an-segment an-segment--'+(i%4)+'" style="width:'+pct.toFixed(2)+'%" title="'+
          esc(x.key+": "+num(x.value))+'"></span>';
      }).join("")+'</div><div class="an-segment-legend">'+
      rows.map(function(x,i){return '<span><i class="an-segment--'+(i%4)+'"></i>'+esc(x.key)+' <b>'+esc(num(x.value))+'</b></span>';}).join("")+
      '</div>';
  }
  function funnel(rows) {
    if(!rows.length)return "";
    var top=Math.max(1,Number(rows[0].value)||0);
    return '<div class="ins-funnel">'+rows.map(function(x,i){
      var pct=Math.max(20,(Number(x.value)||0)/top*100);
      return '<div class="ins-funnel__step" style="width:'+pct.toFixed(1)+'%;background:rgba(229,56,59,'+
        Math.max(.24,.86-i*.10).toFixed(2)+')"><span>'+esc(x.key)+'</span><b>'+esc(num(x.value))+'</b></div>';
    }).join("")+'</div>';
  }
  function rangeQuery(range) {
    if(!range || !range.since || !range.until) return "";
    return "?since="+encodeURIComponent(range.since)+"&until="+encodeURIComponent(range.until)+
      "&label="+encodeURIComponent(range.label || "selected range");
  }
  function fillSignupDays(rows, range) {
    rows=rows||[];
    if(!range || !range.days || range.days > 120) return rows;
    var map={};rows.forEach(function(r){map[r.day]=Number(r.count)||0;});
    var out=[], cur=new Date(range.since), end=new Date(range.until);
    cur.setHours(0,0,0,0);
    while(cur<end && out.length<125){
      var key=cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0");
      out.push({day:key,count:map[key]||0});cur.setDate(cur.getDate()+1);
    }
    return out;
  }
  function paintOverview() {
    var host=$("overviewBody"), s=state.overview;
    if(!host)return;
    if(!s){host.innerHTML='<p class="ins__none">No owner overview loaded.</p>';return;}
    var u=s.users||{}, p=s.platform||{}, m=s.mnet||{}, music=s.music||{}, rev=music.revenue||{};
    var signups=fillSignupDays(u.created_by_day||[],state.range);
    var signupChart=signups.length && B.lineChart ? B.lineChart(signups,{
      id:"overviewSignupTrend",xKey:"day",
      series:[{key:"count",label:"New accounts",color:HUE_A}],
      label:"New accounts over time",labelFor:function(v){return String(v).slice(5);}
    }) : '<p class="ins__none">No signup timeline in this range.</p>';

    var platformRows=[
      {key:"Page views",value:p.page_views&&p.page_views.in_window},
      {key:"Clicks",value:p.clicks&&p.clicks.in_window},
      {key:"Acquisitions",value:p.acquisitions&&p.acquisitions.in_window},
      {key:"All events",value:p.events&&p.events.in_window}
    ];
    var mnetRows=[
      {key:"Profiles",value:m.profiles&&m.profiles.created_in_window},
      {key:"Posts",value:m.posts&&m.posts.created_in_window},
      {key:"Follows",value:m.follows&&m.follows.created_in_window},
      {key:"Reactions",value:m.reactions&&m.reactions.created_in_window}
    ];
    var musicRows=[
      {key:"All plays",value:music.plays&&music.plays.in_window},
      {key:"Full plays",value:music.full_plays&&music.full_plays.in_window},
      {key:"Completions",value:music.completions&&music.completions.in_window}
    ];
    host.innerHTML=
      '<div class="ins-stats an-overview-kpis">'+
        stat(num(u.total),"accounts","all time")+
        stat(num(u.created_in_window),"new accounts",state.range&&state.range.label)+
        stat(num(u.active_in_window),"active accounts",state.range&&state.range.label)+
        stat(num(p.page_views&&p.page_views.in_window),"page views",state.range&&state.range.label)+
        stat(num(music.plays&&music.plays.in_window),"music plays",state.range&&state.range.label)+
        stat(money(rev.gross_cents_in_window),"gross music revenue",state.range&&state.range.label)+
      '</div>'+
      '<div class="an-grid" style="margin-top:1rem">'+
        '<section class="an-panel an-wide"><div class="an-ph"><h2>Account growth</h2><span class="an-viz-tag">line + points</span></div>'+
          '<p class="bd-sub">New M Accounts in the selected window.</p>'+signupChart+'</section>'+
        '<section class="an-panel"><div class="an-ph"><h2>Verification</h2><span class="an-viz-tag">donut</span></div>'+
          donut(u.confirmed_total,u.unconfirmed_total,"confirmed","unconfirmed",num(u.total))+'</section>'+
        '<section class="an-panel"><div class="an-ph"><h2>Platform activity</h2><span class="an-viz-tag">composition</span></div>'+
          segmented(platformRows)+'</section>'+
        '<section class="an-panel"><div class="an-ph"><h2>Mnet</h2><span class="an-viz-tag">lollipop</span></div>'+
          lollipop(mnetRows,"Mnet activity in the selected range")+'</section>'+
        '<section class="an-panel"><div class="an-ph"><h2>Music journey</h2><span class="an-viz-tag">funnel</span></div>'+
          funnel(musicRows)+'</section>'+
        '<section class="an-panel"><div class="an-ph"><h2>Music money</h2><span class="an-viz-tag">donut</span></div>'+
          donut(rev.platform_fee_cents_in_window,rev.creator_net_cents_in_window,
            "platform fee","creator net",money(rev.gross_cents_in_window))+'</section>'+
      '</div>'+
      '<div class="an-grid" style="margin-top:1rem">'+
        '<section class="an-panel"><h2>Creators & catalog</h2><div class="ins-stats">'+
          stat(num(music.creators&&music.creators.total),"creator profiles")+
          stat(num(music.creator_tracks&&music.creator_tracks.total),"creator tracks")+
          stat(num(music.published_tracks),"published tracks")+
          stat(num(music.active_license_offers),"active license offers")+
        '</div></section>'+
        '<section class="an-panel"><h2>Commerce</h2><div class="ins-stats">'+
          stat(num(music.paid_orders&&music.paid_orders.in_window),"paid orders")+
          stat(num(music.entitlements&&music.entitlements.created_in_window),"entitlements")+
          stat(money(rev.platform_fee_cents_in_window),"platform fee")+
          stat(money(rev.creator_net_cents_in_window),"creator net")+
        '</div></section>'+
      '</div>';
    var stamp=$("overviewStamp");
    if(stamp)stamp.textContent="Owner overview · "+(state.range&&state.range.label||"selected range")+
      " · generated "+new Date(s.generated_at).toLocaleString();
  }

  function relationGraph(data) {
    var journeys=(data&&data.journeys||[]).filter(function(j){return !!j.last_track;}).slice(0,16);
    if(!journeys.length)return '<p class="ins__none">No attributed account journeys in this range yet.</p>';
    var sources=[],tracks=[];
    journeys.forEach(function(j){
      var src=j.source||"direct";
      if(sources.indexOf(src)<0&&sources.length<6)sources.push(src);
      if(tracks.indexOf(j.last_track)<0&&tracks.length<8)tracks.push(j.last_track);
    });
    journeys=journeys.filter(function(j){return sources.indexOf(j.source||"direct")>=0&&tracks.indexOf(j.last_track)>=0;});
    var W=940,H=Math.max(390,Math.max(sources.length,tracks.length,journeys.length)*36+70);
    function y(i,n){return 46+(H-92)*(n<=1?.5:i/(n-1));}
    var S={},T={},A={};sources.forEach(function(v,i){S[v]={x:24,y:y(i,sources.length)};});
    tracks.forEach(function(v,i){T[v]={x:334,y:y(i,tracks.length)};});
    journeys.forEach(function(v,i){A[i]={x:682,y:y(i,journeys.length)};});
    var counts={};journeys.forEach(function(j){var k=(j.source||"direct")+"\u0000"+j.last_track;counts[k]=(counts[k]||0)+1;});
    function short(v,n){v=String(v||"");return v.length>n?v.slice(0,n-1)+"…":v;}
    var links=Object.keys(counts).map(function(k){
      var p=k.split("\u0000"),a=S[p[0]],b=T[p[1]];if(!a||!b)return "";
      return '<path class="rel-link" stroke-width="'+Math.min(10,1.5+counts[k]*1.4)+'" d="M 204 '+a.y+' C 272 '+a.y+',286 '+b.y+',334 '+b.y+'"/>';
    }).join("")+journeys.map(function(j,i){
      var a=T[j.last_track],b=A[i];if(!a||!b)return "";
      return '<path class="rel-link" stroke-width="1.5" d="M 544 '+a.y+' C 610 '+a.y+',628 '+b.y+',682 '+b.y+'"/>';
    }).join("");
    function node(pos,width,label,cls,note){
      return '<g><rect class="rel-node '+(cls||"")+'" x="'+pos.x+'" y="'+(pos.y-13)+'" width="'+width+'" height="26" rx="7"/>'+
        '<text class="rel-label" x="'+(pos.x+9)+'" y="'+(pos.y+4)+'">'+esc(short(label,26))+'</text>'+
        (note?'<text class="rel-note" x="'+(pos.x+9)+'" y="'+(pos.y+27)+'">'+esc(short(note,30))+'</text>':"")+'</g>';
    }
    var nodes=sources.map(function(v){return node(S[v],180,v,"","source");}).join("")+
      tracks.map(function(v){return node(T[v],210,v,"rel-node--track","track");}).join("")+
      journeys.map(function(j,i){
        var who=[j.first_name,j.last_name].filter(Boolean).join(" ")||j.email||"account";
        return node(A[i],230,who,"rel-node--account",
          j.minutes_after_last_track==null?"account":j.minutes_after_last_track+"m after last play");
      }).join("");
    return '<div class="rel-scroll"><svg class="rel-graph" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Source to track to account relationship flow">'+links+nodes+'</svg></div>';
  }
  function identityScatter(rows) {
    rows=(rows||[]).filter(function(r){return Number(r.listeners)>0;}).slice(0,24);
    if(!rows.length)return '<p class="ins__none">No track-to-account relationships with a listener denominator yet.</p>';
    var W=660,H=350,l=54,r=24,t=24,b=48;
    var mx=Math.max.apply(null,rows.map(function(x){return Number(x.listeners)||0;}))||1;
    var my=Math.max.apply(null,rows.map(function(x){return Number(x.last_touch_accounts)||0;}))||1;
    return '<svg class="bd-svg ins-scatter" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Track listeners versus attributed accounts">'+
      '<line class="ins-net-axis" x1="'+l+'" y1="'+(H-b)+'" x2="'+(W-r)+'" y2="'+(H-b)+'"/>'+
      '<line class="ins-net-axis" x1="'+l+'" y1="'+t+'" x2="'+l+'" y2="'+(H-b)+'"/>'+
      rows.map(function(x,i){
        var cx=l+(Number(x.listeners)||0)/mx*(W-l-r),cy=t+(1-(Number(x.last_touch_accounts)||0)/my)*(H-t-b);
        return '<g><circle class="ins-scatter-dot" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+(5+Math.min(7,Number(x.assisted_accounts)||0))+'"><title>'+
          esc(x.track+": "+num(x.listeners)+" listeners, "+num(x.last_touch_accounts)+" last-touch accounts")+'</title></circle>'+
          (i<6?'<text class="ins-scatter-label" x="'+(cx+10)+'" y="'+(cy+4)+'">'+esc(String(x.track).slice(0,18))+'</text>':"")+'</g>';
      }).join("")+
      '<text class="bd-axis" x="'+((W+l-r)/2)+'" y="'+(H-12)+'" text-anchor="middle">listeners →</text>'+
      '<text class="bd-axis" x="14" y="'+((H+t-b)/2)+'" transform="rotate(-90 14 '+((H+t-b)/2)+')" text-anchor="middle">last-touch accounts →</text></svg>';
  }
  function paintIdentity() {
    var data=state.identity||{}, c=data.coverage||{};
    if($("identityCoverage"))$("identityCoverage").innerHTML=
      stat(num(c.accounts),"accounts created")+
      stat(num(c.bridged_accounts),"device bridged")+
      stat(num(c.attributed_accounts),"track attributed")+
      stat(num(c.accounts_with_ip),"with IP context")+
      stat(num(c.accounts_with_location),"with location context");
    if($("identityFlow"))$("identityFlow").innerHTML=relationGraph(data);
    if($("identityTracks"))$("identityTracks").innerHTML=identityScatter(data.tracks||[])+
      '<div class="bd-scroll"><table class="bd-table"><thead><tr><th>Track</th><th class="n">Listeners</th><th class="n">Assisted</th><th class="n">Last touch</th><th class="n">Rate</th></tr></thead><tbody>'+
      (data.tracks||[]).slice(0,30).map(function(x){return '<tr><td>'+esc(x.track)+'</td><td class="n">'+num(x.listeners)+'</td><td class="n">'+num(x.assisted_accounts)+'</td><td class="n">'+num(x.last_touch_accounts)+'</td><td class="n">'+esc(x.signup_rate_pct==null?"—":x.signup_rate_pct+"%")+'</td></tr>';}).join("")+
      '</tbody></table></div>';
    if($("identityJourneys"))$("identityJourneys").innerHTML=(data.journeys||[]).length
      ? '<div class="an-journeys">'+(data.journeys||[]).slice(0,50).map(function(j){
          var who=[j.first_name,j.last_name].filter(Boolean).join(" ")||j.email||"account";
          return '<details class="an-journey"><summary><span><b>'+esc(who)+'</b><small>'+esc(new Date(j.created_at).toLocaleString())+'</small></span><span><b>'+esc(j.last_track||"No track")+'</b><small>'+esc(j.source||"direct")+'</small></span></summary>'+
            '<div class="an-journey__grid"><span><b>Elapsed</b>'+esc(j.minutes_after_last_track==null?"—":j.minutes_after_last_track+" min")+'</span>'+
            '<span><b>Network</b>'+esc(j.network||"—")+'</span><span><b>Location</b>'+esc([j.city,j.region,j.country].filter(Boolean).join(", ")||"—")+'</span>'+
            '<span><b>IP</b><code>'+esc(j.ip||"privacy-suppressed")+'</code></span><span><b>Device</b>'+esc(j.device&&j.device.platform||"—")+'</span>'+
            '<span><b>Assisted tracks</b>'+esc((j.assisted_tracks||[]).join(", ")||"—")+'</span></div></details>';
        }).join("")+'</div>'
      : '<p class="ins__none">No account journeys in this range.</p>';

    if($("forensicsEvents"))$("forensicsEvents").innerHTML=state.forensics.length
      ? '<div class="an-forensics">'+state.forensics.map(function(e){
          var dev=e.device||{};
          return '<details class="an-forensic"><summary><span><b>'+esc(e.name||"event")+'</b><small>'+esc(new Date(e.at).toLocaleString())+'</small></span><span><b>'+esc(e.path||"—")+'</b><small>'+esc([e.city,e.region,e.country].filter(Boolean).join(", ")||"location unavailable")+'</small></span></summary>'+
            '<div class="an-journey__grid"><span><b>IP</b><code>'+esc(e.ip||"privacy-suppressed")+'</code></span><span><b>Network</b>'+esc(e.asn_org||"—")+(e.asn?" · AS"+esc(e.asn):"")+'</span>'+
            '<span><b>Device</b>'+esc(dev.platform||"—")+" · "+esc(dev.screen||dev.viewport||"—")+'</span><span><b>Device ID</b><code>'+esc(e.device_id||"—")+'</code></span>'+
            '<span><b>Session ID</b><code>'+esc(e.session_id||"—")+'</code></span><span><b>User agent</b>'+esc(e.user_agent||"—")+'</span></div></details>';
        }).join("")+'</div>'
      : '<p class="ins__none">No raw first-party events in this range.</p>';
    var stamp=$("identityStamp");if(stamp)stamp.textContent="Owner-only · "+(state.range&&state.range.label||"selected range")+" · "+new Date().toLocaleString();
  }

  function setOwnerTabs(show) {
    ["anOverviewTab","anIdentityTab"].forEach(function(id){var x=$(id);if(x)x.hidden=!show;});
    if (!show && /#(?:overview|identity)$/.test(location.hash)) location.hash="#traffic";
    /* The owner should land on the suite, not discover it by accident after
       another complaint. Respect explicit deep links, but default the first
       house-property load to Overview. */
    if (show && !state.ownerShown) {
      state.ownerShown=true;
      if (!location.hash) {
        var tab=$("anOverviewTab");
        if(tab)tab.click();
      }
    }
  }
  function load() {
    var range=state.range, prop=state.property;
    var eligible=!!(range&&prop&&prop.first_party);
    setOwnerTabs(eligible);
    if(!eligible)return;
    var mine=++state.seq, q=rangeQuery(range);
    var overview=$("overviewBody"), identity=$("identityFlow");
    if(overview)overview.innerHTML='<div class="bd-gap" role="status"><b>Updating '+esc(range.label)+'…</b><span>Loading accounts, platform, Mnet, music and commerce.</span></div>';
    if(identity)identity.innerHTML='<div class="bd-gap" role="status"><b>Updating attribution…</b><span>Reconstructing account journeys for this range.</span></div>';
    Promise.allSettled([
      api("/v1/analytics/business"+q),
      api("/v1/analytics/identity"+q),
      api("/v1/analytics/forensics"+q+"&limit=100")
    ]).then(function(results){
      if(mine!==state.seq)return;
      if(results[0].status==="fulfilled"){state.overview=results[0].value.snapshot;paintOverview();}
      else if(overview)overview.innerHTML='<p class="ins__none ins__none--stop"><b>Owner overview did not load.</b> '+esc(results[0].reason&&results[0].reason.message)+'</p>';
      if(results[1].status==="fulfilled")state.identity=results[1].value;
      else state.identity=null;
      if(results[2].status==="fulfilled")state.forensics=results[2].value.events||[];
      else state.forensics=[];
      if(results[1].status==="fulfilled")paintIdentity();
      else if(identity)identity.innerHTML='<p class="ins__none ins__none--stop"><b>Identity analytics did not load.</b> '+esc(results[1].reason&&results[1].reason.message)+'</p>';
    });
  }

  d.addEventListener("mcc:range",function(e){
    if(!e||!e.detail||!e.detail.since||!e.detail.until)return;
    state.range=e.detail;load();
  });
  d.addEventListener("mcc:analytics-property",function(e){
    state.property=e&&e.detail||null;load();
  });
  if(w.MCC_ANALYTICS_PROPERTY)state.property=w.MCC_ANALYTICS_PROPERTY;
})(window,document);
