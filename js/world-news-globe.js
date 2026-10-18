(function(){'use strict';
const API='https://api.mccluster.org/v1/world/news',frame=document.getElementById('mnWorldFrame'),deck=document.getElementById('worldNewsDeck');
if(!frame||!deck)return;
const host=document.getElementById('worldNewsEntries'),more=document.getElementById('worldNewsMore'),status=document.getElementById('worldNewsStatus');
let items=[],cursor=null,active=false,loading=false;
const reader=document.createElement('dialog');
reader.id='worldNewsReader';
reader.className='world-news-reader';
reader.setAttribute('aria-labelledby','worldNewsReaderTitle');
const readerTitle=document.createElement('h3');readerTitle.id='worldNewsReaderTitle';
const readerMeta=document.createElement('p');readerMeta.className='world-news-meta';
const readerNotice=document.createElement('p');
readerNotice.textContent='This is a news discovery record, not the full publisher article. In-app full text is unavailable until it can be provided with permission.';
const readerClose=document.createElement('button');readerClose.type='button';readerClose.textContent='Close';
readerClose.onclick=()=>reader.close();
reader.append(readerTitle,readerMeta,readerNotice,readerClose);
deck.appendChild(reader);
let priorFocus=null;
reader.addEventListener('close',()=>{priorFocus?.focus?.();priorFocus=null;});
function openStory(x,opener){
 priorFocus=opener;
 readerTitle.textContent=x.title;
 readerMeta.textContent=x.domain+(x.place?' · Mentioned place: '+x.place:'')+(x.seen_at?' · '+new Date(x.seen_at).toLocaleString():'');
 reader.showModal();
}
const geo=x=>x&&Number.isFinite(x.lat)&&Number.isFinite(x.lon)&&Math.abs(x.lat)<=90&&Math.abs(x.lon)<=180&&!(x.lat===0&&x.lon===0);
const valid=x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&typeof x.domain==='string'&&typeof x.url==='string'&&/^https?:\/\//.test(x.url);
function send(data){frame.contentWindow?.postMessage(data,location.origin)}
function pins(){return items.filter(geo).slice(-120).map(x=>({id:x.id,lat:x.lat,lon:x.lon}))}
function sync(){send({type:'hu:world-news-pins',on:active,items:active?pins():[]})}
function locate(x){if(!geo(x))return;send({type:'hu:focus-place',lat:x.lat,lon:x.lon,label:String(x.place||'News mentions this location').slice(0,120)});const n=[...host.querySelectorAll('[data-news-id]')].find(n=>n.dataset.newsId===x.id);n?.scrollIntoView({block:'nearest'})}
function render(){
 const f=document.createDocumentFragment();
 items.forEach(x=>{const card=document.createElement('article');card.className='world-news-entry';card.dataset.newsId=x.id;
 const meta=document.createElement('p');meta.textContent=x.domain+(x.place?' · '+x.place:'')+(x.seen_at?' · '+new Date(x.seen_at).toLocaleString():'');meta.className='world-news-meta';
 const title=document.createElement('button');title.type='button';title.className='world-news-title';title.textContent=x.title;title.onclick=()=>openStory(x,title);card.append(meta,title);
 if(geo(x)){const b=document.createElement('button');b.type='button';b.textContent='Show on globe';b.onclick=()=>locate(x);card.append(b)}f.append(card)});
 host.replaceChildren(f);more.hidden=!cursor;sync()
}
async function load(reset){
 if(loading)return;loading=true;more.disabled=true;status.textContent='Loading news…';
 try{const url=API+'?limit=50'+(!reset&&cursor?'&before='+encodeURIComponent(cursor):'');
 const response=await fetch(url,{credentials:'omit'});if(!response.ok)throw Error('Unavailable');
 const data=await response.json();if(!Array.isArray(data?.items))throw Error('Invalid');
 const seen=new Set(reset?[]:items.map(x=>x.id)),rows=data.items.filter(valid).filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true});
 items=reset?rows:items.concat(rows);cursor=typeof data.next_before==='string'?data.next_before:null;
 status.textContent=items.length?items.length+' news stories loaded. Places are article mentions.':'No news currently available.';render();
 }catch(_){status.textContent='News is temporarily unavailable.'}finally{loading=false;more.disabled=false}
}
more.onclick=()=>load(false);
window.addEventListener('mcc:world-mode',e=>{active=e.detail?.mode==='posts';deck.hidden=!active;if(active&&!items.length)void load(true);else sync()});
window.addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin)return;const d=e.data||{};if(d.type==='hu:globe-ready')sync();if(d.type==='hu:world-news-selected'&&active){const x=items.find(x=>x.id===d.id);if(x)locate(x)}});
if(window.MCC_WORLD_MODE?.get?.()==='posts'){active=true;deck.hidden=false;void load(true)}
})();