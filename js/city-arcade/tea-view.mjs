import { arcadeRequest, arcadeCloudAvailable } from './cloud.mjs';
import { GAME_ID, validateMission } from './mission-contract.mjs';
import { TEA_MISSION, BREWERS, newTeaAction, stepTea } from './tea-action.mjs';
import {accountScope,enqueueResult,settleResult,discardResult,pendingFor,claimStartIntent,clearStartIntent} from './result-outbox.mjs';
const colors = ['#f4dc78', '#7ae3b0', '#dba6ec', '#efa477'];
export function mountTea(root, onFinish, {locationId,onReturn} = {}) {
  let state = newTeaAction(), frame, last = 0, saved = false, configError = '';
  const sessionKey='here.city-arcade.tea-action.session.v1:'+locationId;
  const keys = new Set(), held = new Map(), abort = new AbortController();
  let revision=null, cloudRun=null, pendingResult=null, busy=false,disposed=false;
  const scope=accountScope();
  const listen = (el, event, fn) => el.addEventListener(event, fn, { signal: abort.signal });
  root.innerHTML = `<div class="mini-badge">GAURANFUCKING TEA / counter sprint</div>
    <h2 id="play-title">Tea Rush</h2><p>Move to a brewer, hold Act to brew, then carry the right blend to your customer.</p>
    <div class="run-hud"><div class="stat"><small>Time</small><b data-time></b></div><div class="stat"><small>Served</small><b data-served></b></div><div class="stat"><small>Score</small><b data-score></b></div></div>
    <canvas class="tea-scene" width="600" height="400" tabindex="0" aria-label="Tea shop. Use arrows or WASD to move and Space to brew or serve.">Use the movement buttons below to brew and deliver tea.</canvas>
    <p data-tea-status role="status"></p><div class="tea-buttons" aria-label="Tea movement and actions">
    <button data-hold="up" aria-label="Move up">↑</button><button data-hold="left" aria-label="Move left">←</button><button data-hold="down" aria-label="Move down">↓</button><button data-hold="right" aria-label="Move right">→</button><button data-hold="act">Act</button></div>
    <div class="actions"><button class="action primary" data-start>Play local settings</button><button class="action" data-pause disabled>Pause</button><button class="action" data-again>Restart</button><button class="action" data-return>Return to map</button></div>
    <details class="tea-tuning"><summary>Mission settings · this run</summary><p>Configure, then restart to play your settings. Nothing is published.</p>
    <label>Shift seconds <input data-setting="duration" type="number" min="30" max="180" value="75"></label>
    <label>Run speed <input data-setting="speed" type="number" min="100" max="300" value="200"></label>
    <label>Brew seconds <input data-setting="brewSeconds" type="number" min="0.5" max="3" step="0.1" value="1.2"></label>
    <label>Points per delivery <input data-setting="reward" type="number" min="0" max="500" value="100"></label>
    <label>Spawn X <input data-setting="spawnX" type="number" min="20" max="580" value="300"></label>
    <label>Spawn Y <input data-setting="spawnY" type="number" min="130" max="300" value="220"></label>
    <div class="actions"><button class="action" data-cloud-load>Load saved mission</button><button class="action" data-cloud-save>Save private mission</button><button class="action" data-cloud-play disabled>Play saved mission</button><button class="action" data-cloud-retry hidden>Retry result save</button><button class="action" data-cloud-reconnect hidden>Reconnect cloud</button><button class="action" data-cloud-discard hidden>Discard unsaved result</button></div><p data-cloud-status role="status">Local settings only. Save a private mission to use cloud practice results.</p><label>Customer order (comma separated) <input data-route value="Lemon,Mint,Berry,Ginger,Lemon"></label></details>`;
  const $ = s => root.querySelector(s), canvas = $('canvas'), ctx = canvas.getContext('2d');
  function clear() { keys.clear(); held.clear(); }
  function persist(){try{if(state.status==='won'||state.status==='failed'){if(!pendingResult){localStorage.removeItem(sessionKey);return;}}localStorage.setItem(sessionKey,JSON.stringify({state,cloudRun,pendingResult}));}catch{}}

  function configFromForm() {
    const config = structuredClone(TEA_MISSION);
    root.querySelectorAll('[data-setting]').forEach(el => {
      if (el.dataset.setting.startsWith('spawn')) config.spawn[el.dataset.setting.slice(-1).toLowerCase()] = Number(el.value);
      else config[el.dataset.setting] = Number(el.value);
    });
    config.route = $('[data-route]').value.split(',').map(s => s.trim());
    return newTeaAction(config).config;
  }
  function useConfig(config) {
    state=newTeaAction(config);saved=false;configError='';clear();cloudRun=null;
    root.querySelectorAll('[data-setting]').forEach(el=>el.value=el.dataset.setting.startsWith('spawn')?config.spawn[el.dataset.setting.slice(-1).toLowerCase()]:config[el.dataset.setting]);
    $('[data-route]').value=config.route.join(',');
    $('[data-start]').disabled=false;$('[data-pause]').disabled=true;$('[data-pause]').textContent='Pause';
    syncPending();
  }
  // W2: the account outbox, not the gameplay save, owns unacknowledged results; restarts never clear it.
  function syncPending(){if(disposed)return;pendingResult=pendingFor(scope,GAME_ID,locationId)[0]||null;$('[data-cloud-retry]').hidden=!pendingResult;$('[data-cloud-discard]').hidden=!pendingResult;$('[data-cloud-reconnect]').hidden=!(pendingResult&&!cloudReady);}
  function reset(){try{useConfig(configFromForm());}catch(e){configError=e.message;}}
  let cloudReady=false;
  function syncCloud(){if(disposed)return;root.querySelectorAll('[data-cloud-load],[data-cloud-save],[data-cloud-play],[data-cloud-retry]').forEach(b=>b.disabled=!cloudReady||busy);$('[data-cloud-play]').disabled=!cloudReady||busy||revision===null;$('[data-cloud-retry]').disabled=!cloudReady||busy;$('[data-cloud-reconnect]').disabled=busy;$('[data-cloud-discard]').disabled=busy;syncPending();}
  syncCloud();cloudStatus('Checking cloud availability. Local play and device saves remain available.');
  function unavailableText(){return pendingResult?'Cloud missions unavailable. Your finished shift is not yet saved to your account; it stays on this device. Reconnect to retry. Local play and device saves remain available.':'Cloud missions unavailable. Local play and device saves remain available.';}
  function checkCloud(){return arcadeCloudAvailable().then(available=>{if(disposed)return;cloudReady=available;syncCloud();cloudStatus(available?(pendingResult?'Completed shift restored. Retry saving its practice result to your account.':'Cloud missions available. Load the current revision before saving.'):unavailableText());});}
  checkCloud();
  listen($('[data-cloud-reconnect]'),'click',()=>{if(busy)return;cloudStatus('Reconnecting to cloud missions.');checkCloud().then(()=>{if(!disposed&&cloudReady&&pendingResult)finishCloud();});});
  listen($('[data-cloud-discard]'),'click',()=>{if(!pendingResult||busy)return;const entry=pendingResult;if(!window.confirm('This finished shift has not been saved to your account. Discard it from this device? It will not count as a saved practice result.'))return;discardResult(scope,entry.id);syncPending();persist();cloudStatus('Unsaved result discarded on this device. It was never saved to your account.');});
  function cloudStatus(text){if(!disposed)$('[data-cloud-status]').textContent=text;}
  async function cloudTask(fn){
    if(busy||!cloudReady)return;busy=true;
    root.querySelectorAll('[data-cloud-load],[data-cloud-save],[data-cloud-play],[data-again],[data-start]').forEach(b=>b.disabled=true);
    try{await fn();}catch(e){if(e.cloudUnavailable)cloudReady=false;cloudStatus(e.message+(pendingResult&&!cloudReady?' Your finished shift is not yet saved to your account; it stays on this device. Reconnect to retry. Local play and device saves remain available.':' Local play and device saves remain available.'));}finally{busy=false;if(!disposed){
      root.querySelectorAll('[data-cloud-load],[data-cloud-save],[data-again]').forEach(b=>b.disabled=false);
      syncCloud();$('[data-start]').disabled=state.status!=='ready';
    }}
  }
  listen($('[data-cloud-load]'),'click',()=>cloudTask(async()=>{
    const m=await arcadeRequest('/missions/'+locationId);if(disposed)return;
    if(!m){revision=0;cloudStatus('No saved mission here. Configure and save revision 1.');return;}
    const mission=validateMission(m.document);if(mission.locationId!==locationId)throw Error('Saved location mismatch');
    revision=m.revision;useConfig(mission.tea);cloudStatus('Loaded private revision '+revision+'.');
  }));
  listen($('[data-cloud-save]'),'click',()=>cloudTask(async()=>{
    if(revision===null){cloudStatus('Load the saved mission first to check its revision.');return;}
    const document=validateMission({version:1,gameId:GAME_ID,locationId,tea:configFromForm()});
    const m=await arcadeRequest('/missions/'+locationId,'PUT',{document,expectedRevision:revision});if(disposed)return;
    revision=m.revision;cloudStatus('Private mission revision '+revision+' saved.');
  }));
  listen($('[data-cloud-play]'),'click',()=>cloudTask(async()=>{
    const intent=claimStartIntent(scope,locationId,revision);let r;try{r=await arcadeRequest('/start/'+locationId,'POST',{expectedRevision:revision,startKey:intent.startKey});}catch(e){if(e.status===409)clearStartIntent(scope,locationId);throw e;}if(disposed)return;clearStartIntent(scope,locationId);
    const mission=validateMission(r.document);if(mission.locationId!==locationId)throw Error('Saved location mismatch');
    useConfig(mission.tea);cloudRun=r.id;state.status='playing';$('[data-pause]').disabled=false;canvas.focus();
    cloudStatus('Playing saved revision '+r.revision+'. Results are private practice, not reward claims.');
  }));
  async function finishCloud(){
    if(!pendingResult||busy)return;
    const pending=pendingResult;
    await cloudTask(async()=>{
      // A 409 rejects with cloud.mjs's finish-conflict text; cloudTask shows it and the receipt stays queued (W2).
      const r=await arcadeRequest('/finish/'+pending.id,'POST',pending.body);
      if(disposed)return;
      settleResult(scope,pending.id);if(pendingResult===pending)pendingResult=null;persist();cloudStatus('Practice result saved to your account.');
      onFinish({...state,score:Number(r.score),cloud:'saved'});
    });
    if(!disposed){syncPending();persist();}
  }
  listen($('[data-cloud-retry]'),'click',finishCloud);
  listen($('[data-return]'),'click',()=>{pause();onReturn?.();});
  listen($('[data-again]'), 'click', reset);
  listen($('[data-start]'), 'click', () => { state.status = 'playing'; $('[data-start]').disabled = true; $('[data-pause]').disabled = false; canvas.focus(); });
  function pause() { if (state.status === 'playing') { state.status = 'paused'; clear(); $('[data-pause]').textContent = 'Resume'; persist(); } }
  listen($('[data-pause]'), 'click', () => { if (state.status === 'paused') { state.status = 'playing'; $('[data-pause]').textContent = 'Pause'; } else pause(); });
  listen(window, 'blur', pause); listen(window, 'pagehide', pause); listen(document, 'visibilitychange', () => { if (document.hidden) pause(); });
  const mapping = { ArrowUp:'up', w:'up', ArrowDown:'down', s:'down', ArrowLeft:'left', a:'left', ArrowRight:'right', d:'right', ' ':'act' };
  listen(root, 'keydown', e => { if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) return; const k = mapping[e.key]; if(k) { e.preventDefault(); keys.add(k); } });
  listen(window, 'keyup', e => keys.delete(mapping[e.key]));
  for (const button of root.querySelectorAll('[data-hold]')) {
    listen(button, 'pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); held.set(e.pointerId, button.dataset.hold); });
    for (const event of ['pointerup','pointercancel','lostpointercapture']) listen(button, event, e => held.delete(e.pointerId));
    // Keyboard activation of touch controls is a short, deterministic step.
    listen(button, 'click', e => { if(e.detail !== 0) return; const k=button.dataset.hold; for(let i=0;i<5;i++) state=stepTea(state,{ x:(k==='right')-(k==='left'), y:(k==='down')-(k==='up'),act:k==='act'},.05); });
  }
  function person(x,y,color) {
    ctx.fillStyle='#0005';ctx.beginPath();ctx.ellipse(x,y+18,15,5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=color;ctx.fillRect(x-10,y-3,20,20);ctx.fillStyle='#e2b994';ctx.beginPath();ctx.arc(x,y-12,9,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#17212b';ctx.fillRect(x-9,y+17,7,11);ctx.fillRect(x+2,y+17,7,11);
  }
  function draw(now) {
    const active = k => keys.has(k) || [...held.values()].includes(k);
    state=stepTea(state,{x:Number(active('right'))-Number(active('left')),y:Number(active('down'))-Number(active('up')),act:active('act')},(now-last)/1000);last=now;
    $('[data-time]').textContent=Math.ceil(state.remaining)+'s';$('[data-served]').textContent=state.index+'/'+state.config.route.length;$('[data-score]').textContent=state.score;
    const message = configError || (state.status==='paused' ? 'Paused. Resume when ready.' : state.message);
    if($('[data-tea-status]').textContent!==message && !root.querySelector('input:focus')) $('[data-tea-status]').textContent=message;
    if((state.status==='won'||state.status==='failed')&&!saved){saved=true;onFinish({...state,cloud:cloudRun?'pending':'local'});$('[data-pause]').disabled=true;
      if(cloudRun){const body={status:state.status,served:state.index};enqueueResult(scope,{id:cloudRun,game:GAME_ID,locationId,body});pendingResult={id:cloudRun,body};$('[data-cloud-retry]').hidden=false;$('[data-cloud-discard]').hidden=false;persist();finishCloud();}}
    if(ctx){
      ctx.fillStyle='#193c42';ctx.fillRect(0,0,600,400);
      for(let x=0;x<600;x+=40)for(let y=110;y<330;y+=40){ctx.fillStyle=(x+y)%80?'#264c50':'#2c5556';ctx.fillRect(x,y,39,39);}
      ctx.fillStyle='#b98a59';ctx.fillRect(0,35,600,70);ctx.fillRect(0,330,600,12);
      BREWERS.forEach((b,i)=>{ctx.fillStyle=colors[i];ctx.fillRect(b.x-22,51,44,37);ctx.fillStyle='#ffffff';ctx.font='bold 26px system-ui';ctx.textAlign='center';ctx.fillText(b.tea,b.x,25);ctx.fillStyle='#fff';ctx.fillRect(b.x-9,60,18,19);});
      const wanted=state.config.route[state.index];
      if(wanted){ person(300,365,'#f0ad71'); ctx.fillStyle='#fff';ctx.font='bold 26px system-ui';ctx.textAlign='center';ctx.fillText('↓ '+wanted+' please',300,310); }
      for(let i=state.index+1;i<Math.min(state.index+4,state.config.route.length);i++)person(350+(i-state.index)*45,370,colors[i%4]);
      person(state.player.x,state.player.y,'#79f0d3');
      if(state.cup){ctx.fillStyle=colors[BREWERS.findIndex(b=>b.tea===state.cup)];ctx.fillRect(state.player.x+13,state.player.y-5,12,16);}
      if(state.brewing){ctx.fillStyle='#77f1d2';ctx.fillRect(state.player.x-22,state.player.y-40,44*(1-state.brewing.left/state.config.brewSeconds),5);}
      if(state.status!=='playing'){ctx.fillStyle='#071923bb';ctx.fillRect(0,120,600,160);ctx.fillStyle='#fff';ctx.font='bold 28px system-ui';ctx.textAlign='center';ctx.fillText({ready:'Ready for the rush?',paused:'Paused',won:'Shift complete!',failed:'Shift ended'}[state.status],300,210);}
    }
    frame=requestAnimationFrame(draw);
  }
  try{
    const stored=JSON.parse(localStorage.getItem(sessionKey)),s=stored?.state;
    if(s&&['ready','playing','paused','won','failed'].includes(s.status)&&Number.isInteger(s.index)&&s.index>=0&&s.index<=s.config.route.length&&Number.isFinite(s.remaining)&&s.remaining>=0&&s.remaining<=s.config.duration&&Number.isFinite(s.score)&&s.score>=0&&s.score<=6000&&s.player&&[s.player.x,s.player.y].every(Number.isFinite)&&s.player.x>=20&&s.player.x<=580&&s.player.y>=120&&s.player.y<=315){
      const base=newTeaAction(s.config);useConfig(base.config);
      state={...base,player:{...s.player},remaining:s.remaining,index:s.index,score:s.score,status:s.status==='playing'?'paused':s.status,
        cup:BREWERS.some(b=>b.tea===s.cup)?s.cup:null,message:'Restored your shift on this device.'};
      cloudRun=typeof stored.cloudRun==='string'?stored.cloudRun:null;
      pendingResult=stored.pendingResult&&stored.pendingResult.id===cloudRun&&['won','failed'].includes(stored.pendingResult.body?.status)&&Number.isInteger(stored.pendingResult.body?.served)?stored.pendingResult:null;
      if(pendingResult)enqueueResult(scope,{id:pendingResult.id,game:GAME_ID,locationId,body:pendingResult.body});
      saved=['won','failed'].includes(state.status);
      $('[data-start]').disabled=state.status!=='ready';$('[data-pause]').disabled=state.status!=='paused';$('[data-pause]').textContent='Resume';
    }
  }catch{}
  syncPending();
  frame=requestAnimationFrame(draw);
  return () => { persist(); disposed=true; cancelAnimationFrame(frame); abort.abort(); clear(); };
}
