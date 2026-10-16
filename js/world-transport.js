/* Keyless directions handoff. No location lookup, storage, analytics payload,
   fare estimate or ride request. A region pin is never an exact venue. */
(function(root){'use strict';
const MODES=Object.freeze({driving:'Drive',transit:'Transit',walking:'Walk',bicycling:'Cycle'});
function directions({destination,origin='',mode='driving'}={}){
  const to=String(destination||'').trim(),from=String(origin||'').trim();
  if(!to||to.length>300||from.length>300||!Object.hasOwn(MODES,mode))return null;
  const url=new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api','1');url.searchParams.set('destination',to);
  if(from)url.searchParams.set('origin',from);
  url.searchParams.set('travelmode',mode);return url.href;
}
function aircraft(row){
  const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
  if(!Array.isArray(row))return null;
  const lon=number(row[2]),lat=number(row[3]);
  if(lon===null||lat===null||Math.abs(lon)>180||Math.abs(lat)>90)return null;
  return {id:String(row[0]||'').slice(0,24),callsign:String(row[1]||'').trim().slice(0,32),lon,lat,
    altitude:number(row[4]),speed:number(row[5]),heading:number(row[6])};
}
function mount(container,{region=''}={}){
  const section=document.createElement('section');section.className='world-transport';
  section.innerHTML='<h3>Plan your journey</h3><p>Choose an address or place. Directions open in Google Maps.</p>'+
    '<label for="transportTo">Destination</label><input id="transportTo" maxlength="300" placeholder="Address or place name" autocomplete="off">'+
    '<p class="transport-region" hidden>From the selected mission’s region. Confirm the actual venue before travelling.</p>'+
    '<label for="transportFrom">Starting point <span>(optional)</span></label><input id="transportFrom" maxlength="300" placeholder="Choose in Maps, or enter a place" autocomplete="off">'+
    '<fieldset><legend>Travel by</legend><div class="transport-modes">'+Object.entries(MODES).map(([key,label])=>'<button type="button" data-mode="'+key+'" aria-pressed="'+(key==='driving')+'">'+label+'</button>').join('')+'</div></fieldset>'+
    '<a class="cctv-act transport-go" target="_blank" rel="noopener noreferrer" aria-disabled="true">Enter a destination</a>'+
    '<p class="cctv-note">Your route is sent to Google Maps only when you open directions. Availability and travel times are shown there.</p>';
  container.prepend(section);
  const to=section.querySelector('#transportTo'),from=section.querySelector('#transportFrom'),go=section.querySelector('.transport-go');let mode='driving';
  to.value=String(region||'').slice(0,300);section.querySelector('.transport-region').hidden=!to.value;
  function update(){const href=directions({destination:to.value,origin:from.value,mode});go.textContent=href?'Open directions ↗':'Enter a destination';go.setAttribute('aria-disabled',String(!href));if(href)go.href=href;else go.removeAttribute('href');}
  to.addEventListener('input',()=>{section.querySelector('.transport-region').hidden=true;update()});from.addEventListener('input',update);
  section.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;section.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));update()}));
  go.addEventListener('click',e=>{if(!go.hasAttribute('href')){e.preventDefault();to.focus()}});update();return section;
}
root.HuTransport=Object.freeze({directions,aircraft,mount});
})(typeof window==='undefined'?globalThis:window);
