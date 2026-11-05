/* Screen app Hardware tab: physical inspection and operation use the same ComputerFleet as the terminal/NOC.
   Browser rendering is progressive enhancement. Every operation remains available through labeled HTML controls. */
import { createComputerView } from './equity-uprise-computer-view.mjs';

const STYLE = `
.eq{display:grid;gap:14px;min-width:0;margin-top:14px}.eq *{box-sizing:border-box}.eq h2,.eq p{margin:0}
.eq-head,.eq-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}.eq select{max-width:100%;min-width:0;width:100%;font:inherit;font-size:max(16px,1rem);padding:12px;background:var(--panel,#13202a);color:inherit;border:1px solid var(--line,#52606a);border-radius:8px}
.eq-stage{height:390px;min-height:320px;border-radius:12px;overflow:hidden;background:#e5ebed;position:relative}.eq-stage canvas{display:block;width:100%;height:100%;touch-action:pan-y}
.eq-controls{display:flex;flex-wrap:wrap;gap:8px}.eq button,.eq a.btn{font-size:16px;min-height:44px;padding:10px 12px;border-radius:8px;white-space:normal}.eq button:disabled{opacity:.5}
.eq-parts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;max-height:260px;overflow:auto}.eq-parts button{text-align:left;overflow-wrap:anywhere;background:var(--panel,#12212b);color:inherit;border:1px solid var(--line,#435362)}
.eq-parts button[aria-pressed=true]{border:2px solid #3ddc97}.eq-port{padding:12px;border:1px solid var(--line,#435362);border-radius:9px;overflow-wrap:anywhere}.eq-port code{font-size:12px;display:block;white-space:normal}
.eq-log{font:13px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto}.eq-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.eq-facts div{padding:10px;border:1px solid var(--line,#435362);border-radius:8px}.eq-facts b{display:block;font-size:20px}.eq-note{font-size:13px;line-height:1.5;color:var(--muted,#b1bec8)}.eq-selection{padding:12px;border:1px solid var(--line,#435362);border-radius:8px;display:grid;gap:10px}.eq-msg{padding:10px;min-height:44px;overflow-wrap:anywhere}.eq-msg[data-bad=true]{border-left:3px solid #f3a345}.eq-frame-link{overflow-wrap:anywhere}
@media(min-width:820px){.eq-grid{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)}.eq-head{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}.eq-stage{height:510px}.eq-parts{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;
const download=(name,content,type='application/json')=>{const u=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};

export function mountWorkbench(ctx, ss) {
  if (!ss.hardware) throw new Error('Equipment runtime unavailable. Reload after the site release completes.');
  const fleet=ss.hardware, esc=ctx.esc, container=ctx.view;
  let alive=true, generation=0, renderer=null, selected=null, chosen=null, threePromise=null;
  const requested=new URLSearchParams(location.search).get('computer');
  let id=fleet.byId.has(requested)?requested:fleet.byId.has(ctx.screen?.network_asset_id)?ctx.screen.network_asset_id:fleet.catalog.find(c=>!c.server)?.id||fleet.catalog[0]?.id;
  const css=document.createElement('style');css.textContent=STYLE;container.replaceChildren(css);
  const root=document.createElement('section');root.className='eq';container.append(root);
  root.innerHTML=`<div><h2>Computer Workbench</h2><p class="eq-note">Registered equipment · physical inspection · causal sandbox state</p></div>
  <div class="eq-head"><label>Computer<select data-machine aria-label="Computer">${fleet.catalog.map(c=>`<option value="${esc(c.id)}">${esc(c.floor+' · '+c.label+' · '+c.id)}</option>`).join('')}</select></label>
  <label>Environment<select data-mode aria-label="Environment"><option>WORKPLACE</option><option>TRAINING</option><option>MISSION</option></select></label></div>
  <p class="eq-note" data-authority></p><div class="eq-grid"><div><div class="eq-stage" data-stage></div>
  <div class="eq-controls" style="margin-top:8px">${[['front','Front'],['rear','Rear / ports'],['inspect','Inside'],['explode','Exploded']].map(([v,t])=>`<button class="btn" data-view="${v}">${t}</button>`).join('')}<button class="btn" data-capture>Capture frame</button></div>
  <p class="eq-note">Inside / Exploded is a read-only inspection overlay. It does not open the service cover or waive power isolation.</p><div class="eq-facts" data-facts style="margin-top:12px"></div>
  <div class="eq-controls" data-ops style="margin-top:12px">${[['shutdown','Shut down'],['power_on','Power on'],['advance','Next boot step'],['sign_in','Sandbox sign-in'],['sign_out','Lock desktop'],['open_cover','Open cover'],['close_cover','Close cover'],['esd','Toggle ESD'],['reset','Reset this computer']].map(([a,t])=>`<button class="btn" data-act="${a}">${t}</button>`).join('')}</div>
  <div class="eq-msg" data-msg role="status" aria-live="polite">Select a part, trace a cable, or run the boot sequence.</div>
  <div class="eq-controls"><button class="btn" data-desktop>Open this computer’s app</button><button class="btn" data-evidence>Export equipment evidence</button><button class="btn" data-film>Export explainer shot plan</button></div>
  </div><div><h3>Components</h3><div class="eq-parts" data-parts></div><div class="eq-selection" data-detail style="margin-top:10px"></div><h3>Physical connections</h3><div class="grid" data-ports></div></div></div>
  <details><summary>Event ledger and coverage</summary><p class="eq-note" data-coverage></p><pre class="eq-log" data-log></pre></details>
  <p class="eq-note">A modeled computer, not a hosted Linux VM or transistor/electrical solver. No real passwords or live controls. Evidence is unassessed; a later learning task must grade it independently. The dedicated Server Lab keeps its own L1–L4 exercise state.</p>
  <a class="btn eq-frame-link" href="/equity-uprise-server-lab-3d.html">Open the dedicated server exercises</a>`;
  const q=s=>root.querySelector(s);
  q('[data-machine]').value=id;q('[data-mode]').value=ss.mode;
  function notice(text,bad=false){q('[data-msg]').textContent=text;q('[data-msg]').dataset.bad=String(bad);}
  function pick(part){selected=part;detail();}
  function detail(){const c=fleet.device(id),s=fleet.machine(id),p=c.parts.find(p=>p.id===selected),port=c.ports.find(p=>p.id===selected);
    for(const b of q('[data-parts]').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.part===selected));
    if(port){q('[data-detail]').innerHTML=`<b>${esc(port.port)}</b><span>${esc(port.cable_type)}</span><span>Recorded peer: ${esc(port.peer)} / ${esc(port.peer_port)}</span><code>${esc(port.id)}</code>`;return;}
    if(!p){q('[data-detail]').innerHTML=`<b>${esc(selected||'Choose a component')}</b><span class="eq-note">Tap the 3D equipment or use the component list. Controls below the scene operate the simulation.</span>`;return;}
    const state=s.parts[p.id]===false?'REMOVED':s.faults.includes(p.id)?'FAULTED':'INSTALLED';
    const kit=[p.sku,...(p.type==='dimm'?['DDR4-UDIMM-16',c.server?'DDR5-UDIMM-16':'DDR5-RDIMM-32']:p.type==='psu'?['PSU-1400W-OTHER']:['INCOMPATIBLE-PART'])];
    q('[data-detail]').innerHTML=`<b>${esc(p.label)}</b><code>${esc(p.id)} · ${state}</code><span>${p.box_mm.slice(3).map(n=>Math.round(n*100)/100).join(' × ')} mm (W × H × D)</span>
    <span class="eq-note">${p.sealed?'Sealed power module: whole-module replacement only, never open its enclosure.':'Cold-service profile: shut down, unplug every AC feed, open cover, apply simulated ESD bond.'}</span>
    <label>Replacement kit<select data-kit>${kit.map(k=>`<option>${esc(k)}</option>`).join('')}</select></label><div class="eq-controls">${[['remove','Remove'],['install','Install'],['replace','Replace'],['inject_fault','Inject fault']].map(([a,t])=>`<button class="btn" data-part-act="${a}" ${ss.readOnly||p.serviceable===false?'disabled':''}>${t}</button>`).join('')}</div>`;
  }
  function refresh(){const c=fleet.device(id),s=fleet.machine(id),st=fleet.status(id);
    q('[data-authority]').textContent=`${c.profile_id} · ${c.geometry_status}. Bench-local view; ${c.placement.placement_authority} equipment placement in the source registry. No room is moved.`;
    q('[data-facts]').innerHTML=[['Boot',st.stage],['Memory',st.memory_gb+' GB'],['Power',st.ac?'AC present':'Isolated / no feed'],['Display',st.display?'Signal present':'No signal'],['Network',st.network_up?'Linked':'Disconnected'],['Cooling',st.cooling?'Fans available':'Fan degraded']].map(([a,b])=>`<div><span class="eq-note">${a}</span><b>${esc(b)}</b></div>`).join('');
    q('[data-ports]').innerHTML=c.ports.map(p=>`<div class="eq-port"><b>${esc(p.port)} · ${esc(p.kind)}</b><code>${esc(p.cable_type+' → '+p.peer+' / '+p.peer_port)}</code><code>${esc(p.id)}</code><button class="btn" data-port="${esc(p.id)}" ${ss.readOnly?'disabled':''}>${s.disconnected.includes(p.id)?'Connect recorded cable':'Disconnect cable'}</button></div>`).join('');
    q('[data-log]').textContent=(ss.session.hardware?.events||[]).filter(e=>e.asset_id===id).map(e=>`${e.seq} ${e.action} ${e.part||e.port||''} → ${e.code}${e.safety?' · SAFETY '+e.safety:''}`).join('\n')||'No hardware actions recorded in this mode.';
    const cov=fleet.coverage();q('[data-coverage]').textContent=`${cov.computers} registered computers: ${cov.workstations} workstations, ${cov.servers} servers/appliances. Unbound screens: ${cov.unbound_screens.length}. Unresolved equipment placements: ${cov.unresolved_placement.length}. Furnishing-only props are not included.`;
    q('[data-desktop]').disabled=!st.desktop_ready||!st.display;
    for(const b of q('[data-ops]').querySelectorAll('button'))b.disabled=ss.readOnly;
    q('[data-ops] [data-act=esd]').textContent=s.esd?'ESD bonded ✓':'Apply ESD bond';
    renderer?.update(st,s);detail();
  }
  function operate(action){try{const result=fleet.act(id,action);refresh();notice(result.message+(result.safety?' Safety violation recorded.':''),!result.accepted);}catch(e){notice(e.message,true);}}
  async function show(){const ticket=++generation;renderer?.dispose();renderer=null;selected=null;
    const c=fleet.device(id);q('[data-parts]').innerHTML=c.parts.map(p=>`<button type="button" data-part="${esc(p.id)}" aria-pressed="false">${esc(p.label)}</button>`).join('');
    refresh();q('[data-stage]').dataset.ready='0';q('[data-stage]').dataset.asset=id;q('[data-stage]').textContent='Loading physical equipment…';
    try{threePromise ||= import('/vendor/three.module.min.js');const THREE=await threePromise;if(!alive||generation!==ticket)return;
      q('[data-stage]').replaceChildren();renderer=createComputerView(THREE,q('[data-stage]'),{device:c,onPick:pick});renderer.update(fleet.status(id),fleet.machine(id));
      q('[data-stage]').dataset.ready='1';
    }catch(e){if(alive&&generation===ticket){q('[data-stage]').textContent='3D unavailable here. The component list, connections and all hardware controls remain available.';notice(e.message,true);}}
  }
  q('[data-machine]').onchange=()=>{id=q('[data-machine]').value;const u=new URL(location.href);u.searchParams.set('computer',id);history.replaceState(history.state,'',u);show();};
  q('[data-mode]').onchange=()=>{const u=new URL(location.href);u.searchParams.set('mode',q('[data-mode]').value);location.replace(u);};
  root.onclick=e=>{
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.part){pick(b.dataset.part);return;}
    if(b.dataset.view){renderer?.view(b.dataset.view);return;}
    if(b.dataset.act){operate({type:b.dataset.act,user:'operator',enabled:!fleet.machine(id).esd});return;}
    if(b.dataset.partAct){operate({type:b.dataset.partAct,part:selected,sku:q('[data-kit]').value});return;}
    if(b.dataset.port){const p=fleet.device(id).ports.find(p=>p.id===b.dataset.port);operate({type:fleet.machine(id).disconnected.includes(p.id)?'connect':'disconnect',port:p.id,peer:p.peer});return;}
    if(b.hasAttribute('data-desktop')){const c=fleet.device(id),s=ctx.registry.screens.find(s=>c.screens.includes(s.screen_id));if(!s)return;
      const u=new URL('/'+s.app.page,location.href);for(const k of ['mode','return']){const v=new URLSearchParams(location.search).get(k);if(v)u.searchParams.set(k,v);}u.searchParams.set('screen',s.screen_id);location.replace(u);return;}
    if(b.hasAttribute('data-evidence'))download(id+'-equipment-evidence.json',JSON.stringify(fleet.exportEvidence(id),null,2));
    if(b.hasAttribute('data-capture')){if(!renderer){notice('No rendered frame is available.',true);return;}const a=document.createElement('a');a.download=id+'-reference.png';a.href=renderer.capture();a.click();}
    if(b.hasAttribute('data-film')){const c=fleet.device(id);download(id+'-explainer-plan.json',JSON.stringify({schema:'equipment-explainer/1',asset_id:id,profile_id:c.profile_id,source_state:fleet.exportEvidence(id),provider:'Higgsfield',status:'prepared-not-submitted',duration_seconds:30,
      restrictions:['Use captured reference frames from this bench, not invented interiors.','No generated labels: add verified text in editing.','Do not portray hot servicing or claim a real certification.','No generation or spending is authorized by exporting this plan.'],
      shots:[{seconds:[0,5],view:'front',voice:'This is a training copy of '+c.label+'.',prompt:'Slow product camera push toward the reference chassis. Preserve its exact dimensions and port positions.'},{seconds:[5,12],view:'inspect',voice:'Power, CPU, memory, storage and cooling form one system.',prompt:'Use the exact inspected reference frame. Subtle camera arc, no topology changes or invented parts.'},{seconds:[12,20],view:'rear',voice:'Trace the labeled power and data connections before changing hardware.',prompt:'Macro camera movement along the actual rear ports and cables. No cable reconnections.'},{seconds:[20,30],view:'explode',voice:'Shut down, isolate every AC feed and use the service precautions. Then verify the boot sequence.',prompt:'Hold the reference exploded arrangement, using only a slow camera orbit. No new component motion.'}]},null,2));notice('Source-bound shot plan exported. No Higgsfield request was submitted.');}
  };
  void show();
  return ()=>{alive=false;generation++;renderer?.dispose();root.onclick=null;};
}
