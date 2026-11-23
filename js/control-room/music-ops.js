/* Native Control · Create · Music.
   Collapses Review Desk, Lyrics (js/control-room/lyrics-review.js), Stems (js/control-room/stems-panel.js), Vault and Lanes into one view.

   THE REVIEW IS OF THE BYTES THE REVIEWER HEARD (music slice M6, 2026-11-19; studio lane ST-1). This desk used to send
   "Publish + clear" with no version and no audio hash, and music-access refused it (400 "expected_updated_at required"),
   so nothing a creator submitted could go live from any live screen. It now runs the flow the release integrity work
   built (supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql, music-access operator-review-prepare):
   Verify + listen pins the master under review and hashes its bytes once, the reviewer plays THAT pinned object and
   sees its hash, and Publish carries the version the desk showed (expected_updated_at) and the hash it played
   (expected_master_sha256) to public.music_operator_review, which refuses anything else. Publish stays shut until then;
   a release that changed after it was verified is verified again. Needs review and Reject carry the version too.

   THE VAULT THAT IS NOT THERE SAYS SO (M6, law lane L-1). Catalog and Distribution read seven vault_* tables that are
   not in the database (supabase/pending/live-callers.json lists them as missing everywhere); they failed as a vague
   "Some music sources failed" on every tab, release review included. A missing table now reads as what it is: the
   vault is not set up yet, and its controls, which could save nothing, are not shown. Nothing here creates it. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var M={supa:null,rerender:null,section:"review",loading:false,error:null,loaded:false,
    review:{tracks:[],creators:[],offers:[],prepared:{},error:null},
    vault:{assets:[],people:[],state:"ok",error:null},
    lanes:{rows:[],gates:[],creds:{},house:{},open:{},filter:"all"}};
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function token(){return window.MCC_SUPA&&MCC_SUPA.token?MCC_SUPA.token():Promise.resolve(null);}
  function money(c,curr){try{return new Intl.NumberFormat(undefined,{style:"currency",currency:(curr||"usd").toUpperCase()}).format(Number(c||0)/100);}catch(_){return"$"+(Number(c||0)/100).toFixed(2);}}
  function musicCall(action,body){return token().then(function(t){if(!t)throw new Error("Signed out");return fetch(window.MCC_SUPA.url+"/functions/v1/music-access",{method:"POST",headers:{apikey:window.MCC_SUPA.key,authorization:"Bearer "+t,"content-type":"application/json"},body:JSON.stringify(Object.assign({action:action},body||{}))});}).then(function(r){return r.text().then(function(raw){var j={};try{j=raw?JSON.parse(raw):{};}catch(_){}if(!r.ok)throw new Error(j.error||("Music service "+r.status));return j;});});}
  function note(t,bad){return'<div class="cro-note'+(bad?" cro-note--bad":"")+'">'+e(t)+'</div>';}
  /* A table PostgREST does not have (the Control Room's supa() carries the status and PostgREST's answer) */
  function missingTable(err){var d=err&&err.detail||{},c=String(d.code||"");return c==="PGRST205"||c==="42P01"||(err&&err.status===404&&/schema cache|does not exist/i.test(String(d.message||err.message||"")));}
  function load(){
    if(M.loading)return Promise.resolve();M.loading=true;M.error=null;if(M.rerender)M.rerender();
    return Promise.allSettled([
      musicCall("operator-dashboard",{}),
      M.supa("vault_assets?select=*,vault_faces(person_id)&order=shot_at.desc.nullslast&limit=500"),
      M.supa("vault_people?select=id,name,role,org&limit=500"),
      M.supa("vault_lane_readiness?select=*"),
      M.supa("vault_gate_status?select=*"),
      M.supa("vault_credentials?select=*"),
      M.supa("vault_house?select=*&id=eq.1")
    ]).then(function(out){
      if(out[0].status==="fulfilled"){
        var d=out[0].value||{};M.review.tracks=d.tracks||[];M.review.creators=d.creators||[];M.review.offers=d.offers||[];M.review.error=null;
        /* a verified listen is of the release as it was then: a changed release is verified again */
        var keep={};M.review.tracks.forEach(function(t){var p=M.review.prepared[t.id];if(p&&p.track_updated_at===t.updated_at)keep[t.id]=p;});
        M.review.prepared=keep;
      }else M.review.error=out[0].reason||new Error("Music service unavailable");
      if(out[1].status==="fulfilled")M.vault.assets=out[1].value||[];
      if(out[2].status==="fulfilled")M.vault.people=out[2].value||[];
      if(out[3].status==="fulfilled")M.lanes.rows=out[3].value||[];
      if(out[4].status==="fulfilled")M.lanes.gates=out[4].value||[];
      if(out[5].status==="fulfilled"){M.lanes.creds={};(out[5].value||[]).forEach(function(c){M.lanes.creds[c.target_id]=c;});}
      if(out[6].status==="fulfilled")M.lanes.house=(out[6].value||[])[0]||{};
      var vaultFailed=out.slice(1).filter(function(x){return x.status==="rejected";}).map(function(x){return x.reason;});
      var broken=vaultFailed.filter(function(r){return!missingTable(r);});
      M.vault.state=!vaultFailed.length?"ok":broken.length?"error":"missing";
      M.vault.error=broken.length?broken[0]:null;
      M.error=M.review.error||M.vault.error||null;M.loading=false;M.loaded=true;if(M.rerender)M.rerender();
    });
  }
  function vaultNote(){
    if(M.vault.state==="missing")return note("The vault is not set up yet: its tables are not in the database, so there is nothing to show here and nothing here can be saved. Release review, direct sales, lyrics and stems do not depend on it.");
    if(M.vault.state==="error")return note("The vault could not be read: "+((M.vault.error&&M.vault.error.message)||M.vault.error)+". Nothing here was changed.",true);
    return"";
  }
  /* (f) what the reviewer hears is the pinned master being approved, with its SHA-256 */
  function listened(t){
    var p=M.review.prepared[t.id];
    if(!p)return"";
    return'<div class="cro-meta"><audio controls preload="none" src="'+e(p.listen_url)+'" style="display:block;width:100%;max-width:100%;margin:6px 0"></audio>Audio SHA-256 <code title="'+e(p.sha256)+'">'+e(p.sha256_short)+'</code>'+(p.size_bytes!=null?' · '+e((Number(p.size_bytes)/1048576).toFixed(1))+' MB':'')+' · publishing approves exactly these bytes</div>';
  }
  function review(){
    var cm={};M.review.creators.forEach(function(c){cm[c.m_uid]=c;});
    var tracks=M.review.tracks.length?'<div class="cro-list">'+M.review.tracks.map(function(t){
      var c=cm[t.m_uid]||{},x=t.experience&&typeof t.experience==="object"?t.experience:{},commerce=x.commerce&&x.commerce.href?" · service CTA":"",media=(t.music_video_url?" · music video":"")+(t.lyrics_url?" · lyrics":""),p=M.review.prepared[t.id];
      return'<div class="cro-item"><div class="cro-item__head"><div><strong>'+e(t.title||"Untitled")+'</strong><div class="cro-meta">'+e(c.artist_name||t.artist||"Unknown creator")+' · '+e(t.access_mode||"")+' · '+e(t.status||"")+' · rights '+e(t.rights_status||"")+e(media+commerce)+'</div></div><span class="cro-pill">'+e(t.status||"queue")+'</span></div>'+(t.moderation_note?'<div class="cro-meta">'+e(t.moderation_note)+'</div>':"")+listened(t)+
        '<div class="cro-actions"><button class="cr-btn" type="button" data-crom-prepare="'+e(t.id)+'">'+(p?"Listen again":"Verify + listen")+'</button>'+
        '<button class="cr-btn cr-btn--primary" type="button" data-crom-review="publish" data-id="'+e(t.id)+'"'+(p?' data-version="'+e(p.expected_updated_at)+'" data-sha="'+e(p.sha256)+'"':' disabled title="Verify and listen to the audio first"')+'>Publish + clear</button>'+
        '<button class="cr-btn" type="button" data-crom-review="review" data-id="'+e(t.id)+'" data-version="'+e(t.updated_at||"")+'">Needs review</button>'+
        '<button class="cr-btn" type="button" data-crom-review="reject" data-id="'+e(t.id)+'" data-version="'+e(t.updated_at||"")+'">Reject</button></div></div>';
    }).join("")+'</div>':note("No creator releases in the queue.");
    var byTrack={};M.review.tracks.forEach(function(t){byTrack[t.id]=t;});
    var offers=M.review.offers.length?'<div class="cro-list">'+M.review.offers.map(function(o){var t=byTrack[o.track_id]||{},live=o.active&&o.checkout_enabled;return'<div class="cro-item"><div class="cro-item__head"><div><strong>'+e(o.title||"License offer")+'</strong><div class="cro-meta">'+e(t.title||o.track_id)+' · '+e(o.license_type||"")+(o.price_cents!=null?" · "+e(money(o.price_cents,o.currency)):"")+' · platform fee '+(Number(o.platform_fee_bps||0)/100).toFixed(1)+'%</div></div><span class="cro-pill">'+(live?"checkout on":"checkout off")+'</span></div><div class="cro-actions"><button class="cr-btn'+(live?"":" cr-btn--primary")+'" type="button" data-crom-license="'+e(o.id)+'" data-enabled="'+(live?"0":"1")+'">'+(live?"Disable checkout":"Enable checkout")+'</button></div></div>';}).join("")+'</div>':note("No license offers yet.");
    var failed=M.review.error?note("The release queue could not be read: "+(M.review.error.message||M.review.error),true):"";
    return failed+'<div class="cro-grid cro-grid--2"><section class="cro-card"><h2>Release queue</h2>'+tracks+'</section><section class="cro-card"><h2>License offers</h2>'+offers+'</section></div>';
  }
  function assetCard(a){
    var ai=a.ai&&typeof a.ai==="object"?a.ai:{},faces=a.vault_faces||[],confirmed=Array.isArray(faces)?faces:[],people=(ai.people||[]);
    return'<details class="cro-details" data-crom-asset="'+e(a.id)+'"><summary><span class="cro-media">'+(a.preview_url?'<img src="'+e(a.preview_url)+'" alt="">':'<span class="cro-media__ph">asset</span>')+'<span><b>'+e(a.catalog_id||a.master_name||a.id)+'</b><small class="cro-meta">'+e(a.status||"new")+' · '+e(a.license||"")+' · '+(a.release_clear?"release clear":"release not clear")+'</small></span></span></summary><div class="cro-details__body"><div class="cro-grid cro-grid--2"><div class="cro-card"><h3>Capture</h3><div class="cro-meta">Shot '+e(a.shot_at||"—")+'<br>'+e([a.camera,a.lens].filter(Boolean).join(" · ")||"—")+'<br>'+e([a.iso?"ISO "+a.iso:"",a.aperture,a.shutter].filter(Boolean).join(" · ")||"—")+'<br>'+e(a.event_id||"loose")+'</div></div><div class="cro-card"><h3>Machine read</h3><div class="cro-meta">'+e(ai.caption||"No machine caption")+(ai.scene?"<br>"+e(ai.scene):"")+'</div></div></div>'+(people.length?'<div class="cro-card" style="margin-top:8px"><h3>People · confirm guesses</h3><div class="cro-list">'+people.map(function(p){return'<div class="cro-row"><div>'+e(p.description||"person")+(p.guess?" · guess <b>"+e(p.guess)+"</b>":"")+'</div>'+(p.guess?'<button class="cr-btn" type="button" data-crom-face="'+e(p.guess)+'" data-asset="'+e(a.id)+'">Confirm</button>':"")+'</div>';}).join("")+(confirmed.length?'<div class="cro-meta">'+e(confirmed.length)+' confirmed face link'+(confirmed.length===1?"":"s")+'</div>':"")+'</div></div>':"")+'<div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-crom-asset-status="reviewed" data-id="'+e(a.id)+'">Mark reviewed</button><button class="cr-btn" type="button" data-crom-clear="'+e(a.id)+'" data-next="'+(a.release_clear?"0":"1")+'">'+(a.release_clear?"Un-clear release":"Clear release")+'</button><button class="cr-btn" type="button" data-crom-asset-status="archived" data-id="'+e(a.id)+'">Archive</button></div></div></details>';
  }
  function catalog(){
    if(M.vault.state!=="ok")return vaultNote();
    var assets=M.vault.assets||[],reviewed=assets.filter(function(a){return a.status==="reviewed";}).length,clear=assets.filter(function(a){return a.release_clear;}).length;
    return'<div class="cro-statgrid"><div class="cro-stat"><b>'+e(assets.length)+'</b><span>assets</span></div><div class="cro-stat"><b>'+e(reviewed)+'</b><span>reviewed</span></div><div class="cro-stat"><b>'+e(clear)+'</b><span>release clear</span></div><div class="cro-stat"><b>'+e(M.vault.people.length)+'</b><span>people</span></div></div><div class="cro-list" style="margin-top:10px">'+(assets.length?assets.map(assetCard).join(""):note("No vault assets returned."))+'</div>';
  }
  function laneCard(l){
    var gs=M.lanes.gates.filter(function(g){return g.target_id===l.id;}),c=M.lanes.creds[l.id]||{},open=!!M.lanes.open[l.id];
    return'<details class="cro-details" data-crom-lane="'+e(l.id)+'"'+(open?" open":"")+'><summary><div class="cro-item__head"><div><strong>'+e(l.label||l.id)+'</strong><div class="cro-meta">'+e(l.lane||"")+" · "+e(l.rail||"")+" · "+e(l.your_cut||"")+(l.has_credentials?" · wired":"")+'</div></div><span class="cro-pill">'+e(l.onboarded?"onboarded":l.unlocked?"unlocked":"locked")+' · '+e(l.pct||0)+'%</span></div><div class="cro-progress" style="margin-top:8px"><i style="--pct:'+Math.max(0,Math.min(100,Number(l.pct)||0))+'%"></i></div></summary><div class="cro-details__body">'+(l.wants?'<p><b>Wants:</b> '+e(l.wants)+'</p>':"")+(l.avoid?'<p><b>Watch:</b> '+e(l.avoid)+'</p>':"")+(gs.length?'<div class="cro-list">'+gs.map(function(g){return'<div class="cro-row"><span>'+e(g.label)+(g.detail?" · "+e(g.detail):"")+'</span><b>'+e(g.met?"met":(g.pct||0)+"%")+'</b></div>';}).join("")+'</div>':"")+'<div class="cro-form cro-form--3" style="margin-top:8px"><label>Protocol<select data-crom-cred="protocol" data-target="'+e(l.id)+'">'+["","sftp","ftp","ftps","https","none"].map(function(p){return'<option value="'+p+'"'+(c.protocol===p?" selected":"")+'>'+(p||"·")+'</option>';}).join("")+'</select></label><label>Host<input data-crom-cred="host" data-target="'+e(l.id)+'" value="'+e(c.host||"")+'"></label><label>Username<input data-crom-cred="username" data-target="'+e(l.id)+'" value="'+e(c.username||"")+'"></label><label>Secret name<input data-crom-cred="secret_ref" data-target="'+e(l.id)+'" value="'+e(c.secret_ref||"")+'"></label><label>Account email<input data-crom-cred="account_email" data-target="'+e(l.id)+'" value="'+e(c.account_email||"")+'"></label><label>Remote dir<input data-crom-cred="remote_dir" data-target="'+e(l.id)+'" value="'+e(c.remote_dir||"/")+'"></label></div><div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-crom-savecred="'+e(l.id)+'">Save credentials</button><button class="cr-btn" type="button" data-crom-toggle="'+e(l.id)+'">'+(l.onboarded?"Mark not onboarded":"Mark onboarded")+'</button></div></div></details>';
  }
  function distribution(){
    if(M.vault.state!=="ok")return vaultNote();
    var rows=M.lanes.rows.filter(function(l){var f=M.lanes.filter;if(f==="all")return true;if(f==="locked")return!l.unlocked;if(f==="ready")return l.unlocked&&!l.onboarded;return l.lane===f;}).sort(function(a,b){return(a.priority||99)-(b.priority||99);}),h=M.lanes.house||{};
    return'<section class="cro-card"><h2>House facts</h2><div class="cro-form cro-form--2"><label>Published bylines<input id="cromBylines" type="number" min="0" value="'+e(h.bylines||0)+'"></label><label>Portfolio URL<input id="cromPortfolio" value="'+e(h.portfolio_url||"")+'"></label><label>PLUS ID<input id="cromPlus" value="'+e(h.plus_id||"")+'"></label><label>Copyright filed<select id="cromCopyright"><option value="false"'+(h.copyright_filed?"":" selected")+'>Not yet</option><option value="true"'+(h.copyright_filed?" selected":"")+'>Filed</option></select></label></div><div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-crom-savehouse>Save house facts</button></div></section><div class="cro-chips">'+["all","ready","locked","editorial","microstock","premium","aggregator"].map(function(f){return'<button class="cro-chip'+(M.lanes.filter===f?" is-on":"")+'" type="button" data-crom-filter="'+f+'">'+e(f)+'</button>';}).join("")+'</div><div class="cro-list">'+(rows.length?rows.map(laneCard).join(""):note("No lanes match this filter."))+'</div>';
  }
  function render(){
    if(!M.loaded&&!M.loading)load();
    return'<div class="cro"><div class="cro-tabs">'+[["review","Review"],["direct","Direct sales"],["lyrics","Lyrics"],["stems","Stems"],["catalog","Catalog"],["distribution","Distribution"]].map(function(t){return'<button class="cro-tab'+(M.section===t[0]?" is-on":"")+'" type="button" data-crom-section="'+t[0]+'">'+t[1]+'</button>';}).join("")+'</div>'+(M.loading&&!M.loaded?note("Loading music operations…"):"")+(M.section==="stems"?(window.CR.stemsPanel?window.CR.stemsPanel.render():note("Stems did not load.",true)):M.section==="lyrics"?(window.CR.lyricsReview?window.CR.lyricsReview.render():note("Lyrics review did not load.",true)):M.section==="direct"?(window.CR.musicDirect?window.CR.musicDirect.render():note("Direct sales did not load.",true)):M.section==="catalog"?catalog():M.section==="distribution"?distribution():review())+'</div>';
  }
  function reloadSection(){return load();}
  function bind(root){
    if(M.section==="lyrics"&&window.CR.lyricsReview)window.CR.lyricsReview.bind(root);
    if(M.section==="stems"&&window.CR.stemsPanel)window.CR.stemsPanel.bind(root);
    (root?root.querySelectorAll("[data-crom-section]"):[]).forEach(function(b){b.onclick=function(){M.section=b.getAttribute("data-crom-section");if(M.rerender)M.rerender();};});
    /* Verify + listen: pin the master under review, hash its bytes once, hand back a player for that pinned object */
    (root?root.querySelectorAll("[data-crom-prepare]"):[]).forEach(function(b){b.onclick=function(){var id=b.getAttribute("data-crom-prepare");b.disabled=true;b.textContent="Verifying audio…";musicCall("operator-review-prepare",{track_id:id}).then(function(p){var t=M.review.tracks.filter(function(x){return x.id===id;})[0]||{};p.track_updated_at=t.updated_at;M.review.prepared[id]=p;if(M.rerender)M.rerender();}).catch(function(err){b.disabled=false;b.textContent="Verify + listen";alert(err.message||"Audio verification failed");});};});
    /* the version this desk shows, and for publish the audio bytes it played: the server refuses anything else */
    (root?root.querySelectorAll("[data-crom-review]"):[]).forEach(function(b){b.onclick=function(){var d=b.getAttribute("data-crom-review"),noteText="";if(d!=="publish")noteText=prompt(d==="reject"?"Why is this release rejected?":"What documentation/review is needed?","")||"";b.disabled=true;var body={track_id:b.getAttribute("data-id"),decision:d,note:noteText,expected_updated_at:b.getAttribute("data-version")||""};if(d==="publish")body.expected_master_sha256=b.getAttribute("data-sha")||"";musicCall("operator-review",body).then(reloadSection).catch(function(err){b.disabled=false;alert(err.message||"Review failed");});};});
    (root?root.querySelectorAll("[data-crom-license]"):[]).forEach(function(b){b.onclick=function(){b.disabled=true;musicCall("operator-license",{offer_id:b.getAttribute("data-crom-license"),enabled:b.getAttribute("data-enabled")==="1"}).then(reloadSection).catch(function(err){b.disabled=false;alert(err.message||"License update failed");});};});
    (root?root.querySelectorAll("[data-crom-asset-status]"):[]).forEach(function(b){b.onclick=function(){b.disabled=true;M.supa("vault_assets?id=eq."+encodeURIComponent(b.getAttribute("data-id")),{method:"PATCH",body:{status:b.getAttribute("data-crom-asset-status")}}).then(reloadSection).catch(function(err){b.disabled=false;alert(err.message||"Asset update failed");});};});
    (root?root.querySelectorAll("[data-crom-clear]"):[]).forEach(function(b){b.onclick=function(){b.disabled=true;M.supa("vault_assets?id=eq."+encodeURIComponent(b.getAttribute("data-crom-clear")),{method:"PATCH",body:{release_clear:b.getAttribute("data-next")==="1"}}).then(reloadSection).catch(function(err){b.disabled=false;alert(err.message||"Release update failed");});};});
    (root?root.querySelectorAll("[data-crom-face]"):[]).forEach(function(b){b.onclick=function(){var name=b.getAttribute("data-crom-face"),asset=b.getAttribute("data-asset"),p=M.vault.people.find(function(x){return String(x.name||"").toLowerCase()===String(name).toLowerCase();}),mk=p?Promise.resolve([p]):M.supa("vault_people",{method:"POST",prefer:"return=representation",body:{name:name}});b.disabled=true;mk.then(function(rows){var person=rows[0];return M.supa("vault_faces",{method:"POST",body:{asset_id:asset,person_id:person.id,source:"ai-confirmed"}});}).then(reloadSection).catch(function(err){b.disabled=false;alert(err.message||"Face confirmation failed");});};});
    if(window.CR.musicDirect)window.CR.musicDirect.bind(root);
    (root?root.querySelectorAll("[data-crom-filter]"):[]).forEach(function(b){b.onclick=function(){M.lanes.filter=b.getAttribute("data-crom-filter");if(M.rerender)M.rerender();};});
    var sh=root&&root.querySelector("[data-crom-savehouse]");if(sh)sh.onclick=function(){sh.disabled=true;M.supa("vault_house?id=eq.1",{method:"PATCH",body:{bylines:parseInt((root.querySelector("#cromBylines")||{}).value,10)||0,portfolio_url:(root.querySelector("#cromPortfolio")||{}).value||"",plus_id:(root.querySelector("#cromPlus")||{}).value||"",copyright_filed:(root.querySelector("#cromCopyright")||{}).value==="true"}}).then(reloadSection).catch(function(err){sh.disabled=false;alert(err.message||"House facts failed");});};
    (root?root.querySelectorAll("[data-crom-savecred]"):[]).forEach(function(b){b.onclick=function(){var id=b.getAttribute("data-crom-savecred"),row={target_id:id,updated_at:new Date().toISOString()};root.querySelectorAll('[data-target="'+CSS.escape(id)+'"][data-crom-cred]').forEach(function(i){var v=i.value.trim();row[i.getAttribute("data-crom-cred")]=v===""?null:v;});b.disabled=true;M.supa("vault_credentials",{method:"POST",prefer:"resolution=merge-duplicates",body:row}).then(reloadSection).catch(function(err){b.disabled=false;alert(err.message||"Credential save failed");});};});
    (root?root.querySelectorAll("[data-crom-toggle]"):[]).forEach(function(b){b.onclick=function(){var id=b.getAttribute("data-crom-toggle"),cur=M.lanes.rows.find(function(x){return String(x.id)===String(id);});if(!cur)return;b.disabled=true;M.supa("vault_targets?id=eq."+encodeURIComponent(id),{method:"PATCH",body:{onboarded:!cur.onboarded}}).then(reloadSection).catch(function(err){b.disabled=false;alert(err.message||"Lane update failed");});};});
  }
  window.CR.musicOps={init:function(opts){M.supa=opts.supa;M.rerender=opts.render;if(window.CR.musicDirect)window.CR.musicDirect.init({render:opts.render});},render:render,bind:bind,load:load,state:M};
})();
