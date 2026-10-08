/* First three instrumented adaptive surfaces.
 *
 * v1 is evidence-only: ask the Experience Plane for a decision, preserve the
 * returned identity order, and attach decision/exposure/outcome context to the
 * existing DOM. No layout generation and no silent reordering.
 */
(function(root){
  "use strict";
  if(!root.MCC_EXPERIENCE || root.MCC_ADAPTIVE_SURFACES) return;

  var seen={};

  function idFor(el,index,prefix){
    return String(
      el.getAttribute("data-track") ||
      el.getAttribute("data-title") ||
      el.getAttribute("data-creator-track") ||
      el.getAttribute("data-mission") ||
      el.getAttribute("data-open-mission") ||
      el.getAttribute("href") ||
      (prefix+"-"+index)
    ).slice(0,160);
  }

  function candidate(el,index,prefix){
    return {
      id:idFor(el,index,prefix),
      kind:prefix,
      position:index,
      meta:{
        title:String(el.getAttribute("data-title")||el.getAttribute("data-track")||el.textContent||"").trim().slice(0,180),
        href:el.getAttribute("href")||"",
        path:location.pathname
      }
    };
  }

  function observeVisible(decision,entry){
    if(!("IntersectionObserver" in root)){
      root.MCC_EXPERIENCE.visible(decision,entry.candidate,{instrumented:true});
      return;
    }
    var fired=false;
    var io=new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(!fired && e.isIntersecting && e.intersectionRatio>=0.5){
          fired=true;
          root.MCC_EXPERIENCE.visible(decision,entry.candidate,{instrumented:true});
          io.disconnect();
        }
      });
    },{threshold:[0.5]});
    io.observe(entry.el);
  }

  function instrument(surface,elements,kind,maxItems){
    var els=Array.prototype.slice.call(elements||[]).filter(Boolean);
    if(!els.length || seen[surface]) return Promise.resolve(null);
    seen[surface]=true;

    var entries=els.slice(0,40).map(function(el,i){
      return {el:el,candidate:candidate(el,i,kind)};
    });
    var candidates=entries.map(function(x){return x.candidate;});

    return root.MCC_EXPERIENCE.decide(surface,candidates,{maxItems:maxItems||candidates.length}).then(function(decision){
      if(!decision || !decision.ok){ seen[surface]=false; return null; }
      var selected={};
      (decision.candidates||[]).forEach(function(c){selected[String(c.id)]=c;});
      entries.forEach(function(entry){
        var chosen=selected[String(entry.candidate.id)];
        if(!chosen)return;
        entry.el.setAttribute("data-experience-decision",decision.decision_id);
        entry.el.setAttribute("data-experience-surface",surface);
        root.MCC_EXPERIENCE.impression(decision,chosen,{instrumented:true});
        observeVisible(decision,{el:entry.el,candidate:chosen});
        entry.el.addEventListener("click",function(){
          root.MCC_EXPERIENCE.interact(decision,chosen,{instrumented:true});
        },{capture:true});
      });
      return decision;
    }).catch(function(){seen[surface]=false;return null;});
  }

  function music(){
    var path=location.pathname;
    if(!/(?:album|listen|music-videos|music-creator).html$/.test(path))return;
    var els=document.querySelectorAll('#tracks li[data-title], [data-music-play][data-track], [data-music-play][data-creator-track]');
    instrument("music.next_step",els,"track",Math.min(6,els.length||1));
  }

  function action(){
    var path=location.pathname;
    if(!/(?:mnet|action|end-racism|heal-the-3rd-world|docket-516)/.test(path))return;
    var els=document.querySelectorAll('[data-mission], [data-open-mission], [data-take-mission], a[href*="/action/"]');
    instrument("action.next_step",els,"mission",Math.min(8,els.length||1));
  }

  function globalForYou(){
    if(!root.MCC_MODEL || !root.MCC_MODEL.prefetch)return;
    root.MCC_MODEL.prefetch("global.for_you",null,{maxItems:1});
  }

  function scan(){
    globalForYou();
    music();
    action();
  }

  var timer=null;
  function later(){
    clearTimeout(timer);
    timer=setTimeout(scan,80);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",scan,{once:true});
  else scan();

  var mo=new MutationObserver(later);
  if(document.documentElement) mo.observe(document.documentElement,{subtree:true,childList:true});

  root.MCC_ADAPTIVE_SURFACES={scan:scan,instrument:instrument};
})(window);
