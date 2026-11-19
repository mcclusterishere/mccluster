import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAnalyticsRequest} from '../src/analytics/router.js';

const uid='123e4567-e89b-42d3-a456-426614174111', device='123e4567-e89b-42d3-a456-426614174222';
const env={SUPABASE_URL:'https://fixture.test',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
const account={id:uid,created_at:'2026-10-20T12:00:00Z'};
async function read({direct=[],behavior=[],bridge=[],role='owner',fail=false}={}) {
  const calls=[],original=globalThis.fetch;
  globalThis.fetch=async input=>{
    const u=new URL(input),q=u.searchParams;calls.push(u);
    if(u.pathname.endsWith('/orgs'))return Response.json([{id:'org',slug:'mccluster'}]);
    if(u.pathname.endsWith('/org_members'))return Response.json([{org_id:'org',profile_id:uid,role}]);
    if(u.pathname.endsWith('/admin/users'))return Response.json({users:[account]});
    if(u.pathname.endsWith('/creator_tracks')||u.pathname.endsWith('/analytics_content'))return Response.json([]);
    if(u.pathname.endsWith('/events')){
      assert.equal(q.get('site_id'),'is.null','every raw first-party identity query must be tenant-scoped');
      if(fail)return Response.json({code:'57014'}, {status:500});
      if(q.get('name')==='eq.account_created')return Response.json(direct);
      if(q.has('uid'))return Response.json(bridge);
      return Response.json(behavior);
    }
    throw Error('Unexpected fixture request '+u.pathname);
  };
  try {
    const response=await handleAnalyticsRequest(new Request('https://api.test/v1/analytics/identity?since=2026-10-20T00:00:00Z&until=2026-10-21T00:00:00Z'),env,{id:uid});
    return {body:await response.json(),calls};
  } finally {globalThis.fetch=original;}
}
const row=(id,who,props={})=>({id,uid:who,device_id:device,at:'2026-10-20T11:50:00Z',name:'music_play',props:{track:id,...props}});

test('a shared device and client signup claims cannot assign another account or anonymous music history',async()=>{
  const {body,calls}=await read({direct:[{...row('signup',uid),name:'account_created',props:{signup_user_id:uid,track:'claimed-old-song',last_track_at:'2026-10-20T11:50:00Z',source:'claimed-source'}}],
    bridge:[row('login',uid)],behavior:[row('anonymous',null),row('other-account','other')]});
  assert.ok(calls.some(u=>u.searchParams.has('uid')));
  const j=body.journeys[0];assert.equal(j.last_track,null);assert.deepEqual(j.assisted_tracks,[]);
  assert.equal(j.source,'unknown');assert.equal(j.attribution_status,'unknown_no_account_bound_touch');
  assert.equal(j.unattributed_device_events,1);assert.equal(body.coverage.attributed_accounts,0);
});

test('only verified account events contribute; arbitrary signup_user_id is not verified identity',async()=>{
  const {body}=await read({direct:[{...row('claim',null),props:{signup_user_id:uid,track:'claim'}}],bridge:[row('login',uid)],
    behavior:[row('own-track',uid),row('other-track','other'),row('anonymous',null)]});
  assert.equal(body.journeys[0].last_track,'own track');assert.deepEqual(body.journeys[0].assisted_tracks,['own track']);
  assert.equal(body.journeys[0].attribution_status,'event_bound_account_evidence');
  assert.equal(body.measurement.metric_version,'identity-attribution/v3');
  const unverified=await read({direct:[{...row('claim',null),props:{signup_user_id:uid}}]});
  assert.equal(unverified.body.journeys[0].device_id,null);
});

test('identity query still fails honestly on database failure and refuses non-owner reads',async()=>{
  await assert.rejects(()=>read({fail:true}),/Analytics database read failed/);
  await assert.rejects(()=>read({role:'member'}),err=>err.status===403);
});
