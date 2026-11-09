'use strict';
(()=>{
const M=window.FyreModel,$=id=>document.getElementById(id);
const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function renderCards(){const container=$('cards');container.replaceChildren();M.cards.filter(c=>$('filter').value==='all'||c.theme===$('filter').value).forEach(c=>{const el=make('article');el.className='card';const number=make('span',`0${M.cards.indexOf(c)+1} / LEARNING CARD`);number.className='number';el.append(number,make('h3',c.title),make('p',c.description),make('p',c.step),make('p','Assessment: not assigned · Local impact: unknown'));const link=make('a','Read Project Drawdown ↗');link.href=c.source;link.target='_blank';link.rel='noopener noreferrer';el.append(link);container.append(el);});}
$('filter').addEventListener('change',renderCards);
$('clear-legacy').onclick=()=>{
  if(!window.confirm('Permanently delete all old FYRE preview notes saved in this browser on this origin? This cannot be undone. No other browser data will be removed.'))return;
  let cleared=false;
  try{cleared=M.clearLegacyNotes(window.localStorage);}catch{}
  $('status').textContent=cleared?'The old preview storage key was removed from this browser and origin. Other devices and origins are unchanged.':'Could not clear old preview notes. Browser storage is unavailable or blocked; old notes may remain. Notes are still disabled.';
};
// Refresh static cards/status on restored pages without accessing any note storage.
window.addEventListener('pageshow',()=>{renderCards();$('status').textContent='Notes are disabled. Older preview notes may remain until you choose to clear them.';});
renderCards();
})();
