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
test('country fallback is labeled worldwide and never mislabeled as a selected state',()=>{const C=context(),s=C.analytics.state;s.geo.places={US:[-97.5,39.5,'United States']};s.geo.region='US';s.country={code:'US',rows:null};let out=C.analytics.render();assert.match(out,/Worldwide · .*country trend unavailable/);s.country.rows=[{bucket:'2026-10-16T00:00:00Z',page_views:2},{bucket:'2026-10-16T01:00:00Z',page_views:4}];out=C.analytics.render();assert.match(out,/Page views over time, United States/);assert.doesNotMatch(out,/country trend unavailable/);});
test('field directory searches names and columns and escapes metadata',()=>{const U=context().analyticsUnified;U.state.inventory={relations:[{name:'orders',columns:['amount_cents','attribution']},{name:'<unsafe>',columns:['title']}]};U.state.fieldQuery='attribution';let out=U.inventory();assert.match(out,/2 tables and views · 1 matches/);assert.match(out,/<summary>orders/);U.state.fieldQuery='';out=U.inventory();assert.match(out,/&lt;unsafe&gt;/);assert.doesNotMatch(out,/<unsafe>/);});

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
  const out=A.render();assert.match(out,/country trend unavailable/);assert.doesNotMatch(out,/Page views over time, United States/);
});
