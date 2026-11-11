import {stripeRequest} from './whip/stripe.js';
import {reply,fail} from './lib/http.js';
import {sitePlanSubscriptions,isActiveSitePlan} from './creator-entitlement.js';
import {isHouseOwner} from './world-access.js';
import {checkoutState,recoverCreatorCheckout} from './creator-checkout-recovery.js';

const PRICE_ENV={
 starter:{monthly:'CREATOR_STARTER_MONTHLY_PRICE_ID',annual:'CREATOR_STARTER_ANNUAL_PRICE_ID'},
 plus:{monthly:'CREATOR_PLUS_MONTHLY_PRICE_ID',annual:'CREATOR_PLUS_ANNUAL_PRICE_ID'},
 pro:{monthly:'CREATOR_PRO_MONTHLY_PRICE_ID',annual:'CREATOR_PRO_ANNUAL_PRICE_ID'},
 business:{monthly:'CREATOR_BUSINESS_MONTHLY_PRICE_ID',annual:'CREATOR_BUSINESS_ANNUAL_PRICE_ID'}
};
const ORIGIN='https://matthew.mccluster.org';
const UUID=/^[0-9a-f-]{36}$/i;
const REQUEST=/^[a-zA-Z0-9-]{16,80}$/;
export async function handleCreatorCheckout(request,env){
 const path=new URL(request.url).pathname;
 if(!['checkout','plans','status','portal','resume','recovery','reconcile'].some(name=>path==='/v1/creator-billing/'+name))return null;
 const read=path.endsWith('/plans')||path.endsWith('/status')||path.endsWith('/recovery');
 if(request.method!==(read?'GET':'POST'))return fail(request,env,'Method not allowed',405);
 const response=(data,status=200)=>{const res=reply(request,env,data,status);res.headers.set('cache-control','private, no-store');res.headers.set('vary','Origin, Authorization');return res};
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.STRIPE_SECRET_KEY)
  return response({error:'Creator billing is not configured'},503);
 const bearer=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(bearer))return response({error:'Sign in required'},401);
 try{
 const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:bearer}});
 if(!auth.ok)return response({error:'Invalid or expired session'},401);
 const user=await auth.json();
 if(!user?.id||!UUID.test(user.id))return response({error:'Invalid session'},401);
 const dbHeaders={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'};
 const db=async(route,body)=>{
  const res=await fetch(env.SUPABASE_URL+'/rest/v1/'+route,{method:body?'POST':'GET',headers:dbHeaders,...(body?{body:JSON.stringify(body)}:{})});
  if(!res.ok)throw new Error('Checkout persistence unavailable');
  return res.json();
 };
 const active=async(owner)=>{
  const rows=await db('creator_checkout_reservations?owner_user_id=eq.'+owner+'&select=request_id&limit=1');
  if(!Array.isArray(rows))throw new Error('Invalid checkout reservation');
  if(!rows.length)return null;
  const attempts=await db('creator_checkout_attempts?owner_user_id=eq.'+owner+'&request_id=eq.'+encodeURIComponent(rows[0].request_id)+'&select=*&limit=1');
  if(!Array.isArray(attempts)||!attempts[0])throw new Error('Checkout recovery unavailable');
  return attempts[0];
 };
 const subscriptions=await sitePlanSubscriptions(user.id,env);
 if(path.endsWith('/status')){
  const attempt=await active(user.id);
  return response({subscriptions:subscriptions.map(({stripe_customer_id,...row})=>row),paid:subscriptions.some(isActiveSitePlan),checkout:checkoutState(attempt),can_reconcile:await isHouseOwner(env,user.id,fetch)});
 }
 // All provider paths, including recovery reads, respect the same mode gate.
 if(env.CREATOR_BILLING_ALLOW_LIVE!=='true'&&!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY))return response({error:'Creator checkout is restricted to Stripe test mode'},503);
 if(path.endsWith('/recovery')||path.endsWith('/reconcile')){
  if(!await isHouseOwner(env,user.id,fetch))return response({error:'McCluster house owner access required'},403);
  if(path.endsWith('/recovery')){
   const rows=await db('creator_checkout_attempts?state=in.(reserved,uncertain,requires_owner)&order=created_at.asc&limit=100&select=owner_user_id,request_id,state,price_id,checkout_session_id,retry_until,created_at,updated_at,provider_payload');
   return response({attempts:rows.map(row=>({owner_user_id:row.owner_user_id,...checkoutState(row),checkout_session_id:row.checkout_session_id,retry_until:row.retry_until,updated_at:row.updated_at}))});
  }
 }
 if(path.endsWith('/plans')){
  const plans=[];
  for(const [plan,periods] of Object.entries(PRICE_ENV))for(const [period,key] of Object.entries(periods)){
   if(!/^price_[A-Za-z0-9]+$/.test(env[key]||''))continue;
   const price=await stripeRequest(env,'prices/'+env[key],{},{method:'GET'});
   if(price.active&&price.type==='recurring'&&Number.isSafeInteger(price.unit_amount)&&price.recurring?.interval===(period==='annual'?'year':'month'))plans.push({plan,period,amount:price.unit_amount,currency:price.currency});
  }
  return response({plans,mode:/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)?'test':'live'});
 }
 let body;
 try{body=await request.json();if(!body||typeof body!=='object'||Array.isArray(body))throw new Error()}catch{return response({error:'Invalid JSON',state:'validation_failed'},400)}
 if(path.endsWith('/portal')){
  const row=subscriptions.find(r=>r.stripe_subscription_id===body.subscription_id);
  if(!row?.stripe_customer_id)return response({error:'Subscription not found'},404);
  const session=await stripeRequest(env,'billing_portal/sessions',{customer:row.stripe_customer_id,return_url:ORIGIN+'/customer-commerce.html'},{});
  return response({url:session.url});
 }
 if(path.endsWith('/resume')||path.endsWith('/reconcile')){
  const operator=path.endsWith('/reconcile');
  const owner=operator?body.owner_user_id:user.id;
  if(!UUID.test(owner||'')||operator&&!REQUEST.test(body.request_id||''))return response({error:'Invalid checkout identity'},400);
  let attempt=await active(owner);
  if(!attempt)return response({released:true});
  if(operator&&attempt.request_id!==body.request_id)return response({error:'Checkout is no longer the active attempt'},409);
  if(operator&&body.session_id&&!/^cs_[A-Za-z0-9_]+$/.test(body.session_id))return response({error:'Invalid checkout session ID'},400);
  if(operator){
   const audited=await db('rpc/audit_creator_checkout_recovery',{p_owner:owner,p_request:attempt.request_id,p_actor:user.id,p_action:'reconcile_requested',p_details:{session_id:body.session_id||null}});
   if(audited!==true)throw new Error('Recovery audit unavailable');
  }
  const suppliedSession=operator?body.session_id:null;
  let dispatch=false;
  if(!attempt.checkout_session_id&&!suppliedSession&&attempt.state!=='requires_owner'&&Date.parse(attempt.retry_until)>Date.now()){
   const reservation=await db('rpc/reserve_creator_checkout',{p_owner:owner,p_request:attempt.request_id,p_price:attempt.price_id,p_payload:null});
   if(!reservation.blocked){attempt={...attempt,...reservation};dispatch=true;}
  }
  const result=await recoverCreatorCheckout({env,db,attempt,dispatch,sessionId:suppliedSession});
  if(operator)await db('rpc/audit_creator_checkout_recovery',{p_owner:owner,p_request:attempt.request_id,p_actor:user.id,p_action:result.status<400?'reconcile_completed':'reconcile_failed',p_details:{status:result.status,state:result.data.state|| (result.data.released?'released':'session_bound')}});
  return response(result.data,result.status);
 }
 if(subscriptions.some(r=>['active','trialing','past_due','unpaid','incomplete','paused'].includes(r.status)))return response({error:'Manage your existing subscription before starting another plan',state:'pending'},409);
 if(!REQUEST.test(body.request_id||''))return response({error:'A checkout request ID is required',state:'validation_failed'},400);
 const plan=typeof body?.plan==='string'?body.plan:'';
 const period=typeof body?.period==='string'?body.period:'';
 const envName=PRICE_ENV[plan]?.[period];
 if(!envName)return response({error:'Unsupported plan or billing period',state:'validation_failed'},400);
 const price=env[envName];
 if(!price||!/^price_[A-Za-z0-9]+$/.test(price))return response({error:'Selected subscription is not available',state:'validation_failed'},503);
 const origin=ORIGIN;
 const payload={
  mode:'subscription',expand:['line_items'],line_items:[{price,quantity:1}],
  success_url:origin+'/customer-commerce.html?checkout=returned&session_id={CHECKOUT_SESSION_ID}',
  cancel_url:origin+'/customer-commerce.html?checkout=cancelled',
  client_reference_id:user.id,
  metadata:{mccluster_user_id:user.id,creator_plan:plan,creator_period:period,creator_request_id:body.request_id,creator_provider_mode:/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)?'test':'live'},
  subscription_data:{metadata:{mccluster_user_id:user.id,creator_plan:plan,creator_period:period,creator_request_id:body.request_id,creator_provider_mode:/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)?'test':'live'}}
 };
 // Email is deliberately omitted: mutable account attributes must not change an
 // original idempotent request on another device or after an account update.
 const reservation=await db('rpc/reserve_creator_checkout',{p_owner:user.id,p_request:body.request_id,p_price:price,p_payload:payload});
 if(reservation.blocked){
  const checkout=checkoutState(await active(user.id));
  return response({error:'Another checkout or subscription is pending. Resume the existing checkout; do not start another payment.',state:checkout?.state||(reservation.state==='requires_owner'||['checkout_reconciliation_required','checkout_requires_owner'].includes(reservation.reason)?'requires_owner':'pending'),request_id:checkout?.request_id||body.request_id,checkout},409);
 }
 if(reservation.request_id!==body.request_id||!reservation.provider_payload||!reservation.idempotency_key)return response({error:'Checkout recovery storage is unavailable',state:'requires_owner'},503);
 const result=await recoverCreatorCheckout({env,db,attempt:{...reservation,owner_user_id:user.id,price_id:price},dispatch:true});
 return response(result.data,result.status);
 }catch{return response({error:'Billing service unavailable. Resume the original checkout or refresh billing status.',state:'pending'},503)}
}
