import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {handleCreatorBillingWebhook} from '../src/creator-billing-webhook.js';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',order='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const env={SUPABASE_URL:'https://db.fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',STRIPE_SECRET_KEY:'sk_test_fixture',CREATOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture'};
function event(mode=false){return {id:'evt_domainfixture',type:'checkout.session.completed',created:Math.floor(Date.now()/1000),livemode:mode,data:{object:{id:'cs_domainfixture',metadata:{creator_domain_order_id:order}}}};}
function signed(body,secret=env.CREATOR_STRIPE_WEBHOOK_SECRET){
 const raw=JSON.stringify(body),time=Math.floor(Date.now()/1000);
 const digest=createHmac('sha256',secret).update(`${time}.${raw}`).digest('hex');
 return new Request('https://api.mccluster.org/v1/creator-billing/webhook',{method:'POST',headers:{'stripe-signature':`t=${time},v1=${digest}`},body:raw});
}
function fixture(t,overrides={}){
 const calls=[],paid=[];
 const session={id:'cs_domainfixture',livemode:false,mode:'payment',metadata:{creator_domain_order_id:order,mccluster_user_id:owner},client_reference_id:owner,payment_status:'paid',amount_total:2400,currency:'usd',...overrides};
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls.push({url:String(url),init});
  assert.equal(String(url),'https://api.stripe.com/v1/checkout/sessions/cs_domainfixture');
  assert.equal(init.method,'GET');
  assert.equal(init.headers.authorization,'Bearer sk_test_fixture');
  return Response.json(session);
 });
 return {calls,paid,callback:async(payload,receivedEnv)=>{assert.equal(receivedEnv,env);paid.push(payload);}};
}

test('signed paid sandbox domain checkout forwards original false mode and provider identity',async t=>{
 const f=fixture(t),body=event(false);
 const response=await handleCreatorBillingWebhook(signed(body),env,{onDomainPaid:f.callback});
 assert.equal(response.status,200);assert.equal(f.calls.length,1);
 assert.deepEqual(f.paid,[{orderId:order,ownerUserId:owner,eventId:body.id,sessionId:'cs_domainfixture',livemode:false,amountTotal:2400,currency:'usd',paymentStatus:'paid',paidAt:new Date(body.created*1000).toISOString()}]);
});
test('signed live domain checkout cannot reach provider or callback without live gate',async t=>{
 const f=fixture(t,{livemode:true});
 assert.equal((await handleCreatorBillingWebhook(signed(event(true)),env,{onDomainPaid:f.callback})).status,503);
 assert.equal(f.calls.length,0);assert.equal(f.paid.length,0);
});
test('live gate forwards true unchanged and preserves downstream registrar refusal',async t=>{
 const f=fixture(t,{livemode:true}),refusal=Object.assign(new Error('Live registration disabled'),{status:503});
 const paid=[];
 await assert.rejects(handleCreatorBillingWebhook(signed(event(true)),{...env,CREATOR_BILLING_ALLOW_LIVE:'true'},{onDomainPaid:async p=>{paid.push(p);throw refusal;}}),error=>error===refusal);
 assert.equal(f.calls.length,1);assert.equal(paid.length,1);assert.equal(paid[0].livemode,true);
});
for(const mode of [undefined,'false','true',0,null])test(`signed nonboolean mode ${String(mode)} is malformed even with live gate`,async t=>{
 const f=fixture(t),body=event();if(mode===undefined)delete body.livemode;else body.livemode=mode;
 assert.equal((await handleCreatorBillingWebhook(signed(body),{...env,CREATOR_BILLING_ALLOW_LIVE:'true'},{onDomainPaid:async p=>f.paid.push(p)})).status,400);
 assert.equal(f.calls.length,0);assert.equal(f.paid.length,0);
});
for(const [name,patch] of [
 ['owner',{client_reference_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}],
 ['order',{metadata:{creator_domain_order_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',mccluster_user_id:owner}}],
 ['session',{id:'cs_anotherfixture'}],
 ['provider mode',{livemode:true}]
])test(`signed event with canonical ${name} mismatch cannot fund domain order`,async t=>{
 const f=fixture(t,patch);
 assert.equal((await handleCreatorBillingWebhook(signed(event()),env,{onDomainPaid:f.callback})).status,409);
 assert.equal(f.calls.length,1);assert.equal(f.paid.length,0);
});
test('invalid HMAC never fetches provider or calls domain funding',async t=>{
 const f=fixture(t);
 assert.equal((await handleCreatorBillingWebhook(signed(event(),'whsec_wrong'),env,{onDomainPaid:f.callback})).status,400);
 assert.equal(f.calls.length,0);assert.equal(f.paid.length,0);
});
