import {handleMusicWorkspaceResearch} from './music-workspace-research.js';
import {handleMusicWorkspaceRelease} from './music-workspace-release.js';
import {reply,fail,corsHeaders} from './lib/http.js';
const UUID=/^[0-9a-f-]{36}$/i,MAX=26214400;
export function musicAudioSignature(bytes,mime){const text=(a,b)=>String.fromCharCode(...bytes.slice(a,b));return mime==='audio/wav'?text(0,4)==='RIFF'&&text(8,12)==='WAVE':mime==='audio/flac'?text(0,4)==='fLaC':mime==='audio/ogg'?text(0,4)==='OggS':mime==='audio/mp4'?text(4,8)==='ftyp':mime==='audio/webm'?bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3:mime==='audio/mpeg'?(text(0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224):false}
export async function handleMusicWorkspace(request,env){
 const research=await handleMusicWorkspaceResearch(request,env);if(research)return research;
 const handoff=await handleMusicWorkspaceRelease(request,env);if(handoff)return handoff;
 const url=new URL(request.url);if(!url.pathname.startsWith('/v1/music-workspace/'))return null;
 const authorization=request.headers.get('authorization')||'';if(!/^Bearer\s+\S+$/i.test(authorization))return fail(request,env,'Sign in to your creator account',401);
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return fail(request,env,'Music workspace is not configured',503);
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization};
 async function action(name,data){const res=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/music_workspace_action',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({p_action:name,p_data:data})});const value=await res.json();if(!res.ok)throw Object.assign(Error(value.message||'Workspace unavailable'),{status:res.status});return value}
 try{
 if(url.pathname==='/v1/music-workspace/action'&&request.method==='POST'){
  const raw=await request.text();if(raw.length>100000)return fail(request,env,'Project request is too large',413);const body=JSON.parse(raw);
  if(!['list','create','get','invite','respond','remove','comment','reserve_asset','version','ready'].includes(body.action))return fail(request,env,'Unsupported workspace action',400);
  const result=reply(request,env,await action(body.action,body.data||{}));result.headers.set('cache-control','no-store');return result;
 }
 if(url.pathname==='/v1/music-workspace/file'&&['GET','POST'].includes(request.method)){
  const project=url.searchParams.get('project'),id=url.searchParams.get('id');if(!UUID.test(project||'')||!UUID.test(id||''))return fail(request,env,'Invalid file',400);
  const asset=await action(request.method==='GET'?'asset_read':'asset_upload',{project_id:project,asset_id:id});
  const path='/storage/v1/object/'+(request.method==='GET'?'authenticated/':'')+'music-workspace-originals/'+project+'/'+id;
  if(request.method==='GET'){
   const stored=await fetch(env.SUPABASE_URL+path,{headers});if(!stored.ok)throw Error('File unavailable');
   return new Response(stored.body,{headers:{...corsHeaders(request,env),'content-type':asset.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
  }
  if(Number(request.headers.get('content-length'))>MAX)return fail(request,env,'Maximum original size is 25 MB',413);
  const reader=request.body?.getReader();if(!reader)return fail(request,env,'Audio file required',400);const chunks=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>MAX){await reader.cancel();return fail(request,env,'Maximum original size is 25 MB',413)}chunks.push(part.value)}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}if(bytes.length!==asset.bytes||bytes.length>MAX||!musicAudioSignature(bytes,asset.mime))return fail(request,env,'File size or audio format does not match',400);
  const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');const checksum=await hash(bytes);
  const upload=await fetch(env.SUPABASE_URL+path,{method:'POST',headers:{...headers,'content-type':asset.mime,'x-upsert':'false'},body:bytes});
  if(!upload.ok){
   // A failed finalize can be retried, but an existing original is never replaced.
   const existing=await fetch(env.SUPABASE_URL+'/storage/v1/object/authenticated/music-workspace-originals/'+project+'/'+id,{headers});
   if(!existing.ok||await hash(await existing.arrayBuffer())!==checksum)return fail(request,env,'Upload failed or original differs. Start a new upload.',409);
  }
  return reply(request,env,await action('finish_asset',{project_id:project,asset_id:id,sha256:checksum}));
 }
 return fail(request,env,'Unknown music workspace route',404);
 }catch(error){const known=['sign_in_required','active_creator_required','project_access_denied','owner_required','editor_required','version_conflict_refresh','existing_collaborator_required','original_is_immutable','invitation_unavailable','project_limit_reuse_existing','asset_limit_use_existing_originals','project_storage_limit'];return fail(request,env,known.includes(error.message)?error.message.replaceAll('_',' '):'Music workspace request failed. Refresh and retry.',error.status===401?401:known.includes(error.message)?409:503)}
}
