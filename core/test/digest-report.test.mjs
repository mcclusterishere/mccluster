import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDigestJobs, summarizeDigest, DIGEST_OUTPUT_FIELDS, evidencePresence } from '../src/digest-report.mjs';
import { buildDigest } from '../src/digest.mjs';

const orgId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-11-08T20:00:00.000Z');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, props = {}) => ({ id: id(n), org_id: orgId, updated_at: '2026-11-08T18:00:00.000Z', status: 'done', job_type: 'prim3_agent_news', output: {commented: 0, briefed: false}, ...props });
function encode(row) { const out=row.output || {}; return {...row, output:undefined, ...Object.fromEntries(DIGEST_OUTPUT_FIELDS.map(k=>[`out_${k}`,out[k]])),out_analysis_summary:out.analysis?.summary,out_tests_ran:out.tests?.ran,out_tests_ok:out.tests?.ok,out_digest:out.completion_evidence?.result_sha256}; }
function fakeReader(rows, cap = 200) {
  const calls = [];
  return { calls, read: async path => {
    calls.push(path);
    const p = new URLSearchParams(path.split('?')[1]);
    assert.equal(p.get('org_id'), `eq.${orgId}`);
    assert.equal(p.get('order'), 'updated_at.desc,id.desc');
    assert.match(p.get('and'), /updated_at.gte.2026-11-07T20:00:00.000Z,updated_at.lte.2026-11-08T20:00:00.000Z/);
    const cursor = p.get('or')?.match(/id.lt.([0-9a-f-]+)/)?.[1];
    return {body: rows.filter(r => !cursor || r.id < cursor).slice(0, Math.min(cap, Number(p.get('limit')))).map(encode)};
  }};
}
test('24h scan includes older work beyond 40 rows, tied timestamps and server caps', async () => {
  const rows = Array.from({length: 451}, (_, i) => row(500 - i));
  const fake = fakeReader(rows, 73);
  const result = await readDigestJobs({orgId, now, read: fake.read});
  assert.equal(result.jobs.length, 451);
  assert.equal(result.coverage.status, 'complete');
  assert.equal(result.coverage.window_hours, 24);
  assert.equal(fake.calls.length, 8);
});
test('exact bound is complete; lookahead labels overflow truncated', async () => {
  for (const [length, status] of [[10, 'complete'], [11, 'truncated']]) {
    const fake = fakeReader(Array.from({length}, (_, i) => row(50-i)), 3);
    const result = await readDigestJobs({orgId, now, maxJobs:10, read:fake.read});
    assert.equal(result.jobs.length, 10);
    assert.equal(result.coverage.status, status);
  }
});
test('missing organization and invalid windows fail before any job read', async () => {
  let calls = 0;
  const read = async () => {calls++; return {body:[]};};
  await assert.rejects(readDigestJobs({now, read}), /organization/);
  for (const hours of [NaN, Infinity, 0, 169]) await assert.rejects(readDigestJobs({orgId, now, read, hours}), /window/);
  assert.equal(calls, 0);
});
test('tenant leakage, duplicate cursor and query failure never become a complete report', async () => {
  await assert.rejects(readDigestJobs({orgId, now, read:async () => ({body:[row(1,{org_id:id(2)})]})}), /out-of-scope/);
  await assert.rejects(readDigestJobs({orgId, now, read:async () => ({body:[row(1)]})}), /duplicate/);
  await assert.rejects(readDigestJobs({orgId, now, read:async () => {throw Error('read failed');}}), /read failed/);
});
test('database timestamp offsets are accepted and empty scans are complete', async () => {
  let calls = 0;
  const result = await readDigestJobs({orgId, now, read: async () => ({body: calls++ ? [] : [row(1,{updated_at:'2026-11-08T20:00:00+00:00'})]})});
  assert.equal(result.coverage.complete, true);
  const empty = await readDigestJobs({orgId, now, read:async () => ({body:[]})});
  assert.equal(empty.coverage.rows, 0);
  assert.equal(empty.coverage.complete, true);
});
test('job-type facts distinguish no changes, tests, empty evidence, abstention, and child queues', () => {
  const jobs = [row(1), row(2,{output:{commented:3,briefed:true}}),
    row(3,{job_type:'world_news_pairing',output:{pairs_new:0,pairs_sent:2}}),
    ...[4,5].map(n => row(n,{job_type:'repo_health',target_id:'org/repo',output:{tests:{ran:false,ok:null},completion_evidence:{result_sha256:'same'}}})),
    row(6,{job_type:'repo_health',output:{tests:{ran:true,ok:false}}}),
    row(7,{job_type:'repo_health',output:{tests:{ran:true,ok:true}}}),
    row(8,{job_type:'local_analysis',evidence:{},output:{analysis:{summary:'unsupported diagnosis'}}}),
    row(9,{job_type:'local_analysis',output:{status:'abstained',reason:'reflection_evidence_missing',model:null}}),
    row(10,{job_type:'local_analysis',evidence:{recent_jobs:[{id:id(6)}]},output:{analysis:{summary:'test failed'}}}),
    row(11,{job_type:'objective_reflection',output:{queued_jobs:[{id:id(12)}]}}),
    row(12,{status:'queued'}), row(13,{status:'running'}), row(14,{status:'failed',last_error:'broken'}),
    row(15,{job_type:'host_health',output:{overall:'fail',summary:'system=fail failures=27'}})];
  const result = summarizeDigest(jobs,{status:'complete',window_hours:24});
  assert.deepEqual(result.facts.prim3,{runs:2,comments:3,briefs:1,zero_change:1,unknown_outputs:0});
  assert.equal(result.facts.repo_health.repeated_digest,1);
  assert.equal(result.facts.repo_health.tests_ran,2);
  assert.equal(result.facts.repo_health.tests_not_run,2);
  assert.deepEqual(result.facts.local_analysis,{with_evidence:1,empty_evidence:1,abstained:1,evidence_unknown:0});
  assert.equal(result.facts.reflection.children_queued,1);
  assert.equal(result.outcomes.planning,1);
  assert.equal(result.counts.failed,1);
  assert.equal(result.facts.health.failing_observations,1);
  assert.match(result.body,/failures=27/);
  assert.doesNotMatch(result.body,/unsupported diagnosis/);
  assert.equal(Object.values(result.outcomes).reduce((a,b)=>a+b,0),result.counts.done);
});
test('maintenance flood cannot crowd out failures, tests and code evidence', () => {
  const jobs = Array.from({length:500},(_,i)=>row(i));
  jobs.push(row(600,{job_type:'code_patch',output:{changed:true,commit:'a'.repeat(40),pushed:false}}));
  jobs.push(row(601,{job_type:'repo_health',output:{tests:{ran:true,ok:false}}}));
  const result = summarizeDigest(jobs,{status:'truncated',window_hours:24});
  assert.match(result.body,/TRUNCATED/);
  assert.match(result.body,/Tests ran: FAILED/);
  assert.match(result.body,/Commit a{40}; pushed=false/);
  assert.equal(result.details.length,2);
});
test('buildDigest resolves organization before reading and has no delivery or signal effects', async () => {
  const events = [];
  const result = await buildDigest({orgId:'',now,resolveOrg:async()=>{events.push('resolve');return orgId;},read:async path=>{events.push('read');assert.match(path,/org_id=eq/);return {body:[]};}});
  assert.deepEqual(events,['resolve','read']);
  assert.equal(result.org_id,orgId);
  assert.equal(result.coverage.window_hours,24);
});

test('missing outputs remain unknown rather than no-change or tests skipped',()=>{const result=summarizeDigest(['prim3_agent_news','world_news_pairing','repo_health','code_patch'].map((job_type,i)=>row(i,{job_type,output:{}})),{status:'complete',window_hours:24}); assert.equal(result.outcomes.no_change,0); assert.equal(result.facts.prim3.unknown_outputs,1); assert.equal(result.facts.pairing.unknown_outputs,1); assert.equal(result.facts.repo_health.tests_unknown,1); assert.equal(result.facts.repo_health.tests_not_run,0); assert.match(result.body,/Code outcome unknown/);});
test('database projection reconstructs factual fields without full output or prompt', async()=>{
  const fake=fakeReader([row(1,{job_type:'repo_health',output:{tests:{ran:true,ok:false,stdout_tail:'private'},completion_evidence:{result_sha256:'abc'}}})]);
  const result=await buildDigest({orgId,now,read:fake.read});
  assert.equal(result.facts.repo_health.tests_failed,1);
  const select=new URLSearchParams(fake.calls[0].split('?')[1]).get('select');
  assert.ok(!select.split(',').includes('output'));
  assert.ok(!select.split(',').includes('input'));
  assert.doesNotMatch(JSON.stringify(result),/private|stdout_tail|evidence:input/);
});

test('missing pairing counters are explicitly unknown in details',()=>{const result=summarizeDigest([row(1,{job_type:'world_news_pairing',status:'done',output:{}})],{status:'complete',window_hours:24}); assert.equal(result.facts.pairing.unknown_outputs,1); assert.match(result.body,/not executions or a snapshot/);});

test('retained scan rows discard private evidence/context and raw projection aliases', async()=>{
 const fake=fakeReader([row(1,{job_type:'local_analysis',evidence:{private:'private-source-text'},context:{private:'private-context'},output:{analysis:{summary:'bounded result'}}})]);
 const result=await readDigestJobs({orgId,now,read:fake.read});
 assert.equal(result.jobs[0].evidence_presence,'present');
 assert.equal(Object.hasOwn(result.jobs[0],'evidence'),false);
 assert.equal(Object.hasOwn(result.jobs[0],'context'),false);
 assert.equal(Object.keys(result.jobs[0]).some(key=>key.startsWith('out_')),false);
 assert.doesNotMatch(JSON.stringify(result),/private-source-text|private-context/);
});
test('deep and broad evidence is bounded and unknown, not empty or input-backed', async()=>{
 let deep={fact:'hidden'}; for(let i=0;i<10000;i++)deep={child:deep};
 assert.equal(evidencePresence(deep),'unknown');
 assert.equal(evidencePresence(Array.from({length:1000},()=>null)),'unknown');
 assert.equal(evidencePresence({empty:[{},null,' ']}),'empty');
 const fake=fakeReader([row(1,{job_type:'local_analysis',evidence:deep,output:{analysis:{summary:'unverified'}}})]);
 const scan=await readDigestJobs({orgId,now,read:fake.read});
 const report=summarizeDigest(scan.jobs,scan.coverage);
 assert.equal(report.facts.local_analysis.evidence_unknown,1);
 assert.equal(report.facts.local_analysis.empty_evidence,0);
 assert.equal(report.facts.local_analysis.with_evidence,0);
});
test('server page caps cannot cause more than 100 reads; truncation is explicit',async()=>{
 const fake=fakeReader(Array.from({length:101},(_,i)=>row(200-i)),1);
 const scan=await readDigestJobs({orgId,now,read:fake.read});
 assert.equal(fake.calls.length,100); assert.equal(scan.coverage.reason,'read_limit'); assert.equal(scan.coverage.status,'truncated');
});

test('retained summaries and planner collections are compact',async()=>{
 const fake=fakeReader([row(1,{job_type:'objective_reflection',output:{summary:'x'.repeat(100000),queued_jobs:Array.from({length:1000},(_,i)=>({id:id(i),private:'source'}))}})]);
 const scan=await readDigestJobs({orgId,now,read:fake.read});
 assert.equal(scan.jobs[0].output.summary.length,180);
 assert.equal(scan.jobs[0].output.queued_jobs,undefined);
 assert.equal(scan.jobs[0].output.queued_child_count,1000);
 assert.equal(summarizeDigest(scan.jobs,scan.coverage).facts.reflection.children_queued,1000);
 assert.doesNotMatch(JSON.stringify(scan),/private|source/);
});
