/* McCluster Adaptive Surfaces v1
 *
 * Constrained renderer + instrumentation for the first three production
 * surfaces. The decision service may return IDs and order only. Labels,
 * destinations and DOM structure stay in this versioned client allowlist.
 */
(function(root,doc){
  "use strict";
  var seenVisible={};

  function cleanCandidate(c,index){
    if(!c||c.id==null)return null;
    return {
      id:String(c.id).slice(0,160),
      kind:String(c.kind||"content").slice(0,64),
      position:Number.isFinite(Number(c.position))?Number(c.position):index,
      label:String(c.label||"").slice(0,120),
      sub:String(c.sub||"").slice(0,220),
      href:String(c.href||"").slice(0,1200),
      eyebrow:String(c.eyebrow||"").slice(0,80),
      meta:c.meta&&typeof c.meta==="object"?c.meta:{}
    };
  }
  function safeHref(raw){
    try{
      var u=new URL(String(raw||""),location.href);
      if(u.protocol!=="http:"&&u.protocol!=="https:")return null;
      if(u.origin!==location.origin)return null;
      return String(raw);
    }catch(_){return null;}
  }
  function byId(list){
    var map={}; list.forEach(function(c){map[c.id]=c;}); return map;
  }
  async function decide(surface,candidates,opts){
    var local=(candidates||[]).map(cleanCandidate).filter(Boolean);
    var maxItems=Math.max(1,Math.min(local.length,Number(opts&&opts.maxItems)||local.length));
    var decision=null;
    try{
      if(root.MCC_MODEL&&typeof root.MCC_MODEL.decide==="function"){
        decision=await root.MCC_MODEL.decide(surface,local,{maxItems:maxItems});
      }else if(root.MCC_EXPERIENCE&&typeof root.MCC_EXPERIENCE.decide==="function"){
        decision=await root.MCC_EXPERIENCE.decide(surface,local,{maxItems:maxItems});
      }
    }catch(_){}
    var map=byId(local);
    var selected=decision&&decision.ok&&Array.isArray(decision.candidates)
      ? decision.candidates.map(function(c){
          var localCandidate=map[String(c.id)];
          return localCandidate ? Object.assign({},localCandidate,{position:Number.isFinite(Number(c.position))?Number(c.position):localCandidate.position}) : null;
        }).filter(Boolean)
      : local.slice(0,maxItems);
    if(!selected.length)selected=local.slice(0,maxItems);
    return {decision:decision&&decision.ok?decision:null,candidates:selected,fallback:!(decision&&decision.ok)};
  }
  function evidence(name,decision,candidate,extra){
    if(!decision||!root.MCC_EXPERIENCE||typeof root.MCC_EXPERIENCE[name]!=="function")return;
    try{root.MCC_EXPERIENCE[name](decision,candidate,extra||{});}catch(_){}
  }
  function watchVisible(el,decision,candidate,surface){
    if(!decision)return;
    var key=decision.decision_id+":"+candidate.id;
    if(!("IntersectionObserver" in root)){
      if(!seenVisible[key]){seenVisible[key]=1;evidence("visible",decision,candidate,{surface:surface});}
      return;
    }
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(!entry.isIntersecting||entry.intersectionRatio<0.55||seenVisible[key])return;
        seenVisible[key]=1;
        evidence("visible",decision,candidate,{surface:surface});
        io.disconnect();
      });
    },{threshold:[0.55]});
    io.observe(el);
  }
  function hasSession(){
    try{var s=JSON.parse(localStorage.getItem("mccdb_session")||"null");return !!(s&&s.access_token);}catch(_){return false;}
  }
  function card(candidate,decision,surface){
    var href=safeHref(candidate.href);
    var wrap=doc.createElement("article");
    wrap.className="adaptive-card";
    wrap.dataset.candidateId=candidate.id;
    var main=doc.createElement(href?"a":"div");
    main.className="adaptive-card__main";
    if(href)main.href=href;
    var k=doc.createElement("span");k.className="adaptive-card__k";k.textContent=candidate.eyebrow||"Next";
    var b=doc.createElement("b");b.textContent=candidate.label||candidate.id;
    var s=doc.createElement("small");s.textContent=candidate.sub||"";
    var go=doc.createElement("span");go.className="adaptive-card__go";go.textContent="→";go.setAttribute("aria-hidden","true");
    main.append(k,b,s,go);
    wrap.appendChild(main);
    if(hasSession()&&root.MCC_EXPERIENCE&&typeof root.MCC_EXPERIENCE.prefer==="function"){
      var tune=doc.createElement("div");tune.className="adaptive-card__tune";tune.setAttribute("aria-label","Tune this recommendation");
      [["more","More like this"],["less","Less like this"]].forEach(function(pair){
        var btn=doc.createElement("button");btn.type="button";btn.textContent=pair[1];btn.dataset.preference=pair[0];
        btn.addEventListener("click",function(){
          btn.disabled=true;
          root.MCC_EXPERIENCE.prefer(surface,candidate.id,pair[0]).then(function(out){
            btn.disabled=false;
            if(!out||!out.ok)return;
            Array.prototype.forEach.call(tune.querySelectorAll("button"),function(x){x.classList.toggle("is-on",x===btn);});
          });
        });
        tune.appendChild(btn);
      });
      wrap.appendChild(tune);
    }
    evidence("impression",decision,candidate,{surface:surface});
    watchVisible(wrap,decision,candidate,surface);
    main.addEventListener("click",function(){
      evidence("interact",decision,candidate,{surface:surface});
      if(root.MCC_TRACK)root.MCC_TRACK("foryou_tap",{dom:candidate.meta&&candidate.meta.domain||"",surface:surface,candidate_id:candidate.id});
    });
    return wrap;
  }
  async function mount(rootEl,surface,candidates,opts){
    if(typeof rootEl==="string")rootEl=doc.querySelector(rootEl);
    if(!rootEl)return null;
    var out=await decide(surface,candidates,opts||{});
    rootEl.textContent="";
    out.candidates.forEach(function(c){rootEl.appendChild(card(c,out.decision,surface));});
    rootEl.hidden=!out.candidates.length;
    rootEl.dataset.experienceSource=out.fallback?"local-fallback":"decision";
    if(out.decision)rootEl.dataset.decisionId=out.decision.decision_id||"";
    return out;
  }
  function globalCandidates(){
    return [
      {id:"music",kind:"destination",eyebrow:"Listen",label:"Music",sub:"Play the catalog, watch the music videos, keep your rotation.",href:"listen.html",meta:{domain:"music",topic:"music discovery"}},
      {id:"action",kind:"destination",eyebrow:"Do something",label:"Action Network",sub:"Pick an action and turn attention into a mission.",href:"action/",meta:{domain:"action",topic:"missions"}},
      {id:"client",kind:"destination",eyebrow:"Build something",label:"Work with McCluster",sub:"Web, media, music and operating systems for your project.",href:"hire.html",meta:{domain:"client",topic:"services"}}
    ];
  }
  function musicCandidates(){
    return [
      {id:"here-album",kind:"music",eyebrow:"Keep listening",label:"I AM HERE",sub:"Six tracks in the album player.",href:"album.html?album=here",meta:{domain:"music",topic:"album"}},
      {id:"here-videos",kind:"music",eyebrow:"Watch",label:"Music Videos",sub:"The records as full-screen music videos with live lyrics.",href:"music-videos.html?album=here",meta:{domain:"music",topic:"music video"}},
      {id:"creator-studio",kind:"creator",eyebrow:"Make your own",label:"Creator Studio",sub:"Release music into the same network people listen in.",href:"creator.html",meta:{domain:"artist",topic:"creator tools"}}
    ];
  }
  async function rank(surface,items,toCandidate,opts){
    var rows=Array.isArray(items)?items.slice():[];
    var candidates=rows.map(function(item,i){
      var c=toCandidate?toCandidate(item,i):item;
      return cleanCandidate(c,i);
    }).filter(Boolean);
    var out=await decide(surface,candidates,opts||{maxItems:candidates.length});
    var lookup={};
    rows.forEach(function(item,i){var c=candidates[i];if(c)lookup[c.id]=item;});
    return {
      decision:out.decision,
      fallback:out.fallback,
      items:out.candidates.map(function(c){return{item:lookup[c.id],candidate:c};}).filter(function(x){return x.item!=null;})
    };
  }
  function instrument(el,decision,candidate,surface){
    if(!el||!candidate)return el;
    evidence("impression",decision,candidate,{surface:surface});
    watchVisible(el,decision,candidate,surface);
    el.addEventListener("click",function(){evidence("interact",decision,candidate,{surface:surface});});
    return el;
  }
  root.MCC_ADAPTIVE={
    decide:decide,mount:mount,rank:rank,instrument:instrument,
    mountGlobal:function(el){return mount(el,"global.for_you",globalCandidates(),{maxItems:3});},
    mountMusic:function(el){return mount(el,"music.next_step",musicCandidates(),{maxItems:3});},
    evidence:evidence
  };
  function autoMount(){
    doc.querySelectorAll("[data-adaptive-auto]").forEach(function(el){
      var kind=el.getAttribute("data-adaptive-auto");
      if(kind==="global")root.MCC_ADAPTIVE.mountGlobal(el);
      else if(kind==="music")root.MCC_ADAPTIVE.mountMusic(el);
    });
  }
  if(doc.readyState==="loading")doc.addEventListener("DOMContentLoaded",autoMount,{once:true});
  else autoMount();
})(window,document);
