import test from 'node:test';
import assert from 'node:assert/strict';
import { compactReflectionContext, loadReflectionJobs, loadReflectionHealth, REFLECTION_USER_BYTES } from '../src/reflection-context.mjs';

test('reflection excludes recursive telemetry and bounds the escaped UTF-8 prompt', () => {
  const jobs = Array.from({length: 100}, (_, i) => ({id: String(i), job_type: i % 2 ? 'host_health' : 'objective_reflection', status: 'failed', last_error: '\u0000😃'.repeat(10000), output: {secret: 'DO_NOT_FORWARD', telemetry: 'x'.repeat(500000)}}));
  const result = compactReflectionContext({objective: '\u0000'.repeat(20000), maxJobs: 0, jobs, objectives: [{id: 'a', title: 'Keep Core safe', secret: 'DO_NOT_FORWARD'}]});
  assert.ok(result.bytes <= REFLECTION_USER_BYTES);
  assert.equal(result.bytes, Buffer.byteLength(result.json));
  assert.ok(!result.json.includes('DO_NOT_FORWARD'));
  assert.ok(result.context.recent_jobs.every(j => j.job_type !== 'host_health'));
  assert.equal(result.context.max_next_jobs, 0);
  assert.ok(result.context.evidence_limits.omitted_jobs > 0);
  assert.doesNotThrow(() => JSON.parse(result.json));
});

test('reflection queries house-scoped non-health metadata, not full outputs', async () => {
  const seen = [];
  const rest = async path => { seen.push(new URL(path, 'http://test')); return {body: []}; };
  await loadReflectionJobs(rest, 'house', 18, 0);
  await loadReflectionHealth(rest, 'house');
  assert.equal(seen[0].searchParams.get('job_type'), 'neq.host_health');
  for (const url of seen) {
    assert.equal(url.searchParams.get('org_id'), 'eq.house');
    assert.ok(!url.searchParams.get('select').split(',').includes('output'));
    assert.ok(!url.searchParams.get('select').includes('*'));
  }
});

test('reflection permits a compact health summary but no arbitrary nested fields', () => {
  const out = compactReflectionContext({health: {overall: 'degraded', failures: '42', parity: 'true', sha_match: 'true', deployed_sha: 'a'.repeat(40), output: {secret: 'hidden'}}});
  assert.equal(out.context.health.failed_jobs_24h, 42);
  assert.equal(out.context.health.migration_parity, true);
  assert.ok(!out.json.includes('hidden'));
});


test('health JSON is read only by the previously selected primary key', async () => {
  const id='11111111-1111-4111-8111-111111111111',seen=[];
  const summary={overall:'degraded',parity:true};
  const rest=async path=>{const q=new URL(path,'http://test').searchParams;seen.push(q);
    return {body:seen.length===1?[{id}]:[summary]};};
  assert.deepEqual(await loadReflectionHealth(rest,'house'),summary);
  assert.equal(seen.length,2);
  assert.equal(seen[0].get('select'),'id');
  assert.equal(seen[0].get('order'),'updated_at.desc,id.desc');
  assert.equal(seen[1].get('id'),'eq.'+id);
  assert.equal(seen[1].has('order'),false);
  for(const q of seen){assert.equal(q.get('org_id'),'eq.house');assert.equal(q.get('status'),'eq.done');assert.equal(q.get('job_type'),'eq.host_health');assert.equal(q.get('limit'),'1');}
});

test('missing or removed health remains unavailable and malformed identities fail closed', async () => {
  let calls=0;
  assert.equal(await loadReflectionHealth(async()=>{calls++;return {body:[]};},'house'),null);
  assert.equal(calls,1);
  await assert.rejects(loadReflectionHealth(async()=>({body:[{id:'not-a-uuid'}]}),'house'),/identity invalid/);
  const responses=[[{id:'11111111-1111-4111-8111-111111111111'}],[]];
  assert.equal(await loadReflectionHealth(async()=>({body:responses.shift()}),'house'),null);
});
