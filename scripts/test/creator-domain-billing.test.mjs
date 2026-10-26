import {test} from 'node:test';import assert from 'node:assert/strict';
import {createCreatorDomainCheckout} from '../../workers/mccluster/src/creator-domain-billing.js';
import {handleCreatorBillingWebhook} from '../../workers/mccluster/src/creator-billing-webhook.js';
const owner='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',order='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',STRIPE_SECRET_KEY:'sk_test_fixture',CREATOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',CREATOR_DOMAIN_SALES_ENABLED:'true'};
async function signed(event){const raw=JSON.stringify(event),t=Math.floor(Date.now()/1000);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.CREATOR_STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw))).toString('hex');return new Request('https://api.mccluster.org/v1/creator-billing/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${signature}`},body:raw})}
test('domain checkout defaults deny and only verified paid event reaches durable funding callback',async()=>{
 const original=globalThis.fetch,calls=[];let payments=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({id:'cs_fixture',url:'https://checkout.stripe.com/fixture',metadata:{creator_domain_order_id:order,mccluster_user_id:owner},client_reference_id:owner,mode:'payment',payment_status:'paid',amount_total:1500,currency:'usd'})};
 const quote={id:order,auth_user_id:owner,hostname:'fixture.example',action:'register',total_cents:1500,currency:'USD',expires_at:new Date(Date.now()+3600e3).toISOString()};
 try{await assert.rejects(createCreatorDomainCheckout(quote,env));assert.equal(calls.length,0);await createCreatorDomainCheckout(quote,env,{registrarReady:true});assert.equal(calls[0].options.headers['Idempotency-Key'],'domain-order-'+order);
 const event={id:'evt_fixture',type:'checkout.session.completed',livemode:false,created:Math.floor(Date.now()/1000),data:{object:{id:'cs_fixture',metadata:{creator_domain_order_id:order}}}};
 const bad=new Request('https://api.mccluster.org/v1/creator-billing/webhook',{method:'POST',body:JSON.stringify(event)});assert.equal((await handleCreatorBillingWebhook(bad,env,{onDomainPaid:p=>payments.push(p)})).status,400);assert.equal(payments.length,0);
 assert.equal((await handleCreatorBillingWebhook(await signed(event),env)).status,503);
 assert.equal((await handleCreatorBillingWebhook(await signed(event),env,{onDomainPaid:async p=>payments.push(p)})).status,200);
 assert.equal(payments[0].ownerUserId,owner);assert.equal(payments[0].amountTotal,1500);assert.equal(payments[0].orderId,order);
 }finally{globalThis.fetch=original}
});
test('connected store payment and refund callbacks require signed provider truth and exact account context',async()=>{
 const original=globalThis.fetch,calls=[],payments=[],refunds=[];
 globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),options});return Response.json(new URL(url).pathname.includes('/charges/')?{id:'ch_fixture',payment_intent:'pi_fixture',metadata:{creator_store_order_id:order},amount:1500,amount_refunded:1500,currency:'usd'}:{id:'cs_fixture',payment_intent:'pi_fixture',metadata:{creator_store_order_id:order},mode:'payment',payment_status:'paid',amount_total:1500,currency:'usd',customer_details:{email:'buyer@example.test'}})};
 try{const event={id:'evt_store',account:'acct_fixture',type:'checkout.session.completed',livemode:false,created:Math.floor(Date.now()/1000),data:{object:{id:'cs_fixture',payment_intent:'pi_fixture',metadata:{creator_store_order_id:order}}}};
 assert.equal((await handleCreatorBillingWebhook(await signed(event),env,{onStorePaid:async p=>payments.push(p)})).status,200);assert.equal(payments[0].accountId,'acct_fixture');assert.equal(payments[0].paymentIntentId,'pi_fixture');assert.equal(payments[0].orderId,order);assert.equal(calls[0].options.headers['Stripe-Account'],'acct_fixture');
 const refund={...event,id:'evt_refund',type:'charge.refunded',data:{object:{id:'ch_fixture',payment_intent:'pi_fixture',metadata:{creator_store_order_id:order}}}};
 assert.equal((await handleCreatorBillingWebhook(await signed(refund),env,{onStoreRefunded:async p=>refunds.push(p)})).status,200);assert.equal(refunds[0].refunded,1500);assert.equal(refunds[0].paymentIntentId,'pi_fixture');
 const wrong={...event,account:null};assert.equal((await handleCreatorBillingWebhook(await signed(wrong),env,{onStorePaid:async p=>payments.push(p)})).status,400);assert.equal(payments.length,1);
 }finally{globalThis.fetch=original}
});
