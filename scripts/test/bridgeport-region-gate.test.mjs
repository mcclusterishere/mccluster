import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleView,regionGate} from '../../js/spatial/region-gate.mjs';
const near={lon:-73.1897895,lat:41.1804834,height:360};
const flush=()=>new Promise(r=>setImmediate(r));
test('region requires owner entry and actual nearby low camera; hysteresis bounded',async()=>{
 let loads=0,attached=0,detached=0;const g=regionGate({load:async()=>{loads++;return {};},attach:()=>attached++,detach:()=>detached++});
 for(const o of [{owner:false,entered:true},{owner:true,entered:false}])g.update({...o,view:near});g.update({owner:true,entered:true,view:{...near,height:1e7}});await flush();assert.equal(loads,0);
 g.update({owner:true,entered:true,view:near});await flush();assert.equal(attached,1);g.update({owner:true,entered:true,view:{...near,height:2200}});assert.equal(detached,0);g.update({owner:true,entered:true,view:{...near,height:2700}});assert.equal(detached,1);
 assert.equal(eligibleView({...near,lon:0}),false);g.dispose();
});
test('revocation aborts pending load and stale response cannot attach after reentry',async()=>{
 const pending=[];let attached=[];const g=regionGate({load:signal=>new Promise(resolve=>pending.push({signal,resolve})),attach:x=>attached.push(x),detach:()=>{}});
 g.update({owner:true,entered:true,view:near});await flush();g.update({owner:false,entered:true,view:near});assert.equal(pending[0].signal.aborted,true);
 g.update({owner:true,entered:true,view:near});await flush();pending[0].resolve('old');pending[1].resolve('new');await flush();assert.deepEqual(attached,['new']);g.dispose();
});
test('failed asset does not create an unbounded retry loop',async()=>{
 let loads=0,errors=0;const g=regionGate({load:async()=>{loads++;throw Error('offline');},attach:()=>{},detach:()=>{},onError:()=>errors++});
 g.update({owner:true,entered:true,view:near});await flush();for(let i=0;i<10;i++)g.update({owner:true,entered:true,view:near});await flush();assert.equal(loads,1);assert.equal(errors,1);
 g.dispose();g.update({owner:true,entered:true,view:near});await flush();assert.equal(loads,2);g.dispose();
});
