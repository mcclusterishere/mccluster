import {reply,fail} from './lib/http.js';
import {sitePlanSubscriptions,isActiveSitePlan} from './creator-entitlement.js';
import {sb,requireOrgRole,railFor,patchRail,railPatchFromAccount,publicRail,createClientAccount} from './connect.js';
import {stripeRequest,createAccountLink,retrieveConnectedAccount} from './whip/stripe.js';
const BASE='https://matthew.mccluster.org/customer-commerce.html';
export async function handleCreatorCommerce(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/v1/creator-commerce/'))return null;
 if(!['workspaces','seller-status','seller-onboarding','seller-dashboard'].some(name=>path==='/v1/creator-commerce/'+name))return fail(request,env,'Not found',404);
 const read=path.endsWith('/workspaces')||path.endsWith('/seller-status');
 if(request.method!==(read?'GET':'POST'))return fail(request,env,'Method not allowed',405);
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return fail(request,env,'Seller storage is not configured',503);
 const respond=data=>{const res=reply(request,env,data);res.headers.set('cache-control','no-store');return res};
 try{
 if(path.endsWith('/workspaces')){
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer\s+\S+$/i.test(authorization))return fail(request,env,'Sign in required',401);
  const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization}});
  if(!auth.ok)return fail(request,env,'Invalid session',401);
  const user=await auth.json();if(!/^[0-9a-f-]{36}$/i.test(user.id||''))return fail(request,env,'Invalid session',401);
  // Include previously paid workspaces so cancellation never removes access to payment records.
  const plans=await sitePlanSubscriptions(user.id,env),workspaces=[];
  for(const plan of plans.filter(p=>p.org_id)){
   const rows=await sb(env,'orgs?id=eq.'+encodeURIComponent(plan.org_id)+'&select=id,slug,name');
   if(rows?.[0])workspaces.push({...rows[0],paid:isActiveSitePlan(plan)});
  }
  return respond({workspaces,seller_configured:!!env.STRIPE_SECRET_KEY,sandbox:/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY||'')});
 }
 const body=read?{}:await request.json().catch(()=>({}));
 const {org,user}=await requireOrgRole(request,env,read?url.searchParams.get('org'):body.org);
 if(!env.STRIPE_SECRET_KEY)return fail(request,env,'Seller payments are not configured',503);
 if(!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)&&env.CREATOR_COMMERCE_ALLOW_LIVE!=='true')return fail(request,env,'Live seller onboarding is not enabled',503);
 let rail=await railFor(env,org.id);
 if(path.endsWith('/seller-status')){
  if(rail?.stripe_account_id){const account=await retrieveConnectedAccount(env,rail.stripe_account_id);rail=await patchRail(env,org.id,railPatchFromAccount(account))}
  return respond({stripe:publicRail(rail)});
 }
 if(path.endsWith('/seller-dashboard')){
  if(!rail?.stripe_account_id)return fail(request,env,'Complete seller onboarding first',409);
  const link=await stripeRequest(env,'accounts/'+encodeURIComponent(rail.stripe_account_id)+'/login_links',{},{});
  return respond({url:link.url});
 }
 const plans=await sitePlanSubscriptions(user.id,env);
 if(!plans.some(p=>p.org_id===org.id&&isActiveSitePlan(p)))return fail(request,env,'An active owned site plan is required to start seller onboarding',403);
 if(!rail){
  await sb(env,'org_stripe_accounts?on_conflict=org_id,livemode',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({org_id:org.id,livemode:/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY),account_reference:'creator-'+org.id})});
  rail=await railFor(env,org.id);
 }
 if(!rail)return fail(request,env,'Seller account storage unavailable',503);
 if(!rail.stripe_account_id){
  const description=String(body.product_description||'').trim();
  if(description.length<10||description.length>500)return fail(request,env,'Describe your products or services in 10–500 characters',400);
  const account=await createClientAccount(env,{org,email:user.email,productDescription:description});
  rail=await patchRail(env,org.id,railPatchFromAccount(account));
 }
 if(!rail?.stripe_account_id)return fail(request,env,'Seller account persistence unavailable. Retry onboarding.',503);
 const link=await createAccountLink(env,rail.stripe_account_id,{returnUrl:BASE+'?seller=returned',refreshUrl:BASE+'?seller=refresh'});
 return respond({url:link.url,expires_at:link.expires_at});
 }catch(error){return fail(request,env,error.status===403?'You do not own this workspace':error.status===401?'Sign in required':'Seller service unavailable. Refresh status and retry.',[401,403,404].includes(error.status)?error.status:503)}
}
