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
      var row=document.createElement("div");row.className="site";
      row.innerHTML='<div><b>'+esc(site.name)+'</b><div class="muted">'+esc(domains.map(function(d){return d.hostname;}).join(", ")||"No domain")+'</div></div>'+
        '<div class="row" style="flex:0 0 auto"><span class="badge '+(verified?"ok":"danger")+'">'+(verified?"verified":"verify domain")+'</span><button class="alt">Open</button></div>';
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

  function countBy(rows,fn){
    var m=new Map();rows.forEach(function(r){var k=fn(r);if(!k)return;m.set(k,(m.get(k)||0)+1);});
    return Array.from(m.entries()).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
  }
  function list(elId,items){
    var el=$(elId);if(!items.length){el.innerHTML='<p class="muted">No data yet.</p>';return;}
    el.innerHTML='<table><tbody>'+items.map(function(x){return '<tr><td>'+esc(x[0])+'</td><td>'+x[1]+'</td></tr>';}).join("")+'</tbody></table>';
  }
  function renderMetrics(){
    var human=state.events.filter(function(e){return e.is_bot!==true;});
    var pv=human.filter(function(e){return e.name==="page_view";});
    var sessions=new Set(human.map(function(e){return e.session_id;}).filter(Boolean));
    var visitors=new Set(human.map(function(e){return e.device_id;}).filter(Boolean));
    var rtts=human.map(function(e){return Number(e.edge&&e.edge["cf-client-tcp-rtt"]);}).filter(function(n){return isFinite(n)&&n>=0;});
    $("mPageviews").textContent=pv.length;
    $("mSessions").textContent=sessions.size;
    $("mVisitors").textContent=visitors.size||"—";
    $("mRtt").textContent=rtts.length?Math.round(rtts.reduce(function(a,b){return a+b;},0)/rtts.length)+" ms":"—";
    list("pages",countBy(pv,function(e){return e.path||"/";}));
    list("countries",countBy(human,function(e){return e.country||"Unknown";}));
    list("networks",countBy(human,function(e){return (e.device&&e.device.network&&e.device.network.effective)||e.asn_org||"Unknown";}));
    $("recent").innerHTML='<table><thead><tr><th>Time</th><th>Event</th><th>Path</th><th>Network</th></tr></thead><tbody>'+
      human.slice(0,50).map(function(e){return '<tr><td>'+esc(new Date(e.at).toLocaleString())+'</td><td>'+esc(e.name)+'</td><td>'+esc(e.path)+'</td><td>'+esc((e.device&&e.device.network&&e.device.network.effective)||e.asn_org||"")+'</td></tr>';}).join("")+'</tbody></table>';
  }

  function loadEvents(site){
    var since=new Date(Date.now()-7*86400000).toISOString();
    return rest("events?site_id=eq."+encodeURIComponent(site.id)+"&at=gte."+encodeURIComponent(since)+"&select=at,name,path,session_id,device_id,country,city,asn_org,is_bot,device,edge&order=at.desc&limit=3000")
      .then(function(rows){state.events=rows||[];renderMetrics();});
  }
  function selectSite(id){
    var site=state.sites.find(function(s){return s.id===id;});if(!site)return;
    state.selected=site;renderInstall(site);loadEvents(site).catch(function(e){$("recent").innerHTML='<p class="danger">'+esc(e.message)+'</p>';});
  }
  function loadSites(){
    return rest("analytics_sites?select=id,name,public_key,status,consent_mode,created_at,analytics_site_domains(id,hostname,verified_at,verification_method,verification_token,enabled)&order=created_at.desc")
      .then(function(rows){
        state.sites=rows||[];renderSites();
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
    loadSites().catch(function(e){$("sites").innerHTML='<p class="danger">'+esc(e.message)+'</p>';});
  }

  $("createSite").onclick=createSite;
  $("sendLink").onclick=function(){
    var email=$("email").value.trim();if(!email)return;
    $("authMsg").textContent="Sending…";
    AUTH.signIn(email).then(function(){$("authMsg").textContent="Check your email for the sign-in link.";}).catch(function(e){$("authMsg").textContent=e.message;});
  };
  boot();
})();