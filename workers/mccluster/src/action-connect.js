import { stripeRequest } from './whip/stripe.js';
import { reply, fail } from './lib/http.js';

const ORIGIN='https://matthew.mccluster.org';
async function userFromBearer(request,env){
 const token=request.headers.get('authorization')||'';
 if(!/^Bearer\\s+\\S+$/i.test(token))return null;
 const res=await fetch(env.SUPABASE_URL+'/auth/v1/user',{
  headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:token}
 });
 if(!res.ok)return null;
 const user=await res.json();
 return user?.id?user:null;
}
async function db(env,path,options={}){
 const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{
  ...options,
  headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,
   authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,
   'content-type':'application/json',...(options.headers||{})}
 });
 if(!r.ok)throw Object.assign(new Error('Recipient persistence failed'),{status:503});
 return r.status===204?null:r.json();
}
export async function handleActionConnect(request,env){
 const path=new URL(request.url).pathname;
 if(!['/v1/action-connect/onboard','/v1/action-connect/status'].includes(path))return null;
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.STRIPE_SECRET_KEY)
  return fail(request,env,'Connect unavailable',503);
 // Explicit pilot gate. Never create live accounts through this draft.
 if(env.ACTION_CONNECT_TEST_PILOT!=='true'||!env.STRIPE_SECRET_KEY.startsWith('sk_test_'))
  return fail(request,env,'Connect onboarding is not enabled',503);
 if((path.endsWith('/onboard')&&request.method!=='POST')||
    (path.endsWith('/status')&&request.method!=='GET'))
  return fail(request,env,'Method not allowed',405);
 const user=await userFromBearer(request,env);
 if(!user)return fail(request,env,'Sign in required',401);
 const rows=await db(env,'an_connect_recipients?user_id=eq.'+encodeURIComponent(user.id)+'&select=*');
 let record=rows?.[0];
 if(path.endsWith('/status')){
  if(!record?.stripe_account_id)return reply(request,env,{status:'not_started'});
  const acct=await stripeRequest(env,'accounts/'+encodeURIComponent(record.stripe_account_id),{},{method:'GET'});
  return reply(request,env,{status:acct.payouts_enabled&&acct.capabilities?.transfers==='active'?'ready':'pending',
   payouts_enabled:Boolean(acct.payouts_enabled),transfers_enabled:acct.capabilities?.transfers==='active',
   requirements_due:acct.requirements?.currently_due||[]});
 }
 if(!record?.stripe_account_id){
  // Preclaim user row to prevent simultaneous onboarding requests.
  if(!record){
   await db(env,'an_connect_recipients?on_conflict=user_id',{method:'POST',
    headers:{Prefer:'resolution=ignore-duplicates'},
    body:JSON.stringify({user_id:user.id,environment:'test',account_kind:'recipient'})});
  }
  // No account creation in this endpoint until a durable idempotent provisioner
  // is implemented; avoids orphaned Stripe accounts on database/network failures.
  return reply(request,env,{status:'provisioning_required',
   message:'Recipient record reserved. Stripe account provisioning requires the controlled backend job.'},202);
 }
 if(record.environment!=='test')return fail(request,env,'Account environment mismatch',409);
 const link=await stripeRequest(env,'account_links',{
  account:record.stripe_account_id,
  refresh_url:ORIGIN+'/action-network.html?connect=refresh',
  return_url:ORIGIN+'/action-network.html?connect=returned',
  type:'account_onboarding'
 });
 return reply(request,env,{url:link.url,expires_at:link.expires_at});
}
