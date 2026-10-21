import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeRuntimeHealth} from '../src/health-verification.mjs';
import {enrichHostHealth} from '../src/health-details.mjs';

test('HTTP 200 without a valid serving SHA never attests the deployment',()=>{
  for (const sha of [undefined,null,'unknown','bad']) {
    const result=finalizeRuntimeHealth({overall:'ok',summary:'system=ok infrastructure=ok',degradation:[],deployment:{deployed_sha:'a'.repeat(40)},health_sections:{infrastructure:{status:'ok',issues:[]}},runtime_checks:{local_core:{http_status:200,ok:true,deployment_sha:sha},public_core:{http_status:200,ok:true,deployment_sha:sha}}});
    assert.equal(result.health_sections.infrastructure.status,'unverified');
    assert.equal(result.deployment.runtime_verification,'unverified');
    assert.notEqual(result.overall,'ok');
  }
});

test('detail-query failure preserves sampled evidence without mislabeling sample counts as exact',async()=>{
  const sample={id:'failed-job',job_type:'local_analysis',last_error:'fetch failed'};
  const original={overall:'degraded',summary:'system=degraded',degradation:[{component:'jobs',severity:'warning'}],jobs:{counts:{failed:42},retry_exhausted_count:4,recent_failures:[sample]}};
  const result=await enrichHostHealth(original,{orgId:'house',rest:async()=>{throw new Error('unavailable');},diagnostics:async()=>({})});
  assert.deepEqual(result.jobs.recent_failures,[sample]);
  assert.equal(result.jobs.sampled_retry_exhausted_count,4);
  assert.equal(result.jobs.retry_exhausted_count,null);
  assert.equal(result.jobs.recent_failures_scope,'collector_sample_fallback');
  assert.equal(result.jobs.failure_details.complete,false);
  assert.equal(result.overall,'degraded');
});
