import test from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeClient } from '../../js/prim3-mission/client.mjs';
const uid='00000000-0000-4000-8000-000000000001',sid='10000000-0000-4000-8000-000000000001';
function setup({nextSeq=1,attempts=0}={}){const saved=new Map(),requests=[];let auth='owner-token',lose=false;const storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
const fetchImpl=async(url,init)=>{requests.push({url,init});if(lose)throw new Error('offline');return Response.json(init.method==='GET'&&url.endsWith('/adaptive')?{owner_id:uid,enabled:true,max_events:32}:{session_id:sid,flow:{nextSeq,question:{id:'q1'},debrief:{attempts}}});};
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
test('final event slot rejects answers and hints before persistence while allowing debrief',async()=>{
const t=setup({nextSeq:32,attempts:29}),c=createPracticeClient(t);await c.connect();await c.start({fictionChecked:true,geographyChecked:true});
const count=t.requests.length,saved=t.saved.get(`prim3.adaptive.pending.v1:${uid}`);
for(const type of ['answer','hint']) assert.throws(()=>c.submit(type,{answer:'7'}),/debrief/);
assert.equal(t.requests.length,count);assert.equal(t.saved.get(`prim3.adaptive.pending.v1:${uid}`),saved);assert.equal(c.pending,false);
assert.equal(c.mustFinish,true);await c.submit('finish',{outcome:'abandoned'});
assert.equal(JSON.parse(t.requests.at(-1).init.body).seq,32);assert.equal(c.pending,false);
});
test('reserve an answer before the final slot when only scaffolds have been used',async()=>{
const t=setup({nextSeq:31}),c=createPracticeClient(t);await c.connect();await c.start({fictionChecked:true,geographyChecked:true});
assert.equal(c.mustAnswer,true);assert.throws(()=>c.submit('hint'),/answer/i);assert.equal(c.pending,false);
await c.submit('answer',{answer:'7'});assert.equal(JSON.parse(t.requests.at(-1).init.body).seq,31);
});
test('new practice requires acknowledged closed debrief and clears only local session state',async()=>{
  const t=setup(),base=t.fetchImpl;let closed=false;
  t.fetchImpl=async(...args)=>{const r=await base(...args),v=await r.json();if(v.flow){v.flow.phase=closed?'debrief':'play';v.evidence={closed};}return Response.json(v);};
  const c=createPracticeClient(t);await c.connect();await c.start({fictionChecked:true,geographyChecked:true});
  assert.throws(()=>c.newPractice(),/debrief/);closed=true;await c.submit('finish',{outcome:'abandoned'});
  const calls=t.requests.length;c.newPractice();assert.equal(c.current,null);assert.equal(c.pending,false);assert.equal(t.requests.length,calls);
  await c.start({fictionChecked:true,geographyChecked:true});assert.equal(t.requests.length,calls+1);
});
test('lost reviewed lattice start retains the exact versioned context',async()=>{
 const t=setup(),c=createPracticeClient(t);await c.connect();t.offline();
 const context={version:'prim3.lattice-learning/v1',variant:'city',topology:'hex'};
 await assert.rejects(c.start({fictionChecked:true,geographyChecked:true},{releaseId:sid,learningContext:context}),/offline/);
 const saved=JSON.parse(t.saved.get(`prim3.adaptive.pending.v1:${uid}`));assert.deepEqual(saved.pending.body.learning_context,context);
 await assert.rejects(c.retry(),/offline/);assert.equal(t.requests.at(-1).init.body,t.requests.at(-2).init.body);
});
test('unavailable release detachment preserves rejected queue until server confirmation, including reload',async()=>{
 const t=setup(),base=t.fetchImpl,rid='20000000-0000-4000-8000-000000000001';let available=true,deny=false;
 t.fetchImpl=async(url,init)=>{
  if(url.endsWith(`/releases/${rid}`)){if(deny)throw Error('offline');return Response.json({release:{id:rid,available}});}
  if(init.method==='POST'&&url.endsWith('/events'))return Response.json({error:'Release expired'},{status:409});
  const r=await base(url,init),v=await r.json();if(v.flow){v.flow.phase='play';v.released_mission={id:rid};}return Response.json(v);
 };
 let c=createPracticeClient(t);await c.connect();await c.start({fictionChecked:true,geographyChecked:true},{releaseId:rid});
 await assert.rejects(c.submit('finish',{outcome:'abandoned'}),/expired/);
 const saved=t.saved.get(`prim3.adaptive.pending.v1:${uid}`);
 c=createPracticeClient(t);await c.connect();assert.equal(c.pending,true);
 await assert.rejects(c.leaveUnavailableRelease(),/still available/);assert.equal(t.saved.get(`prim3.adaptive.pending.v1:${uid}`),saved);
 available=false;deny=true;await assert.rejects(c.leaveUnavailableRelease(),/offline/);assert.equal(c.pending,true);
 deny=false;await c.leaveUnavailableRelease();assert.equal(c.current,null);assert.equal(c.pending,false);assert.equal(t.saved.size,0);
 await c.start({fictionChecked:true,geographyChecked:true},{releaseId:rid});assert.equal(c.current.session_id,sid);
});
test('expired rejected start can detach without a current session and never posts a synthetic finish',async()=>{
 const t=setup(),base=t.fetchImpl,rid='20000000-0000-4000-8000-000000000002',writes=[];
 t.fetchImpl=async(url,init)=>{
  if(init.method==='POST'){writes.push(JSON.parse(init.body));return Response.json({error:'Release expired'},{status:409});}
  if(url.endsWith(`/releases/${rid}`))return Response.json({release:{id:rid,available:false}});
  return base(url,init);
 };
 const c=createPracticeClient(t);await c.connect();await assert.rejects(c.start({fictionChecked:true,geographyChecked:true},{releaseId:rid}),/expired/);
 assert.equal(c.current,null);assert.equal(c.releaseId,rid);await c.leaveUnavailableRelease();assert.equal(c.pending,false);assert.equal(writes.length,1);assert.equal(writes[0].type,undefined);
});
