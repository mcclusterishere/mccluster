/* The production browser module runs in a fake browser to verify its auth
   boundary. No remote requests, real users or jobs are involved. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const CODE = readFileSync(new URL('../../../js/control-room/build-code.js', import.meta.url), 'utf8');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const JOB = '623e4567-e89b-42d3-a456-426614174555';
const KEY = '923e4567-e89b-42d3-a456-426614174555';
const STORE = 'cr_build_code_last', PENDING = 'cr_build_code_pending';
const flush = () => new Promise(r => setImmediate(r));
function harness(initialUser='',seed={},requestOverride=null) {
  let user=initialUser;
  const db=new Map(Object.entries(seed));
  const posts=[],gets=[];
  const storage={getItem:k=>db.has(k)?db.get(k):null,setItem:(k,v)=>db.set(k,String(v)),removeItem:k=>db.delete(k)};
  const window={CR:{},MCC_SUPA:{uid:()=>user},crypto:{randomUUID:()=>KEY},addEventListener(){}};
  const document={hidden:false,addEventListener(){}};
  const request=(path,options)=>{
    if(requestOverride)return requestOverride(path,options);
    if(options?.method==='POST'){posts.push(options.body);return Promise.resolve({job_id:JOB,receipt:{state:'queued'}});}
    if(path.endsWith('/'+JOB)){gets.push(path);return Promise.resolve({receipt:{state:'queued',title:'Private build receipt'}});}
    return Promise.resolve({enabled:true,repositories:['mcclusterishere/mccluster']});
  };
  const timers={setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}};
  runInNewContext(CODE,{window,document,localStorage:storage,Date,...timers});
  const instance=window.CR.buildCode;
  instance.init({request,render:()=>{},orgId:'o1'});
  return {instance,posts,gets,db,setUser:v=>{user=v}};
}
test('stored private build stays hidden while signed out and under another account',{concurrency:false},async()=>{
  const seed={
    [STORE]:JSON.stringify({user:A,job_id:JOB,key:KEY}),
    [PENDING]:JSON.stringify({user:A,body:{repository:'mcclusterishere/mccluster',task:'Secret A objective',idempotency_key:KEY,allowed_paths:[]}})
  };
  const h=harness('',seed);
  assert.match(h.instance.render(),/Sign in to view or recover/);
  assert.equal(h.instance.state.job,null);
  h.setUser(B);
  const other=h.instance.render();
  assert.equal(h.instance.state.job,null);
  assert.equal(h.instance.state.form.task,'');
  assert.doesNotMatch(other,/Secret A objective|Private build receipt/);
  assert.equal(h.posts.length,0,'account B cannot resubmit account A pending work');
  h.setUser(A);
  h.instance.render();
  await flush();
  assert.equal(h.instance.state.job,JOB,'original account can recover its saved job');
  assert.equal(h.posts.length,0,'a known job is read, not submitted again');
  assert.equal(h.gets.length,1);
});
test('a pending submission may be replayed only as its exact original owner',{concurrency:false},async()=>{
  const h=harness(B,{[PENDING]:JSON.stringify({user:A,body:{
    repository:'mcclusterishere/mccluster',task:'Private task from A',title:'',
    allowed_paths:['scripts/test'],idempotency_key:KEY}})});
  h.instance.render();await flush();
  assert.equal(h.posts.length,0);
  h.setUser('');
  assert.match(h.instance.render(),/Sign in/);
  h.setUser(A);
  h.instance.render();await flush();
  assert.equal(h.posts.length,1);
  assert.equal(h.posts[0].task,'Private task from A');
  assert.equal(h.posts[0].idempotency_key,KEY);
});
test('receipt-read failure retains recovery controls',{concurrency:false},async()=>{
  let attempts=0;
  const request=(path)=>{
    if(path.endsWith('/'+JOB)){attempts++;return attempts===1?Promise.reject(Object.assign(new Error('Temporary API outage'),{status:503})):Promise.resolve({receipt:{state:'queued'}});}
    return Promise.resolve({enabled:true,repositories:['mcclusterishere/mccluster']});
  };
  const h=harness(A,{[STORE]:JSON.stringify({user:A,job_id:JOB,key:KEY})},request);
  await flush();
  const html=h.instance.render();
  assert.match(html,/Temporary API outage/);
  assert.match(html,/data-crb="refresh"/);
  assert.match(html,/data-crb="new"/);
});
test('in-flight receipt response is discarded when account changes',{concurrency:false},async()=>{
  let resolveReceipt;
  const request=(path)=>{
    if(path.endsWith('/'+JOB))return new Promise(resolve=>{resolveReceipt=resolve});
    return Promise.resolve({enabled:true,repositories:['mcclusterishere/mccluster']});
  };
  const h=harness(A,{[STORE]:JSON.stringify({user:A,job_id:JOB,key:KEY})},request);
  h.setUser(B);
  h.instance.render();
  resolveReceipt({receipt:{state:'completed',title:'A confidential receipt'}});
  await flush();
  assert.equal(h.instance.state.job,null);
  assert.equal(h.instance.state.receipt,null,'A response cannot overwrite B state');
});
