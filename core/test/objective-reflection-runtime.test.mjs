import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchReflectionResponse } from '../src/executors/objective-reflection.mjs';

test('objective reflection retries transient local-AI transport failures', async () => {
  let calls = 0;
  const data = await fetchReflectionResponse(
    [{ role: 'user', content: 'test' }],
    {
      attempts: 3,
      timeoutMs: 1000,
      sleepImpl: async () => {},
      chatImpl: async () => {
        calls += 1;
        if (calls < 3) throw new TypeError('fetch failed');
        return { message: { content: '{"summary":"ok"}' } };
      },
    },
  );

  assert.equal(calls, 3);
  assert.equal(data.message.content, '{"summary":"ok"}');
});

test('objective reflection does not retry non-retryable local-AI errors', async () => {
  let calls = 0;

  await assert.rejects(
    fetchReflectionResponse(
      [{ role: 'user', content: 'test' }],
      {
        attempts: 3,
        timeoutMs: 1000,
        sleepImpl: async () => {},
        chatImpl: async () => {
          calls += 1;
          throw Object.assign(new Error('bad request'), { status: 400, retryable: false });
        },
      },
    ),
    /bad request/,
  );

  assert.equal(calls, 1);
});
