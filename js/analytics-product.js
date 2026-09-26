(function(){
  "use strict";
  var SUPA=window.MCC_SUPA, AUTH=window.MCC_AUTH;
  var state={sites:[],selected:null,events:[],sessions:[]};
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
  function groupRecentSessions(rows){
    var by={};
    (rows||[]).forEach(function(e){
      if(e.is_bot===true||!e.session_id)return;
      var x=by[e.session_id]||(by[e.session_id]={
        session_id:e.session_id,started_at:e.at,ended_at:e.at,device_id:e.device_id||null,
        ip:e.ip||null,country:e.country||null,region:e.region||null,city:e.city||null,
        postal:e.postal||null,latitude:e.latitude,longitude:e.longitude,timezone:e.timezone||null,
        asn:e.asn||null,network:e.asn_org||null,user_agent:e.user_agent||null,
        entry_page:null,exit_page:null,entry_at:null,exit_at:null,referrer:null,
        events:0,pages:0,clicks:0,errors:0,conversions:0,device:e.device||{}
      });
      if(new Date(e.at)<new Date(x.started_at))x.started_at=e.at;
      if(new Date(e.at)>new Date(x.ended_at))x.ended_at=e.at;
      ["device_id","ip","country","region","city","postal","timezone","asn","network","user_agent"].forEach(function(k){
        var source=k==="network"?e.asn_org:e[k]; if(x[k]==null&&source!=null)x[k]=source;
      });
      if((!x.device||!Object.keys(x.device).length)&&e.device)x.device=e.device;
      x.events++;
      if(e.name==="page_view"||e.name==="view"){
        x.pages++;
        if(!x.entry_at||new Date(e.at)<new Date(x.entry_at)){x.entry_at=e.at;x.entry_page=e.path;}
        if(!x.exit_at||new Date(e.at)>new Date(x.exit_at)){x.exit_at=e.at;x.exit_page=e.path;}
      }
      if(e.name==="click"||e.name==="cta_click")x.clicks++;
      if(e.name==="js_error"||e.name==="js_rejection")x.errors++;
      if(["conversion","form_submit","checkout","purchase","account_created"].indexOf(e.name)>=0)x.conversions++;
      if(!x.referrer&&e.referrer)x.referrer=e.referrer;
    });
    return Object.keys(by).map(function(k){return by[k];})
      .sort(function(a,b){return new Date(b.ended_at)-new Date(a.ended_at);}).slice(0,50);
  }
  function recentEvents(site,request){
    /* Recent-event/session inspection is intentionally bounded. Aggregate
       reporting above is server-side and complete; this is the drill-down
       window behind it, not the source of historical totals. */
    return rest("events?"+scopeFilter(site)+
      "&at=gte."+encodeURIComponent(request.since)+
      "&at=lt."+encodeURIComponent(request.until)+
      "&select=at,name,path,session_id,device_id,ip,country,region,city,postal,latitude,longitude,timezone,asn,asn_org,user_agent,is_bot,device,edge,referrer,source_host"+
      "&order=at.desc&limit=800").then(function(rows){
        state.events=rows||[];
        state.sessions=groupRecentSessions(state.events);
        renderRecent(); renderSessions();
      }).catch(function(e){
        state.events=[];state.sessions=[];renderRecent();renderSessions(e);
      });
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

  function locationLabel(r){
    return [r.city,r.region,r.country].filter(Boolean).join(", ") || "—";
  }
  function renderRecent(){
    var human=state.events.filter(function(e){return e.is_bot!==true;});
    if(!human.length){$("recent").innerHTML='<p class="bd-empty">No events in this window.</p>';return;}
    $("recent").innerHTML='<div class="bd-scroll"><table class="bd-table"><thead><tr><th>Time</th><th>Event</th><th>Path</th><th>Location</th><th>IP</th><th>Network</th></tr></thead><tbody>'+
      human.slice(0,50).map(function(e){
        return '<tr><td>'+esc(new Date(e.at).toLocaleString())+'</td><td>'+esc(e.name)+'</td><td>'+esc(e.path)+
          '</td><td>'+esc(locationLabel(e))+'</td><td><code>'+esc(e.ip||"—")+'</code></td><td>'+esc(e.asn_org||"—")+'</td></tr>';
      }).join("")+'</tbody></table></div>'+
      '<p class="bd-foot">Location is IP-derived and approximate. GPC/DNT rows intentionally omit IP, city, coordinates, session and device identifiers.</p>';
  }
  function renderSessions(err){
    var host=$("sessions");
    if(!host)return;
    if(err){host.innerHTML='<p class="bd-empty danger">Session detail did not load: '+esc(err.message||err)+'</p>';return;}
    if(!state.sessions.length){host.innerHTML='<p class="bd-empty">No identifiable sessions in this window.</p>';return;}
    host.innerHTML='<div class="an-session-list">'+state.sessions.map(function(s){
      var where=locationLabel(s);
      var coords=(s.latitude!=null&&s.longitude!=null)
        ? Number(s.latitude).toFixed(3)+", "+Number(s.longitude).toFixed(3)+" · IP-derived" : "—";
      var dev=s.device||{}, net=dev.network||{};
      var deviceBits=[
        dev.platform||"",dev.mobile===true?"mobile":"",dev.vw&&dev.vh?(dev.vw+"×"+dev.vh):"",
        net.effective?("network "+net.effective):""
      ].filter(Boolean).join(" · ");
      return '<details class="an-session"><summary><span><b>'+esc(where)+'</b><small>'+
        esc(new Date(s.started_at).toLocaleString())+' → '+esc(new Date(s.ended_at).toLocaleTimeString())+
        '</small></span><span><code>'+esc(s.ip||"privacy-suppressed")+'</code><small>'+
        esc(Number(s.events||0).toLocaleString())+' events · '+esc(Number(s.pages||0).toLocaleString())+' pages</small></span></summary>'+
        '<div class="an-session-grid">'+
          '<div><b>Network</b><span>'+esc(s.network||"—")+(s.asn?" · AS"+esc(s.asn):"")+'</span></div>'+
          '<div><b>Region</b><span>'+esc(where)+(s.postal?" · "+esc(s.postal):"")+'</span></div>'+
          '<div><b>Approx. coordinates</b><span>'+esc(coords)+'</span></div>'+
          '<div><b>Timezone</b><span>'+esc(s.timezone||"—")+'</span></div>'+
          '<div><b>Entry → exit</b><span>'+esc(s.entry_page||"—")+' → '+esc(s.exit_page||"—")+'</span></div>'+
          '<div><b>Referrer</b><span>'+esc(s.referrer||"direct")+'</span></div>'+
          '<div><b>Device</b><span>'+esc(deviceBits||s.user_agent||"—")+'</span></div>'+
  
          '<div><b>Session ID</b><span><code>'+esc(s.session_id||"—")+'</code></span></div>'+
          '<div><b>Device ID</b><span><code>'+esc(s.device_id||"—")+'</code></span></div>'+
          '<div><b>Errors</b><span>'+esc(s.errors||0)+'</span></div>'+
          '<div><b>Conversions</b><span>'+esc(s.conversions||0)+'</span></div>'+
        '</div></details>';
    }).join("")+'</div><p class="bd-foot">Session inspector groups the 800 newest raw events in the selected window into the 50 most recent identifiable sessions. Aggregate totals above remain complete and server-side.</p>';
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

  $("createSite").onclick=createSite;
  $("signIn").onclick=function(){
    var email=$("email").value.trim(),password=$("password").value;if(!email||!password)return;
    $("authMsg").textContent="Signing in…";
    AUTH.signInPassword(email,password).then(function(){location.reload();}).catch(function(e){$("authMsg").textContent=e.message;});
  };
  boot();
})();