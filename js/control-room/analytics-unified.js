/* One owner overview over existing reads. Provider snapshots stay transient;
   a configured adapter is not evidence that a feed or archive is populated. */
(function(){
  'use strict';
  window.CR=window.CR||{};
  var H={health:null,healthError:null,sources:null,readiness:null,error:null,busy:false,source:'',query:'',inventory:null,inventoryError:null,inventoryBusy:false,eventInventory:null,eventError:null,eventBusy:false,eventQuery:'',eventLimit:50,fieldQuery:'',fieldLimit:30,panel:'datasets',datasetQuery:'',family:'',datasetStatus:'',dataset:'',records:null,runs:null,result:null,recordError:null,reading:false,seq:0};
  var W={economy:'WLD',data:null,error:null,busy:false,seq:0};
  var WORKSPACE=[['Inbox','work:inbox'],['People','work:people'],['Projects','work:projects'],['Payments','work:payments'],['Renewals','work:renewals'],['Publishing','create:schedule'],['Library','create:library'],['Music','create:music'],['McCluster AI','ai'],['Apps','apps']];
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(v){return v==null||v===''||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString();}
  function cash(v){return v==null||!Number.isFinite(Number(v))?'—':new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(v/100);}
  function badge(text){return '<span class="cu-badge">'+esc(text)+'</span>';}
  function link(text,hash){return '<a href="#'+esc(hash)+'">'+esc(text)+' ↗</a>';}
  function button(text,section){return '<button type="button" data-cra-sec="'+esc(section)+'">'+esc(text)+' ↗</button>';}
  function card(title,sub,body){return '<section class="cu-card"><div class="cu-heading"><h2>'+esc(title)+'</h2></div><p class="cu-note">'+esc(sub)+'</p>'+body+'</section>';}
  function fact(label,value,sub){return '<div class="cu-fact"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(sub||'')+'</small></div>';}
  function metric(label,value,sub,section){return '<button type="button" class="cu-fact cu-metric-link" data-cra-sec="'+section+'" aria-label="'+esc(label+': '+value+'. Open details')+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(sub)+'</small><i aria-hidden="true">↗</i></button>';}
  function rows(items){return '<dl class="cu-rows">'+items.map(function(x){return '<div><dt>'+esc(x[0])+'</dt><dd>'+esc(x[1])+'</dd></div>';}).join('')+'</dl>';}
  function date(v){if(!v)return 'Unknown';var d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString():'Unknown';}
  function sum(a,k){return Array.isArray(a)?a.reduce(function(n,r){return n+(Number(r[k])||0);},0):null;}
  function sourceStatus(s){if(s.entitlement&&s.entitlement.allowed===false)return 'Access restricted';if(s.credential_required&&!s.configured)return 'Needs configuration';return s.credential_required?'Configured · not checked':'Keyless · not checked';}
  function overview(S,h){
    var d=S.data,t=(d.traffic||{}).totals||{},b=d.business&&d.business.snapshot||{},house=S.site==='__first_party__',science=d.audienceScience||{},aud=science.totals||{},cm=b.commerce||{},sales=cm.available?(b.window?cm.live_in_window:cm.live):null;
    var tracks=Array.isArray(d.content)?d.content:[],scope=S.range&&S.range.label||'Selected range';
    var metrics='<div class="cu-metrics cu-overview-metrics" aria-label="Key metrics. Swipe for more.">'+metric('Unique visitors',num(t.visitors),'Distinct devices · '+scope,'audience')+metric('Page views',num(t.page_views),scope+' · all countries','audience')+(house?metric('New accounts',num(b.users&&b.users.created_in_window),scope+' · all countries','identity')+metric('Music plays',num(b.music&&b.music.plays&&b.music.plays.in_window),scope+' · all countries','content')+metric('Verified sales',cash(sales&&sales.net_cents),'Live · net of refunds','action')+metric('Awaiting review',num(sum(d.missions,'submitted')),'Mission assignments · all time','action'):metric('Sessions',num(t.sessions),scope,'audience')+metric('Events',num(t.events),scope,'content'))+'</div>';

    var f=d.funnel,keys=[['arrived','Arrived'],['heard_something','Listened'],['made_an_account','Signed up'],['paid','Purchase reports']];
    function stageValue(key){
      if(!d.stageTotals)return sum(f,key);
      if(key==='made_an_account')return d.stageTotals.accounts&&d.stageTotals.accounts.made_an_account;
      var stage={arrived:'view',heard_something:'content',paid:'purchase'}[key],row=(d.stageTotals.stages||[]).find(function(x){return x.stage===stage;});return row?row.value:0;
    }
    var funnel='<div class="cu-funnel">'+keys.map(function(k){return '<div><small>'+k[1]+'</small><b>'+num(S.errors.funnel||!S.completed||!S.completed.funnel?null:stageValue(k[0]))+'</b></div>';}).join('')+'</div>';
    var reach=card('Reach & stage activity',h.scopeLabel(),h.chart+(house?funnel+'<p class="cu-note">Stage totals · first-party, all countries. Arrived, Listened and Purchase reports are '+(d.stageTotals?'distinct devices in this window':'device-days')+'; Signed up is accounts. Not an ordered conversion funnel.</p>':'')+button(house?'Explore journeys':'Explore audience',house?'identity':'audience'));
    var errs=d.errors&&d.errors.totals;

    return metrics+'<div class="cad-overview-grid">'+reach+(house?card('Needs attention','First-party · '+scope,rows([['Site errors',num(errs&&errs.site_errors)],['Friction events',num(errs&&errs.friction)],['Proof awaiting review · all time',num(sum(d.missions,'submitted'))]])+button('Inspect site health','forensics')):card('Property activity',scope,rows([['Sessions',num(t.sessions)],['Events',num(t.events)]])+button('Explore audience','audience')))+'</div>';
  }
  function coverage(S){
    var d=S&&S.data.coverage,m=d&&d.metrics||{};
    var items=[['headlines','Headlines'],['publishers','Publishers'],['ingest_records','Ingested records'],['connectors','Connectors'],['missions','Missions'],['proofs','Proofs'],['observability','System events']];
    return card('Stored data',d?d.scope+' · '+date(d.measured_at):'Current stored records · all time', '<div class="cu-metrics">'+items.map(function(x){var v=m[x[0]];return fact(x[1],num(v&&v.count),v?v.status:'Not available');}).join('')+'</div>');
  }
  function operations(S){
    var d=S.data,b=d.business&&d.business.snapshot||{},cm=b.commerce||{},sales=cm.available?(b.window?cm.live_in_window:cm.live):null;
    if(S.site!=='__first_party__')return card('Action & business','McCluster first-party','<p>Select McCluster first-party to see participation and commerce.</p>');
    var community=b.mnet||{},windowCount=function(k){return community[k]&&community[k].created_in_window;};
    return '<div class="cu-grid">'+card('Equity Uprise','Assignment states · all time',rows([['Mission joins',num(sum(d.missions,'joined'))],['In progress',num(sum(d.missions,'in_progress'))],['Awaiting proof review',num(sum(d.missions,'submitted'))],['Verified assignments',num(sum(d.missions,'verified'))]])+link('Open operations','work:operations'))+
      card('Sales & delivery',(S.range&&S.range.label||'Selected range')+' · all countries',rows([['Verified net sales',cash(sales&&sales.net_cents)],['Refunded',cash(sales&&sales.refunded_cents)],['Bookings',num(sales&&sales.bookings&&sales.bookings.total)],['Waiting for a time',num(sales&&sales.bookings&&sales.bookings.proposed)]])+link('Open payments','work:payments'))+card('Community activity',(S.range&&S.range.label||'Selected range')+' · first-party',rows([['New profiles',num(windowCount('profiles'))],['Posts',num(windowCount('posts'))],['Reactions',num(windowCount('reactions'))],['Follows',num(windowCount('follows'))]]))+'</div>'+card('Stored datasets','Counts and collection health','<p>Inspect the measured data behind these views.</p>'+button('Open dataset explorer','inventory'))+
      '<section class="cu-card cu-workspace"><h2>Workspaces</h2><nav aria-label="Backend workspaces">'+WORKSPACE.map(function(x){return link(x[0],x[1]);}).join('')+'</nav></section>';
  }
  function geography(a,S,h){
    var pts=(a.points||[]).slice(0,4),mx=Math.max.apply(null,pts.map(function(p){return p.value;}).concat([1]));
    return '<h2>'+esc(S.geo.layer==='intel'?'Evidence geography':'Audience geography')+'</h2><p class="cu-note">'+(a.awaiting?esc(a.unavailable||'Loading geography…'):S.geo.layer==='visitors'?pts.length+' leading countries · unique visitors':num(a.located)+' located · '+num(a.suppressed)+' folded · '+num(a.unknown)+' unknown')+'</p><div class="cu-heat-legend" aria-label="Heat intensity: fewer to more"><span>Fewer</span><i></i><span>More</span></div><div class="cu-georows">'+pts.map(function(p){return '<button data-cra-region="'+esc(p.code)+'" type="button" aria-pressed="'+(S.geo.region===p.code)+'"><span>'+esc(p.name||h.countryName(p.code))+'</span><b>'+num(p.value)+'</b><i style="width:'+Math.max(0,Math.min(100,p.value/mx*100))+'%"></i></button>';}).join('')+'</div><small>'+esc(S.geo.layer==='intel'?'Owner evidence · includes unreviewed':S.geo.layer==='signups'?'Signups · IP-derived country':S.geo.layer==='visitors'?'Unique visitors · IP-derived country':'Page views · IP-derived country')+'</small>';
  }
  function datasetRows(state){
    var data=state&&state.data.coverage,items=data&&data.datasets||[],summary=data&&data.summary||{};
    if(state&&state.site!=='__first_party__')return card('Stored datasets','House organization','<p>Select McCluster first-party to inspect the internal data inventory.</p>');
    if(state&&state.errors.coverage)return card('Stored datasets','Read unavailable','<p role="alert">'+esc(state.errors.coverage.message||'Could not read dataset status.')+'</p><button data-cu-coverage-retry type="button">Retry dataset reads</button>');
    if(!data)return card('Stored datasets','Measured on demand','<p role="status">Reading dataset counts and latest activity…</p>');
    if(!Array.isArray(data.datasets))return coverage(state)+'<p class="cu-warning">Detailed dataset health is not available from this API version.</p>';
    var shown=items.filter(function(d){return (!H.family||d.family===H.family)&&(!H.datasetStatus||d.state===H.datasetStatus||['missing','unavailable'].includes(H.datasetStatus)&&d.window_status===H.datasetStatus||H.datasetStatus==='attention'&&(['empty','quiet','missing','unavailable'].includes(d.state)||['missing','unavailable'].includes(d.window_status)))&&(d.label+' '+d.family+' '+d.scope).toLowerCase().includes(H.datasetQuery.toLowerCase());});
    var states={populated:'Has records',empty:'Empty',quiet:'No recent records',missing:'Storage missing',unavailable:'Read failed'};
    var filters='<div class="cu-dataset-filters"><label>Find a dataset<input id="cuDatasetSearch" type="search" value="'+esc(H.datasetQuery)+'" placeholder="News, missions, social…"></label><label>Family<select id="cuDatasetFamily"><option value="">All families</option>'+Array.from(new Set(items.map(function(d){return d.family;}))).map(function(f){return '<option'+(H.family===f?' selected':'')+'>'+esc(f)+'</option>';}).join('')+'</select></label><label>Status<select id="cuDatasetStatus"><option value="">All statuses</option>'+[['attention','Needs attention'],['populated','Has records'],['empty','Empty'],['quiet','No recent records'],['missing','Storage missing'],['unavailable','Read failed']].map(function(x){return '<option value="'+x[0]+'"'+(H.datasetStatus===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label></div>';
    var selected=items.find(function(d){return d.key===H.dataset;});
    var detail=selected?card(selected.label,selected.family+' · '+selected.scope,
      '<div class="cu-small-metrics">'+fact('Stored records',num(selected.count),'All time')+fact('In selected range',num(selected.window_count),['missing','unavailable'].includes(selected.window_status)?'Range read failed':state.range&&state.range.label||'Selected range')+'</div>'+rows([['Latest stored activity',selected.latest_at?date(selected.latest_at):selected.count===0?'No records':'Unknown'],['Measured by',selected.time_field],['Status',states[selected.state]||'Unknown']])+'<p>'+esc(selected.next_step)+'</p>'+(selected.section[0]==='#'?link('Open workspace',selected.section.slice(1)):button('Open analysis',selected.section))):'';
    return '<section class="cu-card"><div class="cu-heading"><h2>Dataset explorer</h2><button data-cu-coverage-retry type="button"'+(state.coverageLoading===state.seq?' disabled':'')+'>Refresh counts</button></div><p class="cu-note">'+num(summary.datasets)+' datasets · '+num(summary.empty)+' empty · '+num(summary.quiet)+' quiet · '+num(summary.unavailable)+' unavailable. Counts use different units and must not be added together.</p><p class="cu-note">Checked '+esc(date(data.measured_at))+' · '+esc(state.range&&state.range.label||'Selected range')+'. Geography applies only inside supported analysis views.</p>'+filters+'<p class="cu-note">'+shown.length+' matching datasets · select one for details</p><div class="cu-dataset-list">'+shown.map(function(d){return '<button type="button" class="cu-dataset-row" data-cu-dataset="'+esc(d.key)+'" aria-pressed="'+(H.dataset===d.key)+'"><span><b>'+esc(d.label)+'</b><small>'+esc(d.family)+' · '+esc(states[d.state]||'Unknown')+(['missing','unavailable'].includes(d.window_status)?' · range read failed':'')+'</small></span><span><b>'+num(d.window_count)+'</b><small>in range</small></span><span><b>'+num(d.count)+'</b><small>stored</small></span></button>';}).join('')+(shown.length?'':'<p>No datasets match these filters.</p>')+'</div></section><div data-cu-dataset-detail>'+detail+'</div>';
  }

  function eventsInventory(){
    var d=H.eventInventory,list=d&&d.rows||[],provider=d&&d.providers&&d.providers.instagram;
    var nav=provider?card('Instagram provider','Connected account does not establish measured reach.',
      rows([['Accounts connected',num(provider.connected_accounts)],
        ['Imported posts',num(provider.imported_posts)],['Provider insight snapshots',num(provider.metric_snapshots)],
        ['Provider state',provider.status||'Unknown']])+
      (provider.reauthorization_required?'<p role="alert">Meta error 190: authorization needs renewal. '+'Renew the existing Instagram authorization in the server’s Meta integration, then run verified media discovery. Channels lists the account but does not renew its authorization.</p>'+link('View registered channels','create:channels'):'<p>'+esc(provider.next_step||'')+'</p>')):'';
    if(H.eventBusy)return '<p role="status">Reading all stored first-party event names…</p>';
    if(H.eventError)return '<p role="alert">'+esc(H.eventError)+'</p><button type="button" data-cu-events-retry>Retry event inventory</button>';
    if(!d)return '<p>Event-name inventory is measured on demand, with taxonomy and raw/lean reconciliation.</p><button type="button" data-cu-events-retry>Read event inventory</button>';
    var search=H.eventQuery.toLowerCase(),matched=list.filter(function(r){
      return (r.name+' '+(r.taxonomy_stage||'unclassified')).toLowerCase().includes(search);
    });
    var summary='<div class="cu-small-metrics">'+fact('Event names',num(d.summary&&d.summary.names),'First-party; bots counted separately')+
      fact('Unclassified names',num(d.summary&&d.summary.unclassified_names),'Not silently counted as engagement')+
      fact('Unclassified records',num(d.summary&&d.summary.unclassified_events),'Stored raw events, all time')+
      fact('Raw/lean mismatches',num(d.summary&&d.summary.mismatched_names),'Must be investigated, not backfilled blindly')+'</div>';
    var filters='<label class="cu-search">Find event name or stage<input id="cuEventQuery" type="search" value="'+esc(H.eventQuery)+'" placeholder="music_play, unclassified…"></label>';
    var body='<div class="cu-dataset-list">'+matched.slice(0,H.eventLimit).map(function(r){
      return '<details class="cu-dataset-row"><summary><b>'+esc(r.name)+'</b><small>'+esc(r.taxonomy_stage||'Unclassified')+' · 24h '+num(r.recent_24h)+' · 7d '+num(r.recent_7d)+' · lifetime '+num(r.raw_total)+'</small></summary>'+
        rows([['Raw events',num(r.raw_total)],['Lean projection',num(r.lean_total)],['Bot events',num(r.bot_rows)],
        ['First recorded',date(r.first_seen_at)],['Last recorded',date(r.last_seen_at)],
        ['Classification',r.taxonomy_stage||'Unclassified'],
        ['Interpretation',r.taxonomy_note||'No reviewed stage yet. Do not infer a completed action.']])+'</details>';
    }).join('')+'</div>';
    return card('Event dictionary','Raw vs lean, observed and unclassified records; client outcomes are not verified accounts, payments or mission completions.',
      '<p>Checked '+esc(date(d.measured_at))+'. '+(d.partial?'Provider source incomplete.':'Live database read, not a frozen snapshot.')+'</p>'+summary+filters+
      '<p>'+num(matched.length)+' matching names · showing '+num(Math.min(matched.length,H.eventLimit))+'. Taxonomy stages are review classifications, not proof of real-world outcomes.</p>'+body+
      (matched.length>H.eventLimit?'<button type="button" data-cu-more-events>Show more event names</button>':'')) +nav;
  }
  async function loadEvents(request,paint,force){
    if(H.eventBusy||(!force&&H.eventInventory))return;
    H.eventBusy=true;H.eventError=null;
    try{
      var d=await request('/v1/analytics/event-inventory');
      if(!d||d.ok!==true||!Array.isArray(d.rows))throw Error('Event inventory unavailable');
      H.eventInventory=d;
    }catch(e){H.eventError='Unable to read event inventory. Check owner access and data service.';}
    finally{H.eventBusy=false;paint();}
  }

  function inventory(){
    var state=window.CR.analytics&&window.CR.analytics.state;
    var nav='<nav class="cu-inventory-tabs" aria-label="Data coverage tools">'+[['datasets','Datasets'],['events','Events'],['connections','Connections'],['fields','Field directory']].map(function(x){return '<button type="button" data-cu-panel="'+x[0]+'" aria-pressed="'+(H.panel===x[0])+'">'+x[1]+'</button>';}).join('')+'</nav>';
    if(H.panel==='datasets')return nav+datasetRows(state);
    if(H.panel==='events')return nav+eventsInventory();
    if(H.panel==='connections')return nav+(window.CR.analyticsDeck&&state?window.CR.analyticsDeck.health(state):'');
    var list=H.inventory&&H.inventory.relations||[],matches=list.filter(function(r){return (r.name+' '+r.columns.join(' ')).toLowerCase().includes(H.fieldQuery.toLowerCase());});
    return nav+'<section class="cu-card"><h2>Field directory</h2><p>Application tables and views audited '+esc(H.inventory&&H.inventory.audited_at||'—')+'. Field metadata is not a measured dataset.</p>'+(H.inventoryError?'<p role="alert">'+esc(H.inventoryError)+'</p><button data-cu-inventory-retry type="button">Retry directory</button>':!H.inventory?'<p role="status">Loading the field directory…</p>':'<label class="cu-search">Search every application field<input id="cuFieldSearch" type="search" value="'+esc(H.fieldQuery)+'" placeholder="Missions, payments, camera, attribution…"></label><p>'+list.length+' tables and views · '+matches.length+' matches</p><div class="cu-records">'+matches.slice(0,H.fieldLimit).map(function(r){return '<details><summary>'+esc(r.name)+'<small>'+r.columns.length+' fields</small></summary><p>'+r.columns.map(esc).join(' · ')+'</p></details>';}).join('')+'</div>'+(matches.length>H.fieldLimit?'<button data-cu-more-fields type="button">Show more fields</button>':''))+'</section>';
  }
  async function loadInventory(paint){
    if(H.inventoryBusy||H.inventory||H.inventoryError)return;H.inventoryBusy=true;
    try{var r=await fetch('data/analytics/application-schema-inventory.json');if(!r.ok)throw Error('Field directory unavailable');var d=await r.json();if(!Array.isArray(d.relations))throw Error('Invalid field directory');H.inventory=d;}catch(e){H.inventoryError=e.message;}finally{H.inventoryBusy=false;paint();}
  }
  function recordsHtml(){
    if(H.reading)return '<p role="status">Reading this source…</p>';
    if(H.recordError)return '<p class="cu-warning" role="alert">'+esc(H.recordError)+'</p>';
    if(!H.records)return '<p>Select a source to inspect its stored records or request a snapshot.</p>';
    var r=H.result||{},records=H.records;
    return '<div class="cu-record-head">'+badge(r.fetched_at?'Snapshot':'Archive')+'<span>'+num(records.length)+' returned records · showing up to 50</span></div><p class="cu-note">'+esc(r.attribution||'Source attribution is retained with each record.')+(r.note?' · '+esc(r.note):'')+(r.fetched_at?' · Retrieved '+esc(date(r.fetched_at)):' · Latest stored records, all dates')+'</p>'+(records.length?'<div class="cu-records">'+records.slice(0,50).map(function(x){var at=x.observed_at||x.last_seen_at;return '<details><summary><span>'+esc(x.name||x.external_id||x.entity_type||'Record')+'</span><small>'+esc(date(at))+'</small></summary><dl class="cu-rows"><div><dt>Source</dt><dd>'+esc(x.source_key||H.source)+'</dd></div><div><dt>Type</dt><dd>'+esc(x.entity_type||'Observation')+'</dd></div></dl><pre>'+esc(JSON.stringify({properties:x.properties||{},provenance:x.provenance||{},location:x.point||x.location||null},null,2).slice(0,12000))+'</pre></details>';}).join('')+'</div>':'<p>No records returned. This does not establish global coverage.</p>')+(Array.isArray(H.runs)?'<h3>Recent ingestion attempts</h3>'+rows(H.runs.slice(0,5).map(function(x){return [date(x.started_at),String(x.status||'Unknown')+' · '+num(x.records_written)+' written'];})): '');
  }
  function worldContext(){
    return card('World context','World Bank · latest published annual observations, not live',
      '<form id="cuWorldContext"><label class="cu-search">Economy code (WLD or two-letter country code)<input id="cuEconomy" maxlength="3" value="'+esc(W.economy)+'" placeholder="WLD, US, GB"></label><button type="submit">'+(W.busy?'Loading…':'Load indicators')+'</button></form><p class="cu-note">Country-level context only. These figures do not describe a selected state, city, your audience or your revenue.</p>'+
      (W.error?'<p role="alert">'+esc(W.error)+'</p>':'')+
      (W.data?'<p>'+esc(W.data.observations[0]&&W.data.observations[0].geography.name||W.economy)+(W.data.mixed_periods?' · Observation years differ':'')+'</p><div class="cu-small-metrics">'+W.data.observations.map(function(o){return fact(o.label,o.value==null?'—':new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:2}).format(o.value),o.unit+' · '+(o.period||'No observation'));}).join('')+'</div><p class="cu-note">Retrieved '+esc(date(W.data.observations[0]&&W.data.observations[0].retrieved_at))+'</p><a href="https://data.worldbank.org/" target="_blank" rel="noopener noreferrer">World Bank data ↗</a> · <a href="https://data.worldbank.org/summary-terms-of-use" target="_blank" rel="noopener noreferrer">Source terms ↗</a>':'')
    );
  }
  async function loadWorld(request,paint,economy){
    var seq=++W.seq;W.economy=economy;W.data=null;W.error=null;W.busy=true;paint();
    try{if(!/^(WLD|[A-Z]{2})$/.test(economy))throw Error('Use WLD or a two-letter country code.');var d=await request('/v1/intel/world-indicators?economy='+encodeURIComponent(economy));if(!d||d.schema!=='world-indicators/v1'||!Array.isArray(d.observations))throw Error('World indicators unavailable');if(seq===W.seq)W.data=d;}
    catch(e){if(seq===W.seq)W.error=e.message||'World indicators unavailable';}finally{if(seq===W.seq){W.busy=false;paint();}}
  }
  function collectionHealth(){
    var h=H.health;
    if(!h)return card('Earthquake collection','USGS · existing ingestion pipeline','<p>'+esc(H.healthError||'Reading collector health…')+'</p>');
    return card('Earthquake collection','USGS M2.5+ · stored history, separate from provider snapshots',rows([
      ['Collector',!h.collector?'Unknown':h.collector.enabled?'Enabled':'Off'],['Evidence storage',h.schema_ready?'Ready':'Not provisioned'],
      ['Latest attempt',h.latest_run?String(h.latest_run.status||'Unknown')+' · '+date(h.latest_run.started_at):'No recorded attempts'],
      ['Last successful run',h.last_successful_run?date(h.last_successful_run.finished_at||h.last_successful_run.started_at):'None recorded']
    ])+'<p class="cu-note">'+(!h.collector?'Collector configuration is unknown.':!h.collector.enabled?'Collection is off. Provider snapshots do not populate the archive.':'Enabled describes configuration. Check the latest attempt and stored datasets to confirm receipt.')+'</p>'+button('Inspect stored datasets','inventory'));
  }
  function intelligence(){
    var news=(window.CR.connections?window.CR.connections.render():'')+(window.CR.newsContext?window.CR.newsContext.render():'');
    if(H.busy&&!H.sources)return news+card('World intelligence','Halo / GEV source families','<p role="status">Reading source permissions and readiness…</p>');
    var sources=H.sources||[],shown=sources.filter(function(s){return (s.name+' '+s.key+' '+(s.capabilities||[]).join(' ')).toLowerCase().includes(H.query.toLowerCase());}),selected=sources.find(function(s){return s.key===H.source;});
    var ready=H.readiness&&H.readiness.database_schema_ready,warning=H.error?'<p class="cu-warning" role="alert">'+esc(H.error)+'</p>':ready===false?'<p class="cu-warning">Spatial archive is not provisioned. Authorized transient snapshots remain available; saved history is unavailable.</p>':'';
    return news+collectionHealth()+worldContext()+'<section class="cu-card"><div class="cu-heading"><h2>World intelligence</h2>'+button('Camera coverage','cameras')+'<button data-cu-refresh type="button">Refresh status</button></div><p>Transport, space, cameras, environment, infrastructure, economics and public records. Source permissions are enforced by the existing McCluster data plane.</p>'+warning+'<p class="cu-note">Status describes configuration, not a live feed. Halo retains its own provider credentials. These reads use McCluster’s existing broker.</p><label class="cu-search">Find a source<input id="cuSourceSearch" value="'+esc(H.query)+'" placeholder="Cameras, aircraft, weather, grants…" type="search"></label><p class="cu-note">'+sources.length+' registered sources · '+shown.length+' matching</p><div class="cu-source-grid">'+shown.map(function(s){return '<button type="button" data-cu-source="'+esc(s.key)+'" class="cu-source'+(s.key===H.source?' is-on':'')+'"><b>'+esc(s.name)+'</b><span>'+esc((s.capabilities||[]).join(' · '))+'</span><small>'+esc(sourceStatus(s))+' · '+esc(s.persistence)+'</small></button>';}).join('')+'</div></section>'+(selected?'<section class="cu-card"><h2>'+esc(selected.name)+'</h2><p>'+esc(selected.attribution||'Provider attribution applies.')+'</p><div class="cu-actions"><button data-cu-archive type="button"'+(ready===false||H.reading?' disabled':'')+'>Read stored records</button></div><form id="cuSnapshot"><label>Query parameters (JSON)<textarea id="cuParameters" data-source="'+esc(H.source)+'" rows="3" spellcheck="false">'+esc(H.parameters||'{}')+'</textarea></label><p class="cu-note">One requested snapshot. No automatic polling or archiving. Example coordinates are New Haven, Connecticut; change them for your query. Open Cameras for measured catalog coverage and image checks.</p><button type="submit"'+(H.reading||selected.entitlement&&selected.entitlement.allowed===false||selected.credential_required&&!selected.configured?' disabled':'')+'>Read provider snapshot</button></form>'+recordsHtml()+'</section>':'');
  }
  async function load(request,paint){
    if(H.busy)return;var seq=++H.seq;H.busy=true;H.error=null;paint();
    var rs=await Promise.allSettled([request('/v1/seek-first/sources?lane=INTERNAL'),request('/v1/seek-first/readiness'),request('/v1/intel/health')]);
    if(seq!==H.seq)return;H.busy=false;H.sources=null;H.readiness=null;H.health=null;H.healthError=null;
    if(rs[2].status==='fulfilled'&&typeof rs[2].value.schema_ready==='boolean')H.health=rs[2].value;else H.healthError='Collector health could not be read.';
    if(rs[0].status==='fulfilled'&&Array.isArray(rs[0].value.sources))H.sources=rs[0].value.sources;else H.error='Source catalog unavailable: '+(rs[0].reason&&rs[0].reason.message||'Invalid response');
    if(rs[1].status==='fulfilled'&&typeof rs[1].value.database_schema_ready==='boolean')H.readiness=rs[1].value;else H.error=(H.error?H.error+' · ':'')+'Readiness could not be verified.';
    paint();
  }
  async function read(request,paint,snapshot,parameters){
    var source=H.sources&&H.sources.find(function(s){return s.key===H.source;});if(!source||H.reading)return;
    var seq=++H.seq;H.reading=true;H.records=null;H.result=null;H.runs=null;H.recordError=null;paint();
    try{
      if(snapshot){var body=Object.assign({},parameters,{lane:'INTERNAL',persist:false,include_raw:false});var d=await request('/v1/seek-first/fetch/'+encodeURIComponent(source.key),{method:'POST',body:body});if(!d.result||!Array.isArray(d.result.records))throw Error('Invalid snapshot response');if(seq!==H.seq)return;H.result=d.result;H.records=d.result.records;}
      else {var results=await Promise.allSettled([request('/v1/seek-first/entities?source='+encodeURIComponent(source.key)+'&limit=50'),request('/v1/seek-first/ingestion-runs?source='+encodeURIComponent(source.key)+'&limit=5')]);if(seq!==H.seq)return;if(results[0].status!=='fulfilled'||!Array.isArray(results[0].value.entities))throw results[0].reason||Error('Archive response unavailable');H.records=results[0].value.entities;if(results[1].status==='fulfilled')H.runs=results[1].value.runs;}
    }catch(e){if(seq===H.seq)H.recordError=e.message||'Source read failed';}finally{if(seq===H.seq){H.reading=false;paint();}}
  }
  function bind(root,request,paint){
    if(window.CR.newsContext)window.CR.newsContext.bind(root,request,paint);
    if(window.CR.connections)window.CR.connections.bind(root,request,paint);
    root.querySelectorAll('[data-cu-panel]').forEach(function(b){b.onclick=function(){H.panel=b.dataset.cuPanel;if(H.panel==='events')loadEvents(request,paint);paint();};});
    root.querySelectorAll('[data-cu-dataset]').forEach(function(b){b.onclick=function(){H.dataset=b.dataset.cuDataset;paint();var host=window.CR.analytics.state.host;var detail=host&&host.querySelector('[data-cu-dataset-detail]');if(detail)detail.scrollIntoView({block:'nearest'});};});
    [['#cuDatasetSearch','datasetQuery'],['#cuDatasetFamily','family'],['#cuDatasetStatus','datasetStatus']].forEach(function(x){var el=root.querySelector(x[0]);if(el)el[x[0]==='#cuDatasetSearch'?'oninput':'onchange']=function(){H[x[1]]=el.value;H.dataset='';paint();};});
    var retry=root.querySelector('[data-cu-coverage-retry]');if(retry)retry.onclick=function(){window.CR.analytics.loadCoverage(true);};
    var er=root.querySelector('[data-cu-events-retry]');if(er)er.onclick=function(){H.eventInventory=null;loadEvents(request,paint,true);};
    var evq=root.querySelector('#cuEventQuery');if(evq)evq.oninput=function(){H.eventQuery=evq.value;H.eventLimit=50;paint();};
    var moreEvents=root.querySelector('[data-cu-more-events]');if(moreEvents)moreEvents.onclick=function(){H.eventLimit+=50;paint();};
    var directoryRetry=root.querySelector('[data-cu-inventory-retry]');if(directoryRetry)directoryRetry.onclick=function(){H.inventoryError=null;loadInventory(paint);};

    var world=root.querySelector('#cuWorldContext');if(world)world.onsubmit=function(e){e.preventDefault();loadWorld(request,paint,root.querySelector('#cuEconomy').value.trim().toUpperCase());};
    var field=root.querySelector('#cuFieldSearch');if(field)field.oninput=function(){H.fieldQuery=field.value;H.fieldLimit=30;paint();};var more=root.querySelector('[data-cu-more-fields]');if(more)more.onclick=function(){H.fieldLimit+=30;paint();};
    var refresh=root.querySelector('[data-cu-refresh]');if(refresh)refresh.onclick=function(){load(request,paint);};
    var search=root.querySelector('#cuSourceSearch');if(search)search.oninput=function(){H.query=search.value;paint();};
    root.querySelectorAll('[data-cu-source]').forEach(function(b){b.onclick=function(){++H.seq;H.reading=false;H.source=b.dataset.cuSource;H.records=null;H.result=null;H.recordError=null;H.parameters=JSON.stringify(H.source==='cctv'?{provider:'austin',limit:100}:H.source==='celestrak'?{group:'stations'}:['usgs','open_meteo','adsb_lol','overpass','nominatim','tomtom'].includes(H.source)?{lat:41.31,lon:-72.93}: {},null,2);paint();};});
    var archive=root.querySelector('[data-cu-archive]');if(archive)archive.onclick=function(){read(request,paint,false);};
    var form=root.querySelector('#cuSnapshot');if(form)form.onsubmit=function(e){e.preventDefault();H.parameters=root.querySelector('#cuParameters').value;try{var p=JSON.parse(H.parameters);if(!p||Array.isArray(p)||typeof p!=='object')throw Error('Use a JSON object.');if(Object.keys(p).some(function(k){return /token|secret|password|api.?key|credential/i.test(k);}))throw Error('Provider credentials stay in server settings.');read(request,paint,true,p);}catch(e){H.recordError=e.message;paint();}};
  }
  function clearPrivate(){
    ++H.seq;++W.seq;H.health=null;H.healthError=null;H.sources=null;H.readiness=null;H.error=null;H.busy=false;H.source='';H.records=null;H.result=null;H.runs=null;H.recordError=null;H.reading=false;H.inventory=null;H.inventoryError=null;H.inventoryBusy=false;H.eventInventory=null;H.eventError=null;H.eventBusy=false;H.eventQuery='';W.data=null;W.error=null;W.busy=false;
  }
  window.CR.analyticsUnified={overview:overview,operations:operations,coverage:coverage,datasetRows:datasetRows,geography:geography,inventory:inventory,loadInventory:loadInventory,intelligence:intelligence,load:load,bind:bind,state:H,worldState:W,worldContext:worldContext,loadWorld:loadWorld,sourceStatus:sourceStatus,clearPrivate:clearPrivate};
})();
