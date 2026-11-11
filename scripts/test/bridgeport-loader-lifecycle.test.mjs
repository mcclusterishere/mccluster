import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the actual globe lifecycle wiring, controlling only the import completion.
const source=readFileSync('js/action-globe.js','utf8');
const wiring=source.slice(source.indexOf('let bridgeportGeneration='),source.indexOf('function haloSync()'))
 .replace("import('./spatial/bridgeport-globe.mjs')",'loadModule()');
function fixture(){
 let owner=true;const listeners={},elements={},pending=[],events=[],enters=[],previews=[];
 const parent={postMessage:data=>events.push(data)};
 const window={parent,addEventListener:(name,fn)=>listeners[name]=fn};
 const document={getElementById:id=>elements[id],body:{append:e=>elements[e.id]=e},createElement:()=>({style:{},click(){if(!this.disabled)return this.onclick();}})};
 const context=vm.createContext({window,document,location:{origin:'https://example.test',search:''},URLSearchParams,viewer:{},Cesium:{},isOwner:()=>owner,
  loadModule:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
 vm.runInContext(wiring+'\nbridgeportSync();',context);
 const module={mountBridgeport:()=>({enter:options=>enters.push(options),previewDestination:(...args)=>previews.push(args),leave:()=>{},destroy:()=>{}})};
 return {window,events,enters,previews,pending,door:elements.bridgeportEnter,
  send:data=>listeners.message({source:parent,origin:'https://example.test',data:{schema:'mccluster.spatial-lifecycle/v1',...data}}),
  enter:(id='bridgeport-main-elm')=>listeners.message({source:parent,origin:'https://example.test',data:{schema:'mccluster.spatial-lifecycle/v1',type:'bridgeport:enter',regionId:'bridgeport-downtown.v2',entranceId:id}}),
  resolve:async i=>{pending[i].resolve(module);await new Promise(resolve=>setImmediate(resolve));},
  owner:value=>{owner=value;vm.runInContext('bridgeportSync()',context);},hide:()=>listeners.pagehide()};
}
test('leave acknowledges the pending entry and late import cannot reopen it; reentry works',async()=>{
 const f=fixture();f.enter();f.send({type:'bridgeport:leave'});
 const d=f.events.at(-1);assert.equal(d.event,'returned');assert.equal(d.regionId,'bridgeport-downtown.v2');assert.equal(d.revision,2);
 assert.equal(d.entranceId,'bridgeport-main-elm');assert.equal(d.frameId,'bridgeport-golden-hill.enu.v1');assert.equal(d.floorId,'street');
 assert.equal(d.position,null);assert.equal(d.entered,false);assert.equal(d.loaded,false);assert.equal(d.topology,'hex');
 assert.equal(d.navigationRevision,0);assert.equal(d.closedRoadIds.length,0);assert.ok(d.capabilities.includes('exterior-navigation'));assert.ok(d.capabilities.includes('road-closures'));
 await f.resolve(0);assert.equal(f.enters.length,0);assert.equal(f.window.BridgeportSlice,undefined);
 f.enter();await f.resolve(1);assert.equal(f.enters.length,1);
});
test('new request supersedes a pending import without old completion resetting its loading state',async()=>{
 const f=fixture();f.enter();f.enter('bridgeport-main-south');await f.resolve(0);
 assert.equal(f.enters.length,0);assert.equal(f.door.disabled,true);await f.resolve(1);
 assert.equal(f.enters.length,1);assert.equal(f.enters[0].entranceId,'bridgeport-main-south');assert.equal(f.door.disabled,false);
});
for(const reason of ['revocation','pagehide'])test(reason+' invalidates import even if owner access returns',async()=>{
 const f=fixture();f.enter();if(reason==='revocation'){f.owner(false);f.owner(true);}else f.hide();
 await f.resolve(0);assert.equal(f.enters.length,0);assert.ok(!f.window.BridgeportSlice);
});
test('untrusted lifecycle messages cannot cancel entry',async()=>{
 const f=fixture();f.enter();f.send({schema:'wrong',type:'bridgeport:leave'});await f.resolve(0);assert.equal(f.enters.length,1);
});

test('terrain status distinguishes provider success from configuration or fallback',async()=>{
 const {terrainDescription}=await import('../../js/spatial/bridgeport-globe.mjs');
 assert.match(terrainDescription({configured:true,terrain:false}),/loading or unavailable/);
 assert.match(terrainDescription({configured:true,terrain:true}),/provider active/);
 assert.match(terrainDescription({configured:false,terrain:false}),/Ion unavailable/);
 assert.match(terrainDescription(undefined),/Ion unavailable/);
});

test('correlated preview passes through the existing owner gate',async()=>{
 const f=fixture();f.enter();await f.resolve(0);f.send({type:'bridgeport:preview',destinationId:'bridgeport-main-elm',requestId:'sole-123'});
 assert.deepEqual(f.previews,[['bridgeport-main-elm','sole-123']]);f.owner(false);f.send({type:'bridgeport:preview',destinationId:'bridgeport-main-elm',requestId:'denied'});assert.equal(f.previews.length,1);
});
