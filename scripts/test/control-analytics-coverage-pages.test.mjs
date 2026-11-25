import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile('js/control-room/analytics.js','utf8');
function setup(request){
 const context={window:{CR:{}},console};vm.createContext(context);vm.runInContext(source,context);
 const A=context.window.CR.analytics;A.init({request,supa:()=>Promise.resolve([])});
 A.state.range={since:'2026-10-01T00:00:00Z',until:'2026-10-02T00:00:00Z'};return A;
}
const response=(offset,next)=>({ok:true,datasets:[{key:'dataset-'+offset}],metrics:{['dataset-'+offset]:{count:0,status:'measured'}},summary:{datasets:1,populated:0,empty:1,quiet:0,unavailable:0},pagination:{offset,next_offset:next,total:2}});
test('coverage loader assembles every page and preserves empty measurements',async()=>{
 const calls=[];const A=setup(async path=>{calls.push(path);return calls.length===1?response(0,1):response(1,null);});
 await A.loadCoverage();assert.equal(calls.length,2);assert.match(calls[1],/limit=12&offset=1/);
 assert.equal(A.state.data.coverage.datasets.length,2);assert.equal(A.state.data.coverage.summary.empty,2);assert.equal(A.state.errors.coverage,undefined);
});
test('a failed second page cannot be presented as a complete inventory',async()=>{
 let calls=0;const A=setup(async()=>{if(++calls===1)return response(0,1);throw Error('Page unavailable');});
 await A.loadCoverage();assert.ok(A.state.errors.coverage);assert.equal(A.state.data.coverage==null,true);
});
test('non-advancing pagination is rejected instead of looping',async()=>{
 let calls=0;const A=setup(async()=>{calls++;return response(0,0);});await A.loadCoverage();
 assert.equal(calls,1);assert.ok(A.state.errors.coverage);
});
