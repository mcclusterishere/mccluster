import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, beginPlayerPhase, moveUnit } from '../../js/prim3-tactics/tactical-resolver.mjs';
import { movementGuidance } from '../../js/prim3-tactics/movement-guidance.mjs';
const fresh = (extra={}) => beginPlayerPhase(createState({width:8,height:6,units:[{id:'T',role:'T',faction:'PLAYER',x:1,y:1,moveRange:2,ap:2,detectionRadius:1}],...extra}));
test('guidance previews cheapest canonical AP cost without changing state or random stream',()=>{
 const s=fresh(),before=JSON.stringify(s),g=movementGuidance(s,'T');
 assert.equal(g.at(2,1).apCost,1);assert.equal(g.at(4,1).apCost,2);assert.equal(g.at(6,1),undefined);
 for(const t of g.tiles){const moved=moveUnit(s,'T',t,t.mode,{path:t.path});assert.equal(moved.units[0].ap,s.units[0].ap-t.apCost);}
 assert.equal(JSON.stringify(s),before);
});
test('locked phases, absent, downed, dead, extracted and unaffordable units have no move guidance',()=>{
 for(const change of [s=>s.phase='THREAT',s=>s.units[0].dead=true,s=>s.units[0].downed=true,s=>s.units[0].statuses.push('EXTRACTED'),s=>s.units[0].ap=0]){const s=fresh();change(s);assert.equal(movementGuidance(s,'T').tiles.length,0);}
 assert.equal(movementGuidance(fresh(),'missing').tiles.length,0);
 const s=fresh();s.units[0].ap=1;const g=movementGuidance(s,'T');assert.ok(g.tiles.length);assert.ok(g.tiles.every(t=>t.apCost===1));assert.equal(g.at(4,1),undefined);
});
test('weighted vertical links use canonical route costs rather than path array length',()=>{
 const s=fresh({floors:2,surfaces:[{x:0,y:0,z:1,w:8,d:6,height:3}],links:[{id:'stairs',from:{x:1,y:1,z:0},to:{x:1,y:1,z:1},cost:3}]});
 const t=movementGuidance(s,'T').at(1,1,1);assert.equal(t.steps,3);assert.equal(t.apCost,2);assert.equal(t.path.length,1);
 const moved=moveUnit(s,'T',t,t.mode,{path:t.path});assert.equal(moved.units[0].z,1);assert.equal(moved.units[0].ap,0);
});
test('hidden enemies do not change guidance; real contact interrupts the accepted route',()=>{
 const s=fresh({units:[{id:'T',role:'T',faction:'PLAYER',x:1,y:1,moveRange:2,detectionRadius:1},{id:'H',faction:'THREAT',x:4,y:1}]});
 const other=structuredClone(s);other.units[1].x=7;other.units[1].y=5;
 const g=movementGuidance(s,'T');assert.deepEqual(g.tiles,movementGuidance(other,'T').tiles);
 const t=g.at(4,1),moved=moveUnit(s,'T',t,t.mode,{path:t.path});assert.notEqual(moved.units[0].x,4);assert.equal(moved.units[0].ap,0);
});
test('walls and known occupied destinations remain unreachable',()=>{
 const s=fresh({blockers:[{x:2,y:1,z:0,h:3}],units:[{id:'T',faction:'PLAYER',x:1,y:1,moveRange:2},{id:'E',faction:'PLAYER',x:1,y:2}]});
 const g=movementGuidance(s,'T');assert.equal(g.at(2,1),undefined);assert.equal(g.at(1,2),undefined);
});
