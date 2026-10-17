import { normalizeJourney, journeyTitle, itinerary, legAction, searchCities } from './journey-core.mjs';
import { journeyStore } from './journey-store.mjs';

const $ = id => document.getElementById(id), root = document.documentElement;
const frame = $('mnWorldFrame'), panel = $('wtPlanner');
panel.setAttribute('data-private','');$('wtDestination').setAttribute('data-private','');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const paths = {
  flight:'m3 15 7-4V4l2-2 2 2v7l7 4v2l-7-2v4l2 2h-8l2-2v-4-0L3 17z',
  train:'M7 3h10a2 2 0 0 1 2 2v12H5V5a2 2 0 0 1 2-2ZM5 11h14M8 20l-2 2m10-2 2 2M8 14h.1m7.9 0h.1M12 3v8',
  drive:'m4 10 2-5h12l2 5M4 10h16v8H4zM6 18v3m12-3v3M7 14h.1m9.9 0h.1',
  stay:'M3 19V6m0 8h18v5M3 9h7v5m0-5h8a3 3 0 0 1 3 3v2',
  transit:'M6 3h12v16H6zM6 11h12M8 22v-3m8 3v-3M9 15h.1m5.9 0h.1',
  walk:'M14 3h.01M11 8l3 1 3 4M8 13l3-5-1 8-4 5m4-5 5 2 2 4',
  cycle:'M7 8h10l3 10M7 8l-3 9h10L9 5H6M16 5h3M7 18a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm17 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
};
const icon = name => `<svg class="wt-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.drive}"/></svg>`;
let draft = normalizeJourney(), savedId = null, dirty = false, busy = false, revision = 0;
let catalogPromise, cities = [], currentMode = 'travel';
const send = data => frame?.contentWindow?.postMessage(data, location.origin);
const status = (message = '') => { $('wtMessage').textContent = message; };
const labels = { flight:'Flights', train:'Trains', drive:'Rides', stay:'Stays', transit:'Transit', walk:'Walking', cycle:'Cycling' };

panel.innerHTML = `
  <header class="wt-planner-head"><h2 id="wtTitle">Your whole journey</h2><span class="wt-status" id="wtDraftStatus">Draft</span></header>
  <form id="wtForm">
    <div class="wt-fields wt-fields--main">
      <label class="wt-field"><span>From</span><input id="wtFrom" name="from" autocomplete="off" maxlength="240" placeholder="Where from?" required><span id="wtFromResults" class="wt-suggest" hidden></span></label>
      <label class="wt-field"><span>To</span><input id="wtTo" name="to" autocomplete="off" maxlength="240" placeholder="Where to?" required><span id="wtToResults" class="wt-suggest" hidden></span></label>
      <label class="wt-field"><span>Departure</span><input id="wtDeparture" name="departure" type="date"></label>
      <label class="wt-field"><span>Travelers</span><select id="wtTravelers" name="travelers">${Array.from({ length:16 }, (_,i) => `<option value="${i+1}">${i+1} ${i ? 'travelers':'traveler'}</option>`).join('')}</select></label>
    </div>
    <div class="wt-date-row"><button type="button" id="wtSwap" aria-label="Swap origin and destination">Swap places ⇄</button><button type="button" id="wtAddReturn" aria-expanded="false">Add return date</button><label class="wt-field wt-return" id="wtReturnField" hidden><span>Return</span><input id="wtReturning" type="date" name="returning"></label></div>
    <nav class="wt-toolbar" aria-label="Journey transport">
      ${['flight','train','drive','stay'].map(m => `<button type="button" data-travel-kind="${m}" ${m !== 'stay' ? `aria-pressed="${m === 'flight'}"` : ''}>${icon(m)}${labels[m]}</button>`).join('')}
      <button type="button" id="wtMore" aria-expanded="false" aria-controls="wtMoreModes">••• More</button>
    </nav>
    <nav id="wtMoreModes" class="wt-toolbar" aria-label="More transport" hidden>${['transit','walk','cycle'].map(m => `<button type="button" data-travel-kind="${m}" aria-pressed="false">${icon(m)}${labels[m]}</button>`).join('')}</nav>
    <div class="wt-preferences"><label><input id="wtLowest" type="checkbox">Prefer lowest cost</label><label><input id="wtFree" type="checkbox">Include free options</label></div>
    <div id="wtItinerary"></div>
    <details class="wt-details" id="wtDetails"><summary>Airports, stations &amp; final address</summary><div class="wt-fields">
      <label class="wt-field"><span>Departure airport or station</span><input id="wtDepartureHub" name="departureHub" maxlength="240" placeholder="Choose your departure point"></label>
      <label class="wt-field"><span>Arrival airport or station</span><input id="wtArrivalHub" name="arrivalHub" maxlength="240" placeholder="Choose your arrival point"></label>
      <label class="wt-field"><span>Your stay or final address</span><input id="wtStay" name="stay" maxlength="240" placeholder="Hotel, address or place name"></label>
    </div></details>
    <div class="wt-actions"><button class="wt-primary" type="submit">Plan journey <span aria-hidden="true">→</span></button><button id="wtSave" type="button">Save journey</button></div>
  </form>
  <div class="wt-footer"><p id="wtSaveHint">Sign in to save. Explore freely.</p><button class="wt-text-button" type="button" id="wtSaved">Saved journeys</button></div>
  <p class="wt-message" id="wtMessage" role="status" aria-live="polite"></p>`;

const search = document.createElement('form');
search.className = 'wt-search'; search.setAttribute('role','search');search.setAttribute('data-private','');
search.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg><input id="wtSearch" type="search" aria-label="Search destinations" placeholder="Search places, routes, stays" maxlength="240" autocomplete="off"><div class="wt-suggest" id="wtSearchResults" hidden></div>';
$('mnSearch').before(search);

const dialog = document.createElement('dialog'); dialog.className='wt-saved'; dialog.id='wtSavedDialog'; dialog.setAttribute('aria-labelledby','wtSavedTitle');
dialog.setAttribute('data-private','');
dialog.innerHTML='<header><h2 id="wtSavedTitle">Your journeys</h2><button type="button" id="wtSavedClose" aria-label="Close saved journeys">×</button></header><p id="wtSavedMessage" role="status"></p><div id="wtSavedList"></div><button type="button" id="wtNew">Start a new journey</button>';
document.body.append(dialog);
$('wtSavedClose').onclick=()=>dialog.close();
dialog.addEventListener('click',e=>{if(e.target===dialog&&e.offsetX<0)dialog.close();});

async function catalog() {
  if (!catalogPromise) catalogPromise = fetch('data/travel/cities.json', { signal:AbortSignal.timeout(12000) })
    .then(r=>{ if(!r.ok)throw Error('Place search is unavailable. You can still enter a place.'); return r.json(); })
    .then(rows => { cities=rows; return rows; }).catch(e=>{catalogPromise=null;throw e;});
  return catalogPromise;
}
function changed() { dirty=true; revision++; $('wtDraftStatus').textContent=savedId?'Unsaved':'Draft'; status(); }
function read() {
  const pick=(key,id)=>{ const label=$(id).value.trim();return label?{label,coordinates:draft[key]?.label===label?draft[key].coordinates:null}:null; };
  return normalizeJourney({ ...draft, from:pick('from','wtFrom'), to:pick('to','wtTo'),
    departure:$('wtDeparture').value, returning:$('wtReturning').value, travelers:Number($('wtTravelers').value),
    departureHub:$('wtDepartureHub').value, arrivalHub:$('wtArrivalHub').value, stay:$('wtStay').value,
    lowestCost:$('wtLowest').checked, freeOptions:$('wtFree').checked });
}
function renderGlobe(fly=false) {
  send({type:'hu:travel-mode',on:currentMode==='travel'});
  send({type:'hu:journey',points:[draft.from,draft.to].filter(p=>p?.coordinates).map(p=>({label:p.label.split(',')[0],coordinates:p.coordinates})),fly});
  const dest=$('wtDestination');dest.hidden=currentMode!=='travel'||!draft.to;
  if(draft.to){dest.replaceChildren();const title=document.createElement('strong'),sub=document.createElement('small');title.textContent=draft.to.label.split(',')[0];sub.textContent=draft.to.label.split(',').slice(1).join(',').trim()||'Your destination';dest.append(title,sub);}
}
function renderItinerary() {
  const legs=itinerary(draft), box=$('wtItinerary');
  if(!legs.length){box.innerHTML='<div class="wt-empty"><h3>Where will the world take you?</h3><p>Pick a destination. Bring every part of your trip together, from your front door to your next place to stay.</p><div class="wt-inspiration" aria-label="Explore a destination"><button type="button" data-inspiration="Lisbon">Lisbon ↗</button><button type="button" data-inspiration="Accra">Accra ↗</button><button type="button" data-inspiration="Tokyo">Tokyo ↗</button></div></div>';return;}
  box.innerHTML='<div class="wt-legs">'+legs.map(l=>{
    const a=legAction(draft,l.id), label=a.type==='edit'?'Add details':a.type==='directions'?'Directions ↗':l.kind==='stay'?'Explore stays ↗':`Search ${l.kind==='flight'?'flights':'trains'} ↗`;
    return `<article class="wt-leg"><span class="wt-leg-symbol">${icon(l.kind)}</span><div><strong>${esc(l.title)}</strong><small>${esc(l.subtitle)}</small></div>${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)} for ${esc(l.title)} (opens Google)">${label}</a>`:`<button type="button" data-edit="${a.field}">${label} →</button>`}</article>`;
  }).join('')+'</div><p class="wt-note">A plan, ready to make your own. Searches and directions open Google. Rides and stays are not booked here yet.</p>';
}
function syncInputs() {
  $('wtFrom').value=draft.from?.label||'';$('wtTo').value=draft.to?.label||'';
  for(const [key,id] of [['departure','wtDeparture'],['returning','wtReturning'],['travelers','wtTravelers'],['departureHub','wtDepartureHub'],['arrivalHub','wtArrivalHub'],['stay','wtStay']])$(id).value=draft[key];
  $('wtLowest').checked=draft.lowestCost;$('wtFree').checked=draft.freeOptions;
  $('wtReturnField').hidden=!draft.returning;$('wtAddReturn').setAttribute('aria-expanded',String(!!draft.returning));
  $('wtReturning').min=draft.departure;
  document.querySelectorAll('[data-travel-kind][aria-pressed]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.travelKind===draft.mode)));
  if(['transit','walk','cycle'].includes(draft.mode)){$('wtMoreModes').hidden=false;$('wtMore').setAttribute('aria-expanded','true');}
  renderItinerary();renderGlobe();
}
function choosePlace(key,row) {
  draft=read();draft[key]={label:row.label,coordinates:row.coordinates};changed();syncInputs();renderGlobe(true);
}
function autocomplete(id, resultId, key) {
  const input=$(id), results=$(resultId);let seq=0;
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',resultId);input.setAttribute('aria-expanded','false');results.setAttribute('role','listbox');
  const close=()=>{seq++;results.hidden=true;input.setAttribute('aria-expanded','false');};
  input.addEventListener('input',async()=>{
    const request=++seq,q=input.value;results.hidden=true;input.setAttribute('aria-expanded','false');
    if(q.trim().length<2)return;
    try{const rows=await catalog();if(request!==seq||input.value!==q||currentMode!=='travel')return;
      const matches=searchCities(rows,q);results.replaceChildren();
      matches.forEach(row=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','option');b.textContent=row.label;b.onclick=()=>{try{choosePlace(key,row);if(id==='wtSearch')input.value=row.label;close();input.focus();}catch(e){status(e.message);}};results.append(b);});
      results.hidden=!matches.length;input.setAttribute('aria-expanded',String(!!matches.length));
    }catch(e){if(request===seq)status(e.message);}
  });
  input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&!results.hidden){e.preventDefault();results.querySelector('button')?.focus();}if(e.key==='Escape'){e.preventDefault();close();}});
  results.addEventListener('keydown',e=>{const buttons=[...results.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Escape'].includes(e.key)){e.preventDefault();if(e.key==='Escape'){close();input.focus();}else buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}});
  document.addEventListener('pointerdown',e=>{if(!results.contains(e.target)&&e.target!==input)close();});
  input.addEventListener('focusout',e=>{if(e.relatedTarget&&!results.contains(e.relatedTarget))close();});
  results.addEventListener('focusout',e=>{if(e.relatedTarget!==input&&!results.contains(e.relatedTarget))close();});
}
autocomplete('wtFrom','wtFromResults','from');autocomplete('wtTo','wtToResults','to');autocomplete('wtSearch','wtSearchResults','to');
search.onsubmit=e=>{e.preventDefault();try{const label=$('wtSearch').value.trim();if(label){choosePlace('to',{label,coordinates:draft.to?.label===label?draft.to.coordinates:null});$('wtSearchResults').hidden=true;$('wtFrom').focus();}}catch(err){status(err.message);}};

function setMode(mode) {
  if(!['travel','missions','posts'].includes(mode))return;
  currentMode=mode;root.dataset.worldMode=mode;if(mode!=='travel')root.classList.remove('wt-expanded');
  root.classList.remove('hu-search-open');$('huSearchToggle').setAttribute('aria-expanded','false');
  document.querySelectorAll('[data-world-mode][aria-pressed]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.worldMode===mode)));
  document.querySelectorAll('.wt-suggest').forEach(el=>el.hidden=true);
  $('mnWorldFeed').scrollTop=0;renderGlobe();
}
window.MCC_WORLD_MODE={set:setMode,get:()=>currentMode};
const modeButtons=[...document.querySelectorAll('.wt-world-modes button')];
modeButtons.forEach(b=>{b.onclick=()=>setMode(b.dataset.worldMode);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();let i=modeButtons.indexOf(b);i=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:-1)+3)%3;modeButtons[i].click();modeButtons[i].focus();}};});
let touchStart=null;
$('mnWorldFeed').addEventListener('touchstart',e=>{touchStart=e.target.closest('input,select,button,a,summary,.wt-toolbar')?null:{x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
$('mnWorldFeed').addEventListener('touchend',e=>{if(!touchStart)return;const dx=e.changedTouches[0].clientX-touchStart.x,dy=e.changedTouches[0].clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>100&&Math.abs(dx)>Math.abs(dy)*2){const modes=['travel','missions','posts'];setMode(modes[(modes.indexOf(currentMode)+(dx<0?1:2))%3]);}},{passive:true});
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==frame.contentWindow)return;
  if(e.data?.type==='hu:globe-ready')renderGlobe();
  if(e.data?.type==='hu:country'&&currentMode==='travel'&&e.data.country?.name){try{draft=read();draft.to={label:String(e.data.country.name).slice(0,240),coordinates:null};changed();syncInputs();status('Country selected. Search for a city or enter your destination to refine the trip.');}catch(err){status(err.message);}}
  if(e.data?.type==='hu:mission-selected'&&currentMode==='travel')setMode('missions');
});

$('wtForm').addEventListener('input',e=>{changed();if(e.target.id==='wtDeparture')$('wtReturning').min=e.target.value;try{draft=read();renderItinerary();renderGlobe();}catch(err){status(err.message);}});
$('wtForm').onsubmit=e=>{e.preventDefault();try{draft=read();renderItinerary();renderGlobe(true);status('Your draft is ready. Add the airport, station or stay details as you choose them.');$('wtItinerary').scrollIntoView({block:'nearest',behavior:'auto'});}catch(err){status(err.message);}};
$('wtSwap').onclick=()=>{try{draft=read();[draft.from,draft.to]=[draft.to,draft.from];[draft.departureHub,draft.arrivalHub]=[draft.arrivalHub,draft.departureHub];draft.stay='';changed();syncInputs();renderGlobe(true);}catch(e){status(e.message);}};
$('wtAddReturn').onclick=()=>{const show=$('wtReturnField').hidden;$('wtReturnField').hidden=!show;$('wtAddReturn').textContent=show?'Remove return':'Add return date';$('wtAddReturn').setAttribute('aria-expanded',String(show));if(show)$('wtReturning').focus();else{$('wtReturning').value='';draft.returning='';changed();renderItinerary();}};
$('wtMore').onclick=()=>{const show=$('wtMoreModes').hidden;$('wtMoreModes').hidden=!show;$('wtMore').setAttribute('aria-expanded',String(show));};
function editField(key){const ids={from:'wtFrom',departureHub:'wtDepartureHub',arrivalHub:'wtArrivalHub',stay:'wtStay'};if(key!=='from')$('wtDetails').open=true;$(ids[key]||'wtFrom').focus();}
panel.addEventListener('click',async e=>{
  const mode=e.target.closest('[data-travel-kind]'),edit=e.target.closest('[data-edit]'),inspiration=e.target.closest('[data-inspiration]');
  try{
    if(mode){if(mode.dataset.travelKind==='stay'){editField('stay');return;}draft=read();draft.mode=mode.dataset.travelKind;changed();syncInputs();}
    if(edit)editField(edit.dataset.edit);
    if(inspiration){const rows=await catalog(),row=searchCities(rows,inspiration.dataset.inspiration,1)[0];if(row){choosePlace('to',row);$('wtFrom').focus();}}
  }catch(err){status(err.message);}
});
const expanded=$('mnWorld').querySelector('.mn__world-expand');
expanded.addEventListener('click',e=>{if(currentMode!=='travel')return;e.preventDefault();const on=root.classList.toggle('wt-expanded');expanded.setAttribute('aria-label',on?'Return to journey':'Expand the globe');});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&root.classList.contains('wt-expanded')){root.classList.remove('wt-expanded');expanded.setAttribute('aria-label','Expand the globe');expanded.focus();}});

const account=()=>window.MCC_SUPA?.uid?.()||null;
const signIn=()=>{$('mnGuestSignIn').click();};
const store=()=>journeyStore(window.MCC_SUPA);
$('wtSave').onclick=async()=>{
  if(busy)return;if(!account()){signIn();return;}
  try{draft=read();if(!draft.from||!draft.to){$('wtForm').reportValidity();return;}
    busy=true;$('wtSave').disabled=true;status('Saving your private draft…');const owner=account(),version=revision;
    const row=await store().save(draft,savedId);if(account()!==owner)return;
    savedId=row.id;dirty=version!==revision;$('wtDraftStatus').textContent=dirty?'Unsaved':'Saved';status(dirty?'Earlier changes saved. Save again to include your latest edits.':'Saved to your account. Your journey is private.');
  }catch(e){status(e.message);}finally{busy=false;$('wtSave').disabled=false;}
};
let listRequest=0;
$('wtSaved').onclick=async()=>{
  if(busy)return;if(!account()){signIn();return;}dialog.showModal();const n=++listRequest,owner=account();$('wtSavedList').replaceChildren();$('wtSavedMessage').textContent='Loading your journeys…';
  try{const rows=await store().list();if(n!==listRequest||account()!==owner)return;$('wtSavedMessage').textContent=rows.length?'Your 50 most recent drafts.':'Your next adventure starts here.';
    rows.forEach(row=>{let plan;try{plan=normalizeJourney(row.plan);}catch{return;}const item=document.createElement('div');item.className='wt-saved-row';const open=document.createElement('button'),del=document.createElement('button');open.type=del.type='button';open.textContent=journeyTitle(plan);del.textContent='Delete';del.setAttribute('aria-label',`Delete ${journeyTitle(plan)}`);
      open.onclick=()=>{if(dirty&&!window.confirm('Open this journey and discard your unsaved changes?'))return;draft=plan;savedId=row.id;dirty=false;revision++;syncInputs();$('wtDraftStatus').textContent='Saved';dialog.close();status();renderGlobe(true);};
      del.onclick=async()=>{if(!window.confirm('Delete this saved journey?'))return;del.disabled=true;try{await store().remove(row.id);if(account()!==owner)return;item.remove();if(savedId===row.id){savedId=null;changed();}if(!$('wtSavedList').children.length)$('wtSavedMessage').textContent='No saved journeys.';}catch(e){$('wtSavedMessage').textContent=e.message;del.disabled=false;}};
      item.append(open,del);$('wtSavedList').append(item);
    });
  }catch(e){if(n===listRequest)$('wtSavedMessage').textContent=e.message;}
};
dialog.addEventListener('close',()=>{listRequest++;$('wtSavedList').replaceChildren();});
$('wtNew').onclick=()=>{if(dirty&&!window.confirm('Start a new journey and discard your unsaved changes?'))return;draft=normalizeJourney();savedId=null;dirty=false;revision++;syncInputs();$('wtDraftStatus').textContent='Draft';dialog.close();status();};
let lastOwner=account();
function sessionChanged(){const owner=account();$('wtSaveHint').textContent=owner?'Your saved journeys are private.':'Sign in to save. Explore freely.';if(lastOwner&&owner!==lastOwner){savedId=null;draft=normalizeJourney();dirty=false;revision++;syncInputs();dialog.close();$('wtDraftStatus').textContent='Draft';status();}lastOwner=owner;}
window.addEventListener('storage',sessionChanged);window.addEventListener('mcc:auth',sessionChanged);
new MutationObserver(sessionChanged).observe(root,{attributes:true,attributeFilter:['class']});
window.addEventListener('beforeunload',e=>{if(dirty&&draft.from&&draft.to){e.preventDefault();e.returnValue='';}});
syncInputs();sessionChanged();
const query=new URLSearchParams(location.search);setMode(query.has('mission')?'missions':query.has('song')?'posts':'travel');
send({type:'hu:hello'});
