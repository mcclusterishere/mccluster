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
   - where the night room arrives in the descent.
   A change shows in the preview at once (a draft posted to the frame, which only a Control Room parent on this origin
   can send) and reaches visitors only on Save. The page checks and bounds every value itself (frontConfig in
   js/main.js), and what is saved is what the page applied, read back from the frame. Reset deletes the row: the page is
   exactly as shipped again. Every save and reset is kept in site_content_history by the table's own trigger.
   Words on the page keep their own editor: the pencil on the page (js/site-editor.js), in the preview or on the site. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var PAGE="index.html",SLOT="@front";
  var DEVICES={phone:{w:390,h:844,label:"Phone"},desktop:{w:1280,h:800,label:"Desktop"}};
  var JUMPS=[["top","Top"],["vaunt","Project tile"],["night","Night"],["world","World"]];
  var FEEL={smooth:{duration:1.2,touchLerp:0.1,label:"Smooth"},standard:{duration:0.85,touchLerp:0.14,label:"Standard (as shipped)"},quick:{duration:0.55,touchLerp:0.22,label:"Quick"}};
  var S={request:null,rerender:null,device:"phone",saved:null,savedAt:null,loaded:false,loading:false,loadError:null,
    draft:null,applied:null,seq:0,acked:0,waiters:[],ready:false,dirty:false,saving:false,message:"",bad:false,frame:null,observer:null};

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
  function when(iso){if(!iso)return"";var d=new Date(iso);return isNaN(d)?"":d.toLocaleString();}
  function rpc(fn,body){
    return token().then(function(t){
      if(!t)throw new Error("Sign in to change the front page.");
      return fetch(sb().url+"/rest/v1/rpc/"+fn,{method:"POST",headers:{apikey:sb().key,authorization:"Bearer "+t,"content-type":"application/json"},body:JSON.stringify(body)});
    }).then(function(r){return r.text().then(function(t){if(!r.ok){var m="";try{m=(JSON.parse(t)||{}).message||"";}catch(_){}throw new Error(m||("HTTP "+r.status));}return t?JSON.parse(t):null;});});
  }
  /* the saved row, read the way every visitor's page reads it (public read) */
  function load(){
    if(S.loading||!sb().url)return;
    S.loading=true;S.loadError=null;
    fetch(sb().url+"/rest/v1/site_content?select=value,updated_at&page=eq."+encodeURIComponent(PAGE)+"&slot=eq."+encodeURIComponent(SLOT)+"&limit=1",{headers:{apikey:sb().key},cache:"no-store"})
      .then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();})
      .then(function(rows){var row=Array.isArray(rows)&&rows[0];S.saved=null;S.savedAt=null;if(row){try{S.saved=JSON.parse(row.value);}catch(_){S.saved=null;}S.savedAt=row.updated_at;}S.loaded=true;})
      .catch(function(err){S.loadError=err;S.loaded=true;})
      .then(function(){S.loading=false;seed();paintForm();});
  }

  /* ---------- the frame ---------- */
  function frameWin(){try{return S.frame&&S.frame.contentWindow;}catch(_){return null;}}
  function post(msg){var w=frameWin();if(w)try{w.postMessage(msg,location.origin);}catch(_){}}
  /* a draft goes to the frame; the page answers with what it applied (mcc:front-applied, same seq). A committed change
     (a field left, a box ticked) comes back into the form as the page bounded it. Returns a promise of that answer. */
  function preview(config,commit){
    var seq=++S.seq;
    post({type:"mcc:front-preview",seq:seq,commit:!!commit,config:config});
    return new Promise(function(resolve){var t=setTimeout(function(){resolve(null);},4000);S.waiters.push({seq:seq,done:function(c){clearTimeout(t);resolve(c);}});});
  }
  /* the draft starts as what visitors get now: the saved row (or none) as the page applies it */
  function seed(){
    if(!S.ready||!S.loaded||S.draft)return;
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
  function feelOf(sc){var best="custom";Object.keys(FEEL).forEach(function(k){if(Math.abs(FEEL[k].duration-sc.duration)<0.001&&Math.abs(FEEL[k].touchLerp-sc.touchLerp)<0.001)best=k;});return best;}
  function check(name,label,on,hint){return'<label class="cfp-check"><input type="checkbox" name="'+name+'"'+(on?" checked":"")+'><span><b>'+e(label)+'</b>'+(hint?'<small>'+e(hint)+'</small>':"")+'</span></label>';}
  function num(name,label,v,lo,hi,step){return'<label>'+e(label)+'<input type="number" inputmode="decimal" name="'+name+'" value="'+e(v)+'" min="'+lo+'" max="'+hi+'" step="'+step+'"></label>';}
  function formHtml(){
    var f=S.draft;
    if(!f)return'<div class="cro-note">'+(S.loadError?"The saved settings could not be read: "+e(S.loadError.message||S.loadError):"Opening your front page…")+'</div>';
    var feel=feelOf(f.scroll),pct=function(x){return Math.round(x*100);};
    return''+
      '<fieldset class="cfp-group"><legend>Scenes</legend>'+
        check("scenes.doors","The hero's two doors",f.scenes.doors,"“Want a website like this?” and “Resume/CV”")+

        check("scenes.night","The night descent",f.scenes.night,"The night film and the LOCK IN room")+
        '<p>The World entry is shared by every public front page.</p>'+
      '</fieldset>'+
      '<fieldset class="cfp-group"><legend>Scroll feel</legend>'+
        '<label>How the page scrolls<select name="feel">'+Object.keys(FEEL).map(function(k){return'<option value="'+k+'"'+(feel===k?" selected":"")+'>'+e(FEEL[k].label)+'</option>';}).join("")+(feel==="custom"?'<option value="custom" selected>Custom</option>':"")+'</select></label>'+
        '<div class="cfp-pair">'+num("scroll.duration","Glide (seconds)",f.scroll.duration,0.3,1.8,0.05)+num("scroll.touchLerp","Finger follow (0.05–0.4)",f.scroll.touchLerp,0.05,0.4,0.01)+'</div>'+
      '</fieldset>'+
      '<p class="cro-note">Vaunt now has its own <a href="front.html?project=vaunt" target="_blank" rel="noopener">project page</a>, managed by Matthew through the repository. Its original cabin settings remain stored for recovery; this editor changes Matthew’s front page.</p>'+
      '<fieldset class="cfp-group"'+(f.scenes.night?"":" disabled")+'><legend>Night room</legend>'+
        num("night.arrive","LOCK IN arrives at (% of the descent)",pct(f.night.arrive),50,86,1)+
      '</fieldset>';
  }
  function statusHtml(){
    var live=S.saved?"Live: your settings, saved "+when(S.savedAt):"Live: the page as shipped";
    return'<p class="cro-meta" data-cfp-live>'+e(live)+(S.dirty?' · <b>unsaved changes, shown only in the preview</b>':"")+'</p>'+
      (S.message?'<div class="cro-note'+(S.bad?" cro-note--bad":"")+'" role="status">'+e(S.message)+'</div>':"");
  }
  function paintForm(){
    var root=document.querySelector("[data-cfp-root]");if(!root)return;
    var form=root.querySelector("[data-cfp-form]");if(form)form.innerHTML=formHtml();
    var st=root.querySelector("[data-cfp-status]");if(st)st.innerHTML=statusHtml();
    var actions=root.querySelector("[data-cfp-actions]");
    if(actions)actions.querySelectorAll("button").forEach(function(b){var a=b.getAttribute("data-cfp");b.disabled=S.saving||!S.draft||(a==="discard"&&!S.dirty)||(a==="save"&&(!S.dirty||badSpots(S.draft).length>0))||(a==="reset"&&!S.saved);});
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
        '<p class="cro-meta">This is index.html itself, the page every visitor gets. Scroll it and open the project tile. To change its words, use the pencil on the page.</p>'+
      '</section>'+
      '<section class="cro-card cfp-panel" aria-label="Front page settings">'+
        '<div data-cfp-status>'+statusHtml()+'</div>'+
        '<form class="cro-form cfp-form" data-cfp-form>'+formHtml()+'</form>'+
        '<div class="cro-actions cfp-actions" data-cfp-actions>'+
          '<button type="button" class="cr-btn cr-btn--primary" data-cfp="save">Save to the live site</button>'+
          '<button type="button" class="cr-btn" data-cfp="discard">Discard changes</button>'+
          '<button type="button" class="cr-btn cr-btn--ghost" data-cfp="reset">Reset to the page as shipped</button>'+
        '</div>'+
      '</section>'+
    '</div>';
  }

  /* one field changed: the draft takes it, the frame shows it */
  function setField(name,value,checked,commit){
    var f=S.draft;if(!f)return;
    var n=Number(value),parts=name.split(".");
    if(name==="feel"){if(FEEL[value]){f.scroll.duration=FEEL[value].duration;f.scroll.touchLerp=FEEL[value].touchLerp;}}
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
    if(a==="view"||a==="spot"){
      var v=lookingAt();
      if(!v){S.message="Open the 360 cabin in the preview first (the “360 cabin” button), look where you want, then press this again.";S.bad=true;paintForm();return;}
      var deg=function(r){var d=Math.round(r*180/Math.PI)%360;return d>180?d-360:d<-180?d+360:d;};
      if(a==="view"){S.draft.vr.yaw=deg(v.state.yaw);S.draft.vr.pitch=Math.max(-85,Math.min(85,deg(v.state.pitch)));}
      else{
        /* the point at the middle of the cabin's picture, in the tags' own measure (js/vr360.js pick) */
        var c=null;try{c=frameWin().document.getElementById("workVRCanvas");}catch(_){}
        var box=c?c.getBoundingClientRect():null,p=box&&v.pick?v.pick(box.left+box.width/2,box.top+box.height/2):null,s=S.draft.vr.spots[Number(btn.getAttribute("data-i"))];
        if(p&&s){s.yaw=p.yaw;s.pitch=p.pitch;}
      }
      S.dirty=true;S.message="";preview(sendable(S.draft),true);return;
    }
    if(a==="discard"){S.draft=null;S.dirty=false;S.message="";seed();paintForm();return;}
    if(a==="save"&&badSpots(S.draft).length){S.message="Fix the tag marked below before saving: it would not reach the page.";S.bad=true;paintForm();return;}
    if(a==="save"||a==="reset"){
      S.saving=true;S.message=a==="save"?"Saving…":"Resetting…";S.bad=false;paintForm();
      var value=null;
      /* what is saved is what the page applied to this exact draft, never the raw form */
      (a==="save"?preview(sendable(S.draft),true).then(function(c){if(!c)throw new Error("the preview did not answer; nothing was saved");value=c;
          return rpc("site_content_set",{p_page:PAGE,p_slot:SLOT,p_value:JSON.stringify(value),p_kind:"text",p_original:"",p_fragile:false,p_via:"control-front-page"});})
        :rpc("site_content_revert",{p_page:PAGE,p_slot:SLOT}))
        .then(function(row){
          S.saved=a==="save"?clone(value):null;S.savedAt=a==="save"?(row&&row.updated_at)||new Date().toISOString():null;S.dirty=false;
          S.message=a==="save"?"Saved. Every visitor's front page now opens with these settings.":"Reset. The front page is exactly as shipped.";S.bad=false;
          if(a==="reset"){S.draft=null;seed();}
        })
        .catch(function(err){S.message=(a==="save"?"Not saved: ":"Not reset: ")+(err.message||err);S.bad=true;})
        .then(function(){S.saving=false;paintForm();});
    }
  }
  function onMessage(ev){
    if(ev.origin!==location.origin||!S.frame||ev.source!==frameWin()||!ev.data)return;
    if(ev.data.type==="mcc:front-ready"){
      S.ready=true;
      /* a draft in hand (a reload, a size change) goes back into the fresh frame; otherwise start from what is saved */
      if(S.draft&&S.dirty)preview(sendable(S.draft),true);else{S.draft=null;seed();}
      paintForm();
    }else if(ev.data.type==="mcc:front-applied"){
      var c=ev.data.config&&typeof ev.data.config==="object"?ev.data.config:null;
      if(!c)return;
      S.applied=c;S.acked=Math.max(S.acked,Number(ev.data.seq)||0);
      S.waiters=S.waiters.filter(function(w){if(w.seq===ev.data.seq){w.done(clone(c));return false;}return true;});
      if(ev.data.commit&&ev.data.seq===S.seq){
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
    paintForm();
  }
  function init(opts){
    S.request=opts.request;S.rerender=opts.render;
    window.addEventListener("message",onMessage);
  }
  window.CR.frontPage={init:init,render:render,bind:bind,state:S,PAGE:PAGE,SLOT:SLOT};
})();
