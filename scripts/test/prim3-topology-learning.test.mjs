import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {learningContext,latticeQuestion} from '../../PRIM3/game/halo/adaptive/topology-learning.mjs';
import {cellCenter} from '../../js/spatial/metric-frame.mjs';
import {FRAME as transit} from '../../js/prim3-tactics/levels/transit-relay.mjs';
import {FRAME as hq} from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';
const region=JSON.parse(readFileSync('data/spatial/bridgeport-downtown.v2.json'));
for(const topology of ['square','hex'])test(`${topology} evaluator agrees with canonical neighbor BFS, not graph indices`,()=>{
 const context={version:'prim3.lattice-learning/v1',variant:'city',topology},neighbors=region.contract.topologies[topology].neighbors;
 for(let seed=0;seed<14;seed++)for(let level=1;level<=3;level++){
  const q=latticeQuestion(context,seed,2,level),m=q.prompt.match(/from \((-?\d+), (-?\d+)\) to \((-?\d+), (-?\d+)\)/),[,x,y,X,Y]=m.map(Number);
  const queue=[[x,y,0]],seen=new Set([`${x},${y}`]);let answer;
  for(let i=0;i<queue.length;i++){const[a,b,d]=queue[i];if(a===X&&b===Y){answer=d;break;}for(const[dx,dy]of neighbors){const k=`${a+dx},${b+dy}`;if(!seen.has(k)){seen.add(k);queue.push([a+dx,b+dy,d+1]);}}}
  assert.equal(q.expected,answer);assert.equal(q.unit,'lattice steps');
 }
 const a=cellCenter(region.contract,topology,0,0),b=cellCenter(region.contract,topology,1,0);
 assert.ok(Math.abs(Math.hypot(a.x-b.x,a.z-b.z)-(topology==='hex'?Math.sqrt(3)*1.5:2))<1e-8);
});
test('authored frames and unsupported/forged context fail closed',()=>{
 assert.deepEqual(transit,{x0:32,y0:31,yUp:true});assert.deepEqual(hq,{x0:3,y0:8,yUp:true});
 for(const value of [{version:'future',variant:'city',topology:'hex'},{version:'prim3.lattice-learning/v1',variant:'equity-uprise-hq',topology:'hex'},{version:'prim3.lattice-learning/v1',variant:'city',topology:'hex',expected:1}])assert.throws(()=>learningContext(value));
});
