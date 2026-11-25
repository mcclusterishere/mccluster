import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {regionPolicies} from '../../js/spatial/region-policies.mjs';
import {eligibleView,regionGate} from '../../js/spatial/region-gate.mjs';
import {readRegion,validateRegion,visibleCells} from '../../js/spatial/region-policy.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
for(const policy of Object.values(regionPolicies)){
 const raw=readFileSync(`data/spatial/${policy.id}.json`,'utf8'),data=JSON.parse(raw);
 test(policy.id+' pre-load policy matches canonical descriptor and accepts payload',async()=>{
  const source=readFileSync(`core/data/spatial/${policy.id}.json`),c=JSON.parse(source);
  assert.deepEqual(policy.gating,c.gating);assert.deepEqual(policy.anchor,c.frame.anchor);
  assert.equal(policy.contractSha256,createHash('sha256').update(source).digest('hex'));
  assert.equal((await readRegion(new Response(raw),policy)).contract.id,policy.id);
 });
 test(policy.id+' rejects policy drift, node excess, and unrenderable base entities',()=>{
  const drift=structuredClone(data);drift.contract.gating.maxAssetBytes++;assert.throws(()=>validateRegion(drift,policy),/policy/);
  const nodes=structuredClone(data);nodes.graphs.hex.nodes.length=policy.gating.maxNodesPerTopology+1;assert.throws(()=>validateRegion(nodes,policy),/node budget/);
  const entities=structuredClone(data);entities.roads.length=policy.gating.maxEntities;assert.throws(()=>validateRegion(entities,policy),/entity budget/);
 });
 test(policy.id+' reserves entity space for roads, footprints, walker and preview in both topologies',()=>{
  for(const topology of ['hex','square']){const d=structuredClone(data);d.contract.gating.maxEntities=d.roads.length+d.buildings.length+7;
   const cells=visibleCells(d,topology,d.graphs[topology].nodes[0].position);
   assert.equal(cells.length,5);assert.equal(cells[0].id,d.graphs[topology].nodes[0].id);
  }
 });
}
test('streamed byte overflow cancels the body before parsing or attaching',async()=>{
 let cancelled=false;const response=new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(100));},cancel(){cancelled=true;}}));
 await assert.rejects(readRegion(response,{gating:{maxAssetBytes:99}}),/byte budget/);assert.equal(cancelled,true);
});
test('descriptor thresholds, anchor and hysteresis control eligibility rather than old constants',async()=>{
 const p=structuredClone(regionPolicies['bridgeport-downtown.v2']);p.anchor={lon:10,lat:20,h:0};Object.assign(p.gating,{enterCameraHeightM:100,exitCameraHeightM:150,centerRadiusM:50,exitRadiusM:80});
 const near={lon:10,lat:20,height:100};assert.equal(eligibleView(near,{policy:p}),true);assert.equal(eligibleView({...near,height:101},{policy:p}),false);
 assert.equal(eligibleView({...near,height:150},{policy:p,active:true}),true);assert.equal(eligibleView({...near,height:151},{policy:p,active:true}),false);
 assert.equal(eligibleView({...near,lat:20+60/111320},{policy:p}),false);assert.equal(eligibleView({...near,lat:20+60/111320},{policy:p,active:true}),true);
 let attached=0,detached=0;const g=regionGate({policy:()=>p,load:async()=>({}),attach:()=>attached++,detach:()=>detached++});
 g.update({owner:true,entered:true,view:near});await flush();assert.equal(attached,1);
 g.update({owner:true,entered:true,view:{...near,height:140}});assert.equal(detached,0);
 g.update({owner:true,entered:true,view:{...near,height:151}});assert.equal(detached,1);
});
