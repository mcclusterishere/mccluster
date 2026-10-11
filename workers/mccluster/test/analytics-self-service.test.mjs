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
