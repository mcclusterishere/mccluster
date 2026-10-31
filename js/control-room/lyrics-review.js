/* Native Control · Create · Music · Lyrics — the owner checks the lyric machine.

   Pick a track; it plays, its lines light as they are sung (the same reader the
   players use, js/lyrics-sync.js), and every line can be fixed:
     - the words (a typed line keeps its word times when the count is the same,
       otherwise its words are spread across the line),
     - the start time: tap the clock to hear it, -/+ nudges 0.1 s, "Now" stamps
       the current playhead,
     - flagged lines (the machine heard something else) are marked, with what it
       heard; "Flagged" shows only those.
   Then mark reviewed and keep it:
     - an uploaded release saves through music-access (operator-lyrics-save, the
       existing owner-only path) and can be re-run on McCluster Core;
     - a shelf track lives in the repo (data/lyrics/<slug>.json): the corrected
       file downloads, to commit or hand to McCluster's Build desk. No new write
       backend.
*/
(function(){
  "use strict";
  window.CR=window.CR||{};
  var L={list:null,loading:false,error:null,key:"",doc:null,orig:"",src:"",kind:"",track:null,filter:"all",msg:"",node:null,audio:null,raf:0,live:-1};
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function fmt(t){if(!isFinite(t))return"-";var m=Math.floor(t/60),s=t-m*60;return m+":"+(s<10?"0":"")+s.toFixed(2);}
  function r3(x){return Math.round(x*1000)/1000;}
  function slugOf(src){return String(src||"").split("/").pop().replace(/\.[a-z0-9]+$/i,"");}
  function lines(){return L.doc&&L.doc.timed&&Array.isArray(L.doc.timed.line)?L.doc.timed.line:[];}

  /* ---- the edits ---- */
  function setText(i,text){
    var l=lines()[i];if(!l)return;
    var words=String(text).trim().split(/\s+/).filter(Boolean);
    l.content=String(text).trim();
    if(Array.isArray(l.words)&&l.words.length===words.length){l.words.forEach(function(w,k){w.content=words[k];});}
    else{var b=l.begin,en=l.end!=null?l.end:b+2,step=(en-b)/Math.max(1,words.length);l.words=words.map(function(w,k){return{begin:r3(b+step*k),end:r3(b+step*(k+1)),content:w};});}
    if(l.mismatch){l.mismatch=false;l.edited=true;}
  }
  function shift(i,delta){
    var l=lines()[i];if(!l)return;
    var prev=lines()[i-1],next=lines()[i+1];
    var lo=prev?prev.begin:0,hi=next?next.begin:(L.audio&&isFinite(L.audio.duration)?L.audio.duration:l.begin+delta+1);
    var nb=Math.max(lo,Math.min(hi,l.begin+delta));delta=nb-l.begin;
    l.begin=r3(nb);if(l.end!=null)l.end=r3(Math.max(l.begin,l.end+delta));
    (l.words||[]).forEach(function(w){w.begin=r3(Math.max(l.begin,w.begin+delta));w.end=r3(Math.max(w.begin,w.end+delta));if(l.end!=null){w.end=Math.min(w.end,l.end);w.begin=Math.min(w.begin,w.end);}});
    l.mismatch=false;l.edited=true;
  }
  /** problems that would make a player misbehave; [] when the file is safe to keep */
  function problems(){
    var out=[],prev=-1,D=L.audio&&isFinite(L.audio.duration)?L.audio.duration:null;
    lines().forEach(function(l,i){
      if(typeof l.content!=="string"||!l.content.trim())out.push("Line "+(i+1)+" has no words.");
      if(!(l.begin>=prev))out.push("Line "+(i+1)+" starts before the line above.");
      if(D!=null&&l.begin>D+0.75)out.push("Line "+(i+1)+" starts after the song ends.");
      (l.words||[]).forEach(function(w){if(w.begin<l.begin-0.001||(l.end!=null&&w.end>l.end+0.001))out.push("Line "+(i+1)+" has a word outside it.");});
      prev=l.begin;
    });
    return out.filter(function(x,i,a){return a.indexOf(x)===i;});
  }
  function output(reviewed){
    var d=JSON.parse(JSON.stringify(L.doc));
    d.reviewed=!!reviewed;
    if(reviewed){d.reviewed_at=new Date().toISOString();}
    d.plain=lines().map(function(l){return l.content;}).join("\n");
    d.timed.line.forEach(function(l){delete l.edited;});
    return d;
  }

  /* ---- data ---- */
  function loadList(){
    if(L.loading)return;L.loading=true;L.error=null;
    fetch("data/albums.json",{cache:"no-cache"}).then(function(r){return r.json();}).then(function(a){
      var shelf=[];(a.albums||[]).forEach(function(al){(al.tracks||[]).forEach(function(t){if(t.lyrics&&t.src&&!t.gated)shelf.push({key:"shelf:"+t.lyrics,kind:"shelf",title:t.title,album:al.name,lyrics:t.lyrics,src:t.src});});});
      var ups=((window.CR.musicOps&&window.CR.musicOps.state.review.tracks)||[]).map(function(t){return{key:"upload:"+t.id,kind:"upload",title:t.title||"Untitled",album:t.artist||"Upload",id:t.id};});
      L.list=shelf.concat(ups);L.loading=false;paint();
    }).catch(function(err){L.loading=false;L.error=err.message||"Could not read the shelf";paint();});
  }
  function musicCall(action,body){
    var tok=window.MCC_SUPA&&MCC_SUPA.token?MCC_SUPA.token():Promise.resolve(null);
    return tok.then(function(t){if(!t)throw new Error("Signed out");return fetch(window.MCC_SUPA.url+"/functions/v1/music-access",{method:"POST",headers:{apikey:window.MCC_SUPA.key,authorization:"Bearer "+t,"content-type":"application/json"},body:JSON.stringify(Object.assign({action:action},body||{}))});})
      .then(function(r){return r.json().catch(function(){return{};}).then(function(j){if(!r.ok)throw new Error(j.error||("Music service "+r.status));return j;});});
  }
  function open(key){
    var t=(L.list||[]).filter(function(x){return x.key===key;})[0];if(!t)return;
    L.key=key;L.track=t;L.doc=null;L.msg="Loading…";L.live=-1;paint();
    var got=t.kind==="shelf"
      ?fetch(t.lyrics,{cache:"no-cache"}).then(function(r){if(!r.ok)throw new Error("No lyrics file");return r.json();}).then(function(j){return{doc:j,src:t.src};})
      :musicCall("operator-lyrics-get",{track_id:t.id}).then(function(j){return{doc:j.lyrics,src:j.listen_url};});
    got.then(function(r){
      if(!r.doc||!r.doc.timed||!Array.isArray(r.doc.timed.line)){L.doc=null;L.msg=r.doc?"These lyrics have no timing yet. Re-run the machine to time them.":"No lyrics yet. The machine writes them after upload.";L.src=r.src||"";paint();return;}
      L.doc=r.doc;L.orig=JSON.stringify(r.doc);L.src=r.src||"";L.msg="";paint();
    }).catch(function(err){L.msg=err.message||"Could not load";paint();});
  }

  /* ---- view ---- */
  function statusLine(){
    var d=L.doc;if(!d)return"";
    var n=lines().length,flag=lines().filter(function(l){return l.mismatch;}).length;
    var src={aligned:"your sheet, timed by McCluster",auto:"heard by McCluster (no sheet)",imported:"imported timing",owner:"written by you"}[d.source]||"existing file";
    var eng=d.machine&&d.machine.engine?Object.keys(d.machine.engine).map(function(k){return d.machine.engine[k];}).join(" · "):"";
    return'<div class="crl-status"><span class="cro-pill'+(d.reviewed?" crl-ok":"")+'">'+(d.reviewed?"Reviewed":"Needs your check")+'</span><span class="cro-meta">'+e(n)+" lines · "+e(flag)+" flagged · "+e(src)+(eng?" · "+e(eng):"")+'</span></div>';
  }
  function rowHtml(l,i){
    var flagged=l.mismatch,show=L.filter==="all"||flagged;
    return'<li class="crl-line'+(flagged?" is-flag":"")+(i===L.live?" is-live":"")+'" data-i="'+i+'"'+(show?"":" hidden")+'>'
      +'<div class="crl-time"><button class="crl-t" type="button" data-crl-seek="'+i+'" aria-label="Play from line '+(i+1)+'">'+fmt(l.begin)+'</button>'
      +'<button class="crl-nudge" type="button" data-crl-nudge="-0.1" data-i="'+i+'" aria-label="Earlier">−</button>'
      +'<button class="crl-nudge" type="button" data-crl-nudge="0.1" data-i="'+i+'" aria-label="Later">+</button>'
      +'<button class="crl-nudge crl-now" type="button" data-crl-now="'+i+'" aria-label="Start this line at the playhead">Now</button></div>'
      +'<input class="crl-text" type="text" value="'+e(l.content)+'" data-crl-text="'+i+'" aria-label="Words of line '+(i+1)+'">'
      +(flagged?'<small class="crl-heard">'+(l.heard?"Heard: “"+e(l.heard)+"”":l.added?"Sung, but not on your sheet":"Timing guessed: check it")+(l.sheet?" · your sheet: “"+e(l.sheet)+"”":"")+'</small>':"")
      +'</li>';
  }
  function editor(){
    if(!L.track)return'<p class="cro-meta">Pick a track to check its lyrics against the music.</p>';
    if(!L.doc)return'<div class="cro-note">'+e(L.msg||"…")+'</div>'+(L.track.kind==="upload"?'<div class="cro-actions"><button class="cr-btn" type="button" data-crl-queue>Run the lyric machine</button></div>':"");
    var up=L.track.kind==="upload";
    return statusLine()
      +'<audio class="crl-audio" controls preload="metadata" src="'+e(L.src)+'"></audio>'
      +'<div class="cro-chips"><button class="cro-chip'+(L.filter==="all"?" is-on":"")+'" type="button" data-crl-filter="all">All lines</button><button class="cro-chip'+(L.filter==="flag"?" is-on":"")+'" type="button" data-crl-filter="flag">Flagged</button></div>'
      +'<ol class="crl-lines">'+lines().map(rowHtml).join("")+'</ol>'
      +'<div class="crl-foot"><label class="crl-check"><input type="checkbox" data-crl-reviewed'+(L.doc.reviewed?" checked":"")+'> These lyrics are right</label>'
      +'<div class="cro-actions">'+(up?'<button class="cr-btn cr-btn--primary" type="button" data-crl-save>Save</button><button class="cr-btn" type="button" data-crl-queue>Re-run machine</button>':'<button class="cr-btn cr-btn--primary" type="button" data-crl-download>Download corrected file</button>')+'</div>'
      +(up?"":'<small class="cro-meta">Shelf lyrics live in the repository as '+e(L.track.lyrics)+'. Commit the downloaded file there, or hand it to Build.</small>')
      +'<div class="crl-msg" role="status" aria-live="polite">'+e(L.msg)+'</div></div>';
  }
  function view(){
    if(!L.list&&!L.loading)loadList();
    var opts=(L.list||[]).map(function(t){return'<option value="'+e(t.key)+'"'+(t.key===L.key?" selected":"")+'>'+e(t.title)+" — "+e(t.album)+(t.kind==="upload"?" (upload)":"")+'</option>';}).join("");
    return'<section class="cro-card crl"><h2>Lyrics</h2><label class="crl-pick">Track<select data-crl-pick><option value="">Choose a track…</option>'+opts+'</select></label>'
      +(L.error?'<div class="cro-note cro-note--bad">'+e(L.error)+'</div>':"")+'<div class="crl-body">'+editor()+'</div></section>';
  }

  /* the editor owns its own DOM so playback never stops when Control repaints */
  function paint(){
    if(!L.node)L.node=document.createElement("div");
    var keepAudio=L.audio&&L.audio.getAttribute("src")===L.src&&L.doc?L.audio:null;
    L.node.innerHTML=view();
    if(keepAudio){var fresh=L.node.querySelector(".crl-audio");if(fresh)fresh.parentNode.replaceChild(keepAudio,fresh);}
    L.audio=L.node.querySelector(".crl-audio");
    wire();
  }
  function follow(){
    var a=L.audio;if(!a||a._crl)return;a._crl=1;
    function tick(){
      var i=window.MCC_LYRICS?window.MCC_LYRICS.indexAt(lines().map(function(l){return{t:l.begin};}),a.currentTime):-1;
      if(i!==L.live){
        var root=L.node,old=root.querySelector(".crl-line.is-live");if(old)old.classList.remove("is-live");
        L.live=i;var li=root.querySelector('.crl-line[data-i="'+i+'"]');
        if(li){li.classList.add("is-live");var box=root.querySelector(".crl-lines");if(box&&document.activeElement&&!li.contains(document.activeElement))box.scrollTo({top:li.offsetTop-box.offsetTop-box.clientHeight*0.3,behavior:"smooth"});}
      }
      L.raf=a.paused?0:requestAnimationFrame(tick);
    }
    a.addEventListener("play",function(){if(!L.raf)L.raf=requestAnimationFrame(tick);});
    a.addEventListener("seeked",tick);a.addEventListener("timeupdate",function(){if(!L.raf)tick();});
  }
  function refreshRow(i){var li=L.node.querySelector('.crl-line[data-i="'+i+'"]');if(!li)return;var tmp=document.createElement("ol");tmp.innerHTML=rowHtml(lines()[i],i);li.parentNode.replaceChild(tmp.firstChild,li);wire();}
  function wire(){
    var root=L.node;follow();
    var pick=root.querySelector("[data-crl-pick]");if(pick)pick.onchange=function(){if(pick.value)open(pick.value);};
    root.querySelectorAll("[data-crl-filter]").forEach(function(b){b.onclick=function(){L.filter=b.getAttribute("data-crl-filter");root.querySelectorAll("[data-crl-filter]").forEach(function(x){x.classList.toggle("is-on",x===b);});root.querySelectorAll(".crl-line").forEach(function(li){li.hidden=L.filter==="flag"&&!li.classList.contains("is-flag");});};});
    root.querySelectorAll("[data-crl-seek]").forEach(function(b){b.onclick=function(){var l=lines()[+b.getAttribute("data-crl-seek")];if(L.audio&&l){L.audio.currentTime=l.begin;var p=L.audio.play();if(p&&p.catch)p.catch(function(){});}};});
    root.querySelectorAll("[data-crl-nudge]").forEach(function(b){b.onclick=function(){var i=+b.getAttribute("data-i");shift(i,+b.getAttribute("data-crl-nudge"));refreshRow(i);};});
    root.querySelectorAll("[data-crl-now]").forEach(function(b){b.onclick=function(){var i=+b.getAttribute("data-crl-now"),l=lines()[i];if(!l||!L.audio)return;shift(i,L.audio.currentTime-l.begin);refreshRow(i);};});
    root.querySelectorAll("[data-crl-text]").forEach(function(inp){inp.onchange=function(){var i=+inp.getAttribute("data-crl-text");setText(i,inp.value);var li=inp.closest(".crl-line");if(li){li.classList.remove("is-flag");var h=li.querySelector(".crl-heard");if(h)h.remove();}};});
    var rev=root.querySelector("[data-crl-reviewed]");if(rev)rev.onchange=function(){L.doc.reviewed=rev.checked;};
    function say(t){L.msg=t;var m=root.querySelector(".crl-msg");if(m)m.textContent=t;}
    var dl=root.querySelector("[data-crl-download]");if(dl)dl.onclick=function(){
      var bad=problems();if(bad.length){say(bad[0]);return;}
      var blob=new Blob([JSON.stringify(output(L.doc.reviewed),null,1)+"\n"],{type:"application/json"}),a=document.createElement("a");
      a.href=URL.createObjectURL(blob);a.download=slugOf(L.track.lyrics)+".json";document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},0);
      say("Downloaded "+a.download+(L.doc.reviewed?" (marked reviewed).":"."));
    };
    var sv=root.querySelector("[data-crl-save]");if(sv)sv.onclick=function(){
      var bad=problems();if(bad.length){say(bad[0]);return;}
      sv.disabled=true;musicCall("operator-lyrics-save",{track_id:L.track.id,lyrics:output(L.doc.reviewed),reviewed:!!L.doc.reviewed})
        .then(function(){sv.disabled=false;L.orig=JSON.stringify(L.doc);say(L.doc.reviewed?"Saved and marked reviewed.":"Saved.");})
        .catch(function(err){sv.disabled=false;say(err.message||"Save failed");});
    };
    var q=root.querySelector("[data-crl-queue]");if(q)q.onclick=function(){
      q.disabled=true;musicCall("operator-lyrics-queue",{track_id:L.track.id})
        .then(function(j){say(j.already?"Already running on McCluster Core.":"Queued on McCluster Core. The new lyrics arrive unreviewed.");})
        .catch(function(err){q.disabled=false;say(err.message||"Could not queue");});
    };
  }
  window.CR.lyricsReview={
    render:function(){return'<div data-crl-host></div>';},
    bind:function(root){var host=root&&root.querySelector("[data-crl-host]");if(!host)return;if(!L.node)paint();host.appendChild(L.node);},
    state:L,_test:{setText:setText,shift:shift,problems:problems,output:output}
  };
})();
