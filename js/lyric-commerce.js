/* Lyric Commerce
   Shared by album and music-video surfaces. A lyric can expose a service CTA
   only when a configured phrase actually exists in the canonical lyric line.
   No generated/invented lyric copy lives here. */
(function(){
  "use strict";
  function safeRules(experience){
    var x=experience&&typeof experience==="object"?experience:{};
    return Array.isArray(x.lyric_ctas)?x.lyric_ctas.filter(function(r){
      return r&&typeof r==="object"&&String(r.match||"").trim()&&String(r.href||"").trim();
    }):[];
  }
  function find(line,experience){
    var text=String(line||"");
    var lower=text.toLowerCase();
    var rules=safeRules(experience);
    for(var i=0;i<rules.length;i++){
      var needle=String(rules[i].match||"").trim();
      var at=lower.indexOf(needle.toLowerCase());
      if(at>=0)return{rule:rules[i],start:at,end:at+needle.length};
    }
    return null;
  }
  function renderLine(container,line,experience,context){
    if(!container)return null;
    var text=String(line||"");
    container.textContent="";
    var hit=find(text,experience);
    if(!hit){container.textContent=text;return null;}
    if(hit.start)container.appendChild(document.createTextNode(text.slice(0,hit.start)));
    var a=document.createElement("a");
    a.className="lyric-service-cta";
    a.href=String(hit.rule.href);
    a.textContent=text.slice(hit.start,hit.end);
    a.dataset.offer=String(hit.rule.offer_id||"");
    a.dataset.label=String(hit.rule.label||"");
    a.setAttribute("aria-label",String(hit.rule.label||("Open "+hit.rule.href)));
    a.addEventListener("click",function(){
      if(window.MCC_TRACK)window.MCC_TRACK("lyric_service_cta_click",{
        track:context&&context.track||null,
        album:context&&context.album||null,
        offer:hit.rule.offer_id||null,
        phrase:hit.rule.match||null,
        surface:context&&context.surface||null
      });
    });
    container.appendChild(a);
    if(hit.end<text.length)container.appendChild(document.createTextNode(text.slice(hit.end)));
    if(window.MCC_TRACK)window.MCC_TRACK("lyric_service_cta_view",{
      track:context&&context.track||null,
      album:context&&context.album||null,
      offer:hit.rule.offer_id||null,
      phrase:hit.rule.match||null,
      surface:context&&context.surface||null
    });
    return hit.rule;
  }
  function bindPrimary(anchor,experience,context){
    if(!anchor)return;
    var c=experience&&experience.commerce&&typeof experience.commerce==="object"?experience.commerce:null;
    anchor.hidden=!c||!c.href;
    if(!c||!c.href){anchor.removeAttribute("href");return;}
    anchor.href=String(c.href);
    anchor.textContent=String(c.label||"Take the next step");
    anchor.dataset.offer=String(c.offer_id||"");
    anchor.onclick=function(){
      if(window.MCC_TRACK)window.MCC_TRACK("track_service_cta_click",{
        track:context&&context.track||null,
        album:context&&context.album||null,
        offer:c.offer_id||null,
        surface:context&&context.surface||null
      });
    };
  }
  window.MCC_LYRIC_COMMERCE={find:find,renderLine:renderLine,bindPrimary:bindPrimary};
}());
