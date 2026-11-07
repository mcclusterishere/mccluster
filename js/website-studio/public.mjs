import {renderWebsite} from './renderer.mjs';
const host=document.getElementById('site'),slug=new URLSearchParams(location.search).get('site');let dispose=()=>{};
try{if(!/^site-[a-f0-9]{32}$/.test(slug||''))throw Error('Website not found');const r=await fetch('https://api.mccluster.org/v1/creator-sites/studio/public/'+slug,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(r.status===404?'This website is unavailable.':'This website could not load. Try again.');const data=await r.json();document.title=data.document.title;dispose=renderWebsite(host,data);}catch(e){host.textContent=e.message;}
window.addEventListener('pagehide',()=>dispose());
