/* Native Control · Create · Clipping.

   A creator's paid clipping campaigns, run on the Action Network. Everything
   here reads or calls the database's clip_* functions with the operator's
   own session, and each function checks that the caller owns the
   campaign's organization. Nothing on this page computes money: spend,
   committed budget, verified and payable views, conversions and payouts are
   what clip_campaign_dashboard() reports, and they move only when the
   Worker records a platform read (supabase/pending/action_clipping_marketplace_v1.sql).

   Only Instagram can be verified server-side today, so the launch form
   offers YouTube and TikTok as unavailable rather than pretending. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var C={supa:null,rerender:null,org:null,loading:false,loaded:false,error:null,campaigns:[],sel:null,tab:"overview",
    dash:{},dashErr:{},msg:"",bad:false,busy:false,songs:null,files:null};
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
    if(C.songs&&C.files)return Promise.resolve();
    return Promise.allSettled([
      C.supa("music_catalog_objects?status=eq.active&select=id,catalog_key,track_title,album_title,artist_name&order=album_title.asc,track_title.asc"),
      C.supa("network_media_assets?status=eq.ready&post_id=is.null&select=id,media_type,mime_type,object_path,created_at&order=created_at.desc&limit=50")
    ]).then(function(out){
      C.songs=out[0].status==="fulfilled"?out[0].value||[]:[];
      C.files=out[1].status==="fulfilled"?out[1].value||[]:[];
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
    var files=(C.files||[]).map(function(f){var name=String(f.object_path||"").split("/").pop();
      return'<label class="cro-check"><input type="checkbox" data-clip-file="'+e(f.id)+'" data-kind="'+e(f.media_type)+'"> '+e(f.media_type)+' · '+e(name)+'</label>';}).join("");
    return'<section class="cro-card"><h2>Launch a clipping campaign</h2>'+
      '<p class="cro-meta">Clippers claim it on the Action Network, post Reels with your song, and are paid on views Instagram reports to the server, never on screenshots. Earnings hold until your hold and keep-live periods pass and you approve each clip.</p>'+
      '<div class="cro-form">'+
      '<label>Title<input id="clTitle" maxlength="160" required placeholder="Clip the hook of …"></label>'+
      '<label>Song<select id="clSong"><option value="">Choose a song…</option>'+songs+'</select></label>'+
      '<label class="cro-span-2">What clippers should make<textarea id="clRules" rows="3" maxlength="4000" placeholder="Use the hook, show the lyric on screen, no reposts of the official video…"></textarea></label>'+
      '<label>Required tags (comma separated)<input id="clTags" placeholder="#pullup, @mattmccluster"></label>'+
      '<fieldset class="cro-span-2"><legend>Platforms</legend>'+
        '<label class="cro-check"><input type="checkbox" id="clIg" checked> Instagram Reels</label>'+
        '<label class="cro-check"><input type="checkbox" disabled> YouTube Shorts — cannot be verified yet</label>'+
        '<label class="cro-check"><input type="checkbox" disabled> TikTok — cannot be verified yet</label></fieldset>'+
      '<label>Budget (USD)<input id="clBudget" type="number" min="10" step="1" inputmode="decimal" value="100"></label>'+
      '<label>Pay per 1,000 verified views (USD)<input id="clCpm" type="number" min="0.01" step="0.01" inputmode="decimal" value="3"></label>'+
      '<label>Minimum views before a clip earns<input id="clMin" type="number" min="0" step="100" inputmode="numeric" value="1000"></label>'+
      '<label>Most a clip can earn (USD)<input id="clClipCap" type="number" min="1" step="1" inputmode="decimal" placeholder="no cap"></label>'+
      '<label>Most a clipper can earn (USD)<input id="clClipperCap" type="number" min="1" step="1" inputmode="decimal" placeholder="no cap"></label>'+
      '<label>Most views paid per clip<input id="clMaxViews" type="number" min="1" step="1000" inputmode="numeric" placeholder="no cap"></label>'+
      '<label>Clips per clipper<input id="clMaxClips" type="number" min="1" max="100" value="10" inputmode="numeric"></label>'+
      '<label>Starts<input id="clStarts" type="date"></label><label>Last day to post<input id="clEnds" type="date"></label>'+
      '<label>Days a clip earns<input id="clWindow" type="number" min="1" max="365" value="30" inputmode="numeric"></label>'+
      '<label>Days a clip must stay up<input id="clKeep" type="number" min="0" max="365" value="14" inputmode="numeric"></label>'+
      '<label>Hold before payable (days)<input id="clHold" type="number" min="0" max="90" value="7" inputmode="numeric"></label>'+
      '<label>Bonus per new verified fan account (USD)<input id="clBonusAcct" type="number" min="0" max="100" step="0.25" inputmode="decimal" value="0"></label>'+
      '<label>Bonus per verified full listen (USD)<input id="clBonusListen" type="number" min="0" max="100" step="0.05" inputmode="decimal" value="0"></label>'+
      '<label>Approval<select id="clApproval"><option value="creator">I approve every clip before it pays</option><option value="auto">Pay verified clips without my review</option></select></label>'+
      '<label>Song moment (optional)<input id="clMoment" maxlength="120" placeholder="The hook"></label>'+
      '<label>Moment starts (seconds)<input id="clMomentStart" type="number" min="0" step="1" inputmode="numeric"></label>'+
      '<label>Moment ends (seconds)<input id="clMomentEnd" type="number" min="1" step="1" inputmode="numeric"></label>'+
      '<fieldset class="cro-span-2"><legend>Source files clippers may use (your uploads)</legend>'+(files||'<p class="cro-meta">No ready uploads. Upload stems or video in the Action Network composer first.</p>')+'</fieldset>'+
      '</div><div class="cro-row__top"><button class="cr-btn" type="button" data-clip-create>Create draft</button></div>'+
      '<p class="cro-meta">A draft can be edited freely. Once live, its rate and rules for earning are fixed; the budget, caps and end date can only grow.</p></section>';
  }
  function createPayload(){
    var tags=val("clTags").split(",").map(function(t){return t.trim();}).filter(Boolean);
    var assets=Array.prototype.map.call(document.querySelectorAll("[data-clip-file]:checked"),function(x){
      var k=x.getAttribute("data-kind");return{kind:k==="audio"||k==="video"||k==="image"?k:"video",label:"Source "+k,asset_id:x.getAttribute("data-clip-file")};});
    var ms=int("clMomentStart"),me=int("clMomentEnd");
    if(val("clMoment")&&ms!=null&&me!=null&&me>ms)assets.push({kind:"moment",label:val("clMoment"),start_ms:ms*1000,end_ms:me*1000});
    return{org_id:org(),title:val("clTitle"),music_object_id:val("clSong")||null,rules:val("clRules"),required_tags:tags,
      platforms:document.getElementById("clIg")&&document.getElementById("clIg").checked?["instagram"]:[],
      budget_cents:cents("clBudget"),base_cpm_cents:cents("clCpm"),min_views:int("clMin"),
      per_clip_cap_cents:cents("clClipCap"),per_clipper_cap_cents:cents("clClipperCap"),max_payable_views_per_clip:int("clMaxViews"),
      max_clips_per_clipper:int("clMaxClips"),starts_at:val("clStarts")?new Date(val("clStarts")+"T00:00:00").toISOString():null,
      ends_at:val("clEnds")?new Date(val("clEnds")+"T23:59:59").toISOString():null,earning_window_days:int("clWindow"),
      keep_live_days:int("clKeep"),hold_days:int("clHold"),bonus_account_cents:cents("clBonusAcct")||0,
      bonus_listen_cents:cents("clBonusListen")||0,approval_mode:val("clApproval")||"creator",assets:assets};
  }

  /* ---------- dashboard ---------- */
  function kpis(list){return'<div class="cro-kpis">'+list.map(function(k){return'<div><small>'+e(k[0])+'</small><b>'+e(k[1])+'</b></div>';}).join("")+'</div>';}
  function table(head,rows,empty){
    return rows.length?'<div class="cro-tablewrap"><table class="cro-table"><thead><tr>'+head.map(function(h){return'<th'+(h[1]?' class="n"':"")+'>'+e(h[0])+'</th>';}).join("")+'</tr></thead><tbody>'+rows.join("")+'</tbody></table></div>':note(empty);
  }
  function overview(c,d){
    var m=d.money||{},t=d.totals||{},camp=d.campaign||{};
    var viewCents=Number(t.view_earnings_cents||0),payable=Number(t.payable_views||0),verified=Number(t.verified_views||0);
    var head=kpis([["Budget",usd(m.budget_cents)],["Funded",usd(m.funded_cents)],["Committed",usd(m.committed_cents)],["Available",usd(m.available_cents)],
      ["Held",usd(m.held_cents)],["Payable",usd(m.payable_cents)],["Paid",usd(m.paid_cents)]]);
    var reach=kpis([["Clips",n(t.clips)],["Clippers",n(t.clippers)],["Verified views",n(verified)],["Payable views",n(payable)],
      ["Effective CPM",cpm(viewCents,payable)],["All-in per 1k verified views",cpm(Number(m.committed_cents||0),verified)]]);
    var funnel=kpis([["Site visits",n(t.visits)],["Song plays",n(t.plays)],["Sign-ups",n(t.signups)],["Verified fan accounts",n(t.verified_accounts)],
      ["Verified full listens",n(t.verified_listens)],["Downstream actions",n(t.actions)],["Bonuses",usd(t.bonus_cents)]]);
    var status=e(camp.status||c.status)+(camp.status_reason?" · "+e(camp.status_reason):"");
    var controls='<div class="cro-row__top">'+
      (camp.status==="draft"||camp.status==="paused"?'<button class="cr-btn" type="button" data-clip-status="live">Go live</button>':"")+
      (camp.status==="live"?'<button class="cr-btn cr-btn--ghost" type="button" data-clip-status="paused">Pause</button>':"")+
      (camp.status!=="ended"?'<button class="cr-btn cr-btn--ghost" type="button" data-clip-status="ended">End campaign</button>':"")+'</div>';
    var fund='<div class="cro-form"><label>Add funding (USD)<input id="clFundAmt" type="number" min="1" step="1" inputmode="decimal"></label>'+
      '<label>Source<select id="clFundProvider"><option value="internal">Allocated from my budget</option><option value="manual">Payment I made (recorded by me)</option><option value="stripe" disabled>Card payment (not connected yet)</option></select></label>'+
      '<label>Payment reference<input id="clFundRef" maxlength="200" placeholder="Transfer or receipt reference"></label>'+
      '<div><button class="cr-btn" type="button" data-clip-fund>Record funding</button></div></div>'+
      '<p class="cro-meta">Funding is what clips can earn against; nothing accrues past it or past the budget. Card funding is not connected yet, so record an allocation, or a payment you made with its reference; both are recorded as yours, not as provider-verified.</p>';
    return'<section class="cro-card"><div class="cro-row__top"><h2>'+e(camp.title||c.title)+'</h2><span class="cr-state">'+status+'</span></div>'+
      (camp.song?'<p class="cro-meta">Song: '+e(camp.song.title)+' · pays '+usd(camp.base_cpm_cents)+' per 1,000 verified views after '+n(camp.min_views)+' views'+
        (camp.per_clip_cap_cents?' · up to '+usd(camp.per_clip_cap_cents)+' a clip':'')+(camp.per_clipper_cap_cents?' · up to '+usd(camp.per_clipper_cap_cents)+' a clipper':'')+'</p>':"")+
      controls+'<h3>Money</h3>'+head+fund+'<h3>Reach</h3>'+reach+'<h3>Funnel</h3>'+funnel+
      '<p class="cro-meta">Visits, plays and sign-ups come from this site\'s own events for each clip\'s tracking code. Verified accounts and listens are the ones that passed the server\'s checks and can earn bonuses.</p></section>';
  }
  function clips(d){
    var rows=(d.clips||[]).map(function(s){
      var flags=(s.fraud_flags||[]).length?'<div class="cro-meta">flags: '+e(s.fraud_flags.join(", "))+'</div>':"";
      var why=s.rejection_reason||s.hold_reason||s.waiting_reason;
      var act=s.status==="rejected"||s.status==="removed"?"":
        (s.review_state==="pending"&&s.status!=="submitted"?'<button class="cr-btn" type="button" data-clip-review="approve" data-id="'+e(s.submission_id)+'">Approve</button>':"")+
        (s.status==="held"?'<button class="cr-btn cr-btn--ghost" type="button" data-clip-review="release" data-id="'+e(s.submission_id)+'">Clear hold</button>':
          (s.status!=="submitted"?'<button class="cr-btn cr-btn--ghost" type="button" data-clip-review="hold" data-id="'+e(s.submission_id)+'">Hold</button>':""))+
        '<button class="cr-btn cr-btn--ghost" type="button" data-clip-review="reject" data-id="'+e(s.submission_id)+'">Reject</button>';
      return'<tr><td><a href="'+e(s.url)+'" target="_blank" rel="noopener noreferrer">'+e(s.platform)+' clip</a>'+(s.moment?'<div class="cro-meta">'+e(s.moment)+'</div>':"")+flags+(why?'<div class="cro-meta">'+e(why)+'</div>':"")+'</td>'+
        '<td>'+e(s.status)+'<div class="cro-meta">review: '+e(s.review_state)+'</div></td><td class="n">'+n(s.verified_views)+'</td><td class="n">'+n(s.payable_views)+'</td>'+
        '<td class="n">'+usd(s.earned_view_cents)+'</td><td class="n">'+n(s.visits)+' / '+n(s.plays)+' / '+n(s.signups)+'</td><td>'+act+'</td></tr>';
    });
    return'<section class="cro-card"><h2>Clips</h2>'+table([["Clip"],["State"],["Verified views",1],["Payable views",1],["Earned",1],["Visits / plays / sign-ups",1],[""]],rows,"No clips yet.")+
      '<p class="cro-meta">Held clips have a fraud signal or your hold on them; their earnings cannot become payable until you clear or reject them. Rejecting voids what a clip had accrued.</p></section>';
  }
  function clippers(d,c){
    var byReach=(d.clippers||[]).slice();
    var byQuality=byReach.slice().sort(function(a,b){return Number(b.quality||0)-Number(a.quality||0);});
    var qRank={};byQuality.forEach(function(x,i){qRank[x.claim_id]=i+1;});
    var rows=byReach.map(function(x,i){
      var pay=Number(x.payable_cents||0)>0?'<button class="cr-btn" type="button" data-clip-payout="'+e(x.m_uid)+'" data-amount="'+e(x.payable_cents)+'">Record payout</button>':"";
      return'<tr><td>'+e(x.name)+'<div class="cro-meta">'+e(x.status)+' · '+n(x.clips)+' clips</div></td><td class="n">#'+(i+1)+' · '+n(x.verified_views)+'</td>'+
        '<td class="n">#'+qRank[x.claim_id]+' · '+(Number(x.quality||0)*100).toFixed(1)+'%</td><td class="n">'+n(x.visits)+' / '+n(x.plays)+' / '+n(x.verified_accounts)+'</td>'+
        '<td class="n">'+usd(x.earned_cents)+'</td><td class="n">'+usd(x.payable_cents)+'</td><td class="n">'+usd(x.paid_cents)+'</td><td>'+pay+'</td></tr>';
    });
    return'<section class="cro-card"><h2>Clippers</h2>'+table([["Clipper"],["Reach rank · verified views",1],["Quality rank · score",1],["Visits / plays / accounts",1],["Earned",1],["Payable",1],["Paid",1],[""]],rows,"Nobody has claimed this campaign yet.")+
      '<p class="cro-meta">Quality is the 95% lower bound of visitors who played the song or made an account, so a few lucky visits do not outrank steady conversion. A payout pays everything payable to that clipper in this workspace, once per payment reference.</p></section>';
  }
  function moneyTables(d){
    var moments=(d.moments||[]).map(function(x){return'<tr><td>'+e(x.label)+'</td><td class="n">'+(x.start_ms!=null?Math.round(x.start_ms/1000)+"–"+Math.round(x.end_ms/1000)+"s":"—")+'</td><td class="n">'+n(x.clips)+'</td><td class="n">'+n(x.verified_views)+'</td></tr>';});
    var funding=(d.funding||[]).map(function(f){return'<tr><td>'+e(new Date(f.at).toLocaleDateString())+'</td><td>'+e(f.kind)+' · '+e(f.provider)+(f.provider_ref?' · '+e(f.provider_ref):"")+'</td><td class="n">'+usd(f.delta_cents)+'</td></tr>';});
    var payouts=(d.payouts||[]).map(function(p){return'<tr><td>'+e(new Date(p.recorded_at).toLocaleDateString())+'</td><td>'+e(p.provider)+' · '+e(p.provider_ref)+'</td><td class="n">'+usd(p.amount_cents)+'</td></tr>';});
    return'<section class="cro-card"><h2>Song moments</h2>'+table([["Moment"],["Range",1],["Clips",1],["Verified views",1]],moments,"No moments set.")+'</section>'+
      '<section class="cro-card"><h2>Funding</h2>'+table([["Date"],["Kind"],["Amount",1]],funding,"No funding recorded.")+'</section>'+
      '<section class="cro-card"><h2>Payouts</h2>'+table([["Date"],["Reference"],["Amount",1]],payouts,"No payouts yet.")+
      '<p class="cro-meta">Payouts are recorded with the reference of a payment you made. Paying clippers through Stripe Connect is not wired yet.</p></section>';
  }

  function render(){
    /* a different workspace is a different creator's campaigns */
    if(C.loaded&&!C.loading&&C.loadedOrg!==org()){C.loaded=false;C.campaigns=[];C.dash={};C.dashErr={};C.sel=null;C.files=null;}
    if(!C.loaded&&!C.loading)load();
    var chips='<div class="cro-chips">'+C.campaigns.map(function(x){return'<button class="cro-chip'+(x.mission_id===C.sel&&C.tab!=="new"?" is-on":"")+'" type="button" data-clip-pick="'+e(x.mission_id)+'">'+e(x.title)+' · '+e(x.status)+(x.pending_review?" · "+x.pending_review+" to review":"")+'</button>';}).join("")+
      '<button class="cro-chip'+(C.tab==="new"?" is-on":"")+'" type="button" data-clip-tab="new">+ New campaign</button></div>';
    var head=(C.loading&&!C.loaded?note("Loading campaigns…"):"")+
      (C.error?note(MISSING.test(C.error.message||"")?"Clipping is not provisioned in this database yet: the clipping migration is waiting to be applied (supabase/pending/).":"Campaigns could not be read: "+(C.error.message||C.error),true):"")+
      (C.msg?note(C.msg,C.bad):"");
    if(C.tab==="new"||(!C.campaigns.length&&C.loaded&&!C.error))return'<div class="cro">'+chips+head+launchForm()+'</div>';
    var c=current();if(!c)return'<div class="cro">'+chips+head+'</div>';
    var d=C.dash[c.mission_id];
    if(!d)return'<div class="cro">'+chips+head+(C.dashErr[c.mission_id]?note(C.dashErr[c.mission_id],true):note("Loading the campaign…"))+'</div>';
    var tabs='<div class="cro-tabs">'+[["overview","Overview"],["clips","Clips"],["clippers","Clippers"],["money","Moments, funding & payouts"]].map(function(t){return'<button class="cro-tab'+(C.tab===t[0]?" is-on":"")+'" type="button" data-clip-tab="'+t[0]+'">'+t[1]+'</button>';}).join("")+'</div>';
    var body=C.tab==="clips"?clips(d):C.tab==="clippers"?clippers(d,c):C.tab==="money"?moneyTables(d):overview(c,d);
    return'<div class="cro">'+chips+head+tabs+body+'</div>';
  }

  function bind(root){
    if(!root)return;
    root.querySelectorAll("[data-clip-pick]").forEach(function(b){b.onclick=function(){C.sel=b.getAttribute("data-clip-pick");if(C.tab==="new")C.tab="overview";C.msg="";if(!C.dash[C.sel])loadDash(C.sel).then(redraw);redraw();};});
    root.querySelectorAll("[data-clip-tab]").forEach(function(b){b.onclick=function(){C.tab=b.getAttribute("data-clip-tab");C.msg="";if(C.tab==="new")loadForm();redraw();};});
    var create=root.querySelector("[data-clip-create]");
    if(create)create.onclick=function(){var p=createPayload();
      if(!p.title||!p.music_object_id){C.msg="A campaign needs a title and a song.";C.bad=true;redraw();return;}
      run(create,function(){return rpc("clip_campaign_create",{p:p}).then(function(r){C.sel=r&&r.mission_id;C.tab="overview";});},"Draft created. Add funding, then go live.");};
    root.querySelectorAll("[data-clip-status]").forEach(function(b){b.onclick=function(){var s=b.getAttribute("data-clip-status");
      if(s==="ended"&&!confirm("End this campaign? Clippers stop submitting; clips already tracked keep settling."))return;
      run(b,function(){return rpc("clip_campaign_set_status",{p_mission:C.sel,p_status:s});},s==="live"?"Live on the Action Network.":"Campaign "+s+".");};});
    var fund=root.querySelector("[data-clip-fund]");
    if(fund)fund.onclick=function(){var amt=cents("clFundAmt"),prov=val("clFundProvider")||"internal";
      if(!amt||amt<=0){C.msg="Enter an amount.";C.bad=true;redraw();return;}
      run(fund,function(){return rpc("clip_campaign_fund",{p_mission:C.sel,p_amount_cents:amt,p_kind:prov==="internal"?"program_allocation":"contribution",p_provider:prov,p_provider_ref:val("clFundRef")||null,p_note:""});},"Funding recorded.");};
    root.querySelectorAll("[data-clip-review]").forEach(function(b){b.onclick=function(){var dec=b.getAttribute("data-clip-review");
      var why=dec==="reject"||dec==="hold"?prompt(dec==="reject"?"Why is this clip rejected? The clipper sees this.":"Why hold it?",""):null;
      if((dec==="reject"||dec==="hold")&&why===null)return;
      run(b,function(){return rpc("clip_review_submission",{p_submission:b.getAttribute("data-id"),p_decision:dec,p_note:why||null});},"Clip "+{approve:"approved",reject:"rejected",hold:"held",release:"cleared"}[dec]+".");};});
    root.querySelectorAll("[data-clip-payout]").forEach(function(b){b.onclick=function(){
      var ref=prompt("Payment reference for "+usd(b.getAttribute("data-amount"))+" (e.g. the transfer or Zelle confirmation):","");
      if(!ref)return;
      run(b,function(){return rpc("clip_record_payout",{p_org:org(),p_m_uid:b.getAttribute("data-clip-payout"),p_provider:"manual",p_provider_ref:ref,p_note:null});},"Payout recorded.");};});
  }

  window.CR.clipping={init:function(opts){C.supa=opts.supa;C.rerender=opts.render;C.org=opts.org;},render:render,bind:bind,load:load,state:C};
})();
