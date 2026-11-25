import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountBridgeport} from '../../js/spatial/bridgeport-globe.mjs';
import {routeToEntrance,distance,clearEdge} from '../../js/spatial/region-graph.mjs';

const data=JSON.parse(readFileSync(new URL('../../data/spatial/bridgeport-downtown.v2.json',import.meta.url)));
const start=data.graphs.hex.entrances.find(e=>e.id==='bridgeport-middle-golden-hill').position;
const destination='bridgeport-main-fairfield';
const path=routeToEntrance(data,'hex',start,destination);
// Mount the production module. Only DOM/graphics, time and fixture transport are
// doubles: route planning, movement, collision, clock and lifecycle are real.
async function fixture(t){
 let now=0,owner=true,nextFrame=null,nextId=0,interval=null;
 const listeners=new Map(),events=[],storage=new Map(),elements=new Map();
 function element(){const children=[];return {children,disabled:false,hidden:false,textContent:'',value:'',setAttribute(){},append(...v){children.push(...v);},remove(){},click(){if(!this.disabled)this.onclick?.();},querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s);}};}
 const document={hidden:false,head:element(),body:element(),createElement:element,
  addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);}};
 const c=data.contract;storage.set(c.state.key,JSON.stringify({schema:c.state.schema,regionId:c.id,revision:c.revision,frameId:c.frame.id,floorId:'street',position:start,topology:'hex'}));
 const originals=new Map();const replace=(key,value)=>{originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
 replace('document',document);replace('performance',{now:()=>now});
 replace('localStorage',{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)});
 replace('fetch',async()=>new Response(JSON.stringify(data)));
 replace('requestAnimationFrame',fn=>{nextFrame=fn;return ++nextId;});replace('cancelAnimationFrame',()=>{nextFrame=null;});
 replace('setInterval',fn=>{interval=fn;return 1;});replace('clearInterval',()=>{interval=null;});
 const color={withAlpha(){return this;}},C={Color:new Proxy({}, {get:()=>color}),HeightReference:{},Cartesian2:class{},PolygonHierarchy:class{},
  Cartesian3:{fromDegrees:(lon,lat)=>({longitude:lon,latitude:lat}),clone:p=>({...p})},Cartographic:{fromCartesian:p=>p},Math:{toDegrees:v=>v},
  CustomDataSource:class{constructor(){const values=[];this.entities={values,add(e){values.push(e);return e;},remove(e){const i=values.indexOf(e);if(i>=0)values.splice(i,1);}};}}};
 const viewer={dataSources:{add(){},remove(){}},scene:{canvas:{clientWidth:1280,clientHeight:1000},globe:{ellipsoid:{}},requestRender(){}},
  camera:{positionWC:{},positionCartographic:{height:360},pickEllipsoid:()=>({longitude:-73.19055,latitude:41.1797}),moveEnd:{addEventListener(){},removeEventListener(){}},flyTo:options=>options.complete?.(),setView(){}}};
 const city=mountBridgeport({globe:{viewer:()=>viewer,owner:()=>owner,tell:e=>events.push(e)},C});
 t.after(()=>{city.destroy();for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 city.enter({regionId:c.id,entranceId:'bridgeport-main-elm'});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(city.snapshot().attached,true);
 return {city,viewer,events,document,listeners,storage,at(value){now=value;},frame(value){now=value;const fn=nextFrame;nextFrame=null;fn?.(value);},
  hidden(value){document.hidden=value;listeners.get('visibilitychange')?.();},owner(value){owner=value;},tick(){interval?.();},
  button(selector){return elements.get(selector);},
  confirm(id=destination,request='walk-test'){city.previewDestination(id,request);city.confirm();assert.equal(city.snapshot().walking,true);},
  arrivals:()=>events.filter(e=>e.event==='arrived')};
}

for(const step of [1000/60,1000,1500,3000])test(`confirmed route follows elapsed time with ${step}ms visible frames`,async t=>{
 const f=await fixture(t);f.confirm();
 for(let now=step;now<120000;now+=step)f.frame(now);
 f.frame(120000);assert.equal(f.city.snapshot().walking,false);assert.deepEqual(f.city.snapshot().position,path.points.at(-1));
 assert.equal(f.arrivals().length,1);assert.equal(f.arrivals()[0].requestId,'walk-test');assert.equal(f.arrivals()[0].destinationId,destination);
 f.frame(240000);assert.equal(f.arrivals().length,1);
});
test('irregular late frames traverse the same swept-clear route and arrive once',async t=>{
 const f=await fixture(t);f.confirm();f.frame(16);f.frame(33);f.frame(120000);
 assert.equal(f.city.snapshot().walking,false);assert.deepEqual(f.city.snapshot().position,path.points.at(-1));assert.equal(f.arrivals().length,1);
});
test('confirmation cannot spend idle time before the route was confirmed',async t=>{
 const f=await fixture(t);f.frame(1000);f.at(100000);f.confirm();f.frame(100010);
 assert.ok(Math.abs(distance(start,f.city.snapshot().position)-.02)<1e-8,'only 10ms belongs to the new route');
 assert.equal(f.arrivals().length,0);
});
test('hidden time is excluded even when no animation frames arrive while hidden',async t=>{
 const f=await fixture(t);f.confirm();f.frame(10);const before={...f.city.snapshot().position};
 f.at(10);f.hidden(true);f.at(100000);f.hidden(false);assert.deepEqual(f.city.snapshot().position,before);f.frame(100010);
 assert.ok(Math.abs(distance(before,f.city.snapshot().position)-.02)<1e-8);assert.equal(f.arrivals().length,0);
});
test('a route confirmed while hidden starts its clock only on visibility resume',async t=>{
 const f=await fixture(t);f.hidden(true);f.at(10000);f.confirm();f.frame(20000);assert.deepEqual(f.city.snapshot().position,start);
 f.at(100000);f.hidden(false);f.frame(100010);assert.ok(Math.abs(distance(start,f.city.snapshot().position)-.02)<1e-8);
});
test('stop and replacement cannot inherit the previous walk or idle gap',async t=>{
 const f=await fixture(t);f.confirm();f.frame(100);f.button('[data-stop]').click();const stopped={...f.city.snapshot().position};
 f.frame(50000);assert.deepEqual(f.city.snapshot().position,stopped);f.at(100000);f.confirm(destination,'replacement');f.frame(100010);
 assert.ok(distance(stopped,f.city.snapshot().position)<=.020000001);f.frame(220000);assert.deepEqual(f.arrivals().map(e=>e.requestId),['replacement']);
});
for(const interruption of ['closures','topology','leave','revocation','destroy'])test(`${interruption} cancels movement and cannot emit a late arrival`,async t=>{
 const f=await fixture(t);f.confirm();f.frame(100);const position={...f.city.snapshot().position};
 if(interruption==='closures')f.city.setClosures(['186839735']);
 if(interruption==='topology')f.button('select[aria-label="Navigation topology"]').onchange({target:{value:'square'}});
 if(interruption==='leave')f.city.leave();
 if(interruption==='revocation'){f.owner(false);f.tick();}
 if(interruption==='destroy')f.city.destroy();
 f.frame(120000);assert.deepEqual(f.city.snapshot().position,position);assert.equal(f.city.snapshot().walking,false);assert.equal(f.arrivals().length,0);
 if(interruption==='destroy')assert.equal(f.listeners.has('visibilitychange'),false);
});
test('every coarse-frame displacement remains on the validated waypoint path',async t=>{
 const f=await fixture(t);f.confirm();
 for(const now of [1000,4000,20000,70000,120000]){f.frame(now);const p=f.city.snapshot().position;
  assert.ok(path.points.slice(1).some((b,i)=>Math.abs(distance(path.points[i],p)+distance(p,b)-distance(path.points[i],b))<1e-7));
 }
 assert.equal(f.arrivals().length,1);
 // The real graph rejects this direct shortcut: consuming a long elapsed interval
 // must follow all clear waypoints, not interpolate straight across CT footprints.
 assert.equal(clearEdge(data,start,path.points.at(-1)),false);
});
test('invalid active position fails swept collision before a coarse-frame move can arrive',async t=>{
 const f=await fixture(t);f.confirm();
 // Simulate an invalidated starting pose through the module's exposed snapshot.
 // The runtime must still check the entire proposed segment before moving.
 Object.assign(f.city.snapshot().position,{x:100000,z:100000});
 const invalid={...f.city.snapshot().position};f.frame(12000000);
 assert.deepEqual(f.city.snapshot().position,invalid);assert.equal(f.city.snapshot().walking,false);
 assert.equal(f.arrivals().length,0);assert.equal(f.button('[data-status]').textContent,'Movement blocked; preview again.');
});

test('camera unload and reentry cannot spend the previous route or idle time',async t=>{
 const f=await fixture(t);f.confirm();f.frame(100);const stopped={...f.city.snapshot().position};
 f.viewer.camera.positionCartographic.height=1e7;f.tick();f.frame(120000);
 assert.deepEqual(f.city.snapshot().position,stopped);assert.equal(f.city.snapshot().walking,false);assert.equal(f.arrivals().length,0);
 f.viewer.camera.positionCartographic.height=360;f.tick();await new Promise(resolve=>setImmediate(resolve));
 f.at(240000);f.confirm();f.frame(240010);assert.ok(distance(stopped,f.city.snapshot().position)<=.020000001);
});
test('a five-hour visible frame gap completes only the confirmed route, exactly once',async t=>{
 const f=await fixture(t);f.confirm();f.frame(18000000);assert.deepEqual(f.city.snapshot().position,path.points.at(-1));
 f.frame(36000000);assert.equal(f.arrivals().length,1);assert.equal(f.city.snapshot().walking,false);
});
