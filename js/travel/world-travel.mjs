import { normalizeJourney, journeyTitle, itinerary, legAction, searchCities, asPlace } from './journey-core.mjs';
import { directionsLink } from './navigation-core.mjs';
import { createAddressSearch, currentPosition } from './address-search.mjs';
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
const freshDraft = () => normalizeJourney({ mode:'drive' });
let draft = freshDraft(), savedId = null, dirty = false, busy = false, revision = 0;
let catalogPromise, cities = [], currentMode = 'travel';
const send = data => frame?.contentWindow?.postMessage(data, location.origin);
const status = (message = '') => { $('wtMessage').textContent = message; };
const addressSearch = createAddressSearch();
let addressController;
const labels = { flight:'Flights', train:'Trains', drive:'Rides', stay:'Stays', transit:'Transit', walk:'Walking', cycle:'Cycling' };

panel.innerHTML = `
  <header class="wt-planner-head"><h2 id="wtTitle">Your whole journey</h2><span class="wt-status" id="wtDraftStatus">Draft</span></header>
  <form id="wtForm">
    <div class="wt-fields wt-fields--main">
      <label class="wt-field"><span>From</span><button type="button" id="wtLocate" class="wt-locate" aria-label="Use my current location" title="Use my location">◎</button><input id="wtFrom" name="from" autocomplete="off" maxlength="240" placeholder="Current location or address"><span id="wtFromResults" class="wt-suggest" hidden></span></label>
      <label class="wt-field"><span>To</span><input id="wtTo" name="to" autocomplete="off" maxlength="240" placeholder="Address, hotel or place" required><span id="wtToResults" class="wt-suggest" hidden></span></label>
    </div>
    <p id="wtLocationStatus" class="wt-location-status" role="status" aria-live="polite"></p>
    <nav class="wt-toolbar" aria-label="Journey transport">
      ${['drive','transit','walk','flight','train','stay'].map(m => `<button type="button" data-travel-kind="${m}" ${m !== 'stay' ? `aria-pressed="${m === 'drive'}"` : ''}>${icon(m)}${labels[m]}</button>`).join('')}
      <button type="button" id="wtMore" aria-expanded="false" aria-controls="wtMoreModes">••• More</button>
    </nav>
    <nav id="wtMoreModes" class="wt-toolbar" aria-label="More transport" hidden>${['cycle'].map(m => `<button type="button" data-travel-kind="${m}" aria-pressed="false">${icon(m)}${labels[m]}</button>`).join('')}</nav>
    <div class="wt-directions" id="wtDirections"><a id="wtNavigate" class="wt-primary" target="_blank" rel="noopener noreferrer" aria-disabled="true">Choose a destination →</a><small id="wtDirectionsHint">Turn-by-turn directions open in Google Maps.</small></div>
    <details id="wtOptions" class="wt-options"><summary>Trip details <span>Dates, travelers &amp; stays</span></summary><div class="wt-fields">      <label class="wt-field"><span>Departure</span><input id="wtDeparture" name="departure" type="date"></label>
      <label class="wt-field"><span>Travelers</span><select id="wtTravelers" name="travelers">${Array.from({ length:16 }, (_,i) => `<option value="${i+1}">${i+1} ${i ? 'travelers':'traveler'}</option>`).join('')}</select></label>
    </div>
    <div class="wt-date-row"><button type="button" id="wtSwap" aria-label="Swap origin and destination">Swap places ⇄</button><button type="button" id="wtAddReturn" aria-expanded="false">Add return date</button><label class="wt-field wt-return" id="wtReturnField" hidden><span>Return</span><input id="wtReturning" type="date" name="returning"></label></div>
    </details>
    <div id="wtItinerary"></div>
    <details class="wt-details" id="wtDetails"><summary>Airports, stations &amp; final address</summary><div class="wt-fields">
      <label class="wt-field"><span>Departure airport or station</span><input id="wtDepartureHub" name="departureHub" maxlength="240" placeholder="Choose your departure point"></label>
      <label class="wt-field"><span>Arrival airport or station</span><input id="wtArrivalHub" name="arrivalHub" maxlength="240" placeholder="Choose your arrival point"></label>
      <label class="wt-field"><span>Your stay or final address</span><input id="wtStay" name="stay" maxlength="240" placeholder="Hotel, address or place name"></label>
    </div></details>
    <div class="wt-actions"><button class="wt-primary" id="wtPlan" type="submit">Plan journey <span aria-hidden="true">→</span></button><button id="wtSave" type="button">Save journey</button></div>
  </form>
  <div class="wt-footer"><p id="wtSaveHint">Sign in to save. Explore freely.</p><button class="wt-text-button" type="button" id="wtSaved">Saved journeys</button></div>
  <p class="wt-attribution">Address search: <a href="https://photon.komoot.io/" target="_blank" rel="noopener noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p><p class="wt-message" id="wtMessage" role="status" aria-live="polite"></p>`;

$('wtOptions').append($('wtDetails'));
const search = document.createElement('form');
search.className = 'wt-search'; search.setAttribute('role','search');search.setAttribute('data-private','');
search.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg><input id="wtSearch" type="search" aria-label="Search destinations" placeholder="Where do you want to go?" maxlength="240" autocomplete="off"><div class="wt-suggest" id="wtSearchResults" hidden></div>';
$('mnWorld').append(search);

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
    lowestCost:draft.lowestCost, freeOptions:draft.freeOptions });
}
function renderGlobe(fly=false) {
  send({type:'hu:travel-mode',on:currentMode==='travel'});
  send({type:'hu:journey',points:[draft.from,draft.to].filter(p=>p?.coordinates).map(p=>({label:p.label.split(',')[0],coordinates:p.coordinates})),fly});
  const dest=$('wtDestination');dest.hidden=currentMode!=='travel'||!draft.to;
  if(draft.to){dest.replaceChildren();const title=document.createElement('strong'),sub=document.createElement('small');title.textContent=draft.to.label.split(',')[0];sub.textContent=draft.to.label.split(',').slice(1).join(',').trim()||'Your destination';dest.append(title,sub);}
}
function renderDirections() {
  const ground = ['drive','walk','cycle','transit'].includes(draft.mode);
  const go = $('wtNavigate'); $('wtDirections').hidden = !ground; $('wtPlan').hidden = ground;
  $('wtOptions').classList.toggle('wt-options--local',ground);
  if (!draft.to) { go.removeAttribute('href');go.setAttribute('aria-disabled','true');go.textContent='Choose a destination →';return; }
  go.href=directionsLink({provider:'google',origin:asPlace(draft.from),destination:asPlace(draft.to),mode:{drive:'driving',walk:'walking',cycle:'cycling',transit:'transit'}[draft.mode]||'driving',navigate:true});
  go.setAttribute('aria-disabled','false');go.textContent='Start directions ↗';
  $('wtDirectionsHint').textContent=draft.from?'Directions from your starting point · opens Google Maps.':'Google Maps will ask for your starting point.';
}
function renderItinerary() {
  renderDirections();
  const legs=itinerary(draft), box=$('wtItinerary');
  if(['drive','walk','cycle','transit'].includes(draft.mode)){box.replaceChildren();return;}
  if(!legs.length){box.innerHTML='<div class="wt-empty"><h3>Where will the world take you?</h3><p>Pick a destination. Bring every part of your trip together, from your front door to your next place to stay.</p><div class="wt-inspiration" aria-label="Explore a destination"><button type="button" data-inspiration="Lisbon">Lisbon ↗</button><button type="button" data-inspiration="Accra">Accra ↗</button><button type="button" data-inspiration="Tokyo">Tokyo ↗</button></div></div>';return;}
  box.innerHTML='<div class="wt-legs">'+legs.map(l=>{
    const a=legAction(draft,l.id), label=a.type==='edit'?'Add details':a.type==='directions'?'Directions ↗':l.kind==='stay'?'Explore stays ↗':`Search ${l.kind==='flight'?'flights':'trains'} ↗`;
    return `<article class="wt-leg"><span class="wt-leg-symbol">${icon(l.kind)}</span><div><strong>${esc(l.title)}</strong><small>${esc(l.subtitle)}</small></div>${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)} for ${esc(l.title)} (opens Google)">${label}</a>`:`<button type="button" data-edit="${a.field}">${label} →</button>`}</article>`;
  }).join('')+'</div><p class="wt-note">A plan, ready to make your own. Searches and directions open Google. Rides and stays are not booked here yet.</p>';
}
function syncInputs() {
  $('wtFrom').value=draft.from?.label||'';$('wtTo').value=draft.to?.label||'';
  for(const [key,id] of [['departure','wtDeparture'],['returning','wtReturning'],['travelers','wtTravelers'],['departureHub','wtDepartureHub'],['arrivalHub','wtArrivalHub'],['stay','wtStay']])$(id).value=draft[key];
  $('wtReturnField').hidden=!draft.returning;$('wtAddReturn').setAttribute('aria-expanded',String(!!draft.returning));
  $('wtReturning').min=draft.departure;
  document.querySelectorAll('[data-travel-kind][aria-pressed]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.travelKind===draft.mode)));
  if(['transit','walk','cycle'].includes(draft.mode)){$('wtMoreModes').hidden=false;$('wtMore').setAttribute('aria-expanded','true');}
  renderItinerary();renderGlobe();
}
function choosePlace(key,row) {
  draft=read();draft[key]=['from','to'].includes(key)?{label:row.label,coordinates:row.coordinates}:row.label;changed();syncInputs();renderGlobe(true);
}
function autocomplete(id, resultId, key) {
  const input=$(id), results=$(resultId);let seq=0,timer;
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',resultId);input.setAttribute('aria-expanded','false');results.setAttribute('role','listbox');
  const close=()=>{seq++;clearTimeout(timer);results.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-busy');};
  input.addEventListener('input',()=>{
    close();addressController?.abort();addressController=new AbortController();const signal=addressController.signal;
    const request=seq,q=input.value.trim();if(q.length<3)return;
    timer=setTimeout(async()=>{
      input.setAttribute('aria-busy','true');
      try{
        let matches, fallback=false;
        try{matches=await addressSearch(q,signal);}catch(e){if(signal.aborted)return;matches=searchCities(await catalog(),q);fallback=true;}
        if(request!==seq||input.value.trim()!==q||currentMode!=='travel'||signal.aborted)return;
        results.replaceChildren();
        for(const row of matches){const b=document.createElement('button');b.type='button';b.setAttribute('role','option');b.textContent=row.label;b.onclick=()=>{try{choosePlace(key,row);if(id==='wtSearch')input.value=row.label;close();input.focus();}catch(e){status(e.message);}};results.append(b);}
        if(fallback||!matches.length){const note=document.createElement('small');note.className='wt-search-note';note.textContent=fallback?'Address search is unavailable. City matches are shown; you can also enter a full address.':'No matching address yet. Add the city or postal code, or use your typed address for directions.';results.append(note);}
        results.hidden=false;input.setAttribute('aria-expanded','true');
      }catch(e){if(request===seq&&!signal.aborted)status('Address suggestions are unavailable. Enter a complete address for directions.');}
      finally{if(request===seq)input.removeAttribute('aria-busy');}
    },650);
  });
  input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&!results.hidden){e.preventDefault();results.querySelector('button')?.focus();}if(e.key==='Escape'){e.preventDefault();close();}});
  results.addEventListener('keydown',e=>{const buttons=[...results.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Escape'].includes(e.key)){e.preventDefault();if(e.key==='Escape'){close();input.focus();}else buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}});
  document.addEventListener('pointerdown',e=>{if(!results.contains(e.target)&&e.target!==input)close();});
  input.addEventListener('focusout',e=>{if(e.relatedTarget&&!results.contains(e.relatedTarget))close();});
  results.addEventListener('focusout',e=>{if(e.relatedTarget!==input&&!results.contains(e.relatedTarget))close();});
}
for(const [id,key] of [['wtFrom','from'],['wtTo','to'],['wtSearch','to'],['wtDepartureHub','departureHub'],['wtArrivalHub','arrivalHub'],['wtStay','stay']]){
  let results=$(id+'Results');if(!results){results=document.createElement('span');results.id=id+'Results';results.className='wt-suggest';results.hidden=true;$(id).after(results);$(id).autocomplete='off';}
  autocomplete(id,results.id,key);
}
let locating=false, autoLocated=false;
async function locate() {
  if(locating)return;locating=true;autoLocated=true;
  const initial=$('wtFrom').value,initialId=savedId,initialRevision=revision;
  $('wtLocate').disabled=true;$('wtLocationStatus').textContent='Finding your starting point…';
  try{
    const coordinates=await currentPosition();
    if($('wtFrom').value!==initial||savedId!==initialId||revision!==initialRevision){$('wtLocationStatus').textContent='Your entered trip was kept. Tap location to use your current position.';return;}
    choosePlace('from',{label:'Current location',coordinates});
    $('wtLocationStatus').textContent='Starting from your current location.';
  }catch(e){$('wtLocationStatus').textContent=e.message;}
  finally{locating=false;$('wtLocate').disabled=false;}
}
function autoLocate(){
  if(autoLocated||currentMode!=='travel'||!root.classList.contains('mn-world-on')||draft.from||!window.MCC_PRIVACY?.accepted?.())return;
  autoLocated=true;
  try{if(sessionStorage.getItem('wt_location_asked'))return;sessionStorage.setItem('wt_location_asked','1');}catch{}
  void locate();
}
$('wtLocate').onclick=()=>void locate();
$('wtNavigate').onclick=e=>{if(!$('wtNavigate').hasAttribute('href')){e.preventDefault();$('wtTo').focus();}};
new MutationObserver(autoLocate).observe(root,{attributes:true,attributeFilter:['class']});

search.onsubmit=e=>{e.preventDefault();try{const label=$('wtSearch').value.trim();if(label){choosePlace('to',{label,coordinates:draft.to?.label===label?draft.to.coordinates:null});$('wtSearchResults').hidden=true;$('wtFrom').focus();}}catch(err){status(err.message);}};

function setMode(mode) {
  if(!['travel','missions','posts'].includes(mode))return;
  currentMode=mode;root.dataset.worldMode=mode;if(mode!=='travel')root.classList.remove('wt-expanded');
  frame.title=mode==='travel'?'Travel globe. Drag to explore; selected cities and your planned connection appear here.':'Human Uprise globe. Drag to explore; select a mission pin to see its details.';
  root.classList.remove('hu-search-open');$('huSearchToggle').setAttribute('aria-expanded','false');
  document.querySelectorAll('[data-world-mode][aria-pressed]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.worldMode===mode)));
  document.querySelectorAll('.wt-suggest').forEach(el=>el.hidden=true);
  $('mnWorldFeed').scrollTop=0;renderGlobe();autoLocate();
  window.dispatchEvent(new CustomEvent('mcc:world-mode',{detail:{mode}}));
}
window.MCC_WORLD_MODE={set:setMode,get:()=>currentMode};
const modeButtons=[...document.querySelectorAll('.wt-world-modes button')];
modeButtons.forEach(b=>{b.onclick=()=>setMode(b.dataset.worldMode);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();let i=modeButtons.indexOf(b);i=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:-1)+3)%3;modeButtons[i].click();modeButtons[i].focus();}};});
let touchStart=null;
$('mnWorldFeed').addEventListener('touchstart',e=>{touchStart=e.touches.length!==1||e.target.closest('input,select,button,a,summary,.wt-toolbar,[data-mission-deck]')?null:{x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
$('mnWorldFeed').addEventListener('touchend',e=>{if(!touchStart)return;const dx=e.changedTouches[0].clientX-touchStart.x,dy=e.changedTouches[0].clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>100&&Math.abs(dx)>Math.abs(dy)*2){const modes=['travel','missions','posts'];setMode(modes[(modes.indexOf(currentMode)+(dx<0?1:2))%3]);}},{passive:true});
$('mnWorldFeed').addEventListener('touchcancel',()=>{touchStart=null;},{passive:true});
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==frame.contentWindow)return;
  if(e.data?.type==='hu:globe-ready')renderGlobe();
  if(e.data?.type==='hu:globe-unavailable')status('The interactive globe is unavailable here. You can still search places and plan your journey.');
  if(e.data?.type==='hu:country'&&currentMode==='travel'&&e.data.country?.name){try{draft=read();draft.to={label:String(e.data.country.name).slice(0,240),coordinates:null};changed();syncInputs();status('Country selected. Search for a city or enter your destination to refine the trip.');}catch(err){status(err.message);}}
  if(e.data?.type==='hu:mission-selected'&&currentMode==='travel')setMode('missions');
});

$('wtForm').addEventListener('input',e=>{changed();if(e.target.id==='wtDeparture')$('wtReturning').min=e.target.value;try{draft=read();renderItinerary();renderGlobe();}catch(err){status(err.message);}});
function requireEndpoints(action){
  const missing=!draft.from?'From':!draft.to?'To':null;
  if(!missing)return true;
  status(`Add ${missing==='From'?'a starting point':'a destination'} before ${action}.`);$('wt'+missing).focus();return false;
}
$('wtForm').onsubmit=e=>{e.preventDefault();try{draft=read();if(!requireEndpoints('planning this journey'))return;renderItinerary();renderGlobe(true);status('Your draft is ready. Add the airport, station or stay details as you choose them.');$('wtItinerary').scrollIntoView({block:'nearest',behavior:'auto'});}catch(err){status(err.message);}};
$('wtSwap').onclick=()=>{try{draft=read();[draft.from,draft.to]=[draft.to,draft.from];[draft.departureHub,draft.arrivalHub]=[draft.arrivalHub,draft.departureHub];draft.stay='';changed();syncInputs();renderGlobe(true);}catch(e){status(e.message);}};
$('wtAddReturn').onclick=()=>{const show=$('wtReturnField').hidden;$('wtReturnField').hidden=!show;$('wtAddReturn').textContent=show?'Remove return':'Add return date';$('wtAddReturn').setAttribute('aria-expanded',String(show));if(show)$('wtReturning').focus();else{$('wtReturning').value='';draft.returning='';changed();renderItinerary();}};
$('wtMore').onclick=()=>{const show=$('wtMoreModes').hidden;$('wtMoreModes').hidden=!show;$('wtMore').setAttribute('aria-expanded',String(show));};
function editField(key){const ids={from:'wtFrom',departureHub:'wtDepartureHub',arrivalHub:'wtArrivalHub',stay:'wtStay'};if(key!=='from'){$('wtOptions').open=true;$('wtDetails').open=true;}$(ids[key]||'wtFrom').focus();}
panel.addEventListener('click',async e=>{
  const mode=e.target.closest('[data-travel-kind]'),edit=e.target.closest('[data-edit]'),inspiration=e.target.closest('[data-inspiration]');
  try{
    if(mode){if(mode.dataset.travelKind==='stay'){editField('stay');return;}draft=read();draft.mode=mode.dataset.travelKind;$('wtOptions').open=['flight','train'].includes(draft.mode);changed();syncInputs();}
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
  try{draft=read();if(!requireEndpoints('saving your journey')||!$('wtForm').reportValidity())return;
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
$('wtNew').onclick=()=>{if(dirty&&!window.confirm('Start a new journey and discard your unsaved changes?'))return;draft=freshDraft();savedId=null;dirty=false;revision++;syncInputs();$('wtDraftStatus').textContent='Draft';dialog.close();status();};
let lastOwner=account();
function sessionChanged(){const owner=account();$('wtSaveHint').textContent=owner?'Your saved journeys are private.':'Sign in to save. Explore freely.';if(lastOwner&&owner!==lastOwner){savedId=null;draft=freshDraft();dirty=false;revision++;syncInputs();dialog.close();$('wtDraftStatus').textContent='Draft';status();}lastOwner=owner;}
window.addEventListener('storage',sessionChanged);window.addEventListener('mcc:auth',sessionChanged);
new MutationObserver(sessionChanged).observe(root,{attributes:true,attributeFilter:['class']});
window.addEventListener('beforeunload',e=>{if(dirty&&draft.from&&draft.to){e.preventDefault();e.returnValue='';}});
syncInputs();sessionChanged();
const query=new URLSearchParams(location.search),requestedMode=query.get('mode');
setMode(query.has('mission')||query.has('completed')?'missions':query.has('song')?'posts':['travel','missions','posts'].includes(requestedMode)?requestedMode:'travel');
send({type:'hu:hello'});

autoLocate();
