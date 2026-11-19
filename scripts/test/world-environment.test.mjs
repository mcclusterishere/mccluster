/* Local contracts only. Fixtures do not establish deployed service availability. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizeFeed, safeURL, captureURL, timeLabel } from '../../js/world-environment.mjs';
const read = path => readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const id='11111111-1111-4111-8111-111111111111';
const row={id:'usgs:one',title:'Observation',lat:41,lon:-73,source:{label:'USGS',url:'https://earthquake.usgs.gov/earthquakes/eventpage/one'},actions:[]};
const feed=events=>({schema:'world-environment/v1',events,sources:[],missions:[]});
test('feed rejects unsupported/duplicate evidence but retains unlocated reports in the accessible list',()=>{
 assert.throws(()=>normalizeFeed({events:[]}));
 const result=normalizeFeed(feed([row,row,{...row,id:'bad',lat:91},{...row,id:'nan',lat:NaN},{...row,id:'str',lat:'41'},{...row,id:'url',source:{url:'javascript:alert(1)'}}]));
 assert.equal(result.events.length,4); assert.equal(result.events[0].id,row.id);
 for(const event of result.events.slice(1)){assert.equal(event.lat,null);assert.equal(event.lon,null);}
 assert.equal(normalizeFeed({...feed([]),missions:[{id},{id:'bad'}]}).missions.length,1);
});
test('source links and capture destinations reject script and foreign-origin navigation',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,x','http://example.com','https://user:pass@example.com'])assert.equal(safeURL(url),'');
 assert.equal(captureURL('/live-mission.html?assignment='+id,id),'/live-mission.html?assignment='+id);
 for(const url of ['https://evil.example/live-mission.html?assignment='+id,'//evil.example/live-mission.html?assignment='+id,'/live-mission.html?assignment=other','/account.html?assignment='+id])assert.equal(captureURL(url,id),'');
 assert.equal(captureURL('/live-mission.html?assignment='+id,'bad'),'');
 assert.equal(captureURL('https://consumer.example/live-mission.html?assignment='+id,id,'https://consumer.example'),'/live-mission.html?assignment='+id);
 assert.equal(captureURL('https://mccluster.org/live-mission.html?assignment='+id,id,'https://consumer.example'),'');
 assert.equal(timeLabel(null),'Not supplied by provider'); assert.equal(timeLabel('bad'),'Not supplied by provider');
});
test('consumer World retains one globe, supplied artwork, original feed and an owner-gated Travel',()=>{
 const html=read('mnet.html'),css=read('css/world-environment.css'),travel=read('js/travel/world-travel.mjs'),travelCss=read('css/world-travel.css');
 assert.equal((html.match(/id="mnWorldFrame"/g)||[]).length,1);
 assert.equal((html.match(/<iframe[^>]+src="action-globe\.html/g)||[]).length,1);
 assert.match(html,/class="[^"]*\bhu-travel-off\b/);assert.match(html,/id="wePanel"[^>]*hidden/);
 /* owner, 2026-11-17: Environmental Justice is behind the feed's Equity Uprise tab, the supplied marks alone, above its
    missions; the centre of the globe has no E=UP or Missions button any more, and only the house owner has a mode bar */
 const bar=/<nav class="wt-world-modes"[^>]*>([\s\S]*?)<\/nav>/.exec(html)[1];
 assert.deepEqual([...bar.matchAll(/data-world-mode="([a-z]+)"/g)].map(m=>m[1]),['travel','posts']);
 assert.doesNotMatch(bar,/<img/);
 const strip=/<nav class="hu-feed-scope" id="mnFeedScope"[^>]*>([\s\S]*?)<\/nav>/.exec(html)[1];
 assert.match(strip,/data-feed-scope="equity" aria-pressed="false" aria-label="Equity Uprise"><img class="hu-eup-mark hu-eup-mark--white" src="assets\/img\/equity-uprise-mark-white\.png" alt=""[^>]*><img class="hu-eup-mark hu-eup-mark--dark" src="assets\/img\/equity-uprise-mark\.png" alt=""[^>]*><\/button>/);
 assert.ok(html.indexOf('id="mnFeedScope"')<html.indexOf('id="wePanel"')&&html.indexOf('id="wePanel"')<html.indexOf('id="mnFeed"'),'the panel sits under the strip, above the missions');
 assert.doesNotMatch(css,/data-world-mode/,'no mode of its own');
 assert.match(travelCss,/\.hu-travel-off \.wt-world-modes \{ display:none; \}/);
 assert.match(travel,/classList\.contains\('hu-travel-off'\) \? \['posts'\] : \['travel', 'posts'\]/);
 assert.doesNotMatch(css,/@media\s*\(max-width/);
});
test('the McCluster adapter shows the panel exactly while the Equity Uprise tab is up on the feed, and says when that changes',async()=>{
 const {mcclusterEnvironmentAdapter}=await import('../../js/world-environment-mccluster.mjs');
 const listeners={},fired=[];let mode='posts',scope='global';
 const w={MCC_WORLD_MODE:{get:()=>mode},MCC_FEED_SCOPE:{get:()=>scope},addEventListener:(type,fn)=>{(listeners[type]||=[]).push(fn);},
  dispatchEvent:e=>{fired.push(e.type);return true;},CustomEvent:class{constructor(type){this.type=type;}},location:{href:'https://mccluster.org/?view=feed',origin:'https://mccluster.org'}};
 const adapter=mcclusterEnvironmentAdapter(w);
 assert.equal(adapter.modeEvent,'mcc:world-environment');
 assert.equal(adapter.mode(),'feed');
 scope='equity';assert.equal(adapter.mode(),'environment');
 mode='travel';assert.equal(adapter.mode(),'feed','never in Travel');
 mode='posts';assert.equal(adapter.mode(),'environment');
 for(const type of ['mcc:world-mode','mcc:feed-scope'])listeners[type].forEach(fn=>fn());
 assert.deepEqual(fired,['mcc:world-environment','mcc:world-environment']);
 let went='';w.location.assign=u=>{went=u;};w.location.href='https://mccluster.org/?mode=environment';adapter.signIn();
 assert.equal(went,'/?feed=equity&signin=1','signing in comes back to the tab');
});
test('reusable module has no first-party auth or backend dependency',()=>{
 const source=read('vendor/equity-uprise/src/environment/panel.mjs');assert.doesNotMatch(source,/https:\/\/api\.mccluster\.org|MCC_SUPA/);
 assert.match(read('mnet.html'),/js\/world-environment-mccluster\.mjs/);
});
test('pins accept public observation geometry only, switch off and do not duplicate entities',()=>{
 const window={matchMedia:()=>({matches:true})}; vm.runInNewContext(read('js/environment-pins.js'),{window});
 const normalized=window.MCC_ENVIRONMENT_PINS.normalize([{...row,assignment_id:id,user_id:'private',address:'private'},row,{...row,id:'invalid',lon:181}]);
 assert.deepEqual(Object.keys(normalized[0]).sort(),['id','lat','lon','stale','title']);assert.equal(normalized.length,1);
 const entities=new Set(),sent=[];let flights=0;
 const C={Cartesian3:{fromDegrees:(...args)=>args},Color:{fromCssColorString:x=>x,WHITE:'white',BLACK:'black'},LabelStyle:{FILL_AND_OUTLINE:1},Cartesian2:class{},DistanceDisplayCondition:class{}};
 const viewer={entities:{add:x=>{entities.add(x);return x;},remove:x=>entities.delete(x)},scene:{requestRender(){}},camera:{flyTo(){flights++;}}};
 const pins=window.MCC_ENVIRONMENT_PINS.create(()=>viewer,()=>C,x=>sent.push(x));
 for(let i=0;i<4;i++){pins.set({on:true,items:[row]});assert.equal(entities.size,1);pins.set({on:false,items:[]});assert.equal(entities.size,0);}
 pins.focus(row.id);assert.equal(flights,0);pins.set({on:true,items:[row]});pins.focus(row.id);assert.equal(flights,1);
 assert.equal(pins.pick({id:{properties:{environmentEventId:{getValue:()=>row.id}}}}),true);assert.equal(sent[0].id,row.id);
 assert.equal(pins.pick({id:{properties:{environmentEventId:{getValue:()=> 'unknown'}}}}),false);
});
test('first-party adapter confines authenticated requests and anonymous feed never carries a token',async()=>{
 const {mcclusterEnvironmentAdapter}=await import('../../js/world-environment-mccluster.mjs');
 const calls=[];let token='test-token';
 const adapter=mcclusterEnvironmentAdapter({MCC_SUPA:{token:async()=>token},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true})};}});
 await adapter.request('');assert.equal(calls[0].url,'https://api.mccluster.org/v1/world/environment');assert.equal(calls[0].options.headers.authorization,undefined);
 await adapter.request('/team',{auth:true});assert.equal(calls[1].options.headers.authorization,'Bearer test-token');assert.equal(calls[1].options.credentials,'omit');
 for(const path of ['https://evil.example','//evil.example','/team?redirect=evil','/../../halo','/missions/../team'])await assert.rejects(()=>adapter.request(path,{auth:true}));
 assert.equal(calls.length,2);token=null;await assert.rejects(()=>adapter.request('/team',{auth:true}),{status:401});assert.equal(calls.length,2);
});
test('malformed optional source/action/mission entries cannot break rendering',()=>{
 const data=normalizeFeed({...feed([{...row,actions:[null,false,{id:'ok',title:'Useful action'}]}]),sources:[null,false,{label:'USGS'}],missions:[null,false,{id}]});
 assert.equal(data.events[0].actions.length,1);assert.equal(data.sources.length,1);assert.equal(data.missions.length,1);
 assert.equal(normalizeFeed(feed([{...row,id:42}])).events.length,0);
});
test('portable module owns lifecycle and keeps host globals in its adapter',()=>{
 const source=read('vendor/equity-uprise/src/environment/panel.mjs');
 assert.doesNotMatch(source,/MCC_SUPA|MCC_WORLD_MODE|api\.mccluster\.org|mccdb_session|mcc:auth-changed/);
 assert.match(source,/destroy\(\)/);assert.match(source,/removeEventListener/);
 assert.match(source,/privateEpoch\+\+;privateBusy=false/);
 const manifest=JSON.parse(read('packages/equity-uprise/environment/manifest.json'));
 assert.equal(manifest.files.includes('js/world-environment-mccluster.mjs'),false);
 assert.ok(manifest.files.every(path=>/^(js|css|assets\/img|packages\/equity-uprise|vendor\/equity-uprise)\//.test(path)));
});
/* THE PANEL BY DAY (review of W2, R9): css/world-environment.css paints the panel for the night, and by day it sat 1.1:1 on the
   white page. css/daylight.css gives it the day's ink and grounds; every pair must be 4.5:1 or better, and the night sheet is
   left alone. */
test('by day every rule for the Environmental Justice panel reads 4.5:1 or better, and the night sheet is untouched',()=>{
 const day=read('css/daylight.css');
 const rules=[...day.matchAll(/^html\[data-daylight="day"\] ([^{]*\.we-[^{]*)\{([^}]*)\}/gm)]
  .map(m=>({sel:m[1].trim(),decl:Object.fromEntries(m[2].split(';').map(s=>s.trim()).filter(Boolean).map(s=>{const i=s.indexOf(':');return [s.slice(0,i).trim(),s.slice(i+1).trim()];}))}));
 assert.ok(rules.length>=10,'the panel has its day rules: '+rules.length);
 const hex=c=>{const m=/^#([0-9a-f]{6})$/i.exec(c);assert.ok(m,'a plain opaque hex colour: '+c);return [0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16));};
 const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
 const ratio=(a,b)=>{const x=lum(hex(a)),y=lum(hex(b));return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
 const panel=rules.find(r=>r.sel==='.we-panel');
 assert.ok(panel&&panel.decl.color,'the panel takes the day ink');
 for(const r of rules){
  const bg=r.decl.background||'#ffffff'; /* the page is white by day */
  if(r.decl.color)assert.ok(ratio(r.decl.color,bg)>=4.5,`${r.sel}: ${r.decl.color} on ${bg} is ${ratio(r.decl.color,bg).toFixed(2)}:1`);
  else if(r.decl.background)assert.ok(ratio(panel.decl.color,bg)>=4.5,`${r.sel}: the panel's ink on ${bg} is ${ratio(panel.decl.color,bg).toFixed(2)}:1`);
 }
 for(const must of ['.we-panel','.we-eyebrow','.we-panel a',':is(.we-subtle,.we-panel small,.we-detail dt)',':is(.we-panel button,.we-button)','.we-list button[aria-pressed="true"]',':is(.we-filter input,.we-proof-form textarea,.we-proof-form input[type="url"])','.we-detail','.we-safety'])
  assert.ok(rules.some(r=>r.sel===must),must+' has a day rule');
 assert.doesNotMatch(read('css/world-environment.css'),/data-daylight/,'the night sheet carries no day rule');
 assert.doesNotMatch(day.slice(day.indexOf('THE ENVIRONMENTAL JUSTICE PANEL BY DAY')),/@media\s*\(max-width|(?<!minmax\(0, ?)\b1fr/);
});
/* THE POLICY GATE'S CODE REACHES THE PANEL (slice G1, 2026-11-17): production answers 503 module_policy_unavailable until the
   owner enables the module, and 404 module_disabled when it is off. The transport attaches the body's `code` to the error it
   throws (additive, beside `status`), the McCluster adapter passes that error through its feed read, and the panel says which it
   was in the mcc:world-environment-events detail. Still no api.mccluster.org or MCC_SUPA string in the vendor transport. */
test('the adapter passes the policy gate\'s code through the feed read: 503 module_policy_unavailable, 404 module_disabled, a bare failure has none',async()=>{
 const {mcclusterEnvironmentAdapter}=await import('../../js/world-environment-mccluster.mjs');
 let answer={status:503,body:{ok:false,code:'module_policy_unavailable'}};
 const w={MCC_SUPA:{token:async()=>null},fetch:async()=>({ok:answer.status<400,status:answer.status,json:async()=>answer.body}),document:{documentElement:{setAttribute(){}}}};
 const adapter=mcclusterEnvironmentAdapter(w);
 await assert.rejects(()=>adapter.request(''),error=>error.status===503&&error.code==='module_policy_unavailable');
 answer={status:404,body:{ok:false,code:'module_disabled'}};
 await assert.rejects(()=>adapter.request(''),error=>error.status===404&&error.code==='module_disabled');
 answer={status:500,body:{error:'boom'}};
 await assert.rejects(()=>adapter.request(''),error=>error.status===500&&error.code===undefined);
 answer={status:503,body:{ok:false,code:{nested:true}}};
 await assert.rejects(()=>adapter.request(''),error=>error.status===503&&error.code===undefined,'only a string code is a code');
 assert.doesNotMatch(read('vendor/equity-uprise/src/environment/transport.mjs'),/api\.mccluster\.org|MCC_SUPA/);
});
/* E=UP slice S0 (2026-11-19): off, an outage and no data are three lines on the page, not one. html[data-we-feed] is "off" for 404
   module_disabled (never installed or disabled: the owner has not turned the reports on), "unavailable" for 503 or any other failure
   or the visitor's own network, "empty" when every source answered and none reported an event, and "ready" otherwise. mnet.html
   carries one line for each; the panel shows only when ready. Before, every failure was "unavailable" and one sentence. */
test('S0: the adapter sets html[data-we-feed] off, unavailable, empty or ready by cause, and mnet.html and the sheet carry a line for each',async()=>{
 const {mcclusterEnvironmentAdapter}=await import('../../js/world-environment-mccluster.mjs');
 const source=(id,status='available')=>({id,label:id,status,url:'https://example.gov/'});
 const cases=[
  ['off: 404 module_disabled',{status:404,body:{ok:false,code:'module_disabled'}},'off'],
  ['outage: 503 module_policy_unavailable',{status:503,body:{ok:false,code:'module_policy_unavailable'}},'unavailable'],
  ['outage: 503 without a code',{status:503,body:{error:'module_policy_unavailable'}},'unavailable'],
  ['a 404 that is not the gate',{status:404,body:{ok:false,code:'not_found'}},'unavailable'],
  ['the visitor\'s network',{throws:true},'unavailable'],
  ['no data: every source answered, none reported an event',{status:200,body:{schema:'world-environment/v1',events:[],sources:[source('usgs'),source('nws')],missions:[]}},'empty'],
  ['a source down and no events: the panel explains',{status:200,body:{schema:'world-environment/v1',events:[],sources:[source('usgs'),source('nws','unavailable')],missions:[]}},'ready'],
  ['events',{status:200,body:{schema:'world-environment/v1',events:[row],sources:[source('usgs')],missions:[]}},'ready']
 ];
 for(const [label,answer,want] of cases){
  const attrs={};
  const w={MCC_SUPA:{token:async()=>null},fetch:async()=>{if(answer.throws)throw new TypeError('Failed to fetch');return {ok:answer.status<400,status:answer.status,json:async()=>answer.body};},document:{documentElement:{setAttribute:(k,v)=>{attrs[k]=v;}}}};
  const adapter=mcclusterEnvironmentAdapter(w);
  await adapter.request('').catch(()=>{});
  assert.equal(attrs['data-we-feed'],want,label);
 }
 const html=read('mnet.html'),css=read('css/world-environment.css');
 assert.match(html,/<p class="mn__we-note" id="weUnavailable" role="status">Environmental reports are not available right now\.<\/p>/);
 assert.match(html,/<p class="mn__we-note" id="weOff" role="status">Environmental reports are turned off for now\.<\/p>/);
 assert.match(html,/<p class="mn__we-note" id="weEmpty" role="status">No qualifying environmental events right now\.<\/p>/);
 assert.match(css,/html\.mn-feed-equity\[data-we-feed="unavailable"\] #weUnavailable,html\.mn-feed-equity\[data-we-feed="off"\] #weOff,html\.mn-feed-equity\[data-we-feed="empty"\] #weEmpty \{ display:block; \}/);
 assert.doesNotMatch(css,/\[data-we-feed="unavailable"\] \.mn__we-note/,'never every line at once');
 /* the release review's two panel findings, fixed in McCluster's sheet (the vendored panel is unchanged): the search placeholder in the
    panel's dim ink, and the sources summary a 44 px target */
 assert.match(css,/\.we-panel input::placeholder \{ color:var\(--we-dim\);opacity:1; \}/);
 assert.match(css,/\.we-panel details > summary \{ min-height:44px;/);
});
