import { LOCATIONS, locationCoordinates } from './mission-contract.mjs';
// Reuse canonical Cesium travel messages. No duplicate globe or new map provider.
export function mountArcadeGlobe() {
  const frame=document.querySelector('#arcade-globe'),status=document.querySelector('#arcade-map-status');if(!frame)return;
  let ready=false,geography=null,selected=null;
  const send=data=>frame.contentWindow?.postMessage(data,location.origin);
  function show(fly=false){
    if(!ready)return;
    if(!geography){send({type:'hu:focus-place',lat:41.1798,lon:-73.1903});return;}
    send({type:'hu:travel-mode',on:true});
    const places=selected?[selected]:LOCATIONS.map(p=>({...p,coordinates:locationCoordinates(p,geography)}));
    send({type:'hu:journey',points:places.map(p=>({label:p.name,coordinates:p.coordinates})),connect:false,fly});
  }
  window.addEventListener('message',e=>{
    if(e.origin!==location.origin||e.source!==frame.contentWindow)return;
    if(e.data?.type==='hu:globe-ready'){if(!ready){ready=true;show(!!selected);}status.textContent='Bridgeport · select a street entrance below or pick it on the globe.';}
    if(e.data?.type==='hu:globe-unavailable'){ready=false;status.textContent='Globe unavailable. Select an entrance on the street map below.';}
    if(e.data?.type==='arcade:view')document.dispatchEvent(new CustomEvent('arcade:view',{detail:e.data}));
    if(e.data?.type==='hu:travel-location-selected'){document.dispatchEvent(new CustomEvent('arcade:map-picked',{detail:e.data.coordinates}));}
  });
  document.addEventListener('arcade:geography-ready',e=>{geography=e.detail.geography;show();});
  document.addEventListener('arcade:location-selected',e=>{selected=e.detail;status.textContent=selected.name+' selected. Choose a game below.';show(true);});
  frame.addEventListener('load',()=>{ready=false;send({type:'hu:hello'});});
  document.querySelector('#arcade-bridgeport').addEventListener('click',()=>{selected=null;show(true);});
  document.querySelector('#arcade-pick-location').addEventListener('click',()=>{if(!ready){status.textContent='Use the street map below while the globe is unavailable.';return;}send({type:'hu:travel-mode',on:true});send({type:'hu:map-pick-mode',kind:'to'});status.textContent='Tap near either playable street entrance on the globe.';});
  document.querySelector('#arcade-map-size').addEventListener('input',e=>frame.style.setProperty('--arcade-globe-height',e.target.value+'vh'));
  send({type:'hu:hello'});
}
