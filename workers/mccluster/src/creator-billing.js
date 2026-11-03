import {stripeRequest} from './whip/stripe.js';
import {reply,fail} from './lib/http.js';

const PRICE_ENV={
 starter:{monthly:'CREATOR_STARTER_MONTHLY_PRICE_ID',annual:'CREATOR_STARTER_ANNUAL_PRICE_ID'},
 plus:{monthly:'CREATOR_PLUS_MONTHLY_PRICE_ID',annual:'CREATOR_PLUS_ANNUAL_PRICE_ID'},
 pro:{monthly:'CREATOR_PRO_MONTHLY_PRICE_ID',annual:'CREATOR_PRO_ANNUAL_PRICE_ID'},
 business:{monthly:'CREATOR_BUSINESS_MONTHLY_PRICE_ID',annual:'CREATOR_BUSINESS_ANNUAL_PRICE_ID'}
};
const ORIGIN='https://matthew.mccluster.org';
export async function handleCreatorCheckout(request,env){
 const path=new URL(request.url).pathname;
 if(path!=='/v1/creator-billing/checkout')return null;
 if(request.method!=='POST')return fail(request,env,'Method not allowed',405);
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.STRIPE_SECRET_KEY)
  return fail(request,env,'Creator billing is not configured',503);
 const bearer=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(bearer))return fail(request,env,'Sign in required',401);
 const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:bearer}});
 if(!auth.ok)return fail(request,env,'Invalid or expired session',401);
 const user=await auth.json();
 if(!user?.id)return fail(request,env,'Invalid session',401);
 let body;
 try{body=await request.json()}catch{return fail(request,env,'Invalid JSON',400)}
 const plan=typeof body?.plan==='string'?body.plan:'';
 const period=typeof body?.period==='string'?body.period:'';
 const envName=PRICE_ENV[plan]?.[period];
 if(!envName)return fail(request,env,'Unsupported plan or billing period',400);
 const price=env[envName];
 if(!price||!/^price_[A-Za-z0-9]+$/.test(price))return fail(request,env,'Selected subscription is not available',503);
 if(env.CREATOR_BILLING_ALLOW_LIVE!=='true'&&!env.STRIPE_SECRET_KEY.startsWith('sk_test_'))
  return fail(request,env,'Creator checkout is restricted to Stripe test mode',503);
 const origin=ORIGIN;
 const session=await stripeRequest(env,'checkout/sessions',{
  mode:'subscription',
  line_items:[{price,quantity:1}],
  success_url:origin+'/mccluster-platform.html?checkout=returned&session_id={CHECKOUT_SESSION_ID}',
  cancel_url:origin+'/mccluster-platform.html?checkout=cancelled',
  client_reference_id:user.id,
  customer_email:user.email||undefined,
  metadata:{mccluster_user_id:user.id,creator_plan:plan,creator_period:period},
  subscription_data:{metadata:{mccluster_user_id:user.id,creator_plan:plan,creator_period:period}}
 },{});
 if(!session?.url||!session?.id)return fail(request,env,'Checkout provider did not return a session',502);
 return reply(request,env,{url:session.url,session_id:session.id});
}
