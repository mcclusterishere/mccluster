/* EQUITY UPRISE AUDIO ROOMS — Realtime SFU (OFF BY DEFAULT).
   This is separate from single-host Cloudflare Stream live video.
   No SFU credentials, SDP, internal member identity, or media URLs leave
   the Worker except the SDP intended for that authenticated endpoint.
   Audio only. No recording, transcription or background capture.
   SQL: supabase/pending/20261019235000_network_sfu_audio_rooms.sql

   People in a room are shown to each other by an opaque participant_id and
   their public display name; m_uid never leaves this file. Listener presence
   is a number. Only the host sees raised hands.

   A signed-out visitor (owner, 2026-10-20) may listen to a room in the
   country Cloudflare reads from their connection, and nowhere else: going to
   another region's conversations takes signing in. The visitor holds a
   signed pass bound to one room, one seat and that country, and every call
   re-reads the connection country. Visitors only ever listen.
*/
import { fail, reply, corsHeaders } from './lib/http.js';
import { bearerUser } from './world-layers.js';
import { isCountry } from './intel/news-country-codes.js';

const ROOT='/v1/mnet/audio';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MID=/^[a-zA-Z0-9]{1,16}$/;
const APP_ID=/^[a-zA-Z0-9_-]{5,128}$/;
const LIMIT_SDP=64_000;
const PASS_SECONDS=4*60*60;
const VISITOR_ACTIONS=new Set(['self','stage','publications','subscribe','answer','leave']);
const SEAT='participant_id,room_id,m_uid,role,status,muted,hand_raised_at,last_seen_at,expires_at,'+
  'sfu_publication_session_id,sfu_publication_mid';
export function audioReady(env) {
  return String(env?.AUDIO_SFU_ROOMS_ENABLED||'').toLowerCase()==='true' &&
    APP_ID.test(String(env?.AUDIO_SFU_APP_ID||'')) &&
    typeof env?.AUDIO_SFU_APP_SECRET==='string' && env.AUDIO_SFU_APP_SECRET.length>12 &&
    !!env?.SUPABASE_URL && !!env?.SUPABASE_SERVICE_ROLE_KEY;
}
export function visitorListenReady(env) {
  return audioReady(env) && String(env?.AUDIO_ROOMS_VISITOR_LISTEN_ENABLED||'').toLowerCase()==='true' &&
    typeof env?.AUDIO_ROOM_PASS_KEY==='string' && env.AUDIO_ROOM_PASS_KEY.length>=32;
}
export function connectionCountry(req) {
  // Cloudflare's own reading of the connection. Never a header, query or
  // body the browser controls; unknown (XX, T1, local dev) is no country.
  const c=req?.cf?.country;
  return typeof c==='string'&&isCountry(c)?c:null;
}
export function validDescription(desc,type) {
  return desc && desc.type===type && typeof desc.sdp==='string' &&
    desc.sdp.startsWith('v=0') && desc.sdp.length>=40 && desc.sdp.length<=LIMIT_SDP;
}
const validUuid=x=>typeof x==='string'&&UUID.test(x);
const safeImage=u=>typeof u==='string'&&/^https:\/\/[^\s"'<>\\]{1,500}$/.test(u)?u:'';
const isJson={ 'content-type':'application/json' };

/* The visitor pass: rp1.<claims>.<HMAC-SHA256>, claims {r room, p seat, c country, e expiry}. */
const enc=new TextEncoder();
const b64u=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64u=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
function passKey(env,use){
  return crypto.subtle.importKey('raw',enc.encode(env.AUDIO_ROOM_PASS_KEY),{name:'HMAC',hash:'SHA-256'},false,[use]);
}
export async function signPass(env,claims) {
  const head='rp1.'+b64u(enc.encode(JSON.stringify(claims)));
  return head+'.'+b64u(new Uint8Array(await crypto.subtle.sign('HMAC',await passKey(env,'sign'),enc.encode(head))));
}
export async function readPass(env,token,nowMs) {
  const m=/^rp1\.([A-Za-z0-9_-]{10,600})\.([A-Za-z0-9_-]{43})$/.exec(token||'');
  if(!m)return null;
  try {
    if(!await crypto.subtle.verify('HMAC',await passKey(env,'verify'),unb64u(m[2]),enc.encode('rp1.'+m[1])))return null;
    const c=JSON.parse(new TextDecoder().decode(unb64u(m[1])));
    return c&&validUuid(c.r)&&validUuid(c.p)&&isCountry(c.c)&&Number.isInteger(c.e)&&c.e*1000>nowMs?c:null;
  } catch {return null;}
}

async function body(req) {
  if(Number(req.headers.get('content-length')||0)>80_000)throw Object.assign(new Error('Request body too large'),{status:413});
  const content=await req.text();if(content.length>80_000)throw Object.assign(new Error('Request body too large'),{status:413});
  try { return content?JSON.parse(content):{}; } catch { throw Object.assign(new Error('Invalid JSON body'),{status:400}); }
}
function pathFor(env,table,params) {
  return env.SUPABASE_URL+'/rest/v1/'+table+(params?'?'+params:'');
}
// The SQL raises AU403/AU404/AU409 with a reason; those reach the person in words.
const DB_STATUS={AU403:403,AU404:404,AU409:409};
const REASONS={
  audio_room_full:'This room is full right now',
  audio_room_closed:'This room has ended',
  audio_room_member_kicked:'The host removed you from this room',
  audio_stage_full:'The stage is full',
  audio_visitor_outside_region:'Sign in to join conversations outside your region',
  audio_visitor_country_unknown:'Sign in to join this conversation',
  audio_speaker_not_allowed:'Only a signed-in listener can be invited to speak',
  audio_host_required:'Only the host can do that',
  audio_member_not_joined:'That person is not in the room'
};
async function service(env,table,params='',init={},fetchImpl=fetch) {
  const res=await fetchImpl(pathFor(env,table,params),{...init,redirect:'manual',
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,
      ...isJson, ...(init.headers||{})}});
  if(!res.ok) {
    const d=await res.json().catch(()=>null);
    throw Object.assign(new Error('audio_database_unavailable'),
      {status:DB_STATUS[d?.code]||res.status,reason:REASONS[d?.message]?d.message:null});
  }
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
async function stopReceiver(env,s,fetchImpl) {
  if(!s?.sfu_session_id||!MID.test(s.sfu_mid||''))return;
  const out=await sfu(env,'PUT','/sessions/'+encodeURIComponent(s.sfu_session_id)+
    '/tracks/close',{tracks:[{mid:s.sfu_mid}],force:true},fetchImpl);
  if(Array.isArray(out?.tracks)&&out.tracks.some(t=>t.error))
    throw Object.assign(new Error('sfu_receiver_close_failed'),{status:502});
}
async function closeSubscriptions(env,room,scope,fetchImpl) {
  // A removed or blocked listener must not keep receiving on a still-live
  // SFU connection. Force-close subscriptions server-side before reporting
  // successful leave, kick or demotion.
  const matches=await service(env,'network_audio_subscriptions','room_id=eq.'+room+
    '&status=neq.closed&'+scope+
    '&select=id,sfu_session_id,sfu_mid',{},fetchImpl);
  for(const sub of matches||[]) {
    await stopReceiver(env,sub,fetchImpl);
    await patch(env,'network_audio_subscriptions','id=eq.'+sub.id+'&status=neq.closed',
      {status:'closed'},fetchImpl);
  }
}
const either=pid=>'or=(listener_participant_id.eq.'+pid+',publisher_participant_id.eq.'+pid+')';
async function seatOf(env,room,muid,fetchImpl) {
  return (await service(env,'network_audio_members','room_id=eq.'+room+'&m_uid=eq.'+muid+
    '&select='+SEAT+'&limit=1',{},fetchImpl))?.[0]||null;
}
async function seatById(env,room,pid,fetchImpl) {
  return (await service(env,'network_audio_members','room_id=eq.'+room+'&participant_id=eq.'+pid+
    '&select='+SEAT+'&limit=1',{},fetchImpl))?.[0]||null;
}
async function roomRow(env,room,fetchImpl) {
  return (await service(env,'network_audio_rooms','id=eq.'+room+
    '&select=id,host_m_uid,title,category_key,country_code,visitors_may_listen,status,max_speakers,max_listeners,created_at&limit=1',{},fetchImpl))?.[0]||null;
}
async function blocked(env,a,b,fetchImpl) {
  if(!a||!b||a===b)return false;
  const [ab,ba]=await Promise.all([
    service(env,'network_blocks','blocker_m_uid=eq.'+a+'&blocked_m_uid=eq.'+b+'&select=blocker_m_uid&limit=1',{},fetchImpl),
    service(env,'network_blocks','blocker_m_uid=eq.'+b+'&blocked_m_uid=eq.'+a+'&select=blocker_m_uid&limit=1',{},fetchImpl)
  ]);
  return !!(ab?.length||ba?.length);
}
// Public names only: what the member chose to show on a public profile, as the
// country feed does. Anyone else on the stage is "Member", with no picture.
async function names(env,muids,fetchImpl) {
  const ids=[...new Set(muids.filter(validUuid))];
  if(!ids.length)return new Map();
  const rows=await service(env,'network_profiles','m_uid=in.('+ids.join(',')+')&visibility=eq.public&select=m_uid,display_name,avatar_url,visibility',{},fetchImpl).catch(()=>[]);
  return new Map((rows||[]).filter(p=>p.visibility==='public')
    .map(p=>[p.m_uid,{display_name:String(p.display_name||'').trim().slice(0,80),avatar_url:safeImage(p.avatar_url)}]));
}
function person(p,people,extra) {
  const n=people.get(p.m_uid)||{};
  return {participant_id:p.participant_id,display_name:n.display_name||'Member',avatar_url:n.avatar_url||'',...extra};
}
function card(r,people) {
  const host=people.get(r.host_m_uid)||{},country=isCountry(r.country_code)?r.country_code:null;
  return {id:r.id,title:String(r.title||'').slice(0,120),category_key:r.category_key||'',country_code:country,
    visitors_may_listen:!!country&&r.visitors_may_listen!==false,
    max_speakers:Math.min(4,Number(r.max_speakers)||1),created_at:r.created_at||null,
    host:{display_name:host.display_name||'Host',avatar_url:host.avatar_url||''},
    speakers:Math.max(0,Number(r.speakers)||0),listeners:Math.max(0,Number(r.listeners)||0)};
}
async function publishList(env,room,fetchImpl) {
  const people=await service(env,'network_audio_members','room_id=eq.'+room+
    '&status=eq.joined&muted=eq.false&sfu_publication_session_id=not.is.null&select=participant_id,role',{},fetchImpl);
  return (people||[]).filter(p=>validUuid(p.participant_id)).map(p=>({participant_id:p.participant_id,role:p.role,track:'mic'}));
}
async function record(env,table,body,fetchImpl) {
  return service(env,table,'',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify(body)},fetchImpl);
}
async function patch(env,table,params,body,fetchImpl) {
  return service(env,table,params,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify(body)},fetchImpl);
}
async function remove(env,table,params,fetchImpl) {
  return service(env,table,params,{method:'DELETE',headers:{prefer:'return=minimal'}},fetchImpl);
}
async function rpc(env,procedure,payload,fetchImpl) {
  return service(env,'rpc/'+procedure,'',{method:'POST',body:JSON.stringify(payload)},fetchImpl);
}
async function clearedMember(env,room,m,fetchImpl) {
  return patch(env,'network_audio_members','room_id=eq.'+room+'&participant_id=eq.'+m.participant_id,
    {muted:true,sfu_publication_session_id:null,sfu_publication_mid:null},fetchImpl);
}
function privateResponse(res){res.headers.set('cache-control','private, no-store');res.headers.set('vary','origin, authorization');return res;}
function respond(req,env,b,status=200){return privateResponse(reply(req,env,b,status));}
function error(req,env,message,status=400,detail){return privateResponse(fail(req,env,message,status,detail));}
const signIn=(req,env,message,status=403)=>error(req,env,message,status,{sign_in:true});
const apiError=(req,env,e)=>{
  const said=e.reason&&REASONS[e.reason];
  if(said)return error(req,env,said,e.status,/^Sign in/.test(said)?{sign_in:true}:undefined);
  return error(req,env,e.status===413?'Request too large':
    e.status===400?'Invalid request':'Audio room is temporarily unavailable',
    [400,403,404,409,413].includes(e.status)?e.status:503);
};

export async function handleAudioRooms(req,env,{fetchImpl=fetch,now=()=>Date.now()}={}) {
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'')||'/';
  if(path!==ROOT&&!path.startsWith(ROOT+'/'))return null;
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(req,env)});
  if(path===ROOT+'/status'&&req.method==='GET') {
    const on=audioReady(env);
    return respond(req,env,{ok:true,enabled:on,transport:'cloudflare_realtime_sfu',
      recording:false,transcription:false,stage:{max_speakers:4},media_permission:'explicit_only',
      // The caller's own connection country, so a signed-out page can say where it may listen.
      visitors:{listen:visitorListenReady(env),country:on?connectionCountry(req):null,other_regions:'sign_in'}});
  }
  if(!audioReady(env))return error(req,env,'Audio rooms are not switched on yet',503,{enabled:false});
  const parts=path.slice(ROOT.length).split('/').filter(Boolean);
  if(parts.length===1&&parts[0]==='rooms'&&req.method==='GET') {
    const country=url.searchParams.get('country');
    if(country && !isCountry(country))return error(req,env,'Invalid country code',400);
    try{
      const rows=(await rpc(env,'network_audio_directory',{p_country:country||null,p_room_id:null},fetchImpl)||[])
        .filter(r=>validUuid(r?.id));
      const people=await names(env,rows.map(r=>r.host_m_uid),fetchImpl);
      // Independently project public fields; host_m_uid stops here.
      return respond(req,env,{rooms:rows.map(r=>card(r,people)),enabled:true});
    }catch(e){return apiError(req,env,e);}
  }
  if(!['POST','GET'].includes(req.method))return error(req,env,'Unsupported method',405);
  const auth=req.headers.get('authorization')||'';
  if(parts.length===3&&parts[0]==='rooms'&&parts[2]==='listen'&&req.method==='POST')
    return visitorListen(req,env,parts[1],auth,{fetchImpl,now});
  const passToken=/^bearer\s+(rp1\.\S+)$/i.exec(auth)?.[1];
  let who;
  if(passToken) {
    // A visitor's pass is never sent to Supabase Auth; it is checked here.
    if(!visitorListenReady(env))return signIn(req,env,'Sign in to join conversations');
    if(parts.length<3||parts[0]!=='rooms'||!validUuid(parts[1]))return error(req,env,'Audio room not found',404);
    if(!VISITOR_ACTIONS.has(parts[2]))return signIn(req,env,'Sign in to do that');
    const pass=await readPass(env,passToken,now());
    if(!pass||pass.r!==parts[1])return signIn(req,env,'Your listening pass has ended. Join again to keep listening',401);
    if(connectionCountry(req)!==pass.c)return signIn(req,env,'Sign in to keep listening from another region');
    who={visitor:true,muid:null,pass};
  } else {
    const user=await bearerUser(req,env,fetchImpl);
    if(!user||!validUuid(user.id))return error(req,env,'Sign in to join an audio room',401);
    const muid=await uidFor(env,user,fetchImpl).catch(()=>null);
    if(!muid)return error(req,env,'Action identity is not linked',403);
    who={visitor:false,muid};
  }
  const muid=who.muid;
  if(!who.visitor&&parts.length===1&&parts[0]==='rooms'&&req.method==='POST') {
    try{
      const grant=await hostGrant(req,env,fetchImpl);
      if(!grant)return error(req,env,'An active host grant is required',403);
      const b=await body(req),title=typeof b.title==='string'?b.title.trim():'';
      const category=typeof b.category_key==='string'?b.category_key.trim():'';
      if(!title||[...title].length>120 ||
        !/^[a-z0-9_-]{1,64}$/.test(category) ||
        !Array.isArray(grant.allowed_categories)||!grant.allowed_categories.includes(category))
        return error(req,env,'Valid title and authorized category required',400);
      // A room belongs to the place the host chose, else where the host is
      // connecting from; null is a room for everywhere (members only).
      const country=b.country_code===undefined?connectionCountry(req):b.country_code;
      if(country != null && !isCountry(country))return error(req,env,'Invalid country',400);
      const visitors=b.visitors_may_listen!==false;
      const rows=await record(env,'network_audio_rooms',{title,category_key:category,
        host_m_uid:muid,country_code:country||null,visitors_may_listen:visitors,
        max_speakers:Math.min(4,Math.max(1,Number(grant.max_stage_seats)||1)),max_listeners:100},fetchImpl);
      const room=rows?.[0];if(!validUuid(room?.id))throw Error('room_insert_failed');
      let seat;
      try{seat=await rpc(env,'network_audio_join_room',{p_room_id:room.id,p_m_uid:muid},fetchImpl);}
      catch(e){await patch(env,'network_audio_rooms','id=eq.'+room.id,{status:'ended',ended_at:new Date(now()).toISOString()},fetchImpl).catch(()=>{});throw e;}
      return respond(req,env,{room:{id:room.id,title,category_key:category,country_code:country||null,
        visitors_may_listen:!!country&&visitors},participant_id:validUuid(seat)?seat:null,role:'host'},201);
    }catch(e){return apiError(req,env,e);}
  }
  if(parts.length<2 || parts[0]!=='rooms'||!validUuid(parts[1]))
    return error(req,env,'Audio room not found',404);
  const rid=parts[1],action=parts[2]||'';
  try {
    const room=await roomRow(env,rid,fetchImpl);
    if(!room || (room.status!=='live' && action!=='leave'))return error(req,env,'Room unavailable',404);
    if(who.visitor&&action!=='leave'&&(room.country_code!==who.pass.c||room.visitors_may_listen===false))
      return signIn(req,env,REASONS.audio_visitor_outside_region);
    if(!who.visitor&&req.method==='POST'&&action==='join') {
      if(await blocked(env,room.host_m_uid,muid,fetchImpl))return error(req,env,'Room unavailable',404);
      const seat=await rpc(env,'network_audio_join_room',{p_room_id:rid,p_m_uid:muid},fetchImpl);
      return respond(req,env,{joined:true,participant_id:validUuid(seat)?seat:null,room:{id:room.id,title:room.title,
        category_key:room.category_key,country_code:room.country_code}});
    }
    const self=who.visitor?await seatById(env,rid,who.pass.p,fetchImpl):await seatOf(env,rid,muid,fetchImpl);
    const seated=self&&self.status==='joined'&&(who.visitor
      ?self.m_uid==null&&Date.parse(self.expires_at)>now():self.m_uid===muid);
    if(!seated) {
      if(action==='leave')return respond(req,env,{left:true});
      return error(req,env,'Join this room before requesting media',403);
    }
    const isHost=!who.visitor&&room.host_m_uid===muid;
    const you={participant_id:self.participant_id,role:self.role,muted:self.muted,host:isHost,
      visitor:who.visitor,hand_raised:!!self.hand_raised_at};
    if(req.method==='GET'&&(action==='self'||action==='stage')&&Date.parse(self.last_seen_at)<now()-45_000) {
      // Checking in keeps a seat counted; a visitor seat lapses two minutes after the last one.
      await patch(env,'network_audio_members','participant_id=eq.'+self.participant_id+'&status=eq.joined',
        {last_seen_at:new Date(now()).toISOString()},fetchImpl);
    }
    if(req.method==='GET'&&action==='self')return respond(req,env,you);
    if(req.method==='GET'&&action==='stage') {
      const [people,counts]=await Promise.all([
        service(env,'network_audio_members','room_id=eq.'+rid+
          '&status=eq.joined&or=(role.in.(host,speaker),hand_raised_at.not.is.null)'+
          '&select=participant_id,m_uid,role,muted,hand_raised_at,joined_at&order=joined_at.asc&limit=60',{},fetchImpl),
        rpc(env,'network_audio_seat_counts',{p_room_id:rid},fetchImpl)
      ]);
      const onStage=(people||[]).filter(p=>p.role==='host'||p.role==='speaker');
      const hands=isHost?(people||[]).filter(p=>p.role==='listener'&&p.hand_raised_at&&p.m_uid):[];
      const named=await names(env,[...onStage,...hands].map(p=>p.m_uid),fetchImpl);
      const c=(Array.isArray(counts)?counts[0]:counts)||{};
      return respond(req,env,{you,
        stage:onStage.map(p=>person(p,named,{role:p.role,muted:!!p.muted,you:p.participant_id===self.participant_id})),
        listeners:Math.max(0,Number(c.listeners)||0),
        hands:hands.map(p=>person(p,named,{raised_at:p.hand_raised_at}))});
    }
    if(req.method==='GET'&&action==='publications') {
      return respond(req,env,{publications:await publishList(env,rid,fetchImpl)});
    }
    if(req.method==='POST'&&action==='hand') {
      if(who.visitor)return signIn(req,env,'Sign in to ask to speak');
      if(self.role!=='listener')return error(req,env,'You are already on the stage',409);
      const b=await body(req);
      if(typeof b.raise!=='boolean')return error(req,env,'Specify raise',400);
      const updated=await patch(env,'network_audio_members','participant_id=eq.'+self.participant_id+
        '&status=eq.joined&role=eq.listener',{hand_raised_at:b.raise?new Date(now()).toISOString():null},fetchImpl);
      if(!updated?.length)return error(req,env,'Membership expired',409);
      return respond(req,env,{hand_raised:b.raise});
    }
    if(req.method==='POST'&&action==='mic') {
      if(!['host','speaker'].includes(self.role))return error(req,env,'Speaker permission required',403);
      const b=await body(req);
      if(typeof b.unmute!=='boolean')return error(req,env,'Specify unmute',400);
      if(!b.unmute&&self.sfu_publication_session_id) {
        await closeMic(env,self,fetchImpl);
        await closeSubscriptions(env,rid,'publisher_participant_id=eq.'+self.participant_id,fetchImpl);
      }
      const updated=await patch(env,'network_audio_members','participant_id=eq.'+self.participant_id+
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
      const saved=await patch(env,'network_audio_members','participant_id=eq.'+self.participant_id+
        '&status=eq.joined&muted=eq.false&sfu_publication_session_id=is.null',
        {sfu_publication_session_id:sessionId,sfu_publication_mid:b.mid,last_seen_at:new Date(now()).toISOString()},fetchImpl);
      if(!saved?.length) {
        await closeMic(env,{sfu_publication_session_id:sessionId,sfu_publication_mid:b.mid},fetchImpl).catch(()=>{});
        return error(req,env,'Publication state changed; reconnect to retry',409);
      }
      return respond(req,env,{sessionDescription:negotiated.sessionDescription,published:true});
    }
    if(req.method==='POST'&&action==='subscribe'){
      const b=await body(req),publisher=b.publisher;
      if(!validUuid(publisher)||publisher===self.participant_id)return error(req,env,'Choose another current speaker',400);
      const p=await seatById(env,rid,publisher,fetchImpl);
      if(!p || p.status!=='joined'||p.muted||!p.sfu_publication_session_id ||
        !['host','speaker'].includes(p.role)||(!who.visitor&&await blocked(env,p.m_uid,muid,fetchImpl)))
        return error(req,env,'Speaker is not available',404);
      const existing=await service(env,'network_audio_subscriptions','room_id=eq.'+rid+
        '&listener_participant_id=eq.'+self.participant_id+'&publisher_participant_id=eq.'+publisher+
        '&status=neq.closed&select=id&limit=1',{},fetchImpl);
      if(existing?.length)return error(req,env,'Subscription already exists',409);
      const session=await sfu(env,'POST','/sessions/new',undefined,fetchImpl),sid=session?.sessionId;
      if(typeof sid!=='string'||sid.length<5||sid.length>256)return error(req,env,'Provider session unavailable',502);
      const offer=await sfu(env,'POST','/sessions/'+encodeURIComponent(sid)+'/tracks/new',{
        tracks:[{location:'remote',sessionId:p.sfu_publication_session_id,trackName:'mic'}]
      },fetchImpl);
      if(!validDescription(offer?.sessionDescription,'offer')||
          !MID.test(offer?.tracks?.[0]?.mid||''))
        return error(req,env,'Provider did not offer audio',502);
      const rows=await record(env,'network_audio_subscriptions',{room_id:rid,listener_participant_id:self.participant_id,
        publisher_participant_id:publisher,sfu_session_id:sid,sfu_mid:offer.tracks[0].mid},fetchImpl);
      if(!validUuid(rows?.[0]?.id))return error(req,env,'Could not save receiving session',503);
      return respond(req,env,{subscription_id:rows[0].id,
        publisher,sessionDescription:offer.sessionDescription});
    }
    if(req.method==='POST'&&action==='answer') {
      const b=await body(req);
      if(!validUuid(b.subscription_id)||!validDescription(b.answer,'answer'))
        return error(req,env,'Invalid receive answer',400);
      const rows=await service(env,'network_audio_subscriptions','id=eq.'+b.subscription_id+
        '&room_id=eq.'+rid+'&listener_participant_id=eq.'+self.participant_id+
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
      if(!isHost)return error(req,env,'Only the host can set speaker permissions',403);
      const b=await body(req);
      if(!validUuid(b.target)||typeof b.allow!=='boolean')
        return error(req,env,'Choose a room member and speaker permission',400);
      const target=await seatById(env,rid,b.target,fetchImpl);
      if(!target||target.status!=='joined')return error(req,env,'Member not in room',404);
      if(!b.allow) {
        if(target.sfu_publication_session_id)await closeMic(env,target,fetchImpl);
        await closeSubscriptions(env,rid,'publisher_participant_id=eq.'+b.target,fetchImpl);
      }
      await rpc(env,'network_audio_assign_speaker',{p_room_id:rid,p_host_m_uid:muid,
        p_target:b.target,p_speaker:b.allow},fetchImpl);
      if(!b.allow)await clearedMember(env,rid,target,fetchImpl);
      return respond(req,env,{speaker:b.allow});
    }
    if(req.method==='POST'&&action==='kick'){
      if(!isHost)return error(req,env,'Only the host can remove members',403);
      const b=await body(req);
      if(!validUuid(b.target)||b.target===self.participant_id)return error(req,env,'Invalid member',400);
      const target=await seatById(env,rid,b.target,fetchImpl);
      if(!target||target.status!=='joined')return error(req,env,'Member not in room',404);
      if(target.sfu_publication_session_id)await closeMic(env,target,fetchImpl);
      await closeSubscriptions(env,rid,either(b.target),fetchImpl);
      if(target.m_uid==null)await remove(env,'network_audio_members','participant_id=eq.'+b.target,fetchImpl);
      else {
        await clearedMember(env,rid,target,fetchImpl);
        await patch(env,'network_audio_members','participant_id=eq.'+b.target,
          {status:'kicked',role:'listener',muted:true,hand_raised_at:null,left_at:new Date(now()).toISOString()},fetchImpl);
      }
      return respond(req,env,{removed:true});
    }
    if(req.method==='POST'&&action==='leave') {
      if(self.sfu_publication_session_id)await closeMic(env,self,fetchImpl);
      await closeSubscriptions(env,rid,either(self.participant_id),fetchImpl);
      // A visitor seat keeps nothing once it is left.
      if(who.visitor)await remove(env,'network_audio_members','participant_id=eq.'+self.participant_id,fetchImpl);
      else {
        await clearedMember(env,rid,self,fetchImpl);
        await patch(env,'network_audio_members','participant_id=eq.'+self.participant_id,
          {status:'left',muted:true,hand_raised_at:null,left_at:new Date(now()).toISOString()},fetchImpl);
      }
      return respond(req,env,{left:true});
    }
    if(req.method==='POST'&&action==='end'){
      if(!isHost)return error(req,env,'Only the host can end the room',403);
      await patch(env,'network_audio_rooms','id=eq.'+rid+'&status=eq.live',
        {status:'ended',ended_at:new Date(now()).toISOString()},fetchImpl);
      const live=await service(env,'network_audio_members','room_id=eq.'+rid+
        '&sfu_publication_session_id=not.is.null&select=participant_id,sfu_publication_session_id,sfu_publication_mid',{},fetchImpl);
      let cleanupFailed=0;
      for(const peer of live||[]) {
        try {await closeMic(env,peer,fetchImpl);await clearedMember(env,rid,peer,fetchImpl);}
        catch {cleanupFailed++;}
      }
      await closeSubscriptions(env,rid,'id=not.is.null',fetchImpl).catch(()=>{cleanupFailed++;});
      await remove(env,'network_audio_members','room_id=eq.'+rid+'&m_uid=is.null',fetchImpl).catch(()=>{cleanupFailed++;});
      await patch(env,'network_audio_members','room_id=eq.'+rid+'&status=eq.joined',
        {status:'left',muted:true,hand_raised_at:null,left_at:new Date(now()).toISOString()},fetchImpl);
      return respond(req,env,{ended:true,cleanup_pending:cleanupFailed>0});
    }
    if(who.visitor)return signIn(req,env,'Sign in to do that');
    return error(req,env,'Audio operation not found',404);
  }catch(e){return apiError(req,env,e);}
}

// A signed-out visitor takes a listening seat in a room of their own
// connection country. No account, no microphone, nothing stored about them.
async function visitorListen(req,env,rid,auth,{fetchImpl,now}) {
  if(!validUuid(rid))return error(req,env,'Audio room not found',404);
  if(auth)return error(req,env,'Signed-in members join the room instead',400);
  if(!visitorListenReady(env))return signIn(req,env,'Sign in to join conversations');
  const country=connectionCountry(req);
  if(!country)return signIn(req,env,REASONS.audio_visitor_country_unknown);
  try {
    const room=await roomRow(env,rid,fetchImpl);
    if(!room||room.status!=='live')return error(req,env,'Room unavailable',404);
    if(room.visitors_may_listen===false||room.country_code!==country)
      return signIn(req,env,REASONS.audio_visitor_outside_region);
    const seat=await rpc(env,'network_audio_join_visitor',{p_room_id:rid,p_country:country},fetchImpl);
    if(!validUuid(seat))throw Object.assign(new Error('visitor_seat_failed'),{status:503});
    const e=Math.floor(now()/1000)+PASS_SECONDS;
    const pass=await signPass(env,{v:1,r:rid,p:seat,c:country,e});
    return respond(req,env,{joined:true,visitor:true,participant_id:seat,pass,
      expires_at:new Date(e*1000).toISOString(),
      room:{id:room.id,title:room.title,category_key:room.category_key,country_code:room.country_code}},201);
  }catch(e){return apiError(req,env,e);}
}
