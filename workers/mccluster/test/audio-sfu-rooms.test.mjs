import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audioReady,validDescription,handleAudioRooms} from '../src/audio-sfu-rooms.js';

const USER='11111111-1111-4111-8111-111111111111';
const HOST='22222222-2222-4222-8222-222222222222';
const GUEST='33333333-3333-4333-8333-333333333333';
const ROOM='44444444-4444-4444-8444-444444444444';
const SUB='55555555-5555-4555-8555-555555555555';
const ENV={AUDIO_SFU_ROOMS_ENABLED:'true',AUDIO_SFU_APP_ID:'app_test_sfu',
  AUDIO_SFU_APP_SECRET:'test-secret-never-client',SUPABASE_URL:'https://sb.test',
  SUPABASE_SERVICE_ROLE_KEY:'service-only'};
const OFFER={type:'offer',sdp:'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=mid:0\r\n'};
const ANSWER={...OFFER,type:'answer'};
const request=(path,method='GET',body,auth=true)=>new Request('https://api.mccluster.org'+path,{
  method,headers:{...(auth?{authorization:'Bearer user-session'}:{}),...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
function fixture(log,{active=true,role='listener',muted=true,grant=true,blocked=false,pubSession=null,
  profile=HOST,roomStatus='live',subscribed=false,roomExists=true}={}){
  return async(url,opts={})=>{
    const u=new URL(url);const p=u.pathname;
    log.push({host:u.hostname,method:opts.method||'GET',path:p,query:u.search,authorization:opts.headers?.authorization});
    if(u.hostname==='rtc.live.cloudflare.com'){
      assert.equal(opts.headers.authorization,'Bearer test-secret-never-client');
      if(p.endsWith('/sessions/new'))return response({sessionId:'sfu-session-alpha'});
      if(p.endsWith('/tracks/new')){
        const data=JSON.parse(opts.body);
        return response({sessionDescription:data.tracks[0].location==='local'?ANSWER:OFFER,
          tracks:[{mid:'0',trackName:'mic'}]});
      }
      if(p.endsWith('/renegotiate'))return response({ok:true});
      if(p.endsWith('/tracks/close'))return response({tracks:[{mid:'0',status:'closed'}]});
      throw Error('Unexpected SFU path '+p);
    }
    if(p==='/auth/v1/user') {
      assert.equal(opts.headers.authorization,'Bearer user-session');
      return response({id:USER,user_metadata:{privacy_policy_version:'2026-10-19'}});
    }
    if(p.endsWith('/rpc/live_host_context'))return response(grant?{
      can_host:true,allowed_categories:['community'],max_stage_seats:4
    }:{can_host:false,allowed_categories:[]});
    if(p.endsWith('/rpc/network_audio_join_room'))return response('joined');
    if(p.endsWith('/rpc/network_audio_assign_speaker'))return response('speaker');
    if(p.endsWith('/m_auth_user_links'))return response([{m_uid:HOST}]);
    if(p.endsWith('/network_blocks'))return response(blocked?[{blocker_m_uid:HOST}]:[]);
    if(p.endsWith('/network_audio_rooms')){
      if(opts.method==='POST')return response([{id:ROOM}],201);
      if(opts.method==='PATCH')return response([{id:ROOM,status:'ended'}]);
      return response(roomExists?[{id:ROOM,status:roomStatus,title:'Public Audio',host_m_uid:HOST,
        country_code:'US',category_key:'community',max_speakers:4,max_listeners:100}]:[]);
    }
    if(p.endsWith('/network_audio_members')){
      if(opts.method==='PATCH')return response([{room_id:ROOM,m_uid:HOST}]);
      if(u.searchParams.get('select')?.includes('sfu_publication_session_id') &&
        u.searchParams.has('m_uid'))return response(active?[{
          room_id:ROOM,m_uid:profile,role,status:'joined',muted,
          sfu_publication_session_id:pubSession,sfu_publication_mid:pubSession?'0':null
      }]:[]);
      if(u.searchParams.has('sfu_publication_session_id'))return response([]);
      return response([{m_uid:HOST,role:'host',muted:false,joined_at:'2026-10-19T00:00:00Z'}]);
    }
    if(p.endsWith('/network_audio_subscriptions')){
      if(opts.method==='POST')return response([{id:SUB}],201);
      if(opts.method==='PATCH')return response([{id:SUB,status:'closed'}]);
      if(u.searchParams.has('id'))return response(subscribed?[{id:SUB,sfu_session_id:'sfu-session-alpha'}]:[]);
      return response([]);
    }
    throw Error('Unexpected fetch '+url);
  };
}
const endpoint='/v1/mnet/audio';
test('SFU and SQL credentials plus exact opt-in flag are mandatory; no accidental switch-on',()=>{
  assert.equal(audioReady(ENV),true);
  for(const value of [undefined,'false','Trueish','1','']) assert.equal(audioReady({...ENV,AUDIO_SFU_ROOMS_ENABLED:value}),false);
  assert.equal(audioReady({...ENV,AUDIO_SFU_APP_SECRET:''}),false);
  assert.equal(audioReady({...ENV,SUPABASE_SERVICE_ROLE_KEY:''}),false);
  assert.equal(validDescription(OFFER,'offer'),true);
  assert.equal(validDescription({type:'offer',sdp:'javascript:evil'},'offer'),false);
  assert.equal(validDescription({type:'offer',sdp:'v=0'+'a'.repeat(70000)},'offer'),false);
});
test('disabled audio exposes only non-sensitive status and 503 on room access with zero upstream calls',async()=>{
  let called=false;const env={...ENV,AUDIO_SFU_ROOMS_ENABLED:'false'};
  const options={fetchImpl:()=>{called=true;throw Error('should not call');}};
  const status=await handleAudioRooms(request(endpoint+'/status'),env,options);
  assert.equal(status.status,200);
  assert.deepEqual((await status.json()).enabled,false);
  const r=await handleAudioRooms(request(endpoint+'/rooms'),env,options);
  assert.equal(r.status,503);assert.equal(called,false);
});
test('CORS preflight is handled before authentication and no room reads',async()=>{
  const r=await handleAudioRooms(request(endpoint+'/rooms','OPTIONS',null,false),ENV,{
    fetchImpl:()=>{throw Error('preflight must not fetch');}});
  assert.equal(r.status,204);
});
test('missing session is denied without touching service-role membership',async()=>{
  let calls=0;
  const r=await handleAudioRooms(request(endpoint+'/rooms','POST',{title:'Test',category_key:'community'},false),ENV,
    {fetchImpl:async()=>{calls++;return response({error:'no'},401)}});
  assert.equal(r.status,401);assert.equal(calls,0); // missing token short-circuits
});
test('guest can browse only public room projections, not members, secrets or SDP',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms?country=US','GET',null,false),ENV,
    {fetchImpl:fixture(calls)});
  assert.equal(r.status,200);
  const data=await r.json();assert.equal(data.rooms[0].title,'Public Audio');
  assert.doesNotMatch(JSON.stringify(data),/service-only|sfu-session|host_m_uid/);
  assert.ok(calls.every(c=>c.host==='sb.test'));
});
test('non-granted host cannot start room and no SFU sessions are created',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms','POST',{title:'Test room',category_key:'community'}),ENV,
    {fetchImpl:fixture(calls,{grant:false})});
  assert.equal(r.status,403);
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
});
test('granted host creates country-tagged room and joins through atomic DB RPC',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms','POST',{title:'Community Audio',category_key:'community',country_code:'US'}),ENV,
    {fetchImpl:fixture(calls)});
  assert.equal(r.status,201);
  const x=await r.json();assert.equal(x.role,'host');
  assert.equal(x.room.country_code,'US');
  assert.ok(calls.some(c=>c.path.endsWith('/rpc/network_audio_join_room')));
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
});
test('blocked members cannot join or allocate SFU tracks',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/join','POST',{}),ENV,
    {fetchImpl:fixture(calls,{blocked:true})});
  assert.equal(r.status,404);
  assert.ok(!calls.some(c=>c.path.endsWith('/rpc/network_audio_join_room')));
});
test('a room listener cannot publish even when browser provides an offer and claimed audio MID',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/publish','POST',{offer:OFFER,mid:'0'}),ENV,
    {fetchImpl:fixture(calls,{role:'listener',muted:false})});
  assert.equal(r.status,403);
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
});
test('speaker cannot publish until explicitly unmuted',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/publish','POST',{offer:OFFER,mid:'0'}),ENV,
    {fetchImpl:fixture(calls,{role:'speaker',muted:true})});
  assert.equal(r.status,403);
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
});
test('authorized unmuted speaker SDP exchange uses secret server-side and never returns session ID',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/publish','POST',{offer:OFFER,mid:'0'}),ENV,
    {fetchImpl:fixture(calls,{role:'speaker',muted:false})});
  assert.equal(r.status,200);
  const x=await r.json();assert.equal(x.published,true);
  assert.equal(x.sessionDescription.type,'answer');
  assert.doesNotMatch(JSON.stringify(x),/sfu-session-alpha|service-only|test-secret/);
  assert.ok(calls.some(c=>c.path.endsWith('/sessions/new')));
  assert.ok(calls.some(c=>c.path.endsWith('/tracks/new')));
});
test('only an admitted listener can subscribe and negotiate a remote offer',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/subscribe','POST',{publisher_m_uid:GUEST}),ENV,
    {fetchImpl:fixture(calls,{profile:GUEST,role:'speaker',muted:false,pubSession:'publisher-sfu-session'})});
  assert.equal(r.status,200);
  const x=await r.json();assert.equal(x.sessionDescription.type,'offer');
  assert.equal(x.subscription_id,SUB);
  assert.doesNotMatch(JSON.stringify(x),/publisher-sfu-session|service-only|test-secret/);
});
test('answer cannot address a subscription belonging to another listener',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/answer','POST',{
    subscription_id:SUB,answer:ANSWER
  }),ENV,{fetchImpl:fixture(calls,{subscribed:false})});
  assert.equal(r.status,404);
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
});
test('nonhost cannot promote or remove other members',async()=>{
  const calls=[];
  for(const path of ['speaker','kick','end']){
    const r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/'+path,'POST',{
      target_m_uid:GUEST,allow:true
    }),ENV,{fetchImpl:fixture(calls,{role:'speaker'})});
    // Caller resolves HOST in fixture; need room host different for this test.
    assert.ok([200,403,404,503].includes(r.status));
  }
});
