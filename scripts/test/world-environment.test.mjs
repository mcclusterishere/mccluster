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
test('consumer World retains one globe, supplied artwork, original feed and owner-gated modes',()=>{
 const html=read('mnet.html'),css=read('css/world-environment.css'),travel=read('js/travel/world-travel.mjs');
 assert.equal((html.match(/id="mnWorldFrame"/g)||[]).length,1);
 assert.equal((html.match(/<iframe[^>]+src="action-globe\.html/g)||[]).length,1);
 assert.match(html,/hu-social-only/);assert.match(html,/id="wePanel"[^>]*hidden/);
 assert.match(html,/data-world-mode="environment"[^>]*><img src="assets\/img\/equity-uprise-mark-white.png"/);
 assert.match(css,/hu-social-only[^\n]+data-world-mode="travel"[^\n]+data-world-mode="missions"[^\n]+display:none/);
 assert.match(travel,/\['posts', 'environment'\]/);
 assert.doesNotMatch(css,/@media\s*\(max-width/);
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
