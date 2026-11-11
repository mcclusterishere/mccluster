import * as R from './tactical-resolver.mjs';
import { playerProjection } from './tactical-hints.mjs';
const sharedMode=location.pathname.endsWith('/prim3-shared-fate.html');
const networkMode=sharedMode||new URLSearchParams(location.search).get('lab')==='network';
const engine=await import(sharedMode?'./shared-fate-simulation.mjs':networkMode?'./network-simulation.mjs':'./hex-simulation.mjs');
const { createRun,restoreRun,act,movePreview,outcome,active }=engine;
const variant=!sharedMode&&new URLSearchParams(location.search).get('variant')==='transfer'?'transfer':'foundation';
const SAVE_KEY=engine.SAVE_KEY+(networkMode?'.'+variant:'');
const levelModule=await import(sharedMode?'./levels/shared-fate.mjs':'./levels/hex-relay.mjs');
const { NAV,LEVEL,renderCell,pickCell,RELAY,EXIT,SOLIDS }=levelModule;
const label=id=>levelModule.LABELS?.[id]||id;
import { hexCorners } from './hex-graph.mjs';
const $=id=>document.getElementById(id),escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let run=createRun(undefined,variant),selected='E1',order=null,renderer=null,mode3d=false,message='',saveBlocked=false;
try{const text=localStorage.getItem(SAVE_KEY);if(text)run=restoreRun(text);else if(engine.LEGACY_SAVE_KEYS?.some(k=>localStorage.getItem(k)))message='Earlier yard-layout save retained separately. This is a fresh interiors v2 run; old commands are not migrated.';}catch(e){message='Saved run could not be restored. It is retained until you choose Restart.';saveBlocked=true;}
const unit=()=>run.state.units.find(u=>u.id===selected);
function choose(i){const u=run.state.units.find(u=>u.x===i&&u.faction==='PLAYER'&&active(u));if(u){selected=u.id;order=null;}else if(playerProjection(run.state).units.some(t=>t.x===i&&t.faction==='THREAT'&&active(t))){const t=playerProjection(run.state).units.find(t=>t.x===i&&t.faction==='THREAT'&&active(t));order=R.shotPreview(run.state,selected,t.id).legal?{action:'fire',payload:t.id}:null;}else{const p=movePreview(run,selected,i);order=p?{action:'move',payload:p}:null;}render();}
function execute(action,payload){try{run=act(run,selected,action,payload);order=null;message='Order resolved.';if(!saveBlocked)try{localStorage.setItem(SAVE_KEY,JSON.stringify(run));}catch{message='Run is playable, but this browser could not save.';}render();}catch(e){message=e.message;render();}}
function render(){
 const s=run.state,p=playerProjection(s),u=unit(),result=outcome(run),playable=result==='ACTIVE'&&active(u)&&u.ap>0,reach=playable?R.computeReach({...s,units:p.units},selected,u.moveRange*Math.min(2,u.ap)):null;
 $('status').textContent=`${result==='ACTIVE'?`Turn ${s.round} · ${s.mission.clock} turns left`:result}`;
 $('actor').textContent=`${label(selected)} · ${u.role==='T'?'Technical':u.role==='R'?'Recon':'Entry'}`;
 $('order-unit').textContent=`${label(selected)} · ${u.ap} AP · ${u.hp} HP`;
 $('stats').textContent=`${u.hp}/${u.maxHp} HP · ${u.ap} AP · ${u.ammo}/${u.magazineSize} ammo · ${u.reserveAmmo} reserve`;
 $('objective').textContent=`Relay: ${s.nodes[0].state.replaceAll('_',' ')} · Extracted ${s.mission.extractedUnitIds.length}/3`;
 $('squad').innerHTML=s.units.filter(u=>u.faction==='PLAYER').map(u=>`<button data-unit="${u.id}" aria-pressed="${u.id===selected}">${label(u.id)} · ${u.ap} AP${!active(u)?' · out':''}</button>`).join('');
 $('targets').innerHTML=p.units.filter(t=>t.faction==='THREAT'&&active(t)).map(t=>{const shot=R.shotPreview(s,selected,t.id);return `<button data-target="${t.id}" ${!playable||!shot.legal?'disabled':''}>${t.id} · ${t.hp} HP · ${shot.legal?`${shot.hitChance}% · ${shot.damage} damage · ${shot.flanked?'FLANKED':shot.cover+' cover'}`:'No shot'}</button>`;}).join('')||'<p>No opposition in sight.</p>';
 for(const b of document.querySelectorAll('[data-action]')){try{act(run,selected,b.dataset.action);b.disabled=false;}catch{b.disabled=true;}}
 $('end').disabled=result!=='ACTIVE';$('confirm').disabled=!order||!playable;
 $('preview').textContent=order?.action==='configure'?`Commit ${sharedMode?'client-edge':'training-edge'}${sharedMode?' via '+order.payload.uplink:''}: /${order.payload.prefix}, gateway ${order.payload.gateway}, ${order.payload.reservedMbps} Mbps. Costs 1 AP. Verification remains separate.`:order?.action==='move'?`${order.payload.mode} · ${order.payload.costM.toFixed(2)} m · ${order.payload.mode==='MOVE'?1:2} AP. Follow the marked path.`:order?.action==='fire'?`Fire at ${order.payload} · ${R.shotPreview(s,selected,order.payload).hitChance}% hit · ${R.shotPreview(s,selected,order.payload).damage} damage · ${R.shotPreview(s,selected,order.payload).critChance}% critical. Costs 1 AP.`:'Select a hex or visible target to preview an order.';
 $('message').textContent=message;
 $('events').innerHTML=s.events.slice(-8).map(e=>`<li>${escape(e.type)} ${escape(e.unitId||e.actorId||e.attackerId||'')}</li>`).join('');
 if(networkMode){document.querySelector('h1').textContent=sharedMode?'Shared Fate · client continuity exercise':'Restore the network path.';$('training-intro').textContent=sharedMode?'PROPOSED supplemental mission at a separate fictional client site. Sari protects access and selects policy; Rafael maps dependencies; Minh configures, failure-tests and verifies. Helen remains command-side.': 'Synthetic TR02 training: Recon inspects at X, Entry holds access at X each working turn, Technical configures and verifies at R. Extract after verified recovery. Local simulation; no competency credit.';$('network-lab').hidden=false;document.querySelector('[data-action=relay]')?.setAttribute('hidden','');$('lab-evidence').textContent=run.lab.observed?JSON.stringify(run.lab.events.find(e=>e.action==='observe').result,null,2):(sharedMode?'Enter the office: Rafael inspects at O in telemetry; Sari selects priorities and holds A in service each working turn. Minh enters the equipment bay backhaul room at R to configure, failure-test and independently verify. X is outdoor extraction.':'Recon: inspect telemetry near X to earn topology and load evidence. Entry: hold access at X each working turn. Technical: configure and verify at R.');$('lab-result').textContent=JSON.stringify({state:run.lab.config,revision:run.lab.revision,lastProbe:run.lab.lastProbe,report:engine.report(run)},null,2);}
 if(sharedMode){const result=run.lab.lastProbe;$('shared-service').textContent=result?`${run.lab.verified?'Verified':'Not independently verified'} · essential ${result.essentialDeliveredMbps}/6 Mbps · broadcast ${result.broadcastDeliveredMbps} Mbps · ${result.missedAppointments} modeled missed appointments · reach ${result.reach} · sponsor confidence ${result.sponsorConfidence} · next-operation capacity ${result.nextMissionCapacity}. Fictional drill metrics only.`:'Service not yet tested and independently verified.';}
 const drawUnits=p.units.filter(active),path=order?.action==='move'?order.payload.path:[];
 const tiles=[];NAV.nodes.forEach((n,i)=>{const cost=reach?.costAt(i,0,0);if(cost>0)tiles.push({...renderCell(i),apCost:cost<=u.moveRange+1e-7?1:2});});
 if(renderer&&mode3d)renderer.update({units:drawUnits.map(u=>({...u,...renderCell(u.x)})),selected,labels:levelModule.STATION_LABELS||[],reach:tiles,path:path.map(t=>renderCell(t.x)),pathLine:[renderCell(u.x),...path.map(t=>renderCell(t.x))],dest:path.length?renderCell(path.at(-1).x):null,gateOpen:false,extraction:renderCell(EXIT),coverAt:()=>null});
 const scale=10/LEVEL.TILE_M,b=NAV.bounds,ox=b.minX*scale-8,oz=b.minZ*scale-8,w=(b.maxX-b.minX)*scale+16,h=(b.maxZ-b.minZ)*scale+16;
 const pathIds=new Set(path.map(t=>t.x));
 const mapScroll={left:$('map').scrollLeft,top:$('map').scrollTop};
 $('map').innerHTML=`<svg viewBox="${ox} ${oz} ${w} ${h}" aria-label="Hex tactical map">`+NAV.nodes.map((n,i)=>{const cost=reach?.costAt(i,0,0),actor=drawUnits.find(u=>u.x===i),label=actor?.id||(i===RELAY?'R':i===EXIT?'X':sharedMode&&i===levelModule.OBSERVE?'O':sharedMode&&i===levelModule.ACCESS?'A':'');const fill=actor?(actor.faction==='PLAYER'?'#733441':'#274c75'):pathIds.has(i)?'#8a6832':'#20292f';return `<g role="button" tabindex="0" data-cell="${i}" aria-label="Hex ${n.q}, ${n.r}${label?', '+label:''}${cost>0?', '+cost.toFixed(2)+' metres':''}"><polygon points="${hexCorners(n.position,NAV.frame.spacingM*.94).map(v=>`${v.x*scale},${v.z*scale}`).join(' ')}" fill="${fill}" stroke="${cost>0?(cost<=u.moveRange+1e-7?'#469bf5':'#efb34f'):'#48545d'}" stroke-width=".6"/>${label?`<text x="${n.position.x*scale}" y="${n.position.z*scale+2}" text-anchor="middle" fill="white" style="font-size:4px">${label}</text>`:''}</g>`;}).join('')+NAV.coverEdges.map(c=>{const p=NAV.nodes[c.node].position,d=NAV.frame.spacingM*.43,half=.23;const x=p.x+Math.cos(c.bearing)*d,z=p.z+Math.sin(c.bearing)*d,dx=-Math.sin(c.bearing)*NAV.frame.spacingM*half,dz=Math.cos(c.bearing)*NAV.frame.spacingM*half;return `<line x1="${(x-dx)*scale}" y1="${(z-dz)*scale}" x2="${(x+dx)*scale}" y2="${(z+dz)*scale}" stroke="white" stroke-width="${c.type==='HIGH'?1.2:.6}" pointer-events="none"/>`;}).join('')+SOLIDS.map(s=>`<rect x="${s.minX*scale}" y="${s.minZ*scale}" width="${(s.maxX-s.minX)*scale}" height="${(s.maxZ-s.minZ)*scale}" fill="${s.heightM>=1.8?'#a3a7aa':'#65717a'}"/>`).join('')+(levelModule.ROOMS||[]).map(r=>`<text x="${(r.minX+r.maxX)/2*scale}" y="${r.minZ*scale+2}" text-anchor="middle" fill="#ffd38a" style="font-size:3px" pointer-events="none">${escape(r.name)}</text>`).join('')+'</svg>';
 $('map').scrollLeft=mapScroll.left;$('map').scrollTop=mapScroll.top;
}
$('map').addEventListener('click',e=>{const cell=e.target.closest('[data-cell]');if(cell)choose(Number(cell.dataset.cell));});
$('map').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const cell=e.target.closest('[data-cell]');if(cell){e.preventDefault();choose(Number(cell.dataset.cell));}}});
$('squad').onclick=e=>{const b=e.target.closest('[data-unit]');if(b){selected=b.dataset.unit;order=null;render();}};
$('targets').onclick=e=>{const b=e.target.closest('[data-target]');if(b&&!b.disabled){order={action:'fire',payload:b.dataset.target};render();}};
$('actions').onclick=e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)execute(b.dataset.action);};
$('confirm').onclick=()=>{if(order)execute(order.action,order.payload);};
$('cancel').onclick=()=>{order=null;render();};document.addEventListener('keydown',e=>{if(e.key==='Escape'){order=null;render();}});
$('end').onclick=()=>execute('end');
$('restart').onclick=()=>{if(!confirm(sharedMode?'Restart this fictional Shared Fate exercise? Its local run will reset.':'Restart this hex drill? Square saves and course progress stay intact.'))return;run=createRun(undefined,variant);saveBlocked=false;selected='E1';order=null;try{localStorage.removeItem(SAVE_KEY);}catch{}message='Fresh drill ready.';render();};
$('focus').onclick=()=>{const p=renderCell(unit().x);renderer?.focus(p.x,p.y,0,18);const cell=$('map').querySelector(`[data-cell="${unit().x}"]`);if(cell){const r=cell.getBoundingClientRect(),m=$('map').getBoundingClientRect();$('map').scrollLeft+=r.x-m.x-m.width/2;$('map').scrollTop+=r.y-m.y-m.height/2;}};
$('view').onclick=async()=>{
 if(!renderer){$('graphics').textContent='Loading the existing 3D level renderer…';try{const {createLevel3D}=await import('./level3d.mjs');$('scene').hidden=false;renderer=createLevel3D($('scene'),{level:LEVEL,look:'studio',fx:'low',reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,onTap:t=>{const i=t.nodeIndex??pickCell(t.x,t.y);if(i!=null)choose(i);}});renderer.focus(sharedMode?9:31,sharedMode?7:32,0,sharedMode?18:22);$('graphics').textContent=sharedMode?'3D uses the same hex graph. Roofless tactical cutaway: low wall display, full-height collision and sight blocking. Drag to pan; wheel/pinch to zoom.':'3D uses the same hex graph. Drag to pan; wheel/pinch to zoom.';}catch(e){$('scene').hidden=true;$('graphics').textContent='3D unavailable. The complete tactical game remains playable on the map.';return;}}
 mode3d=!mode3d;$('scene').hidden=!mode3d;$('map').hidden=mode3d;$('view').textContent=mode3d?'Switch to 2D':'Switch to 3D';renderer.setActive(mode3d);render();
};
render();

$('focus').click();

if(new URLSearchParams(location.search).get('view')!=='2d')$('view').click();

if(networkMode){$('lab-prepare').onclick=()=>{order={action:'configure',payload:{targetId:sharedMode?'client-edge':'training-edge',...(sharedMode?{uplink:$('lab-uplink').value}:{}),prefix:Number($('lab-prefix').value),gateway:$('lab-gateway').value,reservedMbps:Number($('lab-bandwidth').value)}};render();};$('lab-export').onclick=()=>{const blob=new Blob([JSON.stringify({trust:'LOCAL UNSIGNED REVIEW ONLY',run,report:engine.report(run)},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='prim3-local-network-evidence.json';a.click();URL.revokeObjectURL(a.href);};}

if(networkMode)$('lab-actions').onclick=e=>{const b=e.target.closest('[data-lab-action]');if(b)execute(b.dataset.labAction);};

if(sharedMode){
 document.querySelector('h1').textContent='Shared Fate · client continuity exercise';
 $('training-intro').textContent='PROPOSED supplemental mission at a fictional client site. Sari leads and controls access; Rafael maps dependencies; Minh configures and tests the fallback. Helen remains command-side. No live network or story write.';
 $('shared-controls').hidden=false;$('shared-briefing').hidden=false;
 $('shared-priority').onclick=e=>{const b=e.target.closest('[data-policy]');if(b)execute('prioritize',b.dataset.policy);};
 $('shared-test').onclick=()=>execute('testFailure');
 const {decodeReturn,buildReturnUrl}=await import('../eu-screens/contract.mjs');const rp=decodeReturn(new URLSearchParams(location.search).get('return')||'');$('shared-return').href=rp?buildReturnUrl(rp):'prim3-transit.html?level=equity-uprise-hq';
}
