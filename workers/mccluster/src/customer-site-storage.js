/* Account-wide website bytes. Only this bounded service writes site objects.
   Storage API metadata is authoritative; reservations survive ambiguous failures. */
import {reply} from './lib/http.js';
import {supabaseStore,fail} from './website-studio/service.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES=new Set(['image/webp','image/jpeg','image/png','video/mp4','video/webm','audio/mpeg','audio/mp4','audio/aac','audio/wav']);
function storage(env,fetchImpl=fetch){
 const root=env.SUPABASE_URL+'/storage/v1/object/';
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY};
 return {
  async head(bucket,path){const r=await fetchImpl(root+'authenticated/'+bucket+'/'+path,{method:'HEAD',headers,signal:AbortSignal.timeout(15000)});if(r.status===404)return null;if(!r.ok)throw fail(503,'Storage reconciliation is unavailable');const size=Number(r.headers.get('content-length'));if(!Number.isSafeInteger(size)||size<0)throw fail(503,'Storage size is not verified');return size;},
  async put(bucket,path,stream,type,signal){const r=await fetchImpl(root+bucket+'/'+path,{method:'POST',headers:{...headers,'content-type':type,'x-upsert':'true'},body:stream,duplex:'half',signal});if(!r.ok)throw fail(r.status===409?409:503,'Storage did not confirm the upload');}
 };
}
export async function writeSiteObject({db,env,user,bucket,path,bytes,body,type,fetchImpl=fetch,storageImpl}){
 if(!Number.isSafeInteger(bytes)||bytes<1||bytes>314572800||!body||!TYPES.has(type))throw fail(400,'Choose a supported file within the upload limit');
 const r=await db.rpc('customer_site_storage_reserve_v1',{p_user:user,p_bucket:bucket,p_path:path,p_bytes:bytes});
 const provider=storageImpl||storage(env,fetchImpl),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),120000);let count=0;
 const stream=body.pipeThrough(new TransformStream({transform(chunk,out){count+=chunk.byteLength;if(count>bytes)throw fail(413,'Uploaded bytes exceed the reserved size');out.enqueue(chunk);},flush(){if(count!==bytes)throw fail(400,'Upload ended before the reserved size');}}));
 try{
  await provider.put(bucket,path,stream,type,controller.signal);
  if(count!==bytes)throw fail(503,'Storage did not consume the complete upload');
  const actual=await provider.head(bucket,path);if(actual!==bytes)throw fail(503,'Upload size needs reconciliation');
  await db.patch('customer_site_storage_reservations',{id:'eq.'+r.id,owner_user_id:'eq.'+user,state:'eq.pending'},{state:'settled',updated_at:new Date().toISOString()});
  return {ok:true,bytes:actual};
 }finally{clearTimeout(timer);controller.abort();}
 // No release in catch: a failed response may have followed a completed write.
}
export async function handleCustomerSiteStorage(request,env,deps={}){
 const url=new URL(request.url);if(!['/v1/customer-site/storage','/v1/customer-site/media'].includes(url.pathname))return null;
 const send=(body,status=200)=>{const r=reply(request,env,body,status);r.headers.set('cache-control','private, no-store');return r;};
 try{
  const db=deps.db||supabaseStore(env,deps.fetchImpl),actor=await db.actor(request);
  if(url.pathname.endsWith('/storage')){
   if(request.method==='POST'){
    // Recovery checks durable provider metadata. Missing objects remain reserved
    // for 24h, beyond the bounded 120s upload, before authoritative absence frees them.
    const rows=await db.select('customer_site_storage_reservations',{owner_user_id:'eq.'+actor.auth_uid,state:'eq.pending',limit:'100'},'id,bucket,path,bytes,prior_bytes,created_at');
    const provider=deps.storageImpl||storage(env,deps.fetchImpl);
    for(const r of rows){const size=await provider.head(r.bucket,r.path),expired=Date.parse(r.created_at)<Date.now()-86400000;
     const settled=size===Number(r.bytes),unchanged=size===null||size===Number(r.prior_bytes);
     if(!settled&&!unchanged)throw fail(503,'Storage bytes need operator reconciliation');
     if(settled||expired&&unchanged)await db.patch('customer_site_storage_reservations',{id:'eq.'+r.id,owner_user_id:'eq.'+actor.auth_uid,state:'eq.pending'},{state:settled?'settled':'released',updated_at:new Date().toISOString()});
    }
   }else if(request.method!=='GET')throw fail(405,'Method not allowed');
   const usage=await db.rpc('customer_site_storage_usage_v1',{p_user:actor.auth_uid});
   return send({ok:true,...usage,unit:'bytes',scope:'All websites in your M Account; originals and prepared website media',processing_included:false,bandwidth_included:false});
  }
  if(request.method!=='POST')throw fail(405,'Method not allowed');
  let bucket='front-media',path=url.searchParams.get('path'),bytes=Number(request.headers.get('x-site-bytes'));
  const asset=url.searchParams.get('asset');
  if(asset){
   if(!UUID.test(asset))throw fail(400,'Invalid media');
   const rows=await db.select('creator_site_media_state',{asset_id:'eq.'+asset,owner_m_uid:'eq.'+actor.m_uid,state:'eq.awaiting_upload',limit:'1'},'source_path,expected_bytes');
   if(!rows.length)throw fail(404,'Media not available in your account');bucket='mnet-media';path=rows[0].source_path;
   if(path!==`studio/${actor.m_uid}/${asset}/original`||bytes!==Number(rows[0].expected_bytes))throw fail(400,'Registered media size or path differs');
  }else{
   if(typeof path!=='string'||!path.startsWith(actor.auth_uid+'/')||path.length>512||!new RegExp('^'+actor.auth_uid+'/[a-zA-Z0-9_./-]+$').test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))throw fail(400,'Choose your own media folder');
   const project=path.match(/^[^/]+\/projects\/([^/]+)\//);
   if(project){const rows=await db.select('managed_projects',{slug:'eq.'+project[1],owner_user_id:'eq.'+actor.auth_uid,m_uid:'eq.'+actor.m_uid,removed_at:'is.null',limit:'1'},'slug');if(!rows.length)throw fail(404,'Project not found in your account');}
  }
  return send(await writeSiteObject({db,env,user:actor.auth_uid,bucket,path,bytes,body:request.body,type:(request.headers.get('content-type')||'').split(';')[0],fetchImpl:deps.fetchImpl,storageImpl:deps.storageImpl}));
 }catch(e){return send({ok:false,error:e.status?e.message:'Website storage is unavailable',code:e.status===429?'storage_full':'storage_unavailable'},e.status||503);}
}
