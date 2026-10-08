/* MCC_MODEL compatibility adapter -> Experience Decision Plane.
 *
 * Keeps the old synchronous MCC_MODEL contract alive while prefetching a
 * server-authoritative decision in the background. The current production
 * policy is identity_order, so this layer records opportunity/exposure without
 * changing live ranking. If the decision service is unavailable, callers keep
 * the legacy on-device behavior.
 */
(function(root){
  "use strict";
  if(!root.MCC_MODEL || !root.MCC_EXPERIENCE || root.MCC_MODEL.__experience_adapter) return;

  var legacy=root.MCC_MODEL;
  var cache={};
  var inflight={};

  var LIBRARY=[
    {id:"music",kind:"next_step",label:"Back to the music",sub:"Your rotation is waiting in the app",href:"app.html",dom:"music"},
    {id:"experience",kind:"next_step",label:"Step back inside the jet",sub:"The 360 cabin, pins and all",href:"vr-vaunt.html",dom:"experience"},
    {id:"client",kind:"next_step",label:"Back to the studio",sub:"The weekly system · come see me",href:"hire.html",dom:"client"},
    {id:"artist",kind:"next_step",label:"Open the Market",sub:"Deals, splits, bookings — one engine",href:"market.html",dom:"artist"},
    {id:"civic",kind:"next_step",label:"Back to the record",sub:"The public record, explained",href:"docket-516.html",dom:"civic"},
    {id:"org",kind:"next_step",label:"Join the organization",sub:"Boards · programs · the donor circle",href:"market.html#providers",dom:"org"}
  ];

  function samePage(href){
    try{
      var u=new URL(href,location.href);
      return u.pathname===location.pathname && (!u.hash || u.hash===location.hash);
    }catch(_){return false;}
  }

  function toCandidate(item,index){
    return {
      id:item.id,
      kind:item.kind||"next_step",
      position:index,
      meta:{
        label:item.label||"",
        sub:item.sub||"",
        href:item.href||"",
        dom:item.dom||""
      }
    };
  }

  function fromCandidate(c){
    var m=c&&c.meta||{};
    return {
      label:m.label||"Keep going",
      sub:m.sub||"",
      href:m.href||"#",
      dom:m.dom||c.id||null,
      why:"experience:"+String(c.id||"selected"),
      decision_id:null
    };
  }

  function candidateOrder(){
    var first=null;
    try{first=legacy.suggest();}catch(_){}
    var list=LIBRARY.filter(function(x){return !samePage(x.href);});
    if(first&&first.dom){
      list.sort(function(a,b){
        if(a.dom===first.dom)return -1;
        if(b.dom===first.dom)return 1;
        return 0;
      });
    }
    return list;
  }

  function prefetch(surface,items,opts){
    surface=surface||"global.for_you";
    if(cache[surface]||inflight[surface]) return inflight[surface]||Promise.resolve(cache[surface]);
    var list=(items&&items.length?items:candidateOrder()).map(toCandidate);
    inflight[surface]=root.MCC_EXPERIENCE.decide(surface,list,opts||{maxItems:1}).then(function(d){
      if(d&&d.ok){
        cache[surface]=d;
        return d;
      }
      return null;
    }).catch(function(){return null;}).finally(function(){delete inflight[surface];});
    return inflight[surface];
  }

  function suggest(){
    var d=cache["global.for_you"];
    if(d&&d.candidates&&d.candidates.length){
      var out=fromCandidate(d.candidates[0]);
      out.decision_id=d.decision_id;
      out.why="experience:"+d.policy.key+"@"+d.policy.version;
      return out;
    }
    var fallback=legacy.suggest();
    prefetch("global.for_you",null,{maxItems:1});
    return fallback;
  }

  function shown(dom){
    try{legacy.shown(dom);}catch(_){}
    var d=cache["global.for_you"];
    if(!d||!d.candidates||!d.candidates.length)return;
    var c=d.candidates[0];
    if(dom && c.meta && c.meta.dom && dom!==c.meta.dom)return;
    root.MCC_EXPERIENCE.impression(d,c,{compatibility_api:"MCC_MODEL.shown"});
  }

  function profile(){
    var p=legacy.profile();
    p.experience_service=cache["global.for_you"]?"ready":(inflight["global.for_you"]?"loading":"fallback");
    p.experience_decision_id=cache["global.for_you"]&&cache["global.for_you"].decision_id||null;
    return p;
  }

  var adapted={};
  Object.keys(legacy).forEach(function(k){adapted[k]=legacy[k];});
  adapted.suggest=suggest;
  adapted.shown=shown;
  adapted.profile=profile;
  adapted.prefetch=prefetch;
  adapted.decision=function(surface){return cache[surface||"global.for_you"]||null;};
  adapted.__experience_adapter=true;
  adapted.__legacy=legacy;
  root.MCC_MODEL=adapted;

  prefetch("global.for_you",null,{maxItems:1});
})(window);
