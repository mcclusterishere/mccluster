import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlpacaClient} from '../src/finance/alpaca.js';
import {accountRequest} from '../src/finance/account.js';
import {IntelError} from '../src/intel/store.js';
import {handleIntelRequest} from '../src/intel/router.js';
const NOW=Date.parse('2026-11-04T15:00:00Z'), owner='11111111-1111-4111-8111-111111111111';
const env={APCA_API_KEY_ID:'stub-key',APCA_API_SECRET_KEY:'stub-secret',FINANCE_ALPACA_ENABLED:'true',FINANCE_DEV_ENABLED:'true',FINANCE_PERSISTENCE_ENABLED:'true',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
const asset={id:'fixture-AAPL',symbol:'AAPL',name:'Apple',exchange:'NASDAQ',class:'us_equity',status:'active',tradable:true};
function stub({age=1000,closed=false,code=200,limit=false}={}){
 const calls=[];let reserved=0;
 const client=createAlpacaClient({now:()=>NOW,reserve:async()=>{reserved++;return !limit;},fetchImpl:async(url,options)=>{
  calls.push({url,options});assert.equal(options.method,'GET');assert.ok(!url.includes('orders'));assert.equal(options.redirect,'manual');
  if(code!==200)return new Response('{}',{status:code,headers:{'retry-after':'120'}});
  const path=new URL(url).pathname;
  return Response.json(path==='/v2/assets'?[asset]:path==='/v2/clock'?{timestamp:new Date(NOW).toISOString(),is_open:!closed}:path.endsWith('/latest')?{quotes:{AAPL:{t:new Date(NOW-age).toISOString(),bp:100,ap:100.02}}}:{bars:{AAPL:[{t:'2026-11-03T05:00:00Z',c:99}]}});
 }});return {client,calls,reserved:()=>reserved};
}
test('absent keys and disabled source never fetch; quota denial fails closed',async()=>{
 const s=stub();await assert.rejects(s.client.search({}),e=>e.code==='needs_key');await assert.rejects(s.client.search({...env,FINANCE_ALPACA_ENABLED:'false'}),e=>e.code==='provider_disabled');assert.equal(s.calls.length,0);
 const limited=stub({limit:true});await assert.rejects(limited.client.search(env),e=>e.code==='quota_exhausted');assert.equal(limited.calls.length,0);
});
test('read-only endpoints preserve feed, timestamps, listing identity and adjusted historical basis',async()=>{
 const s=stub();const rows=await s.client.search(env,'apple');assert.equal(rows.items[0].mic,'XNAS');
 const q=await s.client.quote(env,'AAPL');assert.equal(q.feed,'iex');assert.equal(q.eligible,true);assert.equal(q.as_of,'2026-11-04T14:59:59.000Z');
 const h=await s.client.history(env,'AAPL','1M');assert.equal(h.adjustment,'all');assert.equal(h.is_live,false);assert.equal(h.bars.length,1);
 assert.ok(s.calls.some(c=>c.url.includes('feed=iex')&&c.url.includes('adjustment=all')));
 assert.equal(s.calls.filter(c=>c.url.includes('/assets')).length,1);
 assert.ok(!JSON.stringify({q,h,rows}).includes('stub-secret'));
});
test('stale, future and closed quotes cannot fill; failures never return stale live fallback',async()=>{
 for(const opts of [{age:60000},{age:-5000},{closed:true}])assert.equal((await stub(opts).client.quote(env,'AAPL')).eligible,false);
 for(const code of [302,401,403,429,500]){
  const s=stub({code});await assert.rejects(s.client.search(env));
  if([401,403,429].includes(code)){await assert.rejects(s.client.search(env));assert.equal(s.calls.length,1);}
 }
});
function memory(){const states=new Map();return async(_env,fn,args)=>{
 const s=states.get(args.p_owner)||{revision:0,events:[]};
 if(fn==='finance_account_read')return structuredClone(s);
 if(args.p_expected!==s.revision)throw new IntelError('conflict',409,'conflict');
 const next={revision:s.revision+1,events:[...s.events,args.p_event]};states.set(args.p_owner,next);return structuredClone(next);
};}
const buy={id:'a',type:'order',symbol:'AAPL',side:'buy',quantity:2};
test('persistent multi-action account, exact retries, owner isolation and server-only valuations',async()=>{
 const call=memory(),s=stub(),options={call,now:()=>NOW};
 let a=await accountRequest(env,owner,buy,s.client,options);assert.equal(a.cash_cents,979996);assert.equal(a.positions[0].quantity,2);
 const n=s.calls.length;assert.deepEqual(await accountRequest(env,owner,buy,s.client,options),a);assert.equal(s.calls.length,n);
 await assert.rejects(accountRequest(env,owner,{...buy,quantity:3},s.client,options),e=>e.code==='idempotency_conflict');
 await assert.rejects(accountRequest(env,owner,{...buy,id:'forged',price:1},s.client,options),e=>e.code==='invalid_order');
 a=await accountRequest(env,owner,{id:'w',type:'watch',symbol:'AAPL'},s.client,options);assert.deepEqual(a.watchlist,['AAPL']);
 a=await accountRequest(env,owner,{...buy,id:'sell',side:'sell',quantity:1},s.client,options);assert.equal(a.realized_cents,-2);
 assert.deepEqual(await accountRequest(env,owner,null,s.client,options),a);
 const other=await accountRequest(env,'22222222-2222-4222-8222-222222222222',null,s.client,options);assert.equal(other.positions.length,0);
 await assert.rejects(accountRequest(env,owner,{...buy,id:'tomorrow'},s.client,{call,now:()=>NOW+86400000}),e=>e.code==='corporate_actions_review_required');
 a=await accountRequest(env,owner,{id:'reset',type:'reset'},s.client,options);assert.equal(a.cash_cents,1000000);assert.equal(a.positions.length,0);
});
test('stale/delayed quote, oversell, overspend and missing schema cannot mutate ledger',async()=>{
 const call=memory(),options={call,now:()=>NOW};
 await assert.rejects(accountRequest(env,owner,buy,stub({age:60000}).client,options),e=>e.code==='quote_not_eligible');
 const s=stub();const q=await s.client.quote(env,'AAPL');const delayed={quote:async()=>({...q,status:'delayed'})};
 await assert.rejects(accountRequest(env,owner,buy,delayed,options),e=>e.code==='quote_not_eligible');
 await assert.rejects(accountRequest(env,owner,{...buy,side:'sell'},s.client,options),e=>e.code==='insufficient_shares');
 await assert.rejects(accountRequest(env,owner,{...buy,quantity:10000},s.client,options),e=>e.code==='insufficient_cash');
 assert.equal((await accountRequest(env,owner,null,s.client,options)).revision,0);
 await assert.rejects(accountRequest(env,owner,null,s.client,{call:async()=>{throw new IntelError('missing',503,'intel_schema_not_ready');}}),e=>e.code==='finance_schema_not_ready');
});
test('routes require owner, flags, bounded valid input, and never expose key values',async()=>{
 const opts={requireHouseOwner:async()=>({id:owner}),financeMarket:stub().client,financeRpc:memory()};
 for(const path of ['market?q=apple','account','control']){
  const req=new Request('https://fixture.invalid/v1/intel/finance/'+path);
  const denied=await handleIntelRequest(req,env,{...opts,requireHouseOwner:async()=>{throw new IntelError('denied',403,'forbidden');}});assert.equal(denied.status,403);
  const disabled=await handleIntelRequest(req,{...env,FINANCE_DEV_ENABLED:'false'},opts);assert.equal(disabled.status,404);
  const ok=await handleIntelRequest(req,env,opts);assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'private, no-store');assert.ok(!(await ok.text()).includes('stub-secret'));
 }
 const bad=await handleIntelRequest(new Request('https://fixture.invalid/v1/intel/finance/market?feed=sip'),env,opts);assert.equal(bad.status,400);
});
