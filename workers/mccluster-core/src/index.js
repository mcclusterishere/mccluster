const JSON_HEADERS={'content-type':'application/json; charset=utf-8'};

function cors(env){return{
  'access-control-allow-origin':env.ALLOWED_ORIGIN||'*',
  'access-control-allow-methods':'GET,POST,OPTIONS',
  'access-control-allow-headers':'authorization,content-type',
  'access-control-max-age':'86400'
}}
function reply(env,data,status=200){return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...cors(env)}})}
function fail(env,message,status=400,detail){return reply(env,{error:message,detail},status)}
function configured(env){return Boolean(env.SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY)}
function sbHeaders(env){return{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json'}}
async function sb(env,path){
  const res=await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,{headers:sbHeaders(env)});
  const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok)throw Object.assign(new Error('McCluster database request failed'),{status:res.status,detail:data});
  return data;
}
async function authUser(req,env){
  const authorization=req.headers.get('authorization')||'';
  if(!authorization.toLowerCase().startsWith('bearer '))return null;
  const res=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization}});
  if(!res.ok)return null;
  return res.json();
}
async function appByKey(env,key){
  const rows=await sb(env,`platform_apps?app_key=eq.${encodeURIComponent(key)}&enabled=eq.true&select=*`);
  return rows?.[0]||null;
}
async function feePolicy(env,appId,orgId){
  const orgFilter=orgId?`&org_id=eq.${encodeURIComponent(orgId)}`:'&org_id=is.null';
  let rows=await sb(env,`platform_fee_policies?app_id=eq.${encodeURIComponent(appId)}${orgFilter}&enabled=eq.true&order=effective_at.desc&limit=1&select=*`);
  if(!rows?.length&&orgId)rows=await sb(env,`platform_fee_policies?app_id=eq.${encodeURIComponent(appId)}&org_id=is.null&enabled=eq.true&order=effective_at.desc&limit=1&select=*`);
  return rows?.[0]||null;
}
function pct(cents,bps){return Math.round(Number(cents||0)*Number(bps||0)/10000)}

export default{async fetch(req,env){
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(env)});
  if(!configured(env))return fail(env,'McCluster Core is not configured',503);
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'')||'/';
  try{
    if(path==='/health'&&req.method==='GET')return reply(env,{
      ok:true,
      service:'mccluster-core',
      supabase_project:env.MCCLUSTER_SUPABASE_PROJECT_REF||null,
      products:['identity','apps','fees','payments','mobility'],
      canonical_identity:'McCluster'
    });

    if(path==='/v1/me'&&req.method==='GET'){
      const user=await authUser(req,env);if(!user)return fail(env,'Authentication required',401);
      return reply(env,{user:{id:user.id,email:user.email,phone:user.phone,user_metadata:user.user_metadata||{}}});
    }

    if(path==='/v1/apps'&&req.method==='GET'){
      const rows=await sb(env,'platform_apps?enabled=eq.true&order=product_family.asc,name.asc&select=app_key,name,product_family,kind,bundle_id,public_url,oauth_client_id,settings');
      return reply(env,{apps:rows||[]});
    }

    if(path==='/v1/fees/quote'&&req.method==='GET'){
      const appKey=url.searchParams.get('app_key');
      const baseCents=Math.max(0,Math.round(Number(url.searchParams.get('base_cents')||0)));
      const whiteLabel=['1','true','yes'].includes(String(url.searchParams.get('white_label')||'').toLowerCase());
      const orgId=url.searchParams.get('org_id')||null;
      if(!appKey||!baseCents)return fail(env,'app_key and positive base_cents are required');
      const app=await appByKey(env,appKey);if(!app)return fail(env,'Unknown McCluster application',404);
      const policy=await feePolicy(env,app.id,orgId);if(!policy)return fail(env,'No fee policy configured for this application',404);
      const payerFee=pct(baseCents,policy.payer_fee_bps);
      const receiverBps=whiteLabel?policy.white_label_payee_fee_bps:policy.payee_fee_bps;
      const receiverFee=pct(baseCents,receiverBps);
      const payerTotal=baseCents+payerFee;
      const receiverEconomicAmount=Math.max(0,baseCents-receiverFee);
      return reply(env,{
        app:{key:app.app_key,name:app.name},
        policy:{key:policy.policy_key,currency:policy.currency,payer_fee_bps:policy.payer_fee_bps,payee_fee_bps:receiverBps,white_label:whiteLabel,white_label_subscription_cents:policy.white_label_subscription_cents},
        quote:{
          base_amount_cents:baseCents,
          payer_fee_cents:payerFee,
          payer_total_cents:payerTotal,
          payee_fee_cents:receiverFee,
          platform_revenue_before_processing_cents:payerFee+receiverFee,
          payee_economic_amount_cents:receiverEconomicAmount
        }
      });
    }

    return fail(env,'Not found',404);
  }catch(error){return fail(env,error.message||'McCluster Core request failed',error.status||500,error.detail)}
}};
