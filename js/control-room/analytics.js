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
  /* REACH VS REPEAT. Right is how many different people started a track;
     up is how many times each of them started it (1x = once each). The
     chart used to be a fixed 720-wide drawing shrunk into the card, with no
     numbers on either axis and every name printed beside its dot, so the
     names piled up and ran off the edge. It is now drawn at the card's real
     width with numbered axes, names only where they fit, and one track
     picked at a time: its dot, its dashed lines to both axes, the readout
     and its row in the list all show the same numbers. */
  function fx(v){return(Math.round((Number(v)||0)*100)/100).toFixed(2).replace(/\.?0+$/,"")+"×";}
  function niceStep(span,count){var raw=span/Math.max(1,count),p=Math.pow(10,Math.floor(Math.log(raw)/Math.LN10)),f=raw/p;return(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;}
  function textW(t){return String(t).length*6.3;}
  function reachRows(){
    var id=S.data.identity||{},known=sid()===null&&Array.isArray(id.tracks)&&!S.errors.identity,map={};
    (id.tracks||[]).forEach(function(x){map[String(x.track||"").toLowerCase()]=x;});
    return(S.data.content||[]).filter(function(r){return Number(r.listeners)>0;})
      .sort(function(a,b){return(Number(b.starts)||0)-(Number(a.starts)||0);}).slice(0,24)
      .map(function(r,i){var l=Number(r.listeners)||0,st=Number(r.starts)||0,a=map[String(r.track||"").toLowerCase()];
        return{rank:i+1,track:String(r.track||"Untitled"),listeners:l,starts:st,each:r.plays_per_listener!=null?Number(r.plays_per_listener):st/Math.max(1,l),accounts:known?Number(a&&a.last_touch_accounts||0):null};});
  }
  function reachReadout(p){
    return'<div class="cra-reach__readout"><div class="cra-reach__name"><span>#'+p.rank+'</span><b>'+e(p.track)+'</b></div>'+
      '<dl class="cra-reach__facts"><div><dt>Listeners</dt><dd>'+n(p.listeners)+'</dd></div><div><dt>Starts each</dt><dd>'+fx(p.each)+'</dd></div><div><dt>Total starts</dt><dd>'+n(p.starts)+'</dd></div><div><dt>Sign-ups</dt><dd>'+(p.accounts==null?"—":n(p.accounts))+'</dd></div></dl>'+
      '<p class="cra-reach__math">'+n(p.listeners)+' listeners × '+fx(p.each).slice(0,-1)+' starts each ≈ '+n(p.starts)+' starts</p></div>';
  }
  function reachSvg(rows,p,W){
    var narrow=W<480,H=narrow?264:Math.min(360,Math.round(W*.44)),maxX=1,maxY=1,minY=1;
    rows.forEach(function(r){maxX=Math.max(maxX,r.listeners);maxY=Math.max(maxY,r.each);minY=Math.min(minY,r.each);});
    var P={t:28,r:18,b:42},y0=minY<1?0:1,plotH=H-P.t-P.b;
    var yStep=niceStep(Math.max(1,maxY-y0),Math.min(7,Math.max(3,Math.floor(plotH/34)))),yTop=y0+Math.max(1,Math.ceil((maxY-y0)/yStep-1e-9))*yStep,yT=[];
    for(var v=y0;v<=yTop+1e-9;v+=yStep)yT.push(+v.toFixed(4));
    P.l=Math.ceil(Math.max.apply(null,yT.map(function(t){return textW(fx(t));}).concat([textW(fx(p.each))+8])))+8;
    var plotW=W-P.l-P.r,xStep=niceStep(maxX,Math.min(8,Math.max(3,Math.floor(plotW/56)))),xTop=Math.max(1,Math.ceil(maxX/xStep-1e-9))*xStep,xT=[];
    for(v=0;v<=xTop+1e-9;v+=xStep)xT.push(+v.toFixed(4));
    function X(x){return P.l+x/xTop*plotW;}function Y(y){return P.t+plotH-(y-y0)/(yTop-y0)*plotH;}
    var bottom=P.t+plotH,pxX=X(p.listeners),pxY=Y(p.each),xChipW=textW(n(p.listeners))+10,s=['<svg class="cra-reach__svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+e("Reach vs repeat for "+rows.length+" tracks. Selected: "+p.track+", "+p.listeners+" listeners, "+fx(p.each)+" starts each.")+'">'];
    s.push('<text class="cra-reach__title" x="0" y="12">↑ Starts per listener</text><text class="cra-reach__title" x="'+(W-P.r)+'" y="'+(H-3)+'" text-anchor="end">Unique listeners →</text>');
    yT.forEach(function(t){var y=Y(t).toFixed(1);s.push('<line class="cra-reach__grid'+(t===y0?" cra-reach__base":"")+'" x1="'+P.l+'" y1="'+y+'" x2="'+(W-P.r)+'" y2="'+y+'"/>'+(Math.abs(y-pxY)<16?"":'<text class="cra-reach__tick" x="'+(P.l-6)+'" y="'+(+y+4)+'" text-anchor="end">'+fx(t)+'</text>'));});
    xT.forEach(function(t,i){var x=X(t).toFixed(1),lab=n(t),anchor=i===xT.length-1&&textW(lab)/2>P.r?"end":"middle";/* A tick label the picked value's chip would cover is left out. */
      var lx=anchor==="end"?W-2-textW(lab)/2:+x,under=Math.abs(lx-pxX)<xChipW/2+textW(lab)/2+3;
      s.push('<line class="cra-reach__grid'+(t===0?" cra-reach__base":"")+'" x1="'+x+'" y1="'+P.t+'" x2="'+x+'" y2="'+bottom+'"/>'+(under?"":'<text class="cra-reach__tick" x="'+(anchor==="end"?W-2:x)+'" y="'+(bottom+16)+'" text-anchor="'+anchor+'">'+lab+'</text>'));});
    var pts=rows.map(function(r,i){return{r:r,i:i,x:X(r.listeners),y:Y(r.each),rad:r===p?7:5.5};}),pick=pts[p.rank-1];
    /* The picked track's own values, drawn on the axes where they line up. */
    s.push('<line class="cra-reach__cross" x1="'+pick.x.toFixed(1)+'" y1="'+pick.y.toFixed(1)+'" x2="'+pick.x.toFixed(1)+'" y2="'+bottom+'"/><line class="cra-reach__cross" x1="'+P.l+'" y1="'+pick.y.toFixed(1)+'" x2="'+pick.x.toFixed(1)+'" y2="'+pick.y.toFixed(1)+'"/>');
    /* Rank 1 is drawn last so it sits on top; the picked dot goes over all. */
    pts.slice().reverse().filter(function(q){return q.r!==p;}).concat([pick]).forEach(function(q){
      s.push('<g class="cra-reach__pt'+(q.r===p?" is-on":"")+'" data-cra-pick="'+q.i+'"><title>'+e(q.r.track+": "+n(q.r.listeners)+" listeners, "+fx(q.r.each)+" starts each")+'</title><circle class="cra-reach__hit" cx="'+q.x.toFixed(1)+'" cy="'+q.y.toFixed(1)+'" r="11"/><circle class="cra-reach__dot" cx="'+q.x.toFixed(1)+'" cy="'+q.y.toFixed(1)+'" r="'+q.rad+'"/></g>');
    });
    /* Names only where they fit: try right, left, above, below; skip a name
       that would touch another name, a dot or the edge. The list below the
       chart names every dot. */
    var boxes=pts.map(function(q){return{x:q.x-q.rad-1,y:q.y-q.rad-1,w:2*q.rad+2,h:2*q.rad+2};}),limit=narrow?6:12,placed=0;
    function hit(a,b){return a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;}
    [pick].concat(pts.filter(function(q){return q!==pick;})).forEach(function(q){
      if(placed>=limit)return;var name=q.r.track.length>18?q.r.track.slice(0,17)+"…":q.r.track,w=textW(name),h=13,g=q.rad+4;
      var tries=[{x:q.x+g,y:q.y-h/2,a:"start"},{x:q.x-g-w,y:q.y-h/2,a:"end"},{x:q.x-w/2,y:q.y-g-h,a:"middle"},{x:q.x-w/2,y:q.y+g,a:"middle"}];
      for(var k=0;k<tries.length;k++){var b={x:tries[k].x,y:tries[k].y,w:w,h:h};
        if(b.x<P.l+2||b.x+b.w>W-2||b.y<16||b.y+b.h>bottom-2)continue;
        if(boxes.some(function(o,j){return j!==q.i&&hit(b,o);}))continue;
        var tx=tries[k].a==="start"?b.x:tries[k].a==="end"?b.x+w:b.x+w/2;
        s.push('<text class="cra-reach__label'+(q===pick?" is-on":"")+'" x="'+tx.toFixed(1)+'" y="'+(b.y+10).toFixed(1)+'" text-anchor="'+tries[k].a+'">'+e(name)+'</text>');
        boxes.push(b);placed++;break;}
    });
    function chip(x,y,label,anchor){var w=textW(label)+10,bx=anchor==="end"?x-w:Math.min(W-w,Math.max(0,x-w/2));return'<g class="cra-reach__chip"><rect x="'+bx.toFixed(1)+'" y="'+(y-12)+'" width="'+w.toFixed(1)+'" height="17" rx="4"/><text x="'+(bx+w/2).toFixed(1)+'" y="'+y+'" text-anchor="middle">'+e(label)+'</text></g>';}
    s.push(chip(pick.x,bottom+16,n(p.listeners),"middle")+chip(P.l-3,pick.y+4,fx(p.each),"end"));
    s.push("</svg>");
    return s.join("");
  }
  function reachList(rows,p){
    var lim=S.reachAll?rows.length:Math.min(8,rows.length);
    return'<div class="cra-reach__list"><div class="cra-reach__row cra-reach__row--head" aria-hidden="true"><span>#</span><span class="cra-reach__track">Track</span><span>Listeners</span><span>Each</span></div>'+
      rows.slice(0,lim).map(function(r,i){return'<button type="button" class="cra-reach__row'+(r===p?" is-on":"")+'" data-cra-pick="'+i+'" aria-pressed="'+(r===p)+'"><span>'+r.rank+'</span><span class="cra-reach__track">'+e(r.track)+'</span><span>'+n(r.listeners)+'</span><span>'+fx(r.each)+'</span></button>';}).join("")+'</div>'+
      (rows.length>8?'<button type="button" class="cra-reach__more" data-cra-reach-all>'+(S.reachAll?"Show top 8":"Show all "+rows.length+" tracks")+'</button>':"");
  }
  function drawReach(fromList){
    var box=S.host&&S.host.querySelector("[data-cra-reach]");if(!box)return;
    var rows=reachRows();if(!rows.length){box.innerHTML='<p>No track rows in this range.</p>';return;}
    var W=Math.max(260,Math.floor(box.clientWidth||320)),p=rows.filter(function(r){return r.track===S.reachPick;})[0]||rows[0];
    box.setAttribute("data-w",W);
    box.innerHTML=reachReadout(p)+reachSvg(rows,p,W)+reachList(rows,p);
    box.onclick=function(ev){
      var t=ev.target.closest&&ev.target.closest("[data-cra-pick]");
      if(t){S.reachPick=rows[Number(t.getAttribute("data-cra-pick"))].track;drawReach(t.tagName==="BUTTON");return;}
      if(ev.target.closest&&ev.target.closest("[data-cra-reach-all]")){S.reachAll=!S.reachAll;drawReach();}
    };
    /* Picked from the list below: bring the readout back into view. */
    if(fromList){var ro=box.querySelector(".cra-reach__readout"),rr=ro&&ro.getBoundingClientRect();if(rr&&rr.top<0&&ro.scrollIntoView)ro.scrollIntoView({block:"start",behavior:"smooth"});}
  }
  /* SOURCE → SONG → ACCOUNT, as ranked paths. Each row is one route people
     actually took: where they came from, the last song they heard before
     signing up, and how many accounts took that route. Tapping a row filters
     the account list below to exactly those people. */
  var PATH_SEP=" |→| ";
  function pathKey(src,track){return String(src||"direct")+PATH_SEP+String(track||"");}
  function flow(data){
    var js=(data&&data.journeys)||[],m={},total=0;
    js.forEach(function(j){if(!j.last_track)return;var k=pathKey(j.source,j.last_track),r=m[k]||(m[k]={source:j.source||"direct",track:j.last_track,n:0,mins:[]});r.n++;total++;if(j.minutes_after_last_track!=null)r.mins.push(Number(j.minutes_after_last_track));});
    var rows=Object.keys(m).map(function(k){return m[k];}).sort(function(a,b){return b.n-a.n||String(a.track).localeCompare(String(b.track));});
    if(!rows.length)return'<p>No account in this range heard a song in the 7 days before signing up.</p>';
    var top=rows[0].n,sel=S.idFilter&&S.idFilter.path;
    return'<div class="cra-paths">'+rows.slice(0,14).map(function(r){
      var k=pathKey(r.source,r.track),med=r.mins.length?r.mins.slice().sort(function(a,b){return a-b;})[Math.floor(r.mins.length/2)]:null;
      return'<button type="button" class="cra-path'+(sel===k?" is-on":"")+'" data-cra-path="'+e(k)+'"><i class="cra-path__fill" style="--pct:'+(r.n/top*100).toFixed(1)+'%"></i>'+
        '<span class="cra-path__chain"><span class="cra-chip cra-chip--src">'+e(r.source)+'</span><span class="cra-path__arrow" aria-hidden="true">→</span><span class="cra-chip cra-chip--song">'+e(r.track)+'</span><span class="cra-path__arrow" aria-hidden="true">→</span><span class="cra-path__acct">'+n(r.n)+(r.n===1?" account":" accounts")+'</span></span>'+
        '<span class="cra-path__meta">'+Math.round(r.n/total*100)+'% of song-led signups'+(med!=null?' · typically '+mins(med)+' after the song':"")+'</span></button>';
    }).join("")+'</div>';
  }
  function mins(v){v=Number(v);if(!isFinite(v))return"—";if(v<1)return"under a minute";if(v<60)return v+" min";if(v<1440)return Math.round(v/60)+" h";return Math.round(v/1440)+" days";}
  function tabs(){return'<nav class="cra-tabs">'+[["overview","Overview"],["audience","Audience"],["content","Content"],["identity","Identity"],["forensics","Forensics"],["setup","Setup"]].map(function(x){return'<button type="button" class="cra-tab'+(S.section===x[0]?" is-on":"")+'" data-cra-sec="'+x[0]+'">'+x[1]+'</button>';}).join("")+'</nav>';}
  function ranges(){var ids=[["24h","24h"],["7d","7 days"],["30d","30 days"],["90d","90 days"],["all","All"],["custom","Custom"]];return'<div class="cra-ranges">'+ids.map(function(x){return'<button type="button" class="cra-range'+(S.rangeId===x[0]?" is-on":"")+'" data-cra-range="'+x[0]+'">'+x[1]+'</button>';}).join("")+'</div><div class="cra-custom"'+(S.rangeId==="custom"?"":" hidden")+'><label>From<input class="cra-date" id="craFrom" type="date" value="'+e(S.from)+'"></label><label>Through<input class="cra-date" id="craThrough" type="date" value="'+e(S.through)+'"></label><button class="cr-btn cr-btn--primary" data-cra-apply type="button">Apply</button></div>';}
  function overview(){
    var t=S.data.traffic||{},tot=t.totals||{},house=sid()===null,b=S.data.business&&S.data.business.snapshot||{},rangeLabel=S.range&&S.range.label||"Selected range";
    var core=kpi("Page views",n(tot.page_views),rangeLabel)+kpi("Visitors",n(tot.visitors),"unique")+kpi("Sessions",n(tot.sessions),"selected range");
    var scoped=house
      ? kpi("Accounts",n(b.users&&(b.window?b.users.created_in_window:b.users.total)),b.window?"created":"all time")+kpi("Music plays",n(b.music&&b.music.plays&&(b.window?b.music.plays.in_window:b.music.plays.total)),"plays")+kpi("Gross music",money(b.music&&b.music.revenue&&(b.window?b.music.revenue.gross_cents_in_window:b.music.revenue.gross_cents)),"revenue")
      : kpi("Plays",n(tot.plays),"selected property")+kpi("Events",n(tot.events),"selected property");
    return'<div class="cra-kpis">'+core+scoped+'</div><div class="cra-grid">'+card("Traffic trend","Page views and visitors in the selected timestamp window.",line(t.byDay,"page_views","visitors","Page views","Visitors"),true)+card("Acquisition mix","Top sources.",donut(t.sources,"source","count"))+card("Geography","Country distribution.",donut(t.countries,"country","count"))+card("Top pages","Highest traffic paths.",rank(t.pages,"path","count"))+card("Network","Observed connection/network.",rank(t.networks,"network","count"))+'</div>'+(house?err("business"):"")+err("daily")+err("totals");
  }
  function audience(){
    var house=sid()===null;
    var scopedGap=house?"":'<div class="cra-error">The conversion funnel is hidden for this external property because the deployed backend does not expose a site-scoped funnel. Control will not mix another property into this view.</div>';
    var funnelCard=house?card("Conversion funnel","People reaching each stage.",funnel(S.data.funnel||[]),true):"";
    return scopedGap+'<div class="cra-grid">'+card("Audience trend","Sessions and unique visitors inside the exact selected timestamp window.",line((S.data.traffic&&S.data.traffic.byDay)||[],"sessions","visitors","Sessions","Visitors"),true)+funnelCard+card("Acquisition quality","People by source.",donut(S.data.acquisition||[],"source","people"))+card("Paths","Page-to-page movement.",rank((S.data.paths||[]).map(function(r){return{label:r.from_page+" → "+r.to_page,count:r.moves};}),"label","count"))+'</div>'+["funnel","acquisition","paths"].map(err).join("");
  }
  function content(){
    var rows=(S.data.content||[]).slice().sort(function(a,b){return(Number(b.listeners)||0)-(Number(a.listeners)||0);}),ev=S.data.contentEvents||[];
    var table=rows.length?'<div class="cra-scroll"><table class="cra-table"><thead><tr><th>Track</th><th>Album</th><th class="n">Starts</th><th class="n">Listeners</th><th class="n">Repeat</th><th class="n">Starts/listener</th><th class="n">Full</th><th class="n">Complete</th><th class="n">Shares</th></tr></thead><tbody>'+rows.map(function(r){return'<tr><td><b>'+e(r.track||"—")+'</b></td><td>'+e(r.album||"—")+'</td><td class="n">'+n(r.starts)+'</td><td class="n">'+n(r.listeners)+'</td><td class="n">'+n(r.repeat_listeners)+'</td><td class="n">'+e(r.plays_per_listener==null?"—":r.plays_per_listener)+'</td><td class="n">'+n(r.full_plays)+'</td><td class="n">'+n(r.completions)+'</td><td class="n">'+n(r.shares)+'</td></tr>';}).join("")+'</tbody></table></div>':'<p>No content rows.</p>';
    return'<div class="cra-grid">'+card("Reach vs repeat","Each dot is one track. Further right: more different people started it. Higher: each of them started it more times (1\u00d7 = once each). Tap a dot or a row to line up its numbers. Sign-ups counts accounts whose last song before joining was this one.",'<div class="cra-reach" data-cra-reach></div>',true)+card("Media event mix","Composition of player events.",donut(ev,"event_name","events"))+card("Top tracks","Starts by track.",rank(rows,"track","starts"))+card("Track detail","Full selected-window ledger.",table,true)+'</div>'+err("content")+err("contentEvents");
  }
  function identity(){
    var d=S.data.identity||{},c=d.coverage||{},js=d.journeys||[],t=d.tracks||[];
    var accounts=Number(c.accounts)||js.length,linked=Number(c.bridged_accounts)||0,heard=Number(c.attributed_accounts)||0;
    var sourced=js.filter(function(j){return j.source&&j.source!=="direct";}).length;
    /* the sentence first: what happened, in words */
    var paths={};js.forEach(function(j){if(j.last_track){var k=pathKey(j.source,j.last_track);paths[k]=(paths[k]||0)+1;}});
    var best=Object.keys(paths).sort(function(a,b){return paths[b]-paths[a];})[0];
    var lead=accounts?('<p class="cra-lead"><b>'+n(accounts)+(accounts===1?" account was":" accounts were")+' created.</b> '+
      (heard?n(heard)+' of them ('+pct(heard,accounts)+') heard a song in the 7 days before signing up'+(best?', most often <b>'+e(best.split(PATH_SEP)[0])+' → '+e(best.split(PATH_SEP)[1])+'</b> ('+n(paths[best])+')':"")+'.':'None of them can be tied to a song yet.')+'</p>')
      :'<p class="cra-lead">No accounts were created in this range.</p>';
    /* the funnel: each step is a share of accounts created */
    var steps=[["Accounts created",accounts,"Everyone who signed up in this range."],["Linked to a device",linked,"We could match the account to the browser it signed up on."],["Heard a song first",heard,"That device played a song in the 7 days before signup."],["Came from a known source",sourced,"Arrived through a tagged link, not typed in or unknown."]];
    var funnel='<div class="cra-steps2">'+steps.map(function(x,i){var p=accounts?x[1]/accounts*100:0;return'<div class="cra-step2"><span class="cra-step2__n">'+(i+1)+'</span><div class="cra-step2__body"><div class="cra-step2__top"><b>'+e(x[0])+'</b><strong>'+n(x[1])+'</strong></div><div class="cra-step2__bar"><i style="--pct:'+Math.max(x[1]?2:0,p).toFixed(1)+'%"></i></div><small>'+(i?Math.round(p)+'% of accounts · ':"")+e(x[2])+'</small></div></div>';}).join("")+'</div>';
    /* songs, as a table you can read across */
    var songs=t.length?'<div class="cra-scroll"><table class="cra-table"><thead><tr><th>Song</th><th class="n">Listeners</th><th class="n">Last song before signup</th><th class="n">Heard on the way</th><th class="n">Signup rate</th><th class="n">Typical time</th></tr></thead><tbody>'+
      t.slice(0,20).map(function(x){return'<tr><td><b>'+e(x.track)+'</b></td><td class="n">'+n(x.listeners)+'</td><td class="n">'+n(x.last_touch_accounts)+'</td><td class="n">'+n(x.assisted_accounts)+'</td><td class="n">'+(x.signup_rate_pct!=null?e(x.signup_rate_pct)+"%":"—")+'</td><td class="n">'+(x.avg_minutes_to_signup!=null?mins(x.avg_minutes_to_signup):"—")+'</td></tr>';}).join("")+'</tbody></table></div>':'<p>No songs tied to signups in this range.</p>';
    /* the accounts themselves, filtered by the path you tapped */
    var f=S.idFilter&&S.idFilter.path,list=f?js.filter(function(j){return pathKey(j.source,j.last_track)===f;}):js;
    var cards=list.length?'<div class="cra-accts">'+list.slice(0,60).map(function(j){
      var name=[j.first_name,j.last_name].filter(Boolean).join(" ")||j.email||"Account",assisted=(j.assisted_tracks||[]).filter(function(x){return x!==j.last_track;});
      return'<article class="cra-acct"><div class="cra-acct__top"><b>'+e(name)+'</b><small>'+e(j.created_at?new Date(j.created_at).toLocaleString():"")+'</small></div>'+
        '<div class="cra-path__chain"><span class="cra-chip cra-chip--src">'+e(j.source||"direct")+'</span><span class="cra-path__arrow" aria-hidden="true">→</span>'+
        (j.last_track?'<span class="cra-chip cra-chip--song">'+e(j.last_track)+'</span><span class="cra-path__arrow" aria-hidden="true">→</span>':'<span class="cra-chip">no song</span><span class="cra-path__arrow" aria-hidden="true">→</span>')+
        '<span class="cra-path__acct">signed up'+(j.minutes_after_last_track!=null?' '+mins(j.minutes_after_last_track)+' later':"")+'</span></div>'+
        (assisted.length?'<p class="cra-acct__also">Also heard: '+e(assisted.join(", "))+'</p>':"")+
        '<details class="cra-acct__more"><summary>Owner-only details</summary><dl><dt>Email</dt><dd>'+e(j.email||"—")+'</dd><dt>Location</dt><dd>'+e([j.city,j.region,j.country].filter(Boolean).join(", ")||"—")+'</dd><dt>Network</dt><dd>'+e(j.network||"—")+'</dd><dt>IP</dt><dd><code>'+e(j.ip||"—")+'</code></dd><dt>Confirmed</dt><dd>'+e(j.confirmed_at?new Date(j.confirmed_at).toLocaleString():"not yet")+'</dd></dl></details></article>';
    }).join("")+'</div>':'<p>No accounts match.</p>';
    var filterNote=f?'<div class="cra-filter"><span>Showing '+e(f.split(PATH_SEP)[0])+' → '+e(f.split(PATH_SEP)[1])+'</span><button type="button" class="cra-filter__x" data-cra-path="">Show everyone</button></div>':"";
    return lead+'<div class="cra-grid">'+card("How signups happened","Each step as a share of accounts created. Song attribution looks back 7 days on the same device; it shows what happened before, not what caused it.",funnel,true)+
      card("Source → track → account","Every route someone took to an account. Tap one to see those people.",flow(d),true)+
      card("Songs","Last song before signup is the song they heard right before joining. Heard on the way counts every song they played in the 7 days before.",songs,true)+
      card("Accounts","Newest first."+(list.length>60?" Showing 60 of "+n(list.length)+".":""),filterNote+cards,true)+'</div>'+err("identity");
  }
  function pct(a,b){return b?Math.round(a/b*100)+"%":"0%";}
  function forensics(){
    var rows=(S.data.forensics&&S.data.forensics.events)||[],table=rows.length?'<div class="cra-scroll"><table class="cra-table"><thead><tr><th>Time</th><th>Event</th><th>Path</th><th>IP</th><th>Location</th><th>Network</th><th>Device</th><th>Session</th></tr></thead><tbody>'+rows.map(function(x){var d=x.device||{};return'<tr><td>'+e(x.at?new Date(x.at).toLocaleString():"—")+'</td><td><b>'+e(x.name||"—")+'</b></td><td>'+e(x.path||"—")+'</td><td><code>'+e(x.ip||"—")+'</code></td><td>'+e([x.city,x.region,x.country,x.postal].filter(Boolean).join(", ")||"—")+'</td><td>'+e(x.asn_org||"—")+(x.asn?" · AS"+e(x.asn):"")+'</td><td>'+e(d.platform||"—")+(d.mobile===true?" · mobile":d.mobile===false?" · desktop":"")+'<br>'+e(d.screen||"")+'</td><td><code>'+e(x.session_id||"—")+'</code><br><code>'+e(x.device_id||"—")+'</code></td></tr>';}).join("")+'</tbody></table></div>':'<p>No raw events in this range.</p>';
    return'<div class="cra-grid">'+card("Owner-only telemetry","Recent first-party IP, approximate edge geography, ASN/network, device and session context.",table,true)+'</div>'+err("forensics");
  }
  /* SETUP. It used to be a one-item property list and a code box reading
     "Built into matthew.mccluster.org.", which answered nothing. It now
     says whether data is arriving for the property on screen, how to put
     the pixel on another website, and lets the owner add one. */
  function ago(t){var sec=(Date.now()-new Date(t).getTime())/1000;if(!isFinite(sec))return"—";if(sec<90)return"just now";if(sec<5400)return Math.round(sec/60)+" min ago";if(sec<129600)return Math.round(sec/3600)+" h ago";return Math.round(sec/86400)+" days ago";}
  function loadPulse(){
    if(S.pulseLoading)return;S.pulseLoading=true;var site=S.site;
    S.supa("events?select=at,name,path&"+(site===FIRST?"site_id=is.null":"site_id=eq."+encodeURIComponent(site))+"&order=at.desc&limit=1")
      .then(function(x){S.pulse={site:site,row:x&&x[0]||null};},function(x){S.pulse={site:site,error:x};})
      .then(function(){S.pulseLoading=false;if(S.section==="setup")paint();});
  }
  function hostname(v){v=String(v||"").trim().toLowerCase().replace(/^[a-z]+:\/\//,"").replace(/[\/?#].*$/,"").replace(/:\d+$/,"");return/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(v)&&v.indexOf(".")>0?v:"";}
  function pixel(site){return'<script async src="https://api.mccluster.org/a.js?site='+site.public_key+'&consent='+(site.consent_mode==="cookieless"?"cookieless":"required")+'"><\/script>';}
  function status(){
    var pu=S.pulse&&S.pulse.site===S.site?S.pulse:null;
    if(!pu)return'<span class="cra-status"><i></i>Checking…</span>';
    if(pu.error)return'<span class="cra-status cra-status--bad"><i></i>Could not check</span>';
    if(!pu.row)return'<span class="cra-status cra-status--warn"><i></i>Waiting for first event</span>';
    var age=(Date.now()-new Date(pu.row.at).getTime())/60000;
    return age<=30?'<span class="cra-status cra-status--ok"><i></i>Receiving data</span>':'<span class="cra-status cra-status--warn"><i></i>Quiet</span>';
  }
  function lastEvent(){
    var pu=S.pulse&&S.pulse.site===S.site?S.pulse:null;
    if(!pu)return"Checking…";if(pu.error)return e(pu.error.message||"Could not read events");if(!pu.row)return"None yet";
    return'<b>'+e(ago(pu.row.at))+'</b> · '+e(pu.row.name||"event")+(pu.row.path?' on <code>'+e(pu.row.path)+'</code>':"");
  }
  function setup(){
    var sites=S.sites||[],sel=S.site===FIRST?null:sites.filter(function(x){return String(x.id)===String(S.site);})[0],first=!sel,top;
    if(first){
      top=card("This site","",'<div class="cra-setup__head"><b class="cra-setup__name">McCluster first-party</b>'+status()+'</div>'+
        '<p class="cra-setup__lede">Built in. Every page of this site reports to this dashboard on its own, so there is nothing to install.</p>'+
        '<dl class="cra-facts"><div><dt>Last event</dt><dd>'+lastEvent()+'</dd></div>'+
        '<div><dt>Privacy</dt><dd>Visitors who send Global Privacy Control or Do Not Track still count as a visit, but nothing that could identify them is kept.</dd></div>'+
        '<div><dt>Bots</dt><dd>Crawlers are marked as bots rather than counted as your audience.</dd></div></dl>'+
        '<button class="cr-btn" type="button" data-cra-pulse>Check again</button>',true);
    }else{
      var d=(sel.analytics_site_domains||[])[0],h=d&&d.hostname;
      var dns=!d?'<p>No domain was added with this website, so there is nothing to verify yet.</p>':d.verified_at?'<p class="cra-ok">✓ '+e(h)+' is verified.</p>':
        '<p>Prove you own <b>'+e(h)+'</b>: add this DNS record where the domain is managed, then press Verify.</p><dl class="cra-dns"><div><dt>Type</dt><dd><code>TXT</code></dd></div><div><dt>Name</dt><dd><code>_mccluster-analytics.'+e(h)+'</code></dd></div><div><dt>Value</dt><dd><code>'+e(d.verification_token)+'</code></dd></div></dl><button class="cr-btn" type="button" data-cra-verify="'+e(d.id)+'">Verify DNS</button>';
      top=card("Install on "+(sel.name||"this website"),"",'<div class="cra-setup__head"><b class="cra-setup__name">'+e(h||sel.name||"Website")+'</b>'+status()+'</div>'+
        '<ol class="cra-steps"><li><div><b>Copy this line.</b><pre class="cra-code" id="craPixel">'+e(pixel(sel))+'</pre><button class="cr-btn" type="button" data-cra-copy>Copy</button></div></li>'+
        '<li><div><b>Paste it inside <code>&lt;head&gt;</code> on every page of '+e(h||"the website")+'.</b></div></li>'+
        '<li><div><b>Verify the domain.</b>'+dns+'</div></li>'+
        (sel.consent_mode==="cookieless"?'<li><div><b>Cookieless.</b> No visitor ID is kept, so no consent banner is needed.</div></li>':'<li><div><b>Ask for consent.</b> Nothing is sent until the site’s cookie banner gets a yes and calls <code>mcAnalytics.consent(true)</code>.</div></li>')+
        '</ol><dl class="cra-facts"><div><dt>Last event</dt><dd>'+lastEvent()+'</dd></div></dl><button class="cr-btn" type="button" data-cra-pulse>Check again</button>',true);
    }
    var list='<div class="cra-sites">'+[{id:FIRST,name:"McCluster first-party"}].concat(sites).map(function(x){
        var own=x.id===FIRST,ds=x.analytics_site_domains||[],v=ds.some(function(d){return d.verified_at&&d.enabled!==false;}),on=String(x.id)===String(S.site);
        return'<div class="cra-site'+(on?" is-on":"")+'"><div class="cra-site__copy"><b>'+e(x.name||x.id)+'</b><span>'+e(own?"Built in":ds.map(function(d){return d.hostname;}).join(", ")||"No domain")+(own?"":v?" · verified":ds.length?" · not verified":"")+'</span></div>'+
          (on?'<span class="cra-site__on">Showing</span>':'<button class="cr-btn" type="button" data-cra-site="'+e(x.id)+'">View</button>')+'</div>';}).join("")+'</div>';
    var form='<form class="cra-form" data-cra-add><label>Website name<input class="cra-input" name="site_name" maxlength="160" autocomplete="off" required></label>'+
      '<label>Domain<input class="cra-input" name="site_host" placeholder="example.com" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false"></label>'+
      '<label>Privacy<select class="cra-input" name="site_mode"><option value="required">Ask visitors for consent first</option><option value="cookieless">Cookieless (no visitor ID)</option></select></label>'+
      '<button class="cr-btn cr-btn--primary" type="submit">Add website</button><p class="cra-form__msg" role="status" aria-live="polite"></p></form>';
    return'<div class="cra-grid">'+top+card("Your websites","Track another website with this same dashboard: add it here, put one line on it, then pick it from the menu at the top.",list+form,true)+'</div>'+err("sites");
  }
  function body(){return S.section==="audience"?audience():S.section==="content"?content():S.section==="identity"?identity():S.section==="forensics"?forensics():S.section==="setup"?setup():overview();}
  function render(){
    var st=S.loading?"Reading "+(S.range&&S.range.label||"analytics")+"…":S.error?"Analytics load failed":S.loaded?"Live · "+(S.range&&S.range.label||"")+" · "+tz():"Ready";
    return'<div class="cra"><div class="cra-head"><div class="cra-head__copy"><h1>Analytics</h1><p>Traffic, audience, content, identity, commerce and diagnostics. One range controls the whole panel.</p></div><select class="cra-property" id="craProperty">'+[{id:FIRST,name:"McCluster first-party"}].concat(S.sites||[]).map(function(x){return'<option value="'+e(x.id)+'"'+(String(x.id)===String(S.site)?" selected":"")+'>'+e(x.name||x.id)+'</option>';}).join("")+'</select></div>'+ranges()+'<div class="cra-state '+(S.loading?"is-loading":S.error?"is-error":"")+'"><i></i><span>'+e(st)+'</span></div>'+tabs()+body()+'</div>';
  }
  function paint(){
    if(!S.host)return;S.host.innerHTML=render();bind(S.host);drawReach();
    if(S.section==="setup"&&(!S.pulse||S.pulse.site!==S.site))loadPulse();
  }
  function loadSites(){return S.supa("analytics_sites?select=id,name,public_key,status,consent_mode,created_at,analytics_site_domains(id,hostname,verified_at,verification_method,verification_token,enabled)&order=created_at.desc").then(function(x){S.sites=x||[];}).catch(function(x){S.errors.sites=x;S.sites=[];});}
  function blankData(){
    return {
      traffic:{byDay:[],totals:{},pages:[],sources:[],countries:[],networks:[]},
      funnel:[],acquisition:[],paths:[],content:[],contentEvents:[],
      identity:{},forensics:{},business:null
    };
  }
  function applyResult(x){
    if(!x)return;
    if(!x.ok){S.errors[x.name]=x.error;return;}
    var v=x.value,t=S.data.traffic;
    if(x.name==="daily")t.byDay=v||[];
    else if(x.name==="totals")t.totals=v&&v[0]||{};
    else if(x.name==="pages")t.pages=top(v,"path");
    else if(x.name==="sources")t.sources=top(v,"source");
    else if(x.name==="countries")t.countries=top(v,"country");
    else if(x.name==="networks")t.networks=top(v,"network");
    else if(x.name==="funnel")S.data.funnel=v||[];
    else if(x.name==="acquisition")S.data.acquisition=v||[];
    else if(x.name==="paths")S.data.paths=v||[];
    else if(x.name==="content")S.data.content=v||[];
    else if(x.name==="contentEvents")S.data.contentEvents=v||[];
    else if(x.name==="identity")S.data.identity=v||{};
    else if(x.name==="forensics")S.data.forensics=v||{};
    else if(x.name==="business")S.data.business=v||null;
  }
  function runLimited(tasks,limit,onResult,shouldContinue){
    limit=Math.max(1,Number(limit)||1);
    return new Promise(function(resolve){
      var out=new Array(tasks.length),next=0,active=0;
      function pump(){
        if(shouldContinue&&!shouldContinue()){if(active===0)resolve(out);return;}
        if(next>=tasks.length&&active===0){resolve(out);return;}
        while(active<limit&&next<tasks.length&&(!shouldContinue||shouldContinue())){
          (function(i){
            var task=tasks[i];active++;
            Promise.resolve().then(function(){return task.run();}).then(
              function(value){out[i]={name:task.name,ok:true,value:value};},
              function(error){out[i]={name:task.name,ok:false,error:error};}
            ).then(function(){
              active--;
              if(onResult)onResult(out[i]);
              pump();
            });
          })(next++);
        }
      }
      pump();
    });
  }
  function load(){
    var r=range(S.rangeId);if(!r){S.error=new Error("Choose a valid custom date range.");paint();return Promise.resolve();}
    S.range=r;var q=++S.seq;S.loading=true;S.loaded=false;S.error=null;S.errors={};S.data=blankData();paint();
    var site=sid(),args={p_since:r.since,p_until:r.until,p_site:site},daily={p_since:r.since,p_until:r.until,p_site:site,p_tz:tz()};
    /* One Control open used to throw every analytics primitive at PostgREST at
       once. On production data that turned one dashboard view into a dozen
       competing scans and some reads hit statement cancellation before any
       result could paint. Keep the full suite, but bound fan-out and paint
       each completed read immediately. */
    var tasks=[
      {name:"daily",run:function(){return rpc("analytics_daily",daily);}},
      {name:"totals",run:function(){return rpc("analytics_totals",args);}},
      {name:"business",run:function(){return site===null?S.request("/v1/analytics/business?since="+encodeURIComponent(r.since)+"&until="+encodeURIComponent(r.until)):Promise.resolve(null);}},
      {name:"pages",run:function(){return rpc("analytics_top",{p_dim:"page",p_since:r.since,p_until:r.until,p_site:site,p_limit:12});}},
      {name:"sources",run:function(){return rpc("analytics_top",{p_dim:"source",p_since:r.since,p_until:r.until,p_site:site,p_limit:12});}},
      {name:"countries",run:function(){return rpc("analytics_top",{p_dim:"country",p_since:r.since,p_until:r.until,p_site:site,p_limit:12});}},
      {name:"networks",run:function(){return rpc("analytics_top",{p_dim:"network",p_since:r.since,p_until:r.until,p_site:site,p_limit:12});}},
      {name:"contentEvents",run:function(){return rpc("analytics_content_events",args);}},
      {name:"content",run:function(){return rpc("analytics_content",args);}},
      {name:"acquisition",run:function(){return rpc("analytics_acquisition",args);}},
      {name:"paths",run:function(){return rpc("analytics_paths",Object.assign({p_limit:40},args));}},
      {name:"funnel",run:function(){return site===null?rpc("analytics_funnel",{p_since:r.since,p_until:r.until}):Promise.resolve([]);}},
      {name:"identity",run:function(){return site===null?S.request("/v1/analytics/identity?since="+encodeURIComponent(r.since)+"&until="+encodeURIComponent(r.until)):Promise.resolve({coverage:{},tracks:[],journeys:[]});}},
      {name:"forensics",run:function(){return site===null?S.request("/v1/analytics/forensics?since="+encodeURIComponent(r.since)+"&until="+encodeURIComponent(r.until)+"&limit=150"):Promise.resolve({events:[]});}}
    ];
    return runLimited(tasks,3,function(x){
      if(q!==S.seq)return;
      applyResult(x);
      S.error=S.errors.daily||S.errors.totals||null;
      paint();
    },function(){return q===S.seq;}).then(function(){
      if(q!==S.seq)return;
      S.loading=false;S.loaded=true;S.error=S.errors.daily||S.errors.totals||null;paint();
    });
  }
  function selectText(el){try{var r=document.createRange();r.selectNodeContents(el);var sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);}catch(_){}}
  function bind(root){
    var p=root.querySelector("#craProperty");if(p)p.onchange=function(){S.site=p.value;load();};
    root.querySelectorAll("[data-cra-path]").forEach(function(b){b.onclick=function(){var k=b.getAttribute("data-cra-path");S.idFilter={path:(S.idFilter&&S.idFilter.path===k)?null:(k||null)};paint();};});
    root.querySelectorAll("[data-cra-sec]").forEach(function(b){b.onclick=function(){S.section=b.getAttribute("data-cra-sec");paint();};});
    root.querySelectorAll("[data-cra-range]").forEach(function(b){b.onclick=function(){S.rangeId=b.getAttribute("data-cra-range");if(S.rangeId==="custom"&&!S.from){var now=new Date();S.through=inputDate(now);S.from=inputDate(new Date(now-7*86400000));paint();}else load();};});
    var from=root.querySelector("#craFrom"),through=root.querySelector("#craThrough");
    if(from)from.oninput=function(){S.from=from.value||"";};
    if(through)through.oninput=function(){S.through=through.value||"";};
    var a=root.querySelector("[data-cra-apply]");if(a)a.onclick=function(){S.from=from?from.value:(S.from||"");S.through=through?through.value:(S.through||"");load();};
    root.querySelectorAll("[data-cra-site]").forEach(function(b){b.onclick=function(){S.site=b.getAttribute("data-cra-site");load();};});
    root.querySelectorAll("[data-cra-verify]").forEach(function(b){b.onclick=function(){S.request("/v1/analytics/domains/"+encodeURIComponent(b.getAttribute("data-cra-verify"))+"/verify",{method:"POST"}).then(loadSites).then(load).catch(function(x){S.error=x;paint();});};});
    root.querySelectorAll("[data-cra-pulse]").forEach(function(b){b.onclick=function(){S.pulse=null;paint();};});
    var cp=root.querySelector("[data-cra-copy]"),px=root.querySelector("#craPixel");
    if(cp&&px)cp.onclick=function(){var t=px.textContent;function done(){cp.textContent="Copied";}
      if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(done,function(){selectText(px);});else selectText(px);};
    var add=root.querySelector("[data-cra-add]");
    if(add)add.onsubmit=function(ev){
      ev.preventDefault();var f=add.elements,name=f.site_name.value.trim(),raw=f.site_host.value.trim(),h=hostname(raw),btn=add.querySelector("[type=submit]"),msg=add.querySelector(".cra-form__msg");
      /* Messages are written in place: repainting would wipe what was typed. */
      function say(t){msg.textContent=t;btn.disabled=false;btn.textContent="Add website";}
      if(!name){say("Name the website.");f.site_name.focus();return;}
      if(raw&&!h){say("Enter a domain like example.com.");f.site_host.focus();return;}
      btn.disabled=true;btn.textContent="Adding\u2026";msg.textContent="";
      S.supa("analytics_sites",{method:"POST",prefer:"return=representation",body:{name:name,consent_mode:f.site_mode.value}}).then(function(rows){
        var site=rows&&rows[0];if(!site)throw new Error("The website was not created.");
        return(h?S.supa("analytics_site_domains",{method:"POST",prefer:"return=representation",body:{site_id:site.id,hostname:h}}):Promise.resolve()).then(function(){return site;});
      }).then(function(site){S.site=site.id;S.pulse=null;return loadSites().then(load);})
        .catch(function(x){say(x&&x.message||"Could not add the website.");});
    };
  }
  window.CR.analytics={
    init:function(opts){S.request=opts.request;S.supa=opts.supa;},
    mount:function(host){S.host=host;
      /* The reach chart is drawn at the card's pixel width; redraw it when
         that width changes (rotation, window resize). */
      if(!S.onResize){S.onResize=function(){clearTimeout(S.resizeTimer);S.resizeTimer=setTimeout(function(){var b=S.host&&S.host.querySelector("[data-cra-reach]");if(b&&Number(b.getAttribute("data-w"))!==Math.max(260,Math.floor(b.clientWidth||320)))drawReach();},120);};if(window.addEventListener)window.addEventListener("resize",S.onResize);}
if(!S.range)S.range=range(S.rangeId);paint();if(!S.loaded&&!S.loading)loadSites().then(load);},
    refresh:function(){return loadSites().then(load);},
    render:render,
    state:S
  };
})();
