/* Native Control · Create · Music · Stems — every instrument of a track, for the owner.

   Owner, 2026-10-31: "anything that's uploaded, it should strip it, like every audio
   from each instrument, like be able to track out the whole instrumentation plus the
   vocals." McCluster Core separates each track (Demucs htdemucs_6s: vocals, drums,
   bass, guitar, piano, other, plus an instrumental) into the private bucket; this
   panel plays them together in sync (Web Audio: one clock, one gain per stem),
   solos and mutes any of them, downloads each, and asks Core to separate again.
   URLs come from music-access (operator-stems-list): owner only, 15 minutes.
*/
(function(){
  "use strict";
  window.CR=window.CR||{};
  var S={gen:0,list:null,key:"",track:null,data:null,msg:"",node:null,ctx:null,buffers:{},gains:{},sources:[],mute:{},solo:{},playing:false,offset:0,startedAt:0,duration:0,loaded:0,raf:0};
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function fmt(t){t=Math.max(0,t||0);var m=Math.floor(t/60),s=Math.floor(t-m*60);return m+":"+(s<10?"0":"")+s;}
  function mb(b){return(b/1e6).toFixed(1)+" MB";}
  var LABEL={vocals:"Vocals",drums:"Drums",bass:"Bass",guitar:"Guitar",piano:"Keys",other:"Other",instrumental:"Instrumental (all but vocals)"};
  function musicCall(action,body){
    var tok=window.MCC_SUPA&&MCC_SUPA.token?MCC_SUPA.token():Promise.resolve(null);
    return tok.then(function(t){if(!t)throw new Error("Signed out");return fetch(window.MCC_SUPA.url+"/functions/v1/music-access",{method:"POST",headers:{apikey:window.MCC_SUPA.key,authorization:"Bearer "+t,"content-type":"application/json"},body:JSON.stringify(Object.assign({action:action},body||{}))});})
      .then(function(r){return r.json().catch(function(){return{};}).then(function(j){if(!r.ok)throw new Error(j.error||("Music service "+r.status));return j;});});
  }
  function loadList(){
    fetch("data/albums.json",{cache:"no-cache"}).then(function(r){return r.json();}).then(function(a){
      var shelf=[];(a.albums||[]).forEach(function(al){(al.tracks||[]).forEach(function(t){if(t.src&&!t.gated){var slug=t.src.split("/").pop().replace(/\.[a-z0-9]+$/i,"");shelf.push({key:"shelf:"+slug,title:t.title,album:al.name,body:{track_key:slug,src:t.src}});}});});
      var ups=((window.CR.musicOps&&window.CR.musicOps.state.review.tracks)||[]).map(function(t){return{key:"upload:"+t.id,title:t.title||"Untitled",album:(t.artist||"Upload")+" (upload)",body:{track_id:t.id}};});
      S.list=shelf.concat(ups);paint();
    }).catch(function(err){S.msg=err.message||"Could not read the shelf";paint();});
  }

  /* ---- the mixer: one AudioContext clock drives every stem ---- */
  function gainFor(name){var anySolo=Object.keys(S.solo).some(function(k){return S.solo[k];});if(name==="instrumental")return S.solo.instrumental?1:0;return anySolo?(S.solo[name]?1:0):(S.mute[name]?0:1);}
  function applyGains(){Object.keys(S.gains).forEach(function(n){S.gains[n].gain.value=gainFor(n);});}
  function now(){return S.playing?S.offset+(S.ctx.currentTime-S.startedAt):S.offset;}
  function stopSources(){S.sources.forEach(function(s){try{s.stop();}catch(_){}});S.sources=[];}
  function play(){
    if(!S.ctx||S.playing)return;
    if(S.ctx.state==="suspended")S.ctx.resume();
    var at=S.ctx.currentTime+0.06;
    Object.keys(S.buffers).forEach(function(n){var src=S.ctx.createBufferSource();src.buffer=S.buffers[n];src.connect(S.gains[n]);src.start(at,Math.min(S.offset,S.buffers[n].duration));S.sources.push(src);});
    S.startedAt=at;S.playing=true;tick();paintTransport();
  }
  function pause(){if(!S.playing)return;S.offset=Math.min(S.duration,now());stopSources();S.playing=false;paintTransport();}
  function seek(t){var was=S.playing;if(was){stopSources();S.playing=false;}S.offset=Math.max(0,Math.min(S.duration,t));if(was)play();else paintTransport();}
  function tick(){cancelAnimationFrame(S.raf);if(!S.playing)return;if(now()>=S.duration){pause();S.offset=0;paintTransport();return;}paintTransport();S.raf=requestAnimationFrame(tick);}
  function teardown(){stopSources();S.playing=false;S.offset=0;S.buffers={};S.gains={};S.mute={};S.solo={};S.loaded=0;S.duration=0;}
  function loadStems(gen){
    var AC=window.AudioContext||window.webkitAudioContext;if(!AC){S.msg="This browser cannot mix audio here; download the stems instead.";paint();return;}
    if(!S.ctx)S.ctx=new AC();
    var stems=S.data.stems.filter(function(x){return x.stem!=="instrumental";});
    var inst=S.data.stems.filter(function(x){return x.stem==="instrumental";});
    Promise.all(stems.concat(inst).map(function(x){
      return fetch(x.url).then(function(r){if(!r.ok)throw new Error(x.stem+" "+r.status);return r.arrayBuffer();})
        .then(function(ab){return new Promise(function(res,rej){S.ctx.decodeAudioData(ab,res,rej);});})
        .then(function(buf){if(gen!==S.gen)return;S.buffers[x.stem]=buf;var g=S.ctx.createGain();g.connect(S.ctx.destination);S.gains[x.stem]=g;S.loaded++;S.duration=Math.max(S.duration,buf.duration);var p=S.node.querySelector(".crs-load");if(p)p.textContent="Loading stems… "+S.loaded+"/"+S.data.stems.length;});
    })).then(function(){if(gen!==S.gen)return;applyGains();S.msg="";paint();}).catch(function(err){if(gen!==S.gen)return;S.msg="Could not load the stems: "+(err.message||err);paint();});
  }
  function open(key){
    var t=(S.list||[]).filter(function(x){return x.key===key;})[0];if(!t)return;
    /* one generation per selection: the manifest answer and every decode callback
       of an earlier selection are dropped, so A can never land in B's mixer */
    var gen=S.gen=(S.gen||0)+1;
    teardown();S.key=key;S.track=t;S.data=null;S.msg="Loading…";paint();
    musicCall("operator-stems-list",t.body).then(function(j){if(gen!==S.gen)return;S.data=j;S.msg="";paint();if(j.stems&&j.stems.length)loadStems(gen);})
      .catch(function(err){if(gen!==S.gen)return;S.msg=err.message||"Could not load";paint();});
  }

  /* ---- view ---- */
  function transport(){
    return'<div class="crs-transport"><button class="cr-btn cr-btn--primary crs-play" type="button" data-crs-play aria-label="'+(S.playing?"Pause":"Play")+' all stems">'+(S.playing?"Pause":"Play")+'</button>'
      +'<input class="crs-seek" type="range" min="0" max="'+(S.duration||0).toFixed(2)+'" step="0.1" value="'+now().toFixed(2)+'" data-crs-seek aria-label="Position">'
      +'<span class="crs-time" data-crs-time>'+fmt(now())+" / "+fmt(S.duration)+'</span></div>';
  }
  function paintTransport(){
    var r=S.node;if(!r)return;var b=r.querySelector("[data-crs-play]");if(b){b.textContent=S.playing?"Pause":"Play";b.setAttribute("aria-label",(S.playing?"Pause":"Play")+" all stems");}
    var sk=r.querySelector("[data-crs-seek]");if(sk&&document.activeElement!==sk)sk.value=now().toFixed(2);
    var tm=r.querySelector("[data-crs-time]");if(tm)tm.textContent=fmt(now())+" / "+fmt(S.duration);
  }
  function rows(){
    return'<ul class="crs-stems">'+S.data.stems.map(function(x){
      var inst=x.stem==="instrumental";
      return'<li class="crs-stem'+(gainFor(x.stem)?" is-on":"")+'" data-stem="'+e(x.stem)+'"><div class="crs-name"><b>'+e(LABEL[x.stem]||x.stem)+'</b><small class="cro-meta">'+e(mb(x.bytes))+(x.rms_dbfs!=null?" · "+e(x.rms_dbfs)+" dBFS RMS":"")+'</small></div>'
        +'<div class="crs-btns">'+(inst?"":'<button class="crs-btn'+(S.mute[x.stem]?" is-on":"")+'" type="button" data-crs-mute="'+e(x.stem)+'" aria-pressed="'+(!!S.mute[x.stem])+'">Mute</button>')
        +'<button class="crs-btn'+(S.solo[x.stem]?" is-on":"")+'" type="button" data-crs-solo="'+e(x.stem)+'" aria-pressed="'+(!!S.solo[x.stem])+'">'+(inst?"Play alone":"Solo")+'</button>'
        +'<a class="crs-btn" href="'+e(x.download_url)+'" download aria-label="Download '+e(LABEL[x.stem]||x.stem)+'">Save</a></div></li>';
    }).join("")+'</ul>';
  }
  function body(){
    if(!S.track)return'<p class="cro-meta">Pick a track to hear every instrument on its own.</p>';
    if(!S.data)return'<div class="cro-note">'+e(S.msg||"…")+'</div>';
    if(!S.data.stems||!S.data.stems.length)return'<div class="cro-note">No stems yet for this track.</div><div class="cro-actions"><button class="cr-btn cr-btn--primary" type="button" data-crs-queue>Separate stems</button></div><div class="crs-msg" role="status">'+e(S.msg)+'</div>';
    var ready=S.loaded===S.data.stems.length;
    return'<div class="crl-status"><span class="cro-pill">'+e(S.data.model)+'</span><span class="cro-meta">'+e(S.data.stems.length)+' files · '+e(S.data.format)+' · private</span></div>'
      +(ready?transport():'<p class="crs-load cro-meta">Loading stems… '+S.loaded+'/'+S.data.stems.length+'</p>')
      +rows()+'<div class="cro-actions"><button class="cr-btn" type="button" data-crs-queue>Re-run separation</button></div><div class="crs-msg" role="status" aria-live="polite">'+e(S.msg)+'</div>';
  }
  function view(){
    if(!S.list)loadList();
    var opts=(S.list||[]).map(function(t){return'<option value="'+e(t.key)+'"'+(t.key===S.key?" selected":"")+'>'+e(t.title)+" — "+e(t.album)+'</option>';}).join("");
    return'<section class="cro-card crl crs"><h2>Stems</h2><label class="crl-pick">Track<select data-crs-pick><option value="">Choose a track…</option>'+opts+'</select></label><div class="crl-body">'+body()+'</div></section>';
  }
  function paint(){if(!S.node)S.node=document.createElement("div");S.node.innerHTML=view();wire();}
  function wire(){
    var r=S.node;
    var pick=r.querySelector("[data-crs-pick]");if(pick)pick.onchange=function(){if(pick.value)open(pick.value);};
    var pb=r.querySelector("[data-crs-play]");if(pb)pb.onclick=function(){if(S.playing)pause();else play();};
    var sk=r.querySelector("[data-crs-seek]");if(sk)sk.oninput=function(){seek(parseFloat(sk.value)||0);};
    r.querySelectorAll("[data-crs-mute]").forEach(function(b){b.onclick=function(){var n=b.getAttribute("data-crs-mute");S.mute[n]=!S.mute[n];applyGains();refresh();};});
    r.querySelectorAll("[data-crs-solo]").forEach(function(b){b.onclick=function(){var n=b.getAttribute("data-crs-solo");S.solo[n]=!S.solo[n];applyGains();refresh();};});
    var q=r.querySelector("[data-crs-queue]");if(q)q.onclick=function(){q.disabled=true;musicCall("operator-stems-queue",S.track.body).then(function(j){S.msg=j.already?"Already separating on McCluster Core.":"Queued on McCluster Core. The stems appear here when it finishes.";var m=r.querySelector(".crs-msg");if(m)m.textContent=S.msg;}).catch(function(err){q.disabled=false;var m=r.querySelector(".crs-msg");if(m)m.textContent=err.message||"Could not queue";});};
  }
  function refresh(){var list=S.node.querySelector(".crs-stems");if(!list)return;var tmp=document.createElement("div");tmp.innerHTML=rows();list.parentNode.replaceChild(tmp.firstChild,list);wire();}
  window.CR.stemsPanel={
    render:function(){return'<div data-crs-host></div>';},
    bind:function(root){var host=root&&root.querySelector("[data-crs-host]");if(!host)return;if(!S.node)paint();host.appendChild(S.node);},
    state:S,_test:{gainFor:gainFor,now:now}
  };
})();
