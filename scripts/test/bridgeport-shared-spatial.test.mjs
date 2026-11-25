import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {metricFrame,cellCenter,localCell} from '../../js/spatial/metric-frame.mjs';
import {clearEdge,route,restorePosition} from '../../js/spatial/region-graph.mjs';
const region=JSON.parse(fs.readFileSync(new URL('../../data/spatial/bridgeport-golden-hill.v1.json',import.meta.url))),c=region.contract,frame=metricFrame(c.frame.anchor);
test('WGS84 ENU round trip preserves actual source vertices below 0.1 mm',()=>{
 let max=0;for(const b of region.buildings)for(const ring of b.coordinates)for(const [lon,lat]of ring){const p=frame.toLocal({lon,lat,h:0}),g=frame.toGeo(p),back=frame.toLocal(g);max=Math.max(max,Math.hypot(p.x-back.x,p.y-back.y,p.z-back.z));assert.ok(Math.abs(g.lon-lon)<1e-10);assert.ok(Math.abs(g.lat-lat)<1e-10);}
 assert.ok(max<.0001);console.log('Maximum geo/local round-trip error metres:',max);
});
for(const topology of ['hex','square'])test(topology+' centres invert exactly and all route edges honor metric body clearance',()=>{
 const graph=region.graphs[topology],byId=new Map(graph.nodes.map(n=>[n.id,n]));
 for(const n of graph.nodes){assert.deepEqual(localCell(c,topology,cellCenter(c,topology,n.q,n.r)),{q:n.q,r:n.r});for(const e of n.edges){assert.ok(clearEdge(region,n.position,byId.get(e.to).position));assert.ok(byId.get(e.to).edges.some(x=>x.to===n.id));}}
 const p=route(region,topology,byId.get(graph.entryId).position,graph.destinationId);assert.ok(p?.ids.length>10);assert.ok(p.points.every((n,i)=>!i||clearEdge(region,p.points[i-1],n)));console.log(topology,graph.nodes.length,'nodes;',p.costM,'metres;',p.ids.length,'path cells');
});
test('new state is frame/revision/floor pinned and cannot consume legacy city/arcade saves',()=>{
 const position=region.graphs.hex.nodes.find(n=>n.id===region.graphs.hex.entryId).position;
 const s={schema:c.state.schema,regionId:c.id,revision:c.revision,frameId:c.frame.id,floorId:c.floor.id,topology:'hex',position};assert.equal(restorePosition(region,s),s);
 for(const change of [{revision:2},{floorId:'B1'},{frameId:'mccluster-city.bridgeport-equirect.v1'},{position:{x:1e6,y:0,z:0}},{position:{...position,y:5}}])assert.equal(restorePosition(region,{...s,...change}),null);
 assert.equal(restorePosition(region,{x:0,z:-220}),null);
});
