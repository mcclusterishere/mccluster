// Consumer of City #748's lifecycle; City owns frames, topology, movement and its separate save.
export const SPATIAL_SCHEMA='mccluster.spatial-lifecycle/v1';
export const SHARED_ENTRANCE='bridgeport-main-golden-hill';
export function acceptsSpatialState(event,source,origin,entranceId=SHARED_ENTRANCE){
 const d=event.data;
 return event.source===source&&event.origin===origin&&d?.schema===SPATIAL_SCHEMA&&d.type==='bridgeport:state'&&
  d.regionId==='bridgeport-golden-hill.v1'&&d.revision===1&&d.frameId==='bridgeport-golden-hill.enu.v1'&&d.floorId==='street'&&
  d.entranceId===entranceId&&['ready','saved','arrived','unloaded','returned'].includes(d.event)&&['hex','square'].includes(d.topology)&&
  Array.isArray(d.capabilities)&&d.capabilities.includes('exterior-navigation')&&
  (d.position===null?['unloaded','returned'].includes(d.event):d.position?.y===0&&[d.position.x,d.position.z].every(Number.isFinite));
}
export function mountSoleSpatial(root,{locationId,onActive,canEnter=()=>true,win=window,frame=document.querySelector('#arcade-globe'),timeoutMs=20000}){
 const panel=document.createElement('section');panel.dataset.soleSpatial='';root.append(panel);
 if(locationId!==SHARED_ENTRANCE){panel.textContent='Shared square/hex walking is available at the Main Street & Golden Hill Street entrance only.';return ()=>panel.remove();}
 panel.innerHTML='<h3>Golden Hill on the globe</h3><p>Pause Sole Run to walk the shared street in square or hex mode on the globe above. This bounded exterior walk has its own saved position; it does not advance the four-pair mission. Ion availability is shown on the globe.</p><button class="action" data-spatial-enter>Walk Golden Hill on globe</button><button class="action" data-spatial-return disabled>Return to Sole Run</button><p role="status" data-spatial-status></p>';
 const enter=panel.querySelector('[data-spatial-enter]'),back=panel.querySelector('[data-spatial-return]'),status=panel.querySelector('[data-spatial-status]');
 let active=false,leaving=false,disposed=false,timer;
 const send=type=>frame?.contentWindow?.postMessage({type,schema:SPATIAL_SCHEMA,...(type==='bridgeport:enter'?{entranceId:locationId}:{})},win.location.origin);
 const finish=message=>{clearTimeout(timer);active=false;leaving=false;enter.disabled=false;back.disabled=true;onActive(false);status.textContent=message;};
 enter.onclick=()=>{
  if(active||disposed)return;if(!frame?.contentWindow||!canEnter()){status.textContent='Shared walk unavailable while mission road closures are configured or the globe is unavailable.';return;}
  active=true;onActive(true);enter.disabled=true;back.disabled=false;status.textContent='Opening the shared Golden Hill street. Your Sole Run is paused.';send('bridgeport:enter');frame.scrollIntoView({behavior:'smooth'});
  timer=setTimeout(()=>{if(!active||disposed)return;send('bridgeport:leave');finish('Shared City navigation did not become ready. Sole Run remains paused; this build requires City #748.');},timeoutMs);
 };
 back.onclick=()=>{if(!active||leaving)return;leaving=true;back.disabled=true;status.textContent='Returning from the globe…';send('bridgeport:leave');};
 const message=e=>{
  if(!active||disposed||!acceptsSpatialState(e,frame?.contentWindow,win.location.origin,locationId))return;
  const d=e.data;
  if(d.event==='returned'){finish('Returned to Sole Run. Its position, inventory and timer are unchanged. Press Start / resume when ready.');root.scrollIntoView({behavior:'smooth'});return;}
  if(leaving)return;
  if(d.event==='ready'){clearTimeout(timer);status.textContent='Shared street ready. Use Preview, Confirm and square/hex controls on the globe; return here to resume Sole Run.';}
  if(d.event==='arrived')status.textContent='Reached a shared street cell. This walk awards no Sole Run mission progress. Return to resume.';
  if(d.event==='unloaded')status.textContent='Shared street unloaded. Return to Sole Run, or move the globe back near Golden Hill.';
 };
 const reloaded=()=>{if(active)finish('Globe reloaded. Sole Run remains paused.');};
 win.addEventListener('message',message);frame?.addEventListener('load',reloaded);
 return ()=>{disposed=true;clearTimeout(timer);if(active)send('bridgeport:leave');win.removeEventListener('message',message);frame?.removeEventListener('load',reloaded);if(active)onActive(false);panel.remove();};
}
