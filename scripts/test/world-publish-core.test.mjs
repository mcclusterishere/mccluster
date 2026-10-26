import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const {create}=createRequire(import.meta.url)('../../js/world-publish-core.js');
const input={org:'org-a',account:'account-a',caption:'Hello',visibility:'public',media:[{id:'video',file:{type:'video/mp4',size:123}}]};
function fixture(){
 let user='alice',fail=true,version=0,held=null;
 const saved={id:'delivery',user:'alice',org:'org-a',account:'account-a',worldId:'world',jobId:'job',state:'draft'};
 const calls=[];
 const api=async(path,init)=>{calls.push([path,init]);if(path==='/v1/mnet/deliveries'){const result={deliveries:user==='alice'?[{...saved}]:[]};if(held)return new Promise(resolve=>{held.resolve=()=>resolve(result);});return result;}
 if(path.endsWith('/submit')){saved.state='queued';if(fail){fail=false;throw Error('Lost response');}return {publish_job:{id:'job',state:saved.state}};}throw Error('Unexpected '+path);};
 const make=()=>create({api,currentUser:()=>user,randomKey:()=>`key-${++version}`,onChange:()=>{}});
 return {make,saved,calls,set user(v){user=v;},hold(){held={};return ()=>{held.resolve();held=null;};}};
}
test('stable operation binds complete World payload across ambiguous retries',()=>{
 const f=fixture(),c=f.make(),r=c.snapshot(input),draft={body:'Hello',media_asset_ids:['video']};
 const a=c.request(r,draft),b=c.request(c.snapshot(input),draft);assert.equal(a.operation_key,b.operation_key);
 assert.notEqual(c.request(c.snapshot(input),{...draft,body:'Edited'}).operation_key,a.operation_key);
});
test('reload after World commit and lost external response recovers same job without another World request',async()=>{
 const f=fixture(),c=f.make(),r=c.snapshot(input);
 await c.worldSucceeded(r,{post:{id:'world'},delivery:{...f.saved}});
 assert.equal(c.records()[0].error,'Lost response');
 const reloaded=f.make();await reloaded.recover();assert.equal(reloaded.records()[0].state,'queued');
 await reloaded.retry(reloaded.records()[0]);assert.equal(f.calls.filter(([p])=>p.endsWith('/submit')).length,2);
 assert.ok(f.calls.every(([p])=>!p.includes('/posts')&&!p.includes('/uploads')));
 assert.equal(reloaded.records()[0].jobId,'job');
});
test('stale history response cannot overwrite newer submit status',async()=>{
 const f=fixture(),c=f.make();await c.recover();await c.retry(c.records()[0]);
 f.saved.state='failed';const release=f.hold();const older=c.recover();
 await c.retry(c.records()[0]);release();await older;
 assert.equal(c.records()[0].state,'queued'); // late failed response cannot roll back acknowledged queue state
});
test('two accounts cannot recover/manage one another, including in-flight auth changes',async()=>{
 const f=fixture(),c=f.make();await c.recover();const r=c.records()[0];f.user='bob';
 await assert.rejects(c.retry(r),/original account/);await assert.rejects(c.refresh(r),/original account/);
 c.reset();await c.recover();assert.equal(c.records().length,0);
});
test('World default no external request; opt-in validation and confirmation required',()=>{
 const f=fixture(),c=f.make();assert.equal(c.snapshot({...input,org:null}),null);
 assert.throws(()=>c.snapshot({...input,visibility:'private'}),/Instagram is public/);
 assert.throws(()=>c.snapshot({...input,media:[]}),/exactly one/);
 assert.throws(()=>c.worldSucceeded(c.snapshot(input),{post:{id:'world'}}),/confirmation missing/);
 assert.equal(f.calls.length,0);
});
test('mnet keeps one World post path and adds explicit delivery before posting',async()=>{
 const source=await readFile(new URL('../../js/mnet.js',import.meta.url),'utf8');
 const block=source.slice(source.indexOf('  function createPost()'),source.indexOf('  // a post can be'));
 assert.equal((block.match(/api\("\/v1\/mnet\/posts/g)||[]).length,1);
 assert.match(block,/if \(externalDelivery\) draft.delivery = window.MCC_WORLD_COMPOSER.request/);
 assert.ok(block.indexOf('worldSucceeded(externalDelivery')<block.indexOf('clearMediaQueue()'));
});
