(function(){
  "use strict";
  var SUPA=window.MCC_SUPA, AUTH=window.MCC_AUTH;
  var state={sites:[],selected:null,events:[],identity:null,forensics:[],range:null};
  var $=function(id){return document.getElementById(id);};

  function host(v){
    v=String(v||"").trim().toLowerCase();
    v=v.replace(/^[a-z][a-z0-9+.-]*:\/\//i,"").split("/")[0].split(":")[0].replace(/\.$/,"");
    return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(v)&&v.indexOf(".")>0?v:"";
  }
  function token(){return SUPA&&SUPA.token?SUPA.token():Promise.resolve(null);}
  function rest(path,opts){
    opts=opts||{};
    return token().then(function(t){
      if(!t) throw new Error("signed out");
      var h={apikey:SUPA.key,Authorization:"Bearer "+t,"Content-Type":"application/json"};
      if(opts.prefer) h.Prefer=opts.prefer;
      return fetch(SUPA.url+"/rest/v1/"+path,{method:opts.method||"GET",headers:h,body:opts.body?JSON.stringify(opts.body):undefined});
    }).then(function(r){
      return r.text().then(function(raw){
        var body=null; try{body=raw?JSON.parse(raw):null;}catch(_){body=raw;}
        if(!r.ok) throw new Error((body&&body.message)||raw||("HTTP "+r.status));
        return body;
      });
    });
  }
  function rpc(name,body){
    return token().then(function(t){
      if(!t) throw new Error("signed out");
      return fetch(SUPA.url+"/rest/v1/rpc/"+name,{
        method:"POST",
        headers:{apikey:SUPA.key,Authorization:"Bearer "+t,"Content-Type":"application/json"},
        body:JSON.stringify(body||{})
      });
    }).then(function(r){
      return r.text().then(function(raw){
        var body=null; try{body=raw?JSON.parse(raw):null;}catch(_){body=raw;}
        if(!r.ok) throw new Error((body&&body.message)||raw||("HTTP "+r.status));
        return body;
      });
    });
  }

  function api(path,opts){
    opts=opts||{};
    return token().then(function(t){
      if(!t) throw new Error("signed out");
      return fetch("https://api.mccluster.org"+path,{
        method:opts.method||"GET",
        headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},
        body:opts.body?JSON.stringify(opts.body):undefined
      });
    }).then(function(r){return r.json().then(function(j){if(!r.ok||j.ok===false)throw new Error(j.error||j.reason||("HTTP "+r.status));return j;});});
  }
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c];});}
  function copy(text){
    if(navigator.clipboard&&navigator.clipboard.writeText)return navigator.clipboard.writeText(text);
    var t=document.createElement("textarea");t.value=text;document.body.appendChild(t);t.select();document.execCommand("copy");t.remove();return Promise.resolve();
  }
  function snippet(site){
    var mode=site.consent_mode==="cookieless"?"cookieless":"required";
    return '<script async src="https://api.mccluster.org/a.js?site='+site.public_key+'&consent='+mode+'"><\/script>';
  }

  function renderSites(){
    var el=$("sites"); el.innerHTML="";
    state.sites.forEach(function(site){
      var domains=site.analytics_site_domains||[];
      var verified=domains.some(function(d){return !!d.verified_at&&d.enabled!==false;});
      var own=site.id===FIRST_PARTY;
      var sel=state.selected&&state.selected.id===site.id;
      var row=document.createElement("div");row.className="site";
      row.innerHTML='<div class="bd-prop"><b>'+esc(site.name)+'</b><div class="muted">'+
        esc(own?"built in · no site key":(domains.map(function(d){return d.hostname;}).join(", ")||"No domain"))+'</div></div>'+
        '<div class="row" style="flex:0 0 auto"><span class="badge '+(own?"ok":verified?"ok":"danger")+'">'+
        (own?"live":verified?"verified":"verify domain")+'</span><button class="alt">'+(sel?"Showing":"Open")+'</button></div>';
      row.querySelector("button").onclick=function(){selectSite(site.id);};
      el.appendChild(row);
    });
    if(!state.sites.length)el.innerHTML='<p class="muted">No analytics properties yet.</p>';
  }

  function renderInstall(site){
    var domains=site.analytics_site_domains||[];
    var domain=domains[0]||null;
    var html='<p><b>'+esc(site.name)+'</b></p><p class="muted">Public site key</p><pre>'+esc(site.public_key)+'</pre>';
    if(domain&&!domain.verified_at){
      html+='<p><b>Verify '+esc(domain.hostname)+'</b></p>'+
        '<p class="muted">Add this DNS TXT record, then press Verify.</p>'+
        '<pre>_mccluster-analytics.'+esc(domain.hostname)+'\n'+esc(domain.verification_token)+'</pre>'+
        '<button id="verifyDomain">Verify DNS</button>';
    }else if(domain){
      html+='<p class="ok">Domain verified: '+esc(domain.hostname)+'</p>';
    }
    html+='<p class="muted" style="margin-top:14px">One-line pixel</p><pre id="snippet">'+esc(snippet(site))+'</pre><button id="copyPixel">Copy pixel</button>';
    if(site.consent_mode!=="cookieless"){
      html+='<p class="muted">After your consent manager approves analytics, call <code>mcAnalytics.consent(true)</code>. Until then the pixel does not send visitor events.</p>';
    }
    $("install").innerHTML=html;
    var cp=$("copyPixel");if(cp)cp.onclick=function(){copy(snippet(site)).then(function(){cp.textContent="Copied";});};
    var v=$("verifyDomain");if(v&&domain)v.onclick=function(){
      v.disabled=true;v.textContent="Checking…";
      api("/v1/analytics/domains/"+domain.id+"/verify",{method:"POST"}).then(loadSites).catch(function(e){alert(e.message);}).finally(function(){v.disabled=false;v.textContent="Verify DNS";});
    };
  }

  /* ===================== THE BOARD =====================
     What used to live here was four integers and three two-column count
     tables. The rows it counted were always enough to draw a real chart — the
     page just threw the timestamps away. Now the same rows go through
     MCCBoard.rollup and come back as a day series, and the board draws it.

     TWO SCOPES, ONE QUERY SHAPE. A client's property is scoped by site_id under
     the "analytics owners read site events" policy. This site's own traffic has
     no site_id at all: js/analytics.js posts to the collector without a
     site_key, so every one of those rows lands with site_id null and the
     site-scoped filter excluded all of it. That is why this page reported
     nothing about the site it is hosted on. The first-party property below is
     that missing scope, readable only by the desk (RLS "only the desk reads
     it"), so it is offered only when the account actually holds that. */
  var FIRST_PARTY = "__first_party__";
  var board = null;
  var isDesk = false;

  function askIsDesk(){
    return token().then(function(t){
      if(!t) return false;
      return fetch(SUPA.url+"/rest/v1/rpc/eu_is_admin",{
        method:"POST",headers:{apikey:SUPA.key,Authorization:"Bearer "+t,"Content-Type":"application/json"},body:"{}"
      }).then(function(r){return r.ok?r.json():false;}).then(function(v){return v===true;});
    }).catch(function(){return false;});
  }

  function scopeFilter(site){
    return site.id===FIRST_PARTY ? "site_id=is.null" : "site_id=eq."+encodeURIComponent(site.id);
  }

  /* Historical reporting comes from server-side aggregates, not a capped raw
     event download. That matters now that the collector holds more than 74k
     rows and the oldest production signal predates the current page_view
     event. The RPCs normalize that legacy period and return the complete
     selected range without a browser row ceiling. Raw rows are fetched only
     for the 50-row Recent Events diagnostic table. */
  function siteUuid(site){ return site.id===FIRST_PARTY ? null : site.id; }
  function topRows(rows,key){
    return (rows||[]).map(function(r){var o={count:Number(r.n)||0};o[key]=r.key;return o;});
  }
  function recentEvents(site,request){
    return rest("events?"+scopeFilter(site)+
      "&at=gte."+encodeURIComponent(request.since)+
      "&at=lt."+encodeURIComponent(request.until)+
      "&select=at,name,path,session_id,device_id,country,city,asn_org,is_bot,device,edge,referrer"+
      "&order=at.desc&limit=50").then(function(rows){
        state.events=rows||[]; renderRecent();
      }).catch(function(){ state.events=[]; renderRecent(); });
  }
  function fetchAnalytics(site,request){
    var sid=siteUuid(site);
    var tz="UTC";
    try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";}catch(_){}
    var current={p_since:request.since,p_until:request.until,p_site:sid};
    var daily={p_since:request.query_since,p_until:request.until,p_site:sid,p_tz:tz};
    var jobs=[
      rpc("analytics_daily",daily),
      rpc("analytics_totals",current),
      rpc("analytics_top",{p_dim:"page",p_since:request.since,p_until:request.until,p_site:sid,p_limit:12}),
      rpc("analytics_top",{p_dim:"source",p_since:request.since,p_until:request.until,p_site:sid,p_limit:12}),
      rpc("analytics_top",{p_dim:"country",p_since:request.since,p_until:request.until,p_site:sid,p_limit:12}),
      rpc("analytics_top",{p_dim:"network",p_since:request.since,p_until:request.until,p_site:sid,p_limit:12})
    ];
    if(request.compare){
      jobs.push(rpc("analytics_totals",{
        p_since:request.query_since,p_until:request.since,p_site:sid
      }));
    }
    return Promise.all(jobs).then(function(out){
      recentEvents(site,request);
      var totals=(out[1]&&out[1][0])||{};
      var previous=request.compare&&out[6]&&out[6][0] ? out[6][0] : null;
      return {traffic:{
        by_day:out[0]||[],
        totals:totals,
        previous_totals:previous,
        top_pages:topRows(out[2],"path"),
        top_referrers:topRows(out[3],"source"),
        top_countries:topRows(out[4],"country"),
        top_networks:topRows(out[5],"network"),
        bots_excluded:true,
        truncated:false,
        first_event:totals.first_event||null,
        identity_since:totals.identity_since||null
      },note:request.mode==="all"&&totals.first_event
        ? "history begins "+new Date(totals.first_event).toLocaleDateString()
        : ""};
    });
  }

  function renderRecent(){
    var human=state.events.filter(function(e){return e.is_bot!==true;});
    if(!human.length){$("recent").innerHTML='<p class="bd-empty">No events in this window.</p>';return;}
    $("recent").innerHTML='<div class="bd-scroll"><table><thead><tr><th>Time</th><th>Event</th><th>Path</th><th>Country</th><th>Network</th></tr></thead><tbody>'+
      human.slice(0,50).map(function(e){
        return '<tr><td>'+esc(new Date(e.at).toLocaleString())+'</td><td>'+esc(e.name)+'</td><td>'+esc(e.path)+
          '</td><td>'+esc(e.country||"—")+'</td><td>'+esc((e.device&&e.device.network&&e.device.network.effective)||e.asn_org||"—")+'</td></tr>';
      }).join("")+'</tbody></table></div>';
  }


  function fmtDate(v){
    if(!v)return "—";
    try{return new Date(v).toLocaleString();}catch(_){return String(v);}
  }
  function statBox(v,label,sub){
    return '<div class="ins-stat"><b>'+esc(v)+'</b><span>'+esc(label)+'</span>'+(sub?'<em>'+esc(sub)+'</em>':"")+'</div>';
  }
  function relationGraph(data){
    data=data||{};
    var journeys=(data.journeys||[]).filter(function(j){return !!j.last_track;}).slice(0,18);
    if(!journeys.length)return '<p class="bd-empty">No account journeys with a track attribution in this range.</p>';

    var edgeCounts={};
    journeys.forEach(function(j){
      var k=(j.source||"direct")+"\u0000"+j.last_track;
      edgeCounts[k]=(edgeCounts[k]||0)+1;
    });
    var sourceNames=[], trackNames=[];
    Object.keys(edgeCounts).sort(function(a,b){return edgeCounts[b]-edgeCounts[a];}).forEach(function(k){
      var p=k.split("\u0000");
      if(sourceNames.indexOf(p[0])<0&&sourceNames.length<6)sourceNames.push(p[0]);
      if(trackNames.indexOf(p[1])<0&&trackNames.length<9)trackNames.push(p[1]);
    });
    journeys=journeys.filter(function(j){
      return sourceNames.indexOf(j.source||"direct")>=0&&trackNames.indexOf(j.last_track)>=0;
    }).slice(0,14);

    var W=920,H=Math.max(390,Math.max(sourceNames.length,trackNames.length,journeys.length)*34+70);
    function y(i,n){return 46+(H-92)*(n<=1?.5:i/(n-1));}
    function short(s,n){s=String(s||"");return s.length>n?s.slice(0,n-1)+"…":s;}
    var srcPos={},trkPos={},acctPos={};
    sourceNames.forEach(function(n,i){srcPos[n]={x:30,y:y(i,sourceNames.length)};});
    trackNames.forEach(function(n,i){trkPos[n]={x:335,y:y(i,trackNames.length)};});
    journeys.forEach(function(j,i){acctPos[i]={x:675,y:y(i,journeys.length)};});

    var links=[];
    Object.keys(edgeCounts).forEach(function(k){
      var p=k.split("\u0000"),a=srcPos[p[0]],b=trkPos[p[1]];
      if(!a||!b)return;
      var sw=Math.max(1.5,Math.min(10,1+edgeCounts[k]*1.6));
      links.push('<path class="rel-link" stroke-width="'+sw+'" d="M '+(a.x+180)+' '+a.y+' C 275 '+a.y+', 285 '+b.y+', '+b.x+' '+b.y+'"/>');
    });
    journeys.forEach(function(j,i){
      var a=trkPos[j.last_track],b=acctPos[i];if(!a||!b)return;
      links.push('<path class="rel-link" stroke-width="1.5" d="M '+(a.x+210)+' '+a.y+' C 595 '+a.y+', 615 '+b.y+', '+b.x+' '+b.y+'"/>');
    });

    function node(x,y,w,label,cls,note){
      return '<g><rect class="rel-node '+(cls||"")+'" x="'+x+'" y="'+(y-13)+'" width="'+w+'" height="26" rx="7"/>'+
        '<text class="rel-label" x="'+(x+9)+'" y="'+(y+4)+'">'+esc(short(label,28))+'</text>'+
        (note?'<text class="rel-note" x="'+(x+9)+'" y="'+(y+26)+'">'+esc(short(note,32))+'</text>':"")+'</g>';
    }
    var nodes=[];
    sourceNames.forEach(function(n){nodes.push(node(srcPos[n].x,srcPos[n].y,180,n,"","source"));});
    trackNames.forEach(function(n){nodes.push(node(trkPos[n].x,trkPos[n].y,210,n,"rel-node--track","track"));});
    journeys.forEach(function(j,i){
      var who=[j.first_name,j.last_name].filter(Boolean).join(" ")||j.email||"account";
      nodes.push(node(acctPos[i].x,acctPos[i].y,215,who,"rel-node--account",j.minutes_after_last_track==null?"account":j.minutes_after_last_track+"m after last play"));
    });
    return '<div class="rel-scroll"><svg class="rel-graph" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Acquisition source to song to account relationship graph">'+links.join("")+nodes.join("")+'</svg></div>';
  }
  function renderIdentity(){
    var d=state.identity||{},cov=d.coverage||{},tracks=d.tracks||[],journeys=d.journeys||[];
    $("identityCoverage").innerHTML=
      statBox((cov.accounts||0).toLocaleString(),"accounts in range")+
      statBox((cov.bridged_accounts||0).toLocaleString(),"device-linked","verified account event bridge")+
      statBox((cov.attributed_accounts||0).toLocaleString(),"song-attributed","last track within 7 days")+
      statBox((cov.accounts_with_ip||0).toLocaleString(),"with IP context")+
      statBox((cov.accounts_with_location||0).toLocaleString(),"with location context");
    $("identityFlow").innerHTML=relationGraph(d);

    $("identityTracks").innerHTML=tracks.length?'<div class="bd-scroll"><table class="bd-table"><thead><tr>'+
      '<th>Track</th><th class="n">Listeners</th><th class="n">Assisted accounts</th><th class="n">Last-touch accounts</th>'+
      '<th class="n">Last-touch rate</th><th class="n">Avg time to signup</th></tr></thead><tbody>'+
      tracks.map(function(r){return '<tr><td><b>'+esc(r.track)+'</b></td><td class="n">'+esc(r.listeners)+'</td>'+
        '<td class="n">'+esc(r.assisted_accounts)+'</td><td class="n">'+esc(r.last_touch_accounts)+'</td>'+
        '<td class="n">'+esc(r.signup_rate_pct==null?"—":r.signup_rate_pct+"%")+'</td>'+
        '<td class="n">'+esc(r.avg_minutes_to_signup==null?"—":r.avg_minutes_to_signup+"m")+'</td></tr>';}).join("")+
      '</tbody></table></div>':'<p class="bd-empty">No track-attributed accounts in this range.</p>';

    $("identityJourneys").innerHTML=journeys.length?'<div class="bd-scroll"><table class="bd-table forensics-table"><thead><tr>'+
      '<th>Created</th><th>Account</th><th>Source → track</th><th>Timing</th><th>Network / location</th><th>Device</th></tr></thead><tbody>'+
      journeys.map(function(j){
        var who=[j.first_name,j.last_name].filter(Boolean).join(" ");
        var loc=[j.city,j.region,j.country,j.postal].filter(Boolean).join(", ");
        var dev=j.device||{};
        return '<tr><td>'+esc(fmtDate(j.created_at))+'</td><td><div class="forensics-detail"><b>'+esc(who||"—")+'</b><code>'+esc(j.email||j.user_id||"—")+'</code></div></td>'+
          '<td><div class="forensics-detail"><span>'+esc(j.source||"direct")+'</span><b>'+esc(j.last_track||"No track")+'</b></div></td>'+
          '<td>'+esc(j.minutes_after_last_track==null?"—":j.minutes_after_last_track+" min")+'</td>'+
          '<td><div class="forensics-detail"><code>'+esc(j.ip||"—")+'</code><span>'+esc(loc||"—")+'</span><span>'+esc(j.network||"—")+(j.asn?" · AS"+esc(j.asn):"")+'</span></div></td>'+
          '<td><div class="forensics-detail"><span>'+esc(dev.platform||"—")+(dev.mobile===true?" · mobile":dev.mobile===false?" · desktop":"")+'</span>'+
          '<span>'+esc(dev.screen||"—")+' · '+esc(dev.memory_gb_bucket==null?"memory —":dev.memory_gb_bucket+" GB bucket")+'</span>'+
          '<code>'+esc(j.session_id||"—")+'</code></div></td></tr>';
      }).join("")+'</tbody></table></div>':'<p class="bd-empty">No account creations in this range.</p>';
  }
  function renderForensics(){
    var rows=state.forensics||[];
    $("forensicsEvents").innerHTML=rows.length?'<div class="bd-scroll"><table class="bd-table forensics-table"><thead><tr>'+
      '<th>Time</th><th>Event</th><th>IP</th><th>Location</th><th>Network</th><th>Device / session</th></tr></thead><tbody>'+
      rows.map(function(e){
        var loc=[e.city,e.region,e.country,e.postal].filter(Boolean).join(", ");
        var dev=e.device||{};
        return '<tr><td>'+esc(fmtDate(e.at))+'</td><td><b>'+esc(e.name)+'</b><br><span class="muted">'+esc(e.path||"")+'</span></td>'+
          '<td><code>'+esc(e.ip||"—")+'</code></td><td><div class="forensics-detail"><span>'+esc(loc||"—")+'</span>'+
          '<span>'+esc(e.latitude==null?"":e.latitude)+(e.longitude==null?"":" · "+esc(e.longitude))+'</span></div></td>'+
          '<td><div class="forensics-detail"><span>'+esc(e.asn_org||"—")+(e.asn?" · AS"+esc(e.asn):"")+'</span><span>'+esc(dev.network&&dev.network.effective||"")+'</span></div></td>'+
          '<td><div class="forensics-detail"><span>'+esc(dev.platform||"—")+' · '+esc(dev.screen||"—")+'</span><code>'+esc(e.device_id||"—")+'</code><code>'+esc(e.session_id||"—")+'</code></div></td></tr>';
      }).join("")+'</tbody></table></div>':'<p class="bd-empty">No raw events in this range.</p>';
  }
  function identityCsv(){
    var rows=(state.identity&&state.identity.journeys)||[];
    if(!rows.length)return;
    var cols=["created_at","email","first_name","last_name","source","last_track","minutes_after_last_track","ip","country","region","city","postal","latitude","longitude","timezone","asn","network","device_id","session_id"];
    function cell(v){v=v==null?"":String(v);if(/^[=+\-@]/.test(v))v="'"+v;return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}
    var body=cols.join(",")+"\n"+rows.map(function(r){return cols.map(function(k){return cell(r[k]);}).join(",");}).join("\n");
    var blob=new Blob([body],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="mccluster-signup-attribution-"+new Date().toISOString().slice(0,10)+".csv";document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},2000);
  }
  function loadIdentity(){
    var tab=$("anIdentityTab");
    var eligible=isDesk&&state.selected&&state.selected.id===FIRST_PARTY;
    if(tab)tab.hidden=!eligible;
    if(!eligible)return Promise.resolve();
    var range=state.range;
    if(!range){
      var now=new Date(),since=new Date(now.getTime()-7*86400000);
      range={since:since.toISOString(),until:now.toISOString(),label:"7 days"};
    }
    $("identityStamp").textContent="Reading identity relationships…";
    var q="?since="+encodeURIComponent(range.since)+"&until="+encodeURIComponent(range.until);
    return Promise.all([
      api("/v1/analytics/identity"+q),
      api("/v1/analytics/forensics"+q+"&limit=100")
    ]).then(function(out){
      state.identity=out[0]||{};
      state.forensics=(out[1]&&out[1].events)||[];
      renderIdentity();renderForensics();
      $("identityStamp").textContent="Owner-only · "+(range.label||"selected range")+" · "+new Date().toLocaleString();
    }).catch(function(e){
      $("identityFlow").innerHTML='<p class="ins__none ins__none--stop"><b>Identity analytics did not load.</b> '+esc(e.message||e)+'</p>';
      $("forensicsEvents").innerHTML="";
      $("identityStamp").textContent="";
    });
  }

  function mountBoard(){
    if(board||!window.MCCBoard) return;
    board=window.MCCBoard.mount({
      rangeHost:$("bdRanges"),
      boardHost:$("bdBoard"),
      /* The board asks for double the range so its deltas have a baseline; the
         note explains a cap or an empty read in the page's own terms. */
      fetch:function(request){
        var site=state.selected;
        if(!site) return Promise.reject(new Error("Choose a property to report on."));
        return fetchAnalytics(site,request);
      }
    });
  }

  function selectSite(id){
    var site=state.sites.find(function(s){return s.id===id;});if(!site)return;
    state.selected=site;
    if(site.id===FIRST_PARTY){
      $("install").innerHTML='<p><b>'+esc(site.name)+'</b></p><p class="muted">This property is the site you are '+
        'reading this on. Its pixel is already built in — there is nothing to install and no domain to verify.</p>';
    }else{
      renderInstall(site);
    }
    window.MCC_ANALYTICS_PROPERTY={
      site_id:siteUuid(site),site_name:site.name,first_party:site.id===FIRST_PARTY
    };
    try{document.dispatchEvent(new CustomEvent("mcc:analytics-property",{detail:window.MCC_ANALYTICS_PROPERTY}));}catch(_){}
    $("bdWho").textContent="Traffic · "+site.name;
    $("bdScope").textContent=site.id===FIRST_PARTY
      ? "First-party events from this site, read straight from the collector."
      : "Events attributed to this property by its site key.";
    mountBoard();
    if(board) board.reload();
    loadIdentity();
  }
  function loadSites(){
    return rest("analytics_sites?select=id,name,public_key,status,consent_mode,created_at,analytics_site_domains(id,hostname,verified_at,verification_method,verification_token,enabled)&order=created_at.desc")
      .then(function(rows){
        state.sites=(rows||[]).slice();
        /* Listed first: it is the property with the traffic on it, and burying
           it under a client's empty site is how this page came to look dead. */
        if(isDesk) state.sites.unshift({
          id:FIRST_PARTY,name:"This site (first-party)",public_key:null,
          consent_mode:"required",analytics_site_domains:[]
        });
        renderSites();
        if(state.selected){var id=state.selected.id;state.selected=null;selectSite(id);}
        else if(state.sites[0])selectSite(state.sites[0].id);
      });
  }
  function createSite(){
    var name=$("siteName").value.trim(), h=host($("hostname").value), mode=$("consentMode").value;
    if(!name)return alert("Name the site.");
    if($("hostname").value.trim()&&!h)return alert("Enter a hostname like example.com.");
    $("createSite").disabled=true;
    rest("analytics_sites",{method:"POST",prefer:"return=representation",body:{name:name,consent_mode:mode}})
      .then(function(rows){
        var site=rows&&rows[0];if(!site)throw new Error("Site was not created.");
        if(!h)return site;
        return rest("analytics_site_domains",{method:"POST",prefer:"return=representation",body:{site_id:site.id,hostname:h}}).then(function(){return site;});
      }).then(function(){
        $("siteName").value="";$("hostname").value="";return loadSites();
      }).catch(function(e){alert(e.message);})
      .finally(function(){$("createSite").disabled=false;});
  }

  function boot(){
    if(!SUPA||!AUTH){$("authMsg").textContent="Account backend did not load.";return;}
    var user=AUTH.user&&AUTH.user();
    if(!user){
      $("auth").classList.remove("hidden");$("app").classList.add("hidden");return;
    }
    $("auth").classList.add("hidden");$("app").classList.remove("hidden");
    askIsDesk().then(function(desk){
      isDesk=desk;
      return loadSites();
    }).catch(function(e){$("sites").innerHTML='<p class="danger">'+esc(e.message)+'</p>';});
  }

  document.addEventListener("mcc:range",function(e){
    if(!e||!e.detail||!e.detail.since||!e.detail.until)return;
    state.range=e.detail;
    loadIdentity();
  });
  if($("identityCsv"))$("identityCsv").onclick=identityCsv;

  $("createSite").onclick=createSite;
  $("signIn").onclick=function(){
    var email=$("email").value.trim(),password=$("password").value;if(!email||!password)return;
    $("authMsg").textContent="Signing in…";
    AUTH.signInPassword(email,password).then(function(){location.reload();}).catch(function(e){$("authMsg").textContent=e.message;});
  };
  boot();
})();