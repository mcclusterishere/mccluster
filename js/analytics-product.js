(function(){
  "use strict";
  var SUPA=window.MCC_SUPA, AUTH=window.MCC_AUTH;
  var state={sites:[],selected:null,events:[]};
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

  /* Newest first, so a window that hits the cap keeps the days somebody is
     actually looking at and loses the far edge — which the board then says out
     loud rather than drawing a confident line through a short day. */
  function fetchEvents(site,days){
    var since=new Date(Date.now()-(days-1)*86400000);
    since.setHours(0,0,0,0);
    return rest("events?"+scopeFilter(site)+
      "&at=gte."+encodeURIComponent(since.toISOString())+
      "&select=at,name,path,session_id,device_id,country,city,asn_org,is_bot,device,edge,referrer"+
      "&order=at.desc&limit=20000")
      .then(function(rows){
        state.events=rows||[];
        renderRecent();
        return {traffic:window.MCCBoard.rollup(state.events,{since:since,days:days})};
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

  function mountBoard(){
    if(board||!window.MCCBoard) return;
    board=window.MCCBoard.mount({
      rangeHost:$("bdRanges"),
      boardHost:$("bdBoard"),
      /* The board asks for double the range so its deltas have a baseline; the
         note explains a cap or an empty read in the page's own terms. */
      fetch:function(days){
        var site=state.selected;
        if(!site) return Promise.reject(new Error("Choose a property to report on."));
        return fetchEvents(site,days);
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