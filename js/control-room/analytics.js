/* Native Control Analytics — no iframe, no second analytics backend. */
(function () {
  "use strict";
  window.CR=window.CR||{};
  var FIRST="__first_party__", palette=["#e5383b","#3f93d2","#d9a441","#75b798","#9c7ae8","#e27d60"];
  var S={host:null,request:null,supa:null,section:"overview",rangeId:"7d",from:"",through:"",range:null,sites:[],site:FIRST,loading:false,loaded:false,error:null,errors:{},data:{},seq:0};
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function n(v){v=Number(v);return Number.isFinite(v)?v.toLocaleString():"—";}
  function money(v){v=Number(v);return Number.isFinite(v)?"$"+(v/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):"—";}
  function tz(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";}catch(_){return"UTC";}}
  function day(v){var d=new Date(v);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
  function inputDate(d){d=new Date(d.getTime()-d.getTimezoneOffset()*60000);return d.toISOString().slice(0,10);}
  function localStart(s){var p=String(s||"").split("-").map(Number);return p[0]?new Date(p[0],p[1]-1,p[2],0,0,0,0):null;}
  function localEnd(s){var d=localStart(s);if(!d)return null;d.setDate(d.getDate()+1);return d;}
  function range(id){
    var until=new Date(),since=new Date(until),compare=true,label=id;
    if(id==="24h"){since=new Date(until-86400000);label="24 hours";}
    else if(id==="7d"){since=new Date(until-7*86400000);label="7 days";}
    else if(id==="30d"){since=new Date(until-30*86400000);label="30 days";}
    else if(id==="90d"){since=new Date(until-90*86400000);label="90 days";}
    else if(id==="all"){since=new Date("2026-07-17T00:00:00Z");label="All time";compare=false;}
    else if(id==="custom"){var f=localStart(S.from),t=localEnd(S.through);if(!f||!t||f>=t)return null;since=f;until=t;label=S.from+" → "+S.through;compare=false;}
    var span=Math.max(1,until-since);
    return{id:id,label:label,since:since.toISOString(),until:until.toISOString(),querySince:compare?new Date(since.getTime()-span).toISOString():since.toISOString(),compare:compare,window:id==="24h"?"24h":id==="7d"?"7d":id==="30d"?"30d":id==="90d"?"90d":null};
  }
  function sid(){return S.site===FIRST?null:S.site;}
  function settled(name,p){return p.then(function(v){return{name:name,ok:true,value:v};}).catch(function(err){return{name:name,ok:false,error:err};});}
  function rpc(name,body){return S.supa("rpc/"+name,{method:"POST",body:body});}
  function top(rows,key){return(rows||[]).map(function(r){var o={count:Number(r.n)||0};o[key]=r.key;return o;});}
  function kpi(label,value,sub){return'<div class="cra-kpi"><small>'+e(label)+'</small><strong>'+e(value)+'</strong>'+(sub?'<span>'+e(sub)+'</span>':"")+'</div>';}
  function card(title,sub,body,wide){return'<section class="cra-card'+(wide?" cra-card--wide":"")+'"><h2>'+e(title)+'</h2>'+(sub?'<p>'+e(sub)+'</p>':"")+body+'</section>';}
  function err(name){var x=S.errors[name];return x?'<div class="cra-error"><b>'+e(name)+'</b> did not load: '+e(x.message||x)+'</div>':"";}
  function line(rows,a,b,la,lb){
    rows=(rows||[]).slice().sort(function(x,y){return String(x.day).localeCompare(String(y.day));});
    if(!rows.length)return'<p>No series in this range.</p>';
    var W=720,H=260,P={l:42,r:18,t:18,b:36},mx=1;
    rows.forEach(function(r){mx=Math.max(mx,Number(r[a])||0,b?Number(r[b])||0:0);});
    function X(i){return P.l+(rows.length===1?0:i/(rows.length-1)*(W-P.l-P.r));}
    function Y(v){return H-P.b-(Number(v)||0)/mx*(H-P.t-P.b);}
    function pts(k){return rows.map(function(r,i){return X(i).toFixed(1)+","+Y(r[k]).toFixed(1);}).join(" ");}
    var p1=pts(a),p2=b?pts(b):"",area=p1+" "+X(rows.length-1)+","+(H-P.b)+" "+P.l+","+(H-P.b);
    var s=['<svg class="cra-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+e(la+(lb?" and "+lb:"")+" over time")+'">'];
    [0,.25,.5,.75,1].forEach(function(q){var y=Y(mx*q);s.push('<line class="cra-gridline" x1="'+P.l+'" y1="'+y+'" x2="'+(W-P.r)+'" y2="'+y+'"/><text class="cra-axis" x="'+(P.l-6)+'" y="'+(y+3)+'" text-anchor="end">'+Math.round(mx*q)+'</text>');});
    s.push('<polygon class="cra-area" points="'+area+'"/><polyline class="cra-line" points="'+p1+'"/>');if(b)s.push('<polyline class="cra-line cra-line--alt" points="'+p2+'"/>');
    var step=Math.max(1,Math.ceil(rows.length/6));rows.forEach(function(r,i){if(i%step===0||i===rows.length-1)s.push('<text class="cra-axis" x="'+X(i)+'" y="'+(H-12)+'" text-anchor="middle">'+e(String(r.day||"").slice(5))+'</text>');});s.push("</svg>");
    return'<div class="cra-legend"><div class="cra-legend__row"><i class="cra-legend__swatch" style="--swatch:#3f93d2"></i><span class="cra-legend__label">'+e(la)+'</span><b></b></div>'+(b?'<div class="cra-legend__row"><i class="cra-legend__swatch" style="--swatch:#e5383b"></i><span class="cra-legend__label">'+e(lb)+'</span><b></b></div>':"")+'</div>'+s.join("");
  }
  function donut(rows,labelKey,valueKey){
    rows=(rows||[]).slice(0,7).map(function(r){return{label:String(r[labelKey]||r.key||"Unknown"),value:Number(r[valueKey]||r.n||r.count||0)};}).filter(function(r){return r.value>0;});
    if(!rows.length)return'<p>No breakdown in this range.</p>';
    var total=rows.reduce(function(a,r){return a+r.value;},0),C=2*Math.PI*42,off=0;
    var circles=rows.map(function(r,i){var len=C*r.value/total,c=palette[i%palette.length],out='<circle class="cra-donut__seg" cx="60" cy="60" r="42" stroke="'+c+'" stroke-dasharray="'+len.toFixed(2)+' '+(C-len).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'"/>';off+=len;return out;}).join("");
    return'<div class="cra-donut-wrap"><svg class="cra-donut" viewBox="0 0 120 120"><circle class="cra-donut__track" cx="60" cy="60" r="42"/>'+circles+'</svg><div class="cra-legend">'+rows.map(function(r,i){return'<div class="cra-legend__row"><i class="cra-legend__swatch" style="--swatch:'+palette[i%palette.length]+'"></i><span class="cra-legend__label">'+e(r.label)+'</span><b class="cra-legend__value">'+n(r.value)+'</b></div>';}).join("")+'</div></div>';
  }
  function rank(rows,labelKey,valueKey){
    rows=(rows||[]).slice(0,12);if(!rows.length)return'<p>Nothing to rank in this range.</p>';var mx=Math.max.apply(null,rows.map(function(r){return Number(r[valueKey]||r.n||r.count||0);}).concat([1]));
    return'<div class="cra-rank">'+rows.map(function(r){var v=Number(r[valueKey]||r.n||r.count||0),p=Math.max(1,v/mx*100);return'<div class="cra-rank__row"><i class="cra-rank__fill" style="--pct:'+p.toFixed(1)+'%"></i><span class="cra-rank__label">'+e(r[labelKey]||r.key||"Unknown")+'</span><b class="cra-rank__value">'+n(v)+'</b></div>';}).join("")+'</div>';
  }
  function funnel(rows){
    if(!rows||!rows.length)return'<p>No funnel rows in this range.</p>';var keys=[["arrived","Arrived"],["heard_something","Heard"],["engaged","Engaged"],["searched","Searched"],["asked_for_something","Asked"],["made_an_account","Account"],["confirmed_the_email","Confirmed"],["reached_checkout","Checkout"],["paid","Paid"]],tot={};keys.forEach(function(k){tot[k[0]]=0;});rows.forEach(function(r){keys.forEach(function(k){tot[k[0]]+=Number(r[k[0]])||0;});});var topv=tot.arrived||1;
    return'<div class="cra-funnel">'+keys.map(function(k){var v=tot[k[0]]||0,p=v/topv*100;return'<div class="cra-funnel__row"><span>'+e(k[1])+'</span><div class="cra-funnel__track"><i class="cra-funnel__fill" style="--pct:'+Math.max(.5,p).toFixed(1)+'%"></i></div><b>'+n(v)+' · '+p.toFixed(1)+'%</b></div>';}).join("")+'</div>';
  }
  function scatter(rows,identity){
    var map={};((identity&&identity.tracks)||[]).forEach(function(x){map[String(x.track||"").toLowerCase()]=x;});rows=(rows||[]).slice(0,24);if(!rows.length)return'<p>No track rows in this range.</p>';var W=720,H=300,P={l:44,r:20,t:20,b:42},mx=1,my=1;
    rows.forEach(function(r){mx=Math.max(mx,Number(r.listeners)||0);my=Math.max(my,Number(r.plays_per_listener)||0);});function X(v){return P.l+(Number(v)||0)/mx*(W-P.l-P.r);}function Y(v){return H-P.b-(Number(v)||0)/my*(H-P.t-P.b);}var s=['<svg class="cra-svg" viewBox="0 0 '+W+' '+H+'">'];[0,.25,.5,.75,1].forEach(function(q){var y=Y(my*q);s.push('<line class="cra-scatter__grid" x1="'+P.l+'" y1="'+y+'" x2="'+(W-P.r)+'" y2="'+y+'"/>');});rows.forEach(function(r,i){var a=map[String(r.track||"").toLowerCase()]||{},x=X(r.listeners),y=Y(r.plays_per_listener),rad=4+Math.min(8,Number(a.last_touch_accounts||0)*1.4);s.push('<circle class="cra-scatter__dot" cx="'+x+'" cy="'+y+'" r="'+rad+'"><title>'+e((r.track||"Track")+": "+n(r.listeners)+" listeners")+'</title></circle>');if(i<10)s.push('<text class="cra-scatter__label" x="'+(x+8)+'" y="'+(y-7)+'">'+e(String(r.track||"").slice(0,24))+'</text>');});s.push('<text class="cra-axis" x="380" y="290" text-anchor="middle">Unique listeners →</text></svg>');return s.join("");
  }
  function flow(data){
    var js=((data&&data.journeys)||[]).filter(function(j){return j.last_track;}).slice(0,16);if(!js.length)return'<p>No song-attributed account journeys in this range.</p>';var ss=[],ts=[];js.forEach(function(j){var s=j.source||"direct";if(ss.indexOf(s)<0&&ss.length<6)ss.push(s);if(ts.indexOf(j.last_track)<0&&ts.length<9)ts.push(j.last_track);});js=js.filter(function(j){return ss.indexOf(j.source||"direct")>=0&&ts.indexOf(j.last_track)>=0;}).slice(0,14);var W=920,H=Math.max(380,Math.max(ss.length,ts.length,js.length)*34+70),SP={},TP={},AP={};function Y(i,m){return 44+(H-88)*(m<=1?.5:i/(m-1));}ss.forEach(function(x,i){SP[x]={x:24,y:Y(i,ss.length)};});ts.forEach(function(x,i){TP[x]={x:330,y:Y(i,ts.length)};});js.forEach(function(x,i){AP[i]={x:680,y:Y(i,js.length)};});var ec={};js.forEach(function(j){var k=(j.source||"direct")+"\u0000"+j.last_track;ec[k]=(ec[k]||0)+1;});var out=['<div class="cra-flow-scroll"><svg class="cra-flow" viewBox="0 0 '+W+' '+H+'">'];Object.keys(ec).forEach(function(k){var p=k.split("\u0000"),a=SP[p[0]],b=TP[p[1]];if(a&&b)out.push('<path class="cra-flow__edge" stroke-width="'+Math.min(10,1+ec[k]*1.6)+'" d="M 196 '+a.y+' C 260 '+a.y+',270 '+b.y+',330 '+b.y+'"/>');});js.forEach(function(j,i){var a=TP[j.last_track],b=AP[i];if(a&&b)out.push('<path class="cra-flow__edge" stroke-width="1.4" d="M 548 '+a.y+' C 600 '+a.y+',625 '+b.y+',680 '+b.y+'"/>');});function node(x,y,w,l,cls,note){l=String(l||"");if(l.length>27)l=l.slice(0,26)+"…";return'<g><rect class="cra-flow__node '+(cls||"")+'" x="'+x+'" y="'+(y-13)+'" width="'+w+'" height="26" rx="7"/><text class="cra-flow__label" x="'+(x+8)+'" y="'+(y+4)+'">'+e(l)+'</text>'+(note?'<text class="cra-flow__note" x="'+(x+8)+'" y="'+(y+25)+'">'+e(note)+'</text>':"")+'</g>';}ss.forEach(function(x){out.push(node(SP[x].x,SP[x].y,172,x,"","source"));});ts.forEach(function(x){out.push(node(TP[x].x,TP[x].y,218,x,"cra-flow__node--accent","track"));});js.forEach(function(j,i){out.push(node(AP[i].x,AP[i].y,215,[j.first_name,j.last_name].filter(Boolean).join(" ")||j.email||"account","cra-flow__node--outcome",j.minutes_after_last_track==null?"account":j.minutes_after_last_track+"m after play"));});out.push("</svg></div>");return out.join("");
  }
  function tabs(){return'<nav class="cra-tabs">'+[["overview","Overview"],["audience","Audience"],["content","Content"],["identity","Identity"],["forensics","Forensics"],["setup","Setup"]].map(function(x){return'<button type="button" class="cra-tab'+(S.section===x[0]?" is-on":"")+'" data-cra-sec="'+x[0]+'">'+x[1]+'</button>';}).join("")+'</nav>';}
  function ranges(){var ids=[["24h","24h"],["7d","7 days"],["30d","30 days"],["90d","90 days"],["all","All"],["custom","Custom"]];return'<div class="cra-ranges">'+ids.map(function(x){return'<button type="button" class="cra-range'+(S.rangeId===x[0]?" is-on":"")+'" data-cra-range="'+x[0]+'">'+x[1]+'</button>';}).join("")+'</div><div class="cra-custom"'+(S.rangeId==="custom"?"":" hidden")+'><label>From<input class="cra-date" id="craFrom" type="date" value="'+e(S.from)+'"></label><label>Through<input class="cra-date" id="craThrough" type="date" value="'+e(S.through)+'"></label><button class="cr-btn cr-btn--primary" data-cra-apply type="button">Apply</button></div>';}
  function overview(){
    var t=S.data.traffic||{},tot=t.totals||{},b=S.data.business&&S.data.business.snapshot||{};
    return'<div class="cra-kpis">'+kpi("Page views",n(tot.page_views),S.range.label)+kpi("Visitors",n(tot.visitors),"unique")+kpi("Sessions",n(tot.sessions),"selected range")+kpi("Accounts",n(b.users&&(b.window?b.users.created_in_window:b.users.total)),b.window?"created":"all time")+kpi("Music plays",n(b.music&&b.music.plays&&(b.window?b.music.plays.in_window:b.music.plays.total)),"plays")+kpi("Gross music",money(b.music&&b.music.revenue&&(b.window?b.music.revenue.gross_cents_in_window:b.music.revenue.gross_cents)),"revenue")+'</div><div class="cra-grid">'+card("Traffic trend","Page views and visitors.",line(t.byDay,"page_views","visitors","Page views","Visitors"),true)+card("Acquisition mix","Top sources.",donut(t.sources,"source","count"))+card("Geography","Country distribution.",donut(t.countries,"country","count"))+card("Top pages","Highest traffic paths.",rank(t.pages,"path","count"))+card("Network","Observed connection/network.",rank(t.networks,"network","count"))+'</div>'+err("business")+err("daily")+err("totals");
  }
  function audience(){var scopedGap=sid()===null?"":'<div class="cra-error">Engagement and funnel are hidden for this external property because the deployed backend does not yet expose site-scoped versions of those two metrics. Control will not mix another property into this view.</div>';return scopedGap+'<div class="cra-grid">'+card("Engagement","Sessions and engaged sessions.",line(S.data.engagement||[],"sessions","engaged_sessions","Sessions","Engaged"),true)+card("Conversion funnel","People reaching each stage.",funnel(S.data.funnel||[]),true)+card("Acquisition quality","People by source.",donut(S.data.acquisition||[],"source","people"))+card("Paths","Page-to-page movement.",rank((S.data.paths||[]).map(function(r){return{label:r.from_page+" → "+r.to_page,count:r.moves};}),"label","count"))+'</div>'+["engagement","funnel","acquisition","paths"].map(err).join("");
  }
  function content(){
    var rows=(S.data.content||[]).slice().sort(function(a,b){return(Number(b.listeners)||0)-(Number(a.listeners)||0);}),ev=S.data.contentEvents||[];
    var table=rows.length?'<div class="cra-scroll"><table class="cra-table"><thead><tr><th>Track</th><th>Album</th><th class="n">Starts</th><th class="n">Listeners</th><th class="n">Repeat</th><th class="n">Starts/listener</th><th class="n">Full</th><th class="n">Complete</th><th class="n">Shares</th></tr></thead><tbody>'+rows.map(function(r){return'<tr><td><b>'+e(r.track||"—")+'</b></td><td>'+e(r.album||"—")+'</td><td class="n">'+n(r.starts)+'</td><td class="n">'+n(r.listeners)+'</td><td class="n">'+n(r.repeat_listeners)+'</td><td class="n">'+e(r.plays_per_listener==null?"—":r.plays_per_listener)+'</td><td class="n">'+n(r.full_plays)+'</td><td class="n">'+n(r.completions)+'</td><td class="n">'+n(r.shares)+'</td></tr>';}).join("")+'</tbody></table></div>':'<p>No content rows.</p>';
    return'<div class="cra-grid">'+card("Reach vs repeat","Right is reach. Up is starts per listener. Dot size reflects attributed accounts.",scatter(rows,S.data.identity),true)+card("Media event mix","Composition of player events.",donut(ev,"event_name","events"))+card("Top tracks","Starts by track.",rank(rows,"track","starts"))+card("Track detail","Full selected-window ledger.",table,true)+'</div>'+err("content")+err("contentEvents");
  }
  function identity(){
    var d=S.data.identity||{},c=d.coverage||{},j=d.journeys||[],t=d.tracks||[];
    var table=j.length?'<div class="cra-scroll"><table class="cra-table"><thead><tr><th>Created</th><th>Account</th><th>Source</th><th>Last track</th><th class="n">Minutes</th><th>Network/location</th></tr></thead><tbody>'+j.map(function(x){return'<tr><td>'+e(x.created_at?new Date(x.created_at).toLocaleString():"—")+'</td><td><b>'+e([x.first_name,x.last_name].filter(Boolean).join(" ")||x.email||x.user_id||"Account")+'</b><br><code>'+e(x.email||x.user_id||"")+'</code></td><td>'+e(x.source||"direct")+'</td><td>'+e(x.last_track||"—")+'</td><td class="n">'+e(x.minutes_after_last_track==null?"—":x.minutes_after_last_track)+'</td><td><code>'+e(x.ip||"—")+'</code><br>'+e([x.city,x.region,x.country].filter(Boolean).join(", ")||"—")+'<br>'+e(x.network||"—")+'</td></tr>';}).join("")+'</tbody></table></div>':'<p>No account journeys in this range.</p>';
    return'<div class="cra-kpis">'+kpi("Accounts",n(c.accounts),"created")+kpi("Device-linked",n(c.bridged_accounts),"verified bridge")+kpi("Song-attributed",n(c.attributed_accounts),"last touch")+kpi("IP context",n(c.accounts_with_ip),"owner only")+kpi("Location",n(c.accounts_with_location),"observed")+kpi("Tracks",n(t.length),"relationships")+'</div><div class="cra-grid">'+card("Source → track → account","Relationship flow. Attribution is not causation.",flow(d),true)+card("Last-touch accounts","By track.",rank(t,"track","last_touch_accounts"))+card("Assisted accounts","Tracks present in signup journeys.",rank(t,"track","assisted_accounts"))+card("Journeys","Owner-only audit detail.",table,true)+'</div>'+err("identity");
  }
  function forensics(){
    var rows=(S.data.forensics&&S.data.forensics.events)||[],table=rows.length?'<div class="cra-scroll"><table class="cra-table"><thead><tr><th>Time</th><th>Event</th><th>Path</th><th>IP</th><th>Location</th><th>Network</th><th>Device</th><th>Session</th></tr></thead><tbody>'+rows.map(function(x){var d=x.device||{};return'<tr><td>'+e(x.at?new Date(x.at).toLocaleString():"—")+'</td><td><b>'+e(x.name||"—")+'</b></td><td>'+e(x.path||"—")+'</td><td><code>'+e(x.ip||"—")+'</code></td><td>'+e([x.city,x.region,x.country,x.postal].filter(Boolean).join(", ")||"—")+'</td><td>'+e(x.asn_org||"—")+(x.asn?" · AS"+e(x.asn):"")+'</td><td>'+e(d.platform||"—")+(d.mobile===true?" · mobile":d.mobile===false?" · desktop":"")+'<br>'+e(d.screen||"")+'</td><td><code>'+e(x.session_id||"—")+'</code><br><code>'+e(x.device_id||"—")+'</code></td></tr>';}).join("")+'</tbody></table></div>':'<p>No raw events in this range.</p>';
    return'<div class="cra-grid">'+card("Owner-only telemetry","Recent first-party IP, approximate edge geography, ASN/network, device and session context.",table,true)+'</div>'+err("forensics");
  }
  function setup(){
    var rows=[{id:FIRST,name:"McCluster first-party"}].concat(S.sites||[]),sel=rows.find(function(x){return String(x.id)===String(S.site);})||rows[0],domains=sel.analytics_site_domains||[],d=domains[0],code=sel.id===FIRST?"Built into matthew.mccluster.org.":'<script async src="https://api.mccluster.org/a.js?site='+e(sel.public_key)+'&consent='+e(sel.consent_mode==="cookieless"?"cookieless":"required")+'"><\/script>';
    return'<div class="cra-grid">'+card("Properties","Choose which property Analytics reads.",'<div class="cra-rank">'+rows.map(function(x){return'<button type="button" class="cra-rank__row" data-cra-site="'+e(x.id)+'"><span class="cra-rank__label">'+e(x.name||x.id)+'</span><b class="cra-rank__value">'+(String(x.id)===String(S.site)?"Showing":"Open")+'</b></button>';}).join("")+'</div>')+card("Install / verify","Pixel setup remains part of Analytics, not another room.",'<pre class="cro-code">'+e(code)+'</pre>'+(d&&!d.verified_at?'<button class="cr-btn" type="button" data-cra-verify="'+e(d.id)+'">Verify DNS</button>':""))+'</div>';
  }
  function body(){return S.section==="audience"?audience():S.section==="content"?content():S.section==="identity"?identity():S.section==="forensics"?forensics():S.section==="setup"?setup():overview();}
  function render(){
    var st=S.loading?"Reading "+(S.range&&S.range.label||"analytics")+"…":S.error?"Analytics load failed":S.loaded?"Live · "+(S.range&&S.range.label||"")+" · "+tz():"Ready";
    return'<div class="cra"><div class="cra-head"><div class="cra-head__copy"><h1>Analytics</h1><p>Traffic, audience, content, identity, commerce and diagnostics. One range controls the whole panel.</p></div><select class="cra-property" id="craProperty">'+[{id:FIRST,name:"McCluster first-party"}].concat(S.sites||[]).map(function(x){return'<option value="'+e(x.id)+'"'+(String(x.id)===String(S.site)?" selected":"")+'>'+e(x.name||x.id)+'</option>';}).join("")+'</select></div>'+ranges()+'<div class="cra-state '+(S.loading?"is-loading":S.error?"is-error":"")+'"><i></i><span>'+e(st)+'</span></div>'+tabs()+body()+'</div>';
  }
  function paint(){if(!S.host)return;S.host.innerHTML=render();bind(S.host);}
  function loadSites(){return S.supa("analytics_sites?select=id,name,public_key,status,consent_mode,created_at,analytics_site_domains(id,hostname,verified_at,verification_method,verification_token,enabled)&order=created_at.desc").then(function(x){S.sites=x||[];}).catch(function(x){S.errors.sites=x;S.sites=[];});}
  function load(){
    var r=range(S.rangeId);if(!r){S.error=new Error("Choose a valid custom date range.");paint();return Promise.resolve();}S.range=r;var q=++S.seq;S.loading=true;S.error=null;S.errors={};paint();var site=sid(),args={p_since:r.since,p_until:r.until,p_site:site},daily={p_since:r.querySince,p_until:r.until,p_site:site,p_tz:tz()},through=day(new Date(new Date(r.until).getTime()-1)),from=day(r.since);
    var jobs=[
      settled("daily",rpc("analytics_daily",daily)),settled("totals",rpc("analytics_totals",args)),
      settled("pages",rpc("analytics_top",{p_dim:"page",p_since:r.since,p_until:r.until,p_site:site,p_limit:12})),
      settled("sources",rpc("analytics_top",{p_dim:"source",p_since:r.since,p_until:r.until,p_site:site,p_limit:12})),
      settled("countries",rpc("analytics_top",{p_dim:"country",p_since:r.since,p_until:r.until,p_site:site,p_limit:12})),
      settled("networks",rpc("analytics_top",{p_dim:"network",p_since:r.since,p_until:r.until,p_site:site,p_limit:12})),
      settled("engagement",site===null?S.supa("v_engagement_daily?select=*&day=gte."+encodeURIComponent(from)+"&day=lte."+encodeURIComponent(through)+"&order=day.asc"):Promise.resolve([])),
      settled("funnel",site===null?rpc("analytics_funnel",{p_since:r.since,p_until:r.until}):Promise.resolve([])),
      settled("acquisition",rpc("analytics_acquisition",args)),settled("paths",rpc("analytics_paths",Object.assign({p_limit:40},args))),
      settled("content",rpc("analytics_content",args)),settled("contentEvents",rpc("analytics_content_events",args)),
      settled("identity",site===null?S.request("/v1/analytics/identity?since="+encodeURIComponent(r.since)+"&until="+encodeURIComponent(r.until)):Promise.resolve({coverage:{},tracks:[],journeys:[]})),
      settled("forensics",site===null?S.request("/v1/analytics/forensics?since="+encodeURIComponent(r.since)+"&until="+encodeURIComponent(r.until)+"&limit=150"):Promise.resolve({events:[]})),
      settled("business",S.request("/v1/analytics/business?since="+encodeURIComponent(r.since)+"&until="+encodeURIComponent(r.until)))
    ];
    return Promise.all(jobs).then(function(out){if(q!==S.seq)return;var m={};out.forEach(function(x){if(x.ok)m[x.name]=x.value;else S.errors[x.name]=x.error;});S.data.business=m.business||null;S.data.traffic={byDay:m.daily||[],totals:m.totals&&m.totals[0]||{},pages:top(m.pages,"path"),sources:top(m.sources,"source"),countries:top(m.countries,"country"),networks:top(m.networks,"network")};S.data.engagement=m.engagement||[];S.data.funnel=m.funnel||[];S.data.acquisition=m.acquisition||[];S.data.paths=m.paths||[];S.data.content=m.content||[];S.data.contentEvents=m.contentEvents||[];S.data.identity=m.identity||{};S.data.forensics=m.forensics||{};S.loading=false;S.loaded=true;S.error=S.errors.daily||S.errors.totals||null;paint();});
  }
  function bind(root){
    var p=root.querySelector("#craProperty");if(p)p.onchange=function(){S.site=p.value;load();};
    root.querySelectorAll("[data-cra-sec]").forEach(function(b){b.onclick=function(){S.section=b.getAttribute("data-cra-sec");paint();};});
    root.querySelectorAll("[data-cra-range]").forEach(function(b){b.onclick=function(){S.rangeId=b.getAttribute("data-cra-range");if(S.rangeId==="custom"&&!S.from){var now=new Date();S.through=inputDate(now);S.from=inputDate(new Date(now-7*86400000));paint();}else load();};});
    var a=root.querySelector("[data-cra-apply]");if(a)a.onclick=function(){S.from=(root.querySelector("#craFrom")||{}).value||"";S.through=(root.querySelector("#craThrough")||{}).value||"";load();};
    root.querySelectorAll("[data-cra-site]").forEach(function(b){b.onclick=function(){S.site=b.getAttribute("data-cra-site");load();};});
    root.querySelectorAll("[data-cra-verify]").forEach(function(b){b.onclick=function(){S.request("/v1/analytics/domains/"+encodeURIComponent(b.getAttribute("data-cra-verify"))+"/verify",{method:"POST"}).then(loadSites).then(load).catch(function(x){S.error=x;paint();});};});
  }
  window.CR.analytics={
    init:function(opts){S.request=opts.request;S.supa=opts.supa;},
    mount:function(host){S.host=host;paint();if(!S.loaded&&!S.loading)loadSites().then(load);},
    refresh:function(){return loadSites().then(load);},
    render:render,
    state:S
  };
})();
