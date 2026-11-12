import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertDocument, renderPlan, resourceBindings, checkPublicationReadiness, processingIdentity} from '../../js/website-studio/contract.mjs';
import {frameAt, sceneProgress, attachScrollSequence, mayRequestAutoStart} from '../../js/website-studio/scroll-controller.mjs';
import {r2Cost, streamCost, standard2ProcessingCost, transformationCost, pilotEstimate} from '../../js/website-studio/cost-model.mjs';
const template=JSON.parse(await readFile(new URL('../../data/website-studio/motion-portfolio-v1.json',import.meta.url),'utf8'));
const draft=()=>structuredClone(template.default_document);
const ref=(type,key)=>({type,key});
const trans=()=>({asset_ref:ref('media_asset','clip-1'),in_ms:0,out_ms:6000,pace:'standard',focal:{desktop:{x:.5,y:.5},mobile:{x:.5,y:.5}}});
function filled(){ const d=draft(); d.mode='cinematic'; d.tiles.forEach((t,i)=>{
 t.source_ref=ref(t.kind==='music'?'music_recording':t.kind==='native_video'?'network_post':'media_asset',`source-${i}`);t.transition=trans(); });return d; }
test('blank template is a valid draft, not a publishable site', async()=>{
 assert.equal(assertDocument(draft()).tiles.length,3);
 await assert.rejects(checkPublicationReadiness(draft(),async()=>({allowed:true,ready:true,publicApproved:true})),/need a source/);
});
test('exactly three ordered content tiles, with stable unique IDs',()=>{
 const d=draft(); d.tiles.pop(); assert.throws(()=>assertDocument(d),/three/);
 const e=draft(); e.tiles[2].id=e.tiles[0].id; assert.throws(()=>assertDocument(e),/duplicate/);
 const f=draft(); f.tiles.reverse(); assert.equal(assertDocument(f).tiles[0].id,'tile-3');
});
test('one optional 360 tile, never forced 360 auto-entry',()=>{
 const d=draft(); d.tiles[0].kind='immersive360';assert.throws(()=>assertDocument(d),/at most one/);
 const e=draft(); e.tiles[2].kind='native_video';assert.doesNotThrow(()=>assertDocument(e));
 const f=draft();f.tiles[2].playback='enter_after_consent';assert.throws(()=>assertDocument(f),/explicit entry/);
});
test('three transitions plus three content tiles are six slots, not six uploads',()=>{
 const d=filled();assert.equal(renderPlan(d).length,6);
 assert.deepEqual(renderPlan(d).map(x=>x.segment),['transition','content','transition','content','transition','content']);
 assert.equal(new Set(resourceBindings(d).map(b=>`${b.ref.type}:${b.ref.key}`)).size,4);
 d.mode='standard'; assert.equal(renderPlan(d).length,3);
 d.mode='cinematic'; assert.equal(renderPlan(d,{reducedMotion:true}).length,3);
});
test('render plan is detached from editable source and preserves tile order',()=>{
 const d=filled();d.tiles.reverse();const p=renderPlan(d);assert.equal(p[0].tile_id,'tile-3');
 p[1].tile.headline='changed';assert.notEqual(d.tiles[0].headline,'changed');
});
test('unknown fields, wrong reference kinds and embedded URL sources are rejected',()=>{
 const d=draft();d.html='<script>alert(1)</script>';assert.throws(()=>assertDocument(d),/unsupported field/);
 const e=filled();e.tiles[0].source_ref.type='network_post';assert.throws(()=>assertDocument(e),/unsupported type/);
 const f=filled();f.tiles[0].source_ref.key='https://example.com/master.mp3';assert.throws(()=>assertDocument(f),/invalid reference/);
});
test('validated links reject script URLs and credentials; purchases reference existing offers',()=>{
 const d=draft();d.tiles[0].action={kind:'link',label:'Visit',url:'javascript:alert(1)'};assert.throws(()=>assertDocument(d),/HTTPS/);
 d.tiles[0].action.url='https://user:secret@example.com/';assert.throws(()=>assertDocument(d),/HTTPS/);
 d.tiles[0].action={kind:'purchase',label:'Buy',offer_ref:ref('commerce_offer','offer-1')};assert.doesNotThrow(()=>assertDocument(d));
 d.tiles[0].action.price_cents=1;assert.throws(()=>assertDocument(d),/unsupported field/);
});
test('transition trim and focal points are bounded',()=>{
 const d=filled();d.tiles[0].transition.out_ms=13000;assert.throws(()=>assertDocument(d),/segment/);
 d.tiles[0].transition.out_ms=6000;d.tiles[0].transition.focal.mobile.x=2;assert.throws(()=>assertDocument(d),/focal point/);
});
test('publish adapter is checked for every slot and offer; removal blocks publication',async()=>{
 const d=filled();d.tiles[0].action={kind:'purchase',label:'Buy',offer_ref:ref('commerce_offer','offer-1')};let n=0;
 assert.equal((await checkPublicationReadiness(d,async(b,ctx)=>{n++;assert.equal(ctx.purpose,'publish');return {allowed:true,ready:true,publicApproved:true};})).ready,true);
 assert.equal(n,7);
 for(const bad of [{allowed:false,ready:true,publicApproved:true},{allowed:true,ready:false,publicApproved:true},{allowed:true,ready:true,publicApproved:false},{allowed:true,ready:true,publicApproved:true,removed:true}])
 await assert.rejects(checkPublicationReadiness(d,async()=>bad),/unavailable/);
});
test('processing identity is tenant-scoped and independent of copy/order',()=>{
 const input={tenant_key:'owner-1',source_sha256:'a'.repeat(64),in_ms:0,out_ms:6000,width:768,height:432,sample_fps:20,focal_x:.5,focal_y:.5,processor_version:'native-v1'};
 const p=processingIdentity(input);assert.equal(processingIdentity({...input,headline:'new text',tile_order:3}),p);
 assert.notEqual(processingIdentity({...input,tenant_key:'owner-2'}),p);
 assert.notEqual(processingIdentity({...input,out_ms:5000}),p);
 assert.notEqual(processingIdentity({...input,processor_version:'native-v2'}),p);
});
test('frame mapping is deterministic, reversible and clamped',()=>{
 assert.equal(frameAt(0,161),0);assert.equal(frameAt(.5,161),80);assert.equal(frameAt(1,161),160);
 assert.equal(frameAt(.25,161),40);assert.equal(frameAt(-2,161),0);assert.equal(frameAt(2,161),160);
 assert.equal(frameAt(.7,1),0);assert.throws(()=>frameAt(NaN,3));assert.throws(()=>frameAt(0,0));
 assert.equal(sceneProgress(-500,2000,1000),.5);assert.equal(sceneProgress(10,2000,1000),0);
});
function fakeWindow(){
 const events=new Map(),changes=new Set(),queue=new Map();let next=1;
 const win={innerHeight:1000,matchMedia:()=>reduced,requestAnimationFrame(fn){const id=next++;queue.set(id,fn);return id;},cancelAnimationFrame(id){queue.delete(id);},
 addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener(name,fn){events.get(name)?.delete(fn);}};
 const reduced={matches:false,addEventListener(_,fn){changes.add(fn);},removeEventListener(_,fn){changes.delete(fn);}};
 return {win,queue,events,reduced,emit(name){events.get(name)?.forEach(fn=>fn());},flush(){const q=[...queue.values()];queue.clear();q.forEach(fn=>fn());},reduce(){reduced.matches=true;changes.forEach(fn=>fn());},changes};
}
test('native controller batches events, holds on stop, reverses and cleans up',()=>{
 const f=fakeWindow();let top=0;const frames=[];const element={getBoundingClientRect:()=>({top,height:2000})};
 const c=attachScrollSequence({element,frameCount:101,onFrame:i=>frames.push(i),win:f.win});
 f.flush();top=-500;for(let i=0;i<10;i++)f.emit('scroll');assert.equal(f.queue.size,1);f.flush();
 f.emit('scroll');f.flush();assert.deepEqual(frames,[0,50]);top=-250;f.emit('scroll');f.flush();assert.equal(frames.at(-1),25);
 f.reduce();f.flush();assert.equal(frames.at(-1),0);c.refresh();c.destroy();assert.equal(f.queue.size,0);
 assert.equal(f.events.get('scroll').size,0);assert.equal(f.changes.size,0);c.refresh();assert.equal(f.queue.size,0);
});
test('autoplay intent cannot bypass visitor sound consent or force 360 entry',()=>{
 const a={intent:'enter_after_consent',visitorSoundEnabled:true,visible:true,kind:'music'};
 assert.equal(mayRequestAutoStart(a),true);
 for(const change of [{visitorSoundEnabled:false},{visible:false},{kind:'immersive360'},{reducedMotion:true},{intent:'manual'}])assert.equal(mayRequestAutoStart({...a,...change}),false);
});
test('R2 published rates, shared allowances and upward operation units',()=>{
 assert.ok(Math.abs(r2Cost({gbMonths:100})-1.35)<1e-9);assert.ok(Math.abs(r2Cost({gbMonths:1000})-14.85)<1e-9);
 assert.equal(r2Cost({gbMonths:0,classB:10000001}),.36);
 assert.equal(r2Cost({gbMonths:0,classA:1000001}),4.5);assert.throws(()=>r2Cost({gbMonths:-1}));
});
test('Stream storage uses purchased blocks, delivery meters separately',()=>{
 assert.equal(streamCost({storedMinutes:500,deliveredMinutes:10000}),15);
 assert.equal(streamCost({storedMinutes:1001,deliveredMinutes:100000}),110);
});
test('native compute pricing and modeled pilot are capacity assumptions, not benchmarks',()=>{
 assert.ok(Math.abs(standard2ProcessingCost({busyHours:1,allowances:false})-.129024)<1e-9);
 assert.ok(Math.abs(standard2ProcessingCost({busyHours:100})-12.177)<1e-9);
 assert.equal(Number(pilotEstimate().total.toFixed(2)),33.53);
});
test('transformation method dramatically changes operation count; beta is explicit',()=>{
 assert.equal(transformationCost({operations:3*6*2*1000}),15.5);
 assert.equal(transformationCost({operations:3*6*20*2*1000}),357.5);
 assert.equal(transformationCost({operations:720000,bindingBetaUnbilled:true}),0);
});

test('standard publication does not prepare or publish dormant transitions',async()=>{
 const d=filled();d.mode='standard';let count=0;
 await checkPublicationReadiness(d,async b=>{assert.equal(b.role,'content');count++;return {allowed:true,ready:true,publicApproved:true};});
 assert.equal(count,3);assert.equal(resourceBindings(d).length,6);
});
