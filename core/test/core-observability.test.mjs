/* Core writes the same canonical observability contract as the Worker:
   org-scoped, traced by job, no arguments or outputs, and never the reason a
   job fails. */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://db.test';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret';
process.env.MCCLUSTER_OLLAMA_ADAPTER_URL ||= 'http://127.0.0.1:4790';

const { coreEventRow, emitCoreEvent, jobTraceId } = await import('../src/observability.mjs');
const { residentAiTurn } = await import('../src/executors/resident-ai-turn.mjs');

const ORG = '00000000-0000-4000-8000-000000000001';
const THREAD = '00000000-0000-4000-8000-000000000002';
const USER = '00000000-0000-4000-8000-000000000003';
const ASSISTANT = '00000000-0000-4000-8000-000000000004';
const JOB = '00000000-0000-4000-8000-000000000005';
const TRACE = '4bf92f35-77b3-4da6-a3ce-929d0e0e4736';
const EVENTS = '/rest/v1/control_observability_events';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('a job traces under the trace it was handed, else its own id', () => {
  assert.equal(jobTraceId({ id: JOB, input: { trace_id: TRACE } }), TRACE);
  assert.equal(jobTraceId({ id: JOB, input: { trace_id: 'not-a-trace' } }), JOB);
  assert.match(jobTraceId({}), /^[0-9a-f-]{36}$/);
});

test('a Core row matches the Worker contract and refuses rows without an org', () => {
  const row = coreEventRow({
    orgId: ORG, traceId: TRACE, requestId: JOB, kind: 'job', name: 'Core Job resident_ai_turn Completed',
    resourceType: 'ops_agent_job', resourceId: JOB, durationMs: 12.6, detail: { attempt: 1 },
  });
  assert.deepEqual(Object.keys(row), [
    'org_id', 'trace_id', 'request_id', 'span_id', 'parent_span_id', 'event_kind', 'event_name',
    'level', 'outcome', 'source', 'service', 'route', 'method', 'status_code', 'duration_ms',
    'actor_user_id', 'resource_type', 'resource_id', 'message', 'detail', 'occurred_at',
  ]);
  assert.equal(row.source, 'core');
  assert.equal(row.event_name, 'core_job_resident_ai_turn_completed');
  assert.equal(row.trace_id, TRACE);
  assert.equal(row.request_id, JOB);
  assert.equal(row.duration_ms, 13);
  assert.equal(row.outcome, 'ok');
  assert.equal(coreEventRow({ name: 'x.y' }), null);
  assert.equal(coreEventRow({ orgId: 'nope', name: 'x.y' }), null);
});

test('emitting never throws, even when the store refuses the write', async () => {
  const original = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  globalThis.fetch = async () => json({ message: 'nope' }, 500);
  try {
    const result = await emitCoreEvent({ orgId: ORG, name: 'core.job.x.completed' });
    assert.deepEqual(result, { recorded: false, reason: 'write_failed' });
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
  }
});

test('a grounded resident turn records its research lookup and inference under the job trace', async () => {
  const written = [];
  const original = globalThis.fetch;
  const userRow = {
    id: USER, thread_id: THREAD, org_id: ORG, role: 'user',
    content: 'What is the latest on the Connecticut budget?', metadata: { agent_job_id: JOB }, created_at: '2026-10-05T14:01:00Z',
  };
  let persisted = null;
  let assistantLookup = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || 'GET';
    if (url.includes(EVENTS) && method === 'POST') {
      written.push(...JSON.parse(String(init.body)));
      return new Response(null, { status: 201 });
    }
    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('id=eq.' + ASSISTANT)) {
      assistantLookup += 1;
      return json(assistantLookup === 1 ? [] : [{ ...persisted }]);
    }
    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('id=eq.' + USER) && method === 'GET') return json([userRow]);
    if (url.includes('/rest/v1/ops_ai_messages?') && url.includes('thread_id=eq.' + THREAD)) return json([userRow]);
    if (url.includes('/rest/v1/ops_ai_messages?') && method === 'PATCH') return json([userRow]);
    if (url === 'http://127.0.0.1:4777/v1/capabilities/call') {
      return json({ provider: 'mccluster-core', result: { result: {
        provider: 'brave', fetched_at: '2026-10-05T14:02:00.000Z', result_count: 1,
        results: [{ title: 'Budget vote set', url: 'https://ctmirror.example/budget', snippet: 'Tuesday.' }],
      } } });
    }
    if (url === 'http://127.0.0.1:4790/execute') return json({ model: 'qwen3:8b', implementation: 'core-local', content: 'REPLY', queue_wait_ms: 3 });
    if (url.includes('/rest/v1/ops_ai_messages?on_conflict=id') && method === 'POST') {
      persisted = JSON.parse(String(init.body));
      return json([{ ...persisted }]);
    }
    throw new Error('unexpected fetch: ' + method + ' ' + url);
  };
  try {
    await residentAiTurn({
      id: JOB, org_id: ORG, job_type: 'resident_ai_turn',
      input: { thread_id: THREAD, user_message_id: USER, assistant_message_id: ASSISTANT, input_mode: 'text' },
    });
  } finally {
    globalThis.fetch = original;
  }
  const names = written.map((row) => row.event_name);
  assert.deepEqual(names, ['ai.research.lookup', 'ai.inference.completed']);
  for (const row of written) {
    assert.equal(row.org_id, ORG);
    assert.equal(row.trace_id, JOB, 'events for one job open as one trace');
    assert.equal(row.request_id, JOB);
    assert.equal(row.source, 'core');
    assert.equal(row.resource_type, 'ops_ai_thread');
    assert.equal(row.resource_id, THREAD);
    assert.doesNotMatch(JSON.stringify(row), /Connecticut budget/, 'the user prompt is not recorded');
  }
  assert.equal(written[0].detail.provider, 'brave');
  assert.equal(written[0].detail.result_count, 1);
  assert.equal(written[1].detail.model, 'qwen3:8b');
});
