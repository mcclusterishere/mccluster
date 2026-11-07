import {stripeRequest} from './whip/stripe.js';
import {reply,fail} from './lib/http.js';
import {sitePlanSubscriptions,isActiveSitePlan} from './creator-entitlement.js';

const PRICE_ENV={
 starter:{monthly:'CREATOR_STARTER_MONTHLY_PRICE_ID',annual:'CREATOR_STARTER_ANNUAL_PRICE_ID'},
 plus:{monthly:'CREATOR_PLUS_MONTHLY_PRICE_ID',annual:'CREATOR_PLUS_ANNUAL_PRICE_ID'},
 pro:{monthly:'CREATOR_PRO_MONTHLY_PRICE_ID',annual:'CREATOR_PRO_ANNUAL_PRICE_ID'},
 business:{monthly:'CREATOR_BUSINESS_MONTHLY_PRICE_ID',annual:'CREATOR_BUSINESS_ANNUAL_PRICE_ID'}
};
const ORIGIN='https://matthew.mccluster.org';
export async function handleCreatorCheckout(request,env){
 const path=new URL(request.url).pathname;
 if(!['checkout','plans','status','portal','resume'].some(name=>path==='/v1/creator-billing/'+name))return null;
 const read=path.endsWith('/plans')||path.endsWith('/status');
 if(request.method!==(read?'GET':'POST'))return fail(request,env,'Method not allowed',405);
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.STRIPE_SECRET_KEY)
  return fail(request,env,'Creator billing is not configured',503);
 const bearer=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(bearer))return fail(request,env,'Sign in required',401);
 const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:bearer}});
 if(!auth.ok)return fail(request,env,'Invalid or expired session',401);
 const user=await auth.json();
 if(!user?.id||!/^[0-9a-f-]{36}$/i.test(user.id))return fail(request,env,'Invalid session',401);
 const response=(data)=>{const res=reply(request,env,data);res.headers.set('cache-control','no-store');return res};
 try{
 const subscriptions=await sitePlanSubscriptions(user.id,env);
 const dbHeaders={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'};
 if(path.endsWith('/resume')){
  const rowsResponse=await fetch(env.SUPABASE_URL+'/rest/v1/creator_checkout_reservations?owner_user_id=eq.'+user.id+'&select=request_id,checkout_session_id',{headers:dbHeaders});
  if(!rowsResponse.ok)throw new Error('Reservation unavailable');
  const rows=await rowsResponse.json(),row=rows[0];
  if(!row)return response({released:true});
  if(!row.checkout_session_id)return fail(request,env,'The checkout outcome is uncertain. Retry the original checkout attempt or request billing support.',409);
  const session=await stripeRequest(env,'checkout/sessions/'+encodeURIComponent(row.checkout_session_id),{},{method:'GET'});
  if(session.client_reference_id!==user.id)return fail(request,env,'Checkout ownership could not be verified',409);
  if(session.status==='open'&&session.url)return response({url:session.url});
  if(session.status!=='expired')return fail(request,env,'Payment confirmation is pending. Refresh billing status shortly.',409);
  const released=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/release_expired_creator_checkout',{method:'POST',headers:dbHeaders,body:JSON.stringify({p_owner:user.id,p_session:row.checkout_session_id})});
  if(!released.ok||await released.json()!==true)throw new Error('Reservation reconciliation unavailable');
  return response({released:true});
 }
 if(path.endsWith('/status'))return response({subscriptions:subscriptions.map(({stripe_customer_id,...row})=>row),paid:subscriptions.some(isActiveSitePlan)});
 if(env.CREATOR_BILLING_ALLOW_LIVE!=='true'&&!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY))return fail(request,env,'Creator checkout is restricted to Stripe test mode',503);
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
 try{body=await request.json()}catch{return fail(request,env,'Invalid JSON',400)}
 if(path.endsWith('/portal')){
  const row=subscriptions.find(r=>r.stripe_subscription_id===body.subscription_id);
  if(!row?.stripe_customer_id)return fail(request,env,'Subscription not found',404);
  const session=await stripeRequest(env,'billing_portal/sessions',{customer:row.stripe_customer_id,return_url:ORIGIN+'/customer-commerce.html'},{});
  return response({url:session.url});
 }
 if(subscriptions.some(r=>['active','trialing','past_due','unpaid','incomplete','paused'].includes(r.status)))return fail(request,env,'Manage your existing subscription before starting another plan',409);
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(body.request_id||''))return fail(request,env,'A checkout request ID is required',400);
 const plan=typeof body?.plan==='string'?body.plan:'';
 const period=typeof body?.period==='string'?body.period:'';
 const envName=PRICE_ENV[plan]?.[period];
 if(!envName)return fail(request,env,'Unsupported plan or billing period',400);
 const price=env[envName];
 if(!price||!/^price_[A-Za-z0-9]+$/.test(price))return fail(request,env,'Selected subscription is not available',503);
 if(env.CREATOR_BILLING_ALLOW_LIVE!=='true'&&!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY))
  return fail(request,env,'Creator checkout is restricted to Stripe test mode',503);
 const reserve=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/reserve_creator_checkout',{
  method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},
  body:JSON.stringify({p_owner:user.id,p_request:body.request_id,p_price:price})
 });
 if(!reserve.ok)return fail(request,env,'Checkout reservation unavailable',503);
 const reservation=await reserve.json();
 if(reservation.blocked)return fail(request,env,'Another checkout or subscription is pending. Resume your existing checkout. An expired attempt needs billing reconciliation before starting another.',409);
 const expiresAt=Math.floor(Date.parse(reservation.expires_at)/1000);
 if(reservation.request_id!==body.request_id||!Number.isFinite(expiresAt))return fail(request,env,'Checkout reservation unavailable',503);
 const origin=ORIGIN;
 const session=await stripeRequest(env,'checkout/sessions',{
  mode:'subscription',
  expires_at:expiresAt,
  line_items:[{price,quantity:1}],
  success_url:origin+'/customer-commerce.html?checkout=returned&session_id={CHECKOUT_SESSION_ID}',
  cancel_url:origin+'/customer-commerce.html?checkout=cancelled',
  client_reference_id:user.id,
  customer_email:user.email||undefined,
  metadata:{mccluster_user_id:user.id,creator_plan:plan,creator_period:period},
  subscription_data:{metadata:{mccluster_user_id:user.id,creator_plan:plan,creator_period:period}}
 },{idempotencyKey:'creator-checkout-'+user.id+'-'+body.request_id});
 if(!session?.url||!session?.id)return fail(request,env,'Checkout provider did not return a session',502);
 const bound=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/bind_creator_checkout',{method:'POST',headers:dbHeaders,body:JSON.stringify({p_owner:user.id,p_request:body.request_id,p_session:session.id})});
 if(!bound.ok||await bound.json()!==true)return fail(request,env,'Checkout created but recovery storage is unavailable. Retry the same attempt.',503);
 return response({url:session.url,session_id:session.id});
 }catch{return fail(request,env,'Billing service unavailable. Retry or refresh your billing status.',503)}
}
