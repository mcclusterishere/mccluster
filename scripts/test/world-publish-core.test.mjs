import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {create}=require('../../js/world-publish-core.js');
function fixture() {
 let user='alice', configured=true, account='account-a', fail=true, uploads=0, creates=0, keys=[];
 const jobs=new Map(), calls=[];
 const core=create({currentUser:()=>user,randomKey:()=> 'stable-fixture-key',onChange:()=>{},uploadFile:async()=>{uploads++;},api:async(path,init)=>{
  calls.push([path,init]);
  if(path.includes('/status?'))return {configured,connection:{status:'connected',account_id:account}};
  if(path.endsWith('/uploads'))return {upload_url:'https://fixture.invalid/upload',storage_path:'org-a/file.mp4'};
  if(path.endsWith('/publish')){const key=init.body.idempotency_key;keys.push(key);if(!jobs.has(key)){creates++;jobs.set(key,{id:'job-one',state:'queued'});}if(fail){fail=false;throw Error('Response lost after accepted');}return {publish_job:jobs.get(key)};}
  if(path.includes('/jobs?'))return {jobs:[{id:'job-one',state:'published'}]};
  if(path.endsWith('/retry'))return {publish_job:{id:'job-one',state:'queued'}};
  throw Error('Unexpected '+path);
 }});
 return {core,calls,get uploads(){return uploads;},get creates(){return creates;},get keys(){return keys;},set user(v){user=v;},set configured(v){configured=v;},set account(v){account=v;},set fail(v){fail=v;}};
}
const input={org:'org-a',account:'account-a',handle:'alice',caption:'Hello',visibility:'public',media:[{file:{name:'video.mp4',type:'video/mp4',size:100}}]};
test('World succeeds once; ambiguous Instagram failure retries same key and creates one external job',async()=>{
 const f=fixture();let worldPosts=0;
 async function post(){const delivery=f.core.snapshot(input);worldPosts++;await f.core.worldSucceeded(delivery,'world-one');return delivery;}
 const delivery=await post();assert.equal(delivery.state,'failed');
 await f.core.retry(delivery);
 assert.equal(worldPosts,1);assert.equal(f.creates,1);assert.equal(f.uploads,1);assert.deepEqual(f.keys,['stable-fixture-key','stable-fixture-key']);
 assert.equal(delivery.state,'queued');await f.core.refresh(delivery);assert.equal(delivery.state,'published');
 assert.ok(f.calls.every(([path])=>!path.includes('/mnet/posts')));
});
test('World default has no external request; missing video/private content fails only opt-in validation',()=>{
 const f=fixture();assert.equal(f.core.snapshot({...input,org:null}),null);assert.equal(f.calls.length,0);
 assert.throws(()=>f.core.snapshot({...input,visibility:'private'}),/Instagram is public/);
 assert.throws(()=>f.core.snapshot({...input,media:[]}),/exactly one/);
 assert.throws(()=>f.core.snapshot({...input,media:[{file:{type:'image/png',size:100}}]}),/exactly one/);
});
test('provider disconnected after selection leaves World success intact and can retry after reconnect',async()=>{
 const f=fixture();f.configured=false;f.fail=false;
 const r=f.core.snapshot(input);await f.core.worldSucceeded(r,'world-one');
 assert.equal(r.worldId,'world-one');assert.equal(r.state,'failed');assert.equal(f.uploads,0);
 f.configured=true;await f.core.retry(r);assert.equal(r.state,'queued');assert.equal(f.creates,1);
});
test('switching accounts cannot retry or refresh another account’s delivery',async()=>{
 const f=fixture();const r=f.core.snapshot(input);await f.core.worldSucceeded(r,'world-one');
 f.user='bob';const count=f.calls.length;
 await assert.rejects(f.core.retry(r),/original account/);await assert.rejects(f.core.refresh(r),/original account/);
 assert.equal(f.calls.length,count);f.core.reset();assert.equal(f.core.records().length,0);assert.equal(r.file,null);
});
test('reconnecting a different Instagram account never silently redirects retained delivery',async()=>{
 const f=fixture();const r=f.core.snapshot(input);f.account='account-b';await f.core.worldSucceeded(r,'world-one');
 assert.equal(r.state,'failed');assert.match(r.error,/account changed/);assert.equal(f.creates,0);
});
test('external starts only after confirmed World id and repeated success notification cannot duplicate it',async()=>{
 const f=fixture();f.fail=false;const r=f.core.snapshot(input);
 assert.throws(()=>f.core.worldSucceeded(r,null),/post identifier/);assert.equal(f.calls.length,0);
 await f.core.worldSucceeded(r,'world-one');await f.core.worldSucceeded(r,'world-one');assert.equal(f.creates,1);
});
test('mnet preserves its existing post path and starts external work only inside World success',async()=>{
 const source=await readFile(new URL('../../js/mnet.js',import.meta.url),'utf8');
 const block=source.slice(source.indexOf('  function createPost()'),source.indexOf('  // a post can be'));
 assert.equal((block.match(/api\("\/v1\/mnet\/posts/g)||[]).length,1);
 assert.match(block,/\.then\(function \(out\) \{\s*if \(window\.MCC_WORLD_COMPOSER && externalDelivery\)/);
 assert.ok(block.indexOf('worldSucceeded(externalDelivery')<block.indexOf('clearMediaQueue()'));
 assert.match(block,/if \(button.disabled\) return;/);
});
