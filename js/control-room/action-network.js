/* Native Control · Create · Action Network.

   The owner's side of the Uprise Action Network (/action/?c=<slug>).
   A campaign is a row in public.action_campaigns, so the next one is
   launched here, not in a deploy: write it as a draft, check it, then
   set it live. Row-level security lets only the owner write.

   What this view shows is read, never guessed: the funnel is
   action_funnel(campaign) (page views and visitors from the site's own
   events, joins/acted/referred from participants, per Reel and source),
   and the counts are rows.

   MONEY. A campaign's money stays off until the owner turns it on, and
   the switch asks first, because turning it on puts a Give lane and a
   dollar meter on a public page. Ledger entries are private until
   published; the public page shows only published ones. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var A={supa:null,rerender:null,loading:false,loaded:false,error:null,
    campaigns:[],sel:null,tab:"overview",detail:{},busy:false,msg:"",proofs:[],proofBusy:false};
  var STATUSES=["draft","live","paused","closed"];
  var LEDGER_KINDS=["received","committed","disbursed","expense"];
  var HAVE={give:"$5",time:"Time",skills:"Skills",reach:"Reach",resources:"Resources",learn:"Wants to learn"};
  var SKILLS={research:"Research",engineering:"Engineering / Technology",media:"Media",organizing:"Organizing",education:"Education",design:"Design",legal_policy:"Legal / Policy",fundraising:"Fundraising",field:"Field work",unsure:"Doesn't know yet"};
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function n(v){return Number(v||0).toLocaleString("en-US");}
  function usd(c){return"$"+(Number(c||0)/100).toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:2});}
  function note(t,bad){return'<div class="cro-note'+(bad?" cro-note--bad":"")+'">'+e(t)+'</div>';}
  function pct(a,b){return b?Math.round(a/b*1000)/10+"%":"—";}
  function current(){return A.campaigns.find(function(c){return c.id===A.sel;})||null;}
  function redraw(){if(A.rerender)A.rerender();}

  function load(){
    if(A.loading)return Promise.resolve();
    A.loading=true;A.error=null;redraw();
    return A.supa("action_campaigns?select=*&order=sort.asc,created_at.asc").then(function(rows){
      A.campaigns=rows||[];
      if(!A.sel||!current())A.sel=A.campaigns.length?A.campaigns[0].id:null;
      return A.sel?loadDetail(A.sel):null;
    }).catch(function(err){A.error=err;}).then(function(){A.loading=false;A.loaded=true;redraw();});
  }
  function loadDetail(id){
    var q=encodeURIComponent(id);
    return Promise.allSettled([
      A.supa("rpc/action_funnel",{method:"POST",body:{p_campaign:id}}),
      A.supa("action_participants?campaign_id=eq."+q+"&select=participant_no,joined_at,origin,contributions,skills,referral_code,referred_by&order=participant_no.desc&limit=1000"),
      A.supa("action_events?campaign_id=eq."+q+"&select=kind,at&order=at.desc&limit=5000"),
      A.supa("action_ledger?campaign_id=eq."+q+"&select=*&order=occurred_on.desc,created_at.desc")
    ]).then(function(out){
      var d={funnel:[],people:[],events:[],ledger:[],errors:[]};
      ["funnel","people","events","ledger"].forEach(function(k,i){
        if(out[i].status==="fulfilled")d[k]=out[i].value||[];else d.errors.push(k+": "+((out[i].reason&&out[i].reason.message)||"failed"));
      });
      A.detail[id]=d;
    });
  }

  /* ---------- views ---------- */
  function tally(list,key){var t={};list.forEach(function(r){(r[key]||[]).forEach(function(k){t[k]=(t[k]||0)+1;});});return t;}
  function bars(t,labels,total){
    var keys=Object.keys(t).sort(function(a,b){return t[b]-t[a];});
    if(!keys.length)return note("Nobody yet.");
    return'<div class="cro-list">'+keys.map(function(k){return'<div class="cro-heat"><span>'+e(labels[k]||k)+'</span><span class="cro-heat__bar"><i style="--pct:'+(total?Math.round(t[k]/total*100):0)+'%"></i></span><b>'+n(t[k])+'</b></div>';}).join("")+'</div>';
  }
  function overview(c,d){
    var people=d.people.length,recruited=0;
    d.people.forEach(function(p){if(p.referred_by)recruited++;});
    var kinds={};d.events.forEach(function(ev){kinds[ev.kind]=(kinds[ev.kind]||0)+1;});
    var views=d.funnel.reduce(function(s,r){return s+Number(r.visitors||0);},0);
    var stats='<div class="cro-statgrid"><div class="cro-stat"><b>'+n(people)+'</b><span>participants'+(c.people_goal?" of "+n(c.people_goal):"")+'</span></div>'+
      '<div class="cro-stat"><b>'+n(views)+'</b><span>visitors (acknowledged)</span></div>'+
      '<div class="cro-stat"><b>'+n(d.events.length)+'</b><span>actions</span></div>'+
      '<div class="cro-stat"><b>'+n(recruited)+'</b><span>joined by referral</span></div></div>';
    var funnel=d.funnel.length?'<div class="cro-tablewrap"><table class="cro-table"><thead><tr><th>Reel</th><th>Source</th><th class="n">Views</th><th class="n">Visitors</th><th class="n">Joins</th><th class="n">Join rate</th><th class="n">Acted</th><th class="n">Referred</th></tr></thead><tbody>'+
      d.funnel.map(function(r){return'<tr><td>'+e(r.reel)+'</td><td>'+e(r.src)+'</td><td class="n">'+n(r.views)+'</td><td class="n">'+n(r.visitors)+'</td><td class="n">'+n(r.joins)+'</td><td class="n">'+pct(Number(r.joins),Number(r.visitors))+'</td><td class="n">'+n(r.acted)+'</td><td class="n">'+n(r.referred)+'</td></tr>';}).join("")+
      '</tbody></table></div><p class="cro-meta">Views and visitors come from the site\'s own events and only count people who accepted the privacy notice; joins come from participants. Tag each Reel\'s link: /action/?c='+e(c.slug)+'&amp;src=ig&amp;reel=0047.</p>':note("No visits or joins yet. Tag each Reel's link: /action/?c="+c.slug+"&src=ig&reel=0047");
    var recent=d.people.slice(0,25);
    var joins=recent.length?'<div class="cro-list">'+recent.map(function(p){var o=p.origin||{};return'<div class="cro-row"><div class="cro-row__top"><b>#'+n(p.participant_no)+'</b><span class="cro-meta">'+e(new Date(p.joined_at).toLocaleString())+'</span></div><div class="cro-meta">'+e([o.reel?"Reel "+o.reel:"",o.src||"",p.referred_by?"via "+p.referred_by:""].filter(Boolean).join(" · ")||"direct")+(p.skills&&p.skills.length?" · "+e(p.skills.map(function(k){return SKILLS[k]||k;}).join(", ")):"")+'</div></div>';}).join("")+'</div>':note("No participants yet.");
    return stats+
      '<section class="cro-card" style="margin-top:10px"><h2>Funnel by Reel</h2>'+funnel+'</section>'+
      '<div class="cro-grid cro-grid--2" style="margin-top:10px"><section class="cro-card"><h2>What people bring</h2>'+bars(tally(d.people,"contributions"),HAVE,people)+'</section>'+
      '<section class="cro-card"><h2>Skills</h2>'+bars(tally(d.people,"skills"),SKILLS,people)+'</section></div>'+
      '<div class="cro-grid cro-grid--2" style="margin-top:10px"><section class="cro-card"><h2>Actions by kind</h2>'+bars(kinds,{},d.events.length)+'</section>'+
      '<section class="cro-card"><h2>Latest joins</h2>'+joins+'</section></div>';
  }
  function proofMedia(p){
    var u=e(p.proof_url||""); if(!u)return '<div class="cro-note">Text proof only.</div>';
    if(p.proof_type==="video")return '<video controls playsinline preload="metadata" style="width:100%;max-height:62vh;background:#000;border-radius:14px" src="'+u+'"></video>';
    if(p.proof_type==="photo")return '<img alt="Submitted mission proof" style="display:block;width:100%;max-height:62vh;object-fit:contain;border-radius:14px;background:#111" src="'+u+'">';
    return '<a class="cr-btn" href="'+u+'" target="_blank" rel="noopener">Open submitted '+e(p.proof_type)+' ↗</a>';
  }
  function loadProofs(){
    A.proofBusy=true;redraw();
    return A.supa("action_proofs?status=eq.pending&select=id,assignment_id,user_id,proof_type,proof_url,statement,created_at,action_mission_assignments!inner(id,m_uid,status,action_missions!inner(id,title,domain,difficulty,base_points,skills))&order=created_at.asc")
      .then(function(rows){A.proofs=rows||[];}).catch(function(err){A.msg="Proof queue could not load: "+(err.message||err);})
      .then(function(){A.proofBusy=false;redraw();});
  }
  function reviews(){
    if(!A.proofs.length&&!A.proofBusy)loadProofs();
    if(A.proofBusy)return note("Loading proof queue…");
    if(!A.proofs.length)return note("Review queue clear. No pending mission proof.");
    return '<div class="cro-list">'+A.proofs.map(function(p){var a=p.action_mission_assignments||{},m=a.action_missions||{};return '<article class="cro-card" style="margin-bottom:14px"><div class="cro-item__head"><div><p class="cro-meta">MISSION PROOF · '+e(p.proof_type)+' · '+e(new Date(p.created_at).toLocaleString())+'</p><h2>'+e(m.title||"Mission")+'</h2><p class="cro-meta">'+e(m.domain||"community")+' · difficulty '+e(m.difficulty||"")+' · '+e(m.base_points||0)+' base pts</p></div><span class="cro-pill">pending</span></div><div style="margin:14px 0">'+proofMedia(p)+'</div><blockquote style="margin:12px 0;padding:12px 14px;border-left:3px solid currentColor">'+e(p.statement||"No statement.")+'</blockquote><label>Review note<textarea data-proof-note="'+e(p.id)+'" placeholder="What did you verify, or why was this rejected?"></textarea></label><p class="cro-meta">Verify the submitted action and evidence only. This does not certify a member’s character, beliefs, race, or whether they are “racist” or “not racist.” Self-declared satire badges remain self-declared.</p><div class="cro-actions"><button class="cr-btn cr-btn--primary" type="button" data-proof-review="'+e(p.id)+'" data-decision="verified">Verify action</button><button class="cr-btn" type="button" data-proof-review="'+e(p.id)+'" data-decision="rejected">Reject proof</button></div></article>';}).join("")+'</div>';
  }

  function controls(c){
    var phases=Array.isArray(c.phases)?c.phases:[];
    return'<section class="cro-card"><h2>State</h2><div class="cro-form cro-form--3">'+
      '<label>Status<select id="crnStatus">'+STATUSES.map(function(s){return'<option value="'+s+'"'+(c.status===s?" selected":"")+'>'+s+'</option>';}).join("")+'</select></label>'+
      '<label>Current phase<select id="crnPhase"><option value="">—</option>'+phases.map(function(p){return'<option value="'+e(p.key)+'"'+(c.current_phase===p.key?" selected":"")+'>'+e(p.title||p.key)+'</option>';}).join("")+'</select></label>'+
      '<label>Sort<input id="crnSort" type="number" value="'+e(c.sort||0)+'"></label></div>'+
      '<div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-crn-state>Save state</button>'+
      '<a class="cr-btn" href="action/?c='+e(encodeURIComponent(c.slug))+'" target="_blank" rel="noopener">Open public page</a>'+
      '<a class="cr-btn" href="heal-the-3rd-world.html#'+e(encodeURIComponent(c.slug))+'" target="_blank" rel="noopener">Open in the gateway</a></div></section>'+
      '<section class="cro-card" style="margin-top:10px"><h2>Money · '+(c.money_enabled?"ON":"off")+'</h2>'+
      '<p>'+(c.money_enabled?"The public page shows a Give lane and a dollar meter counted from published receipts.":"Nothing about money is on the public page. Turn it on only when McCluster Corp can lawfully solicit for this campaign and the giving path is ready.")+'</p>'+
      '<div class="cro-actions"><button class="cr-btn'+(c.money_enabled?"":" cr-btn--primary")+'" type="button" data-crn-money="'+(c.money_enabled?"0":"1")+'">'+(c.money_enabled?"Turn money off":"Turn money on…")+'</button></div></section>';
  }
  function editor(c){
    var ch=c.chapter||{};
    function j(v){return e(JSON.stringify(v||[],null,2));}
    return'<section class="cro-card"><h2>Content</h2><div class="cro-form cro-form--2">'+
      '<label>Title<input id="crnTitle" value="'+e(c.title)+'" maxlength="160"></label>'+
      '<label>Kicker<input id="crnKicker" value="'+e(c.kicker)+'"></label>'+
      '<label>Headline<input id="crnHeadline" value="'+e(c.headline)+'"></label>'+
      '<label>People goal<input id="crnPeopleGoal" type="number" min="1" value="'+e(c.people_goal||"")+'"></label>'+
      '<label>Money goal (USD)<input id="crnMoneyGoal" type="number" min="1" value="'+e(c.money_goal_cents?Math.round(c.money_goal_cents/100):"")+'"></label>'+
      '<label>Chapter region<input id="crnRegion" value="'+e(ch.region)+'"></label>'+
      '<label>Chapter title<input id="crnChapterTitle" value="'+e(ch.title)+'"></label>'+
      '<label>Chapter line<input id="crnChapterLine" value="'+e(ch.line)+'"></label></div>'+
      '<div class="cro-form" style="margin-top:8px"><label>Body<textarea id="crnBody">'+e(c.body)+'</textarea></label>'+
      '<label>Allocation note<textarea id="crnAllocation">'+e(c.allocation_note)+'</textarea></label>'+
      '<label>Facts (JSON: text, source, url — every fact needs its source)<textarea id="crnFacts" spellcheck="false">'+j(c.facts)+'</textarea></label>'+
      '<label>Sources (JSON: label, publisher, url)<textarea id="crnSources" spellcheck="false">'+j(c.sources)+'</textarea></label>'+
      '<label>Phases (JSON: key, title, detail)<textarea id="crnPhases" spellcheck="false">'+j(c.phases)+'</textarea></label></div>'+
      '<div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-crn-save>Save content</button></div></section>';
  }
  function ledger(c,d){
    var rows=d.ledger.length?'<div class="cro-list">'+d.ledger.map(function(r){return'<div class="cro-item"><div class="cro-item__head"><div><strong>'+e(r.kind)+' · '+e(usd(r.amount_cents))+'</strong><div class="cro-meta">'+e(r.occurred_on)+(r.counterparty?" · "+e(r.counterparty):"")+" · "+e(r.purpose)+(r.evidence_url?' · <a href="'+e(r.evidence_url)+'" target="_blank" rel="noopener">evidence</a>':"")+'</div></div><span class="cro-pill">'+(r.published?"public":"private")+'</span></div><div class="cro-actions"><button class="cr-btn" type="button" data-crn-publish="'+e(r.id)+'" data-next="'+(r.published?"0":"1")+'">'+(r.published?"Unpublish":"Publish")+'</button></div></div>';}).join("")+'</div>':note("No ledger entries.");
    return'<section class="cro-card"><h2>Add an entry</h2><div class="cro-form cro-form--3">'+
      '<label>Kind<select id="crnLKind">'+LEDGER_KINDS.map(function(k){return'<option>'+k+'</option>';}).join("")+'</select></label>'+
      '<label>Amount (USD)<input id="crnLAmount" type="number" min="0" step="0.01"></label>'+
      '<label>Date<input id="crnLDate" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label>'+
      '<label>Counterparty<input id="crnLWho"></label>'+
      '<label>Purpose<input id="crnLPurpose"></label>'+
      '<label>Evidence URL (https)<input id="crnLEvidence" type="url"></label></div>'+
      '<div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-crn-ledger>Add (private)</button></div>'+
      '<p class="cro-meta">Entries start private. Publish one when its evidence is ready; the public page lists published entries and counts published receipts toward the meter.</p></section>'+
      '<section class="cro-card" style="margin-top:10px"><h2>Ledger</h2>'+rows+'</section>';
  }
  function creator(){
    return'<section class="cro-card"><h2>New campaign</h2><div class="cro-form cro-form--3">'+
      '<label>ID<input id="crnNewId" placeholder="water-access-002"></label>'+
      '<label>Slug (the link)<input id="crnNewSlug" placeholder="water"></label>'+
      '<label>Title<input id="crnNewTitle" placeholder="The Water Action Mission"></label></div>'+
      '<div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-crn-create>Create as draft</button></div>'+
      '<p class="cro-meta">Drafts are invisible to the public. Fill in the content, facts and sources, then set it live.</p></section>';
  }
  function render(){
    if(!A.loaded&&!A.loading)load();
    var c=current(),d=c&&A.detail[c.id];
    var chips='<div class="cro-chips">'+A.campaigns.map(function(x){return'<button class="cro-chip'+(x.id===A.sel&&A.tab!=="new"?" is-on":"")+'" type="button" data-crn-pick="'+e(x.id)+'">'+e(x.title)+' · '+e(x.status)+'</button>';}).join("")+'<button class="cro-chip'+(A.tab==="new"?" is-on":"")+'" type="button" data-crn-tab="new">+ New campaign</button></div>';
    var head=(A.loading&&!A.loaded?note("Loading campaigns…"):A.error?note("Campaigns could not be read: "+(A.error.message||A.error)+". If the table is missing, the Action Network migration has not been applied.",true):"")+(A.msg?note(A.msg):"");
    if(A.tab==="new")return'<div class="cro">'+chips+head+creator()+'</div>';
    if(!c)return'<div class="cro">'+chips+head+(A.loaded&&!A.error?note("No campaigns yet."):"")+'</div>';
    var tabs='<div class="cro-tabs">'+[["overview","Overview"],["reviews","Proof review"],["state","State & money"],["content","Content"],["ledger","Ledger"]].map(function(t){return'<button class="cro-tab'+(A.tab===t[0]?" is-on":"")+'" type="button" data-crn-tab="'+t[0]+'">'+t[1]+'</button>';}).join("")+'</div>';
    var body=!d?note("Loading "+c.title+"…"):(d.errors.length?note("Some reads failed: "+d.errors.join("; "),true):"")+
      (A.tab==="reviews"?reviews():A.tab==="state"?controls(c):A.tab==="content"?editor(c):A.tab==="ledger"?ledger(c,d):overview(c,d));
    return'<div class="cro">'+chips+head+tabs+body+'</div>';
  }

  /* ---------- writes ---------- */
  function patch(c,body){
    body.updated_at=new Date().toISOString();
    return A.supa("action_campaigns?id=eq."+encodeURIComponent(c.id),{method:"PATCH",body:body});
  }
  function run(btn,work,done){
    if(btn)btn.disabled=true;A.msg="";
    return work().then(function(){A.msg=done||"";return load();}).catch(function(err){if(btn)btn.disabled=false;alert(err.message||"That did not save.");});
  }
  function val(root,id){var el=root.querySelector("#"+id);return el?el.value:"";}
  function parseList(text,need,label){
    var v;try{v=JSON.parse(text||"[]");}catch(_){throw new Error(label+" is not valid JSON.");}
    if(!Array.isArray(v))throw new Error(label+" must be a list.");
    v.forEach(function(x,i){need.forEach(function(k){if(!x||typeof x!=="object"||!String(x[k]||"").trim())throw new Error(label+" #"+(i+1)+" needs "+k+".");});
      if(x.url&&!/^https:\/\//i.test(x.url))throw new Error(label+" #"+(i+1)+": url must start with https://");});
    return v;
  }
  function bind(root){
    if(!root)return;
    root.querySelectorAll("[data-crn-pick]").forEach(function(b){b.onclick=function(){A.sel=b.getAttribute("data-crn-pick");if(A.tab==="new")A.tab="overview";A.msg="";if(!A.detail[A.sel])loadDetail(A.sel).then(redraw);redraw();};});
    root.querySelectorAll("[data-crn-tab]").forEach(function(b){b.onclick=function(){A.tab=b.getAttribute("data-crn-tab");A.msg="";redraw();};});
    root.querySelectorAll("[data-proof-review]").forEach(function(b){b.onclick=function(){var id=b.getAttribute("data-proof-review"),decision=b.getAttribute("data-decision"),noteEl=root.querySelector('[data-proof-note="'+id+'"]'),reviewNote=noteEl?noteEl.value.trim():"";
      if(decision==="rejected"&&!reviewNote){alert("Add a review note explaining why the proof is rejected.");return;}
      if(!confirm((decision==="verified"?"Verify this submitted action and award it exactly once?":"Reject this proof without awarding points?")))return;
      b.disabled=true;A.supa("rpc/review_action_proof",{method:"POST",body:{p_proof_id:id,p_decision:decision,p_review_note:reviewNote||null}})
        .then(function(){A.msg=decision==="verified"?"Action verified. Award transaction completed.":"Proof rejected. No award issued.";return loadProofs();})
        .catch(function(err){b.disabled=false;alert(err.message||"Review failed.");});
    };});
    var st=root.querySelector("[data-crn-state]");
    if(st)st.onclick=function(){var c=current();if(!c)return;var s=val(root,"crnStatus");
      if(s==="live"&&c.status!=="live"&&!confirm("Set \""+c.title+"\" live? It becomes public at /action/?c="+c.slug+" and appears in the Heal the 3rd World gateway."))return;
      run(st,function(){return patch(c,{status:s,current_phase:val(root,"crnPhase")||null,sort:parseInt(val(root,"crnSort"),10)||0});},"State saved.");};
    var mo=root.querySelector("[data-crn-money]");
    if(mo)mo.onclick=function(){var c=current();if(!c)return;var on=mo.getAttribute("data-crn-money")==="1";
      if(on&&!confirm("Turn money ON for \""+c.title+"\"?\n\nThis puts a Give lane and a dollar meter on the public page. Only do this when McCluster Corp is registered to solicit where it will be asking, the giving path is ready, and the page says truthfully whether gifts are tax-deductible."))return;
      run(mo,function(){return patch(c,{money_enabled:on});},on?"Money is on.":"Money is off.");};
    var sv=root.querySelector("[data-crn-save]");
    if(sv)sv.onclick=function(){var c=current();if(!c)return;var body;
      try{
        var pg=parseInt(val(root,"crnPeopleGoal"),10),mg=parseFloat(val(root,"crnMoneyGoal"));
        body={title:val(root,"crnTitle").trim(),kicker:val(root,"crnKicker").trim()||null,headline:val(root,"crnHeadline").trim()||null,
          body:val(root,"crnBody").trim()||null,allocation_note:val(root,"crnAllocation").trim()||null,
          people_goal:pg>0?pg:null,money_goal_cents:mg>0?Math.round(mg*100):null,
          chapter:{region:val(root,"crnRegion").trim(),title:val(root,"crnChapterTitle").trim(),line:val(root,"crnChapterLine").trim()},
          facts:parseList(val(root,"crnFacts"),["text","source","url"],"Fact"),
          sources:parseList(val(root,"crnSources"),["label","url"],"Source"),
          phases:parseList(val(root,"crnPhases"),["key","title"],"Phase")};
        Object.keys(body.chapter).forEach(function(k){if(!body.chapter[k])delete body.chapter[k];});
        if(!body.title)throw new Error("A campaign needs a title.");
      }catch(err){alert(err.message);return;}
      run(sv,function(){return patch(c,body);},"Content saved.");};
    var lg=root.querySelector("[data-crn-ledger]");
    if(lg)lg.onclick=function(){var c=current();if(!c)return;var amt=parseFloat(val(root,"crnLAmount")),ev=val(root,"crnLEvidence").trim(),purpose=val(root,"crnLPurpose").trim();
      if(!(amt>=0)||!purpose){alert("An amount and a purpose are required.");return;}
      if(ev&&!/^https:\/\//i.test(ev)){alert("Evidence must be an https:// link.");return;}
      run(lg,function(){return A.supa("action_ledger",{method:"POST",body:{campaign_id:c.id,kind:val(root,"crnLKind"),amount_cents:Math.round(amt*100),counterparty:val(root,"crnLWho").trim()||null,purpose:purpose,evidence_url:ev||null,occurred_on:val(root,"crnLDate")||undefined,published:false}});},"Entry added (private).");};
    root.querySelectorAll("[data-crn-publish]").forEach(function(b){b.onclick=function(){var on=b.getAttribute("data-next")==="1";
      if(on&&!confirm("Publish this entry on the public page?"))return;
      run(b,function(){return A.supa("action_ledger?id=eq."+encodeURIComponent(b.getAttribute("data-crn-publish")),{method:"PATCH",body:{published:on}});},on?"Entry published.":"Entry unpublished.");};});
    var cr=root.querySelector("[data-crn-create]");
    if(cr)cr.onclick=function(){var id=val(root,"crnNewId").trim().toLowerCase(),slug=val(root,"crnNewSlug").trim().toLowerCase(),title=val(root,"crnNewTitle").trim();
      if(!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)){alert("ID: lowercase letters, numbers and dashes, 3–64 characters.");return;}
      if(!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)){alert("Slug: lowercase letters, numbers and dashes, 2–41 characters.");return;}
      if(!title){alert("A title, please.");return;}
      run(cr,function(){return A.supa("action_campaigns",{method:"POST",body:{id:id,slug:slug,title:title,status:"draft"}}).then(function(){A.sel=id;A.tab="content";});},"Draft created. Write its content, facts and sources, then set it live.");};
  }
  window.CR.actionNetwork={init:function(opts){A.supa=opts.supa;A.rerender=opts.render;},render:render,bind:bind,load:load,state:A};
})();
