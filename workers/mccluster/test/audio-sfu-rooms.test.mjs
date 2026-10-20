import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audioReady,visitorListenReady,connectionCountry,validDescription,handleAudioRooms,signPass,readPass}
  from '../src/audio-sfu-rooms.js';

const USER='11111111-1111-4111-8111-111111111111';
const HOST='22222222-2222-4222-8222-222222222222';
const GUEST='33333333-3333-4333-8333-333333333333';
const ROOM='44444444-4444-4444-8444-444444444444';
const SUB='55555555-5555-4555-8555-555555555555';
const SEAT_HOST='66666666-6666-4666-8666-666666666666';
const SEAT_SELF='77777777-7777-4777-8777-777777777777';
const SEAT_OTHER='88888888-8888-4888-8888-888888888888';
const SEAT_VISITOR='99999999-9999-4999-8999-999999999999';
const OTHER_ROOM='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW=Date.parse('2026-10-20T12:00:00Z');
const ENV={AUDIO_SFU_ROOMS_ENABLED:'true',AUDIO_SFU_APP_ID:'app_test_sfu',
  AUDIO_SFU_APP_SECRET:'test-secret-never-client',SUPABASE_URL:'https://sb.test',
  SUPABASE_SERVICE_ROLE_KEY:'service-only'};
const VISITORS={...ENV,AUDIO_ROOMS_VISITOR_LISTEN_ENABLED:'true',AUDIO_ROOM_PASS_KEY:'k'.repeat(40)};
const OFFER={type:'offer',sdp:'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=mid:0\r\n'};
const ANSWER={...OFFER,type:'answer'};
// request.cf is Cloudflare's; a Request built in a test has none until we give it one.
const request=(path,method='GET',body,auth='Bearer user-session',country)=>{
  const r=new Request('https://api.mccluster.org'+path,{
    method,headers:{...(auth?{authorization:auth}:{}),...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  if(country!==undefined)Object.defineProperty(r,'cf',{value:{country}});
  return r;
};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const at=(o)=>({fetchImpl:o,now:()=>NOW});
function fixture(log,{active=true,role='listener',muted=true,grant=true,blocked=false,pubSession=null,
  identity=HOST,roomStatus='live',subscribed=false,roomExists=true,roomCountry='US',visitorsMayListen=true,
  hand=null,visitorExpires='2026-10-20T15:00:00Z',dbError=null,closeError=false,priorSub=null}={}){
  const hostRoom={id:ROOM,status:roomStatus,title:'Public Audio',host_m_uid:HOST,
    country_code:roomCountry,visitors_may_listen:visitorsMayListen,category_key:'community',max_speakers:4,max_listeners:100};
  return async(url,opts={})=>{
    const u=new URL(url);const p=u.pathname;
    log.push({host:u.hostname,method:opts.method||'GET',path:p,query:decodeURIComponent(u.search),
      authorization:opts.headers?.authorization,body:opts.body});
    if(u.hostname==='rtc.live.cloudflare.com'){
      assert.equal(opts.headers.authorization,'Bearer test-secret-never-client');
      if(p.endsWith('/sessions/new'))return response({sessionId:'sfu-session-alpha'});
      if(p.endsWith('/tracks/new')){
        const data=JSON.parse(opts.body);
        return response({sessionDescription:data.tracks[0].location==='local'?ANSWER:OFFER,
          tracks:[{mid:'0',trackName:'mic'}]});
      }
      if(p.endsWith('/renegotiate'))return response({ok:true});
      // Cloudflare answers 200 and names the failure on the track
      if(p.endsWith('/tracks/close'))return response({tracks:[closeError?{mid:'0',errorCode:'track_not_found',errorDescription:'no such track'}:{mid:'0',status:'closed'}]});
      throw Error('Unexpected SFU path '+p);
    }
    if(p==='/auth/v1/user') {
      assert.equal(opts.headers.authorization,'Bearer user-session');
      return response({id:USER,user_metadata:{privacy_policy_version:'2026-10-19'}});
    }
    if(dbError&&p.includes('/rpc/network_audio_join'))return response({code:dbError[0],message:dbError[1]},400);
    if(p.endsWith('/rpc/live_host_context'))return response(grant?{
      can_host:true,allowed_categories:['community'],max_stage_seats:4
    }:{can_host:false,allowed_categories:[]});
    if(p.endsWith('/rpc/network_audio_join_room'))return response(identity===HOST?SEAT_HOST:SEAT_SELF);
    if(p.endsWith('/rpc/network_audio_join_visitor'))return response(SEAT_VISITOR);
    if(p.endsWith('/rpc/network_audio_assign_speaker'))return response('speaker');
    if(p.endsWith('/rpc/network_audio_seat_counts'))return response([{speakers:2,listeners:37,visitors:5}]);
    if(p.endsWith('/rpc/network_audio_directory'))return response([{...hostRoom,created_at:'2026-10-20T11:00:00Z',speakers:2,listeners:37}]);
    if(p.endsWith('/m_auth_user_links'))return response([{m_uid:identity}]);
    if(p.endsWith('/network_profiles'))return response([{m_uid:HOST,display_name:'Matthew',avatar_url:'https://img.test/m.png',visibility:'public'},
      {m_uid:GUEST,display_name:'Ada',avatar_url:'javascript:alert(1)',visibility:'public'},
      // a profile that is not public never lends its name, even if a filter upstream let it through
      {m_uid:USER,display_name:'Hidden Person',avatar_url:'https://img.test/h.png',visibility:'network'}]);
    if(p.endsWith('/network_blocks'))return response(blocked?[{blocker_m_uid:HOST}]:[]);
    if(p.endsWith('/network_audio_rooms')){
      if(opts.method==='POST')return response([{id:ROOM}],201);
      if(opts.method==='PATCH')return response([{id:ROOM,status:'ended'}]);
      return response(roomExists?[hostRoom]:[]);
    }
    if(p.endsWith('/network_audio_members')){
      if(opts.method==='PATCH')return response([{participant_id:SEAT_SELF}]);
      if(opts.method==='DELETE')return new Response(null,{status:204});
      const q=u.searchParams;
      if(q.has('participant_id')||q.has('m_uid')){
        if(!active)return response([]);
        const pid=(q.get('participant_id')||'').replace('eq.','');
        if(pid===SEAT_OTHER)return response([{participant_id:SEAT_OTHER,room_id:ROOM,m_uid:GUEST,role:'speaker',status:'joined',
          muted:false,sfu_publication_session_id:'publisher-sfu-session',sfu_publication_mid:'0',last_seen_at:'2026-10-20T11:59:59Z'}]);
        const visitorSeat=pid===SEAT_VISITOR;
        return response([{participant_id:visitorSeat?SEAT_VISITOR:(identity===HOST?SEAT_HOST:SEAT_SELF),room_id:ROOM,
          m_uid:visitorSeat?null:identity,role,status:'joined',muted,hand_raised_at:hand,
          last_seen_at:'2026-10-20T11:50:00Z',expires_at:visitorSeat?visitorExpires:null,
          sfu_publication_session_id:pubSession,sfu_publication_mid:pubSession?'0':null}]);
      }
      if(q.has('sfu_publication_session_id'))return response([{participant_id:SEAT_OTHER,role:'speaker'}]);
      if(q.has('or'))return response([
        {participant_id:SEAT_HOST,m_uid:HOST,role:'host',muted:false,hand_raised_at:null,joined_at:'2026-10-20T11:00:00Z'},
        {participant_id:SEAT_OTHER,m_uid:GUEST,role:'listener',muted:true,hand_raised_at:'2026-10-20T11:58:00Z',joined_at:'2026-10-20T11:30:00Z'}]);
      return response([]);
    }
    if(p.endsWith('/network_audio_subscriptions')){
      if(opts.method==='POST')return response([{id:SUB}],201);
      if(opts.method==='PATCH')return response([{id:SUB,status:'closed'}]);
      if(u.searchParams.has('id'))return response(subscribed?[{id:SUB,sfu_session_id:'sfu-session-alpha'}]:[]);
      if(priorSub&&u.searchParams.has('listener_participant_id'))return response([{id:SUB,status:priorSub,sfu_session_id:'stale-receiver',sfu_mid:'0'}]);
      return response([]);
    }
    throw Error('Unexpected fetch '+url);
  };
}
const endpoint='/v1/mnet/audio';
const visitorPass=(claims={})=>signPass(VISITORS,{v:1,r:ROOM,p:SEAT_VISITOR,c:'US',e:Math.floor(NOW/1000)+3600,...claims});
const noLeak=(x)=>assert.doesNotMatch(JSON.stringify(x),new RegExp([HOST,GUEST,USER,'service-only','test-secret','sfu-session'].join('|')));

test('SFU and SQL credentials plus exact opt-in flag are mandatory; no accidental switch-on',()=>{
  assert.equal(audioReady(ENV),true);
  for(const value of [undefined,'false','Trueish','1','']) assert.equal(audioReady({...ENV,AUDIO_SFU_ROOMS_ENABLED:value}),false);
  assert.equal(audioReady({...ENV,AUDIO_SFU_APP_SECRET:''}),false);
  assert.equal(audioReady({...ENV,SUPABASE_SERVICE_ROLE_KEY:''}),false);
  assert.equal(validDescription(OFFER,'offer'),true);
  assert.equal(validDescription({type:'offer',sdp:'javascript:evil'},'offer'),false);
  assert.equal(validDescription({type:'offer',sdp:'v=0'+'a'.repeat(70000)},'offer'),false);
});
test('visitor listening needs its own flag and a real signing key on top of rooms being on',()=>{
  assert.equal(visitorListenReady(VISITORS),true);
  assert.equal(visitorListenReady(ENV),false);
  assert.equal(visitorListenReady({...VISITORS,AUDIO_ROOMS_VISITOR_LISTEN_ENABLED:'false'}),false);
  assert.equal(visitorListenReady({...VISITORS,AUDIO_ROOM_PASS_KEY:'short'}),false);
  assert.equal(visitorListenReady({...VISITORS,AUDIO_SFU_ROOMS_ENABLED:'false'}),false);
});
test('the connection country is Cloudflare\'s reading only, and unknown is no country',()=>{
  assert.equal(connectionCountry(request('/','GET',null,null,'US')),'US');
  for(const c of ['XX','T1','us','',undefined]) assert.equal(connectionCountry(request('/','GET',null,null,c)),null);
  const spoofed=new Request('https://api.mccluster.org/',{headers:{'cf-ipcountry':'FR','x-country':'FR'}});
  assert.equal(connectionCountry(spoofed),null);
});
test('a pass is bound to its claims: tampering, another key or expiry all fail',async()=>{
  const pass=await visitorPass();
  assert.equal((await readPass(VISITORS,pass,NOW)).c,'US');
  const [head,claims,sig]=pass.split('.');
  const forged=Buffer.from(JSON.stringify({v:1,r:ROOM,p:SEAT_VISITOR,c:'FR',e:Math.floor(NOW/1000)+3600})).toString('base64url');
  assert.equal(await readPass(VISITORS,[head,forged,sig].join('.'),NOW),null);
  assert.equal(await readPass({...VISITORS,AUDIO_ROOM_PASS_KEY:'z'.repeat(40)},pass,NOW),null);
  assert.equal(await readPass(VISITORS,pass,NOW+3601_000),null);
  assert.equal(await readPass(VISITORS,'rp1.'+claims,NOW),null);
});
test('disabled audio exposes only non-sensitive status and 503 on room access with zero upstream calls',async()=>{
  let called=false;const env={...ENV,AUDIO_SFU_ROOMS_ENABLED:'false'};
  const options={fetchImpl:()=>{called=true;throw Error('should not call');}};
  const status=await handleAudioRooms(request(endpoint+'/status','GET',null,null,'US'),env,options);
  assert.equal(status.status,200);
  const s=await status.json();
  assert.equal(s.enabled,false);assert.equal(s.visitors.listen,false);assert.equal(s.visitors.country,null);
  const r=await handleAudioRooms(request(endpoint+'/rooms'),env,options);
  assert.equal(r.status,503);assert.equal(called,false);
});
test('status tells a signed-out page its own country and that other regions need sign-in',async()=>{
  const r=await handleAudioRooms(request(endpoint+'/status','GET',null,null,'US'),VISITORS,{fetchImpl:()=>{throw Error('no fetch');}});
  const s=await r.json();
  assert.deepEqual(s.visitors,{listen:true,country:'US',other_regions:'sign_in'});
  assert.equal(r.headers.get('cache-control'),'private, no-store');
});
test('CORS preflight is handled before authentication and no room reads',async()=>{
  const r=await handleAudioRooms(request(endpoint+'/rooms','OPTIONS',null,null),ENV,{
    fetchImpl:()=>{throw Error('preflight must not fetch');}});
  assert.equal(r.status,204);
});
test('missing session is denied without touching service-role membership',async()=>{
  let calls=0;
  const r=await handleAudioRooms(request(endpoint+'/rooms','POST',{title:'Test',category_key:'community'},null),ENV,
    {fetchImpl:async()=>{calls++;return response({error:'no'},401)}});
  assert.equal(r.status,401);assert.equal(calls,0); // missing token short-circuits
});
test('the directory shows host names and counts, never m_uids, secrets or SDP',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms?country=US','GET',null,null),ENV,
    at(fixture(calls)));
  assert.equal(r.status,200);
  const data=await r.json(),room=data.rooms[0];
  assert.equal(room.title,'Public Audio');
  assert.deepEqual(room.host,{display_name:'Matthew',avatar_url:'https://img.test/m.png'});
  assert.equal(room.speakers,2);assert.equal(room.listeners,37);assert.equal(room.visitors_may_listen,true);
  noLeak(data);
  assert.ok(calls.every(c=>c.host==='sb.test'));
  assert.match(calls.find(c=>c.path.endsWith('/rpc/network_audio_directory')).body,/"p_country":"US"/);
});
test('non-granted host cannot start room and no SFU sessions are created',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms','POST',{title:'Test room',category_key:'community'}),ENV,
    at(fixture(calls,{grant:false})));
  assert.equal(r.status,403);
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
});
test('granted host creates country-tagged room and joins through atomic DB RPC',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms','POST',{title:'Community Audio',category_key:'community',country_code:'US'}),ENV,
    at(fixture(calls)));
  assert.equal(r.status,201);
  const x=await r.json();assert.equal(x.role,'host');
  assert.equal(x.room.country_code,'US');assert.equal(x.participant_id,SEAT_HOST);
  assert.ok(calls.some(c=>c.path.endsWith('/rpc/network_audio_join_room')));
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
});
test('a room with no chosen place belongs to where the host connects from; null is everywhere',async()=>{
  let calls=[];
  await handleAudioRooms(request(endpoint+'/rooms','POST',{title:'Lagos tonight',category_key:'community'},'Bearer user-session','NG'),ENV,at(fixture(calls)));
  assert.equal(JSON.parse(calls.find(c=>c.path.endsWith('/network_audio_rooms')&&c.method==='POST').body).country_code,'NG');
  calls=[];
  const r=await handleAudioRooms(request(endpoint+'/rooms','POST',{title:'Everywhere',category_key:'community',country_code:null},'Bearer user-session','NG'),ENV,at(fixture(calls)));
  assert.equal(JSON.parse(calls.find(c=>c.path.endsWith('/network_audio_rooms')&&c.method==='POST').body).country_code,null);
  assert.equal((await r.json()).room.visitors_may_listen,false);
});
test('blocked members cannot join or allocate SFU tracks',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/join','POST',{}),ENV,
    at(fixture(calls,{blocked:true,identity:GUEST})));
  assert.equal(r.status,404);
  assert.ok(!calls.some(c=>c.path.endsWith('/rpc/network_audio_join_room')));
});
test('a member can join a room in any region and gets an opaque seat',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/join','POST',{},'Bearer user-session','JP'),ENV,
    at(fixture(calls,{identity:GUEST})));
  assert.equal(r.status,200);
  const x=await r.json();assert.equal(x.participant_id,SEAT_SELF);noLeak(x);
});
test('database refusals reach the person in words',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/join','POST',{}),ENV,
    at(fixture(calls,{identity:GUEST,dbError:['AU409','audio_room_full']})));
  assert.equal(r.status,409);assert.equal((await r.json()).error,'This room is full right now');
});
test('a room listener cannot publish even when browser provides an offer and claimed audio MID',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/publish','POST',{offer:OFFER,mid:'0'}),ENV,
    at(fixture(calls,{role:'listener',muted:false})));
  assert.equal(r.status,403);
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
});
test('speaker cannot publish until explicitly unmuted',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/publish','POST',{offer:OFFER,mid:'0'}),ENV,
    at(fixture(calls,{role:'speaker',muted:true})));
  assert.equal(r.status,403);
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
});
test('authorized unmuted speaker SDP exchange uses secret server-side and never returns session ID',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/publish','POST',{offer:OFFER,mid:'0'}),ENV,
    at(fixture(calls,{role:'speaker',muted:false,identity:GUEST})));
  assert.equal(r.status,200);
  const x=await r.json();assert.equal(x.published,true);
  assert.equal(x.sessionDescription.type,'answer');
  assert.doesNotMatch(JSON.stringify(x),/sfu-session-alpha|service-only|test-secret/);
  assert.ok(calls.some(c=>c.path.endsWith('/sessions/new')));
  assert.ok(calls.some(c=>c.path.endsWith('/tracks/new')));
});
test('only an admitted listener can subscribe, by seat, to a speaker on the stage',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/subscribe','POST',{publisher:SEAT_OTHER}),ENV,
    at(fixture(calls,{identity:USER})));
  assert.equal(r.status,200);
  const x=await r.json();assert.equal(x.sessionDescription.type,'offer');
  assert.equal(x.subscription_id,SUB);assert.equal(x.publisher,SEAT_OTHER);
  noLeak(x);
  const saved=JSON.parse(calls.find(c=>c.path.endsWith('/network_audio_subscriptions')&&c.method==='POST').body);
  assert.equal(saved.listener_participant_id,SEAT_SELF);assert.equal(saved.publisher_participant_id,SEAT_OTHER);
});
test('answer cannot address a subscription belonging to another listener',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/answer','POST',{
    subscription_id:SUB,answer:ANSWER
  }),ENV,at(fixture(calls,{subscribed:false})));
  assert.equal(r.status,404);
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
});
test('the stage names speakers and counts listeners; only the host sees raised hands',async()=>{
  let calls=[];
  const asHost=await (await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/stage'),ENV,at(fixture(calls,{role:'host',identity:HOST})))).json();
  assert.equal(asHost.you.host,true);
  assert.deepEqual(asHost.stage.map(p=>[p.participant_id,p.display_name,p.role,p.you]),[[SEAT_HOST,'Matthew','host',true]]);
  assert.equal(asHost.listeners,37);
  assert.deepEqual(asHost.hands.map(h=>[h.participant_id,h.display_name,h.avatar_url]),[[SEAT_OTHER,'Ada','']]);
  noLeak(asHost);
  calls=[];
  const asListener=await (await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/stage'),ENV,at(fixture(calls,{identity:USER})))).json();
  assert.equal(asListener.you.host,false);assert.deepEqual(asListener.hands,[]);
  assert.ok(!asListener.stage.some(p=>'m_uid' in p));
  noLeak(asListener);
  // the poll checks the seat in
  assert.ok(calls.some(c=>c.method==='PATCH'&&c.path.endsWith('/network_audio_members')&&/last_seen_at/.test(c.body)));
});
test('a listener raises and lowers a hand; a speaker cannot',async()=>{
  const calls=[];
  let r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/hand','POST',{raise:true}),ENV,at(fixture(calls,{identity:USER})));
  assert.equal(r.status,200);assert.equal((await r.json()).hand_raised,true);
  assert.match(calls.find(c=>c.method==='PATCH').query,/role=eq\.listener/);
  r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/hand','POST',{raise:true}),ENV,at(fixture([],{identity:USER,role:'speaker'})));
  assert.equal(r.status,409);
});
test('nonhost cannot promote, remove or terminate another host room',async()=>{
  const calls=[];
  for(const path of ['speaker','kick','end']){
    const r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/'+path,'POST',{
      target:SEAT_OTHER,allow:true
    }),ENV,at(fixture(calls,{role:'speaker',identity:GUEST})));
    assert.equal(r.status,403,path);
  }
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
});
test('the host invites a raised hand to speak by seat, never by m_uid',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/speaker','POST',{target:SEAT_OTHER,allow:true}),ENV,
    at(fixture(calls,{role:'host',identity:HOST})));
  assert.equal(r.status,200);
  const rpcCall=calls.find(c=>c.path.endsWith('/rpc/network_audio_assign_speaker'));
  assert.deepEqual(JSON.parse(rpcCall.body),{p_room_id:ROOM,p_host_m_uid:HOST,p_target:SEAT_OTHER,p_speaker:true});
});

/* ---- signed-out visitors ---- */
test('a visitor listens in a room of their own connection country with a pass and no account',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/listen','POST',{},null,'US'),VISITORS,at(fixture(calls)));
  assert.equal(r.status,201);
  const x=await r.json();
  assert.equal(x.visitor,true);assert.equal(x.participant_id,SEAT_VISITOR);
  assert.equal((await readPass(VISITORS,x.pass,NOW)).p,SEAT_VISITOR);
  assert.equal(x.expires_at,'2026-10-20T16:00:00.000Z');
  noLeak(x);
  assert.ok(!calls.some(c=>c.path==='/auth/v1/user'),'a visitor is never looked up as a member');
  assert.deepEqual(JSON.parse(calls.find(c=>c.path.endsWith('/rpc/network_audio_join_visitor')).body),{p_room_id:ROOM,p_country:'US'});
});
test('a visitor cannot hop to another region\'s conversation; signing in is the way',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/listen','POST',{},null,'FR'),VISITORS,at(fixture(calls)));
  assert.equal(r.status,403);
  const x=await r.json();assert.equal(x.detail.sign_in,true);assert.match(x.error,/Sign in/);
  assert.ok(!calls.some(c=>c.path.includes('join_visitor')));
});
test('no connection country, a room for everywhere, or a host who said no: no visitor seat',async()=>{
  for(const [country,opts] of [[null,{}],['XX',{}],['US',{roomCountry:null}],['US',{visitorsMayListen:false}]]){
    const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/listen','POST',{},null,country),VISITORS,at(fixture(calls,opts)));
    assert.equal(r.status,403,JSON.stringify([country,opts]));
    assert.ok(!calls.some(c=>c.path.includes('join_visitor')));
  }
});
test('with visitor listening off, a visitor is asked to sign in and nothing is read',async()=>{
  const r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/listen','POST',{},null,'US'),ENV,
    {fetchImpl:()=>{throw Error('no fetch');},now:()=>NOW});
  assert.equal(r.status,403);assert.equal((await r.json()).detail.sign_in,true);
});
test('a visitor pass works only for its room, from its country, until it ends',async()=>{
  const pass=await visitorPass(),auth='Bearer '+pass;
  let r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/stage','GET',null,auth,'US'),VISITORS,at(fixture([])));
  assert.equal(r.status,200);
  const s=await r.json();assert.equal(s.you.visitor,true);assert.deepEqual(s.hands,[]);noLeak(s);
  r=await handleAudioRooms(request(endpoint+'/rooms/'+OTHER_ROOM+'/stage','GET',null,auth,'US'),VISITORS,at(fixture([])));
  assert.equal(r.status,401);
  r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/stage','GET',null,auth,'GB'),VISITORS,at(fixture([])));
  assert.equal(r.status,403);assert.equal((await r.json()).detail.sign_in,true);
  r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/stage','GET',null,'Bearer '+await visitorPass({e:Math.floor(NOW/1000)-1}),'US'),VISITORS,at(fixture([])));
  assert.equal(r.status,401);
  r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/stage','GET',null,auth,'US'),VISITORS,at(fixture([],{visitorExpires:'2026-10-20T11:00:00Z'})));
  assert.equal(r.status,403,'a lapsed seat is no seat');
  r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/stage','GET',null,auth,'US'),ENV,at(fixture([])));
  assert.equal(r.status,403,'switching visitor listening off ends visitor calls');
});
test('a visitor pass is never sent to Supabase Auth',async()=>{
  const calls=[];
  await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/stage','GET',null,'Bearer '+await visitorPass(),'US'),VISITORS,at(fixture(calls)));
  assert.ok(!calls.some(c=>c.path==='/auth/v1/user'));
  assert.ok(!calls.some(c=>String(c.authorization||'').includes('rp1.')));
});
test('a visitor only listens: hand, mic, publish, host controls and room creation ask for sign-in',async()=>{
  const auth='Bearer '+await visitorPass(),calls=[];
  for(const path of ['hand','mic','publish','speaker','kick','end','join']){
    const r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/'+path,'POST',{raise:true,unmute:true,offer:OFFER,mid:'0',target:SEAT_OTHER,allow:true},auth,'US'),
      VISITORS,at(fixture(calls)));
    assert.equal(r.status,403,path);assert.equal((await r.json()).detail.sign_in,true,path);
  }
  const create=await handleAudioRooms(request(endpoint+'/rooms','POST',{title:'x',category_key:'community'},auth,'US'),VISITORS,at(fixture(calls)));
  assert.equal(create.status,404);
  assert.ok(!calls.some(c=>c.host==='rtc.live.cloudflare.com'));
  assert.ok(!calls.some(c=>c.method!=='GET'),'no write for a refused visitor');
});
test('a visitor receives a speaker by seat; no block lookup needs their identity',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/subscribe','POST',{publisher:SEAT_OTHER},'Bearer '+await visitorPass(),'US'),
    VISITORS,at(fixture(calls)));
  assert.equal(r.status,200);
  const saved=JSON.parse(calls.find(c=>c.path.endsWith('/network_audio_subscriptions')&&c.method==='POST').body);
  assert.equal(saved.listener_participant_id,SEAT_VISITOR);
  assert.ok(!calls.some(c=>c.path.endsWith('/network_blocks')));
});
test('a visitor who leaves keeps nothing: receivers closed, seat deleted',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/leave','POST',{},'Bearer '+await visitorPass(),'US'),
    VISITORS,at(fixture(calls)));
  assert.equal(r.status,200);
  const del=calls.find(c=>c.method==='DELETE');
  assert.ok(del&&del.path.endsWith('/network_audio_members')&&del.query.includes('participant_id=eq.'+SEAT_VISITOR));
});

test('only public profiles lend a name to the stage; anyone else is Member',async()=>{
  const calls=[];
  await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/stage'),ENV,at(fixture(calls,{role:'host',identity:HOST})));
  const q=calls.find(c=>c.path.endsWith('/network_profiles'));
  assert.match(q.query,/visibility=eq\.public/);
  const r=await handleAudioRooms(request(endpoint+'/rooms?country=US','GET',null,null),ENV,at(async(url,opts)=>{
    const u=new URL(url);
    if(u.pathname.endsWith('/rpc/network_audio_directory'))return response([{id:ROOM,title:'T',category_key:'c',country_code:'US',visitors_may_listen:true,max_speakers:4,host_m_uid:USER,speakers:1,listeners:0}]);
    if(u.pathname.endsWith('/network_profiles'))return response([{m_uid:USER,display_name:'Hidden Person',avatar_url:'https://img.test/h.png',visibility:'network'}]);
    throw Error('unexpected '+url);
  }));
  const room=(await r.json()).rooms[0];
  assert.deepEqual(room.host,{display_name:'Host',avatar_url:''});
});

test('a track Cloudflare reports as failed inside a 200 fails the mute and keeps the media ids for a retry',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/mic','POST',{unmute:false}),ENV,
    at(fixture(calls,{identity:USER,role:'speaker',muted:false,pubSession:'pub-session'})));
  assert.equal(r.status,200,'a clean close still mutes');
  const failing=[],bad=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/mic','POST',{unmute:false}),ENV,
    at(fixture(failing,{identity:USER,role:'speaker',muted:false,pubSession:'pub-session',closeError:true})));
  assert.equal(bad.status,503,'the room answers "temporarily unavailable", as for any provider failure');
  assert.ok(failing.some(c=>c.path.endsWith('/tracks/close')));
  assert.ok(!failing.some(c=>c.method==='PATCH'&&c.path.endsWith('/network_audio_members')),'the seat keeps its session and mid');
});
test('the host leaving ends the room for everyone, as End does',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/leave','POST',{}),ENV,
    at(fixture(calls,{role:'host',identity:HOST})));
  assert.equal(r.status,200);
  assert.equal((await r.json()).ended,true);
  const ended=calls.find(c=>c.method==='PATCH'&&c.path.endsWith('/network_audio_rooms'));
  assert.ok(ended&&/"status":"ended"/.test(ended.body)&&/status=eq\.live/.test(ended.query));
  assert.ok(calls.some(c=>c.method==='PATCH'&&c.path.endsWith('/network_audio_members')&&/status=eq\.joined/.test(c.query)&&/"status":"left"/.test(c.body)),'everyone still seated is let go');
});
test('a listener whose answer never arrived can subscribe again; the half-made receiver is closed first',async()=>{
  const calls=[],r=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/subscribe','POST',{publisher:SEAT_OTHER}),ENV,
    at(fixture(calls,{identity:USER,priorSub:'negotiating'})));
  assert.equal(r.status,200);
  const close=calls.findIndex(c=>c.path.endsWith('/sessions/stale-receiver/tracks/close'));
  const retire=calls.findIndex(c=>c.method==='PATCH'&&c.path.endsWith('/network_audio_subscriptions')&&/status=eq\.negotiating/.test(c.query));
  const fresh=calls.findIndex(c=>c.method==='POST'&&c.path.endsWith('/network_audio_subscriptions'));
  assert.ok(close>=0&&retire>close&&fresh>retire,'close, then retire the row, then record the new receiver');
  const dup=await handleAudioRooms(request(endpoint+'/rooms/'+ROOM+'/subscribe','POST',{publisher:SEAT_OTHER}),ENV,
    at(fixture([],{identity:USER,priorSub:'active'})));
  assert.equal(dup.status,409,'a working subscription is never replaced');
});
