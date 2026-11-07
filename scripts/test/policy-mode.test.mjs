import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {create}=require('../../js/policy-mode-core.js');
function setup(opts={}){
  const paints=[],views=[];let calls=0;
  const c=create({verifyOwner:opts.verifyOwner||(async()=>true),show:v=>views.push(v),studio:opts.studio||(async guard=>{assert.equal(guard(),true);calls++;return {opened:true};}),paint:s=>paints.push(s)});
  return {c,paints,views,calls:()=>calls};
}
test('no authorization means no Policy views or live actions',async()=>{
  const {c,views,calls}=setup({verifyOwner:async()=>false});
  assert.equal(await c.activate(),false);assert.equal(c.select('feed'),false);assert.equal(await c.live(),false);
  assert.deepEqual(views,[]);assert.equal(calls(),0);
});
test('authorized owner switches between the existing globe and feed',async()=>{
  const {c,views,paints}=setup();assert.equal(await c.activate(),true);
  assert.equal(c.select('feed'),true);assert.equal(c.select('globe'),true);assert.equal(c.select('halo'),false);
  assert.deepEqual(views,['globe','feed','globe']);assert.match(paints.at(-1).message,/Audit publication is not connected/);
});
test('Go Live rechecks permission and describes studio opening, never a broadcast',async()=>{
  let checks=0;const {c,paints,calls}=setup({verifyOwner:async()=>{checks++;return true;}});
  await c.activate();assert.equal(await c.live(),true);assert.equal(checks,2);assert.equal(calls(),1);
  assert.match(paints.at(-1).message,/not broadcasting/);assert.equal(paints.at(-1).busy,false);
});
test('lost role denies live and withdraws the preview',async()=>{
  let checks=0;const {c,calls,paints}=setup({verifyOwner:async()=>++checks===1});
  await c.activate();assert.equal(await c.live(),false);assert.equal(calls(),0);assert.equal(paints.at(-1).active,false);
});
test('late permission answer cannot reopen revoked preview',async()=>{
  let resolve;const {c,paints}=setup({verifyOwner:()=>new Promise(r=>resolve=r)});
  const pending=c.activate();c.revoke();resolve(true);assert.equal(await pending,false);assert.equal(paints.at(-1).active,false);
});
test('role loss during studio preparation invalidates its opening guard',async()=>{
  let guard,finish;const {c,paints}=setup({studio:g=>{guard=g;return new Promise(r=>finish=r);}});
  await c.activate();const pending=c.live();await Promise.resolve();assert.equal(guard(),true);
  c.revoke();assert.equal(guard(),false);finish({opened:true});assert.equal(await pending,false);assert.equal(paints.at(-1).active,false);
});
test('provider disabled/failure remains recoverable with truthful status',async()=>{
  let attempt=0;const {c,paints}=setup({studio:async()=>{if(++attempt===1)return {opened:false,message:'Live broadcasting is not enabled.'};throw Error('offline');}});
  await c.activate();assert.equal(await c.live(),false);assert.match(paints.at(-1).message,/not enabled/);
  assert.equal(await c.live(),false);assert.match(paints.at(-1).message,/Try again/);assert.equal(paints.at(-1).busy,false);
});
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('consumer integration has three local actions, retains fellowship and has no case data client',()=>{
  const js=read('js/policy-mode.js'),html=read('mnet.html'),css=read('css/policy-mode.css');
  assert.ok(js.includes("[['live','Go Live'],['globe','Globe'],['feed','Feed']]"));
  assert.ok(js.includes("get('policy')!=='1'"));assert.match(js,/MCC_BAR\?\.verifyAdmin/);
  assert.doesNotMatch(js,/fetch\(|localStorage|\/api\/evidence|whpd|Supabase/i);
  assert.match(html,/js\/member-desk\.js/);assert.match(html,/js\/policy-mode\.js/);
  assert.doesNotMatch(css,/@media[^{]*max-width/);assert.match(css,/repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(read('js/site-navigation.js'),/href:world \+ '&policy=1'/);
});
function liveMethod(grant,guard=()=>true){
  const src=read('js/mnet-live.js'),start=src.indexOf('    studio: function (canOpen)'),end=src.indexOf('\n  };',start);
  assert.ok(start>0&&end>start);
  const dialog={open:false};let checks=0,opens=0;
  const ctx={live:{started:true},M:{},w:{RTCPeerConnection:function(){}},Promise,loadEligibility:async()=>{checks++;return grant;},openStudio:()=>{opens++;dialog.open=true;},$:()=>dialog};
  vm.runInNewContext('method=({'+src.slice(start,end)+'}).studio;',ctx);
  return {run:()=>ctx.method(guard),checks:()=>checks,opens:()=>opens};
}
test('actual live adapter checks capability and enablement before opening',async()=>{
  for(const grant of [null,{can_host:false,enabled:true},{can_host:true,enabled:false}]){
    const a=liveMethod(grant);assert.equal((await a.run()).opened,false);assert.equal(a.checks(),1);assert.equal(a.opens(),0);
  }
  const a=liveMethod({can_host:true,enabled:true});assert.equal((await a.run()).opened,true);assert.equal(a.opens(),1);
});
test('actual live adapter respects revoked caller while eligibility was loading',async()=>{
  const a=liveMethod({can_host:true,enabled:true},()=>false);assert.equal((await a.run()).opened,false);assert.equal(a.opens(),0);
});

for (const phase of ['owner check', 'studio']) test(`visibility reactivation cancels pending ${phase} and restores usable controls`, async () => {
  let checks=0,finish,staleGuard;
  const {c,paints}=setup({
    verifyOwner:()=>phase==='owner check'&&++checks===2?new Promise(r=>finish=r):Promise.resolve(true),
    studio:guard=>{staleGuard=guard;return new Promise(r=>finish=r);}
  });
  await c.activate();
  const pending=c.live();await Promise.resolve();
  assert.equal(paints.at(-1).busy,true);
  await c.activate();
  assert.equal(paints.at(-1).busy,false);
  if(staleGuard)assert.equal(staleGuard(),false);
  finish(phase==='owner check'?true:{opened:false});
  assert.equal(await pending,false);
  assert.equal(paints.at(-1).active,true);
  assert.equal(paints.at(-1).busy,false);
  assert.equal(c.select('feed'),true);
  const retry=c.live();await Promise.resolve();
  assert.equal(paints.at(-1).busy,true);
  finish({opened:false});assert.equal(await retry,false);
  assert.equal(paints.at(-1).busy,false);
});
