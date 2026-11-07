import * as R from './tactical-resolver.mjs';
import { playerProjection } from './tactical-hints.mjs';
import { runThreatPhase } from './tactical-threat-ai.mjs';
import { clearEdge, route } from '../spatial/region-graph.mjs';

export const SAVE_KEY = 'here.prim3.city-tactics.v1';
export function createCitySimulation(region, { topology = 'hex', moveRangeM = 6 } = {}) {
  if (region.contract.id !== 'bridgeport-downtown.v2' || region.contract.revision !== 2 ||
      region.contract.frame.id !== 'bridgeport-golden-hill.enu.v1' || region.contract.floor.id !== 'street' ||
      region.contract.floor.verticalLinks.length || !['hex','square'].includes(topology) ||
      !Number.isFinite(moveRangeM) || moveRangeM < 3 || moveRangeM > 12) throw new Error('Unsupported city simulation configuration');
  const graph = region.graphs[topology], indices = new Map(graph.nodes.map((n,i)=>[n.id,i]));
  const nodes = graph.nodes.map(n=>({id:n.id,position:{...n.position},edges:n.edges.map(e=>({to:indices.get(e.to),cost:e.costM}))}));
  // Validate the imported graph against City's authoritative clearance query, not a drawn grid.
  for (const n of nodes) for (const e of n.edges) if (!nodes[e.to] || !clearEdge(region,n.position,nodes[e.to].position)) throw new Error('City graph edge fails source clearance');
  const start=indices.get(graph.entryId),path=route(region,topology,nodes[start].position,graph.destinationId);
  if (!path || path.ids.length < 7) throw new Error('Source graph lacks a bounded drill route');
  const exit=indices.get(path.ids[6]), threat=indices.get(path.ids[3]);
  const metricNavigation={schema:'prim3.metric-navigation/v1',regionId:region.contract.id,revision:2,
    frameId:region.contract.frame.id,floorId:'street',topology,radiusM:region.contract.actor.radiusM,
    sightPolicy:'opaque-footprints',nodes,occluders:region.buildings.flatMap(b=>b.rings.map(r=>r.map(p=>({x:p.x,z:p.z}))))};
  const state=R.beginPlayerPhase(R.createState({width:nodes.length,height:1,floors:1,seed:17,clock:100,
    metricNavigation,extractionRequired:true,battlefield:{extractionZone:{x:exit,y:0,z:0,r:0}},
    units:[{id:'R1',role:'R',faction:'PLAYER',x:start,y:0,z:0,hp:12,maxHp:12,moveRange:moveRangeM,
      aim:85,weaponDamage:3,weaponRange:20,detectionRadius:20,ammo:6,magazineSize:6,reserveAmmo:12},
    {id:'H1',faction:'THREAT',x:threat,y:0,z:0,hp:4,maxHp:4,moveRange:4,aim:55,weaponDamage:2,
      weaponRange:16,detectionRadius:16,ammo:6,magazineSize:6,reserveAmmo:12}]}));
  return {schema:'prim3.city-simulation/v1',topology,moveRangeM,sourceHash:R.stableHash(metricNavigation),state};
}
export function outcome(run) {
  const p=run.state.units.find(u=>u.id==='R1');
  return R.missionComplete(run.state)?'COMPLETE':p.dead||p.downed?'FAILED':'ACTIVE';
}
const previewCache=new WeakMap();
export function movementPreview(run,targetIndex) {
  if(outcome(run)!=='ACTIVE'||run.state.phase!=='PLAYER') return null;
  let cache=previewCache.get(run);
  if(!cache){const projection=playerProjection(run.state),p=projection.units.find(u=>u.id==='R1');
    cache={p,reach:R.computeReach({...run.state,units:projection.units},p.id,p.moveRange*Math.min(2,p.ap)),stateHash:R.stableHash(run.state)};previewCache.set(run,cache);}
  const {p,reach,stateHash}=cache;
  const path=reach.pathTo(targetIndex,0,0),cost=reach.costAt(targetIndex,0,0);
  if(!path?.length||!Number.isFinite(cost))return null;
  return {targetIndex,path,costM:cost,mode:cost<=p.moveRange?'MOVE':'DASH',stateHash};
}
export function act(run,action,preview=null) {
  if(outcome(run)!=='ACTIVE')throw new Error('Simulation has ended');
  let state=run.state;
  if(state.phase!=='PLAYER')throw new Error('Not the player phase');
  if(action==='move') {
    if(!preview||preview.stateHash!==R.stableHash(state))throw new Error('Preview expired; select the destination again');
    const expected=movementPreview(run,preview.targetIndex);
    if(!expected||R.stableHash(expected)!==R.stableHash(preview))throw new Error('Invalid route preview');
    state=R.moveUnit(state,'R1',{x:preview.targetIndex,y:0,z:0},preview.mode,{path:preview.path});
  } else if(action==='fire') {
    if(!playerProjection(state).units.some(u=>u.id==='H1'))throw new Error('No visible target');
    const dice=R.drawRolls(state,2);state=R.fireWeapon(dice.state,'R1','H1',...dice.rolls).state;
  } else if(action==='reload') state=R.reload(state,'R1');
  else if(action==='overwatch')state=R.enterOverwatch(state,'R1');
  else if(action==='extract')state=R.extractUnit(state,'R1');
  else if(action==='end') {
    // The whole hostile phase commits atomically; exceptions never skip the opposition.
    state=runThreatPhase(R.beginThreatPhase(state)).state;
    state=R.beginPlayerPhase(R.resolveClockStatePhase(state));
  } else throw new Error('Unknown action');
  return {...run,state};
}
export function restoreSimulation(region,text) {
  const saved=JSON.parse(text);
  if(saved.schema!=='prim3.city-simulation/v1')throw new Error('Unsupported save; original retained');
  const fresh=createCitySimulation(region,saved),s=saved.state;
  if(saved.sourceHash!==fresh.sourceHash || R.stableHash(s.metricNavigation)!==fresh.sourceHash ||
      s.version!==fresh.state.version || s.width!==fresh.state.width || s.height!==1 || s.floors!==1 ||
      s.phase!=='PLAYER' || !Number.isInteger(s.round) || s.round<1 || !Number.isInteger(s.rng?.n) ||
      !Number.isFinite(s.rng?.seed) || !Array.isArray(s.events) || s.units?.length!==2 ||
      s.units.some((u,i)=>u.id!==fresh.state.units[i].id||u.faction!==fresh.state.units[i].faction||
        !Number.isInteger(u.x)||!s.metricNavigation.nodes[u.x]||u.y!==0||u.z!==0||
        !Number.isInteger(u.ap)||u.ap<0||u.ap>u.maxAp||!Number.isFinite(u.hp)||u.hp<0||u.hp>u.maxHp||!Array.isArray(u.statuses)) ||
      R.stableHash(s.battlefield)!==R.stableHash(fresh.state.battlefield)) throw new Error('Save does not match this simulation; original retained');
  return saved;
}
export function commitSimulation(storage,run) { storage.setItem(SAVE_KEY,JSON.stringify(run)); return run; }
