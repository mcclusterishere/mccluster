import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverInstagramMedia, syncInstagramInsights } from '../src/social/meta.js';
import { runUsgsCollector } from '../src/intel/usgs-collector.js';
const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',SOCIAL_IG_TEST_ACCESS_TOKEN:'token'};
const account={id:'account',org_id:'org',platform:'instagram',status:'connected',external_account_id:'ig'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status});
function mock(t,handler){const old=globalThis.fetch;globalThis.fetch=handler;t.after(()=>{globalThis.fetch=old;});}
for (const failure of [false,true]) test(`discovery ${failure?'backs off provider failure without advancing cursor':'imports one page without publishing or replacing links'}`,async t=>{
 let posted=null,patch=null;
 mock(t,async(raw,opts={})=>{
  const u=new URL(raw);
  if(u.pathname.endsWith('claim_instagram_discovery_accounts'))return json([{...account,media_discovery_cursor:'previous'}]);
  if(u.pathname.endsWith('org_channels'))return json([{account_id:'ig',token_env:'SOCIAL_IG_TEST_ACCESS_TOKEN'}]);
  if(u.host==='graph.facebook.com'){
   assert.equal(opts.method,undefined);assert.equal(u.searchParams.get('after'),'previous');
   return failure?json({error:{code:190,message:'bad token'}},401):json({data:[{id:'media',timestamp:'2026-10-01T00:00:00Z'}],paging:{next:'https://untrusted.test/token',cursors:{after:'next-cursor'}}});
  }
  if(u.pathname.endsWith('social_posts')){assert.match(opts.headers.prefer,/ignore-duplicates/);posted=JSON.parse(opts.body);return json(posted);}
  if(u.pathname.endsWith('social_accounts')){patch=JSON.parse(opts.body);return json([patch]);}
  throw Error('unexpected '+raw);
 });
 const out=await discoverInstagramMedia(env);
 if(failure){assert.equal(posted,null);assert.equal(patch.media_discovery_cursor,undefined);assert.equal(out.results[0].error,'meta_error_190');}
 else {assert.equal(posted[0].publish_mode,'imported');assert.equal(posted[0].campaign_id,undefined);assert.equal(patch.media_discovery_cursor,'next-cursor');assert.equal(out.results[0].imported,1);}
});
for(const failed of [false,true])test(`insights ${failed?'does not mark total provider failure as a successful zero':'preserves measured zero and unknown metrics separately'}`,async t=>{
 let snapshot=null,patch=null;
 mock(t,async(raw,opts={})=>{
  const u=new URL(raw);
  if(u.pathname.endsWith('claim_social_insight_posts'))return json([{id:'post',org_id:'org',account_id:'account',external_media_id:'media',published_at:'2026-10-01T00:00:00Z'}]);
  if(u.pathname.endsWith('social_accounts'))return json([account]);
  if(u.pathname.endsWith('org_channels'))return json([{account_id:'ig',token_env:'SOCIAL_IG_TEST_ACCESS_TOKEN'}]);
  if(u.host==='graph.facebook.com'){
   if(!failed&&u.searchParams.get('fields'))return json({like_count:0,comments_count:2});
   if(!failed&&u.searchParams.get('metric')==='reach')return json({data:[{values:[{value:0}]}]});
   return json({error:{message:'unavailable'}},400);
  }
  if(u.pathname.endsWith('social_metric_snapshots')){snapshot=JSON.parse(opts.body);return json([{id:'snapshot'}]);}
  if(u.pathname.endsWith('social_posts')){patch=JSON.parse(opts.body);return json([patch]);}
  throw Error('unexpected '+raw);
 });
 const out=await syncInstagramInsights(env);
 if(failed){assert.equal(snapshot,null);assert.equal(patch.last_insights_synced_at,undefined);assert.ok(out.results[0].error);}
 else {assert.equal(snapshot.likes,0);assert.equal(snapshot.reach,0);assert.equal(snapshot.views,null);assert.equal(snapshot.follows,null);assert.equal(snapshot.score,null);assert.equal(snapshot.source,'platform_api');assert.ok(patch.last_insights_synced_at);}
});
for(const scenario of ['success','archive_failure','entitlement_failure','entitlement_denied'])test(`USGS spatial checkpoint: ${scenario}`,async t=>{
 const calls=[];let archived=null;
 mock(t,async(raw,opts={})=>{
  const u=new URL(raw);calls.push(u.pathname);
  if(u.pathname.endsWith('orgs'))return json([{id:'org',slug:'mccluster'}]);
  if(u.pathname.endsWith('intel_collector_begin'))return json({started:true,run_id:'run',cursor:{}});
  if(u.pathname.endsWith('intel_collector_fail'))return json({});
  if(u.pathname.endsWith('intel_collector_commit'))return json({status:'succeeded'});
  if(u.host==='earthquake.usgs.gov')return json({type:'FeatureCollection',features:[{id:'quake',properties:{mag:3,time:Date.now(),updated:Date.now()},geometry:{coordinates:[-72,41]}}]});
  if(u.pathname.endsWith('seek_first_source_entitlements'))return scenario==='entitlement_failure'?json({},500):json(scenario==='entitlement_denied'?[{source_key:'usgs',enabled:false}]:[]);
  if(u.pathname.endsWith('seek_first_sources'))return json([{source_key:'usgs'}]);
  if(u.pathname.endsWith('seek_first_ingestion_runs'))return json([{id:'archive-run'}]);
  if(u.pathname.endsWith('seek_first_events')){archived=JSON.parse(opts.body);return scenario==='archive_failure'?json({},500):json(archived);}
  throw Error('unexpected '+raw);
 });
 const out=await runUsgsCollector({...env,INTEL_USGS_COLLECTOR_ENABLED:'true',INTEL_USGS_SPATIAL_ARCHIVE_ENABLED:'true'});
 if(scenario==='success'){
  assert.equal(out.status,'succeeded');assert.equal(archived[0].org_id,'org');assert.equal(archived[0].location,'POINT(-72 41)');assert.ok(archived[0].provenance.attribution);
  assert.ok(calls.indexOf('/rest/v1/seek_first_events')<calls.indexOf('/rest/v1/rpc/intel_collector_commit'));
 }else {assert.equal(out.status,'failed');assert.ok(!calls.some(p=>p.endsWith('intel_collector_commit')));}
});
