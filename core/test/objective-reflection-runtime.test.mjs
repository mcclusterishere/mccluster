import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchReflectionResponse } from '../src/executors/objective-reflection.mjs';

test('objective reflection retries transient Ollama connection failures', async () => {
  let calls = 0;
  const data = await fetchReflectionResponse(
    [{ role: 'user', content: 'test' }],
    {
      attempts: 3,
      timeoutMs: 1000,
      sleepImpl: async () => {},
      fetchImpl: async () => {
        calls += 1;
        if (calls < 3) throw new TypeError('fetch failed');
        return new Response(JSON.stringify({ message: { content: '{"summary":"ok"}' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  );

  assert.equal(calls, 3);
  assert.equal(data.message.content, '{"summary":"ok"}');
});

test('objective reflection does not retry client errors', async () => {
  let calls = 0;

  await assert.rejects(
    fetchReflectionResponse(
      [{ role: 'user', content: 'test' }],
      {
        attempts: 3,
        timeoutMs: 1000,
        sleepImpl: async () => {},
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({ error: 'bad request' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    ),
    /bad request/,
  );

  assert.equal(calls, 1);
});
