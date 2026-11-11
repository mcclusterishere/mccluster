import {mountArcadeGlobe} from './globe.mjs';
import {mountJourney} from './journey.mjs';
import {mountLoading} from './loading-controls.mjs';
const $=s=>document.querySelector(s),esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let games=[],journey,loading,selected=null,dispose=null,generation=0;
function showGames(){
 $('#arcade-list').innerHTML=games.map(g=>`<button type="button" class="game-card" data-game="${esc(g.id)}" aria-pressed="${selected?.id===g.id}" ${g.status==='playable'&&journey?.location?'':'disabled'}><small>${g.status==='playable'?(journey?.location?'PLAY NOW':'CHOOSE A LOCATION'):'COMING LATER'}</small><strong>${esc(g.title)}</strong><span>${esc(g.blurb)}</span><div class="game-meta"><span>${esc(g.genre)}</span><span>${esc(g.length)}</span></div></button>`).join('');
}
function leave(){generation++;dispose?.();dispose=null;selected=null;loading.leave();showGames();$('#arcade-play').innerHTML='<h2 id="play-title">Choose a game</h2><p>Your in-progress game stays on this device. Select it to resume.</p>';}
async function selectGame(id){
 const game=games.find(g=>g.id===id&&g.status==='playable');if(!game||!journey.location)return;
 const seq=++generation;dispose?.();dispose=null;selected=game;showGames();
 const point={...journey.location},url=new URL(location.href);url.searchParams.set('game',id);url.searchParams.set('location',point.id);history.replaceState(null,'',url);
 $('#arcade-play').innerHTML='<h2 id="play-title">Loading game…</h2><button class="action" data-cancel-load>Cancel entry</button>';
 try{
  // Geography is bounded/abortable; actual game modules are not requested before entry.
  const neighborhood=await loading.enter();if(seq!==generation)return;
  const module=await (id==='gauranfucking-tea-tea-rush'?import('./tea-view.mjs'):import('./sole-street-view.mjs'));if(seq!==generation)return;
  const finish=result=>{
   if(seq!==generation)return;
   journey.record({locationId:point.id,gameId:id,status:result.status,score:result.score,cloud:result.cloud||'local'});
   try{const key='here.city-arcade.'+(id==='gauranfucking-tea-tea-rush'?'tea-action':'sole-street')+'.best.v1';localStorage.setItem(key,String(Math.max(Number(localStorage.getItem(key))||0,result.score)));}catch{}
  };
  const options={locationId:point.id,point:point.point,neighborhood,onReturn:()=>{leave();journey.returnToMap();}};
  dispose=id==='gauranfucking-tea-tea-rush'?module.mountTea($('#arcade-play'),finish,options):module.mountSoleStreet($('#arcade-play'),finish,options);
 }catch(e){if(seq===generation){$('#arcade-play').innerHTML='<h2 id="play-title">Game could not load</h2><p role="alert">'+esc(e.message)+'</p><button class="action" data-cancel-load>Return to map</button>';}}
}
document.addEventListener('arcade:leave-region',()=>{if(selected)leave();});
$('#arcade-list').addEventListener('click',e=>{const b=e.target.closest('[data-game]');if(b)selectGame(b.dataset.game);});
$('#arcade-play').addEventListener('click',e=>{if(e.target.closest('[data-cancel-load]'))leave();});
async function boot(){
 mountArcadeGlobe();loading=mountLoading();
 const r=await fetch(new URL('../../data/city-arcade/catalog.v1.json',import.meta.url),{cache:'no-cache'});if(!r.ok)throw Error('Arcade catalog unavailable');
 const registry=await r.json();if(registry.schema!=='here.city-arcade/v1'||!Array.isArray(registry.games))throw Error('Wrong catalog schema');games=registry.games;
 const requested=new URLSearchParams(location.search).get('game');
 journey=mountJourney({onSelect:point=>{leave();document.dispatchEvent(new CustomEvent('arcade:location-selected',{detail:point}));showGames();if(requested)selectGame(requested);}});showGames();
}
boot().catch(e=>{$('#arcade-list').textContent='Arcade unavailable: '+e.message;});
