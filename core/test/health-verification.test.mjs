import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeRuntimeHealth} from '../src/health-verification.mjs';
const base = () => ({overall:'ok',summary:'system=ok infrastructure=ok',deployment:{deployed_sha:'a'.repeat(40)},degradation:[],health_sections:{infrastructure:{status:'ok',issues:[]}},runtime_checks:{}});
test('runtime response failures cannot be hidden behind a matching host manifest',()=>{
  const value=base();value.runtime_checks.local_core={http_status:503,ok:false};
  const result=finalizeRuntimeHealth(value);
  assert.equal(result.overall,'fail');assert.equal(result.health_sections.infrastructure.status,'fail');
});
test('external DNS restriction is explicitly unverified, not an invented outage',()=>{
  const value=base();value.runtime_checks.public_core={http_status:null,ok:null};
  value.runtime_checks.local_core={http_status:200,ok:true,deployment_sha:'a'.repeat(40)};
  const result=finalizeRuntimeHealth(value);
  assert.equal(result.overall,'ok');assert.equal(result.health_sections.infrastructure.public_access,'unverified');
});
test('a real serving SHA discrepancy adds a warning and preserves old warnings',()=>{
  const value=base();value.degradation=[{component:'jobs',code:'failed_jobs_present',severity:'warning'}];
  value.runtime_checks.public_core={http_status:200,ok:true,deployment_sha:'b'.repeat(40)};
  const result=finalizeRuntimeHealth(value);
  assert.equal(result.overall,'degraded');assert.equal(result.degradation.length,2);
  assert.equal(result.health_sections.infrastructure.public_serving_sha,'b'.repeat(40));
});
