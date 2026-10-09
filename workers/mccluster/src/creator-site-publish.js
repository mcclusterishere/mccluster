import {reply,fail} from './lib/http.js';
import {stripeRequest} from './whip/stripe.js';

const PRICE_KEYS=['CREATOR_STARTER_MONTHLY_PRICE_ID','CREATOR_STARTER_ANNUAL_PRICE_ID','CREATOR_PLUS_MONTHLY_PRICE_ID','CREATOR_PLUS_ANNUAL_PRICE_ID','CREATOR_PRO_MONTHLY_PRICE_ID','CREATOR_PRO_ANNUAL_PRICE_ID','CREATOR_BUSINESS_MONTHLY_PRICE_ID','CREATOR_BUSINESS_ANNUAL_PRICE_ID'];
async function getOwner(request,env){
 const bearer=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(bearer))return null;
 const response=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:bearer}});
 if(!response.ok)return null;
 return response.json();
}
async function getSubscriptions(env,userId,orgId){
 const query=new URL(env.SUPABASE_URL+'/rest/v1/creator_billing_subscriptions');
 query.searchParams.set('owner_user_id','eq.'+userId);
 query.searchParams.set('org_id','eq.'+orgId);
 query.searchParams.set('select','stripe_subscription_id,status,stripe_price_id,current_period_end');
 const res=await fetch(query,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});
 if(!res.ok)throw Object.assign(new Error('Entitlements unavailable'),{status:503});
 return res.json();
}
export async function handleCreatorPublish(request,env){
 const path=new URL(request.url).pathname;
 if(path!=='/v1/creator-sites/publish')return null;
 if(request.method!=='POST')return fail(request,env,'Method not allowed',405);
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.STRIPE_SECRET_KEY)return fail(request,env,'Publishing unavailable',503);
 const user=await getOwner(request,env);
 if(!user?.id)return fail(request,env,'Sign in required',401);
 let body;
 try{body=await request.json()}catch{return fail(request,env,'Invalid JSON',400)}
 const orgId=body?.org_id;
 if(typeof orgId!=='string'||!/^[0-9a-f-]{36}$/i.test(orgId))return fail(request,env,'Invalid workspace',400);
 const subscriptions=await getSubscriptions(env,user.id,orgId);
 const allowedPrices=new Set(PRICE_KEYS.map(k=>env[k]).filter(Boolean));
 let valid=false;
 for(const record of subscriptions){
  if(record.status!=='active'||!allowedPrices.has(record.stripe_price_id)||!record.current_period_end||Date.parse(record.current_period_end)<=Date.now())continue;
  // A live provider check prevents stale local state from publishing after cancellation.
  const stripe=await stripeRequest(env,'subscriptions/'+encodeURIComponent(record.stripe_subscription_id),{}, {method:'GET'});
  if(stripe.status==='active'&&stripe.metadata?.mccluster_user_id===user.id&&
    stripe.items?.data?.[0]?.price?.id===record.stripe_price_id){valid=true;break}
 }
 if(!valid)return fail(request,env,'An active creator subscription is required to publish',403);
 const title=body?.title,tagline=body?.tagline??'',bio=body?.bio??'';
 if(typeof title!=='string'||!title.trim()||title.length>120||
    typeof tagline!=='string'||tagline.length>300||
    typeof bio!=='string'||bio.length>4000)
  return fail(request,env,'Invalid website content',400);
 const saved=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/creator_publish_site',{
  method:'POST',
  headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},
  body:JSON.stringify({p_org_id:orgId,p_title:title.trim(),p_tagline:tagline,p_bio:bio})
 });
 if(!saved.ok)return fail(request,env,'Publishing storage is not configured or entitlement expired',503);
 const slug=await saved.json();
 if(typeof slug!=='string'||!/^site-[a-f0-9]{32}$/.test(slug))
  return fail(request,env,'Invalid publishing result',502);
 return reply(request,env,{published:true,url:'https://api.mccluster.org/v1/creator-sites/view/'+slug});
}
