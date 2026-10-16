import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCatalog, checkCamera, createCameraRoutes, CAMERA_CHECK_BATCH } from '../src/analytics/cameras.js';
import { handleAnalyticsRequest } from '../src/analytics/router.js';

const env={HALO_INTERNAL_TOKEN:'test-only',HALO_API_BASE:'https://prime.mccluster.org'};
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFqoAAAAASUVORK5CYII=','base64'));
const source=(id,extra={})=>({id,name:id,lat:30,lon:-97,pack:'Austin',...extra});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
test('measured catalog excludes duplicate IDs and invalid geometry; includes stale status and empty failed packs',()=>{
 const data=summarizeCatalog({count:999999,maxSources:999999,sources:[source('a'),source('a'),source('b',{lat:null}),source('c',{stale:true})],packs:{Austin:{status:'stale',fetchedAt:'2026-10-16T00:00:00Z'},London:{status:'failed'}}});
 assert.equal(data.catalog_count,2);assert.equal(data.stale_count,1);assert.deepEqual(data.excluded,{invalid:1,duplicate:1});assert.equal(data.packs.find(p=>p.name==='London').cameras,0);assert.equal(data.maxSources,undefined);
});
test('frame checks accept real raster bytes only and keep the internal credential server-side',async()=>{
 let called;
 const result=await checkCamera(env,'a',async(url,opts)=>{called={url,opts};return new Response(png,{headers:{'content-type':'image/png','x-cctv-source':'upstream-image'}});});
 assert.equal(result.status,'image_received');assert.match(result.image,/^data:image\/png;base64,/);assert.equal(called.opts.headers['x-halo-internal'],'test-only');assert.equal(called.opts.redirect,'manual');assert.equal(called.url,'https://prime.mccluster.org/api/cctv/frame/a');
 for(const [body,headers,status] of [['<svg/>',{'content-type':'image/svg+xml','x-cctv-source':'synthetic'},200],['<!doctype html>',{'content-type':'image/png','x-cctv-source':'upstream-image'},200],[png,{'content-type':'image/png','x-cctv-source':'streetview'},200],['',{'location':'https://example.com'},302]]){
  assert.equal((await checkCamera(env,'a',async()=>new Response(body,{status,headers}))).status,'unavailable');
 }
});
test('owner authorization precedes all catalog and feed access',async()=>{
 let calls=0;
 const route=createCameraRoutes({requireOwner:async()=>{throw Object.assign(new Error('Forbidden'),{status:403});},json,fetchImpl:async()=>{calls++;}});
 const url=new URL('https://api.mccluster.org/v1/analytics/cameras');
 const res=await route(new Request(url),env,{id:'member'},url,url.pathname);
 assert.equal(res.status,403);assert.equal(calls,0);
});
test('checks bound fan-out and reject URLs, oversized batches, missing bodies and invalid catalog responses',async()=>{
 let calls=0;
 const route=createCameraRoutes({requireOwner:async()=>{},json,fetchImpl:async()=>{calls++;return json({});}});
 const url=new URL('https://api.mccluster.org/v1/analytics/cameras/check');
 for(const ids of [[],['https://example.com'],Array(CAMERA_CHECK_BATCH+1).fill('a')]){
  const response=await route(new Request(url,{method:'POST',body:JSON.stringify({ids})}),env,{},url,url.pathname);assert.equal(response.status,400);
 }
 assert.equal(calls,0);
 assert.throws(()=>summarizeCatalog({count:500}),/missing/);
});
test('stored coverage counts are owner-only, organization scoped, and never replace unavailable counts with zero',async()=>{
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async raw=>{
  const u=new URL(raw),table=u.pathname.split('/').pop();calls.push(u);
  if(table==='orgs')return json([{id:'house',slug:'mccluster'}]);
  if(table==='org_members')return json([{org_id:'house',profile_id:'owner',role:'owner'}]);
  if(table==='action_proofs')return json({error:'unavailable'},503);
  const r=json([]);r.headers.set('content-range',table==='media_news_sources'?'*/*':'0-0/17');return r;
 };
 try {
  const request=new Request('https://api.mccluster.org/v1/analytics/coverage');
  const settings={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test'};
  const denied=await handleAnalyticsRequest(request,settings,null);assert.equal(denied.status,401);assert.equal(calls.length,0);
  const result=await (await handleAnalyticsRequest(request,settings,{id:'owner'})).json();
  assert.equal(result.metrics.headlines.count,17);assert.equal(result.metrics.proofs.count,null);assert.equal(result.metrics.publishers.count,null);
  for(const table of ['ops_ingest_records','ops_ingest_connectors','control_observability_events'])assert.equal(calls.find(u=>u.pathname.endsWith('/'+table)).searchParams.get('org_id'),'eq.house');
 } finally {globalThis.fetch=previous;}
});
