import {reply,fail} from './lib/http.js';

export async function sitePlanSubscriptions(userId,env,fetchImpl=fetch){
 if(!/^[0-9a-f-]{36}$/i.test(userId||'')||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Entitlements unavailable');
 const query=new URL(env.SUPABASE_URL+'/rest/v1/creator_billing_subscriptions');
 query.searchParams.set('owner_user_id','eq.'+userId);
 query.searchParams.set('select','org_id,status,stripe_price_id,current_period_end,cancel_at_period_end,stripe_subscription_id,stripe_customer_id');
 query.searchParams.set('limit','100');
 const res=await fetchImpl(query,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});
 if(!res.ok)throw new Error('Entitlements unavailable');
 const rows=await res.json();
 if(!Array.isArray(rows))throw new Error('Entitlements unavailable');
 return rows;
}
export function isActiveSitePlan(row){return row.status==='active'&&!!row.org_id&&Date.parse(row.current_period_end)>Date.now()}
export async function hasActiveSitePlan(userId,env,fetchImpl=fetch){
 try{return (await sitePlanSubscriptions(userId,env,fetchImpl)).some(isActiveSitePlan)}catch{return false}
}
export async function handleCreatorEntitlement(request,env){
 if(new URL(request.url).pathname!=='/v1/creator-billing/entitlement')return null;
 if(request.method!=='GET')return fail(request,env,'Method not allowed',405);
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return fail(request,env,'Entitlements unavailable',503);
 const bearer=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(bearer))return fail(request,env,'Sign in required',401);
 try{
 const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:bearer}});
 if(!auth.ok)return fail(request,env,'Invalid or expired session',401);
 const user=await auth.json();
 const active=(await sitePlanSubscriptions(user.id,env)).filter(isActiveSitePlan);
 const response=reply(request,env,{paid:active.length>0,workspaces:active.map(r=>({org_id:r.org_id,price_id:r.stripe_price_id,current_period_end:r.current_period_end,cancel_at_period_end:r.cancel_at_period_end}))});
 response.headers.set('cache-control','no-store');return response;
 }catch{return fail(request,env,'Entitlements unavailable',503)}
}
