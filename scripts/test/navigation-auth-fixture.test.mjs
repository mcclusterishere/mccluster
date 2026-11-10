import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {seedNavigationAuth} from '../e2e/support/navigation-auth-fixture.mjs';

function run({child=false,signed=true,source=seedNavigationAuth.toString()}={}) {
  const writes=[],window={};window.top=child?{}:window;
  vm.runInNewContext(`(${source})(${JSON.stringify({signed,USER:'fixture-owner'})})`,{
    window,localStorage:{setItem:(...entry)=>writes.push(entry)},
    requestAnimationFrame:()=>{},btoa:value=>Buffer.from(value).toString('base64'),
  });
  return {writes,window};
}

test('navigation auth seeds the signed-in top page and keeps its frame sampler',()=>{
  const {writes,window}=run();
  assert.deepEqual(writes.map(([key])=>key),['mcc_privacy_ack','mccdb_session']);
  assert.equal(JSON.parse(writes[1][1]).user.id,'fixture-owner');
  assert.equal(Array.isArray(window.__navFrames),true);
});

test('guest navigation seeds privacy without manufacturing a session',()=>{
  assert.deepEqual(run({signed:false}).writes.map(([key])=>key),['mcc_privacy_ack']);
});

test('same-origin nested frames never reseed shared auth or navigation state',()=>{
  const child=run({child:true});
  assert.deepEqual(child.writes,[]);
  assert.equal(child.window.__navFrames,undefined);
});

test('the previous unguarded init behavior reproduces child auth writes',()=>{
  const oldBehavior=seedNavigationAuth.toString().replace('if (window !== window.top) return;','');
  const child=run({child:true,source:oldBehavior});
  assert.equal(child.writes.some(([key])=>key==='mccdb_session'),true);
});
