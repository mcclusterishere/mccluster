// Consumer of City #748: no geometry, topology, pose conversion or shared save implementation.
import {STREET_STOPS} from './sole-config.mjs';
export const SPATIAL_SCHEMA='mccluster.spatial-lifecycle/v1';
export const SPATIAL_REGION='bridgeport-downtown.v2';
export const SHARED_ENTRANCE='bridgeport-main-golden-hill';
const WAYS=['10181430','186839735','10173135','10180837','10169925','659214169'];
const sameIds=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export function sharedStopId(alias){if(!STREET_STOPS.some(p=>p.id===alias))throw Error('Unsupported shared street stop');return 'bridgeport-'+alias;}
// Conservative policy: a closed legacy segment closes its complete source way in City.
export function sharedClosures(ids){
 if(!Array.isArray(ids))throw Error('Invalid road closures');
 return [...new Set(ids.map(id=>{const m=/^bridgeport-osm-(\d+)-\d+$/.exec(id);if(!m||!WAYS.includes(m[1]))throw Error('A mission closure is outside the shared downtown graph.');return m[1];}))];
}
export function acceptsSpatialState(event,source,origin,entranceId=SHARED_ENTRANCE){
 const d=event.data;
 return event.source===source&&event.origin===origin&&d?.schema===SPATIAL_SCHEMA&&d.type==='bridgeport:state'&&
  d.regionId===SPATIAL_REGION&&d.revision===2&&d.frameId==='bridgeport-golden-hill.enu.v1'&&d.floorId==='street'&&
  d.entranceId===entranceId&&['ready','saved','arrived','unloaded','returned','closures-changed','imported'].includes(d.event)&&['hex','square'].includes(d.topology)&&
  Number.isSafeInteger(d.navigationRevision)&&d.navigationRevision>=0&&Array.isArray(d.closedRoadIds)&&d.closedRoadIds.every(id=>WAYS.includes(id))&&
  Array.isArray(d.capabilities)&&['exterior-navigation','road-closures'].every(c=>d.capabilities.includes(c))&&
  (d.position===null?['unloaded','returned'].includes(d.event):d.position?.y===0&&[d.position.x,d.position.z].every(Number.isFinite));
}
export function mountSoleSpatial(root,{locationId,onActive,canEnter=()=>true,getMission=()=>({route:['main-elm','main-fairfield','middle-golden-hill','main-golden-hill'],index:0,blockedRoads:[]}),win=window,frame=document.querySelector('#arcade-globe'),timeoutMs=20000}){
 const panel=document.createElement('section');panel.dataset.soleSpatial='';root.append(panel);
 if(!['bridgeport-main-elm',SHARED_ENTRANCE].includes(locationId)){panel.textContent='This entrance is not supported by the shared downtown graph.';return ()=>panel.remove();}
 panel.innerHTML='<h3>Sole routes on the downtown globe</h3><p>Pause Sole Run to navigate its configured street stops in square or hex mode on the globe. This shared navigation save is separate: walking does not collect shoes or advance the arcade mission. Mission segment closures close their entire source road here. Existing shared position resumes; no legacy save is moved. Doors/stairs are unsupported; ion availability is shown on the globe.</p><button class="action" data-spatial-enter>Walk Sole routes on globe</button><label>Street objective<select data-spatial-target disabled></select></label><button class="action" data-spatial-preview disabled>Preview selected route on globe</button><button class="action" data-spatial-return disabled>Return to Sole Run</button><p role="status" data-spatial-status></p>';
 const enter=panel.querySelector('[data-spatial-enter]'),back=panel.querySelector('[data-spatial-return]'),status=panel.querySelector('[data-spatial-status]'),target=panel.querySelector('[data-spatial-target]'),preview=panel.querySelector('[data-spatial-preview]');
 let active=false,leaving=false,disposed=false,timer,ready=false,desired=[],waitingClosures=false,navigationRevision=-1,targets=[];
 const send=(type,payload={})=>frame?.contentWindow?.postMessage({type,schema:SPATIAL_SCHEMA,...payload},win.location.origin);
 const routeControls=on=>{target.disabled=!on;preview.disabled=!on;};
 const finish=message=>{clearTimeout(timer);active=false;leaving=false;ready=false;waitingClosures=false;enter.disabled=false;back.disabled=true;routeControls(false);onActive(false);status.textContent=message;};
 enter.onclick=()=>{
  if(active||disposed)return;if(!frame?.contentWindow||!canEnter()){status.textContent='Shared walk unavailable while a mission operation is pending or the globe is unavailable.';return;}
  try{const m=getMission();desired=sharedClosures(m.blockedRoads);targets=m.route.map((id,i)=>({id:sharedStopId(id),label:(i+1)+'. '+['Robbery 1s','Velocity 1s','Ghost Soles','Gravity Highs'][i]+' · '+id}));targets.push({id:sharedStopId('main-south'),label:'Other street stop · main-south'},{id:locationId,label:'Return to entrance'});target.replaceChildren();for(const t of targets){const option=document.createElement('option');option.value=t.id;option.textContent=t.label;target.append(option);}target.selectedIndex=Math.min(m.index,4)===4?targets.length-1:Math.max(0,m.index);}catch(e){status.textContent=e.message;return;}
  active=true;navigationRevision=-1;onActive(true);enter.disabled=true;back.disabled=false;status.textContent='Opening shared downtown navigation. Sole Run is paused.';send('bridgeport:enter',{regionId:SPATIAL_REGION,entranceId:locationId});frame.scrollIntoView({behavior:'smooth'});
  timer=setTimeout(()=>{if(!active||disposed)return;send('bridgeport:leave');finish('Shared City v2 navigation did not become ready. Sole Run remains paused; this build requires City #748 v2.');},timeoutMs);
 };
 preview.onclick=()=>{if(!active||!ready||waitingClosures||leaving||!targets.some(t=>t.id===target.value))return;send('bridgeport:preview',{destinationId:target.value});status.textContent='Route requested for '+target.selectedOptions[0].textContent+'. Review the route or blocked message on the globe, then Confirm there.';frame.scrollIntoView({behavior:'smooth'});};
 back.onclick=()=>{if(!active||leaving)return;leaving=true;back.disabled=true;routeControls(false);status.textContent='Returning from the globe…';send('bridgeport:leave');};
 const message=e=>{
  if(!active||disposed||!acceptsSpatialState(e,frame?.contentWindow,win.location.origin,locationId))return;
  const d=e.data;if(d.navigationRevision<navigationRevision)return;navigationRevision=d.navigationRevision;
  if(d.event==='returned'){finish('Returned to Sole Run. Its position, inventory and timer are unchanged. Press Start / resume when ready.');root.scrollIntoView({behavior:'smooth'});return;}
  if(leaving)return;
  if(d.event==='ready'){ready=true;waitingClosures=true;routeControls(false);status.textContent='Applying mission road closures to the shared graph…';send('bridgeport:closures',{closedRoadIds:desired});}
  if(d.event==='closures-changed'){
   if(!ready)return;
   if(waitingClosures&&!sameIds(d.closedRoadIds,desired))return;waitingClosures=false;clearTimeout(timer);routeControls(ready);status.textContent='Shared downtown ready. Select a Sole street objective, preview its route, then confirm on the globe. Active whole-road closures: '+(d.closedRoadIds.join(', ')||'none')+'.';
  }
  if(d.event==='arrived')status.textContent='Reached a shared street destination. No Sole mission progress was awarded. Preview another stop or return to resume.';
  if(d.event==='imported'){routeControls(ready&&!waitingClosures);status.textContent='City explicitly imported its previous slice position. The original Sole save is unchanged.';}
  if(d.event==='unloaded'){ready=false;routeControls(false);status.textContent='Shared streets unloaded. Return to Sole Run, or move the globe back near downtown.';}
 };
 const reloaded=()=>{if(active)finish('Globe reloaded. Sole Run remains paused.');};
 win.addEventListener('message',message);frame?.addEventListener('load',reloaded);
 return ()=>{disposed=true;clearTimeout(timer);if(active)send('bridgeport:leave');win.removeEventListener('message',message);frame?.removeEventListener('load',reloaded);if(active)onActive(false);panel.remove();};
}
