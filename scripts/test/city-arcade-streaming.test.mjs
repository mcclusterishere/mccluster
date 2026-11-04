import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createRegionLoader,withinRegion,DEFAULT_LOADING} from '../../js/city-arcade/region-loader.mjs';
import {SOLE_MISSION,validateSoleMission,roadGraph,streetPath,newStreetRun,stepStreet,targetPoint,encounterAction,STREET_STOPS} from '../../js/city-arcade/sole-street-engine.mjs';
const district=JSON.parse(await readFile(new URL('../../core/data/fictional-city/district.v1.json',import.meta.url))),n=district.neighborhoods.find(n=>n.id==='bridgeport-robbery-1s');
test('no geometry request until entry or within a configured zoom region',async()=>{
 let requests=0;const loader=createRegionLoader({url:'test',fetchImpl:async()=>{requests++;return Response.json(district);}});
 assert.equal(requests,0);await loader.observe({lon:0,lat:0,height:10});assert.equal(requests,0);
 assert.equal(withinRegion({lon:-73.19,lat:41.18,height:1e6},DEFAULT_LOADING),false);
 const result=await loader.observe({lon:-73.19,lat:41.18,height:1000});assert.equal(requests,1);assert.equal(result.id,n.id);
 await loader.load();assert.equal(requests,1);loader.unload();assert.equal(loader.loaded,null);
});
test('byte budget fails before JSON parsing and cancelled loads cannot revive geometry',async()=>{
 const budget=createRegionLoader({url:'test',config:{...DEFAULT_LOADING,maxBytes:200000},fetchImpl:async()=>new Response('x'.repeat(100001))});await assert.rejects(()=>budget.load(),/byte budget/);
 let release;const loader=createRegionLoader({url:'test',fetchImpl:()=>new Promise(r=>release=r)});const pending=loader.load();loader.unload();release(Response.json(district));await assert.rejects(()=>pending,e=>e.name==='AbortError');assert.equal(loader.loaded,null);
});
test('street mission follows actual legal connected roads to all four shoes and home',()=>{
 const graph=roadGraph(n),spawn=STREET_STOPS[3].point;let s={...newStreetRun(SOLE_MISSION,n,spawn),status:'playing'};
 // Traverse each graph segment in small steps rather than teleporting over geometry.
 for(let checkpoint=0;checkpoint<5;checkpoint++){
  const path=streetPath(graph,s.player,targetPoint(s));assert.ok(path.length);
  for(const goal of path){let guard=0;while(Math.hypot(goal[0]-s.player[0],goal[1]-s.player[1])>.9&&s.status==='playing'){
   const dx=goal[0]-s.player[0],dy=goal[1]-s.player[1];s=stepStreet(s,{x:Math.abs(dx)>.4?Math.sign(dx):0,y:Math.abs(dy)>.4?Math.sign(dy):0},.025,graph);assert.ok(++guard<1500,'segment walk converges');
  }}
  for(let i=0;i<5;i++)s=stepStreet(s,{},.05,graph);
 }
 assert.equal(s.status,'won');assert.equal(s.index,4);assert.equal(s.score,400);
});
test('closed roads reroute or reject unreachable checkpoints instead of drawing through buildings',()=>{
 const closed=['bridgeport-osm-10173135-0'];const g=roadGraph(n,closed);const path=streetPath(g,STREET_STOPS[0].point,STREET_STOPS[3].point);assert.ok(path.length>0);
 assert.throws(()=>newStreetRun({...SOLE_MISSION,blockedRoads:['bridgeport-osm-186839735-0','bridgeport-osm-10173135-0']},n,STREET_STOPS[0].point),/blocked|unreachable/);
});
test('optional decoy sequence rewards once, wrong evidence costs time, main checkpoints stay intact',()=>{
 let s={...newStreetRun(SOLE_MISSION,n,STREET_STOPS[0].point),status:'playing',player:[...STREET_STOPS[4].point]};const id='replica-courier';
 const inspected=encounterAction(s,id,'inspect');const wrong=encounterAction(inspected,id,'identify',1);assert.equal(wrong.remaining,s.remaining-8);assert.equal(wrong.score,0);
 s=encounterAction(inspected,id,'identify',0);s=encounterAction(s,id,'confiscate');s=encounterAction(s,id,'roast');assert.equal(s.score,75);assert.equal(s.index,0);assert.equal(encounterAction(s,id,'roast').score,75);
 assert.throws(()=>validateSoleMission({...SOLE_MISSION,encounters:[{...SOLE_MISSION.encounters[0],reward:99999}]}));
});

test('lightweight marker and server road artifacts match the shared city authority',async()=>{
 const {createHash}=await import('node:crypto');const source=await readFile(new URL('../../core/data/fictional-city/district.v1.json',import.meta.url));
 const markers=JSON.parse(await readFile(new URL('../../data/city-arcade/locations.v1.json',import.meta.url)));
 assert.equal(markers.sourceSha256,createHash('sha256').update(source).digest('hex'));
 const {arcadeRoads}=await import('../../workers/mccluster/src/arcade/roads.generated.js');assert.deepEqual(arcadeRoads.roads,n.roads);
 for(const p of markers.locations)assert.ok(n.roads.some(r=>r.id===p.roadId&&r.points.some(pt=>pt[0]===p.point[0]&&pt[1]===p.point[1])));
});
test('reserved game-code budget covers all arcade modules',async()=>{
 const {readdir,stat}=await import('node:fs/promises'),{GAME_CODE_RESERVE}=await import('../../js/city-arcade/region-loader.mjs');
 const dir=new URL('../../js/city-arcade/',import.meta.url);let bytes=0;for(const f of await readdir(dir))if(f.endsWith('.mjs'))bytes+=(await stat(new URL(f,dir))).size;
 assert.ok(bytes<GAME_CODE_RESERVE,`${bytes} exceeds module reserve ${GAME_CODE_RESERVE}`);
});
