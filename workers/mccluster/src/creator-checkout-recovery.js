// Checkout recovery never grants entitlements and never releases on elapsed time.
import {stripeRequest} from './whip/stripe.js';

export function checkoutState(attempt) {
 if (!attempt) return null;
 const expiredKey = !attempt.checkout_session_id && (!attempt.retry_until || Date.parse(attempt.retry_until) <= Date.now());
 return {
  request_id: attempt.request_id,
  plan: attempt.provider_payload?.metadata?.creator_plan || null,
  period: attempt.provider_payload?.metadata?.creator_period || null,
  // A stored ID proves binding, not whether the live session is still open.
  // Completed/expired sessions can change while no client is connected.
  state: attempt.state === 'requires_owner' || expiredKey ? 'requires_owner' : 'pending',
  recoverable: attempt.state !== 'requires_owner' && !expiredKey
 };
}

// An HTTP status alone proves nothing. Only Stripe's explicit pre-execution
// validation class on the first dispatch can release, and SQL enforces that
// no competing dispatch or prior uncertain outcome has occurred.
export function verifiedPreSessionRejection(error) {
 return error?.status === 400 && error?.stripe?.type === 'invalid_request_error'
  && !!error?.providerRequestId && !error?.stripe?.payment_intent
  && !error?.stripe?.setup_intent && !error?.stripe?.charge
  && !error?.stripe?.decline_code && error?.stripe?.code !== 'idempotency_key_in_use';
}
const sessionPattern = /^cs_[A-Za-z0-9_]+$/;
export function sessionMatchesAttempt(session, attempt, env) {
 return sessionPattern.test(session?.id || '') && session.mode === 'subscription'
  && session.client_reference_id === attempt.owner_user_id
  && session.metadata?.mccluster_user_id === attempt.owner_user_id
  && (attempt.provider_payload
   ? session.metadata?.creator_request_id === attempt.request_id
     && session.metadata?.creator_plan === attempt.provider_payload.metadata?.creator_plan
     && session.metadata?.creator_period === attempt.provider_payload.metadata?.creator_period
   // Upgrade receipts retain a known session binding, but cannot invent a
   // missing request body or bind an unknown legacy session by operator input.
   : attempt.checkout_session_id === session.id)
  && session.livemode === !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)
  && session.line_items?.data?.length === 1
  && session.line_items.data[0].price?.id === attempt.price_id
  && session.line_items.data[0].quantity === 1;
}
function safeCheckoutUrl(value) {
 try { const url=new URL(value); return url.protocol==='https:' && url.hostname==='checkout.stripe.com' && !url.username && !url.password; }
 catch { return false; }
}
export async function recoverCreatorCheckout({env,db,attempt,dispatch=false,sessionId=null}) {
 const pending = {state:'pending',request_id:attempt.request_id,error:'Payment outcome is uncertain. Resume this checkout to check the original attempt.'};
 const owner = {state:'requires_owner',request_id:attempt.request_id,error:'This checkout needs the McCluster owner to reconcile it. Do not start another payment.'};
 const mark = async (outcome,details={}) => db('rpc/mark_creator_checkout_outcome',{
  p_owner:attempt.owner_user_id,p_request:attempt.request_id,p_outcome:outcome,p_details:details
 });
 let session,created=false;
 try {
  const originalMode=attempt.provider_payload?.metadata?.creator_provider_mode;
  if(originalMode && originalMode !== (/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)?'test':'live')){
   await mark('requires_owner',{reason:'provider_mode_changed'});
   return {status:409,data:owner};
  }
  const id = sessionId || attempt.checkout_session_id;
  if (id) {
   if (!sessionPattern.test(id)) return {status:400,data:{...owner,error:'Invalid checkout session ID'}};
   session = await stripeRequest(env,'checkout/sessions/'+encodeURIComponent(id),{expand:['line_items']},{method:'GET'});
   if (session.id !== id) throw new Error('Provider session identity mismatch');
  } else {
   if (!dispatch || !attempt.provider_payload || !attempt.idempotency_key || Date.parse(attempt.retry_until) <= Date.now()) {
    await mark('requires_owner',{reason:'original_retry_unavailable'});
    return {status:409,data:owner};
   }
   try {
    session = await stripeRequest(env,'checkout/sessions',attempt.provider_payload,{idempotencyKey:attempt.idempotency_key});
    created=true;
   } catch (error) {
    if (verifiedPreSessionRejection(error)) {
     const result = await mark('rejected',{status:error.status,type:error.stripe.type,pre_execution:true,provider_request_id:error.providerRequestId});
     if (result === true || result?.released === true) return {status:422,data:{state:'validation_failed',request_id:attempt.request_id,released:true,retryable:true,error:'Checkout was rejected before a payment session was created. Choose a plan and try again.'}};
    }
    await mark('uncertain',{reason:'provider_outcome_unknown'});
    return {status:503,data:pending};
   }
  }
  if (!sessionMatchesAttempt(session,attempt,env)) {
   await mark('requires_owner',{reason:'provider_binding_mismatch'});
   return {status:409,data:owner};
  }
  const bound = await db('rpc/bind_creator_checkout',{p_owner:attempt.owner_user_id,p_request:attempt.request_id,p_session:session.id});
  if (bound !== true) throw new Error('Session binding unavailable');
  if(created){
   // Stripe caches the ORIGINAL POST body for an idempotent replay. Its open
   // status and URL can be stale after payment or expiry. Read current truth.
   const id=session.id;
   session=await stripeRequest(env,'checkout/sessions/'+encodeURIComponent(id),{expand:['line_items']},{method:'GET'});
   if(session.id!==id || !sessionMatchesAttempt(session,attempt,env)){
    await mark('requires_owner',{reason:'provider_binding_mismatch'});
    return {status:409,data:owner};
   }
  }
  if (session.status === 'expired') {
   const released = await db('rpc/release_expired_creator_checkout',{p_owner:attempt.owner_user_id,p_session:session.id});
   if (released !== true) throw new Error('Expired session reconciliation unavailable');
   return {status:200,data:{released:true,request_id:attempt.request_id}};
  }
  if (session.status === 'open' && safeCheckoutUrl(session.url)) return {status:200,data:{url:session.url,session_id:session.id,request_id:attempt.request_id}};
  // Complete/processing sessions stay reserved until subscription reconciliation.
  return {status:409,data:{...pending,error:'Payment confirmation is pending. Refresh billing status shortly.'}};
 } catch {
  // Persistence failure, malformed success and transport errors are all unknown.
  // If this update fails too, the pre-call reservation still blocks new identity.
  try { await mark('uncertain',{reason:'recovery_or_binding_unavailable'}); } catch {}
  return {status:503,data:pending};
 }
}
