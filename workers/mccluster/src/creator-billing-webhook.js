import {verifyStripeWebhook,stripeRequest} from './whip/stripe.js';
import {reply,fail} from './lib/http.js';

const EVENTS=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed']);
const ALLOWED_PRICE_ENV=['CREATOR_STARTER_MONTHLY_PRICE_ID','CREATOR_STARTER_ANNUAL_PRICE_ID','CREATOR_PLUS_MONTHLY_PRICE_ID','CREATOR_PLUS_ANNUAL_PRICE_ID','CREATOR_PRO_MONTHLY_PRICE_ID','CREATOR_PRO_ANNUAL_PRICE_ID','CREATOR_BUSINESS_MONTHLY_PRICE_ID','CREATOR_BUSINESS_ANNUAL_PRICE_ID'];
const allowedPriceIds=env=>new Set(ALLOWED_PRICE_ENV.map(k=>env[k]).filter(Boolean));

function subscriptionId(event){
 const o=event.data?.object||{};
 if(event.type.startsWith('customer.subscription.'))return o.id;
 if(event.type.startsWith('invoice.'))return typeof o.subscription==='string'?o.subscription:null;
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
export async function handleCreatorBillingWebhook(request,env){
 if(new URL(request.url).pathname!=='/v1/creator-billing/webhook')return null;
 if(request.method!=='POST')return fail(request,env,'Method not allowed',405);
 if(!env.CREATOR_STRIPE_WEBHOOK_SECRET||!env.STRIPE_SECRET_KEY||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)
  return fail(request,env,'Creator billing webhook is not configured',503);
 let event;
 try{event=await verifyStripeWebhook(await request.text(),request.headers.get('stripe-signature'),env.CREATOR_STRIPE_WEBHOOK_SECRET)}
 catch{return fail(request,env,'Invalid Stripe webhook signature',400)}
 if(!event?.id||!event?.type||!Number.isInteger(event.created))return fail(request,env,'Malformed Stripe event',400);
 if(!EVENTS.has(event.type))return reply(request,env,{received:true,ignored:true});
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
  owner,price,status,current_period_end:subscription.items?.data?.[0]?.current_period_end||null,
  cancel_at_period_end:!!subscription.cancel_at_period_end
 });
 return reply(request,env,{received:true});
}
