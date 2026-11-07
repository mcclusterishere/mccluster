import {createCitySimulation,movementPreview,act,outcome,restoreSimulation,commitSimulation,SAVE_KEY} from './city-simulation.mjs';
import {playerProjection} from './tactical-hints.mjs';
import {shotPreview} from './tactical-resolver.mjs';
const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
let region,run=null,selected=null;
function message(e){$('notice').textContent=e?.message||String(e);}
function element(tag,attrs){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;}
function choose(index){selected=movementPreview(run,index);$('route').textContent=selected?`${selected.mode}: ${selected.costM.toFixed(2)} m · ${selected.mode==='MOVE'?1:2} AP. Confirm to execute.`:'Destination is not reachable.';$('confirm').disabled=!selected;draw();}
function draw(){
  const svg=$('map');svg.replaceChildren();if(!run)return;
  const s=run.state,nav=s.metricNavigation,p=s.units[0],point=nav.nodes[p.x].position,extent=22;
  svg.setAttribute('viewBox',`${point.x-extent} ${point.z-extent} ${extent*2} ${extent*2}`);
  for(const b of region.buildings)for(const ring of b.rings)svg.append(element('polygon',{points:ring.map(p=>`${p.x},${p.z}`).join(' '),fill:'#44525c',stroke:'#96a3ab','stroke-width':.15}));
  for(const road of region.roads)svg.append(element('polyline',{points:road.points.map(p=>`${p.x},${p.z}`).join(' '),fill:'none',stroke:'#344a56','stroke-width':2}));
  // Only the player's projection can produce hints or enemy markers.
  for(const option of $('destination').options){if(!option.value)continue;const i=Number(option.value),n=nav.nodes[i],q=movementPreview(run,i);if(!q)continue;
    const c=element('circle',{cx:n.position.x,cy:n.position.z,r:.65,fill:q.mode==='MOVE'?'#4faaff':'#ffa64f','data-node':i});c.addEventListener('click',()=>{$('destination').value=String(i);choose(i);});svg.append(c);}
  if(selected)svg.append(element('polyline',{points:[p,...selected.path].map(c=>{const v=nav.nodes[c.x].position;return `${v.x},${v.z}`;}).join(' '),fill:'none',stroke:'#fff','stroke-width':.25}));
  const markers=playerProjection(s).units.filter(u=>!u.dead&&!u.statuses.includes('EXTRACTED')).map(u=>({at:nav.nodes[u.x].position,label:u.id==='R1'?'R':'H'}));
  markers.push({at:nav.nodes[s.battlefield.extractionZone.x].position,label:'E'});
  for(const {at,label} of markers){const t=element('text',{x:at.x,y:at.z,'font-size':1.8,'text-anchor':'middle',fill:label==='H'?'#ff8292':'#fff','pointer-events':'none'});t.textContent=label;svg.append(t);}
}
function render(){
  selected=null;$('confirm').disabled=true;$('destination').replaceChildren(new Option('Select a destination',''));
  if(!run)return;const s=run.state,p=s.units[0],result=outcome(run),active=result==='ACTIVE';
  $('status').textContent=`${result} · Round ${s.round} · ${p.ap} AP · ${p.hp} HP · ${p.ammo} ammo · ${run.topology}`;
  $('route').textContent='Select first; confirm to move.';
  if(active)for(let i=0;i<s.metricNavigation.nodes.length;i++){const q=movementPreview(run,i);if(q){const n=s.metricNavigation.nodes[i];$('destination').append(new Option(`${n.id} · ${q.costM.toFixed(1)}m · ${q.mode}`,String(i)));}}
  $('fire').disabled=!active||!playerProjection(s).units.some(u=>u.id==='H1')||!shotPreview(s,'R1','H1').legal;
  for(const id of ['reload','overwatch'])$(id).disabled=!active||p.ap<1;
  $('end').disabled=!active;$('extract').disabled=!active||p.x!==s.battlefield.extractionZone.x;
  $('aftermath').textContent=result==='COMPLETE'?`Extraction complete in ${s.round} rounds. Mission state is saved; resume preserves this result.`:result==='FAILED'?'Operative down. This failed run is preserved; use owner setup to start a new simulation.':'';
  draw();
}
async function load(){if(!region){const response=await fetch('data/spatial/bridgeport-downtown.v2.json');if(!response.ok)throw new Error('Shared City data unavailable');region=await response.json();}return region;}
function transact(action){try{const next=act(run,action,selected);commitSimulation(localStorage,next);run=next;$('notice').textContent='Saved in this browser.';render();}catch(e){message(e);}}
$('start').onclick=async()=>{try{await load();const next=createCitySimulation(region,{topology:$('topology').value,moveRangeM:Number($('range').value)}),old=localStorage.getItem(SAVE_KEY);if(old)localStorage.setItem(SAVE_KEY+'.previous',old);commitSimulation(localStorage,next);run=next;$('notice').textContent='Simulation started and saved.';render();}catch(e){message(e);}};
$('resume').onclick=async()=>{try{await load();const text=localStorage.getItem(SAVE_KEY);if(!text)throw new Error('No saved simulation in this browser');run=restoreSimulation(region,text);$('notice').textContent='Saved simulation restored.';render();}catch(e){message(e);}};
$('destination').onchange=()=>{if(run&&$('destination').value)choose(Number($('destination').value));};
$('confirm').onclick=()=>transact('move');for(const id of ['fire','reload','overwatch','extract','end'])$(id).onclick=()=>transact(id);

// Read-only presentation adapter. This snapshot is not authoritative learning evidence.
export function learningSnapshot(){return run?{variant:'city',topology:run.topology,turn:run.state.round}:null;}
const requestedTopology=new URLSearchParams(location.search).get('topology');
if(['square','hex'].includes(requestedTopology))$('topology').value=requestedTopology;
Object.defineProperty(window,'__prim3CityLearningSnapshot',{value:learningSnapshot,configurable:false,writable:false});
