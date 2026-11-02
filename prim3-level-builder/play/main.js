(function () {
  'use strict';
  if(window.P3CustomLevelError){
    const section=document.createElement('main'),title=document.createElement('h1'),p=document.createElement('p'),a=document.createElement('a');
    title.textContent='This level could not be tested';p.textContent=window.P3CustomLevelError;a.href='../index.html';a.textContent='Return to Level Forge';
    section.append(title,p,a);section.style.cssText='padding:32px;max-width:640px;margin:auto';document.body.replaceChildren(section);return;
  }
  // Capture the original document before UI state, map labels and dialogs mutate it.
  const standaloneDocument='<!doctype html>\n'+document.documentElement.outerHTML;
  const $=id=>document.getElementById(id);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const level=window.P3Level;
  let game=new window.P3Game(level),renderer,busy=false,mode='move',preview=null,targetId=null,question=null,soundOn=true,audioContext=null;
  let busyLabel='',actionSerial=0,helpOpen=false,sheetReturnFocus=null,cameraView='3d';
  const names={E:'ENTRY',R:'RECON',T:'TECHNICAL'};
  const roleCopy={E:level.authoringDocument?'Protect the approach and cover the squad.':'Protect the approach. Open the service gate.',R:'Use elevation, long sightlines and a sensor scan.',T:'Reach the relay, establish the link, then extract.'};
  const portraits={};document.querySelectorAll('[data-unit] img').forEach(i=>{portraits[i.closest('[data-unit]').dataset.unit]=i.src;});
  const coord=n=>`(${n.x}, ${n.y})${n.layer?' · ROOF':''}`;
  const unit=id=>game.units.find(u=>u.id===id);
  const alive=u=>u&&!u.dead&&!u.extracted&&u.hp>0;
  const players=()=>game.units.filter(u=>u.team==='player');
  const selected=()=>alive(unit(game.selectedId))?unit(game.selectedId):players().find(alive)||unit(game.selectedId);
  const message=(text,tone='')=>{if($('message')){$('message').textContent=text;$('message').dataset.tone=tone;}};
  function beep(kind){
    if(!soundOn)return;
    try{
      const C=window.AudioContext||window.webkitAudioContext;if(!C)return;
      audioContext=audioContext||new C();if(audioContext.state==='suspended')audioContext.resume();
      const t=audioContext.currentTime,o=audioContext.createOscillator(),g=audioContext.createGain();
      const v=kind==='shot'?[110,35,.16,.07]:kind==='success'?[620,920,.24,.055]:kind==='error'?[170,90,.14,.03]:[490,700,.055,.022];
      o.type=kind==='shot'?'sawtooth':'sine';o.frequency.setValueAtTime(v[0],t);o.frequency.exponentialRampToValueAtTime(v[1],t+v[2]);g.gain.setValueAtTime(v[3],t);g.gain.exponentialRampToValueAtTime(.0001,t+v[2]);o.connect(g);g.connect(audioContext.destination);o.start(t);o.stop(t+v[2]);
    }catch(e){}
  }
  function setDisabled(id,yes){const n=$(id);if(n)n.disabled=!!yes;}
  function setText(id,text){if($(id))$(id).textContent=text;}
  function setSheetTab(tab){
    if(!['actions','targets','tools'].includes(tab))tab='actions';
    document.querySelectorAll('[data-sheet-tab]').forEach(b=>{const active=b.dataset.sheetTab===tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});
    document.querySelectorAll('[data-sheet-pane]').forEach(p=>p.hidden=p.dataset.sheetPane!==tab);
    const scroll=$('phone-sheet')?.querySelector('.sheet-content');if(scroll)scroll.scrollTop=0;
  }
  function openSheet(tab='actions'){
    if(busy)return;const s=$('phone-sheet');if(!s)return;if(s.hidden)sheetReturnFocus=document.activeElement;s.hidden=false;setSheetTab(tab);
    $('more-actions')?.setAttribute('aria-expanded','true');document.querySelector(`[data-sheet-tab="${tab}"]`)?.focus({preventScroll:true});
  }
  function closeSheet(restore=true){
    const s=$('phone-sheet');if(!s||s.hidden)return;s.hidden=true;$('more-actions')?.setAttribute('aria-expanded','false');
    if(restore&&sheetReturnFocus?.isConnected&&!sheetReturnFocus.disabled)sheetReturnFocus.focus({preventScroll:true});
  }
  function cameraState(view='3d'){
    cameraView=view;
    document.querySelectorAll('[data-camera="top"],[data-camera="3d"]').forEach(n=>{n.classList.toggle('active',n.dataset.camera===view);n.setAttribute('aria-pressed',String(n.dataset.camera===view));});
  }
  function focusOperative(id){renderer.focusOperative?renderer.focusOperative(id):renderer.home();if($('overview-map'))$('overview-map').hidden=true;cameraState(cameraView);updateLabels();}
  function cleanPreview(){preview=null;targetId=null;question=null;setText('practice-feedback','Optional practice never spends AP.');if($('practice-answer'))$('practice-answer').value='';}
  function updateObjective(){
    const h=game.hackProgress||0;
    setText('objective-text',h>=2?'Bring the squad to extraction.':`Reach (0, 0) · Connect ${Math.min(h,2)}/2 with T`);
    setText('mission-status',game.status==='won'?'MISSION COMPLETE':game.status==='lost'?'MISSION FAILED':h>=2?'EXTRACT SQUAD':'SECURE RELAY');
  }
  function updateUI(){
    const u=selected(),locked=busy||game.status!=='active'||game.phase!=='player';
    setText('turn-indicator',String(game.turn).padStart(2,'0'));
    setText('phase-indicator',busy?busyLabel:game.status==='active'?'YOUR MOVE':game.status==='won'?'COMPLETE':'MISSION LOST');
    if(renderer)setText('renderer-mode',renderer.getMode()==='webgl'?'WEBGL':'COMPATIBILITY');
    updateObjective();
    for(const p of players()){
      document.querySelectorAll(`[data-unit="${p.id}"]`).forEach(b=>{b.classList.toggle('selected',p.id===game.selectedId);b.setAttribute('aria-pressed',String(p.id===game.selectedId));if(b.tagName==='BUTTON')b.disabled=busy||!alive(p);});
      document.querySelectorAll(`[data-hp="${p.id}"]`).forEach(n=>n.textContent=`${Math.max(0,p.hp)}/${p.maxHp}`);
      document.querySelectorAll(`[data-ap="${p.id}"]`).forEach(n=>n.textContent=p.extracted?'EXTRACTED':alive(p)?'●'.repeat(p.ap)+'○'.repeat(Math.max(0,2-p.ap)):'DOWN');
    }
    if(!u)return;
    setText('selected-name',`${u.id} / ${names[u.id]||u.role}`);setText('selected-role',roleCopy[u.id]||'');
    setText('selected-ap',`${u.ap} AP`);setText('selected-hp',`${Math.max(0,u.hp)} / ${u.maxHp} HP`);
    if($('selected-portrait')&&portraits[u.id]){$('selected-portrait').src=portraits[u.id];$('selected-portrait').alt=`${names[u.id]} operator reference`;}
    setText('coordinates',`${u.id} ${coord(u)}`);
    const actions=['move','dash','fire','overwatch','hunker','scan','interact'];
    for(const a of actions){const b=$(`action-${a}`);if(!b)continue;b.classList.toggle('active',a===mode);b.setAttribute('aria-pressed',String(a===mode));b.disabled=locked||u.ap<(a==='dash'?2:1)||(a==='scan'&&u.id!=='R');}
    setDisabled('end-turn',locked);setDisabled('restart',busy);setDisabled('confirm-action',true);setDisabled('more-actions',busy);
    setDisabled('coord-x',locked);setDisabled('coord-y',locked);setDisabled('coord-layer',locked);
    if(preview){
      setText('route-text',`${u.id} → ${coord(preview.destination)}`);
      setText('preview-detail',preview.ok?`${preview.cost} move · ${preview.apCost||1} AP${level.coverAt(preview.destination)?' · Cover':''}`:preview.reason||'No legal route.');
      setText('confirm-action',mode==='dash'?'Dash · 2 AP':'Move · 1 AP');
      setDisabled('confirm-action',locked||!preview.ok);
    }else if(targetId){
      const t=unit(targetId),a=t?game.attackPreview(u.id,targetId):null;
      setText('route-text',t?`${u.id} → ${targetId}`:'Choose a target');
      setText('preview-detail',a&&a.ok?`${Math.round(a.chance* (a.chance<=1?100:1))}% · ${a.damage} damage · 1 AP`:a?.reason||'Target unavailable.');
      setText('confirm-action','Fire · 1 AP');setDisabled('confirm-action',locked||!a?.ok);
    }else{
      setText('route-text',`${u.id} · ${u.ap} AP · ${mode==='dash'?'Dash':mode==='fire'?'Choose target':'Choose a tile'}`);
      setText('preview-detail',mode==='fire'?'Tap a threat to preview.':'Drag to pan · Pinch to zoom');setText('confirm-action','Confirm');
    }
    if($('practice-route')){$('practice-route').hidden=!preview?.ok;setDisabled('practice-route',busy);}
    if($('action-interact')){const ip=game.interactionPreview(u.id),short={hack:'Link',gate:'Open gate',medkit:'Heal',extract:'Extract'};const label=ip.ok?(short[ip.kind]||'Interact'):(u.id==='T'?'Link':'Interact');setText($('interact-label')?'interact-label':'action-interact',label);$('action-interact').disabled=locked||!ip.ok;$('action-interact').title=ip.ok?ip.label:ip.reason||'Move closer to an interactive objective.';}
    renderTargets();renderLog();updateOverlay();updateLabels();drawMinimap();updatePractice();
  }
  function renderTargets(){
    const out=$('target-list');if(!out)return;out.replaceChildren();const u=selected();if(!u)return;
    const hostiles=game.units.filter(t=>t.team==='enemy'&&alive(t));
    if(!hostiles.length){out.append(el('p','muted','All threats neutralized. Complete the relay and extract.'));return;}
    for(const t of hostiles){
      const a=game.attackPreview(u.id,t.id),b=el('button','target-card');b.type='button';b.disabled=busy||game.status!=='active';b.classList.toggle('selected',targetId===t.id);b.dataset.target=t.id;
      b.append(el('strong','',`${t.id} · ${t.layer?'ROOFTOP':'GROUND'}`));
      b.append(el('span','',`${t.hp}/${t.maxHp} HP · ${a.ok?`${Math.round(a.chance*(a.chance<=1?100:1))}%`:a.reason||'No shot'}`));
      b.addEventListener('click',()=>selectTarget(t.id));out.append(b);
    }
  }
  function renderLog(){const out=$('battle-log');if(!out)return;out.replaceChildren();for(const row of (game.logs||[]).slice(-8).reverse()){out.append(el('li','',typeof row==='string'?row:row.message||row.text||JSON.stringify(row)));}}
  function updateOverlay(){if(!renderer)return;const u=selected();renderer.setOverlay({selectedId:u?.id,reachable:!busy&&alive(u)&&mode!=='fire'&&u.ap>0?game.reachable(u.id,mode==='dash'):[],path:!busy&&preview?.ok?preview.path:[],destination:preview?.ok?preview.destination:null,targetId});}
  let labelNodes=new Map();
  function updateLabels(){
    const holder=$('unit-labels');if(!holder||!renderer)return;holder.style.visibility=busy?'hidden':'visible';
    const current=new Set();
    for(const u of game.units){if(!alive(u))continue;current.add(u.id);let b=labelNodes.get(u.id);
      if(!b){b=el('button',u.team==='enemy'?'map-unit hostile':'map-unit friendly',u.id);b.type='button';b.dataset.mapUnit=u.id;b.setAttribute('aria-label',u.team==='player'?`Select ${names[u.id]}`:`Target ${u.id}`);b.addEventListener('click',e=>{e.stopPropagation();onPick({kind:'unit',id:u.id});});holder.append(b);labelNodes.set(u.id,b);}
      const p=renderer.project({...u,height:2.4});b.hidden=!p||p.visible===false;b.classList.toggle('selected',u.id===game.selectedId);b.disabled=busy;
      if(p){b.style.left=`${p.x}px`;b.style.top=`${p.y}px`;}
    }
    for(const [id,b]of labelNodes)if(!current.has(id)){b.remove();labelNodes.delete(id);}
  }
  function drawMinimap(){
    const c=$('minimap');if(!c)return;const g=c.getContext('2d');if(!g)return;const w=c.width,h=c.height,b=level.bounds,minX=b.minX??b.min,minY=b.minY??b.min,maxX=(b.maxX??b.max)+1,maxY=(b.maxY??b.max)+1,s=w/(maxX-minX),sy=h/(maxY-minY),light=level.theme==='white-industrial';
    g.fillStyle=light?'#e5ece4':'#111a20';g.fillRect(0,0,w,h);const rect=(r,color)=>{if(!r)return;g.fillStyle=color;g.fillRect((r.x-minX)*s,(maxY-r.y-r.d)*sy,r.w*s,r.d*sy);};
    for(const water of level.waters||[level.canal])rect(water,'#276d70');for(const p of level.groundBridges)rect(p,'#b3c0b9');for(const p of level.buildings)rect(p,light?'#8d9b92':'#58656b');for(const p of level.bridges)rect(p,'#b8c5bc');
    g.strokeStyle='#cba45a';g.lineWidth=1;g.strokeRect((level.evac.x-level.evac.r-minX)*s,(maxY-level.evac.y-level.evac.r)*sy,level.evac.r*2*s,level.evac.r*2*sy);
    const dot=(p,color,r)=>{if(!p)return;g.fillStyle=color;g.beginPath();g.arc((p.x-minX)*s,(maxY-p.y)*sy,r,0,Math.PI*2);g.fill();};dot(level.relay,'#d69222',3);
    for(const u of game.units)if(alive(u))dot(u,u.team==='enemy'?'#e96b6b':u.id===game.selectedId?'#fff':'#64dedc',u.team==='player'?2.7:2);
  }
  function selectUnit(id,follow=false){if(busy)return;const r=game.select(id);if(r&&r.ok===false)return;cleanPreview();mode='move';renderer.setState(game.snapshot());if(follow)focusOperative(id);closeSheet(false);updateUI();beep('tap');message(`${names[id]} selected · ${unit(id)?.ap||0} AP`);}
  function selectTarget(id){if(busy)return;preview=null;question=null;targetId=id;mode='fire';closeSheet(false);const t=unit(id),u=selected();if(t&&u){renderer.focus({x:(u.x+t.x)/2,y:(u.y+t.y)/2,layer:0});}updateUI();beep('tap');}
  function plan(n){
    if(busy||game.status!=='active')return;const u=selected();if(!u)return;if(mode==='fire')mode='move';
    const dest={x:Number(n.x),y:Number(n.y),layer:Number(n.layer)||0};const p=game.previewMove(u.id,dest,mode==='dash');
    targetId=null;preview={...p,destination:dest};question=null;
    if($('coord-x'))$('coord-x').value=dest.x;if($('coord-y'))$('coord-y').value=dest.y;if($('coord-layer'))$('coord-layer').value=String(dest.layer);
    updateUI();message(p.ok?'Route ready. Tap Move to commit.':p.reason||'No route to that position.',p.ok?'':'error');beep(p.ok?'tap':'error');
  }
  function onPick(p){if(!p||busy)return;if(p.kind==='unit'){const u=unit(p.id);if(!alive(u))return;if(u.team==='player')selectUnit(u.id);else selectTarget(u.id);}else if(p.kind==='tile')plan(p);}
  async function act(fn,label){
    if(busy||game.status!=='active')return;const token=++actionSerial;closeSheet(false);
    busy=true;busyLabel=label||'EXECUTING';updateUI();let r;
    try{r=fn();}catch(e){console.error(e);busy=false;updateUI();message('Action failed. The console has diagnostic details.','error');return;}
    if(!r||r.ok===false){busy=false;updateUI();message(r?.reason||r?.message||'Action unavailable.','error');beep('error');return;}
    const events=r.events||[];beep(events.some(e=>e.type==='shot')?'shot':'tap');
    try{await renderer.animate(events);}catch(e){console.warn('Animation recovered:',e);}
    if(token!==actionSerial)return;busy=false;cleanPreview();mode='move';renderer.setState(game.snapshot());if(label==='MOVING')renderer.focus(game.selectedId);updateUI();
    message(r.message||r.reason||'Action complete.');if(game.status!=='active')finishMission();
  }
  function confirm(){const u=selected();if(!u)return;if(targetId)return act(()=>game.attack(u.id,targetId),'FIRING');if(preview?.ok){const d={...preview.destination},dash=mode==='dash';return act(()=>game.move(u.id,d,dash),'MOVING');}}
  function reset(){if(busy)return;closeSheet(false);game=new window.P3Game(level);cleanPreview();mode='move';labelNodes.forEach(b=>b.remove());labelNodes.clear();renderer.setState(game.snapshot());renderer.setView('3d');cameraState('3d');focusOperative('E');$('mission-modal')?.setAttribute('hidden','');helpOpen=false;updateUI();message('Cross the canal. Keep T protected.');beep('tap');}
  function showModal(title,body,button){closeSheet(false);setText('modal-title',title);const b=$('modal-body');if(b)b.innerHTML=body;setText('modal-close',button||'Back to game');$('mission-modal')?.removeAttribute('hidden');$('modal-close')?.focus({preventScroll:true});}
  function finishMission(){
    const won=game.status==='won';beep(won?'success':'error');
    showModal(won?'LINK SECURED. SQUAD EXTRACTED.':'THE SIGNAL WENT DARK.',won?`<p>You completed Black Signal in <strong>${game.turn} turns</strong>.</p><p>${players().filter(p=>!p.dead&&p.hp>0).length} of 3 operatives extracted. The relay is online.</p><p>Replay with a different approach: the service gate, the canal crossing, or the roof and skybridge.</p>`:'<p>The Technical operative was lost, or the squad could no longer complete the mission.</p><p>Use cover, coordinate Entry and Recon, and keep T protected while connecting the relay.</p>','RESTART MISSION');
  }
  function showHelp(){helpOpen=true;showModal('BLACK SIGNAL','<p><strong>Tap. Preview. Commit.</strong> Tap a squad card to bring that operative into view. Tap a cyan tile, then the amber Move button to take the route.</p><p><strong>Your mission:</strong> get T beside the relay at (0, 0), use Link twice, then return the surviving squad to extraction.</p><p><strong>Two actions each:</strong> Move, Fire, Overwatch, Hunker and Interact cost 1 AP. Dash uses 2 AP. End turn lets the defenders act.</p><p><strong>More:</strong> open the bottom sheet for Dash, Overwatch, Hunker and R’s Scan. Targets shows the known threats; Tools has coordinate navigation, optional math practice and the mission log.</p><p><strong>Move the camera:</strong> drag with one finger to pan. Pinch or use +/− to zoom. The map button shows the compound; the focus button returns to your selected operative. Tools has Top view and rotation controls.</p><p><strong>Keep T covered.</strong> E can open the service gate. R has the longest range. Adjacent barriers and Hunker improve protection. Overwatch can interrupt a move.</p><p>The coordinate exercise is optional. You can make every normal move without answering it.</p>');}
  function updatePractice(){
    const u=selected();if(!u)return;
    if(!preview?.ok){setText('practice-question','Preview a move to practice coordinate distance.');question=null;setDisabled('practice-answer',true);return;}
    const dx=Math.abs(preview.destination.x-u.x),dy=Math.abs(preview.destination.y-u.y);
    question={answer:dx+dy,dx,dy,route:preview.cost,layerChange:u.layer!==preview.destination.layer};
    setText('practice-question',`From (${u.x}, ${u.y}) to (${preview.destination.x}, ${preview.destination.y}): ignoring walls and stairs, how many horizontal + vertical grid steps?`);setDisabled('practice-answer',busy);
  }
  function checkPractice(e){e.preventDefault();if(!question)return;const raw=$('practice-answer').value.trim();if(!raw){setText('practice-feedback','Enter a number first.');return;}const n=Number(raw),q=question;
    setText('practice-feedback',n===q.answer?`Correct: ${q.dx} across + ${q.dy} along = ${q.answer}. ${q.route!==q.answer?`The actual route costs ${q.route} movement because it follows traversable terrain${q.layerChange?' and stairs':''}.`:'The planned route has the same cost.'}`:`Work one axis at a time: the x change is ${q.dx}; the y change is ${q.dy}. Add them. You can still make your move.`);beep(n===q.answer?'success':'tap');
  }
  function setup(){
    renderer=new window.P3Renderer($('battlefield'),level,{onPick});renderer.setState(game.snapshot());
    if(window.P3CustomLevelDoc){document.title='PRIM3 — '+level.title;const title=document.querySelector('.mission-heading > span:first-child');if(title)title.textContent=level.title;for(const [id,low,high] of [['coord-x',level.bounds.minX,level.bounds.maxX],['coord-y',level.bounds.minY,level.bounds.maxY]]){if($(id)){$(id).min=low;$(id).max=high;}}}
    setText('renderer-mode',renderer.getMode()==='webgl'?'WEBGL':'COMPATIBILITY');
    document.querySelectorAll('[data-unit]').forEach(b=>b.addEventListener('click',()=>selectUnit(b.dataset.unit,true)));
    ['move','dash','fire'].forEach(a=>$(`action-${a}`)?.addEventListener('click',()=>{if(busy)return;mode=a;cleanPreview();closeSheet(false);updateUI();message(a==='fire'?'Select a threat to preview.':a==='dash'?'Choose a tile for a two-AP dash.':'Tap a cyan tile to plan.');if(a==='fire')openSheet('targets');}));
    ['overwatch','hunker','scan','interact'].forEach(a=>$(`action-${a}`)?.addEventListener('click',()=>{const u=selected();if(u)act(()=>game[a](u.id),a==='interact'?'INTERACTING':'EXECUTING');}));
    $('confirm-action')?.addEventListener('click',confirm);$('end-turn')?.addEventListener('click',()=>act(()=>game.endTurn(),'ENEMY TURN'));
    $('restart')?.addEventListener('click',reset);$('help')?.addEventListener('click',showHelp);
    $('more-actions')?.addEventListener('click',()=>openSheet('actions'));
    document.querySelectorAll('[data-open-sheet]:not(#more-actions)').forEach(b=>b.addEventListener('click',()=>openSheet(b.dataset.openSheet)));
    document.querySelectorAll('[data-sheet-tab]').forEach(b=>{b.addEventListener('click',()=>setSheetTab(b.dataset.sheetTab));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-sheet-tab]')],i=tabs.indexOf(b),n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;setSheetTab(tabs[n].dataset.sheetTab);tabs[n].focus();});});
    $('sheet-close')?.addEventListener('click',()=>closeSheet());$('sheet-backdrop')?.addEventListener('click',()=>closeSheet());
    $('practice-route')?.addEventListener('click',()=>{openSheet('tools');if($('practice-panel'))$('practice-panel').open=true;$('practice-panel')?.scrollIntoView({block:'nearest'});});
    $('modal-close')?.addEventListener('click',()=>{if(game.status!=='active')reset();else{$('mission-modal').hidden=true;helpOpen=false;}});
    $('coordinate-form')?.addEventListener('submit',e=>{e.preventDefault();plan({x:Number($('coord-x').value),y:Number($('coord-y').value),layer:Number($('coord-layer').value)});if(preview?.ok){closeSheet(false);renderer.focus(selected().id);}});
    $('practice-form')?.addEventListener('submit',checkPractice);
    document.querySelectorAll('[data-camera]').forEach(b=>b.addEventListener('click',()=>{const c=b.dataset.camera;
      if(c==='home')focusOperative(selected()?.id);
      else if(c==='overview'){renderer.overview();if($('overview-map'))$('overview-map').hidden=false;}
      else if(c==='objective'){renderer.focus((game.hackProgress||0)>=2?{...level.evac,layer:0}:level.relay);}
      else if(c==='in')renderer.zoom(1.2);else if(c==='out')renderer.zoom(1/1.2);else if(c==='left')renderer.rotate(-.3);else if(c==='right')renderer.rotate(.3);else renderer.setView(c);
      if(['top','3d','overview'].includes(c))cameraState(c==='top'?'top':'3d');
      if(['top','3d','left','right'].includes(c))closeSheet(false);updateLabels();
    }));
    $('minimap')?.addEventListener('click',e=>{const r=e.currentTarget.getBoundingClientRect(),b=level.bounds,minX=b.minX??b.min,maxX=b.maxX??b.max,minY=b.minY??b.min,maxY=b.maxY??b.max;renderer.home();renderer.focus({x:minX+(e.clientX-r.left)/r.width*(maxX-minX+1),y:maxY+1-(e.clientY-r.top)/r.height*(maxY-minY+1),layer:0});if($('overview-map'))$('overview-map').hidden=true;cameraState(cameraView);updateLabels();});
    $('download-html')?.addEventListener('click',()=>window.P3DownloadStandalone(standaloneDocument));
    $('sound-toggle')?.addEventListener('click',()=>{soundOn=!soundOn;setText('sound-toggle',soundOn?'SOUND ON':'SOUND OFF');$('sound-toggle').setAttribute('aria-pressed',String(soundOn));if(soundOn)beep('tap');});
    document.addEventListener('keydown',e=>{
      const dialog=[$('mission-modal'),$('phone-sheet')].find(n=>n&&!n.hidden);
      if(dialog){
        if(e.key==='Escape'){e.preventDefault();if(dialog.id==='phone-sheet')closeSheet();else if(game.status==='active'){dialog.hidden=true;helpOpen=false;$('help')?.focus();}return;}
        if(e.key==='Tab'){const nodes=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]')].filter(n=>n.offsetParent!==null&&n.tabIndex>=0);const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first?.focus();}}
        return;
      }
      if(e.target.closest?.('button,a,input,textarea,select,summary,[contenteditable="true"]')||e.ctrlKey||e.metaKey||e.altKey)return;
      if(['1','2','3'].includes(e.key)){e.preventDefault();selectUnit(['E','R','T'][Number(e.key)-1],true);}
      else if(e.key==='Enter'){e.preventDefault();confirm();}
      else if(e.key===' '){e.preventDefault();if(!busy)act(()=>game.endTurn(),'ENEMY TURN');}
      else if(e.key==='?'){showHelp();}else if(e.key==='Escape'){cleanPreview();mode='move';updateUI();}
      else if(e.key.toLowerCase()==='q')renderer.rotate(-.2);else if(e.key.toLowerCase()==='e')renderer.rotate(.2);
      else if(e.key==='+'||e.key==='=')renderer.zoom(1.15);else if(e.key==='-')renderer.zoom(1/1.15);
      else if(e.key.startsWith('Arrow')){e.preventDefault();const p=preview?.destination||selected();if(!p)return;const delta={ArrowUp:[0,1],ArrowDown:[0,-1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[e.key];plan({x:p.x+delta[0],y:p.y+delta[1],layer:p.layer||0});}
    });
    const resize=()=>{document.documentElement.style.setProperty('--app-height',`${Math.round(window.visualViewport?.height||window.innerHeight)}px`);renderer.resize();updateLabels();};
    window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);resize();
    setInterval(()=>{if(!document.hidden)updateLabels();},100);updateUI();message(level.authoringDocument?'Get T to the relay at (0, 0).':'Cross the canal. Keep T protected.');
    // Diagnostic hooks are deliberately separate from the visible controls.
    window.PRIM3={snapshot:()=>game.snapshot(),project:n=>renderer.project(n),get renderer(){return renderer;},level};
  }
  try{setup();}catch(e){console.error(e);message(`Unable to start: ${e.message}`,'error');setText('renderer-mode','STARTUP ERROR');}
})();
