import {renderPlan} from './contract.mjs';
import {panorama} from './panorama.mjs';
/** The exact same module renders authenticated previews and published pages.
 * payload media URLs are short-lived, owner-authorized derivative URLs only.
 * Do not pass editor input as a resolved media object.
 */
export function renderWebsite(host,payload,{reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches}={}){
 const cleanups=[],players=[];let sound=false,closed=false;
 const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 const safe=value=>{try{const u=new URL(value,location.href);return u.protocol==='https:'||u.origin===location.origin?u.href:null;}catch{return null;}};
 const find=(tile,role)=>payload.media?.[`${tile}:${role}`];
 const wrapper=element('div',null,'ws-site');host.replaceChildren(wrapper);
 wrapper.append(element('h1',payload.document.title));
 const soundButton=element('button','Enable sound');soundButton.type='button';soundButton.onclick=()=>{sound=!sound;soundButton.textContent=sound?'Sound enabled':'Enable sound';};wrapper.append(soundButton);
 const controls=[];
 function configurePlayer(player,tile){player.controls=true;player.preload='none';player.playsInline=true;player.setAttribute('aria-label',tile.headline||'Play media');players.push(player);
 player.addEventListener('play',()=>players.filter(p=>p!==player).forEach(p=>p.pause()));
 const observer=new IntersectionObserver(entries=>{for(const e of entries){if(!e.isIntersecting)player.pause();else if(sound&&!reducedMotion&&tile.playback==='enter_after_consent')player.play().catch(()=>{});}},{threshold:.5});observer.observe(player);cleanups.push(()=>observer.disconnect());}
 for(const segment of renderPlan(payload.document,{reducedMotion})){
  const tileID=segment.tile_id;
  if(segment.segment==='transition'){
   const m=find(tileID,'transition');if(!m?.desktop_url)continue;
   const section=element('section',null,'ws-transition');section.style.minHeight={quick:'180svh',standard:'260svh',cinematic:'360svh'}[segment.transition.pace];
   const sticky=element('div',null,'ws-sticky'),v=element('video');v.muted=true;v.playsInline=true;v.preload='metadata';v.setAttribute('aria-hidden','true');const poster=safe(m.poster_url);if(poster)v.poster=poster;
   const url=safe(innerWidth<700&&m.phone_url?m.phone_url:m.desktop_url);if(!url)continue;v.src=url;sticky.append(v);section.append(sticky);wrapper.append(section);
   let target=0,raf=null,near=false;const seek=()=>{if(closed||!near||v.seeking||!Number.isFinite(v.duration)||v.duration<=0)return;const time=target*Math.max(0,v.duration-.04);if(Math.abs(v.currentTime-time)>.025)v.currentTime=time;};
   const draw=()=>{raf=null;const r=section.getBoundingClientRect();target=Math.max(0,Math.min(1,-r.top/Math.max(1,r.height-innerHeight)));seek();};const queue=()=>{if(raf===null&&!closed&&near)raf=requestAnimationFrame(draw);};
   const io=new IntersectionObserver(es=>{near=es[0].isIntersecting;if(near){v.preload='auto';queue();}} ,{rootMargin:'100% 0px'});io.observe(section);
   window.addEventListener('scroll',queue,{passive:true});window.addEventListener('resize',queue);v.addEventListener('loadedmetadata',queue);v.addEventListener('seeked',seek);
   cleanups.push(()=>{io.disconnect();window.removeEventListener('scroll',queue);window.removeEventListener('resize',queue);if(raf!==null)cancelAnimationFrame(raf);v.removeEventListener('seeked',seek);v.removeAttribute('src');v.load();});
   continue;
  }
  const tile=segment.tile,m=find(tileID,'content');const section=element('section',null,'ws-content');section.dataset.tile=tileID;section.append(element('h2',tile.headline),element('p',tile.body));wrapper.append(section);
  if(!m){section.append(element('p','Add approved media to this tile.','ws-notice'));continue;}
  const url=safe(m.url);if(!url){section.append(element('p','Media unavailable.'));continue;}
  if(tile.kind==='immersive360'){
   const thumb=element('img');thumb.src=url;thumb.alt=tile.headline||'360 panorama';thumb.loading='lazy';section.append(thumb);
   const enter=element('button','Enter 360 experience');enter.type='button';section.append(enter);
   enter.onclick=()=>{if(section.querySelector('canvas'))return;const panel=element('div',null,'ws-immersive'),canvas=element('canvas');canvas.tabIndex=0;canvas.setAttribute('aria-label','Drag to look around. Arrow keys move the view.');
    const exit=element('button','Exit 360');panel.append(exit,canvas);section.append(panel);let stop=()=>{};
    const close=()=>{stop();panel.remove();enter.hidden=false;enter.focus();};exit.onclick=close;panel.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
    try{stop=panorama(canvas,url);cleanups.push(stop);enter.hidden=true;canvas.focus();}catch(e){panel.replaceChildren(element('p',e.message),exit);}
   };
  }else{const p=element(tile.kind==='music'?'audio':'video');p.src=url;if(m.poster_url&&p.tagName==='VIDEO')p.poster=safe(m.poster_url)||'';configurePlayer(p,tile);section.append(p);}
  if(tile.action){const destination=tile.action.kind==='link'?safe(tile.action.url):safe(find(tileID,'offer')?.url);if(destination){const a=element('a',tile.action.label,'ws-action');a.href=destination;a.rel='noopener noreferrer';section.append(a);}else section.append(element('p','Purchase is unavailable until the offer is verified.','ws-notice'));}
 }
 return ()=>{closed=true;cleanups.forEach(f=>f());players.forEach(p=>{p.pause();p.removeAttribute('src');p.load();});host.replaceChildren();};
}
