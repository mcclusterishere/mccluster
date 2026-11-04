import {DEFAULT_LOADING,validateLoading,createRegionLoader,withinRegion} from './region-loader.mjs';
export function mountLoading(){
 const key='here.city-arcade.loading.v1';let config={...DEFAULT_LOADING};try{config=validateLoading(JSON.parse(localStorage.getItem(key)));}catch{}
 const status=document.querySelector('#arcade-load-status'),root=document.querySelector('#arcade-loading-controls');
 const loader=createRegionLoader({url:new URL('../../data/fictional-city/district.v1.json',import.meta.url),config,onState:(state,info)=>{
  if(state==='unloaded')document.dispatchEvent(new CustomEvent('arcade:unloaded'));
  status.textContent=state==='loaded'?`Shared city geometry loaded: ${info.bytes.toLocaleString()} bytes (${info.reason}).`:state==='loading'?'Loading the shared city geometry…':state==='error'?info.message:'Markers only. City geometry is unloaded.';
 }});
 for(const k of Object.keys(config)){const label=document.createElement('label');label.textContent=k;const input=document.createElement('input');input.type='number';input.step=k==='maxBytes'||k==='maxHeight'?'1':'0.0001';input.value=config[k];input.dataset.loadSetting=k;label.append(input);root.append(label);}
 const b=document.createElement('button');b.className='action';b.textContent='Apply loading settings';b.onclick=()=>{try{const next={};root.querySelectorAll('input').forEach(i=>next[i.dataset.loadSetting]=Number(i.value));config=validateLoading(next);loader.setConfig(config);localStorage.setItem(key,JSON.stringify(config));status.textContent='Loading settings saved on this device.';}catch(e){status.textContent=e.message;}};root.append(b);
 let active=false;
 document.addEventListener('arcade:view',e=>{if(active){if(!withinRegion(e.detail,config))document.dispatchEvent(new CustomEvent('arcade:leave-region'));return;}loader.observe(e.detail).then(n=>{if(n)document.dispatchEvent(new CustomEvent('arcade:geometry',{detail:n}));}).catch(()=>{});});
 return {async enter(){active=true;const n=await loader.load('entry');document.dispatchEvent(new CustomEvent('arcade:geometry',{detail:n}));return n;},leave(){active=false;loader.unload();document.dispatchEvent(new CustomEvent('arcade:unloaded'));},get loaded(){return loader.loaded;}};
}
