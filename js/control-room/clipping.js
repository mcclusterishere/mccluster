/* Native Control · Create · Clipping.

   A creator's paid clipping campaigns, run on the Action Network. Everything
   here reads or calls the database's clip_* functions with the operator's
   own session, and each function checks that the caller owns the
   campaign's organization. Nothing on this page computes money: spend,
   committed budget, verified and payable views, conversions and payouts are
   what clip_campaign_dashboard() reports, and they move only when the
   Worker records a platform read (supabase/migrations/20261006170955_action_clipping_marketplace_v1.sql).

   Only Instagram can be verified server-side today, so the launch form
   offers YouTube and TikTok as unavailable rather than pretending. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var C={supa:null,rerender:null,org:null,loading:false,loaded:false,error:null,campaigns:[],sel:null,tab:"overview",
    dash:{},dashErr:{},msg:"",bad:false,busy:false,songs:null,files:null,sources:null,sourceType:"music"};
  var MISSING=/clip_campaigns_for_org|PGRST202|Could not find the function/i;
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function n(v){return Number(v||0).toLocaleString("en-US");}
  function usd(c){return"$"+(Number(c||0)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});}
  function note(t,bad){return'<div class="cro-note'+(bad?" cro-note--bad":"")+'">'+e(t)+'</div>';}
  function org(){var o=C.org&&C.org();return o&&o.id?o.id:null;}
  function rpc(name,body){return C.supa("rpc/"+name,{method:"POST",body:body||{}});}
  function redraw(){if(C.rerender)C.rerender();}
  function current(){return C.campaigns.find(function(x){return x.mission_id===C.sel;})||null;}
  function cents(id){var v=(document.getElementById(id)||{}).value;if(v===""||v==null)return null;var x=Math.round(Number(v)*100);return isFinite(x)?x:null;}
  function int(id){var v=(document.getElementById(id)||{}).value;if(v===""||v==null)return null;var x=parseInt(v,10);return isFinite(x)?x:null;}
  function val(id){return((document.getElementById(id)||{}).value||"").trim();}
  function cpm(viewCents,views){return views>0?usd(Math.round(viewCents*1000/views)):"—";}

  function load(){
    if(C.loading)return Promise.resolve();
    if(!org()){C.error=new Error("Pick a workspace first.");C.loaded=true;redraw();return Promise.resolve();}
    C.loading=true;C.error=null;C.loadedOrg=org();redraw();
    return rpc("clip_campaigns_for_org",{p_org:org()}).then(function(rows){
      C.campaigns=rows||[];
      if(!C.sel||!current())C.sel=C.campaigns.length?C.campaigns[0].mission_id:null;
      return C.sel?loadDash(C.sel):null;
    }).catch(function(err){C.error=err;}).then(function(){C.loading=false;C.loaded=true;redraw();});
  }
  function loadDash(id){
    return rpc("clip_campaign_dashboard",{p_mission:id}).then(function(d){C.dash[id]=d;delete C.dashErr[id];})
      .catch(function(err){C.dashErr[id]=err.message||String(err);});
  }
  function loadForm(){
    if(C.songs&&C.files&&C.sources)return Promise.resolve();
    return Promise.allSettled([
      C.supa("music_catalog_objects?status=eq.active&select=id,catalog_key,track_title,album_title,artist_name&order=album_title.asc,track_title.asc"),
      C.supa("network_media_assets?status=eq.ready&post_id=is.null&select=id,media_type,mime_type,object_path,created_at&order=created_at.desc&limit=50"),\n      C.supa("social_content_items?org_id=eq."+encodeURIComponent(org())+"&status=in.(ready,published)&select=id,title,master_caption,status,action_mission_id,created_at&order=created_at.desc&limit=50")
    ]).then(function(out){
      C.songs=out[0].status==="fulfilled"?out[0].value||[]:[];
      C.files=out[1].status==="fulfilled"?out[1].value||[]:[];\n      C.sources=out[2].status==="fulfilled"?out[2].value||[]:[];
      redraw();
    });
  }
  function run(btn,fn,ok){
    if(C.busy)return;C.busy=true;C.msg="";C.bad=false;if(btn)btn.disabled=true;redraw();
    Promise.resolve().then(fn).then(function(){C.msg=ok||"Done.";return load();})
      .catch(function(err){C.msg=(err&&err.message)||String(err);C.bad=true;})
      .then(function(){C.busy=false;redraw();});
  }

  /* ---------- launch ---------- */
  function launchForm(){
    if(!C.songs)loadForm();
    var songs=(C.songs||[]).map(function(s){return'<option value="'+e(s.id)+'">'+e(s.album_title+" · "+s.track_title)+'</option>';}).join("");
    var sources=(C.sources||[]).map(function(s){return'<option value="'+e(s.id)+'">'+e((s.title||"Untitled Action Network post")+" · "+s.status)+'</option>';}).join("");
    var files=(C.files||[]).map(function(f){var name=String(f.object_path||"").split("/").pop();
      return'<label class="cro-check"><input type="checkbox" data-clip-file="'+e(f.id)+'" data-kind="'+e(f.media_type)+'"> '+e(f.media_type)+' · '+e(name)+'</label>';}).join("");
    var action=C.sourceType==="action";
    return'<div class="cro-create-workspace">'+
      '<section class="cro-card"><p class="cro-meta">EQUITY UPRISE · DISTRIBUTION</p><h2>What are we putting into motion?</h2>'+
      '<p class="cro-meta">Start with the content. Then tell the network how to distribute it and what verified performance is worth.</p>'+
      '<div class="cro-chips"><button class="cro-chip'+(!action?" is-on":"")+'" type="button" data-clip-source="music">Music</button>'+
      '<button class="cro-chip'+(action?" is-on":"")+'" type="button" data-clip-source="action">Action content</button></div></section>'+
      '<section class="cro-card"><h3>1 · Source</h3><div class="cro-form">'+
      '<label>Campaign title<input id="clTitle" maxlength="160" required placeholder="'+(action?"Amplify this action":"Clip this release")+'"></label>'+
      (action?'<label>Action Network source<select id="clSource"><option value="">Choose approved content…</option>'+sources+'</select></label>'+
        '<label class="cro-span-2">Send traffic here<input id="clDestination" type="url" placeholder="https://mccluster.org/action/…"></label>':
        '<label>Song<select id="clSong"><option value="">Choose a song…</option>'+songs+'</select></label>')+
      '</div></section>'+
      '<section class="cro-card"><h3>2 · Distribution brief</h3><div class="cro-form">'+
      '<label class="cro-span-2">What should clippers make?<textarea id="clRules" rows="3" maxlength="4000" placeholder="'+(action?"Show what happened, preserve context, and drive people to the action.":"Use the strongest moment, make it native to Reels, and drive people back to the release.")+'"></textarea></label>'+
      '<label>Required caption tags<input id="clTags" placeholder="#EquityUprise"></label>'+
      '<label>Credit these accounts<input id="clAttribution" placeholder="@mcclusterishere, @equityuprise"></label>'+
      '<label>Invite as collaborators<input id="clCollaborators" placeholder="@mcclusterishere, @equityuprise"></label>'+
      '<label>Collab rule<select id="clCollabMode"><option value="request">Ask for the collab</option><option value="required_review">Required — confirm in review</option><option value="none">No collab requirement</option></select></label>'+
      '<fieldset class="cro-span-2"><legend>Where</legend><label class="cro-check"><input type="checkbox" id="clIg" checked> Instagram Reels · verified</label>'+
      '<label class="cro-check"><input type="checkbox" disabled> TikTok · integration not live</label><label class="cro-check"><input type="checkbox" disabled> YouTube Shorts · integration not live</label></fieldset>'+
      '</div></section>'+
      '<section class="cro-card"><h3>3 · Pay for verified performance</h3><div class="cro-form">'+
      '<label>Campaign budget<input id="clBudget" type="number" min="10" step="1" value="100"></label>'+
      '<label>CPM · per 1,000 verified views<input id="clCpm" type="number" min="0.01" step="0.01" value="3"></label>'+
      '<label>Start earning at<input id="clMin" type="number" min="0" step="100" value="1000"></label>'+
      '<label>Max per clip<input id="clClipCap" type="number" min="1" step="1" placeholder="No cap"></label>'+
      '<label>Max per clipper<input id="clClipperCap" type="number" min="1" step="1" placeholder="No cap"></label>'+
      '<label>Max paid views per clip<input id="clMaxViews" type="number" min="1" step="1000" placeholder="No cap"></label>'+
      '<label>Clips per clipper<input id="clMaxClips" type="number" min="1" max="100" value="10"></label>'+
      '<label>Approval<select id="clApproval"><option value="creator">Review before payout</option><option value="auto">Auto-release verified clips</option></select></label>'+
      (!action?'<label>Bonus · new verified fan<input id="clBonusAcct" type="number" min="0" step="0.25" value="0"></label><label>Bonus · full listen<input id="clBonusListen" type="number" min="0" step="0.05" value="0"></label>':'<input id="clBonusAcct" type="hidden" value="0"><input id="clBonusListen" type="hidden" value="0">')+
      '<label>Starts<input id="clStarts" type="date"></label><label>Last day to post<input id="clEnds" type="date"></label>'+
      '<label>Earns for days<input id="clWindow" type="number" min="1" max="365" value="30"></label>'+
      '<label>Must stay live days<input id="clKeep" type="number" min="0" max="365" value="14"></label>'+
      '<label>Hold days<input id="clHold" type="number" min="0" max="90" value="7"></label>'+
      '</div></section>'+
      '<section class="cro-card"><h3>4 · Approved source assets</h3><p class="cro-meta">Give clippers material they are actually allowed to redistribute.</p>'+
      '<div class="cro-form"><fieldset class="cro-span-2">'+(files||'<p class="cro-meta">No ready uploads yet.</p>')+'</fieldset>'+
      (!action?'<label>Moment label<input id="clMoment" maxlength="120" placeholder="The hook"></label><label>Starts · seconds<input id="clMomentStart" type="number" min="0"></label><label>Ends · seconds<input id="clMomentEnd" type="number" min="1"></label>':'')+
      '</div></section>'+
      '<section class="cro-card"><h3>5 · Review</h3><p><b>'+e(action?"Equity Uprise action distribution":"Equity Uprise × creator music distribution")+'</b></p>'+
      '<p class="cro-meta">Draft first. Funding is recorded separately before launch. Views only count from the platform API; collab acceptance is human-reviewed until Instagram exposes proof.</p>'+
      '<button class="cr-btn cr-btn--primary" type="button" data-clip-create>Create campaign draft</button></section></div>';
  }
  function listVal(id){return val(id).split(",").map(function(t){return t.trim();}).filter(Boolean);}
  function createPayload(){
    var assets=Array.prototype.map.call(document.querySelectorAll("[data-clip-file]:checked"),function(x){
      var k=x.getAttribute("data-kind");return{kind:k==="audio"||k==="video"||k==="image"?k:"video",label:"Source "+k,asset_id:x.getAttribute("data-clip-file")};});
    var ms=int("clMomentStart"),me=int("clMomentEnd");
    if(val("clMoment")&&ms!=null&&me!=null&&me>ms)assets.push({kind:"moment",label:val("clMoment"),start_ms:ms*1000,end_ms:me*1000});
    return{org_id:org(),title:val("clTitle"),music_object_id:val("clSong")||null,source_content_id:val("clSource")||null,
      source_kind:C.sourceType==="action"?"action":"music",destination_url:val("clDestination")||null,rules:val("clRules"),
      required_tags:listVal("clTags"),attribution_handles:listVal("clAttribution"),collaborator_handles:listVal("clCollaborators"),
      collaboration_mode:val("clCollabMode")||"none",operator_brand:"Equity Uprise",
      platforms:document.getElementById("clIg")&&document.getElementById("clIg").checked?["instagram"]:[],
      budget_cents:cents("clBudget"),base_cpm_cents:cents("clCpm"),min_views:int("clMin"),
      per_clip_cap_cents:cents("clClipCap"),per_clipper_cap_cents:cents("clClipperCap"),max_payable_views_per_clip:int("clMaxViews"),
      max_clips_per_clipper:int("clMaxClips"),starts_at:val("clStarts")?new Date(val("clStarts")+"T00:00:00").toISOString():null,
      ends_at:val("clEnds")?new Date(val("clEnds")+"T23:59:59").toISOString():null,earning_window_days:int("clWindow"),
      keep_live_days:int("clKeep"),hold_days:int("clHold"),bonus_account_cents:cents("clBonusAcct")||0,
      bonus_listen_cents:cents("clBonusListen")||0,approval_mode:val("clApproval")||"creator",assets:assets};
  }

