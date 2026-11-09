// Regression for audit finding W2: a finished cloud run whose result the server has not yet
// accepted must survive local restart, apply, load and a new start. Synthetic DOM, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
class Element extends EventTarget {
 constructor(){super();this.nodes=new Map();this.dataset={};this.value='';this.disabled=false;this.hidden=false;this.textContent='';this.classList={add(){},remove(){}};}
 querySelector(s){if(!this.nodes.has(s))this.nodes.set(s,new Element());return this.nodes.get(s);}
 querySelectorAll(){return [];}
 append(){} remove(){} getContext(){return null;} focus(){} scrollIntoView(){} setPointerCapture(){} replaceChildren(){} closest(){return null;}
 click(){this.dispatchEvent(new Event('click'));if(this.onclick)this.onclick();}
}
globalThis.document={hidden:false,querySelector(){return null;},createElement(){return new Element();},addEventListener(){},removeEventListener(){}};
globalThis.window=new EventTarget();window.location={origin:'https://local.fixture.invalid'};window.confirm=()=>false;
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
let capability=false;globalThis.fetch=async()=>Response.json({ok:true,value:{cloudEnabled:capability}});
const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),key:i=>[...store.keys()][i],get length(){return store.size;}};
const flush=()=>new Promise(r=>setTimeout(r,0));
const {newStreetRun}=await import('../../js/city-arcade/sole-street-engine.mjs');
const {SOLE_MISSION}=await import('../../js/city-arcade/sole-config.mjs');
const {newTeaAction}=await import('../../js/city-arcade/tea-action.mjs');
const {mountTea}=await import('../../js/city-arcade/tea-view.mjs');
const {mountSoleStreet}=await import('../../js/city-arcade/sole-street-view.mjs');
const {readOutbox,outboxKey,RESULT_OUTBOX_PREFIX}=await import('../../js/city-arcade/result-outbox.mjs');
const d=JSON.parse(await readFile(new URL('../../core/data/fictional-city/district.v1.json',import.meta.url),'utf8')),neighborhood=d.neighborhoods.find(n=>n.id==='bridgeport-robbery-1s'),point=[51.1422,-253.0175];
const id='bridgeport-main-elm',run='11111111-1111-4111-8111-111111111111',session={access_token:'synthetic-owner',user:{id:'owner-a'}};
function seed(kind){
 store.clear();localStorage.setItem('mccdb_session',JSON.stringify(session));
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
for(const kind of ['sole','tea']){
 test(`${kind}: legacy session with an unacknowledged result is moved into the account outbox on mount`,async()=>{
  seed(kind);const root=new Element();const dispose=mount(kind,root);await flush();
  const entries=readOutbox('owner-a');
  assert.equal(entries.length,1);assert.equal(entries[0].id,run);assert.equal(entries[0].body.status,'failed');
  assert.equal(root.querySelector(retryButton(kind)).hidden,false);
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
}
test('outbox keys are account scoped and separate from gameplay session keys',()=>{
 assert.equal(outboxKey('owner-a'),RESULT_OUTBOX_PREFIX+'owner-a');
 assert.notEqual(outboxKey('owner-a'),outboxKey('owner-b'));
 assert.ok(!outboxKey('owner-a').includes('.session.v1:'));
});
