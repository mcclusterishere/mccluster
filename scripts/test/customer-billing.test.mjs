import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleCreatorCheckout} from '../../workers/mccluster/src/creator-billing.js';
const alice='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',bob='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',STRIPE_SECRET_KEY:'rk_test_fixture',CREATOR_STARTER_MONTHLY_PRICE_ID:'price_fixture'};
function req(path,owner,body){return new Request('https://api.mccluster.org/v1/creator-billing/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+owner,'content-type':'application/json'},body:body?JSON.stringify(body):undefined})}
test('checkout retries bind idempotency to owner; portal refuses another tenant subscription',async()=>{
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(input,options={})=>{const url=new URL(input);if(url.pathname==='/auth/v1/user')return Response.json({id:options.headers.authorization.slice(7)});if(url.pathname.endsWith('/bind_creator_checkout'))return Response.json(true);if(url.pathname.endsWith('/reserve_creator_checkout')){const body=JSON.parse(options.body);return Response.json({blocked:false,request_id:body.p_request,expires_at:'2099-01-01'})}if(url.pathname.includes('creator_billing_subscriptions')){const owner=url.searchParams.get('owner_user_id');return Response.json(owner==='eq.'+bob?[{stripe_subscription_id:'sub_bob',stripe_customer_id:'cus_bob',status:'canceled'}]:[])}calls.push({url,options});return Response.json({id:'cs_fixture',url:'https://checkout.stripe.com/c/fixture'})};
 try{
 const body={plan:'starter',period:'monthly',request_id:'fixture-request-0001'};
 for(let i=0;i<2;i++)assert.equal((await handleCreatorCheckout(req('checkout',alice,body),env)).status,200);
 assert.equal(calls[0].options.headers['Idempotency-Key'],calls[1].options.headers['Idempotency-Key']);
 assert.match(calls[0].options.body,/client_reference_id=aaaaaaaa/);
 assert.equal((await handleCreatorCheckout(req('portal',alice,{subscription_id:'sub_bob'}),env)).status,404);
 assert.equal(calls.length,2);
 assert.equal((await handleCreatorCheckout(req('portal',bob,{subscription_id:'sub_bob'}),env)).status,200);
 assert.match(calls[2].options.body,/customer=cus_bob/);
 assert.equal((await handleCreatorCheckout(req('checkout',alice,body),{...env,STRIPE_SECRET_KEY:'sk_live_fixture'})).status,503);
 }finally{globalThis.fetch=original}
});
