import test from 'node:test';
import assert from 'node:assert/strict';
import {IntelError} from '../src/intel/store.js';
import {valueAccount} from '../src/finance/valuation.js';
import {handleIntelRequest} from '../src/intel/router.js';
const owner='11111111-1111-4111-8111-111111111111', NOW=Date.parse('2026-11-06T15:00:00Z');
const instrument={id:'fixture-AAPL',symbol:'AAPL'};
const event={action:{id:'one',type:'order',symbol:'AAPL',side:'buy',quantity:2},price_cents:10000,instrument,quote:{feed:'iex'},session:'2026-11-06',at:new Date(NOW).toISOString()};
const quote={provider:'alpaca',feed:'iex',currency:'USD',status:'real_time',session:'open',instrument,bid:110,as_of:new Date(NOW-1000).toISOString()};
function options(events=[event]){return {now:()=>NOW,call:async(_env,fn)=>{assert.equal(fn,'finance_account_read');return {revision:events.length,events};}};}
test('marks paper holdings at sourced bid and never appends to the ledger',async()=>{
 const v=await valueAccount({},owner,{quote:async()=>quote},options());
 assert.equal(v.status,'complete');assert.equal(v.holdings_cents,22000);assert.equal(v.equity_cents,1002000);assert.equal(v.unrealized_cents,2000);
 assert.equal(v.marks[0].source.as_of,quote.as_of);assert.match(v.basis,/IEX bid/);
});
test('cash-only portfolio is complete without any provider request',async()=>{
 const v=await valueAccount({},owner,{quote:()=>assert.fail('unexpected provider request')},options([]));
 assert.equal(v.equity_cents,1000000);assert.equal(v.holdings_cents,0);
});
test('stale, closed, mismatched, unavailable and malformed marks never become totals',async()=>{
 for(const q of [{...quote,status:'stale'},{...quote,session:'closed'},{...quote,instrument:{id:'other'}},{...quote,bid:Infinity},{...quote,bid:null},{...quote,as_of:'invalid'},{...quote,as_of:new Date(NOW+2000).toISOString()},{...quote,feed:'sip'},{...quote,currency:'EUR'}]){
  const v=await valueAccount({},owner,{quote:async()=>q},options());assert.equal(v.status,'partial');assert.equal(v.equity_cents,null);assert.equal(v.marks[0].value_cents,null);
 }
 const v=await valueAccount({},owner,{quote:async()=>{throw {code:'needs_key'};}},options());assert.equal(v.marks[0].reason,'needs_key');assert.equal(v.unrealized_cents,null);
});
test('prior-session holdings are not marked without corporate-action reconciliation',async()=>{
 const v=await valueAccount({},owner,{quote:()=>assert.fail('unexpected request')},options([{...event,session:'2026-11-05'}]));
 assert.equal(v.equity_cents,null);assert.equal(v.marks[0].reason,'corporate_actions_review_required');
});
test('quotes that expire during a batch cannot produce a portfolio total',async()=>{
 let time=NOW;const o=options();o.now=()=>time;
 const v=await valueAccount({},owner,{quote:async()=>{time+=31000;return quote;}},o);assert.equal(v.equity_cents,null);
});
test('large portfolios cap quote work and disclose incomplete totals',async()=>{
 const events=Array.from({length:31},(_,i)=>({...event,action:{...event.action,id:'id'+i,symbol:'S'+i,quantity:1},price_cents:100,instrument:{id:'id'+i,symbol:'S'+i}}));
 let calls=0,active=0,peak=0;
 const v=await valueAccount({},owner,{quote:async(_e,s)=>{calls++;peak=Math.max(peak,++active);await new Promise(r=>setImmediate(r));active--;return {...quote,instrument:{id:'id'+s.slice(1),symbol:s}};}},options(events));
 assert.equal(calls,30);assert.equal(peak,4);assert.equal(v.truncated,true);assert.equal(v.equity_cents,null);assert.equal(v.holdings_count,31);
});
test('valuation route is owner-only, gated, rejects parameters and is never cached',async()=>{
 const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',FINANCE_DEV_ENABLED:'true',FINANCE_PERSISTENCE_ENABLED:'true'};
 const opts={requireHouseOwner:async()=>({id:owner}),financeRpc:options([]).call,financeMarket:{quote:()=>assert.fail('provider called')}};
 const req=new Request('https://fixture.invalid/v1/intel/finance/valuation');
 let r=await handleIntelRequest(req,env,opts);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');
 r=await handleIntelRequest(req,{...env,FINANCE_DEV_ENABLED:undefined},opts);assert.equal(r.status,404);
 r=await handleIntelRequest(req,{...env,FINANCE_PERSISTENCE_ENABLED:undefined},opts);assert.equal(r.status,503);
 r=await handleIntelRequest(new Request(req.url+'?owner=other'),env,opts);assert.equal(r.status,400);
 r=await handleIntelRequest(req,env,{...opts,requireHouseOwner:async()=>{throw new IntelError('forbidden',403,'forbidden');}});assert.equal(r.status,403);
});
