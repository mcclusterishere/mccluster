import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const settle=()=>new Promise(r=>setImmediate(r));
test('an empty proof queue settles once; failures show a retry without looping',async()=>{
 for(const fail of [false,true]){
 const context={window:{CR:{}},location:{search:''},URLSearchParams,console};vm.createContext(context);vm.runInContext(read('js/control-room/action-network.js'),context);
 const api=context.window.CR.actionNetwork,A=api.state;let calls=0;
 Object.assign(A,{loaded:true,sel:'c',tab:'reviews',campaigns:[{id:'c',title:'Fixture'}],detail:{c:{errors:[]}},antiLoaded:true});
 api.init({supa:async()=>{calls++;if(fail)throw Error('offline');return [];},render:()=>api.render()});
 api.render();await settle();await settle();
 const out=api.render();assert.equal(calls,1);assert.ok(A.proofLoaded);assert.equal(A.proofBusy,false);assert.match(out,fail?/Retry proof queue/:/Review queue clear/);
 }
});
test('HTTP-success unavailable envelopes do not erase a last good Halo answer',async()=>{
 const replies=[{missions:[{id:'one'}]}, {unavailable:true,missions:[],counts:{active:0}}];
 const context={window:{},document:{hidden:false},fetch:async()=>({ok:true,status:200,json:async()=>replies.shift()}),setInterval:()=>1,clearInterval,Date,Intl};
 vm.createContext(context);vm.runInContext(read('js/halo/data.js'),context);
 const d=context.window.HaloData.create({api:'https://fixture.invalid',token:()=>''});
 await d.get('missions');await d.refresh('missions');assert.equal(d.peek('missions').body.missions[0].id,'one');assert.match(d.peek('missions').error,/unavailable/);d.destroy();
});
test('initial unavailable Halo read remains unknown, not a valid zero',async()=>{
 const context={window:{},document:{hidden:false},fetch:async()=>({ok:true,status:200,json:async()=>({unavailable:true,counts:{active:0},missions:[]})}),setInterval:()=>1,clearInterval,Date,Intl};
 vm.createContext(context);vm.runInContext(read('js/halo/data.js'),context);const d=context.window.HaloData.create({api:'',token:()=>''});await d.get('missions');assert.equal(d.peek('missions').body,null);assert.match(d.peek('missions').error,/unavailable/);
});
test('mission destinations carry record and intent and brief destinations carry edition',()=>{
 const s=read('js/halo/halo.js');assert.match(s,/taskLink\('reviews', m.id\)/);assert.match(s,/taskLink\('missions', m.id\)/);assert.match(s,/briefLink\(b\)/);assert.match(s,/completed: 'Closed'/);assert.match(s,/coverage\('people'\)/);
});
