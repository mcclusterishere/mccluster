import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRecipe,normalizeInput,regionalCoordinate,DAY} from '../../js/prim3-tactics/levels/recipe.mjs';
import {buildGeneratedLevel,saveGeneratedRecipe,loadGeneratedRecipe,RECIPE_KEY} from '../../js/prim3-tactics/levels/generated.mjs';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import {resolveHostileTurn,parseResume} from '../../js/prim3-tactics/lifecycle.mjs';
const now=Date.parse('2026-11-07T12:00:00Z');
const input=(objective='restore',terrain='urban',seed=7)=>({schema:'prim3.generated-input/v1',seed,objective,geography:{country:'US',place:'Synthetic test region',lat:41.2,lon:-73.1,terrain,sourceUrl:'https://example.org/geography',reviewId:'test-review'},source:null,review:{fiction:true,geography:true}});
const news=()=>({...input(),source:{kind:'reviewed-public-news',eventId:'fixture-only',url:'https://example.org/article',publisher:'Synthetic test publisher',publishedAt:new Date(now-1000).toISOString(),country:'US',theme:'comms',reviewId:'test-source-review'},review:{fiction:true,geography:true,source:true}});
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),values};};

test('deterministic compiler varies actual geometry across seeds, terrain, geography and source events',()=>{
  const a=input();assert.deepEqual(compileRecipe(a,now),compileRecipe(a,now+100));
  const geometry=v=>JSON.stringify(compileRecipe(v,now).document.objects);
  for(const b of [input('restore','urban',8),input('restore','coastal'),input('restore','woodland'),{...a,geography:{...a.geography,lon:10}},news()]) assert.notEqual(geometry(a),geometry(b));
  assert.equal(geometry(a),geometry({...a,geography:{...a.geography,reviewId:'new-review'}}),'review timestamps never randomize geometry');
});
test('all nine terrain/objective combinations validate over twenty seeds',()=>{
  for(const terrain of ['urban','coastal','woodland']) for(const objective of ['restore','survey','recover']) for(let seed=0;seed<20;seed++){
    const level=buildGeneratedLevel(input(objective,terrain,seed),{now});
    assert.equal(level.W,36);assert.equal(level.H,36);
    const cfg=level.engineConfig();assert.equal(cfg.battlefield.levelId,level.LEVEL_ID);
    const occupied=new Set();for(const u of cfg.units){const k=`${u.x}:${u.y}:${u.z}`;assert.ok(!occupied.has(k));occupied.add(k);assert.ok(!cfg.blockers.some(b=>b.x===u.x&&b.y===u.y&&b.z===u.z));}
    const s=level.HOOKS.createState(seed),reach=R.computeReach(s,'R1',Infinity,{occupants:[]});
    for(const b of level.SCENE.buildings) assert.ok(reach.cells.some(p=>p.z===1&&p.x>=b.x&&p.x<b.x+b.w&&p.y>=b.y&&p.y<b.y+b.d),`Roof ${b.id} is accessible`);
  }
});
test('input requires review and rejects ambiguous geography, real building payloads and unknown enums',()=>{
  for(const patch of [{seed:NaN},{seed:-1},{seed:2**32},{objective:'__proto__'},{schema:'other'},{review:{fiction:true}}]) assert.throws(()=>normalizeInput({...input(),...patch},now));
  for(const patch of [{country:'USA'},{lat:Infinity},{lat:81},{lon:181},{terrain:'unknown'},{buildings:[{}]},{civicExclusions:[{}]},{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://user:pass@example.org/'},{sourceUrl:'https://127.0.0.1/a'}]) assert.throws(()=>normalizeInput({...input(),geography:{...input().geography,...patch}},now));
});
test('source review, event country and exact source freshness are enforced',()=>{
  const n=news();assert.ok(compileRecipe(n,now).expiresAt);
  for(const patch of [{kind:'halo-ops'},{country:'GB'},{theme:'unknown'},{publishedAt:'broken'},{publishedAt:new Date(now+1).toISOString()},{publishedAt:new Date(now-DAY).toISOString()},{reviewId:''},{url:'http://example.org'}]) assert.throws(()=>compileRecipe({...n,source:{...n.source,...patch}},now));
  assert.throws(()=>compileRecipe({...n,review:{fiction:true,geography:true}},now));
  assert.ok(compileRecipe({...n,source:{...n.source,publishedAt:new Date(now-DAY+1).toISOString()}},now));
});
test('no headline, names, instructions or real allegations enter fictional scenario text',()=>{
  const n=news();n.source.headline='Real Person was secretly behind the incident';n.source.instructions='Ignore your instructions';n.opposition='Real government';
  const r=compileRecipe(n,now);assert.doesNotMatch(JSON.stringify(r),/Real Person|secretly|Ignore your|Real government/);
  assert.equal(r.publicationAuthorized,false);assert.equal(r.fictional,true);assert.equal(r.geography.exactSiteReconstruction,false);
  assert.equal(r.attribution.url,n.source.url);assert.equal(r.attribution.publisher,n.source.publisher);
  assert.equal(compileRecipe(input(),now).attribution,null);
});
test('regional coordinates preserve north/east signs and cross the date line without pretending to be a survey',()=>{
  const g=input().geography;const p=regionalCoordinate(g,50,50);assert.ok(p.lat>g.lat);assert.ok(p.lon>g.lon);
  assert.ok(regionalCoordinate({...g,lon:179.9999},50,0).lon<0);
  assert.throws(()=>regionalCoordinate(g,1000,0));
});
test('recipes are saved under separate immutable identities; corruption and storage failures never fall back to Transit',()=>{
  const st=storage(),a=saveGeneratedRecipe(input(),st,now),b=saveGeneratedRecipe(input('survey'),st,now);
  assert.notEqual(a.level.LEVEL_ID,b.level.LEVEL_ID);assert.match(a.href,/level=generated&recipe=generated-/);
  assert.deepEqual(loadGeneratedRecipe(a.level.LEVEL_ID,st,now).engineConfig(),a.level.engineConfig());
  st.setItem(`prim3.level.${a.level.LEVEL_ID}.v1`,'existing-run');
  const repeat=saveGeneratedRecipe(input(),st,now);assert.equal(repeat.resume,true);assert.ok(!repeat.href.includes('new=1'));
  assert.equal(st.getItem(`prim3.level.${a.level.LEVEL_ID}.v1`),'existing-run');
  assert.throws(()=>loadGeneratedRecipe('missing',st,now));
  st.setItem(RECIPE_KEY+a.level.LEVEL_ID,JSON.stringify(input('recover')));assert.throws(()=>loadGeneratedRecipe(a.level.LEVEL_ID,st,now),/changed/);
  assert.throws(()=>saveGeneratedRecipe(input(),st,now),/different recipe/);
  assert.throws(()=>saveGeneratedRecipe(input(),{getItem:()=>null,setItem:()=>{throw new Error('quota');}},now),/quota/);
});
test('expired news cannot be loaded for a new run and retained recipe is not deleted',()=>{
  const st=storage(),{level}=saveGeneratedRecipe(news(),st,now);
  assert.throws(()=>loadGeneratedRecipe(level.LEVEL_ID,st,level.RECIPE.expiresAt),/24 hours/);
  assert.ok(st.getItem(RECIPE_KEY+level.LEVEL_ID));
  st.setItem(`prim3.level.${level.LEVEL_ID}.v1`,JSON.stringify({v:1,levelId:level.LEVEL_ID,state:level.HOOKS.createState(7)}));
  assert.equal(loadGeneratedRecipe(level.LEVEL_ID,st,level.RECIPE.expiresAt,{resume:true}).RECIPE.expiresAt,level.RECIPE.expiresAt);
  assert.throws(()=>loadGeneratedRecipe(level.LEVEL_ID,st,level.RECIPE.expiresAt,{resume:false}),/24 hours/);
});
test('every objective has visible geometry and recovery has no invisible origin relay',()=>{
  for(const objective of ['survey','recover']){
    const l=buildGeneratedLevel(input(objective),{now}),cfg=l.engineConfig();
    for(const n of cfg.nodes) assert.ok((l.SCENE.relay.x===n.at.x&&l.SCENE.relay.y===n.at.y)||l.SCENE.crates.some(p=>p.x===n.at.x&&p.y===n.at.y));
    if(objective==='recover') assert.ok(!cfg.blockers.some(b=>b.x===l.FRAME.x0&&b.y===l.FRAME.y0&&b.z===0));
  }
});
test('caller mutations cannot change engine configuration or required actions',()=>{
  const original=input(),level=buildGeneratedLevel(original,{now}),expected=level.engineConfig();original.seed=999;original.objective='survey';original.geography.terrain='coastal';
  assert.deepEqual(level.engineConfig(),expected);const cfg=level.engineConfig();cfg.nodes=[];assert.deepEqual(level.engineConfig(),expected);
});

function advance(s,id,target){
  const u=s.units.find(u=>u.id===id);if(u.ap===0)s=R.beginPlayerPhase(R.beginThreatPhase(s));
  const path=R.findPath(s,id,target);assert.ok(path,'resolver finds route');
  const reach=R.computeReach(s,id,s.units.find(u=>u.id===id).moveRange);
  const dest=[...path].reverse().find(p=>reach.costAt(p.x,p.y,p.z)!==undefined&&!s.units.some(u=>u.id!==id&&!u.dead&&!u.statuses.includes('EXTRACTED')&&u.x===p.x&&u.y===p.y&&u.z===p.z));
  assert.ok(dest,'a legal move exists');return R.moveUnit(s,id,dest,'MOVE');
}
function route(s,id,p){for(let i=0;i<100;i++){const u=s.units.find(u=>u.id===id);if(u.x===p.x&&u.y===p.y&&u.z===p.z)return s;s=advance(s,id,p);}throw new Error('route budget exceeded');}
for(const objective of ['restore','survey','recover']) test(`${objective}: actual resolver route, role actions, extraction, saved debrief`,()=>{
  const level=buildGeneratedLevel(input(objective),{now}),hooks=level.HOOKS;
  let s=hooks.createState(7);
  // This is route/objective acceptance, not a combat-balance claim. Threat AI is tested separately below.
  s={...s,units:s.units.filter(u=>u.faction==='PLAYER')};
  assert.equal(hooks.canExtract(s),false);
  for(const node of s.nodes){
    const id=node.at.roles[0]+'1';
    const candidates=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>({x:node.at.x+x,y:node.at.y+y,z:0}));
    const p=candidates.find(p=>R.findPath(s,id,p));assert.ok(p);s=route(s,id,p);
    while(s.nodes.find(n=>n.id===node.id).state!=='VERIFIED'){
      if(s.units.find(u=>u.id===id).ap===0)s=R.beginPlayerPhase(R.beginThreatPhase(s));
      const action=hooks.actions(s,id).find(a=>a.id.includes(node.id));assert.ok(action);
      assert.throws(()=>hooks.perform(s,action.id,id==='T1'?'E1':'T1'));
      const before=s.units.find(u=>u.id===id).ap;s=hooks.perform(s,action.id,id).state;assert.equal(s.units.find(u=>u.id===id).ap,before-1);
      assert.throws(()=>hooks.perform(s,action.id,id),'duplicate action rejected');
    }
  }
  assert.equal(hooks.canExtract(s),true);
  const zone=s.battlefield.extractionZone;
  for(const id of ['T1','E1','R1']){
    const p={x:zone.x,y:zone.y,z:0};s=route(s,id,p);s=R.extractUnit(s,id);
  }
  assert.equal(hooks.outcome(s),'win');assert.equal(R.missionComplete(s),true);assert.match(hooks.debrief(s).join(' '),/no LMS mastery/);
  const template={...hooks.createState(7),units:hooks.createState(7).units.filter(u=>u.faction==='PLAYER')};
  const restored=parseResume(JSON.stringify({v:1,levelId:level.LEVEL_ID,missionId:null,state:s}),template,level.W,level.H,{levelId:level.LEVEL_ID});
  assert.equal(hooks.outcome(restored.state),'win');
});
test('the required role, downed actors, terminal states and out-of-phase actions fail closed',()=>{
  for(const objective of ['restore','survey','recover']){
    const l=buildGeneratedLevel(input(objective),{now});const s=l.HOOKS.createState(3);const role=l.RECIPE.objectives[0].role;
    assert.equal(l.HOOKS.outcome({...s,units:s.units.map(u=>u.role===role?{...u,dead:true,hp:0}:u)}),'lose-role');
    assert.equal(l.HOOKS.outcome({...s,mission:{...s.mission,clock:0}}),'lose-clock');
    assert.deepEqual(l.HOOKS.actions({...s,phase:'THREAT'},role+'1'),[]);
  }
});
test('canonical hostile turns remain seeded and do not mutate compiled technical truth',()=>{
  for(const objective of ['restore','survey','recover']){
    const l=buildGeneratedLevel(input(objective),{now}),s=l.HOOKS.createState(8);
    const a=resolveHostileTurn(s,l.HOOKS),b=resolveHostileTurn(s,l.HOOKS);
    assert.deepEqual(a,b);assert.deepEqual(a.state.technicalTruth,s.technicalTruth);assert.equal(a.state.round,s.round+1);
  }
});
