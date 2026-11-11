import * as R from './tactical-resolver.mjs';
import { playerProjection } from './tactical-hints.mjs';
import { runThreatPhase } from './tactical-threat-ai.mjs';
import { engineConfig, NAV } from './levels/hex-relay.mjs';
export const SAVE_KEY='here.prim3.transit-relay.hex.v1';
export const active=u=>!u.dead&&!u.downed&&!u.statuses.includes('EXTRACTED');
export function createRun(seed=20261109){return {schema:'prim3.hex-relay/v1',sourceHash:R.stableHash(engineConfig(seed)),seed,commands:[],state:R.beginPlayerPhase(R.createState(engineConfig(seed)))};}
export function outcome(run){const s=run.state;if(R.missionComplete(s))return 'COMPLETE';if(s.mission.clock<=0||s.units.filter(u=>u.faction==='PLAYER').some(u=>u.dead||u.downed))return 'FAILED';return 'ACTIVE';}
export function movePreview(run,id,target){
  if(outcome(run)!=='ACTIVE')return null;
  const projection=playerProjection(run.state),u=projection.units.find(u=>u.id===id);
  if(!u||u.faction!=='PLAYER'||!active(u)||!u.ap)return null;
  const reach=R.computeReach({...run.state,units:projection.units},id,u.moveRange*Math.min(2,u.ap));
  const path=reach.pathTo(target,0,0),costM=reach.costAt(target,0,0);
  if(!path?.length||!Number.isFinite(costM))return null;
  return {id,target,path,costM,mode:costM<=u.moveRange+1e-7?'MOVE':'DASH',stateHash:R.stableHash(run.state)};
}
export function act(run,id,action,payload){
  if(outcome(run)!=='ACTIVE'||run.state.phase!=='PLAYER')throw Error('Mission is not accepting actions');
  let s=run.state;
  if(action==='move'){const fresh=movePreview(run,id,payload?.target);if(!fresh||R.stableHash(fresh)!==R.stableHash(payload))throw Error('Route changed; preview again');s=R.moveUnit(s,id,{x:payload.target,y:0,z:0},payload.mode,{path:payload.path});}
  else if(action==='fire'){if(!playerProjection(s).units.some(u=>u.id===payload&&u.faction==='THREAT'))throw Error('No visible target');const d=R.drawRolls(s,2);s=R.fireWeapon(d.state,id,payload,...d.rolls).state;}
  else if(action==='relay'){const node=s.nodes.find(n=>n.id==='RELAY');s=R.technicalAction(s,id,'RELAY',node.state==='OBSERVED'?'LINK_1':'LINK_2').state;}
  else if(action==='extract'){if(s.nodes.some(n=>n.required&&n.state!=='VERIFIED'))throw Error('Verify the relay before extracting');s=R.extractUnit(s,id);}
  else if(action==='end'){s=R.beginPlayerPhase(R.resolveClockStatePhase(runThreatPhase(R.beginThreatPhase(s)).state));}
  else {const actions={overwatch:R.enterOverwatch,hunker:R.hunkerDown,reload:R.reload};if(!actions[action])throw Error('Unknown action');s=actions[action](s,id);}
  return {...run,state:s,commands:[...run.commands,{id,action,payload:payload??null}]};
}
export function restoreRun(text){
  if(typeof text!=='string'||text.length>2000000)throw Error('Invalid save size');
  const saved=JSON.parse(text);
  if(saved.schema!=='prim3.hex-relay/v1'||!Number.isInteger(saved.seed)||!Array.isArray(saved.commands)||saved.commands.length>500)throw Error('Incompatible save retained');
  let replay=createRun(saved.seed);
  if(saved.sourceHash!==replay.sourceHash)throw Error('Save contract changed');
  // The deterministic resolver replays authorized commands. Validate ALL mutable
  // state (including AP, extraction flags, RNG, statuses and technical effects).
  for(const c of saved.commands)replay=act(replay,c.id,c.action,c.payload);
  if(R.stableHash(replay)!==R.stableHash(saved))throw Error('Invalid saved state or commands');
  return replay;
}
