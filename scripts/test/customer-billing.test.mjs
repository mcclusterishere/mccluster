import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleCreatorCheckout} from '../../workers/mccluster/src/creator-billing.js';
import {checkoutFixture,billingRequest,billingEnv,firstBody,alice,bob} from './support/creator-checkout-fixture.mjs';
test('checkout retries bind idempotency to owner; portal refuses another tenant subscription',async()=>{
 const original=globalThis.fetch,f=checkoutFixture();globalThis.fetch=f.fetch;
 f.subscriptions.push({owner_user_id:bob,stripe_subscription_id:'sub_bob',stripe_customer_id:'cus_bob',status:'canceled'});
 try{
 for(let i=0;i<2;i++)assert.equal((await handleCreatorCheckout(billingRequest('checkout',alice,firstBody),billingEnv)).status,200);
 // An already bound retry now retrieves the same session rather than creating
 // it again. The separate recovery suite proves identical POST key and body
 // when binding did not finish and an actual creation replay is necessary.
 assert.equal(f.providerCalls.length,3);
 assert.equal(f.providerCalls[0].options.headers['Idempotency-Key'],'creator-checkout-'+alice+'-'+firstBody.request_id);
 assert.match(f.providerCalls[0].options.body,/client_reference_id=aaaaaaaa/);
 assert.equal(f.providerCalls[2].options.method,'GET');
 assert.match(f.providerCalls[2].url,/checkout\/sessions\/cs_fixture_1/);
 assert.equal(f.sessions.size,1);
 assert.equal(f.providerCalls.filter(call=>call.options.method==='POST').length,1);
 assert.equal((await handleCreatorCheckout(billingRequest('portal',alice,{subscription_id:'sub_bob'}),billingEnv)).status,404);
 assert.equal(f.providerCalls.length,3);
 assert.equal((await handleCreatorCheckout(billingRequest('portal',bob,{subscription_id:'sub_bob'}),billingEnv)).status,200);
 assert.match(f.providerCalls[3].options.body,/customer=cus_bob/);
 assert.equal((await handleCreatorCheckout(billingRequest('checkout',alice,firstBody),{...billingEnv,STRIPE_SECRET_KEY:'sk_live_fixture'})).status,503);
 }finally{globalThis.fetch=original}
});
