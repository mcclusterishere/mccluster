import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LEARNING_VARIANTS,learningContext,latticeQuestion} from '../../js/prim3-mission/topology-learning.mjs';
import {cellCenter} from '../../js/spatial/metric-frame.mjs';
import {FRAME as transit} from '../../js/prim3-tactics/levels/transit-relay.mjs';
import {FRAME as hq} from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';
import * as transitLevel from '../../js/prim3-tactics/levels/transit-relay.mjs';
import * as hqLevel from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';
import * as b1Level from '../../js/prim3-tactics/levels/equity-uprise-b1.mjs';
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
test('authored frames follow their level modules: an HQ/B1 cell is the plan\'s 12 ft WORLD_M, the 3.54 m rule tile is named apart (audit W5)',()=>{
 for(const [variant,level] of [['transit-relay',transitLevel],['equity-uprise-hq',hqLevel],['equity-uprise-b1',b1Level],['equity-uprise-b1-attack',b1Level]]){
  const {frame}=LEARNING_VARIANTS[variant],prompt=latticeQuestion({version:'prim3.lattice-learning/v1',variant,topology:'square'},0,1,1).prompt;
  assert.ok(frame.startsWith(`X=x−${level.FRAME.x0}, Y=${level.FRAME.y0}−y; +X east, +Y north; `),`${variant}: origin and axes follow the level FRAME`);
  assert.ok(prompt.startsWith(frame),`${variant}: every question shows the frame`);
  if(level.WORLD_M===undefined){assert.equal(Number(frame.match(/; (\d+(?:\.\d+)?) m\/tile$/)?.[1]),level.TILE_M,`${variant}: drawn and ruled on the shared tile`);continue;}
  const cell=frame.match(/one cell is (\d+) ft \((\d+(?:\.\d+)?) m\) on the building plan/),rule=frame.match(/tactical rules use the separate (\d+(?:\.\d+)?) m game tile/);
  assert.ok(cell&&rule,`${variant}: names the plan cell and the rule tile separately: ${frame}`);
  assert.equal(Number(cell[1]),hqLevel.FT_PER_TILE);assert.ok(Math.abs(Number(cell[2])-level.WORLD_M)<1e-9&&Math.abs(Number(cell[1])*hqLevel.FT-level.WORLD_M)<1e-9,`${variant}: a cell is the level's WORLD_M`);
  assert.equal(Number(rule[1]),level.TILE_M);assert.doesNotMatch(frame,/m\/tile/,`${variant}: the rule tile is not the cell size`);
 }
});
test('the published mission UI imports the published runtime; the private path only re-exports it (audit W5)',async()=>{
 // deploy-pages.yml strips PRIM3/: a published import of PRIM3/game/halo/adaptive/ leaves the page without its runtime.
 for(const file of ['js/prim3-mission/released-app.mjs','js/prim3-mission/released-learning.mjs']){
  const source=readFileSync(file,'utf8');
  assert.match(source,/from '\.\/topology-learning\.mjs'/,`${file} imports the published runtime`);assert.doesNotMatch(source,/PRIM3\//,`${file} must not import the private PRIM3 tree`);
 }
 const shim=await import('../../PRIM3/game/halo/adaptive/topology-learning.mjs');
 assert.equal(shim.LEARNING_VARIANTS,LEARNING_VARIANTS);assert.equal(shim.learningContext,learningContext);assert.equal(shim.latticeQuestion,latticeQuestion);
 assert.match(readFileSync('PRIM3/game/halo/adaptive/topology-learning.mjs','utf8'),/^export \* from '\.\.\/\.\.\/\.\.\/\.\.\/js\/prim3-mission\/topology-learning\.mjs';$/m,'one source of truth, no second copy');
});
