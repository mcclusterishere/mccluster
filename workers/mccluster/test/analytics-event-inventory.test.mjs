import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanInventory,socialCoverage} from '../src/analytics/event-inventory.js';
import {handleAnalyticsRequest} from '../src/analytics/router.js';

test('classifications are explicit and raw/lean drift stays visible',()=>{
  const x=cleanInventory([
    {event_name:'music_play',raw_total:12,lean_total:'11',bot_rows:2,recent_24h:3,recent_7d:8,taxonomy_stage:'content',taxonomy_note:'client-reported play'},
    {event_name:'signup_succeeded',raw_total:2,lean_total:2,bot_rows:0,recent_24h:0,recent_7d:2,taxonomy_stage:null}
  ]);
  assert.equal(x.summary.names,2);
  assert.equal(x.summary.unclassified_names,1);
  assert.equal(x.summary.unclassified_events,2);
  assert.equal(x.summary.mismatched_names,1);
  assert.equal(x.rows[0].projection_match,false);
  assert.equal(x.rows[1].classification,'unclassified');
  assert.equal(x.rows[1].taxonomy_stage,null);
});
test('no provider data never becomes zero reach or verified Instagram metrics',()=>{
  const a=socialCoverage([{platform:'instagram',status:'connected',media_discovery_error:'meta_error_190'}],0,0);
  assert.equal(a.instagram.reauthorization_required,true);
  assert.equal(a.instagram.metric_snapshots,0);
  assert.equal(a.instagram.status,'reauthorization_required');
  assert.equal(a.instagram.provider_observation,'not_measured');
  assert.equal(socialCoverage([],0,null).instagram.status,'unavailable');
});
test('invalid or nonfinite inventory counts reject the response',()=>{
  assert.throws(()=>cleanInventory([{event_name:'bad',raw_total:Infinity,lean_total:0,bot_rows:0}]),/Invalid event-name/);
  assert.throws(()=>cleanInventory(new Array(1001)),/unavailable/);
});

const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'secret-test'};
const data=(body,status=200,count=0)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','content-range':'0-0/'+count}});
test('staff are denied before any event or social data reads',async()=>{
  const original=globalThis.fetch, calls=[];
  globalThis.fetch=async raw=>{
    const url=new URL(raw),path=url.pathname;calls.push(path);
    if(path.endsWith('/orgs'))return data([{id:'00000000-0000-4000-8000-000000000090'}]);
    if(path.endsWith('/org_members'))return data([{role:'staff'}]);
    throw Error('Owner-only data must not be read');
  };
  try{
    await assert.rejects(()=>handleAnalyticsRequest(new Request('https://api.test/v1/analytics/event-inventory'),env,{id:'user-staff'}),/owner access required/);
    assert.equal(calls.some(path=>path.endsWith('/rpc/analytics_event_inventory_v1')),false);
  }finally{globalThis.fetch=original;}
});
test('owner sees stored event names and authenticated source status only',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async raw=>{
    const path=new URL(raw).pathname;calls.push(path);
    if(path.endsWith('/orgs'))return data([{id:'00000000-0000-4000-8000-000000000090'}]);
    if(path.endsWith('/org_members'))return data([{role:'owner'}]);
    if(path.endsWith('/rpc/analytics_event_inventory_v1'))return data([{event_name:'music_play',raw_total:12,lean_total:12,bot_rows:0,recent_24h:1,recent_7d:8,taxonomy_stage:'content'}]);
    if(path.endsWith('/social_accounts'))return data([{platform:'instagram',status:'connected',media_discovery_error:'meta_error_190'}]);
    if(path.endsWith('/rpc/analytics_instagram_source_status_v1'))return data([{instagram_posts:0,verified_insight_snapshots:0}]);
    throw Error('Unexpected backend path '+path);
  };
  try{
    const response=await handleAnalyticsRequest(new Request('https://api.test/v1/analytics/event-inventory'),env,{id:'owner'});
    assert.equal(response.status,200);
    const j=await response.json();
    assert.equal(j.rows[0].name,'music_play');
    assert.equal(j.summary.names,1);
    assert.equal(j.providers.instagram.status,'reauthorization_required');
    assert.equal(j.providers.instagram.metric_snapshots,0);
    assert.doesNotMatch(JSON.stringify(j),/credential_ref|external_account_id|access_token|secret-test/);
    assert.equal(calls.some(x=>x.endsWith('/rpc/analytics_event_inventory_v1')),true);
  }finally{globalThis.fetch=original;}
});
