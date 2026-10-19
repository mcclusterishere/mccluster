/* EQUITY UPRISE AUDIO ROOMS — Realtime SFU (OFF BY DEFAULT).
   This is separate from single-host Cloudflare Stream live video.
   No SFU credentials, SDP, internal member identity, or media URLs leave
   the Worker except the SDP intended for that authenticated endpoint.
   Audio only. No recording, transcription or background capture.
   SQL: supabase/pending/20261019235000_network_sfu_audio_rooms.sql
*/
import { fail, reply } from './lib/http.js';
import { bearerUser } from './world-layers.js';
import { isCountry } from './intel/news-country-codes.js';

const ROOT='/v1/mnet/audio';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MID=/^[a-zA-Z0-9]{1,16}$/;
const APP_ID=/^[a-zA-Z0-9_-]{5,128}$/;
const LIMIT_SDP=64_000;
export function audioReady(env) {
  return String(env?.AUDIO_SFU_ROOMS_ENABLED||'').toLowerCase()==='true' &&
    APP_ID.test(String(env?.AUDIO_SFU_APP_ID||'')) &&
    typeof env?.AUDIO_SFU_APP_SECRET==='string' && env.AUDIO_SFU_APP_SECRET.length>12 &&
    !!env?.SUPABASE_URL && !!env?.SUPABASE_SERVICE_ROLE_KEY;
}
export function validDescription(desc,type) {
  return desc && desc.type===type && typeof desc.sdp==='string' &&
    desc.sdp.startsWith('v=0') && desc.sdp.length>=40 && desc.sdp.length<=LIMIT_SDP;
}
const validUuid=x=>typeof x==='string'&&UUID.test(x);
const isJson={ 'content-type':'application/json' };
async function body(req) {
  if(Number(req.headers.get('content-length')||0)>80_000)throw Object.assign(new Error('Request body too large'),{status:413});
  const content=await req.text();if(content.length>80_000)throw Object.assign(new Error('Request body too large'),{status:413});
  try { return content?JSON.parse(content):{}; } catch { throw Object.assign(new Error('Invalid JSON body'),{status:400}); }
}
function pathFor(env,table,params) {
  return env.SUPABASE_URL+'/rest/v1/'+table+(params?'?'+params:'');
}
async function service(env,table,params='',init={},fetchImpl=fetch) {
  const res=await fetchImpl(pathFor(env,table,params),{...init,redirect:'manual',
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,
      ...isJson, ...(init.headers||{})}});
  if(!res.ok)throw Object.assign(new Error('audio_database_unavailable'),{status:res.status});
  try {return await res.json();}catch {return null;}
}
async function uidFor(env,user,fetchImpl) {
  const list=await service(env,'m_auth_user_links','auth_user_id=eq.'+user.id+
    '&is_primary=eq.true&select=m_uid&limit=1',{},fetchImpl);
  return validUuid(list?.[0]?.m_uid)?list[0].m_uid:null;
}
async function hostGrant(req,env,fetchImpl) {
  const auth=req.headers.get('authorization')||'';
  const res=await fetchImpl(pathFor(env,'rpc/live_host_context',''),{method:'POST',redirect:'manual',
    headers:{...isJson,apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:auth},body:'{}'});
  if(!res.ok)return null;
  const answer=await res.json().catch(()=>null);
  return answer?.can_host===true?answer:null;
}
async function sfu(env,method,route,payload,fetchImpl) {
  const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),12000);
  try {
    const res=await fetchImpl('https://rtc.live.cloudflare.com/v1/apps/'+env.AUDIO_SFU_APP_ID+route,{
      method,redirect:'manual',signal:ctrl.signal,headers:{
        authorization:'Bearer '+env.AUDIO_SFU_APP_SECRET,'content-type':'application/json',
        accept:'application/json'
      },...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    const value=await res.json().catch(()=>null);
    if(!res.ok || !value || typeof value!=='object')
      throw Object.assign(new Error('sfu_unavailable'),{status:502});
    return value;
  }finally {clearTimeout(timer);}
}
async function closeMic(env,m,fetchImpl) {
  if(!m?.sfu_publication_session_id || !MID.test(m.sfu_publication_mid||''))return;
  const result=await sfu(env,'PUT','/sessions/'+encodeURIComponent(m.sfu_publication_session_id)+
    '/tracks/close',{tracks:[{mid:m.sfu_publication_mid}],force:true},fetchImpl);
  if(Array.isArray(result?.tracks)&&result.tracks.some(t=>t.error))
    throw Object.assign(new Error('sfu_mic_close_failed'),{status:502});
}
async function member(env,room,muid,fetchImpl) {
  const q='room_id=eq.'+room+'&m_uid=eq.'+muid+
    '&select=room_id,m_uid,role,status,muted,sfu_publication_session_id,sfu_publication_mid&limit=1';
  return (await service(env,'network_audio_members',q,{},fetchImpl))?.[0]||null;
}
async function roomRow(env,room,fetchImpl) {
  return (await service(env,'network_audio_rooms','id=eq.'+room+
    '&select=id,host_m_uid,title,category_key,country_code,status,max_speakers,max_listeners,created_at&limit=1',{},fetchImpl))?.[0]||null;
}
async function blocked(env,a,b,fetchImpl) {
  if(a===b)return false;
  const [ab,ba]=await Promise.all([
    service(env,'network_blocks','blocker_m_uid=eq.'+a+'&blocked_m_uid=eq.'+b+'&select=blocker_m_uid&limit=1',{},fetchImpl),
    service(env,'network_blocks','blocker_m_uid=eq.'+b+'&blocked_m_uid=eq.'+a+'&select=blocker_m_uid&limit=1',{},fetchImpl)
  ]);
  return !!(ab?.length||ba?.length);
}
async function publishList(env,room,fetchImpl) {
  const people=await service(env,'network_audio_members','room_id=eq.'+room+
    '&status=eq.joined&muted=eq.false&sfu_publication_session_id=not.is.null&select=m_uid,role',{},fetchImpl);
  return (people||[]).map(p=>({participant_id:p.m_uid,role:p.role,track:'mic'}));
}
async function record(env,table,body,fetchImpl) {
  return service(env,table,'',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify(body)},fetchImpl);
}
async function patch(env,table,params,body,fetchImpl) {
  return service(env,table,params,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify(body)},fetchImpl);
}
async function rpc(env,procedure,payload,fetchImpl) {
  return service(env,'rpc/'+procedure,'',{method:'POST',body:JSON.stringify(payload)},fetchImpl);
}
async function clearedMember(env,room,m,fetchImpl) {
  const q='room_id=eq.'+room+'&m_uid=eq.'+m.m_uid;
  return patch(env,'network_audio_members',q,{muted:true,sfu_publication_session_id:null,
    sfu_publication_mid:null},fetchImpl);
}
function privateResponse(res){res.headers.set('cache-control','private, no-store');res.headers.set('vary','origin, authorization');return res;}
function respond(req,env,b,status=200){return privateResponse(reply(req,env,b,status));}
function error(req,env,message,status=400,detail){return privateResponse(fail(req,env,message,status,detail));}
const apiError=(req,env,e)=>error(req,env,e.status===413?'Request too large':
  e.status===400?'Invalid request':'Audio room is temporarily unavailable',
  [400,403,404,409,413].includes(e.status)?e.status:503);

export async function handleAudioRooms(req,env,{fetchImpl=fetch,now=()=>Date.now()}={}) {
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'')||'/';
  if(!path.startsWith(ROOT))return null;
  if(path===ROOT+'/status'&&req.method==='GET')
    return respond(req,env,{ok:true,enabled:audioReady(env),transport:'cloudflare_realtime_sfu',
      recording:false,transcription:false,stage:{max_speakers:4},media_permission:'explicit_only'});
  if(!audioReady(env))return error(req,env,'Audio rooms are not switched on yet',503,{enabled:false});
  const parts=path.slice(ROOT.length).split('/').filter(Boolean);
  if(parts.length===1&&parts[0]==='rooms'&&req.method==='GET') {
    const country=url.searchParams.get('country');
    if(country && !isCountry(country))return error(req,env,'Invalid country code',400);
    try{
      const rows=await service(env,'network_audio_rooms','status=eq.live&'+(country?'country_code=eq.'+country+'&':'')+
        'select=id,title,category_key,country_code,max_speakers,created_at&order=created_at.desc&limit=40',{},fetchImpl);
      return respond(req,env,{rooms:rows||[],enabled:true});
    }catch(e){return apiError(req,env,e);}
  }
  if(!['POST','GET'].includes(req.method))return error(req,env,'Unsupported method',405);
  const user=await bearerUser(req,env,fetchImpl);
  if(!user||!validUuid(user.id))return error(req,env,'Sign in to join an audio room',401);
  const muid=await uidFor(env,user,fetchImpl).catch(()=>null);
  if(!muid)return error(req,env,'Action identity is not linked',403);
  if(parts.length===1&&parts[0]==='rooms'&&req.method==='POST') {
    try{
      const grant=await hostGrant(req,env,fetchImpl);
      if(!grant)return error(req,env,'An active host grant is required',403);
      const b=await body(req),title=typeof b.title==='string'?b.title.trim():'';
      const category=typeof b.category_key==='string'?b.category_key.trim():'';
      if(!title||[...title].length>120 ||
        !/^[a-z0-9_-]{1,64}$/.test(category) ||
        !Array.isArray(grant.allowed_categories)||!grant.allowed_categories.includes(category))
        return error(req,env,'Valid title and authorized category required',400);
      if(b.country_code != null && !isCountry(b.country_code))return error(req,env,'Invalid country',400);
      const rows=await record(env,'network_audio_rooms',{title,category_key:category,
        host_m_uid:muid,country_code:b.country_code||null,
        max_speakers:Math.min(4,Math.max(1,Number(grant.max_stage_seats)||1)),max_listeners:100},fetchImpl);
      const room=rows?.[0];if(!validUuid(room?.id))throw Error('room_insert_failed');
      try{await rpc(env,'network_audio_join_room',{p_room_id:room.id,p_m_uid:muid},fetchImpl);}
      catch(e){await patch(env,'network_audio_rooms','id=eq.'+room.id,{status:'ended',ended_at:new Date(now()).toISOString()},fetchImpl).catch(()=>{});throw e;}
      return respond(req,env,{room:{id:room.id,title,category_key:category,country_code:b.country_code||null},role:'host'},201);
    }catch(e){return apiError(req,env,e);}
  }
  if(parts.length<2 || parts[0]!=='rooms'||!validUuid(parts[1]))
    return error(req,env,'Audio room not found',404);
  const rid=parts[1],action=parts[2]||'';
  try {
    const room=await roomRow(env,rid,fetchImpl);
    if(!room || (room.status!=='live' && action!=='leave'))return error(req,env,'Room unavailable',404);
    if(req.method==='POST'&&action==='join') {
      if(await blocked(env,room.host_m_uid,muid,fetchImpl))return error(req,env,'Room unavailable',404);
      await rpc(env,'network_audio_join_room',{p_room_id:rid,p_m_uid:muid},fetchImpl);
      return respond(req,env,{joined:true,room:{id:room.id,title:room.title,
        category_key:room.category_key,country_code:room.country_code}});
    }
    const self=await member(env,rid,muid,fetchImpl);
    if(!self || self.status!=='joined')return error(req,env,'Join this room before requesting media',403);
    if(req.method==='GET'&&action==='publications') {
      return respond(req,env,{publications:await publishList(env,rid,fetchImpl)});
    }
    if(req.method==='POST'&&action==='mic') {
      if(!['host','speaker'].includes(self.role))return error(req,env,'Speaker permission required',403);
      const b=await body(req);
      if(typeof b.unmute!=='boolean')return error(req,env,'Specify unmute',400);
      if(!b.unmute&&self.sfu_publication_session_id)
        await closeMic(env,self,fetchImpl);
      const updated=await patch(env,'network_audio_members','room_id=eq.'+rid+'&m_uid=eq.'+muid+
        '&status=eq.joined',{muted:!b.unmute,...(!b.unmute?{sfu_publication_session_id:null,sfu_publication_mid:null}:{})},fetchImpl);
      if(!updated?.length)return error(req,env,'Membership expired',409);
      return respond(req,env,{unmuted:b.unmute});
    }
    if(req.method==='POST'&&action==='publish') {
      if(!['host','speaker'].includes(self.role)||self.muted||self.sfu_publication_session_id)
        return error(req,env,'Unmute an authorized speaker before publishing once',403);
      const b=await body(req);
      if(!validDescription(b.offer,'offer')||!MID.test(b.mid||''))return error(req,env,'Invalid audio offer',400);
      const session=await sfu(env,'POST','/sessions/new',undefined,fetchImpl);
      const sessionId=session?.sessionId;
      if(typeof sessionId!=='string'||sessionId.length<5||sessionId.length>256)
        return error(req,env,'Provider did not create a media session',502);
      const negotiated=await sfu(env,'POST','/sessions/'+encodeURIComponent(sessionId)+'/tracks/new',{
        sessionDescription:b.offer,tracks:[{location:'local',mid:b.mid,trackName:'mic'}]
      },fetchImpl);
      if(!validDescription(negotiated?.sessionDescription,'answer')) {
        await closeMic(env,{sfu_publication_session_id:sessionId,sfu_publication_mid:b.mid},fetchImpl).catch(()=>{});
        return error(req,env,'Provider did not accept the audio offer',502);
      }
      const saved=await patch(env,'network_audio_members','room_id=eq.'+rid+'&m_uid=eq.'+muid+
        '&status=eq.joined&muted=eq.false&sfu_publication_session_id=is.null',
        {sfu_publication_session_id:sessionId,sfu_publication_mid:b.mid,last_seen_at:new Date(now()).toISOString()},fetchImpl);
      if(!saved?.length) {
        await closeMic(env,{sfu_publication_session_id:sessionId,sfu_publication_mid:b.mid},fetchImpl).catch(()=>{});
        return error(req,env,'Publication state changed; reconnect to retry',409);
      }
      return respond(req,env,{sessionDescription:negotiated.sessionDescription,published:true});
    }
    if(req.method==='POST'&&action==='subscribe'){
      const b=await body(req),publisher=b.publisher_m_uid;
      if(!validUuid(publisher)||publisher===muid)return error(req,env,'Choose another current speaker',400);
      const p=await member(env,rid,publisher,fetchImpl);
      if(!p || p.status!=='joined'||p.muted||!p.sfu_publication_session_id ||
        !['host','speaker'].includes(p.role)||await blocked(env,publisher,muid,fetchImpl))
        return error(req,env,'Speaker is not available',404);
      const existing=await service(env,'network_audio_subscriptions','room_id=eq.'+rid+
        '&listener_m_uid=eq.'+muid+'&publisher_m_uid=eq.'+publisher+'&status=neq.closed&select=id&limit=1',{},fetchImpl);
      if(existing?.length)return error(req,env,'Subscription already exists',409);
      const session=await sfu(env,'POST','/sessions/new',undefined,fetchImpl),sid=session?.sessionId;
      if(typeof sid!=='string'||sid.length<5||sid.length>256)return error(req,env,'Provider session unavailable',502);
      const offer=await sfu(env,'POST','/sessions/'+encodeURIComponent(sid)+'/tracks/new',{
        tracks:[{location:'remote',sessionId:p.sfu_publication_session_id,trackName:'mic'}]
      },fetchImpl);
      if(!validDescription(offer?.sessionDescription,'offer'))
        return error(req,env,'Provider did not offer audio',502);
      const rows=await record(env,'network_audio_subscriptions',{room_id:rid,listener_m_uid:muid,
        publisher_m_uid:publisher,sfu_session_id:sid,sfu_mid:offer?.tracks?.[0]?.mid||'0'},fetchImpl);
      if(!validUuid(rows?.[0]?.id))return error(req,env,'Could not save receiving session',503);
      return respond(req,env,{subscription_id:rows[0].id,
        publisher_m_uid:publisher,sessionDescription:offer.sessionDescription});
    }
    if(req.method==='POST'&&action==='answer') {
      const b=await body(req);
      if(!validUuid(b.subscription_id)||!validDescription(b.answer,'answer'))
        return error(req,env,'Invalid receive answer',400);
      const rows=await service(env,'network_audio_subscriptions','id=eq.'+b.subscription_id+
        '&room_id=eq.'+rid+'&listener_m_uid=eq.'+muid+
        '&status=eq.negotiating&select=id,sfu_session_id&limit=1',{},fetchImpl);
      if(!rows?.length)return error(req,env,'Subscription missing or already negotiated',404);
      const ok=await sfu(env,'PUT','/sessions/'+encodeURIComponent(rows[0].sfu_session_id)+
        '/renegotiate',{sessionDescription:b.answer},fetchImpl);
      if(ok?.error)return error(req,env,'Provider rejected receive answer',502);
      await patch(env,'network_audio_subscriptions','id=eq.'+rows[0].id+'&status=eq.negotiating',
        {status:'active',updated_at:new Date(now()).toISOString()},fetchImpl);
      return respond(req,env,{connected:true});
    }
    if(req.method==='POST'&&action==='speaker'){
      if(room.host_m_uid!==muid)return error(req,env,'Only the host can set speaker permissions',403);
      const b=await body(req);
      if(!validUuid(b.target_m_uid)||typeof b.allow!=='boolean')
        return error(req,env,'Choose a room member and speaker permission',400);
      const target=await member(env,rid,b.target_m_uid,fetchImpl);
      if(!target||target.status!=='joined')return error(req,env,'Member not in room',404);
      if(!b.allow&&target.sfu_publication_session_id)await closeMic(env,target,fetchImpl);
      await rpc(env,'network_audio_assign_speaker',{p_room_id:rid,p_host_m_uid:muid,
        p_target_m_uid:b.target_m_uid,p_speaker:b.allow},fetchImpl);
      if(!b.allow)await clearedMember(env,rid,target,fetchImpl);
      return respond(req,env,{speaker:b.allow});
    }
    if(req.method==='POST'&&action==='leave') {
      if(self.sfu_publication_session_id)await closeMic(env,self,fetchImpl);
      await clearedMember(env,rid,self,fetchImpl);
      await patch(env,'network_audio_members','room_id=eq.'+rid+'&m_uid=eq.'+muid,
        {status:'left',muted:true,left_at:new Date(now()).toISOString()},fetchImpl);
      await patch(env,'network_audio_subscriptions','room_id=eq.'+rid+'&listener_m_uid=eq.'+muid+
        '&status=neq.closed',{status:'closed'},fetchImpl);
      return respond(req,env,{left:true});
    }
    if(req.method==='POST'&&action==='end'){
      if(room.host_m_uid!==muid)return error(req,env,'Only the host can end the room',403);
      await patch(env,'network_audio_rooms','id=eq.'+rid+'&status=eq.live',
        {status:'ended',ended_at:new Date(now()).toISOString()},fetchImpl);
      const live=await service(env,'network_audio_members','room_id=eq.'+rid+
        '&sfu_publication_session_id=not.is.null&select=m_uid,sfu_publication_session_id,sfu_publication_mid',{},fetchImpl);
      let cleanupFailed=0;
      for(const peer of live||[]) {
        try {await closeMic(env,peer,fetchImpl);await clearedMember(env,rid,peer,fetchImpl);}
        catch {cleanupFailed++;}
      }
      await patch(env,'network_audio_members','room_id=eq.'+rid+'&status=eq.joined',
        {status:'left',muted:true,left_at:new Date(now()).toISOString()},fetchImpl);
      return respond(req,env,{ended:true,cleanup_pending:cleanupFailed>0});
    }
    return error(req,env,'Audio operation not found',404);
  }catch(e){return apiError(req,env,e);}
}
