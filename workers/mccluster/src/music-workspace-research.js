import {reply} from './lib/http.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function requestText(request){
 const reader=request.body?.getReader();if(!reader)return '';const decoder=new TextDecoder();let text='',size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new RangeError('Request too large');}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{reader.releaseLock();}
}
// Disabled unless explicitly configured. This only requests an existing private
// queue job; the independent database execution capability remains off.
export async function handleMusicWorkspaceResearch(request,env,{fetchImpl=fetch}={}){
 if(new URL(request.url).pathname!=='/v1/music-workspace/analysis')return null;
 const send=(body,status)=>{const r=reply(request,env,body,status);r.headers.set('cache-control','private, no-store');return r};
 if(!['GET','POST'].includes(request.method))return send({error:'Method not allowed'},405);
 if(request.method==='POST'&&env.MUSIC_WORKSPACE_RESEARCH_ENQUEUE_ENABLED!=='true')return send({error:'Workspace analysis queue is unavailable'},503);
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return send({error:'Workspace analysis is not configured'},503);
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(authorization))return send({error:'Sign in to continue'},401);
 try{
  if(request.method==='GET'){
   const r=await fetchImpl(env.SUPABASE_URL+'/rest/v1/rpc/music_workspace_research_state',{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization,'content-type':'application/json'},body:'{}'});
   if(!r.ok)return send({error:'Private research records are unavailable'},503);
   const state=await r.json();
   return send({...state,enqueue_enabled:env.MUSIC_WORKSPACE_RESEARCH_ENQUEUE_ENABLED==='true'&&state.enqueue_enabled===true},200);
  }
  const raw=await requestText(request);
  const b=JSON.parse(raw);
  if(!uuid.test(b.track_id||'')||!['analyze','separate','transcribe','engrave'].includes(b.stage)||!/^[-a-z0-9_:]{3,80}$/.test(b.model_id||'')||!/^[-A-Za-z0-9._:]{12,128}$/.test(b.idempotency_key||'')||(b.parent_job_id!=null&&!uuid.test(b.parent_job_id))||b.consent!==true)return send({error:'Valid draft, stage, model, request key and explicit analysis consent required'},400);
  const r=await fetchImpl(env.SUPABASE_URL+'/rest/v1/rpc/music_workspace_research_enqueue',{
   method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization,'content-type':'application/json'},
   body:JSON.stringify({p_track_id:b.track_id,p_stage:b.stage,p_model_id:b.model_id,p_idempotency_key:b.idempotency_key,p_parent_job_id:b.parent_job_id||null,p_consent:true})});
  if(!r.ok)return send({error:'Queue request refused. Check creator ownership, rights, approved prior stage and enabled model.'},409);
  const job=await r.json();if(!uuid.test(job||''))return send({error:'Invalid queue response'},502);
  return send({job_id:job,accepted:true,published:false},202);
 }catch(e){if(e instanceof RangeError)return send({error:'Request too large'},413);return send({error:'Queue request failed. Retry with the same request key.'},400)}
}
