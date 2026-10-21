import test from 'node:test';
import assert from 'node:assert/strict';
import { handleIntelRequest } from '../src/intel/router.js';
import { evidenceProjection, sourceHealthProjection, TRUTH_KINDS } from '../src/intel/projection.js';
import { normalizeFeature, fetchUsgsPage } from '../src/intel/usgs-collector.js';

const ORG='00000000-0000-4000-8000-0000000000a1', OWNER='00000000-0000-4000-8000-00000000000b';
const BRIEFING='00000000-0000-4000-8000-0000000000b1', DECISION='00000000-0000-4000-8000-0000000000d1';
const env={SUPABASE_URL:'https://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const input={briefing_id:BRIEFING,title:'Preparedness check',decision:'Prepare a reviewed check-in',rationale:'Cited observation'};
const call=()=>handleIntelRequest(new Request('https://api.mccluster.org/v1/intel/decisions',{
  method:'POST',headers:{authorization:'Bearer actual-owner','content-type':'application/json'},body:JSON.stringify(input)
}),env,{requireHouseOwner:async()=>({id:OWNER})});

test('committed decision survives failed basis; retry carries exactly the same key, actor and decision',async t=>{
  let basisCalls=0, proposals=0; const keys=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(String(url).includes('/rest/v1/orgs?'))return json([{id:ORG}]);
    if(String(url).includes('/functions/v1/context-decision?'))return json({contract:'intel-decision/v2',schema_ready:true});
    if(String(url).endsWith('/functions/v1/context-decision')) {
      assert.equal(init.headers.authorization,'Bearer actual-owner');
      const body=JSON.parse(init.body);keys.push(body.idempotency_key);proposals++;
      assert.equal(body.status,'proposed'); assert.equal(body.metadata.intel_briefing_id,BRIEFING);
      return json({decision:{id:DECISION,status:'proposed'},created:proposals===1});
    }
    if(String(url).endsWith('/rpc/intel_record_decision_basis')) {
      const body=JSON.parse(init.body);assert.equal(body.p_decision,DECISION);assert.equal(body.p_actor,OWNER);
      if(++basisCalls===1)return json({code:'XX000',message:'ledger unavailable'},500);
      return json({decision_id:DECISION,basis_items:3,audit:{recorded:true,id:32}});
    }
    throw Error(`unexpected ${url}`);
  });
  const first=await call(), failed=await first.json();
  assert.equal(first.status,503);assert.equal(failed.recovery.decision_id,DECISION);
  assert.equal(failed.audit.recorded,null);assert.equal(failed.audit.state,'unconfirmed');assert.equal(failed.actionable,false);
  const second=await call(), repaired=await second.json();
  assert.equal(second.status,200);assert.equal(repaired.recovery.state,'complete');assert.equal(repaired.audit.recorded,true);
  assert.equal(keys[0],keys[1]);assert.equal(keys[0],failed.idempotency_key);
});

test('old deployed decision service cannot receive a retryable proposal',async t=>{
  let writes=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(String(url).includes('/rest/v1/orgs?'))return json([{id:ORG}]);
    if(init.method==='GET')return json({decisions:[]});
    writes++;return json({});
  });
  const result=await call();assert.equal(result.status,503);assert.equal(writes,0);
  assert.equal((await result.json()).detail.code,'intel_decision_contract_not_ready');
});

test('timeout, true empty, stale cache, cap and denied entitlement remain distinct',()=>{
  const now=new Date('2026-10-20T12:00:00Z');
  const last={finished_at:'2026-10-20T08:00:00Z',status:'succeeded'};
  assert.deepEqual(['timeout','last_success_only',true],((h)=>[h.transport,h.coverage,h.stale])(
    sourceHealthProjection({latest_run:{status:'failed',error:'provider_timeout'},last_successful_run:last},{now})));
  assert.equal(sourceHealthProjection({latest_run:{status:'succeeded',records_seen:0}},{now}).coverage,'empty');
  assert.equal(sourceHealthProjection({latest_run:{status:'succeeded',records_seen:500,metadata:{page_full:true}}},{now}).coverage,'truncated');
  assert.equal(sourceHealthProjection({latest_run:{status:'failed',error:'provider_http_403'}},{now}).transport,'denied');
  assert.equal(sourceHealthProjection(null,{now}).coverage,'unknown');
});

test('truth kinds stay distinct and derived centroid never becomes source geometry',()=>{
  for(const kind of TRUTH_KINDS)assert.equal(evidenceProjection({},{truthKind:kind}).truth_kind,kind);
  assert.throws(()=>evidenceProjection({lat:41,lon:-73,geo_source:'centroid'}),/source-published/);
  const projection=evidenceProjection({observed_at:null},{derivedGeometry:{type:'Point',coordinates:[-73,41],method:'country_centroid',uncertainty:null}});
  assert.equal(projection.geometry,null);assert.equal(projection.time.observed_at,null);
  assert.equal(projection.derived_geometry.method,'country_centroid');
  assert.throws(()=>evidenceProjection({},{derivedGeometry:{type:'Point',method:'model'}}),/uncertainty/);
});

test('actual USGS normalization retains source revision and unknown publication time',async()=>{
  const row=await normalizeFeature({type:'Feature',id:'fixture',properties:{time:1000,updated:2000,mag:4},geometry:{type:'Point',coordinates:[-73,41]}},'2026-10-20T12:00:00Z');
  const p=row.source_ref.projection;
  assert.equal(p.truth_kind,'observation');assert.equal(p.time.publisher_published_at,null);
  assert.equal(p.source_revision,'1970-01-01T00:00:02.000Z');
  assert.deepEqual(p.geometry.coordinates,[-73,41]);assert.equal(p.geometry.basis,'source_published');
  assert.equal(p.derived_geometry,null);assert.equal(p.review.status,'unreviewed');
  const unknown=await normalizeFeature({type:'Feature',id:'no-revision',properties:{time:1000},geometry:null},'2026-10-20T12:00:00Z');
  assert.equal(unknown.source_ref.projection.source_revision,null);
  assert.equal(unknown.source_ref.updated_at,null);
  assert.match(unknown.idempotency_key,/sha256:/);
  assert.deepEqual(p.values,[{name:'magnitude',value:4,unit:null},{name:'depth',value:null,unit:'km'}]);
});

test('USGS response body is byte bounded and remains under its deadline after headers arrive',async()=>{
  await assert.rejects(()=>fetchUsgsPage('https://example.test',async()=>new Response(' '.repeat(101)),{maxBytes:100}),/provider_payload_too_large/);
  await assert.rejects(()=>fetchUsgsPage('https://example.test',async()=>new Response(new ReadableStream({start(){}})),{timeoutMs:10}),/provider_timeout/);
});
