import { fail, reply } from './lib/http.js';

function headers(env,extra={}){return {apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json',...extra}}
async function svc(env,path,init={}){const r=await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,{...init,headers:headers(env,init.headers||{})});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw Object.assign(new Error(d?.message||d?.error||'Database request failed'),{status:r.status,detail:d});return d}
async function auth(req,env){const a=req.headers.get('authorization')||'';if(!a.toLowerCase().startsWith('bearer ')||a.toLowerCase().startsWith('bearer mcc_'))return null;const r=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:a}});return r.ok?r.json():null}
async function muid(env,userId){const r=await svc(env,`m_auth_user_links?auth_user_id=eq.${encodeURIComponent(userId)}&is_primary=eq.true&select=m_uid&limit=1`);return r?.[0]?.m_uid||null}

export async function handlePlatformPlanApi(req,env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
  const u=new URL(req.url),p=u.pathname.replace(/\/+$/,'')||'/';
  if(p==='/v1/platform/plans'&&req.method==='GET'){
    const plans=await svc(env,'api_plans?enabled=eq.true&public=eq.true&order=monthly_credits.asc&select=plan_code,name,description,monthly_price_cents,monthly_credits,overage_price_per_1000_credits_cents,max_keys,rate_limit_per_minute,metadata');
    return reply(req,env,{plans:plans||[],note:'Paid-plan dollar prices remain unset until pricing is approved; the free developer plan is active.'});
  }
  const revoke=p.match(/^\/v1\/developer\/consumers\/([0-9a-f-]{36})\/keys\/([0-9a-f-]{36})$/i);
  if(revoke&&req.method==='DELETE'){
    const user=await auth(req,env);if(!user)return fail(req,env,'McCluster authentication required',401);const m=await muid(env,user.id);if(!m)return fail(req,env,'McCluster identity not provisioned',409);
    const owned=await svc(env,`api_consumers?id=eq.${revoke[1]}&owner_m_uid=eq.${m}&select=id&limit=1`);if(!owned?.length)return fail(req,env,'Consumer not found',404);
    const rows=await svc(env,`api_keys?id=eq.${revoke[2]}&consumer_id=eq.${revoke[1]}`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify({status:'revoked',revoked_at:new Date().toISOString()})});if(!rows?.length)return fail(req,env,'API key not found',404);return reply(req,env,{revoked:true,key_id:revoke[2]});
  }
  return null;
}
