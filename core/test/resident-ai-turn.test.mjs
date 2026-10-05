import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://db.test';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret';
process.env.MCCLUSTER_OLLAMA_ADAPTER_URL ||= 'http://127.0.0.1:4790';

const { residentAiTurn, needsCurrentResearch } = await import('../src/executors/resident-ai-turn.mjs');

const ORG = '00000000-0000-4000-8000-000000000001';
const THREAD = '00000000-0000-4000-8000-000000000002';
const USER = '00000000-0000-4000-8000-000000000003';
const ASSISTANT = '00000000-0000-4000-8000-000000000004';
const JOB = '00000000-0000-4000-8000-000000000005';
const LATER = '00000000-0000-4000-8000-000000000006';

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
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('created_at'), 'lte.2026-09-27T22:29:00Z');
      return json([
        {
          id: LATER, thread_id: THREAD, org_id: ORG, role: 'user',
          content: 'later prompt must not leak backward', metadata: { agent_job_id: LATER }, created_at: '2026-09-27T22:31:00Z'
        },
        {
          id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
          content: 'keep working if I close this', metadata: { agent_job_id: JOB }, created_at: '2026-09-27T22:29:00Z'
        }
      ]);
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
      assert.ok(!request.input.messages.some((message) => message.content === 'later prompt must not leak backward'));
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

test('freshness-triggering resident turns ground Qwen with timestamped web discovery', async () => {
  assert.equal(needsCurrentResearch('What is the latest situation today?'), true);
  assert.equal(needsCurrentResearch('Explain Rutherford scattering.'), false);

  const originalFetch = globalThis.fetch;
  let assistantLookup = 0;
  let brokerCalls = 0;
  let adapterMessages = null;
  let persistedMetadata = null;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);

    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('id=eq.' + ASSISTANT)) {
      assistantLookup += 1;
      return json(assistantLookup === 1 ? [] : [{
        id: ASSISTANT, thread_id: THREAD, org_id: ORG, role: 'assistant',
        content: 'Current answer with source.', model: 'qwen3:8b',
        implementation: 'core-local', metadata: persistedMetadata || {}, created_at: '2026-10-05T05:20:00Z'
      }]);
    }

    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('id=eq.' + USER) && (init.method || 'GET') === 'GET') {
      return json([{
        id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'What is the latest situation today?', metadata: { agent_job_id: JOB }, created_at: '2026-10-05T05:19:00Z'
      }]);
    }

    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('thread_id=eq.' + THREAD) && (init.method || 'GET') === 'GET') {
      return json([{
        id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'What is the latest situation today?', metadata: { agent_job_id: JOB }, created_at: '2026-10-05T05:19:00Z'
      }]);
    }

    if (url.includes('/rest/v1/ops_ai_messages?') && (init.method || 'GET') === 'PATCH') {
      return json([{
        id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'What is the latest situation today?', metadata: { agent_job_id: JOB }, created_at: '2026-10-05T05:19:00Z'
      }]);
    }

    if (url === 'http://127.0.0.1:4777/v1/capabilities/call') {
      brokerCalls += 1;
      const request = JSON.parse(String(init.body));
      assert.equal(request.capability, 'research.web');
      assert.match(request.arguments.objective, /latest situation today/i);
      return json({
        capability: 'research.web',
        result: {
          fetched_at: '2026-10-05T05:19:30Z',
          provider: 'brave',
          objective: request.arguments.objective,
          result_count: 1,
          results: [{
            title: 'Current source',
            url: 'https://example.com/current',
            snippet: 'Current discovery evidence.'
          }]
        }
      });
    }

    if (url === 'http://127.0.0.1:4790/execute') {
      const request = JSON.parse(String(init.body));
      adapterMessages = request.input.messages;
      assert.ok(adapterMessages.some((message) => /CURRENT-WEB-DISCOVERY EVIDENCE/.test(message.content)));
      assert.ok(adapterMessages.some((message) => /https:\/\/example\.com\/current/.test(message.content)));
      assert.ok(adapterMessages.some((message) => /Never present stale model memory as current information/.test(message.content)));
      return json({
        model: 'qwen3:8b',
        implementation: 'core-local',
        content: 'Current answer with source.',
        queue_wait_ms: 1
      });
    }

    if (url.includes('/rest/v1/ops_ai_messages?on_conflict=id') && (init.method || 'GET') === 'POST') {
      const body = JSON.parse(String(init.body));
      persistedMetadata = body.metadata;
      assert.equal(body.metadata.current_research.attempted, true);
      assert.equal(body.metadata.current_research.ok, true);
      assert.equal(body.metadata.current_research.provider, 'brave');
      assert.equal(body.metadata.current_research.result_count, 1);
      return json([{ ...body, created_at: '2026-10-05T05:20:00Z' }]);
    }

    throw new Error('unexpected fetch: ' + (init.method || 'GET') + ' ' + url);
  };

  try {
    const output = await residentAiTurn(job());
    assert.equal(brokerCalls, 1);
    assert.ok(adapterMessages);
    assert.equal(output.current_research.ok, true);
    assert.equal(output.current_research.fetched_at, '2026-10-05T05:19:30Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('empty current-web discovery also fails closed instead of laundering stale memory', async () => {
  const originalFetch = globalThis.fetch;
  let assistantLookup = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('id=eq.' + ASSISTANT)) {
      assistantLookup += 1;
      return json(assistantLookup === 1 ? [] : [{
        id: ASSISTANT, thread_id: THREAD, org_id: ORG, role: 'assistant',
        content: 'No current evidence was available.', model: 'qwen3:8b',
        implementation: 'core-local', metadata: {}, created_at: '2026-10-05T05:20:00Z'
      }]);
    }
    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('id=eq.' + USER) && (init.method || 'GET') === 'GET') {
      return json([{ id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'What is the latest update today?', metadata: { agent_job_id: JOB }, created_at: '2026-10-05T05:19:00Z' }]);
    }
    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('thread_id=eq.' + THREAD) && (init.method || 'GET') === 'GET') {
      return json([{ id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'What is the latest update today?', metadata: { agent_job_id: JOB }, created_at: '2026-10-05T05:19:00Z' }]);
    }
    if (url.includes('/rest/v1/ops_ai_messages?') && (init.method || 'GET') === 'PATCH') {
      return json([{ id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'What is the latest update today?', metadata: { agent_job_id: JOB }, created_at: '2026-10-05T05:19:00Z' }]);
    }
    if (url === 'http://127.0.0.1:4777/v1/capabilities/call') {
      return json({ capability: 'research.web', result: { fetched_at: '2026-10-05T05:19:30Z', provider: 'brave', result_count: 0, results: [] } });
    }
    if (url === 'http://127.0.0.1:4790/execute') {
      const request = JSON.parse(String(init.body));
      assert.ok(request.input.messages.some((message) => /CURRENT-WEB-LOOKUP STATUS: FAILED/.test(message.content)));
      assert.ok(request.input.messages.some((message) => /no usable results/.test(message.content)));
      return json({ model: 'qwen3:8b', implementation: 'core-local', content: 'No current evidence was available.', queue_wait_ms: 1 });
    }
    if (url.includes('/rest/v1/ops_ai_messages?on_conflict=id') && (init.method || 'GET') === 'POST') {
      const body = JSON.parse(String(init.body));
      assert.equal(body.metadata.current_research.attempted, true);
      assert.equal(body.metadata.current_research.ok, false);
      assert.match(body.metadata.current_research.error, /no usable results/);
      return json([{ ...body, created_at: '2026-10-05T05:20:00Z' }]);
    }
    throw new Error('unexpected fetch: ' + (init.method || 'GET') + ' ' + url);
  };

  try {
    const output = await residentAiTurn(job());
    assert.equal(output.current_research.attempted, true);
    assert.equal(output.current_research.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed freshness lookup is disclosed to Qwen instead of silently answering stale', async () => {
  assert.equal(needsCurrentResearch('What is happening right now?'), true);
  const originalFetch = globalThis.fetch;
  let assistantLookup = 0;
  let adapterMessages = null;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('id=eq.' + ASSISTANT)) {
      assistantLookup += 1;
      return json(assistantLookup === 1 ? [] : [{
        id: ASSISTANT, thread_id: THREAD, org_id: ORG, role: 'assistant',
        content: 'Could not verify current state.', model: 'qwen3:8b',
        implementation: 'core-local', metadata: {}, created_at: '2026-10-05T05:20:00Z'
      }]);
    }
    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('id=eq.' + USER) && (init.method || 'GET') === 'GET') {
      return json([{ id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'What is happening right now?', metadata: { agent_job_id: JOB }, created_at: '2026-10-05T05:19:00Z' }]);
    }
    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('thread_id=eq.' + THREAD) && (init.method || 'GET') === 'GET') {
      return json([{ id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'What is happening right now?', metadata: { agent_job_id: JOB }, created_at: '2026-10-05T05:19:00Z' }]);
    }
    if (url.includes('/rest/v1/ops_ai_messages?') && (init.method || 'GET') === 'PATCH') {
      return json([{ id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
        content: 'What is happening right now?', metadata: { agent_job_id: JOB }, created_at: '2026-10-05T05:19:00Z' }]);
    }
    if (url === 'http://127.0.0.1:4777/v1/capabilities/call') {
      return new Response(JSON.stringify({ error: 'search unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'http://127.0.0.1:4790/execute') {
      const request = JSON.parse(String(init.body));
      adapterMessages = request.input.messages;
      assert.ok(adapterMessages.some((message) => /CURRENT-WEB-LOOKUP STATUS: FAILED/.test(message.content)));
      assert.ok(adapterMessages.some((message) => /Do not answer from training memory as though it is current/.test(message.content)));
      return json({ model: 'qwen3:8b', implementation: 'core-local', content: 'Could not verify current state.', queue_wait_ms: 1 });
    }
    if (url.includes('/rest/v1/ops_ai_messages?on_conflict=id') && (init.method || 'GET') === 'POST') {
      const body = JSON.parse(String(init.body));
      assert.equal(body.metadata.current_research.attempted, true);
      assert.equal(body.metadata.current_research.ok, false);
      assert.match(body.metadata.current_research.error, /search unavailable/);
      return json([{ ...body, created_at: '2026-10-05T05:20:00Z' }]);
    }
    throw new Error('unexpected fetch: ' + (init.method || 'GET') + ' ' + url);
  };

  try {
    const output = await residentAiTurn(job());
    assert.ok(adapterMessages);
    assert.equal(output.current_research.attempted, true);
    assert.equal(output.current_research.ok, false);
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
