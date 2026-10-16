/* Control · Create · Funding Intelligence.
   This surface is deliberately owner-only via /v1/control/funding/*. It never
   publishes a mission, sends a grant application, or records cash. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  var F = { request: null, renderHost: null, catalog: null, loading: false,
    keyword: 'community health', partner: 'all', mode: 'opportunities',
    results: null, resultsError: '', searching: false, seq:0, catalogSeq:0 };
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function safeUrl(s){try{var u=new URL(s);return u.protocol==='https:'?u.href:'#';}catch(_){return '#';}}
  function status(s) { return '<span class="cro-pill">'+e(s)+'</span>'; }
  function redraw() { if(F.renderHost) F.renderHost(); }
  function load() {
    if (F.loading) return;
    var seq=++F.catalogSeq;F.loading = true;
    return F.request('/v1/control/funding/catalog').then(function(data){
      if(seq===F.catalogSeq)F.catalog = data;
    }).catch(function(err){
      if(seq===F.catalogSeq)F.catalog = {ok:false,schema_state:'unavailable',message:err.message,opportunities:[],drafts:[]};
    }).finally(function(){ if(seq===F.catalogSeq){F.loading=false;redraw();} });
  }
  function search(kind) {
    if(F.searching)return;
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
      '<p>'+e(d.instruction)+'</p><p class="cro-meta"><b>Funder metrics:</b> '+e(metrics.join(', ')||'Pending')+'</p>'+
      '<p class="cro-meta"><b>Verification:</b> '+e(d.proof_policy)+'</p>'+
      '<p class="cro-meta"><b>Presentation:</b> '+e(d.presenting_to)+
      ' · '+e(d.relationship_status).replace(/_/g,' ')+'</p>'+
      '<p class="cro-meta">Compensation: not authorized · no participant claims or payouts</p></article>';
  }
  function render() {
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
      '<div class="cro-tabs"><button type="button" data-funding-view="drafts" class="cro-tab'+(F.mode==='drafts'?' is-on':'')+'">Partner drafts ('+drafts.length+')</button>'+
      '<button type="button" data-funding-view="catalog" class="cro-tab'+(F.mode==='catalog'?' is-on':'')+'">Funding programs ('+opportunities.length+')</button>'+
      '<button type="button" data-funding-view="opportunities" class="cro-tab'+(F.mode==='opportunities'?' is-on':'')+'">Federal opportunities</button>'+
      '<button type="button" data-funding-view="past_awards" class="cro-tab'+(F.mode==='past_awards'?' is-on':'')+'">Federal past awards</button></div>'+
      (F.mode==='drafts' ?
        '<label class="cro-meta" for="crFundPartner">Private partner presentation</label> <select id="crFundPartner" class="cr-input" style="width:min(100%,520px)"><option value="all">All prospective partners</option>'+
        partners.map(function(p){return '<option value="'+e(p)+'"'+(F.partner===p?' selected':'')+'>'+e(p)+'</option>';}).join('')+'</select>'+
        '<p class="cro-meta">'+selected.length+' unpublished mission proposals. No partner authorization or reward is recorded.</p>'+
        (selected.length?selected.map(draftCard).join(''):'<p class="cro-note">No drafts available in this view; verify the pending database migration.</p>')+
        (selected.length?'<button class="cr-btn" data-funding-brief type="button">Copy partner briefing text</button><p class="cro-meta" id="crFundingCopyStatus" aria-live="polite"></p>':'')
      :F.mode==='catalog' ?
        (opportunities.length?opportunities.map(function(o){return '<article class="cro-card" style="margin-bottom:10px">'+
          '<div class="cro-item__head"><div><p class="cro-meta">'+e(o.funder_name)+'</p><h3>'+e(o.program_title)+'</h3></div>'+status(o.availability)+'</div>'+
          '<p>'+e(o.eligibility_note)+'</p>'+
          '<a href="'+e(safeUrl(o.source_url))+'" target="_blank" rel="noopener noreferrer">Official source ↗</a> <span class="cro-meta">Reviewed '+e(o.reviewed_at)+'</span></article>';}).join(''):
          '<p class="cro-note">No program records loaded. A missing database migration is not an empty funding market.</p>')
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
      'Presenting to: '+(F.partner==='all'?'multiple prospective partners':F.partner)+'\n\n'+
      rows.map(function(d){return d.title+'\nActivity: '+d.instruction+'\nMetrics: '+(d.metric_keys||[]).join(', ')+
        '\nProof: '+d.proof_policy+'\nStatus: PRIVATE DRAFT; no funding, claims, or affiliation asserted.\n';}).join('\n');
  }
  function bind(root) {
    if(!root||!root.querySelector('#crFundingIntelligence'))return;
    var btn=root.querySelector('[data-funding-refresh]');if(btn)btn.onclick=load;
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
  function clearPrivate(){++F.seq;++F.catalogSeq;F.catalog=null;F.results=null;F.loading=false;F.searching=false;var node=document.getElementById('crFundingIntelligence');if(node)node.replaceChildren();}
  window.addEventListener('mcc:auth-changed',clearPrivate);
  window.addEventListener('storage',function(event){if(event.key==='mccdb_session')clearPrivate();});
  window.CR.fundingIntelligence={init:function(opts){F.request=opts.request;F.renderHost=opts.render;},render:render,bind:bind,load:load,state:F};
})();
