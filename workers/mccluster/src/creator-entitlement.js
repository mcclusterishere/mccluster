import {reply,fail} from './lib/http.js';

export async function handleCreatorEntitlement(request,env){
 if(new URL(request.url).pathname!=='/v1/creator-billing/entitlement')return null;
 if(request.method!=='GET')return fail(request,env,'Method not allowed',405);
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return fail(request,env,'Entitlements unavailable',503);
 const bearer=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(bearer))return fail(request,env,'Sign in required',401);
 const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{
  headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:bearer}
 });
 if(!auth.ok)return fail(request,env,'Invalid or expired session',401);
 const user=await auth.json();
 if(!user?.id||!/^[0-9a-f-]{36}$/i.test(user.id))return fail(request,env,'Invalid session',401);
 const query=new URL(env.SUPABASE_URL+'/rest/v1/creator_billing_subscriptions');
 query.searchParams.set('owner_user_id','eq.'+user.id);
 query.searchParams.set('select','org_id,status,stripe_price_id,current_period_end,cancel_at_period_end');
 query.searchParams.set('limit','30');
 const res=await fetch(query,{
  headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}
 });
 if(!res.ok)return fail(request,env,'Entitlements unavailable',503);
 const rows=await res.json();
 const now=Date.now();
 const active=(Array.isArray(rows)?rows:[]).filter(r=>r.status==='active'&&r.org_id&&
  r.current_period_end&&Date.parse(r.current_period_end)>now);
 return reply(request,env,{paid:active.length>0,workspaces:active.map(r=>({
  org_id:r.org_id,price_id:r.stripe_price_id,current_period_end:r.current_period_end,
  cancel_at_period_end:r.cancel_at_period_end
 }))},{'cache-control':'no-store'});
}
