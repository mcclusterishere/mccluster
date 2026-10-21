/* Control · Create · Funding Intelligence.
   This surface is deliberately owner-only via /v1/control/funding/*. It never
   publishes a mission, sends a grant application, or records cash. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  var F = { request: null, renderHost: null, catalog: null, loading: false,
    keyword: 'community health', partner: 'all', mode: 'opportunities',
    results: null, resultsError: '', searching: false, seq:0, catalogSeq:0, register:null, registerError:"", route:"", detail:null, detailError:"", detailLoading:false, detailSeq:0, revoked:false };
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function safeUrl(s){try{var u=new URL(s);return u.protocol==='https:'?u.href:'#';}catch(_){return '#';}}
  function status(s) { return '<span class="cro-pill">'+e(s)+'</span>'; }
  function redraw() { if(F.renderHost) F.renderHost(); }
  function load() {
    if (F.revoked||F.loading) return Promise.resolve();
    var seq=++F.catalogSeq;F.loading = true;++F.detailSeq;F.route='';F.detail=null;F.detailError='';F.detailLoading=false;
    return Promise.all([
      F.request('/v1/control/funding/catalog').then(function(data){
        if(seq===F.catalogSeq&&!F.revoked)F.catalog=data;
      },function(err){if(seq===F.catalogSeq&&!F.revoked)F.catalog={ok:false,schema_state:'unavailable',message:err.message,opportunities:[],drafts:[]};}),
      F.request('/v1/control/funding/register').then(function(data){
        if(seq===F.catalogSeq&&!F.revoked){F.register=data;F.registerError=data.ok?'':data.message||'Requirements register unavailable.';}
      },function(err){if(seq===F.catalogSeq&&!F.revoked){F.register=null;F.registerError=err.message||'Requirements register unavailable.';}})
    ]).finally(function(){if(seq===F.catalogSeq&&!F.revoked){F.loading=false;redraw();}});
  }
  function loadRoute(route){
    if(F.revoked)return Promise.resolve();
    var seq=++F.detailSeq;F.route=route;F.detail=null;F.detailError='';F.detailLoading=true;redraw();
    return F.request('/v1/control/funding/register?route_id='+encodeURIComponent(route)).then(function(data){
      if(seq!==F.detailSeq||F.revoked)return;
      F.detail=data&&data.items&&data.items.find(function(x){return x.route_id===route;})||null;
      if(!data.ok||!F.detail)F.detailError=data.message||'Requirement details unavailable.';
    },function(err){if(seq===F.detailSeq&&!F.revoked)F.detailError=err.message||'Requirement details unavailable.';}).finally(function(){if(seq===F.detailSeq&&!F.revoked){F.detailLoading=false;redraw();}});
  }
  function words(value){return String(value||'unverified').replace(/_/g,' ');}
  function requirementDetails(){
    if(F.detailLoading)return '<p role="status">Loading requirement evidence…</p>';
    if(F.detailError)return '<p class="cro-note cro-note--bad" role="alert">'+e(F.detailError)+'</p>';
    var d=F.detail;if(!d)return '';
    return '<p class="cro-note">'+e(d.requirements_complete?'Requirements reviewed; applicant review remains separate.':'Screening register only. Full requirements review remains incomplete.')+'</p>'+
      (d.criteria||[]).map(function(c){return '<details><summary>'+e(c.criterion_id)+' · '+e(words(c.classification))+' · '+e(words(c.status))+(c.blocking?' · blocks readiness':'')+'</summary><p>'+e(c.requirement)+'</p>'+
        '<p class="cro-meta">Work package: '+e(c.work_package||'unassigned')+' · Responsible owner: '+e(c.responsible_owner||'unassigned')+'</p>'+
        '<p class="cro-meta">Deliverable: '+e(c.deliverable||'unverified')+' · Acceptance artifact: '+e(c.acceptance_artifact||'unverified')+'</p>'+
        '<p class="cro-meta">Source section: '+e(c.source_section||'unverified')+' · '+e(words(c.source_basis))+' · Version '+e(c.source_version||'unverified')+'</p>'+
        '<p class="cro-meta">Reviewed: '+e(c.reviewed_at||'not recorded')+' · Reviewer: '+e(c.reviewer||'not assigned')+' · Evidence references: '+e((c.evidence_refs||[]).join(', ')||'none')+'</p>'+
        (c.source_url?'<a href="'+e(safeUrl(c.source_url))+'" target="_blank" rel="noopener noreferrer">Requirement source ↗</a>':'')+'</details>';}).join('')+
      '<p class="cro-meta">'+(d.source_versions||[]).length+' source versions recorded · '+e(words(d.source_review))+'</p>';
  }
  function programCards(opportunities){
    var reg=F.register,items=reg&&Array.isArray(reg.items)?reg.items:[],c=reg&&reg.completeness;
    var warning=F.registerError?'<p class="cro-note cro-note--bad" role="alert">Requirements register unavailable. '+e(F.registerError)+'</p>':
      c&&c.state!=='complete'?'<p class="cro-note">Register completeness: '+e(c.state||'unknown')+'.'+(c.limit?' Read limit '+e(c.limit)+'.':'')+'</p>':'';
    if(items.length)return warning+items.map(function(o){return '<article class="cro-card" style="margin-bottom:10px">'+
      '<div class="cro-item__head"><div><p class="cro-meta">'+e(o.route_id)+' · '+e(o.funder_name)+' · '+e(words(o.instrument))+'</p><h3>'+e(o.program_title)+'</h3></div>'+status(words(o.call_status))+'</div>'+
      '<p class="cro-meta"><b>Technical fit:</b> '+e(words(o.technical_fit&&o.technical_fit.status))+' · '+e((o.technical_fit&&o.technical_fit.work_packages||[]).join(', '))+'</p>'+
      '<p class="cro-meta"><b>Applicant eligibility:</b> '+e(words(o.applicant_eligibility&&o.applicant_eligibility.status))+'</p>'+
      '<p class="cro-meta"><b>Application readiness:</b> '+e(words(o.application_readiness&&o.application_readiness.status))+'</p>'+
      '<p class="cro-meta">'+e(o.criterion_counts&&o.criterion_counts.blocking!=null?o.criterion_counts.blocking:'Unknown')+' blocking criteria · Source review: '+e(words(o.source_review))+'</p>'+
      '<a href="'+e(safeUrl(o.source_url))+'" target="_blank" rel="noopener noreferrer">Official source ↗</a> <button type="button" class="cr-btn" data-funding-route="'+e(o.route_id)+'" aria-expanded="'+(F.route===o.route_id)+'">Inspect requirements</button>'+
      (F.route===o.route_id?requirementDetails():'')+'</article>';}).join('');
    return warning+(opportunities.length?opportunities.map(function(o){return '<article class="cro-card" style="margin-bottom:10px">'+
      '<div class="cro-item__head"><div><p class="cro-meta">'+e(o.funder_name)+'</p><h3>'+e(o.program_title)+'</h3></div>'+status(o.availability)+'</div><p>'+e(o.eligibility_note)+'</p>'+
      '<a href="'+e(safeUrl(o.source_url))+'" target="_blank" rel="noopener noreferrer">Official source ↗</a> <span class="cro-meta">Reviewed '+e(o.reviewed_at)+'</span></article>';}).join(''):
      '<p class="cro-note">No program records loaded. A missing database migration is not an empty funding market.</p>');
  }

  function search(kind) {
    if(F.revoked||F.searching)return;
    if (!F.keyword.trim()) { F.resultsError = 'Enter a search topic.';redraw();return; }
    var seq=++F.seq;F.mode=kind;F.results=null;F.resultsError='';F.searching=true;redraw();
    var route=kind==='past_awards'?'awards':'search';
    F.request('/v1/control/funding/'+route+'?keyword='+encodeURIComponent(F.keyword)).then(function(data){
      if(seq!==F.seq)return;F.results=data;
      if(!data.ok)F.resultsError=data.message||'Official provider unavailable';
    }).catch(function(err){ if(seq===F.seq)F.resultsError=err.message||'Request failed'; })
      .finally(function(){if(seq===F.seq){F.searching=false;redraw();}});
  }
  function partnerChoices(drafts) {
    return Array.from(new Set(drafts.map(function(d){return d.presenting_to;}))).sort();
  }
  function draftCard(d) {
    var metrics=Array.isArray(d.metric_keys)?d.metric_keys:[];
    return '<article class="cro-card" style="margin:0 0 10px">' +
      '<div class="cro-item__head"><div><p class="cro-meta">'+e(d.draft_id)+' · '+e(d.mission_category)+'</p><h3>'+e(d.title)+'</h3></div>'+status('PRIVATE DRAFT')+'</div>'+
      '<p>'+e(d.instruction)+'</p><p class="cro-meta"><b>Planned outcomes:</b> '+e(metrics.join(', ')||'Pending')+'</p>'+
      '<p class="cro-meta"><b>Verification:</b> '+e(d.proof_policy)+'</p>'+
      '<p class="cro-meta"><b>Presentation:</b> '+e(d.presenting_to)+
      ' · '+e(d.relationship_status).replace(/_/g,' ')+'</p>'+
      '<p class="cro-meta">Compensation: not authorized · no participant claims or payouts</p></article>';
  }
  function render() {
    if(F.revoked)return '<p class="cro-note" role="alert">Owner access changed. Reload Control to verify your current session.</p>';
    if(!F.catalog && !F.loading)load();
    var cat=F.catalog, opportunities=cat&&Array.isArray(cat.opportunities)?cat.opportunities:[],
      drafts=cat&&Array.isArray(cat.drafts)?cat.drafts:[], partners=partnerChoices(drafts),
      selected=drafts.filter(function(d){return F.partner==='all'||d.presenting_to===F.partner;});
    var warning=!cat?'<p class="cro-note">Loading private funding records…</p>'
      :cat.schema_state!=='installed'?'<p class="cro-note cro-note--bad">Private catalog '+e(cat.schema_state)+'. '+e(cat.message||'Migration not installed; no draft records are claimed to be available.')+'</p>':'';
    return '<div class="cro" id="crFundingIntelligence">'+
      '<div class="cro-item__head"><div><p class="cro-meta">ACTION NETWORK · CONTROL ONLY</p><h2>Funding Intelligence</h2><p>Source-backed opportunities, existing federal awards, and unpublishable partner mission briefs.</p></div>'+
      '<button class="cr-btn" type="button" data-funding-refresh>Refresh catalog</button></div>'+
      '<p class="cro-note">Discovery does not imply eligibility, partnership, award availability or allowable participant compensation. Drafts cannot be claimed.</p>'+
      warning+
      '<div class="cro-tabs"><button type="button" data-funding-view="drafts" class="cro-tab'+(F.mode==='drafts'?' is-on':'')+'">Mission arsenal ('+drafts.length+')</button>'+
      '<button type="button" data-funding-view="catalog" class="cro-tab'+(F.mode==='catalog'?' is-on':'')+'">Funding programs ('+((F.register&&F.register.items||[]).length||opportunities.length)+')</button>'+
      '<button type="button" data-funding-view="opportunities" class="cro-tab'+(F.mode==='opportunities'?' is-on':'')+'">Federal opportunities</button>'+
      '<button type="button" data-funding-view="past_awards" class="cro-tab'+(F.mode==='past_awards'?' is-on':'')+'">Federal past awards</button></div>'+
      (F.mode==='drafts' ?
        '<label class="cro-meta" for="crFundPartner">Partner or prospect</label> <select id="crFundPartner" class="cr-input" style="width:min(100%,520px)"><option value="all">All partners and prospects</option>'+
        partners.map(function(p){return '<option value="'+e(p)+'"'+(F.partner===p?' selected':'')+'>'+e(p)+'</option>';}).join('')+'</select>'+
        '<p class="cro-meta">'+selected.length+' missions in development. Each needs a confirmed activity and operating plan before publication.</p>'+
        (selected.length?selected.map(draftCard).join(''):'<p class="cro-note">No drafts available in this view; verify the pending database migration.</p>')+
        (selected.length?'<button class="cr-btn" data-funding-brief type="button">Copy partner briefing text</button><p class="cro-meta" id="crFundingCopyStatus" aria-live="polite"></p>':'')
      :F.mode==='catalog' ?
        programCards(opportunities)
      : '<form data-funding-search><label for="crFundingKeyword">Search '+(F.mode==='past_awards'?'USAspending historical federal awards':'Grants.gov currently posted or forecasted opportunities')+'</label>'+
        '<div class="cro-actions"><input class="cr-input" id="crFundingKeyword" maxlength="90" type="search" value="'+e(F.keyword)+'" placeholder="e.g. community health">'+
        '<button class="cr-btn cr-btn--primary" type="submit"'+(F.searching?' disabled':'')+'>'+(F.searching?'Searching…':'Search official API')+'</button></div></form>'+
        '<p class="cro-meta">Official API data, fetched on demand. Matching terms generate suggestions, not mission authorizations.</p>'+
        (F.resultsError?'<p class="cro-note cro-note--bad">'+e(F.resultsError)+'</p>':'')+
        (F.results&&F.results.ok?'<p class="cro-meta">'+e(F.results.provider)+' · checked '+e(F.results.checked_at)+' · '+F.results.items.length+' returned</p>'+
          (F.results.items.length?F.results.items.map(function(v){return '<article class="cro-card" style="margin-bottom:10px">'+
            '<p class="cro-meta">'+e(v.source_id||v.award_id)+' · '+e(v.status||'historical award')+'</p><h3>'+e(v.title)+'</h3>'+
            '<p>'+e(v.agency||'Agency not supplied')+(v.recipient?' · Recipient: '+e(v.recipient):'')+'</p>'+
            (v.obligated_amount!==undefined&&v.obligated_amount!==null?'<p class="cro-meta">Reported award: $'+e(Number(v.obligated_amount).toLocaleString())+' (historical, not available to Action Network)</p>':'')+
            '<p class="cro-meta">Possible mission categories: '+e((v.suggested_mission_families||[]).join(', ')||'Requires manual analysis')+'</p>'+
            '<a href="'+e(safeUrl(v.source_url))+'" target="_blank" rel="noopener noreferrer">Inspect source ↗</a></article>';}).join(''):
          '<p class="cro-note">The official provider returned no matches for this search.</p>')+
          '<a href="'+e(safeUrl(F.results.source_url))+'" target="_blank" rel="noopener noreferrer">API documentation ↗</a>':'')
      )+'</div>';
  }
  function briefing() {
    var rows=((F.catalog&&F.catalog.drafts)||[]).filter(function(d){return F.partner==='all'||d.presenting_to===F.partner;});
    return 'Action Network — INTERNAL partner proposal (NOT FUNDED OR AUTHORIZED)\n'+
      'Presenting to: '+(F.partner==='all'?'partners and prospects':F.partner)+'\n\n'+
      rows.map(function(d){return d.title+'\nActivity: '+d.instruction+'\nMetrics: '+(d.metric_keys||[]).join(', ')+
        '\nProof: '+d.proof_policy+'\nRelationship: '+String(d.relationship_status||'prospective_lead').replace(/_/g,' ')+'\nStatus: PRIVATE DRAFT; this activity is not yet authorized or funded.\n';}).join('\n');
  }
  function bind(root) {
    if(!root||!root.querySelector('#crFundingIntelligence'))return;
    var btn=root.querySelector('[data-funding-refresh]');if(btn)btn.onclick=load;
    root.querySelectorAll('[data-funding-route]').forEach(function(el){el.onclick=function(){loadRoute(el.getAttribute('data-funding-route'));};});
    root.querySelectorAll('[data-funding-view]').forEach(function(el){el.onclick=function(){++F.seq;F.searching=false;F.results=null;F.mode=el.getAttribute('data-funding-view');F.resultsError='';redraw();};});
    var partner=root.querySelector('#crFundPartner');if(partner)partner.onchange=function(){F.partner=partner.value;redraw();};
    var input=root.querySelector('#crFundingKeyword');if(input)input.oninput=function(){F.keyword=input.value;};
    var form=root.querySelector('[data-funding-search]');if(form)form.onsubmit=function(ev){ev.preventDefault();search(F.mode);};
    var copy=root.querySelector('[data-funding-brief]');if(copy)copy.onclick=function(){
      var out=root.querySelector('#crFundingCopyStatus');
      if(!navigator.clipboard||!navigator.clipboard.writeText){if(out)out.textContent='Clipboard unavailable on this device.';return;}
      navigator.clipboard.writeText(briefing()).then(function(){if(out)out.textContent='Draft briefing copied.';})
        .catch(function(){if(out)out.textContent='Clipboard permission denied.';});
    };
  }
  function clearPrivate(){++F.seq;++F.catalogSeq;++F.detailSeq;F.revoked=true;F.catalog=null;F.register=null;F.registerError='';F.route='';F.detail=null;F.detailError='';F.detailLoading=false;F.results=null;F.resultsError='';F.loading=false;F.searching=false;var node=document.getElementById('crFundingIntelligence');if(node)node.replaceChildren();}
  window.addEventListener('mcc:auth-changed',function(event){if(event.detail&&event.detail.signed_in===false)clearPrivate();});
  window.addEventListener('mcc:appbar-admin',function(event){if(event.detail&&event.detail.admin===false&&(F.catalog||F.loading||F.searching||F.detailLoading))clearPrivate();});
  window.addEventListener('storage',function(event){if(event.key==='mccdb_session')clearPrivate();});
  window.CR.fundingIntelligence={init:function(opts){F.request=opts.request;F.renderHost=opts.render;},render:render,bind:bind,load:load,loadRoute:loadRoute,state:F};
})();
