import {project,cleanDraft} from './portfolio-progression-model.mjs';
const $=id=>document.getElementById(id);
const API='https://api.mccluster.org/v1/portfolio-progression';
const edit=new URLSearchParams(location.search).has('edit');
let catalog,roles,draft,evidence=[],revision=0,review=null,dirty=false,authEpoch=0;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const say=message=>{$('notice').textContent=message;};
function token(){try{return JSON.parse(localStorage.getItem('mccdb_session')||'null')?.access_token||'';}catch{return '';}}
async function api(path='',body){
 const epoch=authEpoch;const headers={};if(edit)headers.authorization=`Bearer ${token()}`;if(body)headers['content-type']='application/json';
 const res=await fetch(API+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const data=await res.json();if(epoch!==authEpoch)throw new Error('Account changed. Reload to verify access.');if(!res.ok){if(edit&&[401,403].includes(res.status))conceal();throw new Error(data.error||'Request failed');}return data;
}
function draw(s){
 $('sheet').innerHTML=`<p class="eyebrow">${review?'PUBLIC PREVIEW':edit?'PRIVATE DRAFT':'PUBLIC CHARACTER SHEET'}</p><h2>${esc(s.name)} <span class="badge">LEVEL ${s.level}</span></h2><p>${s.goals.map(esc).join(' · ')}</p><div class="metrics"><div class="metric"><strong>${s.xp}</strong><span>project + exam XP</span></div><div class="metric"><strong>${s.courses.length} / 8</strong><span>prep slots shown</span></div><div class="metric"><strong>${s.experience.length?s.years:'—'}</strong><span>documented-date years · self-reported</span></div></div><p>${s.next} XP to next level. ${esc(s.rule)}</p><progress max="100" value="${s.xp%100}" aria-label="Progress toward next level"></progress><div class="grid stats">${s.stats.map(x=>`<div class="card"><span class="badge">${x.xp} XP</span><h3>${esc(x.label)}</h3></div>`).join('')}</div><h2>Class → project → evidence</h2><p>Eight Modern States prep courses planned; no earned credits recorded. Project briefs below are proposals, not completed work. The remaining four subjects are unconfirmed.</p><div class="grid">${s.courses.map(c=>`<article class="card" id="project-${esc(c.id)}"><span class="badge">${esc(c.status.replaceAll('_',' '))}</span><h3>${esc(c.title)}</h3><a href="#brief-${esc(c.id)}">${esc(c.project)}</a><p id="brief-${esc(c.id)}">${esc(c.brief)}</p><p>Exam: ${c.exam==='verified'?'Reviewer-verified record':'Not recorded'} · Credit acceptance: unknown</p><a href="${esc(c.related)}">Related existing work ↗</a></article>`).join('')||'<p>No course summaries selected for publication.</p>'}</div>${s.experience.length?'<h2>Experience intervals</h2>'+s.experience.map(e=>`<p>${esc(e.title)} · ${esc(e.start)} → ${esc(e.end)} · self-reported</p>`).join(''):''}`;
}
function invalidate(){dirty=true;review=null;$('publish-controls').hidden=true;$('confirm').checked=false;$('publish').disabled=true;}
function renderEditor(){
 $('editor').innerHTML='<h2>Eight prep quests</h2><div class="grid">'+draft.courses.map(c=>{const def=catalog.courses.find(x=>x.id===c.id);return `<div class="card"><h3>${esc(def.title)}</h3><p>${esc(def.project)}</p><label>Project progress<select data-status="${c.id}"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="self_reported">Completed · self-reported</option></select></label><label><input type="checkbox" data-visible="${c.id}" ${c.visible?'checked':''}> Include summary in public preview</label></div>`;}).join('')+'</div>';
 for(const el of document.querySelectorAll('[data-status]')){el.value=draft.courses.find(c=>c.id===el.dataset.status).status;el.onchange=()=>{draft.courses.find(c=>c.id===el.dataset.status).status=el.value;invalidate();draw(project(draft,catalog,roles,evidence));};}
 for(const el of document.querySelectorAll('[data-visible]'))el.onchange=()=>{draft.courses.find(c=>c.id===el.dataset.visible).visible=el.checked;invalidate();};
 $('intervals').innerHTML=draft.experience.map((e,i)=>`<div class="card"><p>${esc(roles.roles.find(r=>r.slug===e.role).title)} · ${esc(e.start)} → ${esc(e.end)}</p><label><input type="checkbox" data-interval="${i}" ${e.visible?'checked':''}> Include in public preview</label><button data-remove="${i}">Remove interval</button></div>`).join('');
 for(const el of document.querySelectorAll('[data-interval]'))el.onchange=()=>{draft.experience[Number(el.dataset.interval)].visible=el.checked;invalidate();};
 for(const el of document.querySelectorAll('[data-remove]'))el.onclick=()=>{draft.experience.splice(Number(el.dataset.remove),1);invalidate();renderEditor();draw(project(draft,catalog,roles,evidence));};
}
async function load(){const data=await api();draft=data.draft;evidence=data.credentials||[];revision=data.revision;dirty=false;review=null;$('controls').hidden=false;$('publish-controls').hidden=true;renderEditor();draw(project(draft,catalog,roles,evidence));say(`Private draft · revision ${revision}. ${data.published_at?'A separate snapshot is published.':'Nothing published.'}`);}
async function action(fn){for(const b of document.querySelectorAll('button,input,select'))b.disabled=true;try{await fn();}catch(e){say(e.message);}finally{for(const b of document.querySelectorAll('button,input,select'))b.disabled=false;$('publish').disabled=!review||!$('confirm').checked;}}
$('save').onclick=()=>action(async()=>{const result=await api('',{revision,draft});revision=result.revision;dirty=false;review=null;$('publish-controls').hidden=true;say('Private draft saved. Public snapshot unchanged.');});
$('reload').onclick=()=>action(load);
$('preview').onclick=()=>action(async()=>{if(dirty)throw new Error('Save your changes before previewing.');review=await api('/preview',{revision});$('controls').hidden=true;$('publish-controls').hidden=false;$('confirm').checked=false;draw(review.snapshot);say('Public preview only. Nothing has been published by this action.');});
$('confirm').onchange=()=>{$('publish').disabled=!review||!$('confirm').checked;};
$('publish').onclick=()=>action(async()=>{if(!review||!$('confirm').checked)return;const result=await api('/publish',{revision,digest:review.digest,confirm:'PUBLISH'});revision=result.revision;review=null;$('publish-controls').hidden=true;$('controls').hidden=false;say('Reviewed snapshot published. New draft changes remain private.');draw(project(draft,catalog,roles,evidence));});
$('back').onclick=()=>{review=null;$('controls').hidden=false;$('publish-controls').hidden=true;draw(project(draft,catalog,roles,evidence));};
$('unpublish').onclick=()=>action(async()=>{const result=await api('/unpublish',{revision});revision=result.revision;say('Snapshot unpublished. Private draft preserved.');});
$('experience-form').onsubmit=e=>{e.preventDefault();try{const next=cleanDraft({...draft,experience:[...draft.experience,{role:$('role').value,start:$('start').value,end:$('end').value,visible:false}]},catalog,roles);draft=next;invalidate();renderEditor();draw(project(draft,catalog,roles,evidence));say('Interval added to unsaved private draft.');}catch(e){say(e.message);}};
function conceal(){authEpoch++;draft=null;evidence=[];review=null;$('controls').hidden=true;$('publish-controls').hidden=true;$('sheet').replaceChildren();say('Account changed. Reload to verify owner access.');}
window.addEventListener('storage',e=>{if(edit&&(e.key==='mccdb_session'||e.key===null))conceal();});window.addEventListener('mcc:auth-changed',()=>{if(edit)conceal();});
window.addEventListener('pageshow',e=>{if(edit&&e.persisted)conceal();});
try{
 [catalog,roles]=await Promise.all(['data/portfolio-progression.json','data/roles.json'].map(async p=>{const r=await fetch(p);if(!r.ok)throw new Error('Source files unavailable');return r.json();}));
 $('role').innerHTML=roles.roles.map(r=>`<option value="${esc(r.slug)}">${esc(r.title)} · ${esc(r.org)}</option>`).join('');
 $('career').innerHTML=roles.roles.map(r=>`<article class="card"><span class="badge">${esc(r.dates)}</span><h3>${esc(r.title)}</h3><p>${esc(r.org)}</p><a href="role.html?role=${encodeURIComponent(r.slug)}">Read résumé evidence ↗</a></article>`).join('');
 if(edit){await load();}else{const data=await api('/public');if(data.snapshot){draw(data.snapshot);say(`Published snapshot · ${data.published_at}. Updates require owner review.`);}else{say('No character sheet has been published yet. Explore the existing portfolio and résumé above.');}}
}catch(e){say(edit?`Owner workspace unavailable: ${e.message}. Sign in through M Account, then reload. No draft was changed.`:'Character sheet unavailable. Existing portfolio and résumé links remain available.');}
