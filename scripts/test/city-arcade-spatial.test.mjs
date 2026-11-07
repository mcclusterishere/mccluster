import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptsSpatialState,SPATIAL_SCHEMA,SHARED_ENTRANCE,sharedStopId,sharedClosures} from '../../js/city-arcade/sole-spatial.mjs';
const source={},origin='https://preview.invalid';
const event=()=>({source,origin,data:{type:'bridgeport:state',schema:SPATIAL_SCHEMA,event:'ready',entered:true,loaded:true,regionId:'bridgeport-downtown.v2',revision:2,navigationRevision:1,closedRoadIds:[],frameId:'bridgeport-golden-hill.enu.v1',floorId:'street',entranceId:SHARED_ENTRANCE,topology:'hex',position:{x:0,y:0,z:0},capabilities:['exterior-navigation','road-closures']}});
test('City lifecycle consumer accepts pinned square/hex positions without converting legacy saves',()=>{
 for(const topology of ['hex','square']){const e=event();e.data.topology=topology;assert.equal(acceptsSpatialState(e,source,origin),true);}
});
test('City lifecycle consumer rejects wrong sender, version, frame, floor and unsupported entrances',()=>{
 for(const patch of [{source:{}},{origin:'https://other.invalid'}])assert.equal(acceptsSpatialState({...event(),...patch},source,origin),false);
 for(const patch of [{schema:'other'},{revision:3},{regionId:'other'},{frameId:'legacy'},{floorId:'1'},{entranceId:'bridgeport-main-elm'},{topology:'triangle'},{capabilities:[]},{position:{x:NaN,y:0,z:0}},{position:{x:0,y:2,z:0}},{position:null}]){const e=event();Object.assign(e.data,patch);assert.equal(acceptsSpatialState(e,source,origin),false);}
});
test('unloaded/returned events can have no position; unsolicited event names are rejected',()=>{
 for(const name of ['unloaded','returned']){const e=event();Object.assign(e.data,{event:name,position:null});assert.equal(acceptsSpatialState(e,source,origin),true);}
 const e=event();e.data.event='grant-reward';assert.equal(acceptsSpatialState(e,source,origin),false);
});
import {mountSoleSpatial} from '../../js/city-arcade/sole-spatial.mjs';
function fixture(options={}){
 const controls=new Map(),panel={dataset:{},remove(){},querySelector(k){if(!controls.has(k))controls.set(k,{disabled:false,textContent:'',replaceChildren(){},append(){},selectedIndex:0});return controls.get(k);}},listeners=new Map(),sent=[],states=[];
 const root={append(){},scrollIntoView(){}},frame={contentWindow:{postMessage:m=>sent.push(m)},scrollIntoView(){},addEventListener(){},removeEventListener(){}};
 const win={location:{origin},addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)};
 const old=globalThis.document;globalThis.document={createElement:tag=>tag==='option'?{}:panel};
 const dispose=mountSoleSpatial(root,{locationId:SHARED_ENTRANCE,onActive:x=>states.push(x),win,frame,timeoutMs:10,returnTimeoutMs:10,...options});
 const originalDispose=dispose;const cleanup=()=>{originalDispose();globalThis.document=old;};
 const emit=(name,patch={})=>{const e=event();e.source=frame.contentWindow;e.data.event=name;Object.assign(e.data,patch);listeners.get('message')?.(e);};
 return {controls,listeners,sent,states,dispose:cleanup,emit};
}
test('missing City times out paused and rejects a late ready reply',async()=>{
 const f=fixture();f.controls.get('[data-spatial-enter]').onclick();assert.deepEqual(f.states,[true]);await new Promise(r=>setTimeout(r,25));
 assert.deepEqual(f.sent.map(x=>x.type),['bridgeport:enter','bridgeport:leave']);assert.deepEqual(f.states,[true,false]);const text=f.controls.get('[data-spatial-status]').textContent;f.emit('ready');assert.equal(f.controls.get('[data-spatial-status]').textContent,text);f.dispose();assert.equal(f.listeners.size,0);
});
test('ready/arrival does not resume gameplay; only returned releases controls; disposal leaves City',()=>{
 const f=fixture();f.controls.get('[data-spatial-enter]').onclick();f.emit('ready');f.emit('arrived');assert.deepEqual(f.states,[true]);f.controls.get('[data-spatial-return]').onclick();assert.deepEqual(f.states,[true]);f.emit('returned');assert.deepEqual(f.states,[true,false]);
 f.controls.get('[data-spatial-enter]').onclick();f.dispose();assert.equal(f.sent.at(-1).type,'bridgeport:leave');assert.deepEqual(f.states,[true,false,true,false]);
});

test('published v2 stop aliases and conservative source-way closures are explicit',()=>{
 for(const alias of ['main-elm','main-fairfield','middle-golden-hill','main-golden-hill','main-south'])assert.equal(sharedStopId(alias),'bridgeport-'+alias);
 assert.throws(()=>sharedStopId('invented'));assert.deepEqual(sharedClosures(['bridgeport-osm-186839735-0','bridgeport-osm-186839735-1']),['186839735']);assert.throws(()=>sharedClosures(['bridgeport-osm-999-0']));
});
test('routes remain disabled until City acknowledges the mission closures',()=>{const f=fixture();f.controls.get('[data-spatial-enter]').onclick();assert.equal(f.sent[0].regionId,'bridgeport-downtown.v2');f.emit('ready');assert.equal(f.sent.at(-1).type,'bridgeport:closures');assert.equal(f.controls.get('[data-spatial-preview]').disabled,true);f.emit('closures-changed');assert.equal(f.controls.get('[data-spatial-preview]').disabled,false);f.dispose();});

test('stale closure acknowledgements cannot re-enable an unloaded route',()=>{const f=fixture();f.controls.get('[data-spatial-enter]').onclick();f.emit('ready',{navigationRevision:5});f.emit('closures-changed',{navigationRevision:6});assert.equal(f.controls.get('[data-spatial-preview]').disabled,false);f.emit('unloaded',{navigationRevision:7});f.emit('closures-changed',{navigationRevision:6});assert.equal(f.controls.get('[data-spatial-preview]').disabled,true);f.dispose();});
test('closure messages before ready do not cancel the missing-host deadline',async()=>{const f=fixture();f.controls.get('[data-spatial-enter]').onclick();f.emit('closures-changed');await new Promise(r=>setTimeout(r,25));assert.deepEqual(f.states,[true,false]);f.dispose();});

test('lost returned acknowledgement enables retry while game and routes remain paused',async()=>{
 const f=fixture();try{f.controls.get('[data-spatial-enter]').onclick();f.emit('ready');f.emit('closures-changed');const back=f.controls.get('[data-spatial-return]');back.onclick();await new Promise(r=>setTimeout(r,25));
 assert.equal(back.disabled,false);assert.match(back.textContent,/Retry/);assert.deepEqual(f.states,[true]);assert.equal(f.controls.get('[data-spatial-preview]').disabled,true);
 f.emit('ready');f.emit('closures-changed');assert.equal(f.controls.get('[data-spatial-preview]').disabled,true);back.onclick();assert.equal(f.sent.filter(m=>m.type==='bridgeport:leave').length,2);f.emit('returned');f.emit('returned');assert.deepEqual(f.states,[true,false]);await new Promise(r=>setTimeout(r,25));assert.equal(back.disabled,true);
 }finally{f.dispose();}
});
test('return during entry waits for acknowledgement rather than the old entry timeout',async()=>{
 const f=fixture();try{f.controls.get('[data-spatial-enter]').onclick();f.controls.get('[data-spatial-return]').onclick();await new Promise(r=>setTimeout(r,25));assert.deepEqual(f.states,[true]);assert.equal(f.controls.get('[data-spatial-return]').disabled,false);f.emit('returned');assert.deepEqual(f.states,[true,false]);}finally{f.dispose();}
});
test('disposing while awaiting return cancels retry timer and removes listener',async()=>{
 const f=fixture();f.controls.get('[data-spatial-enter]').onclick();f.emit('ready');f.emit('closures-changed');const back=f.controls.get('[data-spatial-return]');back.onclick();f.dispose();await new Promise(r=>setTimeout(r,25));assert.equal(back.disabled,true);assert.equal(f.listeners.size,0);assert.deepEqual(f.states,[true,false]);
});

function request(f,id){const target=f.controls.get('[data-spatial-target]');target.value=id;target.selectedOptions=[{textContent:id}];f.controls.get('[data-spatial-preview]').onclick();return f.sent.at(-1);}
test('only correlated current requests award once; late, wrong and invalidated replies do not',()=>{
 const awards=[];const f=fixture({onArrival:a=>{awards.push(a);return true;}});
 try{f.controls.get('[data-spatial-enter]').onclick();f.emit('ready',{capabilities:['exterior-navigation','road-closures','correlated-arrival']});f.emit('closures-changed');
 const a=request(f,'bridgeport-main-elm');
 f.emit('arrived',{requestId:'old',destinationId:a.destinationId});assert.equal(awards.length,0);
 f.emit('arrived',{requestId:a.requestId,destinationId:'bridgeport-main-south'});assert.equal(awards.length,0);
 f.emit('arrived',{requestId:a.requestId,destinationId:a.destinationId,entered:false});assert.equal(awards.length,0);
 f.emit('arrived',{requestId:a.requestId,destinationId:a.destinationId,loaded:false});assert.equal(awards.length,0);
 f.emit('arrived',{requestId:a.requestId,destinationId:a.destinationId});f.emit('arrived',{requestId:a.requestId,destinationId:a.destinationId});assert.equal(awards.length,1);
 const b=request(f,'bridgeport-main-fairfield');f.emit('closures-changed',{navigationRevision:2});f.emit('arrived',{requestId:b.requestId,destinationId:b.destinationId,navigationRevision:2});assert.equal(awards.length,1);
 const c=request(f,'bridgeport-main-fairfield');f.controls.get('[data-spatial-return]').onclick();f.emit('arrived',{requestId:c.requestId,destinationId:c.destinationId,navigationRevision:2});assert.equal(awards.length,1);
 }finally{f.dispose();}
});
test('older hosts remain navigation-only and unrequested arrivals never award',()=>{
 const awards=[];const f=fixture({onArrival:a=>awards.push(a)});try{f.controls.get('[data-spatial-enter]').onclick();f.emit('ready');f.emit('closures-changed');const a=request(f,'bridgeport-main-elm');f.emit('arrived',{requestId:a.requestId,destinationId:a.destinationId});assert.equal(awards.length,0);}finally{f.dispose();}
});
