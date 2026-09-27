import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { localAiChat } from '../src/compute/local-ai-client.mjs';

const executorFiles = [
  'local-analysis.mjs',
  'objective-plan.mjs',
  'objective-reflection.mjs',
  'objective-synthesis.mjs',
  'sms-assistant-turn.mjs',
  'meeting-delegate-collect.mjs',
];

test('resident Core local-model executors use the shared adapter gate', async () => {
  for (const name of executorFiles) {
    const source = await readFile(new URL(`../src/executors/${name}`, import.meta.url), 'utf8');
    assert.match(source, /local-ai-client\.mjs/, `${name} must import the shared local AI client`);
    assert.doesNotMatch(source, /\/api\/chat/, `${name} must not call Ollama directly`);
    assert.doesNotMatch(source, /MCCLUSTER_OLLAMA_URL/, `${name} must not own an Ollama endpoint`);
  }
});

test('local AI client uses the loopback adapter and preserves normalized usage', async () => {
  let seen = null;
  const result = await localAiChat({
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0.3,
    priority: -20,
    metadata: { job_type: 'test' },
  }, {
    fetchImpl: async (url, init) => {
      seen = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        model: 'qwen3:8b',
        implementation: 'qwen3.8b.local',
        content: 'hello back',
        queue_wait_ms: 42,
        usage: { prompt_eval_count: 10, eval_count: 4, total_duration_ns: 123 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(seen.url, 'http://127.0.0.1:4790/execute');
  assert.equal(new URL(seen.url).hostname, '127.0.0.1');
  assert.equal(seen.body.capability, 'ai.chat');
  assert.equal(seen.body.priority, -20);
  assert.equal(result.message.content, 'hello back');
  assert.equal(result.model, 'qwen3:8b');
  assert.equal(result.queue_wait_ms, 42);
  assert.equal(result.prompt_eval_count, 10);
});

test('adapter serializes requests by priority and exposes queue health', async () => {
  const source = await readFile(new URL('../src/compute/ollama-adapter.mjs', import.meta.url), 'utf8');
  assert.match(source, /const pending = \[\]/);
  assert.match(source, /pending\.sort\(\(a, b\) => b\.priority - a\.priority \|\| a\.sequence - b\.sequence\)/);
  assert.match(source, /queue_depth: pending\.length/);
  assert.match(source, /busy: Boolean\(active\)/);
  assert.match(source, /CALLER_ABORTED/);
  assert.match(source, /pending\.splice\(index, 1\)/);
  assert.match(source, /req\.once\('aborted', abortCaller\)/);
  assert.match(source, /AbortSignal\.any/);
});

test('compute node forwards durable task priority into the adapter', async () => {
  const source = await readFile(new URL('../src/compute/node-agent.mjs', import.meta.url), 'utf8');
  assert.match(source, /priority: Number\(task\.priority \|\| 0\)/);
});
