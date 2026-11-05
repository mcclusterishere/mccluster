import test from 'node:test';
import assert from 'node:assert/strict';
import {portfolioRequest} from '../src/finance/portfolio.js';
import {IntelError} from '../src/intel/store.js';
import {handleIntelRequest} from '../src/intel/router.js';
const id='11111111-1111-4111-8111-111111111111';
const command={id:'order-1',side:'buy',quantity:1};
function memory(){let stored={revision:0,commands:[]};return async(_env,fn,args)=>{assert.equal(args.p_owner,id);if(fn==='finance_paper_read')return structuredClone(stored);if(args.p_expected!==stored.revision)throw new IntelError('Conflict',409,'conflict');stored={revision:stored.revision+1,commands:args.p_commands};return structuredClone(stored);};}
test('server persists validated commands, reloads portfolio and deduplicates retries',async()=>{
  const rpc=memory();const initial=await portfolioRequest({},id,null,rpc);assert.equal(initial.shares,0);
  const saved=await portfolioRequest({},id,command,rpc);assert.equal(saved.shares,1);assert.equal(saved.persisted,true);
  assert.deepEqual(await portfolioRequest({},id,null,rpc),saved);
  assert.deepEqual(await portfolioRequest({},id,command,rpc),saved);
  await assert.rejects(portfolioRequest({},id,{...command,quantity:2},rpc),/idempotency_conflict/);
});
test('missing schema, invalid store, concurrent update and forged command do not pretend saved',async()=>{
  await assert.rejects(portfolioRequest({},id,null,async()=>{throw new IntelError('Missing',503,'intel_schema_not_ready');}),e=>e.code==='finance_schema_not_ready');
  await assert.rejects(portfolioRequest({},id,null,async()=>({})),e=>e.code==='portfolio_invalid');
  await assert.rejects(portfolioRequest({},id,{...command,price:1},memory()),/invalid_order/);
  await assert.rejects(portfolioRequest({},id,command,async(_e,fn)=>{if(fn==='finance_paper_read')return{commands:[],revision:0};throw new IntelError('Conflict',409,'conflict');}),e=>e.status===409);
});
test('saved routes and diagnostics enforce owner and server persistence gates',async()=>{
 const env={SUPABASE_URL:'https://fixture.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',FINANCE_DEV_ENABLED:'true'};
 const demoStore=memory();const options={requireHouseOwner:async()=>({id}),financeRpc:async(env,fn,args)=>fn==='finance_account_read'?{revision:0,events:[]}:demoStore(env,fn,args)};
 const req=new Request('https://fixture.test/v1/intel/finance/portfolio');
 assert.equal((await handleIntelRequest(req,env,options)).status,503);
 const enabled={...env,FINANCE_PERSISTENCE_ENABLED:'true'};
 assert.equal((await handleIntelRequest(req,enabled,options)).status,200);
 assert.equal((await handleIntelRequest(new Request(req.url,{method:'POST',headers:{'content-type':'application/json'},body:'{"orders":[null]}'}),enabled,options)).status,400);
 const blocked={...options,requireHouseOwner:async()=>{throw new IntelError('Forbidden',403,'forbidden');}};
 for(const route of ['portfolio','reference','control'])assert.equal((await handleIntelRequest(new Request('https://fixture.test/v1/intel/finance/'+route),enabled,blocked)).status,403);
 const status=await handleIntelRequest(new Request('https://fixture.test/v1/intel/finance/control'),enabled,options);
 assert.equal((await status.json()).storage,'ready');
 const ref=await handleIntelRequest(new Request('https://fixture.test/v1/intel/finance/reference'),env,options);
 const body=await ref.json();assert.equal(body.is_live,false);assert.equal(body.kind,'static_reference');assert.ok(body.sources.length);
});
