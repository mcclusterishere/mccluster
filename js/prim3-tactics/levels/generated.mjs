/* Recipe -> existing Forge geometry -> canonical resolver. No new combat engine. */
import { compileRecipe, SCHEMA } from '../../../PRIM3/game/halo/generated/recipe.mjs';
import { exportForgeLevel, deriveCover } from './forge.mjs';
import * as R from '../tactical-resolver.mjs';
import { TILE_M } from '../scale.mjs';

export const RECIPE_KEY = 'prim3.generated.recipe.v1.';
const clone = v => JSON.parse(JSON.stringify(v));
const complete = s => s.nodes.every(n=>n.state==='VERIFIED');
const live = u => !u.dead && !u.downed && !u.statuses.includes('EXTRACTED');
export function buildGeneratedLevel(input, {now=Date.now(),allowExpired=false}={}) {
  const recipe=compileRecipe(input,now,{allowExpired}), exported=exportForgeLevel(recipe.document);
  if (!exported.level || exported.errors.length) throw new Error(exported.errors.join(' ') || 'Cannot build generated level.');
  input=clone(recipe.input);
  const base=exported.level, cfg=base.engineConfig({seed:input.seed});
  cfg.battlefield.levelId=recipe.id;
  const tile = (x,y) => ({x:Math.floor((x+64+0.5)/TILE_M),y:Math.floor((64-y-0.5)/TILE_M),z:0});
  const goals=recipe.objectives.map(o=>({...o,at:{...tile(o.x,o.y),range:1,roles:[o.role]}}));
  // Replace the Forge's fixed relay problem with actual, role-specific objectives.
  cfg.nodes=goals.map(o=>({id:o.id,state:'OBSERVED',required:true,at:clone(o.at)}));
  cfg.blockers=cfg.blockers.filter(b=>!(b.x===base.SCENE.relay.x&&b.y===base.SCENE.relay.y&&b.z===0));
  cfg.technicalTruth={nodes:{}};
  for (const goal of goals) {
    const actions={};
    goal.steps.forEach((label,i)=> { actions[i===0?'OBSERVED':`STEP_${i}`] = {[`STEP_${i+1}`]:{next:i===goal.steps.length-1?'VERIFIED':`STEP_${i+1}`,apCost:1}}; });
    cfg.technicalTruth.nodes[goal.id]={actions};
    if (!cfg.blockers.some(b=>b.x===goal.at.x&&b.y===goal.at.y&&b.z===0)) cfg.blockers.push({...tile(goal.x,goal.y),h:goal===goals[0]?1.5:1.8});
  }
  cfg.cover=deriveCover(cfg.blockers,cfg.surfaces,base.W,base.H,base.FLOORS);
  cfg.clock=40; // explicit generous play-test budget; not claimed balanced
  cfg.battlefield.objectiveTiles=goals.map(o=>({id:o.id,...o.at}));
  cfg.battlefield.generated={recipeId:recipe.id,version:recipe.schema,objective:input.objective};
  const outcome = s => {
    const squad=s.units.filter(u=>u.faction==='PLAYER');
    if (!squad.length||squad.every(u=>u.dead)) return 'lose-all';
    if (R.missionComplete(s)) return 'win';
    if (s.mission.clock<=0||s.mission.escalation==='TERMINAL') return 'lose-clock';
    if (squad.some(u=>u.downed&&!u.dead&&!u.statuses.includes('EXTRACTED'))) return 'lose-downed';
    if (goals.some(g=>s.nodes.find(n=>n.id===g.id)?.state!=='VERIFIED'&&!squad.some(u=>u.role===g.role&&live(u)))) return 'lose-role';
    return null;
  };
  const actions=(s,actorId)=> {
    if(outcome(s)) return [];
    const out=[];
    for (const g of goals) for(let i=0;i<g.steps.length;i++) {
      const act=`STEP_${i+1}`;
      try { if(R.technicalAction(s,actorId,g.id,act).accepted) out.push({id:`generated:${g.id}:${act}`,label:`${g.steps[i]} · ${g.label}`,sub:'1 AP'}); } catch { /* resolver owns eligibility */ }
    }
    return out;
  };
  const sourceLine=recipe.attribution?`Inspired by a reviewed ${recipe.attribution.publisher} source (${recipe.attribution.publishedAt}). ${recipe.attribution.url}`:'Evergreen practice. No live news source is claimed.';
  const level={...base,LEVEL_ID:recipe.id,SAVE_ID:recipe.id,RECIPE:recipe,
    SCENE:{...base.SCENE,objective:{...goals[0].at},relay:{...goals[0].at,h:1.5},
      crates:[...base.SCENE.crates,...goals.slice(1).map(g=>({x:g.at.x,y:g.at.y,w:1,d:1,h:1.8}))]},
    RETURN:{href:'prim3-world.html',label:'PRIM3 World'},
    MISSION:{...base.MISSION,title:recipe.title,objective:recipe.title,node:goals[0].id,nodeLabel:goals[0].label,doneTitle:'Training objectives complete',
      brief:`${recipe.title} in the ${recipe.geography.place} regional setting. ${goals.map(g=>`${g.role}: ${g.steps.join(' → ')} at ${g.label}`).join('. ')}. Complete every checkpoint, then extract the squad. ${sourceLine} ${recipe.disclaimer}`,
      roles:{E:'Protect the team; secure supply caches in recovery exercises.',R:'Survey and corroborate route checkpoints.',T:'Inspect, restore and independently verify training network nodes.'},
      help:['Use the marked checkpoint actions for the required role, then extract every survivor.','Synthetic 128 m layout on the existing 3.54 m tactical grid. A regional reference, not a real site reconstruction.']},
    engineConfig:({seed=input.seed}={})=>({...clone(cfg),seed})
  };
  level.HOOKS={
    createState:seed=>R.beginPlayerPhase(R.createState(level.engineConfig({seed}))),
    actions,
    perform(s,id,actorId) {
      if(!actions(s,actorId).some(a=>a.id===id)) throw new Error('This checkpoint action is not available.');
      const [,node,action]=id.split(':'); const result=R.technicalAction(s,actorId,node,action);
      if(!result.accepted) throw new Error('Checkpoint action refused.');
      return {state:result.state,log:`${actorId}: ${goals.find(g=>g.id===node).label} ${result.nodeState==='VERIFIED'?'complete':'in progress'}.`};
    },
    canExtract:complete,
    markers:s=>goals.map(g=>({...g.at,h:0.5,kind:'obj',text:`${g.role} · ${g.label}${s.nodes.find(n=>n.id===g.id)?.state==='VERIFIED'?' ✓':''}`})),
    objective:s=>({title:complete(s)?'Extract the squad':recipe.title,progress:`${s.nodes.filter(n=>n.state==='VERIFIED').length}/${goals.length}`,line:complete(s)?'All survivors to the yellow extraction ring.':goals.map(g=>`${g.role}: ${g.label}`).join(' · ')}),
    outcome, sync:s=>s, afterThreat:s=>({state:s,log:[]}),
    debrief:s=>[`${recipe.title}: ${s.nodes.filter(n=>n.state==='VERIFIED').length}/${goals.length} checkpoints complete.`,sourceLine,recipe.disclaimer,'This tactical exercise awards no LMS mastery or Principles credit.']
  };
  // Use the canonical reach function. No local pathfinder or silent fallback map.
  const s=level.HOOKS.createState(input.seed);
  for(const u of s.units.filter(u=>u.faction==='PLAYER')) {
    const reach=R.computeReach({...s,links:s.links.filter(l=>l.cost<=2*u.moveRange)},u.id,Infinity,{occupants:[]});
    const cells=[{x:u.x,y:u.y,z:u.z},...reach.cells];
    for(const g of goals.filter(g=>g.role===u.role)) if(!cells.some(p=>p.z===0&&Math.abs(p.x-g.at.x)+Math.abs(p.y-g.at.y)<=1)) throw new Error(`${u.role} cannot reach ${g.label}.`);
    const zone=s.battlefield.extractionZone;
    if(!cells.some(p=>p.z===0&&Math.abs(p.x-zone.x)+Math.abs(p.y-zone.y)<=zone.r)) throw new Error(`${u.role} cannot reach extraction.`);
  }
  return level;
}

export function saveGeneratedRecipe(input,storage=globalThis.localStorage,now=Date.now()) {
  const level=buildGeneratedLevel(input,{now}), value=JSON.stringify(level.RECIPE.input), key=RECIPE_KEY+level.RECIPE.id;
  const old=storage.getItem(key);
  if(old!==null&&old!==value) throw new Error('A different recipe already owns this save identity. Export it before replacing anything.');
  storage.setItem(key,value);
  if(storage.getItem(key)!==value) throw new Error('The recipe could not be saved.');
  const hasSave=storage.getItem(`prim3.level.${level.RECIPE.id}.v1`)!==null;
  return {level,resume:hasSave,href:`prim3-transit.html?level=generated&recipe=${level.RECIPE.id}${hasSave?'':'&new=1'}`};
}
export function loadGeneratedRecipe(id,storage=globalThis.localStorage,now=Date.now(),{resume=false}={}) {
  if(!/^generated-[0-9a-f]{16}$/.test(id||'')) throw new Error('A valid generated mission identity is required.');
  const raw=storage.getItem(RECIPE_KEY+id);
  if(!raw||raw.length>16000) throw new Error('This generated recipe is missing or too large. Return to PRIM3 World to review it.');
  const input=JSON.parse(raw);
  if(input.schema!==SCHEMA) throw new Error('The saved recipe version is unsupported.');
  // An existing run keeps its immutable scenario after discovery expiry. This is
  // local corruption protection, not a backend entitlement or release authority.
  let saved=null;
  if(resume) try { saved=JSON.parse(storage.getItem(`prim3.level.${id}.v1`)||'null'); } catch { /* normal resume validator explains damage */ }
  const allowExpired=!!(saved?.v===1&&saved.levelId===id&&saved.state?.battlefield?.generated?.recipeId===id);
  const level=buildGeneratedLevel(input,{now,allowExpired});
  if(level.RECIPE.id!==id) throw new Error('The saved recipe changed. The existing tactical save has not been replaced.');
  return level;
}
