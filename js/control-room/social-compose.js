/* Native Social composer for Control · Create · Channels. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var S={request:null,rerender:null,channels:[],picked:{},stats:null,loading:false,error:null,result:[],draft:"",loaded:false};
  var FN="https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/social";
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function token(){return window.MCC_SUPA&&MCC_SUPA.token?MCC_SUPA.token():Promise.resolve(null);}
  function call(payload){return token().then(function(t){if(!t)throw new Error("Signed out");return fetch(FN,{method:"POST",headers:{authorization:"Bearer "+t,"content-type":"application/json"},body:JSON.stringify(payload)});}).then(function(r){return r.text().then(function(raw){var j={};try{j=raw?JSON.parse(raw):{};}catch(_){}if(!r.ok)throw Object.assign(new Error(j.error||("Social service "+r.status)),{status:r.status});return j;});});}
  function label(k){var x=S.channels.find(function(c){return c.key===k;});return x?x.label:k;}
  function load(){
    if(S.loading)return Promise.resolve();S.loading=true;S.error=null;if(S.rerender)S.rerender();
    return Promise.allSettled([call({action:"channels"}),call({action:"stats",days:30})]).then(function(out){
      if(out[0].status==="fulfilled"){S.channels=(out[0].value.channels||[]).map(function(c){return{key:c.key,label:c.label||c.key,account:c.account,postable:!!c.postable,blockers:c.blockers||[]};});}else S.error=out[0].reason;
      S.stats=out[1].status==="fulfilled"?out[1].value:null;S.loading=false;S.loaded=true;if(S.rerender)S.rerender();
    });
  }
  function dests(){return[{key:"__mnet__",label:"Mnet",account:"your McCluster profile",postable:true,blockers:[],house:true}].concat(S.channels);}
  function stats(){
    var by=S.stats&&S.stats.by_channel||{},keys=Object.keys(by);if(!keys.length)return'<div class="cro-note">No social send/receive rows in the last 30 days.</div>';
    return'<div class="cro-list">'+keys.map(function(k){var c=by[k],total=Object.keys(c).reduce(function(a,x){return a+(Number(c[x])||0);},0),bits=Object.keys(c).sort().map(function(x){return x.replace(/_/g," ")+" "+c[x];}).join(" · ");return'<div class="cro-item"><div class="cro-item__head"><strong>'+e(label(k))+'</strong><b>'+e(total)+'</b></div><div class="cro-meta">'+e(bits)+'</div></div>';}).join("")+'</div>';
  }
  function render(){
    if(!S.loaded&&!S.loading)load();
    var ds=dests(),picked=ds.filter(function(c){return c.postable&&S.picked[c.key];}).length;
    var results=S.result.length?'<div class="cro-result">'+S.result.map(function(r){return'<div class="cro-result__row"><b>'+e(r.label)+'</b><span>'+e(r.detail)+'</span></div>';}).join("")+'</div>':"";
    return'<section class="cro-card"><h2>Post once</h2><p>Choose destinations here. This replaces the Socials Room as a separate place.</p><div class="cro-form"><label>Post<textarea id="croSocialBody" maxlength="5000" placeholder="Say it once.">'+e(S.draft)+'</textarea></label></div><div class="cro-dests" style="margin-top:8px">'+ds.map(function(c){var on=!!S.picked[c.key]&&c.postable;return'<button type="button" class="cro-dest'+(on?" is-on":"")+'" data-cro-social-dest="'+e(c.key)+'"'+(c.postable?"":" disabled")+'><span>'+((on?"✓":"○"))+'</span><span><b>'+e(c.label)+(c.house?' <span class="cro-pill">ours</span>':"")+'</b><small>'+e(c.postable?(c.account||"ready"):(c.blockers[0]||"not available"))+'</small></span></button>';}).join("")+'</div><div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-cro-social-send'+(!picked||!S.draft.trim()?' disabled':"")+'>'+(S.loading?"Loading…":picked?"Post to "+picked+" destination"+(picked===1?"":"s"):"Choose destinations")+'</button></div>'+results+(S.error?'<div class="cro-note cro-note--bad" style="margin-top:8px">'+e(S.error.message||S.error)+'</div>':"")+'</section><section class="cro-card"><h2>Channel health · 30 days</h2>'+stats()+'</section>';
  }
  function send(btn){
    var body=S.draft.trim();if(!body)return;var list=dests().filter(function(c){return c.postable&&S.picked[c.key];});if(!list.length)return;btn.disabled=true;btn.textContent="Sending…";
    var mnet=list.some(function(c){return c.key==="__mnet__";}),keys=list.filter(function(c){return c.key!=="__mnet__";}).map(function(c){return c.key;});
    Promise.allSettled([
      mnet?S.request("/v1/mnet/posts?app_key=mccluster-web",{method:"POST",body:{body:body}}):Promise.resolve(null),
      keys.length?call({action:"queue",channels:keys,body:body,kind:"post"}):Promise.resolve(null)
    ]).then(function(out){
      var rows=[];if(mnet)rows.push(out[0].status==="fulfilled"?{label:"Mnet",detail:"Posted to your profile."}:{label:"Mnet",detail:(out[0].reason&&out[0].reason.message)||"Could not post."});
      if(keys.length){if(out[1].status!=="fulfilled")keys.forEach(function(k){rows.push({label:label(k),detail:(out[1].reason&&out[1].reason.message)||"Queue refused this."});});else{var x=out[1].value||{};(x.queued||[]).forEach(function(k){rows.push({label:label(k),detail:x.approved_by?"Queued and approved.":"Queued; approval required."});});(x.refused||[]).forEach(function(r){rows.push({label:label(r.channel),detail:r.why||"refused"});});}}
      S.result=rows;if(rows.length)S.draft="";return load();
    }).catch(function(err){S.error=err;if(S.rerender)S.rerender();});
  }
  function bind(root){
    var ta=root&&root.querySelector("#croSocialBody");if(ta){ta.oninput=function(){S.draft=ta.value;var b=root.querySelector("[data-cro-social-send]");var cnt=dests().filter(function(c){return c.postable&&S.picked[c.key];}).length;if(b)b.disabled=!cnt||!S.draft.trim();};}
    (root?root.querySelectorAll("[data-cro-social-dest]"):[]).forEach(function(b){b.onclick=function(){var k=b.getAttribute("data-cro-social-dest");S.picked[k]=!S.picked[k];if(S.rerender)S.rerender();};});
    var sendBtn=root&&root.querySelector("[data-cro-social-send]");if(sendBtn)sendBtn.onclick=function(){send(sendBtn);};
  }
  window.CR.socialCompose={init:function(opts){S.request=opts.request;S.rerender=opts.render;},render:render,bind:bind,load:load,state:S};
})();
