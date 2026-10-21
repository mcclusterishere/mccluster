import test from 'node:test';
import assert from 'node:assert/strict';
import { failureDetails, healthProbe, jsonFileProbe, healthSections, enrichHostHealth } from '../src/health-details.mjs';
const row = i => ({id: `job-${i}`, job_type: 'objective_reflection', attempts: 2, max_attempts: 2, updated_at: '2026-10-21T15:00:00Z'});

test('failure detail queries are independent of telemetry and count every exhausted failure', async () => {
  const all = Array.from({length: 142}, (_, i) => row(i));
  const rest = async path => {
    const q = new URL(path, 'http://test').searchParams;
    assert.equal(q.get('status'), 'eq.failed'); assert.equal(q.get('org_id'), 'eq.house');
    assert.ok(q.get('and').includes('updated_at.lte.'));
    const start = Number(q.get('offset')); const body = all.slice(start, start + Number(q.get('limit')));
    return {body, headers: new Headers({'content-range': `${start}-${start+body.length-1}/142`})};
  };
  const out = await failureDetails(rest, 'house', Date.parse('2026-10-21T16:00:00Z'));
  assert.equal(out.complete, true); assert.equal(out.retry_exhausted_count, 142); assert.equal(out.recent_failures.length, 12);
});

test('capped or changing scans never pretend to return an exact exhausted count', async () => {
  const rest = async () => ({body: Array.from({length:100},(_,i)=>row(i)), headers: new Headers({'content-range':'0-99/9999'})});
  const out = await failureDetails(rest, 'house', Date.now(), 100);
  assert.equal(out.complete, false); assert.equal(out.retry_exhausted_count, null); assert.equal(out.retry_exhausted_lower_bound, 100);
});

test('transport restriction is unverified, while HTTP and serving SHA are observed separately', async () => {
  const failure = await healthProbe('https://example.test', async () => {throw Object.assign(new Error('private payload'), {code: 'ENOTFOUND'});});
  assert.equal(failure.http_status, null); assert.equal(failure.verification, 'unverified'); assert.ok(!JSON.stringify(failure).includes('private payload'));
  const success = await healthProbe('https://example.test', async () => new Response(JSON.stringify({ok:true, deployment_sha:'a'.repeat(40)}), {status:200}));
  assert.equal(success.http_status, 200); assert.equal(success.deployment_sha, 'a'.repeat(40));
});

test('snapshot permission, missing file and malformed JSON remain distinguishable', async () => {
  for (const name of ['ENOENT','EACCES']) {
    const result = await jsonFileProbe('/fixed', async () => {throw Object.assign(new Error('hidden'), {code:name});});
    assert.equal(result.error, name);
  }
  assert.equal((await jsonFileProbe('/fixed', async () => '{bad')).error, 'SyntaxError');
});

const snapshot = () => ({overall:'degraded',summary:'system=degraded',
  degradation:[{component:'jobs',code:'failed_jobs_present',severity:'warning'},{component:'communications',code:'no_enabled_relay',severity:'warning'}],
  services:{core_runner:'active',core_tool_broker:'active'}, supabase:{reachable:true,migration_attestation:{parity:true}},
  deployment:{sha_match:true},edge:{reachable:true},jobs:{counts:{failed:42},error:null},
  communications:{schema_ready:true,relay_count:0,enabled_relays:0,pending_outbox:0,failed_outbox:0,stale_relays:0},prim3:{status:'degraded'}});

test('healthy infrastructure, failed workloads and unconfigured capabilities are distinct without masking warnings', async () => {
  const before = snapshot();
  const result = await enrichHostHealth(before, {orgId:'house',rest:async()=>({body:Array.from({length:42},(_,i)=>row(i)),headers:new Headers({'content-range':'0-41/42'})}),diagnostics:async()=>({})});
  assert.equal(result.overall,'degraded'); assert.deepEqual(result.degradation,before.degradation);
  assert.equal(result.health_sections.infrastructure.status,'ok');
  assert.equal(result.health_sections.workloads.status,'degraded');
  assert.equal(result.health_sections.capabilities.communications.status,'not_configured');
  assert.equal(result.jobs.retry_exhausted_count,42);
  assert.equal(healthSections({}).infrastructure.status,'unverified');
  const activeNeed = snapshot(); activeNeed.communications.pending_outbox=1;
  assert.equal(healthSections(activeNeed).capabilities.communications.status,'degraded');
});
