/* Native Control · Create · Member fronts (moderation).

   The house owner's look at any account's front page and the one action the house keeps over it: a takedown
   (workers/mccluster/src/member-fronts.js; versioned form in editor-versioned.js). Until now that route had no
   screen. Everything here reads before it writes: the page's current revision is shown, the takedown carries it
   (`POST /v2/fronts/{handle}/takedown {expected_revision, reason}`), and a page that changed meanwhile is read
   again rather than taken down blind. Where the versioned API reports itself unconfigured, the legacy
   unconditional takedown remains, and is labelled as such.

   Nothing here edits a member's words or media: ordinary owner rights stay with the member; the house only
   removes a publication and records why. Recovery of a house takedown is not an owner action (v3 contract). */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var API="https://api.mccluster.org",HANDLE=/^[a-z0-9][a-z0-9._-]{2,39}$/;
  var S={handle:"",looking:false,record:null,v2:null,legacy:false,history:null,showHistory:false,message:"",bad:false,working:false,reason:"",conflict:null,done:null};
  var V2=window.MCC_EDITOR_V2;
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function sb(){return window.MCC_SUPA||{};}
  function token(){return sb().token?sb().token():Promise.resolve(null);}
  function when(iso){if(!iso)return"";var d=new Date(iso);return isNaN(d)?"":d.toLocaleString();}
  function api(path,opts){
    opts=opts||{};
    return token().then(function(t){
      if(!t)throw Object.assign(new Error("Sign in as the house owner."),{status:401});
      return fetch(API+path,{method:opts.method||"GET",headers:Object.assign({authorization:"Bearer "+t,accept:"application/json"},opts.body?{"content-type":"application/json"}:{}),body:opts.body?JSON.stringify(opts.body):undefined,cache:"no-store"});
    }).then(function(r){return r.json().catch(function(){return null;}).then(function(b){if(!r.ok)throw Object.assign(new Error((b&&(b.error||b.message))||("HTTP "+r.status)),{status:r.status,body:b});return b;});});
  }
  function client(){return V2&&HANDLE.test(S.handle)?V2.owned(api,"fronts",S.handle):null;}
  function explain(err,what){return V2?V2.explain(V2.classify(err),what):(err.message||String(err));}
  function kind(err){return V2?V2.classify(err).kind:"other";}

  function look(){
    if(!HANDLE.test(S.handle)){S.message="A handle is 3–40 lowercase letters, digits, dots, underscores or hyphens.";S.bad=true;paint();return;}
    S.looking=true;S.record=null;S.v2=null;S.legacy=false;S.history=null;S.showHistory=false;S.message="";S.bad=false;S.conflict=null;S.done=null;paint();
    var c=client();
    (c?c.read():Promise.reject(Object.assign(new Error("unconfigured"),{status:503,body:{code:"unconfigured"}}))).then(function(v){
      S.v2={revision:v.revision,protected:!!v.protected};S.record=v.snapshot||null;
      if(!S.record)S.message="No front page record for @"+S.handle+" yet.";
    }).catch(function(err){
      var k=kind(err);
      if(k==="unconfigured"){S.legacy=true;S.message="Versioned moderation is not switched on here. The legacy takedown route is available: it removes the publication without a revision check.";S.bad=false;}
      else{S.message=explain(err,"read");S.bad=true;}
    }).then(function(){S.looking=false;paint();});
  }
  function loadHistory(){
    if(!S.v2)return;S.history=null;paint();
    client().history().then(function(h){S.history=Array.isArray(h&&h.history)?h.history:[];}).catch(function(err){S.history=[];S.message=explain(err,"listed");S.bad=true;}).then(paint);
  }
  function takedown(){
    if(S.working)return;
    var reason=String(S.reason||"").trim();
    if(!reason){S.message="Write the reason first: it is recorded with the takedown.";S.bad=true;paint();return;}
    if(!window.confirm("Take @"+S.handle+"'s published front page down? The member keeps their draft and cannot republish it from here.\n\nReason: "+reason))return;
    S.working=true;S.message=S.legacy?"Taking down (legacy route)…":"Taking down revision "+S.v2.revision+"…";S.bad=false;S.conflict=null;paint();
    var p=S.legacy?api("/v1/fronts/"+encodeURIComponent(S.handle)+"/takedown",{method:"POST",body:{reason:reason}}).then(function(){S.done={legacy:true};})
      :client().takedown(S.v2.revision,reason).then(function(v){S.v2={revision:v.revision,protected:!!v.protected};S.record=v.snapshot||S.record;S.done={revision:v.revision};});
    p.then(function(){S.message="Taken down. @"+S.handle+"'s page is no longer public; the reason is recorded.";S.bad=false;if(S.showHistory)loadHistory();})
      .catch(function(err){
        var k=kind(err);
        if(k==="conflict"&&S.v2){S.message="Not taken down: this page changed since you looked at it. It was read again; check it, then decide.";S.bad=true;return client().read().then(function(v){S.v2={revision:v.revision,protected:!!v.protected};S.record=v.snapshot||null;S.conflict=true;}).catch(function(){});}
        S.message=explain(err,"taken down");S.bad=true;
      }).then(function(){S.working=false;paint();});
  }

  function recordHtml(){
    var r=S.record;if(!r)return"";
    var state=r.removed_at?"Taken down "+when(r.removed_at)+(r.removed_reason?" · "+r.removed_reason:""):r.published?"Published "+when(r.published_at):"Draft only, never published";
    return'<div class="cr-card cmf-record"><h2 class="cr-card__title">@'+e(r.handle||S.handle)+'</h2>'+
      '<p class="cro-meta">'+e(state)+(S.v2?' · revision '+e(S.v2.revision)+(S.v2.protected?' · versioned':' · not yet enrolled'):'')+(r.updated_at?' · last saved '+e(when(r.updated_at)):'')+'</p>'+
      (r.published&&!r.removed_at?'<p><a class="cr-btn cr-btn--ghost" href="front.html?u='+encodeURIComponent(r.handle||S.handle)+'" target="_blank" rel="noopener">Open the public page ↗</a></p>':'')+
      (r.removed_at?'<p class="cro-note">Already taken down. The member keeps their draft; a house takedown is not recovered from the member\'s editor.</p>':
        '<label class="cmf-reason">Reason for the takedown (recorded)<textarea data-cmf="reason" maxlength="300" rows="3">'+e(S.reason)+'</textarea></label>'+
        '<div class="cro-actions"><button type="button" class="cr-btn cr-btn--danger" data-cmf="takedown"'+(S.working||!r.published?' disabled':'')+'>'+(S.legacy?'Take it down (legacy, no revision check)':'Take it down')+'</button>'+
        (S.v2?'<button type="button" class="cr-btn cr-btn--ghost" data-cmf="history" aria-expanded="'+(S.showHistory?"true":"false")+'">History</button>':'')+'</div>'+
        (!r.published?'<p class="cro-meta">Nothing is published, so there is nothing to take down.</p>':''))+
      (S.showHistory?'<section class="cmf-history" aria-label="Saved revisions">'+(S.history===null?'<p class="cro-meta">Reading…</p>':!S.history.length?'<p class="cro-meta">No revisions recorded.</p>':'<ul class="cmf-revisions">'+S.history.map(function(h){return'<li><b>Revision '+e(h.revision)+'</b> <small>'+e(h.operation||"")+(h.actor?' · '+e(String(h.actor).slice(0,8)):' · (no actor recorded)')+(h.at?' · '+e(when(h.at)):'')+'</small></li>';}).join("")+'</ul>')+'</section>':"")+
      '</div>';
  }
  function render(){
    return'<div class="cro cmf" data-cmf-root>'+
      '<section class="cr-card"><h2 class="cr-card__title">Look up a member\'s front page</h2>'+
        '<p class="cro-meta">The house owner can see any account\'s page record and take a publication down. Words and media stay the member\'s to edit.</p>'+
        '<form class="cro-form cmf-form" data-cmf-form><label>Handle<input name="handle" value="'+e(S.handle)+'" maxlength="40" autocomplete="off" spellcheck="false" inputmode="url" placeholder="handle, as in front.html?u=handle"></label>'+
        '<div class="cro-actions"><button type="submit" class="cr-btn cr-btn--primary"'+(S.looking?' disabled':'')+'>'+(S.looking?'Looking…':'Look up')+'</button></div></form>'+
        (S.message?'<div class="cro-note'+(S.bad?" cro-note--bad":"")+'" role="status">'+e(S.message)+'</div>':'')+
      '</section>'+recordHtml()+'</div>';
  }
  function paint(){var root=document.querySelector("[data-cmf-root]");if(!root||!root.parentNode)return;var host=document.createElement("div");host.innerHTML=render();root.parentNode.replaceChild(host.firstChild,root);bind(document);}
  function bind(root){
    var host=root&&root.querySelector("[data-cmf-root]");if(!host)return;
    var form=host.querySelector("[data-cmf-form]");
    form.addEventListener("submit",function(ev){ev.preventDefault();S.handle=String(form.handle.value||"").trim().toLowerCase();look();});
    host.addEventListener("input",function(ev){var t=ev.target;if(t&&t.getAttribute&&t.getAttribute("data-cmf")==="reason")S.reason=t.value;});
    host.addEventListener("click",function(ev){var b=ev.target.closest&&ev.target.closest("button[data-cmf]");if(!b||b.disabled)return;var a=b.getAttribute("data-cmf");if(a==="takedown")takedown();if(a==="history"){S.showHistory=!S.showHistory;if(S.showHistory)loadHistory();else paint();}});
  }
  window.CR.memberFronts={render:render,bind:bind,state:S,look:look,takedown:takedown};
})();
