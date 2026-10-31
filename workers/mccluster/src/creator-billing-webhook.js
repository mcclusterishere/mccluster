import {verifyStripeWebhook,stripeRequest} from './whip/stripe.js';
import {reply,fail} from './lib/http.js';

const EVENTS=new Set(['charge.refunded','checkout.session.completed','checkout.session.async_payment_succeeded','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed']);
const ALLOWED_PRICE_ENV=['CREATOR_STARTER_MONTHLY_PRICE_ID','CREATOR_STARTER_ANNUAL_PRICE_ID','CREATOR_PLUS_MONTHLY_PRICE_ID','CREATOR_PLUS_ANNUAL_PRICE_ID','CREATOR_PRO_MONTHLY_PRICE_ID','CREATOR_PRO_ANNUAL_PRICE_ID','CREATOR_BUSINESS_MONTHLY_PRICE_ID','CREATOR_BUSINESS_ANNUAL_PRICE_ID'];
const allowedPriceIds=env=>new Set(ALLOWED_PRICE_ENV.map(k=>env[k]).filter(Boolean));

function subscriptionId(event){
 const o=event.data?.object||{};
 if(event.type.startsWith('customer.subscription.'))return o.id;
 if(event.type.startsWith('invoice.')){
  const nested=o.parent?.subscription_details?.subscription;
  const value=o.subscription||nested;
  return typeof value==='string'?value:value?.id||null;
 }
 if(event.type.startsWith('checkout.session.'))return typeof o.subscription==='string'?o.subscription:null;
 return null;
}
async function commitEvent(env,event,subscription){
 const response=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/creator_billing_apply_stripe_event',{
  method:'POST',
  headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},
  body:JSON.stringify({p_event_id:event.id,p_event_type:event.type,p_event_created:event.created,p_subscription:subscription})
 });
 if(!response.ok)throw Object.assign(new Error('Creator billing persistence unavailable'),{status:503});
}
export async function handleCreatorBillingWebhook(request,env,{onDomainPaid,onStorePaid,onStoreRefunded}={}){
 if(new URL(request.url).pathname!=='/v1/creator-billing/webhook')return null;
 if(request.method!=='POST')return fail(request,env,'Method not allowed',405);
 if(!env.CREATOR_STRIPE_WEBHOOK_SECRET||!env.STRIPE_SECRET_KEY||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)
  return fail(request,env,'Creator billing webhook is not configured',503);
 let event;
 try{event=await verifyStripeWebhook(await request.text(),request.headers.get('stripe-signature'),env.CREATOR_STRIPE_WEBHOOK_SECRET)}
 catch{return fail(request,env,'Invalid Stripe webhook signature',400)}
 if(!event?.id||!event?.type||!Number.isInteger(event.created)||typeof event.livemode!=='boolean')return fail(request,env,'Malformed Stripe event',400);
 if(event.livemode!==false && env.CREATOR_BILLING_ALLOW_LIVE!=='true')return fail(request,env,'Live creator billing is disabled',503);
 if(!EVENTS.has(event.type))return reply(request,env,{received:true,ignored:true});
 if(event.type==='charge.refunded'&&event.data?.object?.metadata?.creator_store_order_id){
  if(typeof onStoreRefunded!=='function')return fail(request,env,'Store refund handler unavailable',503);
  const source=event.data.object;
  if(!/^acct_[A-Za-z0-9]+$/.test(event.account||'')||!/^ch_[A-Za-z0-9]+$/.test(source.id||''))return fail(request,env,'Invalid refund event',400);
  const charge=await stripeRequest(env,'charges/'+encodeURIComponent(source.id),{},{method:'GET',account:event.account});
  const orderId=charge.metadata?.creator_store_order_id;
  if(orderId!==source.metadata.creator_store_order_id||!/^[0-9a-f-]{36}$/i.test(orderId||''))return fail(request,env,'Refund order mismatch',409);
  await onStoreRefunded({orderId,livemode:event.livemode===true,eventId:event.id,accountId:event.account,chargeId:charge.id,paymentIntentId:typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id,amount:charge.amount,refunded:charge.amount_refunded,currency:charge.currency},env);
  return reply(request,env,{received:true});
 }
 const storeOrderId=event.data?.object?.metadata?.creator_store_order_id;
 if(event.type.startsWith('checkout.session.')&&storeOrderId){
  if(typeof onStorePaid!=='function')return fail(request,env,'Store funding handler unavailable',503);
  if(!/^acct_[A-Za-z0-9]+$/.test(event.account||'')||!/^cs_[A-Za-z0-9_]+$/.test(event.data.object.id||''))return fail(request,env,'Invalid connected checkout',400);
  const session=await stripeRequest(env,'checkout/sessions/'+encodeURIComponent(event.data.object.id),{},{method:'GET',account:event.account});
  if(session.metadata?.creator_store_order_id!==storeOrderId||!/^[0-9a-f-]{36}$/i.test(storeOrderId)||session.mode!=='payment')return fail(request,env,'Store checkout mismatch',409);
  if(session.payment_status!=='paid')return reply(request,env,{received:true,pending:true});
  await onStorePaid({orderId:storeOrderId,livemode:event.livemode===true,accountId:event.account,eventId:event.id,sessionId:session.id,paymentIntentId:typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id,amountTotal:session.amount_total,currency:session.currency,email:session.customer_details?.email,shipping:session.collected_information?.shipping_details||session.shipping_details,paidAt:new Date(event.created*1000).toISOString()},env);
  return reply(request,env,{received:true});
 }
 const domainOrderId=event.data?.object?.metadata?.creator_domain_order_id;
 if(event.type.startsWith('checkout.session.')&&domainOrderId){
  if(typeof onDomainPaid!=='function')return fail(request,env,'Domain funding handler unavailable',503);
  const source=event.data.object;
  if(!/^cs_[A-Za-z0-9_]+$/.test(source.id||''))return fail(request,env,'Invalid domain checkout',400);
  const session=await stripeRequest(env,'checkout/sessions/'+encodeURIComponent(source.id),{},{method:'GET'});
  const owner=session.metadata?.mccluster_user_id;
  if(session.id!==source.id||session.livemode!==event.livemode||session.metadata?.creator_domain_order_id!==domainOrderId||!/^[0-9a-f-]{36}$/i.test(domainOrderId)||!/^[0-9a-f-]{36}$/i.test(owner||'')||session.client_reference_id!==owner||session.mode!=='payment')return fail(request,env,'Domain checkout ownership mismatch',409);
  if(session.payment_status!=='paid')return reply(request,env,{received:true,pending:true});
  if(!Number.isSafeInteger(session.amount_total)||session.amount_total<=0)return fail(request,env,'Invalid domain payment amount',400);
  await onDomainPaid({orderId:domainOrderId,livemode:event.livemode,ownerUserId:owner,eventId:event.id,sessionId:session.id,amountTotal:session.amount_total,currency:session.currency,paymentStatus:session.payment_status,paidAt:new Date(event.created*1000).toISOString()},env);
  return reply(request,env,{received:true});
 }
 const id=subscriptionId(event);
 if(!id||!/^sub_[A-Za-z0-9]+$/.test(id))return reply(request,env,{received:true,ignored:true});
 // Retrieve the current Stripe subscription instead of trusting mutable event metadata.
 // This makes out-of-order events converge on provider truth.
 const subscription=await stripeRequest(env,'subscriptions/'+encodeURIComponent(id),{}, {method:'GET'});
 const price=subscription.items?.data?.[0]?.price?.id;
 const owner=subscription.metadata?.mccluster_user_id;
 const status=subscription.status;
 if(!allowedPriceIds(env).has(price)||!owner||!/^[0-9a-f-]{36}$/i.test(owner))
  return reply(request,env,{received:true,ignored:true});
 if(!['active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'].includes(status))
  return fail(request,env,'Unexpected subscription status',422);
 await commitEvent(env,event,{
  id:subscription.id,customer:typeof subscription.customer==='string'?subscription.customer:subscription.customer?.id,
  owner,price,status,current_period_end:subscription.items?.data?.[0]?.current_period_end||subscription.current_period_end||null,
  cancel_at_period_end:!!subscription.cancel_at_period_end
 });
 return reply(request,env,{received:true});
}
