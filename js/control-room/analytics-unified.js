/* One owner overview over existing reads. Provider snapshots stay transient;
   a configured adapter is not evidence that a feed or archive is populated. */
(function(){
  'use strict';
  window.CR=window.CR||{};
  var H={sources:null,readiness:null,error:null,busy:false,source:'',query:'',inventory:null,inventoryError:null,inventoryBusy:false,fieldQuery:'',fieldLimit:30,records:null,runs:null,result:null,recordError:null,reading:false,seq:0};
  var DOMAINS=[
    ['Traffic & journeys','Page views, sessions, returning visitors, referrers, devices, geography, paths and funnels.','audience'],
    ['Music & media','Starts, previews, full listens, completions, catalog, rights and media assets.','content'],
    ['Identity & conversion','Accounts, verified identity, signup attribution and song-to-account journeys.','identity'],
    ['Adaptive experience','Experiments, policies, decisions, exposure and outcome measurements.','adaptive'],
    ['Site quality','Script errors, injected errors, dead clicks and interrupted journeys.','forensics'],
    ['Community & missions','Campaigns, assignments, proof reviews, bounty and creator ledgers, cohorts and live rooms.','#work:operations'],
    ['Clients & commerce','Contacts, relationships, projects, deliverables, bookings, renewals, payments and refunds.','#work:projects'],
    ['Publishing & communications','Social accounts, publishing queues, inbox conversations, outreach and delivery events.','#create:schedule'],
    ['Research & evidence','Sources, claims, citations, publications, civic records and research artifacts.','#apps'],
    ['System & resources','Jobs, approvals, audit events, compute usage, provider spend and execution traces.','#system:observability']
  ];
  var WORKSPACE=[['Inbox','work:inbox'],['People','work:people'],['Projects','work:projects'],['Payments','work:payments'],['Renewals','work:renewals'],['Publishing','create:schedule'],['Library','create:library'],['Music','create:music'],['McCluster AI','ai'],['Apps','apps']];
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(v){return v==null||v===''||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString();}
  function cash(v){return v==null||!Number.isFinite(Number(v))?'—':new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(v/100);}
  function badge(text){return '<span class="cu-badge">'+esc(text)+'</span>';}
  function link(text,hash){return '<a href="#'+esc(hash)+'">'+esc(text)+' ↗</a>';}
  function button(text,section){return '<button type="button" data-cra-sec="'+esc(section)+'">'+esc(text)+' ↗</button>';}
  function card(title,sub,body){return '<section class="cu-card"><div class="cu-heading"><h2>'+esc(title)+'</h2></div><p class="cu-note">'+esc(sub)+'</p>'+body+'</section>';}
  function fact(label,value,sub){return '<div class="cu-fact"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(sub||'')+'</small></div>';}
  function rows(items){return '<dl class="cu-rows">'+items.map(function(x){return '<div><dt>'+esc(x[0])+'</dt><dd>'+esc(x[1])+'</dd></div>';}).join('')+'</dl>';}
  function date(v){if(!v)return 'Unknown';var d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString():'Unknown';}
  function sum(a,k){return Array.isArray(a)?a.reduce(function(n,r){return n+(Number(r[k])||0);},0):null;}
  function sourceStatus(s){if(s.entitlement&&s.entitlement.allowed===false)return 'Access restricted';if(s.credential_required&&!s.configured)return 'Needs configuration';return s.credential_required?'Configured · not checked':'Keyless · not checked';}
  function overview(S,h){
    var d=S.data,t=(d.traffic||{}).totals||{},b=d.business&&d.business.snapshot||{},house=S.site==='__first_party__',science=d.audienceScience||{},aud=science.totals||{},cm=b.commerce||{},sales=cm.available?(b.window?cm.live_in_window:cm.live):null;
    var tracks=Array.isArray(d.content)?d.content:[],scope=S.range&&S.range.label||'Selected range';
    var metrics='<div class="cu-metrics">'+fact('Page views',num(t.page_views),scope+' · property-wide')+fact('Visitors',num(t.visitors),'Distinct · property-wide')+fact('New accounts',num(b.users&&b.users.created_in_window),house?scope:'First-party only')+fact('Verified sales',cash(sales&&sales.net_cents),'Net of refunds · live payments')+'</div>';
    var f=d.funnel,keys=[['arrived','Arrived'],['heard_something','Listened'],['made_an_account','Signed up'],['paid','Paid']];
    var funnel='<div class="cu-funnel">'+keys.map(function(k){return '<div><small>'+k[1]+'</small><b>'+num(S.errors.funnel||!S.completed||!S.completed.funnel?null:sum(f,k[0]))+'</b></div>';}).join('')+'</div>';
    var reach=card('Reach & conversion',h.scopeLabel(),h.chart+(house?funnel+'<p class="cu-note">Funnel: first-party, all countries</p>':'')+button('Explore journeys','identity'));
    var music=card('Music & content',scope+' · all countries','<div class="cu-small-metrics">'+fact('Track starts',num(S.errors.content||!S.completed||!S.completed.content?null:sum(tracks,'starts')))+fact('Listeners',num(aud.music_listeners))+fact('Returning',num(aud.returning_listeners))+'</div>'+h.bars(tracks.slice().sort(function(a,b){return Number(b.starts)-Number(a.starts);}).slice(0,3),'track','starts',3)+button('Explore music','content'));
    var missions=card('Action Network','Assignment states · all time',rows([['Mission joins',num(sum(d.missions,'joined'))],['Awaiting proof review',num(sum(d.missions,'submitted'))],['Verified assignments',num(sum(d.missions,'verified'))]])+link('Open operations','work:operations'));
    var work=card('Sales & delivery',scope+' · all countries',rows([['Bookings',num(sales&&sales.bookings&&sales.bookings.total)],['Waiting for a time',num(sales&&sales.bookings&&sales.bookings.proposed)],['Refunded',cash(sales&&sales.refunded_cents)]])+(cm.available===false?'<p class="cu-note">Sales records unavailable</p>':'')+link('Open work','work:projects'));
    var errs=d.errors&&d.errors.totals;
    var workspace='<section class="cu-card cu-workspace"><h2>Workspace</h2><nav aria-label="Backend workspaces">'+WORKSPACE.map(function(x){return link(x[0],x[1]);}).join('')+'</nav><div class="cu-system">'+link('System','system:overview')+'<span>'+num(errs&&errs.site_errors)+' site errors · '+num(errs&&errs.friction)+' friction events</span>'+link('Jobs','system:workload')+link('Providers','system:resources')+link('Traces','system:observability')+'</div></section>';
    return metrics+'<div class="cu-grid">'+reach+music+(house?missions+work:'')+'</div>'+workspace+'<section class="cu-card cu-intro"><div><h2>World intelligence</h2><p>Halo sources, camera catalogs, transport, space, environment and public records.</p></div>'+button('Explore sources','intelligence')+'</section>';
  }
  function geography(a,S,h){
    var pts=(a.points||[]).slice(0,4),mx=Math.max.apply(null,pts.map(function(p){return p.value;}).concat([1]));
    return '<h2>'+esc(S.geo.layer==='intel'?'Evidence geography':'Audience geography')+'</h2><p class="cu-note">'+(a.awaiting?esc(a.unavailable||'Loading geography…'):num(a.located)+' located · '+num(a.suppressed)+' folded · '+num(a.unknown)+' unknown')+'</p><div class="cu-georows">'+pts.map(function(p){return '<button data-cra-region="'+esc(p.code)+'" type="button" aria-pressed="'+(S.geo.region===p.code)+'"><span>'+esc(p.name||h.countryName(p.code))+'</span><b>'+num(p.value)+'</b><i style="width:'+Math.max(0,Math.min(100,p.value/mx*100))+'%"></i></button>';}).join('')+'</div><small>'+esc(S.geo.layer==='intel'?'Accepted evidence · coarse cells':S.geo.layer==='signups'?'Signups · IP-derived country':'Page views · IP-derived country')+'</small>';
  }
  function inventory(){
    var families='<div class="cu-grid">'+DOMAINS.map(function(d){return card(d[0],'Existing data family','<p>'+esc(d[1])+'</p>'+(d[2][0]==='#'?link('Open workspace',d[2].slice(1)):button('Open details',d[2])));}).join('')+'</div>';
    var list=H.inventory&&H.inventory.relations||[],matches=list.filter(function(r){return (r.name+' '+r.columns.join(' ')).toLowerCase().includes(H.fieldQuery.toLowerCase());});
    return families+'<section class="cu-card"><h2>Field directory</h2><p>Application tables and views audited 16 October 2026. This is a field inventory; row values, credentials and private authentication schemas are excluded.</p>'+(H.inventoryError?'<p role="alert">'+esc(H.inventoryError)+'</p>':!H.inventory?'<p role="status">Loading the field directory…</p>':'<label class="cu-search">Search every application field<input id="cuFieldSearch" type="search" value="'+esc(H.fieldQuery)+'" placeholder="Missions, payments, camera, attribution…"></label><p>'+list.length+' tables and views · '+matches.length+' matches</p><div class="cu-records">'+matches.slice(0,H.fieldLimit).map(function(r){return '<details><summary>'+esc(r.name)+'<small>'+r.columns.length+' fields</small></summary><p>'+r.columns.map(esc).join(' · ')+'</p></details>';}).join('')+'</div>'+(matches.length>H.fieldLimit?'<button data-cu-more-fields type="button">Show more fields</button>':''))+'</section>';
  }
  async function loadInventory(paint){
    if(H.inventoryBusy||H.inventory||H.inventoryError)return;H.inventoryBusy=true;
    try{var r=await fetch('docs/analytics/application-schema-inventory.json');if(!r.ok)throw Error('Field directory unavailable');var d=await r.json();if(!Array.isArray(d.relations))throw Error('Invalid field directory');H.inventory=d;}catch(e){H.inventoryError=e.message;}finally{H.inventoryBusy=false;paint();}
  }
  function recordsHtml(){
    if(H.reading)return '<p role="status">Reading this source…</p>';
    if(H.recordError)return '<p class="cu-warning" role="alert">'+esc(H.recordError)+'</p>';
    if(!H.records)return '<p>Select a source to inspect its stored records or request a snapshot.</p>';
    var r=H.result||{},records=H.records;
    return '<div class="cu-record-head">'+badge(r.fetched_at?'Snapshot':'Archive')+'<span>'+num(records.length)+' returned records · showing up to 50</span></div><p class="cu-note">'+esc(r.attribution||'Source attribution is retained with each record.')+(r.note?' · '+esc(r.note):'')+(r.fetched_at?' · Retrieved '+esc(date(r.fetched_at)):' · Latest stored records, all dates')+'</p>'+(records.length?'<div class="cu-records">'+records.slice(0,50).map(function(x){var at=x.observed_at||x.last_seen_at;return '<details><summary><span>'+esc(x.name||x.external_id||x.entity_type||'Record')+'</span><small>'+esc(date(at))+'</small></summary><dl class="cu-rows"><div><dt>Source</dt><dd>'+esc(x.source_key||H.source)+'</dd></div><div><dt>Type</dt><dd>'+esc(x.entity_type||'Observation')+'</dd></div></dl><pre>'+esc(JSON.stringify({properties:x.properties||{},provenance:x.provenance||{},location:x.point||x.location||null},null,2).slice(0,12000))+'</pre></details>';}).join('')+'</div>':'<p>No records returned. This does not establish global coverage.</p>')+(Array.isArray(H.runs)?'<h3>Recent ingestion attempts</h3>'+rows(H.runs.slice(0,5).map(function(x){return [date(x.started_at),String(x.status||'Unknown')+' · '+num(x.records_written)+' written'];})): '');
  }
  function intelligence(){
    if(H.busy&&!H.sources)return card('World intelligence','Halo / GEV source families','<p role="status">Reading source permissions and readiness…</p>');
    var sources=H.sources||[],shown=sources.filter(function(s){return (s.name+' '+s.key+' '+(s.capabilities||[]).join(' ')).toLowerCase().includes(H.query.toLowerCase());}),selected=sources.find(function(s){return s.key===H.source;});
    var ready=H.readiness&&H.readiness.database_schema_ready,warning=H.error?'<p class="cu-warning" role="alert">'+esc(H.error)+'</p>':ready===false?'<p class="cu-warning">Spatial archive is not provisioned. Authorized transient snapshots remain available; saved history is unavailable.</p>':'';
    return '<section class="cu-card"><div class="cu-heading"><h2>World intelligence</h2><button data-cu-refresh type="button">Refresh status</button></div><p>Transport, space, cameras, environment, infrastructure, economics and public records. Source permissions are enforced by the existing McCluster data plane.</p>'+warning+'<p class="cu-note">Status describes configuration, not a live feed. Halo retains its own provider credentials. These reads use McCluster’s existing broker.</p><label class="cu-search">Find a source<input id="cuSourceSearch" value="'+esc(H.query)+'" placeholder="Cameras, aircraft, weather, grants…" type="search"></label><p class="cu-note">'+sources.length+' registered sources · '+shown.length+' matching</p><div class="cu-source-grid">'+shown.map(function(s){return '<button type="button" data-cu-source="'+esc(s.key)+'" class="cu-source'+(s.key===H.source?' is-on':'')+'"><b>'+esc(s.name)+'</b><span>'+esc((s.capabilities||[]).join(' · '))+'</span><small>'+esc(sourceStatus(s))+' · '+esc(s.persistence)+'</small></button>';}).join('')+'</div></section>'+(selected?'<section class="cu-card"><h2>'+esc(selected.name)+'</h2><p>'+esc(selected.attribution||'Provider attribution applies.')+'</p><div class="cu-actions"><button data-cu-archive type="button"'+(ready===false||H.reading?' disabled':'')+'>Read stored records</button></div><form id="cuSnapshot"><label>Query parameters (JSON)<textarea id="cuParameters" rows="3" spellcheck="false">'+esc(H.parameters||'{}')+'</textarea></label><p class="cu-note">One requested snapshot. No automatic polling or archiving. Example coordinates are New Haven, Connecticut; change them for your query. Camera listings do not prove that a stream is online.</p><button type="submit"'+(H.reading||selected.entitlement&&selected.entitlement.allowed===false||selected.credential_required&&!selected.configured?' disabled':'')+'>Read provider snapshot</button></form>'+recordsHtml()+'</section>':'');
  }
  async function load(request,paint){
    if(H.busy)return;H.busy=true;H.error=null;paint();
    var rs=await Promise.allSettled([request('/v1/seek-first/sources?lane=INTERNAL'),request('/v1/seek-first/readiness')]);
    H.busy=false;H.sources=null;H.readiness=null;
    if(rs[0].status==='fulfilled'&&Array.isArray(rs[0].value.sources))H.sources=rs[0].value.sources;else H.error='Source catalog unavailable: '+(rs[0].reason&&rs[0].reason.message||'Invalid response');
    if(rs[1].status==='fulfilled'&&typeof rs[1].value.database_schema_ready==='boolean')H.readiness=rs[1].value;else H.error=(H.error?H.error+' · ':'')+'Readiness could not be verified.';
    paint();
  }
  async function read(request,paint,snapshot,parameters){
    var source=H.sources&&H.sources.find(function(s){return s.key===H.source;});if(!source||H.reading)return;
    var seq=++H.seq;H.reading=true;H.records=null;H.result=null;H.runs=null;H.recordError=null;paint();
    try{
      if(snapshot){var body=Object.assign({},parameters,{lane:'INTERNAL',persist:false,include_raw:false,limit:Math.min(500,Math.max(1,Number(parameters.limit)||100))});var d=await request('/v1/seek-first/fetch/'+encodeURIComponent(source.key),{method:'POST',body:body});if(!d.result||!Array.isArray(d.result.records))throw Error('Invalid snapshot response');if(seq!==H.seq)return;H.result=d.result;H.records=d.result.records;}
      else {var results=await Promise.allSettled([request('/v1/seek-first/entities?source='+encodeURIComponent(source.key)+'&limit=50'),request('/v1/seek-first/ingestion-runs?source='+encodeURIComponent(source.key)+'&limit=5')]);if(seq!==H.seq)return;if(results[0].status!=='fulfilled'||!Array.isArray(results[0].value.entities))throw results[0].reason||Error('Archive response unavailable');H.records=results[0].value.entities;if(results[1].status==='fulfilled')H.runs=results[1].value.runs;}
    }catch(e){if(seq===H.seq)H.recordError=e.message||'Source read failed';}finally{if(seq===H.seq){H.reading=false;paint();}}
  }
  function bind(root,request,paint){
    var field=root.querySelector('#cuFieldSearch');if(field)field.onchange=function(){H.fieldQuery=field.value;H.fieldLimit=30;paint();};var more=root.querySelector('[data-cu-more-fields]');if(more)more.onclick=function(){H.fieldLimit+=30;paint();};
    var refresh=root.querySelector('[data-cu-refresh]');if(refresh)refresh.onclick=function(){load(request,paint);};
    var search=root.querySelector('#cuSourceSearch');if(search)search.onchange=function(){H.query=search.value;paint();};
    root.querySelectorAll('[data-cu-source]').forEach(function(b){b.onclick=function(){++H.seq;H.reading=false;H.source=b.dataset.cuSource;H.records=null;H.result=null;H.recordError=null;H.parameters=JSON.stringify(H.source==='cctv'?{provider:'austin',limit:100}:H.source==='celestrak'?{group:'stations'}:['usgs','open_meteo','adsb_lol','overpass','nominatim','tomtom'].includes(H.source)?{lat:41.31,lon:-72.93}: {},null,2);paint();};});
    var archive=root.querySelector('[data-cu-archive]');if(archive)archive.onclick=function(){read(request,paint,false);};
    var form=root.querySelector('#cuSnapshot');if(form)form.onsubmit=function(e){e.preventDefault();H.parameters=root.querySelector('#cuParameters').value;try{var p=JSON.parse(H.parameters);if(!p||Array.isArray(p)||typeof p!=='object')throw Error('Use a JSON object.');if(Object.keys(p).some(function(k){return /token|secret|password|api.?key|credential/i.test(k);}))throw Error('Provider credentials stay in server settings.');read(request,paint,true,p);}catch(e){H.recordError=e.message;paint();}};
  }
  window.CR.analyticsUnified={overview:overview,geography:geography,inventory:inventory,loadInventory:loadInventory,intelligence:intelligence,load:load,bind:bind,state:H,sourceStatus:sourceStatus};
})();
