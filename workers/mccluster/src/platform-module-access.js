// Draft/default-off capability contract. Existing Auth, org membership, app
// catalog, domain orders and billing remain authoritative; no billing mutation.
import {reply} from './lib/http.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP=/^[a-z0-9][a-z0-9._-]{1,99}$/;
const fail=(status,code)=>Object.assign(new Error(code),{status,code});
function configured(env){
 if(env.CREATOR_DOMAIN_TRIAL_ENABLED!=='true'||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw fail(503,'module_contract_unconfigured');
}
async function rpc(env,name,body,fetchImpl){
 configured(env);
 const response=await fetchImpl(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await response.json().catch(()=>null);
 if(!response.ok){const status=data?.code==='42501'?403:data?.code==='P0002'?404:['PT409','40001','23505'].includes(data?.code)?409:data?.code==='22023'?400:503;throw fail(status,status===503?'module_contract_unavailable':status===403?'module_not_authorized':status===409?'module_event_conflict':'module_request_refused');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw fail(503,'invalid_module_projection');
 return data;
}
function scope(user,org,app){if(!UUID.test(user||'')||!UUID.test(org||'')||!APP.test(app||''))throw fail(400,'invalid_module_scope');}
function projection(data,org,app){
 if(data.scope?.org_id!==org||data.scope?.app_key!==app||['base_manage','advanced','white_label'].some(k=>typeof data.capabilities?.[k]?.allowed!=='boolean'))throw fail(503,'invalid_module_projection');
 return data;
}
export async function platformModuleAccess(env,user,org,app,{fetchImpl=fetch}={}){
 scope(user,org,app);
 return projection(await rpc(env,'creator_platform_access_v1',{p_user:user,p_org:org,p_app:app},fetchImpl),org,app);
}
export async function requirePlatformModule(env,user,org,app,capability,{fetchImpl=fetch}={}){
 scope(user,org,app);if(!['base_manage','advanced','white_label'].includes(capability))throw fail(400,'invalid_module_capability');
 const data=projection(await rpc(env,'creator_platform_require_v1',{p_user:user,p_org:org,p_app:app,p_capability:capability},fetchImpl),org,app);
 if(data.capabilities[capability].allowed!==true)throw fail(403,'module_not_authorized');
 return data;
}
// Only a trusted reconciliation adapter may call this; there is deliberately no
// public HTTP grant endpoint. Current sandbox registrar lacks these capabilities.
export async function recordVerifiedDomainTrial(env,{ownerId,orgId,orderId,eventId},proofProvider,{fetchImpl=fetch}={}){
 configured(env);
 if(![ownerId,orgId,orderId].every(v=>UUID.test(v||''))||typeof eventId!=='string'||eventId.length<1||eventId.length>200)throw fail(400,'invalid_registration_scope');
 if(proofProvider?.capabilities?.registrant_readback!==true||proofProvider?.capabilities?.charge_readback!==true||typeof proofProvider.readVerifiedRegistration!=='function')throw fail(503,'verified_registrar_readback_unavailable');
 // Implementations must perform authenticated provider readbacks, not translate
 // payment events or browser booleans into verification. SQL binds every field.
 const evidence=await proofProvider.readVerifiedRegistration({ownerId,orgId,orderId});
 if(evidence?.source!=='verified_registrar_readback'||evidence.registrant_verified!==true||evidence.charge_verified!==true)throw fail(409,'registration_not_verified');
 return rpc(env,'creator_domain_trial_record_v1',{p_owner:ownerId,p_org:orgId,p_order:orderId,p_event:eventId,p_evidence:evidence},fetchImpl);
}
export async function handlePlatformModuleAccess(request,env,{fetchImpl=fetch}={}){
 const url=new URL(request.url),access=url.pathname.match(/^\/v2\/platform\/apps\/([a-z0-9][a-z0-9._-]{1,99})\/access$/),cancel=url.pathname.match(/^\/v2\/platform\/domain-trials\/([0-9a-f-]{36})\/cancel$/i);
 if(!access&&!cancel)return null;
 const send=(data,status=200)=>{const r=reply(request,env,data,status);r.headers.set('cache-control','private, no-store');r.headers.set('vary','Origin, Authorization');return r;};
 try{
  configured(env);
  if((access&&request.method!=='GET')||(cancel&&request.method!=='POST'))throw fail(405,'method');
  const authorization=request.headers.get('authorization')||'';if(!/^Bearer \S+$/i.test(authorization))throw fail(401,'signin');
  const auth=await fetchImpl(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization},signal:AbortSignal.timeout(15000)});
  const user=auth.ok?await auth.json():null;if(!UUID.test(user?.id||'')||user?.is_anonymous===true)throw fail(401,'signin');
  if(access)return send(await platformModuleAccess(env,user.id,url.searchParams.get('org_id'),access[1],{fetchImpl}));
  // Stream-count a small cancellation body rather than trusting Content-Length.
  let bytes=0,text='';const reader=request.body?.getReader();if(!reader)throw fail(400,'invalid_body');const decoder=new TextDecoder();
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1024){await reader.cancel();throw fail(413,'too_large');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  let body;try{body=JSON.parse(text);}catch{throw fail(400,'invalid_body');}
  if(!body||Array.isArray(body)||Object.keys(body).some(k=>k!=='org_id')||!UUID.test(body.org_id||'')||!UUID.test(cancel[1]))throw fail(400,'invalid_cancel_scope');
  return send(await rpc(env,'creator_domain_trial_cancel_v1',{p_owner:user.id,p_org:body.org_id,p_order:cancel[1],p_event:'cancel:'+cancel[1]},fetchImpl));
 }catch(e){return send({ok:false,code:e.code||'module_contract_unavailable'},e.status||503);}
}
