import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../../js/prim3-tactics/city-simulation.mjs';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
const region=JSON.parse(fs.readFileSync(new URL('../../data/spatial/bridgeport-downtown.v2.json',import.meta.url)));
for(const topology of ['hex','square'])test(`${topology}: owner configuration → combat → legal movement → extraction → reload`,()=>{
  let run=C.createCitySimulation(region,{topology,moveRangeM:6});
  const original=structuredClone(run),source=JSON.stringify(region);
  for(let i=0;i<8&&!run.state.units[1].dead;i++) {
    run=run.state.units[0].ap?C.act(run,'fire'):C.act(run,'end');
    run=C.restoreSimulation(region,JSON.stringify(run));
  }
  assert.equal(run.state.units[1].dead,true);assert.equal(original.state.units[1].hp,4);
  const exit=run.state.battlefield.extractionZone;
  for(let i=0;i<10&&run.state.units[0].x!==exit.x;i++) {
    if(!run.state.units[0].ap){run=C.act(run,'end');continue;}
    const path=R.findPath(run.state,'R1',exit),reachable=path.map(c=>C.movementPreview(run,c.x)).filter(Boolean);
    assert.ok(reachable.length);const q=reachable.at(-1);const previous=run;
    run=C.act(run,'move',q);assert.equal(run.state.units[0].ap,previous.state.units[0].ap-(q.mode==='MOVE'?1:2));
    assert.throws(()=>C.act(run,'move',q),/expired/);
  }
  run=C.act(run,'extract');assert.equal(C.outcome(run),'COMPLETE');
  const restored=C.restoreSimulation(region,JSON.stringify(run));assert.deepEqual(restored,run);
  assert.throws(()=>C.act(restored,'end'),/ended/);assert.equal(JSON.stringify(region),source);
});
test('storage failure and foreign save preserve original run; route tampering rejected',()=>{
  const run=C.createCitySimulation(region),before=JSON.stringify(run);
  assert.throws(()=>C.commitSimulation({setItem(){throw new Error('quota');}},run),/quota/);
  assert.equal(JSON.stringify(run),before);
  assert.throws(()=>C.restoreSimulation(region,JSON.stringify({...run,sourceHash:'wrong'})),/does not match/);
  assert.throws(()=>C.restoreSimulation(region,'{"schema":"legacy"}'),/Unsupported/);
  const q=Array.from({length:run.state.width},(_,i)=>C.movementPreview(run,i)).find(Boolean);
  assert.throws(()=>C.act(run,'move',{...q,costM:0}),/Invalid route/);
});
