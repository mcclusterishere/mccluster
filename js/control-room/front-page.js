/* Native Control · Create · Front page.

   Owner, 2026-10-21: "My front page as the admin is not my actual site's front page ... I should be able to control my
   site's front page, like the actual front page of the website, with the scroll dependent and the VR and all that stuff
   from my admin panel ... and it should represent as my actual front page."

   THE PREVIEW IS THE REAL PAGE. The frame holds index.html itself, on this origin, as every visitor gets it: the scroll
   films, the Vaunt scene, the 360 cabin, the night room. Nothing here imitates it.

   WHAT IS CONTROLLED, AND HOW. index.html is never rewritten. Its scroll engine (js/main.js) reads one row,
   site_content page "index.html" slot "@front" (a JSON value), through js/live-content.js, for every visitor. This view
   edits that row:
   - the scenes on the page (the hero's two doors, the Vaunt scene and its cabin, the night descent, the World at the end);
   - the scroll feel (how long a scroll glides, how closely a finger is followed);
   - the 360 cabin: on or off, whether it holds the page, where in the Vaunt scene it opens, the view it opens on, and its
     tags (label and link);
   - where the night room arrives in the descent;
   - (owner, 2026-10-29) where the page opens (in the Vaunt cabin, as shipped, or on the plane), its one song (Antisocial,
     as shipped), and whether the public sees it at all: tucked away (visible:false), visitors get a holding screen and
     the page is noindex, while the house owner still sees it. A static site still serves its files: hidden, not secret.
   A change shows in the preview at once (a draft posted to the frame, which only a Control Room parent on this origin
   can send) and reaches visitors only on explicit Publish. The page checks and bounds every value itself (frontConfig in
   js/main.js), and what is saved is what the page applied, read back from the frame. Reset stages the shipped page in the preview; Publish removes the override. Every save and reset is kept in site_content_history by the table's own trigger.
   The pencil remains a separate immediate-publication workflow on the standalone page. It is disabled in this preview. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var PAGE="index.html",SLOT="@front";
  var DEVICES={phone:{w:390,h:844,label:"Phone"},desktop:{w:1280,h:800,label:"Desktop"}};
  var JUMPS=[["top","Top"],["cabin","Cabin"],["vaunt","Plane"],["night","Night"],["world","World"]];
  /* owner, 2026-10-29: the page opens in the Vaunt cabin and plays Antisocial; both can be changed here (start, song) */
  var STARTS={cabin:"In the 360 cabin (as shipped)",plane:"On the plane (no cabin)"};
  var SONGS={antisocial:"Antisocial (as shipped)",whodidtheshoot:"Who Did The Shoot",vaunt:"Vaunt (acoustic)",runway:"Runway Walk",here:"Here","environmental-injustice":"Environmental Injustice"};
  var FEEL={smooth:{duration:1.2,touchLerp:0.1,label:"Smooth"},standard:{duration:0.85,touchLerp:0.14,label:"Standard (as shipped)"},quick:{duration:0.55,touchLerp:0.22,label:"Quick"}};
  var S={request:null,rerender:null,device:"phone",saved:null,savedAt:null,loaded:false,loading:false,loadError:null,
    draft:null,applied:null,seq:0,acked:0,waiters:[],ready:false,dirty:false,saving:false,message:"",bad:false,frame:null,observer:null,viewAs:"owner",revision:null,history:[],publicationReady:false,publicationError:"",resetDraft:false,storedDraft:null,draftBase:null,epoch:0,sessionIdentity:undefined};

  /* the page's own rule for a tag (frontHref / frontConfig in js/main.js), so a refused tag is named here, in the form,
     instead of quietly vanishing from the preview; the page still checks everything itself */
  function spotProblem(s){
    var label=String(s&&s.label||"").trim(),h=String(s&&s.href||"").trim();
    if(!label)return"needs a label";
    if(label.length>60)return"label is longer than 60 characters";
    if(!h||h.length>300)return"needs a link";
    if(/^https:\/\/[^\s"'<>]+$/i.test(h))return"";
    return/^(?![a-z][a-z0-9+.-]*:)(?!\/\/)[a-z0-9_./?#=&%-]+$/i.test(h)?"":"link must be a page on this site (like hire.html) or an https:// address";
  }
  function badSpots(d){return d?d.vr.spots.map(spotProblem).map(function(p,i){return p?{i:i,problem:p}:null;}).filter(Boolean):[];}
  /* what the preview is sent: the draft without the tags the page would refuse */
  function sendable(d){var c=clone(d);c.vr.spots=c.vr.spots.filter(function(s){return!spotProblem(s);});return c;}
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function sb(){return window.MCC_SUPA||{};}
  function token(){return sb().token?sb().token():Promise.resolve(null);}
  // Used only to discard local state on account changes, never to authorize.
  // A refresh for the same subject must not erase the current editing session.
  function sessionKey(t){
    if(!t)return null;
    try{var part=t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");while(part.length%4)part+="=";
      var sub=JSON.parse(atob(part)).sub;if(typeof sub==="string"&&sub)return sub;}catch(_){}
    return t;
  }
  function when(iso){if(!iso)return"";var d=new Date(iso);return isNaN(d)?"":d.toLocaleString();}
  function rpc(fn,body){
    var epoch=S.epoch,used;
    return token().then(function(t){
      if(!t)throw new Error("Sign in to change the front page.");
      used=sessionKey(t);if(S.sessionIdentity===undefined)S.sessionIdentity=used;
      return fetch(sb().url+"/rest/v1/rpc/"+fn,{method:"POST",headers:{apikey:sb().key,authorization:"Bearer "+t,"content-type":"application/json"},body:JSON.stringify(body)});
    }).then(function(r){return r.text().then(function(t){
      if(!r.ok){var m="",code="";try{var b=JSON.parse(t)||{};m=b.message||"";code=b.code||"";}catch(_){}
        var err=new Error(m||("HTTP "+r.status));err.code=code;throw err;}
      return token().then(function(now){if(epoch!==S.epoch||sessionKey(now)!==used)throw new Error("Account changed. Reload this editor.");return t?JSON.parse(t):null;});
    });});
  }
  function snapshot(data){
    if(!data||data.schema!=="owner-front-publication/v1"||!/^\d+$/.test(data.revision)||!Array.isArray(data.history))throw new Error("Publication service returned an unsupported response.");
    var value=data.value===null?null:JSON.parse(data.value);
    if(value!==null&&(typeof value!=="object"||Array.isArray(value)))throw new Error("The live settings need repair before publication.");
    S.saved=value;S.savedAt=data.updated_at;S.revision=data.revision;S.history=data.history;
    S.storedDraft=data.draft||null;S.publicationReady=true;S.publicationError="";
  }
  function load(){
    if(S.loading||!sb().url)return;
    var epoch=S.epoch;
    S.loading=true;S.loadError=null;S.publicationReady=false;
    rpc("owner_front_snapshot_v1",{}).then(function(data){if(epoch===S.epoch)snapshot(data);})
      .catch(function(err){
        if(epoch!==S.epoch)return;
        S.publicationError=err.code==="PGRST202"||err.code==="42883"?
          "Versioned publishing is not installed. Preview is available; publishing and history are unavailable.":
          "Publishing and history could not be verified: "+err.message;
        // Public read can seed a preview, but never authorizes a fallback write.
        return fetch(sb().url+"/rest/v1/site_content?select=value,updated_at&page=eq."+encodeURIComponent(PAGE)+"&slot=eq."+encodeURIComponent(SLOT)+"&limit=1",{headers:{apikey:sb().key},cache:"no-store"})
          .then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();})
          .then(function(rows){if(epoch!==S.epoch)return;var row=Array.isArray(rows)&&rows[0];S.saved=row?JSON.parse(row.value):null;S.savedAt=row?row.updated_at:null;});
      }).catch(function(err){if(epoch===S.epoch)S.loadError=err;})
      .then(function(){if(epoch!==S.epoch)return;S.loaded=true;S.loading=false;seed();paintForm();});
  }

  /* ---------- the frame ---------- */
  function frameWin(){try{return S.frame&&S.frame.contentWindow;}catch(_){return null;}}
  function post(msg){var w=frameWin();if(w)try{w.postMessage(msg,location.origin);}catch(_){}}
  /* a draft goes to the frame; the page answers with what it applied (mcc:front-applied, same seq). A committed change
     (a field left, a box ticked) comes back into the form as the page bounded it. Returns a promise of that answer. */
  function preview(config,commit){
    var seq=++S.seq;
    post({type:"mcc:front-preview",seq:seq,commit:!!commit,config:config});
    return new Promise(function(resolve){var t=setTimeout(function(){S.waiters=S.waiters.filter(function(w){return w.seq!==seq;});resolve(null);},4000);S.waiters.push({seq:seq,done:function(c){clearTimeout(t);resolve(c);}});});
  }
  /* the draft starts as what visitors get now: the saved row (or none) as the page applies it */
  function seed(){
    if(!S.ready||!S.loaded||S.loadError||S.draft)return;
    preview(S.saved,true);
  }
  /* the frame keeps the device's real width (so the page lays out as it does there) and is scaled to the room it has.
     Beside the settings (from 1100px) the whole stage also fits the window above the house's bar, and the settings
     scroll inside a column of the same height, so the preview stays in view whatever is being changed. */
  function fit(){
    var box=S.frame&&S.frame.parentNode;if(!box||!box.parentNode)return;
    var d=DEVICES[S.device],k=Math.min(1,box.parentNode.clientWidth/d.w),root=box.closest("[data-cfp-root]"),stage=box.closest(".cfp-stage");
    var wide=window.matchMedia&&window.matchMedia("(min-width:1100px)").matches;
    if(wide&&stage){
      var bar=document.querySelector(".appbar"),barH=bar&&bar.getBoundingClientRect().height?window.innerHeight-bar.getBoundingClientRect().top+12:24;
      var chrome=stage.offsetHeight-box.offsetHeight;   // the stage's own controls and note
      k=Math.min(k,Math.max(0.3,(window.innerHeight-barH-chrome-24)/d.h));
    }
    if(k>0)box.style.setProperty("--cfp-k",k.toFixed(4));
    if(root){if(wide&&stage)root.style.setProperty("--cfp-room",stage.offsetHeight+"px");else root.style.removeProperty("--cfp-room");}
  }

  /* ---------- the form ---------- */
  /* the page opens on the plane when the owner chose it, or when an older saved row turned the cabin off */
  function startOf(f){return f.start==="plane"||!f.vr.enabled?"plane":"cabin";}
  function pick(name,label,opts,on){return'<label>'+e(label)+'<select name="'+name+'">'+Object.keys(opts).map(function(k){return'<option value="'+e(k)+'"'+(on===k?" selected":"")+'>'+e(opts[k])+'</option>';}).join("")+'</select></label>';}
  function feelOf(sc){var best="custom";Object.keys(FEEL).forEach(function(k){if(Math.abs(FEEL[k].duration-sc.duration)<0.001&&Math.abs(FEEL[k].touchLerp-sc.touchLerp)<0.001)best=k;});return best;}
  function check(name,label,on,hint){return'<label class="cfp-check"><input type="checkbox" name="'+name+'"'+(on?" checked":"")+'><span><b>'+e(label)+'</b>'+(hint?'<small>'+e(hint)+'</small>':"")+'</span></label>';}
  function num(name,label,v,lo,hi,step){return'<label>'+e(label)+'<input type="number" inputmode="decimal" name="'+name+'" value="'+e(v)+'" min="'+lo+'" max="'+hi+'" step="'+step+'"></label>';}
  function formHtml(){
    var f=S.draft;
    if(!f)return'<div class="cro-note">'+(S.loadError?"The saved settings could not be read: "+e(S.loadError.message||S.loadError):"Opening your front page…")+'</div>';
    var feel=feelOf(f.scroll),pct=function(x){return Math.round(x*100);},start=startOf(f),shown=f.visible!==false;
    return''+
      /* TUCK AWAY. Honest about what a static site can do: the page is hidden from visitors and from search, not secret. */
      '<fieldset class="cfp-group cfp-visibility"><legend>Who sees it</legend>'+
        check("visible","Show my front page to the public",shown,shown?"On: everyone gets the page.":"Off: tucked away. Visitors get a holding screen; you still see the page when you are signed in.")+
        '<p class="cro-meta" data-cfp-honest>Tucking the page away hides it: visitors get a short holding screen with the bar, the World and the footer, and search engines are asked not to index it (noindex). It does not make it secret. This is a static site on GitHub Pages, so index.html, its films and its files can still be fetched by anyone who asks for them directly.</p>'+
        (shown?"":'<div class="cro-actions"><button type="button" class="cr-btn cr-btn--ghost" data-cfp="viewas" aria-pressed="'+(S.viewAs==="visitor")+'">'+(S.viewAs==="visitor"?"Show me my page again":"See it as a visitor")+'</button></div>')+
      '</fieldset>'+
      '<fieldset class="cfp-group"><legend>Opening and song</legend>'+
        pick("start","The page opens",STARTS,start)+
        pick("song","The page’s one song",SONGS,SONGS[f.song]?f.song:"antisocial")+
        '<p class="cro-meta">One song plays for the whole page. Browsers keep it silent until the visitor’s first tap, click or key; the Sound button always decides.</p>'+
      '</fieldset>'+
      '<fieldset class="cfp-group"><legend>Scenes</legend>'+
        check("scenes.doors","The two doors",f.scenes.doors,"“Want a website like this?” and “Resume/CV”, at the foot of the cabin")+
        check("scenes.vaunt","The plane",f.scenes.vaunt,"The Vaunt fly-through after the cabin")+
        check("scenes.night","The night descent",f.scenes.night,"The night film and the LOCK IN room")+
        '<p>The World entry is shared by every public front page.</p>'+
      '</fieldset>'+
      '<fieldset class="cfp-group"><legend>Scroll feel</legend>'+
        '<label>How the page scrolls<select name="feel">'+Object.keys(FEEL).map(function(k){return'<option value="'+k+'"'+(feel===k?" selected":"")+'>'+e(FEEL[k].label)+'</option>';}).join("")+(feel==="custom"?'<option value="custom" selected>Custom</option>':"")+'</select></label>'+
        '<div class="cfp-pair">'+num("scroll.duration","Glide (seconds)",f.scroll.duration,0.3,1.8,0.05)+num("scroll.touchLerp","Finger follow (0.05–0.4)",f.scroll.touchLerp,0.05,0.4,0.01)+'</div>'+
      '</fieldset>'+
      /* the cabin's settings, back now that the cabin is this page's opening scene (they were dropped in #621 when it left) */
      '<fieldset class="cfp-group"'+(start==="cabin"?"":" disabled")+'><legend>The 360 cabin</legend>'+
        '<div class="cfp-pair">'+num("vr.yaw","Opening view: turn (°)",f.vr.yaw,-180,180,1)+num("vr.pitch","Opening view: tilt (°)",f.vr.pitch,-85,85,1)+'</div>'+
        '<div class="cro-actions"><button type="button" class="cr-btn cr-btn--ghost" data-cfp="view">Use the preview’s view</button></div>'+
        '<div class="cfp-spots">'+f.vr.spots.map(function(s,i){var bad=spotProblem(s);return'<div class="cfp-spot'+(bad?" is-bad":"")+'"><b>Tag '+(i+1)+(s.urgent?' · flashing':'')+'</b>'+(bad?'<p class="cfp-spot__bad" role="alert">This tag '+e(bad)+'. It is left out of the preview until it is fixed.</p>':"")+
          '<label>Label<input name="spot.'+i+'.label" value="'+e(s.label)+'" maxlength="60"></label>'+
          '<label>Link (a page here, or https://…)<input name="spot.'+i+'.href" value="'+e(s.href)+'" maxlength="300" inputmode="url"></label>'+
          '<div class="cro-actions"><button type="button" class="cr-btn cr-btn--ghost" data-cfp="spot" data-i="'+i+'">Pin where the preview looks</button></div></div>';}).join("")+'</div>'+
      '</fieldset>'+
      '<p class="cro-note">The whole Vaunt project, the runway performance included, keeps its own <a href="front.html?project=vaunt" target="_blank" rel="noopener">project page</a>, managed by Matthew through the repository. This editor changes Matthew’s front page.</p>'+
      '<fieldset class="cfp-group"'+(f.scenes.night?"":" disabled")+'><legend>Night room</legend>'+
        num("night.arrive","LOCK IN arrives at (% of the descent)",pct(f.night.arrive),50,86,1)+
      '</fieldset>';
  }
  function historyHtml(){
    if(!S.publicationReady)return "";
    return '<details><summary>Published settings history (latest 25)</summary><p class="cro-meta">Choose a version to preview. It reaches visitors only after Publish. Use Save private draft to keep edits across reloads. Published history is unchanged until Publish.</p>'+
      (S.history.length?S.history.map(function(h){return '<p><button type="button" class="cr-btn" data-cfp="history" data-revision="'+e(h.id)+'"'+(S.saving?' disabled':'')+'>Preview '+e(h.value===null?'shipped settings':'version '+h.id)+' · '+e(when(h.at))+'</button></p>';}).join(""):'<p>No published settings history yet.</p>')+'</details>';
  }
  function statusHtml(){
    var live=!S.loaded?"Reading live settings…":S.loadError?"Live settings could not be read":S.saved?"Live: your settings, saved "+when(S.savedAt):"Live: the page as shipped";
    return'<p class="cro-meta" data-cfp-live>'+e(live)+(S.dirty?' · <b>unsaved changes, shown only in the preview</b>':"")+'</p>'+
      (!S.publicationReady?'<p class="cro-note cro-note--bad" role="status">'+e(S.publicationError||'Checking publishing and history…')+'</p>':'<p class="cro-meta">Publishing ready · version '+e(S.revision)+'</p>')+
      (S.storedDraft?'<p class="cro-meta">Private draft saved '+e(when(S.storedDraft.updated_at))+' · based on live version '+e(S.storedDraft.base_revision)+'. Resume it below.</p>':'')+
      (S.message?'<div class="cro-note'+(S.bad?" cro-note--bad":"")+'" role="status">'+e(S.message)+'</div>':"");
  }
  function paintForm(){
    var root=document.querySelector("[data-cfp-root]");if(!root)return;
    var form=root.querySelector("[data-cfp-form]");if(form){form.innerHTML=formHtml();if(S.saving)form.querySelectorAll("input,select,button").forEach(function(x){x.disabled=true;});}
    var st=root.querySelector("[data-cfp-status]");if(st)st.innerHTML=statusHtml();
    var hist=root.querySelector("[data-cfp-history]");if(hist)hist.innerHTML=historyHtml();
    var actions=root.querySelector("[data-cfp-actions]");
    if(actions)actions.querySelectorAll("button").forEach(function(b){var a=b.getAttribute("data-cfp");b.disabled=S.saving||(a!=="reload"&&!S.draft)||(a==="discard"&&!S.dirty)||((a==="save"||a==="save-draft")&&(!S.publicationReady||!S.dirty||badSpots(S.draft).length>0))||((a==="resume"||a==="clear-draft")&&(!S.publicationReady||!S.storedDraft))||(a==="rebase"&&(!S.publicationReady||!S.dirty||!S.draftBase||S.draftBase===S.revision))||(a==="reset"&&!S.saved);});
  }
  function render(){
    if(!S.loaded&&!S.loading)load();
    var d=DEVICES[S.device];
    return'<div class="cro cfp" data-cfp-root>'+
      '<section class="cro-card cfp-stage" aria-label="Your front page, live">'+
        '<div class="cfp-bar">'+
          '<div class="cro-tabs" role="group" aria-label="Preview size">'+Object.keys(DEVICES).map(function(k){return'<button type="button" class="cro-tab'+(S.device===k?" is-on":"")+'" data-cfp-device="'+k+'" aria-pressed="'+(S.device===k)+'">'+e(DEVICES[k].label)+'</button>';}).join("")+'</div>'+
          '<div class="cro-chips" role="group" aria-label="Go to a scene">'+JUMPS.map(function(j){return'<button type="button" class="cro-chip" data-cfp-go="'+j[0]+'">'+e(j[1])+'</button>';}).join("")+'</div>'+
          '<a class="cr-btn cr-btn--ghost" href="index.html" target="_blank" rel="noopener">Open the site ↗</a>'+
        '</div>'+
        '<div class="cfp-viewport"><div class="cfp-device" style="--cfp-w:'+d.w+'px;--cfp-h:'+d.h+'px"><iframe title="Your front page, as visitors get it" src="index.html" data-cfp-frame></iframe></div></div>'+
        '<p class="cro-meta">This is index.html itself, the page every visitor gets. It opens in the cabin: look around, then scroll on. To edit page copy, open the site above. Its pencil publishes immediately and is disabled in this private settings preview.</p>'+
      '</section>'+
      '<section class="cro-card cfp-panel" aria-label="Front page settings">'+
        '<div data-cfp-status>'+statusHtml()+'</div>'+
        '<form class="cro-form cfp-form" data-cfp-form>'+formHtml()+'</form>'+
        '<div class="cro-actions cfp-actions" data-cfp-actions>'+
          '<button type="button" class="cr-btn" data-cfp="save-draft">Save private draft</button>'+
          '<button type="button" class="cr-btn" data-cfp="resume">Resume saved draft</button>'+
          '<button type="button" class="cr-btn" data-cfp="rebase">Use reviewed preview over loaded live version</button>'+
          '<button type="button" class="cr-btn cr-btn--ghost" data-cfp="clear-draft">Delete saved draft</button>'+
          '<button type="button" class="cr-btn cr-btn--primary" data-cfp="save">Publish preview to the live site</button>'+
          '<button type="button" class="cr-btn" data-cfp="discard">Discard changes</button>'+
          '<button type="button" class="cr-btn cr-btn--ghost" data-cfp="reset">Preview the page as shipped</button>'+
          '<button type="button" class="cr-btn cr-btn--ghost" data-cfp="reload">Reload live settings (keep saved draft)</button>'+
        '</div>'+
        '<div data-cfp-history>'+historyHtml()+'</div>'+
      '</section>'+
    '</div>';
  }

  /* one field changed: the draft takes it, the frame shows it */
  function setField(name,value,checked,commit){
    var f=S.draft;if(!f||S.saving)return;S.resetDraft=false;
    var n=Number(value),parts=name.split(".");
    if(name==="feel"){if(FEEL[value]){f.scroll.duration=FEEL[value].duration;f.scroll.touchLerp=FEEL[value].touchLerp;}}
    else if(name==="visible"){f.visible=!!checked;if(f.visible&&S.viewAs!=="owner"){S.viewAs="owner";post({type:"mcc:front-view-as",as:"owner"});}}
    else if(name==="start"){if(STARTS[value]){f.start=value;if(value==="cabin")f.vr.enabled=true;}}
    else if(name==="song"){if(SONGS[value])f.song=value;}
    else if(parts[0]==="scenes"||name==="vr.enabled"||name==="vr.hold")f[parts[0]][parts[1]]=!!checked;
    else if(name==="vr.band0"||name==="vr.band1"){if(isFinite(n))f.vr.band[name==="vr.band0"?0:1]=n/100;}
    else if(name==="night.arrive"){if(isFinite(n))f.night.arrive=n/100;}
    else if(parts[0]==="spot"){var s=f.vr.spots[Number(parts[1])];if(s)s[parts[2]]=String(value);}
    else if(parts.length===2&&isFinite(n))f[parts[0]][parts[1]]=n;
    S.dirty=true;S.message="";
    preview(sendable(f),commit);
  }
  function lookingAt(){
    var w=frameWin(),v=null;
    try{v=w&&w.__MCC_VR&&w.__MCC_VR.viewer;}catch(_){}
    return v||null;
  }
  function act(a,btn){
    if(S.saving)return;
    if(a==="reload"){S.draftBase=null;S.draft=null;S.dirty=false;S.resetDraft=false;S.history=[];S.message="";S.loaded=false;load();paintForm();return;}
    if(a==="rebase"){
      if(!S.publicationReady||!S.draft||!S.dirty)return;
      S.draftBase=S.revision;S.message="Preview will replace the loaded live settings only after Publish. Newer changes will still block publication.";S.bad=false;paintForm();return;
    }
    if(a==="clear-draft"){
      if(!S.storedDraft||!S.publicationReady)return;
      var clearEpoch=S.epoch;S.saving=true;paintForm();
      rpc("owner_front_draft_discard_v1",{p_expected_revision:S.storedDraft.revision}).then(function(){
        if(clearEpoch!==S.epoch)return;S.storedDraft=null;S.message="Saved draft deleted. The live page is unchanged.";
      }).catch(function(err){if(clearEpoch===S.epoch){S.publicationReady=false;S.publicationError="Draft deletion was not confirmed. Reload to check its state.";S.message=err.message;}})
        .then(function(){if(clearEpoch===S.epoch){S.saving=false;paintForm();}});return;
    }
    if(a==="history"||a==="reset"||a==="resume"){
      if(!S.ready)return;
      var old=null;S.draftBase=S.revision;
      if(a==="resume"){if(!S.storedDraft)return;old=clone(S.storedDraft.config);S.draftBase=S.storedDraft.base_revision;}
      if(a==="history"){
        var h=S.history.find(function(x){return x.id===btn.getAttribute("data-revision");});if(!h)return;
        try{old=h.value===null?null:JSON.parse(h.value);if(old!==null&&(typeof old!=="object"||Array.isArray(old)))throw new Error();}
        catch(_){S.message="This historical value is not a settings document. Nothing was changed.";S.bad=true;paintForm();return;}
      }
      S.draft=null;S.resetDraft=old===null;S.dirty=true;
      S.message=a==="resume"?"Saved draft resumed privately. Review it before publishing.":"Historical settings are only in the preview. Review them, then Publish to restore.";S.bad=false;
      preview(old,true);paintForm();return;
    }
    if(a==="viewas"){S.viewAs=S.viewAs==="visitor"?"owner":"visitor";post({type:"mcc:front-view-as",as:S.viewAs});paintForm();return;}
    if(a==="view"||a==="spot"){
      var v=lookingAt();
      if(!v){S.message="Open the 360 cabin in the preview first (the “Cabin” button), look where you want, then press this again.";S.bad=true;paintForm();return;}
      var deg=function(r){var d=Math.round(r*180/Math.PI)%360;return d>180?d-360:d<-180?d+360:d;};
      if(a==="view"){S.draft.vr.yaw=deg(v.state.yaw);S.draft.vr.pitch=Math.max(-85,Math.min(85,deg(v.state.pitch)));}
      else{
        /* the point at the middle of the cabin's picture, in the tags' own measure (js/vr360.js pick) */
        var c=null;try{c=frameWin().document.getElementById("workVRCanvas");}catch(_){}
        var box=c?c.getBoundingClientRect():null,p=box&&v.pick?v.pick(box.left+box.width/2,box.top+box.height/2):null,s=S.draft.vr.spots[Number(btn.getAttribute("data-i"))];
        if(p&&s){s.yaw=p.yaw;s.pitch=p.pitch;}
      }
      S.resetDraft=false;S.dirty=true;S.message="";preview(sendable(S.draft),true);return;
    }
    if(a==="discard"){S.draftBase=null;S.resetDraft=false;S.draft=null;S.dirty=false;S.message="";seed();paintForm();return;}
    if((a==="save"||a==="save-draft")&&badSpots(S.draft).length){S.message="Fix the tag marked below before saving: it would not reach the page.";S.bad=true;paintForm();return;}
    if(a==="save"||a==="save-draft"){
      if(!S.publicationReady||!S.dirty||!S.draft)return;
      var epoch=S.epoch,expected=S.draftBase||S.revision,reset=S.resetDraft;
      S.saving=true;S.message=a==="save-draft"?"Saving private draft…":"Publishing…";S.bad=false;paintForm();
      preview(sendable(S.draft),true).then(function(c){
        if(epoch!==S.epoch)throw new Error("Account changed. Reload this editor.");
        if(!c)throw new Error("The preview did not answer; nothing was sent.");
        if(a==="save-draft")return rpc("owner_front_draft_save_v1",{p_expected_revision:S.storedDraft?S.storedDraft.revision:null,p_base_revision:expected,p_value:reset?null:c});
        return rpc("owner_front_publish_v1",{p_expected_revision:expected,p_value:reset?null:c});
      }).then(function(data){
        if(epoch!==S.epoch)return;
        if(a==="save-draft"){S.storedDraft=data;S.message="Private draft saved. Visitors still see the published page.";S.bad=false;return;}
        snapshot(data);S.draftBase=null;S.dirty=false;S.resetDraft=false;S.draft=null;seed();
        S.message="Published. Visitors now receive these settings.";S.bad=false;
      }).catch(function(err){
        if(epoch!==S.epoch)return;
        // Never blindly retry an uncertain response, or silently replace a newer
        // live version. Preserve this tab's draft until the owner reloads.
        S.publicationReady=false;
        S.publicationError=err.code==="40001"?(a==="save-draft"?"The saved draft changed. Reload it before saving again.":"The live page changed. Reload it and review your changes again."):
          (a==="save-draft"?"Draft saving was not confirmed. Reload to check the outcome before trying again.":"Publication was not confirmed. Reload live settings to check the outcome before trying again.");
        S.message=err.message;S.bad=true;
      }).then(function(){if(epoch===S.epoch){S.saving=false;paintForm();}});
    }
  }

  function onMessage(ev){
    if(ev.origin!==location.origin||!S.frame||ev.source!==frameWin()||!ev.data)return;
    if(ev.data.type==="mcc:front-ready"){
      S.ready=true;
      /* a draft in hand (a reload, a size change) goes back into the fresh frame; otherwise start from what is saved */
      if(S.draft&&S.dirty)preview(sendable(S.draft),true);else{S.draft=null;seed();}
      if(S.viewAs==="visitor")post({type:"mcc:front-view-as",as:"visitor"});
      paintForm();
    }else if(ev.data.type==="mcc:front-applied"){
      var c=ev.data.config&&typeof ev.data.config==="object"?ev.data.config:null;
      if(!c||S.loadError)return;
      if(ev.data.seq===S.seq)S.applied=c;
      S.acked=Math.max(S.acked,Number(ev.data.seq)||0);
      S.waiters=S.waiters.filter(function(w){if(w.seq===ev.data.seq){w.done(clone(c));return false;}return true;});
      if(ev.data.commit&&ev.data.seq===S.seq&&!S.loadError){
        var typed=S.draft?S.draft.vr.spots:null,next=clone(c);
        if(typed){var k=0;next.vr.spots=typed.map(function(s){if(spotProblem(s))return s;var p=c.vr.spots[k++]||s;return{yaw:p.yaw,pitch:p.pitch,label:s.label,href:s.href,blank:p.blank,urgent:!!s.urgent};});}
        S.draft=next;paintForm();
      }
    }
  }
  function bind(root){
    var host=root&&root.querySelector("[data-cfp-root]");if(!host)return;
    S.frame=host.querySelector("[data-cfp-frame]");S.ready=false;
    fit();
    if(S.observer)S.observer.disconnect();
    if(window.ResizeObserver){S.observer=new ResizeObserver(fit);S.observer.observe(host.querySelector(".cfp-viewport"));}
    if(!S.onResize){S.onResize=function(){fit();};window.addEventListener("resize",S.onResize);}
    host.querySelectorAll("[data-cfp-device]").forEach(function(b){b.onclick=function(){S.device=b.getAttribute("data-cfp-device");if(S.rerender)S.rerender();};});
    host.querySelectorAll("[data-cfp-go]").forEach(function(b){b.onclick=function(){post({type:"mcc:front-goto",to:b.getAttribute("data-cfp-go")});};});
    var form=host.querySelector("[data-cfp-form]");
    /* a field the form has already redrawn (its value came back from the page) no longer speaks for the draft */
    form.addEventListener("change",function(ev){var t=ev.target;if(t&&t.name&&t.isConnected)setField(t.name,t.value,t.checked,true);});
    form.addEventListener("input",function(ev){var t=ev.target;if(t&&t.name&&t.isConnected&&t.type!=="checkbox"&&t.tagName!=="SELECT"){setField(t.name,t.value,t.checked,false);var st=host.querySelector("[data-cfp-status]");if(st)st.innerHTML=statusHtml();}});
    form.addEventListener("submit",function(ev){ev.preventDefault();});
    form.addEventListener("click",function(ev){var b=ev.target.closest&&ev.target.closest("button[data-cfp]");if(b)act(b.getAttribute("data-cfp"),b);});
    host.querySelector("[data-cfp-actions]").addEventListener("click",function(ev){var b=ev.target.closest&&ev.target.closest("button[data-cfp]");if(b&&!b.disabled)act(b.getAttribute("data-cfp"),b);});
    host.querySelector("[data-cfp-history]").addEventListener("click",function(ev){var b=ev.target.closest&&ev.target.closest("button[data-cfp]");if(b&&!b.disabled)act(b.getAttribute("data-cfp"),b);});
    paintForm();
  }
  function forget(){
    S.epoch++;S.storedDraft=null;S.draftBase=null;S.saved=null;S.savedAt=null;S.draft=null;S.applied=null;S.history=[];S.revision=null;S.dirty=false;S.resetDraft=false;
    S.publicationReady=false;S.publicationError="Account changed. Reload the editor to verify access.";
    S.loaded=true;S.loading=false;S.saving=false;S.message="";S.loadError=new Error("Reload the editor after signing in.");
    S.waiters.forEach(function(w){w.done(null);});S.waiters=[];post({type:"mcc:front-preview",seq:++S.seq,commit:false,config:null});paintForm();
  }
  function authChanged(){
    token().then(function(t){var key=sessionKey(t);if(S.sessionIdentity!==undefined&&key!==S.sessionIdentity)forget();S.sessionIdentity=key;})
      .catch(function(){forget();S.sessionIdentity=null;});
  }
  function init(opts){
    S.request=opts.request;S.rerender=opts.render;
    window.addEventListener("message",onMessage);
    window.addEventListener("mcc:auth-changed",authChanged);
    window.addEventListener("storage",function(ev){if(ev.key==="mccdb_session"||ev.key===null)authChanged();});
  }
  window.CR.frontPage={init:init,render:render,bind:bind,state:S,PAGE:PAGE,SLOT:SLOT};
})();
