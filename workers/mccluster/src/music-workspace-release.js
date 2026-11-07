import { reply } from './lib/http.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = async b => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
async function boundedBytes(response,limit){
 const reader=response.body?.getReader();if(!reader)throw Error('Private audio unavailable');
 const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('Private audio exceeds original size');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
export async function handleMusicWorkspaceRelease(request,env,{fetchImpl=fetch}={}) {
 if(new URL(request.url).pathname!=='/v1/music-workspace/release-draft')return null;
 const send=(body,status=200)=>{const r=reply(request,env,body,status);r.headers.set('cache-control','private, no-store');return r};
 if(request.method!=='POST')return send({error:'Method not allowed'},405);
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return send({error:'Music workspace unavailable'},503);
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(authorization))return send({error:'Sign in to continue'},401);
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization};
 try{
  const raw=await request.text();if(raw.length>4096)return send({error:'Request too large'},413);
  const b=JSON.parse(raw);if(!uuid.test(b.project_id||'')||!uuid.test(b.asset_id||'')||!Number.isSafeInteger(b.version)||b.version<1||b.authorized!==true)return send({error:'Select a ready version and explicitly confirm transfer permissions'},400);
  async function rpc(name,args,service=false){const r=await fetchImpl(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,...(service?{authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}:{}),'content-type':'application/json'},body:JSON.stringify(args)});if(!r.ok)throw Error('The draft could not be prepared. Check owner access, release-ready version, permissions and audio format.');return r.json()}
  const h=await rpc('music_workspace_release_prepare',{p_project:b.project_id,p_version:b.version,p_asset:b.asset_id,p_authorized:true});
  if(!uuid.test(h.id||'')||!uuid.test(h.owner_id||'')||h.project_id!==b.project_id||h.asset_id!==b.asset_id||!new RegExp('^'+h.owner_id+'/workspace/'+h.id+'\\.(wav|mp3|flac|m4a)$').test(h.master_path||'')||!Number.isSafeInteger(h.bytes)||h.bytes<1||h.bytes>26214400)throw Error('Invalid private handoff');
  if(!h.completed_at){
   const source=await fetchImpl(env.SUPABASE_URL+'/storage/v1/object/authenticated/music-workspace-originals/'+h.project_id+'/'+h.asset_id,{headers});
   if(!source.ok)throw Error('Original is unavailable or access changed');
   const bytes=await boundedBytes(source,h.bytes);if(bytes.byteLength!==h.bytes||await hash(bytes)!==h.source_sha256)throw Error('Original checksum does not match. No release was created.');
   const dest=env.SUPABASE_URL+'/storage/v1/object/creator-masters/'+h.master_path;
   const copied=await fetchImpl(dest,{method:'POST',headers:{...headers,'content-type':h.mime,'x-upsert':'false'},body:bytes});
   if(!copied.ok){const previous=await fetchImpl(env.SUPABASE_URL+'/storage/v1/object/authenticated/creator-masters/'+h.master_path,{headers});if(!previous.ok||await hash(await boundedBytes(previous,h.bytes))!==h.source_sha256)throw Error('Private copy unavailable. Retry; existing files are never overwritten.');}
  }
  const result=await rpc('music_workspace_release_finish',{p_handoff:h.id,p_owner:h.owner_id,p_sha256:h.source_sha256},true);
  return send({...result,status:'draft',published:false,analysis_enabled:false});
 }catch(e){return send({error:e instanceof SyntaxError?'Invalid request':e.message||'Handoff failed. Retry with the same original.'},e instanceof SyntaxError?400:409)}
}
