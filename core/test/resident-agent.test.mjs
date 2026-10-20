import test from 'node:test';
import assert from 'node:assert/strict';
import { runResidentAgent } from '../src/resident-agent.mjs';
import { executeResidentTool, safeRepositoryPath, stableAnalysisId } from '../src/resident-tools.mjs';
import { packHistory, memoryQuery, relevantMemory, memoryUnavailableAnswer, memoryPrompt } from '../src/resident-context.mjs';
import { inferenceSettings, inferenceUsage } from '../src/compute/inference-settings.mjs';

const context = { orgId: 'trusted-house', turnId: 'turn-1', before: '2026-10-20T12:00:00Z' };
test('model reads actual tool results before answering and checkpoints the receipt', async () => {
  let rounds = 0, checkpointed = false;
  const result = await runResidentAgent({ messages: [{ role: 'user', content: 'Read operations status' }], context, checkpoint: async receipts => { assert.equal(receipts[0].ok, true); checkpointed = true; } }, {
    chat: async input => {
      assert.equal(input.think, false);
      if (!rounds++) return { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'operations_read', arguments: {} } }] } };
      assert.equal(checkpointed, true);
      assert.equal(JSON.parse(input.messages.at(-1).content).failed_jobs, 3);
      return { message: { content: 'There are 3 failed jobs.' }, model: 'qwen3:8b' };
    },
    execute: async (name, args, scope) => { assert.equal(scope.orgId, 'trusted-house'); return { failed_jobs: 3 }; },
  });
  assert.equal(rounds, 2);
  assert.equal(result.tool_receipts.length, 1);
  assert.equal(result.message.content, 'There are 3 failed jobs.');
});

test('server refuses invented tools and cross-organization arguments', async () => {
  await assert.rejects(executeResidentTool('shell_execute', { command: 'anything' }, context), /outside resident authority/);
  await assert.rejects(executeResidentTool('operations_read', { org_id: 'other-org' }, context), /Unexpected argument/);
  let seen;
  await executeResidentTool('job_read', { job_id: '00000000-0000-4000-8000-000000000001' }, context, { rest: async path => { seen = path; return { body: [{ id: 'job', status: 'done' }] }; } });
  assert.match(seen, /org_id=eq.trusted-house/);
});

test('queued analysis has stable identity across retries and no deploy/send authority', async () => {
  const created = [];
  const deps = { enqueueJob: async row => { created.push(row); return { id: row.jobId, status: 'queued' }; } };
  const args = { task: 'Draft an incident summary', evidence: 'Three observed failures' };
  const a = await executeResidentTool('analysis_queue', args, context, deps);
  const b = await executeResidentTool('analysis_queue', args, context, deps);
  assert.equal(a.job_id, b.job_id);
  assert.equal(created[0].jobType, 'local_analysis');
  assert.equal(created[0].orgId, context.orgId);
  assert.equal(a.completed, false);
  assert.notEqual(stableAnalysisId('other-turn', args.task, args.evidence), a.job_id);
});

test('agent stops tool execution at its budget and makes a final answer pass', async () => {
  let round = 0, executed = 0;
  const output = await runResidentAgent({ messages: [{ role: 'user', content: 'Check' }], context, maxCalls: 1 }, {
    chat: async input => {
      if (round++) { assert.equal(input.tools, undefined); return { message: { content: 'Checked once.' } }; }
      return { message: { role: 'assistant', content: '', tool_calls: [1, 2].map(() => ({ function: { name: 'operations_read', arguments: {} } })) } };
    }, execute: async () => { executed++; return { ok: true }; },
  });
  assert.equal(executed, 1);
  assert.equal(output.tool_receipts[1].ok, false);
});

test('memory window exceeds the previous 24 messages and always retains the latest turn', async () => {
  const history = Array.from({ length: 120 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: `Message ${i}` }));
  const packed = packHistory(history);
  assert.equal(packed.included_messages, 120);
  assert.equal(packed.messages.at(-1).content, 'Message 119');
  const small = packHistory(history, 100);
  assert.equal(small.messages.at(-1).content, 'Message 119');
  assert.ok(small.chars <= 100);
  assert.equal(small.truncated, true);
  assert.match(memoryQuery('What did we decide about funding and OVH?'), /funding/);
  const memory = await relevantMemory({ orgId: 'house', content: 'funding', before: context.before }, async args => { assert.equal(args.before, context.before); throw new Error('unavailable'); });
  assert.equal(memory.available, false);
  assert.match(memoryUnavailableAnswer('Use saved memory to recall our code', memory), /will not invent/);
  assert.equal(memoryUnavailableAnswer('Explain photosynthesis', memory), null);
  assert.equal(memoryUnavailableAnswer('Use saved memory', { available: true }), null);
});

test('tracked source reads reject traversal and credential files', () => {
  for (const file of ['../core.env', '/etc/passwd', '.env', '.env.production', 'config/private-key.pem', 'a\\..\\b']) assert.throws(() => safeRepositoryPath(file));
  assert.equal(safeRepositoryPath('core/src/runner.mjs'), 'core/src/runner.mjs');
});

test('retrieval does not resend recent messages and prioritizes user evidence over generated claims', () => {
  const prompt = memoryPrompt({ available: true, resident_messages: [{ id: 'duplicate', role: 'user', content: 'already in history' }, { id: 'generated', role: 'assistant', content: 'unverified answer' }, { id: 'source', role: 'user', content: 'original fact' }] }, ['duplicate']);
  assert.doesNotMatch(prompt, /already in history/);
  assert.ok(prompt.indexOf('original fact') < prompt.indexOf('unverified answer'));
});

test('inference controls reject unbounded generation and record separate timings', () => {
  const settings = inferenceSettings({ num_ctx: Infinity, num_predict: -1, temperature: 'invalid' });
  assert.equal(settings.think, false);
  assert.equal(settings.num_ctx, 16384);
  assert.equal(settings.num_predict, 16);
  assert.equal(settings.temperature, 0.3);
  const usage = inferenceUsage({ eval_count: 20, eval_duration: 2e9, load_duration: 5e9, prompt_eval_duration: 1e9, prompt_eval_count: 100, total_duration: 8e9 });
  assert.equal(usage.generation_tokens_per_second, 10);
  assert.equal(usage.prompt_tokens_per_second, 100);
  assert.equal(usage.load_duration_ns, 5e9);
});
