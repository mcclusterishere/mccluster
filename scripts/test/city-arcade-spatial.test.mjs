import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptsSpatialState,SPATIAL_SCHEMA,SHARED_ENTRANCE} from '../../js/city-arcade/sole-spatial.mjs';
const source={},origin='https://preview.invalid';
const event=()=>({source,origin,data:{type:'bridgeport:state',schema:SPATIAL_SCHEMA,event:'ready',regionId:'bridgeport-golden-hill.v1',revision:1,frameId:'bridgeport-golden-hill.enu.v1',floorId:'street',entranceId:SHARED_ENTRANCE,topology:'hex',position:{x:0,y:0,z:0},capabilities:['exterior-navigation']}});
test('City lifecycle consumer accepts pinned square/hex positions without converting legacy saves',()=>{
 for(const topology of ['hex','square']){const e=event();e.data.topology=topology;assert.equal(acceptsSpatialState(e,source,origin),true);}
});
test('City lifecycle consumer rejects wrong sender, version, frame, floor and unsupported entrances',()=>{
 for(const patch of [{source:{}},{origin:'https://other.invalid'}])assert.equal(acceptsSpatialState({...event(),...patch},source,origin),false);
 for(const patch of [{schema:'other'},{revision:2},{regionId:'other'},{frameId:'legacy'},{floorId:'1'},{entranceId:'bridgeport-main-elm'},{topology:'triangle'},{capabilities:[]},{position:{x:NaN,y:0,z:0}},{position:{x:0,y:2,z:0}},{position:null}]){const e=event();Object.assign(e.data,patch);assert.equal(acceptsSpatialState(e,source,origin),false);}
});
test('unloaded/returned events can have no position; unsolicited event names are rejected',()=>{
 for(const name of ['unloaded','returned']){const e=event();Object.assign(e.data,{event:name,position:null});assert.equal(acceptsSpatialState(e,source,origin),true);}
 const e=event();e.data.event='grant-reward';assert.equal(acceptsSpatialState(e,source,origin),false);
});
import {mountSoleSpatial} from '../../js/city-arcade/sole-spatial.mjs';
function fixture(){
 const controls=new Map(),panel={dataset:{},remove(){},querySelector(k){if(!controls.has(k))controls.set(k,{disabled:false,textContent:''});return controls.get(k);}},listeners=new Map(),sent=[],states=[];
 const root={append(){},scrollIntoView(){}},frame={contentWindow:{postMessage:m=>sent.push(m)},scrollIntoView(){},addEventListener(){},removeEventListener(){}};
 const win={location:{origin},addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)};
 const old=globalThis.document;globalThis.document={createElement:()=>panel};
 const dispose=mountSoleSpatial(root,{locationId:SHARED_ENTRANCE,onActive:x=>states.push(x),win,frame,timeoutMs:10});globalThis.document=old;
 const emit=name=>{const e=event();e.source=frame.contentWindow;e.data.event=name;listeners.get('message')?.(e);};
 return {controls,listeners,sent,states,dispose,emit};
}
test('missing City times out paused and rejects a late ready reply',async()=>{
 const f=fixture();f.controls.get('[data-spatial-enter]').onclick();assert.deepEqual(f.states,[true]);await new Promise(r=>setTimeout(r,25));
 assert.deepEqual(f.sent.map(x=>x.type),['bridgeport:enter','bridgeport:leave']);assert.deepEqual(f.states,[true,false]);const text=f.controls.get('[data-spatial-status]').textContent;f.emit('ready');assert.equal(f.controls.get('[data-spatial-status]').textContent,text);f.dispose();assert.equal(f.listeners.size,0);
});
test('ready/arrival does not resume gameplay; only returned releases controls; disposal leaves City',()=>{
 const f=fixture();f.controls.get('[data-spatial-enter]').onclick();f.emit('ready');f.emit('arrived');assert.deepEqual(f.states,[true]);f.controls.get('[data-spatial-return]').onclick();assert.deepEqual(f.states,[true]);f.emit('returned');assert.deepEqual(f.states,[true,false]);
 f.controls.get('[data-spatial-enter]').onclick();f.dispose();assert.equal(f.sent.at(-1).type,'bridgeport:leave');assert.deepEqual(f.states,[true,false,true,false]);
});
