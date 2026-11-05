import test from 'node:test';
import assert from 'node:assert/strict';
import { TEA_MISSION, newTeaAction, stepTea, validateTeaMission, BREWERS } from '../../js/city-arcade/tea-action.mjs';
import { newSoleRun, moveSole, WALLS } from '../../js/city-arcade/engine.mjs';
import { soleObjective, soleRoute } from '../../js/city-arcade/guidance.mjs';
test('missions reject invalid tuning, spawns and customer routes',()=>{
  for(const patch of [{duration:NaN},{speed:Infinity},{brewSeconds:0},{reward:-1},{spawn:{x:0,y:0}},{route:['Coffee']},{route:[]}]) assert.throws(()=>validateTeaMission({...TEA_MISSION,...patch}));
  const state=newTeaAction(); state.config.route.pop(); assert.equal(TEA_MISSION.route.length,5);
});
test('movement is bounded, diagonal speed normalized, frame gap capped and pause inert',()=>{
  const s={...newTeaAction(),status:'playing'};
  const n=stepTea(s,{x:1,y:1},10);
  assert.ok(Math.abs(Math.hypot(n.player.x-s.player.x,n.player.y-s.player.y)-10)<.001);
  assert.deepEqual(s.player,{x:300,y:220});
  const paused={...s,status:'paused'};assert.equal(stepTea(paused,{x:1},.05),paused);
  assert.equal(stepTea({...s,player:{x:580,y:315}},{x:1,y:1},.05).player.x,580);
});
test('brew requires proximity and time; serving requires the correct cup; all configured orders win once',()=>{
  let s={...newTeaAction(),status:'playing'};
  s=stepTea(s,{act:true},.05);assert.equal(s.brewing,null);
  s={...s,player:{x:300,y:300}};s=stepTea(s,{act:true},.05);assert.equal(s.index,0);
  for(const tea of s.config.route){
    const brewer=BREWERS.find(b=>b.tea===tea);s={...s,player:{x:brewer.x,y:120}};
    s=stepTea(s,{act:true},.05);assert.equal(s.cup,null);
    for(let i=0;i<25;i++)s=stepTea(s,{},.05);
    assert.equal(s.cup,tea);
    s=stepTea(s,{act:true},.05);assert.equal(s.brewing,null,'holding Act cannot restart the same brew');
    s={...s,player:{x:300,y:300}};s=stepTea(s,{act:true},.05);
  }
  assert.equal(s.status,'won');assert.equal(s.score,500);assert.equal(stepTea(s,{act:true},.05),s);
});
test('time expires and configurable reward is local score only',()=>{
  let s={...newTeaAction({...TEA_MISSION,route:['Lemon'],reward:20}),status:'playing',cup:'Lemon',player:{x:300,y:300}};
  s=stepTea(s,{act:true},.05);assert.equal(s.score,20);
  assert.equal(stepTea({...newTeaAction(),status:'playing',remaining:.01},{},.05).status,'failed');
});
test('glowing route starts with Robbery 1s, avoids walls and can complete a legal collection run',()=>{
  let s=newSoleRun();assert.equal(soleObjective(s).id,'robbery');
  while(s.status==='playing'){
    const path=soleRoute(s);assert.ok(path.length>1);
    const next=path[1];assert.ok(!WALLS.some(([x,y])=>x===next.x&&y===next.y));
    const dir=next.x>s.player.x?'east':next.x<s.player.x?'west':next.y>s.player.y?'south':'north';s=moveSole(s,dir);
  }
  assert.equal(s.collected[0],'robbery');assert.equal(s.status,'won');assert.equal(s.heat,0);
});
