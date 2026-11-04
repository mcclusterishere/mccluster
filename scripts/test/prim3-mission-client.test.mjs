import test from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeClient } from '../../js/prim3-mission/client.mjs';
const uid='00000000-0000-4000-8000-000000000001',sid='10000000-0000-4000-8000-000000000001';
function setup(){const saved=new Map(),requests=[];let auth='owner-token',lose=false;const storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
const fetchImpl=async(url,init)=>{requests.push({url,init});if(lose)throw new Error('offline');return Response.json(init.method==='GET'&&url.endsWith('/adaptive')?{owner_id:uid,enabled:true}:{session_id:sid,flow:{nextSeq:1,question:{id:'q1'}}});};
return{saved,requests,storage,fetchImpl,token:()=>auth,setToken:v=>{auth=v;},offline:()=>{lose=true;}};}
test('review and integer validation happen before queuing or network writes',async()=>{
const t=setup(),c=createPracticeClient(t);await c.connect();
assert.throws(()=>c.start({}),/both/);assert.equal(t.requests.length,1);assert.equal(c.pending,false);
await c.start({fictionChecked:true,geographyChecked:true});assert.throws(()=>c.submit('answer',{answer:''}),/whole-number/);assert.equal(c.pending,false);
});
test('lost request stays scoped to verified owner and retries exact body',async()=>{
const t=setup(),c=createPracticeClient(t);await c.connect();await c.start({fictionChecked:true,geographyChecked:true});t.offline();
await assert.rejects(c.submit('answer',{answer:'7'}),/offline/);assert.equal(c.pending,true);
const saved=JSON.parse(t.saved.get(`prim3.adaptive.pending.v1:${uid}`));assert.equal(saved.pending.body.answer,'7');
await assert.rejects(c.retry(),/offline/);assert.equal(t.requests.at(-1).init.body,t.requests.at(-2).init.body);
c.clear();assert.equal(t.saved.size,0);
});
test('account change during response discards old pending account data',async()=>{
const t=setup();const base=t.fetchImpl;let flip=false;t.fetchImpl=async(...args)=>{const r=await base(...args);if(flip)t.setToken('other');return r;};
const c=createPracticeClient(t);await c.connect();flip=true;
await assert.rejects(c.start({fictionChecked:true,geographyChecked:true}),/Account changed/);assert.equal(c.pending,false);assert.equal(t.saved.size,0);
});
test('storage failure refuses mutation rather than losing a queue',async()=>{
const t=setup();t.storage.setItem=()=>{throw new Error('quota');};const c=createPracticeClient(t);await c.connect();
await assert.rejects(c.start({fictionChecked:true,geographyChecked:true}),/nothing was submitted/);assert.equal(t.requests.length,1);assert.equal(c.pending,false);
});
