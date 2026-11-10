// Regression for audit finding W2: a finished cloud run whose result the server has not yet
// accepted must survive local restart, apply, load and a new start. Synthetic DOM, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
class Element extends EventTarget {
 constructor(){super();this.nodes=new Map();this.dataset={};this.value='';this.disabled=false;this.hidden=false;this.textContent='';this.classList={add(){},remove(){}};}
 // The views' markup sets each control's initial hidden/disabled state, as a browser would, so a reveal
 // that never runs is caught instead of passing on a default of hidden=false.
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
// Synthetic Worker: capabilities follow `capability`; every other route answers from `routes`
// ('METHOD /path' → Response factory) or 503, and every request is recorded.
let capability=false,routes={};const requests=[];
globalThis.fetch=async(url,init={})=>{
 const method=init.method||'GET',path=new URL(url).pathname.replace(/^\/v1\/arcade/,'');
 requests.push({method,path,body:init.body?JSON.parse(init.body):null});
 if(path==='/capabilities')return Response.json({ok:true,value:{cloudEnabled:capability}});
 const answer=routes[method+' '+path];
 return answer?answer():Response.json({ok:false,error:'Arcade service unavailable.'},{status:503});
};
const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),key:i=>[...store.keys()][i],get length(){return store.size;}};
const flush=()=>new Promise(r=>setTimeout(r,0));
async function until(check,label){for(let i=0;i<400;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('timed out waiting for '+label);}
const {newStreetRun}=await import('../../js/city-arcade/sole-street-engine.mjs');
const {SOLE_MISSION}=await import('../../js/city-arcade/sole-config.mjs');
const {newTeaAction,TEA_MISSION}=await import('../../js/city-arcade/tea-action.mjs');
const {mountTea}=await import('../../js/city-arcade/tea-view.mjs');
const {mountSoleStreet}=await import('../../js/city-arcade/sole-street-view.mjs');
const {readOutbox,outboxKey,enqueueResult,RESULT_OUTBOX_PREFIX}=await import('../../js/city-arcade/result-outbox.mjs');
const d=JSON.parse(await readFile(new URL('../../core/data/fictional-city/district.v1.json',import.meta.url),'utf8')),neighborhood=d.neighborhoods.find(n=>n.id==='bridgeport-robbery-1s'),point=[51.1422,-253.0175];
const id='bridgeport-main-elm',run='11111111-1111-4111-8111-111111111111',session={access_token:'synthetic-owner',user:{id:'owner-a'}};
const nextRun='22222222-2222-4222-8222-222222222222';
function seed(kind){
 store.clear();capability=false;routes={};requests.length=0;localStorage.setItem('mccdb_session',JSON.stringify(session));
 if(kind==='sole'){
  const state=newStreetRun(SOLE_MISSION,neighborhood,point);state.status='failed';state.remaining=0;
  store.set('here.city-arcade.sole-street.session.v1:'+id,JSON.stringify({...state,locationId:id,cloudRun:run,pending:{id:run,body:{status:'failed',served:0,encounters:[]}}}));
 }else{
  const state=newTeaAction();state.status='failed';state.remaining=0;
  store.set('here.city-arcade.tea-action.session.v1:'+id,JSON.stringify({state,cloudRun:run,pendingResult:{id:run,body:{status:'failed',served:0}}}));
 }
}
const mount=(kind,root)=>kind==='sole'?mountSoleStreet(root,()=>{},{locationId:id,point,neighborhood,onReturn(){}}):mountTea(root,()=>{},{locationId:id,onReturn(){}});
const resetButton=kind=>kind==='sole'?'[data-sole-apply]':'[data-again]';
const retryButton=kind=>kind==='sole'?'[data-sole-retry]':'[data-cloud-retry]';
const reconnectButton=kind=>kind==='sole'?'[data-sole-reconnect]':'[data-cloud-reconnect]';
const discardButton=kind=>kind==='sole'?'[data-sole-discard]':'[data-cloud-discard]';
const statusNode=kind=>kind==='sole'?'[data-sole-cloud-status]':'[data-cloud-status]';
const loadButton=kind=>kind==='sole'?'[data-sole-load]':'[data-cloud-load]';
const playButton=kind=>kind==='sole'?'[data-sole-cloud-play]':'[data-cloud-play]';
const cloudId=kind=>kind==='sole'?'sole-'+id:id;
const missionDocument=kind=>kind==='sole'?{version:1,gameId:'designer-kicks-sole-run',locationId:id,sole:structuredClone(SOLE_MISSION)}:{version:1,gameId:'gauranfucking-tea-tea-rush',locationId:id,tea:structuredClone(TEA_MISSION)};
const pendingBody=kind=>kind==='sole'?{status:'failed',served:0,encounters:[]}:{status:'failed',served:0};
for(const kind of ['sole','tea']){
 const status=root=>root.querySelector(statusNode(kind)).textContent;
 test(`${kind}: legacy session with an unacknowledged result is moved into the account outbox on mount`,async()=>{
  seed(kind);const root=new Element();const dispose=mount(kind,root);await flush();
  const entries=readOutbox('owner-a');
  assert.equal(entries.length,1);assert.equal(entries[0].id,run);assert.equal(entries[0].body.status,'failed');
  assert.equal(root.querySelector(retryButton(kind)).hidden,false);
  assert.equal(root.querySelector(discardButton(kind)).hidden,false,'discard is offered while a result waits');
  dispose();
 });
 test(`${kind}: restart/apply does not erase the pending result and keeps retry visible`,async()=>{
  seed(kind);const root=new Element();const dispose=mount(kind,root);await flush();
  root.querySelector(resetButton(kind)).click();await flush();dispose();
  const entries=readOutbox('owner-a');
  assert.equal(entries.length,1,'outbox entry survives local restart');
  assert.deepEqual(entries[0].body,kind==='sole'?{status:'failed',served:0,encounters:[]}:{status:'failed',served:0});
  assert.equal(root.querySelector(retryButton(kind)).hidden,false,'retry stays available after restart');
 });
 test(`${kind}: cloud unavailable exposes an explicit reconnect action instead of a dead retry`,async()=>{
  seed(kind);capability=false;const root=new Element();const dispose=mount(kind,root);await flush();await flush();
  assert.equal(root.querySelector(retryButton(kind)).disabled,true);
  assert.equal(root.querySelector(reconnectButton(kind)).hidden,false,'reconnect is offered while a result waits');
  assert.match(root.querySelector(statusNode(kind)).textContent,/unsaved|not yet saved|Reconnect/i);
  dispose();
 });
 test(`${kind}: discarding an unsaved result requires explicit confirmation and never claims it was saved`,async()=>{
  seed(kind);const root=new Element();const dispose=mount(kind,root);await flush();
  window.confirm=()=>false;root.querySelector(discardButton(kind)).click();await flush();
  assert.equal(readOutbox('owner-a').length,1,'declined confirmation keeps the result');
  window.confirm=message=>{assert.match(message,/not been saved|never saved|was not saved/i);return true;};
  root.querySelector(discardButton(kind)).click();await flush();
  assert.equal(readOutbox('owner-a').length,0);
  assert.doesNotMatch(root.querySelector(statusNode(kind)).textContent,/result saved to your account/i);assert.match(root.querySelector(statusNode(kind)).textContent,/never saved/i);
  dispose();window.confirm=()=>false;
 });
 test(`${kind}: reconnect stays hidden while the cloud is ready and is offered, usable, beside discard when it is not`,async()=>{
  seed(kind);capability=true;let root=new Element(),dispose=mount(kind,root);
  await until(()=>/restored/i.test(status(root)),'cloud ready with a waiting result');
  assert.equal(root.querySelector(reconnectButton(kind)).hidden,true,'no reconnect while the cloud is ready');
  assert.equal(root.querySelector(retryButton(kind)).hidden,false);assert.equal(root.querySelector(retryButton(kind)).disabled,false);
  assert.equal(root.querySelector(discardButton(kind)).hidden,false);
  dispose();
  capability=false;root=new Element();dispose=mount(kind,root);
  await until(()=>/unavailable/i.test(status(root)),'cloud refused');
  assert.equal(root.querySelector(reconnectButton(kind)).hidden,false,'reconnect is revealed');
  assert.equal(root.querySelector(reconnectButton(kind)).disabled,false,'reconnect is usable');
  assert.equal(root.querySelector(discardButton(kind)).hidden,false);assert.equal(root.querySelector(retryButton(kind)).disabled,true);
  dispose();
 });
 test(`${kind}: Reconnect re-checks the cloud and saves the waiting result once access returns`,async()=>{
  seed(kind);capability=false;const root=new Element(),dispose=mount(kind,root);
  await until(()=>/unavailable/i.test(status(root)),'cloud refused');
  capability=true;routes['POST /finish/'+run]=()=>Response.json({ok:true,value:{id:run,status:'failed',served:0,score:0}});
  root.querySelector(reconnectButton(kind)).click();
  await until(()=>/Practice result saved/.test(status(root)),'result saved through reconnect');
  const finishes=requests.filter(r=>r.method==='POST'&&r.path==='/finish/'+run);
  assert.equal(finishes.length,1,'reconnect sends the waiting result once');assert.deepEqual(finishes[0].body,pendingBody(kind));
  assert.deepEqual(readOutbox('owner-a'),[],'the accepted receipt leaves the outbox');
  for(const b of [retryButton(kind),discardButton(kind),reconnectButton(kind)])assert.equal(root.querySelector(b).hidden,true,b+' hidden once saved');
  dispose();
 });
 test(`${kind}: Retry sends the waiting result and settles it once the server accepts it`,async()=>{
  seed(kind);capability=true;routes['POST /finish/'+run]=()=>Response.json({ok:true,value:{id:run,status:'failed',served:0,score:0}});
  const finished=[];const root=new Element(),dispose=kind==='sole'?mountSoleStreet(root,r=>finished.push(r),{locationId:id,point,neighborhood,onReturn(){}}):mountTea(root,r=>finished.push(r),{locationId:id,onReturn(){}});
  await until(()=>/restored/i.test(status(root)),'cloud ready with a waiting result');
  assert.equal(root.querySelector(retryButton(kind)).disabled,false);root.querySelector(retryButton(kind)).click();
  await until(()=>/Practice result saved/.test(status(root)),'result saved through retry');
  assert.deepEqual(requests.filter(r=>r.method==='POST'&&r.path==='/finish/'+run).map(r=>r.body),[pendingBody(kind)]);
  assert.deepEqual(readOutbox('owner-a'),[]);assert.equal(finished.at(-1)?.cloud,'saved');
  for(const b of [retryButton(kind),discardButton(kind),reconnectButton(kind)])assert.equal(root.querySelector(b).hidden,true,b+' hidden once saved');
  dispose();
 });
 test(`${kind}: a 409 on finish keeps its own message, the receipt and discard`,async()=>{
  seed(kind);capability=true;routes['POST /finish/'+run]=()=>Response.json({ok:false,error:'Mission or result changed. Reload before retrying.'},{status:409});
  const root=new Element(),dispose=mount(kind,root);
  await until(()=>/restored/i.test(status(root)),'cloud ready with a waiting result');
  assert.equal(root.querySelector(retryButton(kind)).disabled,false);root.querySelector(retryButton(kind)).click();
  await until(()=>requests.some(r=>r.path==='/finish/'+run)&&!/restored/i.test(status(root)),'finish answered');
  assert.match(status(root),/different result/);assert.doesNotMatch(status(root),/mission changed/i);
  assert.deepEqual(readOutbox('owner-a').map(e=>[e.id,e.body]),[[run,pendingBody(kind)]],'the receipt is kept');
  assert.equal(root.querySelector(discardButton(kind)).hidden,false);assert.equal(root.querySelector(retryButton(kind)).hidden,false);
  dispose();
 });
 test(`${kind}: loading a mission and starting a new cloud run keep the waiting receipt`,async()=>{
  seed(kind);capability=true;
  routes['GET /missions/'+cloudId(kind)]=()=>Response.json({ok:true,value:{id:cloudId(kind),revision:1,document:missionDocument(kind)}});
  routes['POST /start/'+cloudId(kind)]=()=>Response.json({ok:true,value:{id:nextRun,revision:1,status:'running',document:missionDocument(kind)}},{status:201});
  const root=new Element(),dispose=mount(kind,root);
  await until(()=>/restored/i.test(status(root)),'cloud ready with a waiting result');
  root.querySelector(loadButton(kind)).click();await until(()=>/Loaded private revision 1/.test(status(root)),'mission loaded');
  assert.deepEqual(readOutbox('owner-a').map(e=>e.id),[run],'load keeps the receipt');
  assert.equal(root.querySelector(retryButton(kind)).hidden,false);assert.equal(root.querySelector(discardButton(kind)).hidden,false);
  assert.equal(root.querySelector(playButton(kind)).disabled,false);root.querySelector(playButton(kind)).click();
  await until(()=>/Playing/.test(status(root)),'new cloud run started');
  assert.ok(requests.some(r=>r.method==='POST'&&r.path==='/start/'+cloudId(kind)));
  assert.deepEqual(readOutbox('owner-a').map(e=>e.id),[run],'a new start keeps the receipt');
  assert.equal(root.querySelector(retryButton(kind)).hidden,false);assert.equal(root.querySelector(discardButton(kind)).hidden,false);
  dispose();
  assert.deepEqual(readOutbox('owner-a').map(e=>e.id),[run],'still queued after the view closes');
 });
}
test('outbox keys are account scoped and separate from gameplay session keys',()=>{
 assert.equal(outboxKey('owner-a'),RESULT_OUTBOX_PREFIX+'owner-a');
 assert.notEqual(outboxKey('owner-a'),outboxKey('owner-b'));
 assert.ok(!outboxKey('owner-a').includes('.session.v1:'));
});
test('a stored receipt cannot be rewritten: the same run id with a different body is refused',()=>{
 store.clear();
 const entry={id:run,game:'gauranfucking-tea-tea-rush',locationId:id,body:{status:'failed',served:0}};
 assert.equal(enqueueResult('owner-a',entry),true);
 assert.equal(enqueueResult('owner-a',{...entry,body:{status:'won',served:5}}),false,'a different body is refused');
 assert.deepEqual(readOutbox('owner-a').map(e=>e.body),[{status:'failed',served:0}],'the stored body is unchanged');
 assert.equal(enqueueResult('owner-a',entry),true,'an exact repeat is idempotent');
 assert.equal(readOutbox('owner-a').length,1);
});
test('the outbox never evicts an unacknowledged receipt to make room for a newer one',()=>{
 store.clear();const ids=[];
 for(let i=1;i<=25;i++){
  const rid='55555555-5555-4555-8555-'+String(i).padStart(12,'0');ids.push(rid);
  assert.equal(enqueueResult('owner-a',{id:rid,game:i%2?'designer-kicks-sole-run':'gauranfucking-tea-tea-rush',locationId:id,body:{status:'failed',served:0}}),true);
 }
 assert.deepEqual(readOutbox('owner-a').map(e=>e.id),ids,'every receipt is kept, oldest first');
});
test('a receipt that cannot be written is not reported as stored',()=>{
 store.clear();const setItem=localStorage.setItem;
 localStorage.setItem=()=>{throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});};
 try{assert.equal(enqueueResult('owner-a',{id:run,game:'gauranfucking-tea-tea-rush',locationId:id,body:{status:'failed',served:0}}),false);}
 finally{localStorage.setItem=setItem;}
 assert.deepEqual(readOutbox('owner-a'),[]);
});
