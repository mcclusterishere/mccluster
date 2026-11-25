import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,beginPlayerPhase,moveUnit,shotPreview} from '../../js/prim3-tactics/tactical-resolver.mjs';
import {playerProjection} from '../../js/prim3-tactics/tactical-hints.mjs';
import {movementGuidance,waypointDistance} from '../../js/prim3-tactics/movement-guidance.mjs';
import {engineConfig,WORLD_M} from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';
function doorState(open){return beginPlayerPhase(createState({width:9,height:5,units:[{id:'E',faction:'PLAYER',x:1,y:2,moveRange:6,detectionRadius:1}],machines:[{id:'D',kind:'DOOR',x:4,y:2,open,cells:[{x:4,y:2,z:0,h:3}]}]}));}
for(const remembered of [false,true]) test(`movement guidance does not reveal ${remembered?'last-seen-open':'unseen'} door closure`,()=>{
 const closed=doorState(false),open=doorState(true);
 if(remembered) for(const s of [closed,open]) s.machines[0].playerSeen={round:1,state:'ACTIVE',faction:'NEUTRAL',controlledBy:null,controlledSinceRound:null,open:true};
 assert.deepEqual(playerProjection(closed),playerProjection(open));
 const g=movementGuidance(closed,'E');assert.deepEqual(g.tiles,movementGuidance(open,'E').tiles);
 const t=g.at(6,2);assert.ok(t);
 const stopped=moveUnit(closed,'E',t,t.mode,{path:t.path});
 assert.equal(stopped.units[0].x,3);assert.equal(stopped.units[0].ap,1);assert.equal(stopped.events.at(-1).type,'MOVE_INTERRUPTED');
});
test('observed closed door excludes its cell and guidance does not normalize it open',()=>{
 const s=doorState(false);s.units[0].detectionRadius=8;
 assert.equal(movementGuidance(s,'E').at(4,2),undefined);
});
test('real HQ upstairs guidance retains weighted cost and executes through public entrance',()=>{
 let s=beginPlayerPhase(createState(engineConfig({seed:1})));
 s=moveUnit(s,'E1',{x:6,y:8,z:1});s=moveUnit(s,'E1',{x:8,y:4,z:1});s=beginPlayerPhase(s);
 const before=JSON.stringify(s),g=movementGuidance(s,'E1'),t=g.at(8,3,2);
 assert.ok(t);assert.equal(t.steps,3);assert.equal(t.apCost,1);
 const moved=moveUnit(s,'E1',t,t.mode,{path:t.path});assert.equal(moved.units[0].z,2);assert.equal(moved.units[0].ap,1);
 assert.equal(JSON.stringify(s),before);
});

test('movement exposure cannot reveal an unseen door between destination and known hostile',()=>{
 const make=open=>beginPlayerPhase(createState({width:10,height:5,units:[{id:'E',faction:'PLAYER',x:1,y:1,moveRange:6,detectionRadius:1},{id:'R',faction:'PLAYER',x:7,y:2,detectionRadius:1},{id:'H',faction:'THREAT',x:7,y:1}],machines:[{id:'D',kind:'DOOR',x:6,y:1,open}]}));
 const open=make(true),closed=make(false);assert.deepEqual(playerProjection(open),playerProjection(closed));
 const preview=s=>{const k=movementGuidance(s,'E').knownState;return shotPreview({...k,units:k.units.map(u=>u.id==='E'?{...u,x:5,y:1}:u)},'H','E');};
 assert.deepEqual(preview(open),preview(closed));assert.equal(preview(closed).legal,true);
});

test('HQ waypoint metres follow physical storey heights, not floor IDs or AP link costs',()=>{
 const s=createState(engineConfig({seed:1})),start={x:8,y:4,z:1};
 const up=waypointDistance(s,start,[{x:8,y:3,z:2}],WORLD_M);
 assert.ok(Math.abs(up-Math.hypot(3.6576,13.5*.3048))<1e-9);
 assert.notEqual(up,3*WORLD_M,'three movement steps are not the stair waypoint chord');
 const b1=s.surfaces.find(f=>f.z===8);
 assert.ok(Math.abs(waypointDistance(s,start,[{x:8,y:3,z:8}],WORLD_M)-Math.hypot(WORLD_M,b1.height))<1e-9);
 assert.equal(waypointDistance(s,start,[{x:8,y:3,z:99}],WORLD_M),null);
});
