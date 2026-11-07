import {renderWebsite} from './renderer.mjs';
const host=document.getElementById('site');let dispose=()=>{};
function pageProfile(profile){window.MCC_PAGE_PROFILE=profile;if(window.MCC_BAR?.pageProfile)window.MCC_BAR.pageProfile(profile);}
try{
 const binding=window.MCC_STUDIO_HOST;
 const bound=binding&&binding.api===location.origin&&/^[a-z0-9][a-z0-9-]{2,39}$/.test(binding.project||'');
 const slug=bound?binding.project:new URLSearchParams(location.search).get('project');
 if(!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug||''))throw Error('Project not found');
 const origin=bound?location.origin:'https://api.mccluster.org';
 const r=await fetch(origin+'/v1/projects/'+encodeURIComponent(slug)+'/tiles/public',{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(r.status===404?'This project is not public.':'This project could not load. Try again.');
 const data=await r.json();document.title=data.document.title;dispose=renderWebsite(host,data);
 window.MCC_SITE_POLICY=data.site_modules||null;if(window.MCC_BAR?.sitePolicy)window.MCC_BAR.sitePolicy(window.MCC_SITE_POLICY);
 pageProfile({name:document.title,logo:'',home:bound?location.pathname:'website-studio-view.html?project='+encodeURIComponent(slug)});
}catch(e){pageProfile(null);host.textContent=e.message;}
window.addEventListener('pagehide',()=>dispose());
