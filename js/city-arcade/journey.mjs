import { arcadeRequest } from './cloud.mjs';
import { LOCATIONS, locationCoordinates } from './mission-contract.mjs';
const KEY='here.city-arcade.journey.v1';
const known=id=>LOCATIONS.find(p=>p.id===id);
export function readJourney(storage=localStorage){
  try{const x=JSON.parse(storage.getItem(KEY)||'{}');return {locationId:known(x.locationId)?.id||null,result:x.result&&known(x.result.locationId)&&['won','failed'].includes(x.result.status)&&Number.isFinite(x.result.score)?x.result:null};}catch{return {locationId:null,result:null};}
}
export function saveJourney(value,storage=localStorage){try{storage.setItem(KEY,JSON.stringify(value));return true;}catch{return false;}}
export function mountJourney({onSelect,onReturn}) {
  const root=document.querySelector('#arcade-location'),saved=readJourney();let location=null,neighborhood=null;
  const text=document.createElement('p');text.setAttribute('role','status');
  root.innerHTML='<h2>Choose your starting block</h2><p>Two street entrances in downtown Bridgeport. Tea Rush uses an authored interior; these markers do not identify a real tea shop.</p><div data-location-buttons></div><div data-street-map></div><p><a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors · ODbL</a> · footprints: CT GIS 2023</p><button class="action" data-history>Load account results</button><div data-return></div>';
  root.append(text);
  function renderResult(){
    const result=readJourney().result,box=root.querySelector('[data-return]');box.replaceChildren();
    if(!result)return;
    const p=document.createElement('p');p.textContent=`Last visit: ${known(result.locationId).name} · ${result.status==='won'?'Completed':'Shift ended'} · ${result.score} practice points · ${result.cloud==='saved'?'cloud saved':'on this device'}`;box.append(p);
  }
  function select(id){
    const next=known(id);if(!next||!neighborhood)return;
    location=next;saveJourney({...readJourney(),locationId:id});
    root.querySelectorAll('[data-location-id]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.locationId===id)));
    text.textContent=next.name+' selected. Choose a game below.';
    onSelect({...next,coordinates:locationCoordinates(next,neighborhood.geography)});
  }
  const buttons=root.querySelector('[data-location-buttons]');
  for(const p of LOCATIONS){const b=document.createElement('button');b.className='action';b.type='button';b.textContent=p.name;b.dataset.locationId=p.id;b.disabled=true;b.onclick=()=>select(p.id);buttons.append(b);}
  async function load(){
    const response=await fetch(new URL('../../data/city-arcade/locations.v1.json',import.meta.url));if(!response.ok)throw Error('Location markers unavailable');
    const d=await response.json();if(d.schema!=='mccluster.arcade-locations/v1'||!d.geography)throw Error('Invalid markers');
    neighborhood={geography:d.geography,roads:[],places:[]};
    paint();
    buttons.querySelectorAll('button').forEach(b=>b.disabled=false);
    text.textContent='Select a street entrance. Detailed city geometry loads only on entry or nearby zoom.';
    const requested=new URLSearchParams(locationGlobal()).get('location');
    if(known(requested||saved.locationId))select(requested||saved.locationId);
    document.dispatchEvent(new CustomEvent('arcade:geography-ready',{detail:{geography:neighborhood.geography}}));
  }
  function paint(){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','-170 -350 340 300');svg.setAttribute('aria-label','Downtown Bridgeport source street layout');svg.setAttribute('role','img');
    for(const p of neighborhood.places||[]){if(!p.footprint)continue;const shape=document.createElementNS(ns,'polygon');shape.setAttribute('points',p.footprint.map(pt=>pt.join(',')).join(' '));shape.setAttribute('fill','#41616a');const title=document.createElementNS(ns,'title');title.textContent=p.name;shape.append(title);svg.append(shape);}
    for(const road of neighborhood.roads){const line=document.createElementNS(ns,'polyline');line.setAttribute('points',road.points.map(pt=>pt.join(',')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#91a9ac');line.setAttribute('stroke-width',Math.max(1,road.width/3));const title=document.createElementNS(ns,'title');title.textContent=road.name||'Footway';line.append(title);svg.append(line);}
    for(const [i,p]of LOCATIONS.entries()){
      const g=document.createElementNS(ns,'g');g.setAttribute('tabindex','0');g.setAttribute('role','button');g.setAttribute('aria-label','Select '+p.name);g.style.cursor='pointer';
      const c=document.createElementNS(ns,'circle');c.setAttribute('cx',p.point[0]);c.setAttribute('cy',p.point[1]);c.setAttribute('r','13');c.setAttribute('fill','#7ef3c8');
      const label=document.createElementNS(ns,'text');label.setAttribute('x',p.point[0]);label.setAttribute('y',p.point[1]+5);label.setAttribute('text-anchor','middle');label.setAttribute('fill','#102f38');label.setAttribute('font-size','16');label.textContent=String(i+1);g.append(c,label);g.onclick=()=>select(p.id);g.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();select(p.id);}};svg.append(g);
    }
    root.querySelector('[data-street-map]').replaceChildren(svg);
  }
  document.addEventListener('arcade:unloaded',()=>{if(neighborhood){neighborhood={geography:neighborhood.geography,roads:[],places:[]};paint();}});
  document.addEventListener('arcade:geometry',e=>{neighborhood=e.detail;paint();});
  const locationGlobal=()=>window.location.search;
  const mapPicked=e=>{
    if(!neighborhood||!Array.isArray(e.detail))return;
    const [lon,lat]=e.detail;if(!Number.isFinite(lon)||!Number.isFinite(lat))return;
    const close=LOCATIONS.map(p=>{const [x,y]=locationCoordinates(p,neighborhood.geography);return {p,d:Math.hypot((x-lon)*84000,(y-lat)*111320)};}).sort((a,b)=>a.d-b.d)[0];
    if(close.d<=60)select(close.p.id);else text.textContent='That point is outside the two playable entrances. Select a numbered Bridgeport entrance.';
  };
  document.addEventListener('arcade:map-picked',mapPicked);
  root.querySelector('[data-history]').onclick=async()=>{
    const b=root.querySelector('[data-history]');b.disabled=true;
    try{const results=await arcadeRequest('/results');const r=results?.[0];const resultLocation=r?.mission_id?.replace(/^sole-/,'');if(r&&known(resultLocation)&&['won','failed'].includes(r.status)&&Number.isFinite(Number(r.score))){saveJourney({...readJourney(),result:{locationId:resultLocation,status:r.status,score:Number(r.score),cloud:'saved'}});renderResult();}else text.textContent='No completed account results yet.';}catch(e){text.textContent=e.message;}finally{b.disabled=false;}
  };
  renderResult();load().catch(e=>{text.textContent=e.message+'. Launch is disabled until the shared map loads.';});
  return {get location(){return location;},record(result){saveJourney({...readJourney(),result});renderResult();},returnToMap(){renderResult();root.scrollIntoView({behavior:'smooth'});onReturn?.();}};
}
