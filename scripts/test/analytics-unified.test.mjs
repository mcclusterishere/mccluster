import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile('js/control-room/analytics-unified.js','utf8');
const main=await readFile('js/control-room/analytics.js','utf8');
function context(){const c={window:{CR:{}},Intl,console,setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(code,c);vm.runInContext(main,c);return c.window.CR;}
test('unified cold state has unknown metrics in overview and content, not invented zero or sample numbers',()=>{
  const C=context(),s=C.analytics.state;
  for(const section of ['overview','content']){
    s.section=section;const out=C.analytics.render();
    assert.match(out,/Track starts<\/small><strong>—/);
    if(section==='overview')assert.match(out,/Verified sales<\/span><strong>—/);
    assert.doesNotMatch(out,/12,480|1,280|3,680|No recorded music activity/);
  }
});
test('successful empty music and funnel reads render actual zero; failed ones remain unknown',()=>{
  const C=context(),s=C.analytics.state;s.completed={content:true,funnel:true};s.data={content:[],funnel:[]};
  for(const section of ['overview','content']){
    s.section=section;s.errors={};let out=C.analytics.render();
    assert.match(out,/Track starts<\/small><strong>0/);
    if(section==='overview')assert.match(out,/Arrived<\/small><b>0/);
    s.errors.content=Error('offline');s.errors.funnel=Error('offline');out=C.analytics.render();
    assert.match(out,/Track starts<\/small><strong>—/);
    if(section==='overview')assert.match(out,/Arrived<\/small><b>—/);
    assert.doesNotMatch(out,/No recorded music activity/);
  }
});
test('only verified live commerce is counted; test payments are never combined',()=>{const C=context(),s=C.analytics.state;s.data.business={snapshot:{window:{},commerce:{available:true,live_in_window:{net_cents:1234,payments:1,bookings:{}},test:{net_cents:999999}}}};const out=C.analyticsUnified.overview(s,{scopeLabel:()=>'',chart:'',bars:()=>''});assert.match(out,/\$12\.34/);assert.doesNotMatch(out,/9,999/);});
test('source catalog reports missing archive independently and escapes provider strings',async()=>{const C=context(),U=C.analyticsUnified;await U.load(async path=>path.includes('/sources')?{sources:[{key:'x',name:'<img src=x onerror=alert(1)>',capabilities:[],configured:true,persistence:'transient',entitlement:{allowed:false}}]}:{database_schema_ready:false},()=>{});const out=U.intelligence();assert.match(out,/not provisioned/);assert.match(out,/Access restricted/);assert.doesNotMatch(out,/<img src=x/);assert.match(out,/&lt;img/);});
test('geography keeps suppression and unknown visible; no identifying coordinates emitted',()=>{const C=context();const out=C.analyticsUnified.geography({located:20,suppressed:3,unknown:2,points:[{code:'US',name:'USA',value:20}]},{geo:{layer:'pageviews'}},{countryName:x=>x});assert.match(out,/20 located · 3 folded · 2 unknown/);assert.doesNotMatch(out,/latitude|longitude/);});

test('overview preserves the production business envelope and audience totals in measured details',()=>{const C=context(),s=C.analytics.state;s.data.business={ok:true,snapshot:{window:{},users:{created_in_window:17}}};s.data.audienceScience={version:'fixture',totals:{music_listeners:43,returning_listeners:12}};const out=C.analytics.render();assert.match(out,/New accounts<\/span><strong>17/);assert.match(out,/Music listeners<\/small><strong>43/);assert.match(out,/Returning listeners<\/small><strong>12/);});
test('selected geography never falls back to global cards or a global trend',()=>{
 const C=context(),s=C.analytics.state;s.geo.places={US:[-97,39,'United States']};s.geo.region='US';s.data.traffic={totals:{visitors:999}};
 for(const section of ['overview','audience']){s.section=section;const out=C.analytics.render();assert.match(out,/Reading this location/);assert.doesNotMatch(out,/999|all countries|Worldwide/);}
 s.geoAudience={data:{schema:'analytics-geo-audience/v1',totals:{visitors:7,sessions:9,returning:2},series:[],sources:[],paths:[],pages:[],stages:[]}};
 assert.match(C.analytics.render(),/Unique visitors<\/small><strong>7/);
 s.geoAudience={error:Error('offline')};assert.match(C.analytics.render(),/offline/);assert.doesNotMatch(C.analytics.render(),/999/);
});
test('field directory searches names and columns and escapes metadata',()=>{const U=context().analyticsUnified;U.state.panel='fields';U.state.inventory={relations:[{name:'orders',columns:['amount_cents','attribution']},{name:'<unsafe>',columns:['title']}]};U.state.fieldQuery='attribution';let out=U.inventory();assert.match(out,/2 tables and views · 1 matches/);assert.match(out,/<summary>orders/);U.state.fieldQuery='';out=U.inventory();assert.match(out,/&lt;unsafe&gt;/);assert.doesNotMatch(out,/<unsafe>/);});

test('snapshot submissions preserve provider defaults and explicit limits while enforcing transient reads',()=>{
  for(const parameters of [{query:'New Haven, CT'},{query:'New Haven, CT',limit:5,persist:true,include_raw:true,lane:'PUBLIC'}]){
    const U=context().analyticsUnified,form={},field={value:JSON.stringify(parameters)};
    U.state.sources=[{key:'mapbox',configured:true}];U.state.source='mapbox';
    const root={querySelector:s=>s==='#cuSnapshot'?form:s==='#cuParameters'?field:null,querySelectorAll:()=>[]};
    let sent;
    U.bind(root,async(path,options)=>{sent={path,...options};return{result:{records:[]}};},()=>{});
    form.onsubmit({preventDefault(){}});
    assert.equal(sent.path,'/v1/seek-first/fetch/mapbox');
    assert.equal(sent.body.limit,parameters.limit,'an omitted limit belongs to the provider adapter');
    assert.equal(sent.body.persist,false);assert.equal(sent.body.include_raw,false);assert.equal(sent.body.lane,'INTERNAL');
  }
});

test('a range refresh clears the previous country series before slow reads return',async()=>{
  const A=context().analytics,s=A.state;
  A.init({request:()=>new Promise(()=>{}),supa:path=>path.startsWith('analytics_sites?')?Promise.resolve([]):new Promise(()=>{})});
  s.geo.places={US:[-97.5,39.5,'United States']};s.geo.region='US';
  s.rangeId='7d';s.range={label:'Old range',since:'2026-09-01',until:'2026-09-07'};
  s.country={code:'US',key:'old',rows:[{bucket:'2026-09-01T00:00:00Z',page_views:777}]};
  A.refresh();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(s.loading,true);assert.equal(s.country,null);
  const out=A.render();assert.match(out,/Reading this location/);assert.doesNotMatch(out,/Page views over time, United States/);
});

test('journeys and adaptive never report empty results while pending or failed',()=>{
  const C=context(),s=C.analytics.state;
  for(const [section,key,loading] of [['identity','identity','Reading signup journeys'],['adaptive','experience','Reading adaptive decisions']]){
    s.section=section;s.completed={};s.errors={};s.data={};
    assert.match(C.analytics.render(),new RegExp(loading));
    assert.doesNotMatch(C.analytics.render(),/No accounts were created|No experience decisions/);
    s.completed[key]=true;s.errors[key]=Error('Service unavailable');
    assert.match(C.analytics.render(),/Service unavailable/);
    assert.doesNotMatch(C.analytics.render(),/No accounts were created|No experience decisions/);
    s.errors={};assert.doesNotMatch(C.analytics.render(),new RegExp(loading));
  }
});

test('external properties never present first-party attention or signup metrics as their own',()=>{
  const C=context(),s=C.analytics.state;s.site='tenant';s.data={traffic:{totals:{page_views:5,sessions:3}}};
  const out=C.analyticsUnified.overview(s,{scopeLabel:()=>'',chart:''});
  assert.doesNotMatch(out,/New accounts|Verified sales|Needs attention|Proof awaiting/);
  assert.match(out,/Property activity/);
  s.section='identity';assert.match(C.analytics.render(),/First-party only/);
});

test('business and community cards read the production snapshot envelope',()=>{
  const C=context(),s=C.analytics.state;
  s.data.business={ok:true,snapshot:{window:{},users:{created_in_window:7},music:{plays:{in_window:42}},mnet:{posts:{created_in_window:13},reactions:{created_in_window:19},follows:{created_in_window:5},profiles:{created_in_window:2}}}};
  const out=C.analyticsUnified.overview(s,{scopeLabel:()=>'',chart:''});
  assert.match(out,/Music plays<\/span><strong>42/);
  assert.match(C.analyticsUnified.operations(s),/Posts<\/dt><dd>13/);
});

test('connection status distinguishes failed, ready-empty, pending and property-inapplicable reads',async()=>{
  const C=context(),c={window:{CR:C},console};vm.createContext(c);
  vm.runInContext(await readFile('js/control-room/analytics-deck.js','utf8'),c);
  const s=C.analytics.state;s.completed={intel:true,content:true};s.errors={intel:Error('<failed>')};
  let out=C.analyticsDeck.health(s);
  assert.match(out,/1 of 23 reads ready/);assert.match(out,/&lt;failed&gt;/);assert.match(out,/Waiting/);
  s.site='tenant';out=C.analyticsDeck.health(s);assert.doesNotMatch(out,/Intelligence evidence|Signup journeys/);
});

test('unique visitor geography is the default, includes small country counts and never sums them into a global unique total',()=>{
 const A=context().analytics,s=A.state;assert.equal(s.geo.layer,'visitors');assert.equal(s.ui.reach,'visitors');
 s.geo.places={US:[-97,39,'US'],GB:[-2,54,'GB']};s.data.traffic={totals:{visitors:5}};
 s.data.countryTotals={ok:true,rows:[{country:'US',visitors:5,page_views:99},{country:'GB',visitors:2,page_views:30}]};
 const g=A.geo.aggregate();assert.equal(g.total,5);assert.equal(g.unknown,null);
 assert.deepEqual(Array.from(g.points,p=>[p.code,p.value]),[['US',5],['GB',2]]);
 assert.match(A.geo.tooltip('GB').line,/2 unique visitors/);
});

test('rapid geographic selection ignores stale reads and clearing selection restores worldwide data',async()=>{
 const A=context().analytics,s=A.state,pending=[];
 A.init({request:()=>Promise.resolve({}),supa:(path,opts)=>path==='rpc/analytics_geo_audience'?new Promise(resolve=>pending.push({resolve,body:opts.body})):Promise.resolve([])});
 s.range={since:'2026-10-16',until:'2026-10-17',label:'24 hours'};s.section='audience';s.data.traffic={totals:{visitors:40}};
 A.geo.pick('US',false);A.geo.pick('GB',false);assert.equal(pending.length,2);
 pending[1].resolve({schema:'analytics-geo-audience/v1',totals:{visitors:7}});await new Promise(r=>setTimeout(r,0));
 pending[0].resolve({schema:'analytics-geo-audience/v1',totals:{visitors:99}});await new Promise(r=>setTimeout(r,0));
 assert.equal(s.geoAudience.data.totals.visitors,7);assert.doesNotMatch(A.render(),/99/);
 A.geo.pick('',false);assert.equal(s.geoAudience,null);assert.match(A.render(),/Unique visitors<\/small><strong>40/);
});

test('a department never queries aliases shared by its broader region',async()=>{
 const A=context().analytics,s=A.state;s.geo.region='FR';s.geo.adm.FR=JSON.parse(await readFile('data/geo/admin1/FR.json','utf8'));
 const ain=s.geo.adm.FR.states.find(x=>x.k==='FR-01'),f=A.geo.stateFilters(ain);
 assert.ok(f.codes.includes('01'));assert.ok(!f.codes.includes('ARA'));assert.ok(f.names.includes('ain'));assert.ok(!f.names.includes('rhonealpes'));
});


test('dataset explorer filters family and health without treating failed reads as zero',()=>{
 const C=context(),s=C.analytics.state,U=C.analyticsUnified;
 s.data.coverage={summary:{datasets:3,empty:1,quiet:0,unavailable:1},datasets:[
  {key:'posts',label:'Posts',family:'Community',state:'populated',count:12,window_count:4,scope:'First-party'},
  {key:'evidence',label:'Evidence',family:'Intelligence',state:'empty',count:0,window_count:0,scope:'House'},
  {key:'spatial',label:'Spatial archive',family:'Intelligence',state:'missing',count:null,window_count:null,scope:'House'}]};
 U.state.family='Intelligence';let out=U.inventory();assert.doesNotMatch(out,/data-cu-dataset="posts"/);assert.match(out,/Storage missing/);assert.match(out,/<b>—<\/b>/);
 U.state.datasetStatus='empty';out=U.inventory();assert.match(out,/data-cu-dataset="evidence"/);assert.doesNotMatch(out,/data-cu-dataset="spatial"/);
 U.state.panel='connections';assert.doesNotMatch(U.inventory(),/data-cu-dataset=/);
});

test('public field directory is published outside the stripped docs tree',async()=>{
 const inventory=JSON.parse(await readFile('data/analytics/application-schema-inventory.json','utf8'));
 assert.ok(inventory.relations.length>400);assert.match(code,/fetch\('data\/analytics\/application-schema-inventory.json'\)/);
 assert.doesNotMatch(code,/fetch\('docs\//);
});

test('collector state distinguishes configuration from successful ingestion',async()=>{
 const U=context().analyticsUnified;
 await U.load(async path=>path.endsWith('/health')?{schema_ready:true,collector:{enabled:false},latest_run:null,last_successful_run:null}:path.includes('/sources')?{sources:[]}:{database_schema_ready:false},()=>{});
 const out=U.intelligence();assert.match(out,/Collection is off/);assert.match(out,/No recorded attempts/);assert.match(out,/None recorded/);
});

 test('operations directs owners to on-demand datasets instead of displaying unloaded counts',()=>{
 const C=context(),out=C.analyticsUnified.operations(C.analytics.state);
 assert.match(out,/Open dataset explorer/);assert.doesNotMatch(out,/Current stored records/);
 });
