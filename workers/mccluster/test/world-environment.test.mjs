import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { environmentFacts, environmentFeed, handleWorldEnvironment, ENVIRONMENT_PATH as P } from '../src/world-environment.js';
import { globeFeatureForPath } from '../../../packages/release-policy/globe.mjs';
const USER = '00000000-0000-0000-0000-000000000001', MISSION = '00000000-0000-0000-0000-000000000002', ASSIGN = '00000000-0000-0000-0000-000000000003';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' };
const json = (data,status=200) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json'}});
const req = (suffix='',method='GET',body,auth=true) => new Request(`https://api.mccluster.org${P}${suffix}`, {method,headers: auth ? {authorization:'Bearer member'} : {}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
function cache() { const map=new Map(); return {map, match:async k => map.has(k.url) ? json(map.get(k.url)) : null, put:async(k,r)=>map.set(k.url,await r.json())}; }
function upstream(url) {
 const u = String(url);
 if (u.startsWith('https://api.weather.gov')) return json({features:[{id:'https://api.weather.gov/alerts/1',geometry:null,properties:{id:'https://api.weather.gov/alerts/1',status:'Actual',event:'Flood Warning',sent:new Date(Date.now()-60000).toISOString(),expires:new Date(Date.now()+3600000).toISOString()}}]});
 if (u.startsWith('https://eonet.gsfc.nasa.gov')) return json({events:[{id:'EONET_1',title:'Wildfire',categories:[{title:'Wildfires'}],geometry:[{type:'Point',coordinates:[-72,41],date:new Date(Date.now()-60000).toISOString()}]}]});
 if (u.startsWith('https://earthquake.usgs.gov')) return json({metadata:{generated:Date.now()},features:[{id:'quake1',geometry:{coordinates:[-72,41,10]},properties:{place:'Test quake',time:Date.now()-30000,url:'https://evil.example/steal'}}]});
 if (u.startsWith('https://www.nhc.noaa.gov')) return json({activeStorms:[{id:'al012026',name:'Test storm',latitudeNumeric:20,longitudeNumeric:-60}]});
 throw new Error(`Unexpected request ${u}`);
}
function fake({owner=false,rpcData={},rpcStatus=200,rpcMessage='',reads=[]}={}) {
 const calls=[];
 const fetchImpl=async(url,opts={})=>{
  calls.push({url:String(url),...opts});
  if (String(url).includes('/auth/v1/user')) return json({id:USER});
  if (String(url).includes('/rest/v1/orgs?')) return json([{id:MISSION}]);
  if (String(url).includes('/rest/v1/org_members?')) return json(owner ? [{role:'owner'}] : []);
  if (String(url).includes('/rest/v1/rpc/')) return json(rpcStatus===200?rpcData:{message:rpcMessage},rpcStatus);
  if (String(url).includes('/rest/v1/')) return json(reads);
  return upstream(url);
 };
 return {fetchImpl,calls};
}
test('consumer feed whitelists four government sources and preserves honest observation times',async()=>{
 const c=cache(), f=await environmentFeed(env,{fetchImpl:upstream,cacheImpl:c});
 assert.deepEqual(f.sources.map(s=>s.id),['nws','eonet','usgs','nhc']);
 assert.equal(f.events.length,4);
 assert.equal(f.events[0].lat,null); assert.equal(f.events[0].location_kind,'unmapped');
 assert.equal(f.events[2].source.url,'https://earthquake.usgs.gov/');
 assert.ok(f.events[2].observed_at); assert.notEqual(f.events[2].observed_at,f.events[2].fetched_at);
 assert.equal(f.events[3].observed_at,null); assert.deepEqual(f.events[3].actions,[]);
 assert.equal(f.events[1].actions.length,2); assert.match(f.events[1].notice,/not proof/);
 assert.ok([...c.map.keys()].every(k=>k.includes('consumer-environment-v1-')));
 assert.doesNotMatch(JSON.stringify(f),/server-secret|user_id|assignment_id|m_uid/);
});
test('provider outages are unavailable, not invented empty live feeds',async()=>{
 const f=await environmentFeed(env,{fetchImpl:async()=>{throw Error('secret');}});
 assert.equal(f.events.length,0); assert.ok(f.sources.every(s=>s.status==='unavailable'&&s.fetched_at===null));
 assert.doesNotMatch(JSON.stringify(f),/secret/);
});
test('stale cache retains fetch time and disables proposals',async()=>{
 const c=cache(); await environmentFeed(env,{fetchImpl:upstream,cacheImpl:c});
 for (const [k,v] of c.map) {v.fetched_at=new Date(Date.now()-3600000).toISOString();c.map.set(k,v);}
 const f=await environmentFeed(env,{fetchImpl:async()=>{throw Error('offline');},cacheImpl:c});
 assert.ok(f.sources.every(s=>s.status==='stale')); assert.ok(f.events.every(e=>e.stale&&e.actions.length===0));
});
test('public response never reads private assignment/people stores and fails honestly without SQL',async()=>{
 const f=fake(); const r=await handleWorldEnvironment(req('', 'GET',undefined,false),env,f); const b=await r.json();
 assert.equal(r.status,200); assert.equal(r.headers.get('cache-control'),'private, no-store');
 assert.equal(b.missions_unavailable,false);
 assert.ok(f.calls.some(c=>c.url.includes('approved_by=not.is.null')));
 assert.ok(!f.calls.some(c=>/assignments|profiles|presence|members/.test(c.url)));
 const fail=fake(); const fetchImpl=async(u,o)=>String(u).includes('/rest/')?json({},503):fail.fetchImpl(u,o);
 const out=await (await handleWorldEnvironment(req(),env,{fetchImpl})).json();assert.equal(out.missions_unavailable,true);
});
test('guest team/proposal/join are refused before writes',async()=>{
 for(const suffix of ['/team','/missions/propose',`/missions/${MISSION}/join`]) {
 const f=fake(); const r=await handleWorldEnvironment(req(suffix,'POST',{},false),env,f);assert.equal(r.status,401);assert.equal(f.calls.length,0);
 }
});
test('owner-only oversight and review cannot be opened by a member',async()=>{
 for(const [suffix,method] of [['/oversight','GET'],[`/missions/${MISSION}/review`,'POST']]) {
 const f=fake();const r=await handleWorldEnvironment(req(suffix,method,method==='POST'?{decision:'open'}:undefined),env,f);
 assert.equal(r.status,403);assert.ok(!f.calls.some(c=>c.url.includes('/rpc/')));
 }
});
test('team persists via self-scoped bearer RPC and reload returns assignments',async()=>{
 const f=fake({rpcData:{slug:'environmental-justice-team',name:'Environmental Justice Team',joined:true,assignments:[{mission_id:MISSION,assignment_id:ASSIGN,status:'joined',mission_status:'open',capture_available:true}]}});
 for (const [method,body] of [['POST',{join:true,user_id:MISSION}],['GET',undefined]]) {
 const r=await handleWorldEnvironment(req('/team',method,body),env,f); const b=await r.json(); assert.equal(b.membership.joined,true);assert.equal(b.assignments[0].capture_path,`live-mission.html?assignment=${ASSIGN}`);
 }
 const writes=f.calls.filter(c=>c.url.includes('/rpc/'));assert.equal(writes[0].headers.authorization,'Bearer member');assert.deepEqual(JSON.parse(writes[0].body),{p_join:true});assert.deepEqual(JSON.parse(writes[1].body),{p_join:null});
});
test('team cannot overwrite banned membership; sanitized actionable errors',async()=>{
 const f=fake({rpcStatus:400,rpcMessage:'membership_blocked'});const r=await handleWorldEnvironment(req('/team','POST',{join:true}),env,f);assert.equal(r.status,409);assert.deepEqual(await r.json(),{ok:false,code:'membership_blocked'});
});
test('proposal ignores client snapshots and persists only selected source action as draft',async()=>{
 const f=fake({rpcData:{mission_id:MISSION,status:'draft',created:true}});
 const r=await handleWorldEnvironment(req('/missions/propose','POST',{event_id:'usgs:quake1',action_id:'resource-check',status:'open',title:'unsafe',source:{url:'https://evil.example'}}),env,f);
 assert.equal(r.status,200);assert.equal((await r.json()).status,'draft');
 const write=f.calls.find(c=>c.url.endsWith('/world_environment_propose')); const args=JSON.parse(write.body);
 assert.equal(args.p_actor,USER);assert.equal(args.p_event.source.url,'https://earthquake.usgs.gov/');assert.notEqual(args.p_action.title,'unsafe');assert.equal(write.headers.authorization,'Bearer server-secret');
});
test('unknown/stale/missing-observation event cannot mint proposal',async()=>{
 for(const event_id of ['military:secret','nhc:al012026']) { const f=fake(); const r=await handleWorldEnvironment(req('/missions/propose','POST',{event_id,action_id:'resource-check'}),env,f);assert.equal(r.status,409);assert.ok(!f.calls.some(c=>c.url.includes('/rpc/')));}
});
test('mission join calls canonical guarded RPC and returns assignment-qualified setup only',async()=>{
 const f=fake({rpcData:{assignment_id:ASSIGN,mission_id:MISSION,status:'joined'}});
 const r=await handleWorldEnvironment(req(`/missions/${MISSION}/join`,'POST',{}),env,f);const b=await r.json();assert.equal(b.capture_path,`live-mission.html?assignment=${ASSIGN}`);assert.equal(b.capture_label,'Check recording availability');
 assert.equal(f.calls.find(c=>c.url.includes('/rpc/')).headers.authorization,'Bearer member');
});
test('owner can pause with owner verification; malformed actions never write',async()=>{
 const f=fake({owner:true,rpcData:{mission_id:MISSION,status:'paused'}});
 assert.equal((await handleWorldEnvironment(req(`/missions/${MISSION}/review`,'POST',{decision:'paused'}),env,f)).status,200);
 const before=f.calls.length; assert.equal((await handleWorldEnvironment(req(`/missions/${MISSION}/review`,'POST',{decision:'verified'}),env,f)).status,400);
 assert.ok(!f.calls.slice(before).some(c=>c.url.includes('/rpc/')));
});
test('old Halo routes stay owner features, distinct consumer namespace is not a gate relaxation',()=>{
 assert.equal(globeFeatureForPath('/v1/world/layers/quakes'),'quakes');assert.equal(globeFeatureForPath('/v1/world/halo/people'),'halo-ops');assert.equal(globeFeatureForPath(P),null);
});
test('pending SQL reuses canonical groups/missions, protects provenance and never grants recording or verification',async()=>{
 const sql=await readFile(new URL('../../../supabase/pending/20261107120000_world_environment_v1.sql',import.meta.url),'utf8');
 assert.match(sql,/return public\.join_action_mission\(p_mission\)/);assert.match(sql,/m\.role='owner'/);assert.match(sql,/immutable_environment_provenance/);assert.match(sql,/v_state='banned'/);assert.match(sql,/on conflict\(group_id,m_uid\) do nothing/);
 assert.doesNotMatch(sql,/insert into public\.(action_cohort_members|action_points_ledger|action_live_grants|action_proofs)/);
 assert.match(sql,/revoke all on public\.action_environment_missions, public\.action_environment_reviews from public,anon,authenticated/);
});

test('provider facts preserve numeric units and omit absent or nonfinite measurements', () => {
 assert.deepEqual(environmentFacts('eonet', { magnitude: 12.4, unit: 'square kilometers' }), [{label:'Reported magnitude',value:'12.4 square kilometers'}]);
 assert.deepEqual(environmentFacts('usgs', { mag: 0, depth_km: 10, tsunami: true }), [
  {label:'Magnitude',value:'0'}, {label:'Depth',value:'10 km'}, {label:'USGS tsunami flag',value:'Flagged by source; consult official warnings'}
 ]);
 assert.deepEqual(environmentFacts('nhc', { intensity_kt: 80, classification: 'HU' }), [{label:'Maximum sustained wind',value:'80 kt'},{label:'Classification',value:'HU'}]);
 for (const source of ['eonet','usgs','nhc']) assert.deepEqual(environmentFacts(source, {}), []);
 assert.deepEqual(environmentFacts('usgs', { mag: NaN, depth_km: Infinity, tsunami: false }), []);
 assert.deepEqual(environmentFacts('nhc', { intensity_kt: '80', classification: null }), []);
 const facts = environmentFacts('nws', {severity:'Severe\u0000',certainty:'Observed',urgency:'Immediate',area:'A'.repeat(1000)});
 assert.equal(facts[0].value,'Severe');assert.equal(facts[3].value.length,300);
});
test('NWS polygon anchor stays a boundary label, with bounded official facts/instructions and long source id', async () => {
 const id='https://api.weather.gov/alerts/'+ 'a'.repeat(200);
 const fetchImpl=async url => {
  if (!String(url).startsWith('https://api.weather.gov')) return upstream(url);
  return json({features:[{id,geometry:{type:'Polygon',coordinates:[[[-72,41],[-71,41],[-71,42],[-72,41]]]},properties:{id,status:'Actual',event:'Flood Warning',sent:new Date(Date.now()-60000).toISOString(),expires:new Date(Date.now()+3600000).toISOString(),severity:'Severe',certainty:'Observed',urgency:'Immediate',areaDesc:'River basin',instruction:'Do not enter floodwater. '+ 'x'.repeat(3000)}}]});
 };
 const e=(await environmentFeed(env,{fetchImpl})).events[0];
 assert.equal(e.id,'nws:'+id);assert.ok(e.id.length>160&&e.id.length<=300);
 assert.equal(e.location_kind,'area_label');assert.equal(e.lon,-72);assert.equal(e.lat,41);
 assert.deepEqual(e.facts,[{label:'Severity',value:'Severe'},{label:'Certainty',value:'Observed'},{label:'Urgency',value:'Immediate'},{label:'Area',value:'River basin'}]);
 assert.equal(e.instructions.length,2000);assert.match(e.instructions,/^Do not enter floodwater/);
 assert.notEqual(e.observed_at,e.fetched_at);
});
test('feed emits source measurements without adding missing cyclone observation time or category', async()=>{
 const fetchImpl=async url=>{
  const u=String(url);
  if(u.startsWith('https://earthquake.usgs.gov'))return json({metadata:{generated:Date.now()},features:[{id:'q',geometry:{coordinates:[-72,41,5.1]},properties:{place:'Quake',mag:4.2,tsunami:1,time:Date.now()-10000}}]});
  if(u.startsWith('https://www.nhc.noaa.gov'))return json({activeStorms:[{id:'al012026',name:'Storm',latitudeNumeric:20,longitudeNumeric:-60,intensity:85,classification:'HU'}]});
  return upstream(url);
 };
 const f=await environmentFeed(env,{fetchImpl});
 assert.equal(f.events[2].facts[0].value,'4.2');assert.equal(f.events[2].facts[1].value,'5.1 km');
 assert.equal(f.events[3].facts[0].value,'85 kt');assert.equal(f.events[3].facts[1].value,'HU');
 assert.equal(f.events[3].observed_at,null);assert.deepEqual(f.events[3].actions,[]);
 assert.ok(!f.events[3].facts.some(f=>/category/i.test(f.label)));
});
