/* Executes the shipped editor and client unchanged. DOM and renderer doubles keep
 * these persistence/race tests deterministic; browser layout/WebGL QA is separate. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let n=0;n<6;n++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}; }
function response(document,revision=1,publishedVersion=null) {return {ok:true,level:{id:document.id,revision,status:'draft',document:clone(document),publishedVersion}};}

class Element {
  constructor(tag='div') {this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.value='';this.textContent='';this.hidden=false;this.listeners=new Map();this.width=480;this.height=480;this.classList={add(){},remove(){},toggle(){return false}};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,fn){const entries=this.listeners.get(name)||[];entries.push(fn);this.listeners.set(name,entries);}
  fire(name,event={}){for(const fn of this.listeners.get(name)||[])fn({target:this,currentTarget:this,preventDefault(){},...event});}
  getContext(){return null;}
  getBoundingClientRect(){return {left:0,top:0,width:390,height:400};}
  closest(){return null;}
  remove(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
  click(){return this.onclick?.();}
}
class Renderer {
  constructor(canvas,level,options){this.canvas=canvas;this.level=level;this.options=options;this.camera={};this.view='3d';}
  setLevel(level){this.level=level;}
  setState(){} setOverlay(){} overview(){} resize(){} focus(){} zoom(){} destroy(){}
  getMode(){return 'compatibility';}
  setView(view){this.view=view;}
}
function harness(cloud={isConfigured:()=>true}) {
  const elements=new Map(),storage=new Map(),timers=new Map();let serial=0,storageFails=false;
  const element=id=>{if(!elements.has(id))elements.set(id,new Element(id.includes('canvas')?'canvas':'div'));return elements.get(id);};
  const document={getElementById:element,createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),querySelectorAll:()=>[],addEventListener(){},body:new Element('body')};
  const context=vm.createContext({console,Date,Math,document,P3Renderer:Renderer,P3LevelClient:cloud,requestAnimationFrame:fn=>fn(),addEventListener(){},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(storageFails)throw new Error('Storage quota reached');storage.set(key,value);}},
    setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)});
  context.window=context;
  element('scene-filter').value='all';element('forge').dataset.panel='assets';
  for(const file of ['catalog.js','model.js','editor-ui.js'])vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context,{filename:file});
  assert.ok(context.PRIM3Forge,'editor initialized through its real start function');
  const getDoc=()=>clone(context.PRIM3Forge.getDocument());
  const makeDoc=(id='level-a',title='Alpha')=>({...clone(context.P3LevelModel.createStarter()),id,title});
  return {element,storage,getDoc,makeDoc,load:doc=>context.PRIM3Forge.loadDocument(doc),
    failStorage:()=>{storageFails=true;},status:()=>element('status-message').textContent,
    title:value=>{element('level-title').value=value;element('level-title').fire('change');},
    click:id=>element(id).click(),flush,autosave:()=>{for(const [id,t]of timers)if(t.delay===550){timers.delete(id);t.fn();}},
    saveDevice:()=>context.PRIM3Forge.saveDraft()};
}

// The old document must remain recoverable after a page reload, not only in Undo.
test('replacement durably archives the active document before autosave changes it',()=>{
  const h=harness(),a=h.makeDoc();h.load(a);h.title('Unsaved local changes');const edited=h.getDoc();h.load(h.makeDoc('level-b','Beta'));h.autosave();
  const drafts=JSON.parse(h.storage.get('prim3.forge.drafts.v1'));
  assert.deepEqual(drafts[0].document,edited);assert.equal(drafts[0].recovery,true);assert.equal(JSON.parse(h.storage.get('prim3.forge.active.v1')).document.id,'level-b');
});
test('recovery storage failure aborts replacement and preserves the current document',()=>{
  const h=harness();h.load(h.makeDoc());const before=h.getDoc();h.failStorage();assert.throws(()=>h.load(h.makeDoc('level-b')),/could not be protected/);assert.deepEqual(h.getDoc(),before);
});
test('invalid import leaves the open document and durable recovery list unchanged',()=>{
  const h=harness();h.load(h.makeDoc());const before=h.getDoc(),drafts=h.storage.get('prim3.forge.drafts.v1');assert.throws(()=>h.load({...h.makeDoc('invalid'),schemaVersion:99}));assert.deepEqual(h.getDoc(),before);assert.equal(h.storage.get('prim3.forge.drafts.v1'),drafts);
});
test('first save POSTs; later save uses only the revision returned by that successful POST',async()=>{
  const calls=[],h=harness({isConfigured:()=>true,create:async d=>{calls.push(['POST']);return response(d,7)},save:async(id,d,rev)=>{calls.push(['PATCH',rev]);return response(d,8)}});h.load(h.makeDoc());h.click('cloud-save');await flush();h.click('cloud-save');await flush();assert.deepEqual(calls,[['POST'],['PATCH',7]]);
});
test('a conflicting first save never fetches a revision or auto-overwrites',async()=>{
  const calls=[],h=harness({isConfigured:()=>true,create:async()=>{calls.push('POST');throw new Error('A cloud draft already uses this level ID.')},get:async()=>calls.push('GET'),save:async()=>calls.push('PATCH')});h.load(h.makeDoc());h.click('cloud-save');await flush();assert.deepEqual(calls,['POST']);assert.match(h.status(),/already uses/);
});
test('late save reports newer local edits and preserves them',async()=>{
  const pending=deferred(),calls=[],h=harness({isConfigured:()=>true,create:()=>pending.promise,save:async(id,d,revision)=>{calls.push(revision);return response(d,2)}});const a=h.makeDoc();h.load(a);h.click('cloud-save');h.title('Newer local edit');pending.resolve(response(a));await flush();assert.match(h.status(),/Newer local edits remain unsaved/);assert.equal(h.getDoc().title,'Newer local edit');h.click('cloud-save');await flush();assert.deepEqual(calls,[1]);
});
test('late save names the prior level and does not grant its revision to a replacement',async()=>{
  const pending=deferred(),calls=[],h=harness({isConfigured:()=>true,create:d=>{calls.push(['POST',d.id]);return calls.length===1?pending.promise:Promise.resolve(response(d))},save:async()=>calls.push(['PATCH'])});const a=h.makeDoc();h.load(a);h.click('cloud-save');h.load(h.makeDoc('level-b','Beta'));pending.resolve(response(a));await flush();assert.match(h.status(),/Alpha.*saved.*Your open level was not changed/);assert.equal(h.getDoc().id,'level-b');h.click('cloud-save');await flush();assert.deepEqual(calls,[['POST','level-a'],['POST','level-b']]);
});
test('late freeze reports that edits made during the request are excluded',async()=>{
  const pending=deferred(),h=harness({isConfigured:()=>true,create:async d=>response(d),freeze:()=>pending.promise});const a=h.makeDoc();h.load(a);h.click('cloud-save');await flush();h.click('cloud-freeze');h.title('Edited after freeze requested');pending.resolve(response(a,2,1));await flush();assert.match(h.status(),/Newer local edits are not included/);assert.equal(h.getDoc().title,'Edited after freeze requested');
});
test('late freeze names the prior level after another document is opened',async()=>{
  const pending=deferred(),h=harness({isConfigured:()=>true,create:async d=>response(d),freeze:()=>pending.promise});const a=h.makeDoc();h.load(a);h.click('cloud-save');await flush();h.click('cloud-freeze');h.load(h.makeDoc('level-b','Beta'));pending.resolve(response(a,2,1));await flush();assert.match(h.status(),/Alpha.*frozen.*Your open level was not changed/);assert.equal(h.getDoc().id,'level-b');
});
test('freeze refuses local edits that have not been saved to the cloud draft',async()=>{
  const calls=[],h=harness({isConfigured:()=>true,create:async d=>response(d),freeze:async()=>calls.push('freeze')});h.load(h.makeDoc());h.click('cloud-save');await flush();h.title('Changed');h.click('cloud-freeze');await flush();assert.equal(calls.length,0);assert.match(h.status(),/Save your current changes/);
});
function clientHarness(session,fetch){const context=vm.createContext({AbortController,setTimeout,clearTimeout,fetch});context.window=context;if(session)context.MCC_SUPA=session;vm.runInContext(fs.readFileSync(path.join(base,'cloud-client.js'),'utf8'),context,{filename:'cloud-client.js'});return context.P3LevelClient;}
test('client obtains a fresh bearer token for each request, with no ambient credentials',async()=>{
  let tokens=0;const requests=[],client=clientHarness({token:async()=>`test-token-${++tokens}`},async(url,options)=>{requests.push({url,options});return {ok:true,status:200,json:async()=>({ok:true})}});
  await client.create({id:'level-a'});await client.save('level-a',{id:'level-a'},3);assert.equal(tokens,2);assert.equal(requests[0].options.headers.Authorization,'Bearer test-token-1');assert.equal(requests[1].options.headers.Authorization,'Bearer test-token-2');assert.equal(requests[1].options.credentials,'omit');assert.equal(requests[1].options.cache,'no-store');assert.equal(JSON.parse(requests[1].options.body).expectedRevision,3);assert(!requests.some(r=>r.url.includes('token')));
});
test('invalid revisions are rejected before any network request',()=>{
  let calls=0;const client=clientHarness({token:async()=> 'test-token'},async()=>{calls++});assert.throws(()=>client.save('level-a',{},0),/Open the cloud draft/);assert.throws(()=>client.freeze('level-a',NaN),/Open the cloud draft/);assert.equal(calls,0);
});
test('a standalone preview without canonical auth remains local and never sends cloud requests',async()=>{
  let calls=0;const client=clientHarness(null,async()=>{calls++});assert.equal(client.isConfigured(),false);await assert.rejects(()=>client.create({id:'level-a'}),/available in McCluster Control/);assert.equal(calls,0);
});
