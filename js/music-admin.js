(function(root){
  "use strict";
  var SB="https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY="sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var session=null,state={tracks:[],creators:[],offers:[]};
  var $=function(id){return document.getElementById(id);};
  function esc(x){var d=document.createElement("i");d.textContent=x==null?"":String(x);return d.innerHTML;}
  function money(c,curr){try{return new Intl.NumberFormat(undefined,{style:"currency",currency:(curr||"usd").toUpperCase()}).format(Number(c||0)/100);}catch(_){return "$"+(Number(c||0)/100).toFixed(2);}}
  async function call(action,body){
    var res=await fetch(SB+"/functions/v1/music-access",{method:"POST",headers:{apikey:KEY,authorization:"Bearer "+session.access_token,"content-type":"application/json"},body:JSON.stringify(Object.assign({action:action},body||{}))});
    var data=await res.json().catch(function(){return{};});
    if(!res.ok)throw new Error(data.error||("Music service "+res.status));
    return data;
  }
  function creatorMap(){var m={};state.creators.forEach(function(c){m[c.m_uid]=c;});return m;}
  function render(){
    var cm=creatorMap();
    $("adminTracks").innerHTML=state.tracks.length?state.tracks.map(function(t){
      var c=cm[t.m_uid]||{};
      return '<div class="creator-admin-row"><div><b>'+esc(t.title)+'</b><small>'+esc(c.artist_name||t.artist||"Unknown creator")+
        ' · '+esc(t.access_mode)+' · '+esc(t.status)+' · rights '+esc(t.rights_status)+
        (t.moderation_note?'<br>'+esc(t.moderation_note):'')+'</small></div>'+
        '<div class="creator-actions">'+
          '<button class="creator-btn good" data-review="publish" data-track="'+esc(t.id)+'">Publish + clear</button>'+
          '<button class="creator-btn quiet" data-review="review" data-track="'+esc(t.id)+'">Needs review</button>'+
          '<button class="creator-btn quiet" data-review="reject" data-track="'+esc(t.id)+'">Reject</button>'+
        '</div></div>';
    }).join(""):'<div class="creator-status">No creator releases in the queue.</div>';

    var byTrack={};state.tracks.forEach(function(t){byTrack[t.id]=t;});
    $("adminOffers").innerHTML=state.offers.length?state.offers.map(function(o){
      var t=byTrack[o.track_id]||{};
      var live=o.active&&o.checkout_enabled;
      return '<div class="creator-admin-row"><div><b>'+esc(o.title)+'</b><small>'+esc(t.title||o.track_id)+' · '+esc(o.license_type)+
        (o.price_cents!=null?' · '+esc(money(o.price_cents,o.currency)):'')+
        ' · platform fee '+(Number(o.platform_fee_bps||0)/100).toFixed(1)+'%</small></div>'+
        '<div class="creator-actions"><button class="creator-btn '+(live?'quiet':'good')+'" data-license="'+esc(o.id)+'" data-enabled="'+(live?'0':'1')+'">'+
        (live?'Disable checkout':'Enable checkout')+'</button></div></div>';
    }).join(""):'<div class="creator-status">No license offers yet.</div>';
  }
  async function load(){
    var d=await call("operator-dashboard",{});
    state.tracks=d.tracks||[];state.creators=d.creators||[];state.offers=d.offers||[];
    render();
  }
  document.addEventListener("click",async function(e){
    var b=e.target.closest&&e.target.closest("[data-review]");
    if(b){
      var decision=b.getAttribute("data-review"),note="";
      if(decision!=="publish")note=prompt(decision==="reject"?"Why is this release rejected?":"What documentation/review is needed?","")||"";
      b.disabled=true;
      try{await call("operator-review",{track_id:b.getAttribute("data-track"),decision:decision,note:note});await load();}
      catch(err){alert(err.message||"Review failed");}
      finally{b.disabled=false;}
      return;
    }
    var l=e.target.closest&&e.target.closest("[data-license]");
    if(l){
      l.disabled=true;
      try{await call("operator-license",{offer_id:l.getAttribute("data-license"),enabled:l.getAttribute("data-enabled")==="1"});await load();}
      catch(err){alert(err.message||"License update failed");}
      finally{l.disabled=false;}
    }
  });
  (async function(){
    session=await root.MCC.refreshIfNeeded();
    if(!session||!session.access_token)return;
    try{
      var st=await call("operator-status",{});
      if(!st.operator)return;
      $("adminGate").hidden=true;$("adminApp").hidden=false;await load();
    }catch(_){}
  })();
})(window);