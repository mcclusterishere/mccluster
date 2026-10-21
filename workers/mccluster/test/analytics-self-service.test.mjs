import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAnalyticsRequest} from '../src/analytics/router.js';
const id='00000000-0000-0000-0000-000000000001';
const other='00000000-0000-0000-0000-000000000002';
const env={SUPABASE_URL:'https://mock.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test-secret'};
function mock(){
 const calls=[];const original=globalThis.fetch;
 globalThis.fetch=async input=>{
  const url=String(input);calls.push(url);
  if(url.includes('m_auth_user_links?'))return Response.json([{m_uid:'00000000-0000-0000-0000-000000000003'}]);
  if(url.includes('music_creator_profiles?'))return Response.json([{handle:'own-artist'}]);
  if(url.includes('creator_tracks?'))return Response.json([{id:'00000000-0000-0000-0000-000000000004',title:'Own song',status:'published'}]);
  if(url.includes('events?'))return Response.json(url.includes('my-listening')?[]:[
   {uid:other,name:'music_play',props:{creator_track_id:'00000000-0000-0000-0000-000000000004'},at:new Date().toISOString()},
   {uid:other,name:'music_play',props:{creator_track_id:'00000000-0000-0000-0000-000000000099'},at:new Date().toISOString()}]);
  throw Error('Unexpected '+url);
 };
 return {calls,restore(){globalThis.fetch=original;}};
}
test('self-service endpoints reject unauthenticated requests',async()=>{
 const m=mock();try{
 for(const path of ['my-listening','my-creator'])
  await assert.rejects(()=>handleAnalyticsRequest(new Request('https://api.test/v1/analytics/'+path),env,null),{status:401});
 assert.equal(m.calls.length,0);
 }finally{m.restore();}
});
test('fan listening endpoint queries only authenticated uid',async()=>{
 const m=mock();try{
 const r=await handleAnalyticsRequest(new Request('https://api.test/v1/analytics/my-listening?uid='+other),env,{id});
 assert.equal(r.status,200);assert.ok(m.calls.some(x=>x.includes('uid=eq.'+id)));
 assert.ok(m.calls.every(x=>!x.includes('uid=eq.'+other)));
 }finally{m.restore();}
});
test('creator counts only events matching owned track IDs',async()=>{
 const m=mock();try{
 const r=await handleAnalyticsRequest(new Request('https://api.test/v1/analytics/my-creator?m_uid='+other),env,{id});
 const j=await r.json();assert.equal(j.tracks[0].plays,1);
 assert.ok(m.calls.some(x=>x.includes('auth_user_id=eq.'+id)));
 }finally{m.restore();}
});
test('a linked member with no music profile and no tracks is not a creator',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async input=>{
  const url=String(input);
  if(url.includes('m_auth_user_links?'))return Response.json([{m_uid:'00000000-0000-0000-0000-000000000003'}]);
  if(url.includes('music_creator_profiles?')||url.includes('creator_tracks?'))return Response.json([]);
  throw Error('Unexpected '+url);
 };
 try{
  const j=await (await handleAnalyticsRequest(new Request('https://api.test/v1/analytics/my-creator'),env,{id})).json();
  assert.equal(j.creator,false);
  assert.deepEqual(j.tracks,[]);
 }finally{globalThis.fetch=original;}
});
test('a creator sees their page audience by country only, with small countries folded away',async()=>{
 const original=globalThis.fetch;const calls=[];
 const view=(country)=>({at:new Date().toISOString(),path:'music-creator.html?handle=own-artist',referrer:'',session_id:'s-'+Math.random(),country,
  region:'Secret Region',city:'Secret City',postal:'06604',latitude:41.18,longitude:-73.19});
 globalThis.fetch=async input=>{
  const url=String(input);calls.push(url);
  if(url.includes('m_auth_user_links?'))return Response.json([{m_uid:'00000000-0000-0000-0000-000000000003'}]);
  if(url.includes('music_creator_profiles?'))return Response.json([{handle:'own-artist'}]);
  if(url.includes('creator_tracks?'))return Response.json([]);
  if(url.includes('events?')&&url.includes('page_view'))return Response.json([
   ...Array.from({length:6},()=>view('US')),view('GB'),view('GB'),view(null),view('T1'),
   {...view('US'),path:'music-creator.html?handle=someone-else'}]);
  throw Error('Unexpected '+url);
 };
 try{
  const j=await (await handleAnalyticsRequest(new Request('https://api.test/v1/analytics/my-creator'),env,{id})).json();
  assert.deepEqual(j.audience.countries,[{country:'US',views:6}]);
  assert.equal(j.audience.elsewhere_views,2,'two GB views are under the threshold and are not named');
  assert.equal(j.audience.unknown_views,2,'missing and Tor countries are unknown');
  assert.equal(j.audience.min_views,5);
  const text=JSON.stringify(j);
  for(const secret of ['Secret Region','Secret City','06604','41.18','-73.19','"GB"'])assert.ok(!text.includes(secret),secret+' must not reach the creator');
  assert.ok(calls.some(u=>u.includes('select=at,path,referrer,session_id,props,country&')),'only the country column is read');
 }finally{globalThis.fetch=original;}
});
