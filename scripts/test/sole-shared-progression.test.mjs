import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SOLE_MISSION,STREET_STOPS,newStreetRun,arriveStreetObjective} from '../../js/city-arcade/sole-street-engine.mjs';
const neighborhood=JSON.parse(readFileSync('core/data/fictional-city/district.v1.json')).neighborhoods.find(n=>n.id==='bridgeport-robbery-1s');
const locationId='bridgeport-main-golden-hill',spawn=STREET_STOPS.find(p=>p.id==='main-golden-hill').point;
test('shared ordered checkpoints reuse configured rewards, map named poses and finish only at entrance',()=>{
 let s={...newStreetRun({...SOLE_MISSION,route:[...SOLE_MISSION.route].reverse(),reward:123},neighborhood,spawn),status:'paused'};const remaining=s.remaining;
 for(let index=0;index<4;index++){
  const destinationId='bridgeport-'+s.config.route[index],before=s;
  s=arriveStreetObjective(s,{index,destinationId,locationId});assert.equal(s.index,index+1);assert.equal(s.score,(index+1)*123);assert.equal(s.remaining,remaining);assert.equal(s.status,'paused');assert.deepEqual(s.player,STREET_STOPS.find(p=>p.id===before.config.route[index]).point);
  assert.equal(arriveStreetObjective(s,{index,destinationId,locationId}),s,'duplicate does not award');
  s=JSON.parse(JSON.stringify(s));
 }
 assert.equal(arriveStreetObjective(s,{index:4,destinationId:'bridgeport-main-elm',locationId}),s);
 s=arriveStreetObjective(s,{index:4,destinationId:locationId,locationId});assert.equal(s.status,'won');assert.equal(s.score,492);assert.deepEqual(s.player,spawn);
 assert.equal(arriveStreetObjective(s,{index:4,destinationId:locationId,locationId}),s);
});
test('wrong order, inactive, expired or completed missions cannot collect from City',()=>{
 const s={...newStreetRun(SOLE_MISSION,neighborhood,spawn),status:'paused'};const good={index:0,destinationId:'bridgeport-'+s.config.route[0],locationId};
 assert.equal(arriveStreetObjective(s,{...good,index:2}),s);assert.equal(arriveStreetObjective(s,{...good,destinationId:'bridgeport-main-south'}),s);
 for(const status of ['ready','playing','won','failed']){const state={...s,status};assert.equal(arriveStreetObjective(state,good),state);}
 const expired={...s,remaining:0};assert.equal(arriveStreetObjective(expired,good),expired);
});
