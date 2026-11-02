// Additive owned-editor API; no public reads, provider calls or credentials in responses.
// The SQL RPC rechecks canonical identity/ownership and serializes all writer paths.
import {reply} from './lib/http.js';
import {validateFront,mediaPrefix,FRONT_MAX_BYTES} from '../../../packages/front-config/index.mjs';

export async function handleVersionedEditor(request,env,{fetchImpl=fetch}={}) {
 const u=new URL(request.url), match=u.pathname.match(/^\/v2\/(projects|fronts)\/([a-z0-9][a-z0-9._-]{1,39})\/(edit|history|restore|unpublish|takedown|withdraw|recover)$/);
 if(!match)return null;
 const send=(body,status=200)=>{const r=reply(request,env,body,status);r.headers.set('cache-control','private, no-store');r.headers.set('vary','Origin, Authorization');return r;};
 const fail=(status,code)=>Object.assign(new Error(code),{status,code});
 if(env.EDITOR_V2_ENABLED!=='true')return send({error:'Versioned editor is not enabled',code:'unconfigured'},503);
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return send({code:'unconfigured'},503);
 const [,collection,key,operation]=match,kind=collection==='projects'?'project':'front';
 try {
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer \S+$/i.test(authorization))throw fail(401,'signin');
  const auth=await fetchImpl(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization},signal:AbortSignal.timeout(15000)});
  const user=auth.ok?await auth.json():null;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user?.id||''))throw fail(401,'signin');
  async function callEditor(action,body={}) {
   const r=await fetchImpl(env.SUPABASE_URL+'/rest/v1/rpc/editor_owned_v2',{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},body:JSON.stringify({p_actor:user.id,p_kind:kind,p_key:key,p_action:action,p_expected:body.expected_revision??null,p_data:body.config??null,p_restore:body.restore_revision??null}),signal:AbortSignal.timeout(15000)});
   const d=await r.json().catch(()=>null);
   if(!r.ok){const status=['40001','PT409'].includes(d?.code)?409:d?.code==='42501'?403:d?.code==='P0002'?404:d?.code==='22023'||d?.code?.startsWith('23')?400:503;throw fail(status,status===503?'storage_unavailable':d?.message||'editor_failed');}
   return d;
  }
  if(request.method==='GET'&&['edit','history'].includes(operation))return send(await callEditor(operation==='edit'?'read':'history'));
  if(request.method!=='POST'||operation==='history')throw fail(405,'method');
  // Count streamed bytes rather than trusting Content-Length.
  const reader=request.body?.getReader();let bytes=0,chunks=[];
  if(!reader)throw fail(400,'invalid_body');
  try {while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>FRONT_MAX_BYTES+2048){await reader.cancel();throw fail(413,'too_large');}chunks.push(value);}}finally{reader.releaseLock();}
  const all=new Uint8Array(bytes);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.byteLength;}
  let body;try{body=JSON.parse(new TextDecoder().decode(all));}catch{throw fail(400,'invalid_body');}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['expected_revision','config','publish','restore_revision','reason'].includes(k))||!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)throw fail(400,'expected_revision_required');
  if(operation==='restore'&&(!Number.isSafeInteger(body.restore_revision)||body.restore_revision<0))throw fail(400,'restore_revision_required');
  const action=operation==='edit'?(body.publish===true?'publish':'save'):operation;
  if(action==='restore'){
   const history=await callEditor('history');const old=history.history?.find(v=>v.revision===body.restore_revision);
   if(!old?.snapshot?.draft)throw fail(404,'editor_revision_not_found');
   // The SQL restores this exact immutable snapshot; do not silently sanitize it.
   body.config=old.snapshot.draft;
  }
  if(['save','publish','restore'].includes(action)){
   if(!body.config||typeof body.config!=='object'||Array.isArray(body.config))throw fail(400,'invalid_config');
   const prefix=mediaPrefix(env.SUPABASE_URL,user.id)+(kind==='project'?'projects/'+key+'/':'');
   const checked=validateFront(body.config,{mediaPrefix:prefix,blockedMediaPrefixes:kind==='front'?[prefix+'projects/']:[]});
   if(!checked.ok)throw fail(413,'too_large');
   if(checked.dropped.length)throw fail(400,'invalid_settings');
   body.config=checked.config;
  }
  if(action==='takedown')body.config={reason:typeof body.reason==='string'?body.reason.slice(0,300):''};
  return send(await callEditor(action,body));
 }catch(e){return send({ok:false,error:e.status?e.message:'Editor unavailable',code:e.code||'unavailable'},e.status||503);}
}
