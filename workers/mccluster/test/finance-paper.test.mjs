import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCashOrder, replayDemo } from '../src/finance/paper.js';
import { handleIntelRequest } from '../src/intel/router.js';
import { IntelError } from '../src/intel/store.js';
test('deterministic replay, balanced journal and exact duplicate idempotency', () => {
  const commands=[{id:'one',side:'buy',quantity:5},{id:'two',side:'sell',quantity:2}];
  const p=replayDemo(commands);
  assert.equal(p.shares,3);assert.equal(p.cash_cents,969970);
  assert.deepEqual(replayDemo([...commands,commands[0]]),p);
  assert.equal(p.persisted,false);assert.equal(p.freshness.is_live,false);
  for(const fill of p.fills)assert.equal(fill.journal.reduce((n,x)=>n+x.cents,0),0);
  assert.throws(()=>replayDemo([commands[0],{...commands[0],quantity:6}]),/idempotency_conflict/);
});
test('rejects overspend, shorts, fractions, negative shares and forged prices',()=>{
  for(const command of [{id:'a',side:'buy',quantity:1000},{id:'a',side:'sell',quantity:1},
    {id:'a',side:'buy',quantity:.5},{id:'a',side:'buy',quantity:-1},{id:'a',side:'buy',quantity:1,price:1}])assert.throws(()=>replayDemo([command]));
  assert.throws(()=>replayDemo(Array(101).fill({id:'a',side:'buy',quantity:1})),/too_many_orders/);
});
test('execution rejects stale, prior, halted, wrong currency and non-synthetic observations',()=>{
  const order={side:'buy',quantity:1,symbol:'DEMO',submitted_at:100000};
  const q={synthetic:true,symbol:'DEMO',currency:'USD',at:160000,received_at:160000,bid_cents:9990,ask_cents:10010};
  for(const patch of [{at:100000},{received_at:220001},{halted:true},{currency:'EUR'},{synthetic:false},{bid_cents:10011}]){
    assert.throws(()=>executeCashOrder({cash_cents:100000,shares:0},order,{...q,...patch}));
  }
  assert.equal(executeCashOrder({cash_cents:100000,shares:0},order,q).fill.price_cents,10010);
});
const env={SUPABASE_URL:'https://fixture.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',FINANCE_DEV_ENABLED:'true'};
const owner={requireHouseOwner:async()=>({id:'owner-fixture'})};
const req=body=>new Request('https://fixture.test/v1/intel/finance/paper-demo',{method:'POST',headers:{'content-type':'application/json'},body});
test('paper route is owner-only, default off, bounded and rejects client identity',async()=>{
  assert.equal((await handleIntelRequest(req('{"orders":[]}'),{...env,FINANCE_DEV_ENABLED:'false'},owner)).status,404);
  assert.equal((await handleIntelRequest(req('{"orders":[]}'),env,{requireHouseOwner:async()=>{throw new IntelError('Forbidden',403,'forbidden');}})).status,403);
  const response=await handleIntelRequest(req('{"orders":[]}'),env,owner);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal((await response.json()).portfolio.cash_cents,1000000);
  for(const body of ['{','{"orders":[],"owner_id":"someone"}','{"orders":[{"id":"a","side":"sell","quantity":1}]}']){
    const r=await handleIntelRequest(req(body),env,owner);assert.equal(r.status,400);assert.equal(r.headers.get('cache-control'),'private, no-store');
  }
  assert.equal((await handleIntelRequest(req(' '.repeat(17000)),env,owner)).status,413);
});
