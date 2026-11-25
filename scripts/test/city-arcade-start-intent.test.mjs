// Regression for audit finding W3, client half: the owner-bound start key is stored BEFORE the start
// request leaves the device, reused when the response is lost, and cleared after success or a 409.
// Synthetic DOM, no network. The fake-Worker cases always run. The database cases run the real Worker
// handler on the applied migration in PGlite; they run whenever PGLITE_MODULE is set (the City Arcade
// workflow sets it) and are skipped, not passed, when no PGlite is installed.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// The database starts before the DOM globals below exist: PGlite's loader treats a global window as a browser.
let pgliteMissing=false,database=null;
if(!process.env.PGLITE_MODULE){try{await import('@electric-sql/pglite');}catch{pgliteMissing='PGlite not installed: set PGLITE_MODULE to run the database cases';}}
if(!pgliteMissing){const {createArcadeDatabase}=await import('./support/arcade-database.mjs');database=await createArcadeDatabase();after(()=>database.close());}
class Element extends EventTarget {
 constructor(){super();this.nodes=new Map();this.dataset={};this.value='';this.disabled=false;this.hidden=false;this.textContent='';this.classList={add(){},remove(){}};}
 // Initial hidden/disabled state comes from the views' markup, as in a browser.
 set innerHTML(html){
  this.nodes=new Map();
  for(const [,attrs] of String(html).matchAll(/<\w+([^>]*)>/g))for(const [,name] of attrs.matchAll(/\sdata-([\w-]+)/g)){
   const selector='[data-'+name+']';if(this.nodes.has(selector))continue;
   const el=new Element();el.hidden=/\shidden(?=[\s=]|$)/.test(attrs);el.disabled=/\sdisabled(?=[\s=]|$)/.test(attrs);this.nodes.set(selector,el);
  }
 }
 querySelector(s){if(!this.nodes.has(s))this.nodes.set(s,new Element());return this.nodes.get(s);}
 querySelectorAll(){return [];}
 append(){} remove(){} getContext(){return null;} focus(){} scrollIntoView(){} setPointerCapture(){} replaceChildren(){} closest(){return null;}
 click(){this.dispatchEvent(new Event('click'));if(this.onclick)this.onclick();}
}
globalThis.document={hidden:false,querySelector(){return null;},createElement(){return new Element();},addEventListener(){},removeEventListener(){}};
globalThis.window=new EventTarget();window.location={origin:'https://local.fixture.invalid'};window.confirm=()=>false;
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
const store=new Map();globalThis.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),key:i=>[...store.keys()][i],get length(){return store.size;}};
const {SOLE_MISSION}=await import('../../js/city-arcade/sole-config.mjs');
const {TEA_MISSION}=await import('../../js/city-arcade/tea-action.mjs');
const {mountTea}=await import('../../js/city-arcade/tea-view.mjs');
const {mountSoleStreet}=await import('../../js/city-arcade/sole-street-view.mjs');
const {claimStartIntent,readStartIntent,clearStartIntent,startIntentKey,START_INTENT_PREFIX}=await import('../../js/city-arcade/result-outbox.mjs');
const {OWNER}=await import('./support/arcade-database.mjs');
const d=JSON.parse(await readFile(new URL('../../core/data/fictional-city/district.v1.json',import.meta.url),'utf8')),neighborhood=d.neighborhoods.find(n=>n.id==='bridgeport-robbery-1s'),point=[51.1422,-253.0175];
const id='bridgeport-main-elm',SCOPE='owner-a';
// The device talks to `server` (a Request → Response function). Every start is recorded with the key it
// carries and the key stored on the device at the moment of sending. `loseNextStart` drops the next
// start response after the server has handled (and, for the database, committed) it.
let server=null,loseNextStart=false;const sends=[];
globalThis.fetch=async(url,init={})=>{
 const u=new URL(url),method=init.method||'GET',path=u.pathname.replace(/^\/v1\/arcade/,'');
 if(path.startsWith('/start/')){const cloud=path.slice('/start/'.length);sends.push({cloud,startKey:JSON.parse(init.body).startKey,storedAtSend:readStartIntent(SCOPE,cloud)?.startKey??null});}
 const response=await server(new Request(u.href,{method,headers:{'content-type':'application/json',authorization:'Bearer local-owner'},...(init.body?{body:init.body}:{})}));
 if(path.startsWith('/start/')&&loseNextStart){loseNextStart=false;throw new TypeError('Failed to fetch');}
 return response;
};
async function until(check,label,ms=10000){const end=Date.now()+ms;for(;;){if(await check())return;if(Date.now()>end)assert.fail('timed out waiting for '+label);await new Promise(r=>setTimeout(r,5));}}
const cloudId=kind=>kind==='sole'?'sole-'+id:id;
const missionDocument=kind=>kind==='sole'?{version:1,gameId:'designer-kicks-sole-run',locationId:id,sole:structuredClone(SOLE_MISSION)}:{version:1,gameId:'gauranfucking-tea-tea-rush',locationId:id,tea:structuredClone(TEA_MISSION)};
const mount=(kind,root)=>kind==='sole'?mountSoleStreet(root,()=>{},{locationId:id,point,neighborhood,onReturn(){}}):mountTea(root,()=>{},{locationId:id,onReturn(){}});
const sel=kind=>kind==='sole'?{status:'[data-sole-cloud-status]',load:'[data-sole-load]',play:'[data-sole-cloud-play]'}:{status:'[data-cloud-status]',load:'[data-cloud-load]',play:'[data-cloud-play]'};
function fresh(){store.clear();sends.length=0;loseNextStart=false;localStorage.setItem('mccdb_session',JSON.stringify({access_token:'synthetic-owner',user:{id:SCOPE}}));}
// Mount, wait for the cloud, Load revision `revision`, then press Play. Resolves with the view.
async function loadAndPlay(kind,revision){
 const root=new Element(),dispose=mount(kind,root),s=sel(kind),text=()=>root.querySelector(s.status).textContent;
 await until(()=>/^Cloud missions available/.test(text()),'cloud available');
 root.querySelector(s.load).click();await until(()=>text().startsWith('Loaded private revision '+revision),'mission loaded');
 assert.equal(root.querySelector(s.play).disabled,false,'play is enabled once loaded');
 const before=sends.length;root.querySelector(s.play).click();await until(()=>sends.length>before&&!text().startsWith('Loaded'),'start answered');
 return {root,dispose,text};
}
// A minimal Worker double: idempotent by start key, like the applied SQL. `conflicts` answers that many starts with 409.
function fakeWorker(kind,{conflicts=0}={}){
 const runs=new Map();
 return async request=>{
  const path=new URL(request.url).pathname.replace(/^\/v1\/arcade/,'');
  if(path==='/capabilities')return Response.json({ok:true,value:{cloudEnabled:true}});
  if(request.method==='GET'&&path==='/missions/'+cloudId(kind))return Response.json({ok:true,value:{id:cloudId(kind),revision:1,document:missionDocument(kind)}});
  if(request.method==='POST'&&path==='/start/'+cloudId(kind)){
   const {startKey,expectedRevision}=await request.json();
   if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(startKey||''))return Response.json({ok:false,error:'Start key required'},{status:400});
   if(conflicts>0){conflicts--;return Response.json({ok:false,error:'Mission or result changed. Reload before retrying.'},{status:409});}
   if(!runs.has(startKey))runs.set(startKey,crypto.randomUUID());
   return Response.json({ok:true,value:{id:runs.get(startKey),revision:expectedRevision,status:'running',document:missionDocument(kind)}},{status:201});
  }
  return Response.json({ok:false,error:'Arcade service unavailable.'},{status:503});
 };
}

test('claimStartIntent stores the key before any request, reuses it for the same revision and replaces it for another',()=>{
 fresh();
 const a=claimStartIntent(SCOPE,id,1);
 assert.match(a.startKey,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
 assert.equal(JSON.parse(store.get(START_INTENT_PREFIX+SCOPE+':'+id)).startKey,a.startKey,'stored under the scope and mission');
 assert.equal(claimStartIntent(SCOPE,id,1).startKey,a.startKey,'the same revision reuses the stored key');
 const b=claimStartIntent(SCOPE,id,2);
 assert.notEqual(b.startKey,a.startKey,'a different revision gets a new key');
 assert.equal(readStartIntent(SCOPE,id).startKey,b.startKey,'and replaces the stored one');assert.equal(readStartIntent(SCOPE,id).revision,2);
});
test('start intents are separate per account and mission, cleared one at a time, and a malformed one is replaced',()=>{
 fresh();
 const tea=claimStartIntent(SCOPE,id,1),sole=claimStartIntent(SCOPE,'sole-'+id,1),other=claimStartIntent('owner-b',id,1);
 assert.equal(new Set([tea.startKey,sole.startKey,other.startKey]).size,3);
 clearStartIntent(SCOPE,id);
 assert.equal(readStartIntent(SCOPE,id),null);assert.equal(readStartIntent(SCOPE,'sole-'+id).startKey,sole.startKey);assert.equal(readStartIntent('owner-b',id).startKey,other.startKey);
 store.set(startIntentKey(SCOPE,id),JSON.stringify({startKey:'not-a-uuid',revision:1}));
 assert.equal(readStartIntent(SCOPE,id),null);
 const replaced=claimStartIntent(SCOPE,id,1);assert.equal(readStartIntent(SCOPE,id).startKey,replaced.startKey);
});
for(const kind of ['sole','tea']){
 test(`${kind}: the start key is stored before sending, reused after a lost response, and cleared on success`,async()=>{
  fresh();server=fakeWorker(kind);loseNextStart=true;
  let view=await loadAndPlay(kind,1);
  await until(()=>/Failed to fetch/.test(view.text()),'lost start reported');
  assert.equal(sends.length,1);assert.equal(sends[0].storedAtSend,sends[0].startKey,'the key is on the device before the first send');
  assert.equal(readStartIntent(SCOPE,cloudId(kind))?.startKey,sends[0].startKey,'a lost response keeps the key');
  view.dispose();
  view=await loadAndPlay(kind,1);
  await until(()=>/Playing/.test(view.text()),'retried start playing');
  assert.equal(sends.length,2);assert.equal(sends[1].startKey,sends[0].startKey,'the retry after reload sends the same key');
  assert.equal(sends[1].storedAtSend,sends[1].startKey);
  assert.equal(readStartIntent(SCOPE,cloudId(kind)),null,'success clears the key');
  view.dispose();
 });
 // A cross-origin handoff stores only the tokens; MCC.refresh() later stores the full answer with `user`.
 // Both shapes name the same account, so a start whose response was lost before the refresh is retried
 // after it with the same key: one run, not two (review of 9bda5896, result-outbox.mjs:11).
 test(`${kind}: a handoff session and the refreshed full session keep one start key across a lost response`,async()=>{
  fresh();server=fakeWorker(kind);loseNextStart=true;
  const jwt=sub=>['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub,role:'authenticated'})).toString('base64url'),'synthetic-signature'].join('.');
  localStorage.setItem('mccdb_session',JSON.stringify({access_token:jwt(SCOPE),refresh_token:'synthetic-refresh',expires_at:4102444800}));
  let view=await loadAndPlay(kind,1);
  await until(()=>/Failed to fetch/.test(view.text()),'lost start reported');
  assert.equal(sends[0].storedAtSend,sends[0].startKey,'the handoff session stores the key under the account, before the send');
  view.dispose();
  localStorage.setItem('mccdb_session',JSON.stringify({access_token:jwt(SCOPE),refresh_token:'synthetic-refresh-2',expires_at:4102444800,user:{id:SCOPE}}));
  view=await loadAndPlay(kind,1);
  await until(()=>/Playing/.test(view.text()),'retried start playing');
  assert.equal(sends.length,2);assert.equal(sends[1].startKey,sends[0].startKey,'the retry after the refresh sends the same key');
  assert.equal(readStartIntent(SCOPE,cloudId(kind)),null,'success clears the key');
  view.dispose();
 });
 test(`${kind}: a 409 on start clears the stored key, so the next start sends a new one`,async()=>{
  fresh();server=fakeWorker(kind,{conflicts:1});
  const view=await loadAndPlay(kind,1);
  await until(()=>/mission changed/i.test(view.text()),'conflict reported');
  assert.equal(sends[0].storedAtSend,sends[0].startKey);
  assert.equal(readStartIntent(SCOPE,cloudId(kind)),null,'a 409 clears the key');
  view.root.querySelector(sel(kind).play).click();
  await until(()=>/Playing/.test(view.text()),'second start playing');
  assert.equal(sends.length,2);assert.notEqual(sends[1].startKey,sends[0].startKey,'a fresh key after a conflict');
  assert.equal(sends[1].storedAtSend,sends[1].startKey);assert.equal(readStartIntent(SCOPE,cloudId(kind)),null);
  view.dispose();
 });
}

// Real Worker handler and applied migration in PGlite (started at the top of this file).
const runCount=async mission=>(await database.db.query('select count(*)::int as n from arcade_runs where mission_id=$1',[mission])).rows[0].n;
for(const kind of ['sole','tea']){
 test(`${kind}: a start whose response is lost after the server committed is retried with the same key: one run, key cleared after success and after a 409`,{skip:pgliteMissing},async()=>{
  fresh();server=request=>database.handle(request);const mission=cloudId(kind);
  await database.rpc({p_action:'save',p_actor:OWNER,p_id:mission,p_revision:0,p_document:missionDocument(kind)});
  loseNextStart=true;
  let view=await loadAndPlay(kind,1);
  await until(()=>/Failed to fetch/.test(view.text()),'lost start reported');
  assert.equal(await runCount(mission),1,'the server committed the first start');
  assert.equal(sends[0].storedAtSend,sends[0].startKey,'the key is on the device before the first send');
  assert.equal(readStartIntent(SCOPE,mission)?.startKey,sends[0].startKey,'a lost response keeps the key');
  view.dispose();
  view=await loadAndPlay(kind,1);
  await until(()=>/Playing/.test(view.text()),'retried start playing');
  assert.equal(await runCount(mission),1,'one run for one requested start');
  assert.equal(sends.length,2);assert.equal(sends[1].startKey,sends[0].startKey,'the retry sends the same key');assert.equal(sends[1].storedAtSend,sends[1].startKey);
  assert.equal(readStartIntent(SCOPE,mission),null,'success clears the key');
  // The mission moves to revision 2 elsewhere; this view still holds revision 1, so its next start is a 409.
  await database.rpc({p_action:'save',p_actor:OWNER,p_id:mission,p_revision:1,p_document:missionDocument(kind)});
  view.root.querySelector(sel(kind).play).click();
  await until(()=>/mission changed/i.test(view.text()),'conflict reported');
  assert.equal(sends.length,3);assert.notEqual(sends[2].startKey,sends[0].startKey);assert.equal(sends[2].storedAtSend,sends[2].startKey);
  assert.equal(readStartIntent(SCOPE,mission),null,'a 409 clears the key');
  assert.equal(await runCount(mission),1,'the refused start created nothing');
  view.dispose();
 });
}
