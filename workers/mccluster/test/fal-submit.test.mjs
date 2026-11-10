/* The paid submit is ONE provider request (audit 2026-11-09, C5, recovery
   lane). The vendor SDK's queue.submit retried the POST up to three more
   times on 429/502/503/504 and on transport errors, and its per-call retry
   option overrides the client configuration (@fal-ai/client 1.10.1). A gateway
   error or a dropped connection can hide an accepted request, so a hidden
   retry is a second paid job under one reservation. submitFal is now a plain
   POST: these tests pin that it is sent once, what it carries, and that every
   outcome is classified from that single attempt. Provider host stubbed; no
   network. */
import './support/offline-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySubmitError, submitFal } from '../src/media/fal.js';

const env = { FAL_KEY: 'synthetic-key' };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

/* answers: an array of (call) => Response | throws, one per expected request */
async function withQueue(answers, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const answer = answers[calls.length - 1];
    if (!answer) throw new Error(`unexpected request ${calls.length} to ${url}`);
    return answer(calls.at(-1));
  };
  try { return await fn(calls); } finally { globalThis.fetch = original; }
}

test('an accepted submission is one POST to the queue endpoint with the key, the JSON input and the webhook URL', async () => {
  await withQueue([() => json({ request_id: 'req-1', status_url: 'https://queue.fal.run/x/requests/req-1/status' })], async (calls) => {
    const webhookUrl = 'https://api.mccluster.org/v1/media/webhooks/fal/523e4567-e89b-42d3-a456-426614174001/tok_en-43';
    const answer = await submitFal(env, 'fal-ai/kling-video/v3/standard/image-to-video', { prompt: 'a lighthouse', duration: 5 }, { webhookUrl });
    assert.deepEqual(answer, { request_id: 'req-1' });
    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, `https://queue.fal.run/fal-ai/kling-video/v3/standard/image-to-video?fal_webhook=${encodeURIComponent(webhookUrl)}`, 'the webhook URL is URL-encoded as one parameter');
    assert.equal(new URL(url).searchParams.get('fal_webhook'), webhookUrl);
    assert.equal(init.method, 'POST');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Key synthetic-key');
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('accept'), 'application/json');
    assert.equal(headers.get('x-fal-queue-priority'), 'normal');
    assert.deepEqual(JSON.parse(init.body), { prompt: 'a lighthouse', duration: 5 });
  });
});

test('without a webhook URL the request carries no query string', async () => {
  await withQueue([() => json({ request_id: 'req-2' })], async (calls) => {
    await submitFal(env, 'fal-ai/flux-2', { prompt: 'p' });
    assert.equal(calls[0].url, 'https://queue.fal.run/fal-ai/flux-2');
  });
});

for (const status of [429, 500, 502, 503, 504]) {
  test(`a ${status} answer is never retried: one POST, and the caller sees that answer`, async () => {
    await withQueue([() => json({ detail: 'provider busy' }, status), () => json({ request_id: 'second-paid-job' })], async (calls) => {
      const error = await submitFal(env, 'fal-ai/flux-2', { prompt: 'p' }).catch((e) => e);
      assert.equal(calls.length, 1, 'exactly one provider request');
      assert.ok(error instanceof Error);
      assert.equal(error.status, status);
      assert.equal(error.message, 'provider busy');
      assert.deepEqual(error.detail, { detail: 'provider busy' });
      /* 502 and 504 come from an intermediary and may hide an accepted request */
      assert.equal(classifySubmitError(error), status === 502 || status === 504 ? 'uncertain' : 'definite');
    });
  });
}

test('a refusal with a message, without JSON, or with the provider\'s timeout header is reported from the one answer', async () => {
  await withQueue([() => json({ message: 'Unprocessable input', detail: [{ loc: ['body', 'prompt'] }] }, 422)], async () => {
    const error = await submitFal(env, 'fal-ai/flux-2', {}).catch((e) => e);
    assert.equal(error.status, 422);
    assert.equal(error.message, 'Unprocessable input');
    assert.equal(classifySubmitError(error), 'definite');
  });
  await withQueue([() => new Response('<html>bad gateway</html>', { status: 400 })], async () => {
    const error = await submitFal(env, 'fal-ai/flux-2', {}).catch((e) => e);
    assert.equal(error.status, 400);
    assert.equal(error.message, 'fal queue request failed (HTTP 400)');
    assert.equal(error.detail, '<html>bad gateway</html>');
  });
  await withQueue([() => json({ detail: 'start timeout' }, 504, { 'x-fal-request-timeout-type': 'user' })], async () => {
    const error = await submitFal(env, 'fal-ai/flux-2', {}).catch((e) => e);
    assert.equal(error.timeoutType, 'user');
    assert.equal(classifySubmitError(error), 'uncertain');
  });
});

test('a 2xx without a request id is an unknown outcome, never "not submitted"', async () => {
  for (const answer of [() => json({ status: 'IN_QUEUE' }), () => new Response('', { status: 200 }), () => new Response('not json', { status: 202 }), () => json({ request_id: 42 })]) {
    await withQueue([answer], async (calls) => {
      const error = await submitFal(env, 'fal-ai/flux-2', { prompt: 'p' }).catch((e) => e);
      assert.equal(calls.length, 1);
      assert.equal(error.uncertain, true);
      assert.equal(classifySubmitError(error), 'uncertain');
    });
  }
});

test('a transport failure is an unknown outcome and is not retried', async () => {
  const failures = [
    new TypeError('fetch failed', { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) }),
    Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    Object.assign(new Error('timed out'), { name: 'TimeoutError' })
  ];
  for (const failure of failures) {
    await withQueue([() => { throw failure; }, () => json({ request_id: 'second-paid-job' })], async (calls) => {
      const error = await submitFal(env, 'fal-ai/flux-2', { prompt: 'p' }).catch((e) => e);
      assert.equal(calls.length, 1, 'the SDK retried exactly these');
      assert.equal(error.uncertain, true);
      assert.equal(error.name, failure.name);
      assert.equal(error.message, failure.message);
      assert.equal(error.cause, failure);
      assert.equal(classifySubmitError(error), 'uncertain');
    });
  }
});

test('nothing is sent without a key or for a model id that is not a queue endpoint: both are definite preflight failures', async () => {
  await withQueue([], async (calls) => {
    const noKey = await submitFal({}, 'fal-ai/flux-2', { prompt: 'p' }).catch((e) => e);
    assert.equal(noKey.status, 503);
    assert.equal(noKey.preflight, true);
    assert.equal(classifySubmitError(noKey), 'definite');
    for (const modelId of [undefined, null, '', 'flux', 'fal-ai/flux-2?fal_webhook=https://evil.invalid', 'fal-ai/../admin', '/fal-ai/flux-2', 'fal-ai//flux-2', 'https://evil.invalid/x/y', 'fal-ai/flux 2', 'fal-ai/flux-2#frag']) {
      const error = await submitFal(env, modelId, { prompt: 'p' }).catch((e) => e);
      assert.equal(error.preflight, true, String(modelId));
      assert.equal(classifySubmitError(error), 'definite', String(modelId));
    }
    assert.equal(calls.length, 0, 'no request left');
  });
});
