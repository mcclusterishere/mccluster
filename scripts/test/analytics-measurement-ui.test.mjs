import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function panel({request=()=>Promise.resolve({}),supa=()=>Promise.resolve([])}={}){
 const listeners={};
 const window={CR:{},addEventListener:(name,fn)=>{(listeners[name]??=[]).push(fn);}};
 const context=vm.createContext({window,console,setTimeout,clearTimeout});
 for(const path of ['analytics-unified.js','analytics.js']) vm.runInContext(await readFile('js/control-room/'+path,'utf8'),context);
 const A=window.CR.analytics; A.init({request,supa});
 A.state.range={id:'7d',label:'7 days',since:'2026-10-13T00:00:00Z',until:'2026-10-20T00:00:00Z'};
 A.state.geo.places={US:[-97,39,'United States'],GB:[-2,54,'United Kingdom']};
 return {A,U:window.CR.analyticsUnified,emit:(name,detail)=>{for(const fn of listeners[name]||[])fn({detail});}};
}

test('legacy daily stages disclose repeat counting and cannot imply paid conversions',async()=>{
 const {A}=await panel(); A.state.section='audience';
 A.state.data.funnel=[{arrived:2,reached_checkout:1,paid:1,made_an_account:1},{arrived:2,reached_checkout:1,paid:0,made_an_account:0}];
 const html=A.render();
 assert.match(html,/4 · device-days/); assert.match(html,/1 · accounts/);
 assert.match(html,/Purchase reports/); assert.match(html,/verified sales are in Action/);
 assert.doesNotMatch(html,/Conversion funnel|People reaching each stage| percent|>Paid</);
});

test('whole-window stage response replaces daily device sums while accounts retain their authority',async()=>{
 const {A,U}=await panel({supa:(path)=>Promise.resolve(path==='rpc/analytics_stage_totals'?{version:'analytics-stage-totals/v1',stages:[{stage:'view',value:2},{stage:'purchase',value:1}],accounts:{made_an_account:1,confirmed_the_email:1}}:[])});
 await A.refresh(); A.state.section='audience';
 assert.match(A.render(),/Distinct devices across the whole selected window/);
 assert.doesNotMatch(A.render(),/Device-days add/);
 const summary=U.overview(A.state,{scopeLabel:()=>'',chart:''});
 assert.match(summary,/Arrived<\/small><b>2/);assert.match(summary,/Signed up<\/small><b>1/);
 assert.match(summary,/distinct devices in this window/);
});

test('missing whole-window RPC falls back explicitly to legacy daily stage totals',async()=>{
 const calls=[];
 const {A}=await panel({supa:(path)=>{calls.push(path);return path==='rpc/analytics_stage_totals'?Promise.reject({status:404,code:'PGRST202'}):Promise.resolve(path==='rpc/analytics_funnel'?[{arrived:2}]:[]);}});
 await A.refresh();A.state.section='audience';
 assert.ok(calls.includes('rpc/analytics_funnel'));assert.match(A.render(),/2 · device-days/);
});

test('incomplete successful reads retain values and expose limits instead of looking fully ready',async()=>{
 const measurement={metric_version:'audience-science/v2',window:{since:'2026-10-13',until:'2026-10-20',timezone:'UTC'},completeness:{status:'partial',datasets:{events:{status:'limit_reached',rows:50000,limit:50000}}},snapshot:{watermark:null}};
 const {A}=await panel({request:()=>Promise.resolve({version:'v2',totals:{music_listeners:8},measurement})});
 await A.refresh(); A.state.section='audience';
 assert.match(A.top(),/Partial data/);assert.match(A.render(),/Some measurements are incomplete/);
 assert.match(A.render(),/50,000 rows/);assert.match(A.render(),/limit_reached/);assert.equal(A.state.data.audienceScience.totals.music_listeners,8);
});

test('country selection drives the read and the same projection context given to the globe',async()=>{
 const calls=[];
 const {A}=await panel({supa:(path,opts)=>{calls.push({path,body:opts?.body});return Promise.resolve(path==='rpc/analytics_geo_audience'?{schema:'analytics-geo-audience/v1',totals:{visitors:3},series:[]}:[]);}});
 A.geo.select({country:'US'},false);await tick();
 const call=calls.find(x=>x.path==='rpc/analytics_geo_audience');
 assert.equal(call.body.p_country,'US');assert.equal(call.body.p_since,A.projection().window.since);
 assert.equal(A.geo.payload().context.selection_key,A.projection().selection_key);
 assert.equal(A.projection().snapshot.watermark,null);assert.equal(A.projection().geography.kind,'audience_network_country');
 assert.equal(A.projection().window.bounds,'[since,until)');
 A.state.data.countryTotals={ok:true,rows:[]};
 assert.match(A.geo.tooltip({country:'GB'}).line,/— unique visitors/,'missing country must not become zero');
});

test('late geographic response cannot overwrite a newer selection',async()=>{
 const pending=[];
 const {A}=await panel({supa:(path,opts)=>path==='rpc/analytics_geo_audience'?new Promise(resolve=>pending.push({country:opts.body.p_country,resolve})):Promise.resolve([])});
 A.geo.select({country:'US'},false);A.geo.select({country:'GB'},false);
 pending.find(x=>x.country==='GB').resolve({schema:'analytics-geo-audience/v1',totals:{visitors:7}});await tick();
 pending.find(x=>x.country==='US').resolve({schema:'analytics-geo-audience/v1',totals:{visitors:99}});await tick();
 assert.equal(A.state.geoAudience.data.totals.visitors,7);assert.equal(A.projection().geography.country,'GB');
});

test('sign-out clears private memory and late responses cannot restore it or restart reads',async()=>{
 let resolveSite,requests=0;
 const {A,U,emit}=await panel({supa:()=>{requests++;return new Promise(resolve=>{resolveSite=resolve;});}});
 const refresh=A.refresh();A.state.data.identity={journeys:[{id:'private'}]};U.state.records=[{id:'private'}];
 emit('mcc:auth-changed',{signed_in:false});resolveSite([{id:'private-site'}]);await refresh;
 assert.equal(A.state.revoked,true);assert.deepEqual(Array.from(A.state.sites),[]);
 assert.equal(A.state.data.identity.journeys,undefined);assert.equal(U.state.records,null);
 assert.match(A.render(),/Reload Control/);await A.refresh();assert.equal(requests,1);
});

test('sign-out fences an in-flight source catalog and world context',async()=>{
 const {A,U,emit}=await panel();let releases=[];
 const request=()=>new Promise(resolve=>releases.push(resolve));
 const loading=U.load(request,()=>{}); const world=U.loadWorld(request,()=>{},'US');
 emit('mcc:auth-changed',{signed_in:false});
 releases[0]({sources:[{key:'private'}]});releases[1]({database_schema_ready:true});releases[2]({schema_ready:true});releases[3]({schema:'world-indicators/v1',observations:[]});
 await Promise.all([loading,world]);
 assert.equal(U.state.sources,null);assert.equal(U.worldState.data,null);assert.equal(A.state.revoked,true);
});

test('legacy behavioral conversion signals and unmatched signup ratios cannot imply verified outcomes',async()=>{
 const {A}=await panel(); A.state.section='audience';A.state.data.audienceScience={version:'v1',signals:[{signal:'converted',visitors:1}],profiles:[]};
 assert.match(A.render(),/Unverified legacy action signal/);assert.doesNotMatch(A.render(),/>Converted</);
 A.state.section='identity';A.state.completed={identity:true};A.state.data.identity={coverage:{accounts:1},tracks:[{track:'Example',signup_rate_pct:66}]};
 assert.match(A.render(),/Signup rate \(cohort needed\)/);assert.doesNotMatch(A.render(),/66%/);
});

test('Adaptive preserves undefined rates and distinguishes client outcomes from verified results',async()=>{
 const {A}=await panel();A.state.section='adaptive';A.state.completed={experience:true};A.state.data.experience={totals:{decisions:0,impressions:0,visible:0,interactions:0,outcomes:0,impression_rate_pct:null,interaction_rate_pct:null,outcome_rate_pct:null}};
 const html=A.render();assert.equal((html.match(/Rate unavailable/g)||[]).length,3);assert.doesNotMatch(html,/0\.0%/);assert.match(html,/Client outcome reports/);
 A.state.data.experience.totals={};assert.match(A.render(),/<small>Decisions<\/small><strong>—<\/strong>/);
});

test('page score labels expose weights and undefined denominators instead of confidence',async()=>{
 const {A}=await panel(); A.state.section='overview';
 A.state.data.traffic={pages:[{path:'/fixture',views:100,prior_views:0,view_change_pct:100,visitors:1,sessions:5,measured_exits:0,confidence:.96,overall_score:70,quality_score:80,action_events:500,return_pct:80,engaged_30_pct:0,short_exit_pct:0}]};
 const html=A.render();
 assert.match(html,/Action points/);
 assert.match(html,/View-volume weight/);
 assert.match(html,/Repeat-session proxy/);
 assert.match(html,/Trend unavailable \(no positive prior denominator\)/);
 assert.match(html,/Exit reports: 0 \/ 100/);
 assert.doesNotMatch(html,/Measurement confidence|500<[^>]+>recorded events/);
});
