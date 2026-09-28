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

test('background reflection defaults cannot monopolize the interactive AI lane', async () => {
  const priorAttempts = process.env.MCCLUSTER_REFLECTION_AI_ATTEMPTS;
  const priorTimeout = process.env.MCCLUSTER_REFLECTION_AI_TIMEOUT_MS;
  delete process.env.MCCLUSTER_REFLECTION_AI_ATTEMPTS;
  delete process.env.MCCLUSTER_REFLECTION_AI_TIMEOUT_MS;
  let observed = null;

  try {
    await fetchReflectionResponse(
      [{ role: 'user', content: 'background reflection' }],
      {
        chatImpl: async (request) => {
          observed = request;
          return { message: { content: '{"summary":"ok"}' } };
        },
        sleepImpl: async () => {},
      },
    );
    assert.equal(observed.timeoutMs, 90000);
    assert.equal(observed.numCtx, 8192);
  } finally {
    if (priorAttempts === undefined) delete process.env.MCCLUSTER_REFLECTION_AI_ATTEMPTS;
    else process.env.MCCLUSTER_REFLECTION_AI_ATTEMPTS = priorAttempts;
    if (priorTimeout === undefined) delete process.env.MCCLUSTER_REFLECTION_AI_TIMEOUT_MS;
    else process.env.MCCLUSTER_REFLECTION_AI_TIMEOUT_MS = priorTimeout;
  }
});

test('background reflection ignores unsafe high timeout and retry environment values', async () => {
  const priorAttempts = process.env.MCCLUSTER_REFLECTION_AI_ATTEMPTS;
  const priorTimeout = process.env.MCCLUSTER_REFLECTION_AI_TIMEOUT_MS;
  process.env.MCCLUSTER_REFLECTION_AI_ATTEMPTS = '9';
  process.env.MCCLUSTER_REFLECTION_AI_TIMEOUT_MS = '600000';
  let calls = 0;
  let timeout = null;

  try {
    await assert.rejects(
      fetchReflectionResponse(
        [{ role: 'user', content: 'background reflection' }],
        {
          chatImpl: async (request) => {
            calls += 1;
            timeout = request.timeoutMs;
            throw new TypeError('fetch failed');
          },
          sleepImpl: async () => {},
        },
      ),
      /fetch failed/,
    );
    assert.equal(calls, 1);
    assert.equal(timeout, 90000);
  } finally {
    if (priorAttempts === undefined) delete process.env.MCCLUSTER_REFLECTION_AI_ATTEMPTS;
    else process.env.MCCLUSTER_REFLECTION_AI_ATTEMPTS = priorAttempts;
    if (priorTimeout === undefined) delete process.env.MCCLUSTER_REFLECTION_AI_TIMEOUT_MS;
    else process.env.MCCLUSTER_REFLECTION_AI_TIMEOUT_MS = priorTimeout;
  }
});
