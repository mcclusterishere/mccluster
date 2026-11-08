import test from 'node:test';
import assert from 'node:assert/strict';
import { objectiveReflection } from '../src/executors/objective-reflection.mjs';
import { localAnalysis } from '../src/executors/local-analysis.mjs';
import { normalizeReflectionPlan } from '../src/reflection-policy.mjs';
import { buildCompletionEvidence, assertCompletionEvidence } from '../src/completion-evidence.mjs';
import { REFLECTION_USER_BYTES } from '../src/reflection-context.mjs';

for (const supplied of [undefined, {invented: 'MODEL_INVENTION', nested: 'x'.repeat(100000)}]) {
  test(`reflection child inherits compact canonical evidence, not ${supplied ? 'invented' : 'omitted'} planner evidence`, async () => {
    let plannerContext, queued;
    const result = await objectiveReflection({id: 'parent-1', org_id: 'house', input: {max_next_jobs: 1}}, {
      getObjectives: async () => [{id: 'objective-1', title: 'Repair checks', private_field: 'DO_NOT_FORWARD'}],
      getJobs: async () => Array.from({length: 30}, (_, i) => ({id: `source-${i}`, job_type: 'repo_health', status: 'failed', last_error: '\u0000😃'.repeat(300), output: {secret: 'DO_NOT_FORWARD'}})),
      getHealth: async () => ({source_job_id: 'health-1', overall: 'degraded', checked_at: '2026-11-08', secret: 'DO_NOT_FORWARD'}),
      chat: async messages => {
        plannerContext = JSON.parse(messages[1].content);
        return {message: {content: JSON.stringify({next_jobs: [{job_type: 'local_analysis', task: 'Explain blockers', evidence: supplied}, {job_type: 'deploy', task: 'Do not run'}]})}};
      },
      enqueue: async args => { queued = args; return {id: 'child-1', job_type: args.jobType}; },
    });
    assert.equal(result.queued_jobs.length, 1);
    assert.equal(result.dropped_job_count, 1);
    assert.equal(queued.orgId, 'house');
    assert.equal(queued.input.reflection_parent_job_id, 'parent-1');
    assert.equal(queued.input.reflection_origin, true);
    assert.deepEqual(queued.input.evidence, {canonical_objectives: plannerContext.canonical_objectives, recent_jobs: plannerContext.recent_jobs, health: plannerContext.health});
    assert.equal(queued.input.evidence.health.source_job_id, 'health-1');
    assert.equal(queued.input.evidence.canonical_objectives[0].id, 'objective-1');
    const serialized = JSON.stringify(queued.input.evidence);
    assert.ok(Buffer.byteLength(serialized) <= REFLECTION_USER_BYTES);
    assert.ok(!serialized.includes('DO_NOT_FORWARD'));
    assert.ok(!serialized.includes('MODEL_INVENTION'));
    let analysisInput;
    await localAnalysis({input: queued.input}, {chat: async request => {analysisInput = JSON.parse(request.messages[1].content); return {message: {content: '{"summary":"Checked source records"}'}};}});
    assert.deepEqual(analysisInput.evidence, queued.input.evidence);
    assert.deepEqual(analysisInput.evidence_limits, plannerContext.evidence_limits);
    assert.ok(analysisInput.evidence_limits.omitted_jobs > 0);
  });
}

test('normalization cannot turn model inventions into analysis evidence without canonical context', () => {
  const plan = normalizeReflectionPlan({next_jobs: [{job_type: 'local_analysis', task: 'Analyze', evidence: {fake: true}}]});
  assert.deepEqual(plan.next_jobs[0].input.evidence, {});
});

test('empty reflection evidence abstains visibly without inference, including legacy children', async () => {
  for (const evidence of [undefined, null, {}, [], '', '  ', {canonical_objectives: [], recent_jobs: [], health: null}]) {
    for (const origin of [{reflection_origin: true}, {reflection_parent_job_id: 'legacy-parent'}]) {
      const out = await localAnalysis({input: {task: 'Analyze', evidence, ...origin}}, {chat: async () => {assert.fail('must not invoke model');}});
      assert.equal(out.status, 'abstained');
      assert.equal(out.reason, 'reflection_evidence_missing');
      assert.equal(out.model, null);
      assert.equal(out.usage.model_invoked, false);
      assert.deepEqual(out.analysis.findings, []);
    }
  }
});

test('generic prompt-only and legacy evidence-bearing reflection analysis remain supported', async () => {
  for (const input of [{task: 'Reason about this proposal'}, {task: 'Analyze', reflection_origin: true, context: {source: 'legacy fact'}}, {task: 'Analyze', reflection_origin: true, evidence: {count: 0, healthy: false}}]) {
    let calls = 0;
    const out = await localAnalysis({input}, {chat: async () => {calls++; return {message: {content: '{"summary":"ok"}'}};}});
    assert.equal(calls, 1);
    assert.equal(out.analysis.summary, 'ok');
  }
});


test('legacy empty reflection analysis completes with verified bounded noop, never a model result', async () => {
  for (const origin of [{reflection_origin: true}, {reflection_parent_job_id: 'legacy-parent'}]) {
    const job = {id: 'empty-child', job_type: 'local_analysis', input: {task: 'Analyze blockers', evidence: {}, ...origin}};
    const output = await localAnalysis(job, {chat: async () => assert.fail('no inference')});
    const completed = buildCompletionEvidence(job, output);
    assert.equal(assertCompletionEvidence(job, completed), true);
    assert.equal(completed.completion_evidence.records.some(row => row.kind === 'model_result'), false);
    assert.deepEqual(completed.completion_evidence.records[1], {kind: 'bounded_noop', reason: 'reflection_evidence_missing', reflection_parent_job_id: origin.reflection_parent_job_id || null, model_invoked: false});
  }
});

test('completion boundary rejects forged and malformed reflection abstentions', async () => {
  const job = {id: 'empty-child', job_type: 'local_analysis', input: {task: 'Analyze', evidence: {}, reflection_parent_job_id: 'parent'}};
  const output = await localAnalysis(job, {chat: async () => assert.fail('no inference')});
  for (const input of [{task: 'generic'}, {reflection_origin: 'true'}, {reflection_parent_job_id: true}, {...job.input, evidence: {fact: 'available'}}, {...job.input, evidence: undefined, context: 'available'}]) {
    assert.throws(() => buildCompletionEvidence({...job, input}, output), /completion evidence rejected/);
  }
  for (const override of [
    {reason: 'arbitrary'}, {executor: 'other'}, {evidence_scope: 'live'}, {model: 'fake-model'},
    {usage: {model_invoked: true}}, {usage: {}}, {usage: {model_invoked: false, eval_count: 1}},
    {reflection_parent_job_id: 'another-parent'}, {analysis: null}, {analysis: []},
    {analysis: {...output.analysis, summary: ''}}, {analysis: {...output.analysis, summary: 'x'.repeat(241)}},
    {analysis: {...output.analysis, findings: ['invented']}}, {analysis: {...output.analysis, assumptions: null}},
    {analysis: {...output.analysis, next_actions: ['execute']}}, {analysis: {...output.analysis, extra: 'invented'}},
  ]) assert.throws(() => buildCompletionEvidence(job, {...output, ...override}), /completion evidence rejected/);
});
