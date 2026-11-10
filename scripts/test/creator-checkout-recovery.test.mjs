import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleCreatorCheckout} from '../../workers/mccluster/src/creator-billing.js';
import {handleCreatorBillingWebhook} from '../../workers/mccluster/src/creator-billing-webhook.js';
import {checkoutFixture,billingRequest,billingEnv,firstBody,alice,bob,operator} from './support/creator-checkout-fixture.mjs';
async function withFixture(run){const f=checkoutFixture({legacy:process.env.COM3_BASELINE==='1'}),original=globalThis.fetch;globalThis.fetch=f.fetch;try{await run(f)}finally{globalThis.fetch=original}}
const call=(path,body,owner=alice,env=billingEnv)=>handleCreatorCheckout(billingRequest(path,owner,body),env);
const attempt=f=>f.attempts.get(f.key(alice,firstBody.request_id));

test('COM-3 definitive pre-session rejection releases only that identity; replay remains retired',()=>withFixture(async f=>{
 f.setScenario('reject');const response=await call('checkout',firstBody);assert.equal(response.status,422);assert.deepEqual((({state,released,retryable})=>({state,released,retryable}))(await response.json()),{state:'validation_failed',released:true,retryable:true});
 assert.equal(f.reservations.size,0);assert.equal(attempt(f).state,'rejected');
 f.setScenario('success');assert.equal((await call('checkout',firstBody)).status,409);assert.equal(f.sessions.size,0);
 assert.equal((await call('checkout',{...firstBody,request_id:'fixture-request-0002'})).status,200);assert.equal(f.sessions.size,1);
}));
for(const scenario of ['timeout_before','timeout_after','5xx','unproven400'])test('COM-3 '+scenario+' stays fail-closed and replays the immutable original',()=>withFixture(async f=>{
 f.setScenario(scenario);const first=await call('checkout',firstBody);assert.equal(first.status,503);assert.equal((await first.json()).state,'pending');
 const original=structuredClone(f.providerCalls[0]);assert.equal((await call('checkout',{...firstBody,request_id:'fixture-request-0002'})).status,409);
 f.setScenario('success');assert.equal((await call('resume',{})).status,200);assert.equal(f.sessions.size,1);
 const replay=f.providerCalls.findLast(c=>c.options.method==='POST');assert.equal(replay.options.headers['Idempotency-Key'],original.options.headers['Idempotency-Key']);assert.equal(replay.options.body,original.options.body);
}));
test('COM-3 bind failure retains recovery identity and resume binds the same provider session',()=>withFixture(async f=>{
 f.setFailBind(true);assert.equal((await call('checkout',firstBody)).status,503);assert.equal(attempt(f).state,'uncertain');assert.equal(f.sessions.size,1);
 f.setFailBind(false);assert.equal((await call('resume',{})).status,200);assert.equal(f.sessions.size,1);assert.equal(attempt(f).checkout_session_id,'cs_fixture_1');
}));
test('COM-3 reload/new device finds server-owned pending request with no browser identifier',()=>withFixture(async f=>{
 f.setScenario('timeout_after');await call('checkout',firstBody);const status=await (await call('status')).json();
 assert.equal(status.checkout.request_id,firstBody.request_id);assert.equal(status.checkout.state,'pending');assert.equal(status.checkout.plan,'starter');assert.equal(JSON.stringify(status).includes('provider_payload'),false);
 f.setScenario('success');assert.equal((await call('resume',{})).status,200);assert.equal(f.sessions.size,1);
}));
test('COM-3 original retry after expiry uses old payload and releases only provider-confirmed expired session',()=>withFixture(async f=>{
 f.setScenario('timeout_after');await call('checkout',firstBody);const oldBody=f.providerCalls[0].options.body;
 attempt(f).expires_at=new Date(Date.now()-60000).toISOString();[...f.sessions.values()][0].status='expired';
 f.setScenario('success');const response=await call('checkout',firstBody);assert.equal(response.status,200);assert.equal((await response.json()).released,true);
 assert.equal(f.providerCalls.findLast(c=>c.options.method==='POST').options.body,oldBody);assert.equal(f.sessions.size,1);assert.equal(attempt(f).state,'expired');assert.equal((await call('checkout',firstBody)).status,409);
}));
test('COM-3 retention deadline requires audited owner reconciliation, never a blind new POST',()=>withFixture(async f=>{
 f.setScenario('timeout_after');await call('checkout',firstBody);attempt(f).retry_until=new Date(Date.now()-1000).toISOString();const count=f.providerCalls.length;
 assert.equal((await (await call('resume',{})).json()).state,'requires_owner');assert.equal(f.providerCalls.length,count);
 assert.equal((await call('recovery')).status,403);assert.equal((await call('reconcile',{owner_user_id:alice,request_id:firstBody.request_id,session_id:'cs_fixture_1'})).status,403);
 const queue=await (await call('recovery',undefined,operator)).json();assert.equal(queue.attempts[0].state,'requires_owner');assert.equal(JSON.stringify(queue).includes('provider_payload'),false);
 assert.equal((await call('reconcile',{owner_user_id:alice,request_id:firstBody.request_id,session_id:'cs_fixture_1'},operator)).status,200);
 assert.equal(f.sessions.size,1);assert.equal(f.audits.length,2);assert.ok(f.audits.every(a=>a.p_actor===operator));
}));
test('COM-3 owner cannot attach another owner, price, or request identity',()=>withFixture(async f=>{
 f.setScenario('timeout_after');await call('checkout',firstBody);const session=[...f.sessions.values()][0];session.metadata.creator_request_id='fixture-other-request';
 assert.equal((await call('reconcile',{owner_user_id:alice,request_id:firstBody.request_id,session_id:session.id},operator)).status,409);assert.equal(attempt(f).checkout_session_id,null);assert.equal(attempt(f).state,'requires_owner');
}));
test('COM-3 plan change cannot replace original binding; account switch cannot read or resume it',()=>withFixture(async f=>{
 f.setScenario('timeout_after');await call('checkout',firstBody);const count=f.providerCalls.length;
 assert.equal((await call('checkout',{...firstBody,plan:'plus'})).status,409);assert.equal(f.providerCalls.length,count);
 const status=await (await call('status',undefined,bob)).json();assert.equal(status.checkout,null);
 assert.equal((await (await call('resume',{owner_user_id:alice},bob)).json()).released,true);assert.equal(f.providerCalls.length,count);
 f.setScenario('success');assert.equal((await call('checkout',firstBody,bob)).status,200);assert.equal(f.sessions.size,2);assert.notEqual(f.providerCalls[0].options.headers['Idempotency-Key'],f.providerCalls.findLast(c=>c.options.method==='POST').options.headers['Idempotency-Key']);
}));
test('COM-3 a later validation error never frees an earlier uncertain attempt',()=>withFixture(async f=>{
 f.setScenario('timeout_before');await call('checkout',firstBody);f.setScenario('reject');const response=await call('resume',{});assert.equal(response.status,503);assert.equal((await response.json()).state,'pending');assert.equal(f.reservations.size,1);assert.equal(attempt(f).state,'uncertain');
}));
test('COM-3 failed rejection persistence stays uncertain and blocks a new checkout',()=>withFixture(async f=>{
 f.setScenario('reject');f.setFailMark(true);assert.equal((await call('checkout',firstBody)).status,503);assert.equal(f.reservations.size,1);assert.equal((await call('checkout',{...firstBody,request_id:'fixture-request-0002'})).status,409);
}));
test('COM-3 live-mode guard covers resume and operator reconciliation',()=>withFixture(async f=>{
 const env={...billingEnv,STRIPE_SECRET_KEY:'sk_live_fixture'};assert.equal((await call('resume',{},alice,env)).status,503);assert.equal((await call('reconcile',{owner_user_id:alice,request_id:firstBody.request_id},operator,env)).status,503);assert.equal(f.providerCalls.length,0);
}));
async function signed(event){const raw=JSON.stringify(event),t=Math.floor(Date.now()/1000),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(billingEnv.CREATOR_STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const digest=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw))).toString('hex');return new Request('https://api.mccluster.org/v1/creator-billing/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${digest}`},body:raw})}
test('COM-3 delayed/out-of-order signed webhook and replay never open a second subscription',()=>withFixture(async f=>{
 f.setScenario('timeout_after');await call('checkout',firstBody);
 for(const [id,created,type]of [['evt_new',200,'customer.subscription.updated'],['evt_old',100,'customer.subscription.deleted'],['evt_new',200,'customer.subscription.updated']]){
  const event={id,created,type,livemode:false,data:{object:{id:'sub_fixture',status:'canceled'}}};assert.equal((await handleCreatorBillingWebhook(await signed(event),billingEnv)).status,200);
 }
 assert.equal(f.subscriptions.length,1);assert.equal(f.subscriptions[0].status,'active');assert.equal(f.events.size,2);
 assert.equal((await call('checkout',{...firstBody,request_id:'fixture-request-0002'})).status,409);assert.equal(f.sessions.size,1);assert.equal(f.reservations.size,1);
}));
test('COM-3 upgrading a known legacy session preserves GET recovery without inventing a POST',()=>withFixture(async f=>{
 await call('checkout',firstBody);const row=attempt(f),session=[...f.sessions.values()][0];row.provider_payload=null;delete session.metadata.creator_request_id;
 assert.equal((await call('resume',{})).status,200);assert.equal(f.providerCalls.length,3);assert.equal(f.providerCalls[2].options.method,'GET');assert.equal(f.sessions.size,1);
}));
test('COM-3 changing provider mode cannot replay an uncertain payment against another mode',()=>withFixture(async f=>{
 f.setScenario('timeout_after');await call('checkout',firstBody);const count=f.providerCalls.length;
 const response=await call('resume',{},alice,{...billingEnv,STRIPE_SECRET_KEY:'sk_live_fixture',CREATOR_BILLING_ALLOW_LIVE:'true'});
 assert.equal(response.status,409);assert.equal((await response.json()).state,'requires_owner');assert.equal(f.providerCalls.length,count);assert.equal(f.sessions.size,1);
}));
test('COM-3 mismatch on a bound current session persists owner-required state and appears in queue',()=>withFixture(async f=>{
 await call('checkout',firstBody);assert.equal((await (await call('recovery',undefined,operator)).json()).attempts.length,0);
 const session=[...f.sessions.values()][0];session.metadata.creator_request_id='other-checkout-identity';
 assert.equal((await (await call('resume',{})).json()).state,'requires_owner');
 assert.equal((await (await call('status')).json()).checkout.state,'requires_owner');
 const queue=await (await call('recovery',undefined,operator)).json();assert.equal(queue.attempts.length,1);assert.equal(queue.attempts[0].state,'requires_owner');assert.equal(attempt(f).checkout_session_id,session.id);
}));
test('COM-3 completed session remains pending across status/reload instead of falsely ready',()=>withFixture(async f=>{
 f.setScenario('timeout_after');await call('checkout',firstBody);[...f.sessions.values()][0].status='complete';
 const resume=await call('resume',{});assert.equal(resume.status,409);assert.equal((await resume.json()).state,'pending');
 const status=await (await call('status')).json();assert.equal(status.checkout.state,'pending');assert.equal(status.paid,false);assert.equal(f.sessions.size,1);
 f.subscriptions.push({owner_user_id:alice,status:'active',org_id:'org_fixture',current_period_end:new Date(Date.now()+3600000).toISOString()});
 const paid=await (await call('status')).json();assert.equal(paid.paid,true);assert.notEqual(paid.checkout.state,'ready');
}));
test('COM-3 blocked second-device checkout returns canonical pending identity and plan',()=>withFixture(async f=>{
 f.setScenario('timeout_after');await call('checkout',firstBody);
 const result=await call('checkout',{plan:'plus',period:'monthly',request_id:'second-device-request'});assert.equal(result.status,409);
 const data=await result.json();assert.equal(data.request_id,firstBody.request_id);assert.equal(data.checkout.plan,'starter');assert.equal(data.checkout.period,'monthly');assert.equal(data.state,'pending');assert.equal(f.sessions.size,1);
}));
