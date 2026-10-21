import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAnalyticsRequest} from '../src/analytics/router.js';
const uid='00000000-0000-0000-0000-000000000001';
const other='00000000-0000-0000-0000-000000000002';
const env={SUPABASE_URL:'https://mock.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test-secret'};
function mockFetch(role='owner'){
 const calls=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(input,init={})=>{
  const url=String(input);calls.push({url,headers:init.headers});
  if(url.includes('/rest/v1/orgs?'))return Response.json([{id:'org1',slug:'mccluster'}]);
  if(url.includes('/rest/v1/org_members?'))return Response.json([{role}]);
  if(url.includes('/auth/v1/admin/users'))return Response.json({users:[{id:uid,email:'user@example.test',created_at:'2026-10-01T00:00:00Z'}]});
  if(url.includes('/rest/v1/events?'))return Response.json([{uid,at:'2026-10-10T00:00:00Z',name:'music_play',session_id:'s1',path:'/music'},{uid:other,at:'2026-10-10T00:00:00Z',name:'secret',session_id:'s2'}]);
  throw Error('unexpected '+url);
 };
 return {calls,restore(){globalThis.fetch=original;}};
}
function req(q=''){return new Request('https://api.mccluster.org/v1/analytics/users'+q);}
test('unauthenticated request rejected before querying user data',async()=>{
 const m=mockFetch();
 try{await assert.rejects(()=>handleAnalyticsRequest(req(),env,null),{status:401});
 assert.equal(m.calls.some(x=>x.url.includes('/auth/v1/admin/users')),false);}
 finally{m.restore();}
});
test('non-owner cannot query auth accounts',async()=>{
 const m=mockFetch('member');
 try{await assert.rejects(()=>handleAnalyticsRequest(req(),env,{id:uid}),{status:403});
 assert.equal(m.calls.some(x=>x.url.includes('/auth/v1/admin/users')),false);}
 finally{m.restore();}
});
test('owner sees only matched authenticated events and score',async()=>{
 const m=mockFetch();
 try{
  const r=await handleAnalyticsRequest(req('?limit=10&page=1'),env,{id:uid});
  assert.equal(r.status,200);
  const j=await r.json();assert.equal(j.users.length,1);
  assert.equal(j.users[0].events.length,1);
  assert.equal(j.users[0].events[0].name,'music_play');
  assert.ok(j.users[0].scores.engagement.value>=0);
  assert.equal(m.calls.filter(x=>x.url.includes('/rest/v1/events?')).length,1);
  assert.ok(m.calls.find(x=>x.url.includes('/auth/v1/admin/users')).headers.authorization.includes('test-secret'));
 }finally{m.restore();}
});
test('invalid pagination rejected before admin user listing',async()=>{
 const m=mockFetch();
 try{const r=await handleAnalyticsRequest(req('?limit=1000'),env,{id:uid});assert.equal(r.status,400);
 assert.equal(m.calls.some(x=>x.url.includes('/auth/v1/admin/users')),false);}
 finally{m.restore();}
});
