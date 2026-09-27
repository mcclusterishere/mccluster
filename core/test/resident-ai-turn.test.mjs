import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://db.test';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret';
process.env.MCCLUSTER_OLLAMA_ADAPTER_URL ||= 'http://127.0.0.1:4790';

const { residentAiTurn } = await import('../src/executors/resident-ai-turn.mjs');

const ORG = '00000000-0000-4000-8000-000000000001';
const THREAD = '00000000-0000-4000-8000-000000000002';
const USER = '00000000-0000-4000-8000-000000000003';
const ASSISTANT = '00000000-0000-4000-8000-000000000004';
const JOB = '00000000-0000-4000-8000-000000000005';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function job() {
  return {
    id: JOB,
    org_id: ORG,
    job_type: 'resident_ai_turn',
    input: {
      thread_id: THREAD,
      user_message_id: USER,
      assistant_message_id: ASSISTANT,
      input_mode: 'text',
    },
  };
}

test('resident AI turn persists the adapter message even after the browser is irrelevant', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  let assistantLookup = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET', body: init.body ? String(init.body) : '' });

    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('id=eq.' + ASSISTANT)) {
      assistantLookup += 1;
      return json(assistantLookup === 1 ? [] : [{
        id: ASSISTANT, thread_id: THREAD, org_id: ORG, role: 'assistant',
        content: 'MCCLUSTER_DURABLE_REPLY', model: 'qwen3:8b',
        implementation: 'core-local', metadata: { agent_job_id: JOB }, created_at: '2026-09-27T22:30:00Z'
      }]);
    }

    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('id=eq.' + USER) && (init.method || 'GET') === 'GET') {
      return json([{
        id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'keep working if I close this', metadata: { agent_job_id: JOB }, created_at: '2026-09-27T22:29:00Z'
      }]);
    }

    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('thread_id=eq.' + THREAD) && (init.method || 'GET') === 'GET') {
      return json([{
        id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'keep working if I close this', metadata: { agent_job_id: JOB }, created_at: '2026-09-27T22:29:00Z'
      }]);
    }

    if (url.includes('/rest/v1/ops_ai_messages?') && (init.method || 'GET') === 'PATCH') {
      return json([{
        id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'keep working if I close this', metadata: { agent_job_id: JOB }, created_at: '2026-09-27T22:29:00Z'
      }]);
    }

    if (url === 'http://127.0.0.1:4790/execute') {
      const request = JSON.parse(String(init.body));
      assert.equal(request.priority, 100);
      assert.equal(request.metadata.source, 'resident-ai-turn');
      assert.ok(request.input.messages.some((message) => message.content === 'keep working if I close this'));
      return json({
        model: 'qwen3:8b',
        implementation: 'core-local',
        content: 'MCCLUSTER_DURABLE_REPLY',
        queue_wait_ms: 2,
        usage: { prompt_eval_count: 20, eval_count: 6, total_duration_ns: 123 }
      });
    }

    if (url.includes('/rest/v1/ops_ai_messages?on_conflict=id') && (init.method || 'GET') === 'POST') {
      const body = JSON.parse(String(init.body));
      assert.equal(body.id, ASSISTANT);
      assert.equal(body.content, 'MCCLUSTER_DURABLE_REPLY');
      assert.equal(body.metadata.agent_job_id, JOB);
      return json([{ ...body, created_at: '2026-09-27T22:30:00Z' }]);
    }

    throw new Error('unexpected fetch: ' + (init.method || 'GET') + ' ' + url);
  };

  try {
    const output = await residentAiTurn(job());
    assert.equal(output.assistant_message_id, ASSISTANT);
    assert.equal(output.model, 'qwen3:8b');
    assert.equal(output.replayed, false);
    assert.ok(calls.some((call) => call.url === 'http://127.0.0.1:4790/execute'));
    assert.ok(calls.some((call) => call.url.includes('on_conflict=id') && call.method === 'POST'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runner retry does not re-run inference after the assistant message is already durable', async () => {
  const originalFetch = globalThis.fetch;
  let adapterCalls = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('id=eq.' + ASSISTANT)) {
      return json([{
        id: ASSISTANT, thread_id: THREAD, org_id: ORG, role: 'assistant',
        content: 'already persisted', model: 'qwen3:8b',
        implementation: 'core-local', metadata: { agent_job_id: JOB }, created_at: '2026-09-27T22:30:00Z'
      }]);
    }
    if (url === 'http://127.0.0.1:4790/execute') {
      adapterCalls += 1;
      return json({ content: 'should not run' });
    }
    throw new Error('unexpected fetch: ' + url);
  };

  try {
    const output = await residentAiTurn(job());
    assert.equal(output.replayed, true);
    assert.equal(adapterCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
