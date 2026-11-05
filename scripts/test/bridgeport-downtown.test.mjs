import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {legacyToLocal,localToLegacy,metricFrame} from '../../js/spatial/metric-frame.mjs';
import {route,routeToEntrance,clearEdge,importCompatiblePose} from '../../js/spatial/region-graph.mjs';
const read=n=>JSON.parse(fs.readFileSync(new URL('../../data/spatial/'+n+'.json',import.meta.url))),d=read('bridgeport-downtown.v2'),old=read('bridgeport-golden-hill.v1');
test('all five legacy Arcade street stops map to sourced vertices in the same ENU frame',()=>{
 assert.deepEqual(d.contract.frame,old.contract.frame);
 for(const e of d.contract.entrances){const p=legacyToLocal(d.contract,{x:e.legacy.point[0],z:e.legacy.point[1]}),back=localToLegacy(d.contract,p),source=metricFrame(d.contract.frame.anchor).toLocal(e);assert.ok(Math.hypot(p.x-source.x,p.z-source.z)<.001);assert.ok(Math.hypot(back.x-e.legacy.point[0],back.z-e.legacy.point[1])<.00001);}
 assert.equal(d.buildings.find(b=>b.id==='283267').name,'Bridgeport Superior Court · Judicial District');
});
for(const topology of ['hex','square'])test(topology+' routes connect every stop in mission order, with swept clearance',()=>{
 const g=d.graphs[topology],order=['main-elm','main-fairfield','middle-golden-hill','main-golden-hill','main-south'];let total=0;
 for(let i=1;i<order.length;i++){const a=g.entrances.find(e=>e.id==='bridgeport-'+order[i-1]),b=g.entrances.find(e=>e.id==='bridgeport-'+order[i]),p=routeToEntrance(d,topology,a.position,b.id);assert.ok(p,order[i]);assert.deepEqual(p.points.at(-1),b.position);for(let j=1;j<p.points.length;j++)assert.ok(clearEdge(d,p.points[j-1],p.points[j]));total+=p.costM;}
 console.log(topology,'five-stop route metres',total);
 const a=g.entrances.find(e=>e.id==='bridgeport-main-golden-hill'),b=g.entrances.find(e=>e.id==='bridgeport-main-elm');assert.equal(route(d,topology,a.position,b.nodeId,{closedRoadIds:['186839735']}),null);
});
test('explicit v1 pose import keeps original immutable and rejects revision/frame mismatches',()=>{
 const c=old.contract,value={schema:c.state.schema,regionId:c.id,revision:1,frameId:c.frame.id,floorId:'street',topology:'hex',position:{...old.graphs.hex.nodes.find(n=>n.id===old.graphs.hex.entryId).position}};
 const original=JSON.stringify(value),next=importCompatiblePose(d,old,value);assert.equal(next.regionId,d.contract.id);assert.deepEqual(next.position,value.position);assert.equal(JSON.stringify(value),original);assert.notEqual(next.position,value.position);
 assert.equal(importCompatiblePose(d,old,{...value,revision:9}),null);assert.equal(importCompatiblePose(d,old,{...value,frameId:'legacy'}),null);
});
