// TR02 local training adapter: existing hex tactics + canonical in-process lab.
import * as H from './hex-simulation.mjs';
import * as R from './tactical-resolver.mjs';
import {runThreatPhase} from './tactical-threat-ai.mjs';
import * as L from './network-path-lab.mjs';
import * as SF from './shared-fate-lab.mjs';
import * as SITE from './levels/shared-fate.mjs';
import {NAV,RELAY,EXIT} from './levels/hex-relay.mjs';
export const SAVE_KEY='here.prim3.training.network.local.v1';
export const active=H.active,movePreview=H.movePreview,outcome=H.outcome;
const distance=(nav,u,node,range)=>{const a=nav.nodes[u.x]?.position,b=nav.nodes[node].position;return a&&Math.hypot(a.x-b.x,a.z-b.z)<=range;};
export function createRun(seed=20261109,variant='foundation'){const r=H.createRun(seed);r.state.mission.clock=22;return {...r,schema:'prim3.training.network/v1',lab:L.createLab(variant),controlRound:null,commands:[]};}
export function createSharedRun(seed=20261111){const config=SITE.engineConfig(seed);return {schema:'prim3.shared-fate/v1',missionId:'shared-fate',seed,sourceHash:R.stableHash(config),commands:[],state:R.beginPlayerPhase(R.createState(config)),lab:SF.createLab(),controlRound:null};}
export function act(run,id,action,payload){const shared=run.missionId==='shared-fate',labLib=shared?SF:L,nav=shared?SITE.NAV:NAV,relay=shared?SITE.RELAY:RELAY,exit=shared?SITE.EXIT:EXIT;const near=(u,node,range)=>distance(nav,u,node,range);if(outcome(run)!=='ACTIVE'||run.state.phase!=='PLAYER')throw Error('Mission not accepting player actions');if(run.commands.length>=400)throw Error('Local action budget reached; restart');let next;const custom=['observe','hold','configure','verify','hint','resetLab',...(shared?['prioritize','testFailure']:[])];
 if(action==='relay')throw Error('Use the network workbench; relay requires verified service');
 if(custom.includes(action)){
  if(run.state.mission.extractedUnitIds.length&&['configure','resetLab','prioritize','testFailure'].includes(action))throw Error('Service sealed: configuration is frozen once extraction begins');
  const u=run.state.units.find(u=>u.id===id);if(!u||u.faction!=='PLAYER'||!active(u)||u.ap<1)throw Error('An active operative needs 1 AP');
  if(action==='observe'&&(u.role!=='R'||!near(u,exit,12)))throw Error('Recon must be within 12 m of the extraction telemetry console');
  if(action==='hold'&&(u.role!=='E'||!near(u,exit,7.1)))throw Error('Entry must hold the power access point within 7.1 m of extraction');
  if(action==='prioritize'&&u.id!=='E1')throw Error('Sari implements the approved service priorities');
  if(['configure','verify','resetLab','testFailure'].includes(action)){if(u.role!=='T'||!near(u,relay,3.55))throw Error('Technical must be within 3.55 m of relay');const guard=run.state.units.find(u=>u.role==='E');if(run.controlRound!==run.state.round||!active(guard)||!near(guard,exit,7.1))throw Error('Entry must hold access this turn');if(!run.lab.observed)throw Error('Earn Recon topology evidence first');}
  next=structuredClone(run);next.state.units.find(x=>x.id===id).ap--;
  if(action==='hold')next.controlRound=next.state.round;else next.lab=labLib.labAction(next.lab,action==='resetLab'?'reset':action,payload);
  const verified=next.lab.verified&&next.lab.verifiedRevision===next.lab.revision;
  next.state.nodes=next.state.nodes.map(n=>n.id==='RELAY'?{...n,state:verified?'VERIFIED':'OBSERVED'}:n);next.state.battlefield.relayLinked=verified;
  next.state.events.push({type:'LOCAL_LAB_'+action.toUpperCase(),unitId:id,round:next.state.round,revision:next.lab.revision});
 }else if(action==='end'){next={...run,state:R.beginPlayerPhase(R.resolveClockStatePhase(runThreatPhase(R.beginThreatPhase(run.state)).state,{advance:!run.lab.verified}))};}else{next=H.act(run,id,action,payload);}
 return {...next,commands:[...run.commands,{id,action,payload:payload??null}]};}
export function restoreSession(text){if(typeof text!=='string'||text.length>2000000)throw Error('Save budget');const saved=JSON.parse(text);if(!['prim3.training.network/v1','prim3.shared-fate/v1'].includes(saved.schema)||!Number.isInteger(saved.seed)||!Array.isArray(saved.commands)||saved.commands.length>400)throw Error('Incompatible local save');let r=saved.schema==='prim3.shared-fate/v1'?createSharedRun(saved.seed):createRun(saved.seed,saved.lab?.variant);for(const c of saved.commands)r=act(r,c.id,c.action,c.payload);if(R.stableHash(r)!==R.stableHash(saved))throw Error('Replay mismatch; source retained');return r;}
export function report(run){return {...(run.missionId==='shared-fate'?SF:L).evaluateLab(run.lab),tacticalOutcome:outcome(run),turn:run.state.round,trace:run.lab.events};}

export function restoreRun(text){const r=restoreSession(text);if(r.schema!=='prim3.training.network/v1')throw Error('Different mission save');return r;}
