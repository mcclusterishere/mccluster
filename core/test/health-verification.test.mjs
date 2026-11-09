import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeRuntimeHealth} from '../src/health-verification.mjs';
import {summarizeReconcileCycles} from '../src/reconciler-source-receipt.mjs';
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

// Incident #510: the reconcile timer stayed "active" for a day while every cycle
// failed. Cycle receipts (deployment.reconcile) make that visible.
const healthy = () => { const value=base(); value.runtime_checks={local_core:{http_status:200,ok:true,deployment_sha:'a'.repeat(40)},public_core:{http_status:200,ok:true,deployment_sha:'a'.repeat(40)}}; return value; };
test('a failed reconcile cycle is a deployment warning even though the timer is active',()=>{
  const value=healthy();
  value.deployment.reconcile={status:'failed',consecutive_failed_cycles:7,last_verified_at:'2026-11-07T13:59:29Z',
    last_cycle:{outcome:'failed',stage:'fetch',exit_code:128,interrupted:false,transport:'https',trigger:'timer',finished_at:'2026-11-09T22:00:00Z'}};
  const result=finalizeRuntimeHealth(value);
  assert.equal(result.overall,'degraded');assert.equal(result.health_sections.infrastructure.status,'degraded');
  assert.deepEqual(result.degradation.map(item=>[item.component,item.code,item.severity]),[['deployment','reconcile_cycle_failed','warning']]);
  assert.deepEqual(result.degradation[0].detail,{stage:'fetch',exit_code:128,interrupted:false,transport:'https',trigger:'timer',finished_at:'2026-11-09T22:00:00Z',consecutive_failed_cycles:7,last_verified_at:'2026-11-07T13:59:29Z'});
  assert.match(result.degradation[0].message,/failed at stage fetch/);
  assert.deepEqual(result.health_sections.infrastructure.issues.map(item=>item.code),['reconcile_cycle_failed']);
  assert.equal(result.deployment.runtime_verification,'verified','the serving SHA is still verified: the warning is about the reconciler');
  const cut=healthy();cut.deployment.reconcile={status:'failed',last_cycle:{outcome:'failed',stage:'deploy',exit_code:null,interrupted:true}};
  const terminated=finalizeRuntimeHealth(cut);
  assert.match(terminated.degradation[0].message,/terminated at stage deploy before it finished/);
  assert.equal(terminated.degradation[0].detail.exit_code,null);assert.equal(terminated.degradation[0].detail.interrupted,true);
});
test('a stale reconcile cycle is a deployment warning',()=>{
  const value=healthy();
  value.deployment.reconcile={status:'stale',last_verified_at:'2026-11-09T21:00:00Z',age_ms:4200000,stale_after_ms:1500000,last_cycle:{outcome:'deferred',stage:'deploy',finished_at:'2026-11-09T22:08:00Z'}};
  const result=finalizeRuntimeHealth(value);
  assert.deepEqual(result.degradation.map(item=>[item.component,item.code,item.severity]),[['deployment','reconcile_cycle_stale','warning']]);
  assert.deepEqual(result.degradation[0].detail,{last_verified_at:'2026-11-09T21:00:00Z',age_ms:4200000,stale_after_ms:1500000,last_cycle_outcome:'deferred',last_cycle_stage:'deploy',last_cycle_finished_at:'2026-11-09T22:08:00Z'});
  assert.equal(result.overall,'degraded');assert.equal(result.health_sections.infrastructure.status,'degraded');
});
test('verified receipts, and a host whose reconciler writes none, leave health exactly as it was',()=>{
  const before=finalizeRuntimeHealth(healthy());
  assert.equal(before.overall,'ok');assert.equal(before.degradation.length,0);
  for (const reconcile of [{status:'verified'},{status:'unverified',last_cycle:null},summarizeReconcileCycles({}),null,undefined]) {
    const value=healthy();if(reconcile!==undefined)value.deployment.reconcile=reconcile;
    const result=finalizeRuntimeHealth(value);
    assert.equal(result.overall,'ok');assert.equal(result.health_sections.infrastructure.status,'ok');
    assert.deepEqual(result.degradation,[]);assert.deepEqual(result.health_sections.infrastructure.issues,[]);
    assert.equal(result.summary,before.summary);
  }
  assert.equal(summarizeReconcileCycles({}).status,'unverified');
});
test('a reconcile warning never softens a critical failure',()=>{
  const value=healthy();value.runtime_checks.local_core={http_status:503,ok:false};
  value.deployment.reconcile={status:'failed',last_cycle:{outcome:'failed',stage:'fetch',exit_code:128,interrupted:false}};
  const result=finalizeRuntimeHealth(value);
  assert.equal(result.overall,'fail');assert.equal(result.health_sections.infrastructure.status,'fail');
  assert.deepEqual(result.degradation.map(item=>item.code),['local_core_probe_failed','reconcile_cycle_failed']);
});
