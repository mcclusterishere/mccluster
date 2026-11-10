import {mountSoleSpatial} from './sole-spatial.mjs';
import {arcadeRequest,arcadeCloudAvailable} from './cloud.mjs';
import {missionKey,validateMission} from './mission-contract.mjs';
import {accountScope,enqueueResult,settleResult,discardResult,pendingFor,claimStartIntent,clearStartIntent} from './result-outbox.mjs';
import {SOLE_MISSION,STREET_STOPS,validateSoleMission,newStreetRun,roadGraph,streetPath,targetPoint,stepStreet,arriveStreetObjective,encounterAction} from './sole-street-engine.mjs';
const names=['Robbery 1s','Velocity 1s','Ghost Soles','Gravity Highs','Return entrance'];
// A finished cloud run must remain recoverable until the server accepts its result.
export function soleResultForRetry(saved,cloudRun,encounters,index,status){
 const body=saved?.pending?.body;
 if(!['won','failed'].includes(status)||!cloudRun||saved?.pending?.id!==cloudRun||
    body?.status!==status||!Number.isInteger(body?.served)||body.served!==index||
    !Array.isArray(body.encounters)||body.encounters.some(id=>typeof id!=='string'||encounters[id]!=='done'))return null;
 return {id:cloudRun,body:{status,served:index,encounters:[...body.encounters]}};
}
export function solePersistedSession(state,locationId,cloudRun,pending){
 const active=['playing','paused','ready'].includes(state.status);
 const retryable=['won','failed'].includes(state.status)&&cloudRun&&pending?.id===cloudRun&&pending?.body?.status===state.status;
 return active||retryable?{...state,locationId,cloudRun,pending:retryable?pending:null}:null;
}
export function mountSoleStreet(root,onFinish,{locationId,point,neighborhood,onReturn}){
 const key='here.city-arcade.sole-street.session.v1:'+locationId,draftKey='here.city-arcade.sole-street.mission.v1:'+locationId;
 let revision=null,cloudRun=null,busy=false,disposed=false,pending=null,cloudReady=false;
 const cloudId=missionKey('designer-kicks-sole-run',locationId),GAME='designer-kicks-sole-run',scope=accountScope();
 let config=structuredClone(SOLE_MISSION);try{config=validateSoleMission(JSON.parse(localStorage.getItem(draftKey)));}catch{}
 let state=newStreetRun(config,neighborhood,point),graph=roadGraph(neighborhood,config.blockedRoads),frame,last=0,recorded=false,error='';
 try{const saved=JSON.parse(localStorage.getItem(key));if(saved&&saved.locationId===locationId&&Number.isFinite(saved.remaining)&&saved.remaining>=0&&saved.remaining<=300&&(saved.remaining>0||['won','failed'].includes(saved.status))&&Number.isInteger(saved.index)&&saved.index>=0&&saved.index<=4&&Number.isFinite(saved.score)&&saved.score>=0&&saved.score<=4000&&Array.isArray(saved.player)&&saved.player.length===2&&saved.player.every(Number.isFinite)&&['playing','paused','ready','won','failed'].includes(saved.status)){
  const base=newStreetRun(saved.config,neighborhood,point);
  if(saved.player[0]<neighborhood.bounds.minX||saved.player[0]>neighborhood.bounds.maxX||saved.player[1]<neighborhood.bounds.minZ||saved.player[1]>neighborhood.bounds.maxZ)throw Error('Invalid saved position');
  const encounters={};for(const e of base.config.encounters){const phase=saved.encounters?.[e.id];if(['inspected','identified','confiscated','done','dismissed'].includes(phase))encounters[e.id]=phase;}
  cloudRun=typeof saved.cloudRun==='string'?saved.cloudRun:null;
  const terminal=['won','failed'].includes(saved.status);
  if(terminal){pending=soleResultForRetry(saved,cloudRun,encounters,saved.index,saved.status);if(!pending)throw Error('Missing pending result');}
  state={...base,player:[...saved.player],remaining:saved.remaining,index:saved.index,score:saved.score,encounters,status:terminal?saved.status:saved.status==='ready'?'ready':'paused'};
  recorded=terminal;graph=roadGraph(neighborhood,state.config.blockedRoads);
 }}catch{}
 // W2: any legacy session receipt moves into the account outbox; the outbox, not the gameplay save, owns retries.
 if(pending)enqueueResult(scope,{id:pending.id,game:GAME,locationId,body:pending.body});
 pending=pendingFor(scope,GAME,locationId)[0]||null;
 const abort=new AbortController(),keys=new Set(),held=new Map(),listen=(el,event,fn)=>el.addEventListener(event,fn,{signal:abort.signal});
 root.innerHTML=`<div class="mini-badge">Designer Kicks / Bridgeport street run</div><h2 id="play-title">Sole Run</h2><p class="gps-objective" role="status"></p><div class="run-hud"><div class="stat"><small>Time</small><b data-time></b></div><div class="stat"><small>Pairs</small><b data-pairs></b></div><div class="stat"><small>Points</small><b data-score></b></div></div><canvas class="tea-scene" width="600" height="400" tabindex="0" aria-label="Bridgeport street run. Move with arrows or WASD; stay on the streets."></canvas><canvas class="sole-minimap" width="300" height="260" aria-label="Minimap with player, route and next checkpoint"></canvas><p data-sole-status role="status"></p><div class="tea-buttons"><button data-hold="up" aria-label="Move up">↑</button><button data-hold="left" aria-label="Move left">←</button><button data-hold="down" aria-label="Move down">↓</button><button data-hold="right" aria-label="Move right">→</button></div><div class="actions"><button class="action primary" data-sole-start>Start / resume</button><button class="action" data-sole-pause>Pause</button><button class="action" data-sole-return>Return to map</button></div><section data-encounter><h3>Designer Kicks Fashion Police</h3><p>Optional costume badge · look for the orange decoy. Inspect the shoes, identify the mismatch, confiscate stage props and perform the on-camera skit. Your device camera is not used.</p><div data-encounter-actions></div></section><details class="tea-tuning"><summary>Mission controls</summary><div class="actions"><button class="action" data-sole-load>Load private mission</button><button class="action" data-sole-save>Save private mission</button><button class="action" data-sole-cloud-play disabled>Play saved mission</button><button class="action" data-sole-retry hidden>Retry result save</button><button class="action" data-sole-reconnect hidden>Reconnect cloud</button><button class="action" data-sole-discard hidden>Discard unsaved result</button></div><p data-sole-cloud-status role="status">Settings start on this device. Load the current cloud revision before saving.</p><p>Edit timing, points, checkpoint order, closed road IDs and optional encounters. Encounter names and roasts describe invented costume decoys. Apply restarts the run.</p><label>Mission document<textarea data-sole-config rows="12" spellcheck="false"></textarea></label><button class="action" data-sole-apply>Validate, save and restart</button></details><p><a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors · ODbL</a> · CT GIS 2023 footprints. Widths and game props are authored.</p>`;
 const $=s=>root.querySelector(s),canvas=$('.tea-scene'),ctx=canvas.getContext('2d'),mini=$('.sole-minimap'),mc=mini.getContext('2d');$('[data-sole-config]').value=JSON.stringify(state.config,null,2);
 function clear(){keys.clear();held.clear();}
 function persist(){try{const snapshot=solePersistedSession(state,locationId,cloudRun,pending);if(snapshot)localStorage.setItem(key,JSON.stringify(snapshot));else localStorage.removeItem(key);}catch{}}
 let spatialDisabled=null;
 const disposeSpatial=mountSoleSpatial(root,{locationId,canEnter:()=>!busy&&['playing','paused'].includes(state.status),onArrival:arrival=>{const next=arriveStreetObjective(state,{...arrival,locationId});if(next===state)return false;state=next;recordCompletion();persist();return true;},getMission:()=>({route:state.config.route,index:state.index,status:state.status,blockedRoads:state.config.blockedRoads}),onActive:active=>{
  if(active){pause();spatialDisabled=new Map([...root.querySelectorAll('button,input,textarea')].filter(el=>!el.closest('[data-sole-spatial]')).map(el=>[el,el.disabled]));for(const el of spatialDisabled.keys())el.disabled=true;canvas.inert=true;}
  else{for(const [el,disabled]of spatialDisabled||[])el.disabled=disabled;spatialDisabled=null;canvas.inert=false;syncCloud();if(pending&&!disposed)finishCloud();}
 }});
 function setState(next){state=next;graph=roadGraph(neighborhood,next.config.blockedRoads);recorded=false;error='';clear();cloudRun=null;$('[data-sole-config]').value=JSON.stringify(next.config,null,2);syncPending();persist();}
 function syncPending(){if(disposed)return;pending=pendingFor(scope,GAME,locationId)[0]||null;$('[data-sole-retry]').hidden=!pending;$('[data-sole-discard]').hidden=!pending;$('[data-sole-reconnect]').hidden=!(pending&&!cloudReady);}
  function syncCloud(){if(disposed)return;root.querySelectorAll('[data-sole-load],[data-sole-save],[data-sole-cloud-play],[data-sole-retry]').forEach(b=>b.disabled=!cloudReady||busy||!!spatialDisabled);$('[data-sole-cloud-play]').disabled=!cloudReady||busy||!!spatialDisabled||revision===null;$('[data-sole-retry]').disabled=!cloudReady||busy||!!spatialDisabled;$('[data-sole-reconnect]').disabled=busy;$('[data-sole-discard]').disabled=busy;syncPending();}
  syncPending();
  syncCloud();cloudStatus('Checking cloud availability. Local play and device saves remain available.');
  function unavailableText(){return pending?'Cloud missions unavailable. Your finished run is not yet saved to your account; it stays on this device. Reconnect to retry. Local play and device saves remain available.':'Cloud missions unavailable. Local play and device saves remain available.';}
  function checkCloud(){return arcadeCloudAvailable().then(available=>{if(disposed)return;cloudReady=available;syncCloud();cloudStatus(available?(pending?'Completed run restored. Retry saving its practice result to your account.':'Cloud missions available. Load the current revision before saving.'):unavailableText());});}
  checkCloud();
  listen($('[data-sole-reconnect]'),'click',()=>{if(busy)return;cloudStatus('Reconnecting to cloud missions.');checkCloud().then(()=>{if(!disposed&&cloudReady&&pending)finishCloud();});});
  listen($('[data-sole-discard]'),'click',()=>{if(!pending||busy)return;const entry=pending;if(!window.confirm('This finished run has not been saved to your account. Discard it from this device? It will not count as a saved practice result.'))return;discardResult(scope,entry.id);syncPending();persist();cloudStatus('Unsaved result discarded on this device. It was never saved to your account.');});
 function cloudStatus(text){if(!disposed)$('[data-sole-cloud-status]').textContent=text;}
 async function cloudTask(fn){if(busy||!cloudReady)return;busy=true;root.querySelectorAll('[data-sole-load],[data-sole-save],[data-sole-cloud-play],[data-sole-apply]').forEach(b=>b.disabled=true);try{await fn();}catch(e){if(e.cloudUnavailable)cloudReady=false;cloudStatus(e.message+(pending&&!cloudReady?' Your finished run is not yet saved to your account; it stays on this device. Reconnect to retry. Local play and device saves remain available.':' Local play and device saves remain available.'));}finally{busy=false;if(!disposed){root.querySelectorAll('[data-sole-load],[data-sole-save],[data-sole-apply]').forEach(b=>b.disabled=false);syncCloud();}}}
 listen($('[data-sole-load]'),'click',()=>cloudTask(async()=>{const m=await arcadeRequest('/missions/'+cloudId);if(disposed)return;if(!m){revision=0;cloudStatus('No saved mission. Save your configuration as revision 1.');return;}const d=validateMission(m.document);if(d.locationId!==locationId||!d.sole)throw Error('Mission mismatch');setState(newStreetRun(d.sole,neighborhood,point));revision=m.revision;cloudStatus('Loaded private revision '+revision+'.');}));
 listen($('[data-sole-save]'),'click',()=>cloudTask(async()=>{if(revision===null){cloudStatus('Load the current cloud revision first.');return;}const c=validateSoleMission(JSON.parse($('[data-sole-config]').value));newStreetRun(c,neighborhood,point);const document={version:1,gameId:'designer-kicks-sole-run',locationId,sole:c};const m=await arcadeRequest('/missions/'+cloudId,'PUT',{document,expectedRevision:revision});if(disposed)return;revision=m.revision;cloudStatus('Private mission revision '+revision+' saved.');}));
 listen($('[data-sole-cloud-play]'),'click',()=>cloudTask(async()=>{const intent=claimStartIntent(scope,cloudId,revision);let r;try{r=await arcadeRequest('/start/'+cloudId,'POST',{expectedRevision:revision,startKey:intent.startKey});}catch(e){if(e.status===409)clearStartIntent(scope,cloudId);throw e;}if(disposed)return;clearStartIntent(scope,cloudId);const d=validateMission(r.document);if(d.locationId!==locationId||!d.sole)throw Error('Mission mismatch');setState(newStreetRun(d.sole,neighborhood,point));cloudRun=r.id;state.status='playing';persist();canvas.focus();cloudStatus('Playing private revision '+r.revision+'.');}));
 // A 409 rejects with cloud.mjs's finish-conflict text; cloudTask shows it and the receipt stays queued (W2).
 async function finishCloud(){if(!pending)return;const attempt=pending;await cloudTask(async()=>{const r=await arcadeRequest('/finish/'+attempt.id,'POST',attempt.body);if(disposed)return;settleResult(scope,attempt.id);if(pending===attempt)pending=null;persist();cloudStatus('Practice result saved to your account.');onFinish({...state,score:Number(r.score),cloud:'saved'});});if(!disposed){syncPending();persist();}}
 listen($('[data-sole-retry]'),'click',finishCloud);
 function pause(){if(state.status==='playing')state.status='paused';clear();persist();}
 listen($('[data-sole-pause]'),'click',pause);listen($('[data-sole-start]'),'click',()=>{if(['ready','paused'].includes(state.status)){state.status='playing';canvas.focus();}});
 listen($('[data-sole-return]'),'click',()=>{pause();onReturn();});listen(window,'blur',pause);listen(window,'pagehide',pause);listen(document,'visibilitychange',()=>{if(document.hidden)pause();});
 listen($('[data-sole-apply]'),'click',()=>{try{const c=validateSoleMission(JSON.parse($('[data-sole-config]').value));const next=newStreetRun(c,neighborhood,point);localStorage.setItem(draftKey,JSON.stringify(c));setState(next);persist();}catch(e){error=e.message;}});
 const map={ArrowUp:'up',w:'up',ArrowDown:'down',s:'down',ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right'};
 listen(canvas,'keydown',e=>{if(map[e.key]){e.preventDefault();keys.add(map[e.key]);}});listen(window,'keyup',e=>keys.delete(map[e.key]));
 root.querySelectorAll('[data-hold]').forEach(b=>{listen(b,'pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);held.set(e.pointerId,b.dataset.hold);});for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(b,type,e=>held.delete(e.pointerId));listen(b,'click',e=>{if(e.detail)return;const k=b.dataset.hold;for(let i=0;i<8;i++)state=stepStreet(state,{x:(k==='right')-(k==='left'),y:(k==='down')-(k==='up')},.05,graph);});});
 let encounterSignature='';
 function encounter(){
  const e=state.config.encounters.find(e=>{const p=STREET_STOPS.find(p=>p.id===e.stopId).point;return Math.hypot(p[0]-state.player[0],p[1]-state.player[1])<12;});
  const phase=e?(state.encounters[e.id]||'new'):'',signature=(e?.id||'none')+phase+state.status;if(signature===encounterSignature)return;encounterSignature=signature;
  const box=$('[data-encounter-actions]');box.replaceChildren();if(!e){box.textContent='Optional encounter is marked orange on the minimap. Main route stays green.';return;}
  const title=document.createElement('p');title.textContent=e.name+' · '+phase;box.append(title);
  const add=(label,action,clue)=>{const b=document.createElement('button');b.className='action';b.textContent=label;b.disabled=state.status!=='playing';b.onclick=()=>{state=encounterAction(state,e.id,action,clue);};box.append(b);};
  if(phase==='new')add('Inspect the shoes','inspect');
  if(phase==='inspected')e.clues.forEach((c,i)=>add(c,'identify',i));
  if(phase==='identified')add('Confiscate stage-prop shoes','confiscate');
  if(phase==='confiscated')add('Perform on-camera roast','roast');
 }
 function drawMap(c,w,h,overview){if(!c)return;c.fillStyle='#152f37';c.fillRect(0,0,w,h);const scale=overview ? .82 : 3.2,ox=overview?150:w/2-state.player[0]*scale,oy=overview?290:h/2-state.player[1]*scale;
  const xy=p=>[p[0]*scale+ox,p[1]*scale+oy];const line=(points,color,width)=>{c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach((p,i)=>{const [x,y]=xy(p);i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();};
  for(const p of neighborhood.places||[]){if(!p.footprint)continue;c.fillStyle='#36525c';c.beginPath();p.footprint.forEach((p,i)=>{const [x,y]=xy(p);i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();c.fill();}
  for(const r of neighborhood.roads)line(r.points,state.config.blockedRoads.includes(r.id)?'#bd6571':'#71888b',Math.max(1,r.width*scale));
  const path=streetPath(graph,state.player,targetPoint(state));if(path.length){line([state.player,...path],'#9bff98',overview?2:4);for(const p of path){const [x,y]=xy(p);c.fillStyle='#adffad';c.fillRect(x-3,y-3,6,6);}}
  for(const e of state.config.encounters){if(['done','dismissed'].includes(state.encounters[e.id]))continue;const p=STREET_STOPS.find(p=>p.id===e.stopId).point,[x,y]=xy(p);c.fillStyle='#ffb269';c.beginPath();c.arc(x,y,overview?4:10,0,Math.PI*2);c.fill();}
  const [tx,ty]=xy(targetPoint(state));c.fillStyle='#d6ff84';c.fillRect(tx-5,ty-10,10,10);
  const [x,y]=xy(state.player);c.fillStyle='#8af2e3';c.fillRect(x-5,y-3,10,14);c.fillStyle='#efd0aa';c.beginPath();c.arc(x,y-8,5,0,Math.PI*2);c.fill();
  if(!overview){c.fillStyle='#fff';c.font='bold 24px system-ui';c.fillText(names[state.index],16,30);if(state.status!=='playing'){c.fillStyle='#122733bb';c.fillRect(0,145,w,90);c.fillStyle='#fff';c.font='bold 28px system-ui';c.fillText({ready:'Ready to run',paused:'Paused',won:'Collection complete',failed:'Time is up'}[state.status],20,198);}}
 }
 function recordCompletion(){
  if(['won','failed'].includes(state.status)&&!recorded){recorded=true;if(cloudRun){const body={status:state.status,served:state.index,encounters:Object.keys(state.encounters).filter(id=>state.encounters[id]==='done')};enqueueResult(scope,{id:cloudRun,game:GAME,locationId,body});pending={id:cloudRun,body};$('[data-sole-retry]').hidden=false;$('[data-sole-discard]').hidden=false;}persist();onFinish({...state,cloud:cloudRun?'pending':'local'});if(pending&&!disposed&&!spatialDisabled)finishCloud();}
 }
 function tick(now){const down=k=>keys.has(k)||[...held.values()].includes(k);state=stepStreet(state,{x:Number(down('right'))-Number(down('left')),y:Number(down('down'))-Number(down('up'))},(now-last)/1000,graph);last=now;
  $('.gps-objective').textContent='Next: '+names[state.index]+' · follow the green route';$('[data-time]').textContent=Math.ceil(state.remaining)+'s';$('[data-pairs]').textContent=state.index+'/4';$('[data-score]').textContent=state.score;
  const message=error||state.message;if($('[data-sole-status]').textContent!==message)$('[data-sole-status]').textContent=message;
  encounter();drawMap(ctx,600,400,false);drawMap(mc,300,260,true);
  recordCompletion();
  frame=requestAnimationFrame(tick);
 }
 frame=requestAnimationFrame(tick);
 return ()=>{disposed=true;disposeSpatial();persist();cancelAnimationFrame(frame);abort.abort();clear();graph=null;neighborhood=null;};
}
